// Plots are intentions that play out over time: a theft waiting for nightfall,
// a killing waiting for the victim to be alone, a raid waiting for the muster.
import { clamp01, feel, firstName, householdMembers } from "../entities/person.ts";
import { interruptPlan } from "../engine/plans.ts";
import type { HolderRef, Person, Plot, PlotKind, PlotStatus, RetributionSeverity } from "../world/types.ts";
import type { World } from "../world/world.ts";

/** A thief being chased by someone who caught them in the act. */
export interface Chase {
  chaserId: number;
  thiefId: number;
  victim: HolderRef;
  crimeId: number | null;
  startTick: number;
}

export function activePlots(w: World, p: Person, kind?: PlotKind): Plot[] {
  return w.plots.filter((pl) => pl.status === "planning" && (kind === undefined || pl.kind === kind) && (pl.plannerId === p.id || pl.participants.includes(p.id)));
}

export function formPlot(
  w: World,
  planner: Person,
  kind: PlotKind,
  fields: { targetPersonId?: number; targetHouseholdId?: number; targetHolder?: HolderRef; motive: string; participants?: number[]; scheduledTick?: number; severity?: RetributionSeverity },
): Plot {
  const plot: Plot = {
    id: w.nextId("plot"),
    kind,
    plannerId: planner.id,
    householdId: planner.householdId,
    targetPersonId: fields.targetPersonId ?? null,
    targetHouseholdId: fields.targetHouseholdId ?? null,
    targetHolder: fields.targetHolder ?? null,
    participants: fields.participants ?? [planner.id],
    struck: [],
    sightings: [],
    severity: fields.severity ?? null,
    motive: fields.motive,
    status: "planning",
    createdTick: w.tick,
    expiresTick: w.tick + w.days((w.config.plots.maxDays as Record<PlotKind, number>)[kind]),
    scheduledTick: fields.scheduledTick ?? null,
    outcome: null,
  };
  w.plots.push(plot);
  w.emit("plot_formed", plot.participants.filter((id) => w.isActive(id)), {
    plot: plot.id,
    kind,
    planner: planner.id,
    target: plot.targetPersonId,
    targetHousehold: plot.targetHouseholdId,
    targetHolder: plot.targetHolder,
    participants: plot.participants,
    motive: plot.motive,
    scheduled: plot.scheduledTick,
    severity: plot.severity,
  });
  return plot;
}

export function endPlot(w: World, plot: Plot, status: Exclude<PlotStatus, "planning">, outcome: string): void {
  if (plot.status !== "planning") return;
  plot.status = status;
  plot.outcome = outcome;
  w.emit(`plot_${status}`, plot.participants.filter((id) => w.isActive(id)), { plot: plot.id, kind: plot.kind, planner: plot.plannerId, target: plot.targetPersonId, targetHousehold: plot.targetHouseholdId, outcome });
  if (status === "abandoned") {
    const planner = w.maybePerson(plot.plannerId);
    if (planner && w.isActive(planner.id)) planner.cooldowns[`plot:${plot.kind}`] = w.tick + w.days(w.config.plots.abandonCooldownDays);
  }
}

/** True if nobody but the plotter is near the target and the target is out in the open. */
export function isIsolated(w: World, target: Person, plotter: Person): boolean {
  const b = w.buildingOf(target);
  if (b && w.isInside(target, b)) return false;
  const r = w.config.plots.isolationRadius;
  for (const o of w.people) {
    if (!o.alive || o.exiled || o.id === target.id || o.id === plotter.id || w.isCarried(o)) continue;
    if (Math.max(Math.abs(o.x - target.x), Math.abs(o.y - target.y)) <= r) return false;
  }
  return true;
}

/** How much a person resents another, and why. */
export function grudgeToward(w: World, p: Person, t: Person): { grudge: number; motive: string } {
  const trust = p.relationships[t.id]?.trust ?? 0;
  const grievance = p.grievances[t.id];
  let grudge = 0;
  let motive = "";
  if (grievance && trust < -0.2) {
    grudge = Math.min(1, -trust + 0.2);
    motive = grievance.reason === "verdict" ? "revenge" : "grudge";
  } else if (trust <= -0.35) {
    grudge = -trust;
    motive = "grudge";
  }
  if (p.rivalId === t.id && p.emotions.jealousy > 0.5) {
    const j = p.emotions.jealousy * 0.8;
    if (j > grudge) {
      grudge = j;
      motive = "jealousy";
    }
  }
  return { grudge, motive };
}

