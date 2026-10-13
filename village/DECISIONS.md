# Decisions

Choices made where `VILLAGE_SPEC.md` left room, with the reason for each. Every tunable number named here lives in `src/scenario/config.ts`.

## Tooling

- **Vitest** is the test runner. It runs the TypeScript sources directly, so there is no build step.
- **No runtime dependencies.** The CLI runs `.ts` files through Node's built-in type stripping (Node 22.18 or later). TypeScript, Vitest and `@types/node` are dev dependencies only. Imports use explicit `.ts` extensions, and `erasableSyntaxOnly` is on so every file can be stripped.
- **The engine is free of Node and DOM APIs.** Only `src/cli/` touches `node:fs`. `test/purity.test.ts` enforces this, and also bans `Math.random` and `Date.now`.

## Engine, time and logging

- **Clock.** One tick is 10 minutes and a day is 144 ticks. The run starts at 06:00 on day 30 of autumn, so winter begins on day 60.
- **Event order.** Events are appended to the log as they happen within each tick phase rather than buffered until step 9. The order is identical either way, and memory stays flat.
- **Hashing.** The stream hash is a custom 64-bit, two-lane hash over the NDJSON lines. It isn't cryptographic, but it is deterministic and dependency-free.
- **Random numbers.** The PRNG is sfc32. Each subsystem draws from its own stream (`scenario`, `weather`, `environment`, `actions`, `perception`, `testimony`, `bonding`, `justice`, ...), seeded with `splitmix32(hash("seed/stream"))`.
- **Decisions and replay.** The utility source logs its rationale string, so the decision log records it too. Replay returns it, which makes the replayed `decision` events byte-identical. Candidate pruning (section 6.2) uses the utility scorer with the config weights whatever decision source is active, so replay sees exactly the same lists.
- **Async decisions.** The interface allows `Promise<Decision>`. The engine awaits only when a promise is returned, so the synchronous utility source stays fast.
- **Logging volume.** A `tick_summary` event (environment plus village-average survival values and wants) is logged every tick, as asked. Per-person values are not logged every tick, to keep the log small.

## World

- **Map.** The 40x40 layout is fixed: forest on the west edge, a river on the east edge, three houses, a store, a well and a meeting clearing, with paths between them. The scenario RNG varies the forest edge and scatters extra forest patches. Movement uses 4-neighbour A* with terrain costs. Walls block sight; crossing between a building and the outside requires the sight line to pass the door.
- **Items.** Items are integer units held by people, households, the communal store, the field, hearths, or tiles (dropped objects). Every move goes through `transfer`, `produce` or `consume`, and the engine checks conservation every tick.
- **The communal store is the winter reserve.** It isn't freely open. The harvest moves field grain into it, and in winter the elder hands each household a daily ration (`communal.winterRationPerPersonPerDay`). Taking from it any other way is theft. While rationing, the elder notices anything missing from the store.
- **Forage depletion (an added rule).** Unlimited wild food made hunger impossible to tune, so forest and river finds add "stress" that recovers 20% a day, and the chance of a find shrinks as stress rises. This caps what 25 people can gather. It turns autumn into a race to stockpile and makes winter the real test. The spec said to tune parameters or add rules rather than script events; this is a rule.
- **Tools matter (an added rule).** Foraging without a tool succeeds 75% as often. Every adult in the two comfortable households owns a tool; the strained household owns none. This is what makes the poor household genuinely short, as section 13 asks. Without it, that household foraged its way out of trouble within days.
- **Store watch (an added rule).** Each discovered theft from the communal store raises a night watch by 0.2, which relaxes by 0.03 a day. A thief at the store is caught with probability `watch x 0.8`, by the elder or another household's head. Villagers know the watch level and price it into their risk. Without it, one desperate household could strip the winter reserve in autumn and starve the whole village.
- **Hearths.** A hearth burns one wood unit every 8 hours while it is cold and someone is home. Faster burn rates made firewood the main cause of death.
- **Infants are carried.** Children under 2 go wherever their carer goes: the mother, or another adult of the household. A fed mother nurses the infant; another carer keeps the infant watered, and food has to be given. Without this rule, infants died of thirst whenever their mother walked away.

## People and needs

