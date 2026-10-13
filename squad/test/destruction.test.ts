// Shells against houses, trees and hedges; ambushes laid and sprung.
import { describe, expect, it } from "vitest";
import { shellDamage } from "../src/combat/destruction.ts";
import { incoming, ordnanceStep } from "../src/combat/ordnance.ts";
import { checkInvariants } from "../src/engine/invariants.ts";
import { EventLog } from "../src/log/events.ts";
import { createSimulation } from "../src/sim.ts";
import { holeStep } from "../src/world/map.ts";
import type { Ordnance } from "../src/world/types.ts";
import type { World } from "../src/world/world.ts";

function world(seed: number, kind: "hamlet" | "town" = "hamlet"): World {
  return createSimulation({ seed, config: { map: { kind }, weather: { kind: "clear" } } }).world;
}

function shell(w: World, kind: "mortar" | "artillery", x: number, y: number, z = 0): Ordnance {
  return { id: 1, kind, side: null, byId: null, from: { x, y: y - 30 }, x, y, z, burstTick: w.tick, thrownTick: w.tick, spotting: false };
}

describe("shellfire knocks things down", () => {
  it("a wall takes several bombs before it is breached, and the breach can be walked through", () => {
    const w = world(5);
    const b = w.buildings[0]!;
    const x = b.x + 1, y = b.y + b.h - 1;
    expect(w.map.at(x, y)).toBe("building");
    expect(w.map.passable(x, y)).toBe(false);
    const hp = w.map.wallHp[w.map.idx(x, y)]!;
    shellDamage(w, shell(w, "mortar", x, y + 1));
    expect(w.map.wallHp[w.map.idx(x, y)]!).toBeLessThan(hp);
    for (let k = 0; k < 4 && w.map.at(x, y) !== "rubble"; k++) shellDamage(w, shell(w, "mortar", x, y));
    expect(w.map.at(x, y)).toBe("rubble");
    expect(w.map.passable(x, y)).toBe(true);
  });

  it("a house shelled hard enough falls in, bringing the men upstairs down with it", () => {
    const log = new EventLog({ retain: true });
    const w = createSimulation({ seed: 5, log, config: { map: { kind: "town" }, weather: { kind: "clear" } } }).world;
    const b = w.buildings.find((x) => x.floors >= 2)!;
    let up: { x: number; y: number } | null = null;
    for (let y = b.y; y < b.y + b.h && !up; y++) for (let x = b.x; x < b.x + b.w && !up; x++) if (w.map.passable(x, y, 1)) up = { x, y };
    const man = w.soldiers.find((s) => s.side === "de" && s.role === "rifleman")!;
    w.place(man, up!.x, up!.y, 1);
    for (let k = 0; k < 12 && !b.destroyed; k++) shellDamage(w, shell(w, "artillery", b.x + 1 + (k % (b.w - 2)), b.y + 1 + (k % (b.h - 2)), 1));
    expect(b.destroyed).toBe(true);
    expect(man.z).toBe(0);
    expect(man.injuries.length).toBeGreaterThan(0);
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) expect(w.map.passable(x, y, 1)).toBe(false);
    expect(log.retained!.some((e) => e.type === "building_collapse")).toBe(true);
    expect(() => checkInvariants(w)).not.toThrow();
  });

  it("shells smash trees to deadfall and blow hedges open", () => {
    const w = world(5);
    for (let y = 40; y <= 50; y++) for (let x = 40; x <= 50; x++) w.map.set(x, y, y === 45 ? "hedge" : "woods");
    w.map.finalize();
    shellDamage(w, shell(w, "artillery", 45, 45));
    shellDamage(w, shell(w, "artillery", 42, 42));
    let smashed = 0;
    for (let y = 40; y <= 50; y++) for (let x = 40; x <= 50; x++) if (w.map.at(x, y) === "deadfall" || w.map.at(x, y) === "crater") smashed++;
    expect(smashed).toBeGreaterThan(3);
    expect(w.map.at(45, 45)).not.toBe("hedge");
    expect(w.map.passable(45, 45)).toBe(true);
  });
});

