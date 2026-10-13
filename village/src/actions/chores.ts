// Household work tied to tasks, and answering screams and washing off blood.
import { noteAnimal, workAccident } from "../entities/injuries.ts";
import { cheb, clamp01, feel, firstName, householdMembers } from "../entities/person.ts";
import { witnessAction } from "../perception/detection.ts";
import { discoverTrace } from "../perception/perception.ts";
import { livestockOf, strikeWolf, wolvesNear } from "../world/animals.ts";
import { gunshot } from "../world/arms.ts";
import { foodUnits, produce, transfer } from "../world/items.ts";
import { FOOD_KINDS, type Point } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { cand, homeDest, isDetained, onCooldown, travelTicks } from "./helpers.ts";
import type { ActionDef, CandidateAction } from "./types.ts";

function pen(w: World, hid: number): Point {
  const c = w.compound(hid).center;
  return { x: c.x + 8, y: c.y + 5 };
}

/** Running to help someone who screamed, and driving off the wolf. */
export const defend: ActionDef = {
  id: "defend",
  name: "Defend",
  candidates(p, w) {
    const out: CandidateAction[] = [];
    for (const key of Object.keys(p.cooldowns)) {
      if (!key.startsWith("help:") || !onCooldown(w, p, key)) continue;
      const v = w.maybePerson(Number(key.slice(5)));
      if (!v || !w.isActive(v.id)) continue;
      const bond = p.relationships[v.id]?.bond ?? 0;
      out.push(
        cand("defend", `defend:${v.id}`, `run to help ${v.name}`, {
          targetId: v.id,
          dest: { x: v.x, y: v.y },
          follow: true,
          duration: 1,
          risk: 0.3,
          effects: { relation: 0.3 + bond * 0.5, duty: 0.4, security: 0.2 },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    delete p.cooldowns[`help:${c.targetId}`];
    const v = w.maybePerson(c.targetId);
    const wolf = v ? wolvesNear(w, v, 3)[0] : undefined;
    if (wolf) strikeWolf(w, p, wolf, ctx.rng);
    if (v && w.isActive(v.id)) feel(w, v, "grateful", `${firstName(p)} came when they screamed`, 0.5);
    return ctx.events;
  },
};

/** Going to see what a gunshot outside the forest was about. */
export const investigateShot: ActionDef = {
  id: "investigate",
  name: "Investigate",
  candidates(p, w) {
    const out: CandidateAction[] = [];
    for (const key of Object.keys(p.cooldowns)) {
      if (!key.startsWith("shot:") || !onCooldown(w, p, key)) continue;
      const [x, y] = key.slice(5).split(",").map(Number) as [number, number];
      out.push(
        cand("investigate", `investigate:${x},${y}`, "go see where the shot came from", {
          dest: { x, y },
          reach: 3,
          duration: 2,
          travel: travelTicks(w, p, { x, y }),
          risk: 0.2,
          effects: { justice: 0.5, security: 0.3 },
        }),
      );
    }
    return out.slice(0, 1);
  },
  resolve(p, c, w, ctx) {
    delete p.cooldowns[`shot:${c.dest!.x},${c.dest!.y}`];
    let found = 0;
    for (const t of w.traces.slice()) {
      if (t.kind === "sound" || p.knownTraces[t.id] || cheb(t.location, c.dest!) > 4) continue;
      if (!ctx.rng.chance(0.6 + 0.3 * p.personality.vigilance)) continue;
      discoverTrace(w, p, t, ctx.rng, "examined");
      found++;
    }
    ctx.emit("investigated_shot", [p.id], { at: [c.dest!.x, c.dest!.y], found });
    return ctx.events;
  },
};

export const tendAnimals: ActionDef = {
  id: "tend_animals",
  name: "Tend animals",
  candidates(p, w) {
    if (w.ageYears(p) < 10 || isDetained(w, p) || livestockOf(w, p.householdId).length === 0) return [];
    const since = w.tick - (w.livestockTended[p.householdId] ?? -Infinity);
    if (since < w.days(0.5)) return [];
    const dest = pen(w, p.householdId);
    return [cand("tend_animals", "tend_animals", "tend the family's animals", { dest, reach: 3, duration: 6, travel: travelTicks(w, p, dest), effects: { provision: Math.min(0.4, since / w.days(4)) } })];
  },
  resolve(p, _c, w, ctx) {
    w.livestockTended[p.householdId] = w.tick;
    for (const a of livestockOf(w, p.householdId)) {
      a.hunger = 0;
      noteAnimal(w, a, `was fed and tended by ${firstName(p)}`);
    }
    ctx.emit("animals_tended", [p.id], { household: p.householdId });
    return ctx.events;
  },
};

export const hunt: ActionDef = {
  id: "hunt",
  name: "Hunt",
  candidates(p, w) {
    if (w.ageYears(p) < 16 || isDetained(w, p)) return [];
    const c = w.compound(p.householdId).center;
    // Hunting grounds lie deeper in the forest, away from town.
    const dx = c.x - w.map.square.x, dy = c.y - w.map.square.y;
    const d = Math.hypot(dx, dy) || 1;
    const out = { x: Math.round(c.x + (dx / d) * 18), y: Math.round(c.y + (dy / d) * 18) };
    const dest = w.map.nearest("forest", { x: Math.max(1, Math.min(w.map.width - 2, out.x)), y: Math.max(1, Math.min(w.map.height - 2, out.y)) });
    const chance = w.config.animals.huntChance[w.env.season]! * (p.inventory.musket > 0 ? w.config.muskets.huntFactor : p.inventory.tool > 0 ? 1 : 0.6);
    const night = w.env.light < w.config.light.nightThreshold;
    return [
      cand("hunt", "hunt", "hunt in the deep forest", {
        dest,
        reach: 3,
        duration: 8,
        travel: travelTicks(w, p, dest),
        risk: night ? 0.5 : 0.1,
        effects: { food: Math.min(chance * 3 * 0.35, 1 - p.survival.food) * 0.6, provision: chance * 0.8 },
      }),
    ];
  },
  resolve(p, _c, w, ctx) {
    const cfg = w.config.animals;
    const chance = cfg.huntChance[w.env.season]! * (p.inventory.musket > 0 ? w.config.muskets.huntFactor : p.inventory.tool > 0 ? 1 : 0.6);
    if (p.inventory.musket > 0) gunshot(w, p, { x: p.x, y: p.y }, "hunting");
    workAccident(w, p, ctx.rng, "hunting");
    if (ctx.rng.chance(chance)) {
      const qty = cfg.huntYield[0] + ctx.rng.int(cfg.huntYield[1] - cfg.huntYield[0] + 1);
      produce(w, { t: "person", id: p.id }, "meat", qty, "hunted", [p.id]);
      ctx.emit("hunted", [p.id], { qty });
      feel(w, p, "proud", "brought down a deer", 0.4);
    } else {
      ctx.success = false;
      ctx.emit("hunted", [p.id], { qty: 0 });
    }
    return ctx.events;
  },
};

/** In hard times a house slaughters an animal for meat. */
export const slaughter: ActionDef = {
  id: "slaughter",
  name: "Slaughter",
  candidates(p, w) {
    if (w.ageYears(p) < 16 || isDetained(w, p) || !(p.isHead || p.task === "farmer" || p.task === "herder")) return [];
    const members = householdMembers(w, p.householdId).length;
    const stock = foodUnits(w.households[p.householdId]!.store);
    if (stock > members * 1.5) return [];
    const herd = livestockOf(w, p.householdId).filter((a) => a.kind !== "cow" || livestockOf(w, p.householdId, "cow").length > 1);
    if (herd.length === 0) return [];
    const scarcity = 1 - stock / (members * 1.5);
    const dest = pen(w, p.householdId);
    return [cand("slaughter", "slaughter", "slaughter an animal for meat", { dest, reach: 3, duration: 3, travel: travelTicks(w, p, dest), effects: { provision: 0.6 * scarcity, comfort: -0.05 } })];
  },
  resolve(p, _c, w, ctx) {
    const order = ["sheep", "chicken", "cow"] as const;
    const animal = order.map((k) => livestockOf(w, p.householdId, k)[0]).find((a) => a !== undefined);
    if (!animal) {
      ctx.success = false;
      return ctx.events;
    }
    animal.alive = false;
    noteAnimal(w, animal, `was slaughtered for meat by ${firstName(p)}`);
    const meat = w.config.animals.slaughterMeat[animal.kind as "sheep" | "cow" | "chicken"];
    produce(w, { t: "household", id: p.householdId }, "meat", meat, "slaughtered", [p.id]);
    ctx.emit("slaughtered", [p.id], { animal: animal.id, kind: animal.kind, meat });
    return ctx.events;
  },
};

/** Minding the young: staying with them, and feeding the hungry ones from the store. */
export const tendChildren: ActionDef = {
  id: "tend_children",
  name: "Tend children",
  candidates(p, w) {
    if (w.ageYears(p) < 14 || isDetained(w, p) || onCooldown(w, p, "tended_children")) return [];
    const kids = householdMembers(w, p.householdId).filter((k) => w.ageYears(k) < 8 && !w.isCarried(k));
    if (kids.length === 0) return [];
    const hungry = kids.filter((k) => k.survival.food < 0.5).length;
    const dest = homeDest(w, p);
    return [
      cand("tend_children", "tend_children", "look after the children", {
        dest,
        duration: 6,
        travel: travelTicks(w, p, dest),
        effects: { provision: 0.15 + hungry * 0.1, companionship: 0.2, comfort: 0.05 },
      }),
    ];
  },
  resolve(p, _c, w, ctx) {
    const store = { t: "household" as const, id: p.householdId };
    let fed = 0;
    for (const k of householdMembers(w, p.householdId)) {
      if (w.ageYears(k) >= 8 || w.isCarried(k)) continue;
      k.wants.companionship = clamp01(k.wants.companionship + 0.2);
      k.wants.security = clamp01(k.wants.security + 0.1);
      if (k.survival.food < 0.5 && foodUnits(k.inventory) === 0) {
        const kind = FOOD_KINDS.find((f) => w.households[p.householdId]!.store[f] > 0);
        if (kind) fed += transfer(w, store, { t: "person", id: k.id }, kind, 1, "fed_child", [p.id]);
      }
    }
    p.cooldowns["tended_children"] = w.tick + 12;
    ctx.emit("children_tended", [p.id], { household: p.householdId, fed });
    return ctx.events;
  },
};

/** Washing blood off a tool or clothes, at a well or the river. Being seen doing it is suspicious. */
export const wash: ActionDef = {
  id: "wash",
  name: "Wash",
  candidates(p, w) {
    if (!p.bloodyTool && !p.bloodyClothes) return [];
    const well = w.map.nearestWell(p);
    const bank = w.map.nearest("bank", p);
    const dest = cheb(p, well) <= cheb(p, bank) ? well : bank;
    const fear = p.emotions.guilt + (p.bloodyTool ? 0.3 : 0);
    return [cand("wash", "wash", `wash the blood off their ${p.bloodyTool ? "tool" : "clothes"}`, { dest, duration: 2, travel: travelTicks(w, p, dest), effects: { security: 0.3 + fear, comfort: 0.2 } })];
  },
  resolve(p, _c, w, ctx) {
    const what = p.bloodyTool ? "tool" : "clothes";
    p.bloodyTool = false;
    p.bloodyClothes = false;
    ctx.emit("washed", [p.id], { person: p.id, what });
    witnessAction(w, p, ctx.rng, { predicate: "washing_blood", object: what, crimeId: null });
    return ctx.events;
  },
};

