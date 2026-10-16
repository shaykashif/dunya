// Fighting in a city: the ground (streets offset into T-junctions, barricades,
// wire, wrecks and debris, a town hall on a plaza with a fountain and statues,
// markets, terraces with their party walls knocked through), the light
// defences on every map's roads, and the house-to-house tactics.
import { beforeAll, describe, expect, it } from "vitest";
import { buildingPositions, houseAt, urbanBoundsTo, urbanFlankPoint } from "../src/ai/tactics.ts";
import { EventLog, type SimEvent } from "../src/log/events.ts";
import type { DecisionRecord } from "../src/decision/sources.ts";
import { createSimulation } from "../src/sim.ts";
import type { MapKind, Terrain } from "../src/world/types.ts";
import type { World } from "../src/world/world.ts";

function world(seed: number, kind: MapKind | null = "urban"): World {
  return createSimulation({ seed, config: { map: { kind } } }).world;
}

function count(w: World, t: Terrain): number {
  let n = 0;
  for (let i = 0; i < w.map.tiles; i++) if (w.map.terrain[i] === t) n++;
  return n;
}

describe("the city", () => {
  it("is street after street of buildings, with no hedgerows or fields", () => {
    const w = world(3);
    expect(w.layout.kind).toBe("urban");
    expect(w.buildings.length).toBeGreaterThan(150);
    expect(count(w, "hedge")).toBe(0);
    expect(count(w, "wheat")).toBe(0);
    // Tall buildings: apartment blocks up to four storeys.
    expect(w.buildings.some((b) => b.kind === "apartment" && b.floors === 4)).toBe(true);
    // Some already knocked about, some fallen in.
    expect(w.buildings.some((b) => b.destroyed)).toBe(true);
  });

  it("the objective is inside the town hall, on a plaza with a fountain and statues, and a squad garrisons it", () => {
    const w = world(3);
    const hall = houseAt(w, w.layout.objective);
    expect(hall?.kind).toBe("townhall");
    expect(w.map.indoors(w.layout.objective.x, w.layout.objective.y)).toBe(true);
    expect(count(w, "fountain")).toBeGreaterThanOrEqual(9);
    expect(count(w, "statue")).toBeGreaterThanOrEqual(2);
    const defender = w.attacker === "us" ? "de" : "us";
    const keep = w.squads.find((s) => s.side === defender && s.task === "keep");
    expect(keep).toBeDefined();
    const men = keep!.members.map((id) => w.soldier(id));
    expect(men.filter((m) => houseAt(w, m) === hall).length).toBeGreaterThanOrEqual(men.length - 1);
    expect(men.some((m) => m.z > 0)).toBe(true);
    // The attackers can get to it.
    expect(w.map.reachable(w.side(w.attacker)[0]!, w.layout.objective)).toBe(true);
  });

  it("the streets are barricaded, wired, cratered and strewn with wrecks and debris, and market stalls stand in the squares", () => {
    for (const seed of [3, 5]) {
      const w = world(seed);
      expect(count(w, "sandbags")).toBeGreaterThan(20);
      expect(count(w, "wire")).toBeGreaterThan(30);
      expect(count(w, "wreck")).toBeGreaterThanOrEqual(10);
      expect(count(w, "debris")).toBeGreaterThan(200);
      expect(count(w, "pothole")).toBeGreaterThan(50);
      expect(count(w, "rubble")).toBeGreaterThan(100);
      // Sandbags across the street mouths on the defended boulevard.
      const L = w.layout.line.y;
      let barricade = 0;
      for (let x = 0; x < w.map.width; x++) if (w.map.at(x, L) === "sandbags") barricade++;
      expect(barricade).toBeGreaterThan(6);
    }
    const stalls = [1, 2, 3, 4, 5, 6].map((s) => count(world(s), "stall"));
    expect(stalls.some((n) => n > 10)).toBe(true);
  });

  it("terraced houses have doorways knocked through their party walls, on the upper floors too", () => {
    const w = world(3);
    let through = 0;
    for (let i = 0; i < w.map.tiles; i++) {
      if (w.map.terrain[i] !== "door") continue;
      const p = w.map.pt(i);
      const ids = new Set(w.map.neighbors4(p.x, p.y).map((q) => w.map.building[w.map.idx(q.x, q.y)]));
      if (ids.has(-1) || ids.size < 2) continue;
      through++;
      if (w.map.levels[i]! > 1) expect(w.map.passable(p.x, p.y, 1)).toBe(true);
    }
    expect(through).toBeGreaterThan(10);
  });

  it("a team holding a building takes the windows facing the enemy, the guns highest", () => {
    const w = world(3);
    const b = w.buildings.find((x) => x.kind === "apartment" && x.floors >= 3 && !x.destroyed)!;
    const squad = w.squads.find((s) => s.side === w.attacker && !s.isHQ && s.members.length >= 8)!;
    const men = squad.members.map((id) => w.soldier(id));
    const toward = { x: b.x + Math.floor(b.w / 2), y: b.y - 40 };
    const pos = buildingPositions(w, men, b, toward);
    const gunner = men.find((m) => m.role === "auto_rifleman")!;
    const zs = men.map((m) => pos[m.id]!.z ?? 0);
    expect(pos[gunner.id]!.z ?? 0).toBe(Math.max(...zs));
    const inside = men.filter((m) => houseAt(w, pos[m.id]!) === b);
    expect(inside.length).toBeGreaterThanOrEqual(Math.min(men.length, 6));
    // Spread over the floors, not bunched on one.
    expect(new Set(zs).size).toBeGreaterThanOrEqual(2);
  });

  it("routes go building to building, and a flanking team makes for dead ground under the enemy's window", () => {
    const w = world(3);
    const start = w.side(w.attacker).find((s) => s.role === "rifleman")!;
    const route = urbanBoundsTo(w, w.attacker, start, w.layout.objective);
    expect(route.length).toBeGreaterThan(5);
    expect(route.filter((p) => houseAt(w, p) !== null).length).toBeGreaterThanOrEqual(2);
    // An upstairs window held by the enemy: the flank point is out of its sight, close, and reachable.
    const b = w.buildings.find((x) => x.floors >= 3 && !x.destroyed && x.y > w.layout.line.y + 20)!;
    const win = buildingPositions(w, [start], b, { x: b.x, y: b.y + 40 }, 2)[start.id]!;
    const fp = urbanFlankPoint(w, w.attacker, { x: b.x, y: b.y + 30 }, win, 10);
    expect(fp).not.toBeNull();
    expect(Math.hypot(fp!.x - win.x, fp!.y - win.y)).toBeLessThan(15);
    expect(w.map.visibility(win.x, win.y, fp!.x, fp!.y, null, win.z ?? 0, 0)).toBeLessThan(w.config.perception.minVisibility);
  });
});

