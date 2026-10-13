// Suppression and morale. Incoming fire presses men down; losses, wounds and
// being pinned wear away the will to fight, and leaders nearby restore it.
import { r3 } from "../log/events.ts";
import { cheb } from "../world/map.ts";
import type { Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { clamp01, isLeader, note, shout } from "./soldier.ts";

/** Steadiness from experience: veterans shrug off what pins a green man. */
function steadiness(s: Soldier): number {
  const lead = s.role === "squad_leader" || s.role === "platoon_leader" || s.role === "platoon_sergeant" ? 0.75 : 1;
  return (s.experience === "veteran" ? 0.8 : s.experience === "green" ? 1.2 : 1) * (1.25 - 0.5 * s.traits.nerve) * lead;
}

/** Adds suppression from rounds landing near a man. */
export function suppress(w: World, s: Soldier, amount: number): void {
  if (s.status !== "active") return;
  s.suppression = clamp01(s.suppression + amount * steadiness(s));
}

export function shakeMorale(w: World, s: Soldier, amount: number): void {
  if (s.status === "dead") return;
  s.morale = clamp01(s.morale - amount * steadiness(s));
}

/** A man is hit or killed: those around him who see it are shaken, more so if he led them. */
export function moraleOnLoss(w: World, victim: Soldier, killed: boolean): void {
  const cfg = w.config.morale;
  const squad = w.squad(victim.squadId);
  const leader = squad.leaderId === victim.id || victim.role === "platoon_leader";
  for (const o of w.soldiers) {
    if (o.id === victim.id || o.status !== "active") continue;
    if (o.side !== victim.side) {
      // The enemy takes heart.
      if (cheb(o, victim) <= 60 && o.sees.includes(victim.id)) o.morale = clamp01(o.morale + cfg.enemyDown);
      continue;
    }
    const d = cheb(o, victim);
    const sameSquad = o.squadId === victim.squadId;
    // Men see a comrade fall close by, or hear of it in their own squad.
    if (d > 12 && !(sameSquad && d <= 30) && !(leader && sameSquad)) continue;
    let hit = (killed ? cfg.friendKilled : cfg.friendHit) * (d <= 6 ? 1.3 : 1);
    if (leader && (sameSquad || victim.role === "platoon_leader")) hit += cfg.leaderDown;
    // Losses in quick succession numb as much as they shake: each further one in a short spell counts for less.
    const since = o.cooldowns["lossTick"] ?? -100;
    const n = w.tick - since <= 15 ? (o.cooldowns["lossN"] ?? 0) + 1 : 0;
    o.cooldowns["lossTick"] = w.tick;
    o.cooldowns["lossN"] = n;
    shakeMorale(w, o, hit / (1 + 0.8 * n));
  }
  if (leader && squad.leaderId === victim.id) {
    for (const id of squad.members) {
      const m = w.maybe(id);
      if (m && m.status === "active") m.confusedUntil = Math.max(m.confusedUntil, w.tick + cfg.confusionTicks);
    }
  }
}

/**
 * Engine rule each tick: suppression ebbs, sustained fire wears down morale,
 * quiet and leaders bring it back, and men are marked pinned or broken.
 */
export function moraleStep(w: World): void {
  const cfg = w.config.morale;
  const sup = w.config.suppression;
  for (const s of w.soldiers) {
    if (s.status !== "active") continue;
    const cover = w.map.besideCover(s.x, s.y) || w.map.at(s.x, s.y) === "foxhole" || w.map.indoors(s.x, s.y);
    s.suppression = Math.max(0, s.suppression - sup.decay * (cover ? 1.3 : 1) * (s.experience === "veteran" ? 1.2 : 1));
    const underFire = s.underFire !== null && w.tick - s.underFire.tick < 5;
    if (underFire && s.suppression > 0.5) s.morale = clamp01(s.morale - cfg.underFirePerTick * steadiness(s));
    else if (!underFire) s.morale = clamp01(s.morale + cfg.recoverPerTick * (0.5 + s.traits.nerve));
    // A leader close by steadies men.
    if (!isLeader(s) || s.morale < cfg.shaken) {
      for (const l of w.friendsNear(s, cfg.rallyRange)) {
        if (!isLeader(l) || !w.able(l) || l.broken) continue;
        s.morale = clamp01(s.morale + cfg.rallyPerTick * 0.25 * l.traits.leadership);
        break;
      }
    }
    const wasPinned = s.pinned, wasBroken = s.broken;
    s.pinned = s.suppression >= sup.pinned;
    s.broken = s.morale < cfg.broken || (wasBroken && s.morale < cfg.broken + 0.1);
    if (s.pinned && !wasPinned) {
      s.posture = "prone";
      w.emit("pinned", [s.id], { person: s.id, suppression: r3(s.suppression) });
      note(w, s, "pinned down by fire");
    }
    if (s.broken && !wasBroken) {
      w.emit("broken", [s.id], { person: s.id, morale: r3(s.morale) });
      note(w, s, "lost his nerve");
      shout(w, s, s.side === "us" ? "I can't — I gotta get out of here!" : "Ich kann nicht mehr!", "broke", 200);
    }
  }
}

/** A leader shouts the men around him back into the fight. */
export function rally(w: World, leader: Soldier): number {
  const cfg = w.config.morale;
  let n = 0;
  for (const s of w.friendsNear(leader, cfg.rallyRange + 3)) {
    if (s.status !== "active") continue;
    s.morale = clamp01(s.morale + cfg.rallyPerTick * 4 * (0.5 + leader.traits.leadership));
    s.suppression = Math.max(0, s.suppression - 0.08 * leader.traits.leadership);
    n++;
  }
  if (n > 0) {
    w.emit("rally", [leader.id], { by: leader.id, men: n });
    note(w, leader, `rallied ${n} men`);
  }
  return n;
}
