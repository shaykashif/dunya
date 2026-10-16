// Core data types. Everything here is plain data so a world can be logged,
// cloned and inspected; behaviour lives in the engine, combat and ai modules.

export interface Point {
  x: number;
  y: number;
  /** Floor of a building, 0 for the ground; left out, it means the ground (or wherever the man already is). */
  z?: number;
}

/** Most floors any building has. Upper floors exist only inside buildings. */
export const MAX_FLOORS = 4;

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
export type MapKind = "hamlet" | "rural" | "road" | "town" | "urban";

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
  | "ditch"
  /** Trees smashed by shellfire: stumps, splintered trunks and fallen limbs. */
  | "deadfall"
  /** A low wall of sandbags: a fighting position, chest high. */
  | "sandbags"
  /** Coils of barbed wire: no cover, and slow, careful work to get through. */
  | "wire"
  /** A burnt-out vehicle: solid cover, and nobody walks through it. */
  | "wreck"
  /** A hole blown in a street or yard: a little cover for a man lying in it. */
  | "pothole"
  /** Pavements, cobbled squares and yards in a city. */
  | "paving"
  /** A stone fountain basin in a plaza: waist-high cover, and in the way. */
  | "fountain"
  /** A statue on its plinth. */
  | "statue"
  /** A market stall: trestles and an awning, something to hide behind but not stop a bullet. */
  | "stall"
  /** Junk in the road: fallen masonry, burnt timbers, smashed furniture, an abandoned cart. Slow going, a little cover. */
  | "debris";

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
  | "sniper"
  /** Carries a bazooka or a Panzerschreck as well as his rifle. */
  | "at_gunner"
  /** The vehicle itself, and the men who work it. They are attached to the platoon, not part of its strength. */
  | "tank"
  | "tank_commander"
  | "tank_gunner"
  | "tank_driver"
  | "tank_loader"
  /** A towed anti-tank gun and the men who serve it. */
  | "field_gun"
  | "gun_crew";

const ARMOUR_ROLES: ReadonlySet<Role> = new Set<Role>(["tank", "tank_commander", "tank_gunner", "tank_driver", "tank_loader", "field_gun", "gun_crew"]);

/** True for tanks, field guns and their crews: separate from the platoon's own men and its cap. */
export function isArmourRole(role: Role): boolean {
  return ARMOUR_ROLES.has(role);
}

export type Posture = "stand" | "crouch" | "prone";

/** "casualty" is alive but out of the fight: unconscious, unable to walk, or too hurt to hold a weapon. */
/** "aboard" is a crewman inside his tank: out of the field of play until he bails out. */
export type Status = "active" | "casualty" | "dead" | "surrendered" | "captured" | "routed" | "aboard";

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

export type WeaponId = "m1_garand" | "m1_carbine" | "thompson" | "bar" | "kar98k" | "kar98k_scoped" | "m1903_scoped" | "mp40" | "mg42" | "pistol" | "tank_mg";

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
  | "crawl_to_cover"
  | "launch";

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
  /** Anti-tank rockets carried (bazooka, Panzerschreck). */
  rockets: number;
  /** The tank or gun this man belongs to, if he is crew. */
  tankId: number | null;
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
  /** A tank or an anti-tank gun, heard or seen. */
  armour?: boolean;
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
  | "displace"
  /** Lying in wait, hidden and holding fire until the enemy walks into it. */
  | "ambush"
  /** Moving up to bolster another squad that called for help. */
  | "reinforce"
  /** Waiting at the jump-off line for the mortars and the smoke, then going in. */
  | "stage";

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
  /** A call for help, by radio or runner: when it was made, when it reaches the platoon leader, and whether it was answered. */
  help: { tick: number; arrives: number; by: "radio" | "runner"; answered: boolean } | null;
  /** The squad it is helping, if any. */
  helping: number | null;
  /** Clearing a house: which one, and how far along (stacking up outside, grenades in, going in). */
  breach: { house: number; stage: "stack" | "grenades" | "enter"; tick: number } | null;
  /** When it last fell back: a squad that has just done so holds rather than running again. */
  fellBackTick: number;
  /** In a city: when the covering team opened up for the current bound, so the movers go only once fire is on the enemy (-1 if no cover is being given). */
  coverTick: number;
  /** In a city: the building the moving team is sweeping room by room, or holding floor by floor, and since when. */
  sweep: { house: number; tick: number; held: boolean } | null;
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
  /** The radio message that started it, if a forward team reported the target. */
  msg: number | null;
}

