// Template text for the chronicle and the council transcripts. No language model: every line is a template over an event.
import type { SimEvent } from "../../src/log/events.ts";
import type { EntityRef, HolderRef } from "../../src/world/types.ts";
import type { World } from "../../src/world/world.ts";

export type Category = "crime" | "justice" | "love" | "life" | "death" | "weather" | "village" | "intrigue" | "danger" | "health";

export interface FeedLine {
  tick: number;
  category: Category;
  text: string;
  people: number[];
  badge?: string;
  at?: [number, number];
}

export function first(w: World, id: unknown): string {
  const p = w.maybePerson(id as number);
  return p ? p.name.split(" ")[0]! : "someone";
}

export function holderName(w: World, h: HolderRef): string {
  switch (h.t) {
    case "communal": return "the communal store";
    case "household": return `the ${w.households[h.id]!.name} house`;
    case "farm": return `the ${w.households[h.id]!.name} farm`;
    case "person": return first(w, h.id);
    default: return h.t;
  }
}

export function refName(w: World, r: unknown): string {
  if (r === null || r === undefined) return "someone";
  if (typeof r === "string" || typeof r === "number") return String(r);
  const e = r as EntityRef;
  switch (e.kind) {
    case "person": return first(w, e.id);
    case "unknown": return e.sizeClass === "small" ? "a small figure" : "a figure";
    case "holder": return holderName(w, e.holder);
    case "place": return "a spot";
    default: return "something";
  }
}

export function clock(w: World, tick: number): string {
  const cfg = w.config.time;
  const min = cfg.startHour * 60 + tick * cfg.minutesPerTick;
  const day = Math.floor(min / 1440);
  const m = min % 1440;
  return `D${day + 1} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const LABELS: Record<string, string> = {
  store: "inside the communal store",
  outdoors_night: "outside after dark",
  near_body: "near a body",
  near_blood: "near blood",
  scene: "at the scene",
  bloody_tool: "seen carrying a bloody tool",
  bloody_clothes: "seen with blood on their clothes",
};

/** A claim as a witness would put it. */
export function claimText(w: World, c: { subject: unknown; predicate: string; object: unknown; time: number; confidence?: number }): string {
  const raw = refName(w, c.subject);
  const s = raw.charAt(0).toUpperCase() + raw.slice(1);
  const when = `around ${clock(w, c.time).split(" ")[1]} on day ${clock(w, c.time).split(" ")[0]!.slice(1)}`;
  const obj = refName(w, c.object);
  const sure = c.confidence === undefined ? "" : c.confidence >= 0.7 ? "" : c.confidence >= 0.4 ? " (not certain)" : " (unsure)";
  switch (c.predicate) {
    case "took": return `"I saw ${s} take food from ${obj} ${when}."${sure}`;
    case "attempted_theft": return `"${s} tried to steal from ${obj} ${when}."${sure}`;
    case "attacked": return `"${s} attacked ${obj} ${when}."${sure}`;
    case "killed": return `"${s} killed ${obj} ${when}."${sure}`;
    case "was_at": {
      const label = typeof c.object === "string" ? (c.object.startsWith("house:") ? `inside the ${w.households[Number(c.object.slice(6))]?.name ?? "other"} house` : LABELS[c.object] ?? c.object) : "nearby";
      return `"${s} was ${label} ${when}."${sure}`;
    }
    case "hungry": return `"${s} was going hungry, begging for food ${when}."`;
    case "seen_bloody": return `"${s} had blood on their ${obj} ${when}."${sure}`;
    case "washing_blood": return `"${s} was washing blood off their ${obj} ${when}."${sure}`;
    case "heard_noise": return `"I heard a ${obj} ${when}."`;
    case "trace_found": {
      const what =
        obj === "item_missing" ? `food missing from ${s}` : obj === "object_left" ? `something left behind by ${s}` : obj === "footprint" ? "footprints" : obj === "body" ? `${s}'s body` : obj === "wound" ? `wounds on ${s}` : obj === "blood" ? "blood on the ground" : obj;
      return `"I found ${what} ${when}."`;
    }
    case "accused_of": return `"${s} did it."`;
    default: return `"${s} ${c.predicate} ${obj}."`;
  }
}

const WEATHER_TEXT: Record<string, string> = {
  storm: "A storm rolls in.",
  snow: "Snow begins to fall.",
};
let lastWeatherLine = -Infinity;

export function resetFeed(): void {
  lastWeatherLine = -Infinity;
}

