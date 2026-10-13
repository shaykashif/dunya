import { UtilityDecisionSource } from "./decision/utility.ts";
import type { DecisionSource } from "./decision/types.ts";
import { Engine } from "./engine/engine.ts";
import { EventLog } from "./log/events.ts";
import { makeConfig, type DeepPartial, type SimConfig } from "./scenario/config.ts";
import { generateScenario } from "./scenario/generate.ts";
import type { MapKind, Side, WeatherKind } from "./world/types.ts";
import type { World } from "./world/world.ts";

export interface SimulationOptions {
  seed: number;
  config?: DeepPartial<SimConfig>;
  decisions?: (config: SimConfig, seed: number) => DecisionSource;
  retainEvents?: boolean;
  log?: EventLog;
}

export function createSimulation(opts: SimulationOptions): Engine {
  const config = makeConfig(opts.config ?? {});
  const log = opts.log ?? new EventLog({ retain: opts.retainEvents ?? false });
  const world = generateScenario(config, opts.seed, log);
  const decisions = opts.decisions ? opts.decisions(config, opts.seed) : new UtilityDecisionSource(opts.seed);
  return new Engine(world, decisions);
}

export interface SideSummary {
  men: number;
  killed: number;
  wounded: number;
  captured: number;
  fled: number;
  shots: number;
  hits: number;
}

export interface RunSummary {
  seed: number;
  ticks: number;
  clock: string;
  attacker: Side;
  /** What kind of place, and the weather. */
  map: MapKind;
  weather: WeatherKind;
  winner: Side | null;
  reason: string;
  us: SideSummary;
  de: SideSummary;
  grenades: number;
  mortarRounds: number;
  medicTreatments: number;
  diedLater: number;
  crippled: number;
  events: number;
  hash: string;
}

function sideSummary(w: World, side: Side): SideSummary {
  const all = w.side(side);
  return {
    men: all.length,
    killed: all.filter((s) => s.status === "dead").length,
    wounded: all.filter((s) => s.status !== "dead" && s.injuries.some((i) => !i.permanent && i.severity >= 0.1)).length,
    captured: all.filter((s) => s.status === "captured" || s.status === "surrendered").length,
    fled: all.filter((s) => s.status === "routed").length,
    shots: all.reduce((a, s) => a + s.shots, 0),
    hits: all.reduce((a, s) => a + s.hits, 0),
  };
}

export function summarize(world: World): RunSummary {
  const log = world.log;
  const after = Object.values(world.aftermath ?? {});
  return {
    seed: world.seed,
    ticks: world.tick,
    clock: world.clock(),
    attacker: world.attacker,
    map: world.layout.kind,
    weather: world.weather.kind,
    winner: world.result?.winner ?? null,
    reason: world.result?.reason ?? "still fighting",
    us: sideSummary(world, "us"),
    de: sideSummary(world, "de"),
    grenades: log.count("grenade_thrown"),
    mortarRounds: log.count("incoming"),
    medicTreatments: world.soldiers.filter((s) => s.role === "medic").reduce((a, s) => a + s.treated, 0),
    diedLater: after.filter((o) => o.died).length,
    crippled: after.filter((o) => !o.died && o.outcome.startsWith("will never")).length,
    events: log.size,
    hash: log.hash(),
  };
}

/** Runs a battle to its end (or for a fixed number of ticks). */
export async function runSimulation(opts: SimulationOptions & { ticks?: number }): Promise<{ engine: Engine; summary: RunSummary }> {
  const engine = createSimulation(opts);
  if (opts.ticks !== undefined) await engine.runTicks(opts.ticks);
  else await engine.runBattle();
  return { engine, summary: summarize(engine.world) };
}
