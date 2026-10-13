import type { World } from "../world/world.ts";

/** Checked every tick: one man per tile, the occupancy grid agrees, health in range, the dead do nothing. */
export function checkInvariants(w: World): void {
  const seen = new Map<number, number>();
  for (const s of w.soldiers) {
    if (s.survival.health < 0 || s.survival.health > 1 || Number.isNaN(s.survival.health)) throw new Error(`invariant: soldier ${s.id} health ${s.survival.health}`);
    if (s.status === "dead" && s.act) throw new Error(`invariant: dead soldier ${s.id} has an activity`);
    const stands = s.carriedById === null && (s.status === "active" || s.status === "casualty" || s.status === "surrendered" || s.status === "captured");
    if (!stands) continue;
    const i = w.map.idx(s.x, s.y);
    const other = seen.get(i);
    if (other !== undefined) throw new Error(`invariant: soldiers ${other} and ${s.id} share tile ${s.x},${s.y} at tick ${w.tick}`);
    seen.set(i, s.id);
    if (w.occupancy[i] !== s.id) throw new Error(`invariant: occupancy at ${s.x},${s.y} is ${w.occupancy[i]}, not ${s.id}`);
    if (!w.map.passable(s.x, s.y)) throw new Error(`invariant: soldier ${s.id} stands on impassable ${w.map.at(s.x, s.y)}`);
  }
}
