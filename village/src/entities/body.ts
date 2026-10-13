// What injuries do to a body: how well someone can walk, grip, see and bear
// the pain. Pure functions of the person, so movement, fighting, perception and
// the viewer all read the same numbers.
import type { BodyPart, Injury, InjuryKind, Person } from "../world/types.ts";

/** How much a wound of each kind hampers the part it is on, per unit of severity. */
const HAMPER: Record<InjuryKind, number> = { bruise: 0.4, cut: 0.5, gash: 0.8, bite: 0.8, sprain: 1, fracture: 1.25, gunshot: 1, lost: 1 };
/** How much each kind hurts, per unit of severity. */
const PAIN: Record<InjuryKind, number> = { bruise: 0.35, cut: 0.4, gash: 0.7, bite: 0.7, sprain: 0.6, fracture: 0.9, gunshot: 1, lost: 0.5 };

/** Residual hampering of the lasting conditions injuries leave behind. */
const LASTING_HAMPER: Record<string, number> = { lame: 0.45, "crooked arm": 0.35, "maimed hand": 0.45, "lost eye": 1 };

export const OPEN_WOUNDS: ReadonlySet<InjuryKind> = new Set(["cut", "gash", "bite", "gunshot"]);

const LEGS: readonly BodyPart[] = ["left leg", "left foot", "right leg", "right foot"];
const ARMS: readonly BodyPart[] = ["left arm", "left hand", "right arm", "right hand"];

function hamper(inj: Injury): number {
  if (inj.permanent) return LASTING_HAMPER[inj.lasting ?? ""] ?? 0;
  return Math.min(1, inj.severity * HAMPER[inj.kind]);
}

function sideImpairment(p: Person, parts: readonly BodyPart[]): number {
  let worst = 0;
  for (const inj of p.injuries) if (parts.includes(inj.part)) worst = Math.max(worst, hamper(inj));
  return worst;
}

/** How badly each leg is hurt, in [0, 1]. */
export function legImpairment(p: Person): { left: number; right: number; worst: number } {
  const left = sideImpairment(p, LEGS.slice(0, 2));
  const right = sideImpairment(p, LEGS.slice(2));
  return { left, right, worst: Math.max(left, right) };
}

/**
 * Someone with a badly broken or twisted leg, both legs hurt, or no strength
 * left cannot walk at all and has to be carried. A crutch lets all but the worst walk.
 */
export function cannotWalk(p: Person): boolean {
  if (p.survival.health < 0.12) return true;
  const legs = legImpairment(p);
  const limit = p.crutch ? 0.9 : 0.7;
  return legs.worst >= limit || Math.min(legs.left, legs.right) >= (p.crutch ? 0.6 : 0.45);
}

/** Walking speed factor from the legs, in [0, 1]. A crutch takes some of the weight off a bad leg. */
export function mobility(p: Person): number {
  if (cannotWalk(p)) return 0;
  const legs = legImpairment(p);
  const impair = legs.worst * (p.crutch ? 0.55 : 1) + Math.min(legs.left, legs.right) * 0.5;
  return Math.max(0.2, 1 - impair);
}

/** Grip and arm strength, in [0, 1]. */
export function armFactor(p: Person): number {
  const left = sideImpairment(p, ARMS.slice(0, 2));
  const right = sideImpairment(p, ARMS.slice(2));
  return Math.max(0.25, 1 - Math.max(left, right) * 0.6 - Math.min(left, right) * 0.3);
}

/** Eyesight: a lost eye narrows it, two blind the person; a fresh head wound blurs it. */
export function sightFactor(p: Person): number {
  let eyes = 2;
  let head = 0;
  for (const inj of p.injuries) {
    if ((inj.part === "left eye" || inj.part === "right eye") && (inj.kind === "lost" || inj.lasting === "lost eye")) eyes--;
    else if ((inj.part === "left eye" || inj.part === "right eye") && !inj.permanent) head = Math.max(head, inj.severity * 0.6);
    else if (inj.part === "head" && !inj.permanent) head = Math.max(head, inj.severity * 0.3);
  }
  const base = eyes >= 2 ? 1 : eyes === 1 ? 0.78 : 0.2;
  return Math.max(0.15, base * (1 - head));
}

/** Pain from wounds that are still healing, in [0, 1]. Infection makes it worse. */
export function painOf(p: Person): number {
  let pain = 0;
  for (const inj of p.injuries) {
    if (inj.permanent) continue;
    pain += inj.severity * PAIN[inj.kind] * (inj.infected ? 1.5 : 1);
  }
  return Math.min(1, pain);
}

/** How marred the face is, in [0, 1]: scars, a lost eye, a ruined face. Others notice. */
export function disfigurement(p: Person): number {
  let d = 0;
  for (const inj of p.injuries) {
    if (!inj.permanent) continue;
    if (inj.lasting === "ruined face") d += 0.7;
    else if (inj.lasting === "disfiguring scar") d += 0.45;
    else if (inj.lasting === "facial scar") d += 0.15;
    else if (inj.lasting === "lost eye") d += 0.25;
  }
  return Math.min(1, d);
}

/** Work goes slower with bad hands and arms, bad legs, or a lot of pain. */
export function workFactor(p: Person): number {
  return Math.max(0.3, Math.min(armFactor(p), 0.5 + 0.5 * mobility(p)) * (1 - 0.4 * painOf(p)));
}

/** True for a leg bad enough that a crutch would help. */
export function needsCrutch(p: Person): boolean {
  return !p.crutch && legImpairment(p).worst >= 0.3;
}

/** Wounds still untended, or festering. */
export function untendedWounds(p: Person): Injury[] {
  return p.injuries.filter((i) => !i.permanent && ((i.severity >= 0.25 && i.care < 0.3) || i.infected || i.bleeding > 0));
}

/** Plain-language severity, Dwarf Fortress style. */
export function severityWord(inj: Injury): string {
  if (inj.permanent) return "healed badly";
  const s = inj.severity;
  return s >= 0.75 ? "grave" : s >= 0.5 ? "serious" : s >= 0.25 ? "moderate" : "minor";
}
