import { beforeAll, describe, expect, it } from "vitest";
import type { Engine } from "../src/engine/engine.ts";
import { hasConflict } from "../src/justice/justice.ts";
import type { SimEvent } from "../src/log/events.ts";
import { EventLog } from "../src/log/events.ts";
import { createSimulation, summarize, type RunSummary } from "../src/sim.ts";

let engine: Engine;
let summary: RunSummary;
let events: SimEvent[];
const conflicted: string[] = [];
let verdictsChecked = 0;

beforeAll(async () => {
  // checkInvariants is on by default: the run throws if any invariant fails on any tick.
  const log = new EventLog({ retain: true });
  // Kinship can change later (marriages), so conflicts are checked when each verdict is given.
  log.addSink((e) => {
    if (e.type !== "verdict") return;
    const w = engine.world;
    const h = w.hearings.find((x) => x.id === e.data.hearing)!;
    verdictsChecked++;
    for (const j of h.judges) if (hasConflict(w, w.person(j), w.person(h.accusedId), h.victim)) conflicted.push(`hearing ${h.id} judge ${j}`);
  });
  engine = createSimulation({ seed: 42, log });
  const start = engine.world.active().length;
  await engine.runDays(90);
  summary = summarize(engine.world, 90, start);
  events = log.retained!;
});

describe("14.10 smoke run", () => {
  it("a 90-day run completes with all invariants passing", () => {
    expect(summary.ticks).toBe(90 * 144);
    expect(summary.population).toBeGreaterThan(0);
    expect(events.length).toBe(summary.events);
  });
});

describe("14.4 no dead actors", () => {
  it("a dead or exiled person never acts in later events", () => {
    const gone = new Map<number, number>();
    for (const e of events) {
      for (const a of e.actors) {
        const since = gone.get(a);
        expect(since === undefined || e.seq <= since, `person ${a} acted in ${e.type} #${e.seq} after leaving at #${since}`).toBe(true);
      }
      if (e.type === "death") gone.set(e.data.person as number, e.seq);
      if (e.type === "departed") gone.set(e.data.person as number, e.seq);
    }
  });
});

describe("14.9 starvation pressure", () => {
  it("at least one theft happens within 60 days, unscripted", () => {
    const early = events.filter((e) => e.type === "theft" && e.tick < 60 * 144);
    expect(early.length).toBeGreaterThan(0);
  });
});

describe("14.5 perception bounds", () => {
  it("every belief has a source event of the right kind", () => {
    const bySeq = new Map(events.map((e) => [e.seq, e]));
    const allowed: Record<string, string[]> = {
      saw: ["perceived", "action_witnessed", "trace_discovered", "theft", "theft_failed", "attack", "intimidation", "food_requested", "apprehended"],
      heard: ["statement", "perceived", "accusation"],
      inferred: ["deduction"],
    };
    let checked = 0;
    for (const p of engine.world.people) {
      for (const b of p.beliefs) {
        const src = bySeq.get(b.sourceSeq);
        expect(src, `belief ${b.id} of ${p.id} has no source event`).toBeDefined();
        expect(allowed[b.source], `belief ${b.id} source ${b.source} from ${src!.type}`).toContain(src!.type);
        expect(src!.seq).toBeLessThan(Number.MAX_SAFE_INTEGER);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    const added = events.filter((e) => e.type === "belief_added");
    for (const e of added) {
      const b = e.data.belief as { sourceSeq: number };
      expect(b.sourceSeq).toBeLessThan(e.seq);
    }
  });
});

describe("14.7 conflict of interest (whole run)", () => {
  it("no hearing was judged by kin of the accused or the victim", () => {
    expect(verdictsChecked).toBeGreaterThan(0);
    expect(conflicted).toEqual([]);
  });
});
