// Command: what each squad leader and platoon leader decides. Squads move in
// bounds from hedge to hedge, react to contact, then fix the enemy with their
// automatic weapon and send the rifle team round a flank to assault, as 1944
// doctrine taught both armies. Defenders hold their fire until the enemy is in
// the open, and fall back by bounds when flanked or badly hurt.
import { clusters, liveContacts, sideContacts, updateContact } from "../combat/perception.ts";
import { isLeader, label, note, shout, spotOf } from "../entities/soldier.ts";
import { incoming } from "../combat/ordnance.ts";
import { cheb, dist } from "../world/map.ts";
import type { Building } from "../world/layout.ts";
import { enemyOf, type Contact, type ElementOrder, type FirePolicy, type Pace, type Platoon, type Point, type Side, type Soldier, type Squad, type SquadState } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { boundsTo, canFireOn, centroid, facingFrom, flankPoint, pickPositions } from "./tactics.ts";

const RANK_ORDER = ["Leutnant", "Second Lieutenant", "Oberfeldwebel", "Technical Sergeant", "Feldwebel", "Staff Sergeant", "Unteroffizier", "Sergeant", "Obergefreiter", "Corporal", "Gefreiter", "Technician Fifth Grade", "Private First Class", "Oberschütze", "Private", "Schütze"];

export function ableMen(w: World, sq: Squad): Soldier[] {
  return sq.members.map((id) => w.soldier(id)).filter((s) => w.able(s));
}

function elementMen(w: World, sq: Squad, el: "A" | "B"): Soldier[] {
  const men = ableMen(w, sq);
  // The medic goes where the wounded are, and a sniper works on his own.
  const own = men.filter((s) => s.element === el && s.role !== "medic" && s.role !== "sniper");
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
  if (state !== "assault") sq.breach = null;
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
  // Each line squad has its own lane across the whole front, thirty-odd tiles from its neighbour's: they converge on the objective, not on one another.
  const lines = pl.squadIds.filter((id) => w.squad(id).task !== "reserve");
  const j = Math.max(0, lines.indexOf(sq.id));
  const offset = n <= 1 ? 0 : sq.task === "reserve" ? 0 : (j - (lines.length - 1) / 2) * w.config.forces.laneSpacing;
  const x = Math.max(8, Math.min(w.map.width - 9, Math.round(pl.objective.x + offset)));
  return w.freeTileNear({ x, y: pl.objective.y }, 8) ?? pl.objective;
}

/** Whether a point is near enough the defended hedge to be seen from it: from there on a squad moves by bounds. */
function nearTheLine(w: World, p: Point): boolean {
  const row = w.layout.line.rowAt[Math.max(0, Math.min(w.map.width - 1, Math.round(p.x)))] ?? w.layout.line.y;
  return Math.abs(p.y - row) < w.config.perception.maxRange + 8;
}

/**
 * Where a squad forming up far back marches to first: straight up its own
 * lane to just out of sight of the enemy's hedge, so the squads come into
 * view spread across the front rather than strung out together along the
 * easiest road. Null once it is already that close.
 */
function approachPoint(w: World, pos: Point): Point | null {
  if (nearTheLine(w, pos)) return null;
  const row = w.layout.line.rowAt[Math.max(0, Math.min(w.map.width - 1, pos.x))] ?? w.layout.line.y;
  const y = Math.round(row + Math.sign(pos.y - row) * (w.config.perception.maxRange + 20));
  return w.freeTileNear({ x: pos.x, y }, 6) ?? null;
}

/** The enemy position a squad is fighting: its strongest known cluster, nearest first among equals. */
function pickFocus(w: World, sq: Squad, at: Point): { at: Point; n: number; automatic: boolean; tank: boolean } | null {
  const live = liveContacts(w, sq, 40);
  if (live.length === 0) return null;
  const cs = clusters(live, 6).sort((a, b) => (b.automatic || b.sniper ? 1 : 0) - (a.automatic || a.sniper ? 1 : 0) || b.n - a.n || dist(a.at, at) - dist(b.at, at));
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
    else if (canFireOn(w, m, target)) out[m.id] = spotOf(m);
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
      pos[m.id] = p && cheb(p, m) <= 4 ? p : spotOf(m);
    }
    setOrder(w, sq, el, order(target ? "suppress" : "hold", pos, "crouch", fire, target));
  }
}

/**
 * Spreads a squad into a line abreast facing the enemy: every man to his own
 * spot a few paces from his neighbours, with a line of fire if the ground
 * gives one, and gets him there at a run. `shift` slides the whole line
 * sideways from `center`, so squads can be put either side of each other.
 */
function deployLine(w: World, sq: Squad, men: { A: Soldier[]; B: Soldier[] }, target: Point, center: Point, spacing = 3.5, shift = 0): void {
  const all = [...men.A, ...men.B];
  if (all.length === 0) return;
  const f = facingFrom(center, target);
  const px = -f.y, py = f.x;
  const sorted = [...all].sort((a, b) => (a.x - center.x) * px + (a.y - center.y) * py - ((b.x - center.x) * px + (b.y - center.y) * py) || a.id - b.id);
  const spot: Record<number, Point> = {};
  const used: Point[] = [];
  sorted.forEach((m, i) => {
    const off = (i - (sorted.length - 1) / 2) * spacing + shift;
    const base = { x: Math.round(center.x + px * off), y: Math.round(center.y + py * off) };
    let best: Point | null = null, bestScore = -Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const p = { x: base.x + dx, y: base.y + dy };
        if (!w.map.inBounds(p.x, p.y) || !w.map.passable(p.x, p.y)) continue;
        const t = w.map.at(p.x, p.y);
        if (t === "hedge" || t === "water" || t === "building") continue;
        if (!w.isFree(p.x, p.y, m.id, 0) || used.some((u) => cheb(u, p) < 2)) continue;
        let score = -Math.hypot(dx, dy) * 0.3 + w.map.cover(p, target, "crouch") * 0.8;
        if (canFireOn(w, p, target)) score += 1;
        if (t === "foxhole" || t === "ditch") score += 0.3;
        if (score > bestScore && w.map.reachable(m, p)) {
          bestScore = score;
          best = p;
        }
      }
    }
    const pick = best ?? w.freeTileNear(base, 4, m.id) ?? spotOf(m);
    used.push(pick);
    spot[m.id] = pick;
  });
  for (const el of ["A", "B"] as const) {
    const mine: Record<number, Point> = {};
    for (const m of men[el]) mine[m.id] = spot[m.id]!;
    setOrder(w, sq, el, order("suppress", mine, "rush", "free", target));
  }
}

/**
 * Contact is the platoon's business. When a squad is shot at, the others
 * within earshot hear the shouting and the guns: each is told where the enemy
 * is and takes its place in a line either side of the squad in contact, spread
 * out, rather than bunched on the road behind it.
 */
function platoonAlarm(w: World, pl: Platoon): void {
  const squads = pl.squadIds.map((id) => w.squad(id));
  const hit = squads.filter((s) => (s.state === "react" || s.state === "fix" || s.state === "flank" || s.state === "assault") && s.focus && w.tick - s.stateTick < 90);
  if (hit.length === 0) return;
  const lead = hit.reduce((a, s) => (s.stateTick < a.stateTick ? s : a), hit[0]!);
  const leadMen = ableMen(w, lead);
  if (leadMen.length === 0 || !lead.focus) return;
  const center = centroid(leadMen);
  const target = lead.focus;
  const side = (n: number) => (n % 2 === 0 ? -1 : 1) * Math.ceil((n + 1) / 2);
  let k = 0;
  for (const o of squads) {
    if (o === lead || (o.state !== "advance" && o.state !== "deploy" && o.state !== "support") || w.tick - o.stateTick < 30) continue;
    const men = elements(w, o);
    const all = [...men.A, ...men.B];
    if (all.length === 0 || dist(centroid(all), center) > 110) continue;
    // What the squad in contact knows, the others now know.
    let told = 0;
    for (const c of Object.values(lead.contacts)) {
      if (w.tick - c.tick > 12) continue;
      const e = w.maybe(c.id);
      if (!e || e.status !== "active") continue;
      updateContact(w, o, e, { x: c.x, y: c.y }, false);
      const nc = o.contacts[c.id];
      if (nc) {
        nc.identified = c.identified;
        nc.automatic = c.automatic;
        nc.sniper = c.sniper;
        nc.armour = c.armour;
      }
      told++;
    }
    if (told === 0) continue;
    const leader = w.maybe(o.leaderId);
    o.focus = target;
    const slot = side(k++);
    // A little way back from the squad in contact, then spread along the line.
    const back = facingFrom(center, target);
    const slotCenter = { x: Math.round(center.x - back.x * 4 + -back.y * slot * 26), y: Math.round(center.y - back.y * 4 + back.x * slot * 26) };
    const at = w.freeTileNear(slotCenter, 5) ?? slotCenter;
    deployLine(w, o, men, target, at);
    setState(w, o, "react", `${lead.name} is in contact: spreading out on the line and returning fire`);
    if (leader) shout(w, leader, leader.side === "us" ? "Spread out! On line, face front!" : "Auseinander! Schützenlinie!", "contact", 40);
  }
}

