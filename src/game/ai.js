// ============================================================================
// The opposing commander.
//
// A plain priority AI: keep the economy fed, never float supply-blocked, walk
// a faction build order, keep production buildings busy, research when the army
// can spare the gold, and send escalating waves. It plays by exactly the same
// rules as you do — difficulty only changes its income trickle, its reaction
// time and how large a host it gathers before it commits.
// ============================================================================

import { TILE, UNITS, BUILDINGS, UPGRADES, FACTIONS, BUILD_ORDER } from './defs.js';
import { dist, dist2, clamp, TAU, makeRng } from '../core/util.js';
import { isEnemy } from './combat.js';

const BUILD_PLAN = {
  human: ['farm', 'barracks', 'farm', 'lumbermill', 'farm', 'blacksmith', 'barracks',
          'farm', 'tower', 'chapel', 'farm', 'workshop', 'tower', 'farm', 'barracks', 'farm', 'farm'],
  demon: ['soulwell', 'bloodpit', 'soulwell', 'forge', 'soulwell', 'altar', 'bloodpit',
          'soulwell', 'spire', 'hellmouth', 'soulwell', 'spire', 'bloodpit', 'soulwell', 'soulwell'],
};

const ARMY_MIX = {
  human: [['footman', 3], ['archer', 3], ['knight', 2], ['cleric', 1], ['ballista', 1]],
  demon: [['fiend', 4], ['hellhound', 2], ['hellcaster', 2], ['brute', 1], ['warlock', 1]],
};

const RESEARCH_ORDER = {
  human: ['h_weapons', 'h_armor', 'h_arrows', 'h_blessing'],
  demon: ['d_weapons', 'd_hide', 'd_spread', 'd_frenzy'],
};

export class AI {
  constructor(game, player, difficulty) {
    this.g = game;
    this.p = player;
    this.d = difficulty;
    this.rng = makeRng(player.index * 7919 + 17);
    this.timer = this.rng() * 0.5;
    this.waveTimer = difficulty.waveGap * 0.75;
    this.planIndex = 0;
    this.workerTarget = 12;
    this.army = [];
    this.stance = 'grow';
    this.rallyPoint = null;
    this.lastAttack = 0;
    this.scoutSent = false;
  }

  get faction() { return this.p.faction; }

  update(dt) {
    this.timer -= dt;
    this.waveTimer -= dt;
    if (this.d.income > 1) {
      // A gentle handicap trickle rather than a rules exemption.
      this.p.gold += 2.6 * (this.d.income - 1) * dt;
      this.p.wood += 1.4 * (this.d.income - 1) * dt;
    }
    if (this.timer > 0) return;
    this.timer = 0.4 + this.d.reaction * 0.5;
    this.think();
  }

  // ---- helpers -------------------------------------------------------------
  mine(kind, type = null) {
    return this.g.world.entities.filter((e) =>
      !e.dead && e.owner === this.p.index && e.kind === kind && (!type || e.type === type));
  }

  hall() {
    const f = FACTIONS[this.faction];
    return this.mine('building', f.hall).find((b) => b.complete) || this.mine('building', f.hall)[0];
  }

  workers() {
    return this.mine('unit').filter((u) => UNITS[u.type].worker);
  }

  soldiers() {
    return this.mine('unit').filter((u) => !UNITS[u.type].worker);
  }

  hasBuilding(type, completeOnly = true) {
    return this.mine('building', type).some((b) => !completeOnly || b.complete);
  }

  countBuilding(type) { return this.mine('building', type).length; }

  underConstruction(type) { return this.mine('building', type).some((b) => !b.complete); }

  // ---- top level -----------------------------------------------------------
  think() {
    const hall = this.hall();
    if (!hall) return;
    this.manageWorkers(hall);
    this.manageSupply(hall);
    this.manageBuildPlan(hall);
    this.manageProduction();
    this.manageResearch();
    this.manageArmy(hall);
  }

