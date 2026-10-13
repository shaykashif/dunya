// Command: what each squad leader and platoon leader decides. Squads move in
// bounds from hedge to hedge, react to contact, then fix the enemy with their
// automatic weapon and send the rifle team round a flank to assault, as 1944
// doctrine taught both armies. Defenders hold their fire until the enemy is in
// the open, and fall back by bounds when flanked or badly hurt.
import { clusters, liveContacts, sideContacts } from "../combat/perception.ts";
import { isLeader, label, note, shout } from "../entities/soldier.ts";
import { cheb, dist } from "../world/map.ts";
import { enemyOf, type ElementOrder, type FirePolicy, type Pace, type Platoon, type Point, type Side, type Soldier, type Squad, type SquadState } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { boundsTo, canFireOn, centroid, facingFrom, flankPoint, pickPositions } from "./tactics.ts";

const RANK_ORDER = ["Leutnant", "Second Lieutenant", "Oberfeldwebel", "Technical Sergeant", "Feldwebel", "Staff Sergeant", "Unteroffizier", "Sergeant", "Obergefreiter", "Corporal", "Gefreiter", "Technician Fifth Grade", "Private First Class", "Oberschütze", "Private", "Schütze"];

export function ableMen(w: World, sq: Squad): Soldier[] {
  return sq.members.map((id) => w.soldier(id)).filter((s) => w.able(s));
}

function elementMen(w: World, sq: Squad, el: "A" | "B"): Soldier[] {
  const men = ableMen(w, sq);
  const own = men.filter((s) => s.element === el && s.role !== "medic");
  return own;
}

/** Splits the able men into the two elements, borrowing riflemen if one has been shot away. */
function elements(w: World, sq: Squad): { A: Soldier[]; B: Soldier[] } {
  let A = elementMen(w, sq, "A");
  let B = elementMen(w, sq, "B");
  if (A.length === 0 && B.length >= 2) {
    A = B.slice(Math.ceil(B.length / 2));
    B = B.slice(0, Math.ceil(B.length / 2));
  } else if (B.length === 0 && A.length >= 3) {
    B = A.filter((s) => s.role !== "machine_gunner" && s.role !== "auto_rifleman" && s.role !== "asst_gunner").slice(0, Math.floor(A.length / 2));
    A = A.filter((s) => !B.includes(s));
  }
  return { A, B };
}

export function emptyOrder(tick: number): ElementOrder {
  return { kind: "hold", positions: {}, target: null, pace: "walk", fire: "free", issued: tick };
}

function setOrder(w: World, sq: Squad, el: "A" | "B", o: Omit<ElementOrder, "issued">): void {
  const prev = sq.orders[el];
  const same = prev.kind === o.kind && prev.pace === o.pace && prev.fire === o.fire && JSON.stringify(prev.positions) === JSON.stringify(o.positions) && (prev.target?.x ?? -1) === (o.target?.x ?? -1) && (prev.target?.y ?? -1) === (o.target?.y ?? -1);
  if (same) return;
  sq.orders[el] = { ...o, issued: w.tick };
  // Interrupt men carrying out a superseded order.
  for (const id of sq.members) {
    const s = w.soldier(id);
    if (s.element === el && s.act?.cand.ordered) s.act = null;
  }
  w.emit("order", [], { squad: sq.id, element: el, kind: o.kind, pace: o.pace, fire: o.fire, target: o.target ? [o.target.x, o.target.y] : null });
}

function setState(w: World, sq: Squad, state: SquadState, intent: string): void {
  if (sq.state === state && sq.intent === intent) return;
  const from = sq.state;
  sq.state = state;
  sq.stateTick = w.tick;
  sq.intent = intent;
  w.emit("squad_state", [], { squad: sq.id, from, to: state, intent });
}

function arrived(w: World, men: readonly Soldier[], order: ElementOrder, within = 1.5): boolean {
  if (men.length === 0) return true;
  let n = 0;
  for (const m of men) {
    const p = order.positions[m.id];
    if (!p || cheb(m, p) <= within) n++;
  }
  return n >= Math.ceil(men.length * 0.75) || w.tick - order.issued > 150;
}

