import { describe, expect, it } from "vitest";
import { ReplayDivergenceError } from "../src/decision/sources.ts";
import { replayRun } from "../src/log/replay.ts";
import { createSimulation, runSimulation } from "../src/sim.ts";

describe("14.2 replay", () => {
  it("replaying the decision log reproduces the event stream", async () => {
    const { engine, summary } = await runSimulation({ seed: 42, days: 15 });
    const replay = await replayRun(42, 15, engine.decisionLog);
    expect(replay.consumed).toBe(engine.decisionLog.length);
    expect(replay.hash).toBe(summary.hash);
  });

  it("player interventions are logged and replayed", async () => {
    const engine = createSimulation({ seed: 9 });
    await engine.runDays(1);
    const w = engine.world;
    const victim = w.active().find((p) => w.ageYears(p) > 20)!;
    const madman = w.active().find((p) => w.ageYears(p) > 20 && p.householdId !== victim.householdId)!;
    engine.intervene({ kind: "smite", personId: victim.id });
    engine.intervene({ kind: "madden", personId: madman.id });
    await engine.runDays(2);
    expect(victim.alive).toBe(false);
    expect(victim.causeOfDeath).toBe("unknown");
    expect(engine.interventionLog.length).toBe(2);
    const replay = await replayRun(9, 3, engine.decisionLog, { interventions: engine.interventionLog });
    expect(replay.hash).toBe(w.log.hash());
  });

  it("a tampered decision log is detected", async () => {
    const { engine } = await runSimulation({ seed: 5, days: 2 });
    const log = engine.decisionLog.map((d) => ({ ...d }));
    const i = log.findIndex((d) => d.n > 1);
    log[i]!.index = (log[i]!.index + 1) % log[i]!.n;
    await expect(replayRun(5, 2, log)).rejects.toBeInstanceOf(ReplayDivergenceError);
  });
});
