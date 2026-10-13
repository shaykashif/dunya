// Skills, Dwarf Fortress style. Doing a job earns experience in its skill; the
// level (0 to 20) makes the work go better: more found, more made, finer things.
import type { Rng } from "../engine/rng.ts";
import { SKILLS, type Person, type Skill, type Task } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { feel } from "./person.ts";

export const LEVEL_NAMES = [
  "Dabbling", "Novice", "Adequate", "Competent", "Skilled", "Proficient", "Talented", "Adept", "Expert", "Professional",
  "Accomplished", "Great", "Master", "High Master", "Grand Master", "Legendary",
];

/** What someone practising each skill is called. */
export const SKILL_NOUNS: Record<Skill, string> = {
  farming: "farmer",
  fishing: "fisher",
  foraging: "forager",
  hunting: "hunter",
  woodcutting: "woodcutter",
  carpentry: "carpenter",
  masonry: "mason",
  medicine: "healer",
  fighting: "fighter",
  herding: "herder",
};

/** The skill each household task exercises. */
export const TASK_SKILL: Partial<Record<Task, Skill>> = {
  farmer: "farming",
  fisher: "fishing",
  forager: "foraging",
  hunter: "hunting",
  woodcutter: "woodcutting",
  carpenter: "carpentry",
  stonemason: "masonry",
  healer: "medicine",
  watchman: "fighting",
  herder: "herding",
};

export function emptySkills(): Record<Skill, number> {
  return { farming: 0, fishing: 0, foraging: 0, hunting: 0, woodcutting: 0, carpentry: 0, masonry: 0, medicine: 0, fighting: 0, herding: 0 };
}

export function levelOf(w: World, xp: number): number {
  const s = w.config.skills;
  return Math.min(s.maxLevel, Math.floor(Math.sqrt(xp / s.levelXp)));
}

export function skillLevel(w: World, p: Person, skill: Skill): number {
  return levelOf(w, p.skills[skill]);
}

/** How much better the work goes, from 0.75 untrained to 1.25 legendary. */
export function skillFactor(w: World, p: Person, skill: Skill): number {
  return 0.75 + 0.025 * skillLevel(w, p, skill);
}

/** "Skilled carpenter", "Novice fisher". */
export function skillTitle(level: number, skill: Skill): string {
  return `${LEVEL_NAMES[Math.min(LEVEL_NAMES.length - 1, level)]} ${SKILL_NOUNS[skill]}`;
}

/** Practice: experience from doing the work. Milestones are noticed. */
export function practise(w: World, p: Person, skill: Skill, ticks: number): void {
  const before = skillLevel(w, p, skill);
  p.skills[skill] += Math.max(1, Math.round(ticks * w.config.skills.xpPerTick));
  const after = skillLevel(w, p, skill);
  if (after <= before) return;
  w.emit("skill_up", [p.id], { person: p.id, skill, level: after, title: skillTitle(after, skill) });
  if (after % 3 === 0 || after >= 12) feel(w, p, "proud", `became a ${skillTitle(after, skill)}`, 0.3);
}

/**
 * Starting experience: years of life spent at a few things. Each person has a
 * leaning toward one or two skills; everyone has picked up a little of the rest.
 */
export function startingSkills(rng: Rng, age: number): Record<Skill, number> {
  const out = emptySkills();
  const working = Math.max(0, age - 10);
  for (const s of SKILLS) out[s] = Math.round(working * rng.next() * 12);
  const main = SKILLS[rng.int(SKILLS.length)]!;
  const second = SKILLS[rng.int(SKILLS.length)]!;
  out[main] += Math.round(working * (40 + rng.next() * 80));
  out[second] += Math.round(working * (15 + rng.next() * 40));
  return out;
}

/** Best level among a person's skills, and which. */
export function bestSkill(w: World, p: Person): { skill: Skill; level: number } {
  let best: Skill = "foraging", lv = -1;
  for (const s of SKILLS) {
    const l = skillLevel(w, p, s);
    if (l > lv) { lv = l; best = s; }
  }
  return { skill: best, level: lv };
}
