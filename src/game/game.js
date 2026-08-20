// ============================================================================
// The simulation.
//
// One Game owns a World, a list of players, the pathfinder, fog, effects and
// every rule that moves a unit, spends a coin or ends the match. The renderer
// and the HUD read from it; they never write to it except through the command
// methods at the bottom of this file.
// ============================================================================

import {
  TILE, UNITS, BUILDINGS, UPGRADES, RESOURCES, FACTIONS, STARTING_RESOURCES,
  DIFFICULTY, SUPPLY_CAP, BUILD_ORDER,
} from './defs.js';
import { World } from './world.js';
import { Pathfinder } from '../engine/pathfinder.js';
import { Fog } from '../engine/fog.js';
import { Effects } from './effects.js';
import { statsOf, healPowerOf, maxHpOf, regenOf, computeDamage, rangePx, isEnemy, isAttackable, levelOf } from './combat.js';
import { clamp, dist, dist2, lerp, TAU, angleDelta, makeRng } from '../core/util.js';
import { AI } from './ai.js';
import { nextEntityId } from './world.js';

const REPATH_INTERVAL = 1.1;
const ACQUIRE_INTERVAL = 0.45;

export class Game {
  constructor(opts) {
    this.opts = opts;
    this.world = new World({ size: opts.mapSize, seed: opts.seed });
    this.pathfinder = new Pathfinder(this.world);
    this.effects = new Effects();
    this.projectiles = [];
    this.rng = makeRng((opts.seed || 1) * 31 + 7);
    this.time = 0;
    this.over = null;              // 'win' | 'lose'
    this.paused = false;
    this.speed = 1;
    this.scratch = [];
    this.selection = [];
    this.groups = new Map();
    this.alerts = [];
    this.lastAlert = new Map();

    const start = STARTING_RESOURCES[opts.startRes] || STARTING_RESOURCES.normal;
    this.players = opts.factions.map((fac, i) => ({
      index: i,
      faction: fac,
      color: opts.colors[i],
      gold: start.gold,
      wood: start.wood,
      supply: 0,
      supplyMax: 0,
      upgrades: {},
      researching: new Set(),
      isAI: i !== 0,
      stats: { gathered: 0, gatheredWood: 0, trained: 0, killed: 0, lost: 0, built: 0 },
    }));
    this.me = 0;
    this.fog = new Fog(this.world, opts.fog !== false);

    this.setupBases(start.workers);

    this.ai = this.players
      .filter((p) => p.isAI)
      .map((p) => new AI(this, p, DIFFICULTY[opts.difficulty] || DIFFICULTY.normal));

    // Centre on the player's base.
    this.homePoint = this.players[0].hallPoint || { x: this.world.pxW / 2, y: this.world.pxH / 2 };
  }

  // =========================================================================
  //  SETUP
  // =========================================================================
  setupBases(workerCount) {
    this.world.startPositions.forEach(([tx, ty], i) => {
      const p = this.players[i];
      if (!p) return;
      const f = FACTIONS[p.faction];
      const hallType = f.hall;
      const size = BUILDINGS[hallType].size;
      const hx = tx - ((size / 2) | 0), hy = ty - ((size / 2) | 0);
      const hall = this.spawnBuilding(hallType, hx, hy, i, true);
      p.hallPoint = { x: hall.x, y: hall.y };
      hall.rally = { x: hall.x, y: hall.y + size * TILE * 0.9 };

      // starting workers fanned out around the hall
      const wType = f.worker;
      for (let k = 0; k < workerCount; k++) {
        const a = (k / workerCount) * TAU + 0.4;
        const r = size * TILE * 0.8;
        const u = this.spawnUnit(wType, hall.x + Math.cos(a) * r, hall.y + Math.sin(a) * r, i);
        // send them to the nearest gold mine straight away
        const mine = this.findNearestResource(u, 'goldmine');
        if (mine) this.orderGather([u], mine, false);
      }
    });
  }

  // =========================================================================
  //  ENTITY CREATION
  // =========================================================================
  spawnUnit(type, x, y, owner) {
    const d = UNITS[type];
    const p = this.players[owner];
    const e = {
      id: nextEntityId(), kind: 'unit', type, owner,
      x, y, vx: 0, vy: 0, angle: Math.PI / 2,
      radius: d.radius,
      hp: maxHpOf({ kind: 'unit', type }, p), maxHp: maxHpOf({ kind: 'unit', type }, p),
      sight: d.sight,
      order: null, orders: [],
      path: null, pathIdx: 0, repath: 0, pathPending: false,
      attackCd: 0, healCd: 0, acquireCd: this.rng() * ACQUIRE_INTERVAL,
      target: null, anim: { name: 'idle', t: this.rng() * 5 },
      carrying: null, gatherTimer: 0, node: null, dropoff: null,
      buildTarget: null, holding: false, aggro: true,
      dead: false, spawnT: 0, hitFlash: 0, blink: 0,
      lastMoveT: 0, stuck: 0,
    };
    this.world.add(e);
    p.stats.trained++;
    return e;
  }