- **Starting village.** There are three households of 7 to 9, 7 to 9, and the remainder (6 to 9), so the population is about 25. Each household has two founders, though one household has a single parent 35% of the time, which gives 2 or 3 pair bonds. A household may also have a grandparent, an unmarried sibling, and children. The generator ensures at least one single adult of each sex.
- **The strained household** is the largest one. It starts with 3 days of food per member against 20 for the others, and with no tools; the communal store holds 8 days' worth for everyone.
- **Elder and heads.** The elder is the oldest person outside the strained household, recomputed when the elder dies. Each household head is its oldest adult.
- **Wants and emotions.** Wants follow simple drift rules. Emotions are four scalars: `distress`, `guilt`, `grief` and `jealousy`. Grief and jealousy are needed by the romance rules.
- **Cause of death** is whichever need did the most health damage recently. Wounds come from attacks or storm injuries; execution is its own cause.
- **Infants share their carer's warmth.** A carried infant is wrapped against them, so an infant is never colder than its carer.
- **Sleep prefers home.** Sleeping outdoors costs comfort and security. Without that, people napped where they stood, even in storms.
- **Attraction starts real.** Attraction is computed for every pair at scenario start. Otherwise the first tick saw zero attraction, and founding couples broke up at dawn.
- **Detention is house arrest.** At first, detainees were held at the outdoor meeting place, and in winter that killed them. Now they stay home and may only leave to fetch water.

## Actions and decisions

- **Extra actions.** Beyond section 6.1 there are `store_goods` (bring food and wood home), `idle:home` (go home to warm up) and `respond` (an accept or refuse answer).
- **Answers go through the decision source.** `request_food`, `court` and `propose` ask the target's `DecisionSource` to choose between accept and refuse candidates. Those choices are logged with purpose `respond` and replayed like any other decision.
- **Utility scoring.** A candidate's score is the urgency-weighted sum of its expected effects on needs and wants, plus terms for provisioning, justice, duty, relationship, romance, grudge and greed. Risk and norm violation count against it, as does time spent. Norm cost falls with desperation.
- **Desperation (open question: theft versus begging).** Desperation is `(theftDesperationFood - food) / theftDesperationFood`, halved when the person still has food at home or in hand. Begging is offered only when there is nothing to eat at hand or at home, and only to people from other households.
- **Cooldowns** keep people from repeating begging, comforting, courting and proposing to the same person every tick.

## Perception, traces and testimony

- **Detection is rolled at resolution,** on the action's RNG stream. A detection becomes an `action_witnessed` event (the "witness trace") plus a pending observation, which the perception step turns into a belief.
- **What observers see.** An observer may recognize the actor, mistake them for someone of the same size (15%), or see only "a figure" with a size class. Children recognize people less reliably.
- **Notable sightings only.** Routine `was_at` sightings are recorded only when someone is inside a building that isn't their home, at the store, outdoors at night, or near blood or a body, and at most once an hour per observer and subject. Recording every sighting of everyone would have meant millions of beliefs.
- **Sounds** become beliefs with source `"heard"` and no `fromId`. They wake sleepers.
- **Belief fields.** `Belief` gains `id`, `sourceSeq` (the event that produced it), `place` and `detail`. `sourceSeq` is what the perception-bounds test checks.
- **Trace lifetimes and burial.** Lifetimes are per kind in days (open question: parameterized). Discovered bodies are buried automatically after one day. Footprints exposed to rain or snow for 12 ticks are washed away.
- **Lying.** Testimony lies are an engine rule on the `testimony` stream, not a decision-source choice. The chance rises with low honesty, kinship or a strong bond with the person incriminated, and boldness. Culprits omit their own acts, and sometimes fabricate a sighting of the person they trust least. Every statement event logs `lie` and `lieType`. Gossip never includes the speaker's own crimes. NanoJev can take over lying later.

## Investigation and justice

