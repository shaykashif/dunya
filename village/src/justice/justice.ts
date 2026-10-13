import { afterDeparture, kill } from "../entities/death.ts";
import { checkObligations } from "../entities/obligations.ts";
import { adjustTrust, cheb, clamp01, feel, firstName, householdMembers, isKin } from "../entities/person.ts";
import { interruptPlan } from "../engine/plans.ts";
import type { Rng } from "../engine/rng.ts";
import { closeCase, expireCases, findMatchingCase, knowledgeOf, openCase, processCaseChecks, runDeductions } from "../investigation/cases.ts";
import type { CaseFile } from "../investigation/casefile.ts";
import { deduce } from "../investigation/deduce.ts";
import { r3 } from "../log/events.ts";
import { CRIME_PREDICATES, personOf } from "../perception/beliefs.ts";
import { addBelief, decayBeliefs } from "../perception/store.ts";
import { denial, relevantToCase, testify, type CaseRef } from "../perception/testimony.ts";
import { holderInv, transfer, transferAll } from "../world/items.ts";
import { FOOD_KINDS, type EntityRef, type HolderRef, type Hearing, type Person, type Sentence, type SentenceKind } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { normFor } from "./norms.ts";

export function hearingCaseRef(h: Hearing): CaseRef {
  return { kind: h.kind, place: h.place, timeFrom: h.timeFrom, timeTo: h.timeTo };
}

function victimPerson(w: World, victim: EntityRef | null): Person | null {
  if (victim && victim.kind === "person") return w.maybePerson(victim.id);
  if (victim && victim.kind === "holder" && victim.holder.t === "person") return w.maybePerson(victim.holder.id);
  return null;
}

function victimHousehold(w: World, victim: EntityRef | null): number | null {
  if (victim && victim.kind === "holder" && victim.holder.t === "household") return victim.holder.id;
  return victimPerson(w, victim)?.householdId ?? null;
}

/** Section 9.4: the judge must not be kin to the accused or the victim. */
export function hasConflict(w: World, judge: Person, accused: Person, victim: EntityRef | null): boolean {
  if (judge.id === accused.id || isKin(judge, accused) || judge.householdId === accused.householdId) return true;
  const v = victimPerson(w, victim);
  if (v && (v.id === judge.id || isKin(judge, v))) return true;
  const vh = victimHousehold(w, victim);
  return vh !== null && vh === judge.householdId;
}

/**
 * The town council: the village elder presides, joined by the heads of houses
 * with no stake in the case, up to `councilSize`. A conflicted elder steps aside
 * and the unconflicted heads sit without them. The presiding judge is listed first.
 */
export function chooseJudges(w: World, accused: Person, victim: EntityRef | null): { judges: number[]; recused: boolean } {
  const size = w.config.justice.councilSize;
  const elder = w.maybePerson(w.elderId);
  const heads = w.households
    .map((h) => h.headId)
    .filter((id): id is number => id !== null && w.isActive(id) && id !== w.elderId)
    .map((id) => w.person(id))
    .sort((a, b) => a.birthTick - b.birthTick || a.id - b.id);
  const free = heads.filter((h) => !hasConflict(w, h, accused, victim)).map((h) => h.id);
  if (elder && w.isActive(elder.id) && !hasConflict(w, elder, accused, victim)) return { judges: [elder.id, ...free].slice(0, size), recused: false };
  let council = free.slice(0, size);
  if (council.length === 0) council = heads.map((h) => h.id).filter((id) => id !== accused.id && id !== victimPerson(w, victim)?.id).slice(0, size);
  return { judges: council, recused: elder !== null && w.isActive(elder.id) };
}

export function nextHearingTick(w: World, after: number): number {
  const tpd = w.config.time.ticksPerDay;
  const startMin = w.config.time.startHour * 60;
  const hearingMin = w.config.justice.hearingHour * 60;
  for (let t = after; t < after + tpd * 2; t++) {
    const minute = (startMin + t * w.config.time.minutesPerTick) % 1440;
    if (minute === hearingMin) return t;
  }
  return after;
}

