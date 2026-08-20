# Emberfall

**▶ [Play it in your browser](https://m1omg.github.io/emberfall-rts/)**

A 2D real-time strategy game for desktop and mobile browsers. The **Kingdom of
Aldermarch** holds the border against the **Ember Legion**.

```bash
npm start          # → http://localhost:8080
```

No build step, no dependencies. Plain ES modules served by a 40-line static server.

---

## The two sides are not mirrors

Both sides have workers, a hall, supply, three tiers of army and two upgrade
lines. Almost nothing else is shared.

| | **Kingdom of Aldermarch** | **The Ember Legion** |
|---|---|---|
| Resources | Gold + **Lumber** | Gold + **Brimstone** |
| Hauling | Peasants **carry loads home on foot** | Imps **blink** their load home — distance costs them nothing |
| Building | A peasant is **occupied for the whole build** | An imp only **ignites** the summoning, then walks away |
| Placement | Anywhere explored | **Only on corruption**, which spreads from Legion structures |
| Staying alive | **Repair** and **clerics that heal** | **Regeneration on corruption**; structures mend themselves |
| Reach | Best range in the game — archers, ballistae, guard towers | Splash, speed and mass |

The economy trade is tuned so the curves **cross at about six tiles**: a peasant
out-earns an imp at a close mine (~2.2/s vs ~1.3/s) and falls behind on a long
haul. Small maps favour the Kingdom, large maps favour the Legion.

The armies trade the same way, through **supply rather than power**. A footman
beats a fiend one-on-one and always will — but a fiend costs *half* the supply,
so the same farm count fields twice the bodies:

| per supply | Footman | Fiend |
|---|---|---|
| damage/sec | 5.9 | **11.6** |
| effective HP | **145** | 159 |
| gold | **30** | 45 |

So the Legion out-damages per supply and the Kingdom out-lasts per gold, and
knights hard-counter the swarm (a knight kills a fiend in 8.6s; the fiend needs
62s back). Every number lives in `src/game/defs.js`.

Corruption also **withers standing timber into brimstone**, so the Legion
remakes the land it takes — and can starve a Kingdom player out of lumber.

---

## Controls

**Desktop** — left-drag box-selects, left-click selects, right-click commands
(move / attack / gather / build / repair, whichever fits the target). `WASD`,
screen edges or middle-drag to pan; wheel zooms at the cursor. `A` attack-move,
`S` stop, `H` hold, `P` patrol, `B` build, `Tab` cycles idle workers, `Space`
jumps to base, `Ctrl+1…9` sets a control group, `1…9` recalls (twice to centre).

**Touch** — one finger box-selects by default, or pans via the ✋ toggle. Two
fingers always pan and pinch-zoom. Tap to select; with units selected, tap the
ground or an enemy to command. Drag on the minimap to fly the camera. Long-press
any command button for its full tooltip.

---

## Art

Every sprite is **drawn procedurally and baked to offscreen canvases at load**
(`src/art/`) — unit rigs at 3 views × 11 frames (mirrored for the other five
facings), structures at four construction stages, terrain in 16×16-tile chunks,
and every UI icon rendered from the same rigs so interface and battlefield never
drift apart. The game ships complete with no image files at all.

**Generated art is an optional override layer.** At boot the game fetches
`assets/manifest.json`; any PNG listed there replaces the matching baked sprite.
A missing manifest is a silent no-op, so this step is never required.

Both sets live in memory at once, so you can **flip between them live**: press
**V** in game, use the 🎨 button, or pick *Painted* / *Vector* on the menu. The
control only appears when generated art is actually present.

```bash
node tools/gen-assets.mjs --list        # 23 assets and their status
OPENAI_API_KEY=… node tools/gen-assets.mjs
node tools/gen-assets.mjs --codex       # prompt to hand to the Codex CLI instead
node tools/gen-assets.mjs --manifest    # re-scan assets/ and rewrite the manifest
```

Prompts live in `tools/art-briefs.json`. Every image must put the **subject
filling the frame horizontally with its base on the bottom edge**, on a
transparent background — `fitOverride()` scales it onto the ground anchor from
that assumption.

Units stay procedural by design: eight facings of coherent animation is not
something image generation can hold consistent. Structures, props and icons are
the overridable set.

---

## Testing

The game has no browser test rig, so correctness is checked by running the real
simulation headlessly — both sides played by the AI, at ~100x realtime:

```bash
npm test                                    # 12 matches, mixed maps and difficulties
node tools/headless.mjs --matches 6 --minutes 10
node tools/headless.mjs --seed 117 --map large --difficulty hard --verbose
```

It reports win/loss by faction and map, average match length, throughput, and
any exception with its stack. It is deliberately long-running: the interesting
failures in an RTS — a stalled economy, workers sealed into a pocket, an AI that
stops building — only appear several minutes into a match, not at startup.

`--verbose` adds per-player resources, supply, structures and researched
upgrades, which is usually enough to see *why* a side lost.

Last measured run — 12 matches across all three map sizes and difficulties:

```
12 matches · 0 errors · avg 7.7 min · 0 stalemates
outcomes: { human: 5, demon: 7 }
by map:   small {H1 D3}  medium {H1 D3}  large {H3 D1}
```

Both factions win on every map size, which is the bar the asymmetry has to
clear. Note the shape of it: the Kingdom takes the large maps and the Legion
the small ones — the reverse of the economy trade, because on a big map the
Kingdom's range and towers get time to matter.

---

## Layout

```
src/core/util.js        maths, seeded RNG, value noise, min-heap
src/art/                palette, unit rigs, structures, props, terrain, icons, the baker
src/engine/             camera, pointer+key input, A* with a frame budget, fog, renderer
src/game/               defs (all balance data), world gen, simulation, combat, AI, effects
src/ui/                 HUD + command card, minimap
src/audio/sfx.js        every sound synthesised at runtime; no audio files
```

`src/game/defs.js` holds **all** balance numbers — units, structures, upgrades,
the damage-type table, difficulty and map sizes — in one file.

Pathfinding is grid A* behind a request queue with a fixed per-frame node
budget, so a hundred simultaneous move orders cannot stall a frame; paths are
line-of-sight simplified so units walk diagonals instead of stair-stepping.
