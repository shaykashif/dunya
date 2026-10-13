import { describe, expect, it } from "vitest";
import { kidnap } from "../src/actions/madness.ts";
import { makeMad } from "../src/entities/madness.ts";
import { EventLog, type SimEvent } from "../src/log/events.ts";
import { createSimulation } from "../src/sim.ts";
import { ctxFor, setTick, tickAtHour } from "./helpers.ts";

async function stage(seed: number, witnessed: boolean): Promise<{ ev: SimEvent[]; kidnapper: number; child: number }> {
  const log = new EventLog({ retain: true });
  const eng = createSimulation({ seed, log });
  const w = eng.world;
  setTick(w, tickAtHour(w, 12));
  const adults = w.active().filter((p) => w.ageYears(p) >= 22 && w.ageYears(p) < 55);
  const kidnapper = adults[0]!;
  const child = w.active().find((p) => w.ageYears(p) >= 3 && w.ageYears(p) < 11 && p.householdId !== kidnapper.householdId)!;
  const wit = adults.find((p) => p.id !== kidnapper.id && p.householdId !== kidnapper.householdId)!;
  const sq = w.map.square;
  // Everyone else is indoors, so only the staged witness can see.
  for (const p of w.active()) {
    if ([kidnapper.id, child.id, wit.id].includes(p.id)) continue;
    const home = w.house(p.householdId);
    w.vacate(p);
    w.place(p, home.hearthSpot.x, home.hearthSpot.y);
  }
  [[kidnapper, 0, 0], [child, 1, 0], [wit, witnessed ? 8 : 60, 3]].forEach(([p, dx, dy]) => {
    const q = p as typeof kidnapper;
    w.vacate(q);
    const s = w.freeTileNear({ x: sq.x + (dx as number), y: sq.y + (dy as number) }, 3, q.id);
    if (s) w.place(q, s.x, s.y);
    q.asleep = false;
    q.plan = null;
  });
  makeMad(w, kidnapper, "test", "kidnapper");
  kidnap.resolve(kidnapper, { key: "k", kind: "kidnap", targetId: child.id } as never, w, ctxFor(w));
  expect(child.captorId).toBe(kidnapper.id);
  await eng.runDays(4);
  return { ev: log.retained!, kidnapper: kidnapper.id, child: child.id };
}

describe("kidnapping", () => {
  it("the village searches for a missing child whether or not anyone saw", async () => {
    for (const seed of [1, 2, 3]) {
      for (const witnessed of [true, false]) {
        const { ev, child } = await stage(seed, witnessed);
        expect(ev.some((e) => e.type === "missing_person" && e.data.person === child)).toBe(true);
        // People go looking: a sweep that comes up empty, or one that finds the child (a rescue without a chase).
        expect(ev.some((e) => e.type === "searched" || (e.type === "rescued" && e.data.child === child && !e.data.chased))).toBe(true);
      }
    }
  });

  it("someone who sees the snatch runs the kidnapper down, frees the child and accuses them", async () => {
    let chases = 0, caught = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { ev, kidnapper, child } = await stage(seed, true);
      if (!ev.some((e) => e.type === "chase_started" && e.data.thief === kidnapper)) continue;
      chases++;
      // The chaser may catch them, or the village's searchers may find the child first; either way the child is freed and the kidnapper accused.
      const freed = ev.some((e) => e.type === "rescued" && e.data.child === child);
      const accused = ev.some((e) => e.type === "accusation" && e.data.accused === kidnapper);
      if (!freed || !accused) continue;
      caught++;
    }
    expect(chases).toBeGreaterThanOrEqual(3);
    expect(caught).toBeGreaterThanOrEqual(chases - 1);
  });
});
