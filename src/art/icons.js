// ============================================================================
// Command-card and portrait icons. Unit/structure icons re-use the same vector
// rigs the world sprites are built from, so the interface and the battlefield
// never drift apart.
// ============================================================================

import { TAU, poly, roundRect, rgba, shade } from '../core/util.js';
import { drawUnitFrame, unitSpriteBox } from './units.js';
import { drawBuildingFrame } from './buildings.js';
import { UNITS, BUILDINGS, UPGRADES, FACTIONS, TILE } from '../game/defs.js';
import { UNIT_ART } from './palette.js';

function backdrop(ctx, s, tint) {
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, shade(tint, -0.55));
  g.addColorStop(0.55, shade(tint, -0.74));
  g.addColorStop(1, '#080a11');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const r = ctx.createRadialGradient(s * 0.32, s * 0.22, 0, s * 0.5, s * 0.5, s * 0.78);
  r.addColorStop(0, rgba(tint, 0.35)); r.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, s, s);
}

function vignette(ctx, s) {
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
}

export function drawUnitIcon(ctx, s, type, teamColor) {
  const u = UNITS[type];
  const tint = teamColor || FACTIONS[u?.faction || 'human'].color;
  backdrop(ctx, s, tint);
  const box = unitSpriteBox(type);
  const art = UNIT_ART[type];
  const fit = (s * 0.86) / Math.max(box.w, box.h * 0.92);
  ctx.save();
  ctx.translate(s * 0.5, s * 0.5 + (box.h * fit) * 0.34);
  ctx.scale(fit * 1.35, fit * 1.35);
  // ground shadow
  ctx.save(); ctx.globalAlpha = 0.35;
  ctx.beginPath(); ctx.ellipse(0, 0, 13 * (art?.scale || 1), 4.5 * (art?.scale || 1), 0, 0, TAU);
  ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
  drawUnitFrame(ctx, type, teamColor, 'idle', 0.1, 'front');
  ctx.restore();
  vignette(ctx, s);
}

export function drawBuildingIcon(ctx, s, type, teamColor) {
  const b = BUILDINGS[type];
  const tint = teamColor || FACTIONS[b?.faction || 'human'].color;
  backdrop(ctx, s, tint);
  const fp = (b?.size || 2) * TILE;
  const fit = (s * 0.92) / (fp * 1.55);
  ctx.save();
  ctx.translate(s * 0.5, s * 0.72);
  ctx.scale(fit, fit);
  drawBuildingFrame(ctx, type, teamColor);
  ctx.restore();
  vignette(ctx, s);
}