/** If the leader is down, the next man takes over: the assistant, else the senior man. */
function ensureLeader(w: World, sq: Squad): Soldier | null {
  const cur = w.maybe(sq.leaderId);
  if (cur && w.able(cur) && !cur.broken) return cur;
  const men = ableMen(w, sq).filter((s) => !s.broken && s.role !== "medic");
  if (men.length === 0) return null;
  men.sort((a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank) || (a.role === "asst_leader" ? -1 : 0) - (b.role === "asst_leader" ? -1 : 0) || a.id - b.id);
  const next = men[0]!;
  const prev = sq.leaderId;
  sq.leaderId = next.id;
  w.emit("takes_command", [next.id], { squad: sq.id, by: next.id, from: prev });
  shout(w, next, next.side === "us" ? `I've got the squad! On me!` : "Ich übernehme! Mir nach!", null);
  note(w, next, `took command of ${sq.name}`);
  return next;
}

function rearDir(w: World, side: Side): Point {
  return { x: 0, y: w.platoons[side].rearY === 0 ? -1 : 1 };
}

/** Where a squad is headed on the objective: its own side of the hamlet. */
function objectiveFor(w: World, sq: Squad, pl: Platoon): Point {
  const idx = pl.squadIds.indexOf(sq.id);
  const n = pl.squadIds.length;
  const offset = n <= 1 ? 0 : sq.task === "reserve" ? 0 : (idx - (n - 1) / 2) * 12;
  return w.freeTileNear({ x: Math.round(pl.objective.x + offset), y: pl.objective.y }, 6) ?? pl.objective;
}

/** The enemy position a squad is fighting: its strongest known cluster, nearest first among equals. */
function pickFocus(w: World, sq: Squad, at: Point): { at: Point; n: number; automatic: boolean } | null {
  const live = liveContacts(w, sq, 40);
  if (live.length === 0) return null;
  const cs = clusters(live, 6).sort((a, b) => (b.automatic ? 1 : 0) - (a.automatic ? 1 : 0) || b.n - a.n || dist(a.at, at) - dist(b.at, at));
  return cs[0] ?? null;
}

function avgMorale(men: readonly Soldier[]): number {
  return men.length === 0 ? 0 : men.reduce((a, s) => a + s.morale, 0) / men.length;
}

function strength(w: World, sq: Squad): number {
  const base = sq.members.filter((id) => w.soldier(id).role !== "medic").length;
  return base === 0 ? 0 : ableMen(w, sq).filter((s) => s.role !== "medic").length / base;
}

function order(kind: ElementOrder["kind"], positions: Record<number, Point>, pace: Pace, fire: FirePolicy, target: Point | null = null): Omit<ElementOrder, "issued"> {
  return { kind, positions, pace, fire, target };
}

/**
 * Firing positions for a team putting fire on `target`: men who already have a
 * line of fire keep their spot; the rest find one nearby, beside a hedge if
 * possible (a man can only shoot through a hedgerow from right against it).
 */
function firingLine(w: World, men: readonly Soldier[], prev: Record<number, Point>, target: Point): Record<number, Point> {
  const out: Record<number, Point> = {};
  const need: Soldier[] = [];
  for (const m of men) {
    const p = prev[m.id];
    if (p && cheb(p, m) <= 4 && canFireOn(w, p, target)) out[m.id] = p;
    else if (canFireOn(w, m, target)) out[m.id] = { x: m.x, y: m.y };
    else need.push(m);
  }
  if (need.length > 0) {
    const c = centroid(need);
    const picked = pickPositions(w, need, c, facingFrom(c, target), 2, 7, target);
    for (const m of need) out[m.id] = picked[m.id]!;
  }
  return out;
}

/** Keep everyone where they are, fighting from cover. */
function holdHere(w: World, sq: Squad, men: { A: Soldier[]; B: Soldier[] }, fire: FirePolicy, target: Point | null): void {
  for (const el of ["A", "B"] as const) {
    const prev = sq.orders[el].positions;
    if (target) {
      setOrder(w, sq, el, order("suppress", firingLine(w, men[el], prev, target), "crouch", fire, target));
      continue;
    }
    const pos: Record<number, Point> = {};
    for (const m of men[el]) {
      const p = prev[m.id];
      pos[m.id] = p && cheb(p, m) <= 4 ? p : { x: m.x, y: m.y };
    }
    setOrder(w, sq, el, order(target ? "suppress" : "hold", pos, "crouch", fire, target));
  }
}

// ---------- Attackers ----------

