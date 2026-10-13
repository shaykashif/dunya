// Inquests: when a body is found, the elder calls the council. The judges go
// to the body and examine it, each reading the signs for themselves (and
// sometimes misreading them). The council then rules: wolves (bury the dead and
// hunt the pack), hunger, cold or sickness (bury and mourn), or murder (open an
// investigation). The body is buried once the council has ruled.
import { cand, isDetained, travelTicks } from "../actions/helpers.ts";
import type { ActionDef, CandidateAction } from "../actions/types.ts";
import { cannotWalk } from "../entities/body.ts";
import { cheb, feel, firstName, isKin } from "../entities/person.ts";
import { classifyBelief, findMatchingCase, openCase } from "../investigation/cases.ts";
import { discoverTrace } from "../perception/perception.ts";
import type { Inquest, Person, Trace } from "../world/types.ts";
import type { World } from "../world/world.ts";

/** Elder first, then heads of houses, none of them kin to the dead. */
function inquestJudges(w: World, dead: Person): number[] {
  const size = w.config.justice.councilSize;
  const out: number[] = [];
  const ok = (p: Person | null): p is Person => !!p && w.isActive(p.id) && !isKin(p, dead) && p.householdId !== dead.householdId && !cannotWalk(p);
  const elder = w.maybePerson(w.elderId);
  if (ok(elder)) out.push(elder.id);
  const heads = w.households.map((h) => w.maybePerson(h.headId)).filter(ok).sort((a, b) => a.birthTick - b.birthTick || a.id - b.id);
  for (const h of heads) if (out.length < size && !out.includes(h.id)) out.push(h.id);
  // If everyone is kin (it happens in a small village), the oldest heads sit anyway.
  if (out.length === 0) for (const h of w.households.map((x) => w.maybePerson(x.headId))) if (h && w.isActive(h.id) && out.length < size) out.push(h.id);
  return out;
}

function bodyTrace(w: World, iq: Inquest): Trace | undefined {
  return w.traces.find((t) => t.id === iq.traceId);
}

/** Calls an inquest for each newly found body, except an executed convict's. */
function callInquests(w: World): void {
  for (const t of w.traces) {
    if (t.kind !== "body" || !t.discovered || t.details.cause === "execution" || w.inquests.some((i) => i.traceId === t.id)) continue;
    const who = t.involves.find((r) => r.kind === "person");
    if (!who || who.kind !== "person") continue;
    const dead = w.person(who.id);
    const judges = inquestJudges(w, dead);
    const iq: Inquest = {
      id: w.nextId("inquest"),
      traceId: t.id,
      personId: dead.id,
      place: { ...t.location },
      calledTick: w.tick,
      scheduledTick: w.tick + w.config.justice.inquestDelayTicks,
      judges,
      readings: [],
      status: "scheduled",
      finding: null,
      cause: null,
    };
    w.inquests.push(iq);
    w.emit("inquest_called", judges.filter((id) => w.isActive(id)), { inquest: iq.id, person: dead.id, judges, at: [t.location.x, t.location.y], scheduled: iq.scheduledTick });
  }
}

const SEVERITY: Record<string, number> = { person: 4, unknown: 3, wolf: 2 };

