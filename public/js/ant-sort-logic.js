// Pure game logic shared by the browser game and the Node level generator.
// Grid cells are stored on a padded grid (one empty ring around the picture)
// so the outer ring is the tray margin the ants walk on.
const EMPTY = 255;
const SLOTS = 5;

class Sim {
  constructor(level, noInit) {
    if (noInit) return;
    const W = level.W, H = level.H, PW = W + 2, PH = H + 2;
    this.W = W; this.H = H; this.PW = PW; this.PH = PH;
    this.ncolors = level.ncolors;
    this.columns = level.columns;
    this.cell = new Uint8Array(PW * PH).fill(EMPTY);
    this.out = new Uint8Array(PW * PH);
    this.reach = new Uint8Array(PW * PH);
    this.key = Sim.keys(W, H);
    this.heaps = [];
    for (let c = 0; c < this.ncolors; c++) this.heaps.push([]);
    this.remaining = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = level.grid[y * W + x];
      if (v !== EMPTY) { this.cell[(y + 1) * PW + x + 1] = v; this.remaining++; }
    }
    this.slots = new Array(SLOTS).fill(null);
    this.colPtr = this.columns.map(() => 0);
    // flood the outside from the padded ring
    const stack = [];
    for (let i = 0; i < PW * PH; i++) {
      const x = i % PW, y = (i / PW) | 0;
      if (x === 0 || y === 0 || x === PW - 1 || y === PH - 1) { this.out[i] = 1; stack.push(i); }
    }
    this._flood(stack);
  }

  // Ants enter from below the picture, so blocks nearest the bottom centre go first.
  static keys(W, H) {
    const k = Sim._kc || (Sim._kc = {});
    const id = W + 'x' + H;
    if (k[id]) return k[id];
    const PW = W + 2, PH = H + 2, a = new Float64Array(PW * PH);
    const cx = (PW - 1) / 2, cy = PH + 2;
    for (let i = 0; i < a.length; i++) {
      const x = i % PW, y = (i / PW) | 0;
      a[i] = Math.hypot(x - cx, (cy - y) * 1.0) * 4096 + i;
    }
    return (k[id] = a);
  }

  _flood(stack) {
    const PW = this.PW, PH = this.PH, cell = this.cell, out = this.out;
    while (stack.length) {
      const q = stack.pop();
      const x = q % PW, y = (q / PW) | 0;
      if (x > 0) this._visit(q - 1, stack);
      if (x < PW - 1) this._visit(q + 1, stack);
      if (y > 0) this._visit(q - PW, stack);
      if (y < PH - 1) this._visit(q + PW, stack);
    }
  }
  _visit(n, stack) {
    const c = this.cell[n];
    if (c === EMPTY) {
      if (!this.out[n]) { this.out[n] = 1; stack.push(n); }
    } else if (!this.reach[n]) {
      this.reach[n] = 1; this._push(c, n);
    }
  }
  _push(c, n) {
    const h = this.heaps[c], key = this.key;
    h.push(n);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[h[p]] <= key[n]) break;
      h[i] = h[p]; i = p;
    }
    h[i] = n;
  }
  _pop(c) {
    const h = this.heaps[c], key = this.key;
    const top = h[0], last = h.pop();
    if (h.length) {
      let i = 0;
      const n = h.length;
      for (;;) {
        let l = 2 * i + 1, r = l + 1, m = i;
        let mk = key[last];
        if (l < n && key[h[l]] < mk) { m = l; mk = key[h[l]]; }
        if (r < n && key[h[r]] < mk) { m = r; }
        if (m === i) break;
        h[i] = h[m]; i = m;
      }
      h[i] = last;
    }
    return top;
  }

  removeBlock(p) {
    this.cell[p] = EMPTY;
    this.out[p] = 1;
    this.remaining--;
    this._flood([p]);
  }

  reachable(c) { return this.heaps[c].length; }

  // One spawn round: every active slot sends at most one ant.
  tick() {
    const ev = [];
    for (let i = 0; i < SLOTS; i++) {
      const s = this.slots[i];
      if (!s || s.n <= 0) continue;
      if (!this.heaps[s.c].length) continue;
      const p = this._pop(s.c);
      this.removeBlock(p);
      s.n--;
      ev.push({ slot: i, p, c: s.c, left: s.n });
      if (s.n === 0) this.slots[i] = null;
    }
    return ev;
  }

  freeSlot() { return this.slots.indexOf(null); }
  front(col) { const q = this.columns[col]; return this.colPtr[col] < q.length ? q[this.colPtr[col]] : null; }
  canPop(col) { return this.front(col) !== null && this.freeSlot() >= 0; }
  pop(col) {
    const f = this.front(col), i = this.freeSlot();
    if (!f || i < 0) return -1;
    this.colPtr[col]++;
    this.slots[i] = { c: f.c, n: f.n };
    return i;
  }
  quiet() {
    for (const s of this.slots) if (s && s.n > 0 && this.heaps[s.c].length) return false;
    return true;
  }
  queueLeft() { let n = 0; this.columns.forEach((q, i) => n += q.length - this.colPtr[i]); return n; }
  stuck() { return this.remaining > 0 && this.freeSlot() < 0 && this.quiet(); }
  won() { return this.remaining === 0; }
  settle() { let n = 0; while (!this.quiet()) n += this.tick().length; return n; }

  clone() {
    const s = new Sim(null, true);
    s.W = this.W; s.H = this.H; s.PW = this.PW; s.PH = this.PH; s.ncolors = this.ncolors;
    s.columns = this.columns; s.key = this.key;
    s.cell = this.cell.slice(); s.out = this.out.slice(); s.reach = this.reach.slice();
    s.heaps = this.heaps.map(h => h.slice());
    s.remaining = this.remaining;
    s.slots = this.slots.map(x => x && { c: x.c, n: x.n });
    s.colPtr = this.colPtr.slice();
    return s;
  }

  // Breadth-first path over the walkable outside region, from cell a to the
  // first cell for which goal(i) is true. Returns padded indices a..goal.
  path(a, goal) {
    const PW = this.PW, PH = this.PH, out = this.out;
    const prev = new Int32Array(PW * PH).fill(-1);
    const q = [a]; prev[a] = a;
    let head = 0, end = -1;
    while (head < q.length) {
      const c = q[head++];
      if (goal(c)) { end = c; break; }
      const x = c % PW, y = (c / PW) | 0;
      const ns = [];
      if (y < PH - 1) ns.push(c + PW);
      if (x > 0) ns.push(c - 1);
      if (x < PW - 1) ns.push(c + 1);
      if (y > 0) ns.push(c - PW);
      for (const n of ns) if (prev[n] < 0 && out[n]) { prev[n] = c; q.push(n); }
    }
    if (end < 0) return [a];
    const p = [];
    for (let c = end; c !== a; c = prev[c]) p.push(c);
    p.push(a);
    return p.reverse();
  }
}


export { EMPTY, SLOTS, Sim };
