// ============================================================================
// The look of the world: colour ramps plus a compact "rig" description for
// every unit and structure. Nothing here draws — art/units.js and
// art/buildings.js read these descriptors and turn them into sprites.
// ============================================================================

export const SKY = {
  ambientTop: 'rgba(255,246,224,0.20)',   // sun comes from the upper-left
  ambientBottom: 'rgba(10,14,28,0.34)',
  rimColor: 'rgba(190,220,255,0.34)',
};

export const GROUND = {
  grass: ['#3d5a44', '#456a4c', '#4e7654', '#37503f'],
  grassLight: '#5b8a60',
  dirt: ['#5a4a38', '#6b5842', '#4c3f30'],
  sand: '#7d6b4c',
  rock: ['#3c4250', '#4b5265', '#2e3340'],
  rockLight: '#697389',
  water: ['#16323f', '#1d4557', '#123043'],
  waterFoam: '#5fa7b8',
  corrupt: ['#241528', '#2f1a2e', '#1a0f1e'],
  corruptCrack: '#ff5a1f',
  corruptGlow: 'rgba(255,90,30,0.30)',
  shadow: 'rgba(6,8,16,0.42)',
};

export const PLAYER_COLORS = {
  human: '#4f86e0',
  demon: '#d8452f',
  alt1: '#3fae86',
  alt2: '#c766d8',
  neutral: '#8a8f9c',
};

// Shared material ramps.
export const MAT = {
  steel: { base: '#8e9cb4', dark: '#4a5468', light: '#cfd9ea' },
  iron: { base: '#6e7688', dark: '#3a404e', light: '#a8b2c4' },
  gold: { base: '#e0ab4c', dark: '#8a6320', light: '#ffe08c' },
  leather: { base: '#7a5638', dark: '#432d1c', light: '#a97a4e' },
  cloth: { base: '#c9c2ae', dark: '#7d7768', light: '#efe9d8' },
  wood: { base: '#8a6a45', dark: '#4d3927', light: '#b99163' },
  bone: { base: '#ded4bd', dark: '#8d8471', light: '#fbf6e6' },
  obsidian: { base: '#2b2130', dark: '#150e19', light: '#4d3d55' },
  ember: { base: '#ff6a2a', dark: '#a32410', light: '#ffcf7a' },
  flesh: { base: '#a83c3c', dark: '#5e1d21', light: '#d9654f' },
  skin: { base: '#d8a882', dark: '#9c7052', light: '#f2cfad' },
  hellskin: { base: '#8c3a3a', dark: '#4a1b1e', light: '#c05a4a' },
  imp: { base: '#7d3a56', dark: '#3f1a2c', light: '#b8628a' },
};

// ---------------------------------------------------------------------------
// UNIT RIGS
// scale     — overall size multiplier (1 ≈ 34px tall)
// build     — 'slim' | 'normal' | 'heavy' | 'huge'
// head      — helmet / head treatment
// weapon    — what the main hand holds
// off       — what the off hand holds
// palette   — material lookups per body part
// extras    — decorative flags
// ---------------------------------------------------------------------------
export const UNIT_ART = {
  peasant: {
    scale: 0.92, build: 'slim', head: 'hood', weapon: 'pick', off: 'none',
    body: MAT.cloth, legs: MAT.leather, trim: MAT.leather, skin: MAT.skin, metal: MAT.iron,
    extras: { satchel: true },
  },
  footman: {
    scale: 1.0, build: 'normal', head: 'kettle', weapon: 'sword', off: 'shield',
    body: MAT.steel, legs: MAT.iron, trim: MAT.cloth, skin: MAT.skin, metal: MAT.steel,
    extras: { pauldrons: true, tabard: true },
  },
  archer: {
    scale: 0.96, build: 'slim', head: 'hood', weapon: 'bow', off: 'none',
    body: '#3f5f47', legs: MAT.leather, trim: MAT.leather, skin: MAT.skin, metal: MAT.iron,
    extras: { quiver: true, cloak: '#2e4a36' },
  },
  knight: {
    scale: 1.18, build: 'heavy', head: 'greathelm', weapon: 'lance', off: 'shield',
    body: MAT.steel, legs: MAT.steel, trim: MAT.gold, skin: MAT.skin, metal: MAT.steel,
    extras: { pauldrons: true, cape: true, plume: '#c2503c', mounted: true },
  },
  cleric: {
    scale: 0.98, build: 'slim', head: 'mitre', weapon: 'staff', off: 'none',
    body: MAT.cloth, legs: MAT.cloth, trim: MAT.gold, skin: MAT.skin, metal: MAT.gold,
    extras: { robe: true, halo: 'rgba(255,232,170,0.55)' },
  },
  ballista: {
    scale: 1.25, build: 'machine', head: 'none', weapon: 'ballista', off: 'none',
    body: MAT.wood, legs: MAT.wood, trim: MAT.iron, skin: MAT.skin, metal: MAT.iron,
    extras: { wheels: true },
  },

  imp: {
    scale: 0.78, build: 'slim', head: 'imphorns', weapon: 'claw', off: 'none',
    body: MAT.imp, legs: MAT.imp, trim: MAT.ember, skin: MAT.imp, metal: MAT.iron,
    extras: { tail: true, batwings: true, eyes: '#ffd24a' },
  },
  fiend: {
    scale: 1.0, build: 'normal', head: 'horns', weapon: 'claw', off: 'claw',
    body: MAT.hellskin, legs: MAT.hellskin, trim: MAT.obsidian, skin: MAT.hellskin, metal: MAT.obsidian,
    extras: { tail: true, spines: true, eyes: '#ff8a2a', hunch: true },
  },
  hellhound: {
    scale: 1.02, build: 'beast', head: 'houndhead', weapon: 'bite', off: 'none',
    body: MAT.obsidian, legs: MAT.obsidian, trim: MAT.ember, skin: MAT.obsidian, metal: MAT.ember,
    extras: { mane: '#ff6a2a', eyes: '#ffd24a', emberTrail: true },
  },
  hellcaster: {
    scale: 1.0, build: 'slim', head: 'hornedhood', weapon: 'orb', off: 'none',
    body: MAT.obsidian, legs: MAT.obsidian, trim: MAT.ember, skin: MAT.hellskin, metal: MAT.ember,
    extras: { robe: true, eyes: '#ff8a2a', floatEmbers: true },
  },
  brute: {
    scale: 1.55, build: 'huge', head: 'greathorns', weapon: 'maul', off: 'none',
    body: MAT.flesh, legs: MAT.flesh, trim: MAT.obsidian, skin: MAT.flesh, metal: MAT.obsidian,
    extras: { spines: true, eyes: '#ffd24a', cracks: true, hunch: true },
  },
  warlock: {
    scale: 1.04, build: 'slim', head: 'crownhorns', weapon: 'scepter', off: 'none',
    body: '#3a2140', legs: '#2a1730', trim: '#b04ad0', skin: MAT.hellskin, metal: MAT.ember,
    extras: { robe: true, cloak: '#2b1636', eyes: '#c766ff', floatEmbers: true },
  },
};

