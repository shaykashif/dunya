// Groups the exchanges between two people into one fight, with a log of every blow, every choice and every wound.
import type { SimEvent } from "../../src/log/events.ts";
import type { World } from "../../src/world/world.ts";
import { clock, first } from "./feed.ts";

export interface Blow {
  by: number;
  hit: boolean;
  damage: number;
}

export interface Wound {
  person: number;
  part: string;
  kind: string;
  severity: number;
  cause: string;
}

export interface Round {
  tick: number;
  attacker: number;
  victim: number;
  weapon: string;
  motive: string;
  lethal: boolean;
  response: string;
  blows: Blow[];
  outcome: string;
  wounds: Wound[];
}

export interface Fight {
  id: number;
  /** Who started it. */
  a: number;
  b: number;
  startTick: number;
  lastTick: number;
  rounds: Round[];
  /** How it ended, once it has: the last round's outcome. */
  at: [number, number] | null;
}

/** Two exchanges within this many ticks (two hours) belong to the same fight. */
const GAP = 12;

export class FightBook {
  readonly fights = new Map<number, Fight>();
  private nextId = 1;
  private pendingWounds: { tick: number; wound: Wound; by: number | null }[] = [];

  reset(): void {
    this.fights.clear();
    this.pendingWounds = [];
    this.nextId = 1;
  }

  private open(a: number, b: number, tick: number): Fight | null {
    let best: Fight | null = null;
    for (const f of this.fights.values()) {
      const same = (f.a === a && f.b === b) || (f.a === b && f.b === a);
      if (same && tick - f.lastTick <= GAP && (!best || f.lastTick > best.lastTick)) best = f;
    }
    return best;
  }

  /** Feeds one event. Returns the fight an attack belongs to, and whether it carried on an earlier one. */
  onEvent(e: SimEvent): { fight: Fight; continued: boolean } | null {
    const d = e.data;
    if (e.type === "injured") {
      const wound: Wound = { person: d.person as number, part: String(d.part), kind: String(d.kind), severity: Number(d.severity), cause: String(d.cause) };
      const by = typeof d.by === "number" ? d.by : null;
      // Wounds are recorded just before the exchange that caused them; a late one goes on the last round.
      const f = by !== null ? this.open(by, wound.person, e.tick) : null;
      const last = f?.rounds[f.rounds.length - 1];
      if (last && last.tick === e.tick) last.wounds.push(wound);
      else this.pendingWounds.push({ tick: e.tick, wound, by });
      if (this.pendingWounds.length > 50) this.pendingWounds.shift();
      return null;
    }
    if (e.type !== "attack") return null;
    const attacker = d.attacker as number;
    const victim = d.victim as number;
    const wounds = this.pendingWounds.filter((p) => p.tick === e.tick && (p.wound.person === victim || p.wound.person === attacker)).map((p) => p.wound);
    this.pendingWounds = this.pendingWounds.filter((p) => p.tick !== e.tick);
    const round: Round = {
      tick: e.tick,
      attacker,
      victim,
      weapon: String(d.weapon),
      motive: String(d.motive),
      lethal: Boolean(d.lethalIntent),
      response: String(d.response),
      blows: d.blows as Blow[],
      outcome: String(d.outcome),
      wounds,
    };
    let fight = this.open(attacker, victim, e.tick);
    const continued = fight !== null;
    if (!fight) {
      fight = { id: this.nextId++, a: attacker, b: victim, startTick: e.tick, lastTick: e.tick, rounds: [], at: Array.isArray(d.at) ? (d.at as [number, number]) : null };
      this.fights.set(fight.id, fight);
    }
    fight.rounds.push(round);
    fight.lastTick = e.tick;
    return { fight, continued };
  }
}

const RESPONSE: Record<string, string> = { fight: "fights back", flee: "tries to run", yield: "gives in" };
const PART = (p: string) => p.replace("foot", "ankle");

function ended(f: Fight, w: World): string | null {
  const r = f.rounds[f.rounds.length - 1]!;
  switch (r.outcome) {
    case "victim_killed": return `${first(w, r.victim)} is dead.`;
    case "attacker_killed": return `${first(w, r.attacker)} is dead, killed in self-defence.`;
    case "victim_fled": return `${first(w, r.victim)} got away.`;
    case "attacker_broke_off": return `${first(w, r.attacker)} broke off the fight.`;
    default: return null;
  }
}

/** One-line state of a fight, for the alert. */
export function fightSummary(f: Fight, w: World): string {
  const r0 = f.rounds[0]!;
  const rounds = f.rounds.length;
  const end = ended(f, w);
  return `${first(w, f.a)} and ${first(w, f.b)} ${rounds > 1 ? `have fought ${rounds} rounds` : "are fighting"} (${r0.motive}${r0.weapon === "musket" ? ", musket" : ""}). ${end ?? "It is not over."}`;
}

export interface FightLine {
  kind: "attack" | "blow" | "choice" | "wound" | "end";
  speaker?: number;
  text: string;
}

/** Every action each person took, in order. */
export function fightLines(f: Fight, w: World): FightLine[] {
  const out: FightLine[] = [];
  f.rounds.forEach((r, i) => {
    const A = first(w, r.attacker), V = first(w, r.victim);
    const when = clock(w, r.tick);
    out.push({
      kind: "attack",
      speaker: r.attacker,
      text: i === 0 ? `${when} · ${A} attacks ${V}${r.weapon === "musket" ? " with a musket" : r.weapon === "tool" ? " with a tool" : ""} (${r.motive}${r.lethal ? ", meaning to kill" : ""}).` : `${when} · ${A} decides to keep attacking ${V}.`,
    });
    out.push({ kind: "choice", speaker: r.victim, text: `${V} ${RESPONSE[r.response] ?? r.response}.` });
    for (const b of r.blows) {
      const who = first(w, b.by), other = b.by === r.attacker ? V : A;
      out.push({ kind: "blow", speaker: b.by, text: b.hit ? `${who} hits ${other} (−${Math.round(b.damage * 100)} health).` : `${who} swings at ${other} and misses.` });
    }
    for (const x of r.wounds) {
      const sev = x.severity >= 0.75 ? "gravely " : x.severity >= 0.5 ? "badly " : "";
      out.push({ kind: "wound", speaker: x.person, text: `${first(w, x.person)}'s ${PART(x.part)} is ${sev}${x.kind === "fracture" ? "broken" : x.kind === "sprain" ? "twisted" : x.kind === "gunshot" ? "shot" : x.kind === "lost" ? "lost" : x.kind === "bite" ? "bitten" : x.kind === "gash" ? "gashed" : x.kind === "cut" ? "cut" : "bruised"}.` });
    }
    const last = i === f.rounds.length - 1;
    if (!last) return;
    const end = ended(f, w);
    out.push({ kind: "end", text: end ?? `The fight peters out: neither side presses on.` });
  });
  return out;
}
