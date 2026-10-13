// Every tunable parameter lives here, so tuning never requires code changes.
// Weather rows are weights over [clear, cloudy, rain, storm, snow].

type Row = [number, number, number, number, number];
type Matrix = { clear: Row; cloudy: Row; rain: Row; storm: Row; snow: Row };

const springWeather: Matrix = {
  clear: [0.6, 0.25, 0.12, 0.02, 0.01],
  cloudy: [0.3, 0.4, 0.25, 0.04, 0.01],
  rain: [0.25, 0.35, 0.35, 0.05, 0],
  storm: [0.2, 0.4, 0.3, 0.1, 0],
  snow: [0.3, 0.4, 0.2, 0, 0.1],
};
const summerWeather: Matrix = {
  clear: [0.75, 0.18, 0.05, 0.02, 0],
  cloudy: [0.45, 0.35, 0.15, 0.05, 0],
  rain: [0.4, 0.3, 0.25, 0.05, 0],
  storm: [0.4, 0.3, 0.2, 0.1, 0],
  snow: [1, 0, 0, 0, 0],
};
const autumnWeather: Matrix = {
  clear: [0.5, 0.3, 0.15, 0.04, 0.01],
  cloudy: [0.25, 0.4, 0.28, 0.05, 0.02],
  rain: [0.2, 0.35, 0.37, 0.06, 0.02],
  storm: [0.2, 0.35, 0.3, 0.15, 0],
  snow: [0.2, 0.3, 0.2, 0, 0.3],
};
const winterWeather: Matrix = {
  clear: [0.45, 0.3, 0.05, 0.03, 0.17],
  cloudy: [0.25, 0.4, 0.08, 0.05, 0.22],
  rain: [0.2, 0.35, 0.25, 0.05, 0.15],
  storm: [0.15, 0.3, 0.1, 0.15, 0.3],
  snow: [0.2, 0.3, 0.05, 0.05, 0.4],
};

