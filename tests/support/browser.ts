// What the browser tests share: the site served in-process, and pages in Bun's built-in headless browser
// (Bun.WebView, which drives Chrome or Chromium over the DevTools protocol).
//
//   const site = startSite();                                   // the real server on a free port
//   const page = await openPage(site, { path: '/#castle-defender', mobile: true });
//   await page.waitFor(() => !!window.CastleDefender);
//   expect(await page.eval((n) => n + 1, 41)).toBe(42);
//   expect(page.errors).toEqual([]);
//
// Each page gets its own origin (p1.localhost, p2.localhost, ...), so localStorage starts empty for every page the
// way a fresh browser profile would, and pages never see each other's saves.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Layer, ManagedRuntime } from 'effect';
import type { RaceLimits, RaceTimes } from '../../server/race';
import { ArrayLog, type ServerOptions, serverLayer, SiteServer, settingsLayer } from '../../server/serve';

export const SHOTS = join(import.meta.dir, '..', '..', '.shots');
/** Set KEEP_SHOTS=1 to keep screenshots in .shots/ (ignored by git). */
export const KEEP_SHOTS = !!process.env.KEEP_SHOTS;

export interface Site {
  readonly port: number;
  readonly scheme: 'http' | 'https';
  /** Everything the server logged */
  readonly logs: string[];
  /** The address of the site for a host name (127.0.0.1 unless given) */
  url(path?: string, host?: string): string;
  stop(): void;
}

export type SiteOptions = ServerOptions & Partial<RaceTimes & RaceLimits> & { share?: string };

/** The real server (page and race server) on a free port, with whatever race timings and limits a test wants. */
export function startSite(opts: SiteOptions = {}): Site {
  const { countdown, ending, away, perDevice, share, ...server } = opts;
  const logs: string[] = [];
  const runtime = ManagedRuntime.make(
    serverLayer({ port: 0, development: false, ...server }).pipe(
      Layer.provide(settingsLayer({ countdown, ending, away, perDevice, share })),
      Layer.provide(ArrayLog(logs)),
    ),
  );
  const { port } = runtime.runSync(SiteServer);
  const scheme = opts.tls ? 'https' : 'http';
  return {
    port,
    scheme,
    logs,
    url: (path = '/', host = '127.0.0.1') => `${scheme}://${host}:${port}${path}`,
    stop: () => void runtime.dispose(),
  };
}

export interface OpenOptions {
  width?: number;
  height?: number;
  /** A phone: touch, a coarse pointer and mobile layout rules */
  mobile?: boolean;
  /** Path, query and hash to open, such as '/?keyboard#bike-race' */
  path?: string;
  /** localStorage items to put in place before the page loads */
  storage?: Record<string, string>;
  /** Console errors that are expected (a refused WebSocket, say) and should not count as page errors */
  ignoreErrors?: RegExp;
}

// Key codes for the keys the games listen to
const KEYS: Record<string, { code: string; keyCode: number; key?: string; text?: string }> = {
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Escape: { code: 'Escape', keyCode: 27 },
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Space: { code: 'Space', keyCode: 32, key: ' ', text: ' ' },
  ' ': { code: 'Space', keyCode: 32, key: ' ', text: ' ' },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
};
function keyInfo(key: string) {
  const known = KEYS[key];
  if (known) return { key: known.key ?? key, code: known.code, keyCode: known.keyCode, text: known.text };
  if (key.length === 1) {
    const upper = key.toUpperCase();
    const code = /[A-Z]/.test(upper) ? `Key${upper}` : /\d/.test(key) ? `Digit${key}` : key;
    return { key, code, keyCode: upper.charCodeAt(0), text: key };
  }
  throw new Error(`No key code for ${key}`);
}

let pages = 0;

export class Page {
  /** Uncaught errors and console.error calls in the page */
  readonly errors: string[] = [];
  private constructor(
    readonly view: Bun.WebView,
    readonly site: Site,
    readonly host: string,
  ) {}