// ---------- Attackers ----------

/** Squads holding for the others to come up on line, and since when. */
const waitingByWorld = new WeakMap<World, Map<number, number>>();
function waitingSinceOf(w: World): Map<number, number> {
  let m = waitingByWorld.get(w);
  if (!m) waitingByWorld.set(w, (m = new Map()));
  return m;
}

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
      const lane = approachPoint(w, pos);
      sq.route = lane ? [...boundsTo(w, sq.side, pos, lane), ...boundsTo(w, sq.side, lane, objective)] : boundsTo(w, sq.side, pos, objective);
      sq.routeIdx = 0;
        sq.boundWp = -1;
      sq.bounding = "A";
      setState(w, sq, "advance", `advancing on ${w.layout.objectiveName}, hedge by hedge`);
      return;
    }
    case "advance": {
      const sniped = sq.sniperAlert && w.tick - sq.sniperAlert.tick < 20 ? sq.sniperAlert : null;
      if (sniped && !focus) {
        setState(w, sq, "react", "sniper! going to ground, trying to spot him");
        holdHere(w, sq, men, "free", { x: sniped.x, y: sniped.y });
        return;
      }
      if (focus && dist(pos, focus.at) <= 75) {
        setState(w, sq, "react", "contact! getting down and returning fire");
        shout(w, leader, leader.side === "us" ? (focus.automatic ? "MG! Get down!" : "Contact front!") : focus.automatic ? "MG! Deckung!" : "Feind voraus!", "contact", 40);
        // The drill: get down, spread out into a line, get into spots you can shoot from, return fire.
        deployLine(w, sq, men, focus.at, pos);
        return;
      }
      // Line abreast: a squad that has got well ahead of the others waits for them, rather than going on alone to be shot up.
      const peers = pl.squadIds.map((id) => w.squad(id)).filter((o) => o !== sq && ableMen(w, o).length >= 4 && (o.state === "advance" || o.state === "react" || o.state === "fix" || o.state === "flank" || o.state === "stage"));
      if (peers.length >= 1 && sq.task !== "reserve") {
        const forward = pl.rearY > pos.y ? -1 : 1;
        const theirs = peers.map((o) => forward * centroid(ableMen(w, o)).y).sort((a, b) => a - b);
        const median = theirs[Math.floor(theirs.length / 2)]!;
        if (forward * pos.y - median > 26) {
          const waiting = waitingSinceOf(w);
          const since = waiting.get(sq.id) ?? w.tick;
          waiting.set(sq.id, since);
          if (w.tick - since < 180) {
            holdHere(w, sq, men, "return", null);
            sq.intent = "holding to let the other squads come up on line";
            return;
          }
        } else waitingSinceOf(w).delete(sq.id);
      }
      advanceByBounds(w, sq, men, objective, toEnemy);
      return;
    }
    case "react": {
      if (w.tick - sq.stateTick < 6) return;
      // Still hunting an unseen sniper: stay down and keep fire on where he might be.
      const sniped = sq.sniperAlert && w.tick - sq.sniperAlert.tick < 35 ? sq.sniperAlert : null;
      if (!focus && sniped) {
        holdHere(w, sq, men, "free", { x: sniped.x, y: sniped.y });
        sq.intent = "pinned by a sniper they cannot see: searching for him, firing on likely spots";
        return;
      }
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
      const hardFix = (focus.automatic || focus.n >= 3) && pl.squadIds.some((id) => id !== sq.id && ableMen(w, w.squad(id)).length >= 4) && w.tick - sq.stateTick < 160;
      const tankFocus = (focus.tank && w.tick - sq.stateTick < 240) || (pl.plan !== null && pl.plan.base.includes(sq.id)) || hardFix;
      if (w.tick - sq.stateTick > 60 && (enemyQuiet || dist(pos, sq.focus) < 14) && strength(w, sq) > 0.4 && !tankFocus) {
        setState(w, sq, "assault", "their fire has slackened: up and at them");
        shout(w, leader, leader.side === "us" ? "Move! Move!" : "Vorwärts!", null);
      } else if (strength(w, sq) < 0.45 || avgMorale(all) < 0.28) {
        fallBack(w, sq, pos, leader);
      } else if (w.tick - sq.stateTick > 120 && men.B.length >= 3 && !tankFocus) {
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
      // Enemies in a house: stack up, grenades through the windows, then in.
      const house = houseHeld(w, sq, target);
      if (house !== null && breachStep(w, sq, men, house, leader)) return;
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
    case "stage": {
      // Waiting at the jump-off line; the platoon sends them in when the mortars are down.
      const j = pl.plan?.jump[sq.id];
      if (!pl.plan || !j) {
        setState(w, sq, "advance", "the attack was called off; pressing on");
        sq.route = boundsTo(w, sq.side, pos, objective);
        sq.routeIdx = 0;
        sq.boundWp = -1;
        return;
      }
      for (const el of ["A", "B"] as const) {
        if (sq.orders[el].kind === "move" && arrived(w, men[el], sq.orders[el], 3)) {
          const keep: Record<number, Point> = {};
          for (const m of men[el]) keep[m.id] = { x: m.x, y: m.y };
          setOrder(w, sq, el, order("suppress", keep, "crouch", "free", pl.plan.target));
        }
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

function decideOnContact(w: World, sq: Squad, men: { A: Soldier[]; B: Soldier[] }, focus: { at: Point; n: number; automatic: boolean; tank?: boolean }, pos: Point, leader: Soldier): void {
  const all = [...men.A, ...men.B];
  const d = dist(pos, focus.at);
  // A tank is not something riflemen assault: go to ground, and let the bazookas and the mortars deal with it.
  if (focus.tank && strength(w, sq) >= 0.45) {
    setState(w, sq, "fix", "a tank! going to ground; bazooka men forward and the mortars called");
    shout(w, leader, leader.side === "us" ? "Tank! Bazooka team up! Everyone down!" : "Panzer! Panzerschreck vor! Deckung!", "tank-warning", 60);
    return;
  }
  if (strength(w, sq) < 0.45 || avgMorale(all) < 0.3) {
    fallBack(w, sq, pos, leader);
    return;
  }
  const pl = w.platoons[sq.side];
  const others = pl.squadIds.map((id) => w.squad(id)).filter((o) => o !== sq && ableMen(w, o).length >= 4 && o.state !== "fall_back" && o.state !== "broken" && o.state !== "withdraw" && o.state !== "displace");
  const hardPos = focus.automatic || focus.n >= 3 || focus.tank === true;
  // A strong position is the whole platoon's job: pin it and let the platoon organise both flanks together.
  if (hardPos && others.length > 0 && d > 10 && (pl.stall === null || pl.stall.shifts < 4)) {
    setState(w, sq, "fix", `pinning ${focus.automatic ? "the machine gun" : "a strong position"}; the platoon will go round both flanks together`);
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
  const here = centroid(all);
  const danger = sq.firstContactTick !== null || dist(here, objective) < 95 || nearTheLine(w, here);
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
  // Just back from one retreat: dig in and trade fire rather than run again.
  if (w.tick - sq.fellBackTick < 150) {
    if (sq.state !== "fix") setState(w, sq, "fix", "too weak to press on: holding where they are and trading fire");
    if (sq.focus) holdHere(w, sq, elements(w, sq), "free", sq.focus);
    return;
  }
  sq.fellBackTick = w.tick;
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
      const close = live.some((c) => c.visible && dist(c, pos) <= 35);
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
          for (const m of men[el]) keep[m.id] = cur.positions[m.id] ?? spotOf(m);
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
          for (const m of men[el]) keep[m.id] = sq.orders[el].positions[m.id] ?? spotOf(m);
          setOrder(w, sq, el, order("hold", keep, "crouch", "free"));
        }
      });
      return;
    }
    case "withdraw":
      withdrawStep(w, sq, men);
      return;
    case "ambush": {
      ambushStep(w, sq, men, pos, leader);
      return;
    }
    case "reinforce": {
      const done = (arrived(w, men.A, sq.orders.A, 2) && arrived(w, men.B, sq.orders.B, 2)) || w.tick - sq.stateTick > 120;
      if (!done) return;
      const caller = sq.helping !== null ? w.squad(sq.helping) : null;
      setState(w, sq, "hold", caller ? `in position beside ${caller.name}, holding with them` : "in position, holding");
      for (const el of ["A", "B"] as const) {
        const keep: Record<number, Point> = {};
        for (const m of men[el]) keep[m.id] = spotOf(m);
        setOrder(w, sq, el, order("hold", keep, "crouch", "free"));
      }
      return;
    }
    default:
      setState(w, sq, "hold", "holding");
  }
}