- **Common knowledge (census).** Deduction receives each villager's household, sex, birth tick, parents, partner and whether they are believed alive. It also receives the investigator's own trust values, which bias it. None of this is crime truth: whether someone is believed alive changes only when a body is found or a person is exiled.
- **Deduction rules.** A crime belief within the opportunity radius and time window counts toward both means and opportunity. A `was_at` sighting counts toward opportunity (discounted for wide time windows) and weakly toward means. A dropped belonging counts toward means. Size cues from footprints and figures add a little. Hunger counts as motive, and so does distrust. A confession, meaning a crime claim heard from the person it is about, counts in full toward means and opportunity, plus some motive. The score is the sum of the three criteria, each taken from its strongest supporting belief. Deduction never reads the world: it imports only belief and case types, and a test checks this.
- **Who opens a case.** Victims and their household or kin open cases, as does the elder, and honest eyewitnesses who are not protecting the culprit. Culprits never investigate their own crimes.
- **Accusation and hearing.** An accusation needs a top suspect scoring at least 1.2 and leading the next suspect by 0.15. The hearing is held at the next 10:00 at least 3 hours later. Summoned witnesses must attend in person. The verdict needs a majority of judges each scoring the accused at least 1.5 and near their own top suspect. A hearing is postponed up to 3 times, then dismissed.
- **Conflict of interest.** A judge is conflicted if kin to, or in the same household as, the accused or the victim. If the elder is conflicted, unconflicted household heads judge together. If none are unconflicted, every head except the accused and the victim judges.
- **Sentences** come from the norm's penalty list, ordered by severity. Theft gets restitution for a first or second conviction, imprisonment for a third, and exile after that. A killing leads to execution or exile depending on the lead judge's empathy. Judges never exile or execute a parent of children under 14; those sentences become imprisonment. Harsher escalation orphaned children, who then died of exposure. The victim's household head carries out an execution if they aren't kin to the convict; otherwise a judge does.
- **Enforcement can fail.** The failure chance rises with the convict's family's loyalty, bond and boldness and falls with the executor's boldness. There are two attempts.
- **Retaliation.** Kin who don't believe in the convict's guilt record a grievance against the accusers and judges. Grievances feed ordinary `attack` candidates, logged with motive `revenge`.
- **Truth stays in the log.** Each verdict event records the true culprit and whether the verdict was correct. The engine finds this through an engine-only map from beliefs and traces to crimes. Agents never see it.

## Obligations

- **Breaches.** Ongoing duties (kin, pair, childcare, food sharing) record a breach, with a trust loss and guilt, when the owed person is starving while the holder carries spare food. They stay `active`. Debts, created when a request for food is granted, become `broken` once their due tick passes.
- **Ending obligations.** Obligations involving someone who died or left, and pair duties after a break-up, are closed as `fulfilled` with the reason in the event, since the spec's status set has no "void".

## Bonding and romance

- **Attraction** combines personality fit, time spent together, shared good events and a fixed per-pair "taste" drawn from the seed, minus betrayals. Courting adds a bonus. Attraction is inclusive of sex; only female and male couples can conceive.
- **Stages.** Acquaintance, friend, drifting apart and reconciliation are engine rules checked hourly. Courting, pair bonding and break-ups happen only through actions. Widowhood sets the stage to `estranged` with reason `death`, carrying grief.
- **Pair bonding** moves one partner into the other's household: the one who isn't a household head, otherwise the younger one.
- **Children.** Conception is checked daily. It requires a female and male pair-bonded couple of fertile age, and a household not in famine *at conception*. Gestation is 270 days. Some couples start with a pregnancy already under way, so births can occur within a 90-day run.

## Tuning notes

The economy tips sharply between plenty (no theft at all) and collapse (theft strips the winter reserve, then everyone starves or freezes). The defaults sit between the two. Across seeds 1 to 5 and 42, 90-day runs end with 19 to 24 people. Each sees 39 to 121 thefts, accusations and verdicts, a few wrongful convictions, and occasional killings. The levers that matter most are `forage.stressCapacity`, the winter values in `forage.*Chance`, `forage.noToolFactor` and `communal.winterRationPerPersonPerDay`.

## Open questions (section 18)

| Question | Parameter | Current answer |
|---|---|---|
| How hungry before theft is weighed against begging | `decision.theftDesperationFood` | 0.35 |
| Can children testify | `justice.childrenCanTestify`, `justice.childTestimonyMinAge` | yes, from age 7 |
| How long traces persist | `traces.lifetimeDays`, `traces.rainClearTicks` | footprints 4 days, missing items 20, blood 12, bodies until burial |
| How long case files persist | `investigation.caseFileExpiryDays` | 30 days |

## Viewer

- **Graphical viewer.** The spec ruled out a graphical UI for this milestone; the pixel-art viewer in `viewer/` was added afterwards at the user's request. It is a separate front end that runs the same engine and doesn't change any engine code paths.

## Beyond milestone 1

Added at the user's request after milestone 1. Where these conflict with entries above, these win.

