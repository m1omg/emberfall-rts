// ============================================================================
// Terrain painting. The world is baked into 16x16-tile chunk canvases the
// renderer blits; only chunks the camera can see are ever painted, and a chunk
// is only repainted when something on it changes (corruption spreading,
// timber felled, a road worn in).
// ============================================================================

import { TAU, clamp, lerp, poly, makeRng, shade, rgba, roundRect } from '../core/util.js';
import { GROUND } from './palette.js';
import { TILE } from '../game/defs.js';
import { drawRock } from './props.js';

export const T_GRASS = 0, T_DIRT = 1, T_ROCK = 2, T_WATER = 3;
export const CHUNK = 16; // tiles per chunk edge

function tileTone(world, x, y) {
  return world.noise.fbm(x * 0.11, y * 0.11, 3) * 0.5 + 0.5;
}

function baseColor(world, x, y, t) {
  const n = tileTone(world, x, y);
  const m = world.noise(x * 0.37, y * 0.37) * 0.5 + 0.5;
  switch (t) {
    case T_GRASS: {
      const ramp = GROUND.grass;
      const i = clamp(Math.floor(n * ramp.length), 0, ramp.length - 1);
      return m > 0.72 ? shade(ramp[i], 0.06) : ramp[i];
    }
    case T_DIRT: {
      const ramp = GROUND.dirt;
      return ramp[clamp(Math.floor(n * ramp.length), 0, ramp.length - 1)];
    }
    case T_ROCK: {
      const ramp = GROUND.rock;
      return ramp[clamp(Math.floor(n * ramp.length), 0, ramp.length - 1)];
    }
    default: {
      const ramp = GROUND.water;
      return ramp[clamp(Math.floor(n * ramp.length), 0, ramp.length - 1)];
    }
  }
}

/**
 * Paint one chunk. ctx must already be translated so that tile (tx0,ty0)
 * starts at local (0,0). Paints TILE-sized cells with soft organic blending.
 */
