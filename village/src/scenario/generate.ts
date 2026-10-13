import { computeAttraction } from "../entities/bonding.ts";
import { createObligation } from "../entities/obligations.ts";
import { assignElder, assignHead, blankPerson, newRelationship } from "../entities/person.ts";
import type { Rng } from "../engine/rng.ts";
import { EventLog, r3 } from "../log/events.ts";
import { initEnv } from "../world/environment.ts";
import { worldTotals } from "../world/items.ts";
import { emptyInventory, type Household, type Person, type Sex } from "../world/types.ts";
import { World } from "../world/world.ts";
import type { SimConfig } from "./config.ts";
import { assignTasks } from "../entities/tasks.ts";
import { spawnAnimals, spawnGame } from "../world/animals.ts";
import { buildLayout } from "./layout.ts";
import { generateCulture, houseValues, personValues } from "../entities/culture.ts";
import { startingSkills } from "../entities/skills.ts";
import { assignBeds, bedUnits, furnitureSpot } from "../world/structures.ts";
import type { FurnitureKind } from "../world/types.ts";

const FEMALE = [
  "Agnes", "Berit", "Clara", "Dagny", "Edda", "Freya", "Gerda", "Helga", "Ingrid", "Jorunn", "Kari", "Liv", "Marta", "Nora", "Oda", "Ragna",
  "Sigrid", "Tove", "Unn", "Vigdis", "Astrid", "Bodil", "Embla", "Gudrun", "Hedda", "Ylva", "Runa", "Solveig", "Thora", "Asa",
];
const MALE = [
  "Arne", "Bjorn", "Colm", "Dag", "Egil", "Frode", "Gunnar", "Halvar", "Ivar", "Jon", "Knut", "Leif", "Magnus", "Njal", "Olaf", "Rolf",
  "Sten", "Tor", "Ulf", "Vidar", "Asbjorn", "Bard", "Eirik", "Geir", "Hakon", "Kjell", "Orm", "Ragnar", "Sigurd", "Torvald",
];
const SURNAMES = ["Ashford", "Brook", "Cairn", "Dunmore", "Elmstead", "Fenwick", "Greywater"];

interface Draft {
  sex: Sex;
  age: number;
  parents: number[]; // indices into the house's draft list
  partner: number | null;
}

function trait(rng: Rng): number {
  return r3((rng.next() + rng.next()) / 2);
}

function other(rng: Rng): Sex {
  return rng.chance(0.5) ? "f" : "m";
}

/**
 * An extended family: an elder (often with a spouse), their grown children,
 * some married to spouses who joined the house, and grandchildren.
 */
function draftHouse(rng: Rng, size: number): Draft[] {
  const out: Draft[] = [];
  const add = (d: Draft): number => {
    out.push(d);
    return out.length - 1;
  };
  const elderAge = 56 + rng.int(17);
  const elder = add({ sex: other(rng), age: elderAge, parents: [], partner: null });
  if (rng.chance(0.7)) {
    const sp = add({ sex: out[elder]!.sex === "f" ? "m" : "f", age: Math.max(50, elderAge - 4 + rng.int(9)), parents: [], partner: elder });
    out[elder]!.partner = sp;
  }
  const elders = out.map((_, i) => i);
  const couples: [number, number | null][] = [];
  const grown = 2 + rng.int(2);
  for (let i = 0; i < grown && out.length < size; i++) {
    const age = Math.max(20, Math.min(46, elderAge - 22 - rng.int(14)));
    const c = add({ sex: other(rng), age, parents: elders.slice(), partner: null });
    let spouse: number | null = null;
    if (out.length < size && rng.chance(0.75)) {
      spouse = add({ sex: out[c]!.sex === "f" ? "m" : "f", age: Math.max(19, age - 5 + rng.int(11)), parents: [], partner: c });
      out[c]!.partner = spouse;
    }
    couples.push([c, spouse]);
  }
  // Grandchildren, round-robin across the grown children.
  let guard = 0;
  while (out.length < size && guard++ < 100) {
    const [c, spouse] = couples[guard % couples.length]!;
    const parentAge = out[c]!.age;
    const maxAge = Math.max(0, Math.min(22, parentAge - 18));
    out.push({ sex: other(rng), age: rng.int(maxAge + 1), parents: spouse === null ? [c] : [c, spouse], partner: null });
  }
  return out;
}

