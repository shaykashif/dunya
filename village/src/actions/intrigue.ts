// Plots, stalking, raids, fleeing and chasing.
import { adjustTrust, cheb, clamp01, feel, firstName, isKin, speedOf, strengthOf } from "../entities/person.ts";
import { findMatchingCase, openCase } from "../investigation/cases.ts";
import { fileAccusation } from "../justice/justice.ts";
import { perceiveIdentity, sightRange, witnessAction } from "../perception/detection.ts";
import { addBelief } from "../perception/store.ts";
import { activePlots, endPlot, formPlot, grudgeToward, houseAdults, injusticeTotal, isIsolated, nextTickAtHour, retributionDrive } from "../plots/plots.ts";
import { bestFood, foodUnits, holderInv, transfer } from "../world/items.ts";
import type { EntityRef, HolderRef, Person, Plot, RetributionSeverity } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { defenseOptions, fight, recordCrime, selfKnowledge, type DefenseChoice } from "./fight.ts";
import { cand, desperation, isDetained, onCooldown, travelTicks } from "./helpers.ts";
import type { ActionDef, CandidateAction, Responder } from "./types.ts";

function farmDest(w: World, hid: number): { x: number; y: number } {
  const farm = w.compound(hid).farm;
  return { ...farm[Math.floor(farm.length / 2)]! };
}

/** Where a theft plot's target is, and how the thief would get there. */
export function theftTarget(w: World, holder: HolderRef): { dest: { x: number; y: number }; buildingId: number | null; label: string } {
  if (holder.t === "communal") {
    const s = w.store();
    return { dest: { ...s.hearthSpot }, buildingId: s.id, label: "the communal store" };
  }
  if (holder.t === "farm") return { dest: farmDest(w, holder.id), buildingId: null, label: `the ${w.households[holder.id]!.name} farm` };
  if (holder.t === "household") {
    const h = w.house(holder.id);
    return { dest: { ...h.hearthSpot }, buildingId: h.id, label: `the ${w.households[holder.id]!.name} house` };
  }
  throw new Error("unsupported theft target");
}