**World and movement**
- **Scale.** One tile is about 20 m. The map is 160x120: dense forest with meadows, a meandering river on the east, a town clearing with the courthouse, communal store and well, and five family compounds about 40 tiles (a bit under a km) from town.
- **Roads.** Winding forest roads join each compound to town and to its neighbours. They are carved as waypoint lines with a sine-and-random-walk offset.
- **Houses are extended families.** Each house (9 to 13 people) is an elder, often with a spouse, plus grown children with spouses who married in, plus grandchildren. Each compound has the house's dwelling, its farm, its own well and an animal pen.
- **No two people share a tile.** People pick a free tile within reach of where they are going, indoors if the destination is indoors. They may slip past others mid-walk but must end each tick on a free tile, and never rest in a doorway. When every spot at a destination is taken, they take the back of the line along their own approach path, which is how lines form at wells. Carried infants travel in their carer's arms. The engine checks occupancy every tick.

**Plots, fights and chases**
- **Plots are intentions over time.** A theft plot waits for dark, unless the thief is desperate. A murder plot waits until the victim is alone, with nobody else within 12 tiles, and in sight. While stalking, the killer records the hours and places where the victim was alone, often at their daily task, then lies in wait there.
- **Raids.** A raid is planned by the head of a house whose feud with another house is high. House members decide for themselves whether to join. The raid musters at 01:00.
- **Who steals.** Only people who are hungry, in a lean house, or truly greedy and dishonest plot thefts. Thefts from houses, farms and the communal store happen only through plots; picking pockets stays opportunistic.
- **Fights are rounds of blows.** The defender chooses, through their own decision source, to fight back, flee or give in. Either side can die. A killer who dies is logged as killed in self-defence, and the defender commits no crime. Witnesses only form beliefs about the attacker, a simplification so that defenders are not accused.
- **Chases.** Whoever catches a thief in the act may chase them. Pursuers run a little harder; most thieves still get away. A caught thief can resist (a lawful scuffle, not a crime) or give up. Stolen food goes back, and the catcher brings the thief straight before the council.

**Marriage and feuds**
- **Marriage between houses** needs both house elders to approve, each choosing through their own decision source. A couple whose marriage is forbidden may elope a day later: both accept, form a pair bond and leave the village together. Elopement counts as both accepting, for the bonding-integrity test.
- **Feuds** are per house pair, in [0, 1]. They rise with accusations of theft or violence, raids, disputed verdicts, forbidden marriages and elopements, and fall by 0.01 a day.

**The council**
- **Composition.** The village elder presides, joined by up to two heads of houses with no stake in the case. A conflicted elder steps aside.
- **Testimony is public.** Each witness speaks once, every judge hears the same statements, and each statement is tagged with its hearing so it can be shown as a transcript.
- **No retrial.** A crime already judged is not brought again.
- **Who brings cases.** Only the victim, the head of the victim's house, the elder or an honest eyewitness opens a case, rather than every member of the house.

**Evidence**
- **Bodies show signs of how they died, and reading them takes skill.** Bites can be read as blows and cold as hunger. Careful examination reads better. A body read as killed by a person, or with no visible cause, opens a violence case.
- **Blood.** Blows of 0.08 or more bloody the attacker's tool and often their clothes, and the victim's clothes. Anyone seen bloodied gives observers a `seen_bloody` belief and spreads a rumour. Killers wash at a well or the river, and being seen washing blood is itself evidence. Both count toward means in deduction, as does a gunshot near a killing for anyone known to own a musket.

**Animals, horses and muskets**
- **Livestock.** Each house has sheep, cows, chickens and (except the poorest) horses. Tended animals give milk and eggs daily and wool every few days. A house short of food may slaughter one.
- **Wolves.** Two packs of three live in deep-forest dens. At night they hunt lone people outdoors and unguarded livestock, and they back off from groups. A bitten person screams, which wakes and calls everyone in earshot, then fights or runs.
- **Horses.** People saddle up for trips of more than 22 tiles if one of their house's horses is near. Riding nearly doubles speed outdoors.
- **Muskets.** Each comfortable house's hunter keeps a musket. It helps hunting and can kill from up to 6 tiles, then needs 3 ticks to reload. A shot is heard 35 tiles away; one fired outside the forest sends people who hear it to investigate. Who owns a musket is common knowledge.

