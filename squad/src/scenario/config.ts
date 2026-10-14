// Every tunable parameter lives here, so tuning never requires code changes.
// One tick is one second; one tile is about 3 metres.

import type { MapKind, Terrain, WeaponId, Weather, WeatherKind } from "../world/types.ts";

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
  m1_garand: { name: "M1 Garand", capacity: 8, reload: 3, rate: 0.55, accuracy: 0.5, rangeScale: 35, maxRange: 110, severity: [0.45, 1], suppression: 0.05, noise: 140, automatic: false, heat: 0 },
  m1_carbine: { name: "M1 carbine", capacity: 15, reload: 3, rate: 0.6, accuracy: 0.45, rangeScale: 22, maxRange: 70, severity: [0.35, 0.8], suppression: 0.04, noise: 110, automatic: false, heat: 0 },
  thompson: { name: "Thompson submachine gun", capacity: 30, reload: 4, rate: 3, accuracy: 0.28, rangeScale: 12, maxRange: 40, severity: [0.3, 0.75], suppression: 0.035, noise: 110, automatic: true, heat: 0 },
  bar: { name: "Browning Automatic Rifle", capacity: 20, reload: 4, rate: 3.5, accuracy: 0.22, rangeScale: 32, maxRange: 120, severity: [0.45, 1], suppression: 0.06, noise: 150, automatic: true, heat: 0 },
  kar98k: { name: "Karabiner 98k", capacity: 5, reload: 4, rate: 0.4, accuracy: 0.55, rangeScale: 38, maxRange: 115, severity: [0.45, 1], suppression: 0.05, noise: 140, automatic: false, heat: 0 },
  kar98k_scoped: { name: "scoped Karabiner 98k", capacity: 5, reload: 4, rate: 0.25, accuracy: 0.75, rangeScale: 220, maxRange: 150, severity: [0.5, 1], suppression: 0.05, noise: 140, automatic: false, heat: 0 },
  m1903_scoped: { name: "scoped M1903A4 Springfield", capacity: 5, reload: 4, rate: 0.25, accuracy: 0.75, rangeScale: 220, maxRange: 150, severity: [0.5, 1], suppression: 0.05, noise: 140, automatic: false, heat: 0 },
  mp40: { name: "MP 40", capacity: 32, reload: 4, rate: 3, accuracy: 0.26, rangeScale: 12, maxRange: 40, severity: [0.3, 0.75], suppression: 0.035, noise: 110, automatic: true, heat: 0 },
  mg42: { name: "MG 42", capacity: 50, reload: 6, rate: 8, accuracy: 0.17, rangeScale: 45, maxRange: 150, severity: [0.45, 1], suppression: 0.07, noise: 200, automatic: true, heat: 0.0045 },
  pistol: { name: "pistol", capacity: 8, reload: 3, rate: 0.6, accuracy: 0.35, rangeScale: 6, maxRange: 15, severity: [0.3, 0.7], suppression: 0.02, noise: 80, automatic: false, heat: 0 },
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
  stairs: 1.5,
  marsh: 2.2,
  brush: 1.5,
  ditch: 1.4,
  deadfall: 1.9,
};

