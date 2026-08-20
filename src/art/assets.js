// ============================================================================
// The asset baker.
//
// Everything the game draws is pre-rendered once into offscreen canvases here:
// unit animation frames (3 views x 11 frames, mirrored at draw time for the
// other 5 facings), structures at several construction stages, props and every
// interface icon. The game loop then only ever blits.
//
// If assets/manifest.json exists, any PNG it points at REPLACES the matching
// baked sprite — that is the hand-off point for tools/gen-assets.mjs (GPT
// Image 2). Nothing else in the codebase needs to know which is which.
// ============================================================================

import { TAU, makeCanvas } from '../core/util.js';
import { drawUnitFrame, unitSpriteBox } from './units.js';
import { drawBuildingFrame, drawConstruction, buildingSpriteBox } from './buildings.js';
import { drawTree, drawStump, drawBrimstone, drawGoldMine } from './props.js';
import { drawUnitIcon, drawBuildingIcon, drawUpgradeIcon, drawCommandIcon } from './icons.js';
import { UNITS, BUILDINGS, UPGRADES, FACTIONS, RESOURCES, TILE } from '../game/defs.js';

export const WALK_FRAMES = 6;
export const ATTACK_FRAMES = 4;
export const VIEWS = ['front', 'side', 'back'];
export const ICON_SIZE = 96;

// When false, generated PNGs are ignored and the procedural sprites are used
// even if the manifest loaded. Both live in memory at once, so this flips
// instantly at runtime — no re-bake, no reload.
let useOverrides = true;

const store = {
  units: new Map(),      // `${type}|${color}` -> { views, w, h, ax, ay }
  buildings: new Map(),  // `${type}|${color}` -> { done, stages:[], w, h, ax, ay }
  props: new Map(),      // key -> canvas
  icons: new Map(),      // key -> canvas
  overrides: new Map(),  // key -> HTMLImageElement
};

