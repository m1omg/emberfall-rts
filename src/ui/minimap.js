// ============================================================================
// Minimap: a one-pixel-per-tile terrain cache, fog on top, entity blips, and
// the camera rectangle. Dragging anywhere on it flies the camera — the primary
// way to get around the map on a phone.
// ============================================================================

import { TILE, FACTIONS, BUILDINGS, UNITS } from '../game/defs.js';
import { T_GRASS, T_DIRT, T_ROCK, T_WATER } from '../art/terrain.js';
import { makeCanvas, clamp, rgba } from '../core/util.js';
import { VISIBLE, EXPLORED } from '../engine/fog.js';

const TERRAIN_COLOR = ['#3f5f47', '#5b4a36', '#39404f', '#173442'];

export class Minimap {
  constructor(canvas, game, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.camera = camera;
    const w = game.world;
    this.terrain = makeCanvas(w.w, w.h);
    this.tctx = this.terrain.getContext('2d');
    this.terrainDirty = true;
    this.repaintTimer = 0;
    this.dragging = false;
    this.bind();
  }

  bind() {
    const c = this.canvas;
    const go = (e) => {
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.game.world.pxW;
      const y = ((e.clientY - r.top) / r.height) * this.game.world.pxH;
      this.camera.moveTo(x, y);
    };
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      c.setPointerCapture(e.pointerId);
      go(e); e.preventDefault(); e.stopPropagation();
    });
    c.addEventListener('pointermove', (e) => { if (this.dragging) { go(e); e.preventDefault(); } });
    const end = (e) => { this.dragging = false; try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  paintTerrain() {
    const w = this.game.world;
    const img = this.tctx.createImageData(w.w, w.h);
    const d = img.data;
    for (let y = 0; y < w.h; y++) {
      for (let x = 0; x < w.w; x++) {
        const i = y * w.w + x;
        const t = w.terrain[i];
        let hex = TERRAIN_COLOR[t] || TERRAIN_COLOR[0];
        let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        const c = w.corrupt[i];
        if (c > 0.05) {
          r = r * (1 - c) + 46 * c;
          g = g * (1 - c) + 22 * c;
          b = b * (1 - c) + 48 * c;
        }
        const o = i * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    this.tctx.putImageData(img, 0, 0);
    this.terrainDirty = false;
  }

  render(dt) {
    const g = this.game, w = g.world, ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    this.repaintTimer -= dt;
    if (this.terrainDirty || this.repaintTimer <= 0) { this.paintTerrain(); this.repaintTimer = 1.5; }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this.terrain, 0, 0, W, H);

    const sx = W / w.pxW, sy = H / w.pxH;

    // resources first, then structures, then units on top
    const fogOn = g.fog.enabled;
    for (const e of w.entities) {
      if (e.dead) continue;
      if (fogOn && !g.fog.areaExplored(e)) continue;
      if (e.kind === 'unit' && fogOn && !g.fog.areaVisible(e)) continue;
      const x = e.x * sx, y = e.y * sy;
      if (e.kind === 'resource') {
        ctx.fillStyle = e.type === 'goldmine' ? '#f0c46a' : e.type === 'tree' ? '#5d9159' : '#d2542a';
        const r = e.type === 'goldmine' ? 3 : 1.4;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      } else if (e.kind === 'building') {
        const p = g.players[e.owner];
        ctx.fillStyle = p.color;
        const r = Math.max(2.5, e.size * sx * TILE * 0.5);
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8;
        ctx.strokeRect(x - r, y - r, r * 2, r * 2);
      }
    }
    for (const e of w.entities) {
      if (e.dead || e.kind !== 'unit') continue;
      if (fogOn && !g.fog.areaVisible(e)) continue;
      const p = g.players[e.owner];
      ctx.fillStyle = p.color;
      const r = e.owner === g.me ? 2 : 2.2;
      ctx.beginPath(); ctx.arc(e.x * sx, e.y * sy, r, 0, Math.PI * 2); ctx.fill();
    }

    // fog veil
    if (fogOn) {
      const img = ctx.getImageData(0, 0, W, H);
      const d = img.data;
      for (let py = 0; py < H; py++) {
        const ty = Math.min(w.h - 1, (py / H * w.h) | 0);
        for (let px = 0; px < W; px++) {
          const tx = Math.min(w.w - 1, (px / W * w.w) | 0);
          const v = g.fog.state[ty * w.w + tx];
          if (v === VISIBLE) continue;
          const o = (py * W + px) * 4;
          const k = v === EXPLORED ? 0.45 : 0.88;
          d[o] = d[o] * (1 - k) + 5 * k;
          d[o + 1] = d[o + 1] * (1 - k) + 7 * k;
          d[o + 2] = d[o + 2] * (1 - k) + 14 * k;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    // alert pings
    const now = g.time;
    for (const a of g.alerts) {
      if (!a.at || now - a.t > 3) continue;
      const k = 1 - (now - a.t) / 3;
      ctx.strokeStyle = a.tone === 'bad' ? `rgba(255,90,80,${k})` : `rgba(140,240,180,${k})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(a.at.x * sx, a.at.y * sy, (1 - k) * 16 + 3, 0, Math.PI * 2); ctx.stroke();
    }

    // camera rectangle
    const cam = this.camera;
    const vw = (cam.viewW / cam.zoom) * sx, vh = (cam.viewH / cam.zoom) * sy;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cam.x * sx - vw / 2, cam.y * sy - vh / 2, vw, vh);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 3;
    ctx.strokeRect(cam.x * sx - vw / 2 - 1.5, cam.y * sy - vh / 2 - 1.5, vw + 3, vh + 3);
    ctx.restore();
  }
}
