import type { Belief } from "../perception/beliefs.ts";
import type { CaseFile } from "../investigation/casefile.ts";
import type { CandidateAction } from "../actions/types.ts";

export type Terrain = "ground" | "field" | "forest" | "water" | "path" | "floor" | "wall" | "door" | "well";

export type Weather = "clear" | "cloudy" | "rain" | "storm" | "snow";
export const WEATHERS: readonly Weather[] = ["clear", "cloudy", "rain", "storm", "snow"];

export type SeasonName = "spring" | "summer" | "autumn" | "winter";
export const SEASON_NAMES: readonly SeasonName[] = ["spring", "summer", "autumn", "winter"];

export type ItemKind = "grain" | "fish" | "berries" | "meat" | "milk" | "eggs" | "wood" | "cloth" | "tool" | "musket";
export const ITEM_KINDS: readonly ItemKind[] = ["grain", "fish", "berries", "meat", "milk", "eggs", "wood", "cloth", "tool", "musket"];
/** Food kinds in order of preference (most filling first). */
export const FOOD_KINDS: readonly ("meat" | "fish" | "grain" | "milk" | "eggs" | "berries")[] = ["meat", "fish", "grain", "milk", "eggs", "berries"];
export type FoodKind = (typeof FOOD_KINDS)[number];

export type Inventory = Record<ItemKind, number>;

export function emptyInventory(): Inventory {
  return { grain: 0, fish: 0, berries: 0, meat: 0, milk: 0, eggs: 0, wood: 0, cloth: 0, tool: 0, musket: 0 };
}

/** Who owns or holds a quantity of items. */
export type HolderRef =
  | { t: "person"; id: number }
  | { t: "household"; id: number }
  | { t: "communal" }
  | { t: "farm"; id: number }
  | { t: "hearth"; id: number }
  | { t: "tile"; x: number; y: number };

export interface Point {
  x: number;
  y: number;
}

export type SizeClass = "small" | "large";

export type EntityRef =
  | { kind: "person"; id: number }
  | { kind: "unknown"; desc: string; sizeClass?: SizeClass }
  | { kind: "place"; x: number; y: number }
  | { kind: "holder"; holder: HolderRef }
  | { kind: "trace"; id: number };

export type Sex = "f" | "m";
export type Role = "none" | "elder";

export type Stage = "stranger" | "acquaintance" | "friend" | "courting" | "pair_bonded" | "estranged";

export interface Relationship {
  bond: number; // [0, 1]
  trust: number; // [-1, 1]
  attraction: number; // [0, 1]
  stage: Stage;
  together: number; // ticks spent near each other
  shared: number; // shared positive events
  negative: number; // betrayal, theft, harm
  stageTick: number;
  kin: boolean;
}

export interface Survival {
  food: number;
  water: number;
  warmth: number;
  rest: number;
  health: number;
}

export interface Wants {
  companionship: number;
  affection: number;
  status: number;
  comfort: number;
  security: number;
}

export interface Personality {
  boldness: number;
  empathy: number;
  greed: number;
  honesty: number;
  loyalty: number;
  vigilance: number;
}

export interface Emotions {
  distress: number;
  guilt: number;
  grief: number;
  jealousy: number;
}

export interface Plan {
  cand: CandidateAction;
  phase: "travel" | "perform";
  path: number[] | null;
  pathIdx: number;
  pathGoal: number;
  /** Tile the person is heading for: a free tile near the destination (or a place in line). */
  goal: number;
  /** True while waiting in line for a spot at the destination. */
  queued: boolean;
  blocked: number;
  moveAcc: number;
  workLeft: number;
  performed: number;
  travelTicks: number;
  startTick: number;
}

export interface Pregnancy {
  fatherId: number;
  dueTick: number;
  conceivedSeq: number;
}

export interface Grievance {
  reason: string;
  tick: number;
}

/** Something a person felt, and why. Kept as a short personal history. */
export interface Feeling {
  tick: number;
  emotion: string;
  cause: string;
  intensity: number;
}

export interface RecentAction {
  tick: number;
  text: string;
  ok: boolean;
}

export type Departure = "exile" | "elopement";

export type DeathCause = "starvation" | "dehydration" | "exposure" | "exhaustion" | "wounds" | "infection" | "animal" | "execution" | "unknown";

/** How madness shows itself. */
export type MadKind = "rampage" | "kidnapper" | "thief" | "wanderer";

