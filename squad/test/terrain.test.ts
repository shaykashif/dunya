// The lie of the land and what stands on it: the kinds of map a seed can give,
// ground height in sight lines, movement and shooting, buildings with floors,
// the weather, and the sniper's eye for a hide.
import { describe, expect, it } from "vitest";
import { chooseHide, sniperPriority } from "../src/ai/sniper.ts";
import { hitChance, sightRange } from "../src/combat/fire.ts";
import { concealment } from "../src/combat/perception.ts";
import { checkInvariants } from "../src/engine/invariants.ts";
import { createSimulation } from "../src/sim.ts";
import { startClearance } from "../src/world/layout.ts";
import { findPath } from "../src/world/map.ts";
import type { MapKind, Soldier } from "../src/world/types.ts";
import type { World } from "../src/world/world.ts";

function world(seed: number, kind: MapKind | null = null, weather: "clear" | "rain" | "fog" | null = null): World {
  return createSimulation({ seed, config: { map: { kind }, weather: { kind: weather } } }).world;
}

/** Flat grass over a patch, with a hedge across it at row `hedgeY`. */
function field(w: World, x0: number, y0: number, x1: number, y1: number, hedgeY: number | null): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      w.map.set(x, y, y === hedgeY ? "hedge" : "grass");
      w.map.elev[w.map.idx(x, y)] = 0;
    }
  }
  w.map.finalize();
}

function men(w: World): { us: Soldier; de: Soldier } {
  return { us: w.soldiers.find((s) => s.side === "us" && s.role === "rifleman")!, de: w.soldiers.find((s) => s.side === "de" && s.role === "rifleman")! };
}

describe("kinds of ground", () => {
  for (const kind of ["hamlet", "rural", "road", "town", "urban"] as const) {
    it(`a ${kind} map has its settlement, floors, stairs and a reachable objective`, () => {
      const w = world(11, kind);
      expect(w.layout.kind).toBe(kind);
      expect(w.buildings.length).toBeGreaterThanOrEqual(4);
      const obj = w.layout.objective;
      expect(w.map.passable(obj.x, obj.y)).toBe(true);
      const attacker = w.side(w.attacker)[0]!;
      expect(w.map.reachable(attacker, obj)).toBe(true);
      expect(w.layout.hamletPositions.length).toBeGreaterThan(3);
      // Every house with an upper floor has stairs, and the upper floor can be reached from the ground.
      // (A house that has already fallen in has no stairs left.)
      for (const b of w.buildings.filter((x) => x.floors > 1 && !x.destroyed)) {
        let stairs: { x: number; y: number } | null = null;
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (w.map.at(x, y) === "stairs") stairs = { x, y };
        expect(stairs, b.name).not.toBeNull();
        expect(w.map.reachable({ ...stairs! }, { ...stairs!, z: 1 })).toBe(true);
      }
    });
  }

  it("the seed picks the ground and the weather, and the same seed picks the same again", () => {
    const kinds = new Set<string>(), skies = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const w = world(seed);
      kinds.add(w.layout.kind);
      skies.add(w.weather.kind);
    }
    // The five kinds of place, and the forest line in winter.
    expect(kinds.size).toBe(6);
    expect(skies.size).toBeGreaterThanOrEqual(3);
    const a = world(17), b = world(17);
    expect(a.layout.kind).toBe(b.layout.kind);
    expect(a.weather.kind).toBe(b.weather.kind);
    expect(Array.from(a.map.elev)).toEqual(Array.from(b.map.elev));
  });
});

describe("high ground", () => {
  it("a man on a rise sees over a hedgerow that hides him on the flat", () => {
    const w = world(3, "hamlet");
    const { us, de } = men(w);
    field(w, 10, 10, 40, 50, 25);
    w.place(de, 20, 15);
    w.place(us, 20, 40);
    expect(w.map.visibility(us.x, us.y, de.x, de.y)).toBe(0);
    // Raise the ground under him: a knoll behind the hedge.
    for (let y = 37; y <= 43; y++) for (let x = 17; x <= 23; x++) w.map.elev[w.map.idx(x, y)] = 9;
    w.map.finalize();
    expect(w.map.visibility(us.x, us.y, de.x, de.y)).toBeGreaterThan(0.2);
  });

  it("a crest between two men blocks sight", () => {
    const w = world(3, "hamlet");
    const { us, de } = men(w);
    field(w, 10, 10, 40, 50, null);
    w.place(de, 20, 15);
    w.place(us, 20, 45);
    expect(w.map.visibility(us.x, us.y, de.x, de.y)).toBeGreaterThan(0.9);
    for (let x = 10; x <= 40; x++) for (let y = 28; y <= 32; y++) w.map.elev[w.map.idx(x, y)] = 4;
    w.map.finalize();
    expect(w.map.visibility(us.x, us.y, de.x, de.y)).toBe(0);
  });

  it("uphill is harder going than the flat, and downhill a little easier", () => {
    const w = world(3, "hamlet");
    field(w, 10, 10, 20, 20, null);
    const a = w.map.cell(15, 15), b = w.map.cell(16, 15);
    const flat = w.map.stepCost(a, b);
    w.map.elev[w.map.idx(16, 15)] = 1.5;
    expect(w.map.stepCost(a, b)).toBeGreaterThan(flat * 1.4);
    expect(w.map.stepCost(b, a)).toBeLessThan(flat);
  });

  it("firing down from higher ground hits a little more often", () => {
    const w = world(3, "hamlet");
    const { us, de } = men(w);
    field(w, 10, 10, 40, 50, null);
    w.place(de, 20, 15);
    w.place(us, 20, 40);
    const spec = w.config.weapons.m1_garand;
    const level = hitChance(w, us, de, spec, 1);
    for (let y = 37; y <= 43; y++) for (let x = 17; x <= 23; x++) w.map.elev[w.map.idx(x, y)] = 6;
    w.map.finalize();
    const above = hitChance(w, us, de, spec, 1);
    expect(above).toBeGreaterThan(level * 1.05);
    expect(above).toBeLessThan(level * 1.3);
  });
});

