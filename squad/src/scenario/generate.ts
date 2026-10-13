// Builds a battle from a seed: the bocage map, a US rifle platoon and a German
// Zug, every man with a name, rank, role, weapon and character. Squads are
// organised as each army taught in 1944: the American squad around its BAR,
// split into a base-of-fire team and a manoeuvre team; the German Gruppe
// around its MG 42, with a gun team and a rifle team.
import { emptyOrder } from "../ai/command.ts";
import { Rng } from "../engine/rng.ts";
import type { EventLog } from "../log/events.ts";
import { generateLayout, type Layout } from "../world/layout.ts";
import { cheb } from "../world/map.ts";
import { enemyOf, type Experience, type Point, type Role, type Side, type Soldier, type Squad, type Traits, type WeaponId } from "../world/types.ts";
import { World } from "../world/world.ts";
import type { SimConfig } from "./config.ts";

const US_FIRST = ["John", "Robert", "William", "James", "Joseph", "Frank", "George", "Edward", "Charles", "Walter", "Harold", "Raymond", "Stanley", "Eugene", "Leonard", "Thomas", "Richard", "Donald", "Albert", "Henry", "Arthur", "Louis", "Carl", "Paul", "Earl", "Clarence", "Vincent", "Anthony", "Ernest", "Floyd", "Howard", "Roy", "Herman", "Lloyd", "Ray", "Melvin"];
const US_LAST = ["Miller", "Kowalski", "O'Brien", "Russo", "Johnson", "Novak", "Martinez", "Schultz", "Murphy", "Rossi", "Jackson", "Kelly", "Brennan", "Wozniak", "Hernandez", "Lindqvist", "Petrakis", "Sullivan", "Carter", "Gallo", "Nowak", "Duffy", "Hansen", "Baker", "Morales", "Walsh", "Zielinski", "Bianchi", "Fletcher", "Kaminski", "Dawson", "Reyes", "Olson", "Larsen", "Mancini", "Hughes", "Price", "Vasquez", "Kozlowski", "Brooks", "Riley", "Gruber", "Moretti", "Lowell", "Pearson", "Cohen", "Weiss", "Tanaka", "Lopez", "Doyle"];
const US_TOWNS = ["Brooklyn", "Pittsburgh", "Chicago", "Cleveland", "Boston", "Omaha", "Scranton", "Tulsa", "Baltimore", "Detroit", "Milwaukee", "Albany", "Fresno", "El Paso", "Duluth", "Macon", "Butte", "Wichita", "Providence", "Buffalo", "Akron", "Knoxville", "Hartford", "Des Moines", "San Antonio", "Philadelphia"];
const DE_FIRST = ["Hans", "Karl", "Werner", "Heinz", "Helmut", "Kurt", "Walter", "Günter", "Fritz", "Otto", "Ernst", "Josef", "Friedrich", "Wilhelm", "Rudolf", "Herbert", "Gerhard", "Horst", "Erich", "Paul", "Alfred", "Willi", "Franz", "Hermann", "Rolf", "Klaus", "Max", "Georg", "Bruno", "Erwin"];
const DE_LAST = ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann", "Koch", "Richter", "Klein", "Wolf", "Schröder", "Neumann", "Braun", "Zimmermann", "Krüger", "Hartmann", "Lange", "Werner", "Krause", "Lehmann", "Köhler", "Maier", "Huber", "Vogel", "Brandt", "Haas", "Schuster", "Lorenz", "Graf", "Kaiser", "Fuchs", "Peters", "Sommer", "Jung", "Berger", "Frank"];
const DE_TOWNS = ["Hamburg", "Bremen", "Kassel", "Dresden", "Leipzig", "Essen", "Dortmund", "Breslau", "Königsberg", "Stettin", "Ulm", "Augsburg", "Kiel", "Lübeck", "Hannover", "Würzburg", "Graz", "Linz", "Mainz", "Trier", "Rostock", "Erfurt", "Danzig", "Bielefeld"];

interface Slot {
  role: Role;
  element: "A" | "B" | "HQ";
  rank: [string, string];
  weapon: WeaponId | null;
  ammo: number;
  team?: number;
  grenades: number;
  smokes?: number;
  rifleGrenades?: number;
}

