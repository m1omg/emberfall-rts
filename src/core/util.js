// Small shared helpers. Kept dependency-free and allocation-light: this file is
// on the hot path for pathing, steering and rendering.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const inv = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a), 0, 1));

export function dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
export function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

/** Shortest signed angular difference, in radians. */
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function turnToward(from, to, maxStep) {
  const d = angleDelta(from, to);
  return from + clamp(d, -maxStep, maxStep);
}

/** Deterministic PRNG (mulberry32) so a seed always yields the same map. */
export function makeRng(seed) {
  let a = seed >>> 0 || 1;
  const rnd = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.range = (lo, hi) => lo + rnd() * (hi - lo);
  rnd.int = (lo, hi) => Math.floor(lo + rnd() * (hi - lo + 1));
  rnd.pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  rnd.chance = (p) => rnd() < p;
  rnd.sign = () => (rnd() < 0.5 ? -1 : 1);
  return rnd;
}

/** Tileable-ish value noise with fbm. Good enough for terrain mottling. */
export function makeNoise(seed) {
  const rnd = makeRng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = rnd.int(0, i); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => {
    switch (h & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };
  const noise2 = (x, y) => {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = smoothstep(xf), v = smoothstep(yf);
    const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.5; // roughly -1..1
  };
  noise2.fbm = (x, y, octaves = 4, lac = 2, gain = 0.5) => {
    let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
    for (let i = 0; i < octaves; i++) {
      sum += noise2(fx, fy) * amp; norm += amp;
      amp *= gain; fx *= lac; fy *= lac;
    }
    return sum / norm;
  };
  return noise2;
}

/** Colour helpers — everything is authored as hsl-ish strings or hex. */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
export function shade(hex, amount) {
  // amount > 0 lightens toward white, < 0 darkens toward black.
  return amount >= 0 ? mix(hex, '#ffffff', amount) : mix(hex, '#000000', -amount);
}
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** A tiny binary min-heap used by the pathfinder. */
export class MinHeap {
  constructor() { this.items = []; this.costs = []; this.size = 0; }
  clear() { this.size = 0; }
  push(item, cost) {
    let i = this.size++;
    this.items[i] = item; this.costs[i] = cost;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.costs[par] <= this.costs[i]) break;
      this.swap(par, i); i = par;
    }
  }
  pop() {
    if (this.size === 0) return undefined;
    const top = this.items[0];
    this.size--;
    if (this.size > 0) {
      this.items[0] = this.items[this.size]; this.costs[0] = this.costs[this.size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let small = i;
        if (l < this.size && this.costs[l] < this.costs[small]) small = l;
        if (r < this.size && this.costs[r] < this.costs[small]) small = r;
        if (small === i) break;
        this.swap(small, i); i = small;
      }
    }
    return top;
  }
  swap(a, b) {
    const ti = this.items[a]; this.items[a] = this.items[b]; this.items[b] = ti;
    const tc = this.costs[a]; this.costs[a] = this.costs[b]; this.costs[b] = tc;
  }
}

/** Rounded-rect path helper (Safari-safe: doesn't rely on ctx.roundRect). */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Convex polygon from a list of [x,y] pairs. */
export function poly(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
