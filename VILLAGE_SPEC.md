# Village Simulation: Implementation Spec (Milestone 1)

This document is a brief for implementing the first playable slice of a deterministic village simulation. Read it fully before writing code. Where it is specific, follow it. Where it leaves room, make the simplest choice that keeps the core rules intact and note the choice in `DECISIONS.md`.

## 1. Goal

Build a headless, deterministic simulation of a village of about 25 people in two or three families. Hunger can push people to steal, and in extreme cases to kill. Crimes leave traces. Witnesses hold partial and sometimes false beliefs. Villagers investigate, accuse, judge, and punish. Every outcome must be reproducible from a seed and an event log.

This milestone also includes an environment (day and night, seasons, temperature, weather, water, shelter, and fire), survival needs and wants, and bonding and romance between villagers. Each is described below.

Out of scope for this milestone: trade between villages, war, a browser UI beyond a minimal text or log viewer, and any real LLM calls. Leave clear extension points for all of these.

## 2. Core principles (non-negotiable)

1. **The world engine is the sole authority on what happened.** Nothing else writes world state.
2. **Determinism.** Given the same seed, configuration, and decision sequence, the run is bit-for-bit identical. Never use `Math.random`, `Date.now`, or iteration over unordered structures whose order can change. Use a seeded PRNG (for example sfc32 or mulberry32) and sort any collection before iterating when order matters.
3. **Decisions are pluggable.** Creatures choose actions through a `DecisionSource` interface. The first implementation is a utility scorer. A NanoJev-backed implementation comes later and must be a drop-in replacement.
4. **Agents know only their beliefs.** Each agent has a belief store, which is a subset of world facts, possibly wrong. Investigation and justice operate only on beliefs.
5. **Everything is logged.** Every action attempt, resolution, trace, belief change, accusation, and verdict becomes an event. The event log must be sufficient to replay and to explain any outcome.
6. **Model-agnostic text is out of the loop.** No language model is called in this milestone. Text output, if any, is generated from templates.

## 3. Tech stack

- TypeScript, strict mode.
- Node.js for the headless engine and tests.
- Test runner: Vitest or Node's built-in test runner. Pick one and stick to it.
- No runtime dependencies beyond what the PRNG and tests need.
- Keep the engine free of any DOM or browser APIs so it can later run in a Web Worker unchanged.

Suggested layout:

```
village/
  src/
    engine/        tick loop, scheduling, RNG, ids
    world/         map, tiles, items, stores, structures
    entities/      people, families, needs, inventory, relationships
    actions/       action definitions, candidate generation, resolution
    perception/    sight, traces, witnesses, belief updates
    investigation/ examine, interview, deduce, case files
    justice/       norms, roles, accusations, hearings, verdicts, sentences
    decision/      DecisionSource interface, utility scorer, stub for NanoJev
    log/           event types, writer, replay, hashing
    scenario/      initial village generation from seed
  test/
  DECISIONS.md
```

## 4. World model

