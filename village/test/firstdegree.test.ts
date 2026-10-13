import { describe, expect, it } from "vitest";
import { councilSympathy, firstDegreeSentence } from "../src/justice/justice.ts";
import { createSimulation } from "../src/sim.ts";

function setup() {
  const w = createSimulation({ seed: 42 }).world;
  const adults = w.active().filter((p) => w.ageYears(p) >= 25 && !w.active().some((c) => c.parents.includes(p.id) && w.ageYears(c) < 14));
  const [killer, victim, ...rest] = adults;
  const judges = rest.filter((j) => j.householdId !== killer!.householdId).slice(0, 3);
  return { w, killer: killer!, victim: victim!, judges };
}

describe("first-degree murder sentencing", () => {
  it("a cold council sentences the killer to death", () => {
    const { w, killer, victim, judges } = setup();
    for (const j of judges) {
      j.personality.empathy = 0.1;
      delete j.relationships[killer.id];
    }
    killer.convictions = 1;
    const sym = councilSympathy(w, judges, killer, victim);
    expect(sym.mean).toBeLessThan(w.config.justice.firstDegree.sympathyThreshold);
    expect(firstDegreeSentence(w, killer, sym.mean)).toBe("execution");
  });

  it("a council with warmth for the killer imprisons instead", () => {
    const { w, killer, victim, judges } = setup();
    for (const j of judges) {
      j.personality.empathy = 0.8;
      j.relationships[killer.id] = { bond: 0.7, trust: 0.6, attraction: 0, stage: "friends", together: 0, shared: 0, negative: 0, stageTick: 0, kin: false } as never;
    }
    const sym = councilSympathy(w, judges, killer, victim);
    expect(sym.mean).toBeGreaterThanOrEqual(w.config.justice.firstDegree.sympathyThreshold);
    expect(firstDegreeSentence(w, killer, sym.mean)).toBe("imprisonment");
  });

  it("love for the dead weighs against the killer", () => {
    const { w, killer, victim, judges } = setup();
    const fond = judges.map((j) => {
      j.personality.empathy = 0.5;
      return j;
    });
    const before = councilSympathy(w, fond, killer, victim).mean;
    for (const j of fond) j.relationships[victim.id] = { bond: 0.9, trust: 0.9, attraction: 0, stage: "friends", together: 0, shared: 0, negative: 0, stageTick: 0, kin: false } as never;
    expect(councilSympathy(w, fond, killer, victim).mean).toBeLessThan(before);
  });

  it("a parent of small children is spared the rope", () => {
    const w = createSimulation({ seed: 42 }).world;
    const parent = w.active().find((p) => w.active().some((c) => c.parents.includes(p.id) && w.ageYears(c) < 14))!;
    expect(firstDegreeSentence(w, parent, 0)).toBe("imprisonment");
  });
});

describe("murder is noticed and tried", () => {
  it("a killing in daylight before honest witnesses puts the killer on trial and often convicts them", async () => {
    const { fight } = await import("../src/actions/fight.ts");
    const { EventLog } = await import("../src/log/events.ts");
    const { ctxFor, setTick, tickAtHour } = await import("./helpers.ts");
    let tried = 0, guilty = 0, trials = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const log = new EventLog({ retain: true });
      const eng = createSimulation({ seed, log });
      const w = eng.world;
      setTick(w, tickAtHour(w, 12));
      const adults = w.active().filter((p) => w.ageYears(p) >= 22 && w.ageYears(p) < 55);
      const killer = adults[0]!;
      const victim = adults.find((p) => p.householdId !== killer.householdId)!;
      const wits = adults.filter((p) => ![killer.id, victim.id].includes(p.id) && ![killer.householdId, victim.householdId].includes(p.householdId)).slice(0, 3);
      const sq = w.map.square;
      [killer, victim, ...wits].forEach((p, i) => {
        w.vacate(p);
        const s = w.freeTileNear({ x: sq.x + [0, 1, 3, -3, 4][i]!, y: sq.y + [0, 0, 2, 3, -2][i]! }, 3, p.id);
        if (s) w.place(p, s.x, s.y);
        p.asleep = false;
        p.plan = null;
        if (wits.includes(p)) p.personality.honesty = 0.9;
      });
      victim.survival.health = 0.05;
      fight(w, killer, victim, "fight", { lethal: true, motive: "grudge", premeditated: true }, ctxFor(w));
      if (!log.retained!.some((e) => e.type === "death" && e.data.person === victim.id)) continue;
      trials++;
      await eng.runDays(6);
      if (log.retained!.some((e) => e.type === "hearing_opened" && e.data.accused === killer.id)) tried++;
      if (log.retained!.some((e) => e.type === "verdict" && e.data.accused === killer.id && e.data.verdict === "guilty")) guilty++;
    }
    expect(trials).toBeGreaterThanOrEqual(6);
    expect(tried).toBeGreaterThanOrEqual(trials - 2);
    expect(guilty).toBeGreaterThanOrEqual(Math.ceil(trials / 2));
  });
});

describe("reading a body", () => {
  it("whoever knows of the killing is never fooled into thinking a wolf did it", async () => {
    const { readBody } = await import("../src/perception/perception.ts");
    const w = createSimulation({ seed: 42 }).world;
    const [obs, victim] = w.active();
    obs!.personality.vigilance = 0;
    const rng = w.rng.get("perception");
    const unaware = Array.from({ length: 300 }, () => readBody(w, obs!, "person", rng, false, victim!.id).cause);
    expect(unaware.includes("wolf")).toBe(true); // an ordinary passer-by can still be misled
    obs!.beliefs.push({ id: 9999, subject: { kind: "person", id: 1 }, predicate: "killed", object: { kind: "person", id: victim!.id }, time: 0, confidence: 0.6, source: "saw", sourceSeq: 0 });
    const aware = Array.from({ length: 300 }, () => readBody(w, obs!, "person", rng, false, victim!.id).cause);
    expect(aware.every((c) => c === "person")).toBe(true);
  });
});
