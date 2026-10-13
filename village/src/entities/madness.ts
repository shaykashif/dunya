// Madness: tragedy, long loneliness, or plain bad luck can unhinge a person.
import { interruptPlan } from "../engine/plans.ts";
import { r3 } from "../log/events.ts";
import type { MadKind, Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { cheb, clamp01, feel, firstName, householdMembers } from "./person.ts";

/** The shape madness takes follows temperament. */
export function madKindFor(p: Person): MadKind {
  const t = p.personality;
  if (t.boldness > 0.55 && t.empathy < 0.45) return "rampage";
  if (t.greed > 0.6) return "thief";
  if (t.empathy < 0.5) return "kidnapper";
  return "wanderer";
}

export function makeMad(w: World, p: Person, cause: string, kind?: MadKind): void {
  if (!p.alive || p.exiled || p.mad) return;
  p.mad = kind ?? madKindFor(p);
  p.madness = Math.max(p.madness, w.config.madness.threshold + 0.2);
  interruptPlan(w, p, "madness");
  w.emit("went_mad", [p.id], { person: p.id, kind: p.mad, cause });
  feel(w, p, "unhinged", cause, 1);
}

export function recover(w: World, p: Person): void {
  if (!p.mad) return;
  const was = p.mad;
  p.mad = null;
  p.madness = r3(Math.min(p.madness, w.config.madness.recoverBelow - 0.05));
  w.emit("recovered", [p.id], { person: p.id, was });
  feel(w, p, "relieved", "the fog of madness lifted", 0.6);
  releaseCaptives(w, p.id, "the kidnapper came to their senses");
}

export function releaseCaptives(w: World, captorId: number, reason: string): void {
  for (const c of w.people) {
    if (c.captorId !== captorId) continue;
    c.captorId = null;
    w.emit("captive_released", c.alive && !c.exiled ? [c.id] : [], { person: c.id, captor: captorId, reason });
    if (c.alive && !c.exiled) feel(w, c, "relieved", "they were let go", 0.8);
  }
}

/**
 * Daily: grief and loneliness push toward madness, rare bad luck tips someone
 * over, and the mad slowly come back to themselves. Each tick, captives are
 * kept beside their captor and missing children are missed.
 */
export function madnessStep(w: World): void {
  const cfg = w.config.madness;
  const rng = w.rng.get("bonding");
  for (const c of w.people) {
    if (c.captorId === null || !c.alive || c.exiled) continue;
    const captor = w.maybePerson(c.captorId);
    if (!captor || !w.isActive(captor.id) || !captor.mad) {
      releaseCaptives(w, c.captorId, "the captor is gone");
      continue;
    }
    c.plan = null;
    if (cheb(c, captor) > 1) {
      const spot = w.freeTileNear(captor, 2, c.id);
      if (spot) w.place(c, spot.x, spot.y);
    }
  }

  // At nightfall, a family notices a child who has not come home.
  if (w.env.minuteOfDay === 20 * 60) {
    for (const c of w.people) {
      if (c.captorId === null || !c.alive || c.exiled) continue;
      for (const m of householdMembers(w, c.householdId)) {
        if (m.id === c.id || w.ageYears(m) < 14) continue;
        if (!m.cooldowns[`search:${c.id}`]) {
          feel(w, m, "afraid", `${firstName(c)} has gone missing`, 0.8);
          if (m.isHead) w.emit("missing_person", [m.id], { person: c.id, reportedBy: m.id });
        }
        m.cooldowns[`search:${c.id}`] = w.tick + w.days(3);
      }
    }
  }

  if (w.env.minuteOfDay !== 0) return;
  for (const p of w.active()) {
    if (w.ageYears(p) < 14) continue;
    if (p.mad) {
      p.madness = clamp01(p.madness - cfg.recoveryPerDay);
      if (p.madness < cfg.recoverBelow) recover(w, p);
      continue;
    }
    p.lonelyDays = p.wants.companionship < 0.12 ? p.lonelyDays + 1 : Math.max(0, p.lonelyDays - 1);
    if (p.lonelyDays >= cfg.lonelyDays) p.madness += cfg.lonelyPushPerDay;
    if (p.emotions.grief >= cfg.griefTrigger) p.madness += cfg.griefPush * rng.next();
    p.madness = r3(clamp01(p.madness - 0.01));
    if (rng.chance(cfg.randomPerDay)) p.madness = Math.max(p.madness, cfg.threshold);
    if (p.madness >= cfg.threshold) {
      const cause = p.emotions.grief >= cfg.griefTrigger ? "grief broke their mind" : p.lonelyDays >= cfg.lonelyDays ? "too long alone" : "something snapped, for no reason anyone could see";
      makeMad(w, p, cause);
    }
  }
}
