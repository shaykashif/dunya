// Winter in the Ardennes: the same kinds of place under deep snow, more
// thickly wooded and dug in, with shorter sight and heavier going. And the
// defenders' fire control: every gun holds until the killing ground is full,
// then the whole platoon opens at once, mortars and grenades with it.
import { describe, expect, it } from "vitest";
import { sightRange } from "../src/combat/fire.ts";
import { EventLog } from "../src/log/events.ts";
import { createSimulation } from "../src/sim.ts";
import { cheb } from "../src/world/map.ts";
import type { MapKind, Season, Terrain } from "../src/world/types.ts";
import type { World } from "../src/world/world.ts";

function world(seed: number, season: Season | null, kind: MapKind | null = null): World {
  return createSimulation({ seed, config: { map: { kind }, season: { kind: season } } }).world;
}

function share(w: World, ...kinds: Terrain[]): number {
  return w.map.terrain.filter((t) => kinds.includes(t)).length / w.map.terrain.length;
}

describe("winter", () => {
  it("the seed picks the season, and summer battles are the battles they always were", () => {
    const seasons = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const w = world(seed, null);
      seasons.add(w.season);
      if (w.season === "summer") expect(world(seed, "summer").map.terrain).toEqual(w.map.terrain);
      else {
        expect(w.date).toBe("19 December 1944");
        expect(["clear", "overcast", "snow", "fog"]).toContain(w.weather.kind);
      }
      if (w.season === "summer") expect(w.weather.kind).not.toBe("snow");
    }
    expect(seasons).toEqual(new Set(["summer", "winter"]));
  });

  for (const kind of ["hamlet", "rural", "road", "town"] as const) {
    it(`a winter ${kind} is more wooded and more dug in than the summer one, with no standing wheat`, () => {
      const summer = world(11, "summer", kind), winter = world(11, "winter", kind);
      expect(winter.layout.name).not.toBe(summer.layout.name);
      expect(share(winter, "woods")).toBeGreaterThan(share(summer, "woods") * 1.3);
      expect(share(winter, "wheat")).toBe(0);
      expect(share(winter, "foxhole")).toBeGreaterThan(share(summer, "foxhole") * 1.5);
      // Foxholes along the defended hedge, and the objective still in reach.
      expect(winter.layout.linePositions.filter((p) => winter.map.at(p.x, p.y) === "foxhole").length).toBeGreaterThan(10);
      const attacker = winter.side(winter.attacker)[0]!;
      expect(winter.map.reachable(attacker, winter.layout.objective)).toBe(true);
    });
  }

  it("a winter city has a more wooded park and the same streets", () => {
    const summer = world(5, "summer", "urban"), winter = world(5, "winter", "urban");
    expect(share(winter, "woods")).toBeGreaterThan(share(summer, "woods"));
    expect(winter.layout.name).toContain("snow");
  });

  it("deep snow slows every step outdoors, roads included, but not indoors", () => {
    const summer = world(3, "summer"), winter = world(3, "winter");
    const cost = (w: World, t: Terrain) => {
      const i = w.map.terrain.indexOf(t);
      expect(i).toBeGreaterThanOrEqual(0);
      return w.map.cost(i);
    };
    for (const t of ["grass", "woods", "road"] as const) expect(cost(winter, t)).toBeGreaterThan(cost(summer, t) * 1.2);
    expect(cost(winter, "floor")).toBe(cost(summer, "floor"));
  });

  it("men see less far in winter, whatever the sky", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const w = world(seed, "winter");
      const s = w.soldiers.find((x) => x.role === "rifleman")!;
      expect(w.weather.sight).toBeLessThan(0.9);
      expect(sightRange(w, s)).toBeLessThan(w.config.perception.maxRange * 0.9);
    }
  });
});

describe("fire control", () => {
  it("the whole defending platoon holds its fire, then opens all at once, with the registered mortars", async () => {
    let checked = 0, registered = 0;
    for (const seed of [1, 3, 6, 11, 12]) {
      const log = new EventLog({ retain: true });
      const engine = createSimulation({ seed, log, config: { ambush: { chance: 1 } } });
      const w = engine.world;
      const pl = w.platoons[w.attacker === "us" ? "de" : "us"];
      // Men of squads lying in wait or dug in, not yet given the word (a squad already moving up to help another is in the fight).
      const waiting = new Set<number>();
      log.addSink((e) => {
        if (e.type !== "fire" || pl.killZone.sprung >= 0) return;
        const s = w.soldier(e.data.by as number);
        const sq = w.squad(s.squadId);
        if (pl.squadIds.includes(sq.id) && s.role !== "sniper" && (sq.state === "ambush" || sq.state === "hold") && sq.orders.A.fire === "hold") waiting.add(e.seq);
      });
      let reserved = true;
      for (let t = 0; t < 1500 && w.phase === "battle" && pl.killZone.sprung < 0; t++) {
        await engine.step();
        // A mission is kept back for the registered target until the word is given.
        if (pl.killZone.sprung < 0 && pl.fireMissionsLeft < w.config.ambush.reserveMissions) reserved = false;
      }
      expect(reserved).toBe(true);
      if (pl.killZone.sprung < 0) continue;
      // Nobody waiting on the line or in the ambush fired before the word, except at an enemy right on top of him
      // or one shooting at him (snipers work on their own account).
      const early = log.retained!.filter((x) => waiting.has(x.seq)).filter((x) => {
        const s = w.soldier(x.data.by as number), at = x.data.at as [number, number], from = x.data.from as [number, number];
        return Math.hypot(at[0] - from[0], at[1] - from[1]) > w.config.ambush.danger + 1 && s.underFire?.by !== x.data.target;
      });
      expect(early).toEqual([]);
      // On the word every squad still waiting is free to fire, at once.
      for (const id of pl.squadIds) {
        const sq = w.squad(id);
        if (sq.state === "hold") expect(sq.orders.A.fire).toBe("free");
      }
      // The mortars come down on the registered target, clear of their own men (unless friends are in the way, an outpost say).
      const reg = pl.missions.find((m) => m.registered);
      if (reg) {
        expect(w.side(pl.side).filter((s) => w.onField(s)).every((s) => cheb(s, reg.target) >= w.config.mortars.dangerClose)).toBe(true);
        registered++;
      }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
    expect(registered).toBeGreaterThanOrEqual(checked - 1);
  });
});