/** Engine-side lookup of which true crime a case is about, for logging only. */
export function truthCrimeFor(w: World, c: CaseFile): number | null {
  for (const id of c.beliefIds) {
    const crime = w.beliefCrime.get(id);
    if (crime !== undefined) return crime;
  }
  for (const t of c.traceIds) {
    const crime = w.crimes.find((x) => x.traceIds.includes(t));
    if (crime) return crime.id;
  }
  return null;
}

function judgeCaseFor(w: World, judge: Person, h: Hearing): CaseFile | null {
  return judge.caseFiles.find((c) => c.hearingId === h.id) ?? findMatchingCase(w, judge, { ...hearingCaseRef(h), victim: h.victim });
}

/**
 * Section 9.3 step 1: an accusation reaches the judge(s). The accuser shares
 * their case-relevant beliefs; a hearing is scheduled and witnesses summoned.
 */
export function fileAccusation(w: World, accuser: Person, accusedId: number, c: CaseFile): Hearing | null {
  const accused = w.maybePerson(accusedId);
  if (!accused || !w.isActive(accusedId)) return null;
  const tpd = w.config.time.ticksPerDay;
  const ref: CaseRef = { kind: c.kind, place: c.place, timeFrom: c.timeFrom, timeTo: c.timeTo };

  const judged = w.hearings.find(
    (h) => h.status === "held" && h.accusedId === accusedId && h.kind === c.kind && cheb(h.place, c.place) <= 3 && Math.abs(h.timeTo - c.timeTo) <= 3 * tpd,
  );
  if (judged) {
    closeCase(w, accuser, c, "already judged");
    return null;
  }
  const existing = w.hearings.find(
    (h) => h.status === "scheduled" && h.accusedId === accusedId && h.kind === c.kind && cheb(h.place, c.place) <= 3 && Math.abs(h.timeTo - c.timeTo) <= 2 * tpd,
  );
  const { judges, recused } = existing ? { judges: existing.judges, recused: existing.recused } : chooseJudges(w, accused, c.victim);
  if (judges.length === 0) {
    w.emit("accusation_dismissed", [accuser.id], { accuser: accuser.id, accused: accusedId, reason: "no_judge" });
    return null;
  }
  const crimeId = truthCrimeFor(w, c);
  const crime = crimeId !== null ? w.crimes.find((x) => x.id === crimeId) : undefined;
  const hearing: Hearing = existing ?? {
    id: w.nextId("hearing"),
    caseKey: c.key,
    kind: c.kind,
    accusedId,
    accuserIds: [],
    victim: c.victim,
    place: { ...c.place },
    timeFrom: c.timeFrom,
    timeTo: c.timeTo,
    judges,
    recused,
    summoned: [],
    scheduledTick: nextHearingTick(w, w.tick + w.config.justice.hearingDelayTicks),
    postponements: 0,
    status: "scheduled",
    crimeId,
  };
  if (!hearing.accuserIds.includes(accuser.id)) hearing.accuserIds.push(accuser.id);

  const ev = w.emit("accusation", [accuser.id], {
    accuser: accuser.id,
    accused: accusedId,
    kind: c.kind,
    case: c.id,
    hearing: hearing.id,
    judges,
    suspects: c.suspects.slice(0, 3),
    truth: { crime: crimeId, culprit: crime?.actorId ?? null },
  });
  if (!existing) {
    w.hearings.push(hearing);
    if (recused && w.elderId !== null) w.emit("recusal", [], { hearing: hearing.id, elder: w.elderId, accused: accusedId, reason: "kin" });
  }

  // Witnesses: people the accuser heard from, saw near the scene, or interviewed.
  const witnessSet = new Set<number>([accuser.id, accusedId, ...c.interviewed]);
  for (const b of accuser.beliefs) {
    if (!relevantToCase(b, ref, tpd)) continue;
    if (b.fromId !== undefined) witnessSet.add(b.fromId);
    const sid = personOf(b.subject);
    if (sid !== null && b.predicate === "was_at") witnessSet.add(sid);
  }
  const minAge = w.config.justice.childrenCanTestify ? w.config.justice.childTestimonyMinAge : 16;
  for (const id of [...witnessSet].sort((a, b) => a - b)) {
    if (!w.isActive(id) || hearing.judges.includes(id) || hearing.summoned.includes(id)) continue;
    if (id !== accusedId && w.ageYears(w.person(id)) < minAge) continue;
    hearing.summoned.push(id);
  }
  hearing.summoned.sort((a, b) => a - b);

  for (const jid of hearing.judges) {
    const judge = w.person(jid);
    let jc = judgeCaseFor(w, judge, hearing);
    if (judge.id !== accuser.id) {
      const claim = addBelief(w, judge, {
        subject: { kind: "person", id: accusedId },
        predicate: "accused_of",
        object: c.kind,
        time: c.timeTo,
        confidence: 0.5,
        source: "heard",
        fromId: accuser.id,
        place: { ...c.place },
      }, ev.seq, crimeId);
      if (!jc) jc = openCase(w, judge, { ...ref, victim: c.victim }, claim);
    }
    if (jc) {
      jc.status = "accused";
      jc.accusedId = accusedId;
      jc.hearingId = hearing.id;
      jc.dirty = true;
      for (const id of c.interviewed) if (!jc.interviewed.includes(id)) jc.interviewed.push(id);
    }
  }
  const listeners = hearing.judges.filter((id) => id !== accuser.id).map((id) => w.person(id));
  testify(w, accuser, listeners, { context: "accusation", filter: (b) => relevantToCase(b, ref, tpd), maxClaims: 6, caseRef: ref, hearingId: hearing.id });
  c.status = "accused";
  c.accusedId = accusedId;
  c.hearingId = hearing.id;
  const victimHh = victimHousehold(w, c.victim);
  if (victimHh !== null && victimHh !== accused.householdId) {
    const victimP = victimPerson(w, c.victim);
    const amount = c.kind === "theft" ? w.config.feud.theft : victimP && !(w.census[victimP.id]?.alive ?? true) ? w.config.feud.killing : w.config.feud.assault;
    w.addFeud(victimHh, accused.householdId, amount, `accused ${accused.name} of ${c.kind}`);
  }
  feel(w, accused, "afraid", `${firstName(accuser)} accused them of ${c.kind}`, 0.6);

  accused.wants.security = clamp01(accused.wants.security - 0.3);
  adjustTrust(accused, accuser.id, -0.3, w.tick);
  for (const m of householdMembers(w, accused.householdId)) if (m.id !== accused.id) adjustTrust(m, accuser.id, -0.15, w.tick);
  w.emit("hearing_scheduled", [], { hearing: hearing.id, at: hearing.scheduledTick, judges: hearing.judges, summoned: hearing.summoned, recused: hearing.recused });
  return hearing;
}