**Daily life**
- **Tasks.** Each house assigns tasks daily: caretaker (if there are young children), farmer, hunter, fisher, woodcutter, carpenter, stonemason, healer, night watchman, herder, foragers; elders and children too. Work matching one's task carries a sense of duty in scoring. Farm work and foraging go better with a tool; the poorest house has none.
- **Feelings.** Feelings are recorded with their causes ("felt grateful because...") and nudge a mood value. This stays deliberately simple, not a full appraisal system.

**Madness and player interventions**
- **Madness** builds from tragedy (grief), long loneliness, or rare bad luck, and passes over weeks. Its form follows temperament: rampage, kidnapper, thief or wanderer. Madness silences conscience in scoring. Kidnapped children are kept beside their captor; at nightfall the family notices and searches the woods.
- **Player interventions** (smite, madden) are queued, applied at the start of the next tick, logged as events and kept in an intervention log. Replays need both the decision log and the intervention log. Villagers learn of interventions only through perception: a smitten body has no visible cause.

**Tuning**
- **Tuning.** With five houses the village is better fed, so crime comes mostly from the poorest house and from feuds. Across seeds, 90-day runs see a few deaths, roughly 100 to 170 thefts, and 60 to 90 accusations.
- **Interventions dominate.** A player-maddened musket owner can kill most of his house in an afternoon, which is the point of the power.

## Injuries, retribution and justice (second round)

**Injuries (Dwarf Fortress style)**
- **Wounds are per body part.** Fights, wolf bites, gunshots, falls from horses, slipped axes and twisted ankles on roads hurt a specific part (head, face, eyes, torso, arms, hands, legs, feet). A wound has a kind (bruise, cut, gash, bite, sprain, fracture, gunshot, lost) and a severity that falls as it heals, faster when tended. Open wounds can fester and kill. Some heal badly into a lasting mark: a limp, a crooked arm, a maimed hand, a scarred or ruined face. A lost eye is permanent at once.
- **Injuries hinder.** `src/entities/body.ts` turns wounds into numbers that everything else reads: walking speed (a crutch takes weight off a bad leg), grip and arm strength (work and fighting), sight range (one eye, no eyes), pain (mood) and disfigurement (attraction and how quickly strangers warm to someone).
- **Rescue.** Someone who cannot walk calls out; anyone who hears or sees them may come and carry them home or to the infirmary in the courthouse, where the best nearby healer tends them. A family that sees someone has not come home by 20:00 goes looking. Left outside, the fallen are the first prey wolves look for. Family and healers nurse the bedridden.
- **Roles replace "builder".** Healer (tends wounds), carpenter (makes crutches), stonemason (repairs the courthouse and store, carves headstones for unmarked graves) and night watchman (evening patrol that finds the fallen and scares off wolves).
- **Accident rates are deliberately low.** Per-tile road and ground rates are tiny; hunting trips (0.4% each) and woodcutting (2%) carry the work risk. A 90-day village sees roughly 40 to 55 accidents, 5 to 11 of them leaving someone unable to walk. Earlier settings (1.5% per hunt) made nearly one person a day stumble.
- **Animals keep a history** of what they did and what was done to them, and livestock get hungry; the viewer shows it.

**Retribution**
- **Acquittals of a guilty person breed resentment.** When the council acquits someone the victim's side knows (by their own beliefs) did it, each aggrieved person adds 1 to their `injustice` toward them (1.5 for a killing of kin). At 2 or more, they may plan vengeance: threaten, maim or kill. Usually they threaten first and turn violent only as more acquittals follow. Resentment fades 0.01 a day.
- **Vengeance is a crime.** Each threat or blow is recorded as a crime (`intimidation`, `assault`, `murder`) and can be witnessed, investigated and judged like any other.

