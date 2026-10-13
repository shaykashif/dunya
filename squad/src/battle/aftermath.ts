// Thirty days on. The wounded are collected after the shooting stops; those
// still bleeding may not last the trip to the aid station. Then a month of
// healing under the doctors, with the same wound rules as ever: festering,
// mending, and the marks that stay.
import { bleedingOf } from "../entities/body.ts";
import { describeInjury, healDay } from "../entities/injuries.ts";
import type { SimEvent } from "../log/events.ts";
import type { Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";

export function aftermath(w: World): void {
  const rng = w.rng.get("aftermath");
  const quiet = Object.create(w) as World;
  quiet.emit = () => ({ seq: -1, tick: w.tick, type: "quiet", actors: [], data: {} }) as SimEvent;
  const cfg = w.config;
  const out: NonNullable<World["aftermath"]> = {};
  for (const s of w.soldiers) {
    if (s.status === "dead" || s.injuries.length === 0) continue;
    const p = structuredClone(s) as Soldier;
    // Collecting the wounded takes time; untended bleeding goes on.
    const minutes = s.status === "routed" ? 10 : 25;
    const lost = bleedingOf(p) * cfg.injuries.bleedHealthPerMinute * minutes * 0.6;
    p.survival.health = Math.max(0, p.survival.health - lost);
    let died = p.survival.health <= 0;
    let day = 0;
    let fit = -1;
    while (!died && day < cfg.aftermath.days) {
      day++;
      healDay(quiet, p, rng, cfg.aftermath.aidStationCare);
      if (p.survival.health <= 0) died = true;
      else if (fit < 0 && p.injuries.every((i) => i.permanent) && p.survival.health > 0.75) fit = day;
    }
    const lasting = p.injuries.filter((i) => i.permanent).map((i) => describeInjury(i));
    const serious = lasting.some((l) => l === "lame" || l === "ruined face" || l === "lost eye" || l === "maimed hand" || l === "crooked arm" || l === "dented skull");
    let outcome: string;
    if (died) outcome = day === 0 ? "died of his wounds before reaching the aid station" : p.lossCause.infection > 0.05 ? `died of a festering wound ${day} days later` : `died of his wounds ${day} days later`;
    else if (serious) outcome = `will never fight again: ${lasting.join(", ")}`;
    else if (fit > 0) outcome = s.status === "captured" ? `recovered in a prisoner-of-war hospital after ${fit} days` : `back with the platoon after ${fit} days`;
    else if (s.status === "captured") outcome = "still in a prisoner-of-war hospital a month on";
    else outcome = "still in hospital a month on";
    out[s.id] = { outcome, lasting, died };
  }
  w.aftermath = out;
  w.emit("aftermath", [], { days: cfg.aftermath.days, died: Object.values(out).filter((o) => o.died).length, crippled: Object.values(out).filter((o) => !o.died && o.lasting.length > 0).length });
}