describe("road defences on every map", () => {
  for (const kind of ["hamlet", "rural", "road", "town"] as const) {
    it(`a ${kind} map has sandbags and wire by its roads, and debris and potholes on them, and the roads still go through`, () => {
      const w = world(4, kind);
      let bagsByRoad = 0;
      for (let i = 0; i < w.map.tiles; i++) {
        if (w.map.terrain[i] !== "sandbags") continue;
        const p = w.map.pt(i);
        if (w.map.neighbors4(p.x, p.y).some((q) => w.map.at(q.x, q.y) === "road")) bagsByRoad++;
      }
      expect(bagsByRoad).toBeGreaterThan(4);
      expect(count(w, "wire")).toBeGreaterThan(6);
      expect(count(w, "pothole") + count(w, "debris")).toBeGreaterThan(15);
      expect(w.map.reachable(w.side(w.attacker)[0]!, w.layout.objective)).toBe(true);
    });
  }
});

describe("house-to-house fighting", () => {
  let events: SimEvent[] = [];
  let decisions: DecisionRecord[] = [];
  beforeAll(async () => {
    for (const seed of [1, 2]) {
      const log = new EventLog({ retain: true });
      const engine = createSimulation({ seed, log, config: { map: { kind: "urban" } } });
      await engine.runTicks(1500);
      events = events.concat(log.retained!);
      decisions = decisions.concat(engine.decisionLog);
    }
  }, 120_000);

  it("squads clear buildings room by room and storm houses with grenades", () => {
    expect(events.filter((e) => e.type === "building_cleared").length).toBeGreaterThanOrEqual(2);
    const breach = events.filter((e) => e.type === "breach");
    expect(breach.some((e) => e.data.stage === "grenades")).toBe(true);
    expect(breach.some((e) => e.data.stage === "enter")).toBe(true);
  });

  it("covering fire goes onto the windows before a team moves, and teams outflank positions through the houses", () => {
    const said = (t: string) => events.some((e) => e.type === "callout" && String(e.data.text).includes(t));
    expect(said("Covering fire! Hit those windows!") || said("Feuerschutz! Die Fenster!")).toBe(true);
    expect(events.some((e) => e.type === "squad_state" && e.data.to === "flank" && String(e.data.intent).includes("through the houses"))).toBe(true);
  });

  it("men post grenades through windows and doorways, and up and down the stairs", () => {
    expect(decisions.some((d) => d.key.startsWith("breach:") || d.key.startsWith("room:"))).toBe(true);
  });
});
