// ============================================================================
// World props: harvestable nodes and scatter decoration.
// Same convention as buildings — (0,0) is the ground anchor, up is -y.
// ============================================================================

import { TAU, lerp, poly, roundRect, shade, rgba, makeRng } from '../core/util.js';

const OUTLINE = 'rgba(9,7,14,0.88)';
function shape(ctx, color, ow = 2.0) {
  if (ow > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = ow; ctx.strokeStyle = OUTLINE; ctx.stroke(); }
  ctx.fillStyle = color; ctx.fill();
}
function glow(ctx, x, y, r, color, alpha = 0.6) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
}

const TREE_GREENS = [
  ['#2f5136', '#3f6b45', '#54885a'],
  ['#2b4a3e', '#3a6350', '#4d8168'],
  ['#3a5230', '#4c6b3e', '#638a50'],
];

/** Broadleaf canopy tree. variant 0..2, seed shifts the silhouette. */
export function drawTree(ctx, variant = 0, seed = 1, scale = 1) {
  const rnd = makeRng(seed * 7919 + variant * 131);
  const g = TREE_GREENS[variant % 3];
  ctx.save();
  ctx.scale(scale, scale);
  // trunk
  ctx.beginPath();
  ctx.moveTo(-2.6, 0); ctx.quadraticCurveTo(-1.6, -8, -2.2, -15);
  ctx.lineTo(2.2, -15); ctx.quadraticCurveTo(1.6, -8, 2.6, 0);
  ctx.closePath();
  shape(ctx, '#4a3626', 1.9);
  // canopy: three overlapping blobs
  const blobs = [
    [0, -26 - rnd.range(0, 3), 12.5 + rnd.range(-1, 2), 10.5],
    [-8 - rnd.range(0, 2), -20, 9 + rnd.range(-1, 1.5), 8],
    [8 + rnd.range(0, 2), -21, 9 + rnd.range(-1, 1.5), 8],
  ];
  ctx.beginPath();
  for (const [bx, by, rx, ry] of blobs) { ctx.moveTo(bx + rx, by); ctx.ellipse(bx, by, rx, ry, 0, 0, TAU); }
  shape(ctx, g[1], 2.3);
  // lit top-left
  ctx.save(); ctx.clip();
  ctx.beginPath();
  ctx.ellipse(-4, -30, 12, 9, -0.3, 0, TAU);
  ctx.fillStyle = g[2]; ctx.globalAlpha = 0.85; ctx.fill();
  ctx.beginPath();
  ctx.ellipse(7, -17, 12, 9, 0.2, 0, TAU);
  ctx.fillStyle = g[0]; ctx.globalAlpha = 0.6; ctx.fill();
  ctx.restore();
  ctx.restore();
}

/** Stump left behind when the timber is gone. */
export function drawStump(ctx, seed = 1) {
  ctx.beginPath();
  ctx.moveTo(-4.5, 0); ctx.lineTo(-3.6, -7); ctx.lineTo(3.6, -7); ctx.lineTo(4.5, 0);
  ctx.closePath();
  shape(ctx, '#4a3626', 1.8);
  ctx.beginPath(); ctx.ellipse(0, -7, 3.8, 1.9, 0, 0, TAU);
  shape(ctx, '#8a6a45', 1.4);
  ctx.beginPath(); ctx.ellipse(0, -7, 1.7, 0.85, 0, 0, TAU);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.8; ctx.stroke();
}

/** Brimstone crystal cluster — the Legion's second resource. */
export function drawBrimstone(ctx, variant = 0, seed = 1, scale = 1) {
  const rnd = makeRng(seed * 6151 + variant * 97);
  ctx.save(); ctx.scale(scale, scale);
  glow(ctx, 0, -12, 22, 'rgba(255,110,40,0.55)', 0.5);
  const spikes = [
    [0, -30 - rnd.range(0, 5), 6.5],
    [-8, -20 - rnd.range(0, 4), 5],
    [8.5, -22 - rnd.range(0, 4), 5.5],
    [-3.5, -14, 4],
  ];
  for (const [sx, sy, w] of spikes) {
    poly(ctx, [[sx - w, 0], [sx + w, 0], [sx + w * 0.35, sy * 0.55], [sx, sy], [sx - w * 0.5, sy * 0.5]]);
    shape(ctx, '#8a2418', 2.0);
    poly(ctx, [[sx - w * 0.2, 0], [sx + w * 0.5, 0], [sx + w * 0.2, sy * 0.55], [sx, sy]]);
    ctx.fillStyle = '#ff6a2a'; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    poly(ctx, [[sx - w * 0.1, sy * 0.2], [sx + w * 0.15, sy * 0.18], [sx, sy]]);
    ctx.fillStyle = '#ffcf7a'; ctx.globalAlpha = 0.75; ctx.fill(); ctx.globalAlpha = 1;
  }
  // scorched base
  ctx.beginPath(); ctx.ellipse(0, 0, 13, 5, 0, 0, TAU);
  ctx.fillStyle = 'rgba(30,10,6,0.55)'; ctx.fill();
  ctx.restore();
}

