import { describe, expect, it } from "vitest";
import { openCase } from "../src/investigation/cases.ts";
import { conductHearing, fileAccusation } from "../src/justice/justice.ts";
import { addBelief } from "../src/perception/store.ts";
import { freshWorld } from "./helpers.ts";

describe("14.7 conflict of interest", () => {
  it("an elder related to the accused does not hear the case", () => {
    const w = freshWorld(42, { justice: { hearingRequiresPresence: false } });
    const elder = w.person(w.elderId!);
    const accused = w.active().find((p) => p.householdId === elder.householdId && p.id !== elder.id && w.ageYears(p) >= 12)!;
    const accuser = w.active().find((p) => p.householdId !== elder.householdId && w.ageYears(p) >= 16)!;
    expect(accused).toBeDefined();

    const ev = w.emit("perceived", [accuser.id], { observer: accuser.id, what: "test" });
    const belief = addBelief(w, accuser, {
      subject: { kind: "person", id: accused.id }, predicate: "took", object: { kind: "holder", holder: { t: "household", id: accuser.householdId } },
      time: w.tick, confidence: 0.9, source: "saw", place: { ...w.house(accuser.householdId).hearthSpot },
    }, ev.seq);
    const c = openCase(w, accuser, { kind: "theft", victim: { kind: "holder", holder: { t: "household", id: accuser.householdId } }, place: belief.place!, timeFrom: 0, timeTo: 6 }, belief);
    c.suspects = [{ personId: accused.id, means: 0.9, motive: 0, opportunity: 0.9, score: 1.8 }];

    const h = fileAccusation(w, accuser, accused.id, c)!;
    expect(h).not.toBeNull();
    expect(h.recused).toBe(true);
    expect(h.judges).not.toContain(elder.id);
    expect(h.judges.length).toBeGreaterThan(0);
    expect(w.log.retained!.some((e) => e.type === "recusal" && e.data.elder === elder.id)).toBe(true);

    conductHearing(w, h);
    const verdict = w.log.retained!.find((e) => e.type === "verdict")!;
    expect(verdict.data.judges).not.toContain(elder.id);
    expect(verdict.actors).not.toContain(elder.id);
  });
});
