// Whole battles: they end, the rules hold every tick (the engine checks its
// invariants), and the tactics the fork is about actually happen.
import { beforeAll, describe, expect, it } from "vitest";
import { firstBlood, verdict } from "../src/battle/verdict.ts";
import { EventLog, type SimEvent } from "../src/log/events.ts";
import { createSimulation } from "../src/sim.ts";
import type { World } from "../src/world/world.ts";

interface Run {
  world: World;
  events: SimEvent[];
}

const runs: Run[] = [];

beforeAll(async () => {
  for (const seed of [1, 2, 3, 6, 4, 24]) {
    const log = new EventLog({ retain: true });
    const engine = createSimulation({ seed, log });
    await engine.runBattle();
    runs.push({ world: engine.world, events: log.retained! });
  }
});

describe("battles", () => {
  it("every battle reaches a result within the time limit", () => {
    for (const r of runs) {
      expect(r.world.phase).toBe("over");
      expect(r.world.result).not.toBeNull();
      expect(r.world.tick).toBeLessThanOrEqual(r.world.config.time.maxTicks + 1);
    }
  });

  it("men are hit, and every death has a cause", () => {
    for (const r of runs) {
      expect(r.world.soldiers.some((s) => s.injuries.length > 0)).toBe(true);
      for (const s of r.world.soldiers.filter((x) => x.status === "dead")) {
        expect(s.causeOfDeath).not.toBeNull();
        expect(s.act).toBeNull();
      }
    }
  });

  it("squads fight by fire and manoeuvre: contact, flanks, assaults, grenades and mortars", () => {
    const all = runs.flatMap((r) => r.events);
    const states = new Set(all.filter((e) => e.type === "squad_state").map((e) => e.data.to as string));
    expect(states.has("react")).toBe(true);
    expect(states.has("flank")).toBe(true);
    expect(states.has("assault")).toBe(true);
    expect(all.some((e) => e.type === "fire_mission")).toBe(true);
    expect(all.some((e) => e.type === "grenade_thrown")).toBe(true);
  });

  it("defenders hold their fire until the enemy is in the open or shooting", () => {
    for (const r of runs) {
      const opened = r.events.find((e) => e.type === "open_fire");
      expect(opened).toBeDefined();
      const defender = r.world.attacker === "us" ? "de" : "us";
      // A sniper works alone, outside his squad's fire discipline; a forward team fires only to defend itself.
      const outside = (id: number) => {
        const s = r.world.soldier(id);
        // Tanks and guns open fire at what is close enough to be certain; that is their own rule.
        return s.role === "sniper" || r.world.squad(s.squadId).task === "scout" || s.role === "tank" || s.role === "field_gun" || s.role === "gun_crew";
      };
      const firstDefenderShot = r.events.find((e) => e.type === "fire" && e.data.side === defender && !outside(e.data.by as number));
      // They may answer once the enemy has opened fire on them (a recon sniper, say), without waiting for the order.
      const attacker = r.world.attacker;
      const firstAttackerShot = r.events.find((e) => e.type === "fire" && e.data.side === attacker);
      if (firstDefenderShot) expect(firstDefenderShot.seq).toBeGreaterThan(Math.min(opened!.seq, firstAttackerShot?.seq ?? Infinity));
    }
  });

  it("squads get out from under mortar fire, and snipers find hides", () => {
    const all = runs.flatMap((r) => r.events);
    expect(all.some((e) => e.type === "shelled")).toBe(true);
    expect(all.some((e) => e.type === "squad_state" && e.data.to === "displace")).toBe(true);
    expect(all.some((e) => e.type === "sniper_hide")).toBe(true);
  });

  it("squads radio or send runners for help and the platoon sends it; houses are cleared with grenades", () => {
    const all = runs.flatMap((r) => r.events);
    expect(all.some((e) => e.type === "help_call")).toBe(true);
    expect(all.some((e) => e.type === "help_sent" && e.data.squad !== null)).toBe(true);
    expect(all.some((e) => e.type === "breach" && e.data.stage === "grenades")).toBe(true);
    expect(all.some((e) => e.type === "decision" && String(e.data.key).startsWith("breach:"))).toBe(true);
  });

  it("medics treat the wounded, and men take over a fallen leader's squad", () => {
    expect(runs.some((r) => r.events.some((e) => e.type === "wounds_treated" && r.world.maybe(e.data.by as number)?.role === "medic"))).toBe(true);
    expect(runs.some((r) => r.events.some((e) => e.type === "takes_command"))).toBe(true);
  });

  it("every result has a character and a first man to fall", () => {
    for (const r of runs) {
      const v = verdict(r.world);
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.score).toBeGreaterThanOrEqual(0);
      expect(v.score).toBeLessThanOrEqual(100);
      for (const side of ["us", "de"] as const) expect(v.losses[side].irrecoverable).toBeLessThanOrEqual(v.losses[side].start);
      const fb = firstBlood(r.world);
      const dead = r.world.soldiers.filter((s) => s.status === "dead");
      expect(fb === null).toBe(dead.length === 0);
      if (fb) expect(dead.every((s) => (s.deathTick ?? 0) >= fb.tick)).toBe(true);
    }
  });

  it("armour is attached to the platoon, outside its headcount, and behaves", () => {
    // Seeds known to field armour: a tank each side, an attacking tank, a defending tank and gun.
    for (const r of runs) {
      for (const t of r.world.tanks.values()) {
        const v = r.world.soldier(t.id);
        expect(["tank", "field_gun"]).toContain(v.role);
        expect(r.world.side(t.side).includes(v)).toBe(false);
        for (const id of t.crew) expect(r.world.side(t.side).includes(r.world.soldier(id))).toBe(false);
        // A wreck blocks its tile and does nothing.
        if (t.state === "wrecked") expect(v.conscious).toBe(false);
        // Nobody inside a tank is also standing on the ground.
        for (const id of t.crew) {
          const c = r.world.soldier(id);
          if (c.status === "aboard") expect(r.world.occupancy[r.world.map.cell(c.x, c.y, c.z)]).toBe(t.kind === "tank" ? v.id : r.world.occupancy[r.world.map.cell(c.x, c.y, c.z)]);
        }
      }
      expect(r.world.soldiers.filter((s) => s.role === "at_gunner").length).toBeGreaterThanOrEqual(4);
    }
  });

  it("the aftermath covers every wounded survivor", () => {
    for (const r of runs) {
      const after = r.world.aftermath!;
      expect(after).not.toBeNull();
      for (const s of r.world.soldiers) {
        if (s.status === "dead" || !s.injuries.some((i) => !i.permanent && i.severity >= 0.1)) continue;
        expect(after[s.id], s.name).toBeDefined();
      }
    }
  });
});
