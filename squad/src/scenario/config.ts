// Every tunable parameter lives here, so tuning never requires code changes.
// One tick is one second; one tile is about 3 metres.

import type { Terrain, WeaponId } from "../world/types.ts";

export interface WeaponSpec {
  name: string;
  /** Rounds in a magazine, clip or belt. */
  capacity: number;
  /** Ticks to reload. */
  reload: number;
  /** Rounds fired per tick of firing. Fractions accumulate. */
  rate: number;
  /** Chance per round to hit a standing man in the open at point blank. */
  accuracy: number;
  /** Range (tiles) over which accuracy falls by a factor of e. */
  rangeScale: number;
  /** Furthest it is used at, in tiles. */
  maxRange: number;
  /** Wound severity range of a hit. */
  severity: [number, number];
  /** Suppression each round adds near where it lands. */
  suppression: number;
  /** How far the shots are heard, in tiles. */
  noise: number;
  automatic: boolean;
  /** Barrel heat per round (machine guns only). */
  heat: number;
}

const weapons: Record<WeaponId, WeaponSpec> = {
  m1_garand: { name: "M1 Garand", capacity: 8, reload: 3, rate: 0.55, accuracy: 0.5, rangeScale: 70, maxRange: 150, severity: [0.45, 1], suppression: 0.05, noise: 140, automatic: false, heat: 0 },
  m1_carbine: { name: "M1 carbine", capacity: 15, reload: 3, rate: 0.6, accuracy: 0.45, rangeScale: 40, maxRange: 90, severity: [0.35, 0.8], suppression: 0.04, noise: 110, automatic: false, heat: 0 },
  thompson: { name: "Thompson submachine gun", capacity: 30, reload: 4, rate: 3, accuracy: 0.28, rangeScale: 18, maxRange: 50, severity: [0.3, 0.75], suppression: 0.035, noise: 110, automatic: true, heat: 0 },
  bar: { name: "Browning Automatic Rifle", capacity: 20, reload: 4, rate: 3.5, accuracy: 0.22, rangeScale: 55, maxRange: 150, severity: [0.45, 1], suppression: 0.06, noise: 150, automatic: true, heat: 0 },
  kar98k: { name: "Karabiner 98k", capacity: 5, reload: 4, rate: 0.4, accuracy: 0.55, rangeScale: 80, maxRange: 160, severity: [0.45, 1], suppression: 0.05, noise: 140, automatic: false, heat: 0 },
  kar98k_scoped: { name: "scoped Karabiner 98k", capacity: 5, reload: 4, rate: 0.25, accuracy: 0.85, rangeScale: 170, maxRange: 200, severity: [0.5, 1], suppression: 0.05, noise: 140, automatic: false, heat: 0 },
  mp40: { name: "MP 40", capacity: 32, reload: 4, rate: 3, accuracy: 0.26, rangeScale: 18, maxRange: 50, severity: [0.3, 0.75], suppression: 0.035, noise: 110, automatic: true, heat: 0 },
  mg42: { name: "MG 42", capacity: 50, reload: 6, rate: 8, accuracy: 0.17, rangeScale: 85, maxRange: 200, severity: [0.45, 1], suppression: 0.07, noise: 200, automatic: true, heat: 0.0045 },
  pistol: { name: "pistol", capacity: 8, reload: 3, rate: 0.6, accuracy: 0.35, rangeScale: 8, maxRange: 15, severity: [0.3, 0.7], suppression: 0.02, noise: 80, automatic: false, heat: 0 },
};

const moveCost: Record<Terrain, number> = {
  grass: 1,
  wheat: 1.3,
  road: 0.9,
  orchard: 1.2,
  woods: 1.6,
  hedge: 9,
  wall: 2.5,
  building: Infinity,
  floor: 1,
  door: 1,
  window: Infinity,
  water: 4,
  bridge: 0.9,
  rubble: 2,
  crater: 1.4,
  foxhole: 1.4,
};