/** A set-piece attack on a hard position: some squads keep it pinned, others wait at the jump-off for the mortars to land. */
export interface AssaultPlan {
  target: Point;
  start: number;
  stage: "prep" | "go";
  base: number[];
  assault: number[];
  jump: Record<number, Point>;
  /** The mortar mission timed to it, if there is one. */
  mission: number | null;
  goTick: number;
  /** Tick the screening smoke shells were called, or -1. */
  smokeTick: number;
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
  /** Forward observation teams (an NCO, a sniper and a radioman) who report what they see back to headquarters. */
  scoutIds: number[];
  /** The set-piece attack under way, and when the last one ended. */
  plan: AssaultPlan | null;
  planTick: number;
  /** When the platoon last had smoke put down by its mortars. */
  smokeAt: number;
  /** What forward teams have reported and headquarters has not yet acted on. */
  reports: { msg: number; at: Point; tick: number; kind: string }[];
  /** Places already shelled on a report, so the same gun is not hit twice. */
  shelled: { at: Point; tick: number }[];
  /** How far the lead squad has got, since when, and how often the axis of attack has been changed. */
  stall: { best: number; tick: number; shifts: number } | null;
  /** Where the platoon's mortar stands: a pit near its headquarters. */
  mortarPit: Point | null;
  /** Where a squad that called for help, and got no squad sent, wants the mortars. */
  priority: Point | null;
  phase: string;
  startStrength: number;
  withdrawing: boolean;
  withdrawTick: number;
}

// ---------- Ordnance and smoke ----------

export type OrdnanceKind = "frag" | "stick" | "rifle_grenade" | "mortar" | "artillery" | "smoke_grenade" | "smoke_shell" | "tank_shell" | "gun_shell" | "at_rocket";

/** What is wrong with a tank. */
export type TankState = "ready" | "tracked" | "burning" | "abandoned" | "wrecked";

/**
 * A tank or an anti-tank gun. The vehicle itself is a soldier (role "tank" or
 * "field_gun") so it takes a tile, is seen and shot at like anything else; this
 * is what is special about it. Its crew are soldiers too, aboard or out.
 */
export interface Tank {
  /** The vehicle's own soldier id. */
  id: number;
  kind: "tank" | "field_gun";
  side: Side;
  name: string;
  crew: number[];
  state: TankState;
  /** advance: leading the attack; emplaced: dug in to shoot; fall_back: going to the rear. */
  mode: "advance" | "emplaced" | "fall_back";
  shells: number;
  reloadLeft: number;
  /** Direction the hull and the turret face, as a unit vector. */
  hull: Point;
  turret: Point;
  goal: Point | null;
  path: Point[];
  pathIdx: number;
  moveAcc: number;
  replanTick: number;
  /** Bogged down until this tick. */
  stuckUntil: number;
  stuckCount: number;
  /** Tick the tank started burning, or -1. */
  burnTick: number;
  /** Tick it was tracked, or -1. */
  trackedTick: number;
  /** Crew are out working on the track: progress and what is needed, in crew-ticks. */
  repair: { done: number; need: number; started: number } | null;
  /** Tick the tank last came under fire from something that could hurt it. */
  threatTick: number;
  /** Last tick it moved. */
  movedTick: number;
  /** Tick a burning crew gets out, and tick the fire reaches the ammunition. */
  bailAt: number;
  cookAt: number;
  /** Where an emplaced vehicle sits. */
  post: Point | null;
  /** The last thing its main gun fired at, so the turret stays on it. */
  lastTarget: Point | null;
}

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
  /** The radio message behind this round. */
  msg?: number | null;
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

/** A messenger on foot, carrying a squad's call for help back to the platoon leader. */
export interface Runner {
  id: number;
  side: Side;
  /** The squad that sent him. */
  squadId: number;
  x: number;
  y: number;
  /** Where he was a tick ago, for smooth drawing. */
  px: number;
  py: number;
  born: number;
  /** Where he is headed if the platoon leader cannot be found. */
  dest: Point;
}

export interface SmokeCloud {
  id: number;
  x: number;
  y: number;
  radius: number;
  born: number;
  until: number;
  /** Black smoke from a burning vehicle: it rises and does not hide what is under it. */
  dark?: boolean;
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
