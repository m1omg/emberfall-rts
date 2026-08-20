// ============================================================================
// Emberfall — faction data.
//
// The two sides share a skeleton (workers, halls, supply, three tiers of army)
// but almost nothing else:
//
//   KINGDOM OF ALDERMARCH  gold + lumber, workers haul resources home on foot,
//                          buildings are raised by an occupied peasant and can
//                          be REPAIRED, clerics HEAL, guard towers hold ground.
//                          Wins by out-ranging and out-lasting.
//
//   THE EMBER LEGION       gold + brimstone, imps BLINK their load home, so
//                          distance costs them little. Structures must sit on
//                          CORRUPTION, which spreads from them, REGENERATES the
//                          host standing on it, and slowly heals their buildings.
//                          Imps only start a summoning; the structure finishes
//                          itself. Wins by speed, swarm and splash.
// ============================================================================

export const TILE = 32;

// --- damage model -----------------------------------------------------------
// attack type x armour type multiplier, then a flat armour reduction.
export const ARMOR_TYPES = ['unarmored', 'light', 'heavy', 'fortified'];
export const DMG_TABLE = {
  normal: { unarmored: 1.00, light: 1.00, heavy: 1.00, fortified: 0.60 },
  pierce: { unarmored: 1.25, light: 1.15, heavy: 0.80, fortified: 0.45 },
  siege:  { unarmored: 0.75, light: 0.75, heavy: 0.85, fortified: 1.90 },
  magic:  { unarmored: 1.20, light: 1.25, heavy: 0.95, fortified: 0.45 },
};

export function armorReduction(armor) {
  // Diminishing, never total: 6% per point, floored at 25% damage taken.
  return Math.max(0.25, 1 - (armor * 0.06) / (1 + armor * 0.012));
}

// --- factions ---------------------------------------------------------------
export const FACTIONS = {
  human: {
    id: 'human',
    name: 'Kingdom of Aldermarch',
    short: 'Aldermarch',
    adjective: 'Kingdom',
    woodName: 'Lumber',
    woodNode: 'tree',
    worker: 'peasant',
    hall: 'townhall',
    supplyBuilding: 'farm',
    color: '#5b8ede',
    colorDark: '#28457a',
    accent: '#e8c46a',
    banner: '#c2503c',
    corrupts: false,
    canRepair: true,
    lore: 'Disciplined ranks, arrow-lines and battle-clerics.',
  },
  demon: {
    id: 'demon',
    name: 'The Ember Legion',
    short: 'Ember Legion',
    adjective: 'Legion',
    woodName: 'Brimstone',
    woodNode: 'brimstone',
    worker: 'imp',
    hall: 'nethergate',
    supplyBuilding: 'soulwell',
    color: '#e0503a',
    colorDark: '#5c1a20',
    accent: '#ff9a3c',
    banner: '#8a2be2',
    corrupts: true,
    canRepair: false,
    lore: 'A tide of horns and cinders that regrows on the ground it ruins.',
  },
};

