// Snipers work alone. Each picks a hide, as high up and as well hidden as he
// can find, with a long view over where the enemy is or will come from: an
// upstairs window, a church tower, a wood on a rise, a hedge corner. He waits
// for the shot that matters: a machine gunner, an officer, the enemy's own
// sniper, or the medic who crawls out to a wounded man. After a few shots, or
// once he is fired on, he moves.
import { clusters, concealment, sideContacts } from "../combat/perception.ts";
import { cheb, dist } from "../world/map.ts";
import { enemyOf, MAX_FLOORS, type Point, type Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { canFireOn, vantage } from "./tactics.ts";

export function isSniper(s: Soldier): boolean {
  return s.role === "sniper" && (s.weapon === "kar98k_scoped" || s.weapon === "m1903_scoped");
}

/**
 * Where a sniper should be looking: a friendly squad's sniper alarm (to hunt
 * the enemy sniper), then the most dangerous enemy position known, else the
 * ground the enemy must cross.
 */
export function watchPoint(w: World, s: Soldier): Point {
  const alarms = w.squads.filter((q) => q.side === s.side && q.sniperAlert && w.tick - q.sniperAlert.tick < 60).map((q) => q.sniperAlert!);
  if (alarms.length > 0) return { x: alarms[0]!.x, y: alarms[0]!.y };
  const groups = clusters(sideContacts(w, s.side, 90), 6);
  if (groups.length > 0) {
    const rank = (g: (typeof groups)[number]) => (g.sniper ? 3 : g.automatic ? 2 : 0) + Math.min(2, g.n * 0.3) - dist(g.at, s) * 0.005;
    return [...groups].sort((a, b) => rank(b) - rank(a) || a.at.x - b.at.x)[0]!.at;
  }
  const pl = w.platoons[s.side];
  if (pl.role === "attack") return pl.objective;
  const enemyRear = w.platoons[enemyOf(s.side)].rearY;
  return { x: s.x, y: Math.round((s.y + enemyRear) / 2) };
}

/** True if the sniper is fired on, or a shot came close: time to go. */
export function compromised(w: World, s: Soldier): boolean {
  return s.underFire !== null && w.tick - s.underFire.tick < 4;
}

/** True if he should look for a new hide. */
export function needsHide(w: World, s: Soldier): boolean {
  const cfg = w.config.sniper;
  if (!s.hide) return w.tick - s.hideTick > 30;
  // The house he was in has come down.
  if (!w.map.passable(s.hide.x, s.hide.y, s.hide.z ?? 0)) return true;
  if ((s.cooldowns["hideShots"] ?? 0) >= cfg.shotsPerHide) return true;
  if (compromised(w, s) && cheb(s, s.hide) === 0) return true;
  // While a wounded man lies in his sights, he stays put and waits.
  if (watchingWounded(w, s)) return false;
  return w.tick - s.hideTick > cfg.rethinkTicks;
}

/** A wounded enemy he can see: whoever comes to help him is the target. */
export function watchingWounded(w: World, s: Soldier): Soldier | null {
  for (const e of w.soldiers) {
    if (e.side === s.side || e.status !== "casualty" || e.carriedById !== null) continue;
    if (dist(e, s) > w.config.sniper.maxRange) continue;
    if (w.map.visibility(s.x, s.y, e.x, e.y, w.smoke, s.z, e.z) >= w.config.perception.minVisibility) return e;
  }
  return null;
}

/**
 * Picks a hide: around his present spot (for an attacker, somewhere behind
 * the leading squads), on the ground or upstairs in a house. It scores height
 * and view toward the watch point, how hidden the spot is, being in the range
 * band he shoots best at, being alone, and not being in known enemy sights.
 */
export function chooseHide(w: World, s: Soldier): Point | null {
  const cfg = w.config.sniper;
  const look = watchPoint(w, s);
  const ex = w.exposure[s.side];
  const pl = w.platoons[s.side];
  let center: Point = { x: s.x, y: s.y };
  if (pl.role === "attack") {
    // Not out in front of his own men: somewhere behind the leading squads.
    const line = pl.squadIds.flatMap((id) => w.squad(id).members.map((m) => w.soldier(m))).filter((m) => w.able(m));
    if (line.length > 0) {
      const lead = line.reduce((a, m) => (dist(m, look) < dist(a, look) ? m : a), line[0]!);
      const back = w.platoons[s.side].rearY > lead.y ? 1 : -1;
      center = { x: lead.x, y: Math.max(1, Math.min(w.map.height - 2, lead.y + back * 10)) };
    }
  }
  const R = cfg.hideRadius;
  let best: Point | null = null, bestScore = -Infinity;
  const consider = (p: Point) => {
    const z = p.z ?? 0;
    if (!w.isFree(p.x, p.y, s.id, z) || !w.map.reachable(s, p)) return;
    const d = dist(p, look);
    if (d < cfg.minRange * 0.6) return;
    const view = vantage(w, p, look);
    if (!canFireOn(w, p, look) && view < 0.2) return;
    let score = view;
    // Hidden: foliage, a dark room, a hedge at his side.
    const t = w.map.at(p.x, p.y);
    const hidden = z > 0 ? 0.3 : (w.config.terrain.concealment[t] ?? 1) * (w.map.besideCover(p.x, p.y) ? 0.4 : 1);
    score += (1 - hidden) * 0.6;
    // Farther up is better: an upper window or a tower.
    score += z * 0.18;
    // A belfry above everything: the best seat there is.
    if (z > 0 && w.map.isTower(p.x, p.y)) score += 0.5;
    if (z > 0 && !w.map.besideWindow(p.x, p.y) && t !== "stairs") score -= 0.4;
    // The range band he wants.
    if (d < cfg.minRange) score -= 0.4;
    else if (d > cfg.maxRange) score -= Math.min(0.6, (d - cfg.maxRange) * 0.01);
    // Alone, away from his own men who draw fire.
    if (w.soldiers.some((f) => f.side === s.side && f.id !== s.id && w.onField(f) && cheb(f, p) < cfg.alone)) score -= 0.3;
    score -= 0.35 * Math.min(1.5, ex[w.map.idx(p.x, p.y)]!);
    score -= dist(p, s) * 0.006;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  };
  for (let dy = -R; dy <= R; dy += 2) {
    for (let dx = -R; dx <= R; dx += 2) {
      const x = center.x + dx + (dy & 2 ? 1 : 0), y = center.y + dy;
      if (!w.map.inBounds(x, y) || !w.map.passable(x, y)) continue;
      const t = w.map.at(x, y);
      if (t === "water" || t === "road" || t === "bridge") continue;
      consider({ x, y });
    }
  }
  // Upstairs, by every window and in every tower within reach.
  for (const b of w.buildings) {
    if (b.floors < 2 && !(b.kind === "church")) continue;
    if (cheb({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, center) > R + 6) continue;
    for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
      for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
        for (let z = 1; z < MAX_FLOORS; z++) {
          if (!w.map.passable(x, y, z)) continue;
          if (!w.map.besideWindow(x, y) && !w.map.isTower(x, y)) continue;
          consider({ x, y, z });
        }
      }
    }
  }
  return best;
}

/**
 * How much a target is worth to a sniper, or 0 if not worth giving himself
 * away for. The enemy's sniper first, then machine gunners, then whoever
 * goes to a wounded man, then officers and radiomen.
 */
export function sniperPriority(w: World, s: Soldier, e: Soldier): number {
  if (e.role === "sniper") return 1.3;
  if (e.weapon === "mg42" || e.weapon === "bar") return 1.2;
  const helping = e.act && (e.act.cand.kind === "aid" || e.act.cand.kind === "carry");
  if (e.role === "medic" || helping) return 1;
  if (e.role === "platoon_leader" || e.role === "squad_leader") return 0.85;
  if (e.role === "radioman" || e.role === "platoon_sergeant") return 0.7;
  if (e.role === "machine_gunner" || e.role === "auto_rifleman" || e.role === "asst_gunner") return 0.6;
  return 0.2;
}

/** Whether he is hidden enough where he is that a man who sees him did so by luck. */
export function wellHidden(w: World, s: Soldier): boolean {
  return concealment(w, s) < 0.4;
}
