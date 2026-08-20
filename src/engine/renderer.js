// ============================================================================
// The renderer. Terrain is blitted from cached chunk canvases, everything else
// is depth-sorted by ground Y and drawn from pre-baked sprites; the only live
// vector work per frame is selection rings, bars and particles.
// ============================================================================

import { TAU, clamp, lerp, roundRect, rgba, makeCanvas, poly } from '../core/util.js';
import { TILE, UNITS, BUILDINGS, FACTIONS } from '../game/defs.js';
import { CHUNK, paintTerrainChunk } from '../art/terrain.js';
import { getUnitSprites, getBuildingSprites, getProp, fitOverride, viewForAngle, WALK_FRAMES, ATTACK_FRAMES } from '../art/assets.js';
import { PROJECTILE_ART } from '../art/palette.js';
import { drawStump, drawWreck } from '../art/props.js';

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.game = game;
    this.world = game.world;
    this.chunks = new Map();
    this.dpr = 1;
    this.drawList = [];
    this.hovered = null;
    this.placement = null;      // { type, tx, ty, ok }
    this.selectBox = null;
    this.showHealth = 'damaged'; // 'damaged' | 'always'
    this.resize();
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
  }

  // ---- terrain chunks ------------------------------------------------------
  chunkCanvas(cx, cy) {
    const key = cy * this.world.chunksW + cx;
    let rec = this.chunks.get(key);
    const dirty = this.world.chunkDirty[key];
    if (!rec) {
      rec = { canvas: makeCanvas(CHUNK * TILE, CHUNK * TILE) };
      this.chunks.set(key, rec);
    }
    if (dirty || !rec.painted) {
      const ctx = rec.canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, rec.canvas.width, rec.canvas.height);
      paintTerrainChunk(ctx, this.world, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
      rec.painted = true;
      this.world.chunkDirty[key] = 0;
    }
    return rec.canvas;
  }

  // ---- main ----------------------------------------------------------------
  render(camera, dt) {
    const ctx = this.ctx;
    const g = this.game;
    this.resize();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, W, H);

    const b = camera.bounds(TILE * 3);
    ctx.save();
    ctx.translate(W / 2 + camera.shakeX, H / 2 + camera.shakeY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    this.drawTerrain(ctx, b);
    this.drawDecals(ctx, b);
    this.drawPlacement(ctx);
    this.drawSelectionRings(ctx);
    this.drawEntities(ctx, b, camera);
    this.drawProjectiles(ctx, b);
    this.drawParticles(ctx, b);
    this.drawRally(ctx);

    ctx.restore();

    g.fog.render(ctx, camera);

    ctx.save();
    ctx.translate(W / 2 + camera.shakeX, H / 2 + camera.shakeY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    this.drawBars(ctx, b, camera);
    this.drawFloaters(ctx);
    ctx.restore();

    this.drawSelectBox(ctx);
    this.drawVignette(ctx, W, H);
  }

  drawTerrain(ctx, b) {
    const w = this.world;
    const c0x = clamp(Math.floor(b.x0 / (CHUNK * TILE)), 0, w.chunksW - 1);
    const c1x = clamp(Math.floor(b.x1 / (CHUNK * TILE)), 0, w.chunksW - 1);
    const c0y = clamp(Math.floor(b.y0 / (CHUNK * TILE)), 0, w.chunksH - 1);
    const c1y = clamp(Math.floor(b.y1 / (CHUNK * TILE)), 0, w.chunksH - 1);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const canvas = this.chunkCanvas(cx, cy);
        ctx.drawImage(canvas, cx * CHUNK * TILE, cy * CHUNK * TILE);
      }
    }
  }

  drawDecals(ctx, b) {
    const fx = this.game.effects;
    for (const d of fx.decals) {
      if (d.x < b.x0 || d.x > b.x1 || d.y < b.y0 || d.y > b.y1) continue;
      const fade = clamp((d.life - d.age) / 6, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.75 * fade;
      ctx.translate(d.x, d.y);
      if (d.kind === 'stump') drawStump(ctx, d.seed);
      else if (d.kind === 'rubble') {
        ctx.fillStyle = d.faction === 'demon' ? 'rgba(40,16,26,0.7)' : 'rgba(60,54,44,0.65)';
        ctx.beginPath(); ctx.ellipse(0, 0, 34, 22, 0, 0, TAU); ctx.fill();
        drawWreck(ctx, d.faction, d.seed);
      } else if (d.kind === 'scorch') {
        ctx.fillStyle = 'rgba(30,12,8,0.55)';
        ctx.beginPath(); ctx.ellipse(0, 0, 14, 8, 0, 0, TAU); ctx.fill();
      } else {
        drawWreck(ctx, d.faction, d.seed);
      }
      ctx.restore();
    }
  }

  drawPlacement(ctx) {
    const pl = this.placement;
    if (!pl) return;
    const bd = BUILDINGS[pl.type];
    const size = bd.size;
    const x = pl.tx * TILE, y = pl.ty * TILE;
    ctx.save();
    // ghost of the structure
    const sp = getBuildingSprites(pl.type, this.game.players[this.game.me].color);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(sp.done, x + (size * TILE) / 2 - sp.ax, y + (size * TILE) / 2 - sp.ay);
    ctx.globalAlpha = 1;
    // footprint grid
    const ok = pl.ok;
    ctx.lineWidth = 2;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const cell = this.game.canPlace(pl.type, pl.tx + dx, pl.ty + dy) && !this.world.isBlocked(pl.tx + dx, pl.ty + dy);
        ctx.fillStyle = ok ? 'rgba(90,220,140,0.16)' : 'rgba(255,80,70,0.2)';
        ctx.fillRect(x + dx * TILE + 1, y + dy * TILE + 1, TILE - 2, TILE - 2);
      }
    }
    ctx.strokeStyle = ok ? 'rgba(120,255,170,0.85)' : 'rgba(255,110,100,0.9)';
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(x + 1, y + 1, size * TILE - 2, size * TILE - 2);
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawSelectionRings(ctx) {
    const g = this.game;
    const t = performance.now() / 1000;
    for (const e of g.selection) {
      if (e.dead) continue;
      const r = e.kind === 'building' ? (e.size * TILE) / 2 + 3 : e.radius + 6;
      const color = e.owner === g.me ? '#8ef0b0' : e.owner < 0 ? '#d8d0b8' : '#ff8a72';
      ctx.save();
      ctx.translate(e.x, e.y + (e.kind === 'building' ? e.size * TILE * 0.16 : 2));
      ctx.scale(1, 0.58);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = rgba(color, 0.9);
      // segmented ring, slowly turning
      const segs = 4, gap = 0.42;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU + t * 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, r, a0, a0 + (TAU / segs) - gap);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    if (this.hovered && !g.selection.includes(this.hovered)) {
      const e = this.hovered;
      const r = e.kind === 'building' ? (e.size * TILE) / 2 + 3 : e.radius + 6;
      ctx.save();
      ctx.translate(e.x, e.y + (e.kind === 'building' ? e.size * TILE * 0.16 : 2));
      ctx.scale(1, 0.58);
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  drawEntities(ctx, b, camera) {
    const g = this.game;
    const list = this.drawList;
    list.length = 0;
    for (const e of this.world.entities) {
      if (e.dead) continue;
      if (e.x < b.x0 - 80 || e.x > b.x1 + 80 || e.y < b.y0 - 120 || e.y > b.y1 + 80) continue;
      if (e.kind === 'unit' && !g.fog.areaVisible(e)) continue;
      if (e.kind !== 'unit' && !g.fog.areaExplored(e)) continue;
      list.push(e);
    }
    list.sort((a, z) => (a.y + (a.kind === 'building' ? a.size * TILE * 0.4 : 0)) - (z.y + (z.kind === 'building' ? z.size * TILE * 0.4 : 0)));
    for (const e of list) {
      if (e.kind === 'resource') this.drawResource(ctx, e);
      else if (e.kind === 'building') this.drawBuilding(ctx, e);
      else this.drawUnit(ctx, e);
    }
  }

  drawShadow(ctx, x, y, rx, ry, alpha = 0.34) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, rx);
    gr.addColorStop(0, 'rgba(4,6,14,0.9)');
    gr.addColorStop(0.62, 'rgba(4,6,14,0.5)');
    gr.addColorStop(1, 'rgba(4,6,14,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawResource(ctx, e) {
    if (e.type === 'goldmine') {
      const sp = getProp(e.spent ? 'goldmine.spent' : 'goldmine');
      if (!sp) return;
      const fp = e.size * TILE;
      this.drawShadow(ctx, e.x, e.y + 8, fp * 0.5, fp * 0.2, 0.4);
      if (sp.override) {
        const f = fitOverride(sp.override, e.x, e.y + fp * 0.34, fp * 1.62);
        ctx.drawImage(sp.override, f.x, f.y, f.w, f.h);
      } else {
        ctx.drawImage(sp.canvas, e.x - sp.ax, e.y - sp.ay + 6);
      }
      return;
    }
    const key = `${e.type}.${e.variant % 3}`;
    const sp = getProp(key);
    if (!sp) return;
    const depleted = e.amount / e.maxAmount;
    this.drawShadow(ctx, e.x, e.y + 3, 13, 5, 0.34);
    ctx.save();
    if (depleted < 0.5) { ctx.globalAlpha = 0.72 + depleted * 0.56; }
    const shrink = lerp(0.82, 1, clamp(depleted, 0, 1));
    ctx.translate(e.x, e.y + 4);
    ctx.scale(shrink, shrink);
    if (sp.override) {
      const f = fitOverride(sp.override, 0, 0, 52);
      ctx.drawImage(sp.override, f.x, f.y, f.w, f.h);
    } else {
      ctx.drawImage(sp.canvas, -sp.ax, -sp.ay);
    }
    ctx.restore();
  }

  drawBuilding(ctx, e) {
    const g = this.game;
    const color = e.owner >= 0 ? g.players[e.owner].color : '#8a8f9c';
    const sp = getBuildingSprites(e.type, color);
    const fp = e.size * TILE;
    this.drawShadow(ctx, e.x, e.y + fp * 0.30, fp * 0.56, fp * 0.22, 0.45);
    ctx.save();
    if (e.hitFlash > 0) { ctx.filter = 'brightness(1.7) saturate(0.6)'; }
    if (e.complete && sp.override) {
      const f = fitOverride(sp.override, e.x, e.y + fp * 0.42, fp * 1.62);
      ctx.drawImage(sp.override, f.x, f.y, f.w, f.h);
    } else {
      const img = e.complete ? sp.done : sp.stages[clamp(Math.floor(e.progress * 4), 0, 3)];
      ctx.drawImage(img, e.x - sp.ax, e.y - sp.ay);
    }
    ctx.restore();
    // production glow while something is cooking
    if (e.complete && e.queue.length) {
      const t = performance.now() / 1000;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.12 + 0.08 * Math.sin(t * 3);
      const gr = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, fp * 0.75);
      gr.addColorStop(0, FACTIONS[BUILDINGS[e.type].faction].accent);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(e.x, e.y, fp * 0.75, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  drawUnit(ctx, e) {
    const g = this.game;
    const color = g.players[e.owner].color;
    const sp = getUnitSprites(e.type, color);
    const { view, flip } = viewForAngle(e.angle);
    const a = e.anim;
    let frames = sp.views[view][a.name] || sp.views[view].idle;
    let idx = 0;
    if (a.name === 'walk') idx = Math.floor(a.t * WALK_FRAMES) % WALK_FRAMES;
    else if (a.name === 'attack') idx = clamp(Math.floor(a.t * ATTACK_FRAMES), 0, ATTACK_FRAMES - 1);
    const img = frames[idx] || frames[0];

    const bob = a.name === 'idle' ? Math.sin(performance.now() / 620 + e.id) * 0.8 : 0;
    this.drawShadow(ctx, e.x, e.y + 2, e.radius * 1.35, e.radius * 0.52, 0.38);

    ctx.save();
    ctx.translate(e.x, e.y + bob);
    if (flip) ctx.scale(-1, 1);
    if (e.hitFlash > 0) ctx.filter = 'brightness(1.85) saturate(0.5)';
    if (e.spawnT < 0.35) ctx.globalAlpha = clamp(e.spawnT / 0.35, 0, 1);
    ctx.drawImage(img, -sp.ax, -sp.ay);
    ctx.restore();

    // carried load
    if (e.carrying) {
      ctx.save();
      ctx.translate(e.x + (flip ? -8 : 8), e.y - e.radius * 2.1);
      if (e.carrying.type === 'gold') {
        ctx.fillStyle = '#f0c46a';
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(3, -3, 3, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      } else {
        const dem = FACTIONS[UNITS[e.type].faction].corrupts;
        ctx.fillStyle = dem ? '#ff6a2a' : '#8a6a45';
        ctx.save(); ctx.rotate(-0.4);
        roundRect(ctx, -5, -2.5, 10, 5, 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  drawProjectiles(ctx, b) {
    for (const p of this.game.projectiles) {
      if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) continue;
      const art = PROJECTILE_ART[p.kind] || PROJECTILE_ART.arrow;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle || 0);
      if (art.len > 0) {
        ctx.strokeStyle = art.trail; ctx.lineWidth = art.w * 1.8; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-art.len * 1.8, 0); ctx.lineTo(-art.len * 0.4, 0); ctx.stroke();
        ctx.strokeStyle = art.color; ctx.lineWidth = art.w;
        ctx.beginPath(); ctx.moveTo(-art.len, 0); ctx.lineTo(art.len * 0.35, 0); ctx.stroke();
        ctx.fillStyle = art.tip;
        poly(ctx, [[art.len * 0.35, -art.w * 0.9], [art.len * 0.85, 0], [art.len * 0.35, art.w * 0.9]]);
        ctx.fill();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, art.w * 2.6);
        gr.addColorStop(0, art.tip); gr.addColorStop(0.4, art.color); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(0, 0, art.w * 2.6, 0, TAU); ctx.fill();
        ctx.fillStyle = art.tip;
        ctx.beginPath(); ctx.arc(0, 0, art.w * 0.5, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawParticles(ctx, b) {
    const fx = this.game.effects;
    ctx.save();
    for (const p of fx.parts) {
      const k = 1 - p.age / p.life;
      if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) continue;
      if (p.kind === 'shock') {
        const r = lerp(p.r0, p.r1, 1 - k);
        ctx.globalAlpha = k * 0.7;
        ctx.strokeStyle = p.color || '#ff8a3d';
        ctx.lineWidth = 2 + k * 3;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.6, 0, 0, TAU); ctx.stroke();
        continue;
      }
      if (p.kind === 'smoke') {
        ctx.globalAlpha = k * 0.5;
        ctx.fillStyle = p.color || 'rgba(90,90,100,0.5)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - k), 0, TAU); ctx.fill();
        continue;
      }
      if (p.kind === 'ember' || p.kind === 'heal') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
        gr.addColorStop(0, p.color || '#ff8a3d'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 3, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color || '#ffffff';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * k, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawRally(ctx) {
    const g = this.game;
    for (const e of g.selection) {
      if (e.kind !== 'building' || !e.rally || e.owner !== g.me) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(224,160,240,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.rally.x, e.rally.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(224,160,240,0.85)';
      ctx.beginPath(); ctx.arc(e.rally.x, e.rally.y, 4.5, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // order feedback for selected units
    for (const e of g.selection) {
      if (e.kind !== 'unit' || e.owner !== g.me) continue;
      const o = e.order;
      if (!o) continue;
      let tx, ty, color;
      if (o.type === 'move' || o.type === 'attackMove' || o.type === 'patrol') { tx = o.x; ty = o.y; color = o.type === 'move' ? 'rgba(150,200,255,0.35)' : 'rgba(255,140,110,0.4)'; }
      else if (o.target) { tx = o.target.x; ty = o.target.y; color = o.type === 'attack' ? 'rgba(255,120,100,0.4)' : 'rgba(240,200,120,0.35)'; }
      if (tx === undefined) continue;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 7]);
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.restore();
    }
  }

  drawBars(ctx, b, camera) {
    const g = this.game;
    const showAll = this.showHealth === 'always';
    for (const e of this.drawList) {
      if (e.kind === 'resource') { this.drawResourceBar(ctx, e); continue; }
      const sel = g.selection.includes(e);
      const damaged = e.hp < e.maxHp - 0.5;
      if (!sel && !damaged && !showAll && e !== this.hovered) continue;
      const wpx = e.kind === 'building' ? Math.min(e.size * TILE * 0.78, 78) : Math.max(20, e.radius * 2.6);
      const top = e.kind === 'building'
        ? e.y - e.size * TILE * 0.5 - 10
        : e.y - e.radius * 3.2 - 6;
      const frac = clamp(e.hp / e.maxHp, 0, 1);
      const col = frac > 0.6 ? '#4ade80' : frac > 0.3 ? '#fbbf24' : '#f87171';
      ctx.save();
      ctx.translate(e.x - wpx / 2, top);
      roundRect(ctx, -1, -1, wpx + 2, 6, 3);
      ctx.fillStyle = 'rgba(6,8,14,0.72)'; ctx.fill();
      roundRect(ctx, 0, 0, wpx * frac, 4, 2);
      ctx.fillStyle = col; ctx.fill();
      if (e.kind === 'building' && !e.complete) {
        roundRect(ctx, 0, 6, wpx * e.progress, 3, 1.5);
        ctx.fillStyle = '#8fb8ff'; ctx.fill();
      }
      ctx.restore();
    }
  }

  drawResourceBar(ctx, e) {
    if (!this.game.selection.includes(e) && e !== this.hovered) return;
    const wpx = e.size * TILE * 0.8;
    const frac = clamp(e.amount / e.maxAmount, 0, 1);
    ctx.save();
    ctx.translate(e.x - wpx / 2, e.y - e.size * TILE * 0.55 - 8);
    roundRect(ctx, -1, -1, wpx + 2, 6, 3);
    ctx.fillStyle = 'rgba(6,8,14,0.72)'; ctx.fill();
    roundRect(ctx, 0, 0, wpx * frac, 4, 2);
    ctx.fillStyle = e.type === 'goldmine' ? '#f0c46a' : e.type === 'tree' ? '#7fbf7a' : '#ff8a3d';
    ctx.fill();
    ctx.restore();
  }

  drawFloaters(ctx) {
    const fx = this.game.effects;
    if (!fx.floaters.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 13px system-ui, sans-serif';
    for (const f of fx.floaters) {
      const k = 1 - f.age / f.life;
      ctx.globalAlpha = k;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color || '#fff';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  drawSelectBox(ctx) {
    const b = this.selectBox;
    if (!b || (b.w < 3 && b.h < 3)) return;
    ctx.save();
    ctx.fillStyle = 'rgba(120,240,170,0.10)';
    ctx.strokeStyle = 'rgba(150,255,190,0.85)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, b.x, b.y, b.w, b.h, 3);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  drawVignette(ctx, W, H) {
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
