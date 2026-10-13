// Deduction works only on an investigator's beliefs, case file and common
// knowledge. It must never import the world: the types enforce isolation.
import { CRIME_PREDICATES, cheb, personOf, type Belief } from "../perception/beliefs.ts";
import type { CensusEntry } from "../world/types.ts";
import type { CaseFile, SuspectScore } from "./casefile.ts";

export interface AgentKnowledge {
  selfId: number;
  now: number;
  ticksPerDay: number;
  ticksPerYear: number;
  /** Common village knowledge: households, sexes, ages, kinship, who is believed alive. */
  census: Readonly<Record<number, Readonly<CensusEntry>>>;
  /** The investigator's own trust toward others (a source of bias). */
  trust: Readonly<Record<number, number>>;
  opportunityRadius: number;
  meansRadius: number;
}

/** How much more a direct sighting of the act counts than circumstance (who was nearby, who is disliked). */
const EYEWITNESS_WEIGHT = 0.9;

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * Scores suspects by three explicit rules:
 * - means: they could have done it (near the scene, their belongings found there)
 * - motive: they were hungry, or the investigator holds a grudge against them
 * - opportunity: they were seen at the scene around the time
 * Each criterion is the strongest supporting belief's confidence; the score is their sum.
 */
export function deduce(caseFile: Readonly<CaseFile>, beliefs: readonly Readonly<Belief>[], k: AgentKnowledge): SuspectScore[] {
  const scores: Record<number, { means: number; motive: number; opportunity: number; eyewitness: number; accounts: Set<string> }> = {};
  const get = (id: number) => (scores[id] ??= { means: 0, motive: 0, opportunity: 0, eyewitness: 0, accounts: new Set() });
  const from = caseFile.timeFrom;
  const to = caseFile.timeTo;
  const near = 12;
  const windowFactor = Math.min(1, Math.max(0.35, 36 / Math.max(36, to - from)));
  const sizes: { size: string; conf: number }[] = [];
  let gunfire = 0;

  for (const b of beliefs) {
    const sid = personOf(b.subject);
    const dist = b.place ? cheb(b.place, caseFile.place) : Infinity;
    const inWindow = b.time >= from - near && b.time <= to + near;
    if (CRIME_PREDICATES.includes(b.predicate) && dist <= k.opportunityRadius && inWindow) {
      if (sid !== null) {
        const s = get(sid);
        // A confession (the subject telling it of themselves) is taken at full weight.
        const conf = b.fromId === sid ? 1 : b.confidence;
        s.means = Math.max(s.means, conf);
        s.opportunity = Math.max(s.opportunity, conf);
        if (b.fromId === sid) s.motive = Math.max(s.motive, 0.5);
        else {
          // Someone saw them do it. What the investigator saw themself counts fully; what others claim they saw counts for half.
          s.eyewitness = Math.max(s.eyewitness, conf * (b.source === "saw" ? EYEWITNESS_WEIGHT : EYEWITNESS_WEIGHT / 2));
          s.accounts.add(b.source === "saw" ? "self" : `from:${b.fromId ?? "?"}`);
          for (const t of b.tellers ?? []) s.accounts.add(`from:${t}`);
        }
      } else if (b.subject.kind === "unknown" && b.subject.sizeClass) {
        sizes.push({ size: b.subject.sizeClass, conf: b.confidence });
      }
    } else if (b.predicate === "was_at" && sid !== null) {
      const s = get(sid);
      if (dist <= k.opportunityRadius && inWindow) s.opportunity = Math.max(s.opportunity, b.confidence * windowFactor);
      if (dist <= k.meansRadius && b.time >= from - k.ticksPerDay && b.time <= to + k.ticksPerDay) s.means = Math.max(s.means, b.confidence * 0.6);
    } else if (b.predicate === "trace_found" && b.object === "object_left" && sid !== null && dist <= k.meansRadius) {
      const s = get(sid);
      s.means = Math.max(s.means, b.confidence);
      s.opportunity = Math.max(s.opportunity, b.confidence * 0.7);
    } else if (b.predicate === "trace_found" && b.object === "footprint" && dist <= k.meansRadius && b.detail?.size) {
      sizes.push({ size: String(b.detail.size), conf: b.confidence });
    } else if ((b.predicate === "seen_bloody" || b.predicate === "washing_blood") && sid !== null && caseFile.kind === "violence" && b.time >= from - near && b.time <= to + k.ticksPerDay) {
      const s = get(sid);
      const weight = b.predicate === "seen_bloody" && b.object === "tool" ? 0.9 : 0.6;
      s.means = Math.max(s.means, b.confidence * weight);
      s.opportunity = Math.max(s.opportunity, b.confidence * weight * 0.6);
    } else if (b.predicate === "heard_noise" && b.object === "gunshot" && caseFile.kind === "violence" && dist <= k.meansRadius * 2 && inWindow) {
      gunfire = Math.max(gunfire, b.confidence);
    } else if (b.predicate === "hungry" && sid !== null && b.time >= from - 10 * k.ticksPerDay && b.time <= to + near) {
      const s = get(sid);
      s.motive = Math.max(s.motive, b.confidence * (caseFile.kind === "theft" ? 1 : 0.3));
    }
  }

  // Size cues (a figure, a footprint) weakly support anyone of matching size already under suspicion.
  for (const { size, conf } of sizes) {
    for (const key of Object.keys(scores)) {
      const id = Number(key);
      const c = k.census[id];
      if (!c) continue;
      const age = (k.now - c.birthTick) / k.ticksPerYear;
      if ((age < 13 ? "small" : "large") === size) get(id).means = Math.min(1, get(id).means + 0.15 * conf);
    }
  }

  // Gunfire near a killing: everyone knows who keeps a musket.
  if (gunfire > 0) {
    for (const key of Object.keys(k.census)) {
      const id = Number(key);
      if (k.census[id]!.armed && k.census[id]!.alive) get(id).means = Math.max(get(id).means, 0.5 * gunfire);
    }
  }

  // Distrust colours judgement.
  for (const key of Object.keys(scores)) {
    const id = Number(key);
    const t = k.trust[id] ?? 0;
    if (t < -0.3) get(id).motive = Math.max(get(id).motive, Math.min(1, 0.6 * -t));
  }

  const victimId = caseFile.victim ? personOf(caseFile.victim) : null;
  const victimHousehold = caseFile.victim && caseFile.victim.kind === "holder" && caseFile.victim.holder.t === "household" ? caseFile.victim.holder.id : null;
  const out: SuspectScore[] = [];
  for (const key of Object.keys(scores)) {
    const id = Number(key);
    if (id === k.selfId || id === victimId) continue;
    const c = k.census[id];
    if (!c || !c.alive) continue;
    if (victimHousehold !== null && c.householdId === victimHousehold) continue;
    const s = scores[id]!;
    // Several independent accounts of the same act back each other up.
    const corroboration = Math.min(0.6, 0.25 * Math.max(0, s.accounts.size - 1));
    const score = s.means + s.motive + s.opportunity + s.eyewitness + corroboration;
    if (score <= 0) continue;
    out.push({ personId: id, means: round(s.means), motive: round(s.motive), opportunity: round(s.opportunity), score: round(score) });
  }
  out.sort((a, b) => b.score - a.score || a.personId - b.personId);
  return out;
}
