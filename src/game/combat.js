// ============================================================================
// Combat maths: upgrade-modified stats, the damage table and hit resolution.
// ============================================================================

import { UNITS, BUILDINGS, UPGRADES, DMG_TABLE, armorReduction, TILE } from './defs.js';
import { clamp } from '../core/util.js';

const FACTION_UP = {
  human: { weapons: 'h_weapons', armor: 'h_armor' },
  demon: { weapons: 'd_weapons', armor: 'd_hide' },
};

export function levelOf(player, id) { return player?.upgrades?.[id] || 0; }

/** Effective combat stats for a unit or an armed structure. */
export function statsOf(e, player) {
  if (e.kind === 'building') {
    const bd = BUILDINGS[e.type];
    const atk = bd.attack;
    let dmg = atk ? atk.dmg : 0;
    let range = atk ? atk.range : 0;
    let armor = bd.armor;
    if (player && bd.faction === 'human') {
      dmg *= 1 + 0.12 * levelOf(player, 'h_arrows');
      range += 0.6 * levelOf(player, 'h_arrows');
    }
    if (player) armor += 2 * levelOf(player, FACTION_UP[bd.faction].armor) * 0.5;
    return {
      dmg, range, armor, armorType: bd.armorType,
      dmgType: atk ? atk.dmgType : 'normal', cd: atk ? atk.cd : 1,
      speed: 0, sight: bd.sight, splash: 0,
    };
  }

  const d = UNITS[e.type];
  const up = FACTION_UP[d.faction];
  let dmg = d.dmg;
  let armor = d.armor;
  let range = d.range;
  let speed = d.speed;
  let cd = d.cd;

  if (player) {
    dmg *= 1 + 0.12 * levelOf(player, up.weapons);
    armor += 2 * levelOf(player, up.armor);
    if (d.faction === 'human' && d.tags?.includes('ranged')) {
      const lv = levelOf(player, 'h_arrows');
      dmg *= 1 + 0.12 * lv;
      range += 0.6 * lv;
    }
    if (d.faction === 'demon' && levelOf(player, 'd_frenzy') && d.tags?.includes('melee')) {
      cd *= 1 / 1.18; speed *= 1.18;
    }
  }
  return { dmg, armor, armorType: d.armorType, dmgType: d.dmgType, range, speed, cd, sight: d.sight, splash: d.splash || 0 };
}

export function healPowerOf(e, player) {
  const d = UNITS[e.type];
  if (!d?.heal) return null;
  const lv = levelOf(player, 'h_blessing');
  return {
    amount: d.heal.amount * (1 + 0.55 * lv),
    cd: d.heal.cd,
    range: d.heal.range,
  };
}

export function maxHpOf(e, player) {
  const d = e.kind === 'building' ? BUILDINGS[e.type] : UNITS[e.type];
  let hp = d.hp;
  if (e.kind === 'unit' && d.heal && levelOf(player, 'h_blessing')) hp += 40;
  return hp;
}

/** Regeneration per second, factoring the Legion's corruption. */
export function regenOf(e, player, corruption) {
  const d = UNITS[e.type];
  if (!d) return 0;
  const base = d.regen || 0;
  if (!d.corruptRegen) return base;
  const boost = 1 + 0.9 * levelOf(player, 'd_spread');
  return base + (d.corruptRegen - base) * clamp(corruption, 0, 1) * boost;
}

/**
 * Resolve one hit. Returns the damage actually dealt.
 */
export function computeDamage(attackerStats, defender, defenderStats, defenderDef) {
  const table = DMG_TABLE[attackerStats.dmgType] || DMG_TABLE.normal;
  const mult = table[defenderStats.armorType] ?? 1;
  let dmg = attackerStats.dmg * mult * armorReduction(defenderStats.armor);
  if (attackerStats.bonusVs && defenderDef?.tags) {
    for (const [tag, m] of Object.entries(attackerStats.bonusVs)) {
      if (defenderDef.tags.includes(tag)) dmg *= m;
    }
  }
  return Math.max(1, dmg);
}

export function rangePx(stats, attacker, target) {
  const pad = (attacker.radius || 0) + (target?.kind === 'building' ? (target.size * TILE) / 2 : (target?.radius || 0));
  return stats.range * TILE + pad * 0.85;
}

export function isEnemy(a, b) {
  return a.owner >= 0 && b.owner >= 0 && a.owner !== b.owner;
}

export function isAttackable(e) {
  return !e.dead && (e.kind === 'unit' || e.kind === 'building') && e.owner >= 0;
}