/**
 * How much the council feels for a killer, in [0, 1]: their bond with and trust in the accused, their own
 * empathy, softened by a clean record and hardened by affection for the dead.
 */
export function councilSympathy(w: World, judges: readonly Person[], accused: Person, victim: Person | null): { mean: number; by: Record<number, number> } {
  const by: Record<number, number> = {};
  let sum = 0;
  for (const j of judges) {
    const r = j.relationships[accused.id];
    const rv = victim ? j.relationships[victim.id] : undefined;
    const kin = isKin(j, accused) ? 0.15 : 0;
    const s = clamp01(0.4 * (r?.bond ?? 0) + 0.25 * Math.max(0, r?.trust ?? 0) + 0.35 * j.personality.empathy + kin + (accused.convictions === 0 ? 0.08 : -0.1) - 0.3 * (rv?.bond ?? 0));
    by[j.id] = Math.round(s * 1000) / 1000;
    sum += s;
  }
  return { mean: judges.length ? Math.round((sum / judges.length) * 1000) / 1000 : 0, by };
}

/** The sentence for first-degree murder: the rope, or years behind a locked door if the council cannot bring itself to hang them. */
export function firstDegreeSentence(w: World, accused: Person, sympathy: number): SentenceKind {
  const hasDependents = w.active().some((c) => c.parents.includes(accused.id) && w.ageYears(c) < 14);
  return sympathy >= w.config.justice.firstDegree.sympathyThreshold || hasDependents ? "imprisonment" : "execution";
}

