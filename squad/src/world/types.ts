// Core data types. Everything here is plain data so a world can be logged,
// cloned and inspected; behaviour lives in the engine, combat and ai modules.

export interface Point {
  x: number;
  y: number;
  /** Floor of a building, 0 for the ground; left out, it means the ground (or wherever the man already is). */
  z?: number;
}

/** Most floors any building has. Upper floors exist only inside buildings. */
export const MAX_FLOORS = 3;

/** The weather on the day. */
export type WeatherKind = "clear" | "overcast" | "rain" | "fog";

export interface Weather {
  kind: WeatherKind;
  /** "a clear morning", for the chronicle. */
  label: string;
  /** Multipliers: how far men can see, how easily they spot, how far shots carry, how heavy the going is off the roads, how fast men tire, how well they shoot. */
  sight: number;
  spot: number;
  hearing: number;
  mud: number;
  fatigue: number;
  aim: number;
}

/** The kinds of ground a battle can be fought over. */
export type MapKind = "hamlet" | "rural" | "road" | "town";

/** The two armies. "us" is a US Army rifle platoon, "de" a German infantry Zug. */
export type Side = "us" | "de";
export const SIDES: readonly Side[] = ["us", "de"];
export const enemyOf = (s: Side): Side => (s === "us" ? "de" : "us");

/**
 * Ground, Normandy bocage style. One tile is about 3 m.
 * Hedges are the earthen banks topped with brush that boxed every field.
 */
export type Terrain =
  | "grass"
  | "wheat"
  | "road"
  | "orchard"
  | "woods"
  | "hedge"
  | "wall"
  | "building"
  | "floor"
  | "door"
  | "window"
  | "water"
  | "bridge"
  | "rubble"
  | "crater"
  | "foxhole"
  /** A staircase inside a building, linking its floors. */
  | "stairs"
  /** Wet meadow by a stream: heavy going. */
  | "marsh"
  /** Scrub and bramble: some concealment, slow. */
  | "brush"
  /** A roadside ditch: a ready-made trench. */
  | "ditch";

// ---------- Bodies and wounds (kept from the village simulation) ----------

export type BodyPart =
  | "head"
  | "face"
  | "left eye"
  | "right eye"
  | "torso"
  | "left arm"
  | "right arm"
  | "left hand"
  | "right hand"
  | "left leg"
  | "right leg"
  | "left foot"
  | "right foot";

export const BODY_PARTS: readonly BodyPart[] = ["head", "face", "left eye", "right eye", "torso", "left arm", "right arm", "left hand", "right hand", "left leg", "right leg", "left foot", "right foot"];

/** "shrapnel" is new in this fork: fragments from grenades and shells. */
export type InjuryKind = "bruise" | "cut" | "gash" | "sprain" | "fracture" | "gunshot" | "shrapnel" | "lost";

export interface Injury {
  id: number;
  part: BodyPart;
  kind: InjuryKind;
  /** In [0, 1]; falls as the wound heals. */
  severity: number;
  tick: number;
  cause: string;
  byId: number | null;
  /** How well it was dressed, in [0, 1]. */
  care: number;
  infected: boolean;
  /** Bleeding rate; stops when bound or clotted. */
  bleeding: number;
  permanent: boolean;
  /** What it healed into, if it healed badly: "lame", "crooked arm", "lost eye"... */
  lasting: string | null;
}

/** "killed" is death at the moment of the hit; "wounds" is bleeding out later. */
export type DeathCause = "killed" | "wounds" | "infection" | "unknown";

// ---------- Soldiers ----------

export type Role =
  | "platoon_leader"
  | "platoon_sergeant"
  | "radioman"
  | "medic"
  | "squad_leader"
  | "asst_leader"
  | "scout"
  | "rifleman"
  | "grenadier"
  | "auto_rifleman"
  | "machine_gunner"
  | "asst_gunner"
  | "ammo_bearer"
  | "sniper";

export type Posture = "stand" | "crouch" | "prone";

/** "casualty" is alive but out of the fight: unconscious, unable to walk, or too hurt to hold a weapon. */
export type Status = "active" | "casualty" | "dead" | "surrendered" | "captured" | "routed";

export type Experience = "green" | "regular" | "veteran";

export interface Traits {
  marksmanship: number;
  /** Courage under fire: resists suppression and fear. */
  nerve: number;
  aggression: number;
  /** How closely they follow orders. */
  discipline: number;
  empathy: number;
  fitness: number;
  leadership: number;
}

export type WeaponId = "m1_garand" | "m1_carbine" | "thompson" | "bar" | "kar98k" | "kar98k_scoped" | "m1903_scoped" | "mp40" | "mg42" | "pistol";

export type Pace = "walk" | "crouch" | "rush" | "crawl";

