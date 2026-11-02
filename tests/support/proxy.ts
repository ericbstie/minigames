// A reverse proxy in front of the site, for the hosting tests: what Caddy, nginx or Cloudflare Tunnel do in front of
// `mise run production` (docs/hosting.md). It answers https, passes every request on to the site over plain http,
// WebSockets too, and adds the address it was asked from to X-Forwarded-For.
//
//   const site = startSite({ behindProxy: true });
//   const proxy = startProxy(site, { tls: { cert, key }, host: 'kept' });
//   const page = await openPage(proxy, { host: 'minigames.ericbs.dev', path: '/#bike-race' });
import type { Site } from './browser';

export interface ProxyOptions {
  readonly tls: { readonly cert: string; readonly key: string };
  /**
   * kept: the Host goes on as it came (Caddy, Cloudflare Tunnel). rewritten: the site's own address takes its place
   * (nginx, unless told otherwise).
   */
  readonly host: 'kept' | 'rewritten';
}

// A WebSocket from the browser, and the one the proxy opened to the site for it
interface Pipe {
  readonly upstream: WebSocket;
  readonly early: (string | ArrayBuffer)[]; // what the site sent before the browser's side was open
}

// Headers that only mean something for one connection, which a proxy doesn't pass on
const HOP = ['connection', 'keep-alive', 'upgrade', 'transfer-encoding', 'te', 'trailer', 'proxy-connection'];

// Bun's WebSocket takes headers too, which the DOM's WebSocket type (the tsconfig has the DOM's types) doesn't know
const BunWebSocket = WebSocket as unknown as new (url: string, options: Bun.WebSocketOptions) => WebSocket;

/** The proxy on a free port, as a Site: its url() is the https address of the proxy for a host name */
export function startProxy(site: Site, opts: ProxyOptions): Site {
  const target = `127.0.0.1:${site.port}`;
  const server = Bun.serve<Pipe>({
    port: 0,
    hostname: '127.0.0.1',
    tls: { cert: Bun.file(opts.tls.cert), key: Bun.file(opts.tls.key) },
    idleTimeout: 120, // the event stream is quiet for 10 s at a time

    async fetch(req, server) {
      const url = new URL(req.url);
      const headers = new Headers(req.headers);
      for (const name of HOP) headers.delete(name);
      const from = server.requestIP(req)?.address ?? '';
      const forwarded = req.headers.get('x-forwarded-for');
      headers.set('x-forwarded-for', forwarded ? `${forwarded}, ${from}` : from);
      headers.set('x-forwarded-proto', 'https');
      if (opts.host === 'rewritten') headers.set('host', target);

      if ((req.headers.get('upgrade') ?? '').toLowerCase() === 'websocket') {
        const pass: Record<string, string> = {};
        for (const name of ['host', 'origin', 'user-agent', 'x-forwarded-for', 'x-forwarded-proto']) {
          const value = headers.get(name);
          if (value) pass[name] = value;
        }
        const upstream = new BunWebSocket(`ws://${target}${url.pathname}${url.search}`, { headers: pass });
        upstream.binaryType = 'arraybuffer';
        const pipe: Pipe = { upstream, early: [] };
        upstream.onmessage = (e) => void pipe.early.push(e.data);
        const opened = await new Promise<boolean>((resolve) => {
          upstream.onopen = () => resolve(true);
          upstream.onerror = () => resolve(false);
        });
        // the site refused it (a real proxy would pass on the site's answer; the tests only need to see it fail)
        if (!opened) return new Response('The site refused the WebSocket\n', { status: 502 });
        if (server.upgrade(req, { data: pipe })) return undefined;
        upstream.close();
        return new Response('Expected a WebSocket\n', { status: 400 });
      }

      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
      const res = await fetch(`http://${target}${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
        decompress: false,
      });
      const back = new Headers(res.headers);
      for (const name of HOP) back.delete(name);
      return new Response(res.body, { status: res.status, headers: back });
    },

    websocket: {
      open(ws) {
        const { upstream, early } = ws.data;
        for (const m of early.splice(0)) ws.send(m);
        upstream.onmessage = (e) => void ws.send(e.data);
        upstream.onclose = (e) => ws.close(e.code === 1005 ? 1000 : e.code);
      },
      message(ws, m) {
        ws.data.upstream.send(m);
      },
      close(ws) {
        ws.data.upstream.close();
      },
    },
  });
  return {
    port: server.port!,
    scheme: 'https',
    logs: site.logs,
    url: (path = '/', host = '127.0.0.1') => `https://${host}:${server.port}${path}`,
    stop: () => void server.stop(true),
  };
}
