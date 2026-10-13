import type { CandidateAction } from "../actions/types.ts";
import type { SimConfig } from "../scenario/config.ts";
import type { Person } from "../world/types.ts";
import type { Decision, DecisionContext, DecisionSource } from "./types.ts";

type Weights = SimConfig["decision"]["weights"];

const WORK: ReadonlySet<string> = new Set(["forage", "gather_wood", "plant", "harvest", "hunt", "tend_animals", "repair_shelter", "construct", "haul", "quarry", "craft", "masonry"]);

function urgency(v: number): number {
  return (1 - v) * (1 - v) + (v < 0.2 ? (0.2 - v) * 5 : 0);
}

/**
 * Weighted sum of need reduction, relationship effects, obligation
 * fulfillment, risk (negative) and personality weights.
 */
export function scoreCandidate(c: CandidateAction, view: DecisionContext, w: Weights): number {
  const e = c.effects;
  const pers = view.personality;
  const v = view.values;
  const s = view.survival;
  const wants = view.wants;
  let score = 0;
  for (const k of ["food", "water", "warmth", "rest", "health"] as const) {
    const v = e[k];
    if (v) score += w.survival[k] * urgency(s[k]) * v;
  }
  for (const k of ["companionship", "affection", "status", "comfort", "security"] as const) {
    const v = e[k];
    if (v) score += w.wants[k] * (1 - wants[k]) * v;
  }
  // Values tint what each kind of good is worth to this person.
  const work = WORK.has(c.kind);
  if (e.provision) score += e.provision * w.provision * (0.4 + 0.6 * pers.loyalty) * (1 + 0.3 * v.hard_work * (work ? 1 : 0.5));
  if (e.justice) score += e.justice * w.justice * (0.5 + 0.5 * (1 - wants.security) + 0.3 * pers.honesty) * (1 + 0.3 * v.fairness);
  if (e.duty) score += e.duty * w.duty * (0.5 + pers.loyalty) * (1 + 0.25 * v.family + (work ? 0.2 * v.hard_work : 0));
  if (e.relation) score += e.relation * w.relation * (0.3 + 0.7 * pers.empathy) * (1 + 0.3 * v.cooperation);
  if (e.romance) score += e.romance * w.romance * (1 + 0.4 * v.romance);
  if (e.grudge) score += e.grudge * w.grudge * (0.3 + pers.boldness) * (1.2 - pers.empathy) * Math.max(0.2, 1 + 0.4 * v.martial - 0.4 * v.peace);
  if (e.greed) score += e.greed * w.greed * pers.greed;
  if (e.frenzy) score += e.frenzy * w.frenzy * view.madness;
  if (e.focus) {
    for (const k of Object.keys(e.focus) as (keyof typeof e.focus)[]) score += (e.focus[k] ?? 0) * w.focus * view.needStrength[k] * (1.2 - view.focus[k]);
  }
  // Those who love nature dislike felling trees and killing beasts.
  if (v.nature > 0.3 && (c.kind === "gather_wood" || c.kind === "hunt" || c.kind === "slaughter")) score -= 0.15 * v.nature;
  if ((c.kind === "idle" || c.kind === "socialize") && v.leisure !== 0) score += 0.06 * v.leisure;
  score -= c.risk * w.risk * (1.3 - pers.boldness);
  // Madness silences conscience; those who hold to the law feel it more.
  if (c.norm) score -= (w.norm * (0.25 + pers.honesty) * (1 + 0.35 * v.law) * (1 - 0.8 * view.desperation) + 0.3 * view.emotions.guilt) * (1 - 0.9 * view.madness);
  score -= (c.travel + c.duration * 0.3) * w.travel;
  if (c.kind === "sleep") score += view.inSleepWindow ? w.sleepWindow : -0.2;
  return score;
}

/** Argmax over utility scores; ties go to the lower index so behaviour is easy to inspect. */
export class UtilityDecisionSource implements DecisionSource {
  readonly name = "utility";
  private readonly weights: Weights;

  constructor(config: SimConfig) {
    this.weights = config.decision.weights;
  }

  decide(_person: Readonly<Person>, candidates: readonly CandidateAction[], view: DecisionContext): Decision {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const sc = scoreCandidate(candidates[i]!, view, this.weights);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    return { candidateIndex: best, rationale: `${candidates[best]?.key ?? "?"}=${Math.round(bestScore * 1000) / 1000}` };
  }
}
