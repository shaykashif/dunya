// Builds readable council session transcripts from the event stream.
import type { SimEvent } from "../../src/log/events.ts";
import type { World } from "../../src/world/world.ts";
import { claimText, first } from "./feed.ts";

export interface TranscriptLine {
  kind: "accusation" | "testimony" | "withheld" | "denial" | "confession" | "vote" | "verdict" | "truth" | "note";
  speaker?: number;
  text: string;
  /** Omniscient note for the player: whether the speaker lied, and how. */
  lie?: string | null;
}

export interface Session {
  hearingId: number;
  kind: string;
  accused: number;
  accusers: number[];
  judges: number[];
  present: number[];
  scheduledTick: number;
  openedTick: number | null;
  lines: TranscriptLine[];
  verdict: string | null;
  sentence: string | null;
  correct: boolean | null;
}

const LIE_TEXT: Record<string, string> = {
  distort: "LIE: blamed someone else for what they saw",
  fabricate: "LIE: made this up",
  omit: "LIE: kept quiet about something they saw",
  deny: "LIE: they did it",
};

export class CouncilBook {
  readonly sessions = new Map<number, Session>();

  private session(id: number): Session | undefined {
    return this.sessions.get(id);
  }

  /** Feeds one event; returns the session when it convenes or reaches a verdict. */
  onEvent(e: SimEvent, w: World): { session: Session; phase: "opened" | "verdict" } | null {
    const d = e.data;
    switch (e.type) {
      case "accusation": {
        const id = d.hearing as number;
        let s = this.session(id);
        if (!s) {
          s = { hearingId: id, kind: String(d.kind), accused: d.accused as number, accusers: [], judges: (d.judges as number[]).slice(), present: [], scheduledTick: e.tick, openedTick: null, lines: [], verdict: null, sentence: null, correct: null };
          this.sessions.set(id, s);
        }
        s.accusers.push(d.accuser as number);
        const top = (d.suspects as { personId: number; means: number; motive: number; opportunity: number }[])[0];
        const why = top ? ` (their reasoning: means ${top.means.toFixed(2)}, motive ${top.motive.toFixed(2)}, opportunity ${top.opportunity.toFixed(2)})` : "";
        s.lines.push({ kind: "accusation", speaker: d.accuser as number, text: `${first(w, d.accuser)} accuses ${first(w, d.accused)} of ${d.kind}${why}.` });
        return null;
      }
      case "recusal": {
        const s = this.session(d.hearing as number);
        s?.lines.push({ kind: "note", text: `The elder ${first(w, d.elder)} steps aside: they are kin to someone in the case.` });
        return null;
      }
      case "hearing_scheduled": {
        const s = this.session(d.hearing as number);
        if (s) {
          s.judges = (d.judges as number[]).slice();
          s.scheduledTick = d.at as number;
        }
        return null;
      }
      case "statement": {
        const s = typeof d.hearing === "number" ? this.session(d.hearing) : undefined;
        if (!s) return null;
        const speaker = d.speaker as number;
        if (d.claim === "denies") {
          s.lines.push({ kind: "denial", speaker, text: `${first(w, speaker)}: "I did nothing of the sort."`, lie: d.lie ? LIE_TEXT.deny : null });
          return null;
        }
        const claim = d.claim as { subject: unknown; predicate: string; object: unknown; time: number; confidence?: number };
        const lead = d.context === "accusation" ? `${first(w, speaker)} tells the council: ` : `${first(w, speaker)} testifies: `;
        const text = lead + claimText(w, claim);
        if (s.lines.some((l) => l.text === text)) return null;
        s.lines.push({ kind: "testimony", speaker, text, lie: d.lie ? LIE_TEXT[String(d.lieType)] ?? "LIE" : null });
        return null;
      }
      case "statement_withheld": {
        const s = typeof d.hearing === "number" ? this.session(d.hearing) : undefined;
        s?.lines.push({ kind: "withheld", speaker: d.speaker as number, text: `${first(w, d.speaker)} says nothing about what they saw.`, lie: LIE_TEXT.omit });
        return null;
      }
      case "confession": {
        const s = typeof d.hearing === "number" ? this.session(d.hearing) : undefined;
        s?.lines.push({ kind: "confession", speaker: d.speaker as number, text: `${first(w, d.speaker)} breaks down and confesses.` });
        return null;
      }
      case "hearing_opened": {
        const s = this.session(d.hearing as number);
        if (!s) return null;
        s.openedTick = e.tick;
        s.present = (d.present as number[]).slice();
        s.judges = (d.judges as number[]).slice();
        const absent = (d.summoned as number[]).filter((id) => !s.present.includes(id));
        s.lines.push({ kind: "note", text: `The council (${s.judges.map((j) => first(w, j)).join(", ")}) sits. Present: ${s.present.map((p) => first(w, p)).join(", ") || "nobody"}.${absent.length ? ` Did not come: ${absent.map((p) => first(w, p)).join(", ")}.` : ""}` });
        return { session: s, phase: "opened" };
      }
      case "verdict": {
        const s = this.session(d.hearing as number);
        if (!s) return null;
        for (const v of d.votes as { judge: number; accusedScore: number; top: number | null; topScore: number; guilty: boolean }[]) {
          const other = v.top !== null && v.top !== s.accused ? `, though they suspect ${first(w, v.top)} more (${v.topScore.toFixed(2)})` : "";
          s.lines.push({ kind: "vote", speaker: v.judge, text: `${first(w, v.judge)} weighs the evidence against ${first(w, s.accused)} at ${v.accusedScore.toFixed(2)}${other}: ${v.guilty ? "GUILTY" : "not guilty"}.` });
        }
        s.verdict = String(d.verdict);
        s.sentence = (d.sentence as string | null) ?? null;
        s.lines.push({ kind: "verdict", text: `Verdict: ${first(w, s.accused)} is ${d.verdict === "guilty" ? `guilty, sentenced to ${d.sentence}` : "not guilty"}.` });
        const truth = d.truth as { correct: boolean | null; culprit: number | null };
        s.correct = truth.correct;
        s.lines.push({ kind: "truth", text: truth.culprit === null ? "The truth: nobody can say what really happened." : `The truth: ${first(w, truth.culprit)} did it. The council was ${truth.correct ? "right" : "WRONG"}.` });
        return { session: s, phase: "verdict" };
      }
      default:
        return null;
    }
  }
}
