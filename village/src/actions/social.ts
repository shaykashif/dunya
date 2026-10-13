import { activeObligations, createObligation, fulfillObligation } from "../entities/obligations.ts";
import { satisfy, sharpestClash } from "../entities/culture.ts";
import type { Value } from "../world/types.ts";

const VALUE_TOPIC: Record<Value, string> = {
  law: "the law", family: "family", tradition: "the old ways", craftsmanship: "good work", hard_work: "hard work", leisure: "idleness",
  martial: "fighting", peace: "keeping the peace", nature: "the forest", fairness: "what is fair", cooperation: "helping others",
  romance: "love", truth: "honesty", merriment: "merrymaking", piety: "the gods",
};
import { adjustBond, adjustTrust, cheb, clamp01, feel, firstName, isKin, rel } from "../entities/person.ts";
import { CRIME_PREDICATES } from "../perception/beliefs.ts";
import { addBelief } from "../perception/store.ts";
import { testify } from "../perception/testimony.ts";
import { bestFood, foodUnits, foodValue, transfer } from "../world/items.ts";
import type { HolderRef, Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { atHome, cand, nearbyPeople, onCooldown, setCooldown } from "./helpers.ts";
import type { ActionDef, CandidateAction } from "./types.ts";

/** Sum of obligation strengths the holder owes to the target. */
function dutyToward(w: World, holder: Person, targetId: number): { duty: number; ids: number[] } {
  let duty = 0;
  const ids: number[] = [];
  for (const o of activeObligations(w, holder.id)) {
    if (o.owed_to !== targetId) continue;
    duty += o.strength;
    ids.push(o.id);
  }
  return { duty, ids };
}

/** Where a person would give food from: carried first, then their home store if inside it. */
function giveSource(w: World, giver: Person, allowHome: boolean): HolderRef | null {
  if (foodUnits(giver.inventory) > 0) return { t: "person", id: giver.id };
  if (allowHome && foodUnits(w.households[giver.householdId]!.store) > 0) return { t: "household", id: giver.householdId };
  return null;
}

export const give: ActionDef = {
  id: "give",
  name: "Give",
  candidates(p, w) {
    if (w.ageYears(p) < 6) return [];
    const out: CandidateAction[] = [];
    for (const t of nearbyPeople(w, p, 2)) {
      const need = 1 - t.survival.food;
      const { duty, ids } = dutyToward(w, p, t.id);
      if (t.survival.food > 0.6 && duty === 0) continue;
      if (t.survival.food > 0.85 || foodUnits(t.inventory) > 0) continue;
      // Household members at home feed themselves from the store; only infants are handed food from it.
      const infant = w.ageYears(t) < w.config.needs.infantAge;
      if (!infant && t.householdId === p.householdId && atHome(w, t) && foodUnits(w.households[t.householdId]!.store) > 0) continue;
      const src = giveSource(w, p, infant && atHome(w, p) && t.householdId === p.householdId);
      if (!src) continue;
      const kind = bestFood(src.t === "person" ? p.inventory : w.households[p.householdId]!.store)!;
      const ownCost = src.t === "person" && foodUnits(p.inventory) <= 1 ? -foodValue(w, kind) * 0.5 : 0;
      out.push(
        cand("give", `give:${t.id}`, `give ${kind} to ${t.name}`, {
          targetId: t.id,
          dest: { x: t.x, y: t.y },
          follow: true,
          duration: 1,
          item: kind,
          source: src,
          obligationIds: ids,
          effects: {
            relation: 0.05 + need * 0.2,
            duty: duty * need,
            provision: isKin(p, t) ? need * 0.2 : 0,
            food: ownCost,
            greed: -0.5,
          },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const t = w.maybePerson(c.targetId);
    if (!t || !w.isActive(t.id) || cheb(p, t) > 2) {
      ctx.success = false;
      return ctx.events;
    }
    const src = c.source!;
    if (src.t === "household" && !atHome(w, p)) {
      ctx.success = false;
      return ctx.events;
    }
    const n = transfer(w, src, { t: "person", id: t.id }, c.item!, 1, "gift", [p.id, t.id]);
    if (n === 0) {
      ctx.success = false;
      return ctx.events;
    }
    adjustBond(t, p.id, 0.05, w.tick);
    adjustTrust(t, p.id, 0.03, w.tick);
    if (t.survival.food < 0.4) {
      rel(t, p.id, w.tick).shared += 0.05;
      rel(p, t.id, w.tick).shared += 0.05;
    }
    for (const o of activeObligations(w, p.id)) {
      if (o.owed_to !== t.id) continue;
      if (o.kind === "debt") {
        o.amount -= n;
        if (o.amount <= 0) fulfillObligation(w, o, "repaid");
      }
    }
    if (t.survival.food < 0.4) feel(w, t, "grateful", `${firstName(p)} gave them food when they were hungry`, 0.5);
    ctx.emit("gave", [p.id, t.id], { giver: p.id, recipient: t.id, kind: c.item, qty: n, obligations: c.obligationIds ?? [] });
    return ctx.events;
  },
};

export const requestFood: ActionDef = {
  id: "request_food",
  name: "Request food",
  candidates(p, w) {
    if (p.survival.food > 0.55 || w.ageYears(p) < 5) return [];
    // Begging is for when there is nothing to eat at hand or at home.
    if (foodUnits(p.inventory) > 0 || foodUnits(w.households[p.householdId]!.store) > 0) return [];
    const targets = nearbyPeople(w, p, 10)
      .filter((t) => w.ageYears(t) >= 14 && !t.asleep && t.householdId !== p.householdId)
      .filter((t) => !onCooldown(w, p, `request_food:${t.id}`))
      .sort((a, b) => (p.relationships[b.id]?.bond ?? 0) - (p.relationships[a.id]?.bond ?? 0) || a.id - b.id)
      .slice(0, 3);
    return targets.map((t) => {
      const bond = p.relationships[t.id]?.bond ?? 0;
      const expect = 0.2 + 0.5 * bond;
      return cand("request_food", `request_food:${t.id}`, `ask ${t.name} for food`, {
        targetId: t.id,
        dest: { x: t.x, y: t.y },
        follow: true,
        duration: 1,
        travel: Math.ceil(cheb(p, t) / 4),
        effects: { food: Math.min(0.25, 1 - p.survival.food) * expect, relation: 0.01, status: -0.05 },
      });
    });
  },
  respond(p, c, w) {
    const t = w.maybePerson(c.targetId);
    if (!t || !w.isActive(t.id)) return null;
    const src = giveSource(w, t, true);
    const refuse = cand("respond", "respond:refuse", "refuse", { dest: null, duration: 0, option: "refuse", effects: {} });
    if (!src) return { responderId: t.id, options: [refuse] };
    const inv = src.t === "person" ? t.inventory : w.households[t.householdId]!.store;
    const kind = bestFood(inv)!;
    const bond = t.relationships[p.id]?.bond ?? 0;
    const { duty } = dutyToward(w, t, p.id);
    const homeStock = foodUnits(w.households[t.householdId]!.store);
    const scarcity = 1 / (1 + homeStock / 8);
    const need = 1 - p.survival.food;
    const accept = cand("respond", "respond:accept", "share food", {
      dest: null,
      duration: 0,
      option: "accept",
      source: src,
      item: kind,
      effects: {
        relation: (0.05 + need * 0.25) * (0.5 + bond),
        duty: duty * need,
        food: src.t === "person" && foodUnits(t.inventory) <= 1 ? -foodValue(w, kind) : 0,
        provision: -0.4 * scarcity,
        greed: -0.6,
      },
    });
    return { responderId: t.id, options: [accept, refuse] };
  },
  resolve(p, c, w, ctx) {
    const t = w.maybePerson(c.targetId);
    if (!t || !w.isActive(t.id) || cheb(p, t) > 2) {
      ctx.success = false;
      return ctx.events;
    }
    const option = ctx.responseOptions && ctx.response !== null ? ctx.responseOptions[ctx.response] : null;
    setCooldown(w, p, `request_food:${t.id}`, w.config.time.ticksPerDay / 2);
    const ev = ctx.emit("food_requested", [p.id, t.id], { requester: p.id, asked: t.id, answer: option?.option ?? "refuse" });
    addBelief(w, t, {
      subject: { kind: "person", id: p.id },
      predicate: "hungry",
      time: w.tick,
      confidence: 0.8,
      source: "saw",
      place: { x: p.x, y: p.y },
    }, ev.seq);
    if (option && option.option === "accept" && option.source) {
      const bond = t.relationships[p.id]?.bond ?? 0;
      const qty = bond > 0.5 ? 2 : 1;
      let given = 0;
      const inv = option.source.t === "person" ? t.inventory : w.households[t.householdId]!.store;
      for (let i = 0; i < qty; i++) {
        const kind = bestFood(inv);
        if (!kind) break;
        given += transfer(w, option.source, { t: "person", id: p.id }, kind, 1, "shared", [t.id, p.id]);
      }
      if (given > 0) {
        adjustBond(p, t.id, 0.06, w.tick);
        adjustTrust(p, t.id, 0.05, w.tick);
        rel(p, t.id, w.tick).shared += 0.05;
        if (!isKin(p, t)) createObligation(w, p.id, t.id, "debt", 0.4, w.tick + w.days(w.config.obligations.debtDueDays), given);
        ctx.emit("request_accepted", [t.id, p.id], { giver: t.id, recipient: p.id, qty: given });
        feel(w, p, "grateful", `${firstName(t)} shared food with them`, 0.5);
        return ctx.events;
      }
    }
    ctx.success = false;
    setCooldown(w, p, `request_food:${t.id}`, w.config.time.ticksPerDay);
    adjustTrust(p, t.id, -0.03, w.tick);
    adjustBond(p, t.id, -0.02, w.tick);
    ctx.emit("request_refused", [t.id, p.id], { refuser: t.id, requester: p.id });
    feel(w, p, p.survival.food < 0.2 ? "desperate" : "hurt", `${firstName(t)} refused to share food`, 0.4);
    return ctx.events;
  },
};

function gossipFilter(w: World) {
  const recent = w.tick - w.days(5);
  return (b: { predicate: string; confidence: number; time: number }) =>
    b.confidence >= 0.4 && b.time >= recent && (CRIME_PREDICATES.includes(b.predicate) || b.predicate === "hungry" || b.predicate === "trace_found" || b.predicate === "seen_bloody" || b.predicate === "washing_blood");
}

export const socialize: ActionDef = {
  id: "socialize",
  name: "Socialize",
  candidates(p, w) {
    if (w.ageYears(p) < 3 || w.env.hour < 7 || w.env.hour > 21) return [];
    const lonely = 1 - p.wants.companionship;
    const out: CandidateAction[] = [];
    const others = nearbyPeople(w, p, 6)
      .filter((o) => !o.asleep)
      .sort((a, b) => (p.relationships[b.id]?.bond ?? 0) - (p.relationships[a.id]?.bond ?? 0) || a.id - b.id)
      .slice(0, 3);
    for (const o of others) {
      const r = p.relationships[o.id];
      const romantic = r && (r.stage === "courting" || r.stage === "pair_bonded") ? 0.3 : (r?.attraction ?? 0) * 0.15;
      out.push(
        cand("socialize", `socialize:${o.id}`, `spend time with ${o.name}`, {
          targetId: o.id,
          dest: { x: o.x, y: o.y },
          follow: true,
          duration: 4,
          effects: { companionship: 0.6, relation: 0.03, affection: romantic },
        }),
      );
    }
    const meet = { ...w.map.meeting };
    if (cheb(p, meet) > 2) {
      out.push(
        cand("socialize", "socialize:meeting", "go to the meeting place", {
          dest: meet,
          duration: 4,
          travel: Math.ceil(cheb(p, meet) / 4),
          effects: { companionship: 0.35 * (lonely > 0.3 ? 1 : 0.5) },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    let t = w.maybePerson(c.targetId);
    if (!t) {
      t = nearbyPeople(w, p, 3)
        .filter((o) => !o.asleep)
        .sort((a, b) => (p.relationships[b.id]?.bond ?? 0) - (p.relationships[a.id]?.bond ?? 0) || a.id - b.id)[0] ?? null;
    }
    const wasLonely = p.wants.companionship < 0.3;
    p.wants.companionship = clamp01(p.wants.companionship + (t ? 0.3 : 0.08));
    if (!t || !w.isActive(t.id) || cheb(p, t) > 3) {
      ctx.success = !!c.dest && !c.targetId;
      return ctx.events;
    }
    const warmth = 0.03 * (0.5 + (p.personality.empathy + t.personality.empathy) / 2);
    adjustBond(p, t.id, warmth, w.tick);
    adjustBond(t, p.id, warmth, w.tick);
    adjustTrust(p, t.id, 0.01, w.tick);
    adjustTrust(t, p.id, 0.01, w.tick);
    rel(p, t.id, w.tick).together += 4;
    rel(t, p.id, w.tick).together += 4;
    t.wants.companionship = clamp01(t.wants.companionship + 0.2);
    ctx.emit("socialized", [p.id, t.id], { a: p.id, b: t.id });
    satisfy(p, "leisure", 0.2);
    satisfy(t, "leisure", 0.15);
    // People whose values clash sometimes end up arguing.
    const clash = sharpestClash(p, t);
    if (clash && ctx.rng.chance(w.config.culture.argueChance)) {
      adjustTrust(p, t.id, -0.06, w.tick);
      adjustTrust(t, p.id, -0.06, w.tick);
      adjustBond(p, t.id, -warmth * 2, w.tick);
      adjustBond(t, p.id, -warmth * 2, w.tick);
      ctx.emit("argument", [p.id, t.id], { a: p.id, b: t.id, over: clash });
      feel(w, p, "annoyed", `argued with ${firstName(t)} about ${VALUE_TOPIC[clash]}`, 0.25);
      feel(w, t, "annoyed", `argued with ${firstName(p)} about ${VALUE_TOPIC[clash]}`, 0.25);
    }
    if (wasLonely) feel(w, p, "happy", `spent time with ${firstName(t)} after being lonely`, 0.3);
    const filter = gossipFilter(w);
    testify(w, p, t, { context: "gossip", filter, maxClaims: 1 });
    testify(w, t, p, { context: "gossip", filter, maxClaims: 1 });
    return ctx.events;
  },
};

export const comfort: ActionDef = {
  id: "comfort",
  name: "Comfort",
  candidates(p, w) {
    if (w.ageYears(p) < 8) return [];
    const out: CandidateAction[] = [];
    for (const t of nearbyPeople(w, p, 4)) {
      const sorrow = Math.max(t.emotions.grief, t.emotions.distress - 0.2);
      if (sorrow < 0.3) continue;
      const bond = p.relationships[t.id]?.bond ?? 0;
      if (bond < 0.2 || onCooldown(w, p, `comfort:${t.id}`)) continue;
      out.push(
        cand("comfort", `comfort:${t.id}`, `comfort ${t.name}`, {
          targetId: t.id,
          dest: { x: t.x, y: t.y },
          follow: true,
          duration: 3,
          effects: { relation: 0.08 + sorrow * 0.3 * bond, companionship: 0.2, duty: isKin(p, t) ? 0.2 * sorrow : 0 },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const t = w.maybePerson(c.targetId);
    if (!t || !w.isActive(t.id) || cheb(p, t) > 2) {
      ctx.success = false;
      return ctx.events;
    }
    setCooldown(w, p, `comfort:${t.id}`, w.config.time.ticksPerDay / 2);
    t.emotions.grief = clamp01(t.emotions.grief - 0.15);
    t.emotions.distress = clamp01(t.emotions.distress - 0.1);
    const bond = t.relationships[p.id]?.bond ?? 0;
    if (bond > 0) {
      adjustBond(t, p.id, 0.05, w.tick);
      t.wants.affection = clamp01(t.wants.affection + 0.1);
    }
    rel(t, p.id, w.tick).shared += 0.05;
    rel(p, t.id, w.tick).shared += 0.05;
    p.wants.companionship = clamp01(p.wants.companionship + 0.15);
    ctx.emit("comforted", [p.id, t.id], { by: p.id, whom: t.id });
    feel(w, t, "comforted", `${firstName(p)} sat with them in their sorrow`, 0.4);
    return ctx.events;
  },
};
