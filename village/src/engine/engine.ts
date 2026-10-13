import { desperation, homeFood } from "../actions/helpers.ts";
import { actionDef, generateCandidates, pruneCandidates } from "../actions/registry.ts";
import type { CandidateAction, ResolveCtx } from "../actions/types.ts";
import { updateBonding } from "../entities/bonding.ts";
import { tickSummary, updateNeeds } from "../entities/needs.ts";
import { cannotWalk } from "../entities/body.ts";
import { accidentStep, updateInjuries } from "../entities/injuries.ts";
import { cultureStep, needStrength } from "../entities/culture.ts";
import { abandonStale, assignBeds } from "../world/structures.ts";
import { activeObligations } from "../entities/obligations.ts";
import { cheb, inSleepWindow, pushRecent, speedOf } from "../entities/person.ts";
import type { DecisionRecord } from "../decision/sources.ts";
import type { Decision, DecisionContext, DecisionSource } from "../decision/types.ts";
import { justiceStep } from "../justice/justice.ts";
import { plotStep } from "../plots/plots.ts";
import { applyIntervention, type Intervention, type ScheduledIntervention } from "./interventions.ts";
import { madnessStep } from "../entities/madness.ts";
import { runPerception } from "../perception/perception.ts";
import { envSummary, updateEnvironment } from "../world/environment.ts";
import { updateAnimals } from "../world/animals.ts";
import { maybeMount, updateRiders } from "../world/arms.ts";
import { updateProduction } from "../world/production.ts";
import { updateTraces } from "../world/traces.ts";
import type { Person, Plan, Point } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { checkInvariants } from "./invariants.ts";

function isPromise<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown }).then === "function";
}

export function buildContext(w: World, p: Person, purpose: "act" | "respond"): DecisionContext {
  return {
    tick: w.tick,
    hour: w.env.hour,
    season: w.env.season,
    light: w.env.light,
    temperature: w.env.temperature,
    weather: w.env.weather,
    purpose,
    inSleepWindow: inSleepWindow(p, w.env.hour),
    ageYears: w.ageYears(p),
    survival: p.survival,
    wants: p.wants,
    personality: p.personality,
    emotions: p.emotions,
    obligations: activeObligations(w, p.id),
    beliefs: p.beliefs,
    recentEvents: p.recent.map((r) => r.text),
    mood: p.mood,
    madness: p.mad ? Math.max(0.6, p.madness) : 0,
    homeFood: homeFood(w, p),
    desperation: desperation(w, p),
    values: p.values,
    focus: p.focus,
    needStrength: { pray: needStrength(p, "pray"), create: needStrength(p, "create"), leisure: needStrength(p, "leisure"), family: needStrength(p, "family") },
  };
}

/**
 * The tick loop. The engine is the sole authority on what happened: decision
 * sources only pick among candidates, and every outcome is applied here.
 */
export class Engine {
  readonly world: World;
  readonly decisions: DecisionSource;
  readonly decisionLog: DecisionRecord[] = [];
  /** Player interventions, in the order applied. Replays need these alongside the decision log. */
  readonly interventionLog: ScheduledIntervention[] = [];
  private pending: ScheduledIntervention[] = [];

  /** Queue a player intervention; it takes effect at the start of the next tick. */
  intervene(cmd: Intervention): void {
    this.pending.push({ tick: this.world.tick, cmd });
  }

  /** Pre-load interventions recorded from an earlier run (for replay). */
  schedule(list: readonly ScheduledIntervention[]): void {
    this.pending.push(...list.map((x) => ({ tick: x.tick, cmd: x.cmd })));
  }

  constructor(world: World, decisions: DecisionSource) {
    this.world = world;
    this.decisions = decisions;
  }

  private async decideFor(p: Person, candidates: CandidateAction[], purpose: "act" | "respond"): Promise<{ cand: CandidateAction; index: number }> {
    const w = this.world;
    const view = buildContext(w, p, purpose);
    const list = purpose === "act" ? pruneCandidates(candidates, view, w) : candidates;
    const raw = this.decisions.decide(p, list, view);
    const d: Decision = isPromise(raw) ? await raw : raw;
    const index = d.candidateIndex;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new Error(`decision source returned invalid index ${index} for ${list.length} candidates`);
    const chosen = list[index]!;
    const record: DecisionRecord = { tick: w.tick, person: p.id, purpose, n: list.length, index, key: chosen.key };
    if (d.rationale !== undefined) record.rationale = d.rationale;
    this.decisionLog.push(record);
    w.emit("decision", [p.id], {
      person: p.id,
      purpose,
      n: list.length,
      offered: candidates.length,
      keys: list.map((c) => c.key).join("|"),
      chosen: index,
      key: chosen.key,
      ...(d.rationale ? { rationale: d.rationale } : {}),
    });
    return { cand: chosen, index };
  }

