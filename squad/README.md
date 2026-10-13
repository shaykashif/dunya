# Squad simulation: Bocage, June 1944

A fork of the [village simulation](../village/README.md) turned to squad-level infantry combat. A US rifle platoon attacks a German infantry Zug dug in among the hedgerows of Normandy, one second and one soldier at a time. The village's daily life is gone: no farming, crime, courts, romance or culture. What carries over is the engine underneath: the seeded RNG streams, the event log and its hash, decision sources with replay, player interventions, one man per tile, and the health system. Wounds are tracked per body part, bleed, get dressed, and heal well or badly.

## What happens in a battle

- **The ground.** About 430 m by 310 m of Normandy (one tile is 3 m). Fields of pasture, wheat, orchard and wood are boxed in by hedgerows, which are earthen banks under thick brush. A stream crosses the south in a shallow valley, with wet meadow along its banks. The seed picks one of four kinds of place:
  - **a bocage hamlet**: small fields, a sunken lane, and a farmhouse, barn, cottage and chapel at a crossroads behind a farmyard wall;
  - **open farmland on a ridge**: big fields with brambles along the hedges, a walled farm, outlying barns, and the defended hedge along the crest;
  - **a highway junction**: a wide straight road with ditches and rows of poplars, houses, a café and a garage at the crossing, and a railway embankment across the fields;
  - **a market town**: streets on a grid around a square, terraced houses two and three storeys high, shops, a church with a bell tower, and garden walls.
