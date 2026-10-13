// Case files are agent-level: each investigator keeps their own.
import type { EntityRef, Point } from "../world/types.ts";

export interface SuspectScore {
  personId: number;
  means: number;
  motive: number;
  opportunity: number;
  score: number;
  /** There is direct evidence (someone saw it, blood on them, a confession), not only that they were nearby or disliked. */
  direct?: boolean;
}

export interface CaseFile {
  id: number;
  ownerId: number;
  kind: "theft" | "violence";
  victim: EntityRef | null;
  place: Point;
  timeFrom: number;
  timeTo: number;
  openedTick: number;
  originBeliefId: number;
  beliefIds: number[];
  traceIds: number[];
  suspects: SuspectScore[];
  interviewed: number[];
  examined: number;
  status: "open" | "accused" | "closed";
  accusedId: number | null;
  hearingId: number | null;
  dirty: boolean;
  key: string;
}

export function caseMatches(c: CaseFile, kind: "theft" | "violence", place: Point, timeFrom: number, timeTo: number, ticksPerDay: number): boolean {
  if (c.status === "closed" || c.kind !== kind) return false;
  if (Math.max(Math.abs(c.place.x - place.x), Math.abs(c.place.y - place.y)) > 3) return false;
  const slack = ticksPerDay * 2;
  return timeFrom <= c.timeTo + slack && timeTo >= c.timeFrom - slack;
}
