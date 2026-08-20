// ============================================================================
// Structure sprites. Drawn in a shallow 3/4 projection: the footprint square
// sits flat on the ground and volumes rise from its back edge, which reads
// correctly in a top-down camera without committing to full isometric.
//
// Origin (0,0) is the CENTRE of the footprint. The footprint spans
// [-fp/2, +fp/2] on x and y, and everything tall is drawn above -fp/2.
// ============================================================================

import { TAU, clamp, lerp, poly, roundRect, shade, rgba } from '../core/util.js';
import { BUILDING_ART } from './palette.js';
import { BUILDINGS, TILE } from '../game/defs.js';

const OUTLINE = 'rgba(9,7,14,0.9)';

function shape(ctx, color, ow = 2.2) {
  if (ow > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = ow; ctx.strokeStyle = OUTLINE; ctx.stroke(); }
  ctx.fillStyle = color; ctx.fill();
}

/** Stone plate the structure stands on. */
function foundation(ctx, fp, color) {
  roundRect(ctx, -fp / 2, -fp / 2 + fp * 0.08, fp, fp * 0.92, fp * 0.13);
  shape(ctx, color, 2.4);
  ctx.save(); ctx.globalAlpha = 0.28;
  roundRect(ctx, -fp / 2 + 3, -fp / 2 + fp * 0.08 + 3, fp - 6, fp * 0.92 - 6, fp * 0.1);
  ctx.fillStyle = shade(color, 0.2); ctx.fill(); ctx.restore();
}

/**
 * A rectangular volume: front wall plus a pitched roof above it.
 * y is the wall's FRONT-BOTTOM line.
 */
function volume(ctx, x, y, w, wallH, roofH, wallC, roofC, opts = {}) {
  const eave = opts.eave ?? w * 0.09;
  // side shadow on the wall
  poly(ctx, [[x - w / 2, y], [x + w / 2, y], [x + w / 2, y - wallH], [x - w / 2, y - wallH]]);
  shape(ctx, wallC, 2.2);
  ctx.save();
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.55, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g; ctx.fill(); ctx.restore();

  if (roofH > 0) {
    if (opts.hip) {
      poly(ctx, [[x - w / 2 - eave, y - wallH], [x + w / 2 + eave, y - wallH],
                 [x + w * 0.24, y - wallH - roofH], [x - w * 0.24, y - wallH - roofH]]);
    } else {
      poly(ctx, [[x - w / 2 - eave, y - wallH], [x + w / 2 + eave, y - wallH], [x, y - wallH - roofH]]);
    }
    shape(ctx, roofC, 2.2);
    ctx.save();
    const rg = ctx.createLinearGradient(0, y - wallH - roofH, 0, y - wallH);
    rg.addColorStop(0, 'rgba(255,255,255,0.16)');
    rg.addColorStop(1, 'rgba(0,0,0,0.20)');
    ctx.fillStyle = rg; ctx.fill(); ctx.restore();
  }
}

function towerVolume(ctx, x, y, w, h, wallC, roofC, teamColor) {
  poly(ctx, [[x - w / 2, y], [x + w / 2, y], [x + w / 2 * 0.86, y - h], [x - w / 2 * 0.86, y - h]]);
  shape(ctx, wallC, 2.2);
  // crenellations
  const cw = w * 0.86;
  for (let i = -1; i <= 1; i++) {
    poly(ctx, [[x + i * cw * 0.33 - cw * 0.11, y - h], [x + i * cw * 0.33 + cw * 0.11, y - h],
               [x + i * cw * 0.33 + cw * 0.11, y - h - w * 0.12], [x + i * cw * 0.33 - cw * 0.11, y - h - w * 0.12]]);
    shape(ctx, shade(wallC, -0.12), 1.8);
  }
  if (roofC) {
    poly(ctx, [[x - w * 0.52, y - h - w * 0.12], [x + w * 0.52, y - h - w * 0.12], [x, y - h - w * 0.72]]);
    shape(ctx, roofC, 2.0);
  }
  // arrow slit
  roundRect(ctx, x - w * 0.07, y - h * 0.62, w * 0.14, h * 0.3, w * 0.06);
  shape(ctx, 'rgba(14,12,20,0.8)', 1.4);
}

function banner(ctx, x, y, h, color) {
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h);
  ctx.lineWidth = 3.2; ctx.strokeStyle = OUTLINE; ctx.stroke();
  ctx.lineWidth = 1.6; ctx.strokeStyle = '#6b5a44'; ctx.stroke();
  poly(ctx, [[x, y - h], [x + h * 0.52, y - h + h * 0.1], [x + h * 0.42, y - h * 0.5], [x, y - h * 0.44]]);
  shape(ctx, color, 1.8);
}

