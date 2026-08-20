// ============================================================================
// Emberfall — entry point. Owns the menus, the match lifecycle and the frame
// loop, and wires raw input to game commands.
// ============================================================================

import { Game } from './game/game.js';
import { Renderer } from './engine/renderer.js';
import { Camera } from './engine/camera.js';
import { Input } from './engine/input.js';
import { Fog } from './engine/fog.js';
import { Hud } from './ui/hud.js';
import { Minimap } from './ui/minimap.js';
import { Sfx } from './audio/sfx.js';
import { bakeAll, loadOverrides, overrideCount, setUseOverrides, getUseOverrides, hasGeneratedArt } from './art/assets.js';
import { drawCrest } from './art/icons.js';
import { FACTIONS, UNITS, BUILDINGS, TILE } from './game/defs.js';
import { clamp, dist } from './core/util.js';

// ---------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const refs = {
  canvas: $('#game'),
  loading: $('#loading'),
  loadFill: $('#loadfill'),
  loadText: $('#loadtext'),
  menu: $('#menu'),
  help: $('#help'),
  hud: $('#hud'),
  result: $('#result'),
  pause: $('#pause'),
  gold: $('#res-gold'),
  wood: $('#res-wood'),
  supply: $('#res-supply'),
  clock: $('#res-clock'),
  alerts: $('#alerts'),
  info: $('#selinfo'),
  card: $('#commandcard'),
  tooltip: $('#tooltip'),
  minimap: $('#minimap'),
};

const settings = {
  faction: 'human',
  difficulty: 'normal',
  mapSize: 'medium',
  startRes: 'normal',
  art: 'generated',      // 'generated' = AI-painted PNGs, 'procedural' = vector rigs
};

const sfx = new Sfx();
let session = null;
let rafId = 0;

// ---------------------------------------------------------------------------
//  MENU
// ---------------------------------------------------------------------------
function initMenu() {
  document.querySelectorAll('.fcard').forEach((card) => {
    const fac = card.dataset.faction;
    const cv = card.querySelector('.fcrest');
    drawCrest(cv.getContext('2d'), 160, fac);
    card.addEventListener('click', () => {
      settings.faction = fac;
      document.querySelectorAll('.fcard').forEach((c) => c.setAttribute('aria-pressed', String(c === card)));
      document.body.dataset.faction = fac;
      sfx.click();
    });
  });
  document.body.dataset.faction = settings.faction;

  const seg = (id, key) => {
    $(id).querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        settings[key] = b.dataset.v;
        $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        sfx.click();
      });
    });
  };
  seg('#opt-diff', 'difficulty');
  seg('#opt-map', 'mapSize');
  seg('#opt-start', 'startRes');
  seg('#opt-art', 'art');

  $('#btn-play').addEventListener('click', () => { sfx.ensure(); sfx.click(); startMatch(); });
  $('#btn-help').addEventListener('click', () => { refs.help.classList.remove('hidden'); sfx.click(); });
  $('#btn-help-close').addEventListener('click', () => { refs.help.classList.add('hidden'); sfx.click(); });
  $('#btn-again').addEventListener('click', () => { refs.result.classList.add('hidden'); startMatch(); });
  $('#btn-tomenu').addEventListener('click', () => { refs.result.classList.add('hidden'); toMenu(); });
  $('#btn-menu').addEventListener('click', () => togglePause(true));
  $('#btn-resume').addEventListener('click', () => togglePause(false));
  $('#btn-restart').addEventListener('click', () => { togglePause(false); startMatch(); });
  $('#btn-quit').addEventListener('click', () => { togglePause(false); toMenu(); });

  $('#tt-mode').addEventListener('click', (e) => {
    if (!session) return;
    const next = session.input.mode === 'select' ? 'pan' : 'select';
    session.input.setMode(next);
    e.currentTarget.textContent = next === 'pan' ? '✋' : '⬚';
    e.currentTarget.classList.toggle('on', next === 'pan');
    e.currentTarget.title = next === 'pan' ? 'One finger pans' : 'One finger selects';
    sfx.click();
  });
  $('#tt-idle').addEventListener('click', () => session && cycleIdleWorker());
  $('#tt-base').addEventListener('click', () => {
    if (!session) return;
    session.camera.moveTo(session.game.homePoint.x, session.game.homePoint.y);
    sfx.click();
  });
  $('#tt-art').addEventListener('click', () => toggleArt());
}

