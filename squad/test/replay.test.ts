import { describe, expect, it } from "vitest";
import { ReplayDivergenceError } from "../src/decision/sources.ts";
import { replayRun } from "../src/log/replay.ts";
import { createSimulation, runSimulation } from "../src/sim.ts";

describe("replay", () => {
  it("replaying the decision log reproduces the event stream", async () => {
    const { engine, summary } = await runSimulation({ seed: 42, ticks: 600 });
    const replay = await replayRun(42, 600, engine.decisionLog);
    expect(replay.consumed).toBe(engine.decisionLog.length);
    expect(replay.hash).toBe(summary.hash);
  });

  it("player interventions are logged and replayed", async () => {
    const engine = createSimulation({ seed: 9 });
    await engine.runTicks(200);
    const w = engine.world;
    const target = w.soldiers.find((s) => s.side !== w.attacker && w.able(s))!;
    engine.intervene({ kind: "sniper", personId: target.id });
    engine.intervene({ kind: "artillery", x: target.x, y: target.y + 3 });
    engine.intervene({ kind: "smoke", x: 40, y: 60 });
    await engine.runTicks(100);
    expect(target.injuries.length).toBeGreaterThan(0);
    expect(engine.interventionLog.length).toBe(3);
    expect(w.log.count("explosion")).toBeGreaterThanOrEqual(6);
    const replay = await replayRun(9, 300, engine.decisionLog, { interventions: engine.interventionLog });
    expect(replay.hash).toBe(w.log.hash());
  });

  it("a tampered decision log is detected", async () => {
    const { engine } = await runSimulation({ seed: 5, ticks: 150 });
    const log = engine.decisionLog.map((d) => ({ ...d }));
    const i = log.findIndex((d) => d.n > 1);
    log[i]!.index = (log[i]!.index + 1) % log[i]!.n;
    await expect(replayRun(5, 150, log)).rejects.toBeInstanceOf(ReplayDivergenceError);
  });
});
