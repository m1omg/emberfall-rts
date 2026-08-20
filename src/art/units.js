// ============================================================================
// Character sprite construction.
//
// Every unit is drawn as a small vector rig in a normalised space where the
// feet sit at (0,0) and up is -y. The baker (art/assets.js) renders each rig
// into an offscreen canvas per view/frame, applies a shared lighting pass and
// hands back blittable sprites — so the game loop never touches a bezier.
// ============================================================================

import { TAU, clamp, lerp, poly, shade } from '../core/util.js';
import { UNIT_ART } from './palette.js';

const OUTLINE = 'rgba(9,7,14,0.88)';

// --- primitives -------------------------------------------------------------
function col(m, which = 'base') { return typeof m === 'string' ? (which === 'base' ? m : shade(m, which === 'light' ? 0.26 : -0.34)) : m[which]; }

function limb(ctx, x1, y1, x2, y2, w, color, outline = true) {
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  if (outline) { ctx.lineWidth = w + 2.2; ctx.strokeStyle = OUTLINE; ctx.stroke(); }
  ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
}

function limb3(ctx, x1, y1, kx, ky, x2, y2, w, color, outline = true) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(kx, ky, x2, y2);
  if (outline) { ctx.lineWidth = w + 2.2; ctx.strokeStyle = OUTLINE; ctx.stroke(); }
  ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
}

function shape(ctx, color, ow = 2.1) {
  if (ow > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = ow; ctx.strokeStyle = OUTLINE; ctx.stroke(); }
  ctx.fillStyle = color; ctx.fill();
}

function ell(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot, 0, TAU);
}