// ---------- Ambush ----------

/**
 * Lying in wait, prone in the woods or scrub, every man holding his fire.
 * It springs all at once when an enemy it can see walks within close range,
 * or the moment it is found.
 */
function ambushStep(w: World, sq: Squad, men: { A: Soldier[]; B: Soldier[] }, pos: Point, leader: Soldier): void {
  const cfg = w.config.ambush;
  const all = [...men.A, ...men.B];
  const live = liveContacts(w, sq, 6);
  const close = live.filter((c) => c.visible && dist(c, pos) <= cfg.trigger);
  const found = all.some((m) => (m.underFire !== null && w.tick - m.underFire.tick < 3) || m.lastHitTick >= w.tick - 3);
  if (close.length === 0 && !found) {
    for (const el of ["A", "B"] as const) {
      const cur = sq.orders[el];
      if (cur.kind !== "hold" || cur.fire !== "hold") {
        const keep: Record<number, Point> = {};
        for (const m of men[el]) keep[m.id] = cur.positions[m.id] ?? spotOf(m);
        setOrder(w, sq, el, order("hold", keep, "crawl", "hold"));
      }
    }
    return;
  }
  setState(w, sq, "hold", found && close.length === 0 ? "the ambush is found: opening fire" : `ambush sprung: ${close.length > 1 ? `${close.length} of them` : "the enemy"} at ${Math.round(Math.min(...close.map((c) => dist(c, pos))) * 3)} m, every rifle opens up at once`);
  shout(w, leader, leader.side === "de" ? "Feuer!" : "Fire! Fire!", null);
  w.emit("ambush_sprung", [leader.id], { squad: sq.id, enemies: close.length, found });
  w.emit("open_fire", [leader.id], { squad: sq.id, ambush: true });
  for (const el of ["A", "B"] as const) {
    const keep: Record<number, Point> = {};
    for (const m of men[el]) keep[m.id] = sq.orders[el].positions[m.id] ?? spotOf(m);
    setOrder(w, sq, el, order("hold", keep, "crouch", "free"));
  }
  // Everyone fires now, together.
  for (const m of all) if (m.act && m.act.cand.kind !== "fire") m.act = null;
}

// ---------- Calling for help ----------

/**
 * A squad in trouble calls the platoon leader for help: an American squad
 * leader on his SCR-536 handie-talkie, at once; a German Gruppenführer by
 * sending a runner, which takes a while.
 */
function maybeCallForHelp(w: World, sq: Squad, pl: Platoon, leader: Soldier): void {
  const cfg = w.config.help;
  if (sq.isHQ || pl.withdrawing || ["withdraw", "broken", "ambush", "displace"].includes(sq.state)) return;
  if (sq.help && w.tick - sq.help.tick < cfg.again) return;
  const men = ableMen(w, sq).filter((m) => m.role !== "medic" && m.role !== "sniper");
  if (men.length === 0) return;
  const pos = centroid(men);
  const live = liveContacts(w, sq, 20);
  if (live.length === 0) return;
  const pinned = men.filter((m) => m.pinned || m.suppression > 0.5).length / men.length >= cfg.pinnedShare;
  const stuck = sq.state === "fix" && w.tick - sq.stateTick > cfg.stuckTicks;
  const weak = strength(w, sq) < cfg.weak && live.some((c) => dist(c, pos) < 40);
  const outnumbered = pl.role === "defend" && live.filter((c) => dist(c, pos) < 50).length > men.length * 1.2;
  if (!pinned && !stuck && !weak && !outnumbered) return;
  const radio = sq.side === "us";
  const why = pinned ? "pinned down" : weak ? "taking casualties" : outnumbered ? "outnumbered" : "stuck";
  // A radio call is heard at once; a runner is a man who has to get there, and the call is heard when he does.
  sq.help = { tick: w.tick, arrives: radio ? w.tick : Number.MAX_SAFE_INTEGER, by: radio ? "radio" : "runner", answered: false };
  if (!radio) {
    const boss = w.maybe(w.squad(pl.hqSquadId).leaderId);
    w.runners.push({ id: w.nextId("runner"), side: sq.side, squadId: sq.id, x: leader.x, y: leader.y, px: leader.x, py: leader.y, born: w.tick, dest: boss ? { x: boss.x, y: boss.y } : { x: pl.aidPost.x, y: pl.aidPost.y } });
  }
  w.emit("help_call", [leader.id], { squad: sq.id, by: sq.help.by, why, at: [pos.x, pos.y] });
  shout(w, leader, radio ? `${sq.name} to Six: we're ${why}, need support, over!` : "Melder! Zum Zugführer: wir brauchen Verstärkung!", null);
  note(w, leader, `${radio ? "radioed" : "sent a runner"} for help`);
}

/** Runners cross the ground to the platoon leader; the call is heard when one arrives, or is given up on. */
function runnersStep(w: World, pl: Platoon, boss: Soldier | undefined | null): void {
  const cfg = w.config.help;
  if (w.runners.length === 0) return;
  const keep = [];
  for (const r of w.runners) {
    if (r.side !== pl.side) {
      keep.push(r);
      continue;
    }
    const sq = w.squad(r.squadId);
    const goal: Point = boss && w.able(boss) ? { x: boss.x, y: boss.y } : r.dest;
    r.px = r.x;
    r.py = r.y;
    const d = dist(r, goal);
    if (d > 1.5 && w.tick - r.born < cfg.runnerGiveUp) {
      const step = Math.min(cfg.runnerSpeed, d - 1);
      r.x += ((goal.x - r.x) / d) * step;
      r.y += ((goal.y - r.y) / d) * step;
      keep.push(r);
      continue;
    }
    // He has arrived (or the trip has taken too long): the call is heard now.
    if (sq.help && !sq.help.answered) sq.help.arrives = w.tick;
    w.emit("runner_arrives", boss ? [boss.id] : [], { squad: sq.id, at: [Math.round(r.x), Math.round(r.y)] });
  }
  w.runners = keep;
}

