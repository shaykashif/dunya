// Looking after the hurt, and the crafts and duties of a village: rescuing
// someone who cannot walk, carrying them home or to the infirmary, nursing
// them, carving crutches, mending stonework, carving headstones, keeping watch.
import { cannotWalk, legImpairment, needsCrutch, untendedWounds } from "../entities/body.ts";
import { careSkill, needsRescue, noteAnimal, pickUp, setDown, treat } from "../entities/injuries.ts";
import { cheb, clamp01, feel, firstName, isKin } from "../entities/person.ts";
import { sightRange } from "../perception/detection.ts";
import { bestFood, consume, foodUnits, transfer } from "../world/items.ts";
import type { Building, HolderRef, Person, Point } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { atHome, cand, homeDest, isDetained, isNight, onCooldown, travelTicks } from "./helpers.ts";
import type { ActionDef, CandidateAction } from "./types.ts";

/** Able to go and help someone: old enough, free, on their own two feet. */
function canHelp(w: World, p: Person): boolean {
  return w.ageYears(p) >= 12 && !isDetained(w, p) && p.carryingId === null && p.carriedById === null && !cannotWalk(p);
}

function bondOf(p: Person, id: number): number {
  return p.relationships[id]?.bond ?? 0;
}

/** The worst untended or festering wound, in [0, 1]. */
function gravity(p: Person): number {
  let g = 0;
  for (const i of p.injuries) if (!i.permanent) g = Math.max(g, i.severity * (i.kind === "fracture" || i.infected ? 1.2 : 1) * (1 - i.care));
  return Math.min(1, g);
}

/** Going to someone who cried out or was seen lying hurt. */
export const rescue: ActionDef = {
  id: "rescue",
  name: "Rescue",
  candidates(p, w) {
    if (!canHelp(w, p)) return [];
    const out: CandidateAction[] = [];
    for (const key of Object.keys(p.cooldowns)) {
      if (!key.startsWith("aid:") || !onCooldown(w, p, key)) continue;
      const v = w.maybePerson(Number(key.slice(4)));
      if (!v || !w.isActive(v.id) || !needsRescue(w, v)) continue;
      const kin = isKin(p, v) || v.householdId === p.householdId;
      const bond = bondOf(p, v.id);
      out.push(
        cand("rescue", `rescue:${v.id}`, `help ${v.name}, who cannot walk`, {
          targetId: v.id,
          dest: { x: v.x, y: v.y },
          follow: true,
          duration: 1,
          travel: travelTicks(w, p, v),
          risk: isNight(w) ? 0.2 : 0.05,
          effects: { duty: 0.6 + (kin ? 0.7 : 0) + bond * 0.4, relation: 0.3 + bond * 0.5, status: 0.1 },
        }),
      );
    }
    return out.slice(0, 2);
  },
  resolve(p, c, w, ctx) {
    delete p.cooldowns[`aid:${c.targetId}`];
    const v = w.maybePerson(c.targetId);
    if (!v || !w.isActive(v.id) || cheb(p, v) > 1 || !needsRescue(w, v) || p.carryingId !== null) {
      ctx.success = false;
      return ctx.events;
    }
    // A quick dressing on the spot, then up onto their back.
    treat(w, p, v, ctx.rng, "where they fell");
    pickUp(w, p, v);
    for (const o of w.people) delete o.cooldowns[`aid:${v.id}`];
    return ctx.events;
  },
};

function infirmary(w: World): Building {
  return w.hall();
}

/** Someone who can dress wounds well, close by: a healer if one is near, else the carrier. */
function bestCarer(w: World, carrier: Person, at: Point): Person {
  let best = carrier;
  for (const o of w.active()) {
    if (o.id === carrier.id || o.carriedById !== null || cannotWalk(o) || cheb(o, at) > 10 || w.ageYears(o) < 14) continue;
    if (careSkill(w, o) > careSkill(w, best)) best = o;
  }
  return best;
}