/** What a soldier is doing right now; it lasts until done or interrupted. */
export interface Activity {
  cand: Candidate;
  /** Walking there, then doing it. */
  phase: "travel" | "perform";
  /** Ticks of work left once there. */
  work: number;
  /** Step within a multi-part job (carrying: 0 fetching, 1 carrying back). */
  stage: number;
  path: number[] | null;
  pathIdx: number;
  /** Tile index being walked to. */
  goal: number;
  moveAcc: number;
  /** Ticks spent on this activity so far. */
  ticks: number;
  startTick: number;
  blocked: number;
}

export type ActKind =
  | "fire"
  | "suppress"
  | "move"
  | "take_cover"
  | "hold"
  | "reload"
  | "grenade"
  | "rifle_grenade"
  | "smoke"
  | "aid"
  | "carry"
  | "hug"
  | "flee"
  | "surrender"
  | "rally"
  | "call_fire"
  | "resupply"
  | "take_weapon"
  | "capture"
  | "barrel"
  | "crawl_to_cover";

/**
 * One option offered to a soldier's decision source. The engine fills in what
 * it would mean tactically; the decision source only weighs it.
 */
export interface Candidate {
  kind: ActKind;
  key: string;
  description: string;
  targetId?: number;
  /** Aim point or object location. */
  at?: Point;
  /** Where to go, for moving activities. */
  dest?: Point;
  pace?: Pace;
  posture?: Posture;
  /** How long it lasts in ticks, if fixed. */
  duration?: number;
  /** Tactical worth as doctrine sees it, roughly in [0, 1.5]. */
  value: number;
  /** True if this is what the soldier's orders call for. */
  ordered: boolean;
  /** How exposed doing this leaves them, in [0, 1]. */
  danger: number;
  /** Getting out of harm's way, in [0, 1]. */
  safety: number;
  /** Helping a comrade, in [0, 1]. */
  care: number;
  /** Closing with or killing the enemy, in [0, 1]. */
  offense: number;
}

export interface Soldier {
  id: number;
  side: Side;
  name: string;
  first: string;
  last: string;
  rank: string;
  /** Short rank, for the chronicle: "Pvt.", "Sgt.", "Ogefr.". */
  abbr: string;
  role: Role;
  squadId: number;
  /** Fire team: "A" (base of fire) or "B" (manoeuvre), or "HQ". */
  element: "A" | "B" | "HQ";
  age: number;
  hometown: string;
  experience: Experience;
  traits: Traits;
  x: number;
  y: number;
  /** Floor he is on: 0 the ground, 1 and up the upper floors of a building. */
  z: number;
  /** -1 faces left, 1 right (sprites only). */
  dir: number;
  posture: Posture;
  status: Status;
  conscious: boolean;
  survival: { health: number };
  injuries: Injury[];
  /** Body-system compatibility: soldiers do not get crutches mid-battle. */
  crutch: boolean;
  lossCause: Record<DeathCause, number>;
  causeOfDeath: DeathCause | null;
  deathTick: number | null;
  killedBy: number | null;
  weapon: WeaponId | null;
  /** Rounds in the weapon. */
  loaded: number;
  /** Spare rounds carried for it. */
  ammo: number;
  /** Rounds carried for the squad's machine gun or BAR (assistants and ammo bearers). */
  teamAmmo: number;
  grenades: number;
  smokes: number;
  rifleGrenades: number;
  /** Fractional rounds carried over between ticks of firing. */
  fireAcc: number;
  /** Ticks left before a reload or barrel change is done. */
  reloadLeft: number;
  /** Machine-gun barrel heat in [0, 1]; at 1 the barrel must be changed. */
  heat: number;
  /** Tick morphine was given, or -1. Halves how much pain takes them out of the fight. */
  morphineTick: number;
  /** In [0, 1]: how hard incoming fire presses them down. */
  suppression: number;
  /** In [0, 1]: the will to keep fighting. */
  morale: number;
  /** In [0, 1]: how blown he is from running and climbing. Slows him and spoils his aim. */
  fatigue: number;
  /** A sniper's chosen hide, and when he chose it. */
  hide: Point | null;
  hideTick: number;
  pinned: boolean;
  broken: boolean;
  act: Activity | null;
  carriedById: number | null;
  carryingId: number | null;
  capturedBy: number | null;
  /** Last time someone shot at them: who, where from, when. */
  underFire: { by: number; x: number; y: number; tick: number } | null;
  lastFiredTick: number;
  lastHitTick: number;
  /** Ticks without orders after a leader falls. */
  confusedUntil: number;
  kills: number;
  shots: number;
  hits: number;
  treated: number;
  /** Things they did or that happened to them, newest last. */
  recent: { tick: number; text: string }[];
  /** Short-lived flags keyed by name, holding the tick they expire. */
  cooldowns: Record<string, number>;
  /** Enemy ids this soldier can see this tick. */
  sees: number[];
  bloodied: boolean;
}

// ---------- Squads and platoons ----------

