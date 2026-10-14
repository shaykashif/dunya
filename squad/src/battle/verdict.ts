// The character of a result: not just who won, but what it cost them. Scored
// from each side's losses (killed, dead of wounds, crippled for life, taken
// prisoner, and the wounded who will heal), against the strength it started
// with. Also the first man to fall, and how.
import { describeInjury } from "../entities/injuries.ts";
import type { Side, Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";

export interface SideLoss {
  side: Side;
  start: number;
  killed: number;
  /** Dead of wounds in the month after; only known once the aftermath has run. */
  diedLater: number;
  /** Alive but never to fight again. */
  crippled: number;
  captured: number;
  /** Hurt but expected to recover. */
  wounded: number;
  fled: number;
  /** Gone for good: killed, died of wounds, crippled, or in the bag. */
  irrecoverable: number;
  /** In [0, 1]: the share of the force lost, counting the recoverable wounded for a part. */
  fraction: number;
}

export interface Verdict {
  /** "Pyrrhic victory", "Decisive victory", "Narrow victory", "Stalemate"... */
  label: string;
  /** 0 to 100: how good a result it was for the winner (50 for a draw). */
  score: number;
  winner: Side | null;
  /** Why it earned that label, in a sentence or two. */
  summary: string;
  losses: Record<Side, SideLoss>;
}

export function sideLoss(w: World, side: Side): SideLoss {
  const all = w.side(side);
  const after = w.aftermath;
  const dead = all.filter((s) => s.status === "dead");
  const alive = all.filter((s) => s.status !== "dead");
  const diedLater = after ? alive.filter((s) => after[s.id]?.died).length : 0;
  const lasting = (s: Soldier) => after?.[s.id] !== undefined && !after[s.id]!.died && /never fight again/.test(after[s.id]!.outcome);
  const crippled = alive.filter(lasting).length;
  const captured = alive.filter((s) => (s.status === "captured" || s.status === "surrendered") && !(after?.[s.id]?.died) && !lasting(s)).length;
  const hurt = (s: Soldier) => s.injuries.some((i) => !i.permanent && i.severity >= 0.1);
  const wounded = alive.filter((s) => hurt(s) && s.status !== "captured" && s.status !== "surrendered" && !(after?.[s.id]?.died) && !lasting(s)).length;
  const fled = alive.filter((s) => s.status === "routed" && !hurt(s)).length;
  const irrecoverable = dead.length + diedLater + crippled + captured;
  const start = Math.max(1, all.length);
  return { side, start, killed: dead.length, diedLater, crippled, captured, wounded, fled, irrecoverable, fraction: (irrecoverable + 0.35 * wounded + 0.15 * fled) / start };
}

const NAME: Record<Side, string> = { us: "the Americans", de: "the Germans" };
const POSS: Record<Side, string> = { us: "the Americans'", de: "the Germans'" };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const lossText = (l: SideLoss) => {
  const bits = [`${l.killed + l.diedLater} dead`, `${l.crippled} crippled`, `${l.captured} captured`, `${l.wounded} wounded who will recover`];
  return `${bits.join(", ")} (${pct(l.fraction)} of ${l.start})`;
};

export function verdict(w: World): Verdict {
  const losses: Record<Side, SideLoss> = { us: sideLoss(w, "us"), de: sideLoss(w, "de") };
  const winner = w.result?.winner ?? null;
  if (!w.result) {
    return { label: "Undecided", score: 50, winner: null, summary: "The battle is still being fought.", losses };
  }
  const note = `Losses: ${NAME.us} ${lossText(losses.us)}; ${NAME.de} ${lossText(losses.de)}.`;
  if (winner === null) {
    const total = (losses.us.fraction + losses.de.fraction) / 2;
    const label = total >= 0.25 ? "Bloody stalemate" : "Stalemate";
    return { label, score: 50, winner, summary: `Neither side broke the other${total >= 0.25 ? " though both bled for it" : ""}. ${note}`, losses };
  }
  const loser: Side = winner === "us" ? "de" : "us";
  const fw = losses[winner].fraction, fl = losses[loser].fraction;
  const ratio = fl / Math.max(0.02, fw);
  const score = Math.round(100 * Math.max(0, Math.min(1, 0.5 * (1 - fw / 0.5) + 0.5 * (fl / 0.5))));
  let label: string;
  let why: string;
  if (fw >= 0.35) {
    label = "Pyrrhic victory";
    why = `${NAME[winner]} held the field but lost ${pct(fw)} of the force doing it`;
  } else if (fl < fw) {
    label = fw >= 0.2 ? "Pyrrhic victory" : "Hollow victory";
    why = `${NAME[winner]} won the ground but lost more men than ${NAME[loser]} (${pct(fw)} against ${pct(fl)})`;
  } else if (fw <= 0.15 && fl >= 0.5 && ratio >= 4) {
    label = "Crushing victory";
    why = `${NAME[loser]} were destroyed (${pct(fl)} lost) for almost nothing`;
  } else if (fw <= 0.2 && fl >= 0.35 && ratio >= 3) {
    label = "Decisive victory";
    why = `${NAME[loser]} lost ${pct(fl)} of the force to ${POSS[winner]} ${pct(fw)}`;
  } else if (fl - fw < 0.1 || ratio < 1.25) {
    label = "Narrow victory";
    why = `the losses were nearly even (${pct(fw)} against ${pct(fl)}) and the result could have gone either way`;
  } else if (fw >= 0.25) {
    label = "Costly victory";
    why = `${NAME[winner]} prevailed, losing ${pct(fw)} to ${POSS[loser]} ${pct(fl)}`;
  } else if (ratio >= 2) {
    label = "Clear victory";
    why = `${NAME[loser]} lost ${ratio.toFixed(1)} men for each one of ${NAME[winner]}`;
  } else {
    label = "Victory";
    why = `${NAME[winner]} came out ahead, ${pct(fw)} lost against ${pct(fl)}`;
  }
  const irrecov = `${losses[winner].irrecoverable} of ${NAME[winner]} and ${losses[loser].irrecoverable} of ${NAME[loser]} are gone for good (dead, crippled or captured)`;
  return { label, score, winner, summary: `${why[0]!.toUpperCase()}${why.slice(1)}. ${irrecov}. ${note}`, losses };
}

export interface FirstBlood {
  soldier: Soldier;
  tick: number;
  killer: Soldier | null;
  /** One sentence: who he was and how he died. */
  text: string;
}

/** The first man killed: who he was, who killed him and with what, and what the wound was. */
export function firstBlood(w: World, roleName: (s: Soldier) => string = (s) => s.role.replace(/_/g, " ")): FirstBlood | null {
  const dead = w.soldiers.filter((s) => s.status === "dead" && s.deathTick !== null);
  if (dead.length === 0) return null;
  dead.sort((a, b) => a.deathTick! - b.deathTick! || a.id - b.id);
  const s = dead[0]!;
  const killer = s.killedBy !== null ? w.maybe(s.killedBy) : null;
  const wound = s.injuries.slice().sort((a, b) => b.severity - a.severity)[0];
  const gun = killer?.weapon ? w.config.weapons[killer.weapon]?.name : null;
  let how: string;
  if (killer) how = `shot down by ${killer.abbr} ${killer.name} (${roleName(killer)}${gun ? `, with the ${gun}` : ""})`;
  else if (wound) how = `killed by ${wound.cause}`;
  else how = "killed";
  const hurt = wound ? ` — ${describeInjury(wound)}` : "";
  const when = w.clock(s.deathTick!).slice(0, 8);
  const text = `${s.abbr} ${s.name}, ${roleName(s)} of ${w.squad(s.squadId).name}, ${s.age}, from ${s.hometown}, was the first to fall at ${when}: ${how}${hurt}${s.causeOfDeath === "wounds" ? ", and died of it" : ""}.`;
  return { soldier: s, tick: s.deathTick!, killer, text };
}
