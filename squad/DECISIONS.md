# Decisions

Choices made in forking the village simulation into a squad combat simulation, with the reason for each. Every tunable number lives in `src/scenario/config.ts`.

## What was kept, what was dropped

- **A fork, not a mode.** The squad simulation is its own package next to `village/`. It shares no imports with the village, so either can change without breaking the other. Kept, adapted where needed: the sfc32 RNG with named streams, the event log and stream hash, `DecisionSource` with logged, replayable decisions, queued player interventions, the per-tick invariant check, one man per tile, and the body and wound system.
- **Dropped:** needs, households, food and the economy, perception of crime, beliefs and testimony, investigation, the council, plots and feuds, bonding and romance, culture, building, animals, weather and seasons. None of it bears on a forty-minute firefight.
- **The health system is the village's.** `entities/body.ts` is the village file with one addition: `shrapnel` joins the wound kinds, and a few battlefield helpers sit at the end (pain dulled by morphine, out of action, aim). `entities/injuries.ts` keeps the wound record, describing wounds in words, tending (care and skill), carrying, crying for help, infection, healing and the lasting conditions (lame, crooked arm, maimed hand, lost eye, scars, ruined face, dented skull). What changed is the clock. Bleeding and clotting run per minute instead of per day, because a gunshot to the body kills in minutes, not days. Healing, infection and lasting marks keep their per-day rates and are played out over the thirty days after the battle.
- **What a wound costs** depends on the part: a hit to the head costs 1.25 times its severity in health, the torso 0.6, a limb far less. How hard it bleeds also depends on the part (torso and thigh bleed most). A heavy round through an arm or leg may break the bone as well.

## Scale

- One tick is one second and one tile is about 3 m. The map is 144 by 104 tiles, about 430 by 310 m: several bocage fields deep, the usual depth of a platoon attack in Normandy.
- The battle starts at 06:40 on 12 June 1944 and is called off after an hour.
- Speeds in tiles per second: walking 0.55, crouched 0.38, rushing 1.6, crawling 0.14, all scaled by fitness and by the legs (`mobility`). Rushing under fire goes a few seconds up, then down: "I'm up, he sees me, I'm down."

## Ground

- **Hedgerows** are drawn along a jittered grid of field boundaries, each stretch with one or two gaps. A hedge tile blocks sight completely, except for a man right beside it, who can see and fire through it at reduced clarity (the firing ports dug into real banks). Crossing a hedge is slow (cost 9) and makes a man stand up on top of it.
- **Cover is directional.** What protects a man is the tile right in front of him toward the shooter (hedge 0.85, wall 0.65, window 0.8) combined with the ground he lies in (foxhole 0.75 when down, crater 0.5 when prone). So a man dug in behind a hedge is nearly safe from the front and exposed from the flank. That is what makes flanking worth it.
- **Concealment** is separate. Woods, wheat, foxholes and a hedge at his side make a man hard to spot. Firing gives him away (four times as visible, more for a machine gun).
- **Field kinds** are chosen per cell of the field grid, not per connected area. Gaps join fields, so flood-filling made half the map one crop.
- **The stream** runs through the middle of a field, not along a hedge line. When it overwrote a line of hedges, the defenders could see the start line.
- **A line of departure**: there is always a hedge row 11 to 13 tiles from the attackers' edge, so they form up out of sight.

## Fire

- **Per round, not per burst.** Each round may hit with `accuracy × e^(−range/rangeScale)`, scaled by marksmanship and experience, the shooter's posture, suppression and wounds (`aimFactor`), visibility, the target's size, cover and movement. Weapon numbers are in `config.weapons`. Most rounds miss, as they did.
- **Firing at a position** that cannot be seen (a hedge line, a window, the flash of a rifle) hits at an eighth of the rate, but suppresses as well as aimed fire. This is the base of fire's real job.
- **Suppression** accrues from every round landing within 2.5 tiles of a man, scaled by his nerve, experience and role. Above 0.35 he goes prone; above 0.65 he is pinned (no advancing, half rate of fire). It decays faster in cover.
- **Friendly fire**: a stray round has a small chance of hitting a friend standing right by the aim point. So base-of-fire teams lift and shift their fire when the assault gets within ten tiles, and nobody suppresses a point with friends near it.
- **Machine guns** fire 8 rounds a second, at 60% without an assistant feeding the belt. Barrels overheat after a few hundred rounds of sustained fire and take seven seconds to change.
- **Medics** are spared by most men who see the red cross: firing at one is heavily discounted in scoring.