/**
 * Flip between the AI-painted PNGs and the procedural vector sprites. Both sets
 * are already in memory, so this is instant; the terrain chunk cache is dropped
 * because props are painted into it.
 */
function toggleArt(force) {
  if (!hasGeneratedArt()) return;
  const on = force !== undefined ? force : !getUseOverrides();
  setUseOverrides(on);
  settings.art = on ? 'generated' : 'procedural';
  const btn = $('#tt-art');
  btn.classList.toggle('on', on);
  btn.title = `Artwork: ${on ? 'painted' : 'vector'} (V)`;
  if (session) {
    session.renderer.chunks.clear();
    session.game.world.chunkDirty.fill(1);
    session.hud.sig = '';              // command-card icons may have changed
    session.hud.alert(`Artwork: ${on ? 'painted' : 'vector'}`, '');
  }
  document.querySelectorAll('#opt-art button').forEach((b) =>
    b.classList.toggle('on', b.dataset.v === settings.art));
  sfx.click();
}

function toMenu() {
  cancelAnimationFrame(rafId);
  session = null;
  refs.hud.classList.add('hidden');
  refs.menu.classList.remove('hidden');
  refs.canvas.style.cursor = '';
}

function togglePause(on) {
  if (!session) return;
  session.game.paused = on;
  refs.pause.classList.toggle('hidden', !on);
  sfx.click();
}

// ---------------------------------------------------------------------------
//  MATCH LIFECYCLE
// ---------------------------------------------------------------------------
async function startMatch() {
  cancelAnimationFrame(rafId);
  refs.menu.classList.add('hidden');
  refs.result.classList.add('hidden');
  refs.pause.classList.add('hidden');
  refs.loading.classList.remove('hidden');
  setProgress(0.02, 'Reading the auguries…');

  const enemyFaction = settings.faction === 'human' ? 'demon' : 'human';
  const factions = [settings.faction, enemyFaction];
  const colors = factions.map((f) => FACTIONS[f].color);
  document.body.dataset.faction = settings.faction;

  const painted = hasGeneratedArt();
  await new Promise((r) => requestAnimationFrame(r));

  await bakeAll(factions, colors, (p, label) => setProgress(0.1 + p * 0.78, label + '…'));

  setProgress(0.9, 'Raising the standards…');
  await new Promise((r) => requestAnimationFrame(r));

  const game = new Game({
    factions, colors,
    difficulty: settings.difficulty,
    mapSize: settings.mapSize,
    startRes: settings.startRes,
    seed: (Math.random() * 65535) | 0,
  });

  const camera = new Camera(game.world, refs.canvas);
  const renderer = new Renderer(refs.canvas, game);
  const hud = new Hud(game, refs);
  const minimap = new Minimap(refs.minimap, game, camera);

  const input = new Input(refs.canvas, camera, makeHandlers(() => session));

  session = {
    game, camera, renderer, hud, minimap, input,
    lastT: performance.now(), groups: new Map(), lastClick: { t: 0, id: -1 },
  };

  game.sfx = sfx;
  game.cameraShake = (a) => camera.addShake(a);
  game.onAlert = (text, tone) => { hud.alert(text, tone); if (tone === 'bad') sfx.alarm(); };
  game.onDeposit = () => sfx.coin();
  game.onSound = (name, x, y) => playPositional(name, x, y);
  game.onOver = (res) => showResult(res);

  camera.moveTo(game.homePoint.x, game.homePoint.y);
  camera.setZoom(1.15);

  setProgress(1, 'To arms.');
  await new Promise((r) => setTimeout(r, 240));
  refs.loading.classList.add('hidden');
  refs.hud.classList.remove('hidden');
  hud.rebuild();
  if (painted) {
    toggleArt(settings.art === 'generated');
    hud.alert(`${overrideCount()} painted assets — press V to compare`, 'good');
  }

  session.lastT = performance.now();
  rafId = requestAnimationFrame(frame);
}

