"""Serve the Pick a Game site, and run the race server for live Bike Race races.

Python standard library only. One process serves public/ and runs the Bike Race rooms:

  python tools/serve.py           http on 127.0.0.1:8000 (mise run app). PORT and HOST change it.
  python tools/serve.py --https   https on every network address, port 8443 (mise run phone), so phones on the
                                  same Wi-Fi can use tilt and race each other.

Phones only send tilt (motion) events to https pages. --https makes a self-signed certificate the first time
(it needs the `openssl` command) and keeps it in .cert/. Phones warn that the connection is not private: that is
expected for a self-signed certificate on your own network.

Live races are JSON messages over a WebSocket at /ws. A browser can refuse a WebSocket to a self-signed
certificate even after the page itself was allowed (iPhones are the worry), so the same messages also work over a
server-sent event stream (GET /net/events) plus POSTs (POST /net/send?sid=...). docs/bike-race.md lists them.
"""
import argparse
import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import pathlib
import re
import secrets
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import time
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = (ROOT / "public").resolve()
CERT_DIR = ROOT / ".cert"
CERT, KEY = CERT_DIR / "cert.pem", CERT_DIR / "key.pem"

# Races. The BR_ variables are for the tests, which don't want to wait.
COUNTDOWN = float(os.environ.get("BR_COUNTDOWN", "3"))   # seconds of 3, 2, 1 before a race
ENDING = float(os.environ.get("BR_ENDING", "30"))         # seconds the others get once the first rider finishes
AWAY = float(os.environ.get("BR_AWAY", "45"))             # seconds a dropped rider keeps their place (a phone drops
                                                          # the connection when its screen locks or another app opens)
RACE_LIMIT = 300            # a race ends after this many seconds whatever happens
MAX_PLAYERS = 6             # riders in one room
MAX_ROOMS = 200
MAX_CONNECTIONS = 300
CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ"   # no vowels, so codes don't spell words, and no I or O to mix up with 1 and 0

# Connections
IDLE = 30                   # seconds without a message before a race connection is dropped (the game pings every 5 s)
KEEP_ALIVE = 30             # seconds an idle http connection stays open
MAX_HEAD = 16 * 1024        # request line and headers
MAX_BODY = 64 * 1024
MAX_MESSAGE = 16 * 1024     # one race message
MAX_BUFFER = 512 * 1024     # unsent bytes before a connection counts as stuck and is dropped
MAX_PER_SECOND = 90         # race messages a connection may send each second (poses go 20 times a second)


def log(text):
    print(time.strftime("%H:%M:%S"), text, flush=True)


# ---------------------------------------------------------------------------------------------------------------
# Rooms and races

def clean_name(v):
    v = re.sub(r"[\x00-\x1f\x7f]", "", v if isinstance(v, str) else "").strip()[:16]
    return v or "Rider"


def clean_int(v, lo, hi, default=0):
    return max(lo, min(hi, int(v))) if number(v) else default


def clean_bike(v):
    return v if isinstance(v, str) and re.fullmatch(r"[a-z]{1,16}", v) else "scout"


def clean_level(v):
    return v if isinstance(v, str) and re.fullmatch(r"[a-z]{1,16}-\d{1,2}", v) else None


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


class Player:
    def __init__(self, pid, key):
        self.id, self.key = pid, key
        self.name, self.paint, self.bike = "Rider", 0, "scout"
        self.conn = None          # the live connection, None while dropped
        self.room = None
        self.wins = 0
        self.away_timer = None

    def send(self, msg):
        if self.conn:
            self.conn.send(msg)

    def public(self):
        return {"id": self.id, "name": self.name, "paint": self.paint, "bike": self.bike, "wins": self.wins,
                "away": self.conn is None}


