// Player interventions ("god powers"). They change the world directly, are
// logged as events, and are replayed from their own log. Villagers only ever
// learn of them through what they can perceive afterwards.
import { kill } from "../entities/death.ts";
import { makeMad } from "../entities/madness.ts";
import { createTrace } from "../world/traces.ts";
import type { MadKind } from "../world/types.ts";
import type { World } from "../world/world.ts";

export type Intervention =
  | { kind: "smite"; personId: number }
  | { kind: "smite_animal"; animalId: number }
  | { kind: "madden"; personId: number; madKind?: MadKind };

export interface ScheduledIntervention {
  tick: number;
  cmd: Intervention;
}

export function applyIntervention(w: World, cmd: Intervention): void {
  w.emit("intervention", [], { ...cmd });
  if (cmd.kind === "smite") {
    const p = w.maybePerson(cmd.personId);
    if (p && p.alive && !p.exiled) kill(w, p, "unknown", null, null);
  } else if (cmd.kind === "madden") {
    const p = w.maybePerson(cmd.personId);
    if (p && p.alive && !p.exiled) makeMad(w, p, "a madness came upon them from nowhere", cmd.madKind);
  } else {
    const a = w.animals.find((x) => x.id === cmd.animalId && x.alive);
    if (!a) return;
    a.alive = false;
    if (a.riderId !== null) {
      const rider = w.maybePerson(a.riderId);
      if (rider) rider.ridingHorseId = null;
      a.riderId = null;
    }
    createTrace(w, "blood", { x: a.x, y: a.y }, [], { what: a.kind }, null);
    w.emit("animal_died", [], { animal: a.id, kind: a.kind, cause: "struck down", at: [a.x, a.y] });
  }
}