  spawnBuilding(type, tx, ty, owner, complete = false) {
    const bd = BUILDINGS[type];
    const p = this.players[owner];
    const size = bd.size;
    const e = {
      id: nextEntityId(), kind: 'building', type, owner,
      tx, ty, size,
      x: (tx + size / 2) * TILE, y: (ty + size / 2) * TILE,
      radius: (size * TILE) / 2,
      maxHp: maxHpOf({ kind: 'building', type }, p),
      hp: 0, sight: bd.sight,
      complete, progress: complete ? 1 : 0,
      queue: [], rally: null, builders: 0,
      attackCd: 0, target: null, acquireCd: this.rng() * ACQUIRE_INTERVAL,
      dead: false, hitFlash: 0, corrupted: false, seed: this.rng() * 1000,
      anim: { name: 'idle', t: 0 },
    };
    e.hp = complete ? e.maxHp : e.maxHp * 0.1;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) this.world.setBlocked(tx + dx, ty + dy, 1, e.id);
    this.world.add(e);
    if (complete) this.onBuildingComplete(e);
    this.world.markChunkAt(tx, ty);
    return e;
  }

  onBuildingComplete(e) {
    const bd = BUILDINGS[e.type];
    e.complete = true;
    e.progress = 1;
    e.hp = e.maxHp;
    this.players[e.owner].stats.built++;
    if (bd.corrupt && !e.corrupted) {
      e.corrupted = true;
      const cx = e.tx + ((e.size / 2) | 0), cy = e.ty + ((e.size / 2) | 0);
      const r = bd.corrupt * (1 + 0.45 * levelOf(this.players[e.owner], 'd_spread'));
      e.corruptRadius = r;
      this.world.applyCorruption(cx, cy, r);
      this.witherTrees(cx, cy, r);
    }
    if (!e.rally) {
      e.rally = { x: e.x, y: e.y + e.size * TILE * 0.85 };
    }
    this.onSound?.('complete', e.x, e.y);
  }

  /** Corruption turns standing timber into brimstone — the Legion remakes the land. */
  witherTrees(cx, cy, r) {
    const w = this.world;
    const px = (cx + 0.5) * TILE, py = (cy + 0.5) * TILE;
    const near = w.near(px, py, r * TILE, []);
    for (const t of near.slice()) {
      if (t.kind !== 'resource' || t.type !== 'tree') continue;
      if (w.corruptionAt(t.x, t.y) < 0.55) continue;
      const amount = Math.max(40, Math.round(t.amount * 0.8));
      const tx = t.tx, ty = t.ty;
      this.world.remove(t);
      const b = this.world.makeResource('brimstone', tx, ty, amount);
      b.harvesters = 0;
      this.effects.burst(b.x, b.y - 10, 'ember', 8, { color: '#ff6a2a', maxLife: 0.8, grav: -20 });
    }
  }

  // =========================================================================
  //  MAIN LOOP
  // =========================================================================
  update(dt) {
    if (this.paused || this.over) { this.effects.update(dt); return; }
    dt = Math.min(dt, 0.05) * this.speed;
    this.time += dt;

    const w = this.world;
    w.rebuildHash();
    this.pathfinder.tick();

    for (const p of this.players) { p.supplyMax = 0; p.supply = 0; }

    const ents = w.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.dead) continue;
      if (e.kind === 'unit') this.updateUnit(e, dt);
      else if (e.kind === 'building') this.updateBuilding(e, dt);
    }

    this.updateProjectiles(dt);
    this.effects.update(dt);
    this.fog.update(dt, ents, this.me);
    for (const ai of this.ai) ai.update(dt);

    w.compact();
    this.selection = this.selection.filter((e) => !e.dead);
    this.checkVictory();
  }

  // =========================================================================
  //  UNITS
  // =========================================================================
  updateUnit(e, dt) {
    const d = UNITS[e.type];
    const p = this.players[e.owner];
    p.supply += d.supply;

    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.attackCd > 0) e.attackCd -= dt;
    if (e.healCd > 0) e.healCd -= dt;
    if (e.blink > 0) e.blink -= dt;
    e.spawnT += dt;

    // regeneration (the Legion knits itself back together on corruption)
    const reg = regenOf(e, p, FACTIONS[d.faction].corrupts ? this.world.corruptionAt(e.x, e.y) : 0);
    if (reg > 0 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + reg * dt);

    // support behaviour runs alongside whatever else the unit is doing
    if (d.heal) this.tryHeal(e, p, dt);

    this.runOrder(e, dt);
    this.integrate(e, dt);
    this.updateAnim(e, dt);
  }

  currentOrder(e) {
    if (!e.order && e.orders.length) e.order = e.orders.shift();
    return e.order;
  }

  finishOrder(e) {
    e.order = null;
    e.path = null;
    if (e.node && !(e.orders[0] && e.orders[0].type === 'gather')) this.releaseNode(e);
    if (e.orders.length) e.order = e.orders.shift();
  }

  runOrder(e, dt) {
    const d = UNITS[e.type];
    const p = this.players[e.owner];
    const o = this.currentOrder(e);

    if (!o) {
      // idle: hold ground but shoot what wanders in
      this.autoAcquire(e, dt, d.sight * TILE * 0.85);
      if (e.target) this.fight(e, dt, false);
      return;
    }

    switch (o.type) {
      case 'move': {
        if (this.moveTowards(e, o.x, o.y, dt, o.tolerance ?? TILE * 0.5)) this.finishOrder(e);
        break;
      }
      case 'attackMove': {
        this.autoAcquire(e, dt, d.sight * TILE);
        if (e.target && isAttackable(e.target) && !e.target.dead) { this.fight(e, dt, true); break; }
        if (this.moveTowards(e, o.x, o.y, dt, TILE * 0.6)) this.finishOrder(e);
        break;
      }
      case 'patrol': {
        this.autoAcquire(e, dt, d.sight * TILE);
        if (e.target && isAttackable(e.target) && !e.target.dead) { this.fight(e, dt, true); break; }
        if (this.moveTowards(e, o.x, o.y, dt, TILE * 0.7)) {
          e.order = { type: 'patrol', x: o.homeX, y: o.homeY, homeX: o.x, homeY: o.y };
          e.path = null;
        }
        break;
      }
      case 'attack': {
        const t = o.target;
        if (!t || t.dead || !isAttackable(t)) {
          // finish the job on whatever is left nearby, else stand down
          e.target = null;
          this.finishOrder(e);
          break;
        }
        e.target = t;
        this.fight(e, dt, true);
        break;
      }
      case 'hold': {
        this.autoAcquire(e, dt, d.sight * TILE * 0.9);
        if (e.target) this.fight(e, dt, false);
        break;
      }
      case 'gather': this.runGather(e, dt, o); break;
      case 'return': this.runReturn(e, dt, o); break;
      case 'build': this.runBuild(e, dt, o); break;
      case 'repair': this.runRepair(e, dt, o); break;
      default: this.finishOrder(e);
    }
  }

  // ---- movement ------------------------------------------------------------
  requestPath(e, x, y) {
    if (e.pathPending) return;
    e.pathPending = true;
    this.pathfinder.request(e, x, y, (path) => {
      e.pathPending = false;
      if (e.dead) return;
      e.path = path;
      e.pathIdx = 0;
      e.repath = REPATH_INTERVAL;
      if (!path) {
        e.pathFailed = (e.pathFailed || 0) + 1;
        // Repeated total pathing failure means this unit is sealed into a
        // pocket — usually because structures went up around it. It has room
        // to shuffle inside the pocket, so no "hasn't moved" test can catch it.
        if (e.pathFailed >= 4 && this.time - (e.lastRescue || -99) > 5) {
          e.lastRescue = this.time;
          e.pathFailed = 0;
          this.rescueFromPocket(e, x, y);
        }
      } else e.pathFailed = 0;
    });
  }

  /** Returns true once the unit is within `tol` of the goal. */
  moveTowards(e, gx, gy, dt, tol) {
    const dd = dist(e.x, e.y, gx, gy);
    if (dd <= tol) { e.path = null; e.desire = null; return true; }

    e.repath -= dt;
    const goalMoved = !e.goal || dist2(e.goal.x, e.goal.y, gx, gy) > (TILE * 1.2) ** 2;
    if (!e.path || goalMoved || e.repath <= 0) {
      if (goalMoved || !e.path) {
        e.goal = { x: gx, y: gy };
        this.requestPath(e, gx, gy);
      } else e.repath = REPATH_INTERVAL;
    }

    let tx = gx, ty = gy;
    if (e.path && e.path.length) {
      let node = e.path[e.pathIdx];
      while (node && dist2(e.x, e.y, node[0], node[1]) < (TILE * 0.55) ** 2 && e.pathIdx < e.path.length - 1) {
        e.pathIdx++; node = e.path[e.pathIdx];
      }
      // Standing on the final waypoint while still short of the goal means the
      // path never reached it. Steer straight at the goal instead of at our own
      // feet, and ask for a fresh path.
      if (node && e.pathIdx >= e.path.length - 1
          && dist2(e.x, e.y, node[0], node[1]) < (TILE * 0.55) ** 2) {
        e.path = null; e.repath = 0;
      } else if (node) { tx = node[0]; ty = node[1]; }
    }
    e.desire = { x: tx, y: ty };
    return false;
  }

  integrate(e, dt) {
    const d = UNITS[e.type];
    const st = statsOf(e, this.players[e.owner]);
    const speed = st.speed;
    let ax = 0, ay = 0;

    if (e.desire) {
      const dx = e.desire.x - e.x, dy = e.desire.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      ax = (dx / len) * speed;
      ay = (dy / len) * speed;
    }

    // soft separation from neighbours so crowds spread instead of stacking
    const near = this.world.near(e.x, e.y, 42, this.scratch);
    let sx = 0, sy = 0;
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === e || o.dead) continue;
      if (o.kind !== 'unit') continue;
      const dx = e.x - o.x, dy = e.y - o.y;
      const dd = Math.hypot(dx, dy);
      const min = (e.radius + o.radius) * 1.05;
      if (dd > min || dd === 0) continue;
      const push = (min - dd) / min;
      sx += (dx / dd) * push;
      sy += (dy / dd) * push;
    }
    const sepStrength = e.desire ? 0.85 : 1.4;
    ax += sx * speed * sepStrength;
    ay += sy * speed * sepStrength;

    if (!e.desire && !sx && !sy) { e.vx *= Math.pow(0.0001, dt); e.vy *= Math.pow(0.0001, dt); }
    else {
      const blend = 1 - Math.pow(0.0008, dt);
      e.vx = lerp(e.vx, ax, blend);
      e.vy = lerp(e.vy, ay, blend);
    }

    const vlen = Math.hypot(e.vx, e.vy);
    if (vlen > speed * 1.6) { e.vx = (e.vx / vlen) * speed * 1.6; e.vy = (e.vy / vlen) * speed * 1.6; }

    if (vlen > 2) {
      let nx = e.x + e.vx * dt, ny = e.y + e.vy * dt;
      // slide along static blockers
      if (this.blockedAt(nx, e.y, e.radius)) { nx = e.x; e.vx *= -0.15; }
      if (this.blockedAt(e.x, ny, e.radius)) { ny = e.y; e.vy *= -0.15; }
      if (!this.blockedAt(nx, ny, e.radius)) { e.x = nx; e.y = ny; }
      else { e.x = nx; e.y = ny; this.unstick(e); }
      e.x = clamp(e.x, TILE, this.world.pxW - TILE);
      e.y = clamp(e.y, TILE, this.world.pxH - TILE);
      const facing = Math.atan2(e.vy, e.vx);
      e.angle += angleDelta(e.angle, facing) * Math.min(1, dt * 13);
    } else if (e.target && !e.target.dead) {
      const facing = Math.atan2(e.target.y - e.y, e.target.x - e.x);
      e.angle += angleDelta(e.angle, facing) * Math.min(1, dt * 11);
    }
    e.moving = vlen > speed * 0.22;

    // Safety net. Whatever the cause — a degenerate path that ends at the
    // unit's own feet, a footprint that closed on top of it, a lost path
    // callback — a unit that wants to move and hasn't for a while tears up its
    // plan and starts over. Without this a single stuck worker silently costs
    // a player its whole economy.
    const moved = Math.hypot(e.x - (e.lastX ?? e.x), e.y - (e.lastY ?? e.y));
    e.lastX = e.x; e.lastY = e.y;
    if (e.desire && moved < 0.4 * dt * 60) e.stuck = (e.stuck || 0) + dt;
    else e.stuck = 0;
    if (e.stuck > 2.5) {
      e.stuck = 0;
      e.path = null; e.goal = null; e.repath = 0;
      if (e.pathPending) { this.pathfinder.cancelFor(e); e.pathPending = false; }
      if (e.order) e.order._spot = null;
      e.stuckStrikes = (e.stuckStrikes || 0) + 1;
      // Replanning did not help last time, so this unit is sealed in: move it.
      this.unstick(e, e.stuckStrikes >= 2);
      if (e.stuckStrikes >= 2) { e.stuckStrikes = 0; this.effects.dust(e.x, e.y, 4); }
    } else if (e.moving) { e.stuckStrikes = 0; }
  }

  blockedAt(x, y, r) {
    const w = this.world;
    const rr = r * 0.62;
    for (const [ox, oy] of [[0, 0], [rr, 0], [-rr, 0], [0, rr], [0, -rr]]) {
      const tx = ((x + ox) / TILE) | 0, ty = ((y + oy) / TILE) | 0;
      if (w.isBlocked(tx, ty)) return true;
    }
    return false;
  }

  /**
   * Free a unit from impassable ground. A gentle nudge is enough when it is
   * merely clipping a corner, but a unit sealed in (a structure raised on top
   * of it, forest closing around a mine) must be MOVED, not nudged — a 40%
   * lerp leaves it inside the wall and stuck forever.
   */
  unstick(e, force = false) {
    const w = this.world;
    const tx = (e.x / TILE) | 0, ty = (e.y / TILE) | 0;
    const trapped = force || w.isBlocked(tx, ty);
    const open = this.pathfinder.nearestOpen(tx, ty, trapped ? 12 : 4);
    if (!open) return false;
    const px = (open[0] + 0.5) * TILE, py = (open[1] + 0.5) * TILE;
    if (trapped) {
      e.x = px; e.y = py;
      e.vx = 0; e.vy = 0;
      e.path = null; e.goal = null; e.pathIdx = 0;
    } else {
      e.x = lerp(e.x, px, 0.4); e.y = lerp(e.y, py, 0.4);
    }
    return true;
  }

  /**
   * Move a sealed-in unit to the nearest tile from which its goal is actually
   * reachable. Only ever runs after A* has failed outright several times, so
   * it cannot be used to shortcut real walls.
   */
  rescueFromPocket(e, gx, gy) {
    const w = this.world;
    const tx = (e.x / TILE) | 0, ty = (e.y / TILE) | 0;
    let tried = 0;
    for (let r = 3; r <= 16; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (w.isBlocked(x, y)) continue;
          const px = (x + 0.5) * TILE, py = (y + 0.5) * TILE;
          if (gx !== undefined && ++tried <= 14) {
            const probe = this.pathfinder.solve(px, py, gx, gy, { maxNodes: 3000 });
            if (!probe.path) continue;          // same pocket — keep looking
          }
          e.x = px; e.y = py;
          e.vx = 0; e.vy = 0;
          e.path = null; e.goal = null; e.pathIdx = 0;
          if (e.order) e.order._spot = null;
          if (e.avoid) e.avoid.clear();
          this.effects.dust(e.x, e.y, 5);
          return true;
        }
      }
    }
    return false;
  }

  updateAnim(e, dt) {
    const a = e.anim;
    let name = 'idle';
    if (e.attackAnim > 0) { name = 'attack'; e.attackAnim -= dt; }
    else if (e.moving) name = 'walk';
    if (a.name !== name) { a.name = name; a.t = 0; }
    const rate = name === 'walk' ? 1.5 * (Math.hypot(e.vx, e.vy) / (UNITS[e.type].speed || 60)) : name === 'attack' ? 1 / Math.max(0.35, e.attackAnimLen || 0.6) : 0.55;
    a.t += dt * rate;
    if (a.t > 1) a.t -= Math.floor(a.t);
  }

  // ---- combat --------------------------------------------------------------
  autoAcquire(e, dt, radius) {
    if (!e.aggro) return;
    if (e.target && !e.target.dead && isAttackable(e.target)) {
      const st = statsOf(e, this.players[e.owner]);
      if (dist(e.x, e.y, e.target.x, e.target.y) < rangePx(st, e, e.target) + TILE * 4) return;
    }
    e.acquireCd -= dt;
    if (e.acquireCd > 0) return;
    e.acquireCd = ACQUIRE_INTERVAL;
    e.target = this.findTarget(e, radius);
  }

  findTarget(e, radius) {
    const near = this.world.near(e.x, e.y, radius, this.scratch);
    let best = null, bestScore = Infinity;
    const isWorker = UNITS[e.type]?.worker;
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o.dead || !isAttackable(o) || !isEnemy(e, o)) continue;
      if (o.kind === 'building' && !o.complete && o.hp < 1) continue;
      let score = dist2(e.x, e.y, o.x, o.y);
      if (o.kind === 'building') score *= 3.2;             // prefer living targets
      if (UNITS[o.type]?.worker) score *= 0.75;            // but workers are juicy
      if (isWorker) score *= o.kind === 'building' ? 6 : 1; // peasants aren't demolition crews
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  fight(e, dt, chase) {
    const t = e.target;
    if (!t || t.dead) { e.target = null; return; }
    const p = this.players[e.owner];
    const st = statsOf(e, p);
    if (st.dmg <= 0) return;
    const reach = rangePx(st, e, t);
    const dd = dist(e.x, e.y, t.x, t.y);

    if (dd > reach) {
      if (!chase && !e.holding) {
        // stationary units don't leave their post
        if (dd > reach + TILE * 3) { e.target = null; e.desire = null; return; }
      }
      if (e.holding) { e.desire = null; return; }
      this.moveTowards(e, t.x, t.y, dt, reach * 0.9);
      return;
    }
    e.desire = null;
    e.path = null;
    if (e.attackCd > 0) return;
    e.attackCd = st.cd;
    e.attackAnim = st.cd * 0.55;
    e.attackAnimLen = st.cd * 0.55;
    const d = UNITS[e.type];
    st.bonusVs = d.bonusVs;
    if (d.projectile) {
      this.spawnProjectile(e, t, st, d);
    } else {
      const delay = st.cd * 0.22;
      this.schedule(delay, () => {
        if (e.dead || t.dead) return;
        if (dist(e.x, e.y, t.x, t.y) > reach * 1.5) return;
        this.onSound?.('melee', e.x, e.y);
        this.dealDamage(e, t, st);
        if (st.splash) this.splash(e, t.x, t.y, st, st.splash);
      });
    }
  }

  schedule(delay, fn) {
    (this.timers || (this.timers = [])).push({ t: delay, fn });
  }

  spawnProjectile(e, target, st, d) {
    const from = { x: e.x, y: e.y - (e.radius + 12) };
    this.onSound?.(d.projectile === 'arrow' || d.projectile === 'bolt' ? 'bow' : 'fire', e.x, e.y);
    this.projectiles.push({
      x: from.x, y: from.y, sx: from.x, sy: from.y,
      target, kind: d.projectile, owner: e.owner, src: e,
      st: { ...st }, speed: d.projectile === 'bolt' ? 520 : d.projectile === 'arrow' ? 620 : 380,
      t: 0, life: 3.2, arc: d.projectile === 'arrow' || d.projectile === 'bolt' ? 1 : 0,
      drain: d.drain || 0,
    });
  }

  updateProjectiles(dt) {
    if (this.timers) {
      for (let i = this.timers.length - 1; i >= 0; i--) {
        const t = this.timers[i];
        t.t -= dt;
        if (t.t <= 0) { t.fn(); this.timers.splice(i, 1); }
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      const tgt = pr.target;
      if (!tgt || tgt.dead || pr.t > pr.life) { this.projectiles.splice(i, 1); continue; }
      const tx = tgt.x, ty = tgt.y - (tgt.kind === 'building' ? tgt.size * TILE * 0.28 : tgt.radius * 0.8);
      const dx = tx - pr.x, dy = ty - pr.y;
      const dd = Math.hypot(dx, dy);
      const step = pr.speed * dt;
      pr.angle = Math.atan2(dy, dx);
      if (dd <= step) {
        pr.x = tx; pr.y = ty;
        this.projectileHit(pr, tgt);
        this.projectiles.splice(i, 1);
        continue;
      }
      pr.x += (dx / dd) * step;
      pr.y += (dy / dd) * step;
      if (pr.kind === 'fireball' || pr.kind === 'drain' || pr.kind === 'holy') {
        if (this.rng() < 0.5) {
          this.effects.spawn({
            kind: 'ember', x: pr.x, y: pr.y, vx: 0, vy: 0, life: 0.28, age: 0, size: 2.2,
            color: pr.kind === 'fireball' ? '#ff8a3d' : pr.kind === 'drain' ? '#c766ff' : '#ffe8aa', grav: -10,
          });
        }
      }
    }
  }

  projectileHit(pr, tgt) {
    const src = pr.src;
    const st = pr.st;
    if (src && !src.dead) {
      const dealt = this.dealDamage(src, tgt, st);
      if (pr.drain && dealt > 0) this.drainInto(src, dealt * pr.drain);
    }
    if (st.splash) this.splash(src, pr.x, pr.y, st, st.splash);
    if (pr.kind === 'fireball') { this.effects.explosion(pr.x, pr.y, (st.splash || 0.8) * TILE * 1.4, '#ff8a3d'); this.onSound?.('explode', pr.x, pr.y); }
    else if (pr.kind === 'holy') this.effects.burst(pr.x, pr.y, 'heal', 5, { color: '#ffe8aa', maxLife: 0.4, grav: -20 });
    else if (pr.kind === 'drain') this.effects.burst(pr.x, pr.y, 'ember', 5, { color: '#c766ff', maxLife: 0.4, grav: -30 });
  }

  drainInto(src, amount) {
    // Warlocks stitch what they tear out into the nearest wounded ally.
    const near = this.world.near(src.x, src.y, TILE * 7, this.scratch);
    let best = null, bestMissing = 0;
    for (const o of near) {
      if (o.dead || o.owner !== src.owner || o.kind !== 'unit') continue;
      const missing = o.maxHp - o.hp;
      if (missing > bestMissing) { bestMissing = missing; best = o; }
    }
    const t = best || src;
    if (t.hp < t.maxHp) {
      t.hp = Math.min(t.maxHp, t.hp + amount);
      this.effects.heal(t.x, t.y - 8);
    }
  }

  splash(src, x, y, st, radiusTiles) {
    const r = radiusTiles * TILE;
    const near = this.world.near(x, y, r, []);
    for (const o of near) {
      if (o.dead || !isAttackable(o) || o === st.primary) continue;
      if (!src || !isEnemy(src, o)) continue;
      const dd = dist(x, y, o.x, o.y);
      if (dd > r) continue;
      const falloff = 1 - (dd / r) * 0.65;
      this.dealDamage(src, o, { ...st, dmg: st.dmg * 0.55 * falloff }, true);
    }
  }

  dealDamage(src, tgt, st, isSplash = false) {
    if (tgt.dead) return 0;
    const tp = this.players[tgt.owner];
    const tStats = statsOf(tgt, tp);
    const tDef = tgt.kind === 'building' ? BUILDINGS[tgt.type] : UNITS[tgt.type];
    const dmg = computeDamage(st, tgt, tStats, tDef);
    tgt.hp -= dmg;
    tgt.hitFlash = 0.14;
    if (!isSplash) {
      const fac = FACTIONS[tDef.faction]?.id || 'human';
      this.effects.hit(tgt.x + (this.rng() - 0.5) * 8, tgt.y - tgt.radius * 0.3, fac, src ? Math.atan2(tgt.y - src.y, tgt.x - src.x) : 0);
    }
    // being shot at makes idle units fight back
    if (tgt.kind === 'unit' && !tgt.target && src && tgt.aggro && !tgt.order) tgt.target = src;
    if (tgt.hp <= 0) this.kill(tgt, src);
    return dmg;
  }

  kill(e, killer) {
    if (e.dead) return;
    const def = e.kind === 'building' ? BUILDINGS[e.type] : UNITS[e.type];
    const fac = def.faction;
    if (killer && killer.owner >= 0) this.players[killer.owner].stats.killed++;
    if (e.owner >= 0) this.players[e.owner].stats.lost++;

    if (e.kind === 'building') {
      this.effects.explosion(e.x, e.y, e.size * TILE * 0.7, fac === 'demon' ? '#ff5a1f' : '#ffb37a');
      this.onSound?.('explode', e.x, e.y);
      this.effects.decal(e.x, e.y, 'rubble', fac, e.seed);
      if (e.corrupted && e.corruptRadius) {
        const cx = e.tx + ((e.size / 2) | 0), cy = e.ty + ((e.size / 2) | 0);
        this.world.applyCorruption(cx, cy, e.corruptRadius, true);
      }
      for (const u of this.world.entities) {
        if (u.kind === 'unit' && u.buildTarget === e) { u.buildTarget = null; if (u.order?.type === 'build') this.finishOrder(u); }
      }
      if (e.owner === this.me) this.alert('Structure lost', 'bad', e);
      this.cameraShake?.(6);
    } else {
      this.effects.death(e.x, e.y - 8, fac, e.radius > 12);
      this.onSound?.(fac === 'demon' ? 'deathDemon' : 'death', e.x, e.y);
      this.effects.decal(e.x, e.y, 'corpse', fac, e.id);
      if (e.node) this.releaseNode(e);
      if (e.owner === this.me && UNITS[e.type].worker) this.alert('Worker slain', 'bad', e);
    }
    this.selection = this.selection.filter((s) => s !== e);
    this.world.remove(e);
  }

  tryHeal(e, p, dt) {
    const power = healPowerOf(e, p);
    if (!power || e.healCd > 0) return;
    const near = this.world.near(e.x, e.y, power.range * TILE, this.scratch);
    let best = null, worst = 0.999;
    for (const o of near) {
      if (o.dead || o.owner !== e.owner || o.kind !== 'unit' || o === e) continue;
      const frac = o.hp / o.maxHp;
      if (frac < worst) { worst = frac; best = o; }
    }
    if (!best) return;
    e.healCd = power.cd;
    best.hp = Math.min(best.maxHp, best.hp + power.amount);
    this.effects.heal(best.x, best.y - 10);
  }

  // =========================================================================
  //  WORKERS: gather / build / repair
  // =========================================================================
  resourceKindFor(player) { return FACTIONS[player.faction].woodNode; }

  /**
   * Distance from a unit to the EDGE of a footprint, not its centre. Approach
   * a 2x2 mine diagonally and the centre is much further away than the side,
   * so a centre-based test leaves workers stranded on corner tiles.
   */
  footprintDist(e, ent) {
    const half = ((ent.size || 1) * TILE) / 2;
    const dx = Math.max(0, Math.abs(e.x - ent.x) - half);
    const dy = Math.max(0, Math.abs(e.y - ent.y) - half);
    return Math.hypot(dx, dy);
  }

  /**
   * Is the worker close enough to work on this footprint?
   * The range must exceed the worst case: standing on a DIAGONAL neighbour tile
   * (~23px from the edge) plus the arrival slop below, or workers stop a hair
   * outside range, give up, and wander in circles forever.
   */
  atFootprint(e, ent) {
    return this.footprintDist(e, ent) <= e.radius + TILE;
  }

  /**
   * Walk to a free tile touching a footprint. The chosen tile is CACHED on the
   * order: recomputing it every frame makes the goal flip between candidates,
   * which retriggers pathfinding every tick and leaves the unit drifting in
   * place. It is only re-chosen if it becomes blocked or the walk stalls.
   */
  approachFootprint(e, ent, dt, order) {
    const slot = order || e;
    let spot = slot._spot;
    const stale = !spot || spot.ent !== ent.id
      || this.world.isBlocked((spot.x / TILE) | 0, (spot.y / TILE) | 0);
    if (stale) {
      const found = this.pathfinder.adjacentTo(ent, e.x, e.y);
      if (!found) {
        // Nothing standable touches this footprint — a mine walled in by
        // forest, say. Caller must pick a different target or the worker will
        // walk at a blocked tile forever.
        this.moveTowards(e, ent.x, ent.y, dt, (ent.size || 1) * TILE * 0.5 + e.radius);
        return false;
      }
      spot = { x: found[0], y: found[1], ent: ent.id, since: this.time };
      slot._spot = spot;
    }
    // If we reached the chosen tile but still aren't in working range, or the
    // walk has dragged on, pick a different tile next frame.
    const arrived = this.moveTowards(e, spot.x, spot.y, dt, TILE * 0.4);
    if (arrived && !this.atFootprint(e, ent)) slot._spot = null;
    else if (this.time - spot.since > 8) slot._spot = null;
    return true;
  }

  findNearestResource(unit, kind, excluding = null) {
    let best = null, bestD = Infinity;
    for (const e of this.world.entities) {
      if (e.dead || e.kind !== 'resource' || e.type !== kind) continue;
      if (e === excluding) continue;
      if (unit.avoid?.has(e.id)) continue;
      if (e.amount <= 0) continue;
      if (e.harvesters >= e.slots) continue;
      const dd = dist2(unit.x, unit.y, e.x, e.y);
      if (dd < bestD) { bestD = dd; best = e; }
    }
    return best;
  }

  findDropoff(unit, resType) {
    const p = this.players[unit.owner];
    let best = null, bestD = Infinity;
    for (const e of this.world.entities) {
      if (e.dead || e.kind !== 'building' || e.owner !== unit.owner || !e.complete) continue;
      const bd = BUILDINGS[e.type];
      if (!bd.dropoff) continue;
      const want = resType === 'goldmine' ? 'gold' : 'wood';
      if (!bd.dropoff.includes(want)) continue;
      const dd = dist2(unit.x, unit.y, e.x, e.y);
      if (dd < bestD) { bestD = dd; best = e; }
    }
    return best;
  }

  claimNode(e, node) {
    if (e.node === node) return true;
    if (e.node) this.releaseNode(e);
    if (node.harvesters >= node.slots) return false;
    node.harvesters++;
    e.node = node;
    return true;
  }

  releaseNode(e) {
    if (e.node) { e.node.harvesters = Math.max(0, e.node.harvesters - 1); e.node = null; }
  }

  runGather(e, dt, o) {
    const d = UNITS[e.type];
    let node = o.target;
    if (!node || node.dead || node.amount <= 0) {
      const kind = o.kind || (node ? node.type : 'goldmine');
      node = this.findNearestResource(e, kind, node);
      if (!node) {
        if (e.carrying) { e.order = { type: 'return' }; return; }
        this.finishOrder(e); return;
      }
      o.target = node;
      e.path = null;
    }
    if (e.carrying && e.carrying.amount > 0) { e.order = { type: 'return', node }; return; }

    // stand next to the node
    if (!this.atFootprint(e, node)) {
      if (!this.claimNode(e, node)) {
        const alt = this.findNearestResource(e, node.type, node);
        if (alt) { o.target = alt; e.path = null; }
        return;
      }
      o.walkT = (o.walkT || 0) + dt;
      const reachable = this.approachFootprint(e, node, dt, o);
      if (!reachable || o.walkT > 16) {
        // Unworkable or unreachable: blacklist it for this worker and retarget,
        // otherwise a whole mining crew can stall for the rest of the match.
        (e.avoid || (e.avoid = new Set())).add(node.id);
        this.releaseNode(e);
        o.walkT = 0; o._spot = null;
        const alt = this.findNearestResource(e, node.type, node);
        if (alt) { o.target = alt; e.path = null; }
        else { e.avoid.clear(); this.finishOrder(e); }
      }
      return;
    }
    o.walkT = 0;
    if (!this.claimNode(e, node)) {
      const alt = this.findNearestResource(e, node.type, node);
      if (alt) { o.target = alt; e.path = null; }
      return;
    }

    e.desire = null;
    e.angle += angleDelta(e.angle, Math.atan2(node.y - e.y, node.x - e.x)) * Math.min(1, dt * 10);
    e.gatherTimer += dt;
    e.attackAnim = 0.4; e.attackAnimLen = 0.5;   // swing the pick / claw
    if (this.rng() < dt * 6) this.effects.dust(node.x + (this.rng() - 0.5) * 14, node.y + 4, 1);
    if (e.gatherTimer >= d.gatherTime) {
      e.gatherTimer = 0;
      const take = Math.min(d.carry, node.amount);
      node.amount -= take;
      e.carrying = { type: node.type === 'goldmine' ? 'gold' : 'wood', amount: take };
      if (node.amount <= 0) {
        if (node.type === 'goldmine') { node.spent = true; this.world.markChunkAt(node.tx, node.ty); }
        else { this.world.remove(node); this.effects.decal(node.x, node.y, node.type === 'tree' ? 'stump' : 'scorch', 'neutral', node.seed); }
        this.releaseNode(e);
      }
      e.order = { type: 'return', node: node.dead ? null : node };
      e.path = null;
    }
  }

  runReturn(e, dt, o) {
    const d = UNITS[e.type];
    if (!e.carrying) { e.order = o.node ? { type: 'gather', target: o.node } : null; return; }
    const resType = e.carrying.type === 'gold' ? 'goldmine' : 'tree';

    // Imps blink their load home instead of walking it.
    if (d.blinkReturn) {
      const drop = this.findDropoff(e, resType);
      if (!drop) { this.finishOrder(e); return; }
      e.desire = null;
      e.blinkChannel = (e.blinkChannel || 0) + dt;
      if (this.rng() < dt * 8) this.effects.burst(e.x, e.y - 8, 'ember', 1, { color: '#ff6a2a', maxLife: 0.4, grav: -40 });
      if (e.blinkChannel >= d.blinkReturn) {
        e.blinkChannel = 0;
        this.effects.blink(e.x, e.y);
        this.effects.blink(drop.x, drop.y - 6, '#ff9a3d');
        this.onSound?.('blink', e.x, e.y);
        this.deposit(e);
        e.order = o.node && !o.node.dead && o.node.amount > 0 ? { type: 'gather', target: o.node } : { type: 'gather', kind: resType };
        e.path = null;
      }
      return;
    }

    const drop = this.findDropoff(e, resType);
    if (!drop) { this.finishOrder(e); return; }
    if (!this.atFootprint(e, drop)) {
      o.walkT = (o.walkT || 0) + dt;
      const reachable = this.approachFootprint(e, drop, dt, o);
      if (!reachable && o.walkT > 16) { o.walkT = 0; o._spot = null; this.unstick(e); }
      return;
    }
    o.walkT = 0;
    e.desire = null;
    this.deposit(e);
    e.order = o.node && !o.node.dead && o.node.amount > 0 ? { type: 'gather', target: o.node } : { type: 'gather', kind: resType };
    e.path = null;
  }

  deposit(e) {
    if (!e.carrying) return;
    // A completed round trip proves the route works, so forget any nodes this
    // worker gave up on earlier.
    if (e.avoid) e.avoid.clear();
    const p = this.players[e.owner];
    if (e.carrying.type === 'gold') { p.gold += e.carrying.amount; p.stats.gathered += e.carrying.amount; }
    else { p.wood += e.carrying.amount; p.stats.gatheredWood += e.carrying.amount; }
    if (e.owner === this.me) this.onDeposit?.(e.carrying.type, e.carrying.amount);
    e.carrying = null;
  }

  runBuild(e, dt, o) {
    const b = o.target;
    if (!b || b.dead || b.complete) {
      e.buildTarget = null;
      this.finishOrder(e);
      // a peasant that finishes a job goes back to work
      if (b && b.complete) this.sendBackToWork(e);
      return;
    }
    if (!this.atFootprint(e, b)) { this.approachFootprint(e, b, dt, o); return; }
    e.desire = null;
    e.buildTarget = b;
    b.builders = (b.builders || 0) + dt;   // accumulated builder-seconds this frame
    e.attackAnim = 0.4; e.attackAnimLen = 0.6;
    if (this.rng() < dt * 4) this.effects.dust(b.x + (this.rng() - 0.5) * b.size * TILE * 0.7, b.y + 4, 1);

    const demonic = FACTIONS[BUILDINGS[b.type].faction].corrupts;
    if (demonic) {
      // The imp only has to light the fuse.
      b.ignited = true;
      e.buildTarget = null;
      this.effects.blink(b.x, b.y - 8, '#ff6a2a');
      this.finishOrder(e);
      this.sendBackToWork(e);
    }
  }

  sendBackToWork(e) {
    if (!UNITS[e.type].worker) return;
    if (e.orders.length || e.order) return;
    const node = this.findNearestResource(e, 'goldmine');
    if (node) this.orderGather([e], node, false);
  }

  runRepair(e, dt, o) {
    const b = o.target;
    const p = this.players[e.owner];
    if (!b || b.dead || b.hp >= b.maxHp || !FACTIONS[p.faction].canRepair) { this.finishOrder(e); return; }
    if (!this.atFootprint(e, b)) { this.approachFootprint(e, b, dt, o); return; }
    e.desire = null;
    e.attackAnim = 0.4; e.attackAnimLen = 0.6;
    const bd = BUILDINGS[b.type];
    const rate = b.maxHp / (bd.buildTime * 1.5);   // repairs a touch faster than building
    const heal = rate * dt;
    const costG = (bd.cost.gold * 0.3) * (heal / b.maxHp);
    const costW = (bd.cost.wood * 0.3) * (heal / b.maxHp);
    if (p.gold < costG || p.wood < costW) {
      if (e.owner === this.me) this.alert('Not enough resources to repair', 'bad', b, 4);
      this.finishOrder(e); return;
    }
    p.gold -= costG; p.wood -= costW;
    b.hp = Math.min(b.maxHp, b.hp + heal);
    if (this.rng() < dt * 8) this.effects.burst(b.x + (this.rng() - 0.5) * b.size * TILE * 0.6, b.y - 6, 'spark', 1, { color: '#ffd98a', maxLife: 0.3 });
    if (b.hp >= b.maxHp) this.finishOrder(e);
  }

  // =========================================================================
  //  BUILDINGS
  // =========================================================================
  updateBuilding(e, dt) {
    const bd = BUILDINGS[e.type];
    const p = this.players[e.owner];
    if (e.hitFlash > 0) e.hitFlash -= dt;

    if (!e.complete) {
      const demonic = FACTIONS[bd.faction].corrupts;
      const rate = 1 / bd.buildTime;
      let advance = 0;
      if (demonic) {
        if (e.ignited) advance = rate * dt;
      } else {
        advance = Math.min(e.builders, dt) * rate * (e.builders > dt ? 1.6 : 1);
      }
      e.builders = 0;
      if (advance > 0) {
        e.progress = Math.min(1, e.progress + advance);
        e.hp = Math.min(e.maxHp, e.maxHp * (0.1 + 0.9 * e.progress));
        if (e.progress >= 1) {
          this.onBuildingComplete(e);
          if (e.owner === this.me) this.alert(`${bd.name} complete`, 'good', e);
        }
      }
      return;
    }

    if (bd.supply) p.supplyMax = Math.min(SUPPLY_CAP, p.supplyMax + bd.supply);

    // demon structures mend themselves on their own blight
    if (FACTIONS[bd.faction].corrupts && e.hp < e.maxHp) {
      const c = this.world.corruptionAt(e.x, e.y);
      if (c > 0.2) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.006 * c * dt);
    }

    // production
    if (e.queue.length) {
      const job = e.queue[0];
      job.elapsed += dt;
      if (job.elapsed >= job.time) {
        e.queue.shift();
        if (job.kind === 'unit') this.completeTraining(e, job);
        else this.completeUpgrade(e, job);
      }
    }

    // towers
    if (bd.attack) {
      if (e.attackCd > 0) e.attackCd -= dt;
      const st = statsOf(e, p);
      if (!e.target || e.target.dead || dist(e.x, e.y, e.target.x, e.target.y) > st.range * TILE + e.radius) {
        e.acquireCd -= dt;
        if (e.acquireCd <= 0) { e.acquireCd = ACQUIRE_INTERVAL; e.target = this.findTarget(e, st.range * TILE + e.radius); }
      }
      if (e.target && !e.target.dead && e.attackCd <= 0) {
        const reach = st.range * TILE + e.radius;
        if (dist(e.x, e.y, e.target.x, e.target.y) <= reach) {
          e.attackCd = st.cd;
          this.spawnProjectile({ ...e, y: e.y - e.size * TILE * 0.55, radius: 0 }, e.target, st, { projectile: bd.attack.projectile });
          this.projectiles[this.projectiles.length - 1].src = e;
        }
      }
    }
  }

  completeTraining(b, job) {
    const p = this.players[b.owner];
    const spot = this.spawnSpot(b);
    const u = this.spawnUnit(job.type, spot[0], spot[1], b.owner);
    const rally = b.rally;
    if (rally) {
      const rt = this.entityAtPoint(rally.x, rally.y);
      if (rt && rt.kind === 'resource' && UNITS[job.type].worker) this.orderGather([u], rt, false);
      else if (rt && isEnemy(u, rt)) this.orderAttack([u], rt, false);
      else this.orderMove([u], rally.x, rally.y, false);
    } else if (UNITS[job.type].worker) {
      this.sendBackToWork(u);
    }
    if (b.owner === this.me) this.alert(`${UNITS[job.type].name} ready`, 'good', b, 2.2);
  }

  spawnSpot(b) {
    const spot = this.pathfinder.adjacentTo(b, b.rally ? b.rally.x : b.x, b.rally ? b.rally.y : b.y + TILE * 3);
    if (spot) return spot;
    return [b.x, b.y + b.size * TILE * 0.6];
  }

  completeUpgrade(b, job) {
    const p = this.players[b.owner];
    p.upgrades[job.type] = (p.upgrades[job.type] || 0) + 1;
    p.researching.delete(job.type);
    const up = UPGRADES[job.type];
    // Retroactively grow health pools that upgrades raise, and widen corruption.
    for (const e of this.world.entities) {
      if (e.dead || e.owner !== b.owner) continue;
      if (e.kind === 'unit') {
        const nm = maxHpOf(e, p);
        if (nm !== e.maxHp) { const frac = e.hp / e.maxHp; e.maxHp = nm; e.hp = nm * frac; }
      }
    }
    if (up.effect.corruptMul) {
      for (const e of this.world.entities) {
        if (e.dead || e.owner !== b.owner || e.kind !== 'building' || !e.corrupted) continue;
        const bd = BUILDINGS[e.type];
        const cx = e.tx + ((e.size / 2) | 0), cy = e.ty + ((e.size / 2) | 0);
        this.world.applyCorruption(cx, cy, e.corruptRadius, true);
        e.corruptRadius = bd.corrupt * (1 + up.effect.corruptMul);
        this.world.applyCorruption(cx, cy, e.corruptRadius);
        this.witherTrees(cx, cy, e.corruptRadius);
      }
    }
    if (b.owner === this.me) this.alert(`${up.name} researched`, 'good', b);
  }

  // =========================================================================
  //  PLACEMENT
  // =========================================================================
  canPlace(type, tx, ty, owner = this.me) {
    const bd = BUILDINGS[type];
    if (!bd) return { ok: false, why: 'Unknown structure' };
    const p = this.players[owner];
    const w = this.world;
    const size = bd.size;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const x = tx + dx, y = ty + dy;
        if (!w.inBounds(x, y)) return { ok: false, why: 'Outside the map' };
        if (w.isBlocked(x, y)) return { ok: false, why: 'Ground is obstructed' };
        // Only the human player is bound by fog; the AI knows its own ground.
        if (owner === this.me && this.fog.enabled && !this.fog.isExplored((x + 0.5) * TILE, (y + 0.5) * TILE)) {
          return { ok: false, why: 'Unexplored ground' };
        }
      }
    }
    if (FACTIONS[bd.faction].corrupts) {
      let corrupted = 0, total = size * size;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
        if (w.corrupt[(ty + dy) * w.w + (tx + dx)] > 0.08) corrupted++;
      }
      if (corrupted < total * 0.75) return { ok: false, why: 'Must be raised on corruption' };
    }
    return { ok: true };
  }

  requirementMet(player, type) {
    const d = BUILDINGS[type] || UNITS[type];
    if (!d?.requires) return true;
    return this.world.entities.some((e) => !e.dead && e.owner === player.index && e.kind === 'building' && e.type === d.requires && e.complete);
  }

  affordable(player, cost) {
    return player.gold >= (cost.gold || 0) && player.wood >= (cost.wood || 0);
  }

  pay(player, cost) {
    player.gold -= cost.gold || 0;
    player.wood -= cost.wood || 0;
  }

  refund(player, cost, frac = 1) {
    player.gold += (cost.gold || 0) * frac;
    player.wood += (cost.wood || 0) * frac;
  }

  /** Start a structure. Returns the new entity or null. */
  placeBuilding(type, tx, ty, workers, owner = this.me) {
    const p = this.players[owner];
    const bd = BUILDINGS[type];
    const check = this.canPlace(type, tx, ty, owner);
    if (!check.ok) { if (owner === this.me) this.alert(check.why, 'bad', null, 3); return null; }
    if (!this.requirementMet(p, type)) {
      if (owner === this.me) this.alert(`Requires ${BUILDINGS[bd.requires].name}`, 'bad', null, 3);
      return null;
    }
    if (!this.affordable(p, bd.cost)) { if (owner === this.me) this.alert('Not enough resources', 'bad', null, 3); return null; }
    this.pay(p, bd.cost);
    const b = this.spawnBuilding(type, tx, ty, owner, false);
    // shove anyone standing in the footprint out of the way
    for (const u of this.world.entities) {
      if (u.kind !== 'unit' || u.dead) continue;
      if (u.x > tx * TILE && u.x < (tx + bd.size) * TILE && u.y > ty * TILE && u.y < (ty + bd.size) * TILE) this.unstick(u, true);
    }
    const crew = (workers && workers.length ? workers : []).filter((u) => UNITS[u.type]?.worker && u.owner === owner);
    if (crew.length) {
      for (const u of crew) {
        u.orders.length = 0;
        u.order = { type: 'build', target: b };
        u.path = null;
        this.releaseNode(u);
      }
    }
    return b;
  }

  cancelBuilding(b) {
    const bd = BUILDINGS[b.type];
    this.refund(this.players[b.owner], bd.cost, 0.85);
    for (const u of this.world.entities) {
      if (u.kind === 'unit' && u.order?.type === 'build' && u.order.target === b) { this.finishOrder(u); this.sendBackToWork(u); }
    }
    this.world.remove(b);
  }

  // =========================================================================
  //  PRODUCTION COMMANDS
  // =========================================================================
  canTrain(b, type) {
    const p = this.players[b.owner];
    const u = UNITS[type];
    if (!u) return { ok: false, why: 'Unknown' };
    if (!b.complete) return { ok: false, why: 'Still under construction' };
    if (u.requires && !this.requirementMet(p, type)) return { ok: false, why: `Requires ${BUILDINGS[u.requires].name}` };
    if (!this.affordable(p, u.cost)) return { ok: false, why: 'Not enough resources' };
    if (p.supply + u.supply > p.supplyMax) return { ok: false, why: `Build a ${BUILDINGS[FACTIONS[p.faction].supplyBuilding].name}` };
    if (b.queue.length >= 6) return { ok: false, why: 'Queue is full' };
    return { ok: true };
  }

  train(b, type) {
    const check = this.canTrain(b, type);
    if (!check.ok) { if (b.owner === this.me) this.alert(check.why, 'bad', null, 3); return false; }
    const u = UNITS[type];
    this.pay(this.players[b.owner], u.cost);
    b.queue.push({ kind: 'unit', type, time: u.buildTime, elapsed: 0 });
    return true;
  }

  canResearch(b, id) {
    const p = this.players[b.owner];
    const up = UPGRADES[id];
    if (!up) return { ok: false, why: 'Unknown' };
    if (!b.complete) return { ok: false, why: 'Still under construction' };
    const lv = p.upgrades[id] || 0;
    if (lv >= up.levels) return { ok: false, why: 'Fully researched' };
    if (p.researching.has(id)) return { ok: false, why: 'Already researching' };
    if (!this.affordable(p, up.cost[lv])) return { ok: false, why: 'Not enough resources' };
    return { ok: true };
  }

  research(b, id) {
    const check = this.canResearch(b, id);
    if (!check.ok) { if (b.owner === this.me) this.alert(check.why, 'bad', null, 3); return false; }
    const p = this.players[b.owner];
    const up = UPGRADES[id];
    const lv = p.upgrades[id] || 0;
    this.pay(p, up.cost[lv]);
    p.researching.add(id);
    b.queue.push({ kind: 'upgrade', type: id, time: up.time[lv], elapsed: 0, level: lv + 1 });
    return true;
  }

  cancelJob(b, index) {
    const job = b.queue[index];
    if (!job) return;
    const p = this.players[b.owner];
    if (job.kind === 'unit') this.refund(p, UNITS[job.type].cost);
    else {
      const up = UPGRADES[job.type];
      this.refund(p, up.cost[(p.upgrades[job.type] || 0)]);
      p.researching.delete(job.type);
    }
    b.queue.splice(index, 1);
  }

  // =========================================================================
  //  UNIT COMMANDS
  // =========================================================================
  assign(units, order, queue) {
    for (const u of units) {
      if (u.dead || u.kind !== 'unit') continue;
      const o = typeof order === 'function' ? order(u) : { ...order };
      if (!o) continue;
      if (queue) u.orders.push(o);
      else {
        u.orders.length = 0;
        u.order = o;
        u.path = null;
        u.target = o.type === 'attack' ? o.target : null;
        u.holding = o.type === 'hold';
        if (o.type !== 'gather' && o.type !== 'return') this.releaseNode(u);
        this.pathfinder.cancelFor(u);
        u.pathPending = false;
      }
    }
  }

  /** Spread a group order so units don't all pile onto one pixel. */
  formationPoints(units, x, y) {
    const n = units.length;
    if (n <= 1) return [[x, y]];
    const pts = [];
    const spacing = 26;
    let ring = 0, placed = 0;
    while (placed < n) {
      const count = ring === 0 ? 1 : Math.floor(TAU * ring * 1.15);
      for (let i = 0; i < count && placed < n; i++) {
        const a = (i / count) * TAU + ring * 0.5;
        pts.push([x + Math.cos(a) * ring * spacing, y + Math.sin(a) * ring * spacing]);
        placed++;
      }
      ring++;
    }
    // pair units to nearby slots so the formation doesn't cross over itself
    const sorted = [...units].sort((a, b) => Math.atan2(a.y - y, a.x - x) - Math.atan2(b.y - y, b.x - x));
    pts.sort((a, b) => Math.atan2(a[1] - y, a[0] - x) - Math.atan2(b[1] - y, b[0] - x));
    const map = new Map();
    sorted.forEach((u, i) => map.set(u, pts[i] || [x, y]));
    return units.map((u) => map.get(u));
  }

  orderMove(units, x, y, queue) {
    const pts = this.formationPoints(units, x, y);
    units.forEach((u, i) => {
      const [px, py] = pts[i] || [x, y];
      this.assign([u], { type: 'move', x: px, y: py }, queue);
    });
  }

  orderAttackMove(units, x, y, queue) {
    const pts = this.formationPoints(units, x, y);
    units.forEach((u, i) => {
      const [px, py] = pts[i] || [x, y];
      this.assign([u], { type: 'attackMove', x: px, y: py }, queue);
    });
  }

  orderAttack(units, target, queue) { this.assign(units, { type: 'attack', target }, queue); }
  orderStop(units) { this.assign(units, null, false); for (const u of units) { u.order = null; u.orders.length = 0; u.target = null; u.path = null; u.desire = null; u.holding = false; this.releaseNode(u); } }
  orderHold(units) { this.assign(units, { type: 'hold' }, false); }
  orderPatrol(units, x, y, queue) {
    for (const u of units) this.assign([u], { type: 'patrol', x, y, homeX: u.x, homeY: u.y }, queue);
  }
  orderGather(units, node, queue) {
    const workers = units.filter((u) => UNITS[u.type]?.worker);
    for (const u of workers) this.assign([u], { type: 'gather', target: node, kind: node.type }, queue);
  }
  orderRepair(units, target, queue) {
    const workers = units.filter((u) => UNITS[u.type]?.worker && FACTIONS[this.players[u.owner].faction].canRepair);
    this.assign(workers, { type: 'repair', target }, queue);
  }
  orderBuildAssist(units, b, queue) {
    const workers = units.filter((u) => UNITS[u.type]?.worker);
    this.assign(workers, { type: 'build', target: b }, queue);
  }

  /** The one-click "do the sensible thing" command. */
  smartCommand(units, x, y, queue) {
    const target = this.entityAtPoint(x, y);
    const mine = units.filter((u) => u.owner === this.me && u.kind === 'unit');
    if (!mine.length) return;
    if (target && !target.dead) {
      if (target.kind === 'resource') {
        const kind = FACTIONS[this.players[this.me].faction].woodNode;
        const gatherable = target.type === 'goldmine' || target.type === kind;
        const workers = mine.filter((u) => UNITS[u.type].worker);
        if (gatherable && workers.length) {
          this.orderGather(workers, target, queue);
          const rest = mine.filter((u) => !UNITS[u.type].worker);
          if (rest.length) this.orderMove(rest, x, y, queue);
          return;
        }
      } else if (isEnemy({ owner: this.me }, target)) {
        this.orderAttack(mine, target, queue);
        return;
      } else if (target.owner === this.me && target.kind === 'building') {
        const workers = mine.filter((u) => UNITS[u.type].worker);
        if (!target.complete && workers.length) { this.orderBuildAssist(workers, target, queue); return; }
        if (target.hp < target.maxHp && workers.length && FACTIONS[this.players[this.me].faction].canRepair) {
          this.orderRepair(workers, target, queue);
          return;
        }
      }
    }
    this.orderMove(mine, x, y, queue);
  }

  setRally(buildings, x, y) {
    for (const b of buildings) {
      if (b.kind !== 'building' || b.owner !== this.me) continue;
      b.rally = { x, y };
    }
    this.effects.spawn({ kind: 'shock', x, y, r0: 4, r1: 30, life: 0.5, age: 0, color: '#e0a0f0' });
  }

  // =========================================================================
  //  QUERIES
  // =========================================================================
  entityAtPoint(x, y, ownerFilter = null) {
    const near = this.world.near(x, y, 40, []);
    let best = null, bestD = Infinity;
    for (const e of near) {
      if (e.dead) continue;
      if (ownerFilter !== null && e.owner !== ownerFilter) continue;
      if (!this.fog.areaExplored(e)) continue;
      if (e.kind === 'unit' && !this.fog.areaVisible(e)) continue;
      let hit, d;
      if (e.kind === 'unit') {
        d = dist(x, y, e.x, e.y);
        hit = d < e.radius + 9;
      } else {
        const half = (e.size * TILE) / 2;
        hit = x > e.x - half && x < e.x + half && y > e.y - half && y < e.y + half;
        d = dist(x, y, e.x, e.y);
      }
      if (hit && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  unitsInRect(x0, y0, x1, y1, owner) {
    const out = [];
    for (const e of this.world.entities) {
      if (e.dead || e.kind !== 'unit') continue;
      if (owner !== undefined && e.owner !== owner) continue;
      if (!this.fog.areaVisible(e)) continue;
      if (e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1) out.push(e);
    }
    return out;
  }

  idleWorkers() {
    return this.world.entities.filter((e) =>
      !e.dead && e.kind === 'unit' && e.owner === this.me && UNITS[e.type].worker && !e.order && !e.orders.length);
  }

  ownedBuildings(owner = this.me) {
    return this.world.entities.filter((e) => !e.dead && e.kind === 'building' && e.owner === owner);
  }

  alert(text, tone = '', at = null, cooldown = 6) {
    const last = this.lastAlert.get(text) || -99;
    if (this.time - last < cooldown) return;
    this.lastAlert.set(text, this.time);
    this.alerts.push({ text, tone, at: at ? { x: at.x, y: at.y } : null, t: this.time });
    if (this.alerts.length > 4) this.alerts.shift();
    this.onAlert?.(text, tone, at);
  }

  /**
   * A side is still in the fight while it holds a structure, or while it holds
   * a worker AND can actually afford to rebuild a hall. Counting a penniless
   * worker as "alive" leaves one hidden peasant keeping a decided match running
   * forever — nobody wants to sweep a 136x136 map for it.
   */
  stillInPlay(p) {
    let hasBuilding = false, hasWorker = false;
    for (const e of this.world.entities) {
      if (e.dead || e.owner !== p.index) continue;
      if (e.kind === 'building') { hasBuilding = true; break; }
      if (e.kind === 'unit' && UNITS[e.type].worker) hasWorker = true;
    }
    if (hasBuilding) return true;
    if (!hasWorker) return false;
    const hall = BUILDINGS[FACTIONS[p.faction].hall];
    return p.gold >= hall.cost.gold && p.wood >= hall.cost.wood;
  }

  checkVictory() {
    if (this.over) return;
    const alive = this.players.map((p) => this.stillInPlay(p));
    if (!alive[0]) this.setOver('lose');
    else if (alive.slice(1).every((a) => !a)) this.setOver('win');
  }

  setOver(result) {
    this.over = result;
    this.onOver?.(result);
  }
}
