// Building, Dwarf Fortress style: furniture inside houses, wells and pumps,
// bridges over the river, house extensions, pen palisades and a village temple.
// A project is planned, materials are hauled to its site, then it is worked
// into place; the finished thing changes the map or a building.
import { feel, firstName, householdMembers } from "../entities/person.ts";
import type { Rng } from "../engine/rng.ts";
import { r3 } from "../log/events.ts";
import { consume, transferAll } from "./items.ts";
import { emptyInventory, type Building, type Furniture, type FurnitureKind, type Person, type Point, type Project, type ProjectKind } from "./types.ts";
import type { World } from "./world.ts";

export const FURNITURE_KINDS: readonly FurnitureKind[] = ["bed", "table", "chair", "chest", "altar"];
export const QUALITY_WORDS = ["", "well-crafted", "finely-crafted", "superior", "exceptional", "masterful"];

export function isFurniture(kind: ProjectKind): kind is FurnitureKind {
  return (FURNITURE_KINDS as readonly string[]).includes(kind);
}

/** Which craft a project calls for. */
export function projectSkill(kind: ProjectKind): "carpentry" | "masonry" {
  return kind === "altar" || kind === "well" || kind === "temple" ? "masonry" : "carpentry";
}

export function furnitureIn(w: World, buildingId: number, kind?: FurnitureKind): Furniture[] {
  return w.furniture.filter((f) => f.buildingId === buildingId && (kind === undefined || f.kind === kind));
}

/** People in a house who need a bed of their own; a couple shares one, infants sleep with their mother. */
export function bedUnits(w: World, householdId: number): number {
  let n = 0;
  const seen = new Set<number>();
  for (const m of householdMembers(w, householdId)) {
    if (seen.has(m.id) || w.ageYears(m) < w.config.needs.infantAge) continue;
    seen.add(m.id);
    const partner = w.maybePerson(m.partnerId);
    if (partner && partner.householdId === householdId && w.isActive(partner.id)) seen.add(partner.id);
    n++;
  }
  return n;
}

/**
 * Gives out a house's beds: the head first, then elders and adults by age,
 * then children. A couple shares a bed. Everyone else sleeps on the floor.
 */
export function assignBeds(w: World, householdId: number): void {
  const house = w.house(householdId);
  const beds = furnitureIn(w, house.id, "bed").sort((a, b) => b.quality - a.quality || a.id - b.id);
  const members = householdMembers(w, householdId).sort((a, b) => Number(b.isHead) - Number(a.isHead) || a.birthTick - b.birthTick || a.id - b.id);
  for (const m of members) m.bedId = null;
  let i = 0;
  for (const m of members) {
    if (m.bedId !== null || w.ageYears(m) < w.config.needs.infantAge) continue;
    const bed = beds[i];
    if (!bed) break;
    i++;
    m.bedId = bed.id;
    const partner = w.maybePerson(m.partnerId);
    if (partner && partner.householdId === householdId && w.isActive(partner.id)) partner.bedId = bed.id;
  }
}

/** True if the person has a bed in the house they live in. */
export function hasBed(w: World, p: Person): boolean {
  if (p.bedId === null) return false;
  const bed = w.furniture.find((f) => f.id === p.bedId);
  return !!bed && bed.buildingId === w.households[p.householdId]!.buildingId;
}

/** Furniture value of a house against what it needs, in [0, 1]. Fine pieces count for more. */
export function furnishing(w: World, householdId: number): number {
  const b = w.house(householdId);
  const people = Math.max(1, householdMembers(w, householdId).length);
  let value = 0;
  for (const f of furnitureIn(w, b.id)) value += (f.kind === "bed" ? 1.5 : f.kind === "chair" ? 0.5 : 1) * (1 + f.quality * 0.25);
  return Math.min(1, value / (people * 1.6));
}

/** A free floor tile for a new piece: along the walls for beds and chests, toward the middle for tables. */
export function furnitureSpot(w: World, b: Building, kind: FurnitureKind): Point | null {
  const taken = new Set(furnitureIn(w, b.id).map((f) => `${f.x},${f.y}`));
  const reserved = (x: number, y: number) =>
    taken.has(`${x},${y}`) || (x === b.hearthSpot.x && y === b.hearthSpot.y) || (x === b.door.x && Math.abs(y - b.door.y) <= 1);
  const byWall = kind === "bed" || kind === "chest" || kind === "altar";
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  let best: Point | null = null, bestS = Infinity;
  for (let y = b.y0 + 1; y <= b.y1 - 1; y++) {
    for (let x = b.x0 + 1; x <= b.x1 - 1; x++) {
      if (reserved(x, y)) continue;
      const wall = Math.min(x - b.x0, b.x1 - x, y - b.y0, b.y1 - y);
      const center = Math.abs(x - cx) + Math.abs(y - cy);
      const s = byWall ? wall * 10 + center * 0.1 : center + (wall === 1 ? 3 : 0);
      if (s < bestS) { bestS = s; best = { x, y }; }
    }
  }
  return best;
}