const US_RANKS: Record<string, [string, string]> = {
  lt: ["Second Lieutenant", "Lt."],
  tsgt: ["Technical Sergeant", "T/Sgt."],
  ssgt: ["Staff Sergeant", "S/Sgt."],
  sgt: ["Sergeant", "Sgt."],
  cpl: ["Corporal", "Cpl."],
  t5: ["Technician Fifth Grade", "T/5"],
  pfc: ["Private First Class", "Pfc."],
  pvt: ["Private", "Pvt."],
};
const DE_RANKS: Record<string, [string, string]> = {
  lt: ["Leutnant", "Lt."],
  ofw: ["Oberfeldwebel", "Ofw."],
  fw: ["Feldwebel", "Fw."],
  uffz: ["Unteroffizier", "Uffz."],
  ogefr: ["Obergefreiter", "Ogefr."],
  gefr: ["Gefreiter", "Gefr."],
  osch: ["Oberschütze", "Osch."],
  sch: ["Schütze", "Sch."],
};

function usSquad(rng: Rng): Slot[] {
  const r = US_RANKS;
  const pv = () => (rng.chance(0.5) ? r.pfc! : r.pvt!);
  return [
    { role: "squad_leader", element: "B", rank: r.ssgt!, weapon: "thompson", ammo: 150, grenades: 2, smokes: 2 },
    { role: "asst_leader", element: "A", rank: r.sgt!, weapon: "m1_garand", ammo: 88, grenades: 2, smokes: 1 },
    { role: "scout", element: "A", rank: pv(), weapon: "m1_garand", ammo: 88, grenades: 2 },
    { role: "scout", element: "A", rank: pv(), weapon: "m1_garand", ammo: 88, grenades: 2 },
    { role: "auto_rifleman", element: "A", rank: r.pfc!, weapon: "bar", ammo: 220, grenades: 1 },
    { role: "asst_gunner", element: "A", rank: pv(), weapon: "m1_garand", ammo: 64, team: 240, grenades: 2 },
    { role: "ammo_bearer", element: "A", rank: pv(), weapon: "m1_garand", ammo: 64, team: 240, grenades: 2 },
    { role: "grenadier", element: "B", rank: pv(), weapon: "m1_garand", ammo: 80, grenades: 2, rifleGrenades: 6 },
    { role: "rifleman", element: "B", rank: r.cpl!, weapon: "m1_garand", ammo: 88, grenades: 2 },
    { role: "rifleman", element: "B", rank: pv(), weapon: "m1_garand", ammo: 88, grenades: 2 },
    { role: "rifleman", element: "B", rank: pv(), weapon: "m1_garand", ammo: 88, grenades: 2 },
    { role: "rifleman", element: "B", rank: pv(), weapon: "m1_garand", ammo: 88, grenades: 2 },
  ];
}

function deSquad(rng: Rng, sniper: boolean): Slot[] {
  const r = DE_RANKS;
  const sch = () => (rng.chance(0.5) ? r.osch! : r.sch!);
  const slots: Slot[] = [
    { role: "squad_leader", element: "B", rank: r.uffz!, weapon: "mp40", ammo: 160, grenades: 2, smokes: 1 },
    { role: "asst_leader", element: "A", rank: r.gefr!, weapon: rng.chance(0.4) ? "mp40" : "kar98k", ammo: 90, grenades: 2 },
    { role: "machine_gunner", element: "A", rank: r.ogefr!, weapon: "mg42", ammo: 250, grenades: 1 },
    { role: "asst_gunner", element: "A", rank: sch(), weapon: "kar98k", ammo: 45, team: 500, grenades: 1 },
    { role: "ammo_bearer", element: "A", rank: sch(), weapon: "kar98k", ammo: 45, team: 400, grenades: 1 },
    { role: "rifleman", element: "B", rank: r.gefr!, weapon: "kar98k", ammo: 60, grenades: 2 },
    { role: "rifleman", element: "B", rank: sch(), weapon: "kar98k", ammo: 60, grenades: 2 },
    { role: "rifleman", element: "B", rank: sch(), weapon: "kar98k", ammo: 60, grenades: 2 },
    { role: "rifleman", element: "B", rank: sch(), weapon: "kar98k", ammo: 60, grenades: 2 },
  ];
  slots.push(sniper ? { role: "sniper", element: "B", rank: r.gefr!, weapon: "kar98k_scoped", ammo: 50, grenades: 1 } : { role: "rifleman", element: "B", rank: sch(), weapon: "kar98k", ammo: 60, grenades: 2 });
  return slots;
}

