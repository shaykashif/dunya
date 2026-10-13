// Belief types and pure helpers. This module must not import the world:
// deduction depends on it and must never see world truth.
import type { EntityRef, Point } from "../world/types.ts";

export type BeliefSource = "saw" | "heard" | "inferred";

export interface Belief {
  id: number;
  subject: EntityRef; // the person, item, or place the claim is about
  predicate: string; // e.g. "was_at", "took", "attacked", "killed", "trace_found", "hungry"
  object?: EntityRef | string | number;
  time: number; // tick the claim refers to
  confidence: number; // [0, 1]
  source: BeliefSource;
  fromId?: number; // who told them, if heard
  /** Seq of the event that produced this belief (perception, statement or deduction). */
  sourceSeq: number;
  /** Where the claim happened, if it has a place. */
  place?: Point;
  /** Observed detail only, never the full truth (e.g. a figure's size, not their name). */
  detail?: Record<string, string | number>;
}

export const CRIME_PREDICATES: readonly string[] = ["took", "attempted_theft", "attacked", "killed", "threatened"];

export function refKey(ref: EntityRef | string | number | undefined): string {
  if (ref === undefined) return "-";
  if (typeof ref === "string" || typeof ref === "number") return String(ref);
  switch (ref.kind) {
    case "person":
      return `p${ref.id}`;
    case "unknown":
      return `u:${ref.desc}:${ref.sizeClass ?? ""}`;
    case "place":
      return `@${ref.x},${ref.y}`;
    case "trace":
      return `t${ref.id}`;
    case "holder": {
      const h = ref.holder;
      if (h.t === "communal") return `h:${h.t}`;
      if (h.t === "tile") return `h:tile:${h.x},${h.y}`;
      return `h:${h.t}:${h.id}`;
    }
  }
}

export function beliefKey(b: Pick<Belief, "subject" | "predicate" | "object" | "time" | "place">): string {
  const place = b.place ? `${b.place.x},${b.place.y}` : "";
  return `${refKey(b.subject)}|${b.predicate}|${refKey(b.object)}|${Math.floor(b.time / 6)}|${place}`;
}

export function personOf(ref: EntityRef | string | number | undefined): number | null {
  if (ref && typeof ref === "object" && ref.kind === "person") return ref.id;
  return null;
}

export function cheb(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