function windowGlow(ctx, x, y, w, h, color) {
  roundRect(ctx, x - w / 2, y - h, w, h, Math.min(w, h) * 0.35);
  ctx.fillStyle = color; ctx.fill();
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
  const g = ctx.createRadialGradient(x, y - h / 2, 0, x, y - h / 2, w * 2.4);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - h / 2, w * 2.4, 0, TAU); ctx.fill();
  ctx.restore();
}

function jaggedRock(ctx, x, y, w, h, color, seed = 1) {
  const pts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const jx = x - w / 2 + w * t;
    const wob = Math.sin(t * 9 + seed) * 0.5 + Math.sin(t * 21 + seed * 3) * 0.3;
    const jy = y - h * (0.35 + 0.65 * Math.sin(t * Math.PI)) - wob * h * 0.16;
    pts.push([jx, jy]);
  }
  pts.push([x + w / 2, y], [x - w / 2, y]);
  poly(ctx, pts);
  shape(ctx, color, 2.2);
}

function emberGlow(ctx, x, y, r, color, alpha = 0.55) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(0.45, rgba(color.startsWith('#') ? color : '#ff6a2a', 0.35)); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}

// ============================================================================
//  SILHOUETTES
// ============================================================================
const SIL = {
  // ------------------------------ human -----------------------------------
  hall(ctx, a, fp, team) {
    foundation(ctx, fp, a.stone);
    const y = fp * 0.34;
    towerVolume(ctx, -fp * 0.36, y, fp * 0.26, fp * 0.62, shade(a.wall, -0.08), a.roof, team);
    towerVolume(ctx, fp * 0.36, y, fp * 0.26, fp * 0.62, shade(a.wall, -0.08), a.roof, team);
    volume(ctx, 0, y + fp * 0.04, fp * 0.58, fp * 0.4, fp * 0.34, a.wall, a.roof, { hip: true });
    // gate
    ctx.beginPath();
    ctx.moveTo(-fp * 0.11, y + fp * 0.04);
    ctx.lineTo(-fp * 0.11, y - fp * 0.2);
    ctx.quadraticCurveTo(0, y - fp * 0.33, fp * 0.11, y - fp * 0.2);
    ctx.lineTo(fp * 0.11, y + fp * 0.04); ctx.closePath();
    shape(ctx, '#3a3026', 2.0);
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(i * fp * 0.055, y + fp * 0.03); ctx.lineTo(i * fp * 0.055, y - fp * 0.24);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
    }
    windowGlow(ctx, -fp * 0.19, y - fp * 0.26, fp * 0.07, fp * 0.11, '#ffd98a');
    windowGlow(ctx, fp * 0.19, y - fp * 0.26, fp * 0.07, fp * 0.11, '#ffd98a');
    banner(ctx, -fp * 0.36, y - fp * 0.78, fp * 0.3, team || a.banner);
    banner(ctx, fp * 0.36, y - fp * 0.78, fp * 0.3, team || a.banner);
  },
  farm(ctx, a, fp) {
    foundation(ctx, fp, shade(a.stone, -0.1));
    // tilled field strip
    ctx.save();
    roundRect(ctx, -fp * 0.46, fp * 0.06, fp * 0.92, fp * 0.36, fp * 0.06);
    ctx.fillStyle = '#5c4a30'; ctx.fill();
    ctx.clip();
    for (let i = 0; i < 7; i++) {
      ctx.beginPath(); ctx.moveTo(-fp * 0.46, fp * 0.09 + i * fp * 0.05); ctx.lineTo(fp * 0.46, fp * 0.09 + i * fp * 0.05);
      ctx.lineWidth = 2; ctx.strokeStyle = i % 2 ? 'rgba(140,180,90,0.5)' : 'rgba(0,0,0,0.18)'; ctx.stroke();
    }
    ctx.restore();
    volume(ctx, 0, fp * 0.06, fp * 0.72, fp * 0.28, fp * 0.3, a.wall, a.roof);
    // timber frame
    ctx.save(); ctx.globalAlpha = 0.75;
    for (const x of [-0.28, 0, 0.28]) {
      ctx.beginPath(); ctx.moveTo(x * fp, fp * 0.06); ctx.lineTo(x * fp, fp * 0.06 - fp * 0.28);
      ctx.lineWidth = 2.4; ctx.strokeStyle = a.trim; ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(-fp * 0.36, fp * 0.06 - fp * 0.16); ctx.lineTo(fp * 0.36, fp * 0.06 - fp * 0.16);
    ctx.lineWidth = 2.4; ctx.strokeStyle = a.trim; ctx.stroke();
    ctx.restore();
    windowGlow(ctx, 0, fp * 0.06 - fp * 0.06, fp * 0.09, fp * 0.1, '#ffcf7a');
  },
  keep(ctx, a, fp, team) {
    foundation(ctx, fp, a.stone);
    const y = fp * 0.34;
    volume(ctx, 0, y, fp * 0.78, fp * 0.4, fp * 0.16, a.wall, a.roof, { hip: true });
    towerVolume(ctx, -fp * 0.3, y - fp * 0.02, fp * 0.22, fp * 0.66, a.wall, a.roof, team);
    towerVolume(ctx, fp * 0.3, y - fp * 0.02, fp * 0.22, fp * 0.66, a.wall, a.roof, team);
    // training yard doors
    poly(ctx, [[-fp * 0.1, y], [-fp * 0.1, y - fp * 0.24], [fp * 0.1, y - fp * 0.24], [fp * 0.1, y]]);
    shape(ctx, '#3a3026', 1.8);
    // crossed swords sign
    ctx.save(); ctx.translate(0, y - fp * 0.34);
    for (const s of [-1, 1]) {
      ctx.save(); ctx.rotate(s * 0.6);
      ctx.beginPath(); ctx.moveTo(0, fp * 0.09); ctx.lineTo(0, -fp * 0.09);
      ctx.lineWidth = 2.6; ctx.strokeStyle = OUTLINE; ctx.stroke();
      ctx.lineWidth = 1.4; ctx.strokeStyle = '#cfd9ea'; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    banner(ctx, 0, y - fp * 0.58, fp * 0.26, team || a.banner);
  },
  mill(ctx, a, fp) {
    foundation(ctx, fp, a.stone);
    const y = fp * 0.34;
    volume(ctx, -fp * 0.06, y, fp * 0.66, fp * 0.36, fp * 0.3, a.wall, a.roof);
    // log pile
    for (let i = 0; i < 3; i++) {
      const lx = fp * 0.3, ly = y - i * fp * 0.075;
      roundRect(ctx, lx - fp * 0.16, ly - fp * 0.07, fp * 0.32, fp * 0.07, fp * 0.035);
      shape(ctx, i % 2 ? '#8a6a45' : '#7a5c3c', 1.8);
      ctx.beginPath(); ctx.arc(lx + fp * 0.14, ly - fp * 0.035, fp * 0.028, 0, TAU);
      shape(ctx, '#b99163', 1.2);
    }
    // saw blade
    ctx.save(); ctx.translate(-fp * 0.24, y - fp * 0.2);
    ctx.beginPath(); ctx.arc(0, 0, fp * 0.1, 0, TAU); shape(ctx, '#a8b2c4', 1.8);
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * TAU;
      poly(ctx, [[Math.cos(ang) * fp * 0.1, Math.sin(ang) * fp * 0.1],
                 [Math.cos(ang + 0.2) * fp * 0.13, Math.sin(ang + 0.2) * fp * 0.13],
                 [Math.cos(ang + 0.4) * fp * 0.1, Math.sin(ang + 0.4) * fp * 0.1]]);
      ctx.fillStyle = '#cfd9ea'; ctx.fill();
    }
    ctx.restore();
  },
  smithy(ctx, a, fp) {
    foundation(ctx, fp, a.stone);
    const y = fp * 0.34;
    volume(ctx, -fp * 0.04, y, fp * 0.7, fp * 0.36, fp * 0.22, a.wall, a.roof, { hip: true });
    // chimney with forge glow
    const cx = fp * 0.3;
    poly(ctx, [[cx - fp * 0.09, y - fp * 0.06], [cx + fp * 0.09, y - fp * 0.06], [cx + fp * 0.075, y - fp * 0.62], [cx - fp * 0.075, y - fp * 0.62]]);
    shape(ctx, a.stone, 2.0);
    emberGlow(ctx, cx, y - fp * 0.66, fp * 0.22, a.forgeGlow || '#ff8a3d', 0.7);
    // forge mouth
    windowGlow(ctx, -fp * 0.1, y - fp * 0.06, fp * 0.16, fp * 0.16, a.trim);
    // anvil
    ctx.save(); ctx.translate(-fp * 0.3, y + fp * 0.02);
    poly(ctx, [[-fp * 0.09, 0], [fp * 0.09, 0], [fp * 0.06, -fp * 0.05], [fp * 0.11, -fp * 0.09], [-fp * 0.09, -fp * 0.09], [-fp * 0.06, -fp * 0.05]]);
    shape(ctx, '#4a5468', 1.8);
    ctx.restore();
  },
  chapel(ctx, a, fp, team) {
    foundation(ctx, fp, a.stone);
    const y = fp * 0.36;
    volume(ctx, fp * 0.06, y, fp * 0.56, fp * 0.34, fp * 0.28, a.wall, a.roof);
    // bell tower
    const tx = -fp * 0.28;
    poly(ctx, [[tx - fp * 0.13, y], [tx + fp * 0.13, y], [tx + fp * 0.115, y - fp * 0.62], [tx - fp * 0.115, y - fp * 0.62]]);
    shape(ctx, a.wall, 2.2);
    poly(ctx, [[tx - fp * 0.17, y - fp * 0.62], [tx + fp * 0.17, y - fp * 0.62], [tx, y - fp * 0.96]]);
    shape(ctx, a.roof, 2.0);
    // cross
    ctx.beginPath(); ctx.moveTo(tx, y - fp * 0.96); ctx.lineTo(tx, y - fp * 1.14);
    ctx.moveTo(tx - fp * 0.055, y - fp * 1.07); ctx.lineTo(tx + fp * 0.055, y - fp * 1.07);
    ctx.lineWidth = 4; ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round'; ctx.stroke();
    ctx.lineWidth = 2.2; ctx.strokeStyle = a.trim; ctx.stroke();
    // rose window
    ctx.beginPath(); ctx.arc(fp * 0.08, y - fp * 0.26, fp * 0.09, 0, TAU);
    shape(ctx, a.glass, 1.8);
    emberGlow(ctx, fp * 0.08, y - fp * 0.26, fp * 0.24, '#9fe0ff', 0.4);
    windowGlow(ctx, tx, y - fp * 0.42, fp * 0.08, fp * 0.13, '#ffd98a');
  },
  workshop(ctx, a, fp) {
    foundation(ctx, fp, a.stone);
    const y = fp * 0.34;
    volume(ctx, 0, y, fp * 0.74, fp * 0.3, fp * 0.2, a.wall, a.roof, { hip: true });
    // open bay + a half-built ballista
    poly(ctx, [[-fp * 0.24, y], [-fp * 0.24, y - fp * 0.26], [fp * 0.24, y - fp * 0.26], [fp * 0.24, y]]);
    shape(ctx, 'rgba(26,20,16,0.85)', 1.8);
    ctx.save(); ctx.translate(0, y - fp * 0.03); ctx.scale(fp / 96, fp / 96);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 10, -6, 6.5, 0, TAU); shape(ctx, '#4d3927', 2.0); }
    poly(ctx, [[-13, -10], [13, -10], [11, -16], [-11, -16]]); shape(ctx, '#8a6a45', 2.0);
    ctx.beginPath(); ctx.moveTo(-14, -20); ctx.lineTo(14, -20);
    ctx.lineWidth = 3.4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#b99163'; ctx.stroke();
    ctx.restore();
    // gear
    ctx.save(); ctx.translate(fp * 0.34, y - fp * 0.36);
    for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate(i / 8 * TAU); poly(ctx, [[-2, -fp * 0.1], [2, -fp * 0.1], [2.6, -fp * 0.13], [-2.6, -fp * 0.13]]); shape(ctx, '#6e7688', 1.2); ctx.restore(); }
    ctx.beginPath(); ctx.arc(0, 0, fp * 0.1, 0, TAU); shape(ctx, '#8e9cb4', 1.8);
    ctx.beginPath(); ctx.arc(0, 0, fp * 0.04, 0, TAU); shape(ctx, '#3a404e', 1.2);
    ctx.restore();
  },
  tower(ctx, a, fp, team) {
    foundation(ctx, fp, a.stone);
    const y = fp * 0.38;
    poly(ctx, [[-fp * 0.3, y], [fp * 0.3, y], [fp * 0.24, y - fp * 0.95], [-fp * 0.24, y - fp * 0.95]]);
    shape(ctx, a.wall, 2.4);
    ctx.save();
    const g = ctx.createLinearGradient(-fp * 0.3, 0, fp * 0.3, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.24)');
    ctx.fillStyle = g; ctx.fill(); ctx.restore();
    // stone courses
    ctx.save(); ctx.globalAlpha = 0.18;
    for (let i = 1; i < 5; i++) {
      const yy = y - i * fp * 0.19;
      ctx.beginPath(); ctx.moveTo(-fp * 0.29 + i * fp * 0.012, yy); ctx.lineTo(fp * 0.29 - i * fp * 0.012, yy);
      ctx.lineWidth = 1.4; ctx.strokeStyle = '#000'; ctx.stroke();
    }
    ctx.restore();
    // battlements
    poly(ctx, [[-fp * 0.34, y - fp * 0.95], [fp * 0.34, y - fp * 0.95], [fp * 0.3, y - fp * 1.08], [-fp * 0.3, y - fp * 1.08]]);
    shape(ctx, shade(a.wall, -0.1), 2.0);
    for (let i = -1; i <= 1; i++) {
      poly(ctx, [[i * fp * 0.2 - fp * 0.06, y - fp * 1.08], [i * fp * 0.2 + fp * 0.06, y - fp * 1.08],
                 [i * fp * 0.2 + fp * 0.06, y - fp * 1.22], [i * fp * 0.2 - fp * 0.06, y - fp * 1.22]]);
      shape(ctx, shade(a.wall, -0.14), 1.7);
    }
    poly(ctx, [[-fp * 0.3, y - fp * 1.22], [fp * 0.3, y - fp * 1.22], [0, y - fp * 1.62]]);
    shape(ctx, a.roof, 2.0);
    banner(ctx, fp * 0.24, y - fp * 1.5, fp * 0.22, team || a.banner);
    windowGlow(ctx, 0, y - fp * 0.5, fp * 0.08, fp * 0.2, '#ffd98a');
  },

  // ------------------------------ demon -----------------------------------
  gate(ctx, a, fp, team) {
    // corrupted stone plinth
    roundRect(ctx, -fp / 2, -fp * 0.42, fp, fp * 0.9, fp * 0.16);
    shape(ctx, a.stone, 2.4);
    const y = fp * 0.36;
    // two jagged pillars framing a portal
    jaggedRock(ctx, -fp * 0.3, y, fp * 0.3, fp * 1.0, a.rock, 2);
    jaggedRock(ctx, fp * 0.3, y, fp * 0.3, fp * 1.0, a.rock, 5);
    // the tear itself
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, y - fp * 0.92);
    ctx.quadraticCurveTo(fp * 0.22, y - fp * 0.5, fp * 0.1, y);
    ctx.lineTo(-fp * 0.1, y);
    ctx.quadraticCurveTo(-fp * 0.22, y - fp * 0.5, 0, y - fp * 0.92);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, y - fp * 0.9, 0, y);
    g.addColorStop(0, '#ffd08a'); g.addColorStop(0.4, '#ff5a1f'); g.addColorStop(1, '#7a1508');
    shape(ctx, '#000', 2.4);
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    emberGlow(ctx, 0, y - fp * 0.42, fp * 0.62, a.glow, 0.8);
    // arch keystone
    poly(ctx, [[-fp * 0.26, y - fp * 0.86], [fp * 0.26, y - fp * 0.86], [fp * 0.16, y - fp * 1.12], [-fp * 0.16, y - fp * 1.12]]);
    shape(ctx, a.wall, 2.2);
    // skulls on the arch
    for (const sx of [-fp * 0.12, fp * 0.12]) {
      ctx.beginPath(); ctx.arc(sx, y - fp * 1.0, fp * 0.055, 0, TAU); shape(ctx, '#ded4bd', 1.6);
      ctx.fillStyle = '#2a1a20';
      ctx.beginPath(); ctx.arc(sx - fp * 0.02, y - fp * 1.01, fp * 0.016, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + fp * 0.02, y - fp * 1.01, fp * 0.016, 0, TAU); ctx.fill();
    }
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * fp * 0.42, y - fp * 0.9);
      ctx.quadraticCurveTo(s * fp * 0.62, y - fp * 1.2, s * fp * 0.4, y - fp * 1.42);
      ctx.lineWidth = 5; ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round'; ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = '#ded4bd'; ctx.stroke();
    }
  },
  well(ctx, a, fp) {
    roundRect(ctx, -fp * 0.46, -fp * 0.36, fp * 0.92, fp * 0.82, fp * 0.2);
    shape(ctx, a.stone, 2.2);
    const y = fp * 0.3;
    // ring of bone teeth
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * TAU;
      const rx = Math.cos(ang) * fp * 0.34, ry = y - fp * 0.22 + Math.sin(ang) * fp * 0.2;
      poly(ctx, [[rx - fp * 0.035, ry], [rx + fp * 0.035, ry], [rx, ry - fp * 0.16 - Math.sin(ang) * fp * 0.05]]);
      shape(ctx, '#ded4bd', 1.5);
    }
    // basin
    ctx.beginPath(); ctx.ellipse(0, y - fp * 0.22, fp * 0.3, fp * 0.18, 0, 0, TAU);
    shape(ctx, a.wall, 2.2);
    ctx.beginPath(); ctx.ellipse(0, y - fp * 0.22, fp * 0.22, fp * 0.12, 0, 0, TAU);
    const g = ctx.createRadialGradient(0, y - fp * 0.22, 0, 0, y - fp * 0.22, fp * 0.24);
    g.addColorStop(0, '#f0c4ff'); g.addColorStop(0.5, a.glow); g.addColorStop(1, '#2a0f3a');
    ctx.fillStyle = g; ctx.fill();
    emberGlow(ctx, 0, y - fp * 0.3, fp * 0.55, a.glow, 0.7);
    // rising wisp
    ctx.save(); ctx.globalAlpha = 0.5; ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(-fp * 0.05, y - fp * 0.3);
    ctx.quadraticCurveTo(fp * 0.1, y - fp * 0.6, -fp * 0.02, y - fp * 0.86);
    ctx.lineWidth = 5; ctx.strokeStyle = a.glow; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
  },
  pit(ctx, a, fp) {
    roundRect(ctx, -fp / 2, -fp * 0.42, fp, fp * 0.9, fp * 0.16);
    shape(ctx, a.stone, 2.4);
    const y = fp * 0.3;
    // crater rim
    ctx.beginPath(); ctx.ellipse(0, y - fp * 0.16, fp * 0.42, fp * 0.28, 0, 0, TAU);
    shape(ctx, a.rock, 2.4);
    ctx.beginPath(); ctx.ellipse(0, y - fp * 0.16, fp * 0.32, fp * 0.2, 0, 0, TAU);
    const g = ctx.createRadialGradient(0, y - fp * 0.16, 0, 0, y - fp * 0.16, fp * 0.34);
    g.addColorStop(0, '#ff9a5a'); g.addColorStop(0.45, a.glow); g.addColorStop(1, '#3a0a08');
    ctx.fillStyle = g; ctx.fill();
    emberGlow(ctx, 0, y - fp * 0.2, fp * 0.6, a.glow, 0.75);
    // claw marks climbing out
    for (const s of [-1, 1]) {
      ctx.save(); ctx.translate(s * fp * 0.3, y - fp * 0.3);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * fp * 0.03, 0);
        ctx.quadraticCurveTo(i * fp * 0.05 + s * fp * 0.04, -fp * 0.1, i * fp * 0.04 + s * fp * 0.02, -fp * 0.22);
        ctx.lineWidth = 3.4; ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round'; ctx.stroke();
        ctx.lineWidth = 1.8; ctx.strokeStyle = '#ded4bd'; ctx.stroke();
      }
      ctx.restore();
    }
    // ribs framing the pit
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * fp * 0.44, y);
      ctx.quadraticCurveTo(s * fp * 0.56, y - fp * 0.44, s * fp * 0.3, y - fp * 0.66);
      ctx.lineWidth = 6; ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round'; ctx.stroke();
      ctx.lineWidth = 3.6; ctx.strokeStyle = '#cfc4aa'; ctx.stroke();
    }
  },
  dforge(ctx, a, fp) {
    roundRect(ctx, -fp / 2, -fp * 0.42, fp, fp * 0.9, fp * 0.14);
    shape(ctx, a.stone, 2.4);
    const y = fp * 0.34;
    volume(ctx, -fp * 0.04, y, fp * 0.62, fp * 0.34, fp * 0.18, a.wall, shade(a.wall, -0.2), { hip: true });
    // brimstone crystal stacks
    for (const [cx, s] of [[-fp * 0.34, 0.9], [fp * 0.33, 1.1], [fp * 0.4, 0.6]]) {
      poly(ctx, [[cx - fp * 0.07 * s, y], [cx + fp * 0.07 * s, y], [cx + fp * 0.03 * s, y - fp * 0.34 * s], [cx - fp * 0.04 * s, y - fp * 0.3 * s]]);
      shape(ctx, '#ff8a3d', 1.8);
      emberGlow(ctx, cx, y - fp * 0.2 * s, fp * 0.24, '#ff9a3d', 0.55);
    }
    // furnace mouth
    windowGlow(ctx, -fp * 0.04, y - fp * 0.04, fp * 0.22, fp * 0.2, a.glow);
    // chimney with smoke
    poly(ctx, [[fp * 0.12, y - fp * 0.34], [fp * 0.24, y - fp * 0.34], [fp * 0.22, y - fp * 0.66], [fp * 0.14, y - fp * 0.66]]);
    shape(ctx, a.rock, 2.0);
    emberGlow(ctx, fp * 0.18, y - fp * 0.7, fp * 0.2, '#ff6a2a', 0.6);
  },
  maw(ctx, a, fp) {
    roundRect(ctx, -fp / 2, -fp * 0.42, fp, fp * 0.9, fp * 0.18);
    shape(ctx, a.stone, 2.4);
    const y = fp * 0.32;
    // the mouth
    ctx.beginPath();
    ctx.ellipse(0, y - fp * 0.24, fp * 0.4, fp * 0.3, 0, 0, TAU);
    shape(ctx, a.rock, 2.4);
    ctx.beginPath(); ctx.ellipse(0, y - fp * 0.24, fp * 0.3, fp * 0.21, 0, 0, TAU);
    const g = ctx.createRadialGradient(0, y - fp * 0.2, 0, 0, y - fp * 0.24, fp * 0.32);
    g.addColorStop(0, '#ffb46a'); g.addColorStop(0.4, '#e0402a'); g.addColorStop(1, '#20060a');
    ctx.fillStyle = g; ctx.fill();
    // teeth
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * TAU;
      const rx = Math.cos(ang) * fp * 0.3, ry = y - fp * 0.24 + Math.sin(ang) * fp * 0.21;
      const dirx = -Math.cos(ang), diry = -Math.sin(ang);
      poly(ctx, [[rx - diry * fp * 0.035, ry + dirx * fp * 0.035],
                 [rx + diry * fp * 0.035, ry - dirx * fp * 0.035],
                 [rx + dirx * fp * 0.12, ry + diry * fp * 0.12]]);
      shape(ctx, '#ded4bd', 1.4);
    }
    emberGlow(ctx, 0, y - fp * 0.26, fp * 0.66, a.glow, 0.8);
    // horns behind
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * fp * 0.36, y - fp * 0.4);
      ctx.quadraticCurveTo(s * fp * 0.62, y - fp * 0.8, s * fp * 0.34, y - fp * 1.1);
      ctx.lineWidth = 8; ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round'; ctx.stroke();
      ctx.lineWidth = 5; ctx.strokeStyle = '#cfc4aa'; ctx.stroke();
    }
  },
  altar(ctx, a, fp) {
    roundRect(ctx, -fp / 2, -fp * 0.42, fp, fp * 0.9, fp * 0.14);
    shape(ctx, a.stone, 2.4);
    const y = fp * 0.34;
    // stepped dais
    for (let i = 0; i < 3; i++) {
      const w = fp * (0.66 - i * 0.1);
      roundRect(ctx, -w / 2, y - fp * 0.06 * (i + 1), w, fp * 0.07, fp * 0.02);
      shape(ctx, shade(a.wall, i * 0.06), 1.8);
    }
    // slab
    roundRect(ctx, -fp * 0.22, y - fp * 0.3, fp * 0.44, fp * 0.09, fp * 0.03);
    shape(ctx, '#4a3550', 2.0);
    // floating rune stones
    for (const [rx, ry, rr] of [[-fp * 0.3, y - fp * 0.5, fp * 0.07], [fp * 0.3, y - fp * 0.56, fp * 0.06], [0, y - fp * 0.72, fp * 0.09]]) {
      ctx.save(); ctx.translate(rx, ry); ctx.rotate(0.3);
      poly(ctx, [[-rr, 0], [0, -rr * 1.6], [rr, 0], [0, rr * 1.6]]);
      shape(ctx, a.trim, 1.6);
      emberGlow(ctx, 0, 0, rr * 4, a.glow, 0.55);
      ctx.restore();
    }
    // beam
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35;
    const bg = ctx.createLinearGradient(0, y - fp * 0.9, 0, y - fp * 0.28);
    bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, a.glow);
    poly(ctx, [[-fp * 0.1, y - fp * 0.28], [fp * 0.1, y - fp * 0.28], [fp * 0.19, y - fp * 0.95], [-fp * 0.19, y - fp * 0.95]]);
    ctx.fillStyle = bg; ctx.fill(); ctx.restore();
  },
  bonespire(ctx, a, fp) {
    roundRect(ctx, -fp * 0.46, -fp * 0.36, fp * 0.92, fp * 0.82, fp * 0.18);
    shape(ctx, a.stone, 2.2);
    const y = fp * 0.36;
    // stacked vertebrae
    let w = fp * 0.3;
    for (let i = 0; i < 6; i++) {
      const yy = y - i * fp * 0.19;
      ctx.beginPath(); ctx.ellipse(0, yy - fp * 0.09, w * 0.5, fp * 0.09, 0, 0, TAU);
      shape(ctx, i % 2 ? a.wall : shade(a.wall, -0.1), 2.0);
      for (const s of [-1, 1]) {
        poly(ctx, [[s * w * 0.42, yy - fp * 0.12], [s * (w * 0.42 + fp * 0.11), yy - fp * 0.2], [s * w * 0.4, yy - fp * 0.05]]);
        shape(ctx, shade(a.wall, -0.06), 1.4);
      }
      w *= 0.88;
    }
    // skull crown
    const sy = y - fp * 1.16;
    ctx.beginPath(); ctx.ellipse(0, sy, fp * 0.13, fp * 0.11, 0, 0, TAU);
    shape(ctx, a.wall, 2.2);
    poly(ctx, [[-fp * 0.07, sy + fp * 0.07], [fp * 0.07, sy + fp * 0.07], [fp * 0.05, sy + fp * 0.16], [-fp * 0.05, sy + fp * 0.16]]);
    shape(ctx, shade(a.wall, -0.08), 1.6);
    ctx.fillStyle = '#1a0c10';
    ctx.beginPath(); ctx.ellipse(-fp * 0.05, sy - fp * 0.01, fp * 0.032, fp * 0.028, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(fp * 0.05, sy - fp * 0.01, fp * 0.032, fp * 0.028, 0, 0, TAU); ctx.fill();
    emberGlow(ctx, -fp * 0.05, sy - fp * 0.01, fp * 0.1, a.glow, 0.9);
    emberGlow(ctx, fp * 0.05, sy - fp * 0.01, fp * 0.1, a.glow, 0.9);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * fp * 0.11, sy - fp * 0.06);
      ctx.quadraticCurveTo(s * fp * 0.26, sy - fp * 0.16, s * fp * 0.2, sy - fp * 0.34);
      ctx.lineWidth = 5; ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round'; ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = shade(a.wall, -0.05); ctx.stroke();
    }
  },
};