// ---------------------------------------------------------------------------
// BUILDING RIGS
// silhouette — which construction routine to use
// ---------------------------------------------------------------------------
export const BUILDING_ART = {
  townhall:   { silhouette: 'hall', roof: '#3f6ea8', wall: '#c8bda6', stone: '#8d8676', trim: '#e0ab4c', banner: '#c2503c', towers: 2, spires: true },
  farm:       { silhouette: 'farm', roof: '#9a6a3c', wall: '#d6c9ae', stone: '#8d8676', trim: '#7d5a34' },
  barracks:   { silhouette: 'keep', roof: '#4a5c86', wall: '#bdb39d', stone: '#7d766a', trim: '#c2503c', banner: '#c2503c' },
  lumbermill: { silhouette: 'mill', roof: '#6b8f52', wall: '#a98455', stone: '#7d766a', trim: '#5d7a44' },
  blacksmith: { silhouette: 'smithy', roof: '#5a5148', wall: '#a89a86', stone: '#6e6659', trim: '#e07a2a', forgeGlow: '#ff8a3d' },
  chapel:     { silhouette: 'chapel', roof: '#4a6fa5', wall: '#dcd3bd', stone: '#9a9384', trim: '#e0ab4c', glass: '#7fc4e8' },
  workshop:   { silhouette: 'workshop', roof: '#6b5a44', wall: '#b3a58c', stone: '#7d766a', trim: '#8a6a45' },
  tower:      { silhouette: 'tower', roof: '#3f6ea8', wall: '#c2b8a2', stone: '#8d8676', trim: '#e0ab4c', banner: '#c2503c' },

  nethergate: { silhouette: 'gate', rock: '#2b2130', wall: '#3a2438', stone: '#241a2a', trim: '#ff6a2a', glow: '#ff5a1f', spires: true },
  soulwell:   { silhouette: 'well', rock: '#2b2130', wall: '#33203a', stone: '#241a2a', trim: '#c766ff', glow: '#a24aff' },
  bloodpit:   { silhouette: 'pit', rock: '#2b2130', wall: '#41202a', stone: '#241a2a', trim: '#e0402a', glow: '#ff3a1f' },
  forge:      { silhouette: 'dforge', rock: '#2b2130', wall: '#3a2a24', stone: '#241a2a', trim: '#ff8a2a', glow: '#ff9a3d' },
  hellmouth:  { silhouette: 'maw', rock: '#2b2130', wall: '#3a1e28', stone: '#241a2a', trim: '#ff5a1f', glow: '#ff4a1a' },
  altar:      { silhouette: 'altar', rock: '#2b2130', wall: '#312038', stone: '#241a2a', trim: '#c766ff', glow: '#b04ad0' },
  spire:      { silhouette: 'bonespire', rock: '#2b2130', wall: '#d8cdb4', stone: '#241a2a', trim: '#ff5a1f', glow: '#ff6a2a' },
};

export const PROJECTILE_ART = {
  arrow:    { len: 15, w: 2.2, color: '#e8dcc0', tip: '#cfd9ea', trail: 'rgba(230,220,190,0.28)' },
  bolt:     { len: 24, w: 3.6, color: '#b99163', tip: '#8e9cb4', trail: 'rgba(200,170,120,0.3)' },
  holy:     { len: 0, w: 6, color: '#ffe8aa', tip: '#fff6d8', trail: 'rgba(255,225,150,0.4)', glow: '#ffd98a' },
  fireball: { len: 0, w: 7, color: '#ff8a3d', tip: '#ffd08a', trail: 'rgba(255,120,50,0.45)', glow: '#ff5a1f' },
  drain:    { len: 0, w: 5.5, color: '#c766ff', tip: '#f0c4ff', trail: 'rgba(180,90,255,0.4)', glow: '#a24aff' },
};