/** Carrying the injured home, or to the infirmary in the courthouse. */
export const carry: ActionDef = {
  id: "carry",
  name: "Carry",
  candidates(p, w) {
    const v = w.maybePerson(p.carryingId);
    if (!v || v.carriedById !== p.id) return [];
    const home = w.house(v.householdId);
    const hall = infirmary(w);
    const g = gravity(v);
    return [
      cand("carry", `carry:home:${v.id}`, `carry ${v.name} home`, {
        targetId: v.id,
        dest: { ...home.hearthSpot },
        duration: 1,
        travel: travelTicks(w, p, home.hearthSpot),
        option: "home",
        effects: { duty: 1.2, relation: 0.3 },
      }),
      cand("carry", `carry:town:${v.id}`, `carry ${v.name} to the infirmary in town`, {
        targetId: v.id,
        dest: { ...hall.hearthSpot },
        duration: 1,
        travel: travelTicks(w, p, hall.hearthSpot),
        option: "town",
        effects: { duty: 0.85 + 0.7 * g, relation: 0.3 },
      }),
    ];
  },
  resolve(p, c, w, ctx) {
    const b = c.option === "town" ? infirmary(w) : w.house(w.maybePerson(c.targetId)?.householdId ?? p.householdId);
    if (!w.isInside(p, b)) {
      ctx.success = false;
      return ctx.events;
    }
    const v = setDown(w, p, c.option === "town" ? "infirmary" : "home", (x, y) => w.isInside({ x, y }, b));
    if (!v) {
      ctx.success = false;
      return ctx.events;
    }
    ctx.emit("carried_to", [p.id], { carrier: p.id, person: v.id, place: c.option, building: b.id });
    const carer = bestCarer(w, p, v);
    treat(w, carer, v, ctx.rng, c.option === "town" ? "the infirmary" : "home");
    feel(w, v, "grateful", `${firstName(p)} carried them ${c.option === "town" ? "to the infirmary" : "home"}`, 0.7);
    feel(w, p, "proud", `carried ${firstName(v)} to safety`, 0.4);
    return ctx.events;
  },
};

/** What a hurt person needs from a nurse right now. */
function careNeeded(w: World, nurse: Person, v: Person): boolean {
  if (v.carriedById !== null || needsRescue(w, v)) return false;
  if (untendedWounds(v).length > 0) return true;
  if (nurse.task === "healer" && v.injuries.some((i) => !i.permanent && i.severity >= 0.25 && i.care < careSkill(w, nurse) - 0.05)) return true;
  return cannotWalk(v) && (v.survival.water < 0.6 || v.survival.food < 0.5);
}

/** Nursing the hurt: dressing wounds, setting bones, bringing water and food to the bedridden. */
export const tendWounded: ActionDef = {
  id: "tend_wounded",
  name: "Tend wounded",
  candidates(p, w) {
    if (!canHelp(w, p) || w.ageYears(p) < 14) return [];
    const healer = p.task === "healer";
    const out: CandidateAction[] = [];
    for (const v of w.people) {
      if (v.id === p.id || v.injuries.length === 0 || !v.alive || v.exiled) continue;
      const family = isKin(p, v) || v.householdId === p.householdId;
      if (!healer && !family) continue;
      if (cheb(p, v) > (healer ? 80 : 60) || onCooldown(w, p, `nursed:${v.id}`) || !careNeeded(w, p, v)) continue;
      const bond = bondOf(p, v.id);
      out.push(
        cand("tend_wounded", `tend_wounded:${v.id}`, `tend to ${v.name}'s wounds`, {
          targetId: v.id,
          dest: { x: v.x, y: v.y },
          follow: true,
          duration: 3,
          travel: travelTicks(w, p, v),
          effects: { duty: (healer ? 0.6 : 0) + (family ? 0.5 : 0) + gravity(v) * 0.6, relation: 0.2 + bond * 0.3, status: healer ? 0.05 : 0 },
        }),
      );
    }
    out.sort((a, b) => (b.effects.duty ?? 0) - (a.effects.duty ?? 0) || a.targetId! - b.targetId!);
    return out.slice(0, 2);
  },
  resolve(p, c, w, ctx) {
    const v = w.maybePerson(c.targetId);
    p.cooldowns[`nursed:${c.targetId}`] = w.tick + 18;
    if (!v || !w.isActive(v.id) || cheb(p, v) > 1) {
      ctx.success = false;
      return ctx.events;
    }
    treat(w, p, v, ctx.rng, "bedside");
    if (cannotWalk(v)) {
      // The bedridden cannot fetch their own water or food.
      if (v.survival.water < 0.9) v.survival.water = 0.9;
      if (v.survival.food < 0.6 && foodUnits(v.inventory) === 0) {
        const from: HolderRef | null = foodUnits(p.inventory) > 0 ? { t: "person", id: p.id } : foodUnits(w.households[v.householdId]!.store) > 0 ? { t: "household", id: v.householdId } : null;
        const kind = from ? bestFood(from.t === "person" ? p.inventory : w.households[v.householdId]!.store) : null;
        if (from && kind) transfer(w, from, { t: "person", id: v.id }, kind, 1, "nursing", [p.id]);
      }
      v.wants.companionship = clamp01(v.wants.companionship + 0.2);
    }
    ctx.emit("nursed", [p.id, v.id], { nurse: p.id, person: v.id });
    return ctx.events;
  },
};

