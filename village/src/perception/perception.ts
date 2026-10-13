import { cheb, feel, firstName, sizeClassOfAge } from "../entities/person.ts";
import { interruptPlan } from "../engine/plans.ts";
import type { Rng } from "../engine/rng.ts";
import type { HolderRef, Person, Trace, TraceKind } from "../world/types.ts";
import type { World } from "../world/world.ts";
import type { Belief } from "./beliefs.ts";
import { perceiveIdentity, sightRange } from "./detection.ts";
import { addBelief } from "./store.ts";

/** Turns a trace into what the observer can actually tell from it. */
/** Causes a body's signs can be mistaken for: bites for blows, cold for hunger. */
const CONFUSED: Record<string, string[]> = {
  person: ["wolf"],
  wolf: ["person"],
  starvation: ["exposure", "dehydration"],
  exposure: ["starvation", "exhaustion"],
  dehydration: ["starvation"],
  exhaustion: ["exposure", "starvation"],
  execution: ["execution"],
  unknown: ["person", "exposure", "starvation", "wolf"],
};

/** What an observer makes of a body: usually right, sometimes misled, better when examined carefully. */
export function readBody(w: World, observer: Person, trueCause: string, rng: Rng, careful: boolean, victimId: number | null = null): { cause: string; confidence: number } {
  // Whoever saw the killing (or was told of it, or did it) is not fooled by the marks on the body.
  if (trueCause === "person" && victimId !== null && observer.beliefs.some((b) => b.predicate === "killed" && typeof b.object === "object" && b.object.kind === "person" && b.object.id === victimId && b.confidence >= 0.4)) {
    return { cause: "person", confidence: 0.95 };
  }
  const p = 0.7 + 0.25 * observer.personality.vigilance + (careful ? 0.2 : 0) + (observer.role === "elder" ? 0.05 : 0);
  if (rng.chance(p)) return { cause: trueCause, confidence: 0.6 + 0.3 * p };
  const alts = CONFUSED[trueCause] ?? [trueCause];
  return { cause: rng.pick(alts), confidence: 0.4 + 0.2 * rng.next() };
}

export function traceBelief(w: World, trace: Trace, rng: Rng, observer?: Person, careful = false): Omit<Belief, "id" | "sourceSeq"> {
  const base = { predicate: "trace_found", object: trace.kind as string, time: w.tick, source: "saw" as const, place: { ...trace.location } };
  const firstPerson = trace.involves.find((r) => r.kind === "person");
  switch (trace.kind) {
    case "item_missing":
      return {
        ...base,
        subject: { kind: "holder", holder: trace.details.holder as HolderRef },
        confidence: 0.9,
        detail: { traceId: trace.id, item: String(trace.details.item), qty: Number(trace.details.qty) },
      };
    case "body": {
      const read = observer ? readBody(w, observer, String(trace.details.cause), rng, careful, firstPerson?.kind === "person" ? firstPerson.id : null) : { cause: String(trace.details.cause), confidence: 0.6 };
      return { ...base, subject: firstPerson ?? { kind: "place", ...trace.location }, confidence: read.confidence, detail: { traceId: trace.id, cause: read.cause } };
    }
    case "wound":
      return { ...base, subject: firstPerson ?? { kind: "place", ...trace.location }, confidence: 0.85, detail: { traceId: trace.id, severity: String(trace.details.severity) } };
    case "footprint":
      return { ...base, subject: { kind: "unknown", desc: "footprint", sizeClass: trace.details.size as "small" | "large" }, confidence: 0.6, detail: { traceId: trace.id, size: String(trace.details.size) } };
    case "object_left": {
      const owner = Number(trace.details.ownerId);
      const recognized = rng.chance(0.7);
      return {
        ...base,
        subject: recognized ? { kind: "person", id: owner } : { kind: "unknown", desc: "object" },
        confidence: recognized ? 0.7 : 0.5,
        detail: { traceId: trace.id, item: String(trace.details.item) },
      };
    }
    default:
      return { ...base, subject: { kind: "place", x: trace.location.x, y: trace.location.y }, confidence: 0.8, detail: { traceId: trace.id } };
  }
}

