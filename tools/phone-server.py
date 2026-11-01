"""Serve public/ over https on your network, so a phone on the same Wi-Fi can play Bike Race with tilt.

Phones only send tilt (motion) events to https pages, so plain `mise run app` works for everything except tilt
when you open it from a phone. This makes a self-signed certificate the first time (it needs the `openssl`
command) and keeps it in .cert/. Your phone will warn that the connection is not private: that is expected for a
self-signed certificate on your own network. Tap through it ("Advanced" then "Proceed" on Android, "Show Details"
then "visit this website" on iPhone).

Run with: mise run phone        (PORT defaults to 8443)
"""
import http.server
import os
import pathlib
import shutil
import socket
import ssl
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
CERT_DIR = ROOT / ".cert"
CERT, KEY = CERT_DIR / "cert.pem", CERT_DIR / "key.pem"
PORT = int(os.environ.get("PORT", "8443"))


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
        sys.exit("phone-server: the openssl command is needed to make a certificate, and it was not found.")
    CERT_DIR.mkdir(exist_ok=True)
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
         "-keyout", str(KEY), "-out", str(CERT), "-subj", "/CN=Pick a Game (local)"],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # always load the latest files while testing
        super().end_headers()


def main():
    ensure_certificate()
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(CERT, KEY)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f"Pick a Game over https. On your phone (same Wi-Fi) open: https://{lan_address()}:{PORT}/#bike-race")
    print("Your phone will warn about the certificate the first time; that is expected here. Ctrl+C stops the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
