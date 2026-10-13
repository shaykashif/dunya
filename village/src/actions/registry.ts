import type { DecisionContext } from "../decision/types.ts";
import { scoreCandidate } from "../decision/utility.ts";
import type { Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { breakUpAction, court, elope, propose } from "./bonding.ts";
import { attack, steal } from "./crime.ts";
import { homeOf, isDetained } from "./helpers.ts";
import { chase, flee, intimidate, lieInWait, plot, raid, stalk } from "./intrigue.ts";
import { carry, craft, masonry, patrol, rescue, tendWounded } from "./care.ts";
import { cannotWalk, workFactor } from "../entities/body.ts";
import { hide, kidnap, search } from "./madness.ts";
import { defend, hunt, investigateShot, slaughter, tendAnimals, tendChildren, wash } from "./chores.ts";
import { applyTaskDuty } from "../entities/tasks.ts";
import { accuse, examine, interview, judge, punish, testifyAction } from "./investigate.ts";
import { comfort, give, requestFood, socialize } from "./social.ts";
import { drink, eat, forage, idle, sleep, storeGoods } from "./survival.ts";
import type { ActionDef, ActionKind, CandidateAction } from "./types.ts";
import { gatherWood, harvest, plant, repairShelter, tendFire } from "./work.ts";

/** Fixed order: candidate lists are built in this order, which keeps them deterministic. */
export const ACTIONS: readonly ActionDef[] = [
  eat,
  drink,
  sleep,
  forage,
  storeGoods,
  gatherWood,
  tendFire,
  repairShelter,
  plant,
  harvest,
  give,
  requestFood,
  socialize,
  comfort,
  steal,
  attack,
  plot,
  stalk,
  raid,
  flee,
  chase,
  defend,
  tendAnimals,
  hunt,
  slaughter,
  tendChildren,
  wash,
  investigateShot,
  kidnap,
  hide,
  search,
  lieInWait,
  intimidate,
  rescue,
  carry,
  tendWounded,
  craft,
  masonry,
  patrol,
  examine,
  interview,
  accuse,
  testifyAction,
  judge,
  punish,
  court,
  propose,
  breakUpAction,
  elope,
  idle,
];

const BY_KIND = new Map<ActionKind, ActionDef>(ACTIONS.map((a) => [a.id, a]));

export function actionDef(kind: ActionKind): ActionDef {
  const def = BY_KIND.get(kind);
  if (!def) throw new Error(`no action ${kind}`);
  return def;
}

const DETAINED_KINDS: readonly ActionKind[] = ["eat", "drink", "sleep", "idle", "testify", "socialize", "wash"];
const INFANT_KINDS: readonly ActionKind[] = ["sleep", "idle"];

/** Work that goes slower with bad hands, bad legs or pain. */
const WORK_KINDS: readonly ActionKind[] = ["forage", "gather_wood", "repair_shelter", "plant", "harvest", "hunt", "slaughter", "tend_animals", "craft", "masonry"];

export function generateCandidates(w: World, p: Person): CandidateAction[] {
  // The carried are carried; the carrier can only take them somewhere.
  if (p.carriedById !== null) return [];
  const carrying = p.carryingId !== null;
  const infant = w.ageYears(p) < w.config.needs.infantAge;
  const detained = isDetained(w, p) || p.captorId !== null;
  const lame = cannotWalk(p);
  const out: CandidateAction[] = [];
  for (const def of ACTIONS) {
    if (carrying && def.id !== "carry") continue;
    if (infant && !INFANT_KINDS.includes(def.id)) continue;
    if (detained && !DETAINED_KINDS.includes(def.id)) continue;
    for (const c of def.candidates(p, w)) {
      // House arrest: a detained person stays home except to fetch water.
      if (detained && c.dest !== null && c.kind !== "drink" && !(c.dest.x === homeOf(w, p).bed.x && c.dest.y === homeOf(w, p).bed.y)) continue;
      // Someone who cannot walk can only do what is within reach.
      if (lame && c.dest !== null && !(c.dest.x === p.x && c.dest.y === p.y)) {
        const t = c.follow ? w.maybePerson(c.targetId) : null;
        if (!t || Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) > (c.reach ?? 1)) continue;
      }
      out.push(c);
    }
  }
  const slow = workFactor(p);
  if (slow < 0.98) for (const c of out) if (WORK_KINDS.includes(c.kind)) c.duration = Math.ceil(c.duration / slow);
  applyTaskDuty(p, out);
  return out;
}

/**
 * Section 6.2: keep at most `max` candidates by pre-scoring with the utility
 * function. Survivors keep their original relative order.
 */
export function pruneCandidates(cands: CandidateAction[], view: DecisionContext, w: World): CandidateAction[] {
  const max = w.config.decision.maxCandidates;
  if (cands.length <= max) return cands;
  const scored = cands.map((c, i) => ({ i, s: scoreCandidate(c, view, w.config.decision.weights) }));
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const keep = new Set(scored.slice(0, max).map((x) => x.i));
  return cands.filter((_, i) => keep.has(i));
}