export const DEFAULT_CONFIG = {
  time: {
    ticksPerDay: 144,
    minutesPerTick: 10,
    daysPerSeason: 90,
    /** Day of year at tick 0. 210 = day 30 of autumn, so winter starts on day 60 of the run. */
    startDayOfYear: 210,
    startHour: 6,
  },
  /** One tile is about 20 m; compounds sit about 40 tiles (a bit under a km) from town. */
  map: { width: 160, height: 120, compoundDistance: 40, compoundRadius: 13, townRadius: 14, meadows: 10, rockOutcrops: 9 },
  light: {
    darkestHour: 2,
    moonlight: 0.03,
    nightThreshold: 0.3,
    weatherFactor: { clear: 1, cloudy: 0.8, rain: 0.65, storm: 0.45, snow: 0.75 },
  },
  temperature: {
    /** Mid-season means for spring, summer, autumn, winter (degrees C). */
    seasonMeans: [10, 24, 11, 0] as [number, number, number, number],
    dailySwing: 5,
    warmestHour: 15,
    weatherOffset: { clear: 0, cloudy: -1, rain: -2, storm: -4, snow: -3 },
    comfortTemp: 14,
  },
  weather: {
    changeEveryTicks: 18,
    transitions: { spring: springWeather, summer: summerWeather, autumn: autumnWeather, winter: winterWeather },
    snowMaxTemp: 1,
    rainToSnowBelow: -1,
  },
  water: {
    drinkDraw: 0.004,
    wellRefillPerTick: 0.0012,
    rainRefillPerTick: 0.008,
    /** Chance per day that a drought starts, by season. */
    droughtChancePerDay: [0.01, 0.05, 0.02, 0] as [number, number, number, number],
    droughtDays: 6,
    droughtRefillFactor: 0.1,
    wellMinToDrink: 0.05,
  },
  needs: {
    foodDecayPerDay: 0.5,
    waterDecayPerDay: 0.9,
    waterHeatPerDegree: 0.06,
    waterHeatAbove: 20,
    restDecayPerDay: 1.35,
    sleepRestorePerTick: 0.024,
    daySleepFactor: 0.6,
    unshelteredSleepFactor: 0.8,
    warmthLossPerDegreeTick: 0.0009,
    warmthGainPerTick: 0.012,
    shelterBonusTemp: 8,
    hearthBonusTemp: 13,
    clothBonusTemp: 4,
    /** A fur coat keeps out the cold far better than plain clothes. */
    coatBonusTemp: 8,
    nightOutdoorPenalty: 2,
    stormOutdoorPenalty: 3,
    healthLossPerTick: { food: 1 / (144 * 10), water: 1 / (144 * 3), warmth: 1 / (144 * 1.5), rest: 1 / (144 * 8) },
    healthRecoverPerTick: 0.0015,
    recoverAbove: 0.25,
    infantAge: 2,
    infantDrawOnMother: 0.3,
  },
  wants: {
    companionshipDecayPerDay: 0.35,
    companionshipGainPerTick: 0.008,
    affectionDecayPerDay: 0.05,
    affectionPartnerGainPerTick: 0.004,
    securityRecoverPerDay: 0.08,
    wantDriftPerTick: 0.004,
    companyRadius: 3,
  },
  emotions: {
    guiltDecayPerDay: 0.05,
    griefDecayPerDay: 0.02,
    jealousyDecayPerDay: 0.06,
  },
  food: {
    value: { grain: 0.25, fish: 0.3, berries: 0.15, meat: 0.35, milk: 0.15, eggs: 0.12 },
    eatDuration: 2,
    /** Below this food level, eating is not offered. */
    fullAbove: 0.92,
  },
  movement: {
    adultSpeed: 12,
    childSpeed: 8.5,
    elderSpeed: 8.5,
    badWeatherFactor: 0.7,
    snowFactor: 0.6,
    maxTravelTicks: 120,
    /** Ticks to wait behind someone before looking for a way around (unless queueing at the destination). */
    detourAfterTicks: 2,
  },
  forage: {
    duration: 6,
    minAge: 8,
    /** Chance of a find per foraging trip, by season (spring, summer, autumn, winter). */
    forestChance: [0.4, 0.5, 0.45, 0.15] as [number, number, number, number],
    riverChance: [0.35, 0.45, 0.4, 0.22] as [number, number, number, number],
    maxYield: 3,
    /** Wild food depletes with use: finds add stress, which recovers by this factor each day. */
    stressCapacity: { forest: 500, river: 400 },
    stressRecoveryPerDay: 0.8,
    minYieldFactor: 0.15,
    /** Foraging without a tool finds food less often. */
    noToolFactor: 0.75,
  },
  wood: {
    gatherDuration: 8,
    minAge: 12,
    yieldMin: 3,
    yieldMax: 5,
    ticksPerWoodUnit: 48,
    burnBelowTemp: 15,
    hearthTarget: 3,
    householdTarget: 15,
  },
  shelter: { decayPerDay: 0.005, stormDamagePerTick: 0.0015, repairAmount: 0.25, repairWood: 2, repairBelow: 0.75, repairDuration: 6 },
  /** Each house has its own farm. Harvest goes to the house store, with a share to the communal store. */
  fields: { growthPerDay: 2, harvestPerAction: 3, harvestTithe: 1, harvestDuration: 6, plantDuration: 6, initialCrop: 200, workNeeded: 8 },
  communal: {
    /** Grain per living person per day released from the communal store in winter. */
    winterRationPerPersonPerDay: 1.1,
    rationHour: 7,
    /** The village keeps a night watch on the store that grows with each discovered theft. */
    watchPerTheft: 0.2,
    watchDecayPerDay: 0.03,
    watchCatch: 0.8,
  },
  scenario: {
    households: 5,
    householdSizeMin: 9,
    householdSizeMax: 13,
    /** Days of food per member at start, before uneven distribution. */
    foodDaysStrained: 10,
    foodDaysNormal: 70,
    foodDaysCommunal: 30,
    unitsPerPersonDay: 2,
    woodPerHousehold: 12,
    startingPregnancyChance: 0.35,
    /** Share of adults owning a tool; the strained household owns none. */
    toolOwnership: 1,
  },
  perception: {
    baseSight: 14,
    minSightFactor: 0.25,
    hearRadius: 9,
    sightingThrottleTicks: 6,
    noticeBase: 0.7,
    misidentifyChance: 0.15,
    childAge: 10,
    childIdentFactor: 0.6,
    weatherSight: { clear: 1, cloudy: 0.95, rain: 0.75, storm: 0.5, snow: 0.7 },
    discover: { body: 0.9, blood: 0.3, item_missing: 0.4, object_left: 0.15, footprint: 0.03, wound: 0.5, sound: 0 },
  },
  detection: {
    base: 0.9,
    sleepingFactor: 0.08,
    forestCover: 0.6,
    minLightFactor: 0.12,
    attackBoost: 1.4,
    identifyBase: 0.25,
    /** Witnesses of a violent act recognize the attacker this much more often. */
    violenceIdentBonus: 0.3,
  },
  traces: {
    /** Lifetime in days per trace kind (open question 18: parameterized). */
    lifetimeDays: { footprint: 4, item_missing: 20, blood: 12, body: 9999, object_left: 30, sound: 0.05, wound: 15 },
    rainClearTicks: 12,
    footprintChance: 0.6,
    footprintWetBonus: 0.3,
    objectLeftChance: 0.08,
    burialDelayDays: 1,
  },
  beliefs: {
    sightingMemoryDays: 10,
    heardDecayPerDay: 0.97,
    forgetBelow: 0.08,
    testimonyDiscount: 0.85,
  },
  investigation: {
    examineRadius: 3,
    examineDuration: 4,
    interviewDuration: 2,
    maxInterviews: 4,
    accuseThreshold: 1.2,
    accuseMargin: 0.15,
    /** Open question 18: how long case files persist. */
    caseFileExpiryDays: 30,
    opportunityRadius: 5,
    meansRadius: 8,
    eyewitnessMinHonesty: 0.35,
  },
  justice: {
    convictThreshold: 1.5,
    /** The town council: the presiding elder plus heads of houses with no stake in the case. */
    councilSize: 3,
    hearingDelayTicks: 18,
    hearingHour: 10,
    hearingRadius: 4,
    hearingRequiresPresence: true,
    /** Open question 18: whether children can testify. */
    childrenCanTestify: true,
    childTestimonyMinAge: 7,
    restitutionMultiplier: 2,
    detentionDays: 3,
    /** First-degree murder: execution, unless the council's sympathy for the killer reaches this, when it is a long imprisonment instead. */
    firstDegree: { sympathyThreshold: 0.4, imprisonmentDays: 30 },
    enforcementBaseFail: 0.12,
    maxPostponements: 3,
    /** The council meets over a found body this soon, and rules after this long at most. */
    inquestDelayTicks: 6,
    inquestWaitTicks: 30,
  },
  decision: {
    maxCandidates: 30,
    /** Open question 18: how hungry before theft is weighed against begging. */
    theftDesperationFood: 0.35,
    weights: {
      survival: { food: 1.2, water: 1.2, warmth: 1.0, rest: 0.8, health: 1.5 },
      wants: { companionship: 0.35, affection: 0.35, status: 0.3, comfort: 0.25, security: 0.3 },
      provision: 0.35,
      justice: 0.6,
      duty: 0.6,
      relation: 0.6,
      romance: 0.6,
      grudge: 0.8,
      greed: 0.5,
      risk: 0.9,
      norm: 1.4,
      travel: 0.003,
      sleepWindow: 0.6,
      frenzy: 2.5,
      focus: 0.6,
    },
  },
  bonding: {
    minAge: 16,
    maxAgeGap: 12,
    proximityRadius: 3,
    proximityBondPerTick: 0.0004,
    proximityBondCap: 0.5,
    nonKinBondDecayPerDay: 0.002,
    attraction: { compat: 0.35, proximity: 0.35, shared: 0.2, taste: 0.15, togetherScale: 144 * 4, courtingBonus: 0.15 },
    thresholds: {
      acquaintanceBond: 0.15,
      friendBond: 0.4,
      friendTrust: 0.25,
      court: 0.4,
      propose: 0.55,
      proposeAffection: 0.45,
      minCourtDays: 3,
      jealousy: 0.55,
      infidelityLoyalty: 0.35,
      reconcileDays: 30,
    },
    fertilityMinAge: 18,
    fertilityMaxAge: 42,
    childRatePerSeason: 0.25,
    gestationDays: 270,
    remarriageDays: 120,
    famineFoodPerMember: 1,
  },
  obligations: { debtDueDays: 10, breachTrustLoss: 0.15, guiltPerBreach: 0.3 },
  animals: {
    wolfPacks: 2,
    wolvesPerPack: 3,
    wolfSpeed: 13,
    wolfHuntRadius: 45,
    /** Wolves range this far from the den by day, and lie in wait beside roads this far at night. */
    wolfRoamRadius: 30,
    wolfAmbushRadius: 45,
    /** An ambushing wolf springs at a lone passer-by this close. */
    wolfPounce: 7,
    /** Carcasses lie where they fell this many days before rotting away. */
    carcassDays: 4,
    /** Chance a palisade keeps a wolf out of the pen. */
    palisadeHolds: 0.85,
    /** Wild game: deer herds range the deep woods; rabbits and foxes are everywhere. */
    game: {
      deerHerds: 6,
      deerPerHerd: [4, 6] as [number, number],
      rabbits: 18,
      foxes: 4,
      herdRange: 14,
      /** Tiles per tick when running: deer and rabbits outrun wolves (13); a fox barely does. */
      speed: { deer: 17, rabbit: 15, fox: 14 },
      /** How close a moving person or a hunting predator comes before the animal bolts. */
      spook: { deer: 9, rabbit: 4, fox: 6 },
      /** Even a still, stalking hunter is noticed this close. */
      spookStill: { deer: 5, rabbit: 2, fox: 4 },
      /** Chance a predator that reaches a fleeing animal brings it down. */
      caught: { deer: 0.25, rabbit: 0.3, fox: 0.35, chicken: 0.3 },
      /** A wolf gives up a chase after this many ticks, then rests this many. */
      chaseTicks: 4,
      chaseRest: 8,
      meat: { deer: [3, 5] as [number, number], rabbit: [1, 1] as [number, number], fox: [0, 0] as [number, number] },
      /** A herd below its cap gains a fawn this often; rabbits breed faster. */
      deerBirthEveryDays: 6,
      maxPerHerd: 8,
      rabbitBirthEveryDays: 3,
      maxRabbits: 30,
      /** Game wanders in from beyond the map this often when the woods are short of it. */
      wanderInEveryDays: 4,
    },
    /** Wolves go for someone only if nobody else is this close to them. */
    wolfLoneRadius: 7,
    wolfGroupFear: 2,
    wolfBite: [0.08, 0.22] as [number, number],
    wolfHealth: 0.6,
    wolfHungerPerDay: 0.35,
    /** Livestock grow hungry; grazing feeds them by day outside winter, and tending feeds them. */
    livestockHungerPerDay: 0.35,
    grazePerTick: 0.008,
    livestock: { sheep: [2, 4] as [number, number], cow: [1, 2] as [number, number], chicken: [4, 7] as [number, number], horse: [1, 2] as [number, number] },
    /** Riding doubles speed on open ground; people saddle up for trips longer than this. */
    horseSpeedFactor: 1.9,
    rideAbove: 22,
    /** Daily yields: milk per cow, eggs per two hens, cloth (wool) per sheep every few days. */
    milkPerCow: 1,
    eggsPerHen: 0.5,
    woolEveryDays: 8,
    /** Seasonal hunting luck, relative: game is harder to bring down in winter. */
    huntChance: [0.3, 0.35, 0.3, 0.15] as [number, number, number, number],
    huntYield: [2, 4] as [number, number],
    slaughterMeat: { sheep: 5, cow: 9, chicken: 1 },
  },
  muskets: {
    /** Hunting with a musket finds game more often. */
    huntFactor: 1.6,
    hitChance: 0.65,
    range: 6,
    /** Ticks to reload after a shot; until then the musket is a club. */
    reloadTicks: 3,
    damage: [0.5, 0.9] as [number, number],
    /** A shot is heard much further than other noises. */
    hearRadius: 35,
  },
  madness: {
    threshold: 0.7,
    /** Chance per day of going mad for no reason anyone can see. */
    randomPerDay: 0.0004,
    /** Grief above this, from a tragedy, pushes toward madness. */
    griefTrigger: 0.75,
    griefPush: 0.25,
    /** Days of near-total loneliness before it starts to tell. */
    lonelyDays: 3,
    lonelyPushPerDay: 0.08,
    recoveryPerDay: 0.015,
    recoverBelow: 0.3,
  },
  plots: {
    maxDays: { theft: 3, murder: 8, raid: 2, retribution: 10 },
    /** A killer strikes only when nobody else is within this many tiles of the target. */
    isolationRadius: 12,
    murderGrudge: 0.7,
    raidFeud: 0.6,
    raidMinBoldness: 0.4,
    raidCooldownDays: 15,
    raidHour: 1,
    abandonCooldownDays: 2,
  },
  fight: { rounds: 4, hitBase: 0.45, damageMin: 0.08, damageMax: 0.3, lethalFactor: 1.6, toolFactor: 1.3, fleeBelow: 0.4, breakOffBelow: 0.3 },
  chase: { maxTicks: 6, sprintBold: 0.5 },
  feud: { raidSatisfies: 0.35, decayPerDay: 0.01, theft: 0.12, killing: 0.5, assault: 0.2, raid: 0.4, elopement: 0.3, marriageRefused: 0.1, verdictDisputed: 0.12 },
  marriage: { approvalRequired: true, elopeAfterRefusalDays: 1 },
  /** Wounds, Dwarf Fortress style: each part of the body can be hurt, heals over days or weeks, and may heal badly. */
  injuries: {
    /** Severity healed per day, untended and well fed. Tending speeds it up by (1 + care). */
    healPerDay: { bruise: 0.5, cut: 0.25, gash: 0.1, bite: 0.12, sprain: 0.22, fracture: 0.035, gunshot: 0.05, lost: 0 },
    /** Daily chance an open wound of at least `infectMinSeverity` festers, reduced by care. */
    infectionPerDay: 0.1,
    /** Open wounds bleed at severity x this, costing health per day at `bleedHealthPerDay` x the rate, until bound or clotted. */
    bleed: { cut: 0.35, gash: 1, bite: 0.8, gunshot: 1.2 },
    bleedHealthPerDay: 1.1,
    clotPerDay: 1.4,
    infectMinSeverity: 0.25,
    infectionHealthPerDay: 0.06,
    painMoodPerTick: 0.0015,
    /** Chance a healing wound leaves a lasting mark, untended; care reduces it by up to `careProtects`. */
    lasting: { lame: 0.5, crookedArm: 0.4, faceScar: 0.6, scar: 0.35, careProtects: 0.75 },
    /** Accident chance per tile walked, by ground. */
    accidents: {
      roadPerTile: 0.00003,
      groundPerTile: 0.000025,
      forestPerTile: 0.00006,
      wetFactor: 1.8,
      snowFactor: 2.6,
      nightFactor: 1.8,
      elderFactor: 1.6,
      childFactor: 0.6,
      hurryFactor: 2.5,
      horseFallPerTick: 0.0015,
      woodcutting: 0.02,
      stormWoodcutting: 0.09,
      hunting: 0.004,
    },
    /** Carrying someone slows the carrier to this fraction. */
    carrySpeed: 0.6,
    /** Someone who cannot walk calls out for help this often. */
    helpCallEveryTicks: 6,
    healerSkill: 0.85,
    /** A disfigured face lowers attraction by up to this, and slows how fast strangers warm to them. */
    disfigureAttraction: 0.35,
    disfigureBondFactor: 0.5,
  },
  /** Skills, Dwarf Fortress style: practice earns experience; level = floor(sqrt(xp / levelXp)), up to 20. */
  skills: { xpPerTick: 2, levelXp: 25, maxLevel: 20 },
  /** Building: furniture, wells and pumps, bridges, house extensions and the temple. Costs are materials and work units. */
  construction: {
    costs: {
      bed: { wood: 2, stone: 0, work: 3 },
      table: { wood: 2, stone: 0, work: 3 },
      chair: { wood: 1, stone: 0, work: 2 },
      chest: { wood: 2, stone: 0, work: 2 },
      altar: { wood: 0, stone: 3, work: 3 },
      well: { wood: 1, stone: 6, work: 6 },
      pump: { wood: 3, stone: 2, work: 4 },
      /** Per tile of the span. */
      bridge: { wood: 3, stone: 1, work: 2 },
      extension: { wood: 10, stone: 4, work: 10 },
      /** A palisade round the animal pen; wolves rarely get through it. */
      fence: { wood: 8, stone: 0, work: 5 },
      temple: { wood: 12, stone: 16, work: 18 },
    },
    workDuration: 6,
    carryMax: 4,
    quarryDuration: 6,
    quarryYield: [2, 4] as [number, number],
    /** A table for every this many people, a chair for every this many. */
    peoplePerTable: 6,
    peoplePerChair: 2,
    /** A house is crowded below this many floor tiles per person. */
    tilesPerPerson: 4,
    maxHouseProjects: 2,
    /** A compound this populous wants a second well. */
    secondWellAbove: 11,
    /** Projects nobody works on for this long are given up. */
    abandonDays: 20,
  },
  /** Sleeping in a bed rests better and feels better; the floor does neither. */
  sleep: { bedRestFactor: 1.15, floorRestFactor: 0.85 },
  /** The village's shared values and gods, and how far people stray from them. */
  culture: {
    houseSpread: 0.25,
    personSpread: 0.35,
    /** How fast unmet needs fade, per day, scaled by how strongly they are felt. */
    focusDecayPerDay: 0.5,
    unmetMoodPerTick: 0.0012,
    /** A festival in the square every this many days, from this hour, lasting this many ticks. */
    festivalEveryDays: 30,
    festivalFirstDay: 20,
    festivalHour: 11,
    festivalTicks: 24,
    /** Chance two people with sharply opposed values argue when they talk. */
    argueChance: 0.2,
  },
  /** Acquittals of someone a victim is sure wronged them eventually drive the victim to take justice into their own hands. */
  retribution: {
    /** Weight of acquittals (a killing of kin counts `killingWeight`) before retribution is considered. */
    acquittalsToAct: 2,
    killingWeight: 1.5,
    decayPerDay: 0.01,
    cooldownDays: 3,
  },
  /** Run invariant checks every tick (cheap at this scale). */
  checkInvariants: true,
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