// --- shared lighting --------------------------------------------------------
function lightPass(ctx, w, h) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,246,224,0.19)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  g.addColorStop(1, 'rgba(12,16,32,0.30)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const r = ctx.createRadialGradient(w * 0.26, h * 0.12, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.8);
  r.addColorStop(0, 'rgba(196,222,255,0.20)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// --- facing helper ----------------------------------------------------------
/** Map a heading (radians, screen space) to a baked view plus mirroring. */
export function viewForAngle(a) {
  let d = a % TAU; if (d < 0) d += TAU;
  const sector = Math.round(d / (TAU / 8)) % 8;   // 0 = east, going clockwise
  switch (sector) {
    case 0: return { view: 'side', flip: false };
    case 1: return { view: 'front', flip: false };
    case 2: return { view: 'front', flip: false };
    case 3: return { view: 'front', flip: true };
    case 4: return { view: 'side', flip: true };
    case 5: return { view: 'back', flip: true };
    case 6: return { view: 'back', flip: false };
    default: return { view: 'back', flip: false };
  }
}

// --- bakers -----------------------------------------------------------------
function bakeUnit(type, teamColor) {
  const box = unitSpriteBox(type);
  const w = box.w, h = box.h, ax = w / 2, ay = box.anchorY;
  const views = {};
  for (const view of VIEWS) {
    const anims = { idle: [], walk: [], attack: [] };
    const frames = [['idle', 1], ['walk', WALK_FRAMES], ['attack', ATTACK_FRAMES]];
    for (const [anim, n] of frames) {
      for (let i = 0; i < n; i++) {
        const c = makeCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.translate(ax, ay);
        drawUnitFrame(ctx, type, teamColor, anim, n === 1 ? 0 : i / n, view);
        lightPass(ctx, w, h);
        anims[anim].push(c);
      }
    }
    views[view] = anims;
  }
  return { views, w, h, ax, ay };
}

function bakeBuilding(type, teamColor) {
  const box = buildingSpriteBox(type);
  const w = box.w, h = box.h, ax = w / 2, ay = box.anchorY;
  const demonic = BUILDINGS[type].faction === 'demon';
  const render = (fn) => {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.translate(ax, ay);
    fn(ctx);
    lightPass(ctx, w, h);
    return c;
  };
  const done = render((ctx) => drawBuildingFrame(ctx, type, teamColor));
  const stages = [];
  for (let i = 0; i < 4; i++) {
    const p = (i + 0.35) / 4;
    stages.push(render((ctx) => drawConstruction(ctx, type, teamColor, p, demonic)));
  }
  // Rubble left behind on death.
  const rubble = render((ctx) => {
    const fp = BUILDINGS[type].size * TILE;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = demonic ? 'rgba(30,14,20,0.8)' : 'rgba(48,42,34,0.75)';
    ctx.beginPath(); ctx.ellipse(0, 0, fp * 0.44, fp * 0.3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = demonic ? '#3a2030' : '#6a6153';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + i, r = fp * (0.1 + (i % 3) * 0.1);
      ctx.save();
      ctx.translate(Math.cos(a) * r, Math.sin(a) * r * 0.6);
      ctx.rotate(a);
      ctx.fillRect(-fp * 0.06, -fp * 0.03, fp * 0.12, fp * 0.06);
      ctx.restore();
    }
  });
  return { done, stages, rubble, w, h, ax, ay };
}

function bakeProps() {
  for (let v = 0; v < 3; v++) {
    const c = makeCanvas(56, 60);
    const ctx = c.getContext('2d');
    ctx.translate(28, 50);
    drawTree(ctx, v, v * 13 + 5, 1.15);
    lightPass(ctx, 56, 60);
    store.props.set(`tree.${v}`, { canvas: c, ax: 28, ay: 50 });
  }
  {
    const c = makeCanvas(28, 24); const ctx = c.getContext('2d');
    ctx.translate(14, 18); drawStump(ctx, 3); lightPass(ctx, 28, 24);
    store.props.set('stump', { canvas: c, ax: 14, ay: 18 });
  }
  for (let v = 0; v < 3; v++) {
    const c = makeCanvas(56, 56);
    const ctx = c.getContext('2d');
    ctx.translate(28, 46);
    drawBrimstone(ctx, v, v * 29 + 7, 1.1);
    lightPass(ctx, 56, 56);
    store.props.set(`brimstone.${v}`, { canvas: c, ax: 28, ay: 46 });
  }
  for (const [key, depleted] of [['goldmine', false], ['goldmine.spent', true]]) {
    const fp = RESOURCES.goldmine.size * TILE;
    const w = Math.ceil(fp * 1.5), h = Math.ceil(fp * 1.5);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.translate(w / 2, h * 0.62);
    drawGoldMine(ctx, fp, depleted);
    lightPass(ctx, w, h);
    store.props.set(key, { canvas: c, ax: w / 2, ay: h * 0.62 });
  }
}

function bakeIcon(key, drawFn) {
  const c = makeCanvas(ICON_SIZE, ICON_SIZE);
  drawFn(c.getContext('2d'), ICON_SIZE);
  store.icons.set(key, c);
}

// --- public API -------------------------------------------------------------
export function getUnitSprites(type, teamColor) {
  const key = `${type}|${teamColor}`;
  let s = store.units.get(key);
  if (!s) { s = bakeUnit(type, teamColor); store.units.set(key, s); }
  return s;
}

export function getBuildingSprites(type, teamColor) {
  const key = `${type}|${teamColor}`;
  let s = store.buildings.get(key);
  if (!s) { s = bakeBuilding(type, teamColor); store.buildings.set(key, s); }
  // A generated PNG replaces the finished look only; construction stages and
  // rubble stay procedural so they always match the footprint exactly.
  // Looked up fresh rather than cached on the sprite: a sprite may be baked
  // before the manifest finishes loading, and a cached miss would be permanent.
  s.override = useOverrides ? (store.overrides.get(`building.${type}`) || null) : null;
  return s;
}

export function getProp(key) {
  const base = store.props.get(key);
  if (!base) return base;
  base.override = useOverrides ? (store.overrides.get(`prop.${key}`) || null) : null;
  return base;
}

/**
 * Generated art follows one convention: the subject fills the frame
 * horizontally and its base rests on the bottom edge. Given a desired ground
 * width, this returns where to blit it so it lands on the ground anchor.
 *
 * `maxHeight` matters for tall, narrow subjects. A guard tower comes back as a
 * portrait image; scaling it by width alone makes it four times its footprint
 * tall, so it looms over the town hall and covers the units behind it. When the
 * cap bites, the sprite is scaled down as a whole and stays centred on its
 * footprint.
 */
export function fitOverride(img, groundX, groundY, targetWidth, maxHeight = Infinity) {
  let dw = targetWidth;
  let dh = dw * (img.height / img.width);
  if (dh > maxHeight) {
    const k = maxHeight / dh;
    dh = maxHeight;
    dw *= k;
  }
  return { x: groundX - dw / 2, y: groundY - dh, w: dw, h: dh };
}

export function getIcon(key) {
  if (useOverrides) {
    const ov = store.overrides.get(`icon.${key}`);
    if (ov) return ov;
  }
  return store.icons.get(key);
}

/** Switch between generated PNGs and the procedural sprites. */
export function setUseOverrides(on) { useOverrides = !!on; }
export function getUseOverrides() { return useOverrides; }
/** True when at least one generated asset actually loaded. */
export function hasGeneratedArt() { return store.overrides.size > 0; }

export function hasIcon(key) { return store.icons.has(key) || store.overrides.has(`icon.${key}`); }

// --- boot -------------------------------------------------------------------
/**
 * Bake everything for one match. Returns a promise; onProgress(0..1, label)
 * fires between chunks so the loading bar can breathe.
 */
export async function bakeAll(factions, colors, onProgress = () => {}) {
  const tasks = [];

  tasks.push(['Cutting timber and stone', () => bakeProps()]);

  const seen = new Set();
  factions.forEach((fac, i) => {
    const color = colors[i];
    if (seen.has(`${fac}|${color}`)) return;
    seen.add(`${fac}|${color}`);
    for (const u of Object.values(UNITS)) {
      if (u.faction !== fac) continue;
      tasks.push([`Mustering ${u.name.toLowerCase()}s`, () => getUnitSprites(u.id, color)]);
    }
    for (const b of Object.values(BUILDINGS)) {
      if (b.faction !== fac) continue;
      tasks.push([`Raising the ${b.name.toLowerCase()}`, () => getBuildingSprites(b.id, color)]);
    }
  });

  // Icons for both factions' full rosters plus commands (cheap, always baked).
  tasks.push(['Illuminating the banners', () => {
    for (const u of Object.values(UNITS)) {
      const c = FACTIONS[u.faction].color;
      bakeIcon(`unit.${u.id}`, (ctx, s) => drawUnitIcon(ctx, s, u.id, c));
    }
  }]);
  tasks.push(['Illuminating the banners', () => {
    for (const b of Object.values(BUILDINGS)) {
      const c = FACTIONS[b.faction].color;
      bakeIcon(`building.${b.id}`, (ctx, s) => drawBuildingIcon(ctx, s, b.id, c));
    }
    for (const up of Object.values(UPGRADES)) {
      bakeIcon(`upgrade.${up.id}`, (ctx, s) => drawUpgradeIcon(ctx, s, up.id, FACTIONS[up.faction].color));
    }
    for (const cmd of ['move', 'stop', 'hold', 'attack', 'patrol', 'build', 'repair', 'gather', 'cancel', 'rally', 'back']) {
      bakeIcon(`cmd.${cmd}`, (ctx, s) => drawCommandIcon(ctx, s, cmd));
    }
  }]);

  for (let i = 0; i < tasks.length; i++) {
    const [label, fn] = tasks[i];
    fn();
    onProgress((i + 1) / tasks.length, label);
    if (i % 3 === 2) await new Promise((r) => requestAnimationFrame(r));
  }
}

/**
 * Load PNG overrides produced by tools/gen-assets.mjs. Silent no-op when the
 * manifest is absent, which is the default state of a fresh checkout.
 */
export async function loadOverrides(onProgress = () => {}) {
  let manifest;
  try {
    const res = await fetch('assets/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return 0;
    manifest = await res.json();
  } catch { return 0; }
  const entries = Object.entries(manifest.assets || {});
  if (!entries.length) return 0;
  let done = 0;
  await Promise.all(entries.map(([key, rec]) => new Promise((resolve) => {
    const file = typeof rec === 'string' ? rec : rec.file;
    if (!file) { resolve(); return; }
    const img = new Image();
    img.onload = () => { store.overrides.set(key, img); done++; onProgress(done / entries.length, key); resolve(); };
    img.onerror = () => resolve();
    img.src = `assets/${file}`;
  })));
  return done;
}

export function overrideCount() { return store.overrides.size; }
