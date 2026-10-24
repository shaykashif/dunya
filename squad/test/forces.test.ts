// The forest line, the American machine-gun teams, rounds through cover,
// runners who are men of the squad, and men who see and hit what is close and
// get out of the open.
import { describe, expect, it } from "vitest";
import { hitChance } from "../src/combat/fire.ts";
import { lineResist, through } from "../src/combat/penetration.ts";
import { EventLog } from "../src/log/events.ts";
import { createSimulation } from "../src/sim.ts";
import { isMachineGun, type Soldier } from "../src/world/types.ts";
import type { World } from "../src/world/world.ts";

function world(seed: number, config: Parameters<typeof createSimulation>[0]["config"] = {}): World {
  return createSimulation({ seed, config }).world;
}

/** Flat grass over a patch, with one tile of `wall` at (x, y). */
function field(w: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      w.map.set(x, y, "grass");
      w.map.elev[w.map.idx(x, y)] = 0;
    }
  }
  w.map.finalize();
}

describe("the forest line", () => {
  it("is forest and rock with two trench lines and a torn no man's land between, a lodge and huts, and the crossroads in reach", () => {
    for (const seed of [1, 2, 3]) {
      const w = world(seed, { map: { kind: "forest" }, season: { kind: "winter" } });
      const L = w.layout;
      expect(L.kind).toBe("forest");
      const share = (...k: string[]) => w.map.terrain.filter((t) => k.includes(t)).length / w.map.terrain.length;
      expect(share("woods", "brush", "deadfall")).toBeGreaterThan(0.6);
      expect(share("rock")).toBeGreaterThan(0.003);
      expect(share("wheat", "hedge")).toBe(0);
      // A trench across the width in front of the defenders, and one in front of the attackers.
      const ditchRow = (y0: number, y1: number) => {
        let cols = 0;
        for (let x = 0; x < w.map.width; x++) for (let y = y0; y <= y1; y++) if (w.map.at(x, y) === "ditch") { cols++; break; }
        return cols / w.map.width;
      };
      expect(ditchRow(L.line.y - 3, L.line.y + 3)).toBeGreaterThan(0.85);
      expect(ditchRow(w.map.height - 17, w.map.height - 11)).toBeGreaterThan(0.75);
      expect(L.mgPositions.length).toBeGreaterThanOrEqual(6);
      expect(w.buildings.length).toBeGreaterThanOrEqual(2);
      expect(w.buildings.length).toBeLessThanOrEqual(4);
      expect(w.buildings.some((b) => b.name === "the forester's lodge")).toBe(true);
      const attacker = w.side(w.attacker)[0]!;
      expect(w.map.reachable(attacker, L.objective)).toBe(true);
    }
  });

  it("comes up only in winter", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = world(seed);
      if (w.layout.kind === "forest") expect(w.season).toBe("winter");
    }
  });
});

describe("rounds through cover", () => {
  it("a rifle goes through a door and a little through a hedge; a pistol barely; a .50 through most of it; stone stops all but the .50", () => {
    const w = world(3);
    const W = w.config.weapons, R = w.config.penetration.resist;
    expect(through(W.m1_garand, R.door!)).toBeGreaterThan(0.7);
    expect(through(W.m1_garand, R.hedge!)).toBeGreaterThan(0.05);
    expect(through(W.m1_garand, R.hedge!)).toBeLessThan(0.25);
    expect(through(W.pistol, R.hedge!)).toBe(0);
    expect(through(W.m2hb, R.hedge!)).toBeGreaterThan(0.5);
    expect(through(W.m1_garand, R.building!)).toBe(0);
    expect(through(W.mg42, R.wall!)).toBe(0);
    expect(through(W.m2hb, R.wall!)).toBeGreaterThan(0);
  });

  it("a man behind a log wall can be hit through it, less often than one in the open", () => {
    const w = world(3);
    field(w, 40, 40, 70, 60);
    const [a, b] = w.soldiers.filter((s) => s.side === "us" && s.role === "rifleman") as [Soldier, Soldier];
    w.place(a, 50, 50, 0);
    w.place(b, 50, 42, 0);
    a.posture = "crouch";
    b.posture = "crouch";
    const spec = w.config.weapons.m1_garand;
    const open = hitChance(w, b, a, spec, 1);
    w.map.set(50, 49, "sandbags");
    w.map.finalize();
    const behindSandbags = hitChance(w, b, a, spec, 1);
    w.map.set(50, 49, "door");
    w.map.finalize();
    const behindDoor = hitChance(w, b, a, spec, 1);
    expect(behindSandbags).toBeLessThan(open);
    expect(behindDoor).toBeGreaterThan(behindSandbags);
    expect(behindDoor).toBeLessThan(open);
    // Through a hedge bank he cannot see the man, but the line is not wholly stopped.
    w.map.set(50, 46, "hedge");
    w.map.finalize();
    expect(through(spec, lineResist(w, b, a).resist)).toBeGreaterThan(0);
  });
});

