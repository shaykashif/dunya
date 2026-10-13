// All item movement goes through these functions so conservation holds:
// totals change only through logged production and consumption.
import { FOOD_KINDS, ITEM_KINDS, emptyInventory, type HolderRef, type Inventory, type ItemKind } from "./types.ts";
import type { World } from "./world.ts";

export function holderInv(w: World, h: HolderRef): Inventory {
  switch (h.t) {
    case "person":
      return w.person(h.id).inventory;
    case "household":
      return w.households[h.id]!.store;
    case "communal":
      return w.communal;
    case "farm":
      return w.farms[h.id]!.crop;
    case "hearth": {
      const hearth = w.buildings[h.id]!.hearth;
      if (!hearth) throw new Error(`building ${h.id} has no hearth`);
      return hearth;
    }
    case "tile": {
      const i = w.map.idx(h.x, h.y);
      return (w.tileItems[i] ??= emptyInventory());
    }
    case "site": {
      const pr = w.projects.find((x) => x.id === h.id);
      if (!pr) throw new Error(`no project ${h.id}`);
      return pr.stock;
    }
  }
}

export function holderLabel(h: HolderRef): string {
  switch (h.t) {
    case "person": return `person:${h.id}`;
    case "household": return `household:${h.id}`;
    case "hearth": return `hearth:${h.id}`;
    case "farm": return `farm:${h.id}`;
    case "tile": return `tile:${h.x},${h.y}`;
    case "site": return `site:${h.id}`;
    default: return h.t;
  }
}

export function transfer(w: World, from: HolderRef, to: HolderRef, kind: ItemKind, qty: number, reason: string, actors: readonly number[] = []): number {
  const src = holderInv(w, from);
  const n = Math.min(Math.max(0, Math.floor(qty)), src[kind]);
  if (n <= 0) return 0;
  const dst = holderInv(w, to);
  src[kind] -= n;
  dst[kind] += n;
  w.emit("item_transferred", actors, { from: holderLabel(from), to: holderLabel(to), kind, qty: n, reason });
  return n;
}

export function produce(w: World, to: HolderRef, kind: ItemKind, qty: number, reason: string, actors: readonly number[] = []): number {
  const n = Math.max(0, Math.floor(qty));
  if (n <= 0) return 0;
  holderInv(w, to)[kind] += n;
  w.ledger.produced[kind] += n;
  w.emit("produced", actors, { to: holderLabel(to), kind, qty: n, reason });
  return n;
}

export function consume(w: World, from: HolderRef, kind: ItemKind, qty: number, reason: string, actors: readonly number[] = []): number {
  const src = holderInv(w, from);
  const n = Math.min(Math.max(0, Math.floor(qty)), src[kind]);
  if (n <= 0) return 0;
  src[kind] -= n;
  w.ledger.consumed[kind] += n;
  w.emit("consumed", actors, { from: holderLabel(from), kind, qty: n, reason });
  return n;
}

/** Moves every item from one holder to another (inheritance, exile). */
export function transferAll(w: World, from: HolderRef, to: HolderRef, reason: string, actors: readonly number[] = []): void {
  const src = holderInv(w, from);
  for (const kind of ITEM_KINDS) if (src[kind] > 0) transfer(w, from, to, kind, src[kind], reason, actors);
}

export function foodUnits(inv: Inventory): number {
  return inv.grain + inv.fish + inv.berries;
}

export function bestFood(inv: Inventory): ItemKind | null {
  for (const k of FOOD_KINDS) if (inv[k] > 0) return k;
  return null;
}

export function foodValue(w: World, kind: ItemKind): number {
  const v = (w.config.food.value as Record<string, number>)[kind];
  return v ?? 0;
}

/** Sum of every item kind across every holder in the world. */
export function worldTotals(w: World): Inventory {
  const total = emptyInventory();
  const add = (inv: Inventory) => {
    for (const k of ITEM_KINDS) total[k] += inv[k];
  };
  for (const p of w.people) add(p.inventory);
  for (const h of w.households) add(h.store);
  add(w.communal);
  for (const f of w.farms) add(f.crop);
  for (const b of w.buildings) if (b.hearth) add(b.hearth);
  for (const key of Object.keys(w.tileItems)) add(w.tileItems[Number(key)]!);
  for (const pr of w.projects) add(pr.stock);
  return total;
}
