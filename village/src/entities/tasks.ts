// Every member of a house has a job. Tasks raise the value of the matching work.
import type { CandidateAction } from "../actions/types.ts";
import type { Person, Task } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { householdMembers } from "./person.ts";
import { skillLevel, TASK_SKILL } from "./skills.ts";

/**
 * Assigns tasks within a house: someone minds the young children, then farmer,
 * hunter (the boldest), woodcutter, fisher, carpenter, stonemason, watchman and
 * herder, and the rest forage. The kindest elder is the house's healer; other
 * elders advise and help with children; children are children.
 */
export function assignTasks(w: World, householdId: number): void {
  const members = householdMembers(w, householdId).sort((a, b) => a.id - b.id);
  const before = new Map(members.map((m) => [m.id, m.task]));
  const kidsUnder8 = members.some((m) => w.ageYears(m) < 8);
  const adults = members.filter((m) => w.ageYears(m) >= 16 && w.ageYears(m) < 60);
  const teens = members.filter((m) => w.ageYears(m) >= 11 && w.ageYears(m) < 16);
  for (const m of members) m.task = w.ageYears(m) >= 60 ? "elder" : w.ageYears(m) < 11 ? "child" : "forager";
  const free = adults.slice();
  // The most skilled at a task gets it; temperament breaks ties.
  const take = (task: Task, pick: (a: Person, b: Person) => number): void => {
    if (free.length === 0) return;
    const skill = TASK_SKILL[task];
    free.sort((a, b) => (skill ? skillLevel(w, b, skill) - skillLevel(w, a, skill) : 0) || pick(a, b) || a.id - b.id);
    free.shift()!.task = task;
  };
  const elders = members.filter((m) => w.ageYears(m) >= 60 && m.personality.empathy >= 0.4).sort((a, b) => b.personality.empathy - a.personality.empathy || a.id - b.id);
  if (elders[0]) elders[0].task = "healer";
  if (kidsUnder8) take("caretaker", (a, b) => b.personality.empathy - a.personality.empathy);
  take("farmer", (a, b) => b.personality.loyalty - a.personality.loyalty);
  take("hunter", (a, b) => b.personality.boldness - a.personality.boldness);
  take("woodcutter", (a, b) => b.survival.health - a.survival.health);
  take("fisher", (a, b) => b.personality.vigilance - a.personality.vigilance);
  take("carpenter", (a, b) => a.birthTick - b.birthTick);
  if (!elders[0]) take("healer", (a, b) => b.personality.empathy - a.personality.empathy);
  take("stonemason", (a, b) => b.survival.health - a.survival.health);
  take("watchman", (a, b) => b.personality.vigilance - a.personality.vigilance);
  if (teens.length > 0) teens[0]!.task = "herder";
  else take("herder", (a, b) => b.personality.empathy - a.personality.empathy);
  for (const m of members) {
    if (before.get(m.id) !== m.task) w.emit("task_assigned", [m.id], { person: m.id, task: m.task, household: householdId });
  }
}

const TASK_WORK: Record<Task, (c: CandidateAction) => boolean> = {
  caretaker: (c) => c.kind === "tend_children",
  farmer: (c) => c.kind === "harvest" || c.kind === "plant" || c.kind === "slaughter",
  fisher: (c) => c.key === "forage:river",
  forager: (c) => c.key === "forage:forest",
  hunter: (c) => c.kind === "hunt",
  woodcutter: (c) => c.kind === "gather_wood",
  carpenter: (c) => c.kind === "repair_shelter" || c.kind === "tend_fire" || c.kind === "craft",
  stonemason: (c) => c.kind === "masonry" || c.kind === "repair_shelter",
  healer: (c) => c.kind === "tend_wounded" || c.kind === "rescue",
  watchman: (c) => c.kind === "patrol" || c.kind === "rescue" || c.kind === "defend",
  herder: (c) => c.kind === "tend_animals",
  elder: (c) => c.kind === "tend_children" || c.kind === "socialize",
  child: () => false,
};

/** The family counts on each person to do their job: matching work carries a sense of duty. */
export function applyTaskDuty(p: Person, cands: CandidateAction[]): void {
  const match = TASK_WORK[p.task];
  for (const c of cands) if (match(c)) c.effects = { ...c.effects, duty: (c.effects.duty ?? 0) + 0.3 };
}