function attackStep(w: World, sq: Squad, pl: Platoon, leader: Soldier): void {
  const men = elements(w, sq);
  const all = [...men.A, ...men.B];
  if (all.length === 0) return;
  const pos = centroid(all);
  const focus = pickFocus(w, sq, pos);
  if (focus) sq.focus = focus.at;
  const objective = objectiveFor(w, sq, pl);
  const toEnemy = facingFrom(pos, focus?.at ?? objective);

  if (pl.withdrawing && sq.state !== "withdraw") {
    setState(w, sq, "withdraw", "pulling back to the start line");
    shout(w, leader, leader.side === "us" ? "Fall back! Back to the start line!" : "Zurück! Absetzen!", null);
  }

  switch (sq.state) {
    case "deploy":
    case "support": {
      // The reserve lets the line squads get ahead before following.
      if (sq.task === "reserve" && w.tick < 150) return;
      sq.route = boundsTo(w, sq.side, pos, objective);
      sq.routeIdx = 0;
        sq.boundWp = -1;
      sq.bounding = "A";
      setState(w, sq, "advance", `advancing on ${w.buildings.length ? "the hamlet" : "the objective"}, hedge by hedge`);
      return;
    }
    case "advance": {
      if (focus && dist(pos, focus.at) <= 130) {
        setState(w, sq, "react", "contact! getting down and returning fire");
        shout(w, leader, leader.side === "us" ? (focus.automatic ? "MG! Get down!" : "Contact front!") : focus.automatic ? "MG! Deckung!" : "Feind voraus!", "contact", 40);
        // The drill: get down, get into a spot you can shoot from, return fire.
        holdHere(w, sq, men, "free", focus.at);
        return;
      }
      advanceByBounds(w, sq, men, objective, toEnemy);
      return;
    }
    case "react": {
      if (w.tick - sq.stateTick < 6) return;
      if (!focus) {
        setState(w, sq, "advance", "no more fire; pressing on");
        sq.route = boundsTo(w, sq.side, pos, objective);
        sq.routeIdx = 0;
        sq.boundWp = -1;
        return;
      }
      decideOnContact(w, sq, men, focus, pos, leader);
      return;
    }
    case "flank": {
      if (!focus || !sq.focus) {
        setState(w, sq, "advance", "the position has gone quiet; pressing on");
        sq.route = boundsTo(w, sq.side, pos, objective);
        sq.routeIdx = 0;
        sq.boundWp = -1;
        return;
      }
      // Base of fire keeps their heads down, from spots that can see the position.
      setOrder(w, sq, "A", order("suppress", firingLine(w, men.A, sq.orders.A.positions, sq.focus), "crouch", "free", sq.focus));
      if (!sq.flankPoint) sq.flankPoint = flankPoint(w, sq.side, centroid(men.B), sq.focus, 18);
      if (!sq.flankPoint) {
        setState(w, sq, "fix", "no way round; pinning them and calling for help");
        return;
      }
      if (sq.orders.B.kind !== "move" || w.tick - sq.orders.B.issued > 200) {
        const facing = facingFrom(sq.flankPoint, sq.focus);
        setOrder(w, sq, "B", order("move", pickPositions(w, men.B, sq.flankPoint, facing, 2, 4, sq.focus), "crouch", "return"));
      }
      const bPos = centroid(men.B);
      const close = dist(bPos, sq.focus) <= 16;
      if (arrived(w, men.B, sq.orders.B, 2) || close) {
        setState(w, sq, "assault", "flank reached: assaulting while the base of fire covers");
        shout(w, leader, leader.side === "us" ? "Go! Go! Go!" : "Sprung auf! Marsch, marsch!", null);
      } else if (men.B.length > 0 && men.B.filter((m) => m.pinned).length >= Math.ceil(men.B.length * 0.6) && w.tick - sq.stateTick > 30) {
        setState(w, sq, "fix", "the flanking team is pinned; trading fire");
      } else if (w.tick - sq.stateTick > 260) {
        sq.flankPoint = null;
        setState(w, sq, "react", "the flank is taking too long; reassessing");
      }
      return;
    }
    case "fix": {
      if (!focus || !sq.focus) {
        setState(w, sq, "advance", "fire has died down; pressing on");
        sq.route = boundsTo(w, sq.side, pos, objective);
        sq.routeIdx = 0;
        sq.boundWp = -1;
        return;
      }
      holdHere(w, sq, men, "free", sq.focus);
      const enemyQuiet = !all.some((m) => m.underFire && w.tick - m.underFire.tick < 15);
      if (w.tick - sq.stateTick > 60 && (enemyQuiet || dist(pos, sq.focus) < 14) && strength(w, sq) > 0.4) {
        setState(w, sq, "assault", "their fire has slackened: up and at them");
        shout(w, leader, leader.side === "us" ? "Move! Move!" : "Vorwärts!", null);
      } else if (strength(w, sq) < 0.45 || avgMorale(all) < 0.28) {
        fallBack(w, sq, pos, leader);
      } else if (w.tick - sq.stateTick > 120 && men.B.length >= 3) {
        sq.flankPoint = null;
        setState(w, sq, "flank", "trying the other flank");
      }
      return;
    }
    case "assault": {
      if (!sq.focus) {
        setState(w, sq, "advance", "pressing on");
        return;
      }
      const target = sq.focus;
      const assaulters = men.B.length > 0 ? men.B : men.A;
      if (sq.orders.B.kind !== "assault" || cheb(sq.orders.B.target ?? target, target) > 3) {
        setOrder(w, sq, men.B.length > 0 ? "B" : "A", order("assault", pickPositions(w, assaulters, target, toEnemy, 2, 4), "rush", "free", target));
      }
      const closest = Math.min(...assaulters.map((m) => dist(m, target)));
      if (men.B.length > 0) {
        // Lift the base of fire when the assault closes in, then follow it up.
        if (closest > 10) {
          setOrder(w, sq, "A", order("suppress", firingLine(w, men.A, sq.orders.A.positions, target), "crouch", "free", target));
        } else if (sq.orders.A.kind !== "move") {
          shout(w, leader, leader.side === "us" ? "Shift fire! Shift fire!" : "Feuer verlegen!", "shift", 30);
          const behind = { x: Math.round(target.x - toEnemy.x * 8), y: Math.round(target.y - toEnemy.y * 8) };
          setOrder(w, sq, "A", order("move", pickPositions(w, men.A, behind, toEnemy, 2, 5), "rush", "free"));
        }
      }
      // Is the position ours? Nobody of theirs left able near it.
      const enemyLeft = w.soldiers.some((e) => e.side !== sq.side && w.able(e) && cheb(e, target) <= 6 && sq.contacts[e.id] && w.tick - sq.contacts[e.id]!.tick < 15);
      if (closest <= 5 && !enemyLeft) {
        for (const c of Object.values(sq.contacts)) if (cheb(c, target) <= 7) delete sq.contacts[c.id];
        w.emit("position_taken", [leader.id], { squad: sq.id, at: [target.x, target.y] });
        shout(w, leader, leader.side === "us" ? "Clear! Hold here, then we push on." : "Stellung genommen!", null);
        sq.focus = null;
        sq.flankPoint = null;
        if (dist(pos, objective) <= w.config.battle.objectiveRadius + 6) setState(w, sq, "consolidate", "on the objective, digging in");
        else {
          setState(w, sq, "advance", "position cleared; pushing on");
          sq.route = boundsTo(w, sq.side, pos, objective);
          sq.routeIdx = 0;
        sq.boundWp = -1;
        }
      } else if (w.tick - sq.stateTick > 220 || assaulters.length === 0 || (strength(w, sq) < 0.35 && closest > 8)) {
        if (strength(w, sq) < 0.45) fallBack(w, sq, pos, leader);
        else setState(w, sq, "fix", "the assault stalled; back to trading fire");
      }
      return;
    }
    case "consolidate": {
      const away = { x: -rearDir(w, sq.side).x, y: -rearDir(w, sq.side).y };
      const center = objective;
      for (const el of ["A", "B"] as const) {
        if (sq.orders[el].kind !== "hold" || w.tick - sq.orders[el].issued > 300) setOrder(w, sq, el, order("hold", pickPositions(w, men[el], center, away, 2, 7), "crouch", "free"));
      }
      if (focus && dist(focus.at, pos) < 40 && w.tick - sq.stateTick > 20) {
        setState(w, sq, "react", "counter-fire on the objective");
      }
      return;
    }
    case "fall_back": {
      fallBackStep(w, sq, men, pos, focus?.at ?? null, leader, () => {
        setState(w, sq, "react", "regrouped; taking stock");
      });
      return;
    }
    case "withdraw": {
      withdrawStep(w, sq, men);
      return;
    }
    default:
      return;
  }
}