  private startPlan(p: Person, c: CandidateAction): void {
    const w = this.world;
    const plan: Plan = {
      cand: c,
      phase: "travel",
      path: null,
      pathIdx: 0,
      pathGoal: -1,
      goal: -1,
      queued: false,
      blocked: 0,
      moveAcc: 0,
      workLeft: c.duration,
      performed: 0,
      travelTicks: 0,
      startTick: w.tick,
    };
    p.plan = plan;
    if (c.dest) maybeMount(w, p, c.dest);
    if (!c.dest) plan.phase = "perform";
    else if (c.follow) {
      const t = w.maybePerson(c.targetId);
      if (t && cheb(p, t) <= (c.reach ?? 1)) plan.phase = "perform";
    } else {
      this.chooseGoal(p, plan);
      if (!plan.queued && plan.goal === w.map.idx(p.x, p.y)) plan.phase = "perform";
    }
  }

  /**
   * Picks the tile to stand on: the nearest free tile within reach of the
   * destination (inside the same building if the destination is indoors). If
   * every spot is taken, the person joins the back of the line: the free tile
   * furthest along their own approach path.
   */
  private chooseGoal(p: Person, plan: Plan): void {
    const w = this.world;
    const c = plan.cand;
    const dest = c.dest!;
    const b = w.buildingOf(dest);
    const indoors = b !== null && w.isInside(dest, b);
    const reach = c.reach ?? (indoors ? 8 : w.map.passable(dest.x, dest.y) ? 2 : 1);
    const accept = indoors ? (x: number, y: number) => w.isInside({ x, y }, b!) : undefined;
    let spot = w.freeTileNear(dest, reach, p.id, accept);
    plan.queued = false;
    if (!spot) {
      plan.queued = true;
      const approach = w.map.passable(dest.x, dest.y) ? dest : w.map.neighbors4(dest.x, dest.y).find((n) => w.map.passable(n.x, n.y)) ?? dest;
      const path = w.path(p, approach);
      if (path) {
        for (let i = path.length - 1; i >= 0; i--) {
          const pt = w.map.pt(path[i]!);
          if (w.isFree(pt.x, pt.y, p.id)) {
            spot = pt;
            break;
          }
        }
      }
      spot ??= w.freeTileNear(dest, reach + 8, p.id);
    }
    const goal = spot ? w.map.idx(spot.x, spot.y) : w.map.idx(p.x, p.y);
    if (goal !== plan.goal) {
      plan.goal = goal;
      plan.path = null;
    }
  }

  private failPlan(p: Person, reason: string): void {
    const w = this.world;
    if (p.plan) w.emit("plan_failed", [p.id], { person: p.id, kind: p.plan.cand.kind, key: p.plan.cand.key, reason });
    p.plan = null;
    p.asleep = false;
  }