class Room:
    def __init__(self, code, level, host):
        self.code, self.level, self.host = code, level, host.id
        self.players = {}         # id -> Player, in the order they joined
        self.state = "lobby"      # lobby | countdown | race
        self.racers = {}          # id -> {name, paint, bike, time, out} for the race on now
        self.ends_at = None       # when the race closes, once someone has finished
        self.last = None          # results of the last race
        self.created = time.monotonic()
        self.timers = []

    def later(self, seconds, fn, *args):
        self.timers.append(asyncio.get_running_loop().call_later(seconds, fn, *args))

    def cancel_timers(self):
        for t in self.timers:
            t.cancel()
        self.timers = []

    def broadcast(self, msg):
        for p in self.players.values():
            p.send(msg)

    def public(self):
        racing = self.state != "lobby"
        return {"t": "room", "code": self.code, "host": self.host, "level": self.level, "state": self.state,
                "players": [p.public() for p in self.players.values()],
                "racers": list(self.racers) if racing else [],
                "ending": max(0, round(self.ends_at - time.monotonic())) if racing and self.ends_at else None,
                "last": self.last}


class Lobby:
    COMMANDS = {"list", "create", "join", "leave", "level", "start", "state", "finish", "retire"}

    def __init__(self, share=""):
        self.players = {}         # resume key -> Player
        self.rooms = {}           # code -> Room
        self.next_id = 1
        self.share = share        # the address friends on the network can open, if the server has one

    def handle(self, conn, msg):
        t = msg.get("t")
        if not isinstance(t, str):
            return
        if t == "ping":
            conn.send({"t": "pong", "c": msg.get("c") if number(msg.get("c")) else 0})
        elif t == "hello":
            self.hello(conn, msg)
        elif t in self.COMMANDS:
            if conn.player is None:
                conn.send({"t": "error", "msg": "Say hello first."})
            else:
                getattr(self, "on_" + t)(conn.player, msg)

    # A connection says hello first, with the key it was given last time (if any). A rider who dropped out a moment
    # ago gets their place back; anyone else is a new rider with a new key.
    def hello(self, conn, msg):
        first = conn.player is None
        resumed = False
        if first:
            key = msg.get("key")
            p = self.players.get(key) if isinstance(key, str) else None
            if p is not None:
                resumed = True
                if p.away_timer:
                    p.away_timer.cancel()
                    p.away_timer = None
                if p.conn is not None:          # the old connection hasn't noticed it is dead yet, or another tab
                    old, p.conn = p.conn, None
                    old.send({"t": "replaced"})
                    old.player = None
                    old.close()
            else:
                p = Player(f"p{self.next_id}", secrets.token_hex(8))
                self.next_id += 1
                self.players[p.key] = p
            p.conn, conn.player = conn, p
        p = conn.player
        p.name, p.paint, p.bike = clean_name(msg.get("name")), clean_int(msg.get("paint"), 0, 999), clean_bike(msg.get("bike"))
        if first:
            conn.send({"t": "welcome", "id": p.id, "key": p.key, "resumed": resumed, "share": self.share})
            if resumed and p.room:
                log(f"{p.name} is back in room {p.room.code}")
        if p.room:
            p.room.broadcast(p.room.public())

    def dropped(self, conn):
        p = conn.player
        if p is None or p.conn is not conn:
            return
        p.conn = None
        room = p.room
        if room:
            log(f"{p.name} dropped out of room {room.code}, keeping their place for {AWAY:g} s")
            # a host who drops out between races hands over straight away, so the others can still start one
            if room.host == p.id and room.state == "lobby":
                self.pass_host(room)
            room.broadcast(room.public())
        p.away_timer = asyncio.get_running_loop().call_later(AWAY, self.expire, p)

    def expire(self, p):
        p.away_timer = None
        if p.conn is None:
            self.leave_room(p)
            self.players.pop(p.key, None)

    def rooms_msg(self):
        rooms = sorted(self.rooms.values(), key=lambda r: -r.created)[:30]
        return {"t": "rooms", "rooms": [{"code": r.code, "host": r.players[r.host].name if r.host in r.players else "",
                                         "level": r.level, "count": len(r.players), "state": r.state} for r in rooms]}

    def on_list(self, p, msg):
        p.send(self.rooms_msg())

    def new_code(self):
        while True:
            code = "".join(secrets.choice(CODE_LETTERS) for _ in range(4))
            if code not in self.rooms:
                return code

    def on_create(self, p, msg):
        level = clean_level(msg.get("level"))
        if not level:
            return p.send({"t": "error", "msg": "Pick a track first."})
        if len(self.rooms) >= MAX_ROOMS:
            return p.send({"t": "error", "msg": "This race server is full. Try again in a minute."})
        self.leave_room(p)
        room = Room(self.new_code(), level, p)
        self.rooms[room.code] = room
        room.players[p.id], p.room = p, room
        log(f"{p.name} opened room {room.code} on {level}")
        room.broadcast(room.public())

    def on_join(self, p, msg):
        code = str(msg.get("code") or "").strip().upper()[:8]
        room = self.rooms.get(code)
        if room is None:
            return p.send({"t": "error", "msg": f"There is no room {code or '----'}. Check the code?", "code": code})
        if p.room is room:
            return p.send(room.public())
        if len(room.players) >= MAX_PLAYERS:
            return p.send({"t": "error", "msg": f"Room {code} is full ({MAX_PLAYERS} riders).", "code": code})
        self.leave_room(p)
        room.players[p.id], p.room = p, room
        log(f"{p.name} joined room {code} ({len(room.players)} riders)")
        room.broadcast(room.public())

    def on_leave(self, p, msg):
        self.leave_room(p)
        p.send({"t": "left"})

    def leave_room(self, p):
        room = p.room
        if room is None:
            return
        del room.players[p.id]
        p.room = None
        if p.id in room.racers:
            room.racers[p.id]["out"] = True
        if not room.players:
            room.cancel_timers()
            del self.rooms[room.code]
            log(f"room {room.code} closed")
            return
        if room.host == p.id:
            self.pass_host(room)
        room.broadcast(room.public())
        self.check_done(room)

    @staticmethod
    def pass_host(room):
        """The next rider to have joined takes over, preferring one who is connected."""
        old = room.host
        room.host = next((q.id for q in room.players.values() if q.conn and q.id != old),
                         next((q for q in room.players if q != old), old))
        if room.host != old:
            log(f"{room.players[room.host].name} is now host of room {room.code}")

    def on_level(self, p, msg):
        room, level = p.room, clean_level(msg.get("level"))
        if room and room.host == p.id and room.state == "lobby" and level:
            room.level = level
            room.broadcast(room.public())

    def on_start(self, p, msg):
        room = p.room
        if room is None:
            return
        if room.host != p.id:
            return p.send({"t": "error", "msg": "Only the host can start the race."})
        if room.state != "lobby":
            return
        room.racers = {q.id: {"name": q.name, "paint": q.paint, "bike": q.bike, "time": None, "out": False}
                       for q in room.players.values() if q.conn}
        room.state, room.ends_at = "countdown", None
        room.broadcast({"t": "countdown", "level": room.level, "racers": list(room.racers), "seconds": COUNTDOWN})
        room.broadcast(room.public())
        room.later(COUNTDOWN, self.go, room)
        log(f"race in room {room.code} on {room.level} with {len(room.racers)} rider{'s' if len(room.racers) != 1 else ''}")

    def go(self, room):
        if room.state == "countdown":
            room.state = "race"
            room.later(RACE_LIMIT, self.end_race, room)
            room.broadcast(room.public())

    def on_state(self, p, msg):
        room, pose = p.room, msg.get("p")
        if not room or room.state == "lobby" or p.id not in room.racers:
            return
        if not isinstance(pose, list) or not 1 <= len(pose) <= 8 or not all(number(v) for v in pose):
            return
        out = {"t": "state", "id": p.id, "p": pose}
        if number(msg.get("c")):
            out["c"] = msg["c"]
        for q in room.players.values():
            if q is not p and q.id in room.racers:
                q.send(out)

    def on_finish(self, p, msg):
        room, t = p.room, msg.get("time")
        if not room or room.state != "race" or p.id not in room.racers or not number(t) or not 0 < t < RACE_LIMIT + 60:
            return
        rec = room.racers[p.id]
        if rec["time"] is not None or rec["out"]:
            return
        rec["time"] = round(t, 3)
        room.broadcast({"t": "finished", "id": p.id, "time": rec["time"]})
        if room.ends_at is None and self.outstanding(room):
            room.ends_at = time.monotonic() + ENDING
            room.later(ENDING, self.end_race, room)
            room.broadcast({"t": "ending", "seconds": ENDING})
        self.check_done(room)

    # a rider who gave up the race (left it from the pause menu, or reloaded the page) but stays in the room
    def on_retire(self, p, msg):
        room = p.room
        if room and room.state != "lobby" and p.id in room.racers and room.racers[p.id]["time"] is None:
            room.racers[p.id]["out"] = True
            room.broadcast(room.public())
            self.check_done(room)

    @staticmethod
    def outstanding(room):
        return [r for r in room.racers.values() if r["time"] is None and not r["out"]]

    def check_done(self, room):
        if room.state != "lobby" and not self.outstanding(room):
            self.end_race(room)

    def end_race(self, room):
        if room.state == "lobby" or self.rooms.get(room.code) is not room:
            return
        room.cancel_timers()
        rows = []
        for pid, rec in room.racers.items():
            q = room.players.get(pid)
            rows.append({"id": pid, "name": q.name if q else rec["name"], "paint": q.paint if q else rec["paint"],
                         "bike": q.bike if q else rec["bike"], "time": rec["time"]})
        rows.sort(key=lambda r: (r["time"] is None, r["time"] or 0))
        if len(rows) > 1 and rows[0]["time"] is not None and rows[0]["id"] in room.players:
            room.players[rows[0]["id"]].wins += 1
        room.state, room.ends_at, room.racers, room.last = "lobby", None, {}, rows
        if room.host in room.players and room.players[room.host].conn is None:
            self.pass_host(room)
        room.broadcast({"t": "results", "level": room.level, "results": rows})
        room.broadcast(room.public())
        log(f"room {room.code} results: " + ", ".join(f"{r['name']} {r['time']:.2f}" if r["time"] is not None else f"{r['name']} DNF" for r in rows))