function decideOnContact(w: World, sq: Squad, men: { A: Soldier[]; B: Soldier[] }, focus: { at: Point; n: number; automatic: boolean }, pos: Point, leader: Soldier): void {
  const all = [...men.A, ...men.B];
  const d = dist(pos, focus.at);
  if (strength(w, sq) < 0.45 || avgMorale(all) < 0.3) {
    fallBack(w, sq, pos, leader);
    return;
  }
  if ((d <= 28 && focus.n <= 2 && !focus.automatic) || d <= 10) {
    setState(w, sq, "assault", `${focus.n === 1 ? "a lone rifleman" : "a light position"} close by: rushing it with fire and movement`);
    shout(w, leader, leader.side === "us" ? "Fire and movement! Go!" : "Sprung auf!", null);
    return;
  }
  if (men.B.length >= 3) {
    sq.flankPoint = flankPoint(w, sq.side, centroid(men.B), focus.at, Math.max(12, Math.min(22, Math.round(d * 0.45))));
    if (sq.flankPoint) {
      const side = (sq.flankPoint.x - focus.at.x) * (pos.y - focus.at.y) - (sq.flankPoint.y - focus.at.y) * (pos.x - focus.at.x) > 0 ? "left" : "right";
      setState(w, sq, "flank", `${focus.automatic ? "machine gun" : "enemy"} at ${Math.round(d * 3)} m: base of fire pins it, ${side} flank for the rifle team`);
      shout(w, leader, leader.side === "us" ? (focus.automatic ? "BAR, keep that MG down! Charlie, on me — we go round!" : "Base of fire! Second team, with me!") : "MG, Feuerschutz! Gruppe, mir nach!", null);
      return;
    }
  }
  setState(w, sq, "fix", `pinning the ${focus.automatic ? "machine gun" : "position"} with fire`);
}

