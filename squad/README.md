# Squad simulation: Bocage, June 1944

A fork of the [village simulation](../village/README.md) turned to squad-level infantry combat. A US rifle platoon attacks a German infantry Zug dug in among the hedgerows of Normandy, one second and one soldier at a time. The village's daily life is gone: no farming, crime, courts, romance or culture. What carries over is the engine underneath: the seeded RNG streams, the event log and its hash, decision sources with replay, player interventions, one man per tile, and the health system. Wounds are tracked per body part, bleed, get dressed, and heal well or badly.

## What happens in a battle

- **The ground.** About 430 m by 310 m of bocage (one tile is 3 m). Small fields of pasture, wheat, orchard and wood are boxed in by hedgerows, which are earthen banks under thick brush. A sunken lane runs north to a hamlet at a crossroads, with a farmhouse, barn, cottage and chapel behind a farmyard wall. A stream crosses the south. A hedge blocks sight and stops bullets, but a man lying right against one can see and shoot through it, and is very hard to spot until he fires.
- **The forces.** Usually the Americans attack: a platoon HQ (lieutenant, platoon sergeant, radio operator and aidman) and two or three 12-man rifle squads. Each squad has a squad leader with a Thompson, an assistant squad leader, two scouts, a BAR team (gunner, assistant and ammunition bearer), a rifle grenadier and riflemen. The defenders are a German Zugtrupp and two 10-man Gruppen, each built around an MG 42 with its three-man crew, a Truppführer, riflemen with Kar98ks, and sometimes a scoped sniper. One battle in four is a German counter-attack on an American-held hamlet.
- **Squad tactics.** Squads advance by bounds, field by field: one team moves to the next hedge while the other watches over it, then it comes up. On contact everyone gets down and returns fire. The squad leader then decides: rush a light position, or fix the enemy with the base-of-fire team (the BAR team or MG crew) while the rifle team works round a flank along the least exposed route. When the flank is reached the rifle team assaults with grenades and rushes, the base of fire lifts and shifts as it closes, and the position is cleared. A squad that loses too many men falls back by bounds under covering fire and smoke. If one squad is stuck, the platoon leader sends another round to help, and his radio operator calls in mortar fire, unless friendly troops are too close to the target.
- **Defence.** Defenders dig foxholes along the hedge line, with machine guns in the field corners where they can fire along the hedges. They hold fire until the enemy is in the open or shooting. When outflanked or badly hurt they fall back by bounds to the hamlet's windows and walls, and when too few remain they pull out.
- **Fire and suppression.** Most rounds miss. Each round can hit, with odds set by range, the shooter's skill, wounds and nerve, and the target's posture, cover and movement. Every round that lands near a man suppresses him. Suppressed men go prone, shoot badly and get pinned. Machine guns suppress hardest, need an assistant to feed the belt, and overheat. Gunners reload, ammunition bearers bring belts forward, and when a gunner falls his assistant takes over the gun.
- **Morale.** Seeing comrades fall, losing a leader and lying under fire all wear morale down. Leaders nearby restore it and can rally pinned men. When morale breaks, a man runs for the rear, or surrenders if the enemy is close and no friend is near. Prisoners are walked back.
- **Wounds (kept from the village).** A bullet or fragment hits a body part: through the torso, the face, a shattered leg, a lost eye. Hits on men behind a hedge or wall land on whatever shows above it. Open wounds bleed, which is what kills most men, minutes after the hit, unless the medic gets to them. The aidman crawls out to the wounded, stops the bleeding and gives morphine. Any soldier can put a field dressing on a buddy, and the platoon sergeant carries out the men who cannot walk. A man who cannot walk, has passed out, is in too much pain or cannot hold his rifle is out of action. Once the fighting stops, the wounded are followed for thirty days under the same healing rules: some are back with the platoon in a week, some die of festering wounds, and some are crippled for life.
- **The end.** The attackers win if they hold the crossroads unopposed, or if the defenders are destroyed or pull out. The defenders win if the attack breaks. The wounded the losers leave behind become prisoners. After an hour with neither, the attack has stalled.

Every run is reproducible from its seed, its decision log and its intervention log.

## Running

Node.js 22.18 or later. `npm install` only adds dev tools.