# ---------------------------------------------------------------------------------------------------------------
# Race connections: a WebSocket, or an event stream with POSTs. Both carry the same JSON messages.

class Conn:
    def __init__(self, kind, writer):
        self.kind, self.writer = kind, writer       # kind: ws | sse
        self.player = None
        self.closed = False
        self.sid = None
        self.last_in = time.monotonic()
        self._second, self._count = 0, 0

    def allow(self):
        now = int(time.monotonic())
        if now != self._second:
            self._second, self._count = now, 0
        self._count += 1
        self.last_in = time.monotonic()
        return self._count <= MAX_PER_SECOND

    def raw(self, data):
        if self.closed:
            return
        transport = self.writer.transport
        if transport is None or transport.is_closing():
            return self.close()
        if transport.get_write_buffer_size() > MAX_BUFFER:
            log("dropping a connection that stopped reading")
            return self.close()
        self.writer.write(data)

    def send(self, msg):
        data = json.dumps(msg, separators=(",", ":")).encode()
        self.raw(ws_frame(0x1, data) if self.kind == "ws" else b"data: " + data + b"\n\n")

    def close(self, code=1000):
        if self.closed:
            return
        self.closed = True
        try:
            if self.kind == "ws" and not self.writer.transport.is_closing():
                self.writer.write(ws_frame(0x8, struct.pack("!H", code)))
            self.writer.close()
        except Exception:
            pass