  /** Moves a person one tick along their path, never onto an occupied tile. Returns true on arrival. */
  private travel(p: Person, plan: Plan): boolean | "fail" {
    const w = this.world;
    const c = plan.cand;
    let goalIdx: number;
    if (c.follow) {
      const t = w.maybePerson(c.targetId);
      if (!t || !w.isActive(t.id)) return "fail";
      if (cheb(p, t) <= (c.reach ?? 1)) return true;
      goalIdx = w.map.idx(t.x, t.y);
    } else {
      const here = w.map.idx(p.x, p.y);
      if (plan.queued || (w.occupancy[plan.goal] !== 0 && w.occupancy[plan.goal] !== p.id)) this.chooseGoal(p, plan);
      if (plan.goal === here) return !plan.queued;
      goalIdx = plan.goal;
    }
    if (plan.pathGoal !== goalIdx || !plan.path) {
      plan.path = w.path(p, w.map.pt(goalIdx));
      plan.pathIdx = 0;
      plan.pathGoal = goalIdx;
      if (!plan.path) return "fail";
    }
    plan.travelTicks++;
    if (plan.travelTicks > w.config.movement.maxTravelTicks) return "fail";
    plan.moveAcc += speedOf(w, p);
    const path = plan.path;
    // Walk as far as this tick allows. People may slip past others on the way,
    // but must end the tick on a free tile.
    let idx = plan.pathIdx;
    let stopAt = -1;
    let budget = plan.moveAcc;
    let reachedTarget = false;
    while (idx < path.length) {
      const next = path[idx]!;
      const cost = w.map.cost(next);
      if (budget < cost) break;
      const occ = w.occupancy[next]!;
      if (c.follow && occ === c.targetId) {
        reachedTarget = true;
        break;
      }
      budget -= cost;
      idx++;
      if (occ === 0 || occ === p.id) {
        if (w.map.at(next % w.map.width, Math.floor(next / w.map.width)) !== "door" || idx >= path.length) stopAt = idx;
        if (c.follow) {
          const t = w.person(c.targetId!);
          const pt = w.map.pt(next);
          if (cheb(pt, t) <= (c.reach ?? 1)) break;
        }
      }
    }
    if (stopAt > plan.pathIdx) {
      for (let i = plan.pathIdx; i < stopAt; i++) plan.moveAcc -= w.map.cost(path[i]!);
      plan.moveAcc = Math.max(0, plan.moveAcc);
      const trail = w.trails.get(p.id) ?? [];
      trail.push(...path.slice(plan.pathIdx, stopAt));
      w.trails.set(p.id, trail);
      plan.pathIdx = stopAt;
      plan.blocked = 0;
      const last = path[stopAt - 1]!;
      w.place(p, last % w.map.width, Math.floor(last / w.map.width));
    } else if (!reachedTarget) {
      // Nowhere free to stop within reach this tick.
      plan.blocked++;
      plan.moveAcc = Math.min(plan.moveAcc, 3);
      const nearDest = !c.follow && c.dest !== null && cheb(p, c.dest) <= (c.reach ?? 2) + 3;
      if (!nearDest && plan.blocked % (w.config.movement.detourAfterTicks + 1) === w.config.movement.detourAfterTicks) {
        const detour = w.detour(p, w.map.pt(goalIdx), p.id);
        if (detour) {
          plan.path = detour;
          plan.pathIdx = 0;
        }
      }
    }
    if (c.follow) {
      const t = w.person(c.targetId!);
      return reachedTarget || cheb(p, t) <= (c.reach ?? 1);
    }
    return w.map.idx(p.x, p.y) === plan.goal && !plan.queued;
  }

  private async resolve(p: Person, plan: Plan): Promise<void> {
    const w = this.world;
    const c = plan.cand;
    const def = actionDef(c.kind);
    const responses: ResolveCtx["responses"] = [];
    let firstOptions: CandidateAction[] | null = null;
    if (def.respond) {
      const r = def.respond(p, c, w);
      const list = r === null ? [] : Array.isArray(r) ? r : [r];
      for (const one of list) {
        const responder = w.maybePerson(one.responderId);
        if (!responder || !w.isActive(responder.id) || one.options.length === 0) continue;
        const index = (await this.decideFor(responder, one.options, "respond")).index;
        responses.push({ responderId: responder.id, index, option: one.options[index]! });
        if (!firstOptions) firstOptions = one.options;
      }
    }
    const events: ResolveCtx["events"] = [];
    const ctx: ResolveCtx = {
      rng: w.rng.get("actions"),
      response: responses[0]?.index ?? null,
      responseOptions: firstOptions,
      responses,
      success: true,
      events,
      emit(type, actors, data) {
        const e = w.emit(type, actors, data);
        events.push(e);
        return e;
      },
    };
    def.resolve(p, c, w, ctx);
    if (p.plan === plan) {
      p.plan = null;
      if (c.kind === "sleep") p.asleep = false;
    }
    w.emit("action_resolved", p.alive && !p.exiled ? [p.id] : [], { person: p.id, kind: c.kind, key: c.key, success: ctx.success, events: events.length });
    if (p.alive && !p.exiled) pushRecent(p, w.tick, c.description, ctx.success);
  }

