import { breakUp, formPairBond, romanceEligible, setStage } from "../entities/bonding.ts";
import { afterDeparture } from "../entities/death.ts";
import { adjustBond, adjustTrust, cheb, clamp01, feel, firstName, rel } from "../entities/person.ts";
import type { Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { cand, isDetained, nearbyPeople, onCooldown, setCooldown } from "./helpers.ts";
import type { ActionDef, CandidateAction, Responder } from "./types.ts";

function stageWith(p: Person, otherId: number): string {
  return p.relationships[otherId]?.stage ?? "stranger";
}

function isCourtingAnyone(p: Person): boolean {
  return Object.keys(p.relationships).some((k) => p.relationships[Number(k)]!.stage === "courting");
}

function partnered(p: Person): boolean {
  return p.partnerId !== null;
}

function widowWaiting(w: World, p: Person): boolean {
  return p.widowedTick !== null && w.tick - p.widowedTick < w.days(w.config.bonding.remarriageDays);
}

function acceptReject(acceptEffects: CandidateAction["effects"]): CandidateAction[] {
  return [
    cand("respond", "respond:accept", "accept", { dest: null, duration: 0, option: "accept", effects: acceptEffects }),
    cand("respond", "respond:refuse", "refuse", { dest: null, duration: 0, option: "refuse", effects: {} }),
  ];
}

function answer(ctx: { response: number | null; responseOptions: CandidateAction[] | null }): string {
  if (ctx.response === null || !ctx.responseOptions) return "refuse";
  return ctx.responseOptions[ctx.response]?.option ?? "refuse";
}

export const court: ActionDef = {
  id: "court",
  name: "Court",
  candidates(p, w) {
    const t = w.config.bonding.thresholds;
    if (w.ageYears(p) < w.config.bonding.minAge || isDetained(w, p) || widowWaiting(w, p) || isCourtingAnyone(p)) return [];
    const affair = partnered(p);
    if (affair && p.personality.loyalty >= t.infidelityLoyalty) return [];
    const out: CandidateAction[] = [];
    for (const o of nearbyPeople(w, p, 8)) {
      if (o.asleep || isDetained(w, o) || !romanceEligible(w, p, o)) continue;
      const r = p.relationships[o.id];
      if (!r || (r.stage !== "acquaintance" && r.stage !== "friend")) continue;
      if (r.attraction < t.court || onCooldown(w, p, `court:${o.id}`)) continue;
      out.push(
        cand("court", `court:${o.id}`, `court ${o.name}`, {
          targetId: o.id,
          dest: { x: o.x, y: o.y },
          follow: true,
          duration: 2,
          risk: affair ? 0.3 : 0.05,
          effects: { romance: r.attraction - 0.3 + (1 - p.wants.affection) * 0.5, affection: 0.3, relation: 0.03 },
        }),
      );
    }
    return out;
  },
  respond(p, c, w) {
    const o = w.maybePerson(c.targetId);
    if (!o || !w.isActive(o.id)) return null;
    const attraction = o.relationships[p.id]?.attraction ?? 0;
    const trust = o.relationships[p.id]?.trust ?? 0;
    const loyaltyCost = partnered(o) ? o.personality.loyalty : 0;
    const busy = isCourtingAnyone(o) ? 0.4 : 0;
    return {
      responderId: o.id,
      options: acceptReject({ romance: attraction - 0.35 + (1 - o.wants.affection) * 0.4 + trust * 0.2 - loyaltyCost - busy, affection: 0.3, relation: 0.05 }),
    };
  },
  resolve(p, c, w, ctx) {
    const o = w.maybePerson(c.targetId);
    if (!o || !w.isActive(o.id) || cheb(p, o) > 2) {
      ctx.success = false;
      return ctx.events;
    }
    if (answer(ctx) === "accept") {
      setStage(w, p, o, "courting", "court_accepted");
      ctx.emit("courtship_started", [p.id, o.id], { suitor: p.id, accepted: o.id });
      feel(w, p, "in love", `${firstName(o)} accepted their courtship`, 0.6);
      feel(w, o, "in love", `${firstName(p)} is courting them`, 0.5);
      p.wants.affection = clamp01(p.wants.affection + 0.15);
      o.wants.affection = clamp01(o.wants.affection + 0.15);
      const partners = [p.partnerId, o.partnerId].filter((id) => id !== null);
      if (partners.length > 0) ctx.emit("affair", [p.id, o.id], { a: p.id, b: o.id, betrayed: partners });
    } else {
      ctx.success = false;
      ctx.emit("court_rejected", [o.id, p.id], { suitor: p.id, rejectedBy: o.id });
      feel(w, p, "sad", `${firstName(o)} rejected their advances`, 0.4);
      setCooldown(w, p, `court:${o.id}`, w.days(3));
      p.wants.affection = clamp01(p.wants.affection - 0.05);
      adjustBond(p, o.id, -0.03, w.tick);
    }
    return ctx.events;
  },
};

export const propose: ActionDef = {
  id: "propose",
  name: "Propose",
  candidates(p, w) {
    const t = w.config.bonding.thresholds;
    if (partnered(p) || isDetained(w, p)) return [];
    const out: CandidateAction[] = [];
    for (const k of Object.keys(p.relationships)) {
      const id = Number(k);
      const r = p.relationships[id]!;
      if (r.stage !== "courting" || w.tick - r.stageTick < w.days(t.minCourtDays)) continue;
      const o = w.maybePerson(id);
      if (!o || !w.isActive(o.id) || partnered(o) || cheb(p, o) > 80) continue;
      if (r.attraction < t.propose || p.wants.affection < t.proposeAffection || onCooldown(w, p, `propose:${id}`)) continue;
      out.push(
        cand("propose", `propose:${o.id}`, `propose to ${o.name}`, {
          targetId: o.id,
          dest: { x: o.x, y: o.y },
          follow: true,
          duration: 2,
          effects: { romance: 0.6 + r.attraction, affection: 0.4, relation: 0.05 },
        }),
      );
    }
    return out;
  },
  respond(p, c, w) {
    const o = w.maybePerson(c.targetId);
    if (!o || !w.isActive(o.id)) return null;
    const t = w.config.bonding.thresholds;
    const attraction = o.relationships[p.id]?.attraction ?? 0;
    const ready = attraction >= t.propose && o.wants.affection >= t.proposeAffection ? 0.4 : -0.4;
    const out: Responder[] = [{ responderId: o.id, options: acceptReject({ romance: attraction - 0.4 + ready, affection: 0.4, relation: 0.05 }) }];
    // A marriage between houses needs both house elders' blessing.
    if (w.config.marriage.approvalRequired && p.householdId !== o.householdId) {
      for (const [member, otherSide] of [[p, o], [o, p]] as const) {
        const head = w.maybePerson(w.households[member.householdId]!.headId);
        if (!head || head.id === p.id || head.id === o.id || !w.isActive(head.id)) continue;
        const feud = w.feud(member.householdId, otherSide.householdId);
        const bond = head.relationships[member.id]?.bond ?? 0.5;
        const trust = head.relationships[otherSide.id]?.trust ?? 0;
        out.push({
          responderId: head.id,
          options: [
            cand("respond", "respond:approve", `bless the marriage of ${member.name}`, {
              dest: null,
              duration: 0,
              option: "approve",
              effects: { relation: bond * 0.3 + trust * 0.3, status: 0.15, provision: 0.1 - otherSide.convictions * 0.2, grudge: -feud },
            }),
            cand("respond", "respond:forbid", `forbid the marriage of ${member.name}`, {
              dest: null,
              duration: 0,
              option: "forbid",
              effects: { grudge: feud * 0.8, status: 0.05 },
            }),
          ],
        });
      }
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const o = w.maybePerson(c.targetId);
    if (!o || !w.isActive(o.id) || cheb(p, o) > 2 || partnered(p) || partnered(o)) {
      ctx.success = false;
      return ctx.events;
    }
    const forbidders = ctx.responses.filter((r) => r.option.option === "forbid").map((r) => r.responderId);
    const approvers = ctx.responses.filter((r) => r.option.option === "approve").map((r) => r.responderId);
    const ev = ctx.emit("proposal", [p.id, o.id], { proposer: p.id, to: o.id, answer: answer(ctx), approvedBy: approvers, forbiddenBy: forbidders });
    if (answer(ctx) === "accept" && forbidders.length === 0) {
      formPairBond(w, p, o, ev.seq);
      p.wants.affection = clamp01(p.wants.affection + 0.3);
      o.wants.affection = clamp01(o.wants.affection + 0.3);
      feel(w, p, "joyful", `${firstName(o)} said yes`, 0.8);
      feel(w, o, "joyful", `married ${firstName(p)}`, 0.8);
    } else if (answer(ctx) === "accept") {
      ctx.success = false;
      ctx.emit("marriage_forbidden", [p.id, o.id], { a: p.id, b: o.id, forbiddenBy: forbidders });
      for (const id of forbidders) {
        const head = w.person(id);
        const forbidden = head.householdId === p.householdId ? o : p;
        w.addFeud(forbidden.householdId, head.householdId, w.config.feud.marriageRefused, "marriage forbidden");
        for (const lover of [p, o]) adjustTrust(lover, head.id, -0.3, w.tick);
      }
      for (const [a, b] of [[p, o], [o, p]] as const) {
        setCooldown(w, a, `forbidden:${b.id}`, w.days(30));
        feel(w, a, "heartbroken", `their elders forbade the marriage to ${firstName(b)}`, 0.8);
      }
    } else {
      ctx.success = false;
      setCooldown(w, p, `propose:${o.id}`, w.days(5));
      feel(w, p, "hurt", `${firstName(o)} turned down their proposal`, 0.6);
      p.wants.affection = clamp01(p.wants.affection - 0.1);
      rel(p, o.id, w.tick).attraction = Math.max(0, rel(p, o.id, w.tick).attraction - 0.05);
    }
    return ctx.events;
  },
};

/** Lovers whose marriage was forbidden may run away together. */
export const elope: ActionDef = {
  id: "elope",
  name: "Elope",
  candidates(p, w) {
    if (partnered(p) || isDetained(w, p)) return [];
    const out: CandidateAction[] = [];
    for (const k of Object.keys(p.relationships)) {
      const id = Number(k);
      const r = p.relationships[id]!;
      const until = p.cooldowns[`forbidden:${id}`];
      if (r.stage !== "courting" || until === undefined || w.tick >= until) continue;
      if (until - w.days(30) + w.days(w.config.marriage.elopeAfterRefusalDays) > w.tick) continue;
      const o = w.maybePerson(id);
      if (!o || !w.isActive(o.id) || partnered(o)) continue;
      out.push(
        cand("elope", `elope:${id}`, `run away with ${o.name}`, {
          targetId: id,
          dest: { x: o.x, y: o.y },
          follow: true,
          duration: 1,
          norm: false,
          risk: 0.3,
          effects: { romance: r.attraction + (1 - p.wants.affection) * 0.6 - 0.2, duty: -p.personality.loyalty * 0.6, security: -0.2 },
        }),
      );
    }
    return out;
  },
  respond(p, c, w) {
    const o = w.maybePerson(c.targetId);
    if (!o || !w.isActive(o.id)) return null;
    const r = o.relationships[p.id];
    return {
      responderId: o.id,
      options: acceptReject({ romance: (r?.attraction ?? 0) + (1 - o.wants.affection) * 0.6 - 0.2, duty: -o.personality.loyalty * 0.6, security: -0.2 }),
    };
  },
  resolve(p, c, w, ctx) {
    const o = w.maybePerson(c.targetId);
    if (!o || !w.isActive(o.id) || cheb(p, o) > 2 || partnered(p) || partnered(o)) {
      ctx.success = false;
      return ctx.events;
    }
    if (answer(ctx) !== "accept") {
      ctx.success = false;
      delete p.cooldowns[`forbidden:${o.id}`];
      feel(w, p, "heartbroken", `${firstName(o)} would not leave their family`, 0.7);
      return ctx.events;
    }
    const ev = ctx.emit("elopement", [p.id, o.id], { a: p.id, b: o.id, accepted: [p.id, o.id], houses: [p.householdId, o.householdId] });
    formPairBond(w, p, o, ev.seq, { elope: true });
    for (const lover of [p, o]) {
      for (const m of w.active()) {
        if (m.householdId !== lover.householdId || m.id === p.id || m.id === o.id) continue;
        feel(w, m, (m.relationships[lover.id]?.bond ?? 0) > 0.6 ? "heartbroken" : "angry", `${firstName(lover)} ran away with ${firstName(lover === p ? o : p)}`, 0.6);
      }
    }
    w.addFeud(p.householdId, o.householdId, w.config.feud.elopement, "elopement");
    w.addFeud(o.householdId, p.householdId, w.config.feud.elopement, "elopement");
    for (const lover of [p, o]) {
      lover.plan = null;
      lover.exiled = true;
      lover.departure = "elopement";
      afterDeparture(w, lover, "elopement");
    }
    return ctx.events;
  },
};

export const breakUpAction: ActionDef = {
  id: "break_up",
  name: "Break up",
  candidates(p, w) {
    const out: CandidateAction[] = [];
    for (const k of Object.keys(p.relationships)) {
      const id = Number(k);
      const r = p.relationships[id]!;
      if (r.stage !== "courting" && r.stage !== "pair_bonded") continue;
      if (!w.isActive(id)) continue;
      let elsewhere = 0;
      for (const k2 of Object.keys(p.relationships)) {
        const r2 = p.relationships[Number(k2)]!;
        if (Number(k2) !== id && r2.stage === "courting") elsewhere = Math.max(elsewhere, r2.attraction - r.attraction);
      }
      const want = (0.25 - r.attraction) + p.emotions.jealousy * 0.6 + Math.max(0, -r.trust) * 0.6 + elsewhere - (r.stage === "pair_bonded" ? 0.2 * p.personality.loyalty : 0);
      if (want <= 0.05) continue;
      const o = w.person(id);
      out.push(
        cand("break_up", `break_up:${id}`, `end things with ${o.name}`, {
          targetId: id,
          dest: { x: o.x, y: o.y },
          follow: true,
          duration: 1,
          effects: { romance: want, relation: -0.1 },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const o = w.maybePerson(c.targetId);
    const stage = stageWith(p, c.targetId!);
    if (!o || !w.isActive(o.id) || (stage !== "courting" && stage !== "pair_bonded")) {
      ctx.success = false;
      return ctx.events;
    }
    breakUp(w, p, o, p.emotions.jealousy > 0.5 ? "jealousy" : "unhappy");
    p.emotions.jealousy = 0;
    return ctx.events;
  },
};