function advanceByBounds(w: World, sq: Squad, men: { A: Soldier[]; B: Soldier[] }, objective: Point, facing: Point): void {
  const wp = sq.route[sq.routeIdx];
  if (!wp) {
    setState(w, sq, "consolidate", "on the objective");
    return;
  }
  const all = [...men.A, ...men.B];
  const danger = sq.firstContactTick !== null || dist(centroid(all), objective) < 95;
  const fwd = facingFrom(wp, sq.route[sq.routeIdx + 1] ?? objective);
  const face = Math.abs(fwd.x) + Math.abs(fwd.y) > 0 ? fwd : facing;
  if (!danger) {
    // Travelling: everyone moves together, the base team in front.
    const posA = sq.orders.A.kind === "move" && sq.orders.A.target && sq.orders.A.target.x === wp.x && sq.orders.A.target.y === wp.y ? sq.orders.A.positions : pickPositions(w, men.A, wp, face, 3, 5);
    const behind = { x: Math.round(wp.x - face.x * 8), y: Math.round(wp.y - face.y * 8) };
    const posB = sq.orders.B.kind === "move" && sq.orders.B.target && sq.orders.B.target.x === wp.x && sq.orders.B.target.y === wp.y ? sq.orders.B.positions : pickPositions(w, men.B, w.freeTileNear(behind, 4) ?? wp, face, 3, 5);
    setOrder(w, sq, "A", order("move", posA, "walk", "return", wp));
    setOrder(w, sq, "B", order("move", posB, "walk", "return", wp));
    if (arrived(w, men.A, sq.orders.A, 2)) sq.routeIdx++;
    return;
  }
  // Bounding overwatch: one team moves to the next hedge while the other watches, then it comes up.
  const mover = sq.bounding;
  const watcher = mover === "A" ? "B" : "A";
  const hold = (ms: Soldier[]) => Object.fromEntries(ms.map((m) => [m.id, { x: m.x, y: m.y }])) as Record<number, Point>;
  if (sq.boundWp !== sq.routeIdx) {
    sq.boundWp = sq.routeIdx;
    sq.boundStage = 0;
    const positions = pickPositions(w, [...men[mover], ...men[watcher]], wp, face, 3, 6);
    const pick = (ms: Soldier[]) => Object.fromEntries(ms.map((m) => [m.id, positions[m.id]!])) as Record<number, Point>;
    setOrder(w, sq, mover, order("move", pick(men[mover]), "crouch", "return", wp));
    setOrder(w, sq, watcher, order("overwatch", hold(men[watcher]), "crouch", "free"));
    sq.intent = `bounding: ${mover === "A" ? "base team" : "rifle team"} moving up while the other covers`;
    return;
  }
  if (sq.boundStage === 0) {
    if (!arrived(w, men[mover], sq.orders[mover], 1.5)) return;
    sq.boundStage = 1;
    const positions = pickPositions(w, men[watcher], wp, face, 3, 6);
    setOrder(w, sq, watcher, order("move", positions, "crouch", "return", wp));
    setOrder(w, sq, mover, order("overwatch", hold(men[mover]), "crouch", "free"));
    sq.intent = `bounding: ${watcher === "A" ? "base team" : "rifle team"} coming up`;
    return;
  }
  if (!arrived(w, men[watcher], sq.orders[watcher], 1.5)) return;
  sq.routeIdx++;
  sq.bounding = watcher;
}

