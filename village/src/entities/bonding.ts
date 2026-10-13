import { hash32 } from "../engine/rng.ts";
import { r3 } from "../log/events.ts";
import { sightRange } from "../perception/detection.ts";
import type { Person, Relationship, Stage } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { disfigurement } from "./body.ts";
import { valueSimilarity } from "./culture.ts";
import { householdFamine } from "./needs.ts";
import { createObligation, fulfillObligation } from "./obligations.ts";
import { assignHead, blankPerson, cheb, clamp01, feel, firstName, isKin, newRelationship, rel } from "./person.ts";

/** Romance is possible only between unrelated adults within the configured age gap. */
export function romanceEligible(w: World, a: Person, b: Person): boolean {
  const cfg = w.config.bonding;
  if (a.id === b.id) return false;
  if (a.partnerId !== b.id && isKin(a, b)) return false;
  if (a.parents.some((id) => b.parents.includes(id))) return false;
  const ageA = w.ageYears(a), ageB = w.ageYears(b);
  if (ageA < cfg.minAge || ageB < cfg.minAge) return false;
  return Math.abs(ageA - ageB) <= cfg.maxAgeGap;
}

/** Fixed per-pair taste in [-1, 1], a pure function of the seed and the ids. */
function taste(seed: number, a: number, b: number): number {
  return (hash32(`${seed}:taste:${a}:${b}`) / 4294967295) * 2 - 1;
}

export function computeAttraction(w: World, a: Person, b: Person, r: Relationship): number {
  if (!romanceEligible(w, a, b)) return 0;
  const cfg = w.config.bonding.attraction;
  const pa = a.personality, pb = b.personality;
  const compat = (1 - Math.abs(pa.empathy - pb.empathy) + (1 - Math.abs(pa.boldness + pb.boldness - 1))) / 2;
  const proximity = Math.min(1, r.together / cfg.togetherScale);
  const shared = Math.min(1, r.shared);
  let v = cfg.compat * compat + cfg.proximity * proximity + cfg.shared * shared + cfg.taste * taste(w.seed, a.id, b.id) - r.negative;
  if (r.stage === "courting" || r.stage === "pair_bonded") v += cfg.courtingBonus;
  // A ruined face puts people off, unless they already love them.
  else v -= w.config.injuries.disfigureAttraction * disfigurement(b);
  return clamp01(v);
}

export function setStage(w: World, a: Person, b: Person, to: Stage, reason: string): void {
  const ra = rel(a, b.id, w.tick), rb = rel(b, a.id, w.tick);
  if (ra.stage === to && rb.stage === to) return;
  const from = ra.stage;
  ra.stage = to;
  rb.stage = to;
  ra.stageTick = w.tick;
  rb.stageTick = w.tick;
  const actors = [a.id, b.id].filter((id) => w.isActive(id));
  w.emit("stage_changed", actors, { a: a.id, b: b.id, from, to, reason });
}

/** Forms a pair bond. Only called when both people accepted a `propose`. */
export function formPairBond(w: World, proposer: Person, accepter: Person, proposalSeq: number, opts: { elope?: boolean } = {}): void {
  setStage(w, proposer, accepter, "pair_bonded", "proposal_accepted");
  proposer.partnerId = accepter.id;
  accepter.partnerId = proposer.id;
  rel(proposer, accepter.id, w.tick).kin = true;
  rel(accepter, proposer.id, w.tick).kin = true;
  let movedTo: number | null = null;
  if (proposer.householdId !== accepter.householdId && !opts.elope) {
    const mover = proposer.isHead && !accepter.isHead ? accepter : !proposer.isHead && accepter.isHead ? proposer : proposer.birthTick > accepter.birthTick ? proposer : accepter;
    const stayer = mover === proposer ? accepter : proposer;
    const oldHousehold = mover.householdId;
    mover.householdId = stayer.householdId;
    movedTo = stayer.householdId;
    w.census[mover.id]!.householdId = stayer.householdId;
    assignHead(w, oldHousehold);
    assignHead(w, stayer.householdId);
  }
  w.census[proposer.id]!.partnerId = accepter.id;
  w.census[accepter.id]!.partnerId = proposer.id;
  w.emit("pair_bond_formed", [proposer.id, accepter.id], { proposer: proposer.id, accepter: accepter.id, accepted: [proposer.id, accepter.id], proposal: proposalSeq, movedTo, eloped: !!opts.elope });
  createObligation(w, proposer.id, accepter.id, "pair_duty", 0.8, null);
  createObligation(w, accepter.id, proposer.id, "pair_duty", 0.8, null);
  createObligation(w, proposer.id, accepter.id, "protection", 0.6, null);
  createObligation(w, accepter.id, proposer.id, "protection", 0.6, null);
}