## Seeing and knowing

- Each man rolls each second to spot each enemy in his sight line. A man already seen stays seen while the line holds. Shots are heard out to the weapon's noise range, and the position is guessed with an error that grows with distance.
- **Contacts are per squad**, shared by shouting. Squad leaders and men act only on their squad's contacts, never on true positions. Contacts are forgotten after 90 seconds.
- **Exposure maps**: every 15 seconds each side builds a map of how visible each tile is from the enemy positions it knows. Routes for bounds, flanks and withdrawals weigh exposure, so men use hedges and dead ground without scripting.

## Command

- **Squad leaders think every 2 seconds, platoon leaders every 10.** A squad is a small state machine: advance, react, fix, flank, assault, consolidate, fall back, withdraw; for defenders, hold, fall back, withdraw. `intent` holds a sentence describing the plan, which the viewer shows.
- **Two fire teams per squad**, as both armies taught. The US base team is the assistant squad leader, the scouts and the BAR team; the manoeuvre team is the squad leader, the grenadier and the riflemen (FM 7-10's Able and Baker, and Charlie). The German MG-Trupp and Schützentrupp work the same way. If one team is shot away, men are borrowed from the other.
- **Bounding**: within about 280 m of the objective, or after first contact, one team moves to the next hedge while the other overwatches, then the second team comes up. Before that the squad walks together.
- **On contact**, the squad gets down and moves to spots from which it can fire on the enemy. A man can only fire through a hedge from right against it, so "where he dropped" is usually no good. After six seconds the leader decides: rush the position if it is one or two riflemen close by, flank it if the rifle team has three or more men and a flank point is reachable, or fix it with fire and wait. A flank point lies 50 to 95 degrees off the line to the enemy, 12 to 22 tiles from it. It is chosen for low exposure along the route, a clear line of fire on the position and cover on arrival.
- **Assault ends** when nobody able is left near the position. It fails, and becomes trading fire again, if it stalls for more than 220 seconds or the squad is too badly hurt.
- **Defenders hold their fire** until an enemy is seen within 75 tiles, or until they are shot at, so that the attackers walk into the open first. They fall back to the hamlet when flanked (an enemy within 26 tiles off to the side), when half are down, or when morale sags.
- **Succession**: when a leader goes down, the next man by rank takes over (the assistant first), and the squad pauses for 15 seconds, confused.
- **The platoon** sends an idle squad round the flank of one that is stuck, and calls mortars on machine guns or groups of three or more once contact has lasted 20 seconds. Missions take 35 seconds for the spotting round and 22 more for fire for effect, and are called off if friends come within about 25 m. It calls off the attack below 35% effective strength (the defenders give up below 35%), and a withdrawal lasting four minutes ends the battle.

## Each soldier

- **Candidates and a decision source**, as in the village. The engine lists what a man could do, each option with its tactical value and whether it is ordered, how dangerous it is, how much safer it makes him, whether it helps a comrade and whether it closes with the enemy. The options are: fire at a man he sees, suppress a position, move as ordered (or rush it), take cover, hold, hug the ground, reload, throw a grenade, fire a rifle grenade, throw smoke, rally the men, take over a fallen gunner's weapon, bring him ammunition, dress a wound, carry a man back, take a prisoner, run, or surrender. The utility source weighs these against his nerve, aggression, discipline and empathy, and his fear (suppression, morale, pain), with a little noise. Decisions are logged and replay exactly.
- **Activities last.** A burst lasts two to four seconds, a move lasts until arrival. Being shot at, getting pinned, breaking or receiving a new order interrupts them.
- **Grenades** are for men behind cover or for the final rush. A man in the open past six tiles is a rifle target. Grenades are lobbed over hedges, which is how the bocage was fought: banks and walls stop fragments, and a man who sees one land beside him may throw himself clear.

## Morale

- Starts at 0.68 (green), 0.78 (regular) or 0.88 (veteran), nudged by nerve.
- Losses shake the men who see them or who are in the same squad. Each further loss within 15 seconds counts for less (a group shaken by one mortar salvo does not lose all its morale in a single second, which it did at first). A leader going down costs his squad 0.12.
- Below 0.3 a man is shaken; below 0.14 he breaks. A broken man runs for the rear, or surrenders if an enemy is within 30 m and no friend is within 18 m.

## Wounded, medics and the aftermath

- **Out of action**: unconscious (health below 0.3), unable to walk, pain above 0.62 (morphine halves it), or arms too hurt to hold a rifle. Such a man lies low, crawls to cover if he can, dresses his own wound, walks back to the aid post if he can walk, and calls for the medic every 20 seconds while untended.
- **The medic** goes to the worst bleeding first, crawling if the spot is exposed. He stops the bleeding (skill 0.85), gives morphine, and drags a man lying in the open into cover. A buddy's field dressing slows bleeding by his skill (0.3 to 0.6) but rarely stops it. Assault troops do not stop for the wounded.
- **The platoon sergeant** carries out men who cannot walk once their bleeding is controlled, to the aid post behind the start line.
- **The aftermath**: when the battle ends, the wounded who were never treated go on bleeding for the 25 minutes it takes to collect them, and some die. The rest get thirty days of healing at an aid-station level of care, with the village's rules: festering, mending, and lasting conditions. A man is back with the platoon when every wound has healed or left only a mark. This runs on copies with its own RNG stream, so the battlefield as it ended stays visible.
- **Prisoners**: the wounded that the losing side leaves on the field, and anyone who surrendered, become prisoners when the battle ends.

## Tuning

- Across seeds 1 to 8 and 42, three-squad American attacks usually take the crossroads in 9 to 15 minutes. Two-squad attacks often fail against two dug-in MG 42s. A long firefight sometimes stalls until the hour is up. German counter-attacks mostly fail. Losses run to a handful killed and a dozen or more wounded on each side, most by grenade fragments and machine-gun fire at close range. That is heavier than most real platoon actions, but those were rarely so short.
- The levers that matter most: `weapons.mg42`, `suppression.*`, `morale.*`, `explosives.frag/stick`, `battle.attackBreak`, `forces.usSquads`, and `mortars.missions`.

## Viewer

- A separate front end running the same engine, like the village's. It changes no engine code paths, and turns invariant checks off to save time.
- Tracers, muzzle flashes, impact puffs, grenade arcs, shell shadows and explosions are drawn from `fire`, `grenade_thrown`, `incoming` and `explosion` events, spread over the real time a tick takes at the current speed. Smoke is drawn from the world's clouds.

## The city

- **Its own generator.** A city is not a bigger market town: no hedge grid, so `city.ts` builds it from scratch (streets, bands of blocks, terraces, yards, the plaza) and returns the same `Layout` the rest of the engine expects. The defended "line" is the barricaded boulevard; line positions are the barricades and the windows of the houses fronting it, on every floor; machine-gun positions are the upper windows with the longest view down a street, scored by how much street they can see. Side streets are offset band to band so they end in T-junctions: without that, every street is a 200 m shooting gallery and nothing is a chokepoint.
- **Four floors.** `MAX_FLOORS` went from 3 to 4 for apartment blocks and the city church's taller tower. It costs a third more memory in the occupancy and region arrays, nothing measurable in time.
- **Party walls.** A doorway between two terraced houses is passable on every floor they share: an inner doorway is now one whose four neighbours are all building, of any house, rather than all of the same house. Front doors are untouched, since one side of them is the street.
- **Cover to cover is a path cost, not a special mode.** Every map keeps a per-tile "open" flag (no wall, bank, pile or hole within a step), and tactical moves (anything but a walk) pay extra for open tiles: a little in the country, a lot in a city (`movement.openCost`). The pause in cover after a dash is in the engine's travel step. Tactical paths search further before giving up, since the extra cost makes A* expand more.
- **Exposure from upstairs.** The exposure map used the ground as the height of every enemy it knew of. A gunner in a top-floor window sees far more than that; it now uses his floor. This changes routes on every map slightly.
- **House to house replaces the platoon's set pieces in a city.** The set-piece attack on both flanks and the "swing wide" axis shift both assume open ground either side of a position; in a city they sent squads 100 m round blocks and threw away the ground they had taken. In a city each squad deals with its own houses, and the platoon helps with mortars, smoke and squads sent to flank through the houses.
- **Borrowed men follow orders.** When one fire team was shot away, men lent from the other team were put in the empty team's orders but went on reading their own, so they stood still. A man now takes the orders that name him.
- **Balance.** Before these, the city went to the defence five times in six. With them, twelve seeds split evenly. The attackers get an extra squad and three more mortar missions there, and an anti-tank gun is half as likely, because a Pak firing high explosive down a street was the single biggest killer. All of it is in `config.urban`.
- **Map kinds.** Adding the city to `map.kindWeights` changes which kind of ground most seeds roll. The road defences and clutter change every map a little too, so old seeds no longer replay old battles.

## Winter

- **A season, not a sixth kind of place.** Winter is laid over the five kinds of ground rather than added as a map kind of its own. The Ardennes had hamlets, ridge farms, highway junctions, market towns and shelled cities too, and every one of them needed only the same changes: snow, more forest, more digging. The season is `Layout.season`, rolled in `generateScenario` from its own `"season"` stream before the map is made, so a summer seed draws exactly what it drew before. The winter-only digging uses its own `"winter"` stream for the same reason. `config.season.kind` (CLI `--season`, viewer `?season=`) forces it.
- **More wooded.** In winter each field cell's chance of being forest goes up by `woodsShare`, taken evenly off the others. It is still one roll per cell, so nothing else in the map shifts. Wheat becomes pasture under snow, and there are more copses. In the city only the park is thicker.
- **More entrenched.** Five to eight more trench lines behind the defended hedge, a foxhole dug on the line position behind the hedge every three tiles, more strongpoints, and 30 to 50 old holes, mostly in the woods, anywhere short of the line of departure. Woods can be dug in winter only. The old holes help both sides: the attackers have somewhere to go to ground.
- **Lower visibility.** Every winter sky has its own row in `config.season.kinds`. Clear winter light already gives only 0.8 of summer's sight, a leaden sky 0.68, falling snow 0.45 and freezing fog 0.3. Snow also deadens sound (hearing) and spoils aim a little.
- **Slower movement.** The weather's `mud` stands for the depth of the snow (1.45 to 1.6) on all the ground mud already applied to. `map.snow` (1.25) adds to roads, paving and the rest of the outdoors, which mud never touched; floors, stairs and doorways are untouched. Fatigue is up by a third, and tanks bog down more through the same mud factor.
- **The vetted seeds stay summer in the viewer.** The featured and daily seeds were chosen for where the first contact happens. Seeds 19, 4 and 2 would roll winter, so the viewer asks for summer for those unless `?season=` says otherwise. Any other old seed link now gives a winter battle about a third of the time.
- **Greatcoats are sprite grids of their own,** not a palette swap. The coat needs a longer skirt (split at the knee when walking), a scarf row under the chin, and gloves for hands. Snow on the helmet crown is what reads as winter from far out; a third of helmets are whitewashed.

## Fire control and ambushes

- **The platoon, not the squad, decides when to open fire.** Before, each defending squad opened when it saw an enemy within 35 tiles, and an ambush when one came within 22. The first man in view, usually a scout, drew every gun, and the rest of the attackers went to ground outside the killing ground. Now `fireControl` runs every tick for a defending platoon until it opens, merging what every waiting squad can see. It opens when the killing ground holds `share` (0.65) of the most enemies seen at once and at least `minVictims` (5), or when the count has stopped growing for `patience` (30 s) with most of the best still in it.
- **What gives an ambush away.** It opens early if an enemy comes within `danger` of a man in the ambush (4 tiles; 14 for the line, which cannot let the enemy reach the hedge), or if an enemy inside `lineRange` who can see one of the hidden men shoots at him. Rounds landing near a man used to open his squad. That let speculative fire, a recon team's sniper or a stray mortar bomb spring the ambush with nobody in it; of a dozen seeds, most opened that way with no enemy in range. Waiting men also no longer answer fire from men they cannot see. They fire only at an enemy within `danger`, or at one who is shooting at them.
- **The registered mortar target.** A defending platoon gets one more fire mission (`reserveMissions`) and keeps it back until the word. Two seconds after the word it comes down as fire for effect, with no ranging round, on the biggest knot of the enemy if that is clear of friends, or else stepped back along their way in until it is. In practice the enemy in the killing ground are always too close to the ambushers, so it lands on the squads following up. At first the reserve came out of the defenders' three missions, and the defence lost noticeably: those missions are what break up attacks early, on the outposts' reports.
- **Shock.** Every man in the killing ground when the platoon opens takes `shock` (0.45) suppression and a little morale, before the first round. Without it, waiting for the zone to fill only gave away the defenders' range advantage: over 18 seeds the defence went from 14 wins to 9, because attackers let in close simply fought back from there. With the shock and the extra mission, 36 summer seeds gave the defence 25 wins, against 28 before the change, which is within the noise of a sample that size.
- **The grenade volley.** For `grenadeVolley` seconds after the word, men may throw at enemies in the open as well as behind cover, and value it highly.
- **The countdown.** `fireControl` also reckons, each second, how long until the word: how long the enemy in sight would take to walk into the killing ground until enough are in it, until the lead man reaches a hidden one, and until the stall rule runs out, whichever is soonest (`killZone.eta`). It is an estimate from what the platoon can see, and it is only available once the enemy is in sight; in a city or the forest that is the last ten or twenty seconds. The viewer steadies it so it ticks down a second at a time and only jumps when the estimate moves by more than a few seconds.
- **The whole squad opens up.** On seed 27 in the city, only three or four of the twelve men in an American ambush could see an enemy when the word came; the rest, scattered through the street, held. Now, for `volleyTicks` after the word, fire and suppression outrank everything but saving a man's life, a man who cannot see the enemy fires where his squad has them if he has a line of fire, and the opening volley is aimed better (`volleyAim`): the guns were laid on the killing ground in advance, at men who did not know it was there. The shock was cut from 0.45 to 0.2 suppression, because throwing the enemy flat at once made them harder to hit. Averaged over eight seeds, men hit in the first minute went from 5.9 to 7.3 and rounds in the first thirty seconds from 66 to 107; on seed 27, from 14 to 18.
- **City ambushes in two houses.** The party's two fire teams take the two houses beside the enemy's route with the best view of it, at the windows, upstairs first (`buildingPositions`), rather than spreading over whatever hiding tiles are round a point in the street. Indoors they crouch back from the window instead of lying flat, so they can see out.
- **Holding after springing.** A sprung ambush party fell back at once: its "outflanked" check saw enemies close and to the side, which is the point of an ambush. It now turns to face the killing ground and fights where it lies for `holdAfter` seconds unless it is badly hurt or shaken.

## Fear, sight and point blank

- **Running for cover.** Hugging the ground counted as perfectly safe anywhere, and a man looked only five tiles round him for cover, so men under fire in a field lay down in it. Now lying or standing in the open under fire carries danger in the utility score, scaled by how exposed the spot is (`fear.openDanger`), and a man in the open looks up to twelve tiles for cover (`fear.coverSearch`) and values it more the more suppressed he is. The share of men under fire who were in the open fell only from 42% to 41%, because most of those left are in the middle of an assault or on their way to the cover they chose.
- **Close by.** Within `closeRange` (14 tiles, about 40 m) spotting has a floor that concealment counts for much less in, so a man in the trees or lying flat a few paces off is seen within a second or two. Within `pointBlank` (10 tiles) part of the miss chance is taken away, less with range, behind cover and when the shooter is frightened; hits per round fired within 18 m went from 10% to 32%.

## Runners

- **A runner is a man of the squad.** He was a moving dot with a dice roll for being shot, and vanished when it came up. Now the squad leader sends a rifleman, a scout, the grenadier or the ammunition bearer, whoever is nearest the Zugführer; his candidates send him running there, he is shot at like anyone else, lies where he falls and can be clicked. When he gets there the call is heard and he goes back to his squad. A squad with nobody to send cannot call.

## Rounds through cover

- **Penetration against resistance.** Each weapon has a `pen` (a .30 rifle round 8, a submachine gun 3, the .50 18) and each material a `resist` (a hedgerow bank 7, a tree 5, a door 2, a log wall 5, a garden wall 14, a house wall 20). The share that gets through is 1 − resist / pen. For a man seen behind cover, the cover beside him is split into what stops the round and what it goes through; for fire at a man who cannot be seen, everything solid on the line is added up. What gets through hits only close in (it falls by e every 20 tiles) and does 55% of the damage. In two bocage battles, 1% and 8% of gunshot wounds came through cover.
- **Men know it.** An enemy known to be behind something a man's round goes through, within reach, gets a "fire through the hedge" candidate valued by how much gets through; a machine gun values it more. In one bocage battle that was chosen 366 times, nearly all through hedges.

## Machine-gun teams

- **Their own step, not a rifle squad's.** The team is kept out of `pl.squadIds` (in `pl.mgIds`) so the rifle-squad machinery never asks it to bound, flank or assault. `mgTeamStep` follows the rifle squads, chooses an overwatch spot by line of fire, cover, height and distance to carry the gun, sets up and suppresses, keeps its spot while it can still fire on what matters, moves on after `relocate` seconds without a target, and pulls back when the enemy comes within `tooClose`. Defending, it starts dug in toward the middle of the line (at first it took the longest view, which was out on a flank with nothing to shoot at) and shifts along the line if it has no line of fire once the shooting starts.
- **Setting up.** Any weapon with a `setup` time cannot fire until that long after it was last carried (the engine notes the tick in `cooldowns.movedAt`); the gunner's candidates offer "set the gun up" meanwhile. While it fires, the gunner is `sittingDuck` times the target.
- **Kept to the Americans.** The team comes from its own seed stream, the force generation is otherwise as it was, and every rule that made the MG 42 special (feeding the belt, the priority it gets as a target, ammunition resupply, being heard and spotted) now applies to any `isMachineGun` weapon.

## The forest line

- **Its own generator, as the city has.** `forest.ts` builds the whole map and returns the same `Layout`. The defended trench zig-zags across the full width, firing positions every three tiles, wire five tiles out with gaps, log bunkers (a pit with sandbags in front and to the sides) every 18 to 26 tiles for the guns. The attackers' trench is just in front of where they form up, with gaps. No man's land between is "torn" more toward its middle, with smooth stands of trees left standing so it is not uniformly open. It comes up only in winter (`map.winterOnly`), so summer seeds still roll exactly the kinds they did.
- **Rocks.** A new terrain: impassable, cover like a statue (0.85), and blocks most sight. Outcrops of one to three boulders, never on the tracks or the trench lines.

## Sound of the machine guns

- **Voicing in the browser, not new recordings.** The bank has no Browning recordings, and the raw recordings it was built from are not in the repository. The .30 and the .50 are made at play time from the BAR and the MG 42: pitched down, a low shelf and a low peak for weight, soft clipping, and the top cut. The BAR and MG 42 get a lighter dose of the same. Shots in a burst are spaced at each gun's cyclic rate (`GUN_VOICE` in `viewer/src/main.ts`), squeezed into the tick when the clock runs faster than the burst would take.

