// ============================================================================
// Fog of war. Visibility is kept at tile resolution and rendered by scaling a
// tiny canvas up with smoothing, which gives soft edges for almost no cost.
// ============================================================================

import { TILE } from '../game/defs.js';
import { makeCanvas, clamp } from '../core/util.js';

export const UNSEEN = 0, EXPLORED = 1, VISIBLE = 2;

export class Fog {
  constructor(world, enabled = true) {
    this.world = world;
    this.enabled = enabled;
    this.state = new Uint8Array(world.w * world.h);
    this.accum = 0;
    this.interval = 0.12;
    // one extra pixel border so the blur has something to fade into
    this.tex = makeCanvas(world.w + 2, world.h + 2);
    this.tctx = this.tex.getContext('2d');
    this.img = this.tctx.createImageData(world.w + 2, world.h + 2);
    this.dirty = true;
    if (!enabled) this.state.fill(VISIBLE);
  }

  /** Stamp a circle of sight. */
  reveal(cx, cy, radiusTiles) {
    const w = this.world;
    const tx = (cx / TILE) | 0, ty = (cy / TILE) | 0;
    const r = Math.ceil(radiusTiles);
    const r2 = radiusTiles * radiusTiles;
    const x0 = Math.max(0, tx - r), x1 = Math.min(w.w - 1, tx + r);
    const y0 = Math.max(0, ty - r), y1 = Math.min(w.h - 1, ty + r);
    for (let y = y0; y <= y1; y++) {
      const dy = y - ty;
      for (let x = x0; x <= x1; x++) {
        const dx = x - tx;
        if (dx * dx + dy * dy > r2) continue;
        this.state[y * w.w + x] = VISIBLE;
      }
    }
  }

  update(dt, entities, playerIndex) {
    if (!this.enabled) return;
    this.accum += dt;
    if (this.accum < this.interval) return;
    this.accum = 0;
    const s = this.state;
    for (let i = 0; i < s.length; i++) if (s[i] === VISIBLE) s[i] = EXPLORED;
    for (const e of entities) {
      if (e.dead || e.owner !== playerIndex) continue;
      const sight = e.sight || 6;
      this.reveal(e.x, e.y, e.kind === 'building' && !e.complete ? sight * 0.6 : sight);
    }
    this.dirty = true;
  }

  isVisible(x, y) {
    if (!this.enabled) return true;
    const w = this.world;
    const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
    if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) return false;
    return this.state[ty * w.w + tx] === VISIBLE;
  }

  isExplored(x, y) {
    if (!this.enabled) return true;
    const w = this.world;
    const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
    if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) return false;
    return this.state[ty * w.w + tx] !== UNSEEN;
  }

  /** Is any part of a footprint visible? */
  areaVisible(e) {
    if (!this.enabled) return true;
    if (e.kind === 'unit') return this.isVisible(e.x, e.y);
    const s = e.size || 1;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      if (this.isVisible((e.tx + dx + 0.5) * TILE, (e.ty + dy + 0.5) * TILE)) return true;
    }
    return false;
  }

  areaExplored(e) {
    if (!this.enabled) return true;
    if (e.kind === 'unit') return this.isExplored(e.x, e.y);
    const s = e.size || 1;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      if (this.isExplored((e.tx + dx + 0.5) * TILE, (e.ty + dy + 0.5) * TILE)) return true;
    }
    return false;
  }

  rebuildTexture() {
    if (!this.dirty || !this.enabled) return;
    this.dirty = false;
    const w = this.world, iw = w.w + 2;
    const d = this.img.data;
    for (let y = 0; y < w.h + 2; y++) {
      for (let x = 0; x < iw; x++) {
        const o = (y * iw + x) * 4;
        let a = 255;
        if (x > 0 && y > 0 && x <= w.w && y <= w.h) {
          const v = this.state[(y - 1) * w.w + (x - 1)];
          a = v === VISIBLE ? 0 : v === EXPLORED ? 150 : 255;
        }
        d[o] = 4; d[o + 1] = 6; d[o + 2] = 12; d[o + 3] = a;
      }
    }
    this.tctx.putImageData(this.img, 0, 0);
  }

  /** Draw the fog over the world, in screen space. */
  render(ctx, camera) {
    if (!this.enabled) return;
    this.rebuildTexture();
    const w = this.world;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const sx = -TILE, sy = -TILE;
    const p0 = camera.worldToScreen(sx, sy);
    ctx.drawImage(this.tex, p0.x, p0.y, (w.w + 2) * TILE * camera.zoom, (w.h + 2) * TILE * camera.zoom);
    ctx.restore();
  }
}