/** The council rules: the most common reading, the graver one on a tie. */
function holdInquest(w: World, iq: Inquest): void {
  const tally = new Map<string, number>();
  for (const r of iq.readings) tally.set(r.cause, (tally.get(r.cause) ?? 0) + 1);
  if (tally.size === 0) {
    // Nobody came to look: the elder rules from what they have heard, or cannot say.
    const elder = w.maybePerson(w.elderId);
    const b = elder?.beliefs.find((x) => x.predicate === "trace_found" && x.object === "body" && x.detail?.traceId === iq.traceId);
    tally.set(String(b?.detail?.cause ?? "unknown"), 1);
  }
  const cause = [...tally.entries()].sort((a, b) => b[1] - a[1] || (SEVERITY[b[0]] ?? 1) - (SEVERITY[a[0]] ?? 1))[0]![0];
  const finding = cause === "person" || cause === "unknown" ? "murder" : cause === "wolf" ? "wolves" : "natural";
  iq.status = "held";
  iq.cause = cause;
  iq.finding = finding;
  const dead = w.person(iq.personId);
  const t = bodyTrace(w, iq);
  if (t) t.details.inquestDone = true;
  const judges = iq.judges.filter((id) => w.isActive(id));
  w.emit("inquest_held", judges, { inquest: iq.id, person: dead.id, readings: iq.readings, cause, finding });

  if (finding === "wolves") {
    // The packs must be hunted down.
    for (const m of w.active()) {
      if (w.ageYears(m) < 16 || cannotWalk(m)) continue;
      if (m.task === "hunter" || m.task === "watchman" || m.isHead) m.cooldowns["wolfhunt"] = w.tick + w.days(4);
      if (m.relationships[dead.id]?.kin) feel(w, m, "grieving", `wolves killed ${firstName(dead)}`, 0.5);
    }
  } else if (finding === "murder") {
    // Each judge takes up the case, from their own reading of the body.
    for (const id of judges) {
      const j = w.person(id);
      const b = j.beliefs.find((x) => x.predicate === "trace_found" && x.object === "body" && x.detail?.traceId === iq.traceId);
      if (!b) continue;
      const info = classifyBelief(b, w.config.time.ticksPerDay) ?? { kind: "violence" as const, victim: { kind: "person" as const, id: dead.id }, place: { ...iq.place }, timeFrom: b.time - w.days(2), timeTo: b.time };
      if (!findMatchingCase(w, j, info)) openCase(w, j, info, b);
    }
    for (const m of w.active()) if (w.ageYears(m) >= 12 && m.id !== dead.id) feel(w, m, "afraid", `the council believes ${firstName(dead)} was murdered`, 0.25);
  }
}

/** Engine rule in the justice step: call inquests for new bodies, and rule once the judges have looked (or time is up). */
export function inquestStep(w: World): void {
  callInquests(w);
  for (const iq of w.inquests) {
    if (iq.status !== "scheduled") continue;
    const living = iq.judges.filter((id) => w.isActive(id));
    const allRead = living.length > 0 && living.every((id) => iq.readings.some((r) => r.judge === id));
    if (allRead || w.tick >= iq.scheduledTick + w.config.justice.inquestWaitTicks) holdInquest(w, iq);
  }
}

/** A judge goes to the body to examine it. */
export const attendInquest: ActionDef = {
  id: "inquest",
  name: "Inquest",
  candidates(p, w) {
    if (isDetained(w, p) || cannotWalk(p) || p.carryingId !== null) return [];
    const out: CandidateAction[] = [];
    for (const iq of w.inquests) {
      if (iq.status !== "scheduled" || !iq.judges.includes(p.id) || iq.readings.some((r) => r.judge === p.id)) continue;
      const dead = w.person(iq.personId);
      out.push(
        cand("inquest", `inquest:${iq.id}`, `examine ${dead.name}'s body for the council`, {
          dest: { ...iq.place },
          reach: 2,
          duration: 2,
          travel: travelTicks(w, p, iq.place),
          option: String(iq.id),
          effects: { justice: 1.1, duty: 0.6, status: 0.2 },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const iq = w.inquests.find((x) => x.id === Number(c.option));
    const t = iq ? bodyTrace(w, iq) : undefined;
    if (!iq || !t || iq.status !== "scheduled" || cheb(p, t.location) > 3) {
      ctx.success = false;
      return ctx.events;
    }
    const b = discoverTrace(w, p, t, ctx.rng, "examined");
    const cause = String(b.detail?.cause ?? "unknown");
    iq.readings.push({ judge: p.id, cause });
    ctx.emit("inquest_examined", [p.id], { inquest: iq.id, judge: p.id, cause });
    return ctx.events;
  },
};