**Murder and the council**
- **First-degree murder** is a killing planned beforehand (a murder plot, or vengeance meant to kill). If the council convicts, the sentence is execution unless the council's sympathy for the killer reaches 0.4, in which case it is a 30-day imprisonment. Sympathy per judge is 0.4 x bond + 0.25 x trust + 0.35 x empathy, +0.15 for kin, +0.08 for a clean record (-0.1 otherwise), minus 0.3 x bond to the victim; the council's value is the mean. A parent of young children is always spared the rope. Other killings keep the older rule.
- **Eyewitnesses count.** `deduce` takes the strongest single signal per category, so an innocent who was nearby and disliked could outscore a direct witness. A direct sighting now adds weight (full for what the investigator saw, half for what others claim), and independent accounts corroborate (+0.25 each, up to +0.6). Identical claims from different tellers merge into one belief that remembers who told it (`tellers`), so three witnesses count as three accounts.
- **Witnesses recognise attackers.** Violence holds the eye: witnesses of an attack get +0.3 to the chance of recognising the attacker (config `detection.violenceIdentBonus`).
- **Bodies.** Someone who saw or heard of the killing is never fooled into thinking a wolf did it, and ordinary passers-by misread less often (about 15% instead of 30%).
- **No accusations by proximity.** Violence cases need direct evidence (a sighting, a confession, blood, a left object) to accuse or convict; being nearby, disliked or hungry is not enough. A case whose identified culprit is already dead is closed. Before this, someone who killed a rampaging neighbour in self-defence could go on to accuse a bystander of violence on weak circumstantial grounds.
- **Theft** keeps circumstantial reasoning, since that is how the hungry get wrongly accused.

**Kidnapping**
- A snatch seen by anyone raises the alarm at once. Otherwise the child is missed within three hours or at nightfall. The family, the elder and the child's friends take up the search, sweeping different sectors and rings of the forest.
- The nearest able adult who saw it gives chase (up to four times longer than a thief chase, and the kidnapper is slowed while dragging a child). A caught kidnapper frees the child and is accused. A child found by searchers also leads to an accusation.

**Winter**
- **The village starts with winter stores.** Households start with 70 days of food per member (10 for the strained house, 30 for the communal store) and 200 grain standing per farm. The village starts in autumn, so the first winter has to be survived on what is stored, and the earlier 20 days did not last: stores ran out by day 80 to 100, adults starved, and children left without anyone to fetch wood froze. Seeds 42, 7, 3 and 11 now keep 45 to 56 of 49 to 59 people through the first winter and spring.
- This also makes the village calmer: a 90-day run of seed 42 has 2 deaths and about 3 attacks, where the old numbers were 20 deaths and 64 attacks. Raise `scenario.foodDaysNormal` or lower it to tune.

**Viewer**
- The chronicle is a transparent overlay on the left (C toggles, B or the book button opens it in full). Intrigue, Council and People are side buttons that fill the lower right; the People panel holds the person panel (pixel face, body-damage diagram, written description, wounds) and, for animals, their needs and history.
- A fight is one alert that updates as it goes on; "Fight log" lists every blow, choice and wound. Smite moved from S to X because S now pans.


## Building, culture and the wild (third round)

**Building**
- **Projects.** A house head plans what the house lacks (beds, a table, chairs, a chest, a household altar, new rooms when crowded, a second well for a big compound, a pump, a palisade round the pen); the elder plans for the village (a bridge over the river, a temple). Each project needs wood and stone hauled to its site, then work; skill makes each stint count for more. Furniture gets a quality from the builder's skill (well-crafted up to masterful). Projects nobody touches for 20 days are given up and their materials go back. Costs are in `construction.costs`.
- **The map changes.** Extensions grow a house three rows north; wells and bridges change terrain; the temple is a new building in town. `mapChanged` drops cached paths and rebuilds site tables and reachability; the viewer redraws on `mapVersion`.
- **Stone.** Quarried at rocky outcrops (a couple lie across the river, so a bridge opens them up). Masons also carve stone figurines, which become a house's valuables.
- **Beds.** Not everyone starts with one (the poorest house least). A couple shares; infants sleep with their mother. Sleeping on the floor rests worse and leaves people sore and less comfortable; a fine bed is a small pleasure. Eating at home without a table annoys; a fine table pleases. A house's furnishing feeds its comfort.

**Skills**
- Ten skills (farming, fishing, foraging, hunting, woodcutting, carpentry, masonry, medicine, fighting, herding) earn experience by doing the work; level is `floor(sqrt(xp / 25))`, up to 20, named as in Dwarf Fortress (Dabbling to Legendary). Level scales success and yield by 0.75 to 1.25. People start with a life's worth in one or two things; each house gives tasks to its most skilled.

**Culture**
- **Values.** The village holds fifteen values (law, family, tradition, craftsmanship, hard work, leisure, martial prowess, peace, nature, fairness, cooperation, romance, truth, merriment, piety). Each house leans its own way and each person strays further. Values tint the utility scorer (the law-abiding feel theft more; the martial and the peaceful weigh grudges differently; lovers of nature dislike felling and killing), lying in testimony (truth), resentment of acquittals (fairness up, law down), scandal at elopements (tradition), and how fast people warm to each other (similar values). Sharply opposed values can start arguments when people talk.
- **Needs.** Four personal needs (to pray, to make things, to rest and play, to be with family) are felt as strongly as the value behind them; unmet, they drag mood and distract. They are met by praying, building and crafting, idling and socialising and festivals, and time near kin.
- **Religion.** A pantheon of three gods with spheres; each house has a patron. People pray at home, at a household altar, or at the temple once built. A festival in the square every 30 days.