### 4.1 Map
- A grid of tiles, for example 40x40. Each tile has a terrain type (ground, field, forest, water, path, building floor, wall).
- Buildings are rectangles of tiles with a door. Each household has one house. There is one communal store and one meeting place (the elder's house or a clearing).
- Terrain affects movement cost and visibility. Walls block sight. Forests give partial cover.

### 4.2 Items and stores
- Items have a kind (grain, fish, cloth, tool, etc.), a quantity, and an owner (a person, a household, the communal store, or unowned).
- Conservation rule: the total quantity of each item kind is constant except through explicit production and consumption events. Add an invariant check that runs every tick in tests.

### 4.3 People
Each person has:
- `id`, `name`, `age`, `sex`, `householdId`.
- `survival`: values that must stay above zero or the person's health declines. Each is a number in [0, 1], updated each tick:
  - `food` (hunger): falls over time, restored by eating.
  - `water` (thirst): falls faster in heat, restored by drinking.
  - `warmth`: falls in cold weather or at night without a fire or shelter, restored by fire, shelter, or clothing.
  - `rest`: falls during waking hours, restored by sleeping, which is more effective at night.
  - `health`: declines while any survival value is at zero, recovers slowly otherwise. Reaching zero is death. Causes of death include starvation, dehydration, exposure, and wounds.
- `wants`: values that shape mood and motivation but never kill directly. Each is a number in [0, 1]:
  - `companionship`: falls when alone, restored by socializing.
  - `affection`: needs a partner or close bond. Drives courtship and romance (section 4.6).
  - `status`: rises with respect from others and with the role held.
  - `comfort`: falls when living in poor shelter or with unmet survival needs.
  - `security`: falls after threats, crimes, or unresolved accusations.
  - Wants feed the utility scorer as weighted terms and are logged each tick in summary form.
- `personality`: fixed traits in [0, 1], for example `boldness`, `empathy`, `greed`, `honesty`, `loyalty`. These weight decisions and later drive lying.
- `inventory`: the items the person holds.
- `relationships`: a sparse map from other person id to `{ bond: number, trust: number }` in [-1, 1] for trust and [0, 1] for bond.
- `beliefs`: see 4.7.
- `status`: alive or dead, and a location.
- `role`: none, elder, or other roles as defined by norms.

### 4.4 Families
Start with 2 to 3 households of 4 to 9 people each. Parent-child and sibling bonds start high. Kin obligations (section 6) apply to these bonds.

### 4.5 Environment

The environment is part of the world state and is updated by the engine, never by agents.

**Time.** One tick is 10 simulated minutes, so a day is 144 ticks and a year is 360 days split into four seasons of 90 days. Track `tick`, `hour`, `day`, `season`, and `year`.

**Day and night.** A light level in [0, 1] follows the hour: brightest at midday, darkest around 02:00. Light affects:
- Detection: observers see less at night, so `steal` and `attack` are harder to witness after dark. Use this in section 6.3.
- Sight range: reduced in low light.
- Sleep: rest recovers faster at night.
- Activity: most people work by day and sleep at night. Each person has a sleep schedule from personality and age, not a single global clock.

**Temperature.** Air temperature is a seasonal baseline plus a daily swing (cooler at night, warmer by day) plus weather. Season baselines are defined as data, for example winter mean around 0 degrees C and summer mean around 24 degrees C. Temperature drives:
- Warmth loss: the colder the air, the faster warmth falls. Warmth also falls at night with no fire or shelter.
- Water loss: thirst rises faster in heat.
- Crop growth: fields only produce during the growing season. Winter forces stored food to last.

**Weather.** A seeded Markov chain over states: clear, cloudy, rain, storm, snow (snow only below freezing). Weather changes at most once per few hours, and seasons make some states more likely.
- Rain and snow clear footprints on open ground after a set time (section 7.1).
- Storms reduce sight range and make outdoor activity riskier.
- Rain fills the well and water source.
- Snow adds to cold and blocks some movement.

**Water.** A well in the village center and a river along one edge. Drinking requires reaching the well or river. Water is free, but the walk costs time, and the well can run low in drought seasons (a parameter).

**Shelter and fire.** Houses protect from weather and nightly cold but only within their walls. Each household needs a hearth. A fire consumes firewood, produced by a `gather_wood` action from the forest. Without wood, warmth falls faster.

**Food production.** Fields produce grain during growing seasons, at a rate set by a rule. Harvest is a seasonal event that moves grain from fields to the communal store. Food scarcity in winter is the main pressure that pushes people toward theft, so tune these parameters carefully.

### 4.6 Bonding and romance

Romance is a set of rules over bonds, not a separate system.

**Attraction.** Each pair has an attraction score in [0, 1], computed from:
- Personality compatibility (for example, similar `empathy` and complementary `boldness`).
- Proximity and time spent together.
- Shared positive events, such as helping in a crisis.
- Age and life stage. Attraction is only possible between people above a minimum age and within a configurable age gap.
- Negative events lower attraction: betrayal, theft from each other, or harm.

**Stages.** A relationship moves through these stages, stored as `relationships[other].stage`:
1. `stranger`: no meaningful bond.
2. `acquaintance`: some time together, bond above a threshold.
3. `friend`: sustained positive interaction, bond and trust above thresholds.
4. `courting`: one person has taken a `court` action and the other has accepted. Courting raises affection and attraction, and makes both people more likely to share food and time with each other.
5. `pair_bonded`: a mutual commitment, formed when both people's attraction and affection are above a threshold and both accept a `propose` action. A pair bond creates obligations (section 11), such as food sharing, protection, and childcare.
6. `estranged`: a former pair bond or friendship after a breakup or betrayal. Estrangement carries grief or resentment and makes reconciliation harder.

**Actions.** Add these to section 6.1:
- **court**: express interest in another person. The target accepts or rejects using their own decision source, based on attraction, trust, their own affection, and whether they are already in a pair bond.
- **propose**: formally offer a pair bond after courting. Acceptance follows the same rule.
- **break_up**: end a pair bond or courtship. It emits an event, creates an obligation dispute if children or shared food are involved, and lowers the other person's affection and trust.
- **comfort**: support someone who is grieving or distressed. Raises their affection toward the comforter if the bond is already positive.

**Jealousy and infidelity.** When a pair-bonded person's attraction toward another rises above a threshold, the partner gains jealousy. Jealousy can cause conflict: an accusation, a confrontation (an attack or threat), or a break-up. An affair is an event recorded in the log. It can be witnessed, which creates beliefs, and it can become a case if it involves theft or violence.

**Children.** A pair-bonded couple above a fertility age may have a child on a seeded schedule with a low rate per season, gated on food security (a family in famine does not have children). The child becomes a new person with `householdId` and parent relationships. Children are dependents: an adult must provide food and warmth. A child whose parents die becomes an obligation of kin.

**Death and widowhood.** When one partner dies, the other gains grief, which is a want loss. Remarriage is possible after a configurable period.

**Abstraction.** Physical intimacy is not simulated in detail. The log records only the events that matter for the simulation: a pair-bond formation, a child born, a break-up, an affair. Do not add explicit content.

### 4.7 Beliefs

A belief is a claim an agent holds about the world, with a confidence value and a source:

```ts
interface Belief {
  subject: EntityRef;      // the person, item, or place the claim is about
  predicate: string;       // e.g. "was_at", "took", "killed", "owns"
  object?: EntityRef | string | number;
  time: number;            // tick the claim refers to
  confidence: number;      // [0, 1]
  source: "saw" | "heard" | "inferred";
  fromId?: number;         // who told them, if heard
}
```

Beliefs are created by perception and by testimony. They may decay in confidence over time. They never reference world truth directly.

## 5. Engine and tick loop

- Fixed tick duration. One tick is one simulated time unit (for example 10 minutes).
- Each tick, in this order:
  1. Update the environment: advance the clock, light level, temperature, and weather. Weather transitions use the scenario RNG stream.
  2. Update survival and want values for each person, using the environment (heat, cold, darkness, shelter, fire). Update health. Process any deaths from zero health.
  3. For each living person whose current plan is complete or interrupted, request a decision from the `DecisionSource`.
  4. Resolve actions in a deterministic order (sort by person id).
  5. Run perception: each person checks what is visible within sight range and updates beliefs. Light and weather change sight range.
  6. Run bonding updates: attraction, stage transitions, jealousy, pregnancy checks, and child births.
  7. Run justice and investigation scheduling (events such as accusations and hearings fire here).
  8. Check invariants (conservation, no dead person acts, no negative quantities, no pair bond with a dead person).
  9. Append events to the log.
- Plans: an action can span multiple ticks (walking, examining). Store progress on the person. Interruptions (being attacked, hearing alarm) cancel the plan and emit an event.

## 6. Actions

Each action type defines:
- `id`, `name`.
- `candidates(person, world)`: returns the list of legal instances for this person right now. Each instance has a target, a cost in time, a risk estimate, and a short description.
- `resolve(person, instance, world, rng)`: applies the outcome and returns the resulting events, including traces.

### 6.1 Required action types for this milestone

- **forage**: gain food from a field or forest tile. Success depends on terrain and rng. Costs time.
- **eat**: consume food from own inventory. Reduces hunger.
- **give**: transfer an item to another person. Raises the recipient's bond with the giver.
- **request_food**: ask another person for food. The response is decided by the recipient's decision source, using bond, their own hunger, and the request. Refusal is an event.
- **steal**: take an item from another person's inventory or from the communal store, without consent. Success requires that the target does not notice, based on distance, the target's vigilance, and rng. Failure or detection leaves a trace. Stealing from a store requires being at the store.
- **attack**: deal damage to another person. Can be lethal. Outcome depends on relative strength and rng. Always leaves a trace (blood or wounds are attached to the victim's record).
- **examine**: investigate a location or body for traces.
- **interview**: ask another person what they know. See section 8.
- **accuse**: formally name someone as a suspect to an elder or authority.
- **testify**: give a statement at a hearing.
- **judge** (elder only): hear a case and deliver a verdict.
- **punish**: carry out a sentence. Enforcement can fail.
- **idle / socialize**: low-impact default actions. Socializing raises bond and companionship.
- **sleep**: restores rest, faster at night and in a sheltered place. Sleeping outdoors in cold weather lowers warmth.
- **drink**: restores water at the well or river. Requires travel.
- **gather_wood**: collect firewood from the forest. Costs time and carries a small risk in storms.
- **tend_fire**: feed the household hearth with wood to restore warmth for everyone inside.
- **repair_shelter**: spend time and materials to keep a house weatherproof. Poor shelter lowers comfort and warmth.
- **plant / harvest**: work the fields during the correct season. Output depends on weather and labor.
- **court, propose, break_up, comfort**: bonding actions, defined in section 4.6.

### 6.2 Candidate pruning
Keep the number of candidates small, at most about 30 per decision. If a person's full candidate list is larger, pre-score candidates with the utility function and keep the top ones. This is required so the future NanoJev 255-candidate cap is never a constraint.

### 6.3 Risk and detection
Every action that could be seen computes a detection probability from distance, light, cover, and the observer's vigilance. The engine rolls with the action's RNG stream. Detection creates a witness trace. Non-detection leaves only physical traces, if any.

## 7. Traces and perception

### 7.1 Traces
A trace is a world record:

```ts
interface Trace {
  id: number;
  tick: number;
  location: TileRef;
  kind: "footprint" | "item_missing" | "blood" | "body" | "object_left" | "sound" | "wound";
  involves: EntityRef[];   // people or items involved
  details: Record<string, unknown>;
  discovered: boolean;
}
```

Traces persist until removed by a rule, such as rain clearing footprints or a body being buried. Store them in the world, not in any agent.

### 7.2 Perception
Each tick, each living person perceives:
- Other people within sight range and not blocked by walls. Perception rolls decide whether they notice an action. Noticing creates a belief with source `saw`.
- Traces in view. Discovering a trace marks it `discovered` and creates a belief.
- Events heard within a smaller radius, with lower confidence.

Perception of a crime should be partial. A child may see a figure without a face. Store the actual observed detail in the belief, not the full truth.

### 7.3 Testimony
Testimony transfers beliefs. A speaker shares a claim from their belief store. The receiving belief gets `source: "heard"`, `fromId: speaker`, and reduced confidence. Speakers may lie: they may omit, distort, or fabricate. Lying decisions use the speaker's honesty trait, their bond with the subject, and their own risk. The engine must record whether a statement was a lie (in the log, not visible to other agents).

## 8. Investigation

- **examine**: a person or elder examines a location. Success reveals undiscovered traces within range, with a skill-based roll. Discovered traces become beliefs for the examiner.
- **interview**: the investigator chooses a witness with relevant beliefs. The witness decides what to share (see 7.3). The investigator records the testimony as heard beliefs.
- **deduce**: combine beliefs into suspects using explicit rules. Start with three:
  - `means`: the suspect could have done it (for example they were near the scene).
  - `motive`: the suspect needed food, or had a grudge, or was harmed by the victim.
  - `opportunity`: the suspect was present at the time.
  A suspect's score is the count of satisfied criteria weighted by belief confidence. Deduction is deterministic given beliefs.
- **case file**: an investigator keeps a case file per crime: suspects, beliefs, traces, and status. Case files are agent-level, not world-level.

Investigators can be wrong. The engine must not correct their conclusions. The log records what they believed and what was true, so the difference is inspectable.

## 9. Justice

### 9.1 Norms
Norms are data:

```ts
interface Norm {
  id: string;
  forbids: ActionKind;           // e.g. "steal", "attack"
  penaltyOptions: Sentence[];    // e.g. restitution, exile, imprisonment, execution
  exemptions?: (actor, victim) => boolean; // e.g. kin exemption, optional
}
```

Ship with two norms: theft and violence. Keep penalties as data so villages can differ later.

### 9.2 Roles
- **Elder**: the village's authority, who hears accusations and issues verdicts. Chosen at scenario start.
- **Household head**: can pursue restitution on behalf of their household.

### 9.3 Process
1. **Accusation**: someone reports a suspect to the elder. The accuser may be mistaken or motivated.
2. **Investigation**: the elder examines the scene and interviews witnesses, or assigns others to.
3. **Hearing**: the elder reviews the case file. Testimony is given (the statements are recorded as events).
4. **Verdict**: the elder chooses a verdict from the norms' penalty options. Verdict is based on the case file, not on world truth.
5. **Sentence**: the sentence is recorded. Enforcement is a separate step and can fail (for example, the accused's household refuses to comply, or the sentence is carried out by a family member).

### 9.4 Conflicts of interest
If the elder is kin to the accused or the victim, the elder must recuse. The engine enforces this check. If no one can judge, the household heads decide jointly.

### 9.5 Retaliation
A family that believes a verdict was unjust may take revenge. Revenge is an ordinary `attack` action with a motive recorded in its details. It can start a new feud.

## 10. Decision interface

```ts
interface DecisionSource {
  decide(
    person: Person,
    candidates: CandidateAction[],
    view: DecisionContext      // the person's beliefs, needs, emotions, recent events
  ): Promise<Decision> | Decision;
}

interface Decision {
  candidateIndex: number;
  rationale?: string;        // optional, for logs
}
```

Implement `UtilityDecisionSource` first:
- Score each candidate as the weighted sum of: need reduction, relationship effects, obligation fulfillment (section 11), risk (negative), and personality weights.
- Choose with a seeded softmax or argmax over scores. Use argmax for the first version so behavior is easy to inspect, and add noise later.

Implement `NanoJevDecisionSource` as a stub that throws `NotImplemented`. Do not call any model.

Decisions must be logged, including the candidates offered and the chosen index.

## 11. Motivations and obligations

- **Drives**: each person has weights for self-interest, safety, status, and attachment to specific others. Personality sets the weights.
- **Obligations**: a commitment record:

```ts
interface Obligation {
  id: number;
  holder: number;        // person who owes
  owed_to: number;       // person who is owed
  kind: "food_share" | "protection" | "debt" | "kin_duty" | "pair_duty" | "childcare";
  strength: number;      // [0, 1], from bond
  due: number | null;    // tick, or null for ongoing
  status: "active" | "fulfilled" | "broken";
}
```

Obligations raise the score of actions that fulfill them. Breaking an obligation emits an event, reduces trust from the owed-to person toward the holder, and creates guilt in the holder (a simple emotion value that decays).

Keep emotions minimal in this milestone: a single `distress` or `guilt` scalar per person is enough. Do not build the full appraisal system yet.

## 12. Event log

Every event has:

```ts
interface Event {
  seq: number;        // global sequence number
  tick: number;
  type: string;       // e.g. "action_resolved", "trace_created", "belief_added", "accusation", "verdict"
  actors: number[];
  data: Record<string, unknown>;
}
```

- Written as newline-delimited JSON.
- Replay: given a seed and the decision log, the engine must reproduce the event log exactly. Provide a `replay` command that verifies this.
- Include a hash of the event stream in the run summary, so tests can compare runs cheaply.

## 13. Scenario

Starting village:
- Map: 40x40 with three households, a communal store, a field, a forest, and a meeting place.
- People: about 25, spread across households, with ages and personalities drawn from the seed.
- Initial store: enough food for the village for about 30 days, but unevenly distributed. One household should have less food than it needs under normal rations, to create pressure.
- Elder: the oldest person not in the most-strained household. Chosen by a rule, so it's deterministic.
- Calendar: the run starts in early autumn, so the first winter arrives around day 60 and tests food and warmth early.
- Relationships: two or three existing pair bonds, at least one single adult of each sex in the village, and some children. Starting bonds are drawn from the seed.
- Weather and temperature: the seasonal curve and weather chain are seeded, so every run with the same seed has the same weather.
- Environment parameters (well drought chance, light curve, season temperatures, attraction weights, child rate) live in a single config object, so tuning does not require code changes.

Scenario generation must be a pure function of the seed.

## 14. Tests and acceptance criteria

Required tests:

1. **Determinism**: running the same seed twice produces identical event-stream hashes.
2. **Replay**: replaying a run from its decision log reproduces the same event stream.
3. **Conservation**: total quantities of each item kind are constant except for logged production and consumption.
4. **No dead actors**: a dead person never appears as an actor in later events.
5. **Perception bounds**: no belief appears without a source event (saw, heard, or inferred).
6. **Belief isolation**: a deduction step cannot reference world truth; enforce this by type (pass only the investigator's beliefs and case file into deduction).
7. **Conflict of interest**: an elder related to the accused does not hear their case.
8. **Wrongful verdict is possible**: construct a scenario where a witness lies or is mistaken, and check that a wrong verdict can result, and that the log shows both the belief and the truth.
9. **Starvation pressure**: over a 60-day simulated run, at least one theft occurs in the default scenario without any scripted instruction. If this doesn't happen, tune the parameters, not the rules.
10. **Smoke run**: a 90-day run completes without exceptions and with all invariants passing.
11. **Survival**: a person with food or water at zero for long enough dies, and the death is logged with its cause. A person with a fire and shelter in winter survives where an unsheltered person of the same health does not.
12. **Day and night**: the same theft attempt is detected less often at night than at midday, with other factors held equal (statistical check over many seeds).
13. **Weather effects**: rain clears footprints on open ground after the configured time, and does not clear traces under a roof.
14. **Bonding integrity**: a pair bond exists only between two living people who both accepted a `propose`. Every break-up, death, or child birth appears in the log. No child is born without a pair-bonded couple or to a family in famine.
15. **Romance can happen**: across 20 seeds, at least some pairs progress from stranger to pair bond. If none do, tune attraction parameters, not the stage rules.

Add a CLI command `npm run simulate -- --seed 42 --days 90` that prints a short summary: population, deaths, thefts, accusations, verdicts, and the event-stream hash.

## 15. Milestones inside this spec

Implement in this order, and get tests passing at each step before moving on:

1. Engine skeleton: RNG, tick loop, event log, hashing. Empty world. Determinism test passes.
2. World and people: map, households, needs, inventory. Conservation test passes.
3. Environment: clock, day and night light, seasons, temperature, weather, well and river. Environment tests pass (sections 14.12 and 14.13 can be checked here).
4. Survival and wants: food, water, warmth, rest, health, and death from causes. Survival test passes.
5. Basic actions: forage, eat, drink, sleep, gather_wood, tend_fire, give, socialize, with utility decisions. Smoke run completes.
6. Crime actions: steal and attack, with resolution and traces. Starvation pressure test passes.
7. Perception and beliefs: sight, witnesses, belief updates, testimony. Belief isolation test passes.
8. Investigation: examine, interview, deduce, case files.
9. Justice: norms, elder, accusation, hearing, verdict, sentence, conflict of interest check.
10. Obligations and minimal distress.
11. Bonding and romance: attraction, stages, court, propose, break_up, comfort, jealousy, children. Bonding integrity and romance tests pass.
12. Replay tool and the full test list.

## 16. Explicit non-goals and warnings

- Do not add a language model call anywhere in this milestone.
- Do not give the engine a "story" or scripted events. If the story is dull, tune parameters or add rules; do not add scripted plot.
- Do not let the deduction or justice code read world truth. Make the types enforce this.
- Do not optimize early. 25 people with a few dozen candidates each is trivial.
- Do not build a graphical UI. A text summary and the event log are enough.
- Keep every random draw traceable. Prefer a separate RNG stream per subsystem, derived from the seed, so adding a new random call in one place does not shift results everywhere else.

## 17. Deliverables

- The source tree described in section 3.
- `DECISIONS.md`: each choice you made where this spec was open, with a short reason.
- `README.md`: how to run the simulation and tests.
- Passing tests for all items in section 14.
- A sample run summary for seed 42 over 90 days, pasted into the README.

## 18. Open questions to note, not decide

- How severe should starvation be before it justifies theft versus begging? Parameterize it.
- Should children be able to testify? Parameterize it.
- How long should case files and traces persist? Parameterize it.

Record any answers you choose in `DECISIONS.md`.