/** What each member of a house is expected to do for the family. */
export type Task =
  | "caretaker"
  | "farmer"
  | "fisher"
  | "forager"
  | "hunter"
  | "woodcutter"
  | "carpenter"
  | "stonemason"
  | "healer"
  | "watchman"
  | "herder"
  | "elder"
  | "child";

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

export type InjuryKind = "bruise" | "cut" | "gash" | "bite" | "sprain" | "fracture" | "gunshot" | "lost";

/** A wound to one part of the body. It heals over time, faster when tended, and may leave a lasting mark. */
export interface Injury {
  id: number;
  part: BodyPart;
  kind: InjuryKind;
  /** How bad it is, in (0, 1]. Falls as it heals; a permanent injury keeps a fixed residual severity. */
  severity: number;
  tick: number;
  cause: string;
  byId: number | null;
  /** Best care it has had, in [0, 1]: 0 untended, about 0.85 from a healer. Speeds healing and prevents lasting harm. */
  care: number;
  infected: boolean;
  /** Healed badly (or could never heal, like a lost eye): it stays for life. */
  permanent: boolean;
  /** The lasting condition, once permanent: "lame", "crooked arm", "disfiguring scar", ... */
  lasting: string | null;
}

/** What vengeance a wronged person has in mind. */
export type RetributionSeverity = "intimidate" | "maim" | "kill";

/** Something that happened to an animal, kept as a short history for the viewer. */
export interface AnimalNote {
  tick: number;
  text: string;
}

/** A grave in the village burial ground; a stonemason may carve it a headstone. */
export interface Grave {
  personId: number;
  tick: number;
  x: number;
  y: number;
  marked: boolean;
}

export type AnimalKind = "wolf" | "sheep" | "cow" | "chicken" | "horse";

export interface Animal {
  id: number;
  kind: AnimalKind;
  x: number;
  y: number;
  alive: boolean;
  health: number;
  /** Owning house for livestock; null for wolves. */
  householdId: number | null;
  /** Pen centre for livestock, den for wolves. */
  home: Point;
  hunger: number;
  /** Person or animal being hunted (wolves), as "p:<id>" or "a:<id>". */
  target: string | null;
  state: "rest" | "graze" | "prowl" | "hunt" | "flee" | "ridden";
  /** Person riding this horse, if any. */
  riderId: number | null;
  /** Wolves that fled stay away until this tick. */
  fearUntil: number;
  /** Recent history: what the animal did and what was done to it. */
  log: AnimalNote[];
}

export interface Person {
  id: number;
  name: string;
  sex: Sex;
  birthTick: number;
  householdId: number;
  parents: number[];
  survival: Survival;
  wants: Wants;
  personality: Personality;
  emotions: Emotions;
  inventory: Inventory;
  relationships: Record<number, Relationship>;
  beliefs: Belief[];
  knownTraces: Record<number, true>;
  caseFiles: CaseFile[];
  alive: boolean;
  exiled: boolean;
  causeOfDeath: DeathCause | null;
  deathTick: number | null;
  x: number;
  y: number;
  role: Role;
  isHead: boolean;
  partnerId: number | null;
  plan: Plan | null;
  asleep: boolean;
  sleepStart: number;
  sleepHours: number;
  lossCause: Record<DeathCause, number>;
  lastSighted: Record<number, number>;
  recent: RecentAction[];
  feelings: Feeling[];
  /** Overall mood in [-1, 1], nudged by feelings and drifting back to neutral. */
  mood: number;
  departure: Departure | null;
  task: Task;
  /** Blood others can see: on the tool they carry, or on their clothes. */
  bloodyTool: boolean;
  bloodyClothes: boolean;
  /** Horse being ridden, if any. */
  ridingHorseId: number | null;
  /** Building toward madness, in [0, 1]; past a threshold the person goes mad. */
  madness: number;
  mad: MadKind | null;
  /** Days spent nearly alone, which wears on the mind. */
  lonelyDays: number;
  /** Who holds this person captive, if anyone. */
  captorId: number | null;
  pregnancy: Pregnancy | null;
  detainedUntil: number | null;
  widowedTick: number | null;
  grievances: Record<number, Grievance>;
  rivalId: number | null;
  /** Tick until which a keyed action (e.g. "request_food:5") is not repeated. */
  cooldowns: Record<string, number>;
  convictions: number;
  /** Wounds, healing and healed-badly, Dwarf Fortress style. */
  injuries: Injury[];
  /** Walks with a crutch (made by a carpenter), which helps a bad leg. */
  crutch: boolean;
  /** Who is carrying this injured person, and whom this person is carrying. */
  carriedById: number | null;
  carryingId: number | null;
  /**
   * How often the council let off someone this person holds responsible for a crime
   * against them or their kin, keyed by that person. Enough of it turns to retribution.
   */
  injustice: Record<number, number>;
}

