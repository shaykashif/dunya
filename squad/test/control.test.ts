import { describe, expect, it } from "vitest";
import { replayRun } from "../src/log/replay.ts";
import { createSimulation } from "../src/sim.ts";
import { dist } from "../src/world/map.ts";
import { centroid } from "../src/ai/tactics.ts";

describe("the player's orders and the man under control", () => {
  it("a squad ordered to move bounds there by itself, then holds it; lifting the order hands it back", async () => {
    const engine = createSimulation({ seed: 42 });
    await engine.runTicks(60);
    const w = engine.world;
    const pl = w.platoons[w.attacker];
    const sq = w.squad(pl.squadIds[0]!);
    const men = () => sq.members.map((id) => w.soldier(id)).filter((m) => w.able(m));
    const start = centroid(men());
    const to = w.freeTileNear({ x: Math.round(start.x + 18), y: Math.round(start.y) }, 6)!;
    engine.intervene({ kind: "order", squadId: sq.id, order: "move", x: to.x, y: to.y });
    await engine.runTicks(2);
    expect(sq.state).toBe("orders");
    expect(sq.directive?.kind).toBe("move");
    await engine.runTicks(200);
    expect(sq.directive?.kind).toBe("hold");
    expect(dist(centroid(men()), to)).toBeLessThan(8);
    // The platoon leader's own plans leave it alone meanwhile.
    expect(sq.state).toBe("orders");
    engine.intervene({ kind: "order", squadId: sq.id, order: "resume", x: 0, y: 0 });
    await engine.runTicks(4);
    expect(sq.directive).toBeNull();
    expect(sq.state).not.toBe("orders");
  });

  it("a squad ordered to suppress a place puts its fire there", async () => {
    const engine = createSimulation({ seed: 42 });
    await engine.runTicks(60);
    const w = engine.world;
    const sq = w.squad(w.platoons[w.attacker].squadIds[0]!);
    const c = centroid(sq.members.map((id) => w.soldier(id)));
    const at = { x: Math.round(c.x), y: Math.round(c.y + (w.platoons[w.attacker].rearY > c.y ? -25 : 25)) };
    engine.intervene({ kind: "order", squadId: sq.id, order: "suppress", x: at.x, y: at.y });
    let rounds = 0;
    w.log.addSink((e) => {
      if (e.type !== "fire" || !sq.members.includes(e.actors[0]!)) return;
      const [x, y] = e.data.at as [number, number];
      if (Math.hypot(x - at.x, y - at.y) <= 3) rounds += e.data.rounds as number;
    });
    await engine.runTicks(60);
    expect(sq.orders.A.kind).toBe("suppress");
    expect(rounds).toBeGreaterThan(10);
  });

  it("a squad sent up to a line drawn on the map strings out along it and holds it", async () => {
    const engine = createSimulation({ seed: 42 });
    await engine.runTicks(60);
    const w = engine.world;
    const sq = w.squad(w.platoons[w.attacker].squadIds[0]!);
    const men = () => sq.members.map((id) => w.soldier(id)).filter((m) => w.able(m));
    const c = centroid(men());
    const a = w.freeTileNear({ x: Math.round(c.x + 8), y: Math.round(c.y - 4) }, 4)!;
    const b = w.freeTileNear({ x: Math.round(c.x + 30), y: Math.round(c.y - 4) }, 4)!;
    engine.intervene({ kind: "order", squadId: sq.id, order: "move", x: a.x, y: a.y, x2: b.x, y2: b.y });
    await engine.runTicks(240);
    expect(sq.directive?.kind).toBe("hold");
    expect(sq.directive?.to).toEqual(b);
    // Close to the line, and spread along most of it rather than bunched at one point.
    const off = (m: { x: number; y: number }) => Math.abs((b.y - a.y) * m.x - (b.x - a.x) * m.y + b.x * a.y - b.y * a.x) / Math.hypot(b.x - a.x, b.y - a.y);
    const near = men().filter((m) => off(m) <= 4);
    expect(near.length).toBeGreaterThanOrEqual(Math.ceil(men().length * 0.6));
    const xs = near.map((m) => m.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan((b.x - a.x) * 0.5);
  });

  it("a squad told to suppress along a line gives each man his own stretch of it", async () => {
    const engine = createSimulation({ seed: 42 });
    await engine.runTicks(60);
    const w = engine.world;
    const sq = w.squad(w.platoons[w.attacker].squadIds[0]!);
    const c = centroid(sq.members.map((id) => w.soldier(id)));
    const ahead = w.platoons[w.attacker].rearY > c.y ? -25 : 25;
    const a = { x: Math.round(c.x - 15), y: Math.round(c.y + ahead) }, b = { x: Math.round(c.x + 15), y: Math.round(c.y + ahead) };
    engine.intervene({ kind: "order", squadId: sq.id, order: "suppress", x: a.x, y: a.y, x2: b.x, y2: b.y });
    await engine.runTicks(6);
    const aims = Object.values({ ...sq.orders.A.targets, ...sq.orders.B.targets });
    expect(aims.length).toBeGreaterThan(5);
    expect(new Set(aims.map((p) => p.x)).size).toBeGreaterThan(5);
    for (const p of aims) expect(Math.abs(p.y - a.y)).toBeLessThanOrEqual(1);
  });

  it("a man under control walks where he is steered, fires where he looks, and is let go when he is killed", async () => {
    const engine = createSimulation({ seed: 42 });
    await engine.runTicks(40);
    const w = engine.world;
    // A rifleman with open ground beside him, clear of hedges and of the column.
    const open = (m: { x: number; y: number; z: number }, dx: number) => [1, 2, 3, 4, 5].every((k) => w.isFree(m.x + k * dx, m.y, 0, m.z) && w.map.cellCost(w.map.cell(m.x + k * dx, m.y, m.z)) < 2);
    const s = w.side(w.attacker).find((m) => w.able(m) && m.weapon === "m1_garand" && (open(m, 1) || open(m, -1)))!;
    const dx = open(s, 1) ? 1 : -1;
    engine.intervene({ kind: "control", personId: s.id });
    await engine.runTicks(1);
    expect(w.pilot?.id).toBe(s.id);
    const x0 = s.x;
    engine.intervene({ kind: "steer", dx, dy: 0, sprint: true, stance: "stand", aim: [s.x + dx * 20, s.y], fire: false });
    await engine.runTicks(6);
    expect((s.x - x0) * dx).toBeGreaterThan(2);
    expect(s.dir).toBe(dx);
    const shots = s.shots, loaded = s.loaded;
    engine.intervene({ kind: "steer", dx: 0, dy: 0, sprint: false, stance: "crouch", aim: [s.x + dx * 20, s.y], fire: true });
    await engine.runTicks(5);
    expect(s.shots).toBeGreaterThan(shots);
    expect(s.loaded + (s.shots - shots)).toBeLessThanOrEqual(loaded + 8);
    // Nobody else decides for him meanwhile.
    expect(s.act).toBeNull();
    for (let k = 0; k < 40 && s.status !== "dead"; k++) {
      engine.intervene({ kind: "sniper", personId: s.id });
      await engine.runTicks(1);
    }
    await engine.runTicks(1);
    expect(s.status).toBe("dead");
    expect(w.pilot).toBeNull();
    const replay = await replayRun(42, w.tick, engine.decisionLog, { interventions: engine.interventionLog });
    expect(replay.hash).toBe(w.log.hash());
  });
});