export function breakUp(w: World, initiator: Person, other: Person, reason: string): void {
  const r = rel(initiator, other.id, w.tick);
  const wasBonded = r.stage === "pair_bonded";
  setStage(w, initiator, other, "estranged", reason);
  if (initiator.partnerId === other.id) initiator.partnerId = null;
  if (other.partnerId === initiator.id) other.partnerId = null;
  if (w.census[initiator.id]?.partnerId === other.id) w.census[initiator.id]!.partnerId = null;
  if (w.census[other.id]?.partnerId === initiator.id) w.census[other.id]!.partnerId = null;
  other.wants.affection = clamp01(other.wants.affection - 0.3);
  const ro = rel(other, initiator.id, w.tick);
  ro.trust = Math.max(-1, ro.trust - 0.3);
  ro.negative += 0.2;
  other.emotions.grief = clamp01(other.emotions.grief + (wasBonded ? 0.4 : 0.2));
  const children = w.active().filter((c) => c.parents.includes(initiator.id) && c.parents.includes(other.id)).map((c) => c.id);
  w.emit("break_up", [initiator.id, other.id], { initiator: initiator.id, other: other.id, wasBonded, reason, children });
  feel(w, other, "heartbroken", `${firstName(initiator)} left them`, wasBonded ? 0.8 : 0.5);
  feel(w, initiator, reason === "jealousy" ? "angry" : "sad", `ended things with ${firstName(other)}`, 0.4);
  for (const o of w.obligations) {
    if (o.status !== "active" || (o.kind !== "pair_duty" && o.kind !== "protection")) continue;
    if ((o.holder === initiator.id && o.owed_to === other.id) || (o.holder === other.id && o.owed_to === initiator.id)) fulfillObligation(w, o, "break_up");
  }
  if (wasBonded && (children.length > 0 || initiator.householdId === other.householdId)) {
    w.emit("obligation_dispute", [initiator.id, other.id], { between: [initiator.id, other.id], children, sharedFood: initiator.householdId === other.householdId });
  }
}

function newChild(w: World, mother: Person, fatherId: number): Person {
  const rng = w.rng.get("bonding");
  const id = w.nextId("person");
  const sex = rng.chance(0.5) ? "f" : "m";
  const names = sex === "f" ? ["Ada", "Bea", "Cora", "Dora", "Elin", "Fay", "Greta", "Hild"] : ["Aric", "Bram", "Cael", "Dag", "Erl", "Finn", "Gunn", "Hal"];
  const trait = () => r3((rng.next() + rng.next()) / 2);
  const child = blankPerson({
    id,
    name: `${names[rng.int(names.length)]} ${w.households[mother.householdId]!.name}`,
    sex,
    birthTick: w.tick,
    householdId: mother.householdId,
    parents: [mother.id, fatherId],
    x: mother.x,
    y: mother.y,
    personality: { boldness: trait(), empathy: trait(), greed: trait(), honesty: trait(), loyalty: trait(), vigilance: trait() },
    survival: { food: 0.9, water: 0.9, warmth: 0.9, rest: 0.9, health: 1 },
    wants: { companionship: 0.8, affection: 0.8, status: 0.3, comfort: 0.7, security: 0.8 },
    sleepStart: 19,
    sleepHours: 11,
  });
  if (w.people.length !== id - 1) throw new Error("person ids out of order");
  w.people.push(child);
  for (const o of w.active()) {
    if (o.id === id) continue;
    const kin = o.householdId === child.householdId || child.parents.includes(o.id);
    const r = newRelationship(w.tick, kin);
    const back = newRelationship(w.tick, kin);
    if (kin) {
      r.bond = back.bond = 0.8;
      r.trust = back.trust = 0.7;
      r.stage = back.stage = "friend";
    }
    child.relationships[o.id] = r;
    o.relationships[id] = back;
  }
  w.census[id] = { householdId: child.householdId, sex, birthTick: w.tick, parents: child.parents.slice(), partnerId: null, alive: true, armed: false };
  return child;
}

/** Someone who barely knows them flinches at a disfigured face. */
function recoil(w: World, a: Person, b: Person): void {
  const key = `recoil:${b.id}`;
  const until = a.cooldowns[key];
  if (until !== undefined && w.tick < until) return;
  a.cooldowns[key] = w.tick + w.days(4);
  feel(w, a, "repulsed", `${firstName(b)}'s scarred face`, 0.15);
}

/**
 * Step 6 of the tick: proximity, attraction, relationship stages, jealousy,
 * conception checks and births.
 */