  private async executePlans(): Promise<void> {
    const w = this.world;
    for (const p of w.people) {
      if (!p.alive || p.exiled || !p.plan) continue;
      const plan = p.plan;
      if (plan.phase === "travel") {
        p.asleep = false;
        if (cannotWalk(p)) {
          this.failPlan(p, "cannot walk");
          continue;
        }
        const r = this.travel(p, plan);
        if (r === "fail") this.failPlan(p, "unreachable");
        else if (r) plan.phase = "perform";
        continue;
      }
      const def = actionDef(plan.cand.kind);
      plan.performed++;
      if (plan.cand.continuous) {
        def.tickEffect?.(p, plan.cand, w, plan.performed);
        if (p.plan === plan && (def.isDone?.(p, plan.cand, w, plan.performed) ?? true)) await this.resolve(p, plan);
      } else {
        plan.workLeft--;
        if (plan.workLeft <= 0) await this.resolve(p, plan);
      }
    }
  }

  /** Gives everyone who stands in the world a tile of their own (after births, growing up, or being moved). */
  private settleOccupancy(): void {
    const w = this.world;
    // Drop the carried first, then the carriers, so the result does not depend on who comes first in the list.
    for (const p of w.people) {
      if (p.carriedById !== null && (!p.alive || p.exiled || !w.isActive(p.carriedById) || w.person(p.carriedById).carryingId !== p.id)) {
        const by = p.carriedById;
        p.carriedById = null;
        if (p.alive && !p.exiled) w.emit("set_down", [p.id], { carrier: by, person: p.id, reason: "dropped", at: [p.x, p.y] });
      }
    }
    for (const p of w.people) {
      // A carrier who died, left or put them down no longer carries anyone.
      if (p.carryingId !== null && (!p.alive || p.exiled || w.maybePerson(p.carryingId)?.carriedById !== p.id)) p.carryingId = null;
    }
    for (const p of w.people) {
      if (!p.alive || p.exiled) continue;
      const carer = w.carriedBy(p);
      if (carer) {
        w.vacate(p);
        p.x = carer.x;
        p.y = carer.y;
        continue;
      }
      if (w.occupancy[w.map.idx(p.x, p.y)] === p.id) continue;
      const spot = w.freeTileNear(p, 10, p.id) ?? p;
      w.place(p, spot.x, spot.y);
    }
  }

  async step(): Promise<void> {
    const w = this.world;
    const due = this.pending.filter((x) => x.tick <= w.tick);
    this.pending = this.pending.filter((x) => x.tick > w.tick);
    for (const x of due) {
      const applied = { tick: w.tick, cmd: x.cmd };
      this.interventionLog.push(applied);
      applyIntervention(w, x.cmd);
    }
    w.trails.clear();
    this.settleOccupancy();
    // 1. Environment and seasonal production.
    updateEnvironment(w);
    updateProduction(w);
    updateTraces(w);
    // 2. Survival, wants, health and deaths; wounds heal or fester.
    updateNeeds(w);
    updateInjuries(w);
    cultureStep(w);
    if (w.env.minuteOfDay === 0) {
      for (const hh of w.households) assignBeds(w, hh.id);
      abandonStale(w);
    }
    // 3. Decisions for everyone without a plan.
    for (const p of w.people) {
      if (!p.alive || p.exiled || p.plan) continue;
      const cands = generateCandidates(w, p);
      if (cands.length === 0) continue;
      const { cand } = await this.decideFor(p, cands, "act");
      this.startPlan(p, cand);
    }
    // 4. Actions, in person id order, then animals.
    await this.executePlans();
    updateRiders(w);
    accidentStep(w);
    updateAnimals(w);
    // 5. Perception.
    runPerception(w);
    // 6. Bonding and romance.
    updateBonding(w);
    // 7. Investigation and justice scheduling, then plots, chases and feuds.
    justiceStep(w);
    plotStep(w);
    madnessStep(w);
    // 8. Invariants (after giving a tile to anyone set down this tick, such as an infant whose carrier died).
    this.settleOccupancy();
    if (w.config.checkInvariants) checkInvariants(w);
    // 9. Per-tick summary (events are appended to the log as they happen).
    w.emit("tick_summary", [], { ...envSummary(w.env), ...tickSummary(w) });
    w.tick++;
  }

  async runTicks(n: number): Promise<void> {
    for (let i = 0; i < n; i++) await this.step();
  }

  async runDays(days: number): Promise<void> {
    await this.runTicks(days * this.world.config.time.ticksPerDay);
  }
}

