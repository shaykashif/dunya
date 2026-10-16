// What shells do to the ground and what stands on it. Each stretch of house
// or garden wall takes a few hits before it is a breach of rubble; a roof
// counts the bombs that came through it; and a house shelled hard enough
// falls in, bringing its upper floors down on whoever is up there. Trees are
// smashed to stumps and splinters, and hedgerows blown open. Only the tiles
// near a burst are touched, so this stays cheap.
import { kill } from "../entities/death.ts";
import { impactHealth, injure } from "../entities/injuries.ts";
import { note, shout } from "../entities/soldier.ts";
import type { Building } from "../world/layout.ts";
import type { Ordnance, Terrain } from "../world/types.ts";
import type { World } from "../world/world.ts";

const OPEN_GROUND = new Set<Terrain>(["grass", "wheat", "orchard", "road", "brush", "marsh", "deadfall", "woods", "paving", "pothole"]);

/** A mortar bomb or shell has burst: knock down what it hits. Returns true if the map changed. */
export function shellDamage(w: World, o: Ordnance): boolean {
  if (o.kind !== "mortar" && o.kind !== "artillery" && o.kind !== "tank_shell" && o.kind !== "gun_shell" && o.kind !== "at_rocket") return false;
  const cfg = w.config.destruction;
  const spec = cfg[o.kind];
  const rng = w.rng.get("ordnance");
  const map = w.map;
  const changed: [number, number, Terrain][] = [];
  const houses = new Set<number>();
  let roofs = false;
  const set = (x: number, y: number, t: Terrain) => {
    if (map.at(x, y) === t) return;
    map.set(x, y, t);
    changed.push([x, y, t]);
  };

  // Through a roof, or into the ground.
  const at = map.idx(o.x, o.y);
  const house = map.building[at]!;
  if (house >= 0) {
    houses.add(house);
    roofs = true;
    map.roofHits[at] = Math.min(255, map.roofHits[at]! + (o.kind === "artillery" ? 2 : 1));
    if (o.kind === "artillery") {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = o.x + dx, y = o.y + dy;
        if (map.inBounds(x, y) && map.building[map.idx(x, y)] === house) map.roofHits[map.idx(x, y)] = Math.min(255, map.roofHits[map.idx(x, y)]! + 1);
      }
    }
  } else if (OPEN_GROUND.has(map.at(o.x, o.y))) set(o.x, o.y, "crater");

  // Walls, trees and hedges within reach.
  const R = Math.ceil(spec.reach);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = o.x + dx, y = o.y + dy;
      if (!map.inBounds(x, y)) continue;
      const d = Math.hypot(dx, dy);
      if (d > spec.reach) continue;
      const i = map.idx(x, y);
      const t = map.terrain[i]!;
      const hp = map.wallHp[i]!;
      if (hp > 0) {
        const dmg = d < 0.5 ? spec.center : d <= 1.5 ? spec.ring : Math.max(1, Math.floor(spec.ring / 2));
        if (map.building[i]! >= 0) houses.add(map.building[i]!);
        if (dmg >= hp) {
          map.wallHp[i] = 0;
          set(x, y, "rubble");
        } else map.wallHp[i] = hp - dmg;
        continue;
      }
      if (d < 0.5) continue;
      const fall = 1 - d / (spec.reach + 1);
      if (t === "woods" || t === "orchard") {
        if (rng.chance((o.kind === "artillery" ? cfg.treeArtillery : cfg.treeMortar) * fall)) set(x, y, "deadfall");
      } else if (t === "stall" && d <= 1.5) {
        // Stalls are blown to matchwood.
        set(x, y, "debris");
      } else if (t === "wire" && d <= 1.5) {
        // Wire is blown apart.
        set(x, y, w.layout.kind === "urban" ? "rubble" : "crater");
      } else if (t === "hedge" && d <= (o.kind === "artillery" ? 1.5 : 1)) {
        if (rng.chance((o.kind === "artillery" ? cfg.hedgeArtillery : cfg.hedgeMortar) * fall)) set(x, y, "brush");
      }
    }
  }
  // A hedge right at the burst is blown open too.
  if (map.at(o.x, o.y) === "hedge" && (o.kind === "artillery" || rng.chance(cfg.hedgeMortar))) set(o.x, o.y, "brush");

  const fell: Building[] = [];
  for (const id of houses) {
    const b = w.buildings[id]!;
    if (!b.destroyed && shouldCollapse(w, b)) {
      collapse(w, b, changed);
      fell.push(b);
    }
  }
  if (changed.length > 0) {
    map.finalize();
    dropFromBreaches(w, changed);
  } else if (roofs) map.version++;
  if (changed.length > 0) w.emit("destroyed", [], { by: o.kind, at: [o.x, o.y], tiles: changed.map(([x, y, t]) => [x, y, t]) });
  return changed.length > 0 || roofs || fell.length > 0;
}