// ============================================================================
//  UNITS
// ============================================================================
// hp, armor, armorType, dmg, dmgType, cd (seconds between swings), range (tiles),
// speed (px/s), sight (tiles), radius (px), cost, supply, buildTime (s).
export const UNITS = {
  // ---------------------------- Aldermarch ----------------------------------
  peasant: {
    id: 'peasant', faction: 'human', name: 'Peasant', hotkey: 'P',
    desc: 'Backbone of the realm. Mines gold, fells timber, raises and repairs every structure.',
    hp: 60, armor: 0, armorType: 'unarmored', dmg: 5, dmgType: 'normal', cd: 1.4, range: 0.9,
    speed: 64, sight: 6, radius: 8, cost: { gold: 50, wood: 0 }, supply: 1, buildTime: 14,
    worker: true, carry: 10, gatherTime: 1.5, from: 'townhall',
    tags: ['worker'],
  },
  footman: {
    id: 'footman', faction: 'human', name: 'Footman', hotkey: 'F',
    desc: 'Shield-bearing line infantry. Cheap, stubborn, and the wall everything else fights behind.',
    hp: 240, armor: 3, armorType: 'heavy', dmg: 13, dmgType: 'normal', cd: 1.1, range: 1.0,
    speed: 66, sight: 7, radius: 9, cost: { gold: 60, wood: 10 }, supply: 2, buildTime: 16,
    from: 'barracks', tags: ['melee'],
  },
  archer: {
    id: 'archer', faction: 'human', name: 'Archer', hotkey: 'A',
    desc: 'Longbows from the border woods. Devastating behind a line, helpless in front of one.',
    hp: 130, armor: 1, armorType: 'light', dmg: 12, dmgType: 'pierce', cd: 1.25, range: 6.2,
    speed: 68, sight: 9, radius: 8, cost: { gold: 70, wood: 30 }, supply: 2, buildTime: 18,
    from: 'barracks', requires: 'lumbermill', projectile: 'arrow', tags: ['ranged'],
  },
  knight: {
    id: 'knight', faction: 'human', name: 'Knight', hotkey: 'K',
    desc: 'Heavy horse in full plate. Arrives before the enemy has decided what to do about it.',
    hp: 480, armor: 6, armorType: 'heavy', dmg: 24, dmgType: 'normal', cd: 1.3, range: 1.2,
    speed: 106, sight: 7, radius: 11, cost: { gold: 130, wood: 45 }, supply: 4, buildTime: 24,
    from: 'barracks', requires: 'blacksmith', tags: ['melee'],
  },
  cleric: {
    id: 'cleric', faction: 'human', name: 'Cleric', hotkey: 'C',
    desc: 'Mends the wounded without being told to, and burns what does not bleed.',
    hp: 120, armor: 0, armorType: 'light', dmg: 9, dmgType: 'magic', cd: 1.6, range: 4.6,
    speed: 66, sight: 9, radius: 8, cost: { gold: 100, wood: 45 }, supply: 2, buildTime: 20,
    from: 'chapel', projectile: 'holy', heal: { amount: 16, cd: 1.4, range: 5.6 }, tags: ['ranged', 'support'],
  },
  ballista: {
    id: 'ballista', faction: 'human', name: 'Ballista', hotkey: 'B',
    desc: 'A siege engine that unmakes walls at range. Slow, fragile, and worth escorting.',
    hp: 260, armor: 2, armorType: 'heavy', dmg: 58, dmgType: 'siege', cd: 3.2, range: 9.0,
    speed: 44, sight: 9, radius: 12, cost: { gold: 180, wood: 110 }, supply: 4, buildTime: 28,
    from: 'workshop', projectile: 'bolt', splash: 1.4, tags: ['siege'],
  },

  // ---------------------------- Ember Legion --------------------------------
  imp: {
    id: 'imp', faction: 'demon', name: 'Imp', hotkey: 'I',
    desc: 'Claws gold and brimstone loose, then BLINKS the load home — distance means nothing to it.',
    hp: 55, armor: 0, armorType: 'unarmored', dmg: 5, dmgType: 'normal', cd: 1.3, range: 0.9,
    speed: 74, sight: 6, radius: 8, cost: { gold: 45, wood: 0 }, supply: 1, buildTime: 13,
    // Balance: an imp never walks its load home, so its rate is CONSTANT with
    // distance. Tuned so a peasant out-earns it at a close mine (~2.2/s vs
    // 1.3/s) and falls behind past roughly six tiles. The Legion's economy
    // buys distance-insensitivity, not raw throughput.
    worker: true, carry: 8, gatherTime: 4.2, blinkReturn: 1.9, from: 'nethergate',
    tags: ['worker'],
  },
  fiend: {
    id: 'fiend', faction: 'demon', name: 'Fiend', hotkey: 'F',
    desc: 'Cheap, quick and endless. Knits itself back together on corrupted ground.',
    // Balance: a footman beats a fiend one-on-one and always will. The Legion
    // pays HALF the supply for it, so the same farm-count fields twice the
    // bodies — glass cannons that out-damage per supply but die faster.
    hp: 150, armor: 1, armorType: 'heavy', dmg: 11, dmgType: 'normal', cd: 0.95, range: 1.0,
    speed: 88, sight: 7, radius: 9, cost: { gold: 45, wood: 5 }, supply: 1, buildTime: 12,
    from: 'bloodpit', regen: 0.6, corruptRegen: 3.0, tags: ['melee'],
  },
  hellhound: {
    id: 'hellhound', faction: 'demon', name: 'Hellhound', hotkey: 'H',
    desc: 'A raider bred for the flank. Outruns everything and eats workers alive.',
    hp: 210, armor: 2, armorType: 'light', dmg: 15, dmgType: 'normal', cd: 1.0, range: 1.0,
    speed: 130, sight: 9, radius: 10, cost: { gold: 90, wood: 25 }, supply: 2, buildTime: 20,
    from: 'bloodpit', requires: 'forge', regen: 0.4, corruptRegen: 2.0,
    bonusVs: { worker: 1.5 }, tags: ['melee'],
  },
  hellcaster: {
    id: 'hellcaster', faction: 'demon', name: 'Hellcaster', hotkey: 'C',
    desc: 'Hurls a bursting cinder. Punishes anything that clumps up — including your own line.',
    hp: 120, armor: 0, armorType: 'light', dmg: 16, dmgType: 'magic', cd: 1.7, range: 5.6,
    speed: 62, sight: 9, radius: 8, cost: { gold: 85, wood: 45 }, supply: 2, buildTime: 21,
    from: 'hellmouth', projectile: 'fireball', splash: 1.15, regen: 0.4, corruptRegen: 2.0,
    tags: ['ranged'],
  },
  brute: {
    id: 'brute', faction: 'demon', name: 'Brute', hotkey: 'B',
    desc: 'Two tonnes of horn and ash. Walks through gates, and through the people behind them.',
    hp: 560, armor: 6, armorType: 'heavy', dmg: 34, dmgType: 'siege', cd: 1.9, range: 1.4,
    speed: 58, sight: 7, radius: 14, cost: { gold: 160, wood: 80 }, supply: 4, buildTime: 30,
    from: 'hellmouth', requires: 'altar', regen: 0.8, corruptRegen: 3.6, splash: 0.9,
    tags: ['melee', 'siege'],
  },
  warlock: {
    id: 'warlock', faction: 'demon', name: 'Warlock', hotkey: 'W',
    desc: 'Every bolt it throws tears life out of a foe and stitches it into the nearest ally.',
    hp: 130, armor: 0, armorType: 'light', dmg: 14, dmgType: 'magic', cd: 1.5, range: 5.2,
    speed: 64, sight: 9, radius: 8, cost: { gold: 105, wood: 55 }, supply: 2, buildTime: 22,
    from: 'altar', projectile: 'drain', drain: 0.85, regen: 0.4, corruptRegen: 2.0,
    tags: ['ranged', 'support'],
  },
};

