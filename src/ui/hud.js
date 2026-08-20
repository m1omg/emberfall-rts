// ============================================================================
// The head-up display: resource bar, selection panel, command card, tooltips
// and alerts. All DOM — which is what makes the controls big enough to hit
// with a thumb and lets the layout reflow for a phone in portrait.
// ============================================================================

import {
  TILE, UNITS, BUILDINGS, UPGRADES, FACTIONS, BUILD_ORDER, RESOURCES,
} from '../game/defs.js';
import { getIcon } from '../art/assets.js';
import { statsOf, healPowerOf } from '../game/combat.js';
import { clamp, fmtTime, makeCanvas } from '../core/util.js';

const CARD_SLOTS = 15;

export class Hud {
  constructor(game, refs) {
    this.g = game;
    this.r = refs;
    this.submenu = null;         // 'build' | null
    this.placement = null;       // { type, workers }
    this.sig = '';
    this.buttons = [];
    this.tipTimer = null;
    this.lastRes = { gold: -1, wood: -1, supply: -1, max: -1 };
    this.alertNodes = [];
    this.clockAcc = 0;
    this.bindStatic();
  }

  get me() { return this.g.players[this.g.me]; }
  get faction() { return FACTIONS[this.me.faction]; }

  bindStatic() {
    const r = this.r;
    r.tooltip.addEventListener('pointerdown', () => this.hideTip());
    window.addEventListener('pointerdown', (e) => {
      if (!e.target.closest?.('.cmd')) this.hideTip();
    }, true);
  }

  // =========================================================================
  //  FRAME UPDATE
  // =========================================================================
  update(dt) {
    const g = this.g, p = this.me;
    // resources
    const gold = Math.floor(p.gold), wood = Math.floor(p.wood);
    if (gold !== this.lastRes.gold) {
      this.r.gold.querySelector('span').textContent = gold.toLocaleString();
      this.lastRes.gold = gold;
    }
    if (wood !== this.lastRes.wood) {
      this.r.wood.querySelector('span').textContent = wood.toLocaleString();
      this.lastRes.wood = wood;
    }
    if (p.supply !== this.lastRes.supply || p.supplyMax !== this.lastRes.max) {
      this.r.supply.querySelector('span').textContent = `${p.supply}/${p.supplyMax}`;
      this.r.supply.classList.toggle('warn', p.supply >= p.supplyMax - 1);
      this.lastRes.supply = p.supply; this.lastRes.max = p.supplyMax;
    }
    this.clockAcc += dt;
    if (this.clockAcc > 0.5) { this.clockAcc = 0; this.r.clock.textContent = fmtTime(g.time); }

    const sig = this.selectionSignature();
    if (sig !== this.sig) { this.sig = sig; this.rebuild(); }
    else { this.refreshStates(); this.refreshInfo(); }
  }

  selectionSignature() {
    const sel = this.g.selection;
    const ids = sel.map((e) => e.id).join(',');
    const q = sel.length === 1 && sel[0].kind === 'building'
      ? `${sel[0].queue.length}:${sel[0].complete}:${Object.entries(this.me.upgrades).join('|')}`
      : '';
    return `${ids}#${this.submenu}#${q}#${this.placement?.type || ''}`;
  }

  // =========================================================================
  //  SELECTION PANEL
  // =========================================================================
  refreshInfo() {
    const sel = this.g.selection;
    if (sel.length === 1) {
      const e = sel[0];
      const bar = this.infoBar;
      if (bar) {
        const frac = clamp(e.hp / e.maxHp, 0, 1);
        bar.style.width = `${frac * 100}%`;
        bar.parentElement.classList.toggle('mid', frac <= 0.6 && frac > 0.3);
        bar.parentElement.classList.toggle('low', frac <= 0.3);
      }
      if (this.hpText) this.hpText.textContent = `${Math.ceil(e.hp)}/${Math.round(e.maxHp)}`;
      if (this.prodSlots && e.kind === 'building') {
        e.queue.forEach((job, i) => {
          const node = this.prodSlots[i];
          if (node) node.style.setProperty('--p', `${(job.elapsed / job.time) * 100}%`);
        });
      }
      if (this.amountText && e.kind === 'resource') {
        this.amountText.textContent = `${Math.ceil(e.amount)}`;
      }
    } else if (sel.length > 1) {
      sel.forEach((e, i) => {
        const chip = this.chips?.[i];
        if (!chip) return;
        const frac = clamp(e.hp / e.maxHp, 0, 1);
        chip.bar.style.width = `${frac * 100}%`;
        chip.bar.style.background = frac > 0.6 ? '#22c55e' : frac > 0.3 ? '#f59e0b' : '#ef4444';
      });
    }
  }