function hqSlots(side: Side): Slot[] {
  if (side === "us") {
    const r = US_RANKS;
    return [
      { role: "platoon_leader", element: "HQ", rank: r.lt!, weapon: "m1_carbine", ammo: 60, grenades: 2, smokes: 1 },
      { role: "platoon_sergeant", element: "HQ", rank: r.tsgt!, weapon: "m1_garand", ammo: 88, grenades: 2, smokes: 1 },
      { role: "radioman", element: "HQ", rank: r.t5!, weapon: "m1_carbine", ammo: 45, grenades: 1 },
      { role: "medic", element: "HQ", rank: r.t5!, weapon: null, ammo: 0, grenades: 0 },
    ];
  }
  const r = DE_RANKS;
  return [
    { role: "platoon_leader", element: "HQ", rank: r.lt!, weapon: "mp40", ammo: 160, grenades: 2, smokes: 1 },
    { role: "platoon_sergeant", element: "HQ", rank: r.ofw!, weapon: "mp40", ammo: 160, grenades: 2, smokes: 1 },
    { role: "radioman", element: "HQ", rank: r.gefr!, weapon: "kar98k", ammo: 45, grenades: 1 },
    { role: "medic", element: "HQ", rank: r.gefr!, weapon: null, ammo: 0, grenades: 0 },
  ];
}

const SQUAD_COLORS: Record<Side, string[]> = { us: ["#e8c84a", "#5ab0e8", "#e8844a"], de: ["#e05a5a", "#b08ae8", "#e878a8"] };
const US_SQUAD_NAMES = ["1st Squad", "2nd Squad", "3rd Squad"];
const DE_SQUAD_NAMES = ["1. Gruppe", "2. Gruppe", "3. Gruppe"];

function gauss(rng: Rng): number {
  return (rng.next() + rng.next() + rng.next() - 1.5) / 0.5;
}

function traitsFor(rng: Rng, exp: Experience, role: Role): Traits {
  const t = (base: number, sd = 0.16) => Math.max(0.05, Math.min(0.98, base + gauss(rng) * sd));
  const vet = exp === "veteran" ? 0.1 : exp === "green" ? -0.08 : 0;
  const lead = role === "platoon_leader" || role === "squad_leader" || role === "platoon_sergeant" ? 0.2 : role === "asst_leader" ? 0.1 : -0.1;
  return {
    marksmanship: t(0.5 + vet + (role === "sniper" ? 0.3 : role === "machine_gunner" || role === "auto_rifleman" ? 0.1 : 0)),
    nerve: t(0.55 + vet + (lead > 0 ? 0.05 : 0)),
    aggression: t(0.48 + (role === "scout" ? 0.08 : 0)),
    discipline: t(0.6 + vet * 0.5),
    empathy: t(role === "medic" ? 0.8 : 0.5),
    fitness: t(0.6),
    leadership: t(0.4 + lead + vet),
  };
}

function experienceFor(rng: Rng, side: Side, role: Role): Experience {
  const r = rng.next();
  const leaderBonus = role === "squad_leader" || role === "platoon_sergeant" || role === "machine_gunner" ? 0.25 : 0;
  if (side === "de") return r < 0.28 + leaderBonus ? "veteran" : r < 0.75 ? "regular" : "green";
  return r < 0.18 + leaderBonus ? "veteran" : r < 0.72 ? "regular" : "green";
}

