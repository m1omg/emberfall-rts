// ============================================================================
// The world: terrain generation, tile occupancy, the entity table and the
// spatial hash everything queries for neighbours.
// ============================================================================

import { clamp, dist2, makeRng, makeNoise, TAU } from '../core/util.js';
import { TILE, BUILDINGS, UNITS, RESOURCES, FACTIONS, MAP_SIZES } from './defs.js';
import { T_GRASS, T_DIRT, T_ROCK, T_WATER, CHUNK } from '../art/terrain.js';

let nextId = 1;

export class World {
  constructor({ size = 'medium', seed = Date.now() & 0xffff }) {
    const conf = MAP_SIZES[size] || MAP_SIZES.medium;
    this.w = conf.w; this.h = conf.h;
    this.conf = conf;
    this.seed = seed;
    this.rng = makeRng(seed + conf.seedOffset);
    this.noise = makeNoise(seed * 7 + 13);

    const n = this.w * this.h;
    this.terrain = new Uint8Array(n);
    this.corrupt = new Float32Array(n);
    this.blocked = new Uint8Array(n);      // static impassability
    this.occupant = new Int32Array(n).fill(0); // entity id occupying the tile

    this.entities = [];
    this.byId = new Map();
    this.chunksW = Math.ceil(this.w / CHUNK);
    this.chunksH = Math.ceil(this.h / CHUNK);
    this.chunkDirty = new Uint8Array(this.chunksW * this.chunksH).fill(1);

    // spatial hash, rebuilt each tick
    this.cell = 64;
    this.gw = Math.ceil((this.w * TILE) / this.cell);
    this.gh = Math.ceil((this.h * TILE) / this.cell);
    this.buckets = Array.from({ length: this.gw * this.gh }, () => []);

    this.startPositions = [];
    this.generate();
  }