**Theft**
- **Hunger theft needs a hungry house.** Only someone whose own house is short (under 3 food per member) plots to steal food; a hungry person with a full larder at home eats. Greed, or envy of a richer house's silver, drives theft of valuables and tools instead. Stolen valuables go back on capture or as restitution.

**Hurt and hungry people**
- The badly hurt (in pain, bleeding or weak from wounds) put aside crimes, plots and heavy work, and can bind their wounds, limp home or go to a healer. Open wounds bleed (severity x a per-kind rate, costing health) until bound or clotted; moving about slows clotting.
- Nobody sets out on a long hunt, quarry trip or wolf hunt hungry and empty-handed. A hunting mother who did starved with both her infants.

**Animals**
- **Wild game.** Deer herds range the deep woods, rabbits keep near their warrens, foxes hunt rabbits and hens at night. All bolt from people on the move and from hunting predators; deer and rabbits outrun wolves most of the time. Herds and warrens breed, and game wanders in from beyond the map when the woods are short.
- **Hunting** goes to a herd's range in the deep woods; only game within a shot (a musket) or a throw is worth it, and a still hunter goes unnoticed until close. A musket-carrying hunter shoots any wolf in sight first, as do armed defenders and watchmen.
- **Wolves** swim, range the woods morning and evening, sleep at the den through midday, chase game at night, lie in wait in the trees beside roads for anyone passing alone when very hungry, and smell out the helpless from far off. After biting someone, a wolf slinks off. Palisades turn most wolves from the pen; a turned-away wolf leaves fenced pens alone for a while. After losses, a house's hunters go to the den by day.
- **Carcasses** lie where they fell for four days and can be skinned for fur (wolves, deer, foxes); two furs make a coat worth +8 degrees outdoors.

**Inquests**
- A found body (other than an executed convict's) brings the council: the elder and heads not kin to the dead go to examine it, each reading the signs for themselves. The council rules by majority (the graver reading on a tie): wolves (bury and hunt the pack), hunger, cold or sickness (bury), or murder (each judge opens a case). The body is buried once the council has ruled, or after two days regardless.

**Map, famine and speed (fourth round)**
- **A larger map.** 192 by 144 tiles (from 160 by 120), compounds 46 tiles from town, with more meadows, outcrops, deer herds, rabbits and foxes to fill it.
- **Famine relief.** Outside winter, the elder opens the communal store to a house that has run out of food while most of its people go hungry (1 grain per person per day). On the larger map the poorest house could otherwise starve to the last child while the store sat full.
- **Babies without a nursing mother are fed** by whoever carries them, from the baby's share, the carer's, or the house store at home. Infants cannot eat on their own, so before this, a baby whose mother had died starved in its father's arms.
- **Searches cover the whole forest.** Searchers sweep around every compound and the town in turn, starting with the compound of anyone they saw take the child. On the larger map a kidnapper's hideout near his own compound was outside every ring a family searched around theirs.
- **Building waits on hunger.** Nobody plans, hauls, quarries or builds while they or their house are going hungry. At most two people work a piece of furniture at once and three a larger work, and big works take longer (a temple is several days), so the whole village no longer raises a temple in an afternoon.
- **Speed.** Paths: a search that cannot succeed (the other side of the river) stops at once, buffers are reused, and the A* heuristic is weighted 1.2, which halves the work for paths within a few per cent of the shortest. The viewer skips the stream hash and the per-tick invariant check (tests keep both), runs the simulation on a 14 ms budget per frame and drops what it cannot keep up with, caches roofs as bitmaps, counts building occupants once per frame, culls and simplifies water, and draws a half or quarter size ground image when zoomed out.
- **The river cuts a corner.** It comes in at the top edge and leaves by the right, bowing toward town (about 37 tiles away instead of 90), so it cuts off only the north-east woods. Compounds are swung round the ring or drawn in toward town until they sit clear of it, on the town's side. The outcrops beyond it lie in that corner.