- **Height.** The ground rises and falls. Sight lines run from a man's eyes to his target's body, so a crest between them blocks sight, and a man on a rise or upstairs sees over hedgerows that hide him on the flat. Walking uphill costs more, a shooter above his target hits a little more often, and fire from above comes in over the bank or wall in front of a man.
- **Buildings.** Houses have rooms (inner walls with doorways), and many have upper floors reached by stairs; the chapel's bell tower climbs two floors. Men fight from upstairs windows, and a grenade lobbed through an upper window, or a shell through a roof, bursts on that floor, while floors shield the men below.
- **Weather.** Each seed brings its own: clear, overcast, rain or fog. Rain and fog cut how far men can see and spot and how far shots are heard; rain turns fields to mud, which slows men and tires them; both spoil aim a little.
- **Hedges and cover.** A hedge blocks sight and stops bullets, but a man lying right against one can see and shoot through it, and is very hard to spot until he fires.
- **The forces.** Usually the Americans attack: a platoon HQ (lieutenant, platoon sergeant, radio operator and aidman) and two or three 12-man rifle squads. Each squad has a squad leader with a Thompson, an assistant squad leader, two scouts, a BAR team (gunner, assistant and ammunition bearer), a rifle grenadier and riflemen. The defenders are a German Zugtrupp and two 10-man Gruppen, each built around an MG 42 with its three-man crew, a Truppführer, riflemen with Kar98ks, and sometimes a scoped sniper. Half the time a US sniper works with the American platoon. One battle in four is a German counter-attack on an American-held position.
- **Squad tactics.** Squads advance by bounds, field by field: one team moves to the next hedge while the other watches over it, then it comes up. On contact everyone gets down and returns fire. The squad leader then decides: rush a light position, or fix the enemy with the base-of-fire team (the BAR team or MG crew) while the rifle team works round a flank along the least exposed route. When the flank is reached the rifle team assaults with grenades and rushes, the base of fire lifts and shifts as it closes, and the position is cleared. A squad that loses too many men falls back by bounds under covering fire and smoke. If one squad is stuck, the platoon leader sends another round to help, and his radio operator calls in mortar fire, unless friendly troops are too close to the target.
- **Calling for help.** A squad that is pinned down, stuck, taking losses or outnumbered calls the platoon leader: an American squad leader on his SCR-536 handie-talkie at once, a German Gruppenführer by sending a runner, which takes a while. The platoon leader sends the nearest squad that is free: attackers swing round to hit the enemy from the flank, defenders move up beside the caller and hold with them. If nobody can be spared, the mortars are told where they are wanted.
- **Clearing houses.** When the enemy is in a house, the assault becomes a drill. The base of fire keeps the windows busy while the assault team runs up and flattens itself against the walls beside the doors, windows and breaches. On the word every man posts a grenade through the nearest opening (lobbed up through an upstairs window if that is where the enemy is), and as they burst the team goes in, room by room and up the stairs. Defenders upstairs drop grenades on men stacked below.
- **Ambushes.** Sometimes one defending squad goes out in front of the line to lie in a wood, scrub or a hedge bank beside the way the enemy must come. They lie flat and hold their fire, then spring it all at once when the enemy walks within about 60 m, or the moment they are found.
- **Destruction.** Every stretch of house and garden wall takes a few hits before it is a breach of rubble men can climb through, and roofs show every bomb that came through them. A house shelled hard enough falls in: the roof and upper floors come down, men upstairs fall with them and men inside may be crushed, and what is left is a ruin. Shells smash woods and orchards into deadfall (stumps and splintered trunks, slow going but some cover) and blow hedgerows open. Only the tiles near each burst are touched, so this stays cheap.
- **Defence.** Defenders dig foxholes along the hedge line, with machine guns in the field corners that give the best view over the ground in front. They hold fire until the enemy is in the open or shooting. When outflanked or badly hurt they fall back by bounds to the settlement's windows, upstairs first, and walls, and when too few remain they pull out. Machine gunners and automatic riflemen take the high, open-fronted spots in any position their team takes up.
- **Snipers.** A sniper works alone. He picks a hide as high and hidden as he can find, with a long view over the enemy: an upper window, the bell tower, a wood on a rise, a hedge corner. He waits for the shot that matters (the enemy sniper, a machine gunner, an officer or radioman) and he watches wounded men to kill the medic or comrade who comes for them. After a few shots, or once he is fired on, he moves. A squad he fires on yells "Sniper!", goes to ground, searches hard where they think he is, and puts fire there; their own sniper turns to hunt him.
- **Seeing and being seen.** Men in woods, brambles, dark rooms and upstairs windows are hard to spot. Firing gives a man away, but much less from cover, and a sniper's shot almost not at all: his crack gives a bearing only up close, and a man fired on by someone he cannot see judges where it came from only roughly. Mortars are only called down on positions someone has actually seen.
- **Under mortar fire.** Men in holes and houses stay down; anyone in the open dives for a crater, ditch or wall. A squad caught in the open gets out of the beaten zone, sideways or back, and a ranging round landing close is warning enough to move before the fire for effect. Attackers already close to the enemy go forward through it instead.
- **Fatigue.** Running, climbing and carrying tire men out, and mud makes it worse. A blown man moves slower, aims worse, cannot rush, and stops to catch his breath when he can.
- **Fire and suppression.** Most rounds miss. Each round can hit, with odds set by range, the shooter's skill, wounds and nerve, and the target's posture, cover and movement. Every round that lands near a man suppresses him. Suppressed men go prone, shoot badly and get pinned. Machine guns suppress hardest, need an assistant to feed the belt, and overheat. Gunners reload, ammunition bearers bring belts forward, and when a gunner falls his assistant takes over the gun.
- **Morale.** Seeing comrades fall, losing a leader and lying under fire all wear morale down. Leaders nearby restore it and can rally pinned men. When morale breaks, a man runs for the rear, or surrenders if the enemy is close and no friend is near. Prisoners are walked back.
- **Wounds (kept from the village).** A bullet or fragment hits a body part: through the torso, the face, a shattered leg, a lost eye. Hits on men behind a hedge or wall land on whatever shows above it. Open wounds bleed, which is what kills most men, minutes after the hit, unless the medic gets to them. The aidman crawls out to the wounded, stops the bleeding and gives morphine. Any soldier can put a field dressing on a buddy, and the platoon sergeant carries out the men who cannot walk. A man who cannot walk, has passed out, is in too much pain or cannot hold his rifle is out of action. Once the fighting stops, the wounded are followed for thirty days under the same healing rules: some are back with the platoon in a week, some die of festering wounds, and some are crippled for life.
- **The end.** The attackers win if they hold the objective (the crossroads, the farm, the road junction or the town square) unopposed, or if the defenders are destroyed or pull out. The defenders win if the attack breaks. The wounded the losers leave behind become prisoners. After an hour with neither, the attack has stalled.