  static async open(site: Site, opts: OpenOptions = {}): Promise<Page> {
    const { width = 1000, height = 600, mobile = false, path = '/', storage, ignoreErrors } = opts;
    const host = `p${++pages}.localhost`;
    let page: Page | undefined;
    const view = new Bun.WebView({
      width,
      height,
      backend: { type: 'chrome', argv: ['--ignore-certificate-errors'] },
      console: (type, ...args) => {
        if (type !== 'error' || !page) return;
        const text = args
          .map((a) =>
            typeof a === 'object' && a ? ((a as { description?: string }).description ?? JSON.stringify(a)) : String(a),
          )
          .join(' ');
        if (/Failed to load resource/.test(text) || ignoreErrors?.test(text)) return;
        page.errors.push(text);
      },
    });
    page = new Page(view, site, host);
    await view.navigate('about:blank');
    await view.cdp('Runtime.enable');
    view.addEventListener('Runtime.exceptionThrown', (e) => {
      const d = (e as MessageEvent).data.exceptionDetails;
      const text: string = d.exception?.description ?? d.text;
      if (!ignoreErrors?.test(text)) page.errors.push(text.split('\n')[0]!);
    });
    // something the page's Content-Security-Policy blocked: the browser says so in its own log, not the console
    await view.cdp('Log.enable');
    view.addEventListener('Log.entryAdded', (e) => {
      const text: string = (e as MessageEvent).data.entry.text;
      if (/Content Security Policy/i.test(text) && !ignoreErrors?.test(text)) page.errors.push(text);
    });
    // the exact viewport asked for (the window itself is a little taller than its viewport)
    await view.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    if (mobile) await view.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (storage) {
      // put the saves in place on this page's origin before the page itself loads
      await page.goto('/__blank');
      await page.eval((items) => {
        for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
      }, storage);
    }
    await page.goto(path);
    return page;
  }

