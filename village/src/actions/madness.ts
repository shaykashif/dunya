// What madness drives people to, and how families search for the missing.
import { needsRescue } from "../entities/injuries.ts";
import { raiseMissingAlarm } from "../entities/madness.ts";
import { adjustTrust, cheb, feel, firstName, householdMembers } from "../entities/person.ts";
import { cannotWalk } from "../entities/body.ts";
import { startChase } from "./intrigue.ts";
import { findMatchingCase, openCase } from "../investigation/cases.ts";
import { fileAccusation } from "../justice/justice.ts";
import { interruptPlan } from "../engine/plans.ts";
import { sightRange, witnessAction } from "../perception/detection.ts";
import { addBelief } from "../perception/store.ts";
import type { Person, Point } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { recordCrime, selfKnowledge } from "./fight.ts";
import { cand, isDetained, onCooldown, travelTicks } from "./helpers.ts";
import type { ActionDef, CandidateAction } from "./types.ts";

/** A deep-forest spot of the person's own, away from every clearing. */
function hideout(w: World, p: Person): Point {
  const a = ((p.id * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
  const c = w.compound(p.householdId).center;
  const x = Math.max(2, Math.min(w.map.width - 2, Math.round(c.x + Math.cos(a) * 24)));
  const y = Math.max(2, Math.min(w.map.height - 2, Math.round(c.y + Math.sin(a) * 24)));
  return w.map.nearest("forest", { x, y });
}

/** The mad who rampage attack whoever is near, kin or not, meaning to kill. */
export function rampageCandidates(w: World, p: Person): CandidateAction[] {
  if (p.mad !== "rampage") return [];
  const range = Math.min(8, sightRange(w, p));
  return w
    .active()
    .filter((t) => t.id !== p.id && !w.isCarried(t) && cheb(t, p) <= range)
    .sort((a, b) => cheb(a, p) - cheb(b, p) || a.id - b.id)
    .slice(0, 2)
    .map((t) =>
      cand("attack", `attack:mad:${t.id}`, `fall on ${t.name} in a frenzy`, {
        targetId: t.id,
        dest: { x: t.x, y: t.y },
        follow: true,
        reach: p.inventory.musket > 0 && !(p.cooldowns["reload"] !== undefined && w.tick < p.cooldowns["reload"]) ? w.config.muskets.range : 1,
        duration: 1,
        norm: true,
        motive: "madness",
        option: "lethal",
        effects: { frenzy: 1.2 },
      }),
    );
}

export const kidnap: ActionDef = {
  id: "kidnap",
  name: "Kidnap",
  candidates(p, w) {
    if (p.mad !== "kidnapper" || w.people.some((c) => c.captorId === p.id)) return [];
    const out: CandidateAction[] = [];
    for (const c of w.active()) {
      const age = w.ageYears(c);
      if (age < 2 || age >= 12 || c.householdId === p.householdId || c.captorId !== null || w.map.roofed(c.x, c.y)) continue;
      const guarded = w.active().some((a) => a.id !== p.id && a.id !== c.id && w.ageYears(a) >= 14 && cheb(a, c) <= 5);
      if (guarded || cheb(c, p) > 30) continue;
      out.push(cand("kidnap", `kidnap:${c.id}`, `snatch ${c.name}`, { targetId: c.id, dest: { x: c.x, y: c.y }, follow: true, duration: 1, norm: true, motive: "madness", effects: { frenzy: 1.1 } }));
    }
    return out.slice(0, 2);
  },
  resolve(p, c, w, ctx) {
    const child = w.maybePerson(c.targetId);
    if (!child || !w.isActive(child.id) || cheb(p, child) > 1 || child.captorId !== null) {
      ctx.success = false;
      return ctx.events;
    }
    child.captorId = p.id;
    child.cooldowns["captured"] = w.tick;
    interruptPlan(w, child, "kidnapped");
    const ev = ctx.emit("kidnapping", [p.id], { kidnapper: p.id, child: child.id, at: [child.x, child.y] });
    const crime = recordCrime(w, "assault", p.id, { t: "person", id: child.id }, child, ev.seq, 0);
    const seen = witnessAction(w, p, ctx.rng, { predicate: "attacked", object: { kind: "person", id: child.id }, crimeId: crime.id, identBonus: w.config.detection.violenceIdentBonus, exclude: [child.id] });
    if (seen.length > 0) {
      // Whoever saw it raises the alarm at once, and the nearest able adult runs the kidnapper down.
      raiseMissingAlarm(w, child, seen);
      const runner = seen
        .map((id) => w.person(id))
        .filter((o) => w.ageYears(o) >= 14 && !o.asleep && !w.isCarried(o) && !cannotWalk(o) && o.captorId === null)
        .sort((a, b) => cheb(a, p) - cheb(b, p) || a.id - b.id)[0];
      if (runner) startChase(w, runner, p, { t: "person", id: child.id }, crime.id, child.id);
    }
    selfKnowledge(w, p, "attacked", { kind: "person", id: child.id }, child, ev.seq, crime.id);
    feel(w, child, "afraid", `${firstName(p)} dragged them away`, 1);
    return ctx.events;
  },
};

/** The mad keep to their hiding place; a kidnapper takes the child there. */
export const hide: ActionDef = {
  id: "hide",
  name: "Hide",
  candidates(p, w) {
    if (!(p.mad === "kidnapper" && w.people.some((c) => c.captorId === p.id)) && p.mad !== "wanderer") return [];
    const dest = hideout(w, p);
    return [cand("hide", "hide", p.mad === "wanderer" ? "wander off into the woods" : "hide in the woods", { dest, reach: 3, duration: 6, travel: travelTicks(w, p, dest), effects: { frenzy: 0.9 } })];
  },
  resolve(_p, _c, _w, ctx) {
    return ctx.events;
  },
};

/** Searching the woods for a missing child: a different stretch of forest each time. */
export const search: ActionDef = {
  id: "search",
  name: "Search",
  candidates(p, w) {
    if (w.ageYears(p) < 14 || isDetained(w, p) || w.chases.some((c) => c.chaserId === p.id)) return [];
    const out: CandidateAction[] = [];
    for (const key of Object.keys(p.cooldowns)) {
      if (!key.startsWith("search:") || !onCooldown(w, p, key)) continue;
      const child = w.maybePerson(Number(key.slice(7)));
      if (!child || !w.isActive(child.id)) continue;
      const hurt = child.captorId === null && needsRescue(w, child);
      if (child.captorId === null && !hurt) continue;
      const c = w.compound(p.householdId).center;
      // Everyone sweeps a different sector and ring, so a big search covers the whole forest.
      const turn = (Math.floor(w.tick / 18) + p.id * 5) % 12;
      const r = 12 + ((Math.floor(w.tick / 72) + p.id) % 5) * 9;
      const clamp = (x: number, y: number) => ({ x: Math.max(1, Math.min(w.map.width - 2, x)), y: Math.max(1, Math.min(w.map.height - 2, y)) });
      // The family knows roughly which way a hurt person went; a kidnapper could be anywhere in the woods.
      const dest = hurt
        ? clamp(child.x + (((w.tick / 18) | 0) % 3 - 1) * 6, child.y + ((((w.tick / 18) | 0) + p.id) % 3 - 1) * 6)
        : w.map.nearest("forest", clamp(Math.round(c.x + Math.cos((turn * Math.PI) / 6) * r), Math.round(c.y + Math.sin((turn * Math.PI) / 6) * r)));
      const bond = p.relationships[child.id]?.bond ?? 0.5;
      out.push(cand("search", `search:${child.id}`, `search the woods for ${child.name}`, { targetId: child.id, dest, reach: 4, duration: 2, travel: travelTicks(w, p, dest), effects: { duty: 0.6 + bond, security: 0.2 } }));
    }
    return out.slice(0, 1);
  },
  resolve(p, c, w, ctx) {
    const child = w.maybePerson(c.targetId);
    const hurt = !!child && child.captorId === null && needsRescue(w, child);
    if (!child || (child.captorId === null && !hurt)) {
      ctx.success = false;
      return ctx.events;
    }
    if (cheb(child, p) > sightRange(w, p) || !w.map.lineOfSight(p.x, p.y, child.x, child.y)) {
      ctx.success = false;
      ctx.emit("searched", [p.id], { searcher: p.id, for: child.id, found: false });
      return ctx.events;
    }
    if (hurt) {
      // Found lying hurt: now to get them home.
      ctx.emit("found_injured", [p.id], { finder: p.id, person: child.id, at: [child.x, child.y] });
      for (const m of householdMembers(w, child.householdId)) delete m.cooldowns[`search:${child.id}`];
      p.cooldowns[`aid:${child.id}`] = w.tick + 18;
      return ctx.events;
    }
    const captor = w.maybePerson(child.captorId);
    child.captorId = null;
    const ev = ctx.emit("rescued", [p.id, child.id], { rescuer: p.id, child: child.id, captor: captor?.id ?? null });
    feel(w, p, "relieved", `found ${firstName(child)}`, 0.9);
    feel(w, child, "relieved", `${firstName(p)} found them`, 0.9);
    for (const o of w.people) delete o.cooldowns[`search:${child.id}`];
    if (captor) {
      const belief = addBelief(w, p, { subject: { kind: "person", id: captor.id }, predicate: "attacked", object: { kind: "person", id: child.id }, time: w.tick, confidence: 0.95, source: "saw", place: { x: child.x, y: child.y } }, ev.seq);
      p.grievances[captor.id] = { reason: "kidnapped", tick: w.tick };
      adjustTrust(p, captor.id, -1, w.tick);
      // The child says who took them: the rescuer takes the accusation to the council.
      if (w.isActive(captor.id)) {
        const info = { kind: "violence" as const, victim: { kind: "person" as const, id: child.id }, place: { x: child.x, y: child.y }, timeFrom: w.tick - w.days(3), timeTo: w.tick };
        const c4 = findMatchingCase(w, p, info) ?? openCase(w, p, info, belief);
        if (!c4.beliefIds.includes(belief.id)) c4.beliefIds.push(belief.id);
        c4.suspects = [{ personId: captor.id, means: 1, motive: 0.5, opportunity: 1, score: 2.5 }];
        if (c4.status === "open") fileAccusation(w, p, captor.id, c4);
      }
    }
    return ctx.events;
  },
};
