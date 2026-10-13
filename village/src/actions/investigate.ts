import { cheb, householdMembers } from "../entities/person.ts";
import type { CaseFile } from "../investigation/casefile.ts";
import { conductHearing, enforceSentence, fileAccusation } from "../justice/justice.ts";
import { personOf } from "../perception/beliefs.ts";
import { discoverTrace } from "../perception/perception.ts";
import { relevantToCase, testify } from "../perception/testimony.ts";
import type { Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { cand, isDetained, travelTicks } from "./helpers.ts";
import type { ActionDef, CandidateAction } from "./types.ts";

function openCases(p: Person): CaseFile[] {
  return p.caseFiles.filter((c) => c.status !== "closed");
}

function importance(c: CaseFile): number {
  return c.kind === "violence" ? 0.7 : 0.45;
}

export const examine: ActionDef = {
  id: "examine",
  name: "Examine",
  candidates(p, w) {
    if (w.ageYears(p) < 10 || isDetained(w, p)) return [];
    const out: CandidateAction[] = [];
    for (const c of openCases(p)) {
      if (c.examined >= 2) continue;
      const dest = { ...c.place };
      out.push(
        cand("examine", `examine:${c.id}`, `examine the scene of case ${c.id}`, {
          caseId: c.id,
          dest,
          duration: w.config.investigation.examineDuration,
          travel: travelTicks(w, p, dest),
          effects: { justice: importance(c) * (c.examined === 0 ? 1 : 0.5), security: 0.05 },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const cf = p.caseFiles.find((x) => x.id === c.caseId);
    if (!cf) {
      ctx.success = false;
      return ctx.events;
    }
    cf.examined++;
    const radius = w.config.investigation.examineRadius;
    const skill = 0.45 + 0.35 * p.personality.vigilance + (p.role === "elder" ? 0.15 : 0);
    let found = 0;
    for (const trace of w.traces.slice()) {
      if (trace.kind === "sound" || p.knownTraces[trace.id]) continue;
      if (cheb(trace.location, cf.place) > radius) continue;
      if (!ctx.rng.chance(skill)) continue;
      const b = discoverTrace(w, p, trace, ctx.rng, "examined");
      if (!cf.traceIds.includes(trace.id)) cf.traceIds.push(trace.id);
      if (!cf.beliefIds.includes(b.id)) cf.beliefIds.push(b.id);
      cf.dirty = true;
      found++;
    }
    ctx.emit("examined", [p.id], { case: cf.id, at: [cf.place.x, cf.place.y], found });
    return ctx.events;
  },
};

/** People an investigator believes may know something about the case. */
function witnessesFor(w: World, p: Person, c: CaseFile): Person[] {
  const tpd = w.config.time.ticksPerDay;
  const ids = new Set<number>();
  for (const b of p.beliefs) {
    if (!relevantToCase(b, c, tpd)) continue;
    if (b.fromId !== undefined) ids.add(b.fromId);
    const sid = personOf(b.subject);
    if (sid !== null && b.predicate === "was_at") ids.add(sid);
  }
  if (c.victim && c.victim.kind === "holder" && c.victim.holder.t === "household") {
    for (const m of householdMembers(w, c.victim.holder.id)) ids.add(m.id);
  }
  if (c.victim && c.victim.kind === "person") ids.add(c.victim.id);
  // Neighbours: the household living closest to the scene.
  let nearest = -1, best = Infinity;
  for (const hh of w.households) {
    const d = cheb(w.buildings[hh.buildingId]!.door, c.place);
    if (d < best) { best = d; nearest = hh.id; }
  }
  if (nearest >= 0) for (const m of householdMembers(w, nearest)) if (w.ageYears(m) >= 10) ids.add(m.id);
  const minAge = w.config.justice.childrenCanTestify ? w.config.justice.childTestimonyMinAge : 16;
  return [...ids]
    .sort((a, b) => a - b)
    .filter((id) => id !== p.id && !c.interviewed.includes(id) && w.isActive(id) && w.ageYears(w.person(id)) >= minAge)
    .map((id) => w.person(id));
}

export const interview: ActionDef = {
  id: "interview",
  name: "Interview",
  candidates(p, w) {
    if (w.ageYears(p) < 12 || isDetained(w, p)) return [];
    const out: CandidateAction[] = [];
    for (const c of openCases(p).slice(0, 2)) {
      if (c.interviewed.length >= w.config.investigation.maxInterviews) continue;
      for (const t of witnessesFor(w, p, c).slice(0, 3)) {
        out.push(
          cand("interview", `interview:${c.id}:${t.id}`, `ask ${t.name} about case ${c.id}`, {
            caseId: c.id,
            targetId: t.id,
            dest: { x: t.x, y: t.y },
            follow: true,
            duration: w.config.investigation.interviewDuration,
            travel: Math.ceil(cheb(p, t) / 4),
            effects: { justice: importance(c) * 0.7 },
          }),
        );
      }
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const cf = p.caseFiles.find((x) => x.id === c.caseId);
    const t = w.maybePerson(c.targetId);
    if (!cf || !t || !w.isActive(t.id) || cheb(p, t) > 2) {
      ctx.success = false;
      return ctx.events;
    }
    cf.interviewed.push(t.id);
    const tpd = w.config.time.ticksPerDay;
    const shared = testify(w, t, p, { context: "interview", filter: (b) => relevantToCase(b, cf, tpd), maxClaims: 4, caseRef: cf });
    ctx.emit("interviewed", [p.id, t.id], { case: cf.id, investigator: p.id, witness: t.id, claims: shared });
    return ctx.events;
  },
};

export const accuse: ActionDef = {
  id: "accuse",
  name: "Accuse",
  candidates(p, w) {
    if (w.ageYears(p) < 12 || isDetained(w, p)) return [];
    const cfg = w.config.investigation;
    const out: CandidateAction[] = [];
    for (const c of openCases(p)) {
      if (c.status !== "open") continue;
      const top = c.suspects[0];
      if (!top || top.score < cfg.accuseThreshold || top.personId === p.id) continue;
      // Nobody is accused of violence only for having been nearby.
      if (c.kind === "violence" && !top.direct) continue;
      const second = c.suspects[1];
      if (second && top.score - second.score < cfg.accuseMargin) continue;
      if (!w.isActive(top.personId)) continue;
      const elder = w.maybePerson(w.elderId);
      const selfFile = !elder || elder.id === p.id || !w.isActive(elder.id);
      out.push(
        cand("accuse", `accuse:${c.id}:${top.personId}`, `accuse ${w.person(top.personId).name}`, {
          caseId: c.id,
          targetId: selfFile ? undefined : elder!.id,
          dest: selfFile ? null : { x: elder!.x, y: elder!.y },
          follow: !selfFile,
          duration: 1,
          travel: selfFile ? 0 : Math.ceil(cheb(p, elder!) / 4),
          risk: 0.05,
          effects: { justice: 0.5 + 0.3 * top.score, security: 0.15, status: 0.05 },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const cf = p.caseFiles.find((x) => x.id === c.caseId);
    if (!cf || cf.status !== "open" || !cf.suspects[0]) {
      ctx.success = false;
      return ctx.events;
    }
    if (c.targetId !== undefined) {
      const elder = w.maybePerson(c.targetId);
      if (!elder || !w.isActive(elder.id) || cheb(p, elder) > 2) {
        ctx.success = false;
        return ctx.events;
      }
    }
    const h = fileAccusation(w, p, cf.suspects[0].personId, cf);
    ctx.success = h !== null;
    return ctx.events;
  },
};

export const testifyAction: ActionDef = {
  id: "testify",
  name: "Testify",
  candidates(p, w) {
    const out: CandidateAction[] = [];
    for (const h of w.hearings) {
      const sitting = h.judges.includes(p.id) && h.judges.find((id) => w.isActive(id)) !== p.id;
      if (h.status !== "scheduled" || !(h.summoned.includes(p.id) || sitting)) continue;
      if (h.scheduledTick - w.tick > 24) continue;
      const dest = { ...w.map.meeting };
      const accused = h.accusedId === p.id;
      out.push(
        cand("testify", `testify:${h.id}`, `attend hearing ${h.id}`, {
          hearingId: h.id,
          dest,
          duration: 1,
          travel: travelTicks(w, p, dest),
          continuous: true,
          effects: { justice: accused ? 0.1 + 0.4 * p.personality.honesty : 0.5, duty: 0.2, status: 0.05 },
        }),
      );
    }
    return out;
  },
  isDone(_p, c, w, performed) {
    const h = w.hearings.find((x) => x.id === c.hearingId);
    return !h || h.status !== "scheduled" || performed > 48;
  },
  resolve(p, c, _w, ctx) {
    ctx.emit("attended_hearing", [p.id], { hearing: c.hearingId });
    return ctx.events;
  },
};

export const judge: ActionDef = {
  id: "judge",
  name: "Judge",
  candidates(p, w) {
    const out: CandidateAction[] = [];
    for (const h of w.hearings) {
      if (h.status !== "scheduled") continue;
      const lead = h.judges.find((id) => w.isActive(id));
      if (lead !== p.id) continue;
      if (h.scheduledTick - w.tick > 12) continue;
      const dest = { ...w.map.meeting };
      out.push(
        cand("judge", `judge:${h.id}`, `hear case against ${w.person(h.accusedId).name}`, {
          hearingId: h.id,
          dest,
          duration: 1,
          travel: travelTicks(w, p, dest),
          continuous: true,
          effects: { justice: 1.2, status: 0.3, duty: 0.3 },
        }),
      );
    }
    return out;
  },
  isDone(_p, c, w, performed) {
    const h = w.hearings.find((x) => x.id === c.hearingId);
    if (!h || h.status !== "scheduled") return true;
    return w.tick >= h.scheduledTick && performed >= 2;
  },
  resolve(_p, c, w, ctx) {
    const h = w.hearings.find((x) => x.id === c.hearingId);
    if (!h || h.status !== "scheduled") {
      ctx.success = false;
      return ctx.events;
    }
    conductHearing(w, h);
    return ctx.events;
  },
};

export const punish: ActionDef = {
  id: "punish",
  name: "Punish",
  candidates(p, w) {
    const out: CandidateAction[] = [];
    for (const s of w.sentences) {
      if (s.status !== "pending" || s.executorId !== p.id || !w.isActive(s.convictId)) continue;
      const convict = w.person(s.convictId);
      out.push(
        cand("punish", `punish:${s.id}`, `carry out ${s.kind} on ${convict.name}`, {
          sentenceId: s.id,
          targetId: convict.id,
          dest: { x: convict.x, y: convict.y },
          follow: true,
          duration: 2,
          travel: Math.ceil(cheb(p, convict) / 4),
          risk: 0.15,
          effects: { justice: 0.9, duty: 0.4 },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const s = w.sentences.find((x) => x.id === c.sentenceId);
    const convict = w.maybePerson(c.targetId);
    if (!s || s.status !== "pending" || !convict || cheb(p, convict) > 2) {
      ctx.success = false;
      return ctx.events;
    }
    ctx.success = enforceSentence(w, s, p, ctx.rng);
    return ctx.events;
  },
};
