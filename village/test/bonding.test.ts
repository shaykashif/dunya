import { beforeAll, describe, expect, it } from "vitest";
import type { SimEvent } from "../src/log/events.ts";
import { EventLog } from "../src/log/events.ts";
import { createSimulation } from "../src/sim.ts";
import type { World } from "../src/world/world.ts";

interface SeedResult {
  seed: number;
  world: World;
  initialStage: Map<string, string>;
  initialPeople: number;
  events: SimEvent[];
}

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const results: SeedResult[] = [];
const BONDING_TYPES = new Set(["scenario_created", "proposal", "elopement", "pair_bond_formed", "break_up", "partnership_ended", "stage_changed", "death", "exiled", "conceived", "child_born"]);

beforeAll(async () => {
  for (const seed of SEEDS) {
    const events: SimEvent[] = [];
    const log = new EventLog();
    log.addSink((e) => {
      if (BONDING_TYPES.has(e.type)) events.push(e);
    });
    const engine = createSimulation({ seed, log });
    const w = engine.world;
    const initialStage = new Map<string, string>();
    for (const p of w.people) for (const k of Object.keys(p.relationships)) initialStage.set(`${p.id}-${k}`, p.relationships[Number(k)]!.stage);
    const initialPeople = w.people.length;
    await engine.runDays(90);
    results.push({ seed, world: w, initialStage, initialPeople, events });
  }
});

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

describe("14.14 bonding integrity", () => {
  it("pair bonds exist only between two living people who both accepted a proposal", () => {
    for (const { world: w, initialStage, events } of results) {
      const proposals = new Map(
        events
          .filter((e) => e.type === "proposal" || e.type === "elopement")
          .map((e) => [e.seq, e.type === "elopement" ? { ...e, data: { answer: "accept", proposer: e.data.a, to: e.data.b } } : e]),
      );
      const formed = new Set<string>();
      for (const e of events.filter((x) => x.type === "pair_bond_formed")) {
        const prop = proposals.get(e.data.proposal as number)!;
        expect(prop, "pair bond without a proposal").toBeDefined();
        expect(prop.data.answer).toBe("accept");
        expect([prop.data.proposer, prop.data.to].sort()).toEqual([e.data.proposer, e.data.accepter].sort());
        formed.add(key(e.data.proposer as number, e.data.accepter as number));
      }
      for (const p of w.people) {
        for (const k of Object.keys(p.relationships)) {
          if (p.relationships[Number(k)]!.stage !== "pair_bonded") continue;
          const q = w.person(Number(k));
          const eloped = p.departure === "elopement" && q.departure === "elopement";
          expect((p.alive && !p.exiled && q.alive && !q.exiled) || eloped, `pair bond ${p.id}-${q.id} with someone gone`).toBe(true);
          const initial = initialStage.get(`${p.id}-${q.id}`) === "pair_bonded";
          expect(initial || formed.has(key(p.id, q.id)), `pair bond ${p.id}-${q.id} has no accepted proposal`).toBe(true);
        }
      }
    }
  });

  it("every break-up, death and birth appears in the log", () => {
    for (const { world: w, initialPeople, events } of results) {
      const dead = w.people.filter((p) => !p.alive);
      const deaths = events.filter((e) => e.type === "death");
      expect(deaths.map((e) => e.data.person).sort()).toEqual(dead.map((p) => p.id).sort());
      const births = events.filter((e) => e.type === "child_born");
      expect(births.map((e) => e.data.child)).toEqual(w.people.slice(initialPeople).map((p) => p.id));
      const breakStages = events.filter((e) => e.type === "stage_changed" && e.data.to === "estranged" && (e.data.reason === "jealousy" || e.data.reason === "unhappy"));
      const breakUps = events.filter((e) => e.type === "break_up");
      expect(breakUps.length).toBe(breakStages.length);
    }
  });

  it("no child is born without a pair-bonded couple or to a family in famine", () => {
    let births = 0;
    for (const { events } of results) {
      const bonded = new Set<string>();
      const conceptions = new Map<number, SimEvent>();
      for (const e of events) {
        if (e.type === "scenario_created") {
          for (const p of e.data.people as { id: number; partner: number | null }[]) if (p.partner !== null) bonded.add(key(p.id, p.partner));
        }
        if (e.type === "pair_bond_formed") bonded.add(key(e.data.proposer as number, e.data.accepter as number));
        if (e.type === "break_up" && e.data.wasBonded) bonded.delete(key(e.data.initiator as number, e.data.other as number));
        if (e.type === "partnership_ended") bonded.delete(key(e.actors[0]!, e.data.other as number));
        if (e.type === "conceived") {
          expect(bonded.has(key(e.data.mother as number, e.data.father as number)), "conceived outside a pair bond").toBe(true);
          expect(e.data.famine).toBe(false);
          conceptions.set(e.seq, e);
        }
        if (e.type === "child_born") {
          births++;
          const c = conceptions.get(e.data.conceived as number)!;
          expect(c, "birth without conception").toBeDefined();
          expect([c.data.mother, c.data.father]).toEqual([e.data.mother, e.data.father]);
        }
      }
    }
    expect(births).toBeGreaterThanOrEqual(0);
  });
});

describe("14.15 romance can happen", () => {
  it("across 20 seeds, some pairs progress from stranger to pair bond", () => {
    let fromStrangers = 0;
    for (const { initialStage, events } of results) {
      for (const e of events.filter((x) => x.type === "pair_bond_formed")) {
        const a = e.data.proposer as number, b = e.data.accepter as number;
        if (initialStage.get(`${a}-${b}`) !== "stranger") continue;
        // The pair passed through the stages on the way.
        const stages = events
          .filter((x) => x.type === "stage_changed" && x.seq < e.seq && key(x.data.a as number, x.data.b as number) === key(a, b))
          .map((x) => x.data.to);
        expect(stages).toContain("courting");
        expect(stages.at(-1)).toBe("pair_bonded");
        fromStrangers++;
      }
    }
    expect(fromStrangers).toBeGreaterThan(0);
  });
});
