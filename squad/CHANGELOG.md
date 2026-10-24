# Changelog

What changed in the squad simulation, newest first. The reasons behind each change are in [`DECISIONS.md`](DECISIONS.md), and every number mentioned here lives in `src/scenario/config.ts`.

## 23 October 2026: orders for squads, and a man of your own

### New

- **Orders for a squad.** Zoomed out, click a squad's label (or **Orders** in the Squads tab) and an orders panel opens beside Barrage, Smoke and Sniper:
  - **Move to:** click a place. The squad bounds there its own way (hedge to hedge, or house to house in a city), then spreads out into cover and holds it.
  - **Assault:** click a position. The base of fire pins it while the rifle team rushes it; enemies in a house get the grenade drill. Once the position is taken the squad holds it.
  - **Suppress:** click a place. Every man with a line of fire on it shoots at it, and those without one move up until they have one.
  - **Hold:** stay where they are and fight from there.
  - **Carry on:** hand the squad back to the platoon's own plan.

  The order stands until it is lifted, the squad loses its leader, or the platoon pulls back. The platoon leader leaves a squad under orders alone, and the map shows each order as a dashed line to a marked spot.
- **Taking control of a soldier.** Select a man and press **T** (or **Take control** in his panel, or on the tap card).
  - **On a computer:** WASD moves him, Shift runs, C cycles standing, crouched and prone, and he faces the pointer. Click fires there (aimed at an enemy he can see there, otherwise into the spot), G or a right-click throws a grenade, R reloads, and T lets him go.
  - **Realism:** he has his own rounds and grenades, gets suppressed and wounded like anyone else, and slows down when he is hurt or blown. A man who cannot walk drags himself. A machine gun still has to be set up after it is moved.
  - **Losing him:** if he is killed or taken prisoner, control is lost.
  - **On a phone:** a thumb stick (push to the rim to run), and a touch on the map fires there. The powers bar and minimap step aside while you have control.
  - Taking control drops the speed to 1x.
- **Replays:** orders, taking control and every change of the controls are logged as interventions and replay exactly.

### Changed

- **Quieter machine-gun bursts.** Each round's recording carries its own room echo, and a burst played a dozen of them over one another. Now each shot is cut off as the next fires, and only the last of a burst rings out, shortened. The MG 42 is a little quieter too.

## 23 October 2026: the forest line, machine-gun teams and rounds through cover

Commit `a233830`.

### New

- **The forest line.** A sixth kind of ground, fought only in winter: fir and beech forest over rocky ridges, cut by a logging track and a forest road that cross at the objective, with a forester's lodge there and a woodcutter's hut or two.
  - **Trenches:** each side holds a trench line across the whole map. The defenders' line has a belt of wire in front, log-covered machine-gun bunkers, and communication trenches back to a reserve trench at the crossroads. The attackers form up behind their own trench.
  - **No man's land:** forest smashed by shelling into stumps, deadfall and craters, with stands of trees still upright, boulders, and firebreaks running across it as open lanes.
  - **Choosing it:** `--map forest` on the command line, `?map=forest` in the viewer.
- **Boulders.** A new kind of ground: solid cover that nobody can walk through.
- **American machine-gun teams.** About seven American platoons in ten, attacking or defending, have a team from the weapons platoon: a sergeant, a gunner, his assistant and two ammunition bearers.
  - **The guns:** a Browning M1919A4 .30, or one time in three an M2 .50.
  - **Setting up:** the gun must be set up on its tripod before it fires: 10 seconds for the .30 and 20 for the .50, after every move.
  - **Strengths and weaknesses:** it suppresses hardest of anything on the field, and the .50 goes through most cover. But the gunner sitting up behind it while it fires is an easy target.
  - **Attacking:** the team follows the rifle squads, carries the gun to a spot with a line of fire on the enemy, sets up and fires while the squads move.
  - **Defending:** it is dug in on the line.
  - **When the enemy closes:** it picks up the gun and pulls back.
- **Rounds through cover.** Bullets go through what they have the punch for:
  - **Rifles and machine guns:** through doors, windows, trees and log walls, and now and then through a hedgerow bank (about one round in eight).
  - **Submachine guns and pistols:** barely through a door.
  - **The .50:** through nearly all of it.
  - **Stone walls and houses:** stop everything but a little of the .50.

  What gets through hits only close in and does about half the damage. Men know this: an enemy known to be behind a hedge or a cabin wall gets fire put through it.
