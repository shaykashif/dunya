# Village simulation

A headless, deterministic simulation of a village of about 55 people in five family houses. Each house lives in its own compound, a short walk through the forest from a town with a courthouse.

Hunger pushes people to plot thefts, and grudges push them to plot killings. A killer stalks the victim to learn when they are alone. Houses feud and raid each other. Crimes leave traces: footprints, missing food, blood on tools and clothes, bodies, gunshots. Witnesses hold partial and sometimes false beliefs. Villagers investigate, accuse, and stand before a council of elders, which hears public testimony and judges from what it believes, not what is true.

Around that sit:

- the environment: seasons, weather, water, shelter and fire
- household tasks
- livestock, wild game (deer, rabbits, foxes), wolves that swim, roam and lie in ambush, horses and muskets
- injuries per body part, bleeding, rescue and nursing; inquests into every death
- building: furniture, wells and pumps, bridges, house extensions, palisades and a temple, from hauled wood and quarried stone
- skills that grow with practice, a culture of shared values and gods, personal needs, festivals
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
- Drag or use **WASD** to pan (hold Shift to go faster); the mouse wheel, a trackpad pinch-scroll or holding **Q/E** zooms smoothly, from the whole map down to close-ups.
- 📖 Chronicle, 🏛 Culture (values, gods, festivals) and 🔨 Building (what is under way, furnishings by house, what was finished) open from the buttons at the top of the right panel.
- The minimap in the corner jumps the camera. Wolf dens show on it as red squares, in the far corners of the forest; the dens are drawn on the map too.
- On a phone the map fills the screen: a bottom bar opens People, Intrigue, Council, the Chronicle and the Village stats as sheets, ☰ holds the view toggles and powers, and pinching zooms.
- Hover over a building to see inside.
- Space pauses; keys 1 to 6 set the speed. At 1x, one tick (10 game minutes) passes every 2.5 seconds, and people walk along the roads they actually take.
- Toggle roofs (R), traces (T), names (N) and the chronicle overlay (C).

**The chronicle** floats over the left of the map with no background of its own. The 📖 button on the right (or B) opens the whole thing.

**Side buttons** (right): People, Intrigue and Council share the lower right, and People gets most of the space.
- **People** lists everyone (🩹 marks the hurt) and shows the person you clicked: a pixel face that shows scars, bruises and lost eyes; a body diagram coloured by injury (minor to grave, festering, lasting, lost); a written description in the manner of Dwarf Fortress ("limps on a crutch", "face is a ruin of scar tissue"); every wound with how well it was tended; their needs, mood and pain; what they felt and why; what they did recently; what they are plotting or investigating; grudges against people the council let go; and their closest relationships.
- **Intrigue** tracks every plot (theft, murder, raid, vengeance) from planning to its outcome, alongside the major events.
- **Council** lists every hearing. Each one opens a transcript of the accusation and the testimony. Statements the speaker knew to be false are marked as lies, and the judges' votes and the truth are shown at the end. For first-degree murder the transcript also shows how sympathetic the council was and why the sentence was execution or imprisonment.

**Animals.** Click any animal (sheep, cow, chicken, horse, wolf) to see its health, hunger, what it needs and a short history of what it has been doing and what has been done to it. Click targets are generous, and wider for anything moving.

**Alerts.** Fights, deaths, raids, kidnappings, wolf attacks, madness, vengeance, crippling injuries and council sessions pause the game and raise an alert, Dwarf Fortress style. A fight is one alert however many rounds it lasts; "Fight log" lists every blow, every choice to fight, run or give in, every decision to keep attacking, and every wound. "Watch" flies the camera to the scene and replays the blows; "Read transcript" opens a council session. ⚙ Alerts chooses which events pause the game.

**Powers**
- ⚡ **Smite** (X) strikes down a person or an animal. The villagers find a body with no mark on it, and it gets investigated like any suspicious death.
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
| injuries, rescue, retribution | `test/injuries.test.ts` |
| first-degree sentencing, witnesses and body reads, no accusation by proximity | `test/firstdegree.test.ts` |
| kidnapping: search, chase, rescue, accusation | `test/kidnap.test.ts` |

The engine also checks, every tick, that no two people stand on the same tile. `test/purity.test.ts` checks that the engine never uses Node or DOM APIs, `Math.random` or `Date.now`, and that the NanoJev decision source is still a stub. The full suite takes about 15 minutes, almost all of it the 20-seed, 90-day bonding test; `npx vitest run --exclude test/bonding.test.ts` runs everything else in about 3.

## Sample run: seed 42, 90 days

```
Village simulation, seed 42, 90 days (12960 ticks, 18448 ms)
  population   54 (started 56, births 0, exiled 0)
  deaths       2 (exposure 1, starvation 1)
  thefts       47 (+24 caught in the act)
  attacks      3
  accusations  17
  verdicts     15 (2 guilty, 0 convicted the wrong person)
  pair bonds   0 formed, 0 break-ups
  events       335609
  hash         b2749c9fe2953ba1
```

A quiet autumn with plenty of stored food. The poorest house still starts plotting thefts: 24 thieves are caught in the act, and the council sits 15 times. Other seeds see more: wolf attacks, accidents that leave someone crippled and carried home, vengeance after acquittals, and the occasional rampage if the player drives someone mad. The first winter (days 60 to 150) now takes a few lives rather than most of the village; run `npm run simulate -- --seed 42 --days 270` to see it.

## Layout

```
src/
  engine/        tick loop, plans, RNG streams, invariants, player interventions
  world/         map and pathfinding, environment, items, traces, production, animals, horses and muskets
  entities/      people, needs, death, obligations, bonding and births, tasks, madness, injuries and what they do to the body (body.ts, injuries.ts)
  actions/       action definitions: survival, work, chores, social, crime, fights, intrigue, investigation, justice, bonding, madness
  plots/         plots (theft, murder, raid, retribution), chases (thieves and kidnappers), feuds
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
