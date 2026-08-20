// ============================================================================
// Grid A* with a frame budget.
//
// Units ask for paths through a queue; the pathfinder spends a fixed number of
// nodes per frame across all pending requests so a hundred simultaneous move
// orders can never stall a frame. Paths are line-of-sight simplified before
// they are handed back, so units walk diagonals instead of stair-stepping.
// ============================================================================

import { MinHeap, clamp } from '../core/util.js';
import { TILE } from '../game/defs.js';

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

export class Pathfinder {
  constructor(world) {
    this.world = world;
    const n = world.w * world.h;
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.gen = 0;
    this.heap = new MinHeap();
    this.queue = [];
    this.budget = 9000;      // A* nodes expanded per frame, total
  }

  /** Queue a request. cb(pathArrayOfWorldPoints | null). */
  request(unit, gx, gy, cb, opts = {}) {
    this.queue.push({ unit, gx, gy, cb, opts, seq: this.queue.length });
    if (this.queue.length > 240) {
      // Dropped requests MUST still answer. A caller that tracks "a path is
      // pending" would otherwise latch forever and never ask again.
      const dropped = this.queue.splice(0, this.queue.length - 240);
      for (const d of dropped) d.cb(null);
    }
  }

  cancelFor(unit) {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].unit === unit) { const [r] = this.queue.splice(i, 1); r.cb(null); }
    }
  }

  tick() {
    let spent = 0;
    while (this.queue.length && spent < this.budget) {
      const req = this.queue.shift();
      if (req.unit && req.unit.dead) continue;
      const r = this.solve(req.unit.x, req.unit.y, req.gx, req.gy, req.opts);
      spent += r.expanded;
      req.cb(r.path);
    }
  }

  /** Immediate solve, used for short hops and by the AI. */
  solve(sx, sy, gx, gy, opts = {}) {
    const w = this.world;
    let stx = clamp(Math.floor(sx / TILE), 0, w.w - 1);
    let sty = clamp(Math.floor(sy / TILE), 0, w.h - 1);
    let gtx = clamp(Math.floor(gx / TILE), 0, w.w - 1);
    let gty = clamp(Math.floor(gy / TILE), 0, w.h - 1);

    if (w.isBlocked(gtx, gty)) {
      const near = this.nearestOpen(gtx, gty, opts.goalSearch || 6);
      if (!near) return { path: null, expanded: 0 };
      gtx = near[0]; gty = near[1];
    }
    if (w.isBlocked(stx, sty)) {
      const near = this.nearestOpen(stx, sty, 4);
      if (near) { stx = near[0]; sty = near[1]; }
    }
    if (stx === gtx && sty === gty) {
      return { path: [[(gtx + 0.5) * TILE, (gty + 0.5) * TILE]], expanded: 0 };
    }

    const gen = ++this.gen;
    const heap = this.heap; heap.clear();
    const start = sty * w.w + stx, goal = gty * w.w + gtx;
    this.g[start] = 0; this.stamp[start] = gen; this.from[start] = -1;
    heap.push(start, this.hcost(stx, sty, gtx, gty));

    const maxNodes = opts.maxNodes || 14000;
    let expanded = 0, found = false;

    while (heap.size) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) { found = true; break; }
      if (++expanded > maxNodes) break;

      const cx = cur % w.w, cy = (cur / w.w) | 0;
      const gc = this.g[cur];
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0], dy = DIRS[d][1];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
        const ni = ny * w.w + nx;
        if (w.blocked[ni]) continue;
        if (dx && dy) {  // no cutting corners through a blocked orthogonal
          if (w.blocked[cy * w.w + nx] || w.blocked[ny * w.w + cx]) continue;
        }
        const ng = gc + DIRS[d][2];
        if (this.stamp[ni] === gen && ng >= this.g[ni]) continue;
        this.stamp[ni] = gen; this.g[ni] = ng; this.from[ni] = cur;
        heap.push(ni, ng + this.hcost(nx, ny, gtx, gty));
      }
    }

    if (!found) {
      // Fall back to the reachable node closest to the goal we touched.
      let best = -1, bestH = Infinity;
      for (let i = 0; i < this.stamp.length; i++) {
        if (this.stamp[i] !== gen) continue;
        const hx = i % w.w, hy = (i / w.w) | 0;
        const hh = this.hcost(hx, hy, gtx, gty);
        if (hh < bestH) { bestH = hh; best = i; }
      }
      if (best < 0 || best === start) return { path: null, expanded };
      return { path: this.build(best, start), expanded };
    }
    return { path: this.build(goal, start), expanded };
  }

  hcost(x, y, gx, gy) {
    const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
    return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy);
  }

  build(goal, start) {
    const w = this.world;
    const tiles = [];
    let cur = goal, guard = 0;
    while (cur !== -1 && guard++ < 20000) {
      tiles.push(cur);
      if (cur === start) break;
      cur = this.from[cur];
    }
    tiles.reverse();
    // convert to world points, then simplify by line of sight
    const pts = tiles.map((i) => [((i % w.w) + 0.5) * TILE, (((i / w.w) | 0) + 0.5) * TILE]);
    return this.simplify(pts);
  }

  simplify(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this.lineClear(pts[anchor], pts[i])) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  lineClear(a, b) {
    const w = this.world;
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (TILE * 0.45));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
      if (w.isBlocked(tx, ty)) return false;
      // keep a little clearance from corners
      if (w.isBlocked(tx + 1, ty) && w.isBlocked(tx, ty + 1)) return false;
    }
    return true;
  }

  nearestOpen(tx, ty, maxR) {
    const w = this.world;
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (!w.isBlocked(x, y)) return [x, y];
        }
      }
    }
    return null;
  }

  /** Nearest standable tile next to a footprint, biased toward `fromX/fromY`. */
  adjacentTo(ent, fromX, fromY) {
    const w = this.world;
    const cands = [];
    const s = ent.size || 1;
    for (let dx = -1; dx <= s; dx++) {
      for (let dy = -1; dy <= s; dy++) {
        if (dx >= 0 && dx < s && dy >= 0 && dy < s) continue;
        const x = ent.tx + dx, y = ent.ty + dy;
        if (w.isBlocked(x, y)) continue;
        cands.push([x, y]);
      }
    }
    if (!cands.length) return null;
    let best = cands[0], bestD = Infinity;
    for (const [x, y] of cands) {
      const px = (x + 0.5) * TILE, py = (y + 0.5) * TILE;
      const d = (px - fromX) ** 2 + (py - fromY) ** 2;
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
    return [(best[0] + 0.5) * TILE, (best[1] + 0.5) * TILE];
  }
}