- **The ambush countdown.** In the wide view, an ambush party shows a box counting down to when the platoon expects to open fire, for example "AMBUSH · FIRE IN 0:12 · 3 of 5 in the killing ground". The killing ground is marked with a dashed ring, and the box flashes FIRE! when the shooting starts. The countdown appears once the enemy is in sight.

### Changed

- **Ambushes hit harder.**
  - **The whole squad:** when the word comes, every man fires at once, the gunners hardest. A man who can't see the enemy himself fires where his squad has them, and the opening volley is aimed better.
  - **Results:** rounds fired in the first 30 seconds roughly doubled (66 to 107 on average), and men hit in the first minute rose from 5.9 to 7.3.
  - **Holding on:** the ambush party now fights where it lies for two minutes instead of falling back the moment it springs the trap.
- **City ambushes use two houses.** The two fire teams take the two houses beside the enemy's route with the best view of it, at the windows, upstairs first.
- **Runners are real soldiers.** A German squad's runner is now one of its own riflemen. He runs to the platoon leader under fire, can be shot, leaves a body, and can be clicked like anyone else. A squad with nobody to send can't call for help.
- **Close-range fighting.**
  - **Spotting:** men within about 40 m are seen within a second or two, even in the trees or lying flat.
  - **Point blank:** hits within about 18 m went from 10% to 32% of rounds, less behind solid cover or when the shooter is frightened.
- **Fear under fire.** A man under fire in the open no longer lies down where he is. He runs up to a dozen tiles for a wall, a bank, a hole or a house, and the more suppressed he is, the harder he tries.
- **Machine-gun sound.** Each automatic weapon now fires at its real rate: the MG 42 rips at about 1,200 rounds a minute, while the BAR and the Brownings thud along at about 500. The sound library has no Browning recordings, so the viewer builds them: the .30 from the BAR recording and the .50 from the MG 42 recording, each pitched down with a heavier low end. The BAR and MG 42 also sound heavier.

### Balance

- Defenders win a little less often in summer: 23 of 36 seeds, against 28 before these two updates. Winter defenders win 13 of 18. The settings that move it most are `mgTeam`, `fire.pointBlank`, `fire.pointBlankBonus` and `penetration`.
- Adding the forest to winter changed which kind of ground some winter seeds roll. Summer seeds still roll the same ground, but every battle plays out differently now because the AI has changed.

## 23 October 2026: winter in the Ardennes, and ambush fire control

Commit `26684f8`.

### New

- **Winter battles.** About one seed in three is fought in the Ardennes on 19 December 1944, on any kind of ground, deep in snow.
  - **More wooded:** more forest and copses, and no standing wheat.
  - **More dug in:** extra trench lines and strongpoints, a foxhole every few paces along the defended hedge, and old holes all through the woods.
  - **Lower visibility:** clear winter light already cuts sight to 80% of summer's; heavy snow cuts it to 45% and freezing fog to 30%.
  - **Slower going:** deep snow slows every step outdoors, roads included, tires men faster and bogs tanks more.
  - **Choosing it:** `--season winter` on the command line, `?season=winter` in the viewer. The featured and daily seeds stay summer.
- **Winter look.** Snow on the ground, trees, hedges and roofs, an iced stream, falling snow and a snowy minimap. The men wear greatcoats: the Americans an olive drab overcoat with a scarf, gloves and overshoes, the Germans the field-grey greatcoat with a wool cap. Every helmet has snow on it, and some are painted white.
- **Platoon-wide fire control.** A defending platoon no longer opens fire squad by squad at the first man in sight. Every gun holds until the killing ground is full: most of the enemy seen so far, or as many as are coming. It also opens if an enemy is about to step on a hidden man, or if an enemy who can see one of them shoots at him. Then the whole platoon opens at once, with these extras:
  - **Mortars:** a mission on a target registered before the battle. It comes straight down with no ranging round, on the ground just behind the killing ground.
  - **Grenades:** a volley from every man in reach.
  - **Shock:** the men caught in the killing ground are stunned before they can answer.

### Balance

- Over 36 summer seeds the defenders won 25, against 28 before. That is within the noise of a sample that size.