def ws_frame(op, payload):
    n = len(payload)
    if n < 126:
        head = struct.pack("!BB", 0x80 | op, n)
    elif n < 65536:
        head = struct.pack("!BBH", 0x80 | op, 126, n)
    else:
        head = struct.pack("!BBQ", 0x80 | op, 127, n)
    return head + payload


class WsError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


async def read_ws_frame(reader):
    b1, b2 = await reader.readexactly(2)
    fin, op, n = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
    if b1 & 0x70 or not b2 & 0x80:          # no extensions, and browsers always mask what they send
        raise WsError(1002)
    if op >= 0x8 and (n > 125 or not fin):
        raise WsError(1002)
    if n == 126:
        n = struct.unpack("!H", await reader.readexactly(2))[0]
    elif n == 127:
        n = struct.unpack("!Q", await reader.readexactly(8))[0]
    if n > MAX_MESSAGE:
        raise WsError(1009)
    mask = await reader.readexactly(4)
    data = await reader.readexactly(n)
    if n:
        data = (int.from_bytes(data, "big") ^ int.from_bytes((mask * (n // 4 + 1))[:n], "big")).to_bytes(n, "big")
    return bool(fin), op, data


def reject_constant(name):
    raise ValueError(name)    # json.loads would otherwise accept NaN and Infinity, which browsers can't parse back


def decode(data):
    try:
        return json.loads(data, parse_constant=reject_constant)
    except (ValueError, UnicodeDecodeError, RecursionError):
        return None


class Server:
    def __init__(self, lobby):
        self.lobby = lobby
        self.conns = set()
        self.streams = {}         # event stream id -> Conn

    def message(self, conn, msg):
        if isinstance(msg, dict) and conn.allow():
            try:
                self.lobby.handle(conn, msg)
            except Exception as e:      # log it and carry on: one bad message shouldn't end anyone's race
                log(f"error handling {str(msg.get('t'))[:20]!r}: {e!r}")

    async def websocket(self, reader, writer, method, headers):
        key = headers.get("sec-websocket-key", "")
        try:
            ok_key = len(base64.b64decode(key, validate=True)) == 16
        except ValueError:
            ok_key = False
        if method != "GET" or "websocket" not in headers.get("upgrade", "").lower() or not ok_key \
                or headers.get("sec-websocket-version") != "13":
            return await respond(writer, 400, body=b"Expected a WebSocket\n")
        if not same_origin(headers):
            return await respond(writer, 403, body=b"Wrong origin\n")
        if len(self.conns) >= MAX_CONNECTIONS:
            return await respond(writer, 503, body=b"Too many riders\n")
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        conn = Conn("ws", writer)
        self.conns.add(conn)
        parts, part_op = [], 0
        try:
            while not conn.closed:
                try:
                    fin, op, data = await asyncio.wait_for(read_ws_frame(reader), IDLE)
                except WsError as e:
                    return conn.close(e.code)
                except asyncio.TimeoutError:
                    return conn.close(1001)
                if op == 0x8:
                    return conn.close()
                if op == 0x9:
                    conn.raw(ws_frame(0xA, data))
                    continue
                if op == 0xA:
                    continue
                if op in (0x1, 0x2):
                    if parts:
                        return conn.close(1002)
                    parts, part_op = [data], op
                elif op == 0x0:
                    if not parts:
                        return conn.close(1002)
                    parts.append(data)
                    if sum(map(len, parts)) > MAX_MESSAGE:
                        return conn.close(1009)
                else:
                    return conn.close(1002)
                if fin:
                    data, parts = b"".join(parts), []
                    if part_op == 0x1:
                        self.message(conn, decode(data))
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass
        finally:
            conn.close()
            self.conns.discard(conn)
            self.lobby.dropped(conn)

    async def event_stream(self, reader, writer, method, headers):
        if method != "GET":
            return await respond(writer, 405, [("Allow", "GET")])
        if not same_origin(headers):
            return await respond(writer, 403, body=b"Wrong origin\n")
        if len(self.conns) >= MAX_CONNECTIONS:
            return await respond(writer, 503, body=b"Too many riders\n")
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\n"
                     b"Connection: close\r\nX-Accel-Buffering: no\r\n\r\n")
        conn = Conn("sse", writer)
        conn.sid = secrets.token_urlsafe(12)
        self.conns.add(conn)
        self.streams[conn.sid] = conn
        conn.send({"t": "conn", "sid": conn.sid})
        try:
            while not conn.closed:
                try:
                    if not await asyncio.wait_for(reader.read(1024), 10):
                        break                               # the browser closed the stream
                except asyncio.TimeoutError:
                    pass
                if time.monotonic() - conn.last_in > IDLE:
                    break
                conn.raw(b": still here\n\n")
        except (ConnectionError, OSError):
            pass
        finally:
            conn.close()
            self.conns.discard(conn)
            self.streams.pop(conn.sid, None)
            self.lobby.dropped(conn)

    async def stream_post(self, writer, method, target, headers, body, keep):
        if method != "POST":
            return await respond(writer, 405, [("Allow", "POST")], keep=keep)
        if not same_origin(headers):
            return await respond(writer, 403, keep=keep)
        sid = urllib.parse.parse_qs(urllib.parse.urlsplit(target).query).get("sid", [""])[0]
        conn = self.streams.get(sid)
        if conn is None or conn.closed:
            return await respond(writer, 410, body=b"That stream is closed\n", keep=keep)
        msgs = decode(body)
        if isinstance(msgs, dict):
            msgs = [msgs]
        if not isinstance(msgs, list):
            return await respond(writer, 400, keep=keep)
        conn.last_in = time.monotonic()
        for m in msgs[:60]:
            self.message(conn, m)
        await respond(writer, 204, [("Cache-Control", "no-store")], keep=keep)

    # one http connection: static files, or a race connection that takes it over
    async def handle(self, reader, writer):
        try:
            while True:
                try:
                    req = await asyncio.wait_for(read_request(reader), KEEP_ALIVE)
                except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, ValueError,
                        ConnectionError, OSError):
                    return
                if req is None:
                    return await respond(writer, 400, keep=False)
                method, target, version, headers = req
                keep = version == "HTTP/1.1" and "close" not in headers.get("connection", "").lower()
                if "transfer-encoding" in headers:
                    return await respond(writer, 411, keep=False)
                try:
                    length = int(headers.get("content-length") or 0)
                except ValueError:
                    return await respond(writer, 400, keep=False)
                if not 0 <= length <= MAX_BODY:
                    return await respond(writer, 413, keep=False)
                body = await asyncio.wait_for(reader.readexactly(length), KEEP_ALIVE) if length else b""
                path = urllib.parse.urlsplit(target).path
                if path == "/ws":
                    return await self.websocket(reader, writer, method, headers)
                if path == "/net/events":
                    return await self.event_stream(reader, writer, method, headers)
                if path == "/net/send":
                    await self.stream_post(writer, method, target, headers, body, keep)
                else:
                    await serve_file(writer, method, path, headers, keep)
                if not keep:
                    return
        except (asyncio.IncompleteReadError, asyncio.TimeoutError, ConnectionError, OSError):
            pass
        finally:
            try:
                writer.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------------------------------------------
# http

REASONS = {101: "Switching Protocols", 200: "OK", 204: "No Content", 304: "Not Modified", 400: "Bad Request",
           403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 410: "Gone", 411: "Length Required",
           413: "Content Too Large", 503: "Service Unavailable"}
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
         ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
         ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
         ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav"}


async def read_request(reader):
    head = await reader.readuntil(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    parts = lines[0].split(" ")
    if len(parts) != 3 or not parts[2].startswith("HTTP/1."):
        return None
    headers = {}
    for line in lines[1:]:
        if line:
            name, sep, value = line.partition(":")
            if not sep:
                return None
            headers[name.strip().lower()] = value.strip()
    return parts[0], parts[1], parts[2], headers


async def respond(writer, status, headers=(), body=b"", keep=False, head_only=False):
    lines = [f"HTTP/1.1 {status} {REASONS.get(status, 'Error')}"]
    lines += [f"{k}: {v}" for k, v in headers]
    if status not in (204, 304):
        lines.append(f"Content-Length: {len(body)}")
        if body and not any(k.lower() == "content-type" for k, _ in headers):
            lines.append("Content-Type: text/plain; charset=utf-8")
    lines.append("Connection: " + ("keep-alive" if keep else "close"))
    writer.write(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + (b"" if head_only or status in (204, 304) else body))
    await writer.drain()


def same_origin(headers):
    origin = headers.get("origin")
    return not origin or urllib.parse.urlsplit(origin).netloc.lower() == headers.get("host", "").lower()


def find_file(url_path):
    parts = []
    for part in urllib.parse.unquote(url_path).split("/"):
        if part in ("", "."):
            continue
        if part.startswith(".") or "\\" in part or "\x00" in part:     # no .., and no hidden files
            return None
        parts.append(part)
    try:
        f = PUBLIC.joinpath(*parts)
        if f.is_dir():
            f = f / "index.html"
        f = f.resolve()
        return f if f.is_file() and f.is_relative_to(PUBLIC) else None
    except (OSError, ValueError):
        return None


async def serve_file(writer, method, path, headers, keep):
    if method not in ("GET", "HEAD"):
        return await respond(writer, 405, [("Allow", "GET, HEAD")], keep=keep)
    f = find_file(path)
    if f is None:
        return await respond(writer, 404, body=b"Not found\n", keep=keep, head_only=method == "HEAD")
    st = f.stat()
    etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
    common = [("Cache-Control", "no-cache"), ("ETag", etag)]     # always check for a newer file, but reuse an unchanged one
    if headers.get("if-none-match") == etag:
        return await respond(writer, 304, common, keep=keep)
    kind = TYPES.get(f.suffix.lower()) or mimetypes.guess_type(f.name)[0] or "application/octet-stream"
    await respond(writer, 200, common + [("Content-Type", kind)], f.read_bytes(), keep=keep, head_only=method == "HEAD")


# ---------------------------------------------------------------------------------------------------------------
# Starting up

def lan_address():
    """The address other devices on the network can reach this computer at (no packets are sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_certificate():
    if CERT.exists() and KEY.exists():
        return
    if not shutil.which("openssl"):
        sys.exit("serve: the openssl command is needed to make a certificate for https, and it was not found.")
    CERT_DIR.mkdir(exist_ok=True)
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
         "-keyout", str(KEY), "-out", str(CERT), "-subj", "/CN=Pick a Game (local)"],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def quiet_errors(loop, context):
    # a phone that hasn't accepted the self-signed certificate yet drops the connection mid-handshake: not news
    exc = context.get("exception")
    if isinstance(exc, (ssl.SSLError, ConnectionError, TimeoutError)) or "SSL" in context.get("message", ""):
        return
    loop.default_exception_handler(context)


async def run(host, port, tls):
    loop = asyncio.get_running_loop()
    loop.set_exception_handler(quiet_errors)
    everywhere = host in ("0.0.0.0", "::", "")
    scheme = "https" if tls else "http"
    share = f"{scheme}://{lan_address()}:{port}" if everywhere else ""
    server = Server(Lobby(share))
    try:
        listener = await asyncio.start_server(server.handle, host, port, ssl=tls, limit=MAX_HEAD)
    except OSError as e:
        why = os.strerror(e.errno) if e.errno else str(e)
        sys.exit(f"serve: can't listen on {host}:{port} ({why}). Is it already running? PORT picks another port.")
    if tls:
        print(f"Pick a Game over https. On your phone (same Wi-Fi) open: {share or f'https://{host}:{port}'}/#bike-race")
        print("Friends on the same Wi-Fi open the same address to race you live.")
        print("Phones warn about the certificate the first time; that is expected here. Ctrl+C stops the server.")
    else:
        local = f"http://localhost:{port}" if host in ("127.0.0.1", "localhost") or everywhere else f"http://{host}:{port}"
        print(f"Pick a Game running at {local}" + (f" (on your network: {share})" if share else ""))
        print("Live Bike Race rooms run here too. For phones, use mise run phone. Ctrl+C stops the server.")
    sys.stdout.flush()
    async with listener:
        await listener.serve_forever()


def main():
    ap = argparse.ArgumentParser(description="Serve the Pick a Game site with the Bike Race race server.")
    ap.add_argument("--https", action="store_true", help="serve https on every address (port 8443), for phones")
    args = ap.parse_args()
    port = int(os.environ.get("PORT") or (8443 if args.https else 8000))
    host = os.environ.get("HOST") or ("0.0.0.0" if args.https else "127.0.0.1")
    tls = None
    if args.https:
        ensure_certificate()
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(CERT, KEY)
    try:
        asyncio.run(run(host, port, tls))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