export const DEFAULT_CONFIG = {
  time: {
    /** Seconds per tick. */
    secondsPerTick: 1,
    /** The battle starts at this time of day, in minutes after midnight. */
    startMinute: 6 * 60 + 40,
    /** The engagement is called off after this many ticks: an hour of fighting, plus the march up out of sight. */
    maxTicks: 70 * 60,
    date: "12 June 1944",
  },
  map: {
    /** Wider than deep: room for outlying hamlets, trench lines and flank positions either side of the main road. */
    width: 240,
    /**
     * Deep enough that the attackers form up out of sight and range of the
     * defenders: the defended hedge is kept at least `startClearance` tiles
     * from the line of departure, and that only fits with room to spare.
     */
    height: 216,
    /** Tiles beyond the longest sight on the field (a sniper's scope in clear weather) that the two sides start apart. */
    startMargin: 6,
    fieldWidth: [24, 40] as [number, number],
    fieldHeight: [13, 19] as [number, number],
    mergeChance: 0.14,
    gapWidth: [2, 3] as [number, number],
    /** The kind of ground to fight over; null lets the seed choose. */
    kind: null as MapKind | null,
    /** How often the seed chooses each kind. */
    kindWeights: { hamlet: 0.3, rural: 0.25, road: 0.2, town: 0.25 } as Record<MapKind, number>,
  },
  terrain: {
    moveCost,
    /** Line-of-sight left after passing through one tile of each kind. */
    seeThrough: { woods: 0.78, orchard: 0.9, wheat: 0.97, hedge: 0, wall: 0.85, building: 0, rubble: 0.92, window: 0.75, door: 0.75, brush: 0.82, deadfall: 0.88 } as Partial<Record<Terrain, number>>,
    /** Protection from a hedge, wall or window between a man and the shooter, right beside him. */
    edgeCover: { hedge: 0.85, wall: 0.65, window: 0.8, door: 0.55, rubble: 0.45, woods: 0.3, orchard: 0.15, building: 0.95, brush: 0.2, deadfall: 0.35 } as Partial<Record<Terrain, number>>,
    /** Protection from the tile he lies in. */
    ownCover: { foxhole: 0.75, crater: 0.5, rubble: 0.3, woods: 0.2, orchard: 0.1, ditch: 0.55, brush: 0.1, deadfall: 0.25 } as Partial<Record<Terrain, number>>,
    /** Concealment: how much harder he is to spot on this ground. Foliage and dark rooms hide a man well. */
    concealment: { woods: 0.35, orchard: 0.6, wheat: 0.6, rubble: 0.65, foxhole: 0.45, crater: 0.7, floor: 0.4, stairs: 0.4, door: 0.7, brush: 0.42, ditch: 0.5, marsh: 0.85, deadfall: 0.55 } as Partial<Record<Terrain, number>>,
    /** How tall what grows or stands on each kind of ground is, in metres. */
    height: { hedge: 2.6, wall: 1.8, woods: 9, orchard: 4.5, wheat: 1.1, brush: 1.6, rubble: 1, deadfall: 1.5 } as Partial<Record<Terrain, number>>,
    floorHeight: 3,
    eye: 1.5,
    body: 1,
    /** Uphill: each metre climbed in a step adds this share to its cost; downhill saves a little. */
    climbCost: 0.45,
    downhill: 0.06,
    stairsCost: 3,
    /** Fire from above comes in over the cover in front of a man: per unit of slope, this share of it is lost. */
    plunge: 2.5,
  },
  weather: {
    /** The weather to fight in; null lets the seed choose. */
    kind: null as WeatherKind | null,
    weights: { clear: 0.35, overcast: 0.3, rain: 0.2, fog: 0.15 } as Record<WeatherKind, number>,
    kinds: {
      clear: { kind: "clear", label: "a clear, bright morning", sight: 1, spot: 1, hearing: 1, mud: 1, fatigue: 1, aim: 1 },
      overcast: { kind: "overcast", label: "a grey, overcast morning", sight: 0.9, spot: 0.92, hearing: 1, mud: 1, fatigue: 1, aim: 1 },
      rain: { kind: "rain", label: "steady rain", sight: 0.65, spot: 0.78, hearing: 0.7, mud: 1.3, fatigue: 1.25, aim: 0.9 },
      fog: { kind: "fog", label: "thick morning fog", sight: 0.32, spot: 0.7, hearing: 0.9, mud: 1.1, fatigue: 1, aim: 0.95 },
    } as Record<WeatherKind, Weather>,
  },
  /** High ground: a shooter above his target hits a little more often, one below a little less. */
  highGround: { perMetre: 0.025, max: 0.2 },
  /** Running and climbing tire men out; rest brings them back. */
  fatigue: {
    perTile: { walk: 0.0015, crouch: 0.003, rush: 0.009, crawl: 0.004 },
    /** Extra per metre climbed, and per flight of stairs. */
    climbPerMetre: 0.012,
    stairs: 0.012,
    /** Recovered per tick while not moving. */
    recover: 0.006,
    /** At full fatigue a man moves this much slower, and aims this much worse. */
    speedLoss: 0.45,
    aimLoss: 0.3,
    /** Above this, a man cannot rush any more: he can only jog. */
    winded: 0.85,
  },
  sniper: {
    /** How far from where he is a sniper looks for a hide, and the range band he wants to shoot over. */
    hideRadius: 26,
    minRange: 25,
    maxRange: 100,
    /** He moves on after this many shots from one hide, or when he is fired on. */
    shotsPerHide: 3,
    rethinkTicks: 150,
    /** He only shoots when the chance of a hit is at least this, or this for a machine gunner or leader. */
    minHit: 0.16,
    priorityMinHit: 0.05,
    /** He wants no friend nearer than this: alone, he is harder to find. */
    alone: 5,
  },
  /** What shells do to what they hit. */
  destruction: {
    /** Hits a stretch of wall takes before it is a breach: stone, a window or door, a garden wall. */
    wallHp: { building: 4, window: 2, door: 2, wall: 3 } as Partial<Record<Terrain, number>>,
    /** Damage to walls at the burst and around it, and how far it reaches, in tiles. */
    mortar: { center: 2, ring: 1, reach: 1.5 },
    artillery: { center: 4, ring: 2, reach: 2.5 },
    /** A house falls in when this share of its walls are breached, or its roof has taken this many hits per ten tiles of floor. */
    collapseWalls: 0.3,
    collapseRoof: 0.8,
    /** Chance a tree within reach is smashed to deadfall, by a mortar bomb and by a shell. */
    treeMortar: 0.6,
    treeArtillery: 0.85,
    /** Chance a hedge is blown open by a mortar bomb bursting on it, and by a shell bursting near it (one bursting on it always does). */
    hedgeMortar: 0.5,
    hedgeArtillery: 0.85,
  },
  ambush: {
    /** Chance the defenders put a squad out in ambush, when they have two or more. */
    chance: 0.55,
    /** It springs when an enemy it can see comes this close, or when it is found. */
    trigger: 22,
    /** How far in front of the defended hedge it may lie, in tiles. */
    forward: [6, 34] as [number, number],
  },
  help: {
    /** A German runner takes this long to reach the Zugführer; an American squad radio is instant. */
    runnerTicks: 25,
    /** A squad calls again no sooner than this. */
    again: 300,
    /** It calls when this share of its men are pinned, or it has been stuck fixing the enemy this long, or it is down to this strength in contact. */
    pinnedShare: 0.5,
    stuckTicks: 50,
    weak: 0.6,
  },
  breach: {
    /** A house within this many tiles of the assault is cleared with grenades first. */
    within: 9,
    /** Ticks to wait for the stack before throwing anyway, and for the grenades before going in. */
    stackTicks: 45,
    grenadeTicks: 5,
    /** The clearing is given up after this long. */
    giveUp: 160,
  },
  shelling: {
    /** A squad reacts to rounds landing within this many tiles of its men, for this many ticks. */
    radius: 13,
    recent: 10,
    /** How far it moves to get out of the beaten zone. */
    displace: 18,
    /** If at least this share of the men are in holes or indoors, they stay down instead. */
    stayIfCovered: 0.6,
    /** Attackers this close to the enemy position go forward through the fire. */
    rushThrough: 26,
    /** Ticks before the same squad moves for shelling again. */
    cooldown: 60,
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
    /** However far out, a round still has this share of its close-range chance: long-range fire is wild, but not harmless. */
    longRangeFloor: 0.1,
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
    /** Seconds a round is in the air after it is fired; men within earshot hear it coming for the last two. */
    flight: { mortar: 9, artillery: 12, smoke_shell: 9 },
    whistleRadius: 10,
    roundInterval: 2,
    spotScatter: 7,
    effectScatter: 4,
    /** Not on targets this close to friends. */
    dangerClose: 14,
    /** Radio range from the radioman to the platoon leader. */
    radioReach: 3,
  },
  perception: {
    /** Furthest a man can make out another, in tiles (about 210 m), before weather. */
    maxRange: 70,
    /** A sniper's scope lets him pick men out this much further. */
    scope: 1.7,
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
    exposureEvery: 20,
    /** A man firing from concealment gives himself away this much less; a sniper far less still. */
    concealedFiring: 0.4,
    sniperFiring: 0.15,
    /** Heard positions are this much vaguer for a sniper, and for a man firing from concealment. */
    sniperHearError: 4,
    concealedHearError: 2,
    /** Beyond this range a sniper's shot gives no bearing at all: just a crack overhead. */
    sniperHeardWithin: 60,
    /** A man fired on by someone he cannot see judges where it came from this far off, per tile of range. */
    fireBearingError: 0.08,
    /** Spotting a man inside a dark room from out in the light, past this range, is harder by this much. */
    darkRoomRange: 15,
    darkRoom: 0.6,
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
    /** Rifle squads in the platoon: about fifty men a side with headquarters and, for the defenders, the forward teams. */
    usSquads: [4, 4] as [number, number],
    deSquads: [4, 4] as [number, number],
    /** Chance the Germans attack and the Americans defend. */
    germanAttackChance: 0.25,
    sniperChance: 0.45,
    /** Chance the American platoon headquarters has a sniper with it. */
    usSniperChance: 0.5,
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