  buildInfoPanel() {
    const host = this.r.info;
    host.innerHTML = '';
    this.infoBar = null; this.hpText = null; this.prodSlots = null; this.chips = null; this.amountText = null;
    const sel = this.g.selection;
    if (!sel.length) {
      host.innerHTML = `<div class="selsingle"><div class="selmeta"><div class="selname">${this.faction.name}</div><div class="seldesc">${this.faction.lore} Drag to select, then command.</div></div></div>`;
      return;
    }
    if (sel.length === 1) { this.buildSingleInfo(host, sel[0]); return; }

    const wrap = document.createElement('div');
    wrap.className = 'selgrid';
    this.chips = [];
    sel.slice(0, 36).forEach((e) => {
      const chip = document.createElement('div');
      chip.className = 'selchip';
      const key = e.kind === 'building' ? `building.${e.type}` : e.kind === 'unit' ? `unit.${e.type}` : null;
      if (key) chip.appendChild(this.iconCanvas(key, 40));
      const bar = document.createElement('i');
      chip.appendChild(bar);
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.g.selection = [e];
        this.sig = '';
      });
      wrap.appendChild(chip);
      this.chips.push({ node: chip, bar });
    });
    host.appendChild(wrap);
  }

  buildSingleInfo(host, e) {
    const g = this.g;
    const isRes = e.kind === 'resource';
    const d = isRes ? RESOURCES[e.type] : (e.kind === 'building' ? BUILDINGS[e.type] : UNITS[e.type]);
    const row = document.createElement('div');
    row.className = 'selsingle';

    const portrait = document.createElement('div');
    portrait.className = 'portrait';
    const key = e.kind === 'building' ? `building.${e.type}` : e.kind === 'unit' ? `unit.${e.type}` : null;
    if (key) portrait.appendChild(this.iconCanvas(key, 88));
    else {
      const c = makeCanvas(88, 88);
      const ctx = c.getContext('2d');
      ctx.fillStyle = e.type === 'goldmine' ? '#3a2f18' : e.type === 'tree' ? '#22301f' : '#331410';
      ctx.fillRect(0, 0, 88, 88);
      ctx.fillStyle = e.type === 'goldmine' ? '#f0c46a' : e.type === 'tree' ? '#5d9159' : '#ff6a2a';
      ctx.beginPath(); ctx.arc(44, 44, 22, 0, Math.PI * 2); ctx.fill();
      portrait.appendChild(c);
    }
    row.appendChild(portrait);

    const meta = document.createElement('div');
    meta.className = 'selmeta';
    const name = document.createElement('div');
    name.className = 'selname';
    name.textContent = d.name;
    meta.appendChild(name);

    if (!isRes) {
      const hp = document.createElement('div');
      hp.className = 'hpbar';
      const fill = document.createElement('i');
      hp.appendChild(fill);
      meta.appendChild(hp);
      this.infoBar = fill;

      const stats = document.createElement('div');
      stats.className = 'statrow';
      const p = g.players[e.owner] || null;
      const st = statsOf(e, p);
      const hpSpan = document.createElement('span');
      hpSpan.innerHTML = `<b class="hpnum"></b> hp`;
      stats.appendChild(hpSpan);
      this.hpText = hpSpan.querySelector('.hpnum');
      if (st.dmg > 0) {
        const s = document.createElement('span');
        s.innerHTML = `<b>${Math.round(st.dmg)}</b> ${st.dmgType}`;
        stats.appendChild(s);
      }
      if (st.armor) stats.appendChild(Object.assign(document.createElement('span'), { innerHTML: `<b>${Math.round(st.armor)}</b> armour` }));
      if (st.range > 1.5) stats.appendChild(Object.assign(document.createElement('span'), { innerHTML: `<b>${st.range.toFixed(1)}</b> range` }));
      const heal = e.kind === 'unit' ? healPowerOf(e, p) : null;
      if (heal) stats.appendChild(Object.assign(document.createElement('span'), { innerHTML: `<b>${Math.round(heal.amount)}</b> heal` }));
      if (e.kind === 'unit' && e.carrying) {
        stats.appendChild(Object.assign(document.createElement('span'), { innerHTML: `carrying <b>${e.carrying.amount}</b> ${e.carrying.type === 'gold' ? 'gold' : this.faction.woodName.toLowerCase()}` }));
      }
      meta.appendChild(stats);

      const desc = document.createElement('div');
      desc.className = 'seldesc';
      desc.textContent = d.desc || '';
      meta.appendChild(desc);

      if (e.kind === 'building' && e.queue.length) {
        const pr = document.createElement('div');
        pr.className = 'prodrow';
        this.prodSlots = [];
        e.queue.forEach((job, i) => {
          const slot = document.createElement('div');
          slot.className = 'prodslot';
          const ik = job.kind === 'unit' ? `unit.${job.type}` : `upgrade.${job.type}`;
          slot.appendChild(this.iconCanvas(ik, 34));
          const ring = document.createElement('div');
          ring.className = 'ring';
          slot.appendChild(ring);
          slot.title = 'Cancel';
          slot.addEventListener('click', (ev) => { ev.stopPropagation(); g.cancelJob(e, i); this.sig = ''; });
          pr.appendChild(slot);
          this.prodSlots.push(ring);
        });
        meta.appendChild(pr);
      }
    } else {
      const stats = document.createElement('div');
      stats.className = 'statrow';
      const s = document.createElement('span');
      s.innerHTML = `<b class="amt"></b> remaining`;
      stats.appendChild(s);
      this.amountText = s.querySelector('.amt');
      stats.appendChild(Object.assign(document.createElement('span'), { innerHTML: `<b>${e.harvesters}/${e.slots}</b> working` }));
      meta.appendChild(stats);
      const desc = document.createElement('div');
      desc.className = 'seldesc';
      desc.textContent = e.type === 'goldmine'
        ? 'Send workers here for gold. Only a few can dig at once.'
        : e.type === 'tree' ? 'Timber for the Kingdom. The Legion cannot use it — but its corruption will turn it to brimstone.'
        : 'Brimstone for the Legion. The Kingdom has no use for it.';
      meta.appendChild(desc);
    }

    row.appendChild(meta);
    host.appendChild(row);
    this.refreshInfo();
  }

  iconCanvas(key, size) {
    const c = makeCanvas(size, size);
    const src = getIcon(key);
    if (src) c.getContext('2d').drawImage(src, 0, 0, size, size);
    return c;
  }

  // =========================================================================
  //  COMMAND CARD
  // =========================================================================
  rebuild() {
    this.buildInfoPanel();
    this.buildCard();
  }

  cardModel() {
    const g = this.g, p = this.me;
    const sel = g.selection.filter((e) => e.owner === g.me);
    const out = [];
    if (!sel.length) return out;

    const units = sel.filter((e) => e.kind === 'unit');
    const buildings = sel.filter((e) => e.kind === 'building');

    // ---- build submenu ----
    if (this.submenu === 'build' && units.some((u) => UNITS[u.type].worker)) {
      for (const type of BUILD_ORDER[p.faction]) {
        const bd = BUILDINGS[type];
        const req = bd.requires && !g.requirementMet(p, type);
        out.push({
          key: `b.${type}`, icon: `building.${type}`, hotkey: bd.hotkey,
          title: bd.name, desc: bd.desc, cost: bd.cost, time: bd.buildTime,
          reqText: req ? `Requires ${BUILDINGS[bd.requires].name}` : null,
          disabled: req || !g.affordable(p, bd.cost),
          armed: this.placement?.type === type,
          onClick: () => this.beginPlacement(type, units.filter((u) => UNITS[u.type].worker)),
        });
      }
      out.push({
        key: 'back', icon: 'cmd.back', hotkey: 'Esc', title: 'Back',
        desc: 'Return to the unit commands.',
        onClick: () => { this.submenu = null; this.cancelPlacement(); this.sig = ''; },
      });
      return out;
    }

    // ---- units ----
    if (units.length) {
      const anyWorker = units.some((u) => UNITS[u.type].worker);
      out.push(
        { key: 'move', icon: 'cmd.move', hotkey: 'M', title: 'Move', desc: 'Walk to a point without seeking a fight.', onClick: () => this.armGround('move') },
        { key: 'stop', icon: 'cmd.stop', hotkey: 'S', title: 'Stop', desc: 'Drop every order, including the queue.', onClick: () => g.orderStop(units) },
        { key: 'attack', icon: 'cmd.attack', hotkey: 'A', title: 'Attack', desc: 'Advance and engage anything on the way.', onClick: () => this.armGround('attack') },
        { key: 'hold', icon: 'cmd.hold', hotkey: 'H', title: 'Hold position', desc: 'Stand fast and shoot what comes into range.', onClick: () => g.orderHold(units) },
        { key: 'patrol', icon: 'cmd.patrol', hotkey: 'P', title: 'Patrol', desc: 'March between here and there, fighting on sight.', onClick: () => this.armGround('patrol') },
      );
      if (anyWorker) {
        out.push({
          key: 'build', icon: 'cmd.build', hotkey: 'B', title: 'Build',
          desc: 'Raise a structure. The Legion only needs to start the summoning.',
          onClick: () => { this.submenu = 'build'; this.sig = ''; },
        });
        out.push({ key: 'gather', icon: 'cmd.gather', hotkey: 'G', title: 'Gather', desc: 'Return to the nearest untapped resource.', onClick: () => this.gatherNearest(units) });
        if (this.faction.canRepair) {
          out.push({ key: 'repair', icon: 'cmd.repair', hotkey: 'R', title: 'Repair', desc: 'Mend a damaged structure for a fraction of its cost.', onClick: () => this.armGround('repair') });
        }
      }
      return out;
    }

    // ---- one building ----
    if (buildings.length === 1) {
      const b = buildings[0];
      const bd = BUILDINGS[b.type];
      if (!b.complete) {
        out.push({ key: 'cancel', icon: 'cmd.cancel', hotkey: 'Esc', title: 'Cancel construction', desc: 'Tear down the site and recover most of the cost.', onClick: () => { g.cancelBuilding(b); this.sig = ''; } });
        return out;
      }
      for (const t of bd.produces || []) {
        const u = UNITS[t];
        const check = g.canTrain(b, t);
        out.push({
          key: `t.${t}`, icon: `unit.${t}`, hotkey: u.hotkey, title: u.name, desc: u.desc,
          cost: u.cost, supply: u.supply, time: u.buildTime,
          reqText: u.requires && !g.requirementMet(p, t) ? `Requires ${BUILDINGS[u.requires].name}` : null,
          disabled: !check.ok, reason: check.why,
          onClick: () => { g.train(b, t); this.sig = ''; },
        });
      }
      for (const id of bd.upgrades || []) {
        const up = UPGRADES[id];
        const lv = p.upgrades[id] || 0;
        const check = g.canResearch(b, id);
        out.push({
          key: `u.${id}`, icon: `upgrade.${id}`, hotkey: up.hotkey,
          title: up.levels > 1 ? `${up.name} ${romanize(Math.min(lv + 1, up.levels))}` : up.name,
          desc: up.desc, cost: up.cost[Math.min(lv, up.levels - 1)], time: up.time[Math.min(lv, up.levels - 1)],
          disabled: !check.ok, reason: check.why,
          level: lv, maxLevel: up.levels,
          onClick: () => { g.research(b, id); this.sig = ''; },
        });
      }
      if (bd.produces?.length) {
        out.push({ key: 'rally', icon: 'cmd.rally', hotkey: 'Y', title: 'Set rally point', desc: 'New units head here. Point it at a mine and they will start working.', onClick: () => this.armGround('rally') });
      }
      return out;
    }

    // ---- several buildings ----
    if (buildings.length > 1) {
      out.push({ key: 'rally', icon: 'cmd.rally', hotkey: 'Y', title: 'Set rally point', desc: 'Applies to every selected structure.', onClick: () => this.armGround('rally') });
    }
    return out;
  }

  buildCard() {
    const host = this.r.card;
    host.innerHTML = '';
    this.buttons = [];
    const model = this.cardModel();
    const slots = Math.max(CARD_SLOTS, Math.ceil(model.length / 5) * 5);
    for (let i = 0; i < slots; i++) {
      const m = model[i];
      const btn = document.createElement('button');
      btn.className = 'cmd' + (m ? '' : ' empty');
      if (!m) { host.appendChild(btn); continue; }
      btn.appendChild(this.iconCanvas(m.icon, 46));
      if (m.hotkey) {
        const hk = document.createElement('span');
        hk.className = 'hk'; hk.textContent = m.hotkey;
        btn.appendChild(hk);
      }
      if (m.cost) {
        const cost = document.createElement('span');
        cost.className = 'cost';
        cost.innerHTML =
          `<span class="g">${m.cost.gold || 0}</span>` +
          (m.cost.wood ? `<span class="w">${m.cost.wood}</span>` : '');
        btn.appendChild(cost);
      }
      if (m.level !== undefined && m.maxLevel > 1) {
        const lv = document.createElement('span');
        lv.className = 'hk'; lv.style.left = '4px'; lv.style.right = 'auto';
        lv.textContent = `${m.level}/${m.maxLevel}`;
        btn.appendChild(lv);
      }
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (btn.classList.contains('disabled')) { this.showTipFor(btn, m); return; }
        m.onClick();
      });
      this.attachTip(btn, m);
      host.appendChild(btn);
      this.buttons.push({ node: btn, model: m });
    }
    this.refreshStates();
  }

  refreshStates() {
    const g = this.g, p = this.me;
    for (const { node, model } of this.buttons) {
      let disabled = false, armed = false;
      if (model.key.startsWith('b.')) {
        const type = model.key.slice(2);
        const bd = BUILDINGS[type];
        disabled = !g.affordable(p, bd.cost) || (bd.requires && !g.requirementMet(p, type));
        armed = this.placement?.type === type;
      } else if (model.key.startsWith('t.')) {
        disabled = !g.canTrain(g.selection[0], model.key.slice(2)).ok;
      } else if (model.key.startsWith('u.')) {
        disabled = !g.canResearch(g.selection[0], model.key.slice(2)).ok;
      } else if (model.armedKey) {
        armed = this.armed === model.armedKey;
      }
      if (this.armed && model.key === this.armed) armed = true;
      node.classList.toggle('disabled', !!disabled);
      node.classList.toggle('armed', !!armed);
      const cost = node.querySelector('.cost');
      if (cost && model.cost) {
        cost.querySelector('.g')?.classList.toggle('lack', p.gold < (model.cost.gold || 0));
        cost.querySelector('.w')?.classList.toggle('lack', p.wood < (model.cost.wood || 0));
      }
    }
  }

  // =========================================================================
  //  ARMED GROUND COMMANDS + PLACEMENT
  // =========================================================================
  armGround(kind) {
    this.armed = kind;
    this.cancelPlacement();
    this.sig = '';
    this.r.canvas.style.cursor = 'crosshair';
  }

  clearArmed() {
    this.armed = null;
    this.r.canvas.style.cursor = '';
    this.sig = '';
  }

  beginPlacement(type, workers) {
    this.placement = { type, workers: workers.slice() };
    this.armed = null;
    this.sig = '';
    this.r.canvas.style.cursor = 'crosshair';
  }

  cancelPlacement() {
    if (this.placement) { this.placement = null; this.r.canvas.style.cursor = ''; this.sig = ''; }
  }

  gatherNearest(units) {
    const g = this.g;
    for (const u of units) {
      if (!UNITS[u.type].worker) continue;
      const gold = g.findNearestResource(u, 'goldmine');
      const wood = g.findNearestResource(u, this.faction.woodNode);
      const pick = !gold ? wood : !wood ? gold
        : (Math.hypot(gold.x - u.x, gold.y - u.y) <= Math.hypot(wood.x - u.x, wood.y - u.y) * 1.25 ? gold : wood);
      if (pick) g.orderGather([u], pick, false);
    }
  }

  /** Called by main when the player clicks the world with something armed. */
  consumeGroundClick(wx, wy, queue) {
    const g = this.g;
    const units = g.selection.filter((e) => e.owner === g.me && e.kind === 'unit');
    const kind = this.armed;
    if (!kind) return false;
    switch (kind) {
      case 'move': g.orderMove(units, wx, wy, queue); break;
      case 'attack': {
        const t = g.entityAtPoint(wx, wy);
        if (t && t.owner >= 0 && t.owner !== g.me) g.orderAttack(units, t, queue);
        else g.orderAttackMove(units, wx, wy, queue);
        break;
      }
      case 'patrol': g.orderPatrol(units, wx, wy, queue); break;
      case 'repair': {
        const t = g.entityAtPoint(wx, wy);
        if (t && t.kind === 'building' && t.owner === g.me) g.orderRepair(units, t, queue);
        break;
      }
      case 'rally': {
        g.setRally(g.selection.filter((e) => e.kind === 'building'), wx, wy);
        break;
      }
      default: break;
    }
    if (!queue) this.clearArmed();
    return true;
  }

  // =========================================================================
  //  TOOLTIPS
  // =========================================================================
  attachTip(node, model) {
    node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.showTipFor(node, model); });
    node.addEventListener('pointerleave', () => this.hideTip());
    let t;
    node.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      t = setTimeout(() => this.showTipFor(node, model), 420);
    });
    const clear = () => clearTimeout(t);
    node.addEventListener('pointerup', clear);
    node.addEventListener('pointercancel', clear);
    node.addEventListener('pointermove', clear);
  }

  showTipFor(node, m) {
    const tip = this.r.tooltip;
    const wood = this.faction.woodName;
    let html = `<h4>${m.title}</h4>`;
    if (m.cost || m.supply || m.time) {
      html += '<div class="tt-cost">';
      if (m.cost?.gold) html += `<span class="g">${m.cost.gold} gold</span>`;
      if (m.cost?.wood) html += `<span class="w">${m.cost.wood} ${wood.toLowerCase()}</span>`;
      if (m.supply) html += `<span class="s">${m.supply} supply</span>`;
      if (m.time) html += `<span>${Math.round(m.time)}s</span>`;
      html += '</div>';
    }
    if (m.desc) html += `<p>${m.desc}</p>`;
    if (m.key?.startsWith('t.')) {
      const u = UNITS[m.key.slice(2)];
      const st = statsOf({ kind: 'unit', type: u.id, radius: u.radius }, this.me);
      html += `<div class="tt-stats"><span><b>${Math.round(u.hp)}</b> hp</span><span><b>${Math.round(st.dmg)}</b> dmg</span>`
        + `<span><b>${Math.round(st.armor)}</b> armour</span><span><b>${st.range.toFixed(1)}</b> range</span></div>`;
    }
    if (m.reqText) html += `<div class="tt-req">${m.reqText}</div>`;
    else if (m.reason && node.classList.contains('disabled')) html += `<div class="tt-req">${m.reason}</div>`;
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const r = node.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2;
    let y = r.top - tr.height - 10;
    x = clamp(x, 8, window.innerWidth - tr.width - 8);
    if (y < 8) y = r.bottom + 10;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  hideTip() { this.r.tooltip.classList.add('hidden'); }

  // =========================================================================
  //  ALERTS
  // =========================================================================
  alert(text, tone) {
    const node = document.createElement('div');
    node.className = `alert ${tone || ''}`;
    node.textContent = text;
    this.r.alerts.appendChild(node);
    setTimeout(() => { node.classList.add('out'); setTimeout(() => node.remove(), 420); }, 2600);
    while (this.r.alerts.children.length > 4) this.r.alerts.firstChild.remove();
  }

  // =========================================================================
  //  HOTKEYS
  // =========================================================================
  handleKey(k, mods) {
    const g = this.g;
    if (k === 'escape') {
      if (this.placement) { this.cancelPlacement(); return true; }
      if (this.armed) { this.clearArmed(); return true; }
      if (this.submenu) { this.submenu = null; this.sig = ''; return true; }
      return false;
    }
    // command card hotkeys
    for (const { node, model } of this.buttons) {
      if (!model.hotkey || model.hotkey.length !== 1) continue;
      if (model.hotkey.toLowerCase() !== k) continue;
      if (node.classList.contains('disabled')) { this.showTipFor(node, model); return true; }
      model.onClick();
      return true;
    }
    return false;
  }
}

function romanize(n) { return ['', 'I', 'II', 'III', 'IV'][n] || String(n); }