  // ---- economy -------------------------------------------------------------
  manageWorkers(hall) {
    const g = this.g;
    const workers = this.workers();
    const woodNode = FACTIONS[this.faction].woodNode;

    // What is each worker currently assigned to?
    const nodeOf = (u) => (u.order?.type === 'gather' ? u.order.target
      : u.order?.type === 'return' ? u.order.node : null);
    const onGold = [], onWood = [], idle = [];
    for (const u of workers) {
      if (u.order?.type === 'build' || u.order?.type === 'repair') continue;
      if (!u.order && !u.orders.length) { idle.push(u); continue; }
      const t = nodeOf(u);
      if (!t) continue;
      if (t.type === 'goldmine') onGold.push(u); else onWood.push(u);
    }

    const assign = (u, kind) => {
      let node = g.findNearestResource(u, kind);
      if (!node) node = g.findNearestResource(u, kind === 'goldmine' ? woodNode : 'goldmine');
      if (node) g.orderGather([u], node, false);
      return !!node;
    };

    // Desired split. Lumber/brimstone is only ever a means to an end, so the
    // share collapses once we are sitting on a pile of it.
    let woodShare = 0.34;
    if (this.p.wood < 150) woodShare = 0.45;
    if (this.p.wood > 600 && this.p.gold < 400) woodShare = 0.12;
    else if (this.p.wood > 900) woodShare = 0.15;
    // Gold buys everything, including more workers, so never starve it.
    if (this.p.gold < 200) woodShare = Math.min(woodShare, 0.12);

    const gathering = onGold.length + onWood.length + idle.length;
    const wantWood = clamp(Math.round(gathering * woodShare), 0, Math.max(0, gathering - 2));

    for (const u of idle) assign(u, onWood.length < wantWood ? woodNode : 'goldmine');

    // Actively move workers between resources. A gatherer never goes idle on
    // its own, so without this the first assignment would be permanent.
    this.rebalanceCd = (this.rebalanceCd || 0) - 1;
    if (this.rebalanceCd <= 0) {
      const surplusWood = onWood.length - wantWood;
      const movable = (list) => list.filter((u) => !u.carrying);
      if (surplusWood >= 2) {
        for (const u of movable(onWood).slice(0, 2)) assign(u, 'goldmine');
        this.rebalanceCd = 6;
      } else if (surplusWood <= -2) {
        for (const u of movable(onGold).slice(0, 2)) assign(u, woodNode);
        this.rebalanceCd = 6;
      }
    }
  }

  manageSupply(hall) {
    const f = FACTIONS[this.faction];
    const sup = f.supplyBuilding;
    const headroom = this.p.supplyMax - this.p.supply;
    const pending = this.mine('building', sup).filter((b) => !b.complete).length;
    if (this.p.supplyMax < 90 && headroom + pending * 6 < 8) {
      this.tryBuild(sup, hall);
    }
  }

  manageBuildPlan(hall) {
    const plan = BUILD_PLAN[this.faction];
    if (this.planIndex >= plan.length) return;
    // don't start a third simultaneous site
    if (this.mine('building').filter((b) => !b.complete).length >= 2) return;
    const next = plan[this.planIndex];
    const bd = BUILDINGS[next];
    // Only advance once the tech gate is genuinely open.
    if (bd.requires && !this.hasBuilding(bd.requires)) {
      const alt = plan.findIndex((t, i) => i > this.planIndex && (!BUILDINGS[t].requires || this.hasBuilding(BUILDINGS[t].requires)));
      if (alt < 0) return;
    }
    const scarcity = this.g.time < 120 * this.d.techDelay ? 1.0 : 1.25;
    if (this.p.gold < bd.cost.gold * scarcity || this.p.wood < bd.cost.wood * scarcity) return;
    if (this.tryBuild(next, hall)) this.planIndex++;
  }

  tryBuild(type, hall) {
    const g = this.g;
    const bd = BUILDINGS[type];
    if (!g.affordable(this.p, bd.cost)) return false;
    if (!g.requirementMet(this.p, type)) return false;
    const spot = this.findBuildSpot(type, hall);
    if (!spot) return false;
    const worker = this.pickBuilder(spot);
    if (!worker) return false;
    return !!g.placeBuilding(type, spot[0], spot[1], [worker], this.p.index);
  }