// ============================================================================
//  BUILDINGS
// ============================================================================
export const BUILDINGS = {
  // ---------------------------- Aldermarch ----------------------------------
  townhall: {
    id: 'townhall', faction: 'human', name: 'Town Hall', hotkey: 'T',
    desc: 'Heart of the realm. Trains peasants and takes in every load of gold and lumber.',
    hp: 1500, armor: 4, armorType: 'fortified', size: 3, sight: 8,
    cost: { gold: 400, wood: 250 }, buildTime: 50,
    produces: ['peasant'], dropoff: ['gold', 'wood'], supply: 5, main: true,
  },
  farm: {
    id: 'farm', faction: 'human', name: 'Farm', hotkey: 'F',
    desc: 'Bread and beds. Each farm supports six more souls under arms.',
    hp: 500, armor: 2, armorType: 'fortified', size: 2, sight: 5,
    cost: { gold: 80, wood: 20 }, buildTime: 14, supply: 6,
  },
  barracks: {
    id: 'barracks', faction: 'human', name: 'Barracks', hotkey: 'B',
    desc: 'Drill yard of the standing army — footmen, archers and, in time, knights.',
    hp: 900, armor: 3, armorType: 'fortified', size: 3, sight: 6,
    cost: { gold: 160, wood: 60 }, buildTime: 26, produces: ['footman', 'archer', 'knight'],
  },
  lumbermill: {
    id: 'lumbermill', faction: 'human', name: 'Lumber Mill', hotkey: 'L',
    desc: 'Takes in timber and turns out better arrows. Unlocks the archer.',
    hp: 700, armor: 2, armorType: 'fortified', size: 3, sight: 6,
    cost: { gold: 120, wood: 40 }, buildTime: 22, dropoff: ['wood'], upgrades: ['h_arrows'],
  },
  blacksmith: {
    id: 'blacksmith', faction: 'human', name: 'Blacksmith', hotkey: 'S',
    desc: 'Iron weapons and plate armour for the whole army. Unlocks the knight.',
    hp: 800, armor: 3, armorType: 'fortified', size: 3, sight: 6,
    cost: { gold: 180, wood: 90 }, buildTime: 28, upgrades: ['h_weapons', 'h_armor'],
  },
  chapel: {
    id: 'chapel', faction: 'human', name: 'Chapel', hotkey: 'C',
    desc: 'Trains clerics, who keep your line standing long after it should have fallen.',
    hp: 650, armor: 2, armorType: 'fortified', size: 3, sight: 7,
    cost: { gold: 200, wood: 120 }, buildTime: 30, produces: ['cleric'], upgrades: ['h_blessing'],
    requires: 'barracks',
  },
  workshop: {
    id: 'workshop', faction: 'human', name: 'Siege Workshop', hotkey: 'W',
    desc: 'Builds ballistae — the only humane way to discuss a fortified wall.',
    hp: 800, armor: 3, armorType: 'fortified', size: 3, sight: 6,
    cost: { gold: 220, wood: 140 }, buildTime: 30, produces: ['ballista'], requires: 'blacksmith',
  },
  tower: {
    id: 'tower', faction: 'human', name: 'Guard Tower', hotkey: 'G',
    desc: 'Holds a crossing you cannot spare troops for. Repair it and it holds forever.',
    hp: 700, armor: 6, armorType: 'fortified', size: 2, sight: 9,
    cost: { gold: 120, wood: 60 }, buildTime: 18, requires: 'lumbermill',
    attack: { dmg: 20, dmgType: 'pierce', cd: 1.15, range: 7.4, projectile: 'arrow' },
  },

  // ---------------------------- Ember Legion --------------------------------
  nethergate: {
    id: 'nethergate', faction: 'demon', name: 'Nether Gate', hotkey: 'T',
    desc: 'The tear the Legion poured through. Spawns imps, swallows tribute, bleeds corruption.',
    hp: 1450, armor: 4, armorType: 'fortified', size: 3, sight: 8,
    cost: { gold: 400, wood: 250 }, buildTime: 50,
    produces: ['imp'], dropoff: ['gold', 'wood'], supply: 5, main: true, corrupt: 9.5,
  },
  soulwell: {
    id: 'soulwell', faction: 'demon', name: 'Soul Well', hotkey: 'S',
    desc: 'A cistern of screaming. Feeds six more of the host — and widens the corruption.',
    hp: 460, armor: 2, armorType: 'fortified', size: 2, sight: 5,
    cost: { gold: 85, wood: 15 }, buildTime: 13, supply: 6, corrupt: 6.0,
  },
  bloodpit: {
    id: 'bloodpit', faction: 'demon', name: 'Blood Pit', hotkey: 'B',
    desc: 'Fiends claw their way out of it faster than you can spend the gold. Hellhounds too, in time.',
    hp: 880, armor: 3, armorType: 'fortified', size: 3, sight: 6,
    cost: { gold: 155, wood: 55 }, buildTime: 25, produces: ['fiend', 'hellhound'], corrupt: 4.5,
  },
  forge: {
    id: 'forge', faction: 'demon', name: 'Brimstone Forge', hotkey: 'R',
    desc: 'Where brimstone is stacked and fangs are sharpened. Unlocks the hound and the hellmouth.',
    hp: 720, armor: 2, armorType: 'fortified', size: 3, sight: 6,
    cost: { gold: 125, wood: 35 }, buildTime: 22, dropoff: ['wood'],
    upgrades: ['d_weapons', 'd_spread'], corrupt: 4.5,
  },
  hellmouth: {
    id: 'hellmouth', faction: 'demon', name: 'Hellmouth', hotkey: 'H',
    desc: 'A throat in the earth. Hellcasters crawl out of it, and brutes tear their way after.',
    hp: 780, armor: 3, armorType: 'fortified', size: 3, sight: 6,
    cost: { gold: 195, wood: 115 }, buildTime: 29, produces: ['hellcaster', 'brute'],
    requires: 'forge', corrupt: 5.0,
  },
  altar: {
    id: 'altar', faction: 'demon', name: 'Sacrificial Altar', hotkey: 'A',
    desc: 'Binds warlocks to the host and thickens every hide in it.',
    hp: 820, armor: 3, armorType: 'fortified', size: 3, sight: 7,
    cost: { gold: 190, wood: 100 }, buildTime: 28, produces: ['warlock'],
    upgrades: ['d_hide', 'd_frenzy'], requires: 'bloodpit', corrupt: 5.0,
  },
  spire: {
    id: 'spire', faction: 'demon', name: 'Bone Spire', hotkey: 'G',
    desc: 'Spits searing bolts at whatever walks too close. Mends itself on corruption.',
    hp: 640, armor: 5, armorType: 'fortified', size: 2, sight: 9,
    cost: { gold: 115, wood: 55 }, buildTime: 17, requires: 'forge', corrupt: 4.0,
    attack: { dmg: 17, dmgType: 'magic', cd: 1.1, range: 7.0, projectile: 'fireball' },
  },
};