describe("close in", () => {
  it("a man a few paces off is seen quickly and hit far more often than at a hundred metres", () => {
    const w = world(3);
    field(w, 30, 30, 90, 90);
    const us = w.soldiers.find((s) => s.side === "us" && s.role === "rifleman")!;
    const de = w.soldiers.find((s) => s.side === "de" && s.role === "rifleman")!;
    w.place(us, 50, 50, 0);
    w.place(de, 50, 54, 0);
    de.posture = "prone";
    const near = hitChance(w, us, de, w.config.weapons.m1_garand, 1);
    w.place(de, 50, 84, 0);
    const far = hitChance(w, us, de, w.config.weapons.m1_garand, 1);
    expect(near).toBeGreaterThan(0.45);
    expect(near).toBeGreaterThan(far * 4);
  });
});

describe("machine-gun teams", () => {
  it("an American platoon may have a Browning .30 or .50 team, which sets up before it fires and puts out a great deal of fire", async () => {
    let fired = 0, teams = 0, heavy = 0;
    for (const [seed, de] of [[3, false], [11, true], [21, false]] as const) {
      const log = new EventLog({ retain: true });
      const engine = createSimulation({ seed, log, config: { forces: { usMgTeamChance: 1, germanAttackChance: de ? 1 : 0 } } });
      const w = engine.world;
      const sq = w.squads.find((q) => q.task === "mg")!;
      expect(sq).toBeDefined();
      expect(w.platoons.us.mgIds).toContain(sq.id);
      const gunner = sq.members.map((id) => w.soldier(id)).find((m) => isMachineGun(m.weapon))!;
      expect(["m1919", "m2hb"]).toContain(gunner.weapon);
      if (gunner.weapon === "m2hb") heavy++;
      teams++;
      // Never fires within its setup time of having been carried.
      let early = 0;
      log.addSink((e) => {
        if (e.type !== "fire" || e.data.by !== gunner.id) return;
        const moved = gunner.cooldowns["movedAt"];
        if (moved !== undefined && w.tick - moved < w.config.weapons[gunner.weapon!].setup!) early++;
      });
      await engine.runTicks(1500);
      expect(early).toBe(0);
      fired += log.retained!.filter((e) => e.type === "fire" && e.data.by === gunner.id).reduce((a, e) => a + (e.data.rounds as number), 0);
    }
    expect(teams).toBe(3);
    expect(fired).toBeGreaterThan(300);
    expect(heavy).toBeLessThan(3);
  });
});

describe("runners", () => {
  it("a German runner is a man of his squad who runs to the Zugführer, and can be shot down on the way", async () => {
    let calls = 0;
    for (const seed of [3, 6, 11]) {
      const log = new EventLog({ retain: true });
      const engine = createSimulation({ seed, log });
      const w = engine.world;
      const runners = new Set<number>();
      for (let t = 0; t < 1800 && w.phase === "battle"; t++) {
        await engine.step();
        for (const r of w.runners) {
          const m = w.soldier(r.soldierId);
          expect(m.squadId).toBe(r.squadId);
          expect(Math.abs(m.x - r.x)).toBeLessThanOrEqual(3);
          runners.add(r.soldierId);
        }
      }
      calls += runners.size;
      for (const e of log.retained!.filter((x) => x.type === "runner_killed" && x.data.by !== "broke")) expect(w.soldier(e.data.person as number).status).not.toBe("active");
    }
    expect(calls).toBeGreaterThan(0);
  });
});
