import { r3 } from "../log/events.ts";
import type { Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { beliefKey, type Belief } from "./beliefs.ts";

const indexes = new WeakMap<Person, Map<string, Belief>>();

function indexOf(p: Person): Map<string, Belief> {
  let idx = indexes.get(p);
  if (!idx) {
    idx = new Map();
    for (const b of p.beliefs) idx.set(beliefKey(b), b);
    indexes.set(p, idx);
  }
  return idx;
}

/**
 * The only way a belief enters an agent's store. Every belief carries the seq
 * of the event that produced it (perception, statement or deduction).
 */
export function addBelief(
  w: World,
  p: Person,
  b: Omit<Belief, "id" | "sourceSeq">,
  sourceSeq: number,
  crimeId: number | null = null,
): Belief {
  const key = beliefKey(b);
  const idx = indexOf(p);
  const existing = idx.get(key);
  if (existing) {
    if (b.confidence > existing.confidence + 0.05) {
      existing.confidence = r3(b.confidence);
      w.emit("belief_updated", [p.id], { holder: p.id, belief: existing.id, confidence: existing.confidence, sourceSeq });
    }
    if (crimeId !== null && !w.beliefCrime.has(existing.id)) w.beliefCrime.set(existing.id, crimeId);
    return existing;
  }
  const belief: Belief = { ...b, confidence: r3(Math.min(1, Math.max(0, b.confidence))), id: w.nextId("belief"), sourceSeq };
  p.beliefs.push(belief);
  idx.set(key, belief);
  if (crimeId !== null) w.beliefCrime.set(belief.id, crimeId);
  w.emit("belief_added", [p.id], { holder: p.id, belief: { ...belief } });
  w.pendingCaseChecks.push({ personId: p.id, beliefId: belief.id });
  return belief;
}

export function findBelief(p: Person, id: number): Belief | undefined {
  return p.beliefs.find((b) => b.id === id);
}

/** Daily decay and forgetting. Beliefs referenced by an open case are kept. */
export function decayBeliefs(w: World): void {
  const cfg = w.config.beliefs;
  const memory = w.days(cfg.sightingMemoryDays);
  for (const p of w.active()) {
    const keep = new Set<number>();
    for (const c of p.caseFiles) if (c.status !== "closed") for (const id of c.beliefIds) keep.add(id);
    let forgotten = 0;
    const idx = indexOf(p);
    const next: Belief[] = [];
    for (const b of p.beliefs) {
      if (keep.has(b.id)) {
        next.push(b);
        continue;
      }
      if (b.source === "heard") b.confidence = r3(b.confidence * cfg.heardDecayPerDay);
      const routine = b.predicate === "was_at" || b.predicate === "hungry" || b.predicate === "heard_noise" || b.predicate === "suspected";
      if (b.confidence < cfg.forgetBelow || (routine && w.tick - b.time > memory)) {
        idx.delete(beliefKey(b));
        forgotten++;
      } else {
        next.push(b);
      }
    }
    if (forgotten > 0) {
      p.beliefs = next;
      w.emit("beliefs_forgotten", [p.id], { holder: p.id, count: forgotten });
    }
  }
}