/** Total weight of acquittals a person resents. */
export function injusticeTotal(p: Person): number {
  let total = 0;
  for (const key of Object.keys(p.injustice)) total += p.injustice[Number(key)]!;
  return total;
}

/** How hard injustice drives a person against one target, in [0, 2.5]. */
export function retributionDrive(w: World, p: Person, t: Person): number {
  const own = p.injustice[t.id] ?? 0;
  if (own <= 0) return 0;
  return Math.min(2.5, (injusticeTotal(p) / w.config.retribution.acquittalsToAct) * (0.5 + 0.5 * Math.min(1, own)));
}

export function nextTickAtHour(w: World, hour: number): number {
  const cfg = w.config.time;
  for (let t = w.tick + 1; t < w.tick + cfg.ticksPerDay * 2; t++) {
    if ((cfg.startHour * 60 + t * cfg.minutesPerTick) % 1440 === hour * 60) return t;
  }
  return w.tick + 1;
}

/**
 * Engine rule run each tick: plots expire or lose their target, raiders are
 * woken for the muster, chases run out of breath, and feuds cool slowly.
 */
export function plotStep(w: World): void {
  for (const plot of w.plots) {
    if (plot.status !== "planning") continue;
    if (!w.isActive(plot.plannerId) && plot.kind !== "raid") {
      endPlot(w, plot, "abandoned", "planner gone");
      continue;
    }
    if (plot.targetPersonId !== null && !w.isActive(plot.targetPersonId)) {
      endPlot(w, plot, "abandoned", "target gone");
      continue;
    }
    if (plot.kind === "raid" && plot.scheduledTick !== null) {
      if (w.tick === plot.scheduledTick) {
        const raiders = plot.participants.filter((id) => w.isActive(id));
        if (raiders.length < 2) {
          endPlot(w, plot, "abandoned", "too few came to the muster");
          continue;
        }
        for (const id of raiders) interruptPlan(w, w.person(id), "raid muster");
        w.emit("raid_mustered", raiders, { plot: plot.id, raiders, targetHousehold: plot.targetHouseholdId });
      }
      if (w.tick > plot.scheduledTick + 18) {
        const done = plot.struck.length > 0 ? "executed" : "abandoned";
        endPlot(w, plot, done, plot.outcome ?? "the raiders never reached the compound");
      }
      continue;
    }
    if (w.tick >= plot.expiresTick) endPlot(w, plot, "abandoned", "lost their nerve");
  }

  for (const chase of w.chases.slice()) {
    const chaser = w.maybePerson(chase.chaserId);
    const done = !chaser || !w.isActive(chaser.id) || !w.isActive(chase.thiefId) || w.tick - chase.startTick > w.config.chase.maxTicks;
    if (!done) continue;
    w.chases.splice(w.chases.indexOf(chase), 1);
    if (chaser && w.isActive(chaser.id) && w.isActive(chase.thiefId)) {
      if (chaser.plan?.cand.kind === "chase") interruptPlan(w, chaser, "lost the trail");
      delete chaser.cooldowns[`chase:${chase.thiefId}`];
      w.emit("escaped", [chase.thiefId], { thief: chase.thiefId, chaser: chaser.id });
      feel(w, chaser, "angry", `${firstName(w.person(chase.thiefId))} got away`, 0.4);
      feel(w, w.person(chase.thiefId), "relieved", `outran ${firstName(chaser)}`, 0.4);
    }
  }

  if (w.env.minuteOfDay === 0) {
    // Resentment of the council's verdicts fades, slowly.
    for (const p of w.people) {
      for (const key of Object.keys(p.injustice)) {
        const id = Number(key);
        const v = Math.round((p.injustice[id]! - w.config.retribution.decayPerDay) * 1000) / 1000;
        if (v <= 0 || !w.isActive(id)) delete p.injustice[id];
        else p.injustice[id] = v;
      }
    }
    const decay = w.config.feud.decayPerDay;
    for (const row of w.feuds) for (let j = 0; j < row.length; j++) row[j] = Math.round(clamp01(row[j]! - decay) * 1000) / 1000;
  }
}

export function houseAdults(w: World, householdId: number): Person[] {
  return householdMembers(w, householdId).filter((p) => {
    const age = w.ageYears(p);
    return age >= 16 && age <= 58 && p.survival.health > 0.5;
  });
}