export function drawUpgradeIcon(ctx, s, id, teamColor) {
  const up = UPGRADES[id];
  const tint = teamColor || FACTIONS[up?.faction || 'human'].color;
  backdrop(ctx, s, tint);
  const c = s / 2;
  ctx.save();
  ctx.translate(c, c);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const ink = 'rgba(9,7,14,0.85)';
  const mk = (path, fill, ow = s * 0.055) => { path(); ctx.lineWidth = ow; ctx.strokeStyle = ink; ctx.stroke(); ctx.fillStyle = fill; ctx.fill(); };
  const k = s / 48;
  switch (id) {
    case 'h_weapons': case 'd_weapons': {
      const metal = id === 'h_weapons' ? '#cfd9ea' : '#ff8a3d';
      for (const sgn of [-1, 1]) {
        ctx.save(); ctx.rotate(sgn * 0.42);
        mk(() => poly(ctx, [[-2.4 * k, 12 * k], [2.4 * k, 12 * k], [1.8 * k, -10 * k], [0, -15 * k], [-1.8 * k, -10 * k]]), metal);
        mk(() => poly(ctx, [[-5.6 * k, 11 * k], [5.6 * k, 11 * k], [5.6 * k, 13.6 * k], [-5.6 * k, 13.6 * k]]), '#e0ab4c', s * 0.045);
        ctx.restore();
      }
      break;
    }
    case 'h_armor': case 'd_hide': {
      const metal = id === 'h_armor' ? '#8e9cb4' : '#a83c3c';
      mk(() => poly(ctx, [[-12 * k, -13 * k], [12 * k, -13 * k], [12 * k, 3 * k], [0, 15 * k], [-12 * k, 3 * k]]), metal);
      mk(() => poly(ctx, [[-7 * k, -8 * k], [7 * k, -8 * k], [7 * k, 2 * k], [0, 10 * k], [-7 * k, 2 * k]]), shade(metal, 0.24), s * 0.04);
      break;
    }
    case 'h_arrows': {
      for (const off of [-6 * k, 0, 6 * k]) {
        ctx.save(); ctx.translate(off, 0); ctx.rotate(0.22);
        mk(() => { ctx.beginPath(); ctx.moveTo(0, 13 * k); ctx.lineTo(0, -9 * k); ctx.closePath(); }, '#e8dcc0', s * 0.055);
        mk(() => poly(ctx, [[-3 * k, -8 * k], [3 * k, -8 * k], [0, -15 * k]]), '#cfd9ea', s * 0.045);
        ctx.restore();
      }
      break;
    }
    case 'h_blessing': {
      mk(() => { ctx.beginPath(); ctx.arc(0, -1 * k, 10 * k, 0, TAU); }, '#ffe8aa');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -k, 0, 0, -k, 20 * k);
      g.addColorStop(0, 'rgba(255,230,160,0.8)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -k, 20 * k, 0, TAU); ctx.fill(); ctx.restore();
      mk(() => poly(ctx, [[-2 * k, -12 * k], [2 * k, -12 * k], [2 * k, -6 * k], [8 * k, -6 * k], [8 * k, -2 * k], [2 * k, -2 * k], [2 * k, 9 * k], [-2 * k, 9 * k], [-2 * k, -2 * k], [-8 * k, -2 * k], [-8 * k, -6 * k], [-2 * k, -6 * k]]), '#fff6d8', s * 0.04);
      break;
    }
    case 'd_spread': {
      mk(() => { ctx.beginPath(); ctx.arc(0, 2 * k, 13 * k, 0, TAU); }, '#2f1a2e');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#ff5a1f'; ctx.lineWidth = 1.8 * k;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.4;
        ctx.beginPath(); ctx.moveTo(0, 2 * k);
        ctx.lineTo(Math.cos(a) * 9 * k, 2 * k + Math.sin(a) * 9 * k);
        ctx.lineTo(Math.cos(a + 0.5) * 13 * k, 2 * k + Math.sin(a + 0.5) * 13 * k);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'd_frenzy': {
      mk(() => poly(ctx, [[-4 * k, -14 * k], [7 * k, -14 * k], [1 * k, -2 * k], [9 * k, -2 * k], [-5 * k, 15 * k], [-1 * k, 1 * k], [-8 * k, 1 * k]]), '#ff8a3d');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 18 * k);
      g2.addColorStop(0, 'rgba(255,120,50,0.55)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(0, 0, 18 * k, 0, TAU); ctx.fill(); ctx.restore();
      break;
    }
    default: {
      mk(() => { ctx.beginPath(); ctx.arc(0, 0, 11 * k, 0, TAU); }, tint);
    }
  }
  ctx.restore();
  vignette(ctx, s);
}

const CMD_GLYPHS = {
  move:    { tint: '#4f86e0', label: 'move' },
  stop:    { tint: '#a04040', label: 'stop' },
  hold:    { tint: '#8a7a50', label: 'hold' },
  attack:  { tint: '#c2503c', label: 'attack' },
  patrol:  { tint: '#3fae86', label: 'patrol' },
  build:   { tint: '#8a6a45', label: 'build' },
  repair:  { tint: '#5f8f6a', label: 'repair' },
  gather:  { tint: '#e0ab4c', label: 'gather' },
  cancel:  { tint: '#7a3b3b', label: 'cancel' },
  rally:   { tint: '#c766d8', label: 'rally' },
  back:    { tint: '#556080', label: 'back' },
};

export function drawCommandIcon(ctx, s, cmd) {
  const info = CMD_GLYPHS[cmd] || CMD_GLYPHS.move;
  backdrop(ctx, s, info.tint);
  const k = s / 48;
  const ink = 'rgba(9,7,14,0.8)';
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const stroke = (color, w) => { ctx.lineWidth = w + 2.4 * k; ctx.strokeStyle = ink; ctx.stroke(); ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke(); };
  const fill = (color, ow = 2.2 * k) => { ctx.lineWidth = ow; ctx.strokeStyle = ink; ctx.stroke(); ctx.fillStyle = color; ctx.fill(); };
  switch (cmd) {
    case 'move': {
      ctx.beginPath(); ctx.moveTo(0, 13 * k); ctx.lineTo(0, -6 * k); stroke('#cfe0ff', 3 * k);
      poly(ctx, [[-7 * k, -5 * k], [7 * k, -5 * k], [0, -15 * k]]); fill('#cfe0ff');
      break;
    }
    case 'attack': {
      for (const sgn of [-1, 1]) {
        ctx.save(); ctx.scale(sgn, 1); ctx.rotate(0.45);
        poly(ctx, [[-2 * k, 12 * k], [2 * k, 12 * k], [1.4 * k, -9 * k], [0, -14 * k], [-1.4 * k, -9 * k]]);
        fill('#e8e2d2', 2 * k);
        ctx.restore();
      }
      break;
    }
    case 'stop': {
      poly(ctx, [[-9 * k, -12 * k], [9 * k, -12 * k], [9 * k, 12 * k], [-9 * k, 12 * k]]);
      fill('#ff8a80');
      break;
    }
    case 'hold': {
      poly(ctx, [[-11 * k, -12 * k], [11 * k, -12 * k], [11 * k, 2 * k], [0, 14 * k], [-11 * k, 2 * k]]);
      fill('#d8c88a');
      ctx.beginPath(); ctx.moveTo(-5 * k, -4 * k); ctx.lineTo(5 * k, -4 * k); stroke('#8a7a50', 2.4 * k);
      break;
    }
    case 'patrol': {
      ctx.beginPath(); ctx.moveTo(-11 * k, 6 * k); ctx.quadraticCurveTo(0, -14 * k, 11 * k, 6 * k);
      ctx.lineWidth = 5.4 * k; ctx.strokeStyle = ink; ctx.stroke();
      ctx.lineWidth = 3 * k; ctx.strokeStyle = '#9fe8c8'; ctx.stroke();
      poly(ctx, [[11 * k, 6 * k], [4 * k, 6 * k], [9 * k, 13 * k]]); fill('#9fe8c8', 1.8 * k);
      break;
    }
    case 'build': {
      poly(ctx, [[-12 * k, 12 * k], [-12 * k, -2 * k], [0, -12 * k], [12 * k, -2 * k], [12 * k, 12 * k]]);
      fill('#d8c4a0');
      poly(ctx, [[-4 * k, 12 * k], [-4 * k, 2 * k], [4 * k, 2 * k], [4 * k, 12 * k]]);
      fill('#6b543a', 1.8 * k);
      break;
    }
    case 'repair': {
      ctx.save(); ctx.rotate(-0.6);
      poly(ctx, [[-2.4 * k, 13 * k], [2.4 * k, 13 * k], [2.4 * k, -4 * k], [-2.4 * k, -4 * k]]); fill('#8a6a45');
      poly(ctx, [[-8 * k, -4 * k], [8 * k, -4 * k], [6 * k, -13 * k], [-6 * k, -13 * k]]); fill('#a8b2c4');
      ctx.restore();
      break;
    }
    case 'gather': {
      ctx.save(); ctx.rotate(0.5);
      poly(ctx, [[-2 * k, 13 * k], [2 * k, 13 * k], [2 * k, -6 * k], [-2 * k, -6 * k]]); fill('#8a6a45');
      ctx.beginPath(); ctx.moveTo(-11 * k, -8 * k); ctx.quadraticCurveTo(0, -14 * k, 11 * k, -8 * k);
      ctx.quadraticCurveTo(0, -6 * k, -11 * k, -8 * k); ctx.closePath(); fill('#cfd9ea');
      ctx.restore();
      break;
    }
    case 'rally': {
      ctx.beginPath(); ctx.moveTo(-6 * k, 14 * k); ctx.lineTo(-6 * k, -13 * k); stroke('#e8dcc0', 2.6 * k);
      poly(ctx, [[-6 * k, -13 * k], [10 * k, -9 * k], [-6 * k, -3 * k]]); fill('#e0a0f0', 2 * k);
      break;
    }
    case 'cancel': {
      ctx.beginPath();
      ctx.moveTo(-9 * k, -9 * k); ctx.lineTo(9 * k, 9 * k);
      ctx.moveTo(9 * k, -9 * k); ctx.lineTo(-9 * k, 9 * k);
      stroke('#ff9b8a', 4 * k);
      break;
    }
    case 'back': {
      poly(ctx, [[6 * k, -12 * k], [6 * k, 12 * k], [-9 * k, 0]]); fill('#c0cade');
      break;
    }
    default: break;
  }
  ctx.restore();
  vignette(ctx, s);
}

/** Faction crest for the menu cards. */
export function drawCrest(ctx, s, faction) {
  const f = FACTIONS[faction];
  ctx.clearRect(0, 0, s, s);
  const c = s / 2, k = s / 160;
  ctx.save();
  ctx.translate(c, c);
  const ink = 'rgba(9,7,14,0.85)';
  const fill = (color, ow = 4 * k) => { ctx.lineWidth = ow; ctx.strokeStyle = ink; ctx.lineJoin = 'round'; ctx.stroke(); ctx.fillStyle = color; ctx.fill(); };
  // shield / sigil field
  ctx.save();
  const g = ctx.createLinearGradient(0, -60 * k, 0, 62 * k);
  g.addColorStop(0, shade(f.color, 0.2)); g.addColorStop(1, shade(f.colorDark, -0.15));
  poly(ctx, [[-46 * k, -54 * k], [46 * k, -54 * k], [46 * k, 12 * k], [0, 62 * k], [-46 * k, 12 * k]]);
  fill(g, 5 * k);
  ctx.restore();
  if (faction === 'human') {
    // crown over crossed swords
    for (const sgn of [-1, 1]) {
      ctx.save(); ctx.scale(sgn, 1); ctx.rotate(0.5);
      poly(ctx, [[-4 * k, 40 * k], [4 * k, 40 * k], [3 * k, -26 * k], [0, -38 * k], [-3 * k, -26 * k]]); fill('#dfe7f5', 3.4 * k);
      poly(ctx, [[-13 * k, 26 * k], [13 * k, 26 * k], [13 * k, 33 * k], [-13 * k, 33 * k]]); fill('#e0ab4c', 3 * k);
      ctx.restore();
    }
    ctx.translate(0, -22 * k);
    poly(ctx, [[-24 * k, 10 * k], [-24 * k, -10 * k], [-12 * k, 2 * k], [0, -16 * k], [12 * k, 2 * k], [24 * k, -10 * k], [24 * k, 10 * k]]);
    fill('#ffd98a', 4 * k);
  } else {
    // horned skull over a rift
    ctx.save();
    const rg = ctx.createRadialGradient(0, 6 * k, 0, 0, 6 * k, 46 * k);
    rg.addColorStop(0, 'rgba(255,150,60,0.9)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 6 * k, 46 * k, 0, TAU); ctx.fill();
    ctx.restore();
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sgn * 20 * k, -8 * k);
      ctx.quadraticCurveTo(sgn * 52 * k, -26 * k, sgn * 42 * k, -54 * k);
      ctx.quadraticCurveTo(sgn * 36 * k, -28 * k, sgn * 14 * k, -20 * k);
      ctx.closePath(); fill('#e8dcc0', 4 * k);
    }
    ctx.beginPath(); ctx.ellipse(0, 0, 24 * k, 22 * k, 0, 0, TAU); fill('#ded4bd', 4.5 * k);
    poly(ctx, [[-13 * k, 16 * k], [13 * k, 16 * k], [9 * k, 36 * k], [-9 * k, 36 * k]]); fill('#c9bfa6', 3.5 * k);
    ctx.fillStyle = '#1a0c10';
    ctx.beginPath(); ctx.ellipse(-9 * k, -2 * k, 6.5 * k, 6 * k, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(9 * k, -2 * k, 6.5 * k, 6 * k, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const ex of [-9 * k, 9 * k]) {
      const eg = ctx.createRadialGradient(ex, -2 * k, 0, ex, -2 * k, 14 * k);
      eg.addColorStop(0, 'rgba(255,140,50,0.95)'); eg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(ex, -2 * k, 14 * k, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}
