import type { Candidate, ElementOrder, Experience, Role, Side, Status, Traits } from "../world/types.ts";

/** What a soldier knows when deciding: his own state, his orders and what his squad has seen. Never world truth. */
export interface DecisionContext {
  tick: number;
  side: Side;
  role: Role;
  status: Status;
  experience: Experience;
  traits: Readonly<Traits>;
  health: number;
  pain: number;
  suppression: number;
  morale: number;
  pinned: boolean;
  broken: boolean;
  order: Readonly<ElementOrder>;
  /** Enemies his squad knows of, and how many he can see himself. */
  contactsKnown: number;
  enemiesSeen: number;
  underFire: boolean;
  ammoFraction: number;
}

export interface Decision {
  candidateIndex: number;
  rationale?: string;
}

export interface Soldierish {
  readonly id: number;
}

export interface DecisionSource {
  readonly name: string;
  decide(soldier: Soldierish, candidates: readonly Candidate[], view: DecisionContext): Promise<Decision> | Decision;
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented`);
    this.name = "NotImplementedError";
  }
}
