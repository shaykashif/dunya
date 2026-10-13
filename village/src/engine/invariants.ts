import { worldTotals } from "../world/items.ts";
import { ITEM_KINDS, type Inventory } from "../world/types.ts";
import type { World } from "../world/world.ts";

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

function checkNonNegative(label: string, inv: Inventory): void {
  for (const k of ITEM_KINDS) {
    if (inv[k] < 0 || !Number.isInteger(inv[k])) throw new InvariantError(`${label} has invalid ${k}=${inv[k]}`);
  }
}

/** Step 8: conservation, no negative quantities, no dead actors, no pair bond with the dead. */
export function checkInvariants(w: World): void {
  const totals = worldTotals(w);
  for (const k of ITEM_KINDS) {
    const expected = w.ledger.initial[k] + w.ledger.produced[k] - w.ledger.consumed[k];
    if (totals[k] !== expected) throw new InvariantError(`conservation broken for ${k}: have ${totals[k]}, expected ${expected} at tick ${w.tick}`);
  }
  for (const p of w.people) checkNonNegative(`person ${p.id}`, p.inventory);
  for (const h of w.households) checkNonNegative(`household ${h.id}`, h.store);
  checkNonNegative("communal", w.communal);
  w.farms.forEach((f, i) => checkNonNegative(`farm ${i}`, f.crop));
  for (const b of w.buildings) if (b.hearth) checkNonNegative(`hearth ${b.id}`, b.hearth);
  for (const key of Object.keys(w.tileItems)) checkNonNegative(`tile ${key}`, w.tileItems[Number(key)]!);

  for (const p of w.people) {
    const gone = !p.alive || p.exiled;
    if (gone && p.plan) throw new InvariantError(`inactive person ${p.id} has a plan`);
    for (const k of ["food", "water", "warmth", "rest", "health"] as const) {
      const v = p.survival[k];
      if (!(v >= 0 && v <= 1)) throw new InvariantError(`person ${p.id} ${k}=${v} out of range`);
    }
    if (gone) continue;
    for (const key of Object.keys(p.relationships)) {
      const r = p.relationships[Number(key)]!;
      if (r.stage !== "pair_bonded") continue;
      const q = w.maybePerson(Number(key));
      if (!q || !q.alive || q.exiled) throw new InvariantError(`person ${p.id} pair-bonded to inactive ${key}`);
      if (q.relationships[p.id]?.stage !== "pair_bonded") throw new InvariantError(`pair bond ${p.id}-${key} not mutual`);
      if (p.partnerId !== q.id) throw new InvariantError(`pair bond ${p.id}-${key} partner mismatch`);
    }
  }

  // Carrying is mutual.
  for (const p of w.people) {
    if (p.carriedById !== null && w.maybePerson(p.carriedById)?.carryingId !== p.id) throw new InvariantError(`person ${p.id} carried by ${p.carriedById}, who is not carrying them`);
    if (p.carryingId !== null && w.maybePerson(p.carryingId)?.carriedById !== p.id) throw new InvariantError(`person ${p.id} carrying ${p.carryingId}, who is not carried`);
  }

  // Nobody shares a tile (carried infants travel in their carer's arms).
  const seen = new Map<number, number>();
  for (const p of w.people) {
    if (!p.alive || p.exiled || w.isCarried(p)) continue;
    const i = w.map.idx(p.x, p.y);
    const other = seen.get(i);
    if (other !== undefined) throw new InvariantError(`people ${other} and ${p.id} share tile ${p.x},${p.y}`);
    seen.set(i, p.id);
    if (w.occupancy[i] !== p.id) throw new InvariantError(`occupancy out of step for person ${p.id}`);
  }
}