```bash
npm install
npm run simulate -- --seed 42
```

```
Squad simulation, seed 42: 12 June 1944, the US platoon attacks (747 ticks, to 06:52:27; 4199 ms)
  outcome   US victory: the Americans took the crossroads
  US        40 men: 2 killed, 18 wounded, 0 captured, 0 left the field; 328 rounds, 15 hits
  German    24 men: 6 killed, 13 wounded, 10 captured, 7 left the field; 379 rounds, 17 hits
  ordnance  41 grenades thrown, 7 mortar and artillery rounds
  medics    9 treatments; a month on, 2 more dead of wounds, 0 never to fight again
```

Add `--out runs/seed42` to write `events.ndjson`, `decisions.ndjson`, `interventions.ndjson` and `summary.json`, and `npm run replay -- --dir runs/seed42` to check that the run reproduces exactly. `--ticks N` stops after N seconds instead of at the end of the battle.

## Viewer

```bash
npm run viewer
```

Then open http://localhost:5174 (add `?seed=7` for another battle).

- Drag or use **WASD** to pan, and the wheel or **Q/E** to zoom. Space pauses, and keys 1 to 6 set the speed from 1x (real time) to 40x.
- Click a soldier, or a name in the **Men** tab, to see his portrait (helmet, wounds and all), a body diagram coloured by wound, what he is doing, his health, morale, suppression, pain and bleeding, his weapon and ammunition, his character, his wounds and how they were dressed, and what has happened to him. **F** follows him.
- **Squads** shows each squad's state and plan in words, for example: "machine gun at 87 m: base of fire pins it, right flank for the rifle team". It also lists what each fire team is ordered to do, who leads, and who is still on his feet.
- **Events** and the log overlay tell the story: contacts, orders, shouted callouts, hits, the medic's work, fire missions, surrenders. **Report** opens the after-action report, which also opens by itself when the battle ends. It lists losses on each side, notable deeds, every man killed, and every wounded man's fate a month later.
- Overlays: **Orders** (O) draws where each man has been sent, the positions being suppressed (circles), enemy positions (red crosses) and flanking objectives. **Sight** (V) shows who the selected man can see, **Names** (N) labels everyone, and **Roofs** (R) hides the roofs. Hover a house to see inside.
- Powers: **💥 Barrage** (X) brings down six 105 mm shells, **💨 Smoke** (Z) lays a smoke screen, and **🎯 Sniper** (K) has someone shot by an unseen marksman. All three are logged and replay exactly.

In the browser console, `squad.advance(60)` runs a minute and `squad.look(x, y, zoom)` moves the camera.

## Tests

```bash
npm run check
```

That runs the strict typecheck of the engine and viewer, then the tests (about 20 seconds):

| Area | Test file |
|---|---|
| determinism, independent RNG streams | `test/determinism.test.ts` |
| replay of decisions and interventions, tamper detection | `test/replay.test.ts` |
| sight through hedgerows, directional cover, posture, suppression | `test/combat.test.ts` |
| wounds: bleeding out, the medic, broken legs, healing into lasting marks | `test/combat.test.ts` |
| whole battles end; flanks, assaults, grenades, mortars, fire discipline, medics, succession of command, aftermath | `test/battle.test.ts` |
| no Node or DOM APIs, `Math.random` or `Date.now` in the engine | `test/purity.test.ts` |

The engine also checks every tick that no two men share a tile, nobody stands in a wall, and the dead do nothing.

## Layout

```
src/
  engine/      tick loop and activities, RNG streams, invariants, player interventions
  world/       types, the map (sight, cover, paths), the bocage generator, the world
  entities/    body.ts and injuries.ts (the village's wound system), death, morale and suppression
  combat/      small-arms fire, grenades/mortars/smoke, spotting and contact reports
  ai/          command (platoon and squad leaders), each soldier's options, tactical geometry
  decision/    DecisionSource interface, utility scorer, replay
  battle/      the thirty days after
  scenario/    config (every tunable number), force generation
  cli/         simulate and replay commands
test/
viewer/        pixel-art browser viewer (build.ts bundles it with esbuild, serve.ts serves it)
```

The choices made along the way are in [`DECISIONS.md`](DECISIONS.md).
