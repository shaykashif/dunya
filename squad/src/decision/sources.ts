import type { Candidate } from "../world/types.ts";
import { NotImplementedError, type Decision, type DecisionContext, type DecisionSource, type Soldierish } from "./types.ts";

/** Placeholder for a future model-backed source. Calls no model. */
export class NanoJevDecisionSource implements DecisionSource {
  readonly name = "nanojev";
  decide(): Decision {
    throw new NotImplementedError("NanoJevDecisionSource");
  }
}

export interface DecisionRecord {
  tick: number;
  person: number;
  n: number;
  index: number;
  key: string;
  rationale?: string;
}

export class ReplayDivergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayDivergenceError";
  }
}

/** Replays a recorded decision log. Throws if the run diverges from the recording. */
export class ReplayDecisionSource implements DecisionSource {
  readonly name = "replay";
  private readonly records: readonly DecisionRecord[];
  private i = 0;

  constructor(records: readonly DecisionRecord[]) {
    this.records = records;
  }

  decide(soldier: Soldierish, candidates: readonly Candidate[], view: DecisionContext): Decision {
    const r = this.records[this.i++];
    if (!r) throw new ReplayDivergenceError(`decision log exhausted at tick ${view.tick}`);
    const key = candidates[r.index]?.key;
    if (r.person !== soldier.id || r.tick !== view.tick || r.n !== candidates.length || key !== r.key) {
      throw new ReplayDivergenceError(`replay diverged at decision ${this.i - 1}: expected s${r.person}@${r.tick} ${r.key} (n=${r.n}), got s${soldier.id}@${view.tick} ${key} (n=${candidates.length})`);
    }
    return r.rationale === undefined ? { candidateIndex: r.index } : { candidateIndex: r.index, rationale: r.rationale };
  }

  get consumed(): number {
    return this.i;
  }
}

/** Test helper: picks the first candidate matching a predicate, else defers to a fallback. */
export class ScriptedDecisionSource implements DecisionSource {
  readonly name = "scripted";
  private readonly pick: (soldier: Soldierish, candidates: readonly Candidate[], view: DecisionContext) => number | null;
  private readonly fallback: DecisionSource;

  constructor(pick: (soldier: Soldierish, candidates: readonly Candidate[], view: DecisionContext) => number | null, fallback: DecisionSource) {
    this.pick = pick;
    this.fallback = fallback;
  }

  decide(soldier: Soldierish, candidates: readonly Candidate[], view: DecisionContext): Promise<Decision> | Decision {
    const i = this.pick(soldier, candidates, view);
    if (i !== null && i >= 0 && i < candidates.length) return { candidateIndex: i };
    return this.fallback.decide(soldier, candidates, view);
  }
}
