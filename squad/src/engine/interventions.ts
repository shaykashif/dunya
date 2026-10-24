// Player interventions: queued, applied at the start of the next tick, logged,
// and replayed exactly. Soldiers learn of them only through what they see and hear,
// except for the orders the player gives a squad, and the man the player steers.
import { giveOrder } from "../ai/command.ts";
import { bulletWound } from "../combat/fire.ts";
import { setDown } from "../entities/injuries.ts";
import type { Directive, Ordnance, Posture } from "../world/types.ts";
import type { World } from "../world/world.ts";

export type Intervention =
  /** A 105 mm barrage: six shells around the point. */
  | { kind: "artillery"; x: number; y: number }
  /** Smoke shells to blind a stretch of ground. */
  | { kind: "smoke"; x: number; y: number }
  /** A shot from an unseen sniper. */
  | { kind: "sniper"; personId: number }
  /** An order to a squad: go to a place, assault it, fire on it, hold; or "resume" to hand it back to its leader. */
  | { kind: "order"; squadId: number; order: Directive["kind"] | "resume"; x: number; y: number }
  /** Take a man under control, or (null) let him go back to his own devices. */
  | { kind: "control"; personId: number | null }
  /** The controls of the man under control, sent as they change: which way, how fast, how low, where he looks, the trigger. */
  | { kind: "steer"; dx: number; dy: number; sprint: boolean; stance: Posture; aim: [number, number] | null; fire: boolean; reload?: boolean; grenade?: boolean };

export interface ScheduledIntervention {
  tick: number;
  cmd: Intervention;
}

/** Lets go of the man under control. */
export function releasePilot(w: World, why: string): void {
  const p = w.pilot;
  if (!p) return;
  w.pilot = null;
  const s = w.maybe(p.id);
  if (s) s.act = null;
  w.emit("control", [p.id], { person: p.id, on: false, why });
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
        const o: Ordnance = { id: w.nextId("ordnance"), kind: cmd.kind === "artillery" ? "artillery" : "smoke_shell", side: null, byId: null, from: { x, y: y - 30 }, x, y, z: 0, burstTick: w.tick + w.config.mortars.callIn[cmd.kind === "artillery" ? "artillery" : "smoke_shell"] + k, thrownTick: w.tick, spotting: false };
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
    case "order": {
      const sq = w.squads[cmd.squadId];
      if (sq) giveOrder(w, sq, cmd.order, { x: cmd.x, y: cmd.y });
      return;
    }
    case "control": {
      if (cmd.personId === null) return releasePilot(w, "released");
      const s = w.maybe(cmd.personId);
      if (!s || !w.onField(s) || s.role === "tank" || s.role === "field_gun" || s.carriedById !== null) return;
      if (w.pilot?.id === s.id) return;
      releasePilot(w, "another");
      if (s.carryingId !== null) setDown(w, s, "the player took him in hand");
      s.act = null;
      w.pilot = { id: s.id, dx: 0, dy: 0, sprint: false, stance: s.posture === "prone" ? "prone" : "crouch", aim: null, firing: false, pull: false, reload: false, grenade: false, moveAcc: 0, since: w.tick };
      w.emit("control", [s.id], { person: s.id, on: true });
      return;
    }
    case "steer": {
      const p = w.pilot;
      if (!p) return;
      p.dx = Math.sign(cmd.dx);
      p.dy = Math.sign(cmd.dy);
      p.sprint = cmd.sprint;
      p.stance = cmd.stance;
      p.aim = cmd.aim ? { x: Math.max(0, Math.min(w.map.width - 1, Math.round(cmd.aim[0]))), y: Math.max(0, Math.min(w.map.height - 1, Math.round(cmd.aim[1]))) } : null;
      p.firing = cmd.fire;
      if (cmd.fire) p.pull = true;
      if (cmd.reload) p.reload = true;
      if (cmd.grenade) p.grenade = true;
      return;
    }
  }
}