/** Footprint pixel size for a structure type. */
export function buildingFootprint(type) {
  return (BUILDINGS[type]?.size || 2) * TILE;
}

export function buildingSpriteBox(type) {
  const fp = buildingFootprint(type);
  return { w: Math.ceil(fp * 1.5), h: Math.ceil(fp * 2.1), anchorY: Math.ceil(fp * 1.45) };
}

/**
 * Draw a finished structure. (0,0) is the centre of its ground footprint.
 * teamColor tints banners, tabards and pennants.
 */
export function drawBuildingFrame(ctx, type, teamColor) {
  const bd = BUILDINGS[type];
  const a = BUILDING_ART[type];
  if (!bd || !a) return;
  const fp = bd.size * TILE;
  const fn = SIL[a.silhouette] || SIL.keep;
  fn(ctx, a, fp, teamColor);
}

/** Scaffolded / summoning state, progress 0..1. */
export function drawConstruction(ctx, type, teamColor, progress, demonic) {
  const bd = BUILDINGS[type];
  if (!bd) return;
  const fp = bd.size * TILE;
  const p = clamp(progress, 0, 1);

  if (demonic) {
    // A summoning circle that a silhouette rises out of.
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, fp * 0.04, fp * 0.46, fp * 0.32, 0, 0, TAU);
    ctx.lineWidth = 2.4; ctx.strokeStyle = rgba('#ff5a1f', 0.75); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, fp * 0.04, fp * 0.34, fp * 0.24, 0, 0, TAU);
    ctx.lineWidth = 1.4; ctx.strokeStyle = rgba('#ff9a3d', 0.5); ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * TAU;
      const rx = Math.cos(ang) * fp * 0.4, ry = fp * 0.04 + Math.sin(ang) * fp * 0.28;
      poly(ctx, [[rx - 3, ry], [rx, ry - 6], [rx + 3, ry], [rx, ry + 6]]);
      ctx.fillStyle = rgba('#ff7a3d', 0.55 + 0.4 * p); ctx.fill();
    }
    emberGlow(ctx, 0, fp * 0.04, fp * 0.7, '#ff5a1f', 0.35 + p * 0.4);
    ctx.restore();
    if (p > 0.06) {
      ctx.save();
      ctx.beginPath(); ctx.rect(-fp, fp * 0.4 - fp * 2.2 * p, fp * 2, fp * 2.4); ctx.clip();
      ctx.globalAlpha = 0.35 + p * 0.65;
      drawBuildingFrame(ctx, type, teamColor);
      ctx.restore();
    }
    return;
  }

  // Human: foundation, then the structure rises inside scaffolding.
  roundRect(ctx, -fp / 2, -fp * 0.42, fp, fp * 0.9, fp * 0.12);
  shape(ctx, '#6a6153', 2.2);
  ctx.save(); ctx.globalAlpha = 0.3;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(-fp / 2, -fp * 0.42 + i * fp * 0.22); ctx.lineTo(fp / 2, -fp * 0.42 + i * fp * 0.22);
    ctx.lineWidth = 1.4; ctx.strokeStyle = '#2a2620'; ctx.stroke();
  }
  ctx.restore();

  if (p > 0.1) {
    ctx.save();
    ctx.beginPath(); ctx.rect(-fp, fp * 0.42 - fp * 2.0 * p, fp * 2, fp * 2.2); ctx.clip();
    drawBuildingFrame(ctx, type, teamColor);
    ctx.restore();
  }
  // scaffolding poles
  const h = fp * (0.5 + 0.85 * p);
  for (const s of [-1, 1]) {
    const x = s * fp * 0.44;
    ctx.beginPath(); ctx.moveTo(x, fp * 0.4); ctx.lineTo(x, fp * 0.4 - h);
    ctx.lineWidth = 4.4; ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round'; ctx.stroke();
    ctx.lineWidth = 2.6; ctx.strokeStyle = '#8a6a45'; ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const yy = fp * 0.4 - h * ((i + 1) / 3.4);
    ctx.beginPath(); ctx.moveTo(-fp * 0.46, yy); ctx.lineTo(fp * 0.46, yy);
    ctx.lineWidth = 3.4; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.lineWidth = 1.8; ctx.strokeStyle = '#a37b4e'; ctx.stroke();
  }
}
