import { describe, expect, it } from "vitest";
import { steal } from "../src/actions/crime.ts";
import { ctxFor, freshWorld, sendHome, setTick, tickAtHour } from "./helpers.ts";

/** Runs one pickpocketing attempt with fixed positions; returns whether anyone noticed. */
function attempt(seed: number, hour: number): boolean {
  const w = freshWorld(seed, { weather: { changeEveryTicks: 1_000_000 } }, true);
  setTick(w, tickAtHour(w, hour, 144 * 2));
  w.env.weather = "clear";
  setTick(w, w.tick);
  const thief = w.people.find((p) => p.householdId === 0 && w.ageYears(p) >= 16)!;
  const target = w.people.find((p) => p.householdId === 1 && w.ageYears(p) >= 16)!;
  const observer = w.people.find((p) => p.householdId === 2 && w.ageYears(p) >= 16)!;
  sendHome(w, [thief.id, target.id, observer.id]);
  for (const p of [thief, target, observer]) { p.asleep = false; p.plan = null; }
  const sq = w.map.square;
  w.place(thief, sq.x, sq.y);
  w.place(target, sq.x + 1, sq.y);
  w.place(observer, sq.x, sq.y + 4);
  target.inventory.grain = 2;
  const cand = steal.candidates(thief, w).find((c) => c.key === `steal:person:${target.id}`)!;
  const ctx = ctxFor(w);
  steal.resolve(thief, cand, w, ctx);
  return ctx.events.some((e) => e.type === "theft_failed") || w.log.retained!.some((e) => e.type === "action_witnessed");
}

describe("14.12 day and night", () => {
  it("the same theft is detected less often at night than at midday", () => {
    let day = 0, night = 0;
    const n = 200;
    for (let seed = 1; seed <= n; seed++) {
      if (attempt(seed, 12)) day++;
      if (attempt(seed, 2)) night++;
    }
    expect(day / n).toBeGreaterThan(night / n + 0.15);
    expect(night).toBeGreaterThan(0);
  });
});