// ============================================================================
//  UPGRADES
// ============================================================================
export const UPGRADES = {
  h_weapons: {
    id: 'h_weapons', name: 'Iron Weapons', faction: 'human', hotkey: 'W', levels: 2,
    desc: 'Every blade and bowstring in the realm, reforged. +12% damage per level.',
    cost: [{ gold: 200, wood: 100 }, { gold: 340, wood: 200 }], time: [34, 46],
    effect: { damageMul: 0.12 },
  },
  h_armor: {
    id: 'h_armor', name: 'Plate Armour', faction: 'human', hotkey: 'A', levels: 2,
    desc: 'Riveted plate for the whole standing army. +2 armour per level.',
    cost: [{ gold: 180, wood: 120 }, { gold: 320, wood: 220 }], time: [34, 46],
    effect: { armorAdd: 2 },
  },
  h_arrows: {
    id: 'h_arrows', name: 'Fletched Arrows', faction: 'human', hotkey: 'F', levels: 2,
    desc: 'Longer shafts, truer flight. +0.6 range and +12% damage for archers and towers.',
    cost: [{ gold: 150, wood: 100 }, { gold: 260, wood: 180 }], time: [30, 40],
    effect: { rangeAdd: 0.6, rangedDamageMul: 0.12 }, tags: ['ranged'],
  },
  h_blessing: {
    id: 'h_blessing', name: 'Sanctified Blessing', faction: 'human', hotkey: 'B', levels: 1,
    desc: 'Clerics mend half again as fast and carry more of the Light with them.',
    cost: [{ gold: 250, wood: 150 }], time: [40], effect: { healMul: 0.55, healerHp: 40 },
  },
  d_weapons: {
    id: 'd_weapons', name: 'Ember Fangs', faction: 'demon', hotkey: 'W', levels: 2,
    desc: 'Claws quenched in living fire. +12% damage per level.',
    cost: [{ gold: 200, wood: 100 }, { gold: 340, wood: 200 }], time: [34, 46],
    effect: { damageMul: 0.12 },
  },
  d_hide: {
    id: 'd_hide', name: 'Infernal Hide', faction: 'demon', hotkey: 'A', levels: 2,
    desc: 'Skin fused with slag. +2 armour per level.',
    cost: [{ gold: 180, wood: 120 }, { gold: 320, wood: 220 }], time: [34, 46],
    effect: { armorAdd: 2 },
  },
  d_spread: {
    id: 'd_spread', name: 'Creeping Corruption', faction: 'demon', hotkey: 'C', levels: 1,
    desc: 'The blight runs 45% further from every structure, and knits the host back twice as fast.',
    cost: [{ gold: 220, wood: 130 }], time: [38], effect: { corruptMul: 0.45, regenMul: 0.9 },
  },
  d_frenzy: {
    id: 'd_frenzy', name: 'Blood Frenzy', faction: 'demon', hotkey: 'F', levels: 1,
    desc: 'Fiends and hounds strike and run 18% faster. They will not be told to stop.',
    cost: [{ gold: 240, wood: 140 }], time: [40], effect: { hasteMul: 0.18, hasteTags: ['melee'] },
  },
};

