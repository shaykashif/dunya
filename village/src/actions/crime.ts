import { adjustBond, adjustTrust, cheb, clamp01, feel, firstName, isKin, rel, sizeClassOfAge, strengthOf } from "../entities/person.ts";
import { interruptPlan } from "../engine/plans.ts";
import type { Rng } from "../engine/rng.ts";
import { detectionProbability, perceiveIdentity, sightRange, witnessAction } from "../perception/detection.ts";
import { activePlots, endPlot } from "../plots/plots.ts";
import { defenseOptions, fight, recordCrime, selfKnowledge, type DefenseChoice } from "./fight.ts";
import { startChase, strikeCandidates, theftTarget } from "./intrigue.ts";
import { rampageCandidates } from "./madness.ts";
import { bestFood, foodUnits, holderInv, transfer } from "../world/items.ts";
import { createTrace } from "../world/traces.ts";
import type { Building, Crime, EntityRef, Person, Point } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { cand, desperation, isDetained, nearbyPeople, travelTicks } from "./helpers.ts";
import type { ActionDef, CandidateAction } from "./types.ts";

/** Footprints on soft ground; wet weather makes them more likely. */
function maybeFootprint(w: World, actor: Person, at: Point, crime: Crime, rng: Rng): void {
  const cfg = w.config.traces;
  const t = w.map.at(at.x, at.y);
  if (t === "wall" || t === "water" || t === "path") return;
  const wet = w.env.weather === "rain" || w.env.weather === "storm" || w.env.weather === "snow";
  if (!rng.chance(cfg.footprintChance + (wet ? cfg.footprintWetBonus : 0))) return;
  const trace = createTrace(w, "footprint", at, [{ kind: "person", id: actor.id }], { size: sizeClassOfAge(w.ageYears(actor)) }, crime.id);
  crime.traceIds.push(trace.id);
}

/** Estimated chance of being seen, from what the actor can see right now. */
function estimateRisk(w: World, p: Person, dest: Point, occupiedBuilding: boolean): number {
  const range = sightRange(w, p);
  let watchers = 0;
  for (const o of w.active()) {
    if (o.id === p.id || o.asleep) continue;
    if (cheb(o, dest) > 6 || cheb(o, p) > range) continue;
    if (!w.map.lineOfSight(p.x, p.y, o.x, o.y)) continue;
    watchers++;
  }
  return clamp01(0.08 + 0.5 * w.env.light + 0.12 * watchers + (occupiedBuilding ? 0.15 : 0));
}

function insideOf(w: World, b: Building): Point {
  return { ...b.hearthSpot };
}

