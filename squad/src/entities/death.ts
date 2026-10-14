import { r3 } from "../log/events.ts";
import type { DeathCause, Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { setDown } from "./injuries.ts";
import { moraleOnLoss } from "./morale.ts";
import { label, note } from "./soldier.ts";

/** Kills a man. Everything after this refers to him only in event data. */
export function kill(w: World, p: Soldier, cause: DeathCause, killerId: number | null): void {
  if (p.status === "dead") return;
  if (p.carryingId !== null) setDown(w, p, "carrier killed");
  const carrier = w.maybe(p.carriedById);
  if (carrier && carrier.carryingId === p.id) carrier.carryingId = null;
  p.carriedById = null;
  const wasOnField = w.onField(p);
  p.status = "dead";
  p.conscious = false;
  p.causeOfDeath = cause;
  p.deathTick = w.tick;
  p.killedBy = killerId;
  p.act = null;
  p.posture = "prone";
  w.vacate(p);
  if (wasOnField && p.role !== "tank" && p.role !== "field_gun") w.addPain(p.side, p.x, p.y, 1.2);
  w.corpses.push({ id: p.id, x: p.x, y: p.y });
  const killer = w.maybe(killerId);
  if (killer && killer.side !== p.side) killer.kills++;
  w.emit("death", [p.id], { person: p.id, name: p.name, side: p.side, role: p.role, cause, killer: killerId, at: [p.x, p.y], health: r3(p.survival.health) });
  if (killer) note(w, killer, `killed ${label(p)}`);
  if (wasOnField) moraleOnLoss(w, p, true);
}