function chooseSentence(w: World, h: Hearing, accused: Person, lead: Person): SentenceKind {
  const opts = normFor(h.kind).penaltyOptions;
  // Judges spare parents of young children from exile and death.
  const hasDependents = w.active().some((c) => c.parents.includes(accused.id) && w.ageYears(c) < 14);
  const cap = (s: SentenceKind): SentenceKind => (hasDependents && (s === "exile" || s === "execution") ? "imprisonment" : s);
  if (h.kind === "theft") return cap(opts[Math.min(Math.max(0, accused.convictions - 1), opts.length - 1)]!);
  const victim = victimPerson(w, h.victim);
  const victimDead = victim ? !(w.census[victim.id]?.alive ?? true) : false;
  if (victimDead) return cap(lead.personality.empathy < 0.45 ? "execution" : "exile");
  return cap(opts[Math.min(1 + accused.convictions, 2)]!);
}

/**
 * Section 9.3 steps 3-5: testimony is given, each judge deduces from their own
 * case file and beliefs, and the verdict follows the majority. World truth is
 * only written to the log next to the verdict, never consulted.
 */
export function conductHearing(w: World, h: Hearing): void {
  if (h.status !== "scheduled") return;
  const accused = w.maybePerson(h.accusedId);
  const judges = h.judges.filter((id) => w.isActive(id)).map((id) => w.person(id));
  if (!accused || !w.isActive(accused.id) || judges.length === 0) {
    h.status = "dismissed";
    w.emit("hearing_dismissed", [], { hearing: h.id, reason: !accused || !w.isActive(h.accusedId) ? "accused_gone" : "no_judge" });
    return;
  }
  const cfg = w.config.justice;
  const tpd = w.config.time.ticksPerDay;
  const ref = hearingCaseRef(h);
  const meeting = w.map.meeting;
  const present = h.summoned.filter((id) => w.isActive(id) && (!cfg.hearingRequiresPresence || cheb(w.person(id), meeting) <= cfg.hearingRadius));
  w.emit("hearing_opened", judges.map((j) => j.id), { hearing: h.id, accused: h.accusedId, judges: h.judges, present, summoned: h.summoned });

  const minAge = cfg.childrenCanTestify ? cfg.childTestimonyMinAge : 16;
  // Testimony is public: every judge hears the same statements.
  for (const id of present) {
    const s = w.person(id);
    if (h.judges.includes(id)) continue;
    if (id === accused.id) denial(w, s, h.judges, ref, h.id);
    else if (w.ageYears(s) < minAge) continue;
    testify(w, s, judges, { context: "hearing", filter: (b) => relevantToCase(b, ref, tpd), maxClaims: 5, caseRef: ref, hearingId: h.id });
  }

  const votes: { judge: number; accusedScore: number; top: number | null; topScore: number; guilty: boolean }[] = [];
  for (const judge of judges) {
    let jc = judgeCaseFor(w, judge, h);
    if (!jc) {
      const fallback = judge.beliefs.find((b) => relevantToCase(b, ref, tpd));
      if (fallback) jc = openCase(w, judge, { ...ref, victim: h.victim }, fallback);
    }
    const suspects = jc ? deduce(jc, judge.beliefs, knowledgeOf(w, judge)) : [];
    if (jc) jc.suspects = suspects;
    const accusedScore = suspects.find((s) => s.personId === h.accusedId)?.score ?? 0;
    const top = suspects[0] ?? null;
    const direct = suspects.find((s) => s.personId === h.accusedId)?.direct === true;
    const guilty = accusedScore >= cfg.convictThreshold && accusedScore >= (top?.score ?? 0) - 0.1 && (h.kind !== "violence" || direct);
    votes.push({ judge: judge.id, accusedScore, top: top?.personId ?? null, topScore: top?.score ?? 0, guilty });
  }
  const guiltyVotes = votes.filter((v) => v.guilty).length;
  const guilty = guiltyVotes * 2 > votes.length;
  const lead = judges[0]!;
  const crime = h.crimeId !== null ? w.crimes.find((c) => c.id === h.crimeId) : undefined;
  const culprit = crime?.actorId ?? null;
  // Premeditated killing is first-degree murder: execution or imprisonment, by how the council feels about the killer.
  const dead = victimPerson(w, h.victim);
  const firstDegree = guilty && h.kind === "violence" && !!crime?.premeditated && !!dead && !(w.census[dead.id]?.alive ?? true);
  const sympathy = firstDegree ? councilSympathy(w, judges, accused, dead) : null;
  const sentenceKind = guilty ? (firstDegree && sympathy ? firstDegreeSentence(w, accused, sympathy.mean) : chooseSentence(w, h, accused, lead)) : null;
  w.emit("verdict", judges.map((j) => j.id), {
    hearing: h.id,
    accused: h.accusedId,
    kind: h.kind,
    verdict: guilty ? "guilty" : "acquitted",
    sentence: sentenceKind,
    degree: firstDegree ? "first" : null,
    sympathy: sympathy ? sympathy.mean : null,
    judges: h.judges,
    recused: h.recused,
    votes,
    truth: { crime: h.crimeId, culprit, correct: crime ? (guilty ? culprit === h.accusedId : culprit !== h.accusedId) : null },
  });
  h.status = "held";

  for (const p of w.active()) {
    for (const c of p.caseFiles) if (c.hearingId === h.id) closeCase(w, p, c, guilty ? "convicted" : "acquitted");
  }
  const didIt = accused.beliefs.some((b) => personOf(b.subject) === accused.id && CRIME_PREDICATES.includes(b.predicate) && relevantToCase(b, ref, tpd));
  if (guilty) feel(w, accused, didIt ? "ashamed" : "outraged", didIt ? `the council found them guilty of ${h.kind}` : `the council convicted them of a ${h.kind} they did not commit`, 0.8);
  else feel(w, accused, "relieved", `the council found them not guilty`, 0.6);
  for (const a of h.accuserIds) if (w.isActive(a)) feel(w, w.person(a), guilty ? "vindicated" : "frustrated", guilty ? `${firstName(accused)} was convicted` : `${firstName(accused)} walked free`, 0.5);

  if (guilty && sentenceKind) {
    accused.convictions++;
    let executor = lead;
    if (sentenceKind === "execution") {
      const vh = victimHousehold(w, h.victim);
      const head = vh !== null ? w.maybePerson(w.households[vh]!.headId) : null;
      if (head && w.isActive(head.id) && head.id !== accused.id && !isKin(head, accused)) executor = head;
    }
    let qty = 3;
    for (const b of lead.beliefs) if (b.predicate === "trace_found" && b.object === "item_missing" && b.place && cheb(b.place, h.place) <= 3) qty = Math.max(qty, Number(b.detail?.qty ?? 0));
    const s: Sentence = {
      id: w.nextId("sentence"),
      hearingId: h.id,
      convictId: accused.id,
      kind: sentenceKind,
      executorId: executor.id,
      victim: h.victim,
      qty,
      ...(firstDegree && sentenceKind === "imprisonment" ? { days: w.config.justice.firstDegree.imprisonmentDays } : {}),
      status: "pending",
      attempts: 0,
      createdTick: w.tick,
    };
    w.sentences.push(s);
    w.emit("sentence_issued", [executor.id], { sentence: s.id, convict: accused.id, kind: s.kind, executor: executor.id, qty });

    // Kin who do not believe the convict did it see the verdict as unjust.
    const kinGroup = householdMembers(w, accused.householdId).filter((m) => m.id !== accused.id && w.ageYears(m) >= 12);
    const partner = w.maybePerson(accused.partnerId);
    if (partner && w.isActive(partner.id) && !kinGroup.includes(partner)) kinGroup.push(partner);
    for (const m of kinGroup) {
      const believesGuilt = m.beliefs.some((b) => personOf(b.subject) === accused.id && CRIME_PREDICATES.includes(b.predicate) && b.confidence >= 0.5);
      if (believesGuilt) continue;
      const bond = m.relationships[accused.id]?.bond ?? 0.5;
      const anger = 0.4 * (0.5 + m.personality.loyalty) * bond;
      for (const target of [...h.accuserIds, ...h.judges]) {
        if (target === m.id || !w.isActive(target)) continue;
        adjustTrust(m, target, -anger, w.tick);
        m.grievances[target] = { reason: "verdict", tick: w.tick };
      }
      m.wants.security = clamp01(m.wants.security - 0.2);
      w.emit("verdict_disputed", [m.id], { by: m.id, hearing: h.id, against: [...h.accuserIds, ...h.judges] });
      feel(w, m, "outraged", `the council convicted ${firstName(accused)}`, 0.6);
      for (const a of h.accuserIds) {
        const ah = w.maybePerson(a)?.householdId;
        if (ah !== undefined && ah !== m.householdId) w.addFeud(m.householdId, ah, w.config.feud.verdictDisputed / Math.max(1, kinGroup.length), "verdict disputed");
      }
    }
  } else {
    for (const a of h.accuserIds) if (w.isActive(a)) adjustTrust(accused, a, -0.2, w.tick);
    if (crime && culprit === accused.id) resentAcquittal(w, h, accused, judges);
  }
  if (guilty) for (const p of aggrieved(w, h, accused)) delete p.injustice[accused.id];
}