function setProgress(p, label) {
  refs.loadFill.style.width = `${clamp(p, 0, 1) * 100}%`;
  if (label) refs.loadText.textContent = label;
}

function showResult(res) {
  const g = session.game;
  const p = g.players[0];
  refs.result.classList.remove('hidden');
  const title = $('#result-title');
  title.textContent = res === 'win' ? 'Victory' : 'Defeat';
  title.className = `result-title ${res === 'win' ? 'win' : 'lose'}`;
  $('#result-sub').textContent = res === 'win'
    ? `${FACTIONS[p.faction].name} holds the field.`
    : `${FACTIONS[p.faction].name} is broken. The banner falls.`;
  const woodName = FACTIONS[p.faction].woodName;
  $('#result-stats').innerHTML = [
    ['Duration', fmt(g.time)],
    ['Gold mined', Math.round(p.stats.gathered).toLocaleString()],
    [woodName, Math.round(p.stats.gatheredWood).toLocaleString()],
    ['Kills', p.stats.killed],
    ['Losses', p.stats.lost],
    ['Structures', p.stats.built],
  ].map(([k, v]) => `<div class="rstat"><b>${v}</b><span>${k}</span></div>`).join('');
  if (res === 'win') sfx.victory(); else sfx.defeat();
}

function fmt(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function playPositional(name, x, y) {
  if (!session) return;
  const cam = session.camera;
  const b = cam.bounds(200);
  if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return;
  if (!session.game.fog.isVisible(x, y)) return;
  if (name === 'death') sfx.death(false);
  else if (name === 'deathDemon') sfx.death(true);
  else sfx[name]?.();
}

// ---------------------------------------------------------------------------
//  INPUT HANDLERS
// ---------------------------------------------------------------------------
function makeHandlers(get) {
  return {
    onClick(sx, sy, additive) {
      const s = get(); if (!s) return;
      const w = s.camera.screenToWorld(sx, sy);
      if (s.hud.placement) { tryPlace(s, w.x, w.y); return; }
      if (s.hud.armed) { s.hud.consumeGroundClick(w.x, w.y, additive); sfx.command(); return; }
      selectAt(s, w.x, w.y, additive, sx, sy);
    },

    onTap(sx, sy, additive) {
      const s = get(); if (!s) return;
      const w = s.camera.screenToWorld(sx, sy);
      if (s.hud.placement) { tryPlace(s, w.x, w.y); return; }
      if (s.hud.armed) { s.hud.consumeGroundClick(w.x, w.y, additive); sfx.command(); return; }
      const hit = s.game.entityAtPoint(w.x, w.y);
      const mine = s.game.selection.filter((e) => e.owner === s.game.me && e.kind === 'unit');
      const tappedOwn = hit && hit.owner === s.game.me;
      if (mine.length && !tappedOwn) {
        s.game.smartCommand(mine, w.x, w.y, additive);
        sfx.command();
        return;
      }
      selectAt(s, w.x, w.y, additive, sx, sy);
    },

    onBoxSelect(box, additive) {
      const s = get(); if (!s) return;
      const a = s.camera.screenToWorld(box.x, box.y);
      const b = s.camera.screenToWorld(box.x + box.w, box.y + box.h);
      const g = s.game;
      let picked = g.unitsInRect(a.x, a.y, b.x, b.y, g.me);
      if (!picked.length) {
        // fall back to any structure the box touches
        picked = g.world.entities.filter((e) => !e.dead && e.kind === 'building' && e.owner === g.me
          && e.x > a.x && e.x < b.x && e.y > a.y && e.y < b.y);
      }
      if (!picked.length) {
        picked = g.world.entities.filter((e) => !e.dead && e.kind === 'unit' && g.fog.areaVisible(e)
          && e.x > a.x && e.x < b.x && e.y > a.y && e.y < b.y);
        if (picked.length > 1) picked = picked.slice(0, 1);
      }
      // Prefer fighting units over workers when the box grabs both.
      const fighters = picked.filter((e) => e.kind === 'unit' && !UNITS[e.type]?.worker);
      if (fighters.length && picked.some((e) => UNITS[e.type]?.worker)) picked = fighters;
      setSelection(s, picked, additive);
    },

    onCommand(sx, sy, mods) {
      const s = get(); if (!s) return;
      if (s.hud.placement) { s.hud.cancelPlacement(); return; }
      if (s.hud.armed) { s.hud.clearArmed(); return; }
      const w = s.camera.screenToWorld(sx, sy);
      const g = s.game;
      const mineUnits = g.selection.filter((e) => e.owner === g.me && e.kind === 'unit');
      const mineBuildings = g.selection.filter((e) => e.owner === g.me && e.kind === 'building');
      if (mineUnits.length) { g.smartCommand(mineUnits, w.x, w.y, mods.queue); sfx.command(); }
      else if (mineBuildings.length) { g.setRally(mineBuildings, w.x, w.y); sfx.click(); }
    },

    onHover(sx, sy) {
      const s = get(); if (!s) return;
      const w = s.camera.screenToWorld(sx, sy);
      s.renderer.hovered = s.game.entityAtPoint(w.x, w.y);
    },

    onKey(k, mods) {
      const s = get(); if (!s) return false;
      return handleKey(s, k, mods);
    },
  };
}

function setSelection(s, list, additive) {
  const g = s.game;
  if (additive) {
    const set = new Set(g.selection);
    for (const e of list) set.has(e) ? set.delete(e) : set.add(e);
    g.selection = [...set];
  } else {
    g.selection = list;
  }
  g.selection = g.selection.filter((e) => !e.dead);
  if (g.selection.length) sfx.select();
  s.hud.submenu = null;
  s.hud.sig = '';
}

function selectAt(s, wx, wy, additive, sx, sy) {
  const g = s.game;
  let hit = g.entityAtPoint(wx, wy, g.me) || g.entityAtPoint(wx, wy);
  const now = performance.now();
  if (hit && hit.kind === 'unit' && hit.owner === g.me
      && s.lastClick.id === hit.id && now - s.lastClick.t < 380) {
    // double click: grab every visible unit of the same type
    const b = s.camera.bounds(0);
    const same = g.world.entities.filter((e) => !e.dead && e.kind === 'unit' && e.owner === g.me
      && e.type === hit.type && e.x > b.x0 && e.x < b.x1 && e.y > b.y0 && e.y < b.y1);
    setSelection(s, same, false);
    s.lastClick = { t: 0, id: -1 };
    return;
  }
  s.lastClick = { t: now, id: hit ? hit.id : -1 };
  setSelection(s, hit ? [hit] : [], additive);
}

function tryPlace(s, wx, wy) {
  const g = s.game;
  const pl = s.hud.placement;
  const bd = BUILDINGS[pl.type];
  const tx = Math.floor(wx / TILE) - ((bd.size / 2) | 0);
  const ty = Math.floor(wy / TILE) - ((bd.size / 2) | 0);
  const workers = pl.workers.filter((u) => !u.dead);
  const b = g.placeBuilding(pl.type, tx, ty, workers);
  if (b) {
    sfx.build();
    s.hud.cancelPlacement();
    s.hud.submenu = null;
    s.hud.sig = '';
  } else {
    sfx.deny();
  }
}

function cycleIdleWorker() {
  const s = session;
  const idle = s.game.idleWorkers();
  if (!idle.length) { s.hud.alert('No idle workers', ''); return; }
  s.idleIdx = ((s.idleIdx ?? -1) + 1) % idle.length;
  const u = idle[s.idleIdx];
  setSelection(s, [u], false);
  s.camera.moveTo(u.x, u.y);
}

function handleKey(s, k, mods) {
  const g = s.game;
  if (k === 'escape') {
    if (s.hud.handleKey(k, mods)) return true;
    togglePause(!g.paused);
    return true;
  }
  if (g.paused) return false;

  if (k >= '1' && k <= '9') {
    const n = k;
    if (mods.ctrl) {
      s.groups.set(n, g.selection.filter((e) => !e.dead));
      s.hud.alert(`Group ${n} set`, '');
    } else {
      const grp = (s.groups.get(n) || []).filter((e) => !e.dead);
      if (grp.length) {
        setSelection(s, grp, false);
        const now = performance.now();
        if (s.lastGroup === n && now - (s.lastGroupT || 0) < 380) {
          s.camera.moveTo(grp[0].x, grp[0].y);
        }
        s.lastGroup = n; s.lastGroupT = now;
      }
    }
    return true;
  }

  switch (k) {
    case ' ':
      s.camera.moveTo(g.homePoint.x, g.homePoint.y);
      return true;
    case 'tab':
      cycleIdleWorker();
      return true;
    case 'f':
      if (mods.ctrl) return false;
      break;
    case 'v':
      toggleArt(); return true;
    case '[':
      s.camera.setZoom(s.camera.zoom * 0.86); return true;
    case ']':
      s.camera.setZoom(s.camera.zoom * 1.16); return true;
    default: break;
  }
  return s.hud.handleKey(k, mods);
}

// ---------------------------------------------------------------------------
//  FRAME
// ---------------------------------------------------------------------------
function frame(now) {
  rafId = requestAnimationFrame(frame);
  const s = session;
  if (!s) return;
  const dt = Math.min(0.05, (now - s.lastT) / 1000);
  s.lastT = now;

  s.input.update(dt);
  s.camera.update(dt);
  s.game.update(dt);

  // keep the building ghost under the pointer
  if (s.hud.placement) {
    const m = s.input.mouse;
    const w = s.camera.screenToWorld(m.x, m.y);
    const bd = BUILDINGS[s.hud.placement.type];
    const tx = Math.floor(w.x / TILE) - ((bd.size / 2) | 0);
    const ty = Math.floor(w.y / TILE) - ((bd.size / 2) | 0);
    s.renderer.placement = { type: s.hud.placement.type, tx, ty, ok: s.game.canPlace(s.hud.placement.type, tx, ty).ok };
  } else {
    s.renderer.placement = null;
  }
  s.renderer.selectBox = s.input.box && s.input.box.active ? s.input.normBox(s.input.box) : null;

  s.renderer.render(s.camera, dt);
  s.minimap.render(dt);
  s.hud.update(dt);
}

// ---------------------------------------------------------------------------
window.addEventListener('resize', () => { if (session) session.renderer.resize(); });
document.addEventListener('visibilitychange', () => { if (session) session.lastT = performance.now(); });

// ---------------------------------------------------------------------------
//  BOOT
// ---------------------------------------------------------------------------
async function boot() {
  initMenu();
  refs.loading.classList.remove('hidden');
  setProgress(0.3, 'Unrolling painted banners…');
  // Generated PNGs are optional; a missing manifest is a silent no-op and the
  // game runs entirely on its procedural sprites.
  await loadOverrides((p) => setProgress(0.3 + p * 0.6, 'Unrolling painted banners…'));
  const painted = hasGeneratedArt();
  $('#opt-art-wrap').hidden = !painted;
  $('#tt-art').hidden = !painted;
  if (!painted) settings.art = 'procedural';
  setUseOverrides(painted);
  setProgress(1, '');
  refs.loading.classList.add('hidden');
  refs.menu.classList.remove('hidden');
}

boot();
