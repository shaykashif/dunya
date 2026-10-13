import { transferAll } from "../world/items.ts";
import { createTrace } from "../world/traces.ts";
import type { DeathCause, Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { closeObligationsFor, createObligation } from "./obligations.ts";
import { assignElder, assignHead, clamp01, feel, firstName, householdMembers, rel } from "./person.ts";

/** Ends a pair bond or courtship when one partner dies or leaves. */
export function endPartnership(w: World, survivor: Person, goneId: number, reason: string): void {
  const r = rel(survivor, goneId, w.tick);
  if (r.stage === "pair_bonded" || r.stage === "courting") {
    const from = r.stage;
    r.stage = "estranged";
    r.stageTick = w.tick;
    const other = w.maybePerson(goneId);
    if (other) {
      const back = rel(other, survivor.id, w.tick);
      back.stage = "estranged";
      back.stageTick = w.tick;
      if (other.partnerId === survivor.id) other.partnerId = null;
    }
    if (survivor.partnerId === goneId) survivor.partnerId = null;
    w.emit("partnership_ended", [survivor.id], { other: goneId, from, reason });
  }
}

export function kill(w: World, p: Person, cause: DeathCause, killerId: number | null = null, crimeId: number | null = null): void {
  if (!p.alive) return;
  p.alive = false;
  p.causeOfDeath = cause;
  p.deathTick = w.tick;
  p.plan = null;
  p.asleep = false;
  p.pregnancy = null;
  w.vacate(p);
  w.emit("death", [p.id], { person: p.id, name: p.name, cause, killer: killerId, at: [p.x, p.y] });

  // Everything after this point refers to the dead person only in event data, never as an actor.
  transferAll(w, { t: "person", id: p.id }, { t: "household", id: p.householdId }, "inheritance");
  createTrace(w, "body", { x: p.x, y: p.y }, [{ kind: "person", id: p.id }], { cause: cause === "wounds" ? "person" : cause === "animal" ? "wolf" : cause }, crimeId);
  afterDeparture(w, p, "death");
}

/** Shared bookkeeping when a person dies or is exiled. */
export function afterDeparture(w: World, p: Person, reason: "death" | "exile" | "elopement"): void {
  const entry = w.census[p.id];
  if (entry && reason !== "death") entry.alive = false;
  w.vacate(p);
  if (reason !== "death") w.emit("departed", [], { person: p.id, reason });

  const partner = w.maybePerson(p.partnerId);
  if (partner && partner.alive && !partner.exiled && reason !== "elopement") {
    endPartnership(w, partner, p.id, reason);
    if (reason === "death") {
      feel(w, partner, "grieving", `${firstName(p)}, their partner, died`, 1);
      partner.widowedTick = w.tick;
      partner.emotions.grief = clamp01(partner.emotions.grief + 0.8);
      partner.wants.affection = clamp01(partner.wants.affection - 0.4);
      partner.wants.comfort = clamp01(partner.wants.comfort - 0.2);
    }
  }
  for (const other of w.active()) {
    const r = other.relationships[p.id];
    if (!r) continue;
    if (r.stage === "courting") endPartnership(w, other, p.id, reason);
    if (reason === "death" && r.kin && other.id !== p.partnerId) {
      other.emotions.grief = clamp01(other.emotions.grief + 0.5 * r.bond);
      feel(w, other, "grieving", `${firstName(p)} died`, 0.4 + 0.5 * r.bond);
    }
    if (reason === "exile" && r.kin) feel(w, other, "sad", `${firstName(p)} was exiled`, 0.5 * r.bond);
  }
  closeObligationsFor(w, p.id, reason);

  // Orphaned children become an obligation of their adult kin.
  for (const child of w.active()) {
    if (!child.parents.includes(p.id) || w.ageYears(child) >= 14) continue;
    const parentAlive = child.parents.some((id) => w.isActive(id));
    if (parentAlive) continue;
    const kin = householdMembers(w, child.householdId).filter((k) => k.id !== child.id && w.ageYears(k) >= 16);
    for (const k of kin) createObligation(w, k.id, child.id, "childcare", 0.6, null);
    w.emit("orphaned", [], { child: child.id, carers: kin.map((k) => k.id) });
  }

  assignHead(w, p.householdId);
  if (w.elderId === p.id) assignElder(w);
}
