import { describe, expect, it } from "vitest";
import { steal } from "../src/actions/crime.ts";
import { processCaseChecks, runDeductions } from "../src/investigation/cases.ts";
import { chooseJudges, conductHearing, fileAccusation } from "../src/justice/justice.ts";
import { runPerception } from "../src/perception/perception.ts";
import { addBelief } from "../src/perception/store.ts";
import { formPlot } from "../src/plots/plots.ts";
import { ctxFor, freshWorld, sendHome, setTick, tickAtHour } from "./helpers.ts";


describe("14.8 wrongful verdict is possible", () => {
  it("a mistaken witness can convict an innocent person, and the log shows belief and truth", () => {
    const w = freshWorld(42, { justice: { hearingRequiresPresence: false } });
    const elder = w.person(w.elderId!);
    const others = w.households.map((h) => h.id).filter((id) => id !== elder.householdId);
    const victimHh = others[0]!, innocentHh = others[1]!;
    const adult = (hh: number) => w.active().find((p) => p.householdId === hh && w.ageYears(p) >= 16 && p.id !== elder.id)!;
    const thief = adult(elder.householdId);
    const innocent = adult(innocentHh);
    const witness = adult(victimHh);

    // Night, everyone else asleep at home, the thief alone in the victim's house.
    setTick(w, tickAtHour(w, 2));
    sendHome(w, [thief.id]);
    for (const p of w.people) if (p.householdId === victimHh) { w.vacate(p); p.x = w.map.square.x; p.y = w.map.square.y; p.asleep = true; }
    const house = w.house(victimHh);
    w.place(thief, house.hearthSpot.x, house.hearthSpot.y);
    const pl = formPlot(w, thief, "theft", { targetHolder: { t: "household", id: victimHh }, targetHouseholdId: victimHh, motive: "hunger" });
    const cand = steal.candidates(thief, w).find((c) => c.key === `steal:plot:${pl.id}`)!;
    steal.resolve(thief, cand, w, ctxFor(w));
    const theft = w.log.retained!.find((e) => e.type === "theft")!;
    expect(theft.data.thief).toBe(thief.id);
    runPerception(w);

    // The witness is mistaken: in the dark they took the figure for the innocent neighbour.
    witness.personality.honesty = 1;
    const seen = w.emit("perceived", [witness.id], { observer: witness.id, what: "sighting", perceived: { kind: "person", id: innocent.id } });
    addBelief(w, witness, {
      subject: { kind: "person", id: innocent.id }, predicate: "took", object: { kind: "holder", holder: { t: "household", id: victimHh } },
      time: theft.tick, confidence: 0.85, source: "saw", place: { ...house.hearthSpot },
    }, seen.seq, w.crimes[0]!.id); // as a misidentified witness record would be linked by the engine
    const begged = w.emit("food_requested", [innocent.id, witness.id], { requester: innocent.id, asked: witness.id, answer: "refuse" });
    addBelief(w, witness, { subject: { kind: "person", id: innocent.id }, predicate: "hungry", time: theft.tick - 20, confidence: 0.8, source: "saw" }, begged.seq);
    processCaseChecks(w);
    runDeductions(w);
    const c = witness.caseFiles[0]!;
    expect(c.suspects[0]!.personId).toBe(innocent.id);

    const { judges } = chooseJudges(w, innocent, c.victim);
    for (const j of judges) w.person(j).relationships[witness.id]!.trust = 0.9;
    const h = fileAccusation(w, witness, innocent.id, c)!;
    expect(h.judges[0]).toBe(elder.id);
    processCaseChecks(w);
    conductHearing(w, h);

    const verdict = w.log.retained!.find((e) => e.type === "verdict")!;
    expect(verdict.data.verdict).toBe("guilty");
    expect(verdict.data.accused).toBe(innocent.id);
    const truth = verdict.data.truth as { culprit: number; correct: boolean };
    expect(truth.culprit).toBe(thief.id);
    expect(truth.correct).toBe(false);
    // The log holds both the false belief and the true act.
    expect(w.log.retained!.some((e) => e.type === "belief_added" && e.data.holder === witness.id && (e.data.belief as { subject: { id?: number } }).subject.id === innocent.id)).toBe(true);
    expect(w.log.retained!.some((e) => e.type === "theft" && e.actors.includes(thief.id))).toBe(true);
  });
});