  /** Load a path on this page's own origin */
  async goto(path: string): Promise<void> {
    const url = this.site.url(path, this.host);
    const page = (u: string) => u.replace(/#.*$/, '');
    // a change of hash alone never fires a load event, so it is made in the page instead
    if (url.includes('#') && this.view.url && page(this.view.url) === page(url)) {
      await this.eval((u) => (location.href = u), url);
      return;
    }
    await this.view.navigate(url);
  }

  async reload(): Promise<void> {
    await this.view.reload();
  }

  /**
   * Run a function in the page and get its result back (as JSON). The function is sent as its source text, so it
   * can only use its arguments and the page's own globals, not variables from the test.
   */
  async eval<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<Awaited<R>> {
    const call = `(${fn.toString()})(...${JSON.stringify(args)})`;
    return (await this.view.evaluate(call)) as Awaited<R>;
  }

  /** Wait until the function returns something truthy in the page, and return that. Throws after the timeout. */
  async waitFor<A extends unknown[], R>(
    fn: (...args: A) => R,
    args: A | [] = [],
    { timeout = 5000, interval = 50 } = {},
  ): Promise<Awaited<R>> {
    const end = performance.now() + timeout;
    for (;;) {
      const v = await this.eval(fn, ...(args as A)).catch(() => undefined);
      if (v) return v as Awaited<R>;
      if (performance.now() > end) throw new Error(`timed out waiting for ${fn.toString().slice(0, 120)}`);
      await Bun.sleep(interval);
    }
  }

  /** Like waitFor, but answers true or false instead of throwing */
  until<A extends unknown[], R>(fn: (...args: A) => R, args: A | [] = [], timeout = 5000): Promise<boolean> {
    return this.waitFor(fn, args, { timeout }).then(
      () => true,
      () => false,
    );
  }

  /**
   * Click the n-th element matching the selector (the first by default) at its centre, as a mouse would, once a
   * person could: when it is shown, switched on, standing still and not covered by anything else. Standing still
   * means no animation or transition is moving it or what it is in (screens and sheets slide, pop and shake in) and
   * it is in the same place on two frames running: on a page that draws a few frames a second, the place it has
   * before the next frame can be well off where it is a frame later. Throws after the timeout, saying which of those
   * it was still waiting for.
   */
  async click(selector: string, nth = 0, { timeout = 10_000 } = {}): Promise<void> {
    const end = performance.now() + timeout;
    for (;;) {
      const at = await this.eval(
        async (sel, i): Promise<{ why: string } | { x: number; y: number }> => {
          const el = document.querySelectorAll(sel)[i] as HTMLButtonElement | undefined;
          if (!el) return { why: 'not in the page' };
          if (!el.checkVisibility()) return { why: 'hidden' };
          if (el.disabled) return { why: 'switched off' };
          // an animation or transition that ends, on it or on what it is in (one that never ends, like a glow or a
          // bounce, is left to the check on its place below)
          const moving = document.getAnimations().find((a) => {
            const fx = a.effect as KeyframeEffect | null;
            const on = fx?.target;
            if (!on || fx.pseudoElement || !on.contains(el)) return false;
            return (a.pending || a.playState === 'running') && fx.getComputedTiming().endTime !== Infinity;
          });
          if (moving) {
            const name = (moving as CSSAnimation).animationName ?? (moving as CSSTransition).transitionProperty;
            return { why: `moving (${name ? `animating ${name}` : 'an animation'})` };
          }
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const place = () => {
            const r = el.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          };
          const before = place().join();
          await new Promise((next) => {
            requestAnimationFrame(next);
            setTimeout(next, 1000);
          });
          const [x0, y0, w, h] = place() as [number, number, number, number];
          if ([x0, y0, w, h].join() !== before) return { why: 'moving' };
          if (!w || !h) return { why: 'of no size' };
          const x = x0 + w / 2;
          const y = y0 + h / 2;
          const hit = document.elementFromPoint(x, y);
          if (!hit || !el.contains(hit)) {
            const cls = hit?.getAttribute('class');
            const name = hit
              ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + (cls ? ` (${cls})` : '')
              : 'nothing';
            return { why: `covered by ${name} at its centre` };
          }
          return { x, y };
        },
        selector,
        nth,
      ).catch((e: Error) => ({ why: e.message }));
      if ('x' in at) return this.view.click(at.x, at.y);
      if (performance.now() > end) {
        throw new Error(`can't click ${selector} (number ${nth}, counting from 0): ${at.why}`);
      }
      await Bun.sleep(40);
    }
  }

  /** A finger touching the screen at x, y and lifting again */
  async tap(x: number, y: number): Promise<void> {
    await this.touch('touchStart', [{ x, y }]);
    await this.touch('touchEnd', []);
  }

  /** Raw touch events: touchStart, touchMove, touchEnd with the fingers down after the event */
  async touch(
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    points: { x: number; y: number; id?: number }[],
  ) {
    await this.view.cdp('Input.dispatchTouchEvent', { type, touchPoints: points });
  }

  async keyDown(key: string): Promise<void> {
    const k = keyInfo(key);
    await this.view.cdp('Input.dispatchKeyEvent', {
      type: k.text ? 'keyDown' : 'rawKeyDown',
      key: k.key,
      code: k.code,
      windowsVirtualKeyCode: k.keyCode,
      text: k.text,
    });
  }

  async keyUp(key: string): Promise<void> {
    const k = keyInfo(key);
    await this.view.cdp('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: k.key,
      code: k.code,
      windowsVirtualKeyCode: k.keyCode,
    });
  }

  async press(key: string): Promise<void> {
    await this.keyDown(key);
    await this.keyUp(key);
  }

  /** Empty an input and type into it, the way a person would (maxlength and input events apply) */
  async fill(selector: string, text: string): Promise<void> {
    await this.eval((sel) => {
      const el = document.querySelector(sel) as HTMLInputElement;
      el.focus();
      el.select();
    }, selector);
    await this.press('Backspace');
    if (text) await this.view.type(text);
  }

  text(selector: string): Promise<string> {
    return this.eval((sel) => document.querySelector(sel)?.textContent ?? '', selector);
  }

  /** Is the element with this id shown (not hidden itself, and not inside something hidden)? */
  visible(id: string): Promise<boolean> {
    return this.eval((id) => {
      const el = document.getElementById(id);
      return !!el && !el.hidden && el.checkVisibility();
    }, id);
  }

  /** A screenshot, saved to .shots/<name> when KEEP_SHOTS is set. Returns the image either way. */
  async screenshot(name?: string, format: 'png' | 'jpeg' = 'jpeg'): Promise<Blob> {
    const shot = (await this.view.screenshot({ format, quality: 85 })) as Blob;
    if (name && KEEP_SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await Bun.write(join(SHOTS, name), shot);
    }
    return shot;
  }

  close(): void {
    this.view.close();
  }
}

export const openPage = (site: Site, opts?: OpenOptions) => Page.open(site, opts);
export const wait = (ms: number) => Bun.sleep(ms);