/** The platoon leader answers: the best free squad goes, or else the mortars are told where. */
function answerCalls(w: World, pl: Platoon): void {
  const pltLeader = w.maybe(w.squad(pl.hqSquadId).leaderId);
  runnersStep(w, pl, pltLeader);
  for (const caller of pl.squadIds.map((id) => w.squad(id))) {
    const call = caller.help;
    if (!call || call.answered || call.arrives > w.tick) continue;
    call.answered = true;
    const cmen = ableMen(w, caller);
    if (cmen.length === 0) continue;
    const cpos = centroid(cmen);
    const free = pl.squadIds
      .map((id) => w.squad(id))
      .filter((s) => s !== caller && s.helping === null && ["advance", "consolidate", "hold", "support", "deploy", "react"].includes(s.state) && ableMen(w, s).length >= 4)
      .filter((s) => !ableMen(w, s).some((m) => m.underFire !== null && w.tick - m.underFire.tick < 15))
      .sort((a, b) => dist(centroid(ableMen(w, a)), cpos) - dist(centroid(ableMen(w, b)), cpos) || a.id - b.id);
    const sent = free[0];
    if (sent && pl.role === "attack" && caller.focus) {
      sent.focus = caller.focus;
      sent.flankPoint = flankPoint(w, pl.side, centroid(ableMen(w, sent)), caller.focus, 18);
      if (sent.flankPoint) {
        sent.task = "helping";
        sent.helping = caller.id;
        setState(w, sent, "flank", `answering ${caller.name}'s call: swinging round to hit them from the flank`);
      }
    } else if (sent && pl.role === "defend") {
      const threat = caller.focus ?? { x: cpos.x, y: cpos.y + (w.platoons[pl.side].rearY === 0 ? 20 : -20) };
      const face = facingFrom(cpos, threat);
      // Up beside them, not on top of them: off to the side nearer this squad.
      const spos = centroid(ableMen(w, sent));
      const side = (spos.x - cpos.x) * -face.y + (spos.y - cpos.y) * face.x >= 0 ? 1 : -1;
      const to = w.freeTileNear({ x: Math.round(cpos.x - face.y * 7 * side), y: Math.round(cpos.y + face.x * 7 * side) }, 6) ?? cpos;
      sent.helping = caller.id;
      sent.fallback = caller.fallback ?? sent.fallback;
      setState(w, sent, "reinforce", `answering ${caller.name}'s call: moving up to bolster them`);
      const els = elements(w, sent);
      for (const el of ["A", "B"] as const) if (els[el].length > 0) setOrder(w, sent, el, order("move", pickPositions(w, els[el], to, face, 2, 6, threat), "rush", "return", to));
    }
    if (sent && sent.helping === caller.id) {
      w.emit("help_sent", pltLeader ? [pltLeader.id] : [], { squad: sent.id, to: caller.id, side: pl.side });
      if (pltLeader && w.able(pltLeader)) shout(w, pltLeader, pl.side === "us" ? `Roger, ${caller.name}. Sending ${sent.name} your way, out.` : `${sent.name}: ${caller.name} unterstützen!`, null);
    } else {
      // Nobody free: the mortars, if there is something seen to shoot at.
      pl.priority = caller.focus;
      w.emit("help_sent", pltLeader ? [pltLeader.id] : [], { squad: null, to: caller.id, side: pl.side, mortars: pl.fireMissionsLeft > 0 });
    }
  }
  // Helpers go back to their own war once the trouble is over.
  for (const id of pl.squadIds) {
    const s = w.squad(id);
    if (s.helping === null) continue;
    const c = w.squad(s.helping);
    if (ableMen(w, c).length === 0 || (c.help && w.tick - c.help.tick > 240) || ["consolidate", "withdraw", "broken"].includes(c.state)) s.helping = null;
  }
}

// ---------- Clearing a house ----------

/** The house near the target where the squad knows enemies are inside, if any. */
function houseHeld(w: World, sq: Squad, target: Point): number | null {
  const cfg = w.config.breach;
  if (sq.breach) return sq.breach.house;
  const count = new Map<number, number>();
  for (const c of liveContacts(w, sq, 25)) {
    const b = w.map.building[w.map.idx(c.x, c.y)]!;
    if (b < 0 || !w.map.indoors(c.x, c.y, c.z) || cheb(c, target) > cfg.within) continue;
    count.set(b, (count.get(b) ?? 0) + 1);
  }
  let best: number | null = null, n = 0;
  for (const [b, k] of count) if (k > n || (k === n && best !== null && b < best)) [best, n] = [b, k];
  return best;
}

/** A house's doors, windows and breaches: the tile outside each, and the room tile inside. */
function openings(w: World, b: Building): { at: Point; out: Point; inside: Point; door: boolean }[] {
  const out: { at: Point; out: Point; inside: Point; door: boolean }[] = [];
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      if (!(x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1)) continue;
      const t = w.map.at(x, y);
      if (t !== "window" && t !== "door" && t !== "rubble") continue;
      let o: Point | null = null, i: Point | null = null;
      for (const p of w.map.neighbors4(x, y)) {
        const inB = w.map.building[w.map.idx(p.x, p.y)] === b.id;
        if (inB && w.map.passable(p.x, p.y)) i = p;
        else if (!inB && w.map.passable(p.x, p.y)) o = p;
      }
      if (o && i) out.push({ at: { x, y }, out: o, inside: i, door: t !== "window" });
    }
  }
  return out;
}

/**
 * The drill for a house with the enemy inside. The base of fire keeps the
 * windows busy while the assault team runs up and flattens itself against
 * the walls beside the doors and windows; on the word, every man posts a
 * grenade through the nearest opening, upstairs ones too; as they burst the
 * team goes in through the doors and breaches, room by room and up the stairs.
 * Returns true while it is running.
 */
function breachStep(w: World, sq: Squad, men: { A: Soldier[]; B: Soldier[] }, house: number, leader: Soldier): boolean {
  const cfg = w.config.breach;
  const b = w.buildings[house]!;
  const inside = liveContacts(w, sq, 25).filter((c) => w.map.building[w.map.idx(c.x, c.y)] === house && w.map.indoors(c.x, c.y, c.z));
  const toHouse = (m: Point) => Math.max(b.x - m.x, 0, m.x - (b.x + b.w - 1), b.y - m.y, 0, m.y - (b.y + b.h - 1));
  if (!sq.breach || sq.breach.house !== house) {
    if (inside.length === 0) return false;
    // Not from out in the fields: close in on the house first.
    const close = (men.B.length > 0 ? men.B : men.A).filter((m) => toHouse(m) <= 12).length;
    if (close < Math.ceil((men.B.length > 0 ? men.B : men.A).length / 2)) return false;
    sq.breach = { house, stage: "stack", tick: w.tick };
    w.emit("breach", [leader.id], { squad: sq.id, house, stage: "stack" });
    shout(w, leader, leader.side === "us" ? `They're in ${b.name}! Stack up on the walls, grenades ready!` : "Ans Haus! Handgranaten fertig!", null);
  }
  const br = sq.breach;
  if (inside.length === 0) {
    if (br.stage === "enter") {
      sq.breach = null;
      return false;
    }
  }
  if (w.tick - br.tick > cfg.giveUp) {
    sq.breach = null;
    setState(w, sq, "fix", `could not get into ${b.name}; back to trading fire`);
    return true;
  }
  const el: "A" | "B" = men.B.length > 0 ? "B" : "A";
  const team = men[el];
  const support = el === "B" && men.A.length > 0;
  const holes = openings(w, b);
  if (holes.length === 0 || team.length === 0) {
    sq.breach = null;
    return false;
  }
  const tc = centroid(team);
  holes.sort((a, c) => dist(a.out, tc) - dist(c.out, tc) || a.at.y - c.at.y || a.at.x - c.at.x);
  const upstairs = inside.reduce((z, c) => Math.max(z, c.z), 0);
  if (br.stage === "stack") {
    if (support) {
      const win = holes.find((h) => !h.door) ?? holes[0]!;
      const aim = upstairs > 0 ? { x: win.inside.x, y: win.inside.y, z: upstairs } : win.inside;
      setOrder(w, sq, "A", order("suppress", firingLine(w, men.A, sq.orders.A.positions, aim), "crouch", "free", aim));
    }
    // Against the wall by the openings nearest them, one man to a spot.
    const spots: Point[] = [];
    for (const h of holes) if (!spots.some((p) => p.x === h.out.x && p.y === h.out.y)) spots.push(h.out);
    const positions: Record<number, Point> = {};
    const taken: Point[] = [];
    for (const m of [...team].sort((a, c) => a.id - c.id)) {
      const free = spots.filter((p) => !taken.some((t) => t.x === p.x && t.y === p.y));
      const pick = free.sort((a, c) => dist(a, m) - dist(c, m) || a.x - c.x)[0] ?? w.freeTileNear(spots[0]!, 3, m.id) ?? spotOf(m);
      taken.push(pick);
      positions[m.id] = pick;
    }
    const marker = { x: b.x, y: b.y };
    if (sq.orders[el].kind !== "move" || sq.orders[el].target?.x !== marker.x || sq.orders[el].target?.y !== marker.y) setOrder(w, sq, el, order("move", positions, "rush", "return", marker));
    sq.intent = `stacking up on ${b.name} for a grenade assault`;
    const atWall = team.filter((m) => toHouse(m) <= 1).length;
    if (atWall === 0 && w.tick - br.tick > cfg.stackTicks * 2) {
      // They never got to the walls.
      sq.breach = null;
      return false;
    }
    if (atWall > 0 && (arrived(w, team, sq.orders[el], 1.5) || w.tick - br.tick > cfg.stackTicks)) {
      br.stage = "grenades";
      br.tick = w.tick;
      w.emit("breach", [leader.id], { squad: sq.id, house, stage: "grenades" });
      shout(w, leader, leader.side === "us" ? "Frag out! Through the windows!" : "Handgranaten — los!", null);
      for (const m of team) if (m.act && m.act.cand.kind !== "grenade") m.act = null;
    }
    return true;
  }
  if (br.stage === "grenades") {
    sq.intent = `grenades through the windows of ${b.name}`;
    if (w.tick - br.tick >= cfg.grenadeTicks) {
      br.stage = "enter";
      br.tick = w.tick;
      w.emit("breach", [leader.id], { squad: sq.id, house, stage: "enter" });
      shout(w, leader, leader.side === "us" ? "Go! Go! Clear it!" : "Rein! Rein!", null);
    }
    return true;
  }
  // In, room by room and up the stairs, to every man of theirs they know of in there.
  const targets = inside.length > 0 ? inside.map((c) => (c.z > 0 ? { x: c.x, y: c.y, z: c.z } : { x: c.x, y: c.y })) : [holes[0]!.inside];
  const positions: Record<number, Point> = {};
  [...team].sort((a, c) => a.id - c.id).forEach((m, k) => (positions[m.id] = targets[k % targets.length]!));
  setOrder(w, sq, el, order("assault", positions, "rush", "free", targets[0]!));
  if (support && sq.orders.A.kind === "suppress") {
    const keep: Record<number, Point> = {};
    for (const m of men.A) keep[m.id] = spotOf(m);
    setOrder(w, sq, "A", order("overwatch", keep, "crouch", "free"));
  }
  sq.intent = `clearing ${b.name} room by room`;
  return true;
}