/**
 * The victim's side: the victim if alive, else the closest grown kin of the dead,
 * plus the head of the wronged house and any accuser of that house.
 */
function aggrieved(w: World, h: Hearing, accused: Person): Person[] {
  const out: Person[] = [];
  const add = (p: Person | null) => {
    if (!p || !w.isActive(p.id) || w.ageYears(p) < 16 || p.id === accused.id || isKin(p, accused) || out.includes(p)) return;
    out.push(p);
  };
  const v = victimPerson(w, h.victim);
  if (v && w.isActive(v.id)) add(v);
  else if (v) for (const o of w.active()) if (o.id === v.partnerId || v.parents.includes(o.id) || o.parents.includes(v.id)) add(o);
  const vh = victimHousehold(w, h.victim);
  if (vh !== null) {
    add(w.maybePerson(w.households[vh]!.headId));
    for (const a of h.accuserIds) {
      const ap = w.maybePerson(a);
      if (ap && ap.householdId === vh) add(ap);
    }
  }
  return out;
}

/**
 * Engine rule: an acquittal of the person who really did it leaves the victim's
 * side resentful, and repeated ones drive them toward retribution. The truth is
 * only a gate here (the request was that this happen when someone truly was
 * guilty); whom they blame is the accused they themselves stood against.
 */