export function paintTerrainChunk(ctx, world, tx0, ty0, tw, th) {
  const { w, h, terrain } = world;
  ctx.save();
  ctx.imageSmoothingEnabled = true;

  // --- 1. flat base ---------------------------------------------------------
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const gx = tx0 + x, gy = ty0 + y;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) { ctx.fillStyle = '#05070c'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); continue; }
      ctx.fillStyle = baseColor(world, gx, gy, terrain[gy * w + gx]);
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }

  // --- 2. organic edge blending --------------------------------------------
  // Splash each tile's colour as a soft blob so hard grid seams disappear.
  ctx.globalAlpha = 0.55;
  for (let y = -1; y <= th; y++) {
    for (let x = -1; x <= tw; x++) {
      const gx = tx0 + x, gy = ty0 + y;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      const t = terrain[gy * w + gx];
      const rnd = makeRng(gx * 73856093 ^ gy * 19349663);
      const cx = (x + 0.5) * TILE + rnd.range(-5, 5);
      const cy = (y + 0.5) * TILE + rnd.range(-5, 5);
      const r = TILE * rnd.range(0.62, 0.86);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * rnd.range(0.8, 1.05), rnd.range(0, TAU), 0, TAU);
      ctx.fillStyle = baseColor(world, gx, gy, t);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // --- 3. water depth + shoreline ------------------------------------------
  for (let y = -1; y <= th; y++) {
    for (let x = -1; x <= tw; x++) {
      const gx = tx0 + x, gy = ty0 + y;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      if (terrain[gy * w + gx] !== T_WATER) continue;
      let coast = false;
      for (let dy = -1; dy <= 1 && !coast; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (terrain[ny * w + nx] !== T_WATER) { coast = true; break; }
      }
      const px = x * TILE, py = y * TILE;
      if (coast) {
        ctx.save(); ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.ellipse(px + TILE / 2, py + TILE / 2, TILE * 0.62, TILE * 0.56, 0, 0, TAU);
        ctx.strokeStyle = GROUND.waterFoam; ctx.lineWidth = 2.2; ctx.stroke();
        ctx.restore();
      } else {
        ctx.save(); ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#0b1f2c'; ctx.fillRect(px, py, TILE, TILE);
        ctx.restore();
      }
      // ripples
      const rnd = makeRng(gx * 92821 ^ gy * 689287);
      ctx.save(); ctx.globalAlpha = 0.22; ctx.strokeStyle = '#8fd3e0'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const rx = px + rnd.range(4, TILE - 4), ry = py + rnd.range(4, TILE - 4);
        ctx.beginPath(); ctx.moveTo(rx - 5, ry); ctx.quadraticCurveTo(rx, ry - 2.4, rx + 5, ry); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // --- 4. cliffs -----------------------------------------------------------
  for (let y = -1; y <= th; y++) {
    for (let x = -1; x <= tw; x++) {
      const gx = tx0 + x, gy = ty0 + y;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      if (terrain[gy * w + gx] !== T_ROCK) continue;
      const px = x * TILE, py = y * TILE;
      const below = gy + 1 < h ? terrain[(gy + 1) * w + gx] : T_ROCK;
      const above = gy - 1 >= 0 ? terrain[(gy - 1) * w + gx] : T_ROCK;
      if (above !== T_ROCK) {
        ctx.save(); ctx.globalAlpha = 0.5;
        const g = ctx.createLinearGradient(0, py, 0, py + TILE * 0.6);
        g.addColorStop(0, GROUND.rockLight); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(px, py, TILE, TILE * 0.6);
        ctx.restore();
      }
      if (below !== T_ROCK) {
        ctx.save(); ctx.globalAlpha = 0.55;
        const g = ctx.createLinearGradient(0, py + TILE * 0.35, 0, py + TILE * 1.25);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.55, 'rgba(4,6,12,0.8)'); g.addColorStop(1, 'rgba(4,6,12,0)');
        ctx.fillStyle = g; ctx.fillRect(px - 2, py + TILE * 0.35, TILE + 4, TILE * 0.9);
        ctx.restore();
      }
      const rnd = makeRng(gx * 40499 ^ gy * 65867);
      ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = '#232936'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px + rnd.range(2, 14), py + rnd.range(2, 12));
      ctx.lineTo(px + rnd.range(16, 30), py + rnd.range(14, 30));
      ctx.stroke(); ctx.restore();
    }
  }

  // --- 5. scatter detail ---------------------------------------------------
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const gx = tx0 + x, gy = ty0 + y;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      const t = terrain[gy * w + gx];
      const rnd = makeRng(gx * 12289 ^ gy * 32771);
      const px = x * TILE, py = y * TILE;
      if (t === T_GRASS) {
        const tufts = rnd.int(1, 3);
        for (let i = 0; i < tufts; i++) {
          const ux = px + rnd.range(4, TILE - 4), uy = py + rnd.range(6, TILE - 3);
          ctx.strokeStyle = rnd.chance(0.5) ? GROUND.grassLight : shade(GROUND.grass[1], 0.14);
          ctx.globalAlpha = 0.75; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
          ctx.beginPath();
          for (let b = -1; b <= 1; b++) {
            ctx.moveTo(ux + b * 1.9, uy);
            ctx.quadraticCurveTo(ux + b * 2.8, uy - 3, ux + b * 4.2, uy - 5.2);
          }
          ctx.stroke();
        }
        if (rnd.chance(0.05)) {
          const fx = px + rnd.range(6, TILE - 6), fy = py + rnd.range(6, TILE - 6);
          ctx.globalAlpha = 0.85; ctx.fillStyle = rnd.pick(['#e8d9a0', '#d9a0c0', '#a0c8e8']);
          for (let p = 0; p < 4; p++) {
            const a = (p / 4) * TAU;
            ctx.beginPath(); ctx.arc(fx + Math.cos(a) * 1.7, fy + Math.sin(a) * 1.7, 1.15, 0, TAU); ctx.fill();
          }
          ctx.fillStyle = '#f2e2a8';
          ctx.beginPath(); ctx.arc(fx, fy, 0.9, 0, TAU); ctx.fill();
        }
        if (rnd.chance(0.035)) {
          ctx.globalAlpha = 1;
          ctx.save(); ctx.translate(px + rnd.range(8, TILE - 8), py + rnd.range(10, TILE - 4));
          drawRock(ctx, gx * 31 + gy, 0.42);
          ctx.restore();
        }
      } else if (t === T_DIRT) {
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = rnd.chance(0.5) ? '#4a3d2e' : '#7a684c';
          ctx.beginPath();
          ctx.ellipse(px + rnd.range(3, TILE - 3), py + rnd.range(3, TILE - 3), rnd.range(1.2, 3), rnd.range(0.8, 1.8), rnd.range(0, TAU), 0, TAU);
          ctx.fill();
        }
      } else if (t === T_ROCK) {
        ctx.globalAlpha = 0.6;
        if (rnd.chance(0.35)) {
          ctx.save(); ctx.translate(px + rnd.range(8, TILE - 8), py + rnd.range(10, TILE - 4));
          drawRock(ctx, gx * 17 + gy * 3, 0.55);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // --- 6. corruption -------------------------------------------------------
  paintCorruption(ctx, world, tx0, ty0, tw, th);

  ctx.restore();
}

function paintCorruption(ctx, world, tx0, ty0, tw, th) {
  const { w, h, corrupt } = world;
  if (!corrupt) return;
  let any = false;
  for (let y = -1; y <= th && !any; y++) for (let x = -1; x <= tw; x++) {
    const gx = tx0 + x, gy = ty0 + y;
    if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
    if (corrupt[gy * w + gx] > 0.01) { any = true; break; }
  }
  if (!any) return;

  ctx.save();
  // soft dark blight
  for (let y = -2; y <= th + 1; y++) {
    for (let x = -2; x <= tw + 1; x++) {
      const gx = tx0 + x, gy = ty0 + y;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      const c = corrupt[gy * w + gx];
      if (c <= 0.01) continue;
      const rnd = makeRng(gx * 2654435761 ^ gy * 40503);
      const cx = (x + 0.5) * TILE + rnd.range(-4, 4);
      const cy = (y + 0.5) * TILE + rnd.range(-4, 4);
      const r = TILE * (0.62 + 0.34 * c);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const col = GROUND.corrupt[rnd.int(0, 2)];
      g.addColorStop(0, rgba(col, Math.min(0.96, c * 1.15)));
      g.addColorStop(0.62, rgba(col, Math.min(0.8, c * 0.9)));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    }
  }
  // ember cracks on the thick parts
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const gx = tx0 + x, gy = ty0 + y;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      const c = corrupt[gy * w + gx];
      if (c < 0.45) continue;
      const rnd = makeRng(gx * 6700417 ^ gy * 2971215073);
      if (!rnd.chance(0.42)) continue;
      const sx = x * TILE + rnd.range(4, TILE - 4), sy = y * TILE + rnd.range(4, TILE - 4);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.28 + 0.4 * (c - 0.45);
      ctx.strokeStyle = GROUND.corruptCrack; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy);
      let px = sx, py = sy;
      for (let s = 0; s < 3; s++) {
        px += rnd.range(-8, 8); py += rnd.range(-7, 7);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 16);
      g.addColorStop(0, GROUND.corruptGlow); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 16, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}