// ---------- Platoon headquarters ----------

function hqStep(w: World, sq: Squad, pl: Platoon, leader: Soldier): void {
  const men = ableMen(w, sq).filter((s) => s.role !== "medic" && s.role !== "sniper" && !(s.role === "platoon_sergeant" && s.carryingId !== null));
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

/**
 * A platoon that has made no ground for a long while, under fire, has been
 * trying the wrong way. Mark the road it has been using as dear, keep one
 * squad on the position as a base of fire and send the others the long way
 * round, either side, wider each time it fails.
 */
function stallCheck(w: World, pl: Platoon, leader: Soldier | undefined): void {
  const squads = pl.squadIds.map((id) => w.squad(id)).filter((s) => ableMen(w, s).length >= 3 && s.state !== "withdraw" && s.state !== "broken");
  if (squads.length < 2) return;
  const cents = squads.map((s) => centroid(ableMen(w, s)));
  const lead = Math.min(...cents.map((c) => dist(c, pl.objective)));
  const st = (pl.stall ??= { best: lead, tick: w.tick, shifts: 0 });
  if (lead < st.best - 10) {
    st.best = lead;
    st.tick = w.tick;
    return;
  }
  const inContact = squads.some((s) => s.firstContactTick !== null && (s.state === "react" || s.state === "fix" || s.state === "advance" || s.state === "flank"));
  if (w.tick - st.tick < 240 || w.tick < 360 || !inContact || pl.plan) return;
  st.tick = w.tick;
  st.shifts++;
  const from = centroid(cents);
  const focused = squads.filter((s) => s.focus);
  const F = focused.length > 0 ? centroid(focused.map((s) => s.focus!)) : pl.objective;
  const dir = facingFrom(from, F);
  const perp = { x: -dir.y, y: dir.x };
  // The road that has been costing men is dear now.
  for (let k = 0; k <= 6; k++) w.addPain(pl.side, from.x + ((F.x - from.x) * k) / 6, from.y + ((F.y - from.y) * k) / 6, 2.5, 10);
  const order = squads.map((s, i) => ({ s, c: cents[i]! })).sort((a, b) => dist(a.c, F) - dist(b.c, F));
  const base = order[0]!.s;
  base.focus = F;
  if (base.state !== "fix") setState(w, base, "fix", "keeping the position pinned while the others go round");
  const named: string[] = [];
  order.slice(1).forEach(({ s, c }, i) => {
    let side = (i + st.shifts) % 2 === 0 ? -1 : 1;
    const reach = 46 + 14 * Math.floor(i / 2) + 12 * (st.shifts - 1);
    let spot: Point | null = null;
    for (const sd of [side, -side]) {
      const want = { x: Math.round(F.x + perp.x * sd * reach - dir.x * 8), y: Math.round(F.y + perp.y * sd * reach - dir.y * 8) };
      const p = w.freeTileNear({ x: Math.max(2, Math.min(w.map.width - 3, want.x)), y: Math.max(2, Math.min(w.map.height - 3, want.y)) }, 10);
      if (p && w.map.reachable(c, p)) {
        spot = p;
        side = sd;
        break;
      }
    }
    if (!spot) return;
    s.route = [...boundsTo(w, s.side, c, spot), ...boundsTo(w, s.side, spot, pl.objective)];
    s.routeIdx = 0;
    s.boundWp = -1;
    s.bounding = "A";
    s.flankPoint = null;
    s.focus = null;
    for (const key of Object.keys(s.contacts)) if (cheb(s.contacts[Number(key)]!, F) <= 12) delete s.contacts[Number(key)];
    setState(w, s, "advance", `the direct way has failed: swinging wide ${side < 0 ? "left" : "right"} of ${base.name}`);
    named.push(s.name);
  });
  w.emit("axis_shift", leader ? [leader.id] : [], { side: pl.side, at: [F.x, F.y], base: base.id, squads: order.slice(1).map((o) => o.s.id), n: st.shifts });
  if (leader && named.length > 0) shout(w, leader, leader.side === "us" ? `${named.join(" and ")}, go round wide! ${base.name}, keep their heads down!` : `${named.join(" und ")}, weit umfassen! ${base.name}, Feuerschutz!`, null);
}

/**
 * Set-piece attack on a position that has held: the squads in contact keep it
 * pinned with every automatic weapon, the rest go round both flanks, wide, to
 * jump-off lines either side, the radioman puts mortars on it, and when the
 * bombs are falling both flanks go in together behind the smoke and the
 * shifted fire. One flank never goes in alone.
 */
function coordinate(w: World, pl: Platoon, leader: Soldier | undefined): void {
  const cfg = w.config;
  const plan = pl.plan;
  const squads = pl.squadIds.map((id) => w.squad(id));
  const hq = w.squad(pl.hqSquadId);
  if (plan) {
    const assaulters = plan.assault.map((id) => w.squad(id));
    const live = assaulters.filter((s) => ableMen(w, s).length >= 3 && s.state !== "fall_back" && s.state !== "broken" && s.state !== "withdraw");
    const quiet = !sideContacts(w, pl.side, 40).some((c) => cheb(c, plan.target) <= 10);
    if (live.length === 0 || w.tick - plan.start > 320 || (quiet && w.tick - plan.start > 30)) {
      for (const s of assaulters) if (s.state === "stage") setState(w, s, "advance", "the attack is over; pressing on");
      pl.plan = null;
      pl.planTick = w.tick;
      return;
    }
    // Every squad in contact within reach of it keeps the position under fire.
    for (const b of squads) {
      if (plan.assault.includes(b.id) || b.state === "fall_back" || b.state === "broken" || b.state === "withdraw") continue;
      const bm = ableMen(w, b);
      if (bm.length === 0) continue;
      const near = dist(centroid(bm), plan.target) <= 95;
      if (plan.base.includes(b.id) || (near && (b.state === "fix" || b.state === "react"))) {
        if (!plan.base.includes(b.id)) plan.base.push(b.id);
        b.focus = plan.target;
        if (w.tick % 10 === 0) holdHere(w, b, elements(w, b), "free", plan.target);
        if (b.state !== "fix" && b.state !== "react" && b.state !== "assault" && b.state !== "flank") setState(w, b, "fix", "keeping the position pinned for the attack");
      }
    }
    if (plan.stage === "prep") {
      const m = pl.missions.find((x) => x.id === plan.mission);
      const placed = live.every((s) => {
        const men = elements(w, s);
        const j = plan.jump[s.id]!;
        return dist(centroid([...men.A, ...men.B]), j) <= 10;
      });
      const bombsFalling = !m || w.tick >= m.effectTick - 3;
      // Both flanks together: wait for the slowest, up to a point.
      if ((placed || w.tick - plan.start > 170) && bombsFalling) {
        // Smoke shells go down between each assault and the position, landing just as they step off.
        if (plan.smokeTick < 0) {
          plan.smokeTick = w.tick;
          const aims = live.slice(0, 2).map((s) => {
            const c = centroid(ableMen(w, s));
            return { x: Math.round(c.x + (plan.target.x - c.x) * 0.45), y: Math.round(c.y + (plan.target.y - c.y) * 0.45) };
          });
          pl.smokeAt = -1000;
          if (smokeMission(w, pl, aims, "between the assault and the position")) return;
        }
        if (w.tick - plan.smokeTick < 6) return;
        plan.stage = "go";
        plan.goTick = w.tick;
        for (const s of live) {
          s.focus = plan.target;
          setState(w, s, "assault", "up and in together with the other flank, behind the mortars and the smoke");
        }
        const l = w.maybe(w.squad(live[0]!.id).leaderId);
        if (l) shout(w, l, l.side === "us" ? "Mortars are on them! Smoke out, then GO! Both flanks, GO!" : "Granaten liegen! Nebel, dann Marsch, marsch! Beide Flügel!", null);
        w.emit("coordinated_attack", leader ? [leader.id] : [], { side: pl.side, at: [plan.target.x, plan.target.y], stage: "go", squads: live.map((s) => s.id), mortars: m !== undefined });
      }
    } else if (plan.stage === "go" && w.tick - plan.goTick > 12 && !live.some((s) => s.state === "assault" || s.state === "flank")) {
      pl.plan = null;
      pl.planTick = w.tick;
    }
    return;
  }
  if (w.tick - pl.planTick < 120 || w.tick < 200 || !leader || !w.able(leader)) return;
  const fixing = squads.filter((s) => s.state === "fix" && s.focus && w.tick - s.stateTick >= 12).sort((a, b) => a.stateTick - b.stateTick)[0];
  if (!fixing || !fixing.focus) return;
  const F = fixing.focus;
  const near = sideContacts(w, pl.side, 40).filter((c) => cheb(c, F) <= 8);
  const painHere = w.pain[pl.side][w.map.idx(Math.max(0, Math.min(w.map.width - 1, F.x)), Math.max(0, Math.min(w.map.height - 1, F.y)))] ?? 0;
  const hard = near.some((c) => c.automatic || c.sniper || c.armour) || near.length >= 2 || w.tick - fixing.stateTick >= 40 || (pl.stall?.shifts ?? 0) >= 1 || painHere > 0.5;
  if (!hard) return;
  const free = squads
    .filter((s) => s !== fixing && ableMen(w, s).length >= 4 && ["advance", "react", "fix", "flank", "deploy", "support"].includes(s.state) && s.task !== "helping")
    .sort((a, b) => dist(centroid(ableMen(w, a)), F) - dist(centroid(ableMen(w, b)), F))
    .slice(0, 3);
  if (free.length === 0) return;
  // Jump-off lines either side of the position, wide of it and short of it, alternating left and right.
  const from = centroid(ableMen(w, fixing));
  const dir = facingFrom(from, F);
  const perp = { x: -dir.y, y: dir.x };
  const jump: Record<number, Point> = {};
  free.forEach((s, i) => {
    const c = centroid(ableMen(w, s));
    const reach = 34 + 12 * Math.floor(i / 2);
    let side = i % 2 === 0 ? -1 : 1;
    // Start with the side the squad is already on.
    const lat = (c.x - F.x) * perp.x + (c.y - F.y) * perp.y;
    if (free.length === 1 || Math.abs(lat) > 12) side = lat < 0 ? -1 : 1;
    let spot: Point | null = null;
    for (const sd of [side, -side]) {
      const want = { x: Math.round(F.x + perp.x * sd * reach - dir.x * 18), y: Math.round(F.y + perp.y * sd * reach - dir.y * 18) };
      const p = w.freeTileNear({ x: Math.max(2, Math.min(w.map.width - 3, want.x)), y: Math.max(2, Math.min(w.map.height - 3, want.y)) }, 8);
      if (p && w.map.reachable(c, p)) {
        spot = p;
        break;
      }
    }
    jump[s.id] = spot ?? flankPoint(w, s.side, c, F, 16 + i * 6) ?? w.freeTileNear({ x: Math.round(F.x + (c.x - F.x) * 0.5), y: Math.round(F.y + (c.y - F.y) * 0.5) }, 6) ?? c;
  });
  // The radioman calls the mortars on it, timed to the attack.
  let mission: number | null = null;
  const radio = hq.members.map((id) => w.soldier(id)).find((m) => m.role === "radioman" && w.able(m));
  if (pl.fireMissionsLeft > 0 && pl.missions.every((m) => m.fired >= m.rounds + 1) && radio && cheb(radio, leader) <= cfg.mortars.radioReach + 3 && !w.soldiers.some((s) => s.side === pl.side && w.onField(s) && cheb(s, F) < cfg.mortars.dangerClose + 4)) {
    pl.fireMissionsLeft--;
    const spot = w.tick + cfg.mortars.spotDelay;
    const id = w.nextId("mission");
    pl.missions.push({ id, side: pl.side, target: F, spotTick: spot, effectTick: spot + cfg.mortars.effectDelay, rounds: cfg.mortars.rounds, fired: 0, calledBy: radio.id, kind: "mortar", msg: null });
    mission = id;
    w.emit("fire_mission", [radio.id, leader.id], { side: pl.side, at: [F.x, F.y], by: radio.id, leader: leader.id, left: pl.fireMissionsLeft });
    shout(w, radio, pl.side === "us" ? "Fire mission! Enemy position, mortars to cover our assault, over!" : "Feuerauftrag! Granatwerfer auf die Stellung, wir greifen an!", null);
    note(w, radio, "called in mortar fire for the attack");
  }
  pl.plan = { target: F, start: w.tick, stage: "prep", base: [fixing.id], assault: free.map((s) => s.id), jump, mission, goTick: -1, smokeTick: -1 };
  for (const s of free) {
    const men = elements(w, s);
    const j = jump[s.id]!;
    const face = facingFrom(j, F);
    setState(w, s, "stage", `working round to the jump-off line while ${fixing.name} keeps them pinned${mission !== null ? " and the mortars come down" : ""}`);
    s.focus = F;
    for (const el of ["A", "B"] as const) setOrder(w, s, el, order("move", pickPositions(w, men[el], j, face, 3, 7, F), "crouch", "return"));
  }
  w.emit("coordinated_attack", [leader.id], { side: pl.side, at: [F.x, F.y], stage: "prep", base: fixing.id, squads: free.map((s) => s.id), mortars: mission !== null });
  shout(w, leader, pl.side === "us" ? `${fixing.name}, keep them pinned. ${free.map((s) => s.name).join(" and ")}, get to the jump-off; we go in on the mortars.` : `${fixing.name}, Feuer halten. ${free.map((s) => s.name).join(" und ")}, Bereitstellung; wir greifen nach den Granaten an.`, null);
}

/**
 * A smoke mission: the radioman has the mortars put two or three smoke bombs
 * on the aim points. It costs one of the platoon's missions. Returns whether
 * it was called.
 */
function smokeMission(w: World, pl: Platoon, aims: readonly Point[], why: string): boolean {
  if (pl.fireMissionsLeft <= 0 || aims.length === 0 || w.tick - pl.smokeAt < 90) return false;
  const hq = w.squad(pl.hqSquadId);
  const leader = w.maybe(hq.leaderId);
  const radio = hq.members.map((id) => w.soldier(id)).find((m) => m.role === "radioman" && w.able(m));
  if (!radio || !leader || !w.able(leader) || cheb(radio, leader) > w.config.mortars.radioReach + 3) return false;
  pl.fireMissionsLeft--;
  pl.smokeAt = w.tick;
  for (const a of aims.slice(0, 3)) incoming(w, "smoke_shell", pl.side, a, 3, radio.id);
  shout(w, radio, pl.side === "us" ? `Smoke mission, ${why}! Shot, over!` : "Nebel! Rauch auf die Linie!", null);
  note(w, radio, `called smoke ${why}`);
  w.emit("smoke_mission", [radio.id], { side: pl.side, at: aims.slice(0, 3).map((a) => [a.x, a.y]), why });
  return true;
}

/**
 * Both sides use the mortars to blind the enemy: a squad falling back is
 * covered by smoke between it and its pursuers, and squads pinned in the open
 * get a screen between them and the guns that have them.
 */
function screenStep(w: World, pl: Platoon): void {
  if (pl.fireMissionsLeft <= 0 || w.tick - pl.smokeAt < 150 || w.tick % 5 !== 0) return;
  const squads = pl.squadIds.map((id) => w.squad(id));
  const known = sideContacts(w, pl.side, 15).filter((c) => c.identified);
  if (known.length === 0) return;
  const nearestEnemy = (p: Point) => known.reduce<Contact | null>((best, c) => (best === null || dist(c, p) < dist(best, p) ? c : best), null);
  for (const s of squads) {
    const men = ableMen(w, s);
    if (men.length < 3) continue;
    const c = centroid(men);
    const e = nearestEnemy(c);
    if (!e) continue;
    const d = dist(c, e);
    if (d > 70 || d < 10) continue;
    const pinned = men.filter((m) => m.pinned || m.suppression > 0.5).length;
    const falling = s.state === "fall_back" || s.state === "displace";
    const stuck = (s.state === "fix" || s.state === "react") && pinned >= Math.max(3, Math.ceil(men.length * 0.4));
    if (!falling && !stuck) continue;
    // Between the men and what is shooting at them: nearer the enemy, where the smoke will cut the line.
    const t = falling ? 0.4 : 0.3;
    const mid = { x: Math.round(e.x + (c.x - e.x) * t), y: Math.round(e.y + (c.y - e.y) * t) };
    const side = { x: Math.round(-(e.y - c.y) / (d || 1) * 7), y: Math.round((e.x - c.x) / (d || 1) * 7) };
    if (smokeMission(w, pl, [mid, { x: mid.x + side.x, y: mid.y + side.y }, { x: mid.x - side.x, y: mid.y - side.y }], falling ? "to cover the withdrawal" : "to break up their aim")) return;
  }
}

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
  if (!pl.withdrawing) answerCalls(w, pl);
  if (!pl.withdrawing || pl.role === "defend") screenStep(w, pl);
  if (pl.role === "attack" && !pl.withdrawing) {
    platoonAlarm(w, pl);
    stallCheck(w, pl, pltLeader ?? undefined);
    coordinate(w, pl, pltLeader ?? undefined);
  }
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
      if (s.task === "helping" && s.state !== "flank" && s.state !== "assault") {
        s.task = "line";
        s.helping = null;
      }
    }
    pl.phase = pl.squadIds.some((id) => ["flank", "assault"].includes(w.squad(id).state)) ? "manoeuvring" : pl.squadIds.some((id) => ["fix", "react"].includes(w.squad(id).state)) ? "in contact" : "advancing";
  } else if (pl.role === "defend" && !pl.withdrawing) {
    pl.phase = pl.squadIds.some((id) => w.squad(id).state === "fall_back") ? "falling back" : pl.squadIds.some((id) => w.squad(id).orders.A.fire === "free") ? "engaged" : "waiting";
  }
  // What a forward team has found goes straight to the mortars, before the platoon is in contact.
  if (pl.reports.length > 0) {
    pl.reports = pl.reports.filter((r) => w.tick - r.tick < 240);
    const radio = hq.members.map((id) => w.soldier(id)).find((s) => s.role === "radioman" && w.able(s));
    if (!pl.withdrawing && pl.fireMissionsLeft > 0 && pl.missions.every((m) => m.fired >= m.rounds + 1) && radio && pltLeader && w.able(pltLeader) && cheb(radio, pltLeader) <= cfg.mortars.radioReach + 3) {
      const r = pl.reports.find((x) => !w.soldiers.some((s) => s.side === side && w.onField(s) && cheb(s, x.at) < cfg.mortars.dangerClose + 4));
      if (r) {
        pl.reports = pl.reports.filter((x) => x !== r);
        pl.fireMissionsLeft--;
        pl.shelled.push({ at: r.at, tick: w.tick });
        const spot = w.tick + cfg.mortars.spotDelay;
        pl.missions.push({ id: w.nextId("mission"), side, target: r.at, spotTick: spot, effectTick: spot + cfg.mortars.effectDelay, rounds: cfg.mortars.rounds, fired: 0, calledBy: radio.id, kind: "mortar", msg: r.msg });
        w.emit("fire_mission", [radio.id, pltLeader.id], { side, at: [r.at.x, r.at.y], by: radio.id, leader: pltLeader.id, left: pl.fireMissionsLeft, msg: r.msg, from: [radio.x, radio.y], reported: r.kind });
        shout(w, radio, side === "us" ? `Fire mission! Recon reports ${r.kind === "machine_gun" ? "a machine gun" : r.kind === "tank" ? "a tank" : "a sniper"}, mortars on it, over!` : "Feuerauftrag! Aufklärer melden Feind, Granatwerfer!", null);
        note(w, radio, "called in mortar fire on a forward team's report");
      }
    }
  }
  // Fire support: the radioman calls the mortars on the strongest known position.
  if (!pl.withdrawing && pl.fireMissionsLeft > 0 && pl.missions.every((m) => m.fired >= m.rounds + 1) && pltLeader && w.able(pltLeader)) {
    const radio = hq.members.map((id) => w.soldier(id)).find((s) => s.role === "radioman" && w.able(s));
    if (radio && cheb(radio, pltLeader) <= cfg.mortars.radioReach + 3) {
      // Only on what has been seen: a gun heard but never spotted is not a map reference.
      const known = sideContacts(w, side, 25).filter((c) => c.identified);
      // A squad that called for help and got nobody sent has its trouble seen to first.
      const prio = pl.priority;
      const groups = clusters(known, 6).sort((a, b) => (prio ? dist(a.at, prio) - dist(b.at, prio) : 0));
      const target = groups.find((g) => (g.tank || g.automatic || g.sniper || g.n >= 3 || (prio !== null && dist(g.at, prio) < 10)) && !w.soldiers.some((s) => s.side === side && w.onField(s) && cheb(s, g.at) < cfg.mortars.dangerClose + 4));
      const sinceContact = Math.min(...pl.squadIds.map((id) => w.squad(id).firstContactTick ?? Infinity));
      if (target && w.tick - sinceContact >= 20) {
        pl.fireMissionsLeft--;
        pl.priority = null;
        const spot = w.tick + cfg.mortars.spotDelay;
        pl.missions.push({ id: w.nextId("mission"), side, target: target.at, spotTick: spot, effectTick: spot + cfg.mortars.effectDelay, rounds: cfg.mortars.rounds, fired: 0, calledBy: radio.id, kind: "mortar", msg: null });
        w.emit("fire_mission", [radio.id, pltLeader.id], { side, at: [target.at.x, target.at.y], by: radio.id, leader: pltLeader.id, left: pl.fireMissionsLeft });
        shout(w, radio, side === "us" ? `Fire mission! Enemy ${target.automatic ? "machine gun" : target.sniper ? "sniper position" : "infantry"} in the open, adjust fire, over!` : "Feuerauftrag! Granatwerfer, Feindstellung!", null);
        note(w, radio, "called in mortar fire");
      }
    }
  }
}

