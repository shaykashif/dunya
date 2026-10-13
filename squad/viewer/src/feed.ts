// Turns engine events into lines of the battle log.
import { describeInjury } from "../../src/entities/injuries.ts";
import type { SimEvent } from "../../src/log/events.ts";
import type { Injury, Role, Soldier } from "../../src/world/types.ts";
import type { World } from "../../src/world/world.ts";

export type Category = "battle" | "us" | "de" | "death" | "wound" | "order" | "voice" | "medic" | "fire";

export interface FeedLine {
  tick: number;
  text: string;
  cat: Category;
  people: number[];
  /** Shown in the Events tab as well as the full log. */
  major: boolean;
}

export const ROLE_NAMES: Record<Role, { us: string; de: string }> = {
  platoon_leader: { us: "platoon leader", de: "Zugführer" },
  platoon_sergeant: { us: "platoon sergeant", de: "Zugtruppführer" },
  radioman: { us: "radio operator", de: "Funker" },
  medic: { us: "aidman", de: "Sanitäter" },
  squad_leader: { us: "squad leader", de: "Gruppenführer" },
  asst_leader: { us: "assistant squad leader", de: "Truppführer" },
  scout: { us: "scout", de: "Späher" },
  rifleman: { us: "rifleman", de: "Schütze" },
  grenadier: { us: "rifle grenadier", de: "Gewehrgranatschütze" },
  auto_rifleman: { us: "BAR man", de: "MG-Schütze" },
  machine_gunner: { us: "machine gunner", de: "MG-Schütze 1" },
  asst_gunner: { us: "assistant BAR man", de: "MG-Schütze 2" },
  ammo_bearer: { us: "ammunition bearer", de: "MG-Schütze 3" },
  sniper: { us: "sniper", de: "Scharfschütze" },
};

export function roleName(s: Soldier): string {
  return ROLE_NAMES[s.role][s.side];
}

export function label(s: Soldier): string {
  return `${s.abbr} ${s.last}`;
}

export function clock(w: World, tick: number): string {
  return w.clock(tick).slice(0, 8);
}

export function bearing(dx: number, dy: number): string {
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const dirs = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return dirs[(Math.round(a / 45) + 8) % 8]!;
}

/** The worst wound, in words. */
export function worstWound(s: Soldier): Injury | null {
  let best: Injury | null = null;
  for (const i of s.injuries) if (!i.permanent && (!best || i.severity > best.severity)) best = i;
  return best;
}