export const DEFAULT_CONFIG = {
  time: {
    /** Seconds per tick. */
    secondsPerTick: 1,
    /** The battle starts at this time of day, in minutes after midnight. */
    startMinute: 6 * 60 + 40,
    /** The engagement is called off after this many ticks. */
    maxTicks: 60 * 60,
    date: "12 June 1944",
  },
  map: { width: 144, height: 104, fieldWidth: [24, 40] as [number, number], fieldHeight: [13, 19] as [number, number], mergeChance: 0.14, gapWidth: [2, 3] as [number, number] },
  terrain: {
    moveCost,
    /** Line-of-sight left after passing through one tile of each kind. */
    seeThrough: { woods: 0.78, orchard: 0.9, wheat: 0.97, hedge: 0, wall: 0.85, building: 0, rubble: 0.92, window: 0.75, door: 0.75 } as Partial<Record<Terrain, number>>,
    /** Protection from a hedge, wall or window between a man and the shooter, right beside him. */
    edgeCover: { hedge: 0.85, wall: 0.65, window: 0.8, door: 0.55, rubble: 0.45, woods: 0.3, orchard: 0.15, building: 0.95 } as Partial<Record<Terrain, number>>,
    /** Protection from the tile he lies in. */
    ownCover: { foxhole: 0.75, crater: 0.5, rubble: 0.3, woods: 0.2, orchard: 0.1 } as Partial<Record<Terrain, number>>,
    /** Concealment: how much harder he is to spot on this ground. */
    concealment: { woods: 0.5, orchard: 0.7, wheat: 0.6, rubble: 0.7, foxhole: 0.45, crater: 0.7, floor: 0.6 } as Partial<Record<Terrain, number>>,
  },
  weapons,
  movement: {
    /** Tiles per tick at each pace. */
    speed: { walk: 0.55, crouch: 0.38, rush: 1.6, crawl: 0.14 },
    /** A rush is a few seconds up, then down again: "I'm up, he sees me, I'm down". */
    rushTicks: 4,
    detourAfterTicks: 3,
    maxTravelTicks: 600,
    /** Carrying a man slows the carrier to this fraction. */
    carrySpeed: 0.45,
    /** Exposure cost weight when routing past known enemies. */
    exposureWeight: 6,
  },
  posture: {
    /** How big a target each posture makes. */
    size: { stand: 1, crouch: 0.65, prone: 0.35 },
    /** Accuracy of the shooter by posture. */
    steadiness: { stand: 0.8, crouch: 0.95, prone: 1.1 },
  },
  fire: {
    /** Accuracy multiplier when firing at a remembered position rather than a seen man. */
    blindFactor: 0.12,
    /** Accuracy for a man who moved this tick. */
    movingShooter: 0.35,
    movingTarget: 0.75,
    /** Suppression falls off over this radius around the aim point. */
    suppressRadius: 2.5,
    /** Chance a stray round hits a friend right next to the line of fire. */
    friendlyFireChance: 0.02,
    /** Machine-gun barrel cooling per tick, and ticks to change it. */
    coolPerTick: 0.012,
    barrelChangeTicks: 7,
    /** Without an assistant feeding the belt, a machine gun fires at this fraction. */
    unfedFactor: 0.6,
    /** Medics are spared this often by an enemy who sees the red cross. */
    medicSpared: 0.85,
  },
  /** How much each body part's wound costs in health, per unit of severity. */
  lethality: { head: 1.25, face: 0.5, "left eye": 0.65, "right eye": 0.65, torso: 0.6, "left arm": 0.12, "right arm": 0.12, "left hand": 0.08, "right hand": 0.08, "left leg": 0.2, "right leg": 0.2, "left foot": 0.08, "right foot": 0.08 },
  /** How hard each body part bleeds. */
  partBleed: { head: 0.8, face: 0.6, "left eye": 0.5, "right eye": 0.5, torso: 1.25, "left arm": 0.7, "right arm": 0.7, "left hand": 0.4, "right hand": 0.4, "left leg": 1, "right leg": 1, "left foot": 0.4, "right foot": 0.4 },
  explosives: {
    /** Expected fragment hits at the burst point, and the distance over which they fall by e. */
    frag: { fragments: 4.5, falloff: 1.5, radius: 6, severity: [0.25, 0.75] as [number, number], blast: 0.15 },
    stick: { fragments: 3.5, falloff: 1.3, radius: 5, severity: [0.2, 0.65] as [number, number], blast: 0.3 },
    rifle_grenade: { fragments: 5, falloff: 1.5, radius: 6, severity: [0.25, 0.7] as [number, number], blast: 0.15 },
    mortar: { fragments: 5, falloff: 2, radius: 9, severity: [0.25, 0.8] as [number, number], blast: 0.3 },
    artillery: { fragments: 9, falloff: 3, radius: 14, severity: [0.35, 0.95] as [number, number], blast: 0.5 },
    /** Throwing ranges in tiles. */
    throwRange: { frag: 12, stick: 13 },
    rifleGrenadeRange: [15, 65] as [number, number],
    fuseTicks: 3,
    /** Scatter of a throw, tiles per tile of distance. */
    throwScatter: 0.08,
    /** Someone who sees a grenade land near them may dive away. */
    diveChance: 0.45,
    suppression: 0.8,
  },
  smoke: { grenadeRadius: 4, shellRadius: 6, grenadeTicks: 75, shellTicks: 100, /** Visibility left per smoky tile crossed. */ seeThrough: 0.45 },
  mortars: {
    missions: { us: 3, de: 2 },
    rounds: 6,
    spotDelay: 35,
    effectDelay: 22,
    roundInterval: 2,
    spotScatter: 7,
    effectScatter: 4,
    /** Not on targets this close to friends. */
    dangerClose: 14,
    /** Radio range from the radioman to the platoon leader. */
    radioReach: 3,
  },
  perception: {
    maxRange: 170,
    /** Spotting chance per tick of an unconcealed, standing, still man at close range. */
    spotBase: 0.55,
    /** Firing gives a man away. */
    firingFactor: 4,
    movingFactor: 1.8,
    /** Below this visibility a line of sight does not count. */
    minVisibility: 0.12,
    /** Shots are heard; the shooter's position is guessed this far off per tile of range. */
    hearError: 0.06,
    contactMemory: 90,
    /** Contacts are shared with squadmates within this range by shouting. */
    shoutRange: 25,
    /** How often exposure maps are rebuilt, in ticks. */
    exposureEvery: 15,
  },
  suppression: {
    decay: 0.045,
    /** Suppression above these marks a man as pinned, and makes him go prone. */
    pinned: 0.65,
    prone: 0.35,
    accuracyLoss: 0.7,
  },
  morale: {
    start: { green: 0.68, regular: 0.78, veteran: 0.88 },
    friendHit: 0.03,
    friendKilled: 0.055,
    leaderDown: 0.12,
    selfHit: 0.15,
    underFirePerTick: 0.002,
    recoverPerTick: 0.0015,
    rallyPerTick: 0.012,
    rallyRange: 7,
    enemyDown: 0.03,
    /** Below these a man is shaken (won't advance) or broken (falls back or gives up). */
    shaken: 0.3,
    broken: 0.14,
    surrenderEnemyWithin: 10,
    confusionTicks: 15,
  },
  /** Wounds, Dwarf Fortress style, as in the village. Rates per day still apply after the battle. */
  injuries: {
    healPerDay: { bruise: 0.5, cut: 0.25, gash: 0.1, sprain: 0.22, fracture: 0.035, gunshot: 0.05, shrapnel: 0.07, lost: 0 },
    infectionPerDay: 0.1,
    bleed: { cut: 0.35, gash: 1, gunshot: 1.2, shrapnel: 0.9 } as Record<string, number>,
    /** Battle scale: health lost per minute per unit of bleeding, and clotting per minute. */
    bleedHealthPerMinute: 0.045,
    clotPerMinute: 0.025,
    infectMinSeverity: 0.25,
    infectionHealthPerDay: 0.06,
    lasting: { lame: 0.5, crookedArm: 0.4, faceScar: 0.6, scar: 0.35, careProtects: 0.75 },
    /** Below this health a man passes out. */
    unconsciousBelow: 0.3,
    /** Pain above this takes a man out of the fight (morphine halves it). */
    painOut: 0.62,
    medicSkill: 0.85,
    /** A man stumbles while rushing over rough ground this often per tile. */
    stumblePerTile: 0.0004,
    callEveryTicks: 20,
  },
  battle: {
    /** Attackers must hold the objective this long with no defender near. */
    holdTicks: 30,
    objectiveRadius: 9,
    /** Attack is given up below this share of effective strength; defenders withdraw below theirs. */
    attackBreak: 0.35,
    defendBreak: 0.35,
    /** A withdrawal this long settles the battle. */
    withdrawTicks: 240,
  },
  aftermath: { days: 30, aidStationCare: 0.8 },
  forces: {
    usSquads: [2, 3] as [number, number],
    deSquads: [2, 2] as [number, number],
    /** Chance the Germans attack and the Americans defend. */
    germanAttackChance: 0.25,
    sniperChance: 0.45,
  },
  /** Run invariant checks every tick. */
  checkInvariants: true,
  /** Log a tick summary every this many ticks. */
  summaryEvery: 10,
};

export type SimConfig = typeof DEFAULT_CONFIG;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function merge(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const key of Object.keys(src)) {
    const sv = src[key];
    const tv = target[key];
    if (isPlainObject(sv) && isPlainObject(tv)) merge(tv, sv);
    else if (sv !== undefined) target[key] = Array.isArray(sv) ? sv.slice() : sv;
  }
}

export function makeConfig(overrides: DeepPartial<SimConfig> = {}): SimConfig {
  const cfg = structuredClone(DEFAULT_CONFIG);
  merge(cfg as unknown as Record<string, unknown>, overrides as Record<string, unknown>);
  return cfg;
}