describe("buildings with floors", () => {
  it("a path climbs the stairs, two men can stand one above the other, and the rules still hold", () => {
    const w = world(11, "town");
    const b = w.buildings.find((x) => x.floors >= 2)!;
    let up: { x: number; y: number } | null = null;
    for (let y = b.y; y < b.y + b.h && !up; y++) for (let x = b.x; x < b.x + b.w && !up; x++) if (w.map.at(x, y) !== "stairs" && w.map.passable(x, y, 1) && w.map.passable(x, y)) up = { x, y };
    expect(up).not.toBeNull();
    const door = w.freeTileNear({ x: b.x + Math.floor(b.w / 2), y: b.y + b.h }, 3)!;
    const path = findPath(w.map, w.map.cell(door.x, door.y), w.map.cell(up!.x, up!.y, 1));
    expect(path).not.toBeNull();
    expect(path!.some((c) => w.map.ptz(c).z === 1)).toBe(true);
    const { us, de } = men(w);
    w.place(us, up!.x, up!.y, 0);
    w.place(de, up!.x, up!.y, 1);
    expect(us.z).toBe(0);
    expect(de.z).toBe(1);
    expect(() => checkInvariants(w)).not.toThrow();
  });

  it("a man at an upstairs window is harder to spot than one in the open", () => {
    const w = world(11, "town");
    const { us, de } = men(w);
    const b = w.buildings.find((x) => x.floors >= 2)!;
    let spot: { x: number; y: number } | null = null;
    for (let y = b.y; y < b.y + b.h && !spot; y++) for (let x = b.x; x < b.x + b.w && !spot; x++) if (w.map.passable(x, y, 1) && w.map.besideWindow(x, y)) spot = { x, y };
    expect(spot).not.toBeNull();
    w.place(de, spot!.x, spot!.y, 1);
    const upstairs = concealment(w, de, us);
    field(w, 2, 2, 8, 8, null);
    w.place(de, 5, 5, 0);
    de.posture = "crouch";
    expect(upstairs).toBeLessThan(concealment(w, de, us) * 0.5);
  });
});

describe("weather and snipers", () => {
  it("rain and fog cut how far men can see", () => {
    const clear = world(5, "hamlet", "clear"), rain = world(5, "hamlet", "rain"), fog = world(5, "hamlet", "fog");
    const s = (w: World) => sightRange(w, w.soldiers[0]!);
    expect(s(rain)).toBeLessThan(s(clear) * 0.8);
    expect(s(fog)).toBeLessThan(s(rain) * 0.6);
    expect(fog.map.mud).toBeGreaterThanOrEqual(1);
    expect(rain.map.mud).toBeGreaterThan(1);
  });

  it("a sniper wants the machine gunner, the enemy sniper and the medic more than a rifleman", () => {
    const w = world(9);
    const sniper = w.soldiers.find((s) => s.role === "sniper") ?? w.soldiers[0]!;
    const enemy = (role: string) => w.soldiers.find((s) => s.side !== sniper.side && s.role === role);
    const rifleman = enemy("rifleman")!;
    const gunner = w.soldiers.find((s) => s.side !== sniper.side && (s.weapon === "mg42" || s.weapon === "bar"))!;
    const medic = enemy("medic")!;
    expect(sniperPriority(w, sniper, gunner)).toBeGreaterThan(sniperPriority(w, sniper, rifleman));
    expect(sniperPriority(w, sniper, medic)).toBeGreaterThan(sniperPriority(w, sniper, rifleman));
  });

  it("a sniper's hide is high up or well hidden, and away from his own men", () => {
    // Some snipers have nothing in view from where they start; those that do have a hide must pick a good one.
    let found = 0;
    for (const [seed, kind] of [1, 9, 12, 3, 4, 5, 6, 7, 8].flatMap((s) => [[s, null], [s, "urban"]] as const)) {
      const w = world(seed, kind);
      const sniper = w.soldiers.find((s) => s.role === "sniper" && !w.squad(s.squadId).task.startsWith("scout"));
      if (!sniper) continue;
      const hide = chooseHide(w, sniper);
      if (!hide) continue;
      found++;
      const t = w.map.at(hide.x, hide.y);
      const hidden = (hide.z ?? 0) > 0 || (w.config.terrain.concealment[t] ?? 1) <= 0.6 || w.map.besideCover(hide.x, hide.y) || w.map.indoors(hide.x, hide.y);
      expect(hidden, `${seed}: ${t}`).toBe(true);
    }
    expect(found).toBeGreaterThanOrEqual(2);
  });
});

describe("the start", () => {
  it("the two sides always start beyond the longest sight on the field, ambushes included", () => {
    for (let seed = 1; seed <= 24; seed++) {
      const w = world(seed);
      const att = w.side(w.attacker).filter((s) => w.onField(s));
      const def = w.soldiers.filter((s) => s.side !== w.attacker && w.onField(s));
      let closest = Infinity;
      for (const a of att) for (const d of def) closest = Math.min(closest, Math.hypot(a.x - d.x, a.y - d.y));
      expect(closest, `seed ${seed} (${w.layout.kind})`).toBeGreaterThan(w.config.perception.maxRange * w.config.perception.scope);
      expect(closest).toBeGreaterThanOrEqual(startClearance(w.config) - w.config.map.startMargin);
    }
  });
});