// ---------- Under mortar fire ----------

function inHole(w: World, s: Soldier): boolean {
  const t = w.map.at(s.x, s.y);
  return t === "foxhole" || t === "crater" || t === "ditch" || w.map.indoors(s.x, s.y, s.z);
}

/**
 * Rounds coming down on a squad. Men dug in or indoors stay down and ride it
 * out. Attackers close to the enemy go forward through it, since staying put
 * is death. Anyone else gets out of the beaten zone, sideways or back, before
 * the fire for effect: a ranging round close by is warning enough. Returns
 * true if the squad is busy with the shelling this turn.
 */
function shellReaction(w: World, sq: Squad, pl: Platoon, leader: Soldier): boolean {
  const cfg = w.config.shelling;
  const men = ableMen(w, sq).filter((m) => m.role !== "medic" && m.role !== "sniper");
  if (sq.state === "displace") {
    displaceStep(w, sq, pl, men, leader);
    return true;
  }
  if (men.length === 0 || sq.state === "withdraw" || sq.state === "broken" || sq.state === "fall_back" || sq.state === "assault" || sq.state === "ambush") return false;
  if (w.tick - sq.shelledTick < cfg.cooldown) return false;
  const hits = w.impacts.filter((i) => w.tick - i.tick <= cfg.recent && i.side !== sq.side && men.some((m) => cheb(m, i) <= cfg.radius));
  if (hits.length === 0) return false;
  sq.shelledTick = w.tick;
  const pos = centroid(men);
  const burst = centroid(hits);
  const covered = men.filter((m) => inHole(w, m)).length / men.length;
  const ranging = hits.every((h) => h.spotting);
  w.emit("shelled", [leader.id], { squad: sq.id, at: [burst.x, burst.y], ranging, covered: Math.round(covered * 100) / 100 });
  if (sq.side === "de") {
    const gasp = men.find((m) => m.id !== leader.id) ?? leader;
    shout(w, gasp, "Heiliger Strohsack!", "strohsack", 240);
  }
  if (!sq.isHQ && pl.role === "attack" && sq.focus && dist(pos, sq.focus) <= cfg.rushThrough && strength(w, sq) > 0.4) {
    setState(w, sq, "assault", "mortars falling all around: no use staying, rushing the position");
    shout(w, leader, leader.side === "us" ? "We can't stay here! Forward! Go!" : "Hier bleiben ist Tod! Vorwärts!", null);
    return true;
  }
  if (covered >= cfg.stayIfCovered) {
    shout(w, leader, leader.side === "us" ? "Incoming! Stay in your holes!" : "Volle Deckung! In den Löchern bleiben!", "shout-shells", 40);
    sq.intent = "shells coming in: riding it out in their holes";
    return false;
  }
  const to = refugeFrom(w, sq, pl, men, pos, burst, hits);
  if (!to) return false;
  sq.resume = sq.state;
  sq.refuge = to;
  setState(w, sq, "displace", ranging ? "a ranging round landed close: moving before the fire for effect comes" : "under mortar fire: getting out of the beaten zone");
  shout(w, leader, leader.side === "us" ? "Incoming! Move, move! Get out of there!" : "Granaten! Stellungswechsel, marsch!", null);
  const facing = sq.focus ? facingFrom(to, sq.focus) : { x: -rearDir(w, sq.side).x, y: -rearDir(w, sq.side).y };
  const els = elements(w, sq);
  for (const el of ["A", "B"] as const) if (els[el].length > 0) setOrder(w, sq, el, order("move", pickPositions(w, els[el], to, facing, 2, 6), "rush", "return", to));
  if (sq.isHQ) setOrder(w, sq, "A", order("move", pickPositions(w, men, to, facing, 2, 6), "rush", "return", to));
  return true;
}