function fallBack(w: World, sq: Squad, pos: Point, leader: Soldier): void {
  const back = rearDir(w, sq.side);
  const prev = sq.route[Math.max(0, sq.routeIdx - 1)];
  const to = prev && dist(prev, pos) > 8 && dist(prev, pos) < 40 ? prev : { x: pos.x, y: Math.max(1, Math.min(w.map.height - 2, pos.y + back.y * 22)) };
  sq.post = w.freeTileNear(to, 6) ?? to;
  sq.bounding = "B";
  setState(w, sq, "fall_back", "too many hit: falling back by bounds under covering fire");
  shout(w, leader, leader.side === "us" ? "Fall back! Smoke! Covering fire!" : "Absetzen! Feuerschutz!", null);
}

/** Bounding back: one team covers while the other moves, then they swap. */
function fallBackStep(w: World, sq: Squad, men: { A: Soldier[]; B: Soldier[] }, pos: Point, threat: Point | null, leader: Soldier, done: () => void): void {
  const to = sq.post ?? pos;
  const facing = threat ? facingFrom(to, threat) : { x: -rearDir(w, sq.side).x, y: -rearDir(w, sq.side).y };
  const mover = sq.bounding, cover = mover === "A" ? "B" : "A";
  const atTo = (o: ElementOrder) => o.kind === "withdraw" && o.target !== null && o.target.x === to.x && o.target.y === to.y;
  if (!atTo(sq.orders[mover])) {
    setOrder(w, sq, mover, order("withdraw", pickPositions(w, men[mover], to, facing, 2, 5), "rush", "return", to));
    const hold: Record<number, Point> = {};
    for (const m of men[cover]) hold[m.id] = { x: m.x, y: m.y };
    if (!atTo(sq.orders[cover])) setOrder(w, sq, cover, order("suppress", hold, "crouch", "free", threat));
    return;
  }
  if (!arrived(w, men[mover], sq.orders[mover], 2)) return;
  if (!atTo(sq.orders[cover])) {
    setOrder(w, sq, cover, order("withdraw", pickPositions(w, men[cover], to, facing, 2, 5), "rush", "return", to));
    return;
  }
  if (!arrived(w, men[cover], sq.orders[cover], 2)) return;
  note(w, leader, "brought the squad back to cover");
  done();
}

function withdrawStep(w: World, sq: Squad, men: { A: Soldier[]; B: Soldier[] }): void {
  const rearY = w.platoons[sq.side].rearY;
  for (const el of ["A", "B"] as const) {
    if (sq.orders[el].kind === "withdraw" && sq.orders[el].target?.y === rearY) continue;
    const pos: Record<number, Point> = {};
    for (const m of men[el]) pos[m.id] = w.freeTileNear({ x: m.x, y: rearY }, 8, m.id) ?? { x: m.x, y: rearY };
    setOrder(w, sq, el, order("withdraw", pos, "rush", "return", { x: 0, y: rearY }));
  }
}

// ---------- Defenders ----------