function resentAcquittal(w: World, h: Hearing, accused: Person, judges: Person[]): void {
  const v = victimPerson(w, h.victim);
  const killing = !!v && !(w.census[v.id]?.alive ?? true);
  const weight = killing ? w.config.retribution.killingWeight : 1;
  for (const p of aggrieved(w, h, accused)) {
    const before = p.injustice[accused.id] ?? 0;
    p.injustice[accused.id] = Math.round((before + weight) * 1000) / 1000;
    let total = 0;
    for (const key of Object.keys(p.injustice)) total += p.injustice[Number(key)]!;
    adjustTrust(p, accused.id, -0.3, w.tick);
    for (const j of judges) if (j.id !== p.id) adjustTrust(p, j.id, -0.1, w.tick);
    p.grievances[accused.id] = { reason: "acquitted", tick: w.tick };
    w.emit("injustice_felt", [p.id], { person: p.id, against: accused.id, hearing: h.id, weight: p.injustice[accused.id], total: Math.round(total * 1000) / 1000, threshold: w.config.retribution.acquittalsToAct });
    feel(w, p, "bitter", `the council let ${firstName(accused)} walk free${before > 0 ? " again" : ""}`, 0.5 + Math.min(0.4, total * 0.15));
  }
}

function victimHolder(w: World, victim: EntityRef | null): HolderRef | null {
  if (!victim) return null;
  if (victim.kind === "holder") {
    const h = victim.holder;
    if (h.t === "person" && !w.isActive(h.id)) return { t: "household", id: w.person(h.id).householdId };
    return h;
  }
  if (victim.kind === "person") {
    return w.isActive(victim.id) ? { t: "person", id: victim.id } : { t: "household", id: w.person(victim.id).householdId };
  }
  return null;
}