/** Carpentry: carving a crutch for someone with a bad leg. */
export const craft: ActionDef = {
  id: "craft",
  name: "Craft",
  candidates(p, w) {
    if (!canHelp(w, p) || w.ageYears(p) < 14) return [];
    const wood = p.inventory.wood + w.households[p.householdId]!.store.wood;
    if (wood < 1) return [];
    const carpenter = p.task === "carpenter";
    const out: CandidateAction[] = [];
    for (const v of w.active()) {
      if (!needsCrutch(v) || onCooldown(w, p, `craft:${v.id}`)) continue;
      const family = v.householdId === p.householdId;
      if (!carpenter && !family) continue;
      const dest = homeDest(w, p);
      out.push(
        cand("craft", `craft:crutch:${v.id}`, `carve a crutch for ${v.name}`, {
          targetId: v.id,
          dest,
          duration: 6,
          travel: travelTicks(w, p, dest),
          effects: { duty: (carpenter ? 0.4 : 0) + (family ? 0.4 : 0) + legImpairment(v).worst * 0.5, relation: 0.2 },
        }),
      );
    }
    return out.slice(0, 1);
  },
  resolve(p, c, w, ctx) {
    p.cooldowns[`craft:${c.targetId}`] = w.tick + 12;
    const v = w.maybePerson(c.targetId);
    if (!v || !w.isActive(v.id) || !needsCrutch(v) || !atHome(w, p)) {
      ctx.success = false;
      return ctx.events;
    }
    const used = consume(w, { t: "person", id: p.id }, "wood", 1, "crutch", [p.id]) || consume(w, { t: "household", id: p.householdId }, "wood", 1, "crutch", [p.id]);
    if (!used) {
      ctx.success = false;
      return ctx.events;
    }
    v.crutch = true;
    ctx.emit("crutch_made", [p.id], { by: p.id, for: v.id });
    if (v.id !== p.id) feel(w, v, "grateful", `${firstName(p)} carved them a crutch`, 0.5);
    feel(w, p, "proud", `carved a crutch for ${firstName(v)}`, 0.3);
    return ctx.events;
  },
};