function defendStep(w: World, sq: Squad, pl: Platoon, leader: Soldier): void {
  const men = elements(w, sq);
  const all = [...men.A, ...men.B];
  if (all.length === 0) return;
  const pos = centroid(all);
  const focus = pickFocus(w, sq, pos);
  if (focus) sq.focus = focus.at;
  if (pl.withdrawing && sq.state !== "withdraw") {
    setState(w, sq, "withdraw", "pulling out to the rear");
    shout(w, leader, leader.side === "de" ? "Absetzen! Alles zurück!" : "Pull out! Everybody back!", null);
  }
  switch (sq.state) {
    case "deploy":
    case "hold": {
      if (sq.state === "deploy") setState(w, sq, "hold", "dug in, holding fire until they are in the open");
      // Fire discipline: wait until the enemy is in the killing ground.
      const live = liveContacts(w, sq, 30);
      const fired = all.some((m) => m.underFire && w.tick - m.underFire.tick < 10) || all.some((m) => w.tick - m.lastFiredTick < 30);
      const close = live.some((c) => c.visible && dist(c, pos) <= 75);
      const open = sq.orders.A.fire === "free";
      if (!open && (fired || close)) {
        shout(w, leader, leader.side === "de" ? "Feuer frei!" : "Open fire!", null);
        w.emit("open_fire", [leader.id], { squad: sq.id });
      }
      const policy: FirePolicy = open || fired || close ? "free" : "hold";
      for (const el of ["A", "B"] as const) {
        const cur = sq.orders[el];
        if (cur.kind !== "hold" || cur.fire !== policy || Object.keys(cur.positions).length === 0) {
          const keep: Record<number, Point> = {};
          for (const m of men[el]) keep[m.id] = cur.positions[m.id] ?? { x: m.x, y: m.y };
          setOrder(w, sq, el, order("hold", keep, "crouch", policy));
        }
      }
      // Flanked, or too badly hurt: fall back to the next line.
      const flanked = live.some((c) => {
        if (dist(c, pos) > 26) return false;
        const a = facingFrom(pos, c);
        return a.x * sq.facing.x + a.y * sq.facing.y < 0.25;
      });
      const closeIn = live.filter((c) => dist(c, pos) <= 8).length >= 2;
      if ((strength(w, sq) < 0.5 || avgMorale(all) < 0.32 || flanked || closeIn) && sq.fallback) {
        sq.post = sq.fallback;
        sq.fallback = null;
        sq.bounding = "B";
        setState(w, sq, "fall_back", flanked ? "outflanked: falling back to the hamlet" : "too many hit: falling back to the hamlet");
        shout(w, leader, leader.side === "de" ? "Zurück zum Dorf! MG gibt Feuerschutz!" : "Back to the farm! Cover them!", null);
      } else if (strength(w, sq) < 0.3 && !sq.fallback) {
        setState(w, sq, "withdraw", "the position is lost; getting out");
      }
      return;
    }
    case "fall_back": {
      fallBackStep(w, sq, men, pos, focus?.at ?? null, leader, () => {
        setState(w, sq, "hold", "holding the second line");
        for (const el of ["A", "B"] as const) {
          const keep: Record<number, Point> = {};
          for (const m of men[el]) keep[m.id] = sq.orders[el].positions[m.id] ?? { x: m.x, y: m.y };
          setOrder(w, sq, el, order("hold", keep, "crouch", "free"));
        }
      });
      return;
    }
    case "withdraw":
      withdrawStep(w, sq, men);
      return;
    default:
      setState(w, sq, "hold", "holding");
  }
}

// ---------- Platoon headquarters ----------

function hqStep(w: World, sq: Squad, pl: Platoon, leader: Soldier): void {
  const men = ableMen(w, sq).filter((s) => s.role !== "medic" && !(s.role === "platoon_sergeant" && s.carryingId !== null));
  if (men.length === 0) return;
  const line = pl.squadIds.flatMap((id) => ableMen(w, w.squad(id)));
  const back = rearDir(w, sq.side);
  let at: Point;
  if (pl.withdrawing) at = { x: leader.x, y: pl.rearY };
  else if (pl.role === "attack" && line.length > 0) {
    const c = centroid(line);
    at = { x: c.x, y: Math.max(1, Math.min(w.map.height - 2, c.y + back.y * 16)) };
  } else at = sq.post ?? { x: leader.x, y: leader.y };
  const cur = sq.orders.A;
  const target = cur.target;
  if (!target || cheb(target, at) > 6 || w.tick - cur.issued > 240) {
    const facing = { x: -back.x, y: -back.y };
    setOrder(w, sq, "A", order(pl.withdrawing ? "withdraw" : "move", pickPositions(w, men, w.freeTileNear(at, 6) ?? at, facing, 2, 4), pl.role === "attack" ? "crouch" : "rush", "return", at));
  }
  sq.intent = pl.withdrawing ? "withdrawing" : pl.role === "attack" ? "following the attack, directing fire" : "holding the hamlet";
}

// ---------- Platoon ----------

