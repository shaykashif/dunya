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
  for (const seed of [1, 2, 3, 6, 4]) {
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
        return s.role === "sniper" || r.world.squad(s.squadId).task === "scout";
      };
      const firstDefenderShot = r.events.find((e) => e.type === "fire" && e.data.side === defender && !outside(e.data.by as number));
      if (firstDefenderShot) expect(firstDefenderShot.seq).toBeGreaterThan(opened!.seq);
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