  // ---- tile helpers --------------------------------------------------------
  idx(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  isBlocked(tx, ty) { return !this.inBounds(tx, ty) || this.blocked[ty * this.w + tx] !== 0; }
  tileOf(x, y) { return [Math.floor(x / TILE), Math.floor(y / TILE)]; }
  centerOf(tx, ty) { return [(tx + 0.5) * TILE, (ty + 0.5) * TILE]; }
  get pxW() { return this.w * TILE; }
  get pxH() { return this.h * TILE; }

  markChunkAt(tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < this.chunksW && y < this.chunksH) this.chunkDirty[y * this.chunksW + x] = 1;
    }
  }

  setBlocked(tx, ty, v, entId = 0) {
    if (!this.inBounds(tx, ty)) return;
    const i = ty * this.w + tx;
    this.blocked[i] = v ? 1 : 0;
    this.occupant[i] = v ? entId : 0;
  }

  // ---- generation ----------------------------------------------------------
  generate() {
    const { w, h, rng, noise } = this;
    // 1. terrain: rolling grass with rocky ridges and a couple of lakes
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const nx = x / w, ny = y / h;
        const ridge = Math.abs(noise.fbm(x * 0.035, y * 0.035, 4));
        const lake = noise.fbm(x * 0.026 + 100, y * 0.026 + 100, 3);
        const edge = Math.min(nx, ny, 1 - nx, 1 - ny);
        let t = T_GRASS;
        if (lake < -0.30 && edge > 0.06) t = T_WATER;
        else if (ridge > 0.36) t = T_ROCK;
        else if (noise.fbm(x * 0.08 - 50, y * 0.08 - 50, 3) > 0.30) t = T_DIRT;
        // hard border ring of rock keeps the camera honest
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) t = T_ROCK;
        this.terrain[i] = t;
        this.blocked[i] = (t === T_ROCK || t === T_WATER) ? 1 : 0;
      }
    }
    this.smoothTerrain();

    // 2. start positions on opposite corners, cleared of obstacles
    const inset = Math.round(w * 0.16);
    const corners = [[inset, inset], [w - 1 - inset, h - 1 - inset]];
    if (rng.chance(0.5)) corners.reverse();
    for (const [cx, cy] of corners) {
      const spot = this.findClearSpot(cx, cy, 7);
      this.carveClearing(spot[0], spot[1], 7);
      this.startPositions.push(spot);
    }

    // 3. resources
    this.placeResources();
  }

  smoothTerrain() {
    const { w, h } = this;
    const src = this.terrain.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const counts = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) counts[src[(y + dy) * w + x + dx]]++;
        let best = 0;
        for (let t = 1; t < 4; t++) if (counts[t] > counts[best]) best = t;
        if (counts[best] >= 6) {
          this.terrain[y * w + x] = best;
          this.blocked[y * w + x] = (best === T_ROCK || best === T_WATER) ? 1 : 0;
        }
      }
    }
    // guarantee the map is connected enough: knock holes through thin rock walls
    this.floodConnect();
  }

  floodConnect() {
    const { w, h } = this;
    const seen = new Uint8Array(w * h);
    const regions = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (seen[i] || this.blocked[i]) continue;
        const stack = [i]; seen[i] = 1;
        const cells = [];
        while (stack.length) {
          const c = stack.pop(); cells.push(c);
          const cx = c % w, cy = (c / w) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (seen[ni] || this.blocked[ni]) continue;
            seen[ni] = 1; stack.push(ni);
          }
        }
        regions.push(cells);
      }
    }
    regions.sort((a, b) => b.length - a.length);
    const main = regions[0];
    if (!main) return;
    const mainSet = new Set(main);
    // Carve a corridor from every sizeable orphan region to the main one.
    for (let r = 1; r < regions.length; r++) {
      const reg = regions[r];
      if (reg.length < 24) { for (const c of reg) { this.terrain[c] = T_ROCK; this.blocked[c] = 1; } continue; }
      const from = reg[(reg.length / 2) | 0];
      let best = main[0], bestD = Infinity;
      const fx = from % w, fy = (from / w) | 0;
      for (let k = 0; k < main.length; k += 7) {
        const c = main[k], cx = c % w, cy = (c / w) | 0;
        const d = (cx - fx) ** 2 + (cy - fy) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      this.carveCorridor(fx, fy, best % w, (best / w) | 0);
      for (const c of reg) mainSet.add(c);
    }
  }

  carveCorridor(x0, y0, x1, y1) {
    let x = x0, y = y0, guard = 0;
    while ((x !== x1 || y !== y1) && guard++ < 4000) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 2 || ny < 2 || nx >= this.w - 2 || ny >= this.h - 2) continue;
        const i = ny * this.w + nx;
        if (this.terrain[i] === T_ROCK || this.terrain[i] === T_WATER) {
          this.terrain[i] = T_DIRT; this.blocked[i] = 0;
        }
      }
      if (Math.abs(x1 - x) > Math.abs(y1 - y)) x += Math.sign(x1 - x);
      else y += Math.sign(y1 - y);
    }
  }

  findClearSpot(cx, cy, r) {
    for (let ring = 0; ring < 30; ring++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * TAU;
        const x = Math.round(cx + Math.cos(ang) * ring * 2);
        const y = Math.round(cy + Math.sin(ang) * ring * 2);
        if (x < r + 3 || y < r + 3 || x >= this.w - r - 3 || y >= this.h - r - 3) continue;
        let ok = true, blockedCount = 0;
        for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) {
          if (this.terrain[(y + dy) * this.w + x + dx] === T_WATER) blockedCount += 2;
          else if (this.terrain[(y + dy) * this.w + x + dx] === T_ROCK) blockedCount++;
          if (blockedCount > r * 3) { ok = false; break; }
        }
        if (ok) return [x, y];
      }
    }
    return [cx, cy];
  }

  carveClearing(cx, cy, r) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!this.inBounds(x, y)) continue;
        if (dx * dx + dy * dy > r * r) continue;
        const i = y * this.w + x;
        const edge = Math.hypot(dx, dy) / r;
        this.terrain[i] = edge > 0.72 ? T_GRASS : (this.rng.chance(0.35) ? T_DIRT : T_GRASS);
        this.blocked[i] = 0;
      }
    }
  }

  placeResources() {
    const { rng, w, h } = this;
    // -- one guaranteed mine per start. "Guaranteed" means exactly that: a base
    //    that spawns without a mine in reach can never get its economy going,
    //    so if no free spot exists we clear one rather than skip it.
    for (const [sx, sy] of this.startPositions) {
      const toward = Math.atan2(h / 2 - sy, w / 2 - sx);
      let placed = false;
      for (let d = 6; d <= 12 && !placed; d++) {
        for (let k = 0; k < 12 && !placed; k++) {
          const ang = toward + rng.range(-0.9, 0.9) + (k / 12) * TAU * (k > 5 ? 1 : 0);
          const mx = Math.round(sx + Math.cos(ang) * d);
          const my = Math.round(sy + Math.sin(ang) * d);
          if (!this.inBounds(mx, my) || !this.areaFree(mx, my, 2)) continue;
          placed = this.spawnMine(mx, my, 2400);
        }
      }
      if (!placed) {
        const mx = clamp(Math.round(sx + Math.cos(toward) * 7), 3, w - 5);
        const my = clamp(Math.round(sy + Math.sin(toward) * 7), 3, h - 5);
        for (let dy = -1; dy <= 2; dy++) {
          for (let dx = -1; dx <= 2; dx++) {
            if (!this.inBounds(mx + dx, my + dy)) continue;
            const i = this.idx(mx + dx, my + dy);
            this.terrain[i] = T_DIRT;
            this.blocked[i] = 0;
            const occ = this.occupant[i];
            if (occ) { const e = this.byId.get(occ); if (e) this.remove(e); }
          }
        }
        this.spawnMine(mx, my, 2400);
      }
    }
    const extra = this.conf.mines - this.startPositions.length;
    for (let i = 0; i < extra; i++) {
      for (let tries = 0; tries < 60; tries++) {
        const x = rng.int(6, w - 7), y = rng.int(6, h - 7);
        if (this.tooCloseToStart(x, y, 12)) continue;
        if (this.areaFree(x, y, 3) && this.spawnMine(x, y, rng.int(1600, 2600))) break;
      }
    }

    // -- woods and brimstone: guarantee a healthy supply of both near each base
    for (const [sx, sy] of this.startPositions) {
      for (let k = 0; k < 4; k++) {
        const ang = rng.range(0, TAU), d = rng.range(9, 15);
        this.spawnForest(Math.round(sx + Math.cos(ang) * d), Math.round(sy + Math.sin(ang) * d), rng.int(9, 16), 'tree');
      }
      for (let k = 0; k < 3; k++) {
        const ang = rng.range(0, TAU), d = rng.range(8, 14);
        this.spawnForest(Math.round(sx + Math.cos(ang) * d), Math.round(sy + Math.sin(ang) * d), rng.int(5, 9), 'brimstone');
      }
    }
    // -- scattered across the rest of the map
    const clumps = Math.round((w * h) / 260);
    for (let i = 0; i < clumps; i++) {
      const x = rng.int(4, w - 5), y = rng.int(4, h - 5);
      if (this.tooCloseToStart(x, y, 8)) continue;
      const kind = rng.chance(0.62) ? 'tree' : 'brimstone';
      this.spawnForest(x, y, rng.int(5, 14), kind);
    }
  }

  tooCloseToStart(x, y, d) {
    return this.startPositions.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < d);
  }

  areaFree(tx, ty, size) {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      if (this.isBlocked(tx + dx, ty + dy)) return false;
    }
    return true;
  }

  spawnMine(tx, ty, amount) {
    tx = clamp(tx, 3, this.w - 5); ty = clamp(ty, 3, this.h - 5);
    if (!this.areaFree(tx, ty, 2)) {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (this.areaFree(tx + dx, ty + dy, 2)) { tx += dx; ty += dy; dy = 9; break; }
      }
    }
    if (!this.areaFree(tx, ty, 2)) return false;
    const e = this.makeResource('goldmine', tx, ty, amount);
    return !!e;
  }

  spawnForest(cx, cy, count, kind) {
    const { rng } = this;
    let placed = 0, guard = 0;
    const r = Math.max(2, Math.round(Math.sqrt(count)));
    while (placed < count && guard++ < count * 12) {
      const x = cx + rng.int(-r, r), y = cy + rng.int(-r, r);
      if (!this.inBounds(x, y) || this.isBlocked(x, y)) continue;
      if (this.terrain[this.idx(x, y)] === T_WATER) continue;
      if (this.tooCloseToStart(x, y, 5)) continue;
      this.makeResource(kind, x, y, RESOURCES[kind].amount);
      placed++;
    }
  }

  // ---- entities ------------------------------------------------------------
  makeResource(kind, tx, ty, amount) {
    const rd = RESOURCES[kind];
    const size = rd.size;
    const e = {
      id: nextId++, kind: 'resource', type: kind, owner: -1,
      tx, ty, size,
      x: (tx + size / 2) * TILE, y: (ty + size / 2) * TILE,
      radius: size * TILE * 0.45,
      amount, maxAmount: amount, harvesters: 0, slots: rd.slots,
      variant: Math.floor(this.rng() * 3), seed: nextId,
      hp: 1, maxHp: 1, dead: false,
    };
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) this.setBlocked(tx + dx, ty + dy, 1, e.id);
    this.add(e);
    this.markChunkAt(tx, ty);
    return e;
  }

  add(e) {
    this.entities.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  remove(e) {
    e.dead = true;
    this.byId.delete(e.id);
    if (e.kind === 'building' || e.kind === 'resource') {
      for (let dy = 0; dy < e.size; dy++) for (let dx = 0; dx < e.size; dx++) {
        const i = this.idx(e.tx + dx, e.ty + dy);
        if (this.inBounds(e.tx + dx, e.ty + dy) && this.occupant[i] === e.id) this.setBlocked(e.tx + dx, e.ty + dy, 0, 0);
      }
      this.markChunkAt(e.tx, e.ty);
    }
  }

  compact() {
    if (this.entities.some((e) => e.dead)) this.entities = this.entities.filter((e) => !e.dead);
  }

  // ---- spatial hash --------------------------------------------------------
  rebuildHash() {
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i].length = 0;
    for (const e of this.entities) {
      if (e.dead) continue;
      const cx = clamp((e.x / this.cell) | 0, 0, this.gw - 1);
      const cy = clamp((e.y / this.cell) | 0, 0, this.gh - 1);
      this.buckets[cy * this.gw + cx].push(e);
    }
  }

  /** Collect entities whose centre is within r px of (x,y) into out. */
  near(x, y, r, out = []) {
    out.length = 0;
    const c0x = clamp(((x - r) / this.cell) | 0, 0, this.gw - 1);
    const c1x = clamp(((x + r) / this.cell) | 0, 0, this.gw - 1);
    const c0y = clamp(((y - r) / this.cell) | 0, 0, this.gh - 1);
    const c1y = clamp(((y + r) / this.cell) | 0, 0, this.gh - 1);
    const r2 = r * r;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const b = this.buckets[cy * this.gw + cx];
        for (let i = 0; i < b.length; i++) {
          const e = b[i];
          if (dist2(x, y, e.x, e.y) <= r2 + e.radius * e.radius) out.push(e);
        }
      }
    }
    return out;
  }

  /** Corruption value at a world pixel. */
  corruptionAt(x, y) {
    const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
    if (!this.inBounds(tx, ty)) return 0;
    return this.corrupt[ty * this.w + tx];
  }

  /** Paint corruption outward from a structure. */
  applyCorruption(cx, cy, radiusTiles, remove = false) {
    const r = Math.ceil(radiusTiles);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!this.inBounds(x, y)) continue;
        const d = Math.hypot(dx, dy);
        if (d > radiusTiles) continue;
        const v = clamp(1 - (d / radiusTiles) ** 1.6, 0, 1);
        const i = y * this.w + x;
        if (remove) this.corrupt[i] = Math.max(0, this.corrupt[i] - v);
        else this.corrupt[i] = Math.min(1, this.corrupt[i] + v);
      }
    }
    this.markChunkAt(cx - r, cy - r);
    this.markChunkAt(cx + r, cy + r);
    for (let d = -r; d <= r; d += CHUNK) { this.markChunkAt(cx + d, cy); this.markChunkAt(cx, cy + d); }
  }
}

export function nextEntityId() { return nextId++; }