describe("rounds in flight and bullets on walls", () => {
  it("a mortar bomb takes some seconds to land, and men near it hear it coming and go flat", () => {
    const log = new EventLog({ retain: true });
    const w = createSimulation({ seed: 5, log, config: { map: { kind: "hamlet" }, weather: { kind: "clear" } } }).world;
    const men = w.soldiers.filter((s) => s.side === "us" && s.status === "active").slice(0, 5);
    const spot = { x: 70, y: 100 };
    for (const m of men) {
      const at = w.freeTileNear(spot, 4, m.id)!;
      w.place(m, at.x, at.y, 0);
      m.posture = "stand";
      m.experience = "veteran";
    }
    const o = incoming(w, "mortar", "de", spot, 0, null);
    expect(o.burstTick - w.tick).toBe(w.config.mortars.flight.mortar);
    let burst = -1, flat = -1;
    for (let k = 0; k < 20 && burst < 0; k++) {
      w.tick++;
      ordnanceStep(w);
      if (flat < 0 && men.some((m) => m.posture === "prone")) flat = w.tick;
      if (log.retained!.some((e) => e.type === "explosion")) burst = w.tick;
    }
    expect(burst).toBe(o.burstTick);
    expect(flat).toBeGreaterThan(0);
    expect(flat).toBeLessThan(burst);
  });

  it("bullets striking a wall leave holes, more of them the more it is shot", () => {
    const w = world(5);
    const b = w.buildings[0]!;
    const x = b.x + 1, y = b.y + b.h - 1;
    const i = w.map.idx(x, y);
    expect(w.map.holes[i]).toBe(0);
    const before = w.map.scars;
    w.map.scar(x, y);
    expect(holeStep(w.map.holes[i]!)).toBe(1);
    expect(w.map.scars).toBe(before + 1);
    for (let k = 0; k < 40; k++) w.map.scar(x, y);
    expect(holeStep(w.map.holes[i]!)).toBe(4);
    // The view is told only when the wall looks different, not on every round.
    expect(w.map.scars).toBe(before + 4);
  });
});

describe("the church tower", () => {
  it("its belfry stands well above an ordinary upper floor, and an MG crew often climbs it", () => {
    let towers = 0, mgs = 0;
    for (let seed = 1; seed <= 14; seed++) {
      const log = new EventLog({ retain: true });
      const w = createSimulation({ seed, log }).world;
      const church = w.buildings.find((b) => b.kind === "church");
      if (!church) continue;
      let tower: { x: number; y: number } | null = null;
      for (let y = church.y; y < church.y + church.h && !tower; y++) for (let x = church.x; x < church.x + church.w && !tower; x++) if (w.map.isTower(x, y)) tower = { x, y };
      expect(tower).not.toBeNull();
      const t = tower!;
      expect(w.map.passable(t.x, t.y, 2)).toBe(true);
      expect(w.map.heightAt(t.x, t.y, 2) - w.map.heightAt(t.x, t.y, 0)).toBeGreaterThan(2 * w.map.rules.floorHeight);
      towers++;
      const e = log.retained!.find((x) => x.type === "belfry_mg");
      if (e) {
        mgs++;
        const gunner = w.soldier(e.actors[0]!);
        expect(gunner.z).toBe(2);
        expect(w.map.isTower(gunner.x, gunner.y)).toBe(true);
      }
    }
    expect(towers).toBeGreaterThan(0);
    expect(mgs).toBeGreaterThan(0);
  });
});

describe("ambushes", () => {
  it("a squad lies in wait, flat and silent in cover, and springs it when the enemy comes close", async () => {
    let checked = false;
    for (const seed of [1, 3, 9, 11, 12, 14]) {
      const log = new EventLog({ retain: true });
      const engine = createSimulation({ seed, log, config: { ambush: { chance: 1 } } });
      const w = engine.world;
      const sq = w.squads.find((s) => s.state === "ambush");
      if (!sq) continue;
      const men = sq.members.map((id) => w.soldier(id));
      expect(men.every((m) => m.posture === "prone")).toBe(true);
      expect(men.filter((m) => ["woods", "brush", "orchard", "deadfall"].includes(w.map.at(m.x, m.y)) || w.map.besideCover(m.x, m.y)).length).toBeGreaterThanOrEqual(men.length - 1);
      expect(sq.orders.A.fire).toBe("hold");
      // Nobody in the ambush fires before it is sprung.
      let sprung = -1;
      for (let t = 0; t < 900 && sprung < 0 && w.phase === "battle"; t++) {
        await engine.step();
        const e = log.retained!.find((x) => x.type === "ambush_sprung");
        if (e) sprung = e.seq;
      }
      if (sprung < 0) continue;
      const early = log.retained!.find((x) => x.type === "fire" && sq.members.includes(x.data.by as number) && x.seq < sprung);
      expect(early).toBeUndefined();
      checked = true;
      break;
    }
    expect(checked).toBe(true);
  });
});
