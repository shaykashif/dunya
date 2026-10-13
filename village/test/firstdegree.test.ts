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