// ============================================================================
//  RESOURCE NODES
// ============================================================================
export const RESOURCES = {
  goldmine: { id: 'goldmine', name: 'Gold Mine', size: 2, amount: 2400, slots: 4, sight: 0 },
  tree:      { id: 'tree', name: 'Ancient Timber', size: 1, amount: 110, slots: 2 },
  brimstone: { id: 'brimstone', name: 'Brimstone Vein', size: 1, amount: 140, slots: 2 },
};

// --- lookups ----------------------------------------------------------------
export const ALL = { ...UNITS, ...BUILDINGS };
export const isUnit = (t) => !!UNITS[t];
export const isBuilding = (t) => !!BUILDINGS[t];
export function def(type) { return ALL[type] || RESOURCES[type]; }

export function buildingsOf(faction) {
  return Object.values(BUILDINGS).filter((b) => b.faction === faction);
}
export function unitsOf(faction) {
  return Object.values(UNITS).filter((u) => u.faction === faction);
}

/** Build menu order shown on a worker's command card. */
export const BUILD_ORDER = {
  human: ['farm', 'barracks', 'lumbermill', 'blacksmith', 'tower', 'chapel', 'workshop', 'townhall'],
  demon: ['soulwell', 'bloodpit', 'forge', 'altar', 'spire', 'hellmouth', 'nethergate'],
};

export const STARTING_RESOURCES = {
  lean:   { gold: 500, wood: 150, workers: 4 },
  normal: { gold: 750, wood: 250, workers: 5 },
  rich:   { gold: 1600, wood: 800, workers: 7 },
};

export const DIFFICULTY = {
  easy:   { name: 'Squire',  income: 1.0,  reaction: 1.0, aggression: 0.55, waveGap: 105, techDelay: 1.45, maxArmy: 16 },
  normal: { name: 'Captain', income: 1.12, reaction: 0.7, aggression: 0.85, waveGap: 78,  techDelay: 1.0,  maxArmy: 26 },
  hard:   { name: 'Warlord', income: 1.35, reaction: 0.45, aggression: 1.15, waveGap: 58, techDelay: 0.78, maxArmy: 40 },
};

export const MAP_SIZES = {
  small:  { w: 72, h: 72, mines: 4, seedOffset: 11 },
  medium: { w: 100, h: 100, mines: 7, seedOffset: 23 },
  large:  { w: 136, h: 136, mines: 11, seedOffset: 41 },
};

export const SUPPLY_CAP = 100;