export function generateScenario(cfg: SimConfig, seed: number, log: EventLog): World {
  const rng = new Rng(seed, "scenario");
  const layout = generateLayout(cfg, new Rng(seed, "map"));
  const attacker: Side = rng.chance(cfg.forces.germanAttackChance) ? "de" : "us";
  const w = new World(cfg, seed, log, layout, attacker);
  const W = w.map.width, H = w.map.height;
  const usedNames = new Set<string>();
  let nextSoldier = 1;

  const makeSoldier = (side: Side, slot: Slot, squadId: number): Soldier => {
    const first = side === "us" ? US_FIRST : DE_FIRST;
    const last = side === "us" ? US_LAST : DE_LAST;
    let f = rng.pick(first), l = rng.pick(last);
    for (let k = 0; k < 20 && usedNames.has(l); k++) l = rng.pick(last);
    usedNames.add(l);
    const exp = slot.role === "platoon_leader" && side === "us" ? (rng.chance(0.6) ? "green" : "regular") : experienceFor(rng, side, slot.role);
    const traits = traitsFor(rng, exp, slot.role);
    const spec = slot.weapon ? cfg.weapons[slot.weapon] : null;
    const age = slot.role === "platoon_leader" ? 22 + rng.int(6) : slot.role === "platoon_sergeant" ? 26 + rng.int(9) : side === "de" ? 17 + rng.int(20) : 19 + rng.int(14);
    const s: Soldier = {
      id: nextSoldier++,
      side,
      name: `${f} ${l}`,
      first: f,
      last: l,
      rank: slot.rank[0],
      abbr: slot.rank[1],
      role: slot.role,
      squadId,
      element: slot.element,
      age,
      hometown: rng.pick(side === "us" ? US_TOWNS : DE_TOWNS),
      experience: exp,
      traits,
      x: 0,
      y: 0,
      dir: 1,
      posture: "stand",
      status: "active",
      conscious: true,
      survival: { health: 1 },
      injuries: [],
      crutch: false,
      lossCause: { killed: 0, wounds: 0, infection: 0, unknown: 0 },
      causeOfDeath: null,
      deathTick: null,
      killedBy: null,
      weapon: slot.weapon,
      loaded: spec ? spec.capacity : 0,
      ammo: slot.ammo,
      teamAmmo: slot.team ?? 0,
      grenades: slot.grenades,
      smokes: slot.smokes ?? 0,
      rifleGrenades: slot.rifleGrenades ?? 0,
      fireAcc: 0,
      reloadLeft: 0,
      heat: 0,
      morphineTick: -1,
      suppression: 0,
      morale: Math.min(1, cfg.morale.start[exp] + (traits.nerve - 0.5) * 0.2),
      pinned: false,
      broken: false,
      act: null,
      carriedById: null,
      carryingId: null,
      capturedBy: null,
      underFire: null,
      lastFiredTick: -100,
      lastHitTick: -100,
      confusedUntil: 0,
      kills: 0,
      shots: 0,
      hits: 0,
      treated: 0,
      recent: [],
      cooldowns: {},
      sees: [],
      bloodied: false,
    };
    w.addSoldier(s);
    return s;
  };

  const makeSquad = (side: Side, name: string, color: string, isHQ: boolean, slots: Slot[], task: string): Squad => {
    const sq: Squad = {
      id: w.squads.length,
      side,
      name,
      color,
      isHQ,
      leaderId: null,
      members: [],
      state: "deploy",
      stateTick: 0,
      route: [],
      routeIdx: 0,
      bounding: "A",
      boundWp: -1,
      boundStage: 0,
      orders: { A: emptyOrder(0), B: emptyOrder(0) },
      contacts: {},
      focus: null,
      flankPoint: null,
      post: null,
      fallback: null,
      facing: { x: 0, y: side === attacker ? -1 : 1 },
      task,
      intent: isHQ ? "platoon headquarters" : "forming up",
      firstContactTick: null,
      casualtiesSeen: 0,
    };
    w.squads.push(sq);
    for (const slot of slots) {
      const s = makeSoldier(side, slot, sq.id);
      sq.members.push(s.id);
      if (slot.role === "squad_leader" || slot.role === "platoon_leader") sq.leaderId = s.id;
    }
    return sq;
  };

  // ---- Forces ----
  const defender = enemyOf(attacker);
  const nUs = cfg.forces.usSquads[0] + rng.int(cfg.forces.usSquads[1] - cfg.forces.usSquads[0] + 1);
  const nDe = cfg.forces.deSquads[0] + rng.int(cfg.forces.deSquads[1] - cfg.forces.deSquads[0] + 1);
  const counts: Record<Side, number> = { us: attacker === "us" ? nUs : Math.min(nUs, 2), de: attacker === "de" ? Math.max(nDe, 3) : nDe };
  for (const side of [attacker, defender] as const) {
    const role = side === attacker ? "attack" : "defend";
    const hq = makeSquad(side, side === "us" ? "Platoon HQ" : "Zugtrupp", "#c8c8c8", true, hqSlots(side), "hq");
    const squadIds: number[] = [];
    for (let i = 0; i < counts[side]; i++) {
      const slots = side === "us" ? usSquad(rng) : deSquad(rng, rng.chance(cfg.forces.sniperChance));
      const task = role === "attack" && i === 2 ? "reserve" : "line";
      squadIds.push(makeSquad(side, (side === "us" ? US_SQUAD_NAMES : DE_SQUAD_NAMES)[i]!, SQUAD_COLORS[side][i]!, false, slots, task).id);
    }
    const rearY = role === "attack" ? H - 1 : 0;
    const objective = layout.objective;
    const aidPost = role === "attack" ? w.freeTileNear({ x: objective.x, y: H - 5 }, 8) ?? { x: objective.x, y: H - 5 } : w.freeTileNear({ x: objective.x, y: Math.max(3, objective.y - 14) }, 8) ?? { x: objective.x, y: 3 };
    w.platoons[side] = {
      side,
      role,
      name: side === "us" ? "3rd Platoon, Fox Company" : "1. Zug, 6. Kompanie",
      hqSquadId: hq.id,
      squadIds,
      objective,
      aidPost,
      rearY,
      fireMissionsLeft: cfg.mortars.missions[side],
      missions: [],
      phase: role === "attack" ? "forming up" : "waiting",
      startStrength: 0,
      withdrawing: false,
      withdrawTick: -1,
    };
  }

  // ---- Deployment ----
  deployAttackers(w, attacker, rng);
  deployDefenders(w, defender, layout, rng);
  for (const side of ["us", "de"] as const) w.platoons[side].startStrength = w.side(side).length;
  w.map.finalize();

  w.emit("battle_start", [], {
    seed,
    date: cfg.time.date,
    clock: w.clock(),
    attacker,
    forces: { us: w.side("us").length, de: w.side("de").length },
    squads: w.squads.map((s) => ({ id: s.id, side: s.side, name: s.name, men: s.members.length })),
    objective: [layout.objective.x, layout.objective.y],
  });
  return w;
}