/** What a squad knows about one enemy soldier. */
export interface Contact {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Last tick seen or heard. */
  tick: number;
  /** True if someone in the squad has eyes on them now. */
  visible: boolean;
  /** Seen with their own eyes at some point (rather than only heard). */
  identified: boolean;
  /** A machine gun or automatic rifle: the first thing to deal with. */
  automatic: boolean;
  /** A sniper, once seen for what he is. */
  sniper: boolean;
  /** Believed out of the fight (seen to fall). */
  down: boolean;
}

export type SquadState =
  | "deploy"
  | "advance"
  | "react"
  | "fix"
  | "flank"
  | "assault"
  | "consolidate"
  | "hold"
  | "fall_back"
  | "withdraw"
  | "broken"
  | "support"
  /** Getting out from under mortar fire. */
  | "displace";

export type FirePolicy = "hold" | "return" | "free";

/** One fire team's current order. */
export interface ElementOrder {
  kind: "move" | "overwatch" | "suppress" | "assault" | "hold" | "withdraw" | "follow";
  /** Spot each member is to occupy, by soldier id. */
  positions: Record<number, Point>;
  /** Where to direct fire, if suppressing. */
  target: Point | null;
  pace: Pace;
  fire: FirePolicy;
  issued: number;
}

export interface Squad {
  id: number;
  side: Side;
  name: string;
  /** Shown on the map and in lists. */
  color: string;
  isHQ: boolean;
  leaderId: number | null;
  members: number[];
  state: SquadState;
  stateTick: number;
  /** The route to the objective, as bounds from hedge line to hedge line. */
  route: Point[];
  routeIdx: number;
  /** Which element moves first in the current bound. */
  bounding: "A" | "B";
  /** Route index the current bound is for, and whether the second team is moving up yet. */
  boundWp: number;
  boundStage: 0 | 1;
  orders: { A: ElementOrder; B: ElementOrder };
  contacts: Record<number, Contact>;
  /** The enemy position the squad is fighting, if any. */
  focus: Point | null;
  /** Where the manoeuvre element is headed when flanking. */
  flankPoint: Point | null;
  /** Defensive position and fallback position, for defenders. */
  post: Point | null;
  fallback: Point | null;
  /** Facing of the defence: direction the enemy is expected from. */
  facing: Point;
  /** Platoon tasking: "main", "support", "reserve", "line". */
  task: string;
  /** A sentence describing the squad's current plan, for the viewer. */
  intent: string;
  firstContactTick: number | null;
  casualtiesSeen: number;
  /** The state to go back to once out from under mortar fire, and when it last moved for shelling. */
  resume: SquadState | null;
  shelledTick: number;
  /** Where it is heading to get out of a barrage. */
  refuge: Point | null;
  /** When it last fell back: a squad that has just done so holds rather than running again. */
  fellBackTick: number;
  /** A sniper is working on the squad: where they think he is, and when he last fired. */
  sniperAlert: { x: number; y: number; tick: number } | null;
}

export interface FireMission {
  id: number;
  side: Side;
  target: Point;
  /** Tick the first (spotting) round lands, then fire for effect. */
  spotTick: number;
  effectTick: number;
  rounds: number;
  fired: number;
  calledBy: number;
  kind: "mortar" | "artillery";
}

export interface Platoon {
  side: Side;
  role: "attack" | "defend";
  name: string;
  hqSquadId: number;
  squadIds: number[];
  objective: Point;
  /** Where the wounded are brought, behind the line. */
  aidPost: Point;
  /** The friendly map edge's y coordinate. */
  rearY: number;
  fireMissionsLeft: number;
  missions: FireMission[];
  phase: string;
  startStrength: number;
  withdrawing: boolean;
  withdrawTick: number;
}

// ---------- Ordnance and smoke ----------

export type OrdnanceKind = "frag" | "stick" | "rifle_grenade" | "mortar" | "artillery" | "smoke_grenade" | "smoke_shell";

export interface Ordnance {
  id: number;
  kind: OrdnanceKind;
  side: Side | null;
  byId: number | null;
  from: Point;
  x: number;
  y: number;
  /** Floor it bursts on: a grenade lobbed through an upper window, or a shell through a roof. */
  z: number;
  /** Tick it bursts. */
  burstTick: number;
  thrownTick: number;
  /** The first, ranging round of a fire mission: the warning that more is coming. */
  spotting: boolean;
}

/** Where a mortar or artillery round came down, remembered a little while so men can react. */
export interface Impact {
  x: number;
  y: number;
  tick: number;
  kind: OrdnanceKind;
  side: Side | null;
  spotting: boolean;
}

export interface SmokeCloud {
  id: number;
  x: number;
  y: number;
  radius: number;
  born: number;
  until: number;
}

export interface Corpse {
  id: number;
  x: number;
  y: number;
}

export type BattlePhase = "battle" | "over";

export interface BattleResult {
  winner: Side | null;
  reason: string;
  tick: number;
}
