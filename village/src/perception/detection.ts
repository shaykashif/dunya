import type { Rng } from "../engine/rng.ts";
import { sightFactor } from "../entities/body.ts";
import { cheb, sizeClassOfAge } from "../entities/person.ts";
import type { EntityRef, Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import type { Belief } from "./beliefs.ts";

export function sightRange(w: World, observer: Person): number {
  const cfg = w.config.perception;
  const lightF = cfg.minSightFactor + (1 - cfg.minSightFactor) * w.env.light;
  const outdoors = !w.map.roofed(observer.x, observer.y);
  const weatherF = outdoors ? cfg.weatherSight[w.env.weather] : 1;
  return cfg.baseSight * lightF * weatherF * sightFactor(observer);
}

/**
 * Section 6.3: chance that an observer notices an action, from distance,
 * light, cover and vigilance. Sleepers only notice things right next to them.
 */
export function detectionProbability(w: World, observer: Person, actor: Person, boost = 1): number {
  const cfg = w.config.detection;
  if (observer.id === actor.id || !observer.alive || observer.exiled) return 0;
  const d = cheb(observer, actor);
  if (observer.asleep) {
    if (d > 2 || !w.map.lineOfSight(observer.x, observer.y, actor.x, actor.y)) return 0;
    return Math.min(1, cfg.base * cfg.sleepingFactor * boost);
  }
  const range = sightRange(w, observer);
  if (d > range) return 0;
  if (!w.map.lineOfSight(observer.x, observer.y, actor.x, actor.y)) return 0;
  const distF = 1 - d / (range + 1);
  const lightF = cfg.minLightFactor + (1 - cfg.minLightFactor) * w.env.light;
  const cover = Math.pow(cfg.forestCover, w.map.forestCover(observer.x, observer.y, actor.x, actor.y));
  const vig = 0.4 + 0.6 * observer.personality.vigilance;
  return Math.min(1, cfg.base * distF * lightF * cover * vig * boost);
}

/** What the observer actually saw of the actor: a name, a wrong name, or a figure. */
export function perceiveIdentity(w: World, observer: Person, actor: Person, rng: Rng, identBonus = 0): { subject: EntityRef; confidence: number } {
  const pc = w.config.perception;
  const range = Math.max(1, sightRange(w, observer));
  const d = cheb(observer, actor);
  let pIdent = w.config.detection.identifyBase + (1 - w.config.detection.identifyBase) * w.env.light * Math.max(0, 1 - d / (range + 1));
  if (d <= 1) pIdent = Math.max(pIdent, 0.75);
  // A violent act holds the eye: people look at the face of whoever is doing it, in a village where everyone knows everyone.
  if (identBonus > 0 && d <= range) pIdent = Math.min(1, pIdent + identBonus);
  if (w.ageYears(observer) < pc.childAge) pIdent *= pc.childIdentFactor;
  const size = sizeClassOfAge(w.ageYears(actor));
  if (rng.chance(pIdent)) return { subject: { kind: "person", id: actor.id }, confidence: 0.6 + 0.4 * pIdent };
  if (rng.chance(pc.misidentifyChance)) {
    const others = w.active().filter((o) => o.id !== actor.id && o.id !== observer.id && sizeClassOfAge(w.ageYears(o)) === size);
    if (others.length > 0) {
      const wrong = rng.pick(others);
      return { subject: { kind: "person", id: wrong.id }, confidence: 0.35 + 0.25 * rng.next() };
    }
  }
  return { subject: { kind: "unknown", desc: "figure", sizeClass: size }, confidence: 0.5 };
}

/**
 * Rolls detection for every potential witness of an action. Each detection
 * becomes an `action_witnessed` event and a pending observation that perception
 * turns into a belief.
 */
export function witnessAction(
  w: World,
  actor: Person,
  rng: Rng,
  opts: {
    predicate: string;
    object?: EntityRef | string;
    crimeId: number | null;
    boost?: number;
    /** Extra chance witnesses recognize the actor (violence is conspicuous). */
    identBonus?: number;
    exclude?: readonly number[];
    detail?: Record<string, string | number>;
  },
): number[] {
  const seen: number[] = [];
  for (const o of w.active()) {
    if (o.id === actor.id || opts.exclude?.includes(o.id)) continue;
    const p = detectionProbability(w, o, actor, opts.boost ?? 1);
    if (p <= 0 || !rng.chance(p)) continue;
    const ident = perceiveIdentity(w, o, actor, rng, opts.identBonus ?? 0);
    const ev = w.emit("action_witnessed", [o.id], {
      observer: o.id,
      perceived: ident.subject,
      predicate: opts.predicate,
      at: [actor.x, actor.y],
      p: Math.round(p * 1000) / 1000,
    });
    const belief: Omit<Belief, "id" | "sourceSeq"> = {
      subject: ident.subject,
      predicate: opts.predicate,
      time: w.tick,
      confidence: ident.confidence,
      source: "saw",
      place: { x: actor.x, y: actor.y },
    };
    if (opts.object !== undefined) belief.object = opts.object;
    if (opts.detail) belief.detail = opts.detail;
    w.pendingObservations.push({ observerId: o.id, eventSeq: ev.seq, crimeId: opts.crimeId, belief });
    seen.push(o.id);
  }
  return seen;
}
