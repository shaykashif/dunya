import { cheb, isKin } from "../entities/person.ts";
import { r3 } from "../log/events.ts";
import type { EntityRef, Person, Point } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { CRIME_PREDICATES, personOf, type Belief } from "./beliefs.ts";
import { addBelief } from "./store.ts";

export interface CaseRef {
  kind: "theft" | "violence";
  place: Point;
  timeFrom: number;
  timeTo: number;
}

export type StatementContext = "interview" | "hearing" | "gossip" | "accusation";

/** Beliefs that bear on a case: sightings near the scene, crimes, traces, motives. */
export function relevantToCase(b: Belief, c: CaseRef, ticksPerDay: number): boolean {
  if (b.predicate === "hungry") return b.time >= c.timeFrom - ticksPerDay * 10 && b.time <= c.timeTo + ticksPerDay;
  if (!b.place) return false;
  if (cheb(b.place, c.place) > 8) return false;
  const slack = ticksPerDay;
  return b.time >= c.timeFrom - slack && b.time <= c.timeTo + slack;
}

function isSelfCrime(b: Belief, speakerId: number): boolean {
  return personOf(b.subject) === speakerId && CRIME_PREDICATES.includes(b.predicate);
}

/** Someone the speaker would happily blame: least trusted, not kin, still around. */
function scapegoatFor(w: World, speaker: Person, exclude: readonly number[]): Person | null {
  let best: Person | null = null;
  let bestTrust = Infinity;
  for (const o of w.active()) {
    if (o.id === speaker.id || exclude.includes(o.id) || isKin(speaker, o) || w.ageYears(o) < 12) continue;
    const t = speaker.relationships[o.id]?.trust ?? 0;
    if (t < bestTrust) {
      bestTrust = t;
      best = o;
    }
  }
  return best;
}

function deliver(
  w: World,
  speaker: Person,
  listeners: readonly Person[],
  claim: Omit<Belief, "id" | "sourceSeq">,
  context: StatementContext,
  lie: boolean,
  lieType: string | null,
  originalId: number | null,
  hearingId: number | null,
): void {
  const ev = w.emit("statement", [speaker.id], {
    speaker: speaker.id,
    listener: listeners[0]!.id,
    listeners: listeners.map((l) => l.id),
    context,
    hearing: hearingId,
    claim: { subject: claim.subject, predicate: claim.predicate, object: claim.object ?? null, time: claim.time, place: claim.place ?? null, confidence: r3(claim.confidence) },
    lie,
    lieType,
    original: originalId,
  });
  const crimeId = originalId !== null && !lie ? (w.beliefCrime.get(originalId) ?? null) : null;
  for (const listener of listeners) {
    const trust = Math.max(0, listener.relationships[speaker.id]?.trust ?? 0);
    const confidence = claim.confidence * w.config.beliefs.testimonyDiscount * (0.55 + 0.45 * trust);
    const heard: Omit<Belief, "id" | "sourceSeq"> = { ...claim, confidence: r3(confidence), source: "heard", fromId: speaker.id };
    addBelief(w, listener, heard, ev.seq, crimeId);
  }
}

/**
 * Section 7.3: a speaker shares claims from their belief store. Speakers may
 * omit, distort, or fabricate, driven by honesty, bond with the subject, and
 * their own risk. Whether a statement was a lie is recorded in the log only.
 */
