import { r3 } from "../log/events.ts";
import { foodUnits } from "../world/items.ts";
import type { Obligation, ObligationKind } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { adjustTrust, clamp01 } from "./person.ts";

export function createObligation(
  w: World,
  holder: number,
  owedTo: number,
  kind: ObligationKind,
  strength: number,
  due: number | null,
  amount = 0,
): Obligation {
  const o: Obligation = { id: w.nextId("obligation"), holder, owed_to: owedTo, kind, strength: r3(clamp01(strength)), due, status: "active", breaches: 0, amount };
  w.obligations.push(o);
  w.emit("obligation_created", [holder], { obligation: o.id, owedTo, kind, strength: o.strength, due, amount });
  return o;
}

export function activeObligations(w: World, holder: number): Obligation[] {
  return w.obligations.filter((o) => o.holder === holder && o.status === "active");
}

export function fulfillObligation(w: World, o: Obligation, reason: string): void {
  if (o.status !== "active") return;
  o.status = "fulfilled";
  w.emit("obligation_fulfilled", w.isActive(o.holder) ? [o.holder] : [], { obligation: o.id, owedTo: o.owed_to, kind: o.kind, reason });
}

/** A breach lowers the owed person's trust and creates guilt in the holder. */
export function breachObligation(w: World, o: Obligation, reason: string, final: boolean): void {
  const cfg = w.config.obligations;
  o.breaches++;
  if (final) o.status = "broken";
  const holder = w.person(o.holder);
  holder.emotions.guilt = clamp01(holder.emotions.guilt + cfg.guiltPerBreach * o.strength);
  if (w.isActive(o.owed_to)) adjustTrust(w.person(o.owed_to), o.holder, -cfg.breachTrustLoss * o.strength, w.tick);
  w.emit("obligation_broken", [o.holder], { obligation: o.id, owedTo: o.owed_to, kind: o.kind, reason, final });
}

/** Ends obligations that involve a person who died or left. */
export function closeObligationsFor(w: World, personId: number, reason: string): void {
  for (const o of w.obligations) {
    if (o.status !== "active") continue;
    if (o.holder === personId || o.owed_to === personId) {
      o.status = "fulfilled";
      w.emit("obligation_fulfilled", [], { obligation: o.id, owedTo: o.owed_to, holder: o.holder, kind: o.kind, reason });
    }
  }
}

/**
 * Daily check. Ongoing duties (kin, pair, childcare, food sharing) record a
 * breach when the owed person is starving while the holder carries spare food;
 * they stay active. Debts break when their due tick passes.
 */
export function checkObligations(w: World): void {
  for (const o of w.obligations) {
    if (o.status !== "active") continue;
    if (!w.isActive(o.holder) || !w.isActive(o.owed_to)) continue;
    const holder = w.person(o.holder);
    const owed = w.person(o.owed_to);
    if (o.kind === "debt") {
      if (o.due !== null && w.tick >= o.due) breachObligation(w, o, "debt_unpaid", true);
      continue;
    }
    if (o.kind === "protection") continue;
    if (owed.survival.food < 0.1 && foodUnits(holder.inventory) >= 3) breachObligation(w, o, "withheld_food", false);
  }
}
