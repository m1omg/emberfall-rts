// ============================================================================
// Camera: world <-> screen, clamped panning, zoom about a focal point and a
// little inertia so flicking the map on a phone feels right.
// ============================================================================

import { clamp, lerp } from '../core/util.js';

export class Camera {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    this.x = world.pxW / 2;
    this.y = world.pxH / 2;
    this.zoom = 1;
    this.minZoom = 0.42;
    this.maxZoom = 2.2;
    this.vx = 0; this.vy = 0;      // inertia
    this.shake = 0; this.shakeX = 0; this.shakeY = 0;
    this.targetZoom = 1;
  }

  get viewW() { return this.canvas.clientWidth; }
  get viewH() { return this.canvas.clientHeight; }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2 + this.shakeX,
      y: (wy - this.y) * this.zoom + this.viewH / 2 + this.shakeY,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2 - this.shakeX) / this.zoom + this.x,
      y: (sy - this.viewH / 2 - this.shakeY) / this.zoom + this.y,
    };
  }

  /** Visible world rect, padded a little for sprite overhang. */
  bounds(pad = 96) {
    const hw = this.viewW / 2 / this.zoom + pad;
    const hh = this.viewH / 2 / this.zoom + pad;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  panBy(dx, dy) { this.x += dx; this.y += dy; this.clampToWorld(); }

  moveTo(x, y) { this.x = x; this.y = y; this.vx = this.vy = 0; this.clampToWorld(); }

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    this.targetZoom = this.zoom;
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToWorld();
  }

  setZoom(z, sx, sy) {
    this.zoomAt(sx ?? this.viewW / 2, sy ?? this.viewH / 2, clamp(z, this.minZoom, this.maxZoom) / this.zoom);
  }

  clampToWorld() {
    const hw = this.viewW / 2 / this.zoom;
    const hh = this.viewH / 2 / this.zoom;
    const W = this.world.pxW, H = this.world.pxH;
    this.x = W < hw * 2 ? W / 2 : clamp(this.x, hw, W - hw);
    this.y = H < hh * 2 ? H / 2 : clamp(this.y, hh, H - hh);
  }

  addShake(amount) { this.shake = Math.min(14, this.shake + amount); }

  update(dt) {
    if (Math.abs(this.vx) > 1 || Math.abs(this.vy) > 1) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      const damp = Math.pow(0.0016, dt);
      this.vx *= damp; this.vy *= damp;
      this.clampToWorld();
    } else { this.vx = this.vy = 0; }

    if (this.shake > 0.05) {
      this.shake *= Math.pow(0.0009, dt);
      this.shakeX = (Math.random() - 0.5) * this.shake * 2;
      this.shakeY = (Math.random() - 0.5) * this.shake * 2;
    } else { this.shake = 0; this.shakeX = this.shakeY = 0; }
  }
}
