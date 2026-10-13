import type { ResolveCtx } from "../src/actions/types.ts";
import { ScriptedDecisionSource } from "../src/decision/sources.ts";
import type { SimEvent } from "../src/log/events.ts";
import { UtilityDecisionSource } from "../src/decision/utility.ts";
import { updateEnvironment } from "../src/world/environment.ts";
import { EventLog } from "../src/log/events.ts";
import { makeConfig, type DeepPartial, type SimConfig } from "../src/scenario/config.ts";
import { generateScenario } from "../src/scenario/generate.ts";
import type { World } from "../src/world/world.ts";

export function freshWorld(seed = 42, overrides: DeepPartial<SimConfig> = {}, retain = true): World {
  const w = generateScenario(makeConfig(overrides), seed, new EventLog({ retain }));
  return w;
}

/** First tick at or after `from` whose clock hour equals `hour`. */
export function tickAtHour(w: World, hour: number, from = 0): number {
  const cfg = w.config.time;
  for (let t = from; t < from + cfg.ticksPerDay * 2; t++) {
    const minute = (cfg.startHour * 60 + t * cfg.minutesPerTick) % 1440;
    if (minute === hour * 60) return t;
  }
  throw new Error("hour not found");
}

export function setTick(w: World, tick: number): void {
  w.tick = tick;
  updateEnvironment(w);
}

/** Moves everyone not listed into their own house, out of sight. */
export function sendHome(w: World, except: readonly number[]): void {
  for (const p of w.people) {
    if (except.includes(p.id)) continue;
    const bed = w.house(p.householdId).bed;
    p.x = bed.x;
    p.y = bed.y;
    p.plan = null;
    p.asleep = true;
  }
}

export function idleSource(config: SimConfig): ScriptedDecisionSource {
  return new ScriptedDecisionSource((_p, cands) => cands.findIndex((c) => c.key === "idle"), new UtilityDecisionSource(config));
}

export function ctxFor(w: World): ResolveCtx {
  const events: SimEvent[] = [];
  return {
    rng: w.rng.get("actions"),
    response: null,
    responseOptions: null,
    responses: [],
    success: true,
    events,
    emit(type, actors, data) {
      const e = w.emit(type, actors, data);
      events.push(e);
      return e;
    },
  };
}