Every run is reproducible from its seed, its decision log and its intervention log.

## Running

Node.js 22.18 or later. `npm install` only adds dev tools.

```bash
npm install
npm run simulate -- --seed 42
```

```
Squad simulation, seed 42: 12 June 1944, the US platoon attacks (519 ticks, to 06:48:39; 3304 ms)
  ground    a bocage hamlet, a clear, bright morning; snipers: us, de
  outcome   US victory: the defenders were killed, captured or driven off
  US        41 men: 1 killed, 19 wounded, 0 captured, 0 left the field; 425 rounds, 22 hits
  German    24 men: 4 killed, 18 wounded, 17 captured, 3 left the field; 414 rounds, 19 hits
  ordnance  38 grenades thrown, 14 mortar and artillery rounds
  medics    6 treatments; a month on, 11 more dead of wounds, 5 never to fight again
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
- Zoomed in, each house has a small floor button by its roof: click it to cut the house away floor by floor (ground floor, first floor, second floor, then the roof again) and see its rooms, stairs and the men on that floor. Selecting a man indoors shows his floor.
- The ground is shaded by its height, buildings stand in three-quarter view with a storey of windows per floor, and rain, fog or grey skies lie over the battle. The alerts box reports squads making contact, flanking, assaulting, falling back, retreating, getting out from under mortar fire, calling for help and being sent it, springing ambushes and clearing houses, and houses falling in. Walls and trees knocked down throw up their pieces, and a collapsing house a cloud of dust.
- Powers: **💥 Barrage** (X) brings down six 105 mm shells, **💨 Smoke** (Z) lays a smoke screen, and **🎯 Sniper** (K) has someone shot by an unseen marksman. All three are logged and replay exactly.

In the browser console, `squad.advance(60)` runs a minute and `squad.look(x, y, zoom)` moves the camera.

## Tests

```bash
npm run check
```

That runs the strict typecheck of the engine and viewer, then the tests (about 25 seconds):

| Area | Test file |
|---|---|
| determinism, independent RNG streams | `test/determinism.test.ts` |
| replay of decisions and interventions, tamper detection | `test/replay.test.ts` |
| sight through hedgerows, directional cover, posture, suppression | `test/combat.test.ts` |
| wounds: bleeding out, the medic, broken legs, healing into lasting marks | `test/combat.test.ts` |
| whole battles end; flanks, assaults, grenades, mortars, fire discipline, medics, succession of command, aftermath, displacing from shellfire, sniper hides, calls for help answered, houses cleared with grenades | `test/battle.test.ts` |
| the four kinds of map, height in sight lines, movement and shooting, floors and stairs, concealment upstairs, weather, sniper targets and hides | `test/terrain.test.ts` |
| walls breached, houses collapsing on the men upstairs, trees and hedges smashed; ambushes that hold fire until sprung | `test/destruction.test.ts` |
| no Node or DOM APIs, `Math.random` or `Date.now` in the engine | `test/purity.test.ts` |

The engine also checks every tick that no two men share a tile on the same floor, nobody stands in a wall, and the dead do nothing.

## Layout

```
src/
  engine/      tick loop and activities, RNG streams, invariants, player interventions
  world/       types, the map (height, floors, sight, cover, paths), the map generator for each kind of ground, the world
  entities/    body.ts and injuries.ts (the village's wound system), death, morale and suppression
  combat/      small-arms fire, grenades/mortars/smoke, what shells knock down, spotting and contact reports
  ai/          command (platoon and squad leaders), each soldier's options, tactical geometry, snipers, ambushes
  decision/    DecisionSource interface, utility scorer, replay
  battle/      the thirty days after
  scenario/    config (every tunable number), force generation
  cli/         simulate and replay commands
test/
viewer/        pixel-art browser viewer (build.ts bundles it with esbuild, serve.ts serves it)
```

The choices made along the way are in [`DECISIONS.md`](DECISIONS.md).
