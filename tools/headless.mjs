// ============================================================================
// Headless test harness.
//
// The simulation has no browser dependency beyond a handful of canvas calls, so
// this stubs those out and runs real matches at ~100x realtime with both sides
// played by the AI. It is how the balance and stability numbers in the README
// were measured, and it catches the class of bug that only shows up after ten
// minutes of play — stalled economies, units sealed into pockets, AI deadlocks.
//
//   node tools/headless.mjs            12 matches, mixed maps/difficulties
//   node tools/headless.mjs --matches 6 --minutes 10
//   node tools/headless.mjs --seed 117 --map large --difficulty hard --verbose
// ============================================================================

const noop = () => {};
function fakeCtx(w, h) {
  return new Proxy({
    canvas: { width: w, height: h },
    createImageData: (a, b) => ({ width: a, height: b, data: new Uint8ClampedArray(a * b * 4) }),
    getImageData: (x, y, a, b) => ({ width: a, height: b, data: new Uint8ClampedArray(a * b * 4) }),
    putImageData: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }),
  }, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
}
const fakeCanvas = (w = 300, h = 150) => ({
  width: w, height: h, style: {}, clientWidth: w, clientHeight: h,
  getContext: () => fakeCtx(w, h), addEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
});
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? fakeCanvas() : { style: {}, appendChild: noop, addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop } }),
  addEventListener: noop, body: { classList: { add: noop, remove: noop } }, querySelector: () => null,
};
globalThis.window = { devicePixelRatio: 1, addEventListener: noop, innerWidth: 1280, innerHeight: 720 };
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.Image = class { set src(v) { setTimeout(() => this.onerror?.(), 0); } };

const { Game } = await import('../src/game/game.js');
const { AI } = await import('../src/game/ai.js');
const { DIFFICULTY, UNITS } = await import('../src/game/defs.js');

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const flag = (f) => argv.includes(f);

const matches = Number(opt('--matches', 12));
const minutes = Number(opt('--minutes', 14));
const fixedSeed = opt('--seed', null);
const fixedMap = opt('--map', null);
const fixedDiff = opt('--difficulty', null);
const verbose = flag('--verbose');

const tally = { human: 0, demon: 0, none: 0 };
const byMap = {};
let errors = 0, totalMin = 0, played = 0, rescues = 0;

for (let i = 0; i < matches; i++) {
  const seed = fixedSeed ? Number(fixedSeed) : 100 + i;
  const map = fixedMap || ['small', 'medium', 'large'][seed % 3];
  const difficulty = fixedDiff || ['easy', 'normal', 'hard'][(seed >> 1) % 3];

  const g = new Game({
    factions: ['human', 'demon'], colors: ['#4f86e0', '#d8452f'],
    difficulty, mapSize: map, startRes: 'normal', seed, fog: true,
  });
  // Hand the human side to the AI too, so both factions get exercised.
  g.players[0].isAI = true;
  g.ai.push(new AI(g, g.players[0], DIFFICULTY[difficulty]));
  const origRescue = g.rescueFromPocket.bind(g);
  g.rescueFromPocket = (e, x, y) => { rescues++; return origRescue(e, x, y); };

  const dt = 1 / 30;
  const t0 = Date.now();
  try {
    for (let f = 0; f < 30 * 60 * minutes && !g.over; f++) g.update(dt);
  } catch (err) {
    errors++;
    console.log(`seed ${seed} THREW: ${err.message}`);
    console.log('  ' + err.stack.split('\n').slice(1, 4).join('\n  '));
    continue;
  }
  const winner = g.over === 'win' ? 'human' : g.over === 'lose' ? 'demon' : 'none';
  tally[winner]++; played++; totalMin += g.time / 60;
  (byMap[map] ||= { human: 0, demon: 0, none: 0 })[winner]++;

  const P = g.players;
  const army = (o) => g.world.entities.filter((e) => !e.dead && e.kind === 'unit' && e.owner === o && !UNITS[e.type].worker).length;
  console.log(
    `${String(seed).padEnd(4)} ${map.padEnd(6)} ${difficulty.padEnd(6)} ${(g.time / 60).toFixed(1).padStart(5)}min ` +
    `${winner.padEnd(6)} H:${String(Math.round(P[0].stats.gathered)).padStart(5)}g ${String(P[0].stats.killed).padStart(3)}k army${army(0)}` +
    `  D:${String(Math.round(P[1].stats.gathered)).padStart(5)}g ${String(P[1].stats.killed).padStart(3)}k army${army(1)}` +
    `  ${(g.time / ((Date.now() - t0) / 1000)).toFixed(0)}x`);
  if (verbose) {
    for (const p of P) {
      console.log(`     P${p.index} ${p.faction}: gold=${Math.round(p.gold)} wood=${Math.round(p.wood)} ` +
        `sup=${p.supply}/${p.supplyMax} built=${p.stats.built} trained=${p.stats.trained} up=${JSON.stringify(p.upgrades)}`);
    }
  }
}

console.log(`\n${played} matches · ${errors} errors · avg ${(totalMin / Math.max(1, played)).toFixed(1)} min · ${rescues} pocket rescues`);
console.log('outcomes:', tally);
console.log('by map:  ', JSON.stringify(byMap));
process.exitCode = errors ? 1 : 0;
