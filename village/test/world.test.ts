import { describe, expect, it } from "vitest";
import { generateCandidates } from "../src/actions/registry.ts";
import { needStrength } from "../src/entities/culture.ts";
import { kill } from "../src/entities/death.ts";
import { injure, treat, updateInjuries } from "../src/entities/injuries.ts";
import { skillLevel } from "../src/entities/skills.ts";
import { checkInvariants } from "../src/engine/invariants.ts";
import { createSimulation } from "../src/sim.ts";
import { updateAnimals } from "../src/world/animals.ts";
import { completeProject, furnitureIn, hasBed, planProject } from "../src/world/structures.ts";
import { NEED_KINDS, VALUES, type Person } from "../src/world/types.ts";
import type { World } from "../src/world/world.ts";
import { ctxFor } from "./helpers.ts";

function head(w: World, hid = 0): Person {
  return w.person(w.households[hid]!.headId!);
}

/** Puts a project's materials on site, as hauling would. */
function stock(w: World, prId: number): void {
  const pr = w.projects.find((x) => x.id === prId)!;
  pr.stock.wood = pr.need.wood;
  pr.stock.stone = pr.need.stone;
  w.ledger.produced.wood += pr.need.wood;
  w.ledger.produced.stone += pr.need.stone;
}

describe("building", () => {
  it("a bed is planned, built and slept in, and conservation holds", () => {
    const w = createSimulation({ seed: 42 }).world;
    const h = head(w);
    const before = furnitureIn(w, w.households[0]!.buildingId, "bed").length;
    const pr = planProject(w, h, "bed")!;
    expect(pr).not.toBeNull();
    stock(w, pr.id);
    completeProject(w, pr, h, ctxFor(w).rng);
    expect(furnitureIn(w, w.households[0]!.buildingId, "bed").length).toBe(before + 1);
    expect(pr.stock.wood).toBe(0);
    checkInvariants(w);
  });

  it("not everyone starts with a bed, and the bedless sleep on the floor", () => {
    const w = createSimulation({ seed: 42 }).world;
    const sleepers = w.active().filter((p) => w.ageYears(p) >= w.config.needs.infantAge);
    expect(sleepers.some((p) => !hasBed(w, p))).toBe(true);
    expect(sleepers.some((p) => hasBed(w, p))).toBe(true);
  });

  it("an extension grows the house three rows and keeps its door", () => {
    const w = createSimulation({ seed: 42 }).world;
    const h = head(w);
    const b = w.house(h.householdId);
    const y0 = b.y0;
    const pr = planProject(w, h, "extension");
    if (!pr) return; // No room to grow on this map.
    stock(w, pr.id);
    completeProject(w, pr, h, ctxFor(w).rng);
    expect(b.y0).toBe(y0 - 3);
    expect(w.map.at(b.door.x, b.door.y)).toBe("door");
    expect(w.map.at(b.x0 + 1, y0)).toBe("floor");
    checkInvariants(w);
  });

  it("a bridge lets people cross the river", () => {
    const w = createSimulation({ seed: 42 }).world;
    const elder = w.person(w.elderId!);
    const pr = planProject(w, elder, "bridge")!;
    expect(pr).not.toBeNull();
    const west = { x: pr.tiles[0]!.x - 1, y: pr.tiles[0]!.y };
    const east = { x: pr.tiles[pr.tiles.length - 1]!.x + 1, y: pr.tiles[0]!.y };
    expect(w.map.reachable(west, east)).toBe(false);
    stock(w, pr.id);
    completeProject(w, pr, elder, ctxFor(w).rng);
    expect(w.map.reachable(west, east)).toBe(true);
    expect(w.path(west, east)).not.toBeNull();
  });
});