/** Stonework: mending the courthouse and the store, and carving headstones for the dead. */
export const masonry: ActionDef = {
  id: "masonry",
  name: "Masonry",
  candidates(p, w) {
    if (p.task !== "stonemason" || !canHelp(w, p) || isNight(w)) return [];
    const out: CandidateAction[] = [];
    for (const b of [w.hall(), w.store()]) {
      if (b.condition >= 0.85) continue;
      out.push(
        cand("masonry", `masonry:${b.id}`, `mend the stonework of the ${b.kind === "hall" ? "courthouse" : "communal store"}`, {
          buildingId: b.id,
          dest: { ...b.hearthSpot },
          duration: 6,
          travel: travelTicks(w, p, b.hearthSpot),
          effects: { provision: (0.95 - b.condition) * 0.8, status: 0.05 },
        }),
      );
    }
    const grave = w.graves.find((g) => !g.marked);
    if (grave) {
      const dead = w.maybePerson(grave.personId);
      out.push(
        cand("masonry", `masonry:grave:${grave.personId}`, `carve a headstone for ${dead?.name ?? "the dead"}`, {
          targetId: grave.personId,
          dest: { x: grave.x, y: grave.y },
          reach: 3,
          duration: 8,
          travel: travelTicks(w, p, grave),
          effects: { duty: 0.2, relation: 0.1 + (dead ? bondOf(p, dead.id) * 0.4 : 0) },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    if (c.buildingId !== undefined) {
      const b = w.buildings[c.buildingId]!;
      b.condition = clamp01(b.condition + 0.2);
      ctx.emit("masonry", [p.id], { by: p.id, building: b.id, kind: b.kind, condition: Math.round(b.condition * 1000) / 1000 });
      return ctx.events;
    }
    const grave = w.graves.find((g) => g.personId === c.targetId && !g.marked);
    if (!grave) {
      ctx.success = false;
      return ctx.events;
    }
    grave.marked = true;
    const dead = w.maybePerson(grave.personId);
    ctx.emit("headstone_carved", [p.id], { by: p.id, person: grave.personId });
    if (dead) {
      for (const o of w.active()) {
        const r = o.relationships[dead.id];
        if (r && (r.kin || r.bond > 0.5) && o.id !== p.id) feel(w, o, "comforted", `${firstName(p)} carved a headstone for ${firstName(dead)}`, 0.3);
      }
    }
    return ctx.events;
  },
};

/** A road tile near a point, scanning outward in a fixed order. */
function roadNear(w: World, at: Point): Point {
  for (let r = 0; r <= 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = at.x + dx, y = at.y + dy;
        if (w.map.inBounds(x, y) && w.map.at(x, y) === "path") return { x, y };
      }
    }
  }
  return at;
}

/** The evening watch: walking the road to town, finding the fallen and scaring off wolves. */
export const patrol: ActionDef = {
  id: "patrol",
  name: "Patrol",
  candidates(p, w) {
    const h = w.env.hour;
    if (p.task !== "watchman" || !canHelp(w, p) || h < 17 || h >= 23.5 || onCooldown(w, p, "patrolled")) return [];
    const gate = w.compound(p.householdId).gate;
    const sq = w.map.square;
    const f = 0.25 + 0.25 * ((Math.floor(w.tick / 9) + p.id) % 3);
    const dest = roadNear(w, { x: Math.round(gate.x + (sq.x - gate.x) * f), y: Math.round(gate.y + (sq.y - gate.y) * f) });
    return [
      cand("patrol", "patrol", "walk the evening watch along the road", {
        dest,
        reach: 3,
        duration: 3,
        travel: travelTicks(w, p, dest),
        risk: 0.15,
        effects: { duty: 0.3, security: 0.2, status: 0.05 },
      }),
    ];
  },
  resolve(p, _c, w, ctx) {
    p.cooldowns["patrolled"] = w.tick + 9;
    const range = sightRange(w, p) * 1.2;
    let found = 0;
    for (const v of w.people) {
      if (!needsRescue(w, v) || cheb(v, p) > range || !w.map.lineOfSight(p.x, p.y, v.x, v.y)) continue;
      p.cooldowns[`aid:${v.id}`] = w.tick + 18;
      found++;
      ctx.emit("found_injured", [p.id], { finder: p.id, person: v.id, at: [v.x, v.y] });
    }
    let scared = 0;
    for (const a of w.animals) {
      if (!a.alive || a.kind !== "wolf" || cheb(a, p) > 8) continue;
      a.fearUntil = w.tick + 12;
      a.state = "flee";
      a.target = null;
      noteAnimal(w, a, `was chased off by ${firstName(p)} on watch`);
      scared++;
    }
    ctx.emit("patrolled", [p.id], { by: p.id, found, scared });
    return ctx.events;
  },
};