export const plot: ActionDef = {
  id: "plot",
  name: "Plot",
  candidates(p, w) {
    if (isDetained(w, p) || w.ageYears(p) < 12) return [];
    const out: CandidateAction[] = [];
    const pc = w.config.plots;

    // A theft, to be carried out after dark.
    const members = Math.max(1, w.active().filter((o) => o.householdId === p.householdId).length);
    const lean = foodUnits(w.households[p.householdId]!.store) / members < 3 || p.survival.food < 0.45;
    const greedy = p.personality.greed > 0.7 && p.personality.honesty < 0.35;
    const compelled = p.mad === "thief";
    if ((lean || greedy || compelled) && activePlots(w, p, "theft").length === 0 && !onCooldown(w, p, "plot:theft")) {
      const qty = 2 + Math.round(p.personality.greed * 2);
      const gain = Math.min(qty * 0.25, 1 - p.survival.food);
      const targets: HolderRef[] = [];
      for (const hh of w.households) {
        if (hh.id === p.householdId) continue;
        if (w.farms[hh.id]!.crop.grain > 0) targets.push({ t: "farm", id: hh.id });
        targets.push({ t: "household", id: hh.id });
      }
      if (foodUnits(w.communal) > 0) targets.push({ t: "communal" });
      const scored = targets.map((h) => {
        const feud = h.t === "farm" || h.t === "household" ? w.feud(p.householdId, h.id) : 0;
        const risk = h.t === "communal" ? 0.25 + w.storeWatch * w.config.communal.watchCatch : h.t === "farm" ? 0.2 : 0.35;
        return { h, risk, feud };
      });
      scored.sort((a, b) => a.risk - a.feud - (b.risk - b.feud));
      for (const { h, risk, feud } of scored.slice(0, 3)) {
        const t = theftTarget(w, h);
        out.push(
          cand("plot", `plot:theft:${h.t}${"id" in h ? `:${h.id}` : ""}`, `plan to steal from ${t.label}`, {
            dest: null,
            duration: 1,
            risk,
            norm: true,
            source: h,
            option: "theft",
            effects: { food: gain * 0.7, greed: 0.3 + qty * 0.05, grudge: feud * 0.3, frenzy: compelled ? 1 : 0 },
          }),
        );
      }
    }

    // A killing, to be done when the victim is alone.
    if (w.ageYears(p) >= 16 && activePlots(w, p, "murder").length === 0 && !onCooldown(w, p, "plot:murder")) {
      for (const t of w.active()) {
        if (t.id === p.id || isKin(p, t) || w.ageYears(t) < 12) continue;
        const { grudge, motive } = grudgeToward(w, p, t);
        if (grudge < pc.murderGrudge || !motive) continue;
        out.push(
          cand("plot", `plot:murder:${t.id}`, `plan to kill ${t.name} (${motive})`, {
            dest: null,
            duration: 1,
            targetId: t.id,
            risk: 0.3,
            norm: true,
            motive,
            option: "murder",
            effects: { grudge: grudge * 0.9 },
          }),
        );
      }
    }

    // Retribution: the council has let off, again and again, someone they are sure wronged them.
    const total = injusticeTotal(p);
    if (w.ageYears(p) >= 16 && total >= w.config.retribution.acquittalsToAct && activePlots(w, p, "retribution").length === 0 && !onCooldown(w, p, "plot:retribution")) {
      const g = Math.min(2.5, total / w.config.retribution.acquittalsToAct);
      const ranked = Object.keys(p.injustice)
        .map(Number)
        .filter((id) => w.isActive(id) && (p.injustice[id] ?? 0) > 0)
        .sort((a, b) => p.injustice[b]! - p.injustice[a]! || a - b);
      const t = w.maybePerson(ranked[0]);
      if (t) {
        // Threats are a lesser wrong than blood: they weigh on conscience less.
        const options: [RetributionSeverity, string, number, boolean, Record<string, number>][] = [
          ["intimidate", `confront and threaten ${t.name}, since the council will not punish them`, 0.15, false, { justice: 0.8 * g, grudge: 0.3 * g, security: 0.15, comfort: -0.1 }],
          ["maim", `make ${t.name} pay in blood: cripple them`, 0.35, true, { justice: 0.9 * g, grudge: 0.8 * g }],
          ["kill", `kill ${t.name}, since the council never will`, 0.5, true, { justice: 0.6 * g, grudge: 1.3 * g * (p.personality.empathy < 0.45 ? 1 : 0.5) }],
        ];
        for (const [severity, text, risk, norm, effects] of options) {
          out.push(cand("plot", `plot:retribution:${severity}:${t.id}`, `plan to ${text}`, { dest: null, duration: 1, targetId: t.id, risk, norm, motive: "retribution", option: `retribution:${severity}`, effects }));
        }
      }
    }

    // A raid on a rival house, organised by the head of the house.
    if (p.isHead && p.personality.boldness >= pc.raidMinBoldness && !onCooldown(w, p, "plot:raid") && !w.plots.some((pl) => pl.status === "planning" && pl.kind === "raid" && pl.householdId === p.householdId)) {
      for (const hh of w.households) {
        const feud = w.feud(p.householdId, hh.id);
        if (hh.id === p.householdId || feud < pc.raidFeud) continue;
        out.push(
          // A raid on a feuding house is a matter of family honour, not a private crime.
          cand("plot", `plot:raid:${hh.id}`, `plan a raid on the ${hh.name} house`, {
            dest: null,
            duration: 1,
            householdId: hh.id,
            risk: 0.35,
            option: "raid",
            motive: "feud",
            effects: { grudge: feud * 1.5, status: 0.2 },
          }),
        );
      }
    }
    return out;
  },
  respond(p, c, w) {
    if (c.option !== "raid") return null;
    const feud = w.feud(p.householdId, c.householdId!);
    const out: Responder[] = [];
    for (const m of houseAdults(w, p.householdId)) {
      if (m.id === p.id || isDetained(w, m)) continue;
      out.push({
        responderId: m.id,
        options: [
          cand("respond", "respond:join", "join the raid", {
            dest: null,
            duration: 0,
            option: "join",
            risk: 0.4,
            effects: { duty: 0.4 + feud * 0.6, grudge: feud * 0.6, status: 0.1, relation: (m.relationships[p.id]?.bond ?? 0) * 0.2 },
          }),
          cand("respond", "respond:decline", "stay home", { dest: null, duration: 0, option: "decline", effects: { security: 0.1 } }),
        ],
      });
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    if (c.option === "theft") {
      formPlot(w, p, "theft", { targetHolder: c.source!, targetHouseholdId: c.source!.t === "communal" ? undefined : (c.source as { id: number }).id, motive: desperation(w, p) > 0.3 ? "hunger" : "greed" });
    } else if (c.option === "murder") {
      formPlot(w, p, "murder", { targetPersonId: c.targetId!, motive: c.motive ?? "grudge" });
      feel(w, p, "resentful", `swore to settle things with ${firstName(w.person(c.targetId!))}`, 0.5);
    } else if (c.option?.startsWith("retribution:")) {
      const severity = c.option.slice(12) as RetributionSeverity;
      formPlot(w, p, "retribution", { targetPersonId: c.targetId!, motive: "retribution", severity });
      p.cooldowns["plot:retribution"] = w.tick + w.days(w.config.retribution.cooldownDays);
      feel(w, p, "vengeful", `the council let ${firstName(w.person(c.targetId!))} walk free, so they will see to it themselves`, 0.6);
    } else {
      const joined = ctx.responses.filter((r) => r.option.option === "join").map((r) => r.responderId);
      const participants = [p.id, ...joined];
      const target = c.householdId!;
      const pl = formPlot(w, p, "raid", { targetHouseholdId: target, motive: "feud", participants, scheduledTick: nextTickAtHour(w, w.config.plots.raidHour) });
      p.cooldowns["plot:raid"] = w.tick + w.days(w.config.plots.raidCooldownDays);
      if (participants.length < 3) endPlot(w, pl, "abandoned", "not enough of the house would join");
      for (const r of ctx.responses) if (r.option.option === "decline") feel(w, w.person(r.responderId), "worried", `${firstName(p)} is planning a raid`, 0.3);
    }
    return ctx.events;
  },
};

/** Plots that need the target alone: murders, and retribution meant to maim or kill. */
function stalkingPlots(w: World, p: Person): Plot[] {
  return activePlots(w, p).filter((pl) => pl.kind === "murder" || (pl.kind === "retribution" && pl.severity !== "intimidate"));
}

function driveFor(w: World, p: Person, pl: Plot, t: Person): number {
  return pl.kind === "retribution" ? retributionDrive(w, p, t) : grudgeToward(w, p, t).grudge;
}

/** Following a target at a distance until they are alone. */
export const stalk: ActionDef = {
  id: "stalk",
  name: "Stalk",
  candidates(p, w) {
    const out: CandidateAction[] = [];
    for (const pl of stalkingPlots(w, p)) {
      const t = w.maybePerson(pl.targetPersonId);
      if (!t || !w.isActive(t.id)) continue;
      const b = w.buildingOf(t);
      if (b && w.isInside(t, b)) continue;
      if (isIsolated(w, t, p) && cheb(p, t) <= sightRange(w, p)) continue;
      const grudge = driveFor(w, p, pl, t);
      out.push(
        cand("stalk", `stalk:${pl.id}`, `shadow ${t.name}`, {
          targetId: t.id,
          plotId: pl.id,
          dest: { x: t.x, y: t.y },
          follow: true,
          reach: 7,
          duration: 1,
          norm: true,
          effects: { grudge: grudge * 0.5 + 0.2, justice: pl.kind === "retribution" ? 0.5 : 0 },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const pl = w.plots.find((x) => x.id === c.plotId);
    const t = w.maybePerson(c.targetId);
    if (!pl || !t) return ctx.events;
    // Alone except for the stalker: worth remembering when and where.
    const loneHere = !w.active().some((o) => o.id !== t.id && o.id !== p.id && !w.isCarried(o) && cheb(o, t) <= w.config.plots.isolationRadius);
    const hour = Math.floor(w.env.hour);
    if (loneHere && !pl.sightings.some((s) => s.hour === hour && cheb(s, t) <= 6)) {
      pl.sightings.push({ hour, x: t.x, y: t.y });
      if (pl.sightings.length > 12) pl.sightings.shift();
      ctx.emit("plot_learned", [p.id], { plot: pl.id, stalker: p.id, target: t.id, hour, at: [t.x, t.y], task: t.task });
    }
    return ctx.events;
  },
};

/** Waiting where the victim is usually alone at this hour. */
export const lieInWait: ActionDef = {
  id: "lie_in_wait",
  name: "Lie in wait",
  candidates(p, w) {
    const out: CandidateAction[] = [];
    const hour = Math.floor(w.env.hour);
    for (const pl of stalkingPlots(w, p)) {
      const t = w.maybePerson(pl.targetPersonId);
      if (!t || !w.isActive(t.id) || cheb(p, t) <= sightRange(w, p)) continue;
      const spot = pl.sightings.find((s) => s.hour === hour || s.hour === (hour + 1) % 24);
      if (!spot) continue;
      const grudge = driveFor(w, p, pl, t);
      out.push(
        cand("lie_in_wait", `lie_in_wait:${pl.id}`, `wait for ${t.name} where they are usually alone`, {
          plotId: pl.id,
          targetId: t.id,
          dest: { x: spot.x, y: spot.y },
          reach: 6,
          duration: 3,
          travel: travelTicks(w, p, spot),
          norm: true,
          effects: { grudge: grudge * 0.7 + 0.2, justice: pl.kind === "retribution" ? 0.5 : 0 },
        }),
      );
    }
    return out;
  },
  resolve(_p, _c, _w, ctx) {
    return ctx.events;
  },
};

/** The strike itself: offered only when the target is alone and in sight. */
export function strikeCandidates(w: World, p: Person): CandidateAction[] {
  const out: CandidateAction[] = [];
  for (const pl of stalkingPlots(w, p)) {
    const t = w.maybePerson(pl.targetPersonId);
    if (!t || !w.isActive(t.id) || !isIsolated(w, t, p) || cheb(p, t) > sightRange(w, p)) continue;
    const grudge = driveFor(w, p, pl, t);
    const sA = strengthOf(w, p), sB = strengthOf(w, t);
    const maim = pl.kind === "retribution" && pl.severity === "maim";
    out.push(
      cand("attack", `attack:plot:${pl.id}`, maim ? `fall on ${t.name} to cripple them` : `ambush ${t.name}`, {
        targetId: t.id,
        plotId: pl.id,
        dest: { x: t.x, y: t.y },
        follow: true,
        reach: !maim && p.inventory.musket > 0 && !(p.cooldowns["reload"] !== undefined && w.tick < p.cooldowns["reload"]) ? w.config.muskets.range : 1,
        duration: 1,
        risk: clamp01(0.2 + 0.4 * (sB / (sA + sB)) - (p.inventory.musket > 0 ? 0.2 : 0)),
        norm: true,
        motive: pl.motive,
        option: maim ? "maim" : "lethal",
        effects: { grudge: grudge * 1.3 + 0.3, justice: pl.kind === "retribution" ? 0.8 : 0 },
      }),
    );
  }
  return out;
}

/** Retribution at its mildest: confronting the person face to face and threatening them. */
export const intimidate: ActionDef = {
  id: "intimidate",
  name: "Intimidate",
  candidates(p, w) {
    if (isDetained(w, p)) return [];
    const out: CandidateAction[] = [];
    for (const pl of activePlots(w, p, "retribution")) {
      if (pl.severity !== "intimidate") continue;
      const t = w.maybePerson(pl.targetPersonId);
      if (!t || !w.isActive(t.id) || w.isCarried(t)) continue;
      const home = w.house(t.householdId);
      if (w.isInside(t, home) || cheb(p, t) > 70) continue;
      out.push(
        cand("intimidate", `intimidate:${pl.id}`, `confront ${t.name} and threaten them`, {
          targetId: t.id,
          plotId: pl.id,
          dest: { x: t.x, y: t.y },
          follow: true,
          duration: 1,
          travel: travelTicks(w, p, t),
          risk: 0.2,
          motive: "retribution",
          effects: { justice: 0.8 + retributionDrive(w, p, t) * 0.3, grudge: retributionDrive(w, p, t) * 0.4 },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const t = w.maybePerson(c.targetId);
    const pl = w.plots.find((x) => x.id === c.plotId);
    if (!t || !w.isActive(t.id) || cheb(p, t) > 1 || !pl || pl.status !== "planning") {
      ctx.success = false;
      return ctx.events;
    }
    const place = { x: t.x, y: t.y };
    const victimRef: EntityRef = { kind: "person", id: t.id };
    const ev = ctx.emit("intimidation", [p.id, t.id], { by: p.id, target: t.id, at: [t.x, t.y], acquittals: Math.round((p.injustice[t.id] ?? 0) * 100) / 100 });
    const crime = recordCrime(w, "intimidation", p.id, { t: "person", id: t.id }, place, ev.seq, 0);
    witnessAction(w, p, ctx.rng, { predicate: "threatened", object: victimRef, crimeId: crime.id, exclude: [t.id] });
    selfKnowledge(w, p, "threatened", victimRef, place, ev.seq, crime.id);
    const ident = perceiveIdentity(w, t, p, ctx.rng);
    const vev = ctx.emit("action_witnessed", [t.id], { observer: t.id, perceived: ident.subject, predicate: "threatened", at: [p.x, p.y], p: 1 });
    w.pendingObservations.push({
      observerId: t.id,
      eventSeq: vev.seq,
      crimeId: crime.id,
      belief: { subject: ident.subject, predicate: "threatened", object: victimRef, time: w.tick, confidence: Math.max(0.8, ident.confidence), source: "saw", place },
    });
    t.wants.security = clamp01(t.wants.security - 0.4);
    adjustTrust(t, p.id, -0.5, w.tick);
    t.grievances[p.id] = { reason: "threatened", tick: w.tick };
    feel(w, t, "afraid", `${firstName(p)} threatened them over the council's verdict`, 0.7);
    // Half satisfied: if the council lets them off again, it may come to blood.
    p.injustice[t.id] = Math.round((p.injustice[t.id] ?? 0) * 50) / 100;
    feel(w, p, "vindicated", `made ${firstName(t)} afraid, as the council would not`, 0.4);
    endPlot(w, pl, "executed", `${firstName(p)} threatened ${firstName(t)}`);
    return ctx.events;
  },
};

function raidPlot(w: World, p: Person): Plot | null {
  return (
    w.plots.find((pl) => pl.status === "planning" && pl.kind === "raid" && pl.participants.includes(p.id) && pl.scheduledTick !== null && w.tick >= pl.scheduledTick && w.tick <= pl.scheduledTick + 18 && !pl.struck.includes(p.id)) ?? null
  );
}

export const raid: ActionDef = {
  id: "raid",
  name: "Raid",
  candidates(p, w) {
    const pl = raidPlot(w, p);
    if (!pl) return [];
    const target = w.house(pl.targetHouseholdId!);
    return [
      cand("raid", `raid:${pl.id}`, `raid the ${w.households[pl.targetHouseholdId!]!.name} house`, {
        plotId: pl.id,
        householdId: pl.targetHouseholdId!,
        dest: { ...target.door },
        reach: 4,
        duration: 1,
        travel: travelTicks(w, p, target.door),
        risk: 0.4,
        effects: { duty: 1.2, grudge: w.feud(p.householdId, pl.targetHouseholdId!) * 1.5 },
      }),
    ];
  },
  respond(p, c, w) {
    const defenders = houseAdults(w, c.householdId!)
      .filter((d) => cheb(d, p) <= 8)
      .sort((a, b) => cheb(a, p) - cheb(b, p) || a.id - b.id);
    const d = defenders[0];
    if (!d) return null;
    return { responderId: d.id, options: defenseOptions(w, d, p, false) };
  },
  resolve(p, c, w, ctx) {
    const pl = w.plots.find((x) => x.id === c.plotId);
    if (!pl || pl.status !== "planning") {
      ctx.success = false;
      return ctx.events;
    }
    const target = c.householdId!;
    // The whole compound wakes to the noise.
    for (const m of w.active()) {
      if (m.householdId !== target || cheb(m, p) > 15) continue;
      if (m.asleep) {
        m.plan = null;
        m.asleep = false;
      }
      feel(w, m, "afraid", `the ${w.households[p.householdId]!.name} house raided their home`, 0.7);
    }
    let loot = 0;
    let fought = "";
    const answer = ctx.responses[0];
    if (answer) {
      const defender = w.person(answer.responderId);
      const r = fight(w, p, defender, answer.option.option as DefenseChoice, { lethal: false, motive: "raid", raidPlotId: pl.id }, ctx);
      fought = r.defenderDied ? `killed ${firstName(defender)}` : r.attackerDied ? `was killed by ${firstName(defender)}` : `fought ${firstName(defender)}`;
      if (r.attackerDied || (answer.option.option === "fight" && !r.defenderDied && !r.defenderFled)) {
        pl.struck.push(p.id);
        pl.outcome = `${pl.outcome ?? ""}${firstName(p)} ${fought}. `;
        finishRaid(w, pl);
        return ctx.events;
      }
    }
    const store: HolderRef = { t: "household", id: target };
    for (let i = 0; i < 3; i++) {
      const kind = bestFood(holderInv(w, store));
      if (!kind) break;
      loot += transfer(w, store, { t: "person", id: p.id }, kind, 1, "raid_loot", [p.id]);
    }
    pl.struck.push(p.id);
    pl.outcome = `${pl.outcome ?? ""}${firstName(p)} ${fought ? fought + " and " : ""}took ${loot} food. `;
    ctx.emit("raid_strike", [p.id], { plot: pl.id, raider: p.id, household: target, loot, fought });
    w.addFeud(target, p.householdId, w.config.feud.raid / Math.max(1, pl.participants.length), "raided");
    finishRaid(w, pl);
    feel(w, p, "triumphant", `raided the ${w.households[target]!.name} house`, 0.4);
    return ctx.events;
  },
};

function finishRaid(w: World, pl: Plot): void {
  const remaining = pl.participants.filter((id) => w.isActive(id) && !pl.struck.includes(id));
  if (remaining.length > 0) return;
  endPlot(w, pl, "executed", (pl.outcome ?? "").trim());
  // Honour is satisfied, for now.
  w.addFeud(pl.householdId, pl.targetHouseholdId!, -w.config.feud.raidSatisfies, "raid carried out");
}

export const flee: ActionDef = {
  id: "flee",
  name: "Flee",
  candidates(p, w) {
    if (!onCooldown(w, p, "fleeing")) return [];
    const home = w.house(p.householdId);
    if (w.isInside(p, home)) return [];
    return [cand("flee", "flee", "run home", { dest: { ...home.hearthSpot }, duration: 1, travel: travelTicks(w, p, home.hearthSpot), effects: { security: 0.9, health: 0.3 } })];
  },
  resolve(p, _c, _w, ctx) {
    delete p.cooldowns["fleeing"];
    return ctx.events;
  },
};

/** Running after a thief caught in the act. Catching them brings them before the council. */
export const chase: ActionDef = {
  id: "chase",
  name: "Chase",
  candidates(p, w) {
    const out: CandidateAction[] = [];
    for (const ch of w.chases) {
      if (ch.chaserId !== p.id) continue;
      const t = w.maybePerson(ch.thiefId);
      if (!t || !w.isActive(t.id)) continue;
      const odds = speedOf(w, p) / (speedOf(w, p) + speedOf(w, t));
      out.push(
        cand("chase", `chase:${t.id}`, `chase ${t.name}`, {
          targetId: t.id,
          dest: { x: t.x, y: t.y },
          follow: true,
          duration: 1,
          risk: clamp01(0.5 - odds * 0.4),
          effects: { justice: 0.8, security: 0.4, status: 0.1 },
        }),
      );
    }
    return out;
  },
  respond(p, c, w) {
    const t = w.maybePerson(c.targetId);
    if (!t || !w.isActive(t.id)) return null;
    const opts = defenseOptions(w, t, p, false).filter((o) => o.option !== "flee");
    return { responderId: t.id, options: opts };
  },
  resolve(p, c, w, ctx) {
    const idx = w.chases.findIndex((x) => x.chaserId === p.id && x.thiefId === c.targetId);
    const ch = idx >= 0 ? w.chases[idx]! : null;
    const t = w.maybePerson(c.targetId);
    if (!ch || !t || !w.isActive(t.id) || cheb(p, t) > 1) {
      ctx.success = false;
      return ctx.events;
    }
    w.chases.splice(idx, 1);
    delete p.cooldowns[`chase:${t.id}`];
    const answer = ctx.responses[0]?.option.option ?? "yield";
    if (answer === "fight") {
      const r = fight(w, p, t, "fight", { lethal: false, motive: "apprehension", lawful: true }, ctx);
      if (r.attackerDied || (!r.defenderDied && t.survival.health > p.survival.health)) {
        ctx.success = false;
        t.cooldowns["fleeing"] = w.tick + 6;
        ctx.emit("escaped", [t.id], { thief: t.id, chaser: p.alive ? p.id : null, fought: true });
        return ctx.events;
      }
      if (r.defenderDied) return ctx.events;
    }
    // Caught: goods go back and the chaser takes them to the council.
    let returned = 0;
    for (let i = 0; i < 4; i++) {
      const kind = bestFood(t.inventory);
      if (!kind) break;
      returned += transfer(w, { t: "person", id: t.id }, ch.victim, kind, 1, "recovered", [p.id]);
    }
    const ev = ctx.emit("apprehended", [p.id, t.id], { chaser: p.id, thief: t.id, returned, resisted: answer === "fight" });
    adjustTrust(p, t.id, -0.3, w.tick);
    feel(w, p, "proud", `caught ${firstName(t)} stealing`, 0.5);
    feel(w, t, "ashamed", `${firstName(p)} caught them stealing`, 0.6);
    const belief = addBelief(w, p, {
      subject: { kind: "person", id: t.id },
      predicate: "took",
      object: { kind: "holder", holder: ch.victim },
      time: w.tick,
      confidence: 1,
      source: "saw",
      place: { x: t.x, y: t.y },
    }, ev.seq, ch.crimeId);
    const info = { kind: "theft" as const, victim: { kind: "holder" as const, holder: ch.victim }, place: { x: t.x, y: t.y }, timeFrom: ch.startTick - 6, timeTo: w.tick };
    const c2 = findMatchingCase(w, p, info) ?? openCase(w, p, info, belief);
    if (!c2.beliefIds.includes(belief.id)) c2.beliefIds.push(belief.id);
    c2.suspects = [{ personId: t.id, means: 1, motive: 0.5, opportunity: 1, score: 2.5 }];
    if (c2.status === "open") fileAccusation(w, p, t.id, c2);
    return ctx.events;
  },
};

/** Called when a thief is caught in the act: the person who noticed may give chase, and the thief runs. */
export function startChase(w: World, chaser: Person, thief: Person, victim: HolderRef, crimeId: number | null): void {
  if (w.chases.some((c) => c.thiefId === thief.id)) return;
  if (w.ageYears(chaser) < 12 || !w.isActive(chaser.id)) return;
  w.chases.push({ chaserId: chaser.id, thiefId: thief.id, victim, crimeId, startTick: w.tick });
  chaser.cooldowns[`chase:${thief.id}`] = w.tick + w.config.chase.maxTicks;
  thief.cooldowns["fleeing"] = w.tick + w.config.chase.maxTicks;
  if (chaser.plan) {
    chaser.plan = null;
    chaser.asleep = false;
  }
  w.emit("chase_started", [chaser.id, thief.id], { chaser: chaser.id, thief: thief.id, at: [thief.x, thief.y] });
}
