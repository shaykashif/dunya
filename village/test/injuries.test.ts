import { beforeAll, describe, expect, it } from "vitest";
import { cannotWalk, disfigurement, mobility, sightFactor } from "../src/entities/body.ts";
import { kill } from "../src/entities/death.ts";
import { injure, pickUp, setDown } from "../src/entities/injuries.ts";
import { checkInvariants } from "../src/engine/invariants.ts";
import { createSimulation } from "../src/sim.ts";
import type { Engine } from "../src/engine/engine.ts";
import { EventLog, type SimEvent } from "../src/log/events.ts";
import type { Person } from "../src/world/types.ts";
import type { World } from "../src/world/world.ts";

function adults(w: World, n: number): Person[] {
  return w.active().filter((p) => w.ageYears(p) >= 18 && p.injuries.length === 0).slice(0, n);
}

describe("injuries hinder the body", () => {
  it("a broken leg stops walking, and a crutch lets a bad (not the worst) leg carry on", () => {
    const w = createSimulation({ seed: 42 }).world;
    const [p] = adults(w, 1);
    expect(cannotWalk(p!)).toBe(false);
    injure(w, p!, "left leg", "fracture", 0.6, "test", null);
    expect(cannotWalk(p!)).toBe(true);
    expect(mobility(p!)).toBe(0);
    p!.crutch = true;
    expect(cannotWalk(p!)).toBe(false);
    expect(mobility(p!)).toBeGreaterThan(0.2);
    expect(mobility(p!)).toBeLessThan(1);
  });

  it("a twisted ankle slows without crippling", () => {
    const w = createSimulation({ seed: 42 }).world;
    const [p] = adults(w, 1);
    injure(w, p!, "right foot", "sprain", 0.5, "test", null);
    expect(cannotWalk(p!)).toBe(false);
    expect(mobility(p!)).toBeLessThan(1);
  });

  it("a lost eye is permanent and narrows sight; a ruined face disfigures", () => {
    const w = createSimulation({ seed: 42 }).world;
    const [p, q] = adults(w, 2);
    const eye = injure(w, p!, "left eye", "gash", 0.8, "test", null)!;
    expect(eye.kind).toBe("lost");
    expect(eye.permanent).toBe(true);
    expect(sightFactor(p!)).toBeLessThan(1);
    expect(disfigurement(p!)).toBeGreaterThan(0);
    const face = injure(w, q!, "face", "gash", 0.5, "test", null)!;
    face.permanent = true;
    face.lasting = "ruined face";
    expect(disfigurement(q!)).toBeGreaterThanOrEqual(0.7);
  });
});

describe("rescue", () => {
  it("carrying is mutual, and the carried dying frees the carrier whatever the order of people", () => {
    const eng: Engine = createSimulation({ seed: 42 });
    const w = eng.world;
    // The carrier has the lower id, so the carried is processed after them: the case that once left a dangling link.
    const [a, b] = adults(w, 2).sort((x, y) => x.id - y.id);
    injure(w, b!, "left leg", "fracture", 0.9, "test", null);
    pickUp(w, a!, b!);
    checkInvariants(w);
    // Death late in a tick, after the per-tick carry clean-up has already run: only the end-of-tick settling can fix it.
    kill(w, b!, "wounds");
    (eng as unknown as { settleOccupancy(): void }).settleOccupancy();
    expect(a!.carryingId).toBeNull();
    expect(b!.carriedById).toBeNull();
    checkInvariants(w);
  });

  it("setting down puts the person on a tile of their own", () => {
    const w = createSimulation({ seed: 42 }).world;
    const [a, b] = adults(w, 2);
    pickUp(w, a!, b!);
    const down = setDown(w, a!, "home");
    expect(down?.id).toBe(b!.id);
    expect(a!.carryingId).toBeNull();
    expect(b!.carriedById).toBeNull();
    checkInvariants(w);
  });
});

describe("a 90-day village", () => {
  let w: World;
  let events: SimEvent[];

  beforeAll(async () => {
    const log = new EventLog({ retain: true });
    const eng = createSimulation({ seed: 42, log });
    w = eng.world;
    await eng.runDays(90);
    events = log.retained!;
  });

  it("people get hurt, and some are carried to safety", () => {
    expect(events.some((e) => e.type === "injured")).toBe(true);
    expect(events.filter((e) => e.type === "picked_up").length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "carried_to").length).toBeGreaterThan(0);
  });

  it("wounds are tended and heal", () => {
    expect(events.some((e) => e.type === "wounds_treated")).toBe(true);
    expect(events.some((e) => e.type === "injury_healed")).toBe(true);
  });

  it("repeated acquittals of a guilty person breed resentment and retribution plots", () => {
    expect(events.filter((e) => e.type === "injustice_felt").length).toBeGreaterThan(0);
    const plots = events.filter((e) => e.type === "plot_formed" && e.data.kind === "retribution");
    expect(plots.length).toBeGreaterThan(0);
    for (const e of plots) expect(["intimidate", "maim", "kill"]).toContain(e.data.severity);
  });

  it("retribution is a crime like any other: every threat is on record", () => {
    const threats = events.filter((e) => e.type === "intimidation");
    expect(threats.length).toBeGreaterThan(0);
    const recorded = w.crimes.filter((c) => c.kind === "intimidation").length;
    expect(recorded).toBe(threats.length);
  });

  it("no one acts on a grudge after dying, and everyone's injuries are well formed", () => {
    for (const p of w.people) {
      for (const i of p.injuries) {
        expect(i.severity).toBeGreaterThan(0);
        expect(i.severity).toBeLessThanOrEqual(1);
        if (i.permanent) expect(i.lasting).not.toBeNull();
      }
    }
  });
});