/** Floor tiles per person, and whether the house can take another piece of furniture. */
export function crowding(w: World, householdId: number): { tilesPerPerson: number; full: boolean } {
  const b = w.house(householdId);
  const tiles = (b.x1 - b.x0 - 1) * (b.y1 - b.y0 - 1);
  const people = Math.max(1, householdMembers(w, householdId).length);
  return { tilesPerPerson: tiles / people, full: furnitureSpot(w, b, "bed") === null };
}

const OPEN: ReadonlySet<string> = new Set(["ground", "forest", "path", "rock"]);

/** Rows a house could grow into: three rows above it, all open ground nobody else built on. */
export function extensionTiles(w: World, b: Building): Point[] | null {
  const out: Point[] = [];
  for (let y = b.y0 - 3; y <= b.y0 - 1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      if (!w.map.inBounds(x, y) || y < 1 || !OPEN.has(w.map.at(x, y)) || w.map.buildingAt(x, y) >= 0 || w.map.farmOf[w.map.idx(x, y)]! >= 0) return null;
      out.push({ x, y });
    }
  }
  return out;
}

/** Map changed: drop cached paths, rebuild site tables, and tell the viewer to redraw. */
export function mapChanged(w: World): void {
  w.mapVersion++;
  w.invalidatePaths();
  w.map.finalize();
  // Anyone left standing in a new wall or well steps aside.
  for (const p of w.people) {
    if (!p.alive || p.exiled || w.isCarried(p) || w.map.passable(p.x, p.y)) continue;
    const spot = w.freeTileNear(p, 6, p.id);
    if (spot) w.place(p, spot.x, spot.y);
  }
}

/** Site searches scan much of the map, so they are remembered until the map changes. */
const siteMemo = new WeakMap<World, { version: number; bridge?: Point[] | null; temple?: { x0: number; y0: number; x1: number; y1: number } | null }>();
function memo(w: World): { version: number; bridge?: Point[] | null; temple?: { x0: number; y0: number; x1: number; y1: number } | null } {
  let m = siteMemo.get(w);
  if (!m || m.version !== w.mapVersion) {
    m = { version: w.mapVersion };
    siteMemo.set(w, m);
  }
  return m;
}

export function bridgeSite(w: World): Point[] | null {
  const m = memo(w);
  if (m.bridge === undefined) m.bridge = findBridgeSite(w);
  return m.bridge;
}

export function templeSite(w: World): { x0: number; y0: number; x1: number; y1: number } | null {
  const m = memo(w);
  if (m.temple === undefined) m.temple = findTempleSite(w);
  return m.temple;
}

/** The narrowest stretch of river near town, with dry land on both banks. */
function findBridgeSite(w: World): Point[] | null {
  const town = w.map.square;
  let best: Point[] | null = null, bestS = Infinity;
  for (let y = 2; y < w.map.height - 2; y++) {
    for (let x = 1; x < w.map.width - 1; x++) {
      if (w.map.at(x, y) !== "water" || w.map.at(x - 1, y) === "water") continue;
      const span: Point[] = [];
      let ex = x;
      while (ex < w.map.width && w.map.at(ex, y) === "water") span.push({ x: ex++, y });
      if (ex >= w.map.width || !w.map.passable(x - 1, y) || !w.map.passable(ex, y) || span.length > 6) continue;
      const s = Math.abs(y - town.y) + span.length * 4 + Math.abs(x - town.x) * 0.2;
      if (s < bestS) { bestS = s; best = span; }
    }
  }
  return best;
}

/** A 9x7 plot of open ground in the town clearing, near the square, for the temple. */
function findTempleSite(w: World): { x0: number; y0: number; x1: number; y1: number } | null {
  const sq = w.map.square;
  let best: { x0: number; y0: number; x1: number; y1: number } | null = null, bestD = Infinity;
  for (let y0 = sq.y - 22; y0 <= sq.y + 16; y0++) {
    for (let x0 = sq.x - 24; x0 <= sq.x + 16; x0++) {
      const r = { x0, y0, x1: x0 + 8, y1: y0 + 6 };
      let ok = true;
      for (let y = r.y0 - 1; y <= r.y1 + 1 && ok; y++) {
        for (let x = r.x0 - 1; x <= r.x1 + 1 && ok; x++) {
          if (!w.map.inBounds(x, y)) { ok = false; break; }
          const t = w.map.at(x, y);
          const inside = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
          if (w.map.buildingAt(x, y) >= 0 || t === "well" || t === "water" || t === "field" || t === "bridge") ok = false;
          else if (inside && t !== "ground" && t !== "path") ok = false;
        }
      }
      if (!ok) continue;
      const d = Math.abs((r.x0 + r.x1) / 2 - sq.x) + Math.abs((r.y0 + r.y1) / 2 - sq.y);
      if (d < bestD) { bestD = d; best = r; }
    }
  }
  return best;
}

