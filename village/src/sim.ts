import { UtilityDecisionSource } from "./decision/utility.ts";
import type { DecisionSource } from "./decision/types.ts";
import { Engine } from "./engine/engine.ts";
import { EventLog } from "./log/events.ts";
import { makeConfig, type DeepPartial, type SimConfig } from "./scenario/config.ts";
import { generateScenario } from "./scenario/generate.ts";
import type { World } from "./world/world.ts";

export interface SimulationOptions {
  seed: number;
  config?: DeepPartial<SimConfig>;
  decisions?: (config: SimConfig) => DecisionSource;
  retainEvents?: boolean;
  log?: EventLog;
}

export function createSimulation(opts: SimulationOptions): Engine {
  const config = makeConfig(opts.config ?? {});
  const log = opts.log ?? new EventLog({ retain: opts.retainEvents ?? false });
  const world = generateScenario(config, opts.seed, log);
  const decisions = opts.decisions ? opts.decisions(config) : new UtilityDecisionSource(config);
  return new Engine(world, decisions);
}

export interface RunSummary {
  seed: number;
  days: number;
  ticks: number;
  population: number;
  startPopulation: number;
  births: number;
  deaths: number;
  deathCauses: Record<string, number>;
  exiled: number;
  thefts: number;
  failedThefts: number;
  attacks: number;
  accusations: number;
  verdicts: number;
  guilty: number;
  wrongful: number;
  pairBonds: number;
  breakUps: number;
  events: number;
  hash: string;
}

export function summarize(world: World, days: number, startPopulation: number): RunSummary {
  const log = world.log;
  const deathCauses: Record<string, number> = {};
  for (const p of world.people) if (!p.alive && p.causeOfDeath) deathCauses[p.causeOfDeath] = (deathCauses[p.causeOfDeath] ?? 0) + 1;
  const verdicts = world.hearings.filter((h) => h.status === "held");
  return {
    seed: world.seed,
    days,
    ticks: world.tick,
    population: world.active().length,
    startPopulation,
    births: log.count("child_born"),
    deaths: log.count("death"),
    deathCauses,
    exiled: world.people.filter((p) => p.exiled).length,
    thefts: log.count("theft"),
    failedThefts: log.count("theft_failed"),
    attacks: log.count("attack"),
    accusations: log.count("accusation"),
    verdicts: log.count("verdict"),
    guilty: world.people.reduce((a, p) => a + p.convictions, 0),
    wrongful: verdicts.length === 0 ? 0 : wrongfulCount(world),
    pairBonds: log.count("pair_bond_formed"),
    breakUps: log.count("break_up"),
    events: log.size,
    hash: log.hash(),
  };
}

function wrongfulCount(world: World): number {
  let n = 0;
  for (const h of world.hearings) {
    if (h.status !== "held" || h.crimeId === null) continue;
    const crime = world.crimes.find((c) => c.id === h.crimeId);
    const convicted = world.sentences.some((s) => s.hearingId === h.id);
    if (crime && convicted && crime.actorId !== h.accusedId) n++;
  }
  return n;
}

export async function runSimulation(opts: SimulationOptions & { days: number }): Promise<{ engine: Engine; summary: RunSummary }> {
  const engine = createSimulation(opts);
  const start = engine.world.active().length;
  await engine.runDays(opts.days);
  return { engine, summary: summarize(engine.world, opts.days, start) };
}