function glowDot(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(0.4, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.9; ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
}

// --- body metrics -----------------------------------------------------------
const BUILDS = {
  slim:    { sh: 11, torso: 14, hipY: -13, head: 5.2, leg: 13, limbW: 4.2, armW: 3.8, hipW: 7 },
  normal:  { sh: 13.5, torso: 15, hipY: -13, head: 5.7, leg: 13, limbW: 4.8, armW: 4.4, hipW: 8 },
  heavy:   { sh: 16.5, torso: 16, hipY: -13.5, head: 6.2, leg: 13.5, limbW: 5.8, armW: 5.2, hipW: 9.5 },
  huge:    { sh: 23, torso: 22, hipY: -16, head: 7.8, leg: 16, limbW: 8.4, armW: 7.6, hipW: 13 },
};

// --- pose solver ------------------------------------------------------------
/** anim: 'idle' | 'walk' | 'attack'; t is 0..1 within the cycle. */
export function solvePose(anim, t, build) {
  const p = { bob: 0, legA: 0, legB: 0, armMain: 0.25, armOff: -0.2, lean: 0, swing: 0, lunge: 0, crouch: 0 };
  if (anim === 'walk') {
    const ph = t * TAU;
    const amp = build === 'huge' ? 0.42 : 0.58;
    p.legA = Math.sin(ph) * amp;
    p.legB = -p.legA;
    p.bob = Math.abs(Math.sin(ph * 2)) * (build === 'huge' ? 1.0 : 1.6);
    p.armMain = 0.2 - Math.sin(ph) * 0.42;
    p.armOff = -0.15 + Math.sin(ph) * 0.42;
    p.lean = 0.045;
  } else if (anim === 'attack') {
    // 0.0-0.32 wind up, 0.32-0.52 strike, 0.52-1.0 recover
    let s;
    if (t < 0.32) s = -lerp(0, 1, t / 0.32);
    else if (t < 0.52) s = lerp(-1, 1.15, (t - 0.32) / 0.2);
    else s = lerp(1.15, 0, (t - 0.52) / 0.48);
    p.swing = s;
    p.armMain = 0.3 + s * 1.25;
    p.armOff = -0.25 - s * 0.2;
    p.lunge = Math.max(0, s) * 2.4;
    p.lean = 0.06 + Math.max(0, s) * 0.10;
    p.legA = 0.22; p.legB = -0.26;
    p.bob = Math.max(0, s) * 0.8;
  } else {
    const ph = t * TAU;
    p.bob = Math.sin(ph) * 0.55;
    p.armMain = 0.26 + Math.sin(ph) * 0.05;
    p.armOff = -0.2 - Math.sin(ph) * 0.05;
    p.legA = 0.06; p.legB = -0.06;
  }
  return p;
}

// --- weapons ----------------------------------------------------------------
// Drawn in the hand's local frame: +x points away from the body along the arm.
function drawWeapon(ctx, kind, art, p, scaleUp) {
  const metal = art.metal, wood = { base: '#8a6a45', dark: '#4d3927', light: '#b99163' };
  switch (kind) {
    case 'sword': {
      limb(ctx, 0, 0, 0, -2, 4.5, col(wood, 'dark'));
      ctx.save(); ctx.rotate(-0.1);
      poly(ctx, [[-1.9, -2], [1.9, -2], [1.4, -18], [0, -21.5], [-1.4, -18]]);
      shape(ctx, col(metal, 'base'), 1.8);
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, -20);
      ctx.lineWidth = 1; ctx.strokeStyle = col(metal, 'light'); ctx.stroke();
      poly(ctx, [[-4.2, -1.6], [4.2, -1.6], [4.2, 0.6], [-4.2, 0.6]]);
      shape(ctx, col(art.trim, 'base'), 1.5);
      ctx.restore();
      break;
    }
    case 'lance': {
      ctx.save(); ctx.rotate(-0.06);
      limb(ctx, 0, 3, 0, -26, 3.0, col(wood, 'base'));
      poly(ctx, [[-2.4, -25], [2.4, -25], [0, -34]]);
      shape(ctx, col(metal, 'light'), 1.7);
      ell(ctx, 0, -4, 3.6, 2.4); shape(ctx, col(art.trim, 'base'), 1.4);
      ctx.restore();
      break;
    }
    case 'maul': {
      limb(ctx, 0, 2, 0, -18, 4.2, col(wood, 'dark'));
      poly(ctx, [[-8, -17], [8, -17], [9.5, -25], [-9.5, -25]]);
      shape(ctx, col(metal, 'base'), 2.2);
      poly(ctx, [[-8, -21.5], [8, -21.5], [8.6, -25], [-8.6, -25]]);
      ctx.fillStyle = col(metal, 'light'); ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
      break;
    }
    case 'pick': {
      limb(ctx, 0, 2, 1, -15, 3.0, col(wood, 'base'));
      ctx.save(); ctx.translate(1, -15); ctx.rotate(-0.25);
      poly(ctx, [[-7, 0], [7, -1.5], [6, 2], [-6.4, 2.6]]);
      shape(ctx, col(metal, 'base'), 1.7);
      ctx.restore();
      break;
    }
    case 'bow': {
      ctx.save(); ctx.rotate(-1.35);
      ctx.beginPath(); ctx.arc(0, 0, 11.5, -1.15, 1.15);
      ctx.lineWidth = 4.4; ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round'; ctx.stroke();
      ctx.lineWidth = 2.6; ctx.strokeStyle = col(wood, 'base'); ctx.stroke();
      const a = 1.15, sx = Math.cos(a) * 11.5, sy = Math.sin(a) * 11.5;
      const pull = 3 + p.swing * 4;
      ctx.beginPath(); ctx.moveTo(sx, -sy); ctx.lineTo(-pull, 0); ctx.lineTo(sx, sy);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(240,236,220,0.9)'; ctx.stroke();
      if (p.swing < 0.4) {
        ctx.beginPath(); ctx.moveTo(-pull, 0); ctx.lineTo(13, 0);
        ctx.lineWidth = 1.6; ctx.strokeStyle = '#e8dcc0'; ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'staff': {
      limb(ctx, 0, 4, -0.5, -24, 2.8, col(wood, 'base'));
      ctx.beginPath(); ctx.arc(-0.5, -26.5, 3.6, 0, TAU);
      shape(ctx, col(art.trim, 'light'), 1.6);
      glowDot(ctx, -0.5, -26.5, 8, 'rgba(255,226,160,0.55)');
      break;
    }
    case 'scepter': {
      limb(ctx, 0, 4, 0.5, -23, 3.0, '#2a1730');
      poly(ctx, [[0.5, -23], [4.5, -27], [0.5, -33], [-3.5, -27]]);
      shape(ctx, '#c766ff', 1.6);
      glowDot(ctx, 0.5, -28, 10, 'rgba(180,90,255,0.5)');
      break;
    }
    case 'orb': {
      const r = 5 + p.swing * 1.6;
      glowDot(ctx, 2, -6, 15, 'rgba(255,120,50,0.5)');
      ctx.beginPath(); ctx.arc(2, -6, r, 0, TAU);
      ctx.fillStyle = '#ff8a3d'; ctx.fill();
      ctx.beginPath(); ctx.arc(0.8, -7.4, r * 0.45, 0, TAU);
      ctx.fillStyle = '#ffe0a8'; ctx.fill();
      break;
    }
    case 'claw': {
      const spread = 0.28 + Math.max(0, p.swing) * 0.3;
      for (let i = -1; i <= 1; i++) {
        ctx.save(); ctx.rotate(i * spread);
        poly(ctx, [[0, 1.6], [1.6, -1], [0.6, -9.5], [-1.1, -1.4]]);
        shape(ctx, col(art.trim, 'light'), 1.5);
        ctx.restore();
      }
      break;
    }
    default: break;
  }
}

// --- heads ------------------------------------------------------------------
function drawHead(ctx, kind, art, m, view, eyes) {
  const r = m.head;
  const skin = col(art.skin, 'base');
  const back = view === 'back';
  switch (kind) {
    case 'kettle': {
      ell(ctx, 0, 0, r * 0.92, r * 0.95); shape(ctx, skin);
      if (!back) { ell(ctx, 0, r * 0.28, r * 0.62, r * 0.44); ctx.fillStyle = 'rgba(20,14,10,0.5)'; ctx.fill(); }
      ctx.beginPath(); ctx.arc(0, -r * 0.12, r * 1.02, Math.PI, TAU); ctx.closePath();
      shape(ctx, col(art.metal, 'base'));
      poly(ctx, [[-r * 1.5, -r * 0.14], [r * 1.5, -r * 0.14], [r * 1.35, r * 0.28], [-r * 1.35, r * 0.28]]);
      shape(ctx, col(art.metal, 'dark'), 1.7);
      break;
    }
    case 'greathelm': {
      poly(ctx, [[-r * 0.95, -r * 1.05], [r * 0.95, -r * 1.05], [r * 1.05, r * 0.5], [0, r * 1.0], [-r * 1.05, r * 0.5]]);
      shape(ctx, col(art.metal, 'base'));
      if (!back) {
        poly(ctx, [[-r * 0.62, -r * 0.1], [r * 0.62, -r * 0.1], [r * 0.62, r * 0.22], [-r * 0.62, r * 0.22]]);
        ctx.fillStyle = 'rgba(12,10,18,0.85)'; ctx.fill();
      }
      if (art.extras?.plume) {
        poly(ctx, [[-1.6, -r * 1.0], [1.6, -r * 1.0], [3.2, -r * 2.6], [0, -r * 3.1], [-3.2, -r * 2.6]]);
        shape(ctx, art.extras.plume, 1.7);
      }
      break;
    }
    case 'hood': {
      ell(ctx, 0, 0, r * 0.86, r * 0.9); shape(ctx, skin);
      ctx.beginPath();
      ctx.moveTo(-r * 1.15, r * 0.75); ctx.quadraticCurveTo(-r * 1.25, -r * 1.35, 0, -r * 1.3);
      ctx.quadraticCurveTo(r * 1.25, -r * 1.35, r * 1.15, r * 0.75);
      ctx.quadraticCurveTo(0, r * 0.2, -r * 1.15, r * 0.75); ctx.closePath();
      shape(ctx, col(art.trim, 'base'));
      if (!back) { ell(ctx, 0, r * 0.18, r * 0.52, r * 0.42); ctx.fillStyle = 'rgba(16,12,10,0.55)'; ctx.fill(); }
      break;
    }
    case 'mitre': {
      ell(ctx, 0, 0, r * 0.85, r * 0.9); shape(ctx, skin);
      poly(ctx, [[-r * 0.95, r * 0.15], [r * 0.95, r * 0.15], [r * 0.7, -r * 1.1], [0, -r * 2.0], [-r * 0.7, -r * 1.1]]);
      shape(ctx, col(art.body, 'light'));
      ctx.beginPath(); ctx.moveTo(0, -r * 1.7); ctx.lineTo(0, r * 0.1);
      ctx.lineWidth = 1.6; ctx.strokeStyle = col(art.trim, 'base'); ctx.stroke();
      break;
    }
    case 'horns': case 'greathorns': case 'imphorns': case 'crownhorns': case 'hornedhood': {
      const big = kind === 'greathorns' ? 1.9 : kind === 'imphorns' ? 1.15 : 1.35;
      if (kind === 'hornedhood') {
        ctx.beginPath();
        ctx.moveTo(-r * 1.1, r * 0.8); ctx.quadraticCurveTo(-r * 1.2, -r * 1.4, 0, -r * 1.3);
        ctx.quadraticCurveTo(r * 1.2, -r * 1.4, r * 1.1, r * 0.8);
        ctx.quadraticCurveTo(0, r * 0.25, -r * 1.1, r * 0.8); ctx.closePath();
        shape(ctx, col(art.body, 'base'));
      } else {
        ell(ctx, 0, 0, r * 0.95, r * 0.92); shape(ctx, col(art.skin, 'base'));
        ell(ctx, 0, -r * 0.3, r * 0.72, r * 0.5); ctx.fillStyle = col(art.skin, 'light'); ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
      }
      for (const s of [-1, 1]) {
        ctx.save(); ctx.scale(s, 1);
        ctx.beginPath();
        ctx.moveTo(r * 0.55, -r * 0.55);
        ctx.quadraticCurveTo(r * 1.5 * big, -r * 1.1 * big, r * 1.15 * big, -r * 2.1 * big);
        ctx.quadraticCurveTo(r * 1.0 * big, -r * 1.2 * big, r * 0.2, -r * 0.75);
        ctx.closePath();
        shape(ctx, col(art.trim === undefined ? art.metal : { base: '#d8cdb4', dark: '#6f6553', light: '#fff6e2' }, 'base'), 1.7);
        ctx.restore();
      }
      if (kind === 'crownhorns') {
        poly(ctx, [[-r * 0.9, -r * 0.75], [-r * 0.5, -r * 1.4], [0, -r * 0.85], [r * 0.5, -r * 1.4], [r * 0.9, -r * 0.75]]);
        shape(ctx, '#b04ad0', 1.5);
      }
      if (!back && eyes) {
        glowDot(ctx, -r * 0.36, r * 0.02, 3.4, eyes);
        glowDot(ctx, r * 0.36, r * 0.02, 3.4, eyes);
      }
      break;
    }
    default: {
      ell(ctx, 0, 0, r * 0.9, r * 0.92); shape(ctx, skin);
    }
  }
}

// --- biped ------------------------------------------------------------------
function drawBiped(ctx, art, p, view) {
  const m = BUILDS[art.build] || BUILDS.normal;
  const side = view === 'side', back = view === 'back';
  const ex = art.extras || {};
  const bodyC = col(art.body, 'base'), bodyD = col(art.body, 'dark'), bodyL = col(art.body, 'light');
  const legC = col(art.legs, 'base');
  const hipY = m.hipY - p.bob;
  const shY = hipY - m.torso;
  const lunge = p.lunge;

  // --- legs (far then near)
  const legOrder = [[-1, p.legA, 0.72], [1, p.legB, 1]];
  for (const [s, swing, tone] of legOrder) {
    const hx = side ? s * 1.2 : s * m.hipW * 0.5;
    const fx = hx + Math.sin(swing) * m.leg * 0.85 + (side ? 0 : 0);
    const fy = -Math.max(0, Math.cos(swing)) * 0.5;
    const kneeX = hx + Math.sin(swing) * m.leg * 0.42;
    const kneeY = hipY + m.leg * 0.5;
    const c = tone < 1 ? shade(legC, -0.24) : legC;
    limb3(ctx, hx, hipY, kneeX, kneeY, fx, fy, m.limbW, c);
    // boot
    ell(ctx, fx + (side ? 1.4 : s * 0.6), fy - 1, m.limbW * 0.85, m.limbW * 0.55);
    shape(ctx, shade(c, -0.3), 1.6);
  }

  if (ex.tail && !back) {
    const t = p.legA * 0.6;
    limb3(ctx, side ? -3 : 0, hipY + 1, -9 - t * 3, hipY - 3, -13 - t * 5, hipY + 6, 3.2, col(art.body, 'dark'));
    poly(ctx, [[-13 - t * 5, hipY + 6], [-17 - t * 6, hipY + 3], [-13.5 - t * 5, hipY + 9]]);
    shape(ctx, col(art.trim, 'base'), 1.4);
  }

  // --- cloak / cape behind
  if ((ex.cape || ex.cloak) && !back) {
    const cc = ex.cloak || (art.extras.capeColor ?? '#c2503c');
    ctx.beginPath();
    ctx.moveTo(-m.sh * 0.55, shY + 1);
    ctx.quadraticCurveTo(-m.sh * 1.15 - lunge, hipY + 5, -m.sh * 0.5 - lunge * 0.6, hipY + 9);
    ctx.lineTo(m.sh * 0.5 - lunge * 0.6, hipY + 9);
    ctx.quadraticCurveTo(m.sh * 1.05 - lunge, hipY + 4, m.sh * 0.55, shY + 1);
    ctx.closePath();
    shape(ctx, cc, 2.0);
  }

  // --- off arm (behind torso)
  const offA = p.armOff + (back ? 0 : 0);
  const oShX = side ? -2.5 : -m.sh * 0.52;
  const ohx = oShX + Math.sin(offA) * 11, ohy = shY + 4 + Math.cos(offA) * 10;
  limb3(ctx, oShX, shY + 1, oShX + Math.sin(offA) * 6 - 2, shY + 7, ohx, ohy, m.armW, shade(col(art.body, 'base'), -0.22));
  if (art.off === 'shield' && !back) {
    ctx.save(); ctx.translate(ohx - 1, ohy - 1); ctx.rotate(-0.15);
    poly(ctx, [[-6.5, -8], [6.5, -8], [6.5, 3], [0, 9.5], [-6.5, 3]]);
    shape(ctx, col(art.metal, 'base'), 2.1);
    poly(ctx, [[-4.4, -5.6], [4.4, -5.6], [4.4, 2], [0, 6.6], [-4.4, 2]]);
    shape(ctx, art.teamColor || col(art.trim, 'base'), 0);
    ell(ctx, 0, -1, 2.1, 2.1); shape(ctx, col(art.metal, 'light'), 1.2);
    ctx.restore();
  } else if (art.off === 'claw') {
    ctx.save(); ctx.translate(ohx, ohy); ctx.rotate(offA + 0.6);
    drawWeapon(ctx, 'claw', art, p);
    ctx.restore();
  }

  // --- torso
  const hunch = ex.hunch ? 2.5 : 0;
  ctx.beginPath();
  ctx.moveTo(-m.sh * 0.5 - lunge * 0.15, shY + hunch * 0.5);
  ctx.quadraticCurveTo(-m.sh * 0.62, shY + m.torso * 0.55, -m.hipW * 0.55, hipY);
  ctx.lineTo(m.hipW * 0.55, hipY);
  ctx.quadraticCurveTo(m.sh * 0.62, shY + m.torso * 0.55, m.sh * 0.5 - lunge * 0.15, shY + hunch * 0.5);
  ctx.quadraticCurveTo(0, shY - 2.5 + hunch, -m.sh * 0.5 - lunge * 0.15, shY + hunch * 0.5);
  ctx.closePath();
  shape(ctx, bodyC, 2.3);

  if (ex.robe) {
    ctx.beginPath();
    ctx.moveTo(-m.sh * 0.5, shY + m.torso * 0.45);
    ctx.quadraticCurveTo(-m.sh * 0.95, hipY + 6, -m.sh * 0.8, 0.5);
    ctx.lineTo(m.sh * 0.8, 0.5);
    ctx.quadraticCurveTo(m.sh * 0.95, hipY + 6, m.sh * 0.5, shY + m.torso * 0.45);
    ctx.closePath();
    shape(ctx, bodyC, 2.2);
    ctx.beginPath(); ctx.moveTo(0, shY + m.torso * 0.5); ctx.lineTo(0, 0);
    ctx.lineWidth = 1.8; ctx.strokeStyle = col(art.trim, 'base'); ctx.stroke();
  }
  if (ex.tabard && !back) {
    poly(ctx, [[-m.sh * 0.26, shY + 2], [m.sh * 0.26, shY + 2], [m.sh * 0.3, hipY + 2.5], [0, hipY + 5], [-m.sh * 0.3, hipY + 2.5]]);
    shape(ctx, art.teamColor || col(art.trim, 'base'), 1.6);
  }
  if (ex.spines && !side) {
    for (let i = 0; i < 3; i++) {
      const yy = shY + 2 + i * (m.torso * 0.32);
      poly(ctx, [[-m.sh * 0.5, yy], [-m.sh * 0.5 - 5 - i, yy - 3], [-m.sh * 0.42, yy + 3]]);
      shape(ctx, col(art.trim, 'light'), 1.3);
      poly(ctx, [[m.sh * 0.5, yy], [m.sh * 0.5 + 5 + i, yy - 3], [m.sh * 0.42, yy + 3]]);
      shape(ctx, col(art.trim, 'light'), 1.3);
    }
  }
  if (ex.cracks) {
    ctx.save(); ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(-m.sh * 0.3, shY + 4); ctx.lineTo(-m.sh * 0.05, shY + m.torso * 0.45);
    ctx.lineTo(-m.sh * 0.28, hipY + 1);
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#ff6a2a'; ctx.stroke();
    ctx.restore();
  }
  if (ex.pauldrons) {
    for (const s of [-1, 1]) {
      ell(ctx, s * m.sh * 0.52, shY + 2, m.sh * 0.3, m.sh * 0.23);
      shape(ctx, col(art.metal, 'light'), 2.0);
    }
  }
  if (ex.quiver && !side) {
    ctx.save(); ctx.translate(m.sh * 0.42, shY + 4); ctx.rotate(0.4);
    poly(ctx, [[-2.6, -2], [2.6, -2], [2.2, 10], [-2.2, 10]]);
    shape(ctx, col(art.trim, 'dark'), 1.6);
    for (let i = -1; i <= 1; i++) limb(ctx, i * 1.5, -2, i * 2.4, -7, 1.2, '#e8dcc0', false);
    ctx.restore();
  }
  if (ex.satchel) {
    ell(ctx, -m.sh * 0.45, hipY + 1, 4.2, 3.4); shape(ctx, col(art.trim, 'dark'), 1.6);
  }
  if (ex.batwings) {
    for (const s of [-1, 1]) {
      ctx.save(); ctx.scale(s, 1); ctx.translate(m.sh * 0.42, shY + 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(9, -9, 15, -4);
      ctx.quadraticCurveTo(11, -1, 13, 5);
      ctx.quadraticCurveTo(8, 1, 5, 7);
      ctx.quadraticCurveTo(3, 2, 0, 3);
      ctx.closePath();
      shape(ctx, shade(col(art.body, 'dark'), 0.08), 1.7);
      ctx.restore();
    }
  }

  // --- head
  const headY = shY - m.head * 0.85 + hunch * 0.4;
  ctx.save();
  ctx.translate(side ? 2.2 + lunge * 0.3 : lunge * 0.25, headY);
  ctx.rotate(p.lean * (side ? 1 : 0.4));
  drawHead(ctx, art.head, art, m, view, ex.eyes);
  ctx.restore();
  if (ex.halo) {
    ctx.save(); ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.ellipse(0, headY - m.head * 1.6, m.head * 1.25, m.head * 0.42, 0, 0, TAU);
    ctx.lineWidth = 2; ctx.strokeStyle = ex.halo; ctx.stroke(); ctx.restore();
  }

  // --- main arm + weapon (in front)
  const mShX = side ? 2.5 : m.sh * 0.5;
  const ma = p.armMain;
  const mhx = mShX + Math.sin(ma) * 11, mhy = shY + 4 + Math.cos(ma) * 9.5;
  limb3(ctx, mShX, shY + 1, mShX + Math.sin(ma) * 6 + 1, shY + 7, mhx, mhy, m.armW, col(art.body, 'base'));
  ctx.save();
  ctx.translate(mhx, mhy);
  ctx.rotate(ma + (art.weapon === 'bow' ? 0.2 : 0.35) + p.swing * 0.35);
  drawWeapon(ctx, art.weapon, art, p);
  ctx.restore();
}

// --- quadruped (hellhound) --------------------------------------------------
function drawBeast(ctx, art, p, view) {
  const ex = art.extras || {};
  const bodyC = col(art.body, 'base'), bodyD = col(art.body, 'dark');
  const bob = p.bob * 0.6;
  const back = view === 'back', side = view === 'side';
  const bodyY = -15 - bob;
  const swing = p.legA;

  // rear legs
  for (const s of [-1, 1]) {
    const sw = s > 0 ? swing : -swing;
    limb3(ctx, -8, bodyY + 2, -11 + Math.sin(sw) * 3, bodyY + 8, -10 + Math.sin(sw) * 8, -0.5, 4.2, s > 0 ? bodyC : shade(bodyC, -0.2));
  }
  // front legs
  for (const s of [-1, 1]) {
    const sw = s > 0 ? -swing : swing;
    limb3(ctx, 8, bodyY + 1, 10 + Math.sin(sw) * 3, bodyY + 7, 10 + Math.sin(sw) * 8, -0.5, 4.0, s > 0 ? bodyC : shade(bodyC, -0.2));
  }
  // tail
  limb3(ctx, -11, bodyY - 1, -18, bodyY - 6 - swing * 3, -22, bodyY + 2, 3.0, bodyD);
  // torso
  ctx.beginPath();
  ctx.moveTo(-12, bodyY + 3);
  ctx.quadraticCurveTo(-14, bodyY - 6, -4, bodyY - 7);
  ctx.quadraticCurveTo(6, bodyY - 8.5, 13, bodyY - 5);
  ctx.quadraticCurveTo(15, bodyY + 2, 9, bodyY + 4);
  ctx.quadraticCurveTo(0, bodyY + 6, -12, bodyY + 3);
  ctx.closePath();
  shape(ctx, bodyC, 2.3);
  // mane
  if (ex.mane) {
    for (let i = 0; i < 5; i++) {
      const t = i / 4, x = lerp(-4, 12, t), yy = bodyY - 7 - Math.sin(t * Math.PI) * 2;
      poly(ctx, [[x - 2.5, yy + 2], [x, yy - 7 - Math.sin(t * Math.PI) * 3], [x + 2.5, yy + 2]]);
      shape(ctx, ex.mane, 1.2);
    }
  }
  // head
  ctx.save();
  ctx.translate(15 + p.lunge, bodyY - 6);
  ctx.rotate(-0.12 + p.swing * 0.35);
  ctx.beginPath();
  ctx.moveTo(-5, -4); ctx.quadraticCurveTo(4, -6, 10, -1.5);
  ctx.quadraticCurveTo(12, 1, 8, 3.5); ctx.quadraticCurveTo(0, 6, -5, 4);
  ctx.closePath();
  shape(ctx, bodyC, 2.0);
  // jaw
  const jaw = Math.max(0, p.swing) * 4;
  ctx.save(); ctx.translate(0, 3); ctx.rotate(jaw * 0.09);
  poly(ctx, [[-4, 0], [9, -0.5], [7, 3.2], [-4, 3]]);
  shape(ctx, shade(bodyC, -0.2), 1.7);
  ctx.restore();
  for (let i = 0; i < 3; i++) { poly(ctx, [[3 + i * 2.4, 2.4], [4.2 + i * 2.4, 2.4], [3.6 + i * 2.4, 5.4]]); shape(ctx, '#f2ead6', 0.9); }
  // ears + eyes
  poly(ctx, [[-3, -4], [-1, -11], [2.5, -4.5]]); shape(ctx, bodyD, 1.5);
  if (!back && ex.eyes) glowDot(ctx, 3.5, -1.6, 3.2, ex.eyes);
  ctx.restore();
}

// --- machine (ballista) -----------------------------------------------------
function drawMachine(ctx, art, p, view) {
  const wood = art.body, metal = art.metal;
  const back = view === 'back';
  const y0 = -4;
  // wheels
  for (const s of [-1, 1]) {
    const wx = s * 9;
    ctx.beginPath(); ctx.arc(wx, y0, 7.5, 0, TAU);
    shape(ctx, col(wood, 'dark'), 2.2);
    ctx.beginPath(); ctx.arc(wx, y0, 3.2, 0, TAU); shape(ctx, col(metal, 'base'), 1.5);
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 4) + 0.3;
      limb(ctx, wx + Math.cos(a) * 2.6, y0 + Math.sin(a) * 2.6, wx + Math.cos(a) * 7, y0 + Math.sin(a) * 7, 1.4, col(wood, 'light'), false);
    }
  }
  // chassis
  poly(ctx, [[-13, y0 - 5], [13, y0 - 5], [11, y0 + 2], [-11, y0 + 2]]);
  shape(ctx, col(wood, 'base'), 2.2);
  // frame + arms
  ctx.save();
  ctx.translate(0, y0 - 6);
  ctx.rotate(-0.12 + p.swing * 0.12);
  poly(ctx, [[-3, 0], [3, 0], [2.4, -16], [-2.4, -16]]);
  shape(ctx, col(wood, 'light'), 2.0);
  ctx.translate(0, -14);
  for (const s of [-1, 1]) {
    limb(ctx, 0, 0, s * 14, -5 - Math.abs(p.swing) * 2, 3.2, col(wood, 'base'));
    ell(ctx, s * 14, -5, 2, 2); shape(ctx, col(metal, 'base'), 1.2);
  }
  const draw = clamp(0.5 - p.swing * 0.5, 0, 1);
  ctx.beginPath(); ctx.moveTo(-14, -5); ctx.lineTo(-draw * 8, 1.5); ctx.lineTo(14, -5);
  ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(240,236,220,0.85)'; ctx.stroke();
  if (p.swing < 0.5) {
    limb(ctx, -draw * 8, 1.5, 16, -3.5, 2.4, col(wood, 'light'));
    poly(ctx, [[16, -3.5], [22, -5.5], [16.5, -0.8]]); shape(ctx, col(metal, 'light'), 1.2);
  }
  ctx.restore();
}

// --- mounted (knight) -------------------------------------------------------
function drawMounted(ctx, art, p, view) {
  const horse = { base: '#4a4038', dark: '#251f1a', light: '#6d5f52' };
  const bob = p.bob * 0.5;
  const bodyY = -20 - bob;
  const swing = p.legA;
  for (const [s, ph] of [[-1, swing], [1, -swing]]) {
    const c = s > 0 ? col(horse, 'base') : shade(col(horse, 'base'), -0.25);
    limb3(ctx, -9, bodyY + 3, -12 + Math.sin(ph) * 3, bodyY + 10, -11 + Math.sin(ph) * 9, -0.5, 4.6, c);
    limb3(ctx, 9, bodyY + 2, 11 + Math.sin(-ph) * 3, bodyY + 9, 11 + Math.sin(-ph) * 9, -0.5, 4.4, c);
  }
  // horse body
  ctx.beginPath();
  ctx.moveTo(-14, bodyY + 4);
  ctx.quadraticCurveTo(-16, bodyY - 7, -5, bodyY - 8);
  ctx.quadraticCurveTo(7, bodyY - 10, 15, bodyY - 5);
  ctx.quadraticCurveTo(17, bodyY + 3, 10, bodyY + 5);
  ctx.quadraticCurveTo(0, bodyY + 7, -14, bodyY + 4);
  ctx.closePath();
  shape(ctx, col(horse, 'base'), 2.3);
  // caparison
  poly(ctx, [[-13, bodyY - 2], [5, bodyY - 4], [6, bodyY + 8], [-12, bodyY + 7]]);
  shape(ctx, art.teamColor || '#c2503c', 1.8);
  // tail + neck + head
  limb3(ctx, -14, bodyY - 2, -21, bodyY + 1, -19, bodyY + 9, 3.4, col(horse, 'dark'));
  limb3(ctx, 12, bodyY - 6, 19, bodyY - 12, 21, bodyY - 16, 6.0, col(horse, 'base'));
  ctx.save(); ctx.translate(21, bodyY - 17); ctx.rotate(-0.5);
  poly(ctx, [[-4, -3], [7, -1.5], [7.5, 2], [-4, 4]]); shape(ctx, col(horse, 'base'), 1.8);
  poly(ctx, [[-3, -3], [-1.5, -8], [1, -3]]); shape(ctx, col(horse, 'dark'), 1.3);
  ctx.restore();
  // rider
  ctx.save();
  ctx.translate(-1, bodyY - 6);
  const rp = { ...p, bob: 0, legA: 0.35, legB: 0.35, lunge: p.lunge };
  const riderArt = { ...art, build: 'heavy', extras: { ...art.extras, mounted: false } };
  ctx.save(); ctx.scale(0.92, 0.92);
  drawRiderTorso(ctx, riderArt, rp, view);
  ctx.restore();
  ctx.restore();
}

function drawRiderTorso(ctx, art, p, view) {
  const m = BUILDS.heavy;
  const shY = -m.torso;
  // legs bent over the saddle
  for (const s of [-1, 1]) {
    limb3(ctx, s * 3, 0, s * 7, 6, s * 5, 12, m.limbW * 0.9, col(art.legs, 'base'));
  }
  if (art.extras?.cape) {
    ctx.beginPath();
    ctx.moveTo(-m.sh * 0.5, shY + 1);
    ctx.quadraticCurveTo(-m.sh * 1.3, 6, -m.sh * 0.7, 14);
    ctx.lineTo(m.sh * 0.6, 14);
    ctx.quadraticCurveTo(m.sh * 1.1, 4, m.sh * 0.5, shY + 1);
    ctx.closePath();
    shape(ctx, art.teamColor || '#c2503c', 2.0);
  }
  const offA = p.armOff;
  const ohx = -m.sh * 0.5 + Math.sin(offA) * 10, ohy = shY + 4 + Math.cos(offA) * 9;
  limb3(ctx, -m.sh * 0.5, shY + 1, -m.sh * 0.6, shY + 7, ohx, ohy, m.armW, shade(col(art.body, 'base'), -0.2));
  ctx.save(); ctx.translate(ohx - 1, ohy); ctx.rotate(-0.15);
  poly(ctx, [[-6, -7.5], [6, -7.5], [6, 3], [0, 9], [-6, 3]]);
  shape(ctx, col(art.metal, 'base'), 2.0);
  poly(ctx, [[-4, -5], [4, -5], [4, 2], [0, 6], [-4, 2]]);
  shape(ctx, art.teamColor || col(art.trim, 'base'), 0);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(-m.sh * 0.5, shY); ctx.quadraticCurveTo(-m.sh * 0.6, shY + m.torso * 0.6, -m.hipW * 0.5, 1);
  ctx.lineTo(m.hipW * 0.5, 1);
  ctx.quadraticCurveTo(m.sh * 0.6, shY + m.torso * 0.6, m.sh * 0.5, shY);
  ctx.quadraticCurveTo(0, shY - 3, -m.sh * 0.5, shY);
  ctx.closePath();
  shape(ctx, col(art.body, 'base'), 2.3);
  poly(ctx, [[-m.sh * 0.24, shY + 2], [m.sh * 0.24, shY + 2], [m.sh * 0.28, 0], [0, 3], [-m.sh * 0.28, 0]]);
  shape(ctx, art.teamColor || col(art.trim, 'base'), 1.5);
  for (const s of [-1, 1]) { ell(ctx, s * m.sh * 0.52, shY + 2, m.sh * 0.3, m.sh * 0.22); shape(ctx, col(art.metal, 'light'), 2.0); }
  ctx.save(); ctx.translate(0, shY - m.head * 0.85);
  drawHead(ctx, art.head, art, m, view, null);
  ctx.restore();
  const ma = p.armMain;
  const mhx = m.sh * 0.5 + Math.sin(ma) * 10, mhy = shY + 4 + Math.cos(ma) * 9;
  limb3(ctx, m.sh * 0.5, shY + 1, m.sh * 0.6, shY + 7, mhx, mhy, m.armW, col(art.body, 'base'));
  ctx.save(); ctx.translate(mhx, mhy); ctx.rotate(ma + 0.9 + p.swing * 0.3);
  drawWeapon(ctx, art.weapon, art, p);
  ctx.restore();
}

// --- entry point ------------------------------------------------------------
/**
 * Draw one unit frame. The caller has already translated so that (0,0) is the
 * unit's ground anchor and applied the sprite scale.
 */
export function drawUnitFrame(ctx, type, teamColor, anim, t, view) {
  const base = UNIT_ART[type];
  if (!base) return;
  const art = { ...base, teamColor };
  const p = solvePose(anim, t, art.build);
  ctx.save();
  ctx.scale(art.scale, art.scale);
  if (art.build === 'beast') drawBeast(ctx, art, p, view);
  else if (art.build === 'machine') drawMachine(ctx, art, p, view);
  else if (art.extras?.mounted) drawMounted(ctx, art, p, view);
  else drawBiped(ctx, art, p, view);
  ctx.restore();
}

/** Rough sprite footprint per unit, used to size the bake canvas. */
export function unitSpriteBox(type) {
  const art = UNIT_ART[type];
  const s = art ? art.scale : 1;
  const tall = art && (art.build === 'huge' || art.extras?.mounted);
  return {
    w: Math.ceil(76 * s + (tall ? 20 : 0)),
    h: Math.ceil(78 * s + (tall ? 22 : 0)),
    anchorY: Math.ceil(56 * s + (tall ? 16 : 0)),
  };
}