  pickBuilder(spot) {
    const workers = this.workers();
    if (!workers.length) return null;
    const px = (spot[0] + 1) * TILE, py = (spot[1] + 1) * TILE;
    // prefer one that isn't mid-haul
    let best = null, bestD = Infinity;
    for (const u of workers) {
      if (u.order?.type === 'build') continue;
      const penalty = u.carrying ? TILE * 12 : 0;
      const d = dist(u.x, u.y, px, py) + penalty;
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  findBuildSpot(type, hall) {
    const g = this.g;
    const bd = BUILDINGS[type];
    const isDefensive = !!bd.attack;
    let ox = hall.tx, oy = hall.ty;
    if (isDefensive) {
      // put towers between the base and the enemy
      const foe = this.enemyBase();
      if (foe) {
        const a = Math.atan2(foe.y - hall.y, foe.x - hall.x);
        ox = Math.round(hall.tx + Math.cos(a) * 7);
        oy = Math.round(hall.ty + Math.sin(a) * 7);
      }
    }
    for (let ring = 2; ring < 16; ring++) {
      const tries = 8 + ring * 3;
      for (let i = 0; i < tries; i++) {
        const a = (i / tries) * TAU + ring * 0.7 + this.rng() * 0.4;
        const tx = Math.round(ox + Math.cos(a) * ring * 1.7);
        const ty = Math.round(oy + Math.sin(a) * ring * 1.7);
        if (!g.canPlace(type, tx, ty, this.p.index).ok) continue;
        // keep a lane open around the hall so workers can get out
        if (dist2(tx, ty, hall.tx, hall.ty) < 9) continue;
        // ...and never butt two structures together. Without a one-tile gap
        // the base packs solid and seals its own workers into dead pockets.
        if (!this.hasClearance(type, tx, ty)) continue;
        return [tx, ty];
      }
    }
    return null;
  }

  /**
   * True if this footprint leaves the ground around it walkable.
   *
   * Two separate rules, both learned the hard way:
   *  - never butt two structures together, or the base packs solid;
   *  - never plug the last gap in a corridor. A building dropped beside a tree
   *    line or a cliff can seal a pocket even with a legal gap on every side,
   *    which strands whatever is inside it.
   */
  hasClearance(type, tx, ty) {
    const w = this.g.world;
    const size = BUILDINGS[type].size;
    let ring = 0, open = 0;
    for (let y = ty - 1; y <= ty + size; y++) {
      for (let x = tx - 1; x <= tx + size; x++) {
        if (!w.inBounds(x, y)) return false;
        if (x >= tx && x < tx + size && y >= ty && y < ty + size) continue;
        ring++;
        const occ = w.occupant[y * w.w + x];
        if (occ) {
          const e = w.byId.get(occ);
          if (e && e.kind === 'building') return false;
        }
        if (!w.isBlocked(x, y)) open++;
      }
    }
    return ring === 0 || open / ring >= 0.55;
  }

  // ---- production ----------------------------------------------------------
  manageProduction() {
    const g = this.g;
    const f = FACTIONS[this.faction];
    const workers = this.workers().length;
    const halls = this.mine('building', f.hall).filter((b) => b.complete);

    // workers first, up to a target
    const target = clamp(10 + Math.floor(this.g.time / 70), 8, this.workerTarget + 8);
    for (const h of halls) {
      if (workers + h.queue.length < target && h.queue.length < 2) g.train(h, f.worker);
    }

    // army from every idle production building
    const mix = ARMY_MIX[this.faction];
    const counts = new Map();
    for (const u of this.soldiers()) counts.set(u.type, (counts.get(u.type) || 0) + 1);
    const totalArmy = this.soldiers().length;
    if (totalArmy >= this.d.maxArmy + 12) return;

    for (const b of this.mine('building')) {
      if (!b.complete || b.queue.length >= 2) continue;
      const bd = BUILDINGS[b.type];
      if (!bd.produces) continue;
      const options = bd.produces.filter((t) => !UNITS[t].worker && g.canTrain(b, t).ok);
      if (!options.length) continue;
      // pick whichever unit is furthest below its share of the mix
      let best = null, bestDeficit = -Infinity;
      for (const t of options) {
        const weight = (mix.find(([m]) => m === t) || [t, 1])[1];
        const share = weight / mix.reduce((s, [, w]) => s + w, 0);
        const have = counts.get(t) || 0;
        const deficit = share * Math.max(totalArmy, 6) - have;
        if (deficit > bestDeficit) { bestDeficit = deficit; best = t; }
      }
      if (best) g.train(b, best);
    }
  }

  manageResearch() {
    const g = this.g;
    if (this.g.time < 150 * this.d.techDelay) return;
    if (this.p.gold < 320) return;
    const order = RESEARCH_ORDER[this.faction];
    for (const id of order) {
      const up = UPGRADES[id];
      if ((this.p.upgrades[id] || 0) >= up.levels) continue;
      if (this.p.researching.has(id)) continue;
      for (const b of this.mine('building')) {
        if (!b.complete || !BUILDINGS[b.type].upgrades?.includes(id)) continue;
        if (b.queue.length) continue;
        if (g.canResearch(b, id).ok) { g.research(b, id); return; }
      }
    }
  }

  // ---- military ------------------------------------------------------------
  enemyBase() {
    const g = this.g;
    let best = null, bestD = Infinity;
    const hall = this.hall();
    if (!hall) return null;
    for (const e of g.world.entities) {
      if (e.dead || e.kind !== 'building' || e.owner < 0 || e.owner === this.p.index) continue;
      const d = dist2(hall.x, hall.y, e.x, e.y);
      const weight = BUILDINGS[e.type].main ? 0.55 : 1;
      if (d * weight < bestD) { bestD = d * weight; best = e; }
    }
    return best;
  }

  threatsNearBase(hall) {
    const out = [];
    const near = this.g.world.near(hall.x, hall.y, TILE * 17, []);
    for (const e of near) {
      if (e.dead || e.owner < 0 || e.owner === this.p.index) continue;
      if (e.kind === 'unit') out.push(e);
    }
    return out;
  }

  manageArmy(hall) {
    const g = this.g;
    const army = this.soldiers();
    const threats = this.threatsNearBase(hall);

    // 1. Defend: everything comes home if the base is under attack.
    if (threats.length) {
      this.stance = 'defend';
      const focus = threats[0];
      for (const u of army) {
        if (u.order?.type === 'attack' && !u.order.target?.dead && dist(u.x, u.y, hall.x, hall.y) < TILE * 22) continue;
        g.orderAttack([u], focus, false);
      }
      // Workers join the defence only as a genuine last stand: the hall itself
      // must be taking damage and the army must be effectively gone. Throwing
      // miners at a raid costs far more than it saves — it used to gut the
      // economy at the exact moment the AI needed to rebuild an army.
      const hallHurt = hall.hp < hall.maxHp * 0.75;
      if (army.length <= 1 && hallHurt) {
        const crew = this.workers()
          .filter((w) => !w.carrying && dist(w.x, w.y, hall.x, hall.y) < TILE * 12)
          .slice(0, 4);
        for (const w of crew) g.orderAttack([w], focus, false);
      }
      return;
    }
    if (this.stance === 'defend') {
      this.stance = 'grow';
      for (const w of this.workers()) {
        if (w.order?.type !== 'attack') continue;
        g.orderStop([w]);
        const node = g.findNearestResource(w, 'goldmine') || g.findNearestResource(w, FACTIONS[this.faction].woodNode);
        if (node) g.orderGather([w], node, false);
      }
    }

    // 2. Scout once, early, so the AI knows where to go.
    if (!this.scoutSent && army.length >= 2) {
      this.scoutSent = true;
      const foe = this.enemyBase();
      if (foe) g.orderAttackMove([army[0]], foe.x, foe.y, false);
    }

    // 3. Gather idle troops at a staging point between base and enemy.
    const foe = this.enemyBase();
    if (!this.rallyPoint && foe) {
      const a = Math.atan2(foe.y - hall.y, foe.x - hall.x);
      this.rallyPoint = { x: hall.x + Math.cos(a) * TILE * 9, y: hall.y + Math.sin(a) * TILE * 9 };
    }
    // Never re-rally mid-assault. Units whose attack order has completed are
    // idle for a frame; pulling them back to a staging point next to our own
    // base makes a committed wave yo-yo home instead of finishing the job.
    const idle = this.stance === 'attack' ? [] : army.filter((u) => !u.order && !u.orders.length);
    if (this.rallyPoint && idle.length) {
      const far = idle.filter((u) => dist(u.x, u.y, this.rallyPoint.x, this.rallyPoint.y) > TILE * 5);
      if (far.length) g.orderMove(far, this.rallyPoint.x, this.rallyPoint.y, false);
    }

    // 4. Commit when the host is big enough, or when the clock says so.
    // The bar must STOP rising: scaled to maxArmy it turtles forever, massing a
    // host it never quite considers ready while both sides sit and mine.
    const threshold = clamp(
      Math.round(5 + this.g.time / (60 / this.d.aggression)),
      4, Math.min(this.d.maxArmy, 16));
    const ready = army.filter((u) => !this.rallyPoint || dist(u.x, u.y, this.rallyPoint.x, this.rallyPoint.y) < TILE * 12);
    if (this.waveTimer <= 0 && ready.length >= Math.min(threshold, 4) && foe) {
      this.waveTimer = this.d.waveGap;
      this.lastAttack = this.g.time;
      this.stance = 'attack';
      const wave = ready.length >= threshold ? army : ready;
      g.orderAttackMove(wave, foe.x, foe.y, false);
      this.rallyPoint = null;
    }

    // 5. Anything that has finished its attack order picks a new target, and a
    // host that is still strong after a wave keeps the pressure on rather than
    // waiting out the full gap.
    if (this.stance === 'attack') {
      for (const u of army) {
        if (u.order || u.orders.length || u.target) continue;
        if (foe) g.orderAttackMove([u], foe.x, foe.y, false);
      }
      if (!army.length) this.stance = 'grow';
      else if (army.length >= threshold * 1.4 && this.waveTimer > 12) this.waveTimer = 12;
    }
  }
}