/** Records that an observer found a trace: marks it discovered, logs it, and adds the belief. */
export function discoverTrace(w: World, observer: Person, trace: Trace, rng: Rng, how: "noticed" | "examined" | "oversight"): Belief {
  const first = !trace.discovered;
  if (first) {
    trace.discovered = true;
    trace.discoveredTick = w.tick;
  }
  observer.knownTraces[trace.id] = true;
  const ev = w.emit("trace_discovered", [observer.id], { observer: observer.id, trace: trace.id, kind: trace.kind, first, how });
  const holder = trace.details.holder as HolderRef | undefined;
  if (trace.kind === "item_missing" && holder && (holder.t === "household" || holder.t === "farm") && holder.id === observer.householdId) {
    feel(w, observer, "angry", holder.t === "farm" ? "found their farm robbed" : "found food stolen from their house", 0.5);
  }
  if (trace.kind === "body") {
    const who = trace.involves.find((r) => r.kind === "person");
    if (who && who.kind === "person") feel(w, observer, "afraid", `found ${firstName(w.person(who.id))}'s body`, 0.7);
  }
  if (first && trace.kind === "item_missing" && (trace.details.holder as HolderRef).t === "communal") {
    w.storeWatch = Math.min(1, w.storeWatch + w.config.communal.watchPerTheft);
    w.emit("watch_raised", [observer.id], { level: Math.round(w.storeWatch * 1000) / 1000, by: observer.id });
  }
  if (trace.kind === "body" && first) {
    const who = trace.involves.find((r) => r.kind === "person");
    if (who && who.kind === "person" && w.census[who.id]) {
      w.census[who.id]!.alive = false;
      w.emit("body_found", [observer.id], { person: who.id, finder: observer.id });
    }
  }
  const belief = addBelief(w, observer, traceBelief(w, trace, rng, observer, how === "examined"), ev.seq, trace.crimeId);
  if (trace.kind === "body" && belief.detail?.cause) {
    w.emit("body_read", [observer.id], { observer: observer.id, trace: trace.id, apparent: belief.detail.cause, careful: how === "examined" });
  }
  return belief;
}

function canNoticeTrace(w: World, observer: Person, trace: Trace): boolean {
  if (trace.kind === "sound") return false;
  if (trace.kind === "item_missing") {
    const h = trace.details.holder as HolderRef;
    if (h.t === "farm") return observer.householdId === h.id;
    const b = w.buildingOf(trace.location);
    if (!b || !w.isInside(observer, b)) return false;
    const holder = trace.details.holder as HolderRef;
    return holder.t === "communal" || (holder.t === "household" && holder.id === observer.householdId) || observer.role === "elder";
  }
  return true;
}

function bloodLabel(subject: Person): string | null {
  if (subject.bloodyTool) return "bloody_tool";
  if (subject.bloodyClothes) return "bloody_clothes";
  return null;
}

function notableLabel(w: World, subject: Person): string | null {
  if (subject.asleep) return null;
  const b = w.buildingOf(subject);
  if (b && w.isInside(subject, b)) {
    if (b.kind === "store") return "store";
    if (b.householdId !== subject.householdId) return `house:${b.householdId}`;
    return null;
  }
  if (w.env.light < w.config.light.nightThreshold) return "outdoors_night";
  for (const t of w.traces) {
    if ((t.kind === "body" || t.kind === "blood") && cheb(t.location, subject) <= 2) return `near_${t.kind}`;
  }
  return null;
}

/**
 * Step 5 of the tick. Each person perceives what is visible within their sight
 * range: witnessed actions, notable sightings of people, and traces. Sounds are
 * heard within a smaller radius. Perception stores the observed detail only.
 */