/** Section 9.3 step 5: carrying out a sentence. Enforcement can fail. */
export function enforceSentence(w: World, s: Sentence, executor: Person, rng: Rng): boolean {
  const convict = w.maybePerson(s.convictId);
  if (!convict || !w.isActive(convict.id)) {
    s.status = "void";
    w.emit("sentence_void", [executor.id], { sentence: s.id, reason: "convict_gone" });
    return false;
  }
  s.attempts++;
  let resist = 0;
  let resister: Person | null = null;
  for (const m of householdMembers(w, convict.householdId)) {
    if (m.id === convict.id || m.id === executor.id || w.ageYears(m) < 16) continue;
    const r = m.personality.loyalty * (m.relationships[convict.id]?.bond ?? 0) * (0.5 + m.personality.boldness) * 0.5;
    if (r > resist) {
      resist = r;
      resister = m;
    }
  }
  const cfg = w.config.justice;
  const pFail = Math.min(0.85, Math.max(0.03, cfg.enforcementBaseFail + resist * 0.6 + convict.personality.boldness * 0.2 - executor.personality.boldness * 0.3 - (executor.role === "elder" ? 0.1 : 0)));
  if (rng.chance(pFail)) {
    if (s.attempts >= 2) s.status = "failed";
    w.emit("enforcement_failed", [executor.id], { sentence: s.id, convict: convict.id, resister: resister?.id ?? null, p: r3(pFail), final: s.status === "failed" });
    const vh = victimHousehold(w, s.victim);
    if (vh !== null) {
      for (const m of householdMembers(w, vh)) {
        m.wants.security = clamp01(m.wants.security - 0.15);
        adjustTrust(m, convict.id, -0.2, w.tick);
        if (resister) adjustTrust(m, resister.id, -0.2, w.tick);
      }
    }
    return false;
  }

  switch (s.kind) {
    case "restitution": {
      const to = victimHolder(w, s.victim) ?? { t: "communal" as const };
      let owed = s.qty * cfg.restitutionMultiplier;
      for (const from of [{ t: "person" as const, id: convict.id }, { t: "household" as const, id: convict.householdId }]) {
        const inv = holderInv(w, from);
        for (const kind of FOOD_KINDS) {
          if (owed <= 0) break;
          owed -= transfer(w, from, to, kind, Math.min(owed, inv[kind]), "restitution", [executor.id]);
        }
      }
      w.emit("restitution_paid", [executor.id], { sentence: s.id, convict: convict.id, paid: s.qty * cfg.restitutionMultiplier - owed, short: owed });
      break;
    }
    case "imprisonment": {
      convict.detainedUntil = w.tick + w.days(s.days ?? cfg.detentionDays);
      interruptPlan(w, convict, "detained");
      const home = w.house(convict.householdId);
      const spot = w.freeTileNear(home.hearthSpot, 8, convict.id, (x, y) => w.isInside({ x, y }, home));
      if (spot) w.place(convict, spot.x, spot.y);
      break;
    }
    case "exile": {
      transferAll(w, { t: "person", id: convict.id }, { t: "household", id: convict.householdId }, "exile");
      interruptPlan(w, convict, "exiled");
      w.emit("exiled", [executor.id], { person: convict.id });
      convict.exiled = true;
      convict.departure = "exile";
      convict.plan = null;
      afterDeparture(w, convict, "exile");
      break;
    }
    case "execution": {
      kill(w, convict, "execution", executor.id, null);
      break;
    }
  }
  s.status = "enforced";
  w.emit("sentence_enforced", [executor.id], { sentence: s.id, convict: convict.id, kind: s.kind });
  convict.wants.status = clamp01(convict.wants.status - 0.2);
  return true;
}