/** Somewhere well clear of where the rounds are falling: to either side, or back; never toward the burst. */
function refugeFrom(w: World, sq: Squad, pl: Platoon, men: readonly Soldier[], pos: Point, burst: Point, hits: readonly Point[]): Point | null {
  const cfg = w.config.shelling;
  const away = facingFrom(burst, pos);
  const ex = w.exposure[sq.side];
  const back = rearDir(w, sq.side);
  let best: Point | null = null, bestScore = -Infinity;
  const turns = [0, 70, -70, 110, -110, 45, -45];
  for (const deg of turns) {
    const a = Math.atan2(away.y, away.x) + (deg * Math.PI) / 180;
    const p = { x: Math.round(pos.x + Math.cos(a) * cfg.displace), y: Math.round(pos.y + Math.sin(a) * cfg.displace) };
    if (!w.map.inBounds(p.x, p.y)) continue;
    const spot = w.freeTileNear(p, 5);
    if (!spot || !w.map.reachable(men[0]!, spot)) continue;
    const clear = Math.min(...hits.map((h) => dist(h, spot)));
    if (clear < cfg.radius * 0.7) continue;
    let score = clear * 0.05 - Math.min(2, ex[w.map.idx(spot.x, spot.y)]!) * 0.6 + (w.map.besideCover(spot.x, spot.y) ? 0.4 : 0);
    // Defenders would rather slide along their line than give ground; attackers would rather not go back.
    const rearward = (spot.x - pos.x) * back.x + (spot.y - pos.y) * back.y;
    score -= (pl.role === "defend" ? 0.02 : 0.03) * Math.max(0, rearward);
    if (score > bestScore) {
      bestScore = score;
      best = spot;
    }
  }
  return best;
}

