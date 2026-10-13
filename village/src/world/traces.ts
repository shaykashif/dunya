import type { EntityRef, Point, Trace, TraceKind } from "./types.ts";
import { isPrecipitating } from "./environment.ts";
import type { World } from "./world.ts";

export function createTrace(
  w: World,
  kind: TraceKind,
  location: Point,
  involves: EntityRef[],
  details: Record<string, unknown>,
  crimeId: number | null,
): Trace {
  const trace: Trace = {
    id: w.nextId("trace"),
    tick: w.tick,
    location: { x: location.x, y: location.y },
    kind,
    involves,
    details,
    discovered: false,
    roofed: w.map.roofed(location.x, location.y),
    rainExposure: 0,
    crimeId,
    discoveredTick: null,
  };
  w.traces.push(trace);
  w.emit("trace_created", [], {
    trace: trace.id,
    kind,
    at: [location.x, location.y],
    roofed: trace.roofed,
    involves,
    details,
    crime: crimeId,
  });
  return trace;
}

export function removeTrace(w: World, trace: Trace, reason: string): void {
  const i = w.traces.indexOf(trace);
  if (i >= 0) w.traces.splice(i, 1);
  w.emit("trace_removed", [], { trace: trace.id, kind: trace.kind, reason });
}

/**
 * Trace persistence rules: precipitation clears footprints on open ground,
 * traces expire after their configured lifetime, and discovered bodies are buried.
 */
export function updateTraces(w: World): void {
  const cfg = w.config.traces;
  const wet = isPrecipitating(w.env.weather);
  const lifetimes = cfg.lifetimeDays as Record<TraceKind, number>;
  for (const trace of w.traces.slice()) {
    if (trace.kind === "footprint" && !trace.roofed && wet) {
      trace.rainExposure++;
      if (trace.rainExposure >= cfg.rainClearTicks) {
        removeTrace(w, trace, w.env.weather === "snow" ? "snow" : "rain");
        continue;
      }
    }
    if (trace.kind === "body") {
      // Buried once the council has ruled on the death, or after a while regardless.
      if (trace.discoveredTick !== null && (trace.details.inquestDone === true || w.tick - trace.discoveredTick >= w.days(cfg.burialDelayDays * 2))) {
        removeTrace(w, trace, "burial");
        const who = trace.involves.find((r) => r.kind === "person");
        if (who && who.kind === "person") {
          // Rows of graves beside the town square.
          const i = w.graves.length;
          const sq = w.map.square;
          w.graves.push({ personId: who.id, tick: w.tick, x: sq.x - 10 + (i % 4), y: sq.y + 6 + Math.floor(i / 4), marked: false });
          w.emit("burial", [], { person: who.id });
        }
      }
      continue;
    }
    if (w.tick - trace.tick >= w.days(lifetimes[trace.kind])) removeTrace(w, trace, "expired");
  }
}
