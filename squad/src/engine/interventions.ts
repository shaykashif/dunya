// Player interventions: queued, applied at the start of the next tick, logged,
// and replayed exactly. Soldiers learn of them only through what they see and hear.
import { bulletWound } from "../combat/fire.ts";
import type { Ordnance } from "../world/types.ts";
import type { World } from "../world/world.ts";

export type Intervention =
  /** A 105 mm barrage: six shells around the point. */
  | { kind: "artillery"; x: number; y: number }
  /** Smoke shells to blind a stretch of ground. */
  | { kind: "smoke"; x: number; y: number }
  /** A shot from an unseen sniper. */
  | { kind: "sniper"; personId: number };

export interface ScheduledIntervention {
  tick: number;
  cmd: Intervention;
}

export function applyIntervention(w: World, cmd: Intervention): void {
  const rng = w.rng.get("ordnance");
  switch (cmd.kind) {
    case "artillery":
    case "smoke": {
      const n = cmd.kind === "artillery" ? 6 : 3;
      const scatter = cmd.kind === "artillery" ? 5 : 3;
      for (let k = 0; k < n; k++) {
        const x = Math.max(0, Math.min(w.map.width - 1, Math.round(cmd.x + (rng.next() * 2 - 1) * scatter)));
        const y = Math.max(0, Math.min(w.map.height - 1, Math.round(cmd.y + (rng.next() * 2 - 1) * scatter)));
        const o: Ordnance = { id: w.nextId("ordnance"), kind: cmd.kind === "artillery" ? "artillery" : "smoke_shell", side: null, byId: null, from: { x, y: y - 30 }, x, y, z: 0, burstTick: w.tick + w.config.mortars.flight[cmd.kind === "artillery" ? "artillery" : "smoke_shell"] + k * 2, thrownTick: w.tick, spotting: false };
        w.ordnance.push(o);
      }
      w.emit("intervention", [], { kind: cmd.kind, at: [cmd.x, cmd.y] });
      return;
    }
    case "sniper": {
      const s = w.maybe(cmd.personId);
      if (!s || !w.onField(s)) return;
      w.emit("intervention", [s.id], { kind: "sniper", person: s.id });
      bulletWound(w, rng, null, s, w.config.weapons.kar98k_scoped, 60, "a sniper's bullet from nowhere");
      return;
    }
  }
}