/** Gold mine: a timbered adit cut into a rock outcrop. */
export function drawGoldMine(ctx, fp = 64, depleted = false) {
  // outcrop
  ctx.beginPath();
  ctx.moveTo(-fp * 0.5, fp * 0.3);
  ctx.quadraticCurveTo(-fp * 0.58, -fp * 0.25, -fp * 0.24, -fp * 0.44);
  ctx.quadraticCurveTo(0, -fp * 0.6, fp * 0.26, -fp * 0.42);
  ctx.quadraticCurveTo(fp * 0.58, -fp * 0.22, fp * 0.5, fp * 0.3);
  ctx.closePath();
  shape(ctx, '#4b5265', 2.6);
  ctx.save(); ctx.clip();
  ctx.beginPath();
  ctx.moveTo(-fp * 0.6, -fp * 0.1); ctx.quadraticCurveTo(-fp * 0.1, -fp * 0.55, fp * 0.1, -fp * 0.6);
  ctx.lineTo(-fp * 0.6, -fp * 0.6); ctx.closePath();
  ctx.fillStyle = '#697389'; ctx.globalAlpha = 0.7; ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(fp * 0.1, fp * 0.4); ctx.quadraticCurveTo(fp * 0.4, -fp * 0.2, fp * 0.6, -fp * 0.4);
  ctx.lineTo(fp * 0.6, fp * 0.4); ctx.closePath();
  ctx.fillStyle = '#2e3340'; ctx.globalAlpha = 0.55; ctx.fill();
  ctx.restore();

  // entrance
  ctx.beginPath();
  ctx.moveTo(-fp * 0.17, fp * 0.3);
  ctx.lineTo(-fp * 0.17, -fp * 0.06);
  ctx.quadraticCurveTo(0, -fp * 0.24, fp * 0.17, -fp * 0.06);
  ctx.lineTo(fp * 0.17, fp * 0.3);
  ctx.closePath();
  shape(ctx, '#0d1018', 2.2);
  // timber frame
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(s * fp * 0.2, fp * 0.32); ctx.lineTo(s * fp * 0.2, -fp * 0.08);
    ctx.lineWidth = 6; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.lineWidth = 3.6; ctx.strokeStyle = '#7a5c3c'; ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(-fp * 0.25, -fp * 0.1); ctx.lineTo(fp * 0.25, -fp * 0.1);
  ctx.lineWidth = 6.5; ctx.strokeStyle = OUTLINE; ctx.stroke();
  ctx.lineWidth = 4; ctx.strokeStyle = '#8a6a45'; ctx.stroke();

  if (!depleted) {
    // gold veins + a spilled cart
    for (const [vx, vy] of [[-fp * 0.3, -fp * 0.18], [fp * 0.3, -fp * 0.14], [fp * 0.34, fp * 0.06]]) {
      ctx.save(); ctx.translate(vx, vy);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(i * 3.4 - 3, Math.sin(i * 2) * 2.2, 2.4 - i * 0.4, 0, TAU);
        ctx.fillStyle = '#f0c46a'; ctx.fill();
      }
      glow(ctx, 0, 0, 12, 'rgba(255,210,120,0.5)', 0.5);
      ctx.restore();
    }
    ctx.save(); ctx.translate(fp * 0.02, fp * 0.3);
    ctx.beginPath(); ctx.ellipse(0, 0, fp * 0.12, fp * 0.05, 0, 0, TAU);
    ctx.fillStyle = 'rgba(240,196,106,0.85)'; ctx.fill();
    for (let i = 0; i < 5; i++) {
      ctx.beginPath(); ctx.arc((i - 2) * 3.5, -1.5 - (i % 2) * 2, 2, 0, TAU);
      ctx.fillStyle = i % 2 ? '#ffe08c' : '#e0ab4c'; ctx.fill();
    }
    ctx.restore();
  }
}

/** Scatter rock used as terrain decoration. */
export function drawRock(ctx, seed = 1, size = 1) {
  const rnd = makeRng(seed * 3301);
  const n = 5 + rnd.int(0, 2);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd.range(-0.2, 0.2);
    const r = size * (5 + rnd.range(0, 4));
    pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.62 - size * 2]);
  }
  poly(ctx, pts);
  shape(ctx, '#4b5265', 1.8);
  ctx.save(); ctx.clip();
  ctx.beginPath(); ctx.ellipse(-size * 2, -size * 5, size * 6, size * 3.5, -0.3, 0, TAU);
  ctx.fillStyle = '#697389'; ctx.globalAlpha = 0.6; ctx.fill();
  ctx.restore();
}

/** Battlefield leftovers: dropped when something dies. */
export function drawWreck(ctx, faction, seed = 1) {
  const rnd = makeRng(seed * 1543);
  ctx.globalAlpha = 0.9;
  if (faction === 'demon') {
    for (let i = 0; i < 4; i++) {
      const a = rnd.range(0, TAU), r = rnd.range(2, 8);
      ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 0.55, rnd.range(1.2, 2.6), 0, TAU);
      ctx.fillStyle = 'rgba(60,20,24,0.75)'; ctx.fill();
    }
    glow(ctx, 0, 0, 12, 'rgba(255,90,30,0.35)', 0.4);
  } else {
    for (let i = 0; i < 3; i++) {
      const a = rnd.range(0, TAU), r = rnd.range(2, 7);
      ctx.save(); ctx.translate(Math.cos(a) * r, Math.sin(a) * r * 0.55); ctx.rotate(rnd.range(0, TAU));
      roundRect(ctx, -3, -1, 6, 2, 1);
      ctx.fillStyle = 'rgba(120,128,145,0.65)'; ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}