/** Scenario generation is a pure function of the seed and config. */
export function generateScenario(cfg: SimConfig, seed: number, log: EventLog = new EventLog()): World {
  const w = new World(cfg, seed, log);
  const rng = w.rng.get("scenario");
  const tpd = cfg.time.ticksPerDay;
  const tpy = tpd * cfg.time.daysPerSeason * 4;
  const sc = cfg.scenario;
  w.env = initEnv(cfg);

  const houses = sc.households;
  const { map, buildings, compounds } = buildLayout(cfg, rng, houses);
  w.map = map;
  w.buildings = buildings;
  w.compounds = compounds;
  w.occupancy = new Int32Array(map.width * map.height);

  const sizes = Array.from({ length: houses }, () => sc.householdSizeMin + rng.int(sc.householdSizeMax - sc.householdSizeMin + 1));
  let strained = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i]! > sizes[strained]!) strained = i;
  w.strainedHouseholdId = strained;
  const drafts = sizes.map((n) => draftHouse(rng, n));

  // At least one single adult of each sex.
  for (const sex of ["f", "m"] as const) {
    const has = drafts.some((hh) => hh.some((d) => d.sex === sex && d.age >= 16 && d.partner === null && d.parents.length > 0));
    if (has) continue;
    let pick: Draft | null = null;
    for (const hh of drafts) for (const d of hh) if (d.partner === null && d.parents.length > 0 && d.age < 16 && (!pick || d.age > pick.age)) pick = d;
    if (pick) {
      pick.sex = sex;
      pick.age = 17 + rng.int(5);
    }
  }

  const usedNames = new Set<string>();
  const nameFor = (sex: Sex): string => {
    const pool = sex === "f" ? FEMALE : MALE;
    for (let i = 0; i < 80; i++) {
      const n = pool[rng.int(pool.length)]!;
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
    return pool[rng.int(pool.length)]!;
  };

  const households: Household[] = [];
  for (let h = 0; h < houses; h++) {
    const house = buildings[compounds[h]!.buildingId]!;
    households.push({ id: h, name: SURNAMES[h % SURNAMES.length]!, buildingId: house.id, headId: null, store: emptyInventory() });
    w.farms.push({ crop: emptyInventory(), planted: false, work: 0 });
    const ids: number[] = [];
    for (const d of drafts[h]!) {
      const id = w.nextId("person");
      ids.push(id);
      const age = d.age;
      const child = age < 12;
      const elderly = age >= 60;
      const personality = { boldness: trait(rng), empathy: trait(rng), greed: trait(rng), honesty: trait(rng), loyalty: trait(rng), vigilance: trait(rng) };
      const p = blankPerson({
        id,
        name: `${nameFor(d.sex)} ${households[h]!.name}`,
        sex: d.sex,
        birthTick: -Math.floor(age * tpy + rng.int(tpy)),
        householdId: h,
        parents: [],
        x: house.bed.x,
        y: house.bed.y,
        personality,
        survival: { food: r3(0.7 + rng.next() * 0.3), water: r3(0.8 + rng.next() * 0.2), warmth: 0.9, rest: r3(0.7 + rng.next() * 0.3), health: 1 },
        wants: { companionship: 0.7, affection: r3(0.4 + rng.next() * 0.4), status: 0.4, comfort: 0.6, security: 0.8 },
        sleepStart: r3((child ? 19.5 + rng.next() : elderly ? 20.5 + rng.next() : 21 + rng.next() * 2) + personality.boldness * 0.5),
        sleepHours: child ? 10 : r3(7.5 + rng.next()),
      });
      w.people.push(p);
    }
    drafts[h]!.forEach((d, i) => {
      const p = w.person(ids[i]!);
      p.parents = d.parents.map((j) => ids[j]!);
      p.partnerId = d.partner === null ? null : ids[d.partner]!;
    });
  }
  w.households = households;
  w.feuds = households.map((a) => households.map((b) => (a.id === b.id ? 0 : r3(rng.next() * 0.2))));

  // Everyone gets their own spot indoors; infants are carried.
  for (const p of w.people) {
    const house = w.house(p.householdId);
    const spot = w.isCarried(p) ? null : w.freeTileNear(house.hearthSpot, 6, p.id, (x, y) => w.isInside({ x, y }, house));
    if (spot) w.place(p, spot.x, spot.y);
  }
  for (const p of w.people) {
    const carer = w.carriedBy(p);
    if (carer) w.place(p, carer.x, carer.y);
  }

  // Kinship within a house; strangers or acquaintances across houses.
  for (const hh of households) {
    const members = w.people.filter((p) => p.householdId === hh.id);
    for (const a of members) {
      for (const b of members) {
        if (a.id === b.id) continue;
        const r = newRelationship(0, true);
        r.bond = r3(0.6 + rng.next() * 0.35);
        r.trust = r3(0.5 + rng.next() * 0.4);
        r.stage = "friend";
        if (a.partnerId === b.id) {
          r.stage = "pair_bonded";
          r.bond = r3(0.75 + rng.next() * 0.25);
          r.together = tpd * 30;
          r.shared = 0.5;
        }
        a.relationships[b.id] = r;
      }
    }
  }
  for (const a of w.people) {
    for (const b of w.people) {
      if (a.id >= b.id || a.householdId === b.householdId) continue;
      const bond = r3(0.02 + rng.next() * 0.26);
      const ra = newRelationship(0), rb = newRelationship(0);
      ra.bond = rb.bond = bond;
      ra.trust = r3(rng.next() * 0.3);
      rb.trust = r3(rng.next() * 0.3);
      ra.stage = rb.stage = bond >= cfg.bonding.thresholds.acquaintanceBond ? "acquaintance" : "stranger";
      a.relationships[b.id] = ra;
      b.relationships[a.id] = rb;
    }
  }

  // Attraction starts from the same rule the bonding step uses, so tick 0 sees real values.
  for (const a of w.people) {
    for (const b of w.people) {
      if (a.id === b.id) continue;
      const r = a.relationships[b.id]!;
      r.attraction = r3(computeAttraction(w, a, b, r));
    }
  }

  for (const p of w.people) {
    w.census[p.id] = { householdId: p.householdId, sex: p.sex, birthTick: p.birthTick, parents: p.parents.slice(), partnerId: p.partnerId, alive: true, armed: false };
  }

  // Culture: the village's values and gods, each house's leaning, each person's own. Skills from a life's work.
  const crng = w.rng.get("culture");
  w.culture = generateCulture(crng);
  for (const hh of households) {
    const base = houseValues(crng, w.culture, cfg.culture.houseSpread);
    const patron = crng.int(w.culture.deities.length);
    for (const p of w.people) {
      if (p.householdId !== hh.id) continue;
      p.values = personValues(crng, base, cfg.culture.personSpread);
      p.deityId = crng.chance(0.75) ? patron : crng.int(w.culture.deities.length);
      p.skills = startingSkills(crng, w.ageYears(p));
    }
  }

  for (const hh of households) {
    assignHead(w, hh.id);
    assignTasks(w, hh.id);
  }
  assignElder(w);
  spawnAnimals(w, w.rng.get("animals"));
  spawnGame(w, w.rng.get("animals"));

  // Starting goods: food unevenly distributed, and the strained house owns no tools.
  for (const p of w.people) {
    const age = w.ageYears(p);
    if (age >= 2) p.inventory.cloth = 1;
    if (age >= 16 && rng.chance(sc.toolOwnership) && p.householdId !== strained) p.inventory.tool = 1;
    if (age >= 16) p.inventory.grain = 1;
  }
  for (const hh of households) {
    const members = w.people.filter((p) => p.householdId === hh.id).length;
    const days = hh.id === strained ? sc.foodDaysStrained : sc.foodDaysNormal;
    const units = Math.round(members * days * sc.unitsPerPersonDay);
    const fish = Math.floor(units * 0.3);
    hh.store.fish = fish;
    hh.store.grain = units - fish;
    hh.store.wood = sc.woodPerHousehold;
    // Heirlooms: silver, jewellery, carvings. The poorest house has next to none.
    hh.store.valuables = hh.id === strained ? rng.int(2) : 3 + rng.int(5);
    buildings[hh.buildingId]!.hearth!.wood = 2;
    w.farms[hh.id]!.crop.grain = hh.id === strained ? Math.round(cfg.fields.initialCrop / 2) : cfg.fields.initialCrop;
  }
  for (const p of w.people) {
    if (p.task === "hunter" && p.householdId !== strained) {
      p.inventory.musket = 1;
      w.census[p.id]!.armed = true;
    }
  }
  w.communal.grain = Math.round(w.people.length * sc.foodDaysCommunal * sc.unitsPerPersonDay);

  // Furniture: never quite enough beds, the poorest house least of all.
  for (const hh of households) {
    const b = buildings[hh.buildingId]!;
    const units = bedUnits(w, hh.id);
    const share = hh.id === strained ? 0.3 : 0.5 + crng.next() * 0.3;
    const pieces: [FurnitureKind, number][] = [
      ["bed", Math.max(1, Math.round(units * share))],
      ["table", hh.id === strained ? 0 : 1],
      ["chair", hh.id === strained ? 1 : 2 + crng.int(3)],
      ["chest", crng.chance(0.5) ? 1 : 0],
    ];
    for (const [kind, n] of pieces) {
      for (let i = 0; i < n; i++) {
        const spot = furnitureSpot(w, b, kind);
        if (!spot) break;
        w.furniture.push({ id: w.nextId("furniture"), kind, buildingId: b.id, x: spot.x, y: spot.y, quality: crng.chance(0.2) ? 1 : 0, makerId: null, tick: 0 });
      }
    }
    assignBeds(w, hh.id);
  }
  w.ledger.initial = worldTotals(w);

  w.emit("scenario_created", [], {
    seed,
    strained,
    elder: w.elderId,
    households: households.map((h) => ({ id: h.id, name: h.name, head: h.headId, store: { ...h.store }, compound: w.compounds[h.id]!.center })),
    people: w.people.map((p) => ({ id: p.id, name: p.name, sex: p.sex, age: Math.floor(w.ageYears(p)), household: p.householdId, partner: p.partnerId, parents: p.parents, personality: p.personality })),
    feuds: w.feuds,
    totals: { ...w.ledger.initial },
    communal: { ...w.communal },
  });

  // Obligations from kinship: parents to children, partners to each other, adults to their house's young and old.
  for (const p of w.people) {
    const age = w.ageYears(p);
    for (const parentId of p.parents) {
      const parent = w.person(parentId);
      if (age < 14) createObligation(w, parentId, p.id, "childcare", 0.9, null);
      else if (w.ageYears(parent) >= 60) createObligation(w, p.id, parentId, "kin_duty", 0.6, null);
    }
    if (p.partnerId !== null) {
      createObligation(w, p.id, p.partnerId, "pair_duty", 0.8, null);
      createObligation(w, p.id, p.partnerId, "protection", 0.6, null);
    }
    if (age >= 16) {
      for (const o of w.people) {
        if (o.householdId !== p.householdId || o.id === p.id || o.parents.includes(p.id) || p.parents.includes(o.id)) continue;
        if (w.ageYears(o) < 14) createObligation(w, p.id, o.id, "kin_duty", 0.4, null);
      }
    }
  }

  // Some couples start with a pregnancy already under way.
  for (const f of w.people) {
    if (f.sex !== "f" || f.partnerId === null || f.householdId === strained) continue;
    const age = w.ageYears(f);
    if (age < cfg.bonding.fertilityMinAge || age > cfg.bonding.fertilityMaxAge) continue;
    if (!rng.chance(sc.startingPregnancyChance)) continue;
    const dueTick = (10 + rng.int(240)) * tpd;
    const ev = w.emit("conceived", [f.id, f.partnerId], { mother: f.id, father: f.partnerId, pairBonded: true, famine: false, dueTick, initial: true });
    f.pregnancy = { fatherId: f.partnerId, dueTick, conceivedSeq: ev.seq };
  }
  return w;
}