/**
 * Step 7 of the tick: case bookkeeping, deductions, hearing upkeep, sentence
 * upkeep, detention, and daily obligation and belief upkeep.
 */
export function justiceStep(w: World): void {
  processCaseChecks(w);
  runDeductions(w);

  for (const h of w.hearings) {
    if (h.status !== "scheduled") continue;
    if (!w.isActive(h.accusedId)) {
      h.status = "dismissed";
      w.emit("hearing_dismissed", [], { hearing: h.id, reason: "accused_gone" });
      continue;
    }
    if (!h.judges.some((id) => w.isActive(id))) {
      const { judges, recused } = chooseJudges(w, w.person(h.accusedId), h.victim);
      h.judges = judges;
      h.recused = h.recused || recused;
      w.emit("judges_replaced", [], { hearing: h.id, judges });
      if (judges.length === 0) {
        h.status = "dismissed";
        w.emit("hearing_dismissed", [], { hearing: h.id, reason: "no_judge" });
        continue;
      }
    }
    if (w.tick > h.scheduledTick + 36) {
      h.postponements++;
      if (h.postponements > w.config.justice.maxPostponements) {
        h.status = "dismissed";
        w.emit("hearing_dismissed", [], { hearing: h.id, reason: "never_held" });
      } else {
        h.scheduledTick = nextHearingTick(w, w.tick + 1);
        w.emit("hearing_postponed", [], { hearing: h.id, at: h.scheduledTick });
      }
    }
  }

  for (const s of w.sentences) {
    if (s.status !== "pending") continue;
    if (!w.isActive(s.convictId)) {
      s.status = "void";
      w.emit("sentence_void", [], { sentence: s.id, reason: "convict_gone" });
      continue;
    }
    if (!w.isActive(s.executorId)) {
      const replacement = w.maybePerson(w.elderId);
      if (replacement && w.isActive(replacement.id) && replacement.id !== s.convictId) {
        s.executorId = replacement.id;
        w.emit("executor_replaced", [replacement.id], { sentence: s.id, executor: replacement.id });
      } else {
        s.status = "void";
        w.emit("sentence_void", [], { sentence: s.id, reason: "no_executor" });
      }
    }
  }

  for (const p of w.active()) {
    if (p.detainedUntil !== null && w.tick >= p.detainedUntil) {
      p.detainedUntil = null;
      w.emit("released", [p.id], { person: p.id });
    }
  }

  if (w.env.minuteOfDay === 0) {
    checkObligations(w);
    decayBeliefs(w);
    expireCases(w);
  }
}
