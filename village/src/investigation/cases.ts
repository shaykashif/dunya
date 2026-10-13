import { isKin } from "../entities/person.ts";
import { CRIME_PREDICATES, personOf, type Belief } from "../perception/beliefs.ts";
import { addBelief, findBelief } from "../perception/store.ts";
import { relevantToCase, type CaseRef } from "../perception/testimony.ts";
import type { EntityRef, Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { caseMatches, type CaseFile } from "./casefile.ts";
import { deduce, type AgentKnowledge } from "./deduce.ts";

export interface CrimeInfo extends CaseRef {
  victim: EntityRef | null;
}

/** Reads a belief as evidence of a crime, if it is one. Uses only the belief. */
export function classifyBelief(b: Belief, ticksPerDay: number): CrimeInfo | null {
  if (!b.place) return null;
  const place = { ...b.place };
  const victim = b.object && typeof b.object === "object" ? b.object : null;
  if (b.predicate === "took" || b.predicate === "attempted_theft") {
    return { kind: "theft", victim, place, timeFrom: b.time - 6, timeTo: b.time + 6 };
  }
  if (b.predicate === "attacked" || b.predicate === "killed" || b.predicate === "threatened") {
    return { kind: "violence", victim, place, timeFrom: b.time - 6, timeTo: b.time + 6 };
  }
  if (b.predicate === "trace_found") {
    const window = { timeFrom: b.time - 2 * ticksPerDay, timeTo: b.time };
    if (b.object === "item_missing") return { kind: "theft", victim: b.subject, place, ...window };
    if (b.object === "body" && (b.detail?.cause === "person" || b.detail?.cause === "unknown")) return { kind: "violence", victim: b.subject, place, ...window };
    if (b.object === "wound") return { kind: "violence", victim: b.subject, place, timeFrom: b.time - ticksPerDay, timeTo: b.time };
    if (b.object === "blood") return { kind: "violence", victim: null, place, ...window };
  }
  return null;
}

export function knowledgeOf(w: World, p: Person): AgentKnowledge {
  const trust: Record<number, number> = {};
  for (const key of Object.keys(p.relationships)) trust[Number(key)] = p.relationships[Number(key)]!.trust;
  const tpd = w.config.time.ticksPerDay;
  return {
    selfId: p.id,
    now: w.tick,
    ticksPerDay: tpd,
    ticksPerYear: tpd * w.config.time.daysPerSeason * 4,
    census: w.census,
    trust,
    opportunityRadius: w.config.investigation.opportunityRadius,
    meansRadius: w.config.investigation.meansRadius,
  };
}

function victimStake(w: World, p: Person, victim: EntityRef | null): boolean {
  if (!victim) return false;
  if (victim.kind === "person") {
    if (victim.id === p.id) return true;
    const v = w.maybePerson(victim.id);
    return !!v && (isKin(p, v) || v.householdId === p.householdId);
  }
  if (victim.kind === "holder") {
    const h = victim.holder;
    if (h.t === "household") return h.id === p.householdId;
    if (h.t === "person") return h.id === p.id;
  }
  return false;
}

export function openCase(w: World, p: Person, info: CrimeInfo, origin: Belief): CaseFile {
  const c: CaseFile = {
    id: w.nextId("case"),
    ownerId: p.id,
    kind: info.kind,
    victim: info.victim,
    place: { ...info.place },
    timeFrom: info.timeFrom,
    timeTo: info.timeTo,
    openedTick: w.tick,
    originBeliefId: origin.id,
    beliefIds: [origin.id],
    traceIds: typeof origin.detail?.traceId === "number" ? [origin.detail.traceId] : [],
    suspects: [],
    interviewed: [],
    examined: 0,
    status: "open",
    accusedId: null,
    hearingId: null,
    dirty: true,
    key: `${info.kind}@${info.place.x},${info.place.y}#${Math.floor(info.timeTo / w.config.time.ticksPerDay)}`,
  };
  p.caseFiles.push(c);
  w.emit("case_opened", [p.id], { owner: p.id, case: c.id, kind: c.kind, victim: c.victim, at: [c.place.x, c.place.y], from: c.timeFrom, to: c.timeTo });
  return c;
}

export function findMatchingCase(w: World, p: Person, info: CrimeInfo): CaseFile | null {
  const tpd = w.config.time.ticksPerDay;
  return p.caseFiles.find((c) => caseMatches(c, info.kind, info.place, info.timeFrom, info.timeTo, tpd)) ?? null;
}

/** True if the person believes they themselves committed this crime. */
export function believesOwnCrime(p: Person, info: CaseRef, tpd: number): boolean {
  return p.beliefs.some((b) => personOf(b.subject) === p.id && CRIME_PREDICATES.includes(b.predicate) && relevantToCase(b, info, tpd));
}

/**
 * Engine rule run in step 7: new beliefs attach to open cases, and crime
 * evidence opens a case for people with a stake (victims, kin, the elder) or
 * honest eyewitnesses.
 */
export function processCaseChecks(w: World): void {
  const tpd = w.config.time.ticksPerDay;
  const checks = w.pendingCaseChecks;
  w.pendingCaseChecks = [];
  for (const { personId, beliefId } of checks) {
    const p = w.maybePerson(personId);
    if (!p || !p.alive || p.exiled) continue;
    const b = findBelief(p, beliefId);
    if (!b) continue;

    for (const c of p.caseFiles) {
      if (c.status === "closed" || c.beliefIds.includes(b.id)) continue;
      if (relevantToCase(b, c, tpd)) {
        c.beliefIds.push(b.id);
        if (typeof b.detail?.traceId === "number" && !c.traceIds.includes(b.detail.traceId)) c.traceIds.push(b.detail.traceId);
        c.dirty = true;
      }
    }

    const info = classifyBelief(b, tpd);
    if (!info) continue;
    const subjectId = personOf(b.subject);
    if (subjectId === p.id) continue;
    if (believesOwnCrime(p, info, tpd)) continue;
    if (findMatchingCase(w, p, info)) continue;

    const speaksForHouse = p.isHead || (info.victim?.kind === "person" && info.victim.id === p.id);
    let open = p.role === "elder" || (victimStake(w, p, info.victim) && speaksForHouse);
    if (!open && b.source === "saw" && CRIME_PREDICATES.includes(b.predicate) && subjectId !== null) {
      const subject = w.maybePerson(subjectId);
      const protective = !!subject && (isKin(p, subject) || (p.relationships[subjectId]?.bond ?? 0) > 0.6);
      open = !protective && p.personality.honesty >= w.config.investigation.eyewitnessMinHonesty && w.ageYears(p) >= 10;
    }
    if (open) openCase(w, p, info, b);
  }
}

/** Re-runs deduction for case files whose evidence changed. */
export function runDeductions(w: World): void {
  for (const p of w.active()) {
    for (const c of p.caseFiles) {
      if (!c.dirty || c.status === "closed") continue;
      c.dirty = false;
      // Someone who knows who did it, and that they are dead, has nobody left to accuse.
      const tpd = w.config.time.ticksPerDay;
      const known = p.beliefs.find((b) => CRIME_PREDICATES.includes(b.predicate) && b.confidence >= 0.7 && personOf(b.subject) !== null && relevantToCase(b, c, tpd));
      const culprit = known ? personOf(known.subject) : null;
      if (culprit !== null && culprit !== p.id && w.census[culprit] && !w.census[culprit]!.alive) {
        closeCase(w, p, c, "culprit dead");
        continue;
      }
      const prevTop = c.suspects[0]?.personId ?? null;
      c.suspects = deduce(c, p.beliefs, knowledgeOf(w, p));
      const top = c.suspects[0] ?? null;
      if (top && top.personId !== prevTop) {
        const ev = w.emit("deduction", [p.id], { owner: p.id, case: c.id, suspects: c.suspects.slice(0, 3) });
        addBelief(w, p, {
          subject: { kind: "person", id: top.personId },
          predicate: "suspected",
          object: c.kind,
          time: c.timeTo,
          confidence: Math.min(1, top.score / 3),
          source: "inferred",
          place: { ...c.place },
        }, ev.seq);
      }
    }
  }
}

export function closeCase(w: World, p: Person, c: CaseFile, reason: string): void {
  if (c.status === "closed") return;
  c.status = "closed";
  w.emit("case_closed", [p.id], { owner: p.id, case: c.id, reason });
}

export function expireCases(w: World): void {
  const limit = w.days(w.config.investigation.caseFileExpiryDays);
  for (const p of w.active()) {
    for (const c of p.caseFiles) if (c.status !== "closed" && w.tick - c.openedTick > limit) closeCase(w, p, c, "expired");
  }
}
