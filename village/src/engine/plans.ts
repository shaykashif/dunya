import type { Person } from "../world/types.ts";
import type { World } from "../world/world.ts";

/** Cancels a person's current plan (attacked, woken by noise, detained). */
export function interruptPlan(w: World, p: Person, reason: string): void {
  if (p.plan) {
    w.emit("plan_interrupted", p.alive && !p.exiled ? [p.id] : [], { person: p.id, kind: p.plan.cand.kind, key: p.plan.cand.key, reason });
  }
  p.plan = null;
  p.asleep = false;
}