/** Open ground in a compound, near the house, with room around it, for a second well. */
export function wellSite(w: World, householdId: number): Point | null {
  const c = w.compound(householdId);
  const door = w.house(householdId).door;
  let best: Point | null = null, bestD = Infinity;
  for (let y = c.center.y - 10; y <= c.center.y + 10; y++) {
    for (let x = c.center.x - 10; x <= c.center.x + 10; x++) {
      if (!w.map.inBounds(x, y) || w.map.at(x, y) !== "ground") continue;
      if (w.map.neighbors4(x, y).some((n) => !w.map.passable(n.x, n.y) || w.map.at(n.x, n.y) === "door")) continue;
      if (w.map.wells.some((wl) => Math.abs(wl.x - x) + Math.abs(wl.y - y) < 6)) continue;
      const d = Math.abs(x - door.x - 4) + Math.abs(y - door.y - 2);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best;
}

export function penCenter(w: World, householdId: number): Point {
  const c = w.compound(householdId).center;
  return { x: c.x + 8, y: c.y + 5 };
}

/** Plans a project. Returns null if there is nowhere to put it. */
export function planProject(w: World, planner: Person, kind: ProjectKind): Project | null {
  const cfg = w.config.construction;
  const cost = cfg.costs[kind];
  const hid = kind === "bridge" || kind === "temple" ? null : planner.householdId;
  let site: Point;
  let tiles: Point[] = [];
  let buildingId: number | null = null;
  let units = 1;
  if (isFurniture(kind)) {
    const b = w.house(planner.householdId);
    const spot = furnitureSpot(w, b, kind);
    if (!spot) return null;
    site = spot;
    tiles = [spot];
    buildingId = b.id;
  } else if (kind === "extension") {
    const b = w.house(planner.householdId);
    const t = extensionTiles(w, b);
    if (!t) return null;
    tiles = t;
    site = { ...b.hearthSpot };
    buildingId = b.id;
  } else if (kind === "well") {
    const s = wellSite(w, planner.householdId);
    if (!s) return null;
    site = s;
    tiles = [s];
  } else if (kind === "pump") {
    const well = w.compound(planner.householdId).well;
    site = { ...well };
    tiles = [well];
  } else if (kind === "fence") {
    site = penCenter(w, planner.householdId);
  } else if (kind === "bridge") {
    const span = bridgeSite(w);
    if (!span) return null;
    tiles = span;
    units = span.length;
    site = { x: span[0]!.x - 1, y: span[0]!.y };
  } else {
    const r = templeSite(w);
    if (!r) return null;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) tiles.push({ x, y });
    site = { x: Math.floor((r.x0 + r.x1) / 2), y: r.y1 + 1 };
  }
  const project: Project = {
    id: w.nextId("project"),
    kind,
    householdId: hid,
    buildingId,
    site,
    tiles,
    need: { wood: cost.wood * units, stone: cost.stone * units },
    stock: emptyInventory(),
    work: cost.work * units,
    done: 0,
    status: "planned",
    plannerId: planner.id,
    builders: [],
    createdTick: w.tick,
    lastWorkTick: w.tick,
    doneTick: null,
    quality: 0,
  };
  w.projects.push(project);
  w.emit("project_planned", [planner.id], { project: project.id, kind, household: hid, at: [site.x, site.y], need: project.need, work: project.work });
  return project;
}

export function activeProjects(w: World, householdId?: number | null): Project[] {
  return w.projects.filter((pr) => pr.status === "planned" && (householdId === undefined || pr.householdId === householdId));
}

/** Materials still to be brought to a project. */
export function stillNeeded(pr: Project): { wood: number; stone: number } {
  return { wood: Math.max(0, pr.need.wood - pr.stock.wood), stone: Math.max(0, pr.need.stone - pr.stock.stone) };
}

function stampRect(w: World, r: { x0: number; y0: number; x1: number; y1: number }, id: number, door: Point): Point[] {
  const interior: Point[] = [];
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const edge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
      w.map.set(x, y, edge ? "wall" : "floor");
      w.map.building[w.map.idx(x, y)] = id;
      if (!edge) interior.push({ x, y });
    }
  }
  w.map.set(door.x, door.y, "door");
  return interior;
}

