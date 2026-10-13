import { ReplayDecisionSource, type DecisionRecord } from "../decision/sources.ts";
import type { ScheduledIntervention } from "../engine/interventions.ts";
import type { DeepPartial, SimConfig } from "../scenario/config.ts";
import { createSimulation } from "../sim.ts";
import { EventLog } from "./events.ts";

/**
 * Re-runs a battle from its seed and recorded decision log. The decision
 * source does no scoring; it replays recorded choices and fails loudly if the
 * engine offers different candidates than it did originally.
 */
export async function replayRun(
  seed: number,
  ticks: number,
  decisions: readonly DecisionRecord[],
  options: { config?: DeepPartial<SimConfig>; log?: EventLog; interventions?: readonly ScheduledIntervention[] } = {},
): Promise<{ hash: string; consumed: number; log: EventLog }> {
  const source = new ReplayDecisionSource(decisions);
  const log = options.log ?? new EventLog();
  const engine = createSimulation({ seed, config: options.config ?? {}, log, decisions: () => source });
  engine.schedule(options.interventions ?? []);
  await engine.runTicks(ticks);
  return { hash: log.hash(), consumed: source.consumed, log };
}
