// What each soldier could do this moment, as candidates for his decision
// source: fire at a man he sees, suppress a position, move where his team
// leader sends him, get into cover, dress a wound, throw a grenade, rally the
// men, give up. The engine judges each option tactically; the decision source
// weighs it against the man's own nerve, aggression and sense of duty.
import { hasAmmo, hitChance, weaponOf } from "../combat/fire.ts";
import { liveContacts } from "../combat/perception.ts";
import { armFactor, bleedingOf, cannotWalk } from "../entities/body.ts";
import { needsAid, needsCarrying } from "../entities/injuries.ts";
import { isGunner, isLeader } from "../entities/soldier.ts";
import { cheb, dist } from "../world/map.ts";
import type { Candidate, ElementOrder, Ordnance, Point, Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { chooseHide, compromised, isSniper, needsHide, sniperPriority, watchingWounded } from "./sniper.ts";
import { canFireOn, findCover } from "./tactics.ts";

function cand(kind: Candidate["kind"], key: string, description: string, fields: Partial<Candidate>): Candidate {
  return { kind, key, description, value: 0, ordered: false, danger: 0, safety: 0, care: 0, offense: 0, ...fields };
}

export function orderFor(w: World, s: Soldier): ElementOrder {
  const sq = w.squad(s.squadId);
  return sq.orders[s.element === "B" ? "B" : "A"];
}

function exposureAt(w: World, s: Soldier, p: Point): number {
  return Math.min(1.5, w.exposure[s.side][w.map.idx(p.x, p.y)]!);
}

/** Where a man falls back to: his platoon's aid post, behind the line. */
function rearPoint(w: World, s: Soldier): Point {
  return w.platoons[s.side].aidPost;
}

/** Whether a hold or suppress order's spot counts as reached: those are loose, moves are exact. */
function atPosition(s: Soldier, o: ElementOrder): boolean {
  const p = o.positions[s.id];
  if (!p) return true;
  const loose = o.kind === "hold" || o.kind === "overwatch" || o.kind === "suppress";
  return cheb(s, p) <= (loose ? 4 : 0);
}

/** A grenade in flight is something to get away from inside this many tiles. */
function clearRadius(w: World, kind: "frag" | "stick" | "rifle_grenade"): number {
  return Math.max(3, Math.round(w.config.explosives[kind].radius * 0.65));
}

/**
 * The live grenade this man should be scrambling away from: one that will burst
 * on his floor within its danger distance of him, that he can see or is next to.
 */
export function grenadeToClear(w: World, s: Soldier): Ordnance | null {
  let best: Ordnance | null = null;
  let bd = Infinity;
  for (const o of w.ordnance) {
    if (o.kind !== "frag" && o.kind !== "stick" && o.kind !== "rifle_grenade") continue;
    if (o.burstTick <= w.tick || o.z !== s.z) continue;
    const d = cheb(s, o);
    if (d > clearRadius(w, o.kind)) continue;
    if (d > 2 && w.map.visibility(s.x, s.y, o.x, o.y, null, s.z, o.z) < 0.3) continue;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Already busy shooting back: under fire, with an enemy in sight and a loaded weapon. */
export function shootingBack(w: World, s: Soldier): boolean {
  const kind = s.act?.cand.kind;
  if (kind === "fire" || kind === "suppress") return true;
  const underFire = s.underFire !== null && w.tick - s.underFire.tick < 6;
  if (!underFire || s.loaded <= 0 || !weaponOf(w, s)) return false;
  return s.sees.some((id) => w.soldier(id).status === "active");
}

/** Whether he is in a state to run: not pinned, hobbled, or carrying a friend. */
export function canScramble(s: Soldier): boolean {
  return !s.pinned && !cannotWalk(s) && s.carryingId === null && s.carriedById === null && s.conscious && s.status === "active";
}

export function generateCandidates(w: World, s: Soldier): Candidate[] {
  const out: Candidate[] = [];
  const cfg = w.config;
  const sq = w.squad(s.squadId);
  const order = orderFor(w, s);
  const here = { x: s.x, y: s.y };
  const exHere = exposureAt(w, s, here);
  const contacts = liveContacts(w, sq, 30);
  const threats = contacts.slice(0, 4).map((c) => ({ x: c.x, y: c.y }));
  const underFire = s.underFire !== null && w.tick - s.underFire.tick < 6;
  if (underFire && s.underFire) threats.unshift({ x: s.underFire.x, y: s.underFire.y });

  // ---- Wounded ----
  if (s.status === "casualty") {
    out.push(cand("hug", "hug", "lie still", { duration: 3, value: 0.3, safety: 0.5 }));
    if (s.conscious && armFactor(s) > 0.3 && (exHere > 0.25 || underFire)) {
      const spot = findCover(w, s, threats, 3, null);
      if (spot) out.push(cand("crawl_to_cover", `crawl:${spot.x},${spot.y}`, "crawl into cover", { dest: spot, pace: "crawl", value: 0.45 + 0.3 * exHere, safety: 0.9 }));
    }
    if (s.conscious && armFactor(s) > 0.4 && bleedingOf(s) > 0.1 && !w.friendsNear(s, 2).some((f) => f.role === "medic")) {
      out.push(cand("aid", `aid:${s.id}`, "dress his own wound", { targetId: s.id, value: 0.65 + bleedingOf(s) * 0.3, care: 0.5, safety: 0.3 }));
    }
    if (s.conscious && !cannotWalk(s) && dist(s, rearPoint(w, s)) > 4) {
      const to = rearPoint(w, s);
      out.push(cand("flee", `back:${to.x},${to.y}`, "make his way back to the aid post", { dest: to, pace: "crouch", value: 0.55, safety: 0.6, danger: 0.3 * exHere }));
    }
    return out;
  }

  // ---- Broken men ----
  const enemiesSeen = s.sees.map((id) => w.soldier(id)).filter((e) => e.status === "active");
  if (s.broken) {
    const to = { x: s.x, y: w.platoons[s.side].rearY };
    out.push(cand("flee", `flee:${to.x},${to.y}`, "run for the rear", { dest: to, pace: "rush", value: 0.75, safety: 1, danger: 0.4 * exHere }));
    out.push(cand("hug", "hug", "hug the ground", { duration: 3, value: 0.25 + s.suppression * 0.5, safety: 0.9 }));
    const close = enemiesSeen.filter((e) => cheb(e, s) <= cfg.morale.surrenderEnemyWithin);
    if (close.length > 0 && (w.friendsNear(s, 6).filter((f) => w.able(f)).length === 0 || !hasAmmo(s))) {
      out.push(cand("surrender", "surrender", "throw down his weapon and surrender", { value: 0.7 + (1 - s.morale) * 0.4, safety: 0.8 }));
    }
    return out;
  }

  // ---- After the battle: tend the wounded and wait ----
  if (w.phase !== "battle") {
    out.push(cand("hold", "hold", "stand easy", { duration: 5, value: 0.3 }));
    addAid(w, s, out, sq.side, true);
    return out;
  }

  const spec = weaponOf(w, s);
  const reloading = s.reloadLeft > 0;
  const fire = order.fire;
  const myPos = isSniper(s) ? undefined : order.positions[s.id];

  // ---- Snipers work alone ----
  if (isSniper(s)) {
    sniperCandidates(w, s, out, enemiesSeen, exHere, underFire);
    return out;
  }

  // ---- A sniper is working on the squad: get down, look for him, put fire where he might be ----
  const alert = sq.sniperAlert && w.tick - sq.sniperAlert.tick < 40 ? sq.sniperAlert : null;
  if (alert) threats.unshift({ x: alert.x, y: alert.y });
  // ---- Shells landing close ----
  const shells = w.impacts.filter((i) => w.tick - i.tick <= 4 && cheb(i, s) <= 9 && s.z === 0);

  // ---- A grenade coming down close by: get outside its reach, unless already busy shooting back ----
  if (canScramble(s) && !shootingBack(w, s)) {
    const g = grenadeToClear(w, s);
    if (g && (g.kind === "frag" || g.kind === "stick" || g.kind === "rifle_grenade")) {
      const safe = clearRadius(w, g.kind);
      let best: Point | null = null;
      let bestScore = -Infinity;
      for (let dy = -(safe + 3); dy <= safe + 3; dy++) {
        for (let dx = -(safe + 3); dx <= safe + 3; dx++) {
          const x = s.x + dx, y = s.y + dy;
          if ((dx === 0 && dy === 0) || !w.isFree(x, y, s.id, s.z)) continue;
          const p = s.z > 0 ? { x, y, z: s.z } : { x, y };
          if (cheb(p, g) <= safe || !w.map.reachable(s, p)) continue;
          // Nearest clear ground, better with something solid between it and the burst.
          const shielded = w.map.visibility(g.x, g.y, x, y, null, g.z, s.z) === 0 ? 2 : 0;
          const score = shielded - Math.hypot(dx, dy) * 0.6 - exposureAt(w, s, p) * 0.3;
          if (score > bestScore) {
            bestScore = score;
            best = p;
          }
        }
      }
      if (best) out.push(cand("take_cover", `clear:${best.x},${best.y}`, "scramble clear of the grenade", { dest: best, pace: "rush", value: 1.4, safety: 1, danger: 0.05 }));
      else out.push(cand("hug", "hug:grenade", "throw himself flat from the grenade", { duration: 1, value: 1.0, safety: 1 }));
    }
  }

  // ---- Fire at men he can see ----
  if (spec && !reloading && s.loaded > 0) {
    const scored = enemiesSeen
      .map((e) => {
        const d = dist(s, e);
        const vis = w.map.visibility(s.x, s.y, e.x, e.y, w.smoke, s.z, e.z);
        const p = d <= spec.maxRange ? hitChance(w, s, e, spec, vis) * Math.max(1, spec.rate) : 0;
        const firing = w.tick - e.lastFiredTick <= 3;
        const atMe = e.id === s.underFire?.by && underFire;
        let threat = (e.weapon === "mg42" || e.weapon === "bar" ? 0.4 : 0) + (e.role === "sniper" ? 0.5 : 0) + (firing ? 0.2 : 0) + (atMe ? 0.25 : 0) + 0.3 * Math.max(0, 1 - d / 60) + (isLeader(e) ? 0.08 : 0);
        // A medic with a red cross is spared by most men who see it.
        if (e.role === "medic") threat -= 0.6;
        return { e, d, p, threat, firing };
      })
      .filter((x) => x.p > 0.003)
      .sort((a, b) => b.threat + b.p * 3 - (a.threat + a.p * 3) || a.e.id - b.e.id)
      .slice(0, 3);
    for (const t of scored) {
      const allowed = fire === "free" || t.d <= 12 || (fire === "return" && (t.firing || t.d <= 30)) || underFire;
      if (!allowed) continue;
      out.push(
        cand("fire", `fire:${t.e.id}`, `fire at ${t.e.abbr} ${t.e.last}`, {
          targetId: t.e.id,
          at: { x: t.e.x, y: t.e.y },
          duration: spec.automatic ? 3 : 2,
          value: 0.5 + t.threat * 0.6 + Math.min(0.45, t.p * 3),
          ordered: fire === "free" || order.kind === "suppress" || order.kind === "overwatch",
          danger: 0.12 + 0.2 * exHere,
          offense: 0.6,
        }),
      );
    }
    // ---- Suppress what can't be seen ----
    const points: Point[] = [];
    if (order.kind === "suppress" && order.target) points.push(order.target);
    if (underFire && s.underFire && !s.sees.includes(s.underFire.by)) points.push({ x: s.underFire.x, y: s.underFire.y });
    if (fire === "free" && contacts.length > 0 && !contacts[0]!.visible) points.push(contacts[0]!.z > 0 ? { x: contacts[0]!.x, y: contacts[0]!.y, z: contacts[0]!.z } : { x: contacts[0]!.x, y: contacts[0]!.y });
    if (alert) points.push({ x: alert.x, y: alert.y });
    const seen = new Set<string>();
    for (const p of points) {
      const key = `${p.x},${p.y}`;
      if (seen.has(key) || dist(s, p) > spec.maxRange || !canFireOn(w, s, p)) continue;
      // Not into friends: an assault going in near the target.
      if (w.friendsNear({ ...p, side: s.side, id: s.id }, 3).some((f) => w.able(f))) continue;
      seen.add(key);
      const ordered = order.kind === "suppress" && order.target !== null && cheb(order.target, p) <= 2;
      const atSniper = alert !== null && p.x === alert.x && p.y === alert.y;
      out.push(
        cand("suppress", `suppress:${key}`, `put fire on ${ordered ? "the enemy position" : atSniper ? "where the sniper might be" : "where the fire came from"}`, {
          at: p,
          duration: spec.automatic ? 4 : 3,
          value: (ordered ? 0.8 : atSniper ? 0.5 : 0.35) + (spec.automatic ? 0.3 : 0) + (underFire ? 0.15 : 0),
          ordered,
          danger: 0.12 + 0.2 * exHere,
          offense: 0.4,
        }),
      );
    }
  }

  // ---- Reload ----
  if (spec && !reloading && s.ammo > 0 && s.loaded < spec.capacity * 0.5) {
    out.push(cand("reload", "reload", "reload", { value: s.loaded === 0 ? 1.1 : 0.3 + 0.5 * (1 - s.loaded / spec.capacity), danger: 0.05, safety: 0.15 }));
  }

  // ---- Move as ordered ----
  if (myPos && !atPosition(s, order) && w.map.passable(myPos.x, myPos.y)) {
    const pinned = s.pinned || s.suppression > 0.5;
    const pace = pinned ? "crawl" : order.pace;
    const exDest = exposureAt(w, s, myPos);
    const paceRisk = pace === "rush" ? 0.6 : pace === "crawl" ? 0.3 : pace === "crouch" ? 0.85 : 1.1;
    const verb = order.kind === "assault" ? "assault" : order.kind === "withdraw" ? "fall back" : "move";
    out.push(
      cand("move", `move:${myPos.x},${myPos.y}:${pace}`, `${verb} to his position${pace === "rush" ? " in rushes" : pace === "crawl" ? ", crawling" : ""}`, {
        dest: myPos,
        pace,
        value: order.kind === "assault" ? 0.95 : order.kind === "withdraw" ? 0.9 : 0.75,
        ordered: true,
        danger: Math.min(1, ((exHere + exDest) / 2) * 0.7 + (underFire ? 0.25 : 0)) * paceRisk,
        offense: order.kind === "assault" ? 0.8 : 0.2,
        safety: order.kind === "withdraw" ? 0.4 : 0,
      }),
    );
    // Under fire, a man may rush the next stretch rather than walk it, if he has the breath for it.
    if (pace !== "rush" && pace !== "crawl" && (underFire || exHere > 0.5) && dist(s, myPos) > 3 && s.fatigue < cfg.fatigue.winded) {
      out.push(cand("move", `move:${myPos.x},${myPos.y}:rush`, "rush to his position", { dest: myPos, pace: "rush", value: 0.7, ordered: true, danger: Math.min(1, ((exHere + exDest) / 2) * 0.45 + (underFire ? 0.15 : 0)), offense: 0.3 }));
    }
  }

  // ---- In ambush: lie still, wait ----
  if (sq.state === "ambush") {
    out.push(cand("hold", "ambush", "lie still in ambush, waiting", { duration: 3, value: 0.7, ordered: true, safety: 0.6 }));
    return out.filter((c) => c.kind !== "move" && c.kind !== "rifle_grenade" && c.kind !== "suppress");
  }

  // ---- Cover ----
  const here3 = s.z > 0 ? { x: s.x, y: s.y, z: s.z } : here;
  const coverHere = threats.length > 0 ? threats.reduce((a, t) => a + w.map.cover(here3, t, "crouch"), 0) / threats.length : 0;
  if (threats.length > 0 && coverHere < 0.55 && (underFire || alert || exHere > 0.3 || s.suppression > 0.25)) {
    const fireAt = threats[0] && spec && hasAmmo(s) ? threats[0] : null;
    const spot = findCover(w, s, threats, s.pinned ? 2 : 5, fireAt);
    if (spot) {
      const urgency = underFire ? 1 : alert ? 0.8 : 0.5;
      out.push(cand("take_cover", `cover:${spot.x},${spot.y}`, alert && !underFire ? "get into cover from the sniper" : "get into cover", { dest: spot, pace: s.pinned ? "crawl" : "rush", value: 0.25 + 0.5 * (1 - coverHere) * urgency, safety: 0.85, danger: 0.15 * exHere }));
    }
  }

  // ---- Shelling: into a hole, or flat in the one he is in ----
  if (shells.length > 0) {
    const t = w.map.at(s.x, s.y);
    const inHole = t === "foxhole" || t === "crater" || t === "ditch" || w.map.indoors(s.x, s.y, s.z);
    if (inHole) out.push(cand("hug", "hug:shells", "stay flat in his hole while the shells come in", { duration: 3, value: 0.85, safety: 1 }));
    else {
      const spot = findCover(w, s, shells, 6, null);
      if (spot) out.push(cand("take_cover", `shellcover:${spot.x},${spot.y}`, "dive for cover from the shells", { dest: spot, pace: "rush", value: 0.9, safety: 1, danger: 0.1 }));
      else out.push(cand("hug", "hug:shells", "throw himself flat", { duration: 2, value: 0.6, safety: 0.8 }));
    }
  }

  // ---- Blown: catch his breath while nobody is shooting at him ----
  if (s.fatigue > cfg.fatigue.winded * 0.75 && !underFire) out.push(cand("hold", "breathe", "catch his breath", { duration: 3, value: 0.15 + 0.4 * s.fatigue, safety: 0.2 }));

  // ---- Hold where he is ----
  out.push(cand("hold", "hold", contacts.length ? "keep watch from cover" : "wait", { duration: 2, value: 0.18 + (atPosition(s, order) ? 0.12 : 0), ordered: atPosition(s, order) && (order.kind === "hold" || order.kind === "overwatch" || order.kind === "suppress"), safety: coverHere * 0.6 }));

  // ---- Pinned: hug the dirt ----
  if (s.pinned || s.suppression > 0.45) out.push(cand("hug", "hug", "press himself into the dirt", { duration: 2, value: 0.15 + s.suppression * 0.55, safety: 1 }));

  // ---- Clearing a house: on the word, a grenade through the nearest door or window ----
  const br = sq.breach;
  if (br && br.stage === "grenades" && s.grenades > 0 && w.tick - br.tick < cfg.breach.grenadeTicks && s.cooldowns["breachThrow"] !== br.tick && s.element === (sq.orders.B.kind === "move" ? "B" : s.element)) {
    const b = w.buildings[br.house]!;
    let best: { inside: Point; door: boolean; d: number } | null = null;
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (!(x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1)) continue;
        const t = w.map.at(x, y);
        if (t !== "window" && t !== "door" && t !== "rubble") continue;
        const d = cheb(s, { x, y });
        if (d > 7 || (best && d >= best.d)) continue;
        const inner = w.map.neighbors4(x, y).find((p) => w.map.building[w.map.idx(p.x, p.y)] === br.house && w.map.passable(p.x, p.y));
        if (inner) best = { inside: inner, door: t !== "window", d };
      }
    }
    if (best) {
      // Upstairs, if that is where they are and this is a window.
      const up = liveContacts(w, sq, 25).find((c) => c.z > 0 && w.map.building[w.map.idx(c.x, c.y)] === br.house);
      const z = up && !best.door && w.map.passable(best.inside.x, best.inside.y, up.z) ? up.z : 0;
      const at = z > 0 ? { ...best.inside, z } : best.inside;
      s.cooldowns["breachThrow"] = br.tick;
      out.push(cand("grenade", `breach:${at.x},${at.y},${z}`, z > 0 ? "lob a grenade through the upstairs window" : best.door ? "roll a grenade in through the door" : "post a grenade through the window", { at, duration: 1, value: 1.8, ordered: true, danger: 0.2, offense: 1 }));
    }
  }

  // ---- Grenades ----
  const assaulting = order.kind === "assault";
  if (s.grenades > 0 && !(s.cooldowns["grenade"] !== undefined && w.tick < s.cooldowns["grenade"]!)) {
    const range = Math.min(assaulting ? 13 : 10, s.side === "us" ? cfg.explosives.throwRange.frag : cfg.explosives.throwRange.stick);
    for (const c of contacts.slice(0, 3)) {
      const d = dist(s, c);
      if (d < 3 || d > range || w.tick - c.tick > 12) continue;
      if (w.friendsNear({ x: c.x, y: c.y, side: s.side, id: s.id }, 3).some((f) => w.onField(f))) continue;
      const behind = w.map.cover({ x: c.x, y: c.y }, s, "crouch") >= 0.45 || !c.visible || w.map.at(c.x, c.y) === "foxhole" || w.map.indoors(c.x, c.y);
      // A man in the open is a rifle target; grenades are for men behind cover, or for the final rush.
      if (!behind && !assaulting && d > 6) continue;
      // Up through an upstairs window, if that is where he is.
      const aim = c.z > 0 && d <= 8 ? { x: c.x, y: c.y, z: c.z } : { x: c.x, y: c.y };
      out.push(cand("grenade", `grenade:${c.x},${c.y}`, c.z > 0 && d <= 8 ? "lob a grenade up through the window" : "throw a grenade", { at: aim, duration: 1, value: 0.4 + (behind ? 0.35 : 0) + (assaulting ? 0.3 : 0) + (c.automatic ? 0.2 : 0), ordered: assaulting, danger: 0.25 + 0.2 * exHere, offense: 0.9 }));
      break;
    }
  }
  if (s.rifleGrenades > 0 && !reloading) {
    const [lo, hi] = cfg.explosives.rifleGrenadeRange;
    for (const c of contacts.slice(0, 3)) {
      const d = dist(s, c);
      if (d < lo || d > hi || w.tick - c.tick > 15 || (!c.visible && !canFireOn(w, s, c))) continue;
      if (w.friendsNear({ x: c.x, y: c.y, side: s.side, id: s.id }, 5).some((f) => w.onField(f))) continue;
      out.push(cand("rifle_grenade", `rgren:${c.x},${c.y}`, "fire a rifle grenade", { at: { x: c.x, y: c.y }, duration: 2, value: 0.55 + (c.automatic ? 0.45 : 0), ordered: fire === "free", danger: 0.2 + 0.2 * exHere, offense: 0.8 }));
      break;
    }
  }

  // ---- Smoke: to cover a move across open ground, a withdrawal, or a casualty ----
  if (s.smokes > 0 && isLeader(s) && !(s.cooldowns["smoke"] && w.tick < s.cooldowns["smoke"]!) && threats.length > 0) {
    const t = threats[0]!;
    const moving = sq.state === "fall_back" || sq.state === "flank" || sq.state === "assault";
    const exposedMen = sq.members.map((id) => w.soldier(id)).filter((m) => w.onField(m) && exposureAt(w, m, m) > 0.6);
    if ((moving && exposedMen.length >= 2) || exposedMen.some((m) => m.status === "casualty")) {
      const mid = { x: Math.round(t.x + (s.x - t.x) * 0.35), y: Math.round(t.y + (s.y - t.y) * 0.35) };
      if (dist(s, mid) <= cfg.explosives.throwRange.frag + 2) {
        out.push(cand("smoke", `smoke:${mid.x},${mid.y}`, "throw smoke to screen the men", { at: mid, duration: 1, value: 1, ordered: true, danger: 0.2, care: 0.4 }));
      }
    }
  }

  // ---- Leaders rally shaken men ----
  if (isLeader(s) && !s.pinned && !(s.cooldowns["rally"] && w.tick < s.cooldowns["rally"]!)) {
    const shaken = w.friendsNear(s, 9).filter((f) => f.status === "active" && (f.pinned || f.morale < 0.45));
    if (shaken.length >= 2) out.push(cand("rally", "rally", "shout the men back into the fight", { duration: 2, value: 0.45 + 0.35 * s.traits.leadership + 0.05 * shaken.length, ordered: true, danger: 0.2 + 0.3 * exHere, care: 0.3 }));
  }

  // ---- Crew-served weapons: pick up a fallen gunner's weapon, bring him ammunition ----
  const team = sq.members.map((id) => w.soldier(id)).filter((m) => m.id !== s.id);
  if (s.role === "asst_gunner" || s.role === "ammo_bearer") {
    const gunner = team.find((m) => isGunner(m) && m.weapon !== null && (m.weapon === "mg42" || m.weapon === "bar"));
    if (gunner && !w.able(gunner) && cheb(gunner, s) <= 12 && !team.some((m) => m.act?.cand.kind === "take_weapon")) {
      out.push(cand("take_weapon", `take:${gunner.id}`, `take over the ${w.config.weapons[gunner.weapon!].name}`, { targetId: gunner.id, dest: { x: gunner.x, y: gunner.y }, pace: "crawl", value: 1.05, ordered: true, danger: 0.3 * exposureAt(w, s, gunner), offense: 0.4 }));
    } else if (gunner && w.able(gunner) && s.teamAmmo > 0 && cheb(gunner, s) <= 15 && gunner.ammo < w.config.weapons[gunner.weapon!].capacity * 2) {
      out.push(cand("resupply", `ammo:${gunner.id}`, `bring ammunition to ${gunner.abbr} ${gunner.last}`, { targetId: gunner.id, dest: { x: gunner.x, y: gunner.y }, pace: "crouch", value: 0.85, ordered: true, danger: 0.3 * exHere, care: 0.3 }));
    }
  }

  // ---- Prisoners ----
  for (const e of s.sees.map((id) => w.soldier(id))) {
    if (e.status !== "surrendered" || cheb(e, s) > 25 || (e.cooldowns["capturing"] !== undefined && w.tick < e.cooldowns["capturing"]!)) continue;
    out.push(cand("capture", `capture:${e.id}`, `take ${e.abbr} ${e.last} prisoner`, { targetId: e.id, dest: { x: e.x, y: e.y }, pace: "crouch", value: 0.55, danger: 0.2 * exposureAt(w, s, e) }));
    break;
  }

  // ---- The wounded ----
  addAid(w, s, out, s.side, false);

  // ---- Giving up ----
  if (s.morale < cfg.morale.broken + 0.08) {
    const close = enemiesSeen.filter((e) => cheb(e, s) <= cfg.morale.surrenderEnemyWithin);
    if (close.length >= 1 && w.friendsNear(s, 6).filter((f) => w.able(f)).length === 0) out.push(cand("surrender", "surrender", "surrender", { value: 0.4 + (1 - s.morale) * 0.4, safety: 0.6 }));
  }
  return out;
}

/**
 * A sniper's options: go to his hide, take the shots worth taking, watch a
 * wounded man for whoever comes to help him, reload, and move on when found.
 */
function sniperCandidates(w: World, s: Soldier, out: Candidate[], enemiesSeen: Soldier[], exHere: number, underFire: boolean): void {
  const cfg = w.config.sniper;
  const spec = weaponOf(w, s);
  if (needsHide(w, s)) {
    const was = s.hide;
    s.hide = chooseHide(w, s) ?? was;
    s.hideTick = w.tick;
    s.cooldowns["hideShots"] = 0;
    if (s.hide && (!was || cheb(was, s.hide) > 0 || (was.z ?? 0) !== (s.hide.z ?? 0))) w.emit("sniper_hide", [s.id], { by: s.id, at: [s.hide.x, s.hide.y], z: s.hide.z ?? 0, moving: was !== null });
  }
  const hide = s.hide;
  const atHide = hide !== null && s.x === hide.x && s.y === hide.y && s.z === (hide.z ?? 0);
  if (spec && s.reloadLeft === 0 && s.loaded > 0) {
    const shots = enemiesSeen
      .map((e) => {
        const vis = w.map.visibility(s.x, s.y, e.x, e.y, w.smoke, s.z, e.z);
        return { e, p: dist(s, e) <= spec.maxRange ? hitChance(w, s, e, spec, vis) : 0, pr: sniperPriority(w, s, e) };
      })
      .filter((x) => x.p >= cfg.minHit || (x.pr >= 0.7 && x.p >= cfg.priorityMinHit))
      .sort((a, b) => b.pr + b.p * 2 - (a.pr + a.p * 2) || a.e.id - b.e.id)
      .slice(0, 3);
    for (const t of shots) {
      const what = t.e.role === "sniper" ? "the enemy sniper" : t.e.weapon === "mg42" || t.e.weapon === "bar" ? "the machine gunner" : t.e.act?.cand.kind === "aid" || t.e.act?.cand.kind === "carry" ? "the man going to the wounded" : `${t.e.abbr} ${t.e.last}`;
      out.push(cand("fire", `fire:${t.e.id}`, `take a shot at ${what}`, { targetId: t.e.id, at: { x: t.e.x, y: t.e.y }, duration: 2, value: 0.55 + t.pr * 0.55 + Math.min(0.4, t.p * 2), ordered: true, danger: 0.1 + 0.1 * exHere, offense: 0.7 }));
    }
  }
  if (hide && !atHide && w.map.passable(hide.x, hide.y, hide.z ?? 0)) {
    out.push(cand("move", `hide:${hide.x},${hide.y},${hide.z ?? 0}`, `${compromised(w, s) ? "slip away to" : "work his way to"} a new hide${(hide.z ?? 0) > 0 ? " upstairs" : ""}`, { dest: hide, pace: underFire || exHere > 0.3 ? "crawl" : "crouch", value: 0.8 + (compromised(w, s) ? 0.3 : 0), ordered: true, safety: 0.3, danger: 0.2 * exHere }));
  }
  const wounded = watchingWounded(w, s);
  out.push(cand("hold", wounded ? `watch:${wounded.id}` : "watch", wounded ? `watch ${wounded.abbr} ${wounded.last} lying wounded, waiting for whoever comes for him` : "watch through the scope", { duration: 3, value: atHide ? 0.5 : 0.15, ordered: atHide, safety: 0.3 }));
  if (spec && s.reloadLeft === 0 && s.ammo > 0 && s.loaded < spec.capacity) out.push(cand("reload", "reload", "reload", { value: s.loaded === 0 ? 1.1 : 0.3, safety: 0.1 }));
  if (s.pinned || s.suppression > 0.45) out.push(cand("hug", "hug", "lie still and let it pass", { duration: 2, value: 0.2 + s.suppression * 0.5, safety: 1 }));
}

/** Medics go to the wounded; anyone may dress a squadmate beside him; the platoon sergeant carries them back. */
function addAid(w: World, s: Soldier, out: Candidate[], side: Soldier["side"], after: boolean): void {
  const medic = s.role === "medic";
  const sergeant = s.role === "platoon_sergeant";
  const order = orderFor(w, s);
  const wounded = w.soldiers
    .filter((p) => p.side === side && p.id !== s.id && p.carriedById === null && (p.status === "casualty" || p.status === "active") && needsAid(p))
    .map((p) => ({ p, d: dist(s, p), b: bleedingOf(p) }))
    .filter(({ p, d }) => {
      if (medic) return d <= 90 && (s.cooldowns[`aid:${p.id}`] !== undefined || s.sees.length >= 0) && !(p.cooldowns["tending"] !== undefined && w.tick < p.cooldowns["tending"]! && p.cooldowns["tender"] !== s.id);
      return (d <= 4 || (after && d <= 25)) && (p.squadId === s.squadId || after) && !(p.cooldowns["tending"] !== undefined && w.tick < p.cooldowns["tending"]!);
    })
    .sort((a, b) => b.b - a.b || a.d - b.d || a.p.id - b.p.id)
    .slice(0, 3);
  for (const { p, d, b } of wounded) {
    const ex = exposureAt(w, s, p);
    const urgency = b * 0.5 + (p.status === "casualty" ? 0.2 : 0);
    let value = medic ? 1.0 + urgency - d * 0.003 : 0.35 + urgency + 0.2 * s.traits.empathy;
    if (!medic && order.kind === "assault") value *= 0.35;
    if (!medic && p.status === "active" && b < 0.15) continue;
    out.push(cand("aid", `aid:${p.id}`, `${medic ? "go to" : "help"} ${p.abbr} ${p.last}`, { targetId: p.id, dest: { x: p.x, y: p.y }, pace: medic && ex > 0.4 ? "crawl" : "rush", value, ordered: medic || after, care: 1, danger: 0.6 * ex }));
  }
  // Carrying back the men who cannot walk once their bleeding is stopped.
  if (medic || sergeant || after) {
    const aidPost = w.platoons[side].aidPost;
    for (const p of w.soldiers) {
      if (p.side !== side || !needsCarrying(p) || bleedingOf(p) > 0.25 || dist(p, aidPost) <= 6) continue;
      if (w.soldiers.some((o) => o.id !== s.id && o.act?.cand.kind === "carry" && o.act.cand.targetId === p.id)) continue;
      const d = dist(s, p);
      if (d > (sergeant ? 70 : medic ? 30 : 25)) continue;
      const ex = exposureAt(w, s, p);
      // The medic drags a man in the open into cover; the sergeant carries him all the way back.
      const dest = medic && !after ? findCover(w, { ...p, id: s.id } as Soldier, [], 8, null) ?? aidPost : aidPost;
      if (medic && !after && ex < 0.4) continue;
      out.push(cand("carry", `carry:${p.id}`, `carry ${p.abbr} ${p.last} ${dest === aidPost ? "back to the aid post" : "into cover"}`, { targetId: p.id, dest, pace: "rush", value: (sergeant ? 0.95 : 0.7) + ex * 0.2 - d * 0.004, ordered: true, care: 0.9, danger: 0.5 * ex }));
      break;
    }
  }
}
