// Major events that stop the clock, Dwarf Fortress style.
import type { SimEvent } from "../../src/log/events.ts";
import type { World } from "../../src/world/world.ts";
import { first } from "./feed.ts";

export type AlertKind = "fight" | "death" | "council" | "raid" | "madness" | "kidnap" | "wolf" | "love" | "retribution" | "injury";

export const ALERT_LABELS: Record<AlertKind, string> = {
  fight: "Fights",
  death: "Deaths",
  council: "Council sessions",
  raid: "Raids",
  madness: "Madness",
  kidnap: "Kidnappings",
  wolf: "Wolf attacks",
  retribution: "Revenge & threats",
  injury: "Crippling injuries",
  love: "Marriages & elopements",
};

export interface Alert {
  id: number;
  tick: number;
  kind: AlertKind;
  icon: string;
  title: string;
  text: string;
  at: [number, number] | null;
  people: number[];
  hearingId?: number;
  blows?: { by: number; hit: boolean; damage: number }[];
  attacker?: number;
  victim?: number;
  weapon?: string;
}

let nextId = 1;

export function toAlert(e: SimEvent, w: World): Alert | null {
  const d = e.data;
  const at = (x: unknown): [number, number] | null => (Array.isArray(x) ? (x as [number, number]) : null);
  const posOf = (id: unknown): [number, number] | null => {
    const p = w.maybePerson(id as number);
    return p ? [p.x, p.y] : null;
  };
  const make = (kind: AlertKind, icon: string, title: string, text: string, where: [number, number] | null, people: unknown[], extra: Partial<Alert> = {}): Alert => ({
    id: nextId++,
    tick: e.tick,
    kind,
    icon,
    title,
    text,
    at: where,
    people: people.filter((x): x is number => typeof x === "number"),
    ...extra,
  });
  switch (e.type) {
    case "attack":
      return make(
        "fight",
        "⚔",
        "Fight!",
        `${first(w, d.attacker)} attacked ${first(w, d.victim)}${d.weapon === "musket" ? " with a musket" : ""} (${d.motive}). ${first(w, d.victim)} chose to ${d.response === "fight" ? "fight back" : d.response === "flee" ? "run" : "give in"}.`,
        posOf(d.victim) ?? posOf(d.attacker),
        [d.attacker, d.victim],
        { blows: d.blows as Alert["blows"], attacker: d.attacker as number, victim: d.victim as number, weapon: String(d.weapon) },
      );
    case "death":
      return make("death", "☠", "Death", `${first(w, d.person)} has died${d.cause === "unknown" ? ", struck down from above" : d.cause === "animal" ? ", savaged by wolves" : d.killer ? ` at the hands of ${first(w, d.killer)}` : ` of ${d.cause}`}.`, at(d.at), [d.person, d.killer]);
    case "hearing_opened":
      return make("council", "⚖", "The council convenes", `${first(w, d.accused)} stands before the council at the courthouse.`, [w.map.meeting.x, w.map.meeting.y], [d.accused], { hearingId: d.hearing as number });
    case "raid_mustered":
      return make("raid", "🔥", "Raid!", `The ${w.households[w.person((d.raiders as number[])[0]!).householdId]?.name} house rides out against the ${w.households[d.targetHousehold as number]?.name} house.`, posOf((d.raiders as number[])[0]), d.raiders as number[]);
    case "went_mad":
      return make("madness", "🌀", "Madness", `${first(w, d.person)} has gone mad (${d.kind}): ${d.cause}.`, posOf(d.person), [d.person]);
    case "kidnapping":
      return make("kidnap", "⛓", "Kidnapping!", `${first(w, d.kidnapper)} has snatched ${first(w, d.child)}.`, at(d.at), [d.kidnapper, d.child]);
    case "wolf_attack":
      return make("wolf", "🐺", "Wolf attack!", `A wolf attacked ${first(w, d.person)}, who ${d.response === "fight" ? "fights back" : "runs"}, screaming.`, at(d.at), [d.person]);
    case "plot_formed":
      if (d.kind !== "retribution") return null;
      return make("retribution", "🗡", "Vengeance", `${first(w, d.planner)} means ${d.severity === "kill" ? "to kill" : d.severity === "maim" ? "to cripple" : "to frighten"} ${first(w, d.target)}, whom the council acquitted.`, posOf(d.planner), [d.planner, d.target]);
    case "intimidation":
      return make("retribution", "😠", "Threat", `${first(w, d.by)} threatened ${first(w, d.target)}.`, at(d.at), [d.by, d.target]);
    case "accident":
      return d.canWalk ? null : make("injury", "🩹", "Crippled", `${first(w, d.person)} ${d.cause} and cannot walk.`, at(d.at), [d.person]);
    case "injury_lasting":
      return make("injury", "🩹", "Lasting injury", `${first(w, d.person)}'s ${d.part} healed badly: ${d.lasting}.`, posOf(d.person), [d.person]);
    case "elopement":
      return make("love", "💘", "Elopement", `${first(w, d.a)} and ${first(w, d.b)} have run away together, defying their elders.`, posOf(d.a), [d.a, d.b]);
    case "marriage_forbidden":
      return make("love", "💔", "Marriage forbidden", `The elders forbade ${first(w, d.a)} and ${first(w, d.b)} to marry.`, posOf(d.a), [d.a, d.b]);
    default:
      return null;
  }
}
