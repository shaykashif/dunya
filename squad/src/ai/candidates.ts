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
import type { Candidate, ElementOrder, Point, Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";
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
  const myPos = order.positions[s.id];

  // ---- Fire at men he can see ----
  if (spec && !reloading && s.loaded > 0) {
    const scored = enemiesSeen
      .map((e) => {
        const d = dist(s, e);
        const vis = w.map.visibility(s.x, s.y, e.x, e.y, w.smoke);
        const p = d <= spec.maxRange ? hitChance(w, s, e, spec, vis) * Math.max(1, spec.rate) : 0;
        const firing = w.tick - e.lastFiredTick <= 3;
        const atMe = e.id === s.underFire?.by && underFire;
        let threat = (e.weapon === "mg42" || e.weapon === "bar" ? 0.4 : 0) + (firing ? 0.2 : 0) + (atMe ? 0.25 : 0) + 0.3 * Math.max(0, 1 - d / 60) + (isLeader(e) ? 0.08 : 0);
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
    if (fire === "free" && contacts.length > 0 && !contacts[0]!.visible) points.push({ x: contacts[0]!.x, y: contacts[0]!.y });
    const seen = new Set<string>();
    for (const p of points) {
      const key = `${p.x},${p.y}`;
      if (seen.has(key) || dist(s, p) > spec.maxRange || !canFireOn(w, s, p)) continue;
      // Not into friends: an assault going in near the target.
      if (w.friendsNear({ ...p, side: s.side, id: s.id }, 3).some((f) => w.able(f))) continue;
      seen.add(key);
      const ordered = order.kind === "suppress" && order.target !== null && cheb(order.target, p) <= 2;
      out.push(
        cand("suppress", `suppress:${key}`, `put fire on ${ordered ? "the enemy position" : "where the fire came from"}`, {
          at: p,
          duration: spec.automatic ? 4 : 3,
          value: (ordered ? 0.8 : 0.35) + (spec.automatic ? 0.3 : 0) + (underFire ? 0.15 : 0),
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
    // Under fire, a man may rush the next stretch rather than walk it.
    if (pace !== "rush" && pace !== "crawl" && (underFire || exHere > 0.5) && dist(s, myPos) > 3) {
      out.push(cand("move", `move:${myPos.x},${myPos.y}:rush`, "rush to his position", { dest: myPos, pace: "rush", value: 0.7, ordered: true, danger: Math.min(1, ((exHere + exDest) / 2) * 0.45 + (underFire ? 0.15 : 0)), offense: 0.3 }));
    }
  }

  // ---- Cover ----
  const coverHere = threats.length > 0 ? threats.reduce((a, t) => a + w.map.cover(here, t, "crouch"), 0) / threats.length : 0;
  if (threats.length > 0 && coverHere < 0.55 && (underFire || exHere > 0.3 || s.suppression > 0.25)) {
    const fireAt = threats[0] && spec && hasAmmo(s) ? threats[0] : null;
    const spot = findCover(w, s, threats, s.pinned ? 2 : 5, fireAt);
    if (spot) {
      out.push(cand("take_cover", `cover:${spot.x},${spot.y}`, "get into cover", { dest: spot, pace: s.pinned ? "crawl" : "rush", value: 0.25 + 0.5 * (1 - coverHere) * (underFire ? 1 : 0.5), safety: 0.85, danger: 0.15 * exHere }));
    }
  }

  // ---- Hold where he is ----
  out.push(cand("hold", "hold", contacts.length ? "keep watch from cover" : "wait", { duration: 2, value: 0.18 + (atPosition(s, order) ? 0.12 : 0), ordered: atPosition(s, order) && (order.kind === "hold" || order.kind === "overwatch" || order.kind === "suppress"), safety: coverHere * 0.6 }));

  // ---- Pinned: hug the dirt ----
  if (s.pinned || s.suppression > 0.45) out.push(cand("hug", "hug", "press himself into the dirt", { duration: 2, value: 0.15 + s.suppression * 0.55, safety: 1 }));

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
      out.push(cand("grenade", `grenade:${c.x},${c.y}`, "throw a grenade", { at: { x: c.x, y: c.y }, duration: 1, value: 0.4 + (behind ? 0.35 : 0) + (assaulting ? 0.3 : 0) + (c.automatic ? 0.2 : 0), ordered: assaulting, danger: 0.25 + 0.2 * exHere, offense: 0.9 }));
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
