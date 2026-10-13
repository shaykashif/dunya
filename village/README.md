# Village simulation

A headless, deterministic simulation of a village of about 55 people in five family houses. Each house lives in its own compound, a short walk through the forest from a town with a courthouse.

Hunger pushes people to plot thefts, and grudges push them to plot killings. A killer stalks the victim to learn when they are alone. Houses feud and raid each other. Crimes leave traces: footprints, missing food, blood on tools and clothes, bodies, gunshots. Witnesses hold partial and sometimes false beliefs. Villagers investigate, accuse, and stand before a council of elders, which hears public testimony and judges from what it believes, not what is true.

Around that sit:

- the environment: seasons, weather, water, shelter and fire
- household tasks
- livestock, wolves, horses and muskets
- marriages that need both house elders' blessing, and elopements when they refuse
- madness

Every run is reproducible from a seed, its decision log and its intervention log.

This started from the brief in [`../VILLAGE_SPEC.md`](../VILLAGE_SPEC.md) (milestone 1) and has grown past it. The choices made where the brief was open, and everything added since, are in [`DECISIONS.md`](DECISIONS.md).

## Requirements

Node.js 22.18 or later. The CLI runs the TypeScript sources directly with Node's built-in type stripping. `npm install` only adds dev tools: TypeScript, Vitest, and esbuild for the viewer.

```bash
npm install
```

## Running

```bash
npm run simulate -- --seed 42 --days 90
```

To also write `events.ndjson`, `decisions.ndjson`, `interventions.ndjson` and `summary.json`, add `--out <dir>`:

```bash
npm run simulate -- --seed 42 --days 90 --out runs/seed42
```

Replay a recorded run and check that it reproduces the event stream exactly:

```bash
npm run replay -- --dir runs/seed42
```

## Viewer

A pixel-art viewer in the style of Worldbox runs the same engine in the browser:

```bash
npm run viewer
```

Then open http://localhost:5173 (add `?seed=7` for another village).

**Getting around**
- Drag to pan; the mouse wheel zooms through 16 steps, from the whole map down to close-ups.
- The minimap in the corner jumps the camera.
- Hover over a building to see inside.
- Space pauses; keys 1 to 6 set the speed. At 1x, one tick (10 game minutes) passes every 2.5 seconds, and people walk along the roads they actually take.
- Toggle roofs (R), traces (T) and names (N).

**The inspector.** Click a villager to see:
- their task, needs, mood and madness
- what they felt and why ("felt grateful because Tor gave them food when they were hungry")
- what they did recently
- what they are plotting or investigating, and their closest relationships

**The sidebar tabs**
- **Chronicle** tells the story.
- **Intrigue** tracks every plot (theft, murder, raid) from planning to its outcome, alongside the major events.
- **Council** lists every hearing. Each one opens a transcript of the accusation and the testimony. Statements the speaker knew to be false are marked as lies, and the judges' votes and the truth are shown at the end.

**Alerts.** Fights, deaths, raids, kidnappings, wolf attacks, madness and council sessions pause the game and raise an alert, Dwarf Fortress style. "Watch" flies the camera to the scene and replays the blows; "Read transcript" opens a council session. ⚙ Alerts chooses which events pause the game.

**Powers**
- ⚡ **Smite** (S) strikes down a person or an animal. The villagers find a body with no mark on it, and it gets investigated like any suspicious death.
- 🌀 **Madden** (M) drives a person mad. Depending on their temperament, they go on a rampage, kidnap a child, steal compulsively, or wander into the woods.

Interventions are logged and replay exactly.

Everything is drawn in code, with no image assets. In the browser console, `village.advance(144)` skips a day.

## Tests

```bash
npm run check
```

That runs the strict typecheck of the engine and the viewer, and every test. Each item in section 14 of the brief has a test:

