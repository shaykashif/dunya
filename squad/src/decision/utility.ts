// The default decision source: weighs each option by its tactical worth and
// the man's character. Brave, aggressive men push on and shoot; frightened
// men hug cover; disciplined men do as they are told; kind men go to the wounded.
import { Rng } from "../engine/rng.ts";
import type { Candidate } from "../world/types.ts";
import type { Decision, DecisionContext, DecisionSource, Soldierish } from "./types.ts";

export function score(c: Candidate, v: DecisionContext): number {
  const t = v.traits;
  const fear = Math.min(2, (1 - t.nerve) * 0.6 + v.suppression * 0.9 + (1 - v.morale) * 0.7 + v.pain * 0.4);
  let s = c.value * (c.ordered ? 0.75 + 0.5 * t.discipline : 1);
  s += c.offense * (t.aggression - 0.45) * 0.5;
  s += c.care * (t.empathy - 0.3) * 0.5;
  s += c.safety * fear * 0.45;
  s -= c.danger * fear * 0.9;
  return s;
}

export class UtilityDecisionSource implements DecisionSource {
  readonly name = "utility";
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed, "decision");
  }

  decide(_soldier: Soldierish, candidates: readonly Candidate[], view: DecisionContext): Decision {
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const sc = score(candidates[i]!, view) + this.rng.next() * 0.06;
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    return { candidateIndex: best, rationale: `${candidates[best]!.kind} ${bestScore.toFixed(2)}` };
  }
}