export function testify(
  w: World,
  speaker: Person,
  to: Person | readonly Person[],
  opts: { context: StatementContext; filter: (b: Belief) => boolean; maxClaims: number; caseRef?: CaseRef; hearingId?: number },
): number {
  const listeners: readonly Person[] = Array.isArray(to) ? to : [to as Person];
  if (listeners.length === 0) return 0;
  const listenerIds = listeners.map((l) => l.id);
  const hearing = opts.hearingId ?? null;
  const rng = w.rng.get("testimony");
  const tpd = w.config.time.ticksPerDay;
  const pers = speaker.personality;
  const claims = speaker.beliefs
    .filter((b) => opts.filter(b) && !listenerIds.includes(personOf(b.subject) ?? -1))
    .sort((a, b) => b.confidence - a.confidence || a.id - b.id)
    .slice(0, opts.maxClaims);
  let shared = 0;

  const guilty = opts.caseRef
    ? speaker.beliefs.find((b) => isSelfCrime(b, speaker.id) && b.place && relevantToCase(b, opts.caseRef!, tpd))
    : undefined;

  for (const b of claims) {
    if (isSelfCrime(b, speaker.id)) {
      if (opts.context === "gossip") continue;
      // Confessing is rare; mostly the culprit stays silent about their own act.
      if (rng.chance(pers.honesty * 0.25 * (0.5 + speaker.emotions.guilt))) {
        deliver(w, speaker, listeners, b, opts.context, false, null, b.id, hearing);
        w.emit("confession", [speaker.id], { speaker: speaker.id, listener: listenerIds[0], listeners: listenerIds, hearing, belief: b.id });
        shared++;
      } else {
        w.emit("statement_withheld", [speaker.id], { speaker: speaker.id, listener: listenerIds[0], listeners: listenerIds, hearing, original: b.id, lie: true, lieType: "omit", about: b.subject, predicate: b.predicate });
      }
      continue;
    }
    const subjectId = personOf(b.subject);
    let protect = 0;
    if (subjectId !== null) {
      const subject = w.maybePerson(subjectId);
      const bond = speaker.relationships[subjectId]?.bond ?? 0;
      if (subjectId === speaker.id) protect = 1;
      else if (subject && isKin(speaker, subject)) protect = Math.max(0.5, bond);
      else if (bond > 0.6) protect = bond * 0.6;
    }
    const incriminating = CRIME_PREDICATES.includes(b.predicate) || ["was_at", "hungry", "trace_found", "seen_bloody", "washing_blood"].includes(b.predicate);
    if (incriminating && protect > 0) {
      const pLie = (1 - pers.honesty) * protect * (0.6 + 0.4 * pers.boldness) * (1 - 0.4 * speaker.values.truth);
      if (rng.chance(pLie)) {
        if (rng.chance(0.6)) {
          w.emit("statement_withheld", [speaker.id], { speaker: speaker.id, listener: listenerIds[0], listeners: listenerIds, hearing, original: b.id, lie: true, lieType: "omit", about: b.subject, predicate: b.predicate });
        } else {
          const goat = scapegoatFor(w, speaker, [...listenerIds, subjectId ?? -1]);
          const subject: EntityRef = goat ? { kind: "person", id: goat.id } : { kind: "unknown", desc: "figure", sizeClass: "large" };
          deliver(w, speaker, listeners, { ...b, subject }, opts.context, true, "distort", b.id, hearing);
          shared++;
        }
        continue;
      }
    }
    deliver(w, speaker, listeners, b, opts.context, false, null, b.id, hearing);
    shared++;
  }

  if (guilty && opts.caseRef && opts.context !== "gossip") {
    const pFab = (1 - pers.honesty) * (0.4 + 0.6 * pers.boldness) * 0.7 * (1 - 0.4 * speaker.values.truth);
    if (rng.chance(pFab)) {
      const goat = scapegoatFor(w, speaker, listenerIds);
      if (goat) {
        deliver(
          w,
          speaker,
          listeners,
          {
            subject: { kind: "person", id: goat.id },
            predicate: "was_at",
            object: "scene",
            time: guilty.time,
            confidence: 0.8,
            source: "saw",
            place: { ...opts.caseRef.place },
          },
          opts.context,
          true,
          "fabricate",
          null,
          hearing,
        );
        shared++;
      }
    }
  }
  return shared;
}

/** The accused's answer at a hearing. A denial is a lie if they believe they did it. */
export function denial(w: World, accused: Person, judges: readonly number[], caseRef: CaseRef, hearingId: number | null = null): void {
  const did = accused.beliefs.some((b) => isSelfCrime(b, accused.id) && b.place && relevantToCase(b, caseRef, w.config.time.ticksPerDay));
  w.emit("statement", [accused.id], { speaker: accused.id, listeners: judges.slice(), context: "hearing", hearing: hearingId, claim: "denies", lie: did, lieType: did ? "deny" : null });
}
