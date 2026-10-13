// Building and devotion: planning a project, hauling materials to it, working
// it into place, quarrying stone; praying, keeping a festival, and hunting down
// the wolves that raid the pens.
import { cannotWalk } from "../entities/body.ts";
import { deityOf, needStrength, satisfy } from "../entities/culture.ts";
import { clamp01, cheb, feel, householdMembers } from "../entities/person.ts";
import { practise, skillFactor, skillLevel } from "../entities/skills.ts";
import { strikeWolf, wolfBite } from "../world/animals.ts";
import { produce, transfer } from "../world/items.ts";
import {
  activeProjects,
  bedUnits,
  bridgeSite,
  completeProject,
  crowding,
  extensionTiles,
  furnitureIn,
  hasBed,
  isFurniture,
  planProject,
  projectSkill,
  stillNeeded,
  templeSite,
  wellSite,
} from "../world/structures.ts";
import type { Person, Point, Project, ProjectKind } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { atHome, cand, homeDest, isDetained, isNight, onCooldown, travelTicks } from "./helpers.ts";
import type { ActionDef, CandidateAction } from "./types.ts";

function canWork(w: World, p: Person, minAge = 14): boolean {
  return w.ageYears(p) >= minAge && !isDetained(w, p) && p.carryingId === null && p.carriedById === null && !cannotWalk(p) && !p.mad;
}

/** Projects a person would work on: their own house's, and (grown-ups) the village's. */
function myProjects(w: World, p: Person): Project[] {
  return activeProjects(w).filter((pr) => pr.householdId === p.householdId || (pr.householdId === null && w.ageYears(p) >= 16));
}

/** Wood a house wants on hand for its projects, on top of firewood. */
export function projectWood(w: World, householdId: number): number {
  let n = 0;
  for (const pr of activeProjects(w)) {
    if (pr.householdId === householdId) n += stillNeeded(pr).wood;
    else if (pr.householdId === null) n += stillNeeded(pr).wood / Math.max(1, w.households.length);
  }
  return Math.ceil(n);
}

/** Firewood kept back from building: more in winter. */
function woodReserve(w: World): number {
  return w.env.season === 3 ? 6 : 3;
}

// ---------- Planning ----------

function commissionCand(kind: ProjectKind, text: string, effects: CandidateAction["effects"]): CandidateAction {
  return cand("commission", `commission:${kind}`, `plan to build ${text}`, { dest: null, duration: 1, option: kind, effects });
}

