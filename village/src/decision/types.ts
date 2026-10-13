import type { CandidateAction } from "../actions/types.ts";
import type { Belief } from "../perception/beliefs.ts";
import type { Emotions, Obligation, Person, Personality, Survival, Wants } from "../world/types.ts";

/** What a person knows when deciding: their own state and beliefs, never world truth. */
export interface DecisionContext {
  tick: number;
  hour: number;
  season: number;
  light: number;
  temperature: number;
  weather: string;
  purpose: "act" | "respond";
  inSleepWindow: boolean;
  ageYears: number;
  survival: Readonly<Survival>;
  wants: Readonly<Wants>;
  personality: Readonly<Personality>;
  emotions: Readonly<Emotions>;
  obligations: readonly Readonly<Obligation>[];
  beliefs: readonly Readonly<Belief>[];
  recentEvents: readonly string[];
  mood: number;
  /** In [0, 1]; high values drive frenzied acts. */
  madness: number;
  /** Food the person knows is at home (their own household store). */
  homeFood: number;
  /** How desperate hunger makes them, in [0, 1]. */
  desperation: number;
}

export interface Decision {
  candidateIndex: number;
  rationale?: string;
}

export interface DecisionSource {
  readonly name: string;
  decide(person: Readonly<Person>, candidates: readonly CandidateAction[], view: DecisionContext): Promise<Decision> | Decision;
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented`);
    this.name = "NotImplementedError";
  }
}