export function describe(e: SimEvent, w: World): FeedLine | null {
  const d = e.data;
  const at = Array.isArray(d.at) ? (d.at as [number, number]) : undefined;
  const line = (category: Category, text: string, people: unknown[] = [], badge?: string): FeedLine => ({
    tick: e.tick,
    category,
    text,
    people: people.filter((x): x is number => typeof x === "number"),
    ...(badge ? { badge } : {}),
    ...(at ? { at } : {}),
  });
  switch (e.type) {
    case "theft":
      return line("crime", `${first(w, d.thief)} stole food from ${holderName(w, d.victim as HolderRef)}.`, [d.thief]);
    case "theft_failed":
      return line("crime", `${first(w, d.noticedBy)} caught ${first(w, d.thief)} stealing.`, [d.thief, d.noticedBy]);
    case "chase_started":
      return line("crime", `${first(w, d.chaser)} is chasing ${first(w, d.thief)}!`, [d.chaser, d.thief]);
    case "escaped":
      return line("crime", `${first(w, d.thief)} got away${d.chaser ? ` from ${first(w, d.chaser)}` : ""}.`, [d.thief, d.chaser]);
    case "apprehended":
      return line("justice", `${first(w, d.chaser)} caught ${first(w, d.thief)} and hauled them before the council.`, [d.chaser, d.thief]);
    case "attack": {
      const outcome = d.outcome === "victim_killed" ? `, killing them` : d.outcome === "attacker_killed" ? ` and was killed in self-defence` : d.outcome === "victim_fled" ? `; ${first(w, d.victim)} fled` : "";
      return line("crime", `${first(w, d.attacker)} attacked ${first(w, d.victim)}${d.weapon === "musket" ? " with a musket" : d.weapon === "tool" ? " with a tool" : ""} (${d.motive})${outcome}.`, [d.attacker, d.victim]);
    }
    case "death": {
      const cause = String(d.cause);
      const how = cause === "unknown" ? "suddenly, with no mark on them" : `of ${cause === "animal" ? "a wolf attack" : cause}`;
      const killer = d.killer !== null && d.killer !== undefined && cause !== "execution" ? `, killed by ${first(w, d.killer)}` : "";
      return line("death", `${first(w, d.person)} died ${how}${killer}.`, [d.person]);
    }
    case "body_found":
      return line("death", `${first(w, d.finder)} found the body of ${first(w, d.person)}.`, [d.finder, d.person]);
    case "body_read": {
      const tr = w.traces.find((t) => t.id === d.trace);
      const who = tr?.involves.find((r) => r.kind === "person");
      const name = who && who.kind === "person" ? first(w, who.id) : "the dead";
      const cause = String(d.apparent);
      const read = cause === "person" ? "someone killed them" : cause === "wolf" ? "a wolf got them" : cause === "unknown" ? "there is no mark on them" : `they died of ${cause}`;
      return line("death", `${first(w, d.observer)} ${d.careful ? "examined" : "looked at"} ${name}'s body: ${read}.`, [d.observer]);
    }
    case "burial":
      return line("death", `${first(w, d.person)} was buried.`, [d.person]);
    case "accusation":
      return line("justice", `${first(w, d.accuser)} accused ${first(w, d.accused)} of ${d.kind}.`, [d.accuser, d.accused]);
    case "recusal":
      return line("justice", `The elder ${first(w, d.elder)} stepped aside: kin of the accused or the victim.`, [d.elder]);
    case "hearing_opened":
      return line("justice", `The council convenes at the courthouse: ${first(w, d.accused)} stands accused.`, [d.accused, ...(d.judges as number[])]);
    case "verdict": {
      const judges = (d.judges as number[]).map((j) => first(w, j)).join(", ");
      const truth = d.truth as { correct: boolean | null; culprit: number | null };
      const verdict = d.verdict === "guilty" ? `guilty${d.degree === "first" ? " of first-degree murder" : ""}${d.sentence ? `, sentenced to ${d.sentence === "imprisonment" && d.degree === "first" ? "long imprisonment" : d.sentence}` : ""}` : "not guilty";
      const badge = truth.correct === false ? (d.verdict === "guilty" ? "WRONGFUL" : "culprit walks") : undefined;
      return line("justice", `The council (${judges}) found ${first(w, d.accused)} ${verdict}.`, [d.accused, ...(d.judges as number[])], badge);
    }
    case "verdict_disputed":
      return line("justice", `${first(w, d.by)} calls the verdict unjust.`, [d.by]);
    case "sentence_enforced":
      return line("justice", `${first(w, d.convict)}'s sentence of ${d.kind} was carried out.`, [d.convict]);
    case "enforcement_failed":
      return line("justice", `The family of ${first(w, d.convict)} resisted the sentence.`, [d.convict, d.resister]);
    case "exiled":
      return line("justice", `${first(w, d.person)} was exiled from the village.`, [d.person]);
    case "confession":
      return line("justice", `${first(w, d.speaker)} confessed.`, [d.speaker]);
    case "courtship_started":
      return line("love", `${first(w, d.suitor)} is courting ${first(w, d.accepted)}.`, [d.suitor, d.accepted]);
    case "pair_bond_formed":
      return d.eloped ? null : line("love", `${first(w, d.proposer)} and ${first(w, d.accepter)} are married, with their elders' blessing.`, [d.proposer, d.accepter]);
    case "marriage_forbidden":
      return line("love", `The elders forbade ${first(w, d.a)} and ${first(w, d.b)} to marry.`, [d.a, d.b, ...(d.forbiddenBy as number[])]);
    case "elopement":
      return line("love", `${first(w, d.a)} and ${first(w, d.b)} have run away together!`, [d.a, d.b]);
    case "break_up":
      return line("love", `${first(w, d.initiator)} broke up with ${first(w, d.other)}.`, [d.initiator, d.other]);
    case "affair":
      return line("love", `${first(w, d.a)} and ${first(w, d.b)} are having an affair.`, [d.a, d.b]);
    case "jealousy":
      return line("love", `${first(w, d.holder)} is jealous of ${first(w, d.rival)}.`, [d.holder, d.rival]);
    case "conceived":
      return d.initial ? null : line("life", `${first(w, d.mother)} is expecting a child.`, [d.mother, d.father]);
    case "child_born":
      return line("life", `${String(d.name).split(" ")[0]} was born to ${first(w, d.mother)} and ${first(w, d.father)}.`, [d.child, d.mother, d.father]);
    case "orphaned":
      return line("life", `${first(w, d.child)} has been orphaned.`, [d.child]);
    case "elder_chosen":
      return e.tick === 0 ? null : line("village", `${first(w, d.elder)} is the new elder.`, [d.elder]);
    case "plot_formed": {
      const what = d.kind === "retribution" ? (d.severity === "kill" ? `to kill ${first(w, d.target)}, whom the council let walk` : d.severity === "maim" ? `to cripple ${first(w, d.target)}, whom the council let walk` : `to frighten ${first(w, d.target)}, whom the council let walk`) : d.kind === "murder" ? `to kill ${first(w, d.target)} (${d.motive})` : d.kind === "raid" ? `a raid on the ${w.households[d.targetHousehold as number]?.name} house with ${(d.participants as number[]).length - 1} others` : `to steal from ${holderName(w, d.targetHolder as HolderRef)}`;
      return line("intrigue", `${first(w, d.planner)} is plotting ${what}.`, [d.planner, d.target]);
    }
    case "plot_executed":
    case "plot_foiled":
    case "plot_abandoned":
      return line("intrigue", `${d.kind === "murder" ? "Murder" : d.kind === "raid" ? "Raid" : d.kind === "retribution" ? "Retribution" : "Theft"} plot by ${first(w, d.planner)} ${e.type.slice(5)}: ${d.outcome}.`, [d.planner, d.target]);
    case "plot_learned":
      return line("intrigue", `${first(w, d.stalker)} noted that ${first(w, d.target)} is alone around ${String(d.hour).padStart(2, "0")}:00${d.task && d.task !== "child" ? ` while working as ${d.task}` : ""}.`, [d.stalker, d.target]);
    case "raid_mustered":
      return line("danger", `The ${w.households[w.person((d.raiders as number[])[0]!).householdId]?.name} house rides out to raid the ${w.households[d.targetHousehold as number]?.name} house!`, d.raiders as number[]);
    case "raid_strike":
      return line("danger", `${first(w, d.raider)} raided the ${w.households[d.household as number]?.name} house${d.fought ? ` and ${d.fought}` : ""}, taking ${d.loot} food.`, [d.raider]);
    case "wolf_attack":
      return line("danger", `A wolf attacked ${first(w, d.person)}! They ${d.response === "fight" ? "fought it off" : "ran"} and screamed for help.`, [d.person]);
    case "wolf_killed":
      return line("danger", `${first(w, d.by)} killed a wolf.`, [d.by]);
    case "wolves_driven_off":
      return line("danger", `A group drove the wolves off.`, d.by as number[]);
    case "livestock_killed":
      return line("danger", `Wolves killed one of the ${w.households[d.household as number]?.name} house's ${d.kind === "sheep" ? "sheep" : `${d.kind}s`}.`, []);
    case "gunshot":
      return d.purpose === "hunting" || d.forest ? null : line("danger", `A gunshot rings out${d.purpose === "fight" ? "" : ` (${d.purpose})`}.`, [d.shooter]);
    case "investigated_shot":
      return line("danger", `${first(w, e.actors[0])} went to see where the shot came from${d.found ? ` and found something` : ""}.`, [e.actors[0]]);
    case "injustice_felt":
      return line("justice", `${first(w, d.person)} cannot forgive the council for letting ${first(w, d.against)} go.`, [d.person, d.against]);
    case "intimidation":
      return line("crime", `${first(w, d.by)} threatened ${first(w, d.target)} to their face.`, [d.by, d.target]);
    case "injured": {
      const sev = Number(d.severity);
      if (sev < 0.3 && d.kind !== "lost") return null;
      const part = String(d.part);
      const verb: Record<string, string> = { fracture: "broke their", sprain: "twisted their", bite: "was bitten on the", gunshot: "was shot in the", gash: "was gashed on the", cut: "was cut on the", bruise: "was bruised on the", lost: "lost their" };
      const grave = sev >= 0.75 ? "gravely: " : sev >= 0.5 ? "badly: " : "";
      return line("health", `${first(w, d.person)} ${verb[String(d.kind)] ?? "was hurt on the"} ${part.replace("foot", "ankle")} (${grave}${d.cause}).`, [d.person, d.by]);
    }
    case "accident":
      return d.canWalk ? null : line("health", `${first(w, d.person)} ${d.cause} and cannot walk!`, [d.person]);
    case "cry_for_help":
      return line("health", `${first(w, d.person)} cries out for help.`, [d.person]);
    case "found_injured":
      return line("health", `${first(w, d.finder)} found ${first(w, d.person)} hurt.`, [d.finder, d.person]);
    case "picked_up":
      return line("health", `${first(w, d.carrier)} picked up ${first(w, d.person)} to carry them to safety.`, [d.carrier, d.person]);
    case "carried_to":
      return line("health", `${first(w, d.carrier)} carried ${first(w, d.person)} ${d.place === "town" ? "to the infirmary in the courthouse" : "home"}.`, [d.carrier, d.person]);
    case "set_down":
      return d.reason === "dropped" ? line("health", `${first(w, d.person)} was left where they lay.`, [d.person]) : null;
    case "wounds_treated":
      return d.by === d.person || (Number(d.tended) === 0 && Number(d.cured) === 0) ? null : line("health", `${first(w, d.by)} tended ${first(w, d.person)}'s wounds${Number(d.cured) > 0 ? " and cleared a festering" : ""}.`, [d.by, d.person]);
    case "infection":
      return line("health", `${first(w, d.person)}'s ${d.part} wound is festering.`, [d.person]);
    case "injury_lasting":
      return line("health", `${first(w, d.person)}'s ${d.part} healed badly: ${String(d.lasting ?? "it will never be the same")}.`, [d.person]);
    case "crutch_made":
      return line("village", `${first(w, d.by)} carved a crutch for ${first(w, d.for)}.`, [d.by, d.for]);
    case "headstone_carved":
      return line("village", `${first(w, d.by)} carved a headstone for ${first(w, d.person)}.`, [d.by, d.person]);
    case "masonry":
      return null;
    case "patrolled":
      return Number(d.found) > 0 || Number(d.scared) > 0 ? line("village", `${first(w, d.by)} on the night watch ${Number(d.found) > 0 ? "found someone fallen" : ""}${Number(d.found) > 0 && Number(d.scared) > 0 ? " and " : ""}${Number(d.scared) > 0 ? "scared off wolves" : ""}.`, [d.by]) : null;
    case "animal_died":
      return line("danger", `A ${d.kind} died (${d.cause}).`, []);
    case "went_mad":
      return line("danger", `${first(w, d.person)} has gone mad (${d.kind}): ${d.cause}.`, [d.person]);
    case "recovered":
      return line("life", `${first(w, d.person)} has come back to their senses.`, [d.person]);
    case "kidnapping":
      return line("danger", `${first(w, d.kidnapper)} snatched ${first(w, d.child)} and dragged them into the woods!`, [d.kidnapper, d.child]);
    case "missing_person":
      return line("danger", `${first(w, d.person)} has gone missing; the family is searching.`, [d.person, d.reportedBy]);
    case "rescued":
      return line("life", `${first(w, d.rescuer)} found ${first(w, d.child)} in the woods and brought them home.`, [d.rescuer, d.child]);
    case "intervention":
      return line("village", d.kind === "smite" ? `A hand from above struck ${first(w, d.personId)} down.` : d.kind === "madden" ? `A hand from above clouded ${first(w, d.personId)}'s mind.` : `A hand from above struck down an animal.`, [d.personId]);
    case "weather_changed": {
      const text = WEATHER_TEXT[String(d.to)];
      if (!text || d.from === "snow" || d.from === "storm" || e.tick - lastWeatherLine < 72) return null;
      lastWeatherLine = e.tick;
      return line("weather", text);
    }
    case "drought_started":
      return line("weather", "A dry spell begins; the wells run low.");
    default:
      return null;
  }
}