/**
 * A man upstairs over a stretch of wall that has just been blown out comes
 * down with it, onto the rubble or beside it, and may be hurt by the fall.
 */
function dropFromBreaches(w: World, changed: [number, number, Terrain][]): void {
  const map = w.map;
  const rng = w.rng.get("ordnance");
  for (const [x, y] of changed) {
    for (const s of w.soldiers) {
      if (s.x !== x || s.y !== y || s.z === 0 || s.carriedById !== null || map.passable(s.x, s.y, s.z)) continue;
      const fall = s.z;
      w.vacate(s);
      s.z = 0;
      const spot = map.passable(x, y, 0) && w.occupancy[map.cell(x, y, 0)] === 0 ? { x, y } : w.freeTileNear({ x, y }, 4, s.id) ?? { x, y };
      w.place(s, spot.x, spot.y, 0);
      if (s.status === "dead") continue;
      s.posture = "prone";
      s.act = null;
      if (!rng.chance(0.6)) continue;
      const part = rng.chance(0.6) ? (rng.chance(0.5) ? "left leg" : "right leg") : "torso";
      const sev = 0.2 + rng.next() * 0.2 * fall;
      injure(w, s, part, sev > 0.5 && part !== "torso" ? "fracture" : "bruise", sev, "a fall when the wall under him was blown out", null, impactHealth(w, part, sev) * 0.5);
      note(w, s, "fell when the wall under him was blown out");
      if (s.survival.health <= 0) kill(w, s, "killed", null);
    }
  }
}

/** Breached walls, or a roof full of holes. */
function shouldCollapse(w: World, b: Building): boolean {
  const cfg = w.config.destruction;
  const map = w.map;
  let edge = 0, breached = 0, roof = 0;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = map.idx(x, y);
      roof += map.roofHits[i]!;
      if (x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1) {
        edge++;
        if (map.terrain[i] === "rubble") breached++;
      }
    }
  }
  return breached / edge >= cfg.collapseWalls || roof >= (cfg.collapseRoof * b.w * b.h) / 10;
}

/**
 * The house falls in: the roof and upper floors come down, most of the walls
 * with them. Men upstairs fall with the floor, and men below may be crushed.
 */
function collapse(w: World, b: Building, changed: [number, number, Terrain][]): void {
  const map = w.map;
  const rng = w.rng.get("ordnance");
  b.destroyed = true;
  const hurt: number[] = [];
  const inside = w.soldiers.filter((s) => (w.onField(s) || s.status === "surrendered" || s.status === "captured") && s.carriedById === null && s.x >= b.x && s.x < b.x + b.w && s.y >= b.y && s.y < b.y + b.h);
  for (const s of inside) w.vacate(s);
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = map.idx(x, y);
      map.levels[i] = 1;
      const t = map.terrain[i]!;
      const edge = x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1;
      // Rubble heaps inside, and what is left of the walls standing here and there.
      if ((edge && t !== "rubble" && rng.chance(0.5)) || (!edge && (t === "stairs" || rng.chance(0.4)))) {
        map.terrain[i] = "rubble";
        map.wallHp[i] = 0;
        changed.push([x, y, "rubble"]);
      }
    }
  }
  for (const s of inside) {
    const fall = s.z;
    let spot = map.passable(s.x, s.y, 0) && w.occupancy[map.cell(s.x, s.y, 0)] === 0 ? { x: s.x, y: s.y } : w.freeTileNear({ x: s.x, y: s.y }, 4, s.id);
    if (!spot) spot = w.freeTileNear({ x: b.x + Math.floor(b.w / 2), y: b.y + b.h + 1 }, 8, s.id) ?? { x: s.x, y: s.y };
    s.z = 0;
    w.place(s, spot.x, spot.y, 0);
    if (s.status === "dead" || (fall === 0 && !rng.chance(0.35))) continue;
    // Falling with the floor, or caught under the beams.
    const part = rng.chance(0.5) ? (rng.chance(0.5) ? "left leg" : "right leg") : rng.chance(0.6) ? "torso" : "head";
    const sev = 0.3 + rng.next() * (0.3 + 0.15 * fall);
    injure(w, s, part, sev > 0.6 && part !== "torso" ? "fracture" : "bruise", sev, `the collapse of ${b.name}`, null, impactHealth(w, part, sev) * 0.6);
    hurt.push(s.id);
    s.act = null;
    s.posture = "prone";
    note(w, s, `buried when ${b.name} fell in`);
    if (s.survival.health <= 0) kill(w, s, "killed", null);
    else if (s.status === "active") shout(w, s, s.side === "us" ? "The roof's coming down!" : "Das Dach stürzt ein!", "shout-collapse", 30);
  }
  w.emit("building_collapse", hurt, { building: b.id, name: b.name, hurt });
}