| Spec | Test file |
|---|---|
| 14.1 determinism | `test/determinism.test.ts` |
| 14.2 replay | `test/replay.test.ts` (also replays player interventions) |
| 14.3 conservation | `test/conservation.test.ts`, plus the engine's per-tick invariant check |
| 14.4 no dead actors | `test/smoke.test.ts` |
| 14.5 perception bounds | `test/smoke.test.ts` |
| 14.6 belief isolation | `test/isolation.test.ts` (import check, behaviour, and a `@ts-expect-error` checked by the typecheck) |
| 14.7 conflict of interest | `test/conflict.test.ts`, `test/smoke.test.ts` (checked as each verdict is given) |
| 14.8 wrongful verdict | `test/wrongful.test.ts` |
| 14.9 starvation pressure | `test/smoke.test.ts` |
| 14.10 smoke run | `test/smoke.test.ts` |
| 14.11 survival | `test/survival.test.ts` |
| 14.12 day and night | `test/daynight.test.ts` (200 seeds) |
| 14.13 weather effects | `test/weather.test.ts` |
| 14.14 bonding integrity | `test/bonding.test.ts` (20 seeds x 90 days) |
| 14.15 romance | `test/bonding.test.ts` |

The engine also checks, every tick, that no two people stand on the same tile. `test/purity.test.ts` checks that the engine never uses Node or DOM APIs, `Math.random` or `Date.now`, and that the NanoJev decision source is still a stub. The full suite takes about 15 minutes, almost all of it the 20-seed, 90-day bonding test; `npx vitest run --exclude test/bonding.test.ts` runs everything else in about 3.

## Sample run: seed 42, 90 days

```
Village simulation, seed 42, 90 days (12960 ticks, 61509 ms)
  population   34 (started 56, births 0, exiled 2)
  deaths       20 (wounds 16, starvation 3, execution 1)
  thefts       203 (+53 caught in the act)
  attacks      64
  accusations  87
  verdicts     74 (9 guilty, 5 convicted the wrong person)
  pair bonds   0 formed, 0 break-ups
  events       377645
  hash         fdf415124218a5c1
```

A hard season. The poorest house, with no tools and little food, starts plotting thefts within days: 53 thieves are caught in the act and 6 are run down in 44 chases. One villager goes mad on a killing rampage (15 of the 64 attacks). Two feuding houses raid each other five times (16 attacks), and families avenge verdicts they think unjust (16 more). Of the 20 deaths, 16 are from wounds. The council sits 74 times, convicts 9, and gets 5 of those wrong. Other seeds are quieter: typically 3 to 12 deaths, with wolf attacks, a marriage or two, and fewer raids.

## Layout

```
src/
  engine/        tick loop, plans, RNG streams, invariants, player interventions
  world/         map and pathfinding, environment, items, traces, production, animals, horses and muskets
  entities/      people, needs, death, obligations, bonding and births, tasks, madness
  actions/       action definitions: survival, work, chores, social, crime, fights, intrigue, investigation, justice, bonding, madness
  plots/         plots (theft, murder, raid), chases, feuds
  perception/    detection, perception step, belief store, testimony and lying
  investigation/ case files, case opening, deduction (beliefs only)
  justice/       norms, the council, accusations, hearings, verdicts, sentences
  decision/      DecisionSource interface, utility scorer, replay and NanoJev stub
  log/           event log, stream hash, replay
  scenario/      config (every tunable parameter), map layout, seeded village generation
  cli/           simulate and replay commands
test/            one file per acceptance area
viewer/          pixel-art browser viewer (build.ts bundles it with esbuild, serve.ts serves it)
```

## Extension points

- **Decisions.** Implement `DecisionSource` (`src/decision/types.ts`). `NanoJevDecisionSource` is the placeholder. A source receives only the person's own state and beliefs, and at most 30 candidates. Responses (accepting a proposal, joining a raid, fighting back) go through the same interface.
- **Language.** No model is called anywhere. Statements are structured events; any text is generated from templates.
- **Norms** are data (`src/justice/norms.ts`), so villages can differ.
- **Trade and war** between villages are still out of scope.