describe("wolves", () => {
  it("swim the river to get home", () => {
    const w = createSimulation({ seed: 42 }).world;
    const wolf = w.animals.find((a) => a.kind === "wolf")!;
    // Put the wolf on the far bank from its den, scared, so it runs home.
    const den = wolf.home;
    let start = { x: den.x, y: den.y };
    for (let x = 2; x < w.map.width - 2; x++) {
      const p = { x, y: den.y };
      if (w.map.passable(p.x, p.y) && !w.map.reachable(p, den) && w.map.at(x, den.y) === "forest") {
        start = p;
        break;
      }
    }
    if (start.x === den.x) return; // The den is on the near bank on this map.
    wolf.x = start.x;
    wolf.y = start.y;
    wolf.fearUntil = w.tick + 200;
    for (let i = 0; i < 40; i++) updateAnimals(w);
    expect(w.map.reachable(wolf, den)).toBe(true);
  });
});

describe("people", () => {
  it("everyone holds values, worships a god of the pantheon, and has skills", () => {
    const w = createSimulation({ seed: 42 }).world;
    for (const p of w.active()) {
      for (const v of VALUES) expect(Math.abs(p.values[v])).toBeLessThanOrEqual(1);
      expect(w.culture.deities[p.deityId]).toBeDefined();
      for (const n of NEED_KINDS) expect(needStrength(p, n)).toBeGreaterThanOrEqual(0);
    }
    const adults = w.active().filter((p) => w.ageYears(p) >= 25);
    expect(adults.some((p) => skillLevel(w, p, "foraging") + skillLevel(w, p, "farming") + skillLevel(w, p, "hunting") >= 5)).toBe(true);
  });

  it("an open wound bleeds until it is bound", () => {
    const w = createSimulation({ seed: 42 }).world;
    const p = w.active().find((x) => w.ageYears(x) >= 20)!;
    const healer = w.active().find((x) => x.id !== p.id && w.ageYears(x) >= 20)!;
    const inj = injure(w, p, "left arm", "gash", 0.8, "test", null)!;
    expect(inj.bleeding).toBeGreaterThan(0);
    const h0 = p.survival.health;
    for (let i = 0; i < 6; i++) updateInjuries(w);
    expect(p.survival.health).toBeLessThan(h0);
    treat(w, healer, p, ctxFor(w).rng, "test");
    expect(inj.bleeding).toBe(0);
  });

  it("the badly hurt put aside schemes and look to their wounds", () => {
    const w = createSimulation({ seed: 42 }).world;
    const p = w.active().find((x) => w.ageYears(x) >= 20)!;
    injure(w, p, "torso", "gunshot", 0.9, "test", null);
    const kinds = generateCandidates(w, p).map((c) => c.kind);
    expect(kinds).toContain("seek_care");
    for (const k of ["plot", "steal", "stalk", "raid", "intimidate"]) expect(kinds).not.toContain(k);
  });

  it("nobody plots to steal food while their own house is well stocked", () => {
    const w = createSimulation({ seed: 42 }).world;
    for (const p of w.active()) {
      const st = w.households[p.householdId]!.store;
      st.grain = 500;
      p.survival.food = 0.3;
      p.personality.greed = 0.2;
    }
    for (const p of w.active()) {
      const thefts = generateCandidates(w, p).filter((c) => c.key.startsWith("plot:theft"));
      expect(thefts.every((c) => c.motive === "greed")).toBe(true);
    }
  });
});

describe("inquests", () => {
  it("a found body is examined by the council and ruled on, then buried", async () => {
    const engine = createSimulation({ seed: 42 });
    const w = engine.world;
    const victim = w.active().find((p) => w.ageYears(p) >= 20 && !p.isHead && p.role !== "elder")!;
    // Wolves: a body left in the open, near the victim's home, for someone to find.
    kill(w, victim, "animal", null, null);
    await engine.runDays(3);
    const iq = w.inquests.find((i) => i.personId === victim.id);
    expect(iq).toBeDefined();
    expect(iq!.status).toBe("held");
    expect(["murder", "wolves", "natural"]).toContain(iq!.finding);
    expect(w.traces.some((t) => t.kind === "body" && t.involves.some((r) => r.kind === "person" && r.id === victim.id))).toBe(false);
  });
});