export function updateBonding(w: World): void {
  const cfg = w.config.bonding;
  const active = w.active();
  const awake = active.filter((p) => !p.asleep);

  for (let i = 0; i < awake.length; i++) {
    const a = awake[i]!;
    for (let j = i + 1; j < awake.length; j++) {
      const b = awake[j]!;
      if (cheb(a, b) > cfg.proximityRadius) continue;
      const ra = rel(a, b.id, w.tick), rb = rel(b, a.id, w.tick);
      ra.together++;
      rb.together++;
      // Strangers warm more slowly to someone whose face is marred.
      const da = disfigurement(a), db = disfigurement(b);
      const f = w.config.injuries.disfigureBondFactor;
      // Like minds warm to each other faster.
      const alike = 0.6 + 0.8 * valueSimilarity(a, b);
      if (ra.bond < cfg.proximityBondCap) ra.bond = Math.min(cfg.proximityBondCap, ra.bond + cfg.proximityBondPerTick * alike * (ra.kin ? 1 : 1 - f * db));
      if (rb.bond < cfg.proximityBondCap) rb.bond = Math.min(cfg.proximityBondCap, rb.bond + cfg.proximityBondPerTick * alike * (rb.kin ? 1 : 1 - f * da));
      if (db >= 0.4 && !ra.kin && ra.bond < 0.3) recoil(w, a, b);
      if (da >= 0.4 && !rb.kin && rb.bond < 0.3) recoil(w, b, a);
    }
  }

  if (w.tick % 6 === 0) {
    const t = cfg.thresholds;
    for (let i = 0; i < active.length; i++) {
      const a = active[i]!;
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j]!;
        const ra = rel(a, b.id, w.tick), rb = rel(b, a.id, w.tick);
        ra.attraction = r3(computeAttraction(w, a, b, ra));
        rb.attraction = r3(computeAttraction(w, b, a, rb));
        const bond = (ra.bond + rb.bond) / 2;
        const trust = (ra.trust + rb.trust) / 2;
        if (ra.stage === "stranger" && bond >= t.acquaintanceBond) setStage(w, a, b, "acquaintance", "time_together");
        else if (ra.stage === "acquaintance" && bond >= t.friendBond && trust >= t.friendTrust) setStage(w, a, b, "friend", "friendship");
        else if (ra.stage === "friend" && bond < t.friendBond - 0.1 && !ra.kin) setStage(w, a, b, "acquaintance", "drifted");
        else if (ra.stage === "estranged" && bond >= 0.55 && trust >= 0.3 && w.tick - ra.stageTick > w.days(t.reconcileDays)) setStage(w, a, b, "friend", "reconciled");
      }
    }

    // Jealousy: a partner who sees their partner with someone they are drawn to.
    for (const p of active) {
      const partner = w.maybePerson(p.partnerId);
      if (!partner || !w.isActive(partner.id) || partner.asleep) continue;
      for (const rival of active) {
        if (rival.id === p.id || rival.id === partner.id) continue;
        const attraction = p.relationships[rival.id]?.attraction ?? 0;
        if (attraction < t.jealousy || cheb(p, rival) > 3) continue;
        if (cheb(partner, p) > sightRange(w, partner) || !w.map.lineOfSight(partner.x, partner.y, p.x, p.y)) continue;
        const before = partner.emotions.jealousy;
        partner.emotions.jealousy = clamp01(before + 0.06);
        partner.rivalId = rival.id;
        if (before < 0.5 && partner.emotions.jealousy >= 0.5) {
          w.emit("jealousy", [partner.id], { holder: partner.id, partner: p.id, rival: rival.id });
          feel(w, partner, "jealous", `saw ${firstName(p)} with ${firstName(rival)}`, 0.6);
        }
      }
    }
  }

  if (w.env.minuteOfDay === 0) {
    const rng = w.rng.get("bonding");
    const pPerDay = cfg.childRatePerSeason / w.config.time.daysPerSeason;
    for (const f of active) {
      if (f.sex !== "f" || f.pregnancy) continue;
      const m = w.maybePerson(f.partnerId);
      if (!m || !w.isActive(m.id) || m.sex !== "m") continue;
      if (rel(f, m.id, w.tick).stage !== "pair_bonded") continue;
      const age = w.ageYears(f);
      if (age < cfg.fertilityMinAge || age > cfg.fertilityMaxAge || w.ageYears(m) < cfg.minAge) continue;
      const famine = householdFamine(w, f.householdId);
      if (famine) continue;
      if (!rng.chance(pPerDay)) continue;
      const dueTick = w.tick + w.days(cfg.gestationDays);
      const ev = w.emit("conceived", [f.id, m.id], { mother: f.id, father: m.id, pairBonded: true, famine, dueTick });
      f.pregnancy = { fatherId: m.id, dueTick, conceivedSeq: ev.seq };
    }
  }

  for (const f of active) {
    if (!f.pregnancy || w.tick < f.pregnancy.dueTick) continue;
    const preg = f.pregnancy;
    f.pregnancy = null;
    const child = newChild(w, f, preg.fatherId);
    w.emit("child_born", [f.id], { child: child.id, name: child.name, sex: child.sex, mother: f.id, father: preg.fatherId, household: child.householdId, conceived: preg.conceivedSeq });
    createObligation(w, f.id, child.id, "childcare", 0.9, null);
    feel(w, f, "joyful", `gave birth to ${firstName(child)}`, 0.9);
    const father = w.maybePerson(preg.fatherId);
    if (father && w.isActive(father.id)) feel(w, father, "joyful", `${firstName(child)} was born`, 0.8);
    if (w.isActive(preg.fatherId)) createObligation(w, preg.fatherId, child.id, "childcare", 0.8, null);
  }
}

