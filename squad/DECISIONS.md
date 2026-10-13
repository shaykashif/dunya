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