export const steal: ActionDef = {
  id: "steal",
  name: "Steal",
  candidates(p, w) {
    if (w.ageYears(p) < 10 || isDetained(w, p)) return [];
    const out: CandidateAction[] = [];
    // Stores, houses and farms are robbed only as part of a plan, after dark unless desperate.
    const dark = w.env.light < w.config.light.nightThreshold;
    const desperate = desperation(w, p) > 0.7;
    for (const pl of activePlots(w, p, "theft")) {
      if (!dark && !desperate) continue;
      const h = pl.targetHolder!;
      if (foodUnits(holderInv(w, h)) <= 0) continue;
      const t = theftTarget(w, h);
      const qty = 2 + Math.round(p.personality.greed * 2);
      const building = t.buildingId === null ? null : w.buildings[t.buildingId]!;
      let risk = estimateRisk(w, p, t.dest, h.t === "household");
      if (h.t === "communal") risk = clamp01(risk + w.storeWatch * w.config.communal.watchCatch);
      out.push(
        cand("steal", `steal:plot:${pl.id}`, `steal from ${t.label}`, {
          plotId: pl.id,
          buildingId: building?.id,
          householdId: h.t === "household" || h.t === "farm" ? h.id : undefined,
          dest: t.dest,
          reach: building ? undefined : 3,
          duration: 2,
          travel: travelTicks(w, p, t.dest),
          risk,
          norm: true,
          qty,
          source: h,
          effects: { food: Math.min(qty * 0.25, 1 - p.survival.food) * (1 - risk), greed: 0.3 + qty * 0.05, duty: 0.3 },
        }),
      );
    }
    for (const t of nearbyPeople(w, p, 3)) {
      if (isKin(p, t) || foodUnits(t.inventory) === 0) continue;
      const risk = clamp01(estimateRisk(w, p, t, false) + (t.asleep ? 0 : 0.3 * t.personality.vigilance));
      out.push(
        cand("steal", `steal:person:${t.id}`, `pick ${t.name}'s pocket`, {
          targetId: t.id,
          dest: { x: t.x, y: t.y },
          follow: true,
          duration: 1,
          risk,
          norm: true,
          qty: 1,
          source: { t: "person", id: t.id },
          effects: { food: Math.min(0.25, 1 - p.survival.food) * (1 - risk), greed: 0.2 },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const rng = ctx.rng;
    const src = c.source!;
    let building: Building | null = null;
    let owners: Person[] = [];
    if (src.t === "person") {
      const t = w.maybePerson(src.id);
      if (!t || !w.isActive(t.id) || cheb(p, t) > 2) {
        ctx.success = false;
        return ctx.events;
      }
      owners = [t];
    } else if (src.t === "farm") {
      if (w.map.farmOf[w.map.idx(p.x, p.y)] !== src.id && cheb(p, theftTarget(w, src).dest) > 4) {
        ctx.success = false;
        return ctx.events;
      }
      owners = w.active().filter((o) => o.householdId === src.id);
    } else {
      building = w.buildings[c.buildingId!]!;
      if (!w.isInside(p, building)) {
        ctx.success = false;
        return ctx.events;
      }
      if (src.t === "household") owners = w.active().filter((o) => o.householdId === src.id && w.isInside(o, building!));
    }
    const pl = c.plotId !== undefined ? w.plots.find((x) => x.id === c.plotId) ?? null : null;
    const victimRef: EntityRef = { kind: "holder", holder: src };
    const place = { x: p.x, y: p.y };

    // The owner noticing, or the store watch, stops the theft.
    let noticer: Person | null = null;
    let caughtByWatch = false;
    if (src.t === "communal" && w.storeWatch > 0) {
      const watcher = w.maybePerson(w.elderId);
      const guard = watcher && w.isActive(watcher.id) && watcher.id !== p.id ? watcher : w.active().find((o) => o.isHead && o.householdId !== p.householdId) ?? null;
      if (guard && rng.chance(w.storeWatch * w.config.communal.watchCatch)) {
        noticer = guard;
        caughtByWatch = true;
      }
    }
    for (const o of owners) {
      if (noticer) break;
      const pNotice = src.t === "person" ? clamp01((0.25 + 0.6 * o.personality.vigilance) * (o.asleep ? 0.15 : 1) * (0.5 + 0.5 * w.env.light)) : detectionProbability(w, o, p, 1.2);
      if (rng.chance(pNotice)) {
        noticer = o;
        break;
      }
    }

    if (noticer) {
      const ev = ctx.emit("theft_failed", [p.id], { thief: p.id, victim: src, noticedBy: noticer.id, watch: caughtByWatch });
      const crime = recordCrime(w, "attempted_theft", p.id, src, place, ev.seq, 0);
      const ident = caughtByWatch ? { subject: { kind: "person" as const, id: p.id }, confidence: 0.9 } : perceiveIdentity(w, noticer, p, rng);
      const wev = ctx.emit("action_witnessed", [noticer.id], { observer: noticer.id, perceived: ident.subject, predicate: "attempted_theft", at: [p.x, p.y], p: 1 });
      w.pendingObservations.push({
        observerId: noticer.id,
        eventSeq: wev.seq,
        crimeId: crime.id,
        belief: { subject: ident.subject, predicate: "attempted_theft", object: victimRef, time: w.tick, confidence: ident.confidence, source: "saw", place },
      });
      if (noticer.asleep) interruptPlan(w, noticer, "disturbed");
      noticer.wants.security = clamp01(noticer.wants.security - 0.2);
      if (ident.subject.kind === "person") {
        adjustTrust(noticer, ident.subject.id, -0.4, w.tick);
        adjustBond(noticer, ident.subject.id, -0.1, w.tick);
        rel(noticer, ident.subject.id, w.tick).negative += 0.2;
      }
      maybeFootprint(w, p, building ? building.door : place, crime, rng);
      witnessAction(w, p, rng, { predicate: "attempted_theft", object: victimRef, crimeId: crime.id, exclude: [noticer.id] });
      selfKnowledge(w, p, "attempted_theft", victimRef, place, ev.seq, crime.id);
      p.emotions.guilt = clamp01(p.emotions.guilt + 0.1 * (p.personality.honesty + 0.2));
      if (pl) endPlot(w, pl, "foiled", `${firstName(noticer)} caught ${firstName(p)} in the act`);
      feel(w, noticer, "angry", `caught ${ident.subject.kind === "person" ? firstName(w.person(ident.subject.id)) : "a thief"} stealing`, 0.5);
      feel(w, p, "afraid", `${firstName(noticer)} caught them stealing`, 0.6);
      if (!noticer.asleep) startChase(w, noticer, p, src, crime.id);
      ctx.success = false;
      return ctx.events;
    }

    const inv = holderInv(w, src);
    const ev = ctx.emit("theft", [p.id], { thief: p.id, victim: src, wanted: c.qty });
    const crime = recordCrime(w, foodUnits(inv) > 0 ? "theft" : "attempted_theft", p.id, src, place, ev.seq, 0);
    let taken = 0;
    let item = "";
    for (let i = 0; i < (c.qty ?? 1); i++) {
      const kind = bestFood(inv);
      if (!kind) break;
      taken += transfer(w, src, { t: "person", id: p.id }, kind, 1, "stolen", [p.id]);
      item = item || kind;
    }
    crime.qty = taken;
    if (taken > 0) {
      const t = createTrace(w, "item_missing", building ? insideOf(w, building) : place, [{ kind: "holder", holder: src }], { holder: src, item, qty: taken }, crime.id);
      crime.traceIds.push(t.id);
    }
    maybeFootprint(w, p, building ? building.door : place, crime, rng);
    if (rng.chance(w.config.traces.objectLeftChance)) {
      const dropKind = p.inventory.cloth > 0 ? "cloth" : p.inventory.tool > 0 ? "tool" : null;
      if (dropKind) {
        transfer(w, { t: "person", id: p.id }, { t: "tile", x: p.x, y: p.y }, dropKind, 1, "dropped", [p.id]);
        const t = createTrace(w, "object_left", place, [{ kind: "person", id: p.id }], { item: dropKind, ownerId: p.id }, crime.id);
        crime.traceIds.push(t.id);
      }
    }
    const seen = witnessAction(w, p, rng, { predicate: "took", object: victimRef, crimeId: crime.id });
    // An owner who sees it happen gives chase.
    const ownerHouse = src.t === "household" || src.t === "farm" ? src.id : src.t === "person" ? w.person(src.id).householdId : -1;
    const chaser = seen.map((id) => w.person(id)).find((o) => o.householdId === ownerHouse && !o.asleep);
    if (chaser && taken > 0) startChase(w, chaser, p, src, crime.id);
    if (pl) endPlot(w, pl, "executed", `${firstName(p)} took ${taken} food from ${src.t === "person" ? firstName(w.person(src.id)) : theftTarget(w, src).label}`);
    if (taken > 0) feel(w, p, p.personality.honesty > 0.5 ? "guilty" : "relieved", `stole food from ${src.t === "person" ? firstName(w.person(src.id)) : theftTarget(w, src).label}`, 0.4);
    selfKnowledge(w, p, "took", victimRef, place, ev.seq, crime.id);
    p.emotions.guilt = clamp01(p.emotions.guilt + 0.15 * (p.personality.honesty + 0.2));
    if (src.t === "person") {
      const t = w.person(src.id);
      rel(t, p.id, w.tick).negative += 0.1;
    }
    ctx.success = taken > 0;
    return ctx.events;
  },
};

interface AttackMotive {
  target: Person;
  grudge: number;
  robbery: boolean;
  motive: string;
}

function attackMotives(w: World, p: Person): AttackMotive[] {
  const range = Math.min(8, sightRange(w, p));
  const out: AttackMotive[] = [];
  for (const t of w.active()) {
    if (t.id === p.id || cheb(p, t) > range) continue;
    if (!w.map.lineOfSight(p.x, p.y, t.x, t.y)) continue;
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
    const robbery = p.survival.food < 0.12 && !isKin(p, t) && foodUnits(t.inventory) > 0;
    if (robbery && !motive) motive = "robbery";
    if (!motive) continue;
    out.push({ target: t, grudge, robbery, motive });
  }
  out.sort((a, b) => b.grudge - a.grudge || a.target.id - b.target.id);
  return out.slice(0, 3);
}

export const attack: ActionDef = {
  id: "attack",
  name: "Attack",
  candidates(p, w) {
    if (w.ageYears(p) < 14 || isDetained(w, p)) return [];
    const out = attackMotives(w, p)
      .filter((m) => m.grudge < w.config.plots.murderGrudge || m.robbery)
      .map((m) => {
        const sA = strengthOf(w, p), sB = strengthOf(w, m.target);
        return cand("attack", `attack:${m.target.id}`, `attack ${m.target.name} (${m.motive})`, {
          targetId: m.target.id,
          dest: { x: m.target.x, y: m.target.y },
          follow: true,
          duration: 1,
          risk: clamp01(0.5 + 0.3 * (sB / (sA + sB))),
          norm: true,
          motive: m.motive,
          effects: { grudge: m.grudge, food: m.robbery ? Math.min(0.5, 1 - p.survival.food) * 0.6 : 0 },
        });
      });
    return out.concat(strikeCandidates(w, p), rampageCandidates(w, p));
  },
  respond(p, c, w) {
    const t = w.maybePerson(c.targetId);
    if (!t || !w.isActive(t.id)) return null;
    return { responderId: t.id, options: defenseOptions(w, t, p, c.option === "lethal") };
  },
  resolve(p, c, w, ctx) {
    const t = w.maybePerson(c.targetId);
    if (!t || !w.isActive(t.id) || cheb(p, t) > (c.reach ?? 1)) {
      ctx.success = false;
      return ctx.events;
    }
    const choice = (ctx.responses[0]?.option.option ?? "fight") as DefenseChoice;
    const maim = c.option === "maim";
    const pl = c.plotId !== undefined ? w.plots.find((x) => x.id === c.plotId) ?? null : null;
    // Killing someone you planned to kill, in cold blood, is first-degree murder.
    const premeditated = !!pl && (pl.kind === "murder" || (pl.kind === "retribution" && pl.severity === "kill"));
    const r = fight(w, p, t, choice, { lethal: c.option === "lethal", maim, motive: c.motive ?? "unknown", robbery: c.motive === "robbery", premeditated }, ctx);
    if (pl) {
      const crippled = maim && !r.defenderFled && !r.attackerDied && t.injuries.some((i) => i.byId === p.id && i.tick === w.tick && i.severity >= 0.45);
      const outcome = r.defenderDied
        ? `${firstName(p)} killed ${firstName(t)}`
        : r.attackerDied
          ? `${firstName(t)} killed ${firstName(p)} in self-defence`
          : r.defenderFled
            ? `${firstName(t)} escaped ${firstName(p)}`
            : crippled
              ? `${firstName(p)} left ${firstName(t)} badly hurt`
              : `${firstName(t)} survived ${firstName(p)}'s attack`;
      const done = r.defenderDied || crippled;
      endPlot(w, pl, done ? "executed" : "foiled", outcome);
      if (pl.kind === "retribution" && done && p.alive) {
        delete p.injustice[t.id];
        feel(w, p, "vindicated", `${firstName(t)} has paid at last`, 0.6);
      }
    }
    return ctx.events;
  },
};