function placeAt(w: World, s: Soldier, p: Point): void {
  const spot = w.freeTileNear(p, 6, s.id) ?? p;
  w.place(s, spot.x, spot.y);
}

function deployAttackers(w: World, side: Side, rng: Rng): void {
  const pl = w.platoons[side];
  const H = w.map.height, W = w.map.width;
  const n = pl.squadIds.length;
  pl.squadIds.forEach((id, i) => {
    const sq = w.squad(id);
    const reserve = sq.task === "reserve";
    const cx = Math.max(8, Math.min(W - 9, Math.round(pl.objective.x + (reserve ? 0 : (i - (Math.min(n, 2) - 1) / 2) * 30) + (rng.next() - 0.5) * 6)));
    const cy = reserve ? H - 3 : H - 6;
    sq.members.forEach((mid, k) => placeAt(w, w.soldier(mid), { x: cx - 4 + (k % 4) * 2, y: cy - Math.floor(k / 4) * 2 + (reserve ? 0 : 1) }));
  });
  const hq = w.squad(pl.hqSquadId);
  hq.members.forEach((mid, k) => placeAt(w, w.soldier(mid), { x: pl.objective.x - 2 + k * 2, y: H - 3 }));
  hq.state = "advance";
}

function deployDefenders(w: World, side: Side, layout: Layout, rng: Rng): void {
  const pl = w.platoons[side];
  const W = w.map.width;
  const road = layout.roadX[layout.line.y] ?? Math.round(W / 2);
  // Machine guns in field corners along the line, spread out to cross their fire.
  const mgs = [...layout.mgPositions].sort((a, b) => Math.abs(a.x - road) - Math.abs(b.x - road) || a.x - b.x);
  const chosen: Point[] = [];
  for (const p of mgs) if (chosen.length < pl.squadIds.length && chosen.every((c) => Math.abs(c.x - p.x) >= 22)) chosen.push(p);
  for (let k = 0; chosen.length < pl.squadIds.length && k < 50; k++) {
    const p = layout.linePositions[rng.int(layout.linePositions.length)];
    if (p && chosen.every((c) => Math.abs(c.x - p.x) >= 18)) chosen.push(p);
  }
  chosen.sort((a, b) => a.x - b.x);
  const hamlet = [...layout.hamletPositions];
  pl.squadIds.forEach((id, i) => {
    const sq = w.squad(id);
    const mg = chosen[i] ?? { x: road + (i === 0 ? -15 : 15), y: layout.line.rowAt[road]! - 1 };
    const men = sq.members.map((m) => w.soldier(m));
    const gunner = men.find((m) => m.role === "machine_gunner" || m.role === "auto_rifleman")!;
    const dig = (p: Point) => {
      const t = w.map.at(p.x, p.y);
      if (t === "grass" || t === "wheat" || t === "orchard" || t === "crater") w.map.set(p.x, p.y, "foxhole");
    };
    dig(mg);
    placeAt(w, gunner, mg);
    // The gun crew beside the gun; riflemen spread along the hedge to either side.
    const crew = men.filter((m) => m.role === "asst_gunner" || m.role === "ammo_bearer" || m.role === "asst_leader");
    const line = layout.linePositions.filter((p) => Math.abs(p.x - mg.x) <= 18 && cheb(p, mg) >= 2).sort((a, b) => Math.abs(a.x - mg.x) - Math.abs(b.x - mg.x) || a.x - b.x);
    crew.forEach((m, k) => {
      const p = k === 0 ? { x: mg.x + (mg.x < road ? 1 : -1), y: mg.y } : { x: mg.x + (k % 2 ? -1 : 1) * 2, y: mg.y - 1 - Math.floor(k / 2) };
      placeAt(w, m, p);
      if (k === 0) dig({ x: m.x, y: m.y });
    });
    const rifles = men.filter((m) => !crew.includes(m) && m !== gunner);
    const taken: Point[] = [mg];
    for (const m of rifles) {
      const p = line.find((q) => taken.every((t) => cheb(t, q) >= 3)) ?? { x: mg.x + (rng.int(9) - 4), y: mg.y - 2 };
      taken.push(p);
      dig(p);
      placeAt(w, m, p);
    }
    for (const m of men) m.posture = "crouch";
    sq.facing = { x: 0, y: 1 };
    sq.post = mg;
    // Fallback: the hamlet positions nearest this squad's side of the road.
    const mine = hamlet.filter((p) => (i === 0 ? p.x <= layout.objective.x + 2 : p.x >= layout.objective.x - 2));
    const pool = mine.length >= 3 ? mine : hamlet;
    sq.fallback = pool.length > 0 ? pool.sort((a, b) => cheb(a, mg) - cheb(b, mg) || a.x - b.x)[Math.min(2, pool.length - 1)]! : { x: layout.objective.x, y: layout.objective.y - 3 };
    // Orders: hold, fire discipline until the enemy is in the open.
    for (const el of ["A", "B"] as const) {
      const keep: Record<number, Point> = {};
      for (const m of men.filter((x) => x.element === el)) keep[m.id] = { x: m.x, y: m.y };
      sq.orders[el] = { kind: "hold", positions: keep, target: null, pace: "crouch", fire: "hold", issued: 0 };
    }
  });
  const hq = w.squad(pl.hqSquadId);
  const post = w.freeTileNear({ x: layout.objective.x, y: layout.objective.y - 4 }, 6) ?? layout.objective;
  hq.post = post;
  hq.members.forEach((mid, k) => placeAt(w, w.soldier(mid), { x: post.x - 2 + k * 2, y: post.y }));
  hq.state = "hold";
}