export interface Household {
  id: number;
  name: string;
  buildingId: number;
  headId: number | null;
  store: Inventory;
}

export interface Building {
  id: number;
  kind: "house" | "store" | "hall";
  householdId: number | null;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  door: Point;
  interior: Point[];
  bed: Point;
  hearthSpot: Point;
  condition: number;
  hearth: Inventory | null;
  burnAcc: number;
  lit: boolean;
}

export type TraceKind = "footprint" | "item_missing" | "blood" | "body" | "object_left" | "sound" | "wound";

export interface Trace {
  id: number;
  tick: number;
  location: Point;
  kind: TraceKind;
  involves: EntityRef[];
  details: Record<string, unknown>;
  discovered: boolean;
  roofed: boolean;
  rainExposure: number;
  /** Engine-only link to the true crime. Never exposed to agents. */
  crimeId: number | null;
  discoveredTick: number | null;
}

export type CrimeKind = "theft" | "attempted_theft" | "assault" | "murder" | "intimidation";

/** World truth about a crime. Agents never read this. */
export interface Crime {
  id: number;
  kind: CrimeKind;
  actorId: number;
  victim: HolderRef;
  tick: number;
  location: Point;
  actionSeq: number;
  traceIds: number[];
  qty: number;
}

export type ObligationKind = "food_share" | "protection" | "debt" | "kin_duty" | "pair_duty" | "childcare";

export interface Obligation {
  id: number;
  holder: number;
  owed_to: number;
  kind: ObligationKind;
  strength: number;
  due: number | null;
  status: "active" | "fulfilled" | "broken";
  breaches: number;
  amount: number;
}

export type SentenceKind = "restitution" | "imprisonment" | "exile" | "execution";

export interface Hearing {
  id: number;
  caseKey: string;
  kind: "theft" | "violence";
  accusedId: number;
  accuserIds: number[];
  victim: EntityRef | null;
  place: Point;
  timeFrom: number;
  timeTo: number;
  judges: number[];
  recused: boolean;
  summoned: number[];
  scheduledTick: number;
  postponements: number;
  status: "scheduled" | "held" | "dismissed";
  /** Engine-only link to the true crime, for logging truth next to the verdict. */
  crimeId: number | null;
}

export interface Sentence {
  id: number;
  hearingId: number;
  convictId: number;
  kind: SentenceKind;
  executorId: number;
  victim: EntityRef | null;
  qty: number;
  status: "pending" | "enforced" | "failed" | "void";
  attempts: number;
  createdTick: number;
}

/** A family compound: the house's dwelling, farm and well, a short walk through the forest from town. */
export interface Compound {
  householdId: number;
  center: Point;
  buildingId: number;
  farm: Point[];
  well: Point;
  gate: Point;
}

export type PlotKind = "theft" | "murder" | "raid" | "retribution";
export type PlotStatus = "planning" | "executed" | "foiled" | "abandoned";

/** An intention someone is working toward over time: a theft, a killing, or a raid on another house. */
export interface Plot {
  id: number;
  kind: PlotKind;
  plannerId: number;
  householdId: number;
  targetPersonId: number | null;
  targetHouseholdId: number | null;
  targetHolder: HolderRef | null;
  participants: number[];
  /** Participants who have already struck (raids). */
  struck: number[];
  motive: string;
  status: PlotStatus;
  createdTick: number;
  expiresTick: number;
  scheduledTick: number | null;
  outcome: string | null;
  /** Murder plots: when and where the stalker has seen the target alone. */
  sightings: { hour: number; x: number; y: number }[];
  /** Retribution plots: frighten, maim or kill. */
  severity: RetributionSeverity | null;
}

/** A witness record created when an action is detected; turned into a belief during perception. */
export interface PendingObservation {
  observerId: number;
  eventSeq: number;
  crimeId: number | null;
  belief: Omit<Belief, "id" | "sourceSeq">;
}

/** Public knowledge everyone in a small village has: who lives where, ages, kinship. */
export interface CensusEntry {
  householdId: number;
  sex: Sex;
  birthTick: number;
  parents: number[];
  partnerId: number | null;
  alive: boolean;
  /** Everyone knows who keeps a musket. */
  armed: boolean;
}
