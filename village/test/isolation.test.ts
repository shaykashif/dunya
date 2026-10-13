import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CaseFile } from "../src/investigation/casefile.ts";
import { deduce, type AgentKnowledge } from "../src/investigation/deduce.ts";
import type { Belief } from "../src/perception/beliefs.ts";
import { freshWorld } from "./helpers.ts";

describe("14.6 belief isolation", () => {
  it("deduction imports nothing that can reach world state", () => {
    const src = readFileSync(new URL("../src/investigation/deduce.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../perception/beliefs.ts", "../world/types.ts", "./casefile.ts"]);
    // world/types.ts and casefile.ts are imported for types only.
    expect(src).toMatch(/import type \{ CensusEntry \} from "\.\.\/world\/types\.ts"/);
    expect(src).toMatch(/import type \{ CaseFile, SuspectScore \} from "\.\/casefile\.ts"/);
  });

  it("deduction follows the investigator's beliefs even when they contradict the truth", () => {
    const w = freshWorld();
    const [a, b] = [w.people[0]!, w.people[10]!];
    const c: CaseFile = {
      id: 1, ownerId: 99, kind: "theft", victim: null, place: { x: 20, y: 20 }, timeFrom: 100, timeTo: 112, openedTick: 112,
      originBeliefId: 1, beliefIds: [], traceIds: [], suspects: [], interviewed: [], examined: 0, status: "open", accusedId: null, hearingId: null, dirty: true, key: "k",
    };
    // The world knows nothing of this; the investigator believes b was seen taking food.
    const beliefs: Belief[] = [
      { id: 1, subject: { kind: "person", id: b.id }, predicate: "took", time: 106, confidence: 0.9, source: "heard", fromId: a.id, sourceSeq: 0, place: { x: 20, y: 20 } },
      { id: 2, subject: { kind: "person", id: b.id }, predicate: "hungry", time: 90, confidence: 0.7, source: "saw", sourceSeq: 0 },
    ];
    const k: AgentKnowledge = { selfId: 99, now: 200, ticksPerDay: 144, ticksPerYear: 144 * 360, census: w.census, trust: {}, opportunityRadius: 5, meansRadius: 8 };
    const out = deduce(c, beliefs, k);
    expect(out[0]!.personId).toBe(b.id);
    // means 0.9 + opportunity 0.9 + motive 0.7, plus half weight (0.9 x 0.9 / 2) because this is what someone else claims to have seen.
    expect(out[0]!.score).toBeCloseTo(0.9 + 0.9 + 0.7 + (0.9 * 0.9) / 2, 5);
    expect(deduce(c, [], k)).toEqual([]);
  });

  it("deduce rejects world state by type", () => {
    const w = freshWorld();
    const k = { selfId: 1, now: 0, ticksPerDay: 144, ticksPerYear: 1, census: w.census, trust: {}, opportunityRadius: 5, meansRadius: 8 };
    const c = { place: { x: 0, y: 0 }, timeFrom: 0, timeTo: 0, kind: "theft", victim: null } as unknown as CaseFile;
    // @ts-expect-error a World is not a belief list: deduction can only see beliefs (checked by `npm run typecheck`).
    expect(() => deduce(c, w, k)).toThrow();
  });
});