export function runPerception(w: World): void {
  const rng = w.rng.get("perception");
  const pc = w.config.perception;

  for (const obs of w.pendingObservations) {
    const observer = w.maybePerson(obs.observerId);
    if (!observer || !observer.alive || observer.exiled) continue;
    addBelief(w, observer, obs.belief, obs.eventSeq, obs.crimeId);
  }
  w.pendingObservations = [];

  const active = w.active();
  for (const observer of active) {
    if (observer.asleep) continue;
    const range = sightRange(w, observer);

    for (const subject of active) {
      if (subject.id === observer.id) continue;
      const d = cheb(observer, subject);
      if (d > range) continue;
      const last = observer.lastSighted[subject.id];
      if (last !== undefined && w.tick - last < pc.sightingThrottleTicks) continue;
      const blood = bloodLabel(subject);
      const label = blood ?? notableLabel(w, subject);
      if (label === null) continue;
      if (!w.map.lineOfSight(observer.x, observer.y, subject.x, subject.y)) continue;
      const lightF = 0.3 + 0.7 * w.env.light;
      const pNotice = pc.noticeBase * (1 - d / (range + 1)) * lightF * (0.5 + 0.5 * observer.personality.vigilance);
      observer.lastSighted[subject.id] = w.tick;
      if (!rng.chance(pNotice)) continue;
      const ident = perceiveIdentity(w, observer, subject, rng);
      const ev = w.emit("perceived", [observer.id], { observer: observer.id, what: blood ? "blood" : "sighting", perceived: ident.subject, label, at: [subject.x, subject.y] });
      if (blood) {
        addBelief(w, observer, {
          subject: ident.subject,
          predicate: "seen_bloody",
          object: blood === "bloody_tool" ? "tool" : "clothes",
          time: w.tick,
          confidence: ident.confidence,
          source: "saw",
          place: { x: subject.x, y: subject.y },
        }, ev.seq);
        if (ident.subject.kind === "person") feel(w, observer, "suspicious", `saw ${firstName(w.person(ident.subject.id))} with blood on their ${blood === "bloody_tool" ? "tool" : "clothes"}`, 0.4);
      }
      addBelief(w, observer, {
        subject: ident.subject,
        predicate: "was_at",
        object: label,
        time: w.tick,
        confidence: ident.confidence,
        source: "saw",
        place: { x: subject.x, y: subject.y },
        detail: { night: w.env.light < w.config.light.nightThreshold ? 1 : 0 },
      }, ev.seq);
    }

    for (const trace of w.traces.slice()) {
      if (observer.knownTraces[trace.id]) continue;
      const d = cheb(observer, trace.location);
      if (d > range) continue;
      if (!canNoticeTrace(w, observer, trace)) continue;
      if (!w.map.lineOfSight(observer.x, observer.y, trace.location.x, trace.location.y)) continue;
      const p = (pc.discover as Record<TraceKind, number>)[trace.kind] * (0.5 + 0.5 * observer.personality.vigilance) * (0.4 + 0.6 * w.env.light);
      if (!rng.chance(p)) continue;
      discoverTrace(w, observer, trace, rng, "noticed");
    }
  }

  // Sounds made this tick are heard within a smaller radius, and wake sleepers.
  for (const trace of w.traces) {
    if (trace.kind !== "sound" || trace.tick !== w.tick) continue;
    const makers = trace.involves.flatMap((r) => (r.kind === "person" ? [r.id] : []));
    const radius = typeof trace.details.radius === "number" ? trace.details.radius : pc.hearRadius;
    for (const hearer of active) {
      if (makers.includes(hearer.id)) continue;
      const d = cheb(hearer, trace.location);
      if (d > radius) continue;
      const indoorsDiff = w.map.roofed(hearer.x, hearer.y) !== trace.roofed;
      const p = (radius > pc.hearRadius ? 0.95 : 0.85) * (1 - d / (radius + 1)) * (hearer.asleep ? 0.6 : 1) * (indoorsDiff ? 0.6 : 1);
      if (!rng.chance(p)) continue;
      const ev = w.emit("perceived", [hearer.id], { observer: hearer.id, what: "sound", at: [trace.location.x, trace.location.y] });
      if (hearer.asleep) interruptPlan(w, hearer, "noise");
      addBelief(w, hearer, {
        subject: { kind: "place", x: trace.location.x, y: trace.location.y },
        predicate: "heard_noise",
        object: String(trace.details.what ?? "noise"),
        time: w.tick,
        confidence: 0.5,
        source: "heard",
        place: { ...trace.location },
      }, ev.seq, trace.crimeId);
    }
  }
}

export function sizeOf(w: World, p: Person): "small" | "large" {
  return sizeClassOfAge(w.ageYears(p));
}