/** Moving out from under the shells; once there, back to what the squad was doing. */
function displaceStep(w: World, sq: Squad, pl: Platoon, men: readonly Soldier[], leader: Soldier): void {
  const els = elements(w, sq);
  const done = (sq.isHQ ? arrived(w, men, sq.orders.A, 2) : arrived(w, els.A, sq.orders.A, 2) && arrived(w, els.B, sq.orders.B, 2)) || w.tick - sq.stateTick > 70;
  if (!done) return;
  const resume = sq.resume ?? (pl.role === "attack" ? "react" : "hold");
  sq.resume = null;
  sq.refuge = null;
  sq.flankPoint = null;
  note(w, leader, "got the squad out from under the shelling");
  // The move out is done: everyone holds where he got to until new orders.
  for (const el of ["A", "B"] as const) {
    const ms = sq.isHQ ? (el === "A" ? men : []) : els[el];
    const keep: Record<number, Point> = {};
    for (const m of ms) keep[m.id] = spotOf(m);
    setOrder(w, sq, el, order("hold", keep, "crouch", "free"));
  }
  if (sq.isHQ) {
    setState(w, sq, pl.role === "attack" ? "advance" : "hold", "clear of the shelling");
    return;
  }
  if (pl.role === "defend") {
    setState(w, sq, "hold", "clear of the shelling: holding here");
    for (const el of ["A", "B"] as const) {
      const keep: Record<number, Point> = {};
      for (const m of els[el]) keep[m.id] = spotOf(m);
      setOrder(w, sq, el, order("hold", keep, "crouch", "free"));
    }
    return;
  }
  if (resume === "advance" || resume === "deploy" || resume === "consolidate") {
    sq.route = boundsTo(w, sq.side, centroid(men), objectiveFor(w, sq, pl));
    sq.routeIdx = 0;
    sq.boundWp = -1;
    setState(w, sq, "advance", "clear of the shelling: pressing on");
  } else setState(w, sq, "react", "clear of the shelling: taking stock");
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
      maybeCallForHelp(w, sq, pl, leader);
      if (shellReaction(w, sq, pl, leader)) continue;
      if (sq.isHQ) hqStep(w, sq, pl, leader);
      else if (pl.role === "attack") attackStep(w, sq, pl, leader);
      else defendStep(w, sq, pl, leader);
    }
  }
}

export { isLeader, label };