export function describe(e: SimEvent, w: World): FeedLine | null {
  const d = e.data;
  const s = (k: string) => w.maybe(d[k] as number);
  const line = (text: string, cat: Category, people: number[], major = false): FeedLine => ({ tick: e.tick, text, cat, people, major });
  switch (e.type) {
    case "battle_start": {
      const att = w.platoons[w.attacker], def = w.platoons[w.attacker === "us" ? "de" : "us"];
      return line(`${w.config.time.date}, dawn. ${att.name} (${w.side(att.side).length} men) moves up through the hedgerows to take the crossroads hamlet, held by ${def.name} (${w.side(def.side).length} men).`, "battle", [], true);
    }
    case "contact": {
      const sq = w.squads[d.squad as number]!;
      const [x, y] = d.at as [number, number];
      const c = w.maybe(sq.leaderId) ?? w.soldier(sq.members[0]!);
      const dist = Math.round(Math.hypot(x - c.x, y - c.y) * 3);
      return line(`${sq.name} makes contact: ${d.automatic ? "a machine gun" : "the enemy"} ${d.visible ? "seen" : "heard"} ${dist} m to the ${bearing(x - c.x, y - c.y)}.`, sq.side, [], true);
    }
    case "squad_state": {
      const sq = w.squads[d.squad as number]!;
      const to = d.to as string;
      const major = ["flank", "assault", "fall_back", "withdraw", "consolidate", "fix"].includes(to);
      return line(`${sq.name}: ${d.intent as string}.`, sq.side, [], major);
    }
    case "death": {
      const p = s("person");
      if (!p) return null;
      const killer = s("killer");
      const last = p.injuries[p.injuries.length - 1];
      const how = d.cause === "wounds" ? "dies of his wounds" : last ? `is killed — ${last.cause.startsWith("a ") ? "" : "hit by "}${last.cause}` : killer ? `is killed by ${label(killer)}` : "is killed";
      return line(`${label(p)}, ${roleName(p)}, ${how}.`, "death", killer ? [p.id, killer.id] : [p.id], true);
    }
    case "casualty": {
      const p = s("person");
      if (!p) return null;
      const wnd = worstWound(p);
      const state = !d.conscious ? "unconscious" : !d.canWalk ? "cannot walk" : "out of the fight";
      return line(`${label(p)} is down: ${wnd ? describeInjury(wnd) : "wounded"}, ${state}.`, "wound", [p.id], true);
    }
    case "passed_out": {
      const p = s("person");
      return p ? line(`${label(p)} passes out from loss of blood.`, "wound", [p.id]) : null;
    }
    case "back_in_action": {
      const p = s("person");
      return p ? line(`${label(p)} grits his teeth and gets back into the fight.`, p.side, [p.id]) : null;
    }
    case "fire_mission": {
      const r = s("by");
      if (!r) return null;
      const [x, y] = d.at as [number, number];
      const what = d.side === "us" ? "60 mm mortars" : "the 8 cm mortars";
      return line(`${label(r)} calls ${what} down on the enemy at ${x},${y}. (${d.left as number} missions left)`, "fire", [r.id], true);
    }
    case "check_fire":
      return line(`Check fire! A mortar mission is called off: friendly troops too close.`, "fire", [], true);
    case "surrender": {
      const p = s("person");
      return p ? line(`${label(p)} throws down his weapon and surrenders.`, "battle", [p.id], true) : null;
    }
    case "captured": {
      const a = s("by"), p = s("prisoner");
      if (p && !a) return line(`${label(p)} is left behind wounded and taken prisoner.`, "battle", [p.id]);
      return a && p ? line(`${label(a)} takes ${label(p)} prisoner.`, a.side, [a.id, p.id], true) : null;
    }
    case "left_field": {
      const p = s("person");
      if (!p) return null;
      const r = d.reason as string;
      if (r === "fled") return line(`${label(p)} breaks and runs for the rear.`, p.side, [p.id], true);
      if (r === "walked back wounded") return line(`${label(p)} limps back to the aid post.`, "wound", [p.id]);
      return line(`${label(p)} pulls back off the field.`, p.side, [p.id]);
    }
    case "broken": {
      const p = s("person");
      return p ? line(`${label(p)}'s nerve gives way.`, p.side, [p.id], true) : null;
    }
    case "takes_command": {
      const p = s("by");
      const sq = w.squads[d.squad as number]!;
      return p ? line(`${label(p)} takes command of ${sq.name}.`, p.side, [p.id], true) : null;
    }
    case "open_fire": {
      const sq = w.squads[d.squad as number]!;
      return line(`${sq.name} opens fire from the hedgerow.`, sq.side, [], true);
    }
    case "platoon_order": {
      const sq = w.squads[d.squad as number]!, help = w.squads[d.help as number]!;
      return line(`The platoon leader sends ${sq.name} round the flank to help ${help.name}.`, sq.side, [], true);
    }
    case "weapon_taken": {
      const p = s("by");
      return p ? line(`${label(p)} takes over the ${w.config.weapons[d.weapon as keyof typeof w.config.weapons].name}.`, p.side, [p.id], true) : null;
    }
    case "wounds_treated": {
      const a = s("by"), p = s("person");
      if (!a || !p || a.role !== "medic") return null;
      return line(`${label(a)} dresses ${label(p)}'s wounds${d.morphine ? " and gives him a syrette of morphine" : ""}.`, "medic", [a.id, p.id]);
    }
    case "picked_up": {
      const a = s("carrier"), p = s("person");
      return a && p ? line(`${label(a)} hoists ${label(p)} onto his shoulders and carries him back.`, "medic", [a.id, p.id]) : null;
    }
    case "position_taken": {
      const sq = w.squads[d.squad as number]!;
      return line(`${sq.name} overruns the enemy position.`, sq.side, [], true);
    }
    case "platoon_withdraws": {
      const pl = w.platoons[d.side as "us" | "de"];
      return line(`${pl.name} ${pl.role === "attack" ? "calls off the attack" : "abandons the position"}: too few men left to fight.`, "battle", [], true);
    }
    case "battle_end":
      return line(`The fighting dies down at ${d.clock as string}: ${d.reason as string}.`, "battle", [], true);
    case "callout": {
      const p = s("by");
      // Cries for the medic float over the wounded; the log would be nothing else.
      if (d.text === "Medic!" || d.text === "Sanitäter!") return null;
      return p ? line(`${label(p)}: “${d.text as string}”`, "voice", [p.id]) : null;
    }
    case "friendly_fire": {
      const a = s("by"), v = s("victim");
      return a && v ? line(`${label(a)}'s burst hits ${label(v)} by mistake!`, "wound", [a.id, v.id], true) : null;
    }
    case "intervention":
      return line(
        d.kind === "artillery" ? "Shells come howling in from far behind the lines." : d.kind === "smoke" ? "Smoke shells burst and a white wall rolls across the fields." : "A single shot cracks out from somewhere unseen.",
        "fire",
        [],
        true,
      );
    case "rally": {
      const p = s("by");
      return p ? line(`${label(p)} rallies ${d.men as number} men.`, p.side, [p.id]) : null;
    }
    case "infection":
      return null;
    default:
      return null;
  }
}