/** Grows a house three rows to the north: the old top wall becomes floor. */
function extendHouse(w: World, b: Building): void {
  const r = { x0: b.x0, y0: b.y0 - 3, x1: b.x1, y1: b.y1 };
  b.interior = stampRect(w, r, b.id, b.door);
  b.y0 = r.y0;
}

function raiseTemple(w: World, tiles: Point[]): Building {
  const x0 = Math.min(...tiles.map((t) => t.x)), x1 = Math.max(...tiles.map((t) => t.x));
  const y0 = Math.min(...tiles.map((t) => t.y)), y1 = Math.max(...tiles.map((t) => t.y));
  const id = w.buildings.length;
  const door = { x: Math.floor((x0 + x1) / 2), y: y1 };
  const interior = stampRect(w, { x0, y0, x1, y1 }, id, door);
  const b: Building = {
    id,
    kind: "temple",
    householdId: null,
    x0,
    y0,
    x1,
    y1,
    door,
    interior,
    bed: { x: door.x, y: y0 + 1 },
    hearthSpot: { x: door.x, y: y0 + 2 },
    condition: 1,
    hearth: null,
    burnAcc: 0,
    lit: false,
  };
  w.buildings.push(b);
  return b;
}

/** Finishes a project: the materials are used up and the thing stands. */
export function completeProject(w: World, pr: Project, builder: Person, rng: Rng): void {
  const site = { t: "site" as const, id: pr.id };
  consume(w, site, "wood", pr.stock.wood, "built", [builder.id]);
  consume(w, site, "stone", pr.stock.stone, "built", [builder.id]);
  pr.status = "done";
  pr.doneTick = w.tick;
  let quality = 0;
  if (isFurniture(pr.kind)) {
    // Skill sets the quality, with some luck.
    quality = Math.max(0, Math.min(5, Math.floor((pr.quality + rng.next() * 8 - 4) / 3.5)));
    w.furniture.push({ id: w.nextId("furniture"), kind: pr.kind, buildingId: pr.buildingId!, x: pr.site.x, y: pr.site.y, quality, makerId: builder.id, tick: w.tick });
    if (pr.kind === "bed" && pr.householdId !== null) assignBeds(w, pr.householdId);
  } else if (pr.kind === "extension") {
    extendHouse(w, w.buildings[pr.buildingId!]!);
    mapChanged(w);
  } else if (pr.kind === "well") {
    w.map.set(pr.site.x, pr.site.y, "well");
    w.map.wells.push({ ...pr.site });
    mapChanged(w);
  } else if (pr.kind === "pump") {
    w.pumps.push(w.map.idx(pr.site.x, pr.site.y));
  } else if (pr.kind === "fence") {
    if (pr.householdId !== null) w.fenced.push(pr.householdId);
  } else if (pr.kind === "bridge") {
    for (const t of pr.tiles) w.map.set(t.x, t.y, "bridge");
    mapChanged(w);
  } else if (pr.kind === "temple") {
    const b = raiseTemple(w, pr.tiles);
    w.furniture.push({ id: w.nextId("furniture"), kind: "altar", buildingId: b.id, x: b.hearthSpot.x, y: b.hearthSpot.y - 1, quality: 2, makerId: builder.id, tick: w.tick });
    mapChanged(w);
  }
  w.emit("project_completed", pr.builders.filter((id) => w.isActive(id)), { project: pr.id, kind: pr.kind, household: pr.householdId, by: builder.id, quality, at: [pr.site.x, pr.site.y] });
  const proud = quality >= 2 ? `made a ${QUALITY_WORDS[quality]} ${pr.kind}` : `finished the ${pr.kind === "extension" ? "new rooms" : pr.kind}`;
  feel(w, builder, quality >= 3 ? "inspired" : "satisfied", proud, 0.3 + quality * 0.08);
  if (pr.householdId !== null) {
    for (const m of householdMembers(w, pr.householdId)) if (m.id !== builder.id) feel(w, m, "pleased", `${firstName(builder)} finished the ${pr.kind === "extension" ? "new rooms" : pr.kind}`, 0.15 + quality * 0.05);
  }
}

/** Gives up on projects nobody has touched in a long time; materials on site go back to the house. */
export function abandonStale(w: World): void {
  const limit = w.days(w.config.construction.abandonDays);
  for (const pr of activeProjects(w)) {
    if (w.tick - pr.lastWorkTick < limit) continue;
    pr.status = "abandoned";
    transferAll(w, { t: "site", id: pr.id }, pr.householdId !== null ? { t: "household", id: pr.householdId } : { t: "communal" }, "abandoned");
    w.emit("project_abandoned", [], { project: pr.id, kind: pr.kind, household: pr.householdId, done: r3(pr.done) });
  }
}