function platoonStep(w: World, pl: Platoon): void {
  const side = pl.side;
  const strengthNow = w.strength(side);
  const cfg = w.config;
  if (!pl.withdrawing) {
    const breakAt = pl.role === "attack" ? cfg.battle.attackBreak : cfg.battle.defendBreak;
    if (strengthNow < breakAt) {
      pl.withdrawing = true;
      pl.withdrawTick = w.tick;
      pl.phase = pl.role === "attack" ? "attack called off" : "withdrawing";
      w.emit("platoon_withdraws", [], { side, strength: Math.round(strengthNow * 100) / 100 });
    }
  }
  const hq = w.squad(pl.hqSquadId);
  const pltLeader = w.maybe(hq.leaderId);
  // Support: an idle squad goes round to help one that is stuck.
  if (pl.role === "attack" && !pl.withdrawing) {
    const stuck = pl.squadIds.map((id) => w.squad(id)).find((s) => (s.state === "fix" || (s.state === "flank" && w.tick - s.stateTick > 90)) && s.focus && w.tick - s.stateTick > 40);
    const idle = pl.squadIds.map((id) => w.squad(id)).find((s) => s !== stuck && (s.state === "advance" || s.state === "consolidate") && ableMen(w, s).length >= 4);
    if (stuck && idle && stuck.focus && idle.task !== "helping") {
      idle.focus = stuck.focus;
      idle.flankPoint = flankPoint(w, side, centroid(ableMen(w, idle)), stuck.focus, 18);
      if (idle.flankPoint) {
        idle.task = "helping";
        setState(w, idle, "flank", `sent by the platoon leader to take the pressure off ${stuck.name}`);
        w.emit("platoon_order", pltLeader ? [pltLeader.id] : [], { side, squad: idle.id, help: stuck.id, at: [stuck.focus.x, stuck.focus.y] });
        if (pltLeader) shout(w, pltLeader, side === "us" ? `${idle.name}, swing around and hit them from the flank!` : `${idle.name}, umfassen!`, null);
      }
    }
    for (const id of pl.squadIds) {
      const s = w.squad(id);
      if (s.task === "helping" && s.state !== "flank" && s.state !== "assault") s.task = "line";
    }
    pl.phase = pl.squadIds.some((id) => ["flank", "assault"].includes(w.squad(id).state)) ? "manoeuvring" : pl.squadIds.some((id) => ["fix", "react"].includes(w.squad(id).state)) ? "in contact" : "advancing";
  } else if (pl.role === "defend" && !pl.withdrawing) {
    pl.phase = pl.squadIds.some((id) => w.squad(id).state === "fall_back") ? "falling back" : pl.squadIds.some((id) => w.squad(id).orders.A.fire === "free") ? "engaged" : "waiting";
  }
  // Fire support: the radioman calls the mortars on the strongest known position.
  if (!pl.withdrawing && pl.fireMissionsLeft > 0 && pl.missions.every((m) => m.fired >= m.rounds + 1) && pltLeader && w.able(pltLeader)) {
    const radio = hq.members.map((id) => w.soldier(id)).find((s) => s.role === "radioman" && w.able(s));
    if (radio && cheb(radio, pltLeader) <= cfg.mortars.radioReach + 3) {
      const known = sideContacts(w, side, 25).filter((c) => c.identified || c.automatic);
      const target = clusters(known, 6).find((g) => (g.automatic || g.n >= 3) && !w.soldiers.some((s) => s.side === side && w.onField(s) && cheb(s, g.at) < cfg.mortars.dangerClose + 4));
      const sinceContact = Math.min(...pl.squadIds.map((id) => w.squad(id).firstContactTick ?? Infinity));
      if (target && w.tick - sinceContact >= 20) {
        pl.fireMissionsLeft--;
        const spot = w.tick + cfg.mortars.spotDelay;
        pl.missions.push({ id: w.nextId("mission"), side, target: target.at, spotTick: spot, effectTick: spot + cfg.mortars.effectDelay, rounds: cfg.mortars.rounds, fired: 0, calledBy: radio.id, kind: "mortar" });
        w.emit("fire_mission", [radio.id, pltLeader.id], { side, at: [target.at.x, target.at.y], by: radio.id, leader: pltLeader.id, left: pl.fireMissionsLeft });
        shout(w, radio, side === "us" ? `Fire mission! Enemy ${target.automatic ? "machine gun" : "infantry"} in the open, adjust fire, over!` : "Feuerauftrag! Granatwerfer, Feindstellung!", null);
        note(w, radio, "called in mortar fire");
      }
    }
  }
}

// ---------- Entry point ----------

/** Engine rule each tick: platoons think every ten seconds, squads every two. */
export function commandStep(w: World): void {
  if (w.phase !== "battle") return;
  for (const side of [w.attacker, enemyOf(w.attacker)] as const) {
    const pl = w.platoons[side];
    if (w.tick % 10 === (side === "us" ? 0 : 5)) platoonStep(w, pl);
    for (const id of [pl.hqSquadId, ...pl.squadIds]) {
      const sq = w.squad(id);
      if ((w.tick + sq.id) % 2 !== 0) continue;
      const leader = ensureLeader(w, sq);
      if (!leader) {
        if (sq.state !== "broken") {
          setState(w, sq, "broken", "no one left to lead; the men drift back");
          withdrawStep(w, sq, elements(w, sq));
        }
        continue;
      }
      if (w.tick < leader.confusedUntil) continue;
      if (sq.isHQ) hqStep(w, sq, pl, leader);
      else if (pl.role === "attack") attackStep(w, sq, pl, leader);
      else defendStep(w, sq, pl, leader);
    }
  }
}

export { isLeader, label };