/** Heads of houses plan what their house needs; the elder plans for the village. */
export const commission: ActionDef = {
  id: "commission",
  name: "Plan a project",
  candidates(p, w) {
    if (!canWork(w, p, 16) || onCooldown(w, p, "commission")) return [];
    const out: CandidateAction[] = [];
    const cfg = w.config.construction;
    if (p.isHead) {
      const hid = p.householdId;
      const projs = activeProjects(w, hid);
      if (projs.length < cfg.maxHouseProjects) {
        const b = w.house(hid);
        const members = householdMembers(w, hid);
        const planned = (k: ProjectKind) => projs.filter((pr) => pr.kind === k).length;
        const have = (k: "bed" | "table" | "chair" | "chest" | "altar") => furnitureIn(w, b.id, k).length + planned(k);
        const crowd = crowding(w, hid);
        const bedless = bedUnits(w, hid) - have("bed");
        if (bedless > 0 && !crowd.full) out.push(commissionCand("bed", "a bed", { comfort: Math.min(0.7, 0.2 * bedless), duty: 0.25, relation: 0.1 }));
        if (have("table") < Math.ceil(members.length / cfg.peoplePerTable) && !crowd.full) out.push(commissionCand("table", "a table", { comfort: 0.25, duty: 0.1 }));
        if (have("chair") < Math.ceil(members.length / cfg.peoplePerChair) && !crowd.full) out.push(commissionCand("chair", "a chair", { comfort: 0.12 }));
        if (have("chest") < 1 && !crowd.full) out.push(commissionCand("chest", "a chest", { comfort: 0.1, provision: 0.05 }));
        const piety = members.reduce((a, m) => a + m.values.piety, 0) / Math.max(1, members.length);
        if (have("altar") < 1 && piety > 0.15 && !crowd.full) out.push(commissionCand("altar", "a household altar", { comfort: 0.1, duty: piety * 0.4 }));
        if ((crowd.tilesPerPerson < cfg.tilesPerPerson || crowd.full) && planned("extension") === 0 && extensionTiles(w, b)) out.push(commissionCand("extension", "new rooms onto the house", { comfort: 0.35, status: 0.1, duty: 0.2 }));
        const c = w.compound(hid);
        const wells = w.map.wells.filter((wl) => cheb(wl, c.center) <= w.config.map.compoundRadius).length;
        if (members.length > cfg.secondWellAbove && wells < 2 && planned("well") === 0 && wellSite(w, hid)) out.push(commissionCand("well", "a second well", { provision: 0.25, water: 0.05 }));
        if (!w.pumps.includes(w.map.idx(c.well.x, c.well.y)) && planned("pump") === 0) out.push(commissionCand("pump", "a pump on the well", { provision: 0.12 + (w.env.well < 0.4 ? 0.3 : 0) }));
        const herd = w.animals.some((a) => a.alive && a.householdId === hid);
        if (herd && !w.fenced.includes(hid) && planned("fence") === 0) {
          const lost = w.tick - (w.livestockLost[hid] ?? -Infinity) < w.days(10);
          out.push(commissionCand("fence", "a palisade round the animal pen", { provision: 0.12 + (lost ? 0.7 : 0), security: lost ? 0.3 : 0.05 }));
        }
      }
    }
    if (p.role === "elder") {
      const village = activeProjects(w, null);
      const ever = (k: ProjectKind) => w.projects.some((pr) => pr.kind === k && pr.status !== "abandoned");
      if (village.length < 1) {
        if (!ever("bridge") && bridgeSite(w)) out.push(commissionCand("bridge", "a bridge over the river", { provision: 0.3, status: 0.2 }));
        const piety = w.active().reduce((a, m) => a + m.values.piety, 0) / Math.max(1, w.active().length);
        if (!ever("temple") && piety > -0.1 && templeSite(w)) out.push(commissionCand("temple", `a temple to ${w.culture.deities[0]!.name}`, { status: 0.3, duty: 0.2 + piety * 0.4 }));
      }
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    p.cooldowns["commission"] = w.tick + 12;
    const pr = planProject(w, p, c.option as ProjectKind);
    if (!pr) ctx.success = false;
    return ctx.events;
  },
};

// ---------- Hauling and building ----------

export const haul: ActionDef = {
  id: "haul",
  name: "Haul materials",
  candidates(p, w) {
    if (!canWork(w, p, 12)) return [];
    const store = w.households[p.householdId]!.store;
    for (const pr of myProjects(w, p)) {
      const left = stillNeeded(pr);
      for (const kind of ["wood", "stone"] as const) {
        const want = left[kind] - p.inventory[kind];
        const spare = store[kind] - (kind === "wood" ? woodReserve(w) : 0);
        if (want <= 0 || p.inventory[kind] > 0 || spare <= 0) continue;
        const dest = homeDest(w, p);
        return [
          cand("haul", `haul:${pr.id}:${kind}`, `fetch ${kind} for the ${label(pr)}`, {
            dest,
            duration: 1,
            travel: travelTicks(w, p, dest),
            item: kind,
            option: String(pr.id),
            effects: { duty: 0.2 + (pr.householdId === p.householdId ? 0.15 : 0), provision: 0.1 },
          }),
        ];
      }
    }
    return [];
  },
  resolve(p, c, w, ctx) {
    const pr = w.projects.find((x) => x.id === Number(c.option));
    if (!pr || pr.status !== "planned" || !atHome(w, p)) {
      ctx.success = false;
      return ctx.events;
    }
    const kind = c.item as "wood" | "stone";
    const reserve = kind === "wood" ? woodReserve(w) : 0;
    const qty = Math.min(stillNeeded(pr)[kind], w.config.construction.carryMax, w.households[p.householdId]!.store[kind] - reserve);
    if (transfer(w, { t: "household", id: p.householdId }, { t: "person", id: p.id }, kind, qty, "hauled", [p.id]) === 0) ctx.success = false;
    return ctx.events;
  },
};

function label(pr: Project): string {
  return pr.kind === "extension" ? "new rooms" : pr.kind === "fence" ? "palisade" : pr.kind;
}

function siteDest(w: World, pr: Project): { dest: Point; reach?: number } {
  if (isFurniture(pr.kind) || pr.kind === "extension") return { dest: { ...pr.site } };
  return { dest: { ...pr.site }, reach: pr.kind === "temple" ? 3 : 2 };
}

export const construct: ActionDef = {
  id: "construct",
  name: "Build",
  candidates(p, w) {
    if (!canWork(w, p)) return [];
    const out: CandidateAction[] = [];
    for (const pr of myProjects(w, p)) {
      const left = stillNeeded(pr);
      const bringing = (left.wood > 0 && p.inventory.wood > 0) || (left.stone > 0 && p.inventory.stone > 0);
      const ready = left.wood === 0 && left.stone === 0 && pr.done < pr.work;
      if (!bringing && !ready) continue;
      const { dest, reach } = siteDest(w, pr);
      const skill = projectSkill(pr.kind);
      const own = pr.householdId === p.householdId;
      const forMe = pr.kind === "bed" && own && !hasBed(w, p);
      out.push(
        cand("construct", `construct:${pr.id}`, ready ? `build the ${label(pr)}` : `bring materials to the ${label(pr)}`, {
          dest,
          reach,
          duration: ready ? w.config.construction.workDuration : 1,
          travel: travelTicks(w, p, dest),
          option: String(pr.id),
          effects: {
            duty: 0.25 + (own ? 0.2 : 0.1) + (p.task === "carpenter" && skill === "carpentry" ? 0.2 : 0) + (p.task === "stonemason" && skill === "masonry" ? 0.2 : 0),
            comfort: forMe ? 0.35 : own ? 0.1 : 0,
            provision: 0.1,
            focus: ready ? { create: 0.3 } : undefined,
          },
        }),
      );
    }
    return out.slice(0, 2);
  },
  resolve(p, c, w, ctx) {
    const pr = w.projects.find((x) => x.id === Number(c.option));
    const { dest, reach } = pr ? siteDest(w, pr) : { dest: p, reach: 0 };
    const b = pr?.buildingId !== null && pr?.buildingId !== undefined ? w.buildings[pr.buildingId]! : null;
    const there = b ? w.isInside(p, b) : cheb(p, dest) <= (reach ?? 2) + 1;
    if (!pr || pr.status !== "planned" || !there) {
      ctx.success = false;
      return ctx.events;
    }
    pr.lastWorkTick = w.tick;
    if (!pr.builders.includes(p.id)) pr.builders.push(p.id);
    const left = stillNeeded(pr);
    let brought = 0;
    for (const kind of ["wood", "stone"] as const) brought += transfer(w, { t: "person", id: p.id }, { t: "site", id: pr.id }, kind, left[kind], "delivered", [p.id]);
    const now = stillNeeded(pr);
    if (now.wood > 0 || now.stone > 0) {
      if (brought === 0) ctx.success = false;
      return ctx.events;
    }
    const skill = projectSkill(pr.kind);
    const stint = c.duration / w.config.construction.workDuration;
    pr.done = Math.round((pr.done + skillFactor(w, p, skill) * stint) * 1000) / 1000;
    pr.quality = Math.max(pr.quality, skillLevel(w, p, skill));
    practise(w, p, skill, c.duration);
    satisfy(p, "create", 0.3 * stint);
    if (pr.done >= pr.work) completeProject(w, pr, p, ctx.rng);
    return ctx.events;
  },
};

/** Breaking stone at a rocky outcrop, when a project needs it. */
export const quarry: ActionDef = {
  id: "quarry",
  name: "Quarry",
  candidates(p, w) {
    if (!canWork(w, p, 16) || w.map.rock.length === 0 || isNight(w) || p.survival.food < 0.35) return [];
    let need = 0;
    for (const pr of myProjects(w, p)) need += stillNeeded(pr).stone;
    need -= p.inventory.stone + w.households[p.householdId]!.store.stone;
    if (need <= 0 && p.task !== "stonemason") return [];
    if (need <= 0 && w.households[p.householdId]!.store.stone >= 8) return [];
    const dest = w.map.nearest("rock", p);
    if (!w.map.reachable(p, dest)) return [];
    return [
      cand("quarry", "quarry", "break stone at the outcrop", {
        dest,
        reach: 1,
        duration: w.config.construction.quarryDuration,
        travel: travelTicks(w, p, dest),
        effects: { provision: Math.min(0.5, 0.1 + need * 0.05), duty: p.task === "stonemason" ? 0.2 : 0 },
      }),
    ];
  },
  resolve(p, c, w, ctx) {
    if (w.map.at(p.x, p.y) !== "rock" && !w.map.neighbors4(p.x, p.y).some((n) => w.map.at(n.x, n.y) === "rock")) {
      ctx.success = false;
      return ctx.events;
    }
    const [lo, hi] = w.config.construction.quarryYield;
    const qty = Math.round((lo + ctx.rng.int(hi - lo + 1)) * skillFactor(w, p, "masonry"));
    produce(w, { t: "person", id: p.id }, "stone", qty, "quarried", [p.id]);
    practise(w, p, "masonry", c.duration);
    return ctx.events;
  },
};

// ---------- Devotion and festivals ----------

/** Praying: at the temple if there is one, at the house altar, or simply at home. */
export const pray: ActionDef = {
  id: "pray",
  name: "Pray",
  candidates(p, w) {
    if (w.ageYears(p) < 6 || p.mad || isDetained(w, p)) return [];
    const s = needStrength(p, "pray");
    if (s < 0.25 || p.focus.pray > 0.7) return [];
    const temple = w.buildings.find((b) => b.kind === "temple");
    const altar = furnitureIn(w, w.households[p.householdId]!.buildingId, "altar").length > 0;
    const out: CandidateAction[] = [];
    const god = deityOf(w, p).name;
    const home = homeDest(w, p);
    out.push(cand("pray", "pray:home", altar ? `pray to ${god} at the house altar` : `pray to ${god}`, { dest: home, duration: 3, travel: travelTicks(w, p, home), option: altar ? "altar" : "home", effects: { comfort: 0.05, focus: { pray: (1 - p.focus.pray) * (altar ? 0.8 : 0.5) } } }));
    if (temple && !cannotWalk(p)) {
      out.push(cand("pray", "pray:temple", `pray to ${god} at the temple`, { dest: { ...temple.hearthSpot }, duration: 3, travel: travelTicks(w, p, temple.hearthSpot), option: "temple", effects: { comfort: 0.08, companionship: 0.05, focus: { pray: 1 - p.focus.pray } } }));
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const amount = c.option === "temple" ? 0.8 : c.option === "altar" ? 0.6 : 0.4;
    satisfy(p, "pray", amount);
    if (p.focus.pray >= 0.95 && !onCooldown(w, p, "devout")) {
      p.cooldowns["devout"] = w.tick + w.days(2);
      feel(w, p, "uplifted", `prayed to ${deityOf(w, p).name}${c.option === "temple" ? " at the temple" : ""}`, 0.2 + 0.2 * needStrength(p, "pray"));
    }
    ctx.emit("prayed", [p.id], { person: p.id, deity: p.deityId, where: c.option });
    return ctx.events;
  },
};

/** Keeping a festival in the square: music, food, dancing, gossip. */
export const celebrate: ActionDef = {
  id: "celebrate",
  name: "Celebrate",
  candidates(p, w) {
    const f = w.festival;
    if (!f || w.ageYears(p) < 4 || isDetained(w, p) || cannotWalk(p) || p.mad || f.attended.includes(p.id)) return [];
    const dest = { ...w.map.square };
    const merry = p.values.merriment;
    return [
      cand("celebrate", "celebrate", `join ${f.name} in the square`, {
        dest,
        reach: 7,
        duration: 6,
        travel: travelTicks(w, p, dest),
        effects: { companionship: 0.5, comfort: 0.1 + 0.2 * merry, romance: 0.1, focus: { leisure: 0.6, pray: 0.2 } },
      }),
    ];
  },
  resolve(p, _c, w, ctx) {
    const f = w.festival;
    if (!f) {
      ctx.success = false;
      return ctx.events;
    }
    f.attended.push(p.id);
    satisfy(p, "leisure", 0.6);
    satisfy(p, "pray", 0.25);
    p.wants.companionship = clamp01(p.wants.companionship + 0.3);
    const merry = p.values.merriment;
    if (merry > -0.3) feel(w, p, "merry", `danced at ${f.name}`, 0.3 + 0.3 * Math.max(0, merry));
    else feel(w, p, "bored", `sat through ${f.name}`, 0.15);
    return ctx.events;
  },
};

// ---------- Hunting the wolves ----------

/** Dens, while wolves live there. */
function liveDens(w: World): { at: Point; wolves: number }[] {
  const out: { at: Point; wolves: number }[] = [];
  for (const a of w.animals) {
    if (a.kind !== "wolf" || !a.alive) continue;
    const d = out.find((x) => x.at.x === a.home.x && x.at.y === a.home.y);
    if (d) d.wolves++;
    else out.push({ at: { ...a.home }, wolves: 1 });
  }
  return out;
}

/** After wolves take livestock or attack someone, the house's hunters go after them by day, at the den. */
export const wolfHunt: ActionDef = {
  id: "wolf_hunt",
  name: "Hunt wolves",
  candidates(p, w) {
    if (!onCooldown(w, p, "wolfhunt") || !canWork(w, p, 16) || isNight(w) || p.survival.food < 0.35) return [];
    const out: CandidateAction[] = [];
    for (const den of liveDens(w)) {
      if (!w.map.reachable(p, den.at)) continue;
      const armed = p.inventory.musket > 0;
      out.push(
        cand("wolf_hunt", `wolf_hunt:${den.at.x},${den.at.y}`, `hunt down the wolves at their den`, {
          dest: den.at,
          reach: 3,
          duration: 2,
          travel: travelTicks(w, p, den.at),
          risk: clamp01(0.55 - (armed ? 0.25 : 0) - (p.task === "hunter" ? 0.1 : 0)),
          effects: { duty: 0.5, security: 0.4, grudge: 0.2, status: 0.15 },
        }),
      );
    }
    return out.slice(0, 1);
  },
  resolve(p, _c, w, ctx) {
    const wolves = w.animals.filter((a) => a.alive && a.kind === "wolf" && cheb(a, p) <= 4).sort((a, b) => cheb(a, p) - cheb(b, p) || a.id - b.id);
    if (wolves.length === 0) {
      ctx.success = false;
      ctx.emit("wolf_hunt", [p.id], { hunter: p.id, found: 0, killed: 0 });
      return ctx.events;
    }
    let killed = 0;
    for (const wolf of wolves.slice(0, 3)) {
      if (!p.alive) break;
      strikeWolf(w, p, wolf, ctx.rng);
      practise(w, p, "hunting", 2);
      if (!wolf.alive) {
        killed++;
        continue;
      }
      // A cornered wolf turns on the hunter.
      if (ctx.rng.chance(0.45)) wolfBite(w, wolf, p, ctx.rng);
    }
    ctx.emit("wolf_hunt", p.alive ? [p.id] : [], { hunter: p.id, found: wolves.length, killed });
    if (p.alive && killed > 0) {
      for (const m of householdMembers(w, p.householdId)) delete m.cooldowns["wolfhunt"];
      feel(w, p, "triumphant", `killed ${killed} wolf${killed > 1 ? "s" : ""} at their den`, 0.5);
    }
    return ctx.events;
  },
};
