import type { Engine } from "../../src/engine/engine.ts";
import { EventLog, type SimEvent } from "../../src/log/events.ts";
import { createSimulation } from "../../src/sim.ts";
import { armFactor, cannotWalk, disfigurement, mobility, painOf, severityWord, sightFactor } from "../../src/entities/body.ts";
import { describeInjury } from "../../src/entities/injuries.ts";
import { foodUnits } from "../../src/world/items.ts";
import { NEED_KINDS, SKILLS, VALUES, type Animal, type BodyPart, type Injury, type NeedKind, type Person, type Value } from "../../src/world/types.ts";
import { deityOf, needStrength } from "../../src/entities/culture.ts";
import { skillLevel, skillTitle } from "../../src/entities/skills.ts";
import { hasBed } from "../../src/world/structures.ts";
import type { World } from "../../src/world/world.ts";
import { ALERT_LABELS, toAlert, type Alert, type AlertKind } from "./alerts.ts";
import { CouncilBook, type Session } from "./council.ts";
import { clock, describe, resetFeed, type FeedLine } from "./feed.ts";
import { FightBook, fightLines, fightSummary, type Fight } from "./fights.ts";
import { Renderer, drawMinimap, type Camera, type ViewOptions } from "./render.ts";
import { BODY_RECTS, HOUSEHOLD_COLORS, TILE, animalSprite, appearance, faceCanvas, hash2, lookFor } from "./sprites.ts";

// Ticks (10 game minutes each) per real second. At 1x a walk across a compound takes a couple of seconds.
const SPEEDS = [
  { label: "1x", tps: 0.4 },
  { label: "3x", tps: 1.2 },
  { label: "10x", tps: 4 },
  { label: "30x", tps: 12 },
  { label: "100x", tps: 40 },
  { label: "300x", tps: 120 },
];
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
/** Zoom the camera is easing toward, and the screen point that stays put while it does. */
let zoomGoal: { zoom: number; sx: number; sy: number } | null = null;
const POSITIVE = new Set(["happy", "grateful", "in love", "joyful", "relieved", "proud", "comforted", "content", "hopeful", "triumphant", "vindicated"]);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("world");
const minimap = $<HTMLCanvasElement>("minimap");
const renderer = new Renderer(canvas);
const miniBase: { img: ImageData | null; season: number } = { img: null, season: -1 };

let engine: Engine;
let world: World;
let feed: FeedLine[] = [];
let major: FeedLine[] = [];
let council = new CouncilBook();
const fights = new FightBook();
const fightToasts = new Map<number, HTMLElement>();
let openFightId: number | null = null;
let dirty = { feed: true, intrigue: true, council: true };
let speed = 1;
let paused = false;
let busy = false;
let acc = 0;
let lastTime = performance.now();
let prev = new Map<number, { x: number; y: number }>();
let selected: number | null = null;
let selectedAnimal: number | null = null;
let follow = false;
let userCamera = false;
let lastSize = "";
let power: "inspect" | "smite" | "madden" = "inspect";
let tab = "people";
const opts: ViewOptions = { roofs: true, traces: true, names: false, chronicle: true };
const cam: Camera = { x: 0, y: 0, zoom: 1.5 };
let stats = { thefts: 0, attacks: 0, accusations: 0, verdicts: 0, wrongful: 0, deaths: 0, births: 0, bonds: 0, plots: 0 };
const pauseOn: Record<AlertKind, boolean> = { fight: true, death: true, council: true, inquest: false, raid: true, madness: true, kidnap: true, wolf: true, retribution: true, injury: false, love: false, festival: false };
try {
  const saved = JSON.parse(localStorage.getItem("village.pauseOn") ?? "{}") as Partial<Record<AlertKind, boolean>>;
  Object.assign(pauseOn, saved);
} catch {
  // Preferences are optional.
}

// ---------- Events from the engine ----------

function onEvent(e: SimEvent): void {
  const fr = fights.onEvent(e);
  switch (e.type) {
    case "theft": stats.thefts++; break;
    case "attack": stats.attacks++; break;
    case "accusation": stats.accusations++; break;
    case "plot_formed": stats.plots++; break;
    case "verdict": {
      stats.verdicts++;
      const t = e.data.truth as { correct: boolean | null };
      if (t.correct === false && e.data.verdict === "guilty") stats.wrongful++;
      break;
    }
    case "death": stats.deaths++; break;
    case "child_born": stats.births++; break;
    case "pair_bond_formed": stats.bonds++; break;
    case "gunshot": {
      const [x, y] = e.data.at as [number, number];
      renderer.addEffect({ kind: "flash", x: x * TILE + 8, y: y * TILE + 4, born: performance.now() / 1000, dur: 0.6 });
      break;
    }
    case "scream": {
      const [x, y] = e.data.at as [number, number];
      renderer.addEffect({ kind: "text", text: "AAAH!", color: "#ffe14a", x: x * TILE + 8, y: y * TILE - 6, born: performance.now() / 1000, dur: 1.2 });
      renderer.addEffect({ kind: "ring", color: "#ffe14a", x: x * TILE + 8, y: y * TILE + 8, born: performance.now() / 1000, dur: 1 });
      break;
    }
  }
  if (!world) return;
  const line = describe(e, world);
  if (line) {
    feed.push(line);
    if (feed.length > 400) feed.shift();
    if (line.category === "intrigue" || line.category === "danger" || line.category === "death" || e.type === "intimidation" || e.type === "injustice_felt" || e.type === "elopement" || e.type === "marriage_forbidden") {
      major.push(line);
      if (major.length > 300) major.shift();
      dirty.intrigue = true;
    }
    dirty.feed = true;
  }
  if (council.onEvent(e, world)) dirty.council = true;
  const alert = toAlert(e, world);
  if (fr && fr.continued) updateFightToast(fr.fight);
  else if (alert) {
    if (fr) alert.fightId = fr.fight.id;
    raiseAlert(alert);
  }
  if (e.type === "attack") {
    // Show the blows as they land.
    const vic = world.maybePerson(e.data.victim as number);
    const att = world.maybePerson(e.data.attacker as number);
    if (vic && att) playFight(att, vic, e.data.blows as { by: number; hit: boolean; damage: number }[], String(e.data.weapon), 0);
  }
}

function playFight(att: Person, vic: Person, blows: { by: number; hit: boolean; damage: number }[], weapon: string, delayBase: number): void {
  const now = performance.now() / 1000;
  blows.forEach((b, i) => {
    const target = b.by === att.id ? vic : att;
    const from = b.by === att.id ? att : vic;
    if (i === 0 && weapon === "musket" && b.by === att.id) renderer.addEffect({ kind: "flash", x: from.x * TILE + 8, y: from.y * TILE + 4, born: now, dur: 0.6, delay: delayBase });
    renderer.addEffect({ kind: "text", text: b.hit ? `-${Math.round(b.damage * 100)}` : "miss", color: b.hit ? "#ff4040" : "#c8ccd2", x: target.x * TILE + 8, y: target.y * TILE - 4, born: now, dur: 1.2, delay: delayBase + i * 0.45 });
  });
}

// ---------- Alerts ----------

function raiseAlert(a: Alert): void {
  if (pauseOn[a.kind]) {
    paused = true;
    syncControls();
  } else if (a.kind !== "love") return;
  const box = $("toasts");
  const el = document.createElement("div");
  el.className = `toast ${a.kind}`;
  el.innerHTML = `<b>${a.icon} ${a.title} <small style="color:var(--dim)">${clock(world, a.tick)}</small></b><span class="t">${esc(a.text)}</span><div class="row">${a.at || a.hearingId ? `<button data-watch="1">${a.hearingId ? "Read transcript" : "Watch"}</button>` : ""}${a.fightId !== undefined ? `<button data-fightlog="${a.fightId}">Fight log</button>` : ""}<button data-close="1">Dismiss</button>${paused ? `<button data-resume="1">Resume ▶</button>` : ""}</div>`;
  if (a.fightId !== undefined) {
    fightToasts.set(a.fightId, el);
    el.querySelector("[data-fightlog]")!.addEventListener("click", () => openFight(a.fightId!));
  }
  el.querySelector("[data-close]")!.addEventListener("click", () => el.remove());
  el.querySelector("[data-resume]")?.addEventListener("click", () => {
    el.remove();
    paused = false;
    syncControls();
  });
  el.querySelector("[data-watch]")?.addEventListener("click", () => watch(a));
  box.prepend(el);
  while (box.children.length > 5) box.lastElementChild!.remove();
}

/** A fight that carries on updates its one alert instead of raising another. */
function updateFightToast(f: Fight): void {
  const el = fightToasts.get(f.id);
  if (el && el.isConnected) {
    el.querySelector(".t")!.textContent = fightSummary(f, world);
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }
  if (openFightId === f.id && $("modal").classList.contains("open")) openFight(f.id);
}

function openFight(id: number): void {
  const f = fights.fights.get(id);
  if (!f) return;
  bookOpen = false;
  panelOpen = null;
  openFightId = id;
  $("mtitle").textContent = `⚔ Fight: ${world.person(f.a).name} and ${world.person(f.b).name}`;
  $("mbody").innerHTML =
    `<div class="tline note">${esc(fightSummary(f, world))}</div>` +
    fightLines(f, world)
      .map((l) => `<div class="tline ${l.kind}">${linkNames(l.text, l.speaker !== undefined ? [l.speaker, f.a, f.b] : [f.a, f.b])}</div>`)
      .join("");
  $("modal").classList.add("open");
}

function watch(a: Alert): void {
  if (a.hearingId !== undefined) {
    const s = council.sessions.get(a.hearingId);
    if (s) openSession(s);
    return;
  }
  if (a.at) {
    const rect = canvas.getBoundingClientRect();
    zoomGoal = null;
    cam.zoom = 3;
    cam.x = a.at[0] * TILE + 8 - rect.width / cam.zoom / 2;
    cam.y = a.at[1] * TILE + 8 - rect.height / cam.zoom / 2;
    userCamera = true;
  }
  if (a.people[0] !== undefined) select(a.people[0]);
  if (a.blows && a.attacker !== undefined && a.victim !== undefined) {
    const att = world.maybePerson(a.attacker), vic = world.maybePerson(a.victim);
    if (att && vic) playFight(att, vic, a.blows, a.weapon ?? "", 0.2);
  }
}

// ---------- Setup ----------

function newVillage(seed: number): void {
  const log = new EventLog({ hash: false });
  feed = [];
  major = [];
  council = new CouncilBook();
  fights.reset();
  fightToasts.clear();
  openFightId = null;
  resetFeed();
  stats = { thefts: 0, attacks: 0, accusations: 0, verdicts: 0, wrongful: 0, deaths: 0, births: 0, bonds: 0, plots: 0 };
  renderer.reset();
  miniBase.img = null;
  $("toasts").innerHTML = "";
  log.addSink((e) => onEvent(e));
  // The tests check invariants every tick; the viewer trusts them and saves the time.
  engine = createSimulation({ seed, log, config: { checkInvariants: false } });
  world = engine.world;
  renderer.mapWidth = world.map.width;
  renderer.trails = new Map();
  prev = new Map(world.people.map((p) => [p.id, { x: p.x, y: p.y }]));
  selected = null;
  follow = false;
  userCamera = false;
  acc = 0;
  feed.push({ tick: 0, category: "village", text: `A new village is founded (seed ${seed}): ${world.people.length} people in ${world.households.length} houses.`, people: [] });
  dirty = { feed: true, intrigue: true, council: true };
  selectedAnimal = null;
  renderer.selectedAnimal = null;
  fitCamera();
  renderRoster();
}

function fitCamera(): void {
  const rect = canvas.getBoundingClientRect();
  if (!world || rect.width === 0 || rect.height === 0) return;
  // Start looking at the town, close enough to see people.
  zoomGoal = null;
  cam.zoom = 1.5;
  cam.x = world.map.square.x * TILE - rect.width / cam.zoom / 2;
  cam.y = world.map.square.y * TILE - rect.height / cam.zoom / 2;
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const size = `${rect.width}x${rect.height}@${dpr}`;
  if (size === lastSize) return;
  lastSize = size;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  if (!userCamera) fitCamera();
}

/** Runs n ticks, stopping early if an alert pauses the game. */
async function advance(n: number, ignorePause = false): Promise<void> {
  busy = true;
  for (let i = 0; i < n; i++) {
    prev = new Map(world.people.map((p) => [p.id, { x: p.x, y: p.y }]));
    renderer.prevAnimals = new Map(world.animals.map((a) => [a.id, { x: a.x, y: a.y }]));
    await engine.step();
    renderer.trails = new Map(world.trails);
    if (paused && !ignorePause) break;
  }
  busy = false;
}

/** Simulation time allowed per frame, so drawing stays smooth at high speeds. */
const FRAME_BUDGET_MS = 14;

/** Runs whole ticks owed by the clock until the frame's budget is spent; a backlog the machine cannot keep up with is dropped. */
async function advanceWithin(budget: number): Promise<void> {
  busy = true;
  const start = performance.now();
  while (acc >= 1 && performance.now() - start < budget && !paused) {
    prev = new Map(world.people.map((p) => [p.id, { x: p.x, y: p.y }]));
    renderer.prevAnimals = new Map(world.animals.map((a) => [a.id, { x: a.x, y: a.y }]));
    await engine.step();
    renderer.trails = new Map(world.trails);
    acc -= 1;
  }
  if (acc > 2) acc = 1.99;
  busy = false;
}

function frame(now: number): void {
  resize();
  const dt = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  const tps = SPEEDS[speed]!.tps;
  if (!paused && !busy) {
    acc += dt * tps;
    if (acc >= 1) void advanceWithin(FRAME_BUDGET_MS);
  }
  // Paused or not, people stay where they are drawn mid-step; acc only moves while running.
  const alpha = Math.min(1, acc);
  const sel = world.maybePerson(selected);
  const rect0 = canvas.getBoundingClientRect();
  if (follow && sel && sel.alive && !sel.exiled) {
    cam.x += (sel.x * TILE + 8 - rect0.width / cam.zoom / 2 - cam.x) * 0.15;
    cam.y += (sel.y * TILE + 8 - rect0.height / cam.zoom / 2 - cam.y) * 0.15;
  } else if (follow && selectedAnimal !== null) {
    const an = world.animals.find((x) => x.id === selectedAnimal);
    if (an && an.alive) {
      cam.x += (an.x * TILE + 8 - rect0.width / cam.zoom / 2 - cam.x) * 0.15;
      cam.y += (an.y * TILE + 8 - rect0.height / cam.zoom / 2 - cam.y) * 0.15;
    }
  }
  panCamera(dt);
  easeZoom(dt);
  renderer.draw(world, cam, opts, prev, alpha, selected, now / 1000);
  const rect = canvas.getBoundingClientRect();
  drawMinimap(minimap, world, cam, rect.width, rect.height, miniBase);
  updateHud();
  requestAnimationFrame(frame);
}

// ---------- HUD and panels ----------

const SEASON_ICON = ["🌱", "☀️", "🍂", "❄️"];
const WEATHER_ICON: Record<string, string> = { clear: "☀", cloudy: "☁", rain: "🌧", storm: "⛈", snow: "🌨" };
let hudThrottle = 0;

function bar(label: string, v: number, color: string): string {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return `<div class="bar"><span>${label}</span><i><b style="width:${pct}%;background:${color}"></b></i></div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function personLink(p: Person): string {
  const color = HOUSEHOLD_COLORS[p.householdId % HOUSEHOLD_COLORS.length];
  return `<a href="#" data-person="${p.id}" class="plink"><em style="background:${color}"></em>${esc(p.name.split(" ")[0]!)}</a>`;
}

function linkNames(text: string, people: number[]): string {
  let out = esc(text);
  for (const id of people) {
    const p = world.maybePerson(id);
    if (!p) continue;
    const name = esc(p.name.split(" ")[0]!);
    out = out.replace(name, `<a href="#" data-person="${id}">${name}</a>`);
  }
  return out;
}

function updateHud(force = false): void {
  if (++hudThrottle % 6 !== 0 && !force) return;
  const env = world.env;
  const clk = $("clock");
  clk.textContent = `${clock(world, world.tick)}  ${SEASON_ICON[env.season]} ${env.seasonName}  ${WEATHER_ICON[env.weather] ?? ""} ${env.weather}  ${env.temperature.toFixed(0)}°C${paused ? "  ⏸ PAUSED" : ""}`;
  clk.classList.toggle("paused", paused);
  const active = world.active();
  $("stats").innerHTML = [
    ["Population", `${active.length}`],
    ["Deaths", `${stats.deaths}`],
    ["Thefts", `${stats.thefts}`],
    ["Attacks", `${stats.attacks}`],
    ["Plots", `${stats.plots}`],
    ["Accusations", `${stats.accusations}`],
    ["Verdicts", `${stats.verdicts}${stats.wrongful ? ` <span class="bad">(${stats.wrongful}✗)</span>` : ""}`],
    ["Marriages", `${stats.bonds}`],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

  const stores = world.households.map((h) => {
    const color = HOUSEHOLD_COLORS[h.id % HOUSEHOLD_COLORS.length]!;
    const n = active.filter((p) => p.householdId === h.id).length;
    const herd = world.animals.filter((a) => a.alive && a.householdId === h.id).length;
    const feud = Math.max(...world.households.map((o) => world.feud(h.id, o.id)));
    const beds = world.furniture.filter((f) => f.buildingId === h.buildingId && f.kind === "bed").length;
    return `<div class="store"><em style="background:${color}"></em>${esc(h.name)} <small>(${n})</small><span title="food · grain in field · animals · wood · stone · valuables · beds">🍞${foodUnits(h.store)} 🌾${world.farms[h.id]!.crop.grain} 🐑${herd} 🪵${h.store.wood} 🪨${h.store.stone} 💎${h.store.valuables} 🛏${beds}${feud >= 0.4 ? ` <span class="bad">⚔${feud.toFixed(1)}</span>` : ""}</span></div>`;
  });
  stores.push(`<div class="store"><em style="background:#7a5230"></em>Communal store<span>🌾 ${world.communal.grain}</span></div>`);
  $("stores").innerHTML = stores.join("");
  if ((hudThrottle % 30 === 0 || force) && panelOpen && $("modal").classList.contains("open")) $("mbody").innerHTML = panelOpen === "culture" ? cultureHtml() : buildingHtml();

  if (hudThrottle % 12 === 0 || force) renderInspector();
  if (dirty.feed || force) renderFeed();
  if ((dirty.intrigue || hudThrottle % 60 === 0) && tab === "intrigue") renderIntrigue();
  if (dirty.council && tab === "council") renderCouncil();
  if ((hudThrottle % 60 === 0 || force) && tab === "people") renderRoster();
}

const EYE_COLOURS = ["brown", "hazel", "grey", "blue", "green"];
const TASK_NAMES: Record<string, string> = { caretaker: "caretaker", farmer: "farmer", fisher: "fisher", forager: "forager", hunter: "hunter", woodcutter: "woodcutter", carpenter: "carpenter", stonemason: "stonemason", healer: "healer", watchman: "night watchman", herder: "herder", elder: "village elder", child: "child" };

function isEye(part: BodyPart): boolean {
  return part === "left eye" || part === "right eye";
}

function injuryColor(inj: Injury): string {
  if (inj.kind === "lost" || inj.lasting === "lost eye") return "#0c0c0c";
  if (inj.permanent) return "#8a5ab0";
  if (inj.infected) return "#a0c020";
  return inj.severity >= 0.75 ? "#c01818" : inj.severity >= 0.5 ? "#e05a2a" : inj.severity >= 0.25 ? "#e0a03a" : "#e8d060";
}

function faceInfo(p: Person, age: number): Parameters<typeof faceCanvas>[0] {
  const lostEyes: ("left" | "right")[] = [];
  let bruised = false, cut = false, scar = false, deepScar = false, ruined = false;
  for (const i of p.injuries) {
    if (isEye(i.part) && (i.kind === "lost" || i.lasting === "lost eye")) lostEyes.push(i.part === "left eye" ? "left" : "right");
    const onFace = i.part === "face" || isEye(i.part) || i.part === "head";
    if (!onFace) continue;
    if (i.permanent) {
      if (i.lasting === "ruined face") ruined = true;
      else if (i.lasting === "disfiguring scar") deepScar = true;
      else if (i.lasting === "facial scar" || i.lasting === "scar") scar = true;
    } else if (i.severity >= 0.1) {
      if (i.kind === "bruise" || i.kind === "fracture" || i.kind === "sprain") bruised = true;
      else cut = true;
    }
  }
  return { id: p.id, sex: p.sex, age, household: p.householdId, mood: p.mood, pain: painOf(p), lostEyes, bruised, cut, scar, deepScar, ruined, dead: !p.alive };
}

function paintPanel(p: Person, age: number): void {
  const face = document.getElementById("face") as HTMLCanvasElement | null;
  if (face) {
    face.width = 16;
    face.height = 16;
    face.getContext("2d")!.drawImage(faceCanvas(faceInfo(p, age)), 0, 0);
  }
  const body = document.getElementById("bodydiag") as HTMLCanvasElement | null;
  if (!body) return;
  body.width = 40;
  body.height = 74;
  const g = body.getContext("2d")!;
  const skin = lookFor(p.id, p.householdId, age).skin;
  for (const part of Object.keys(BODY_RECTS)) {
    const [x, y, w, h] = BODY_RECTS[part]!;
    if (isEye(part as BodyPart)) continue;
    let col = skin;
    let worst = -1;
    for (const i of p.injuries) {
      if (i.part !== part) continue;
      const rank = (i.kind === "lost" ? 3 : i.permanent ? 1 : 0) + i.severity + (i.infected ? 0.5 : 0);
      if (rank > worst) {
        worst = rank;
        col = injuryColor(i);
      }
    }
    g.fillStyle = "#000";
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  }
  for (const part of ["left eye", "right eye"] as const) {
    const [x, y, w, h] = BODY_RECTS[part]!;
    const lost = p.injuries.some((i) => i.part === part && (i.kind === "lost" || i.lasting === "lost eye"));
    g.fillStyle = lost ? "#000" : "#f4f0e8";
    g.fillRect(x, y, w, h);
  }
  if (p.crutch) {
    g.fillStyle = "#8a6a3a";
    g.fillRect(3, 24, 2, 48);
    g.fillRect(1, 24, 6, 2);
  }
}

function describeBody(p: Person, age: number): string {
  const n = esc(p.name.split(" ")[0]!);
  const he = p.sex === "f" ? "She" : "He";
  const his = p.sex === "f" ? "her" : "his";
  const looks = appearance(p.id, age);
  const eyes = EYE_COLOURS[Math.floor(hash2(p.id, 29) * EYE_COLOURS.length)]!;
  const noun = age < 2 ? "infant" : age < 12 ? (p.sex === "f" ? "girl" : "boy") : age < 18 ? (p.sex === "f" ? "young woman" : "young man") : age >= 58 ? (p.sex === "f" ? "old woman" : "old man") : p.sex === "f" ? "woman" : "man";
  const hgt = hash2(p.id, 31);
  const frame = age < 12 ? "" : hgt < 0.25 ? "short" : hgt > 0.75 ? "tall" : "of middling height";
  const build = p.survival.food < 0.25 ? "gaunt from hunger" : p.survival.health < 0.4 ? "frail" : hash2(p.id, 37) < 0.3 ? "stocky" : hash2(p.id, 37) > 0.7 ? "lean" : "sturdy";
  const parts: string[] = [];
  parts.push(`<p>${n} is a ${age < 2 ? "baby" : `${age}-year-old`} ${noun}${frame ? `, ${frame}` : ""} and ${build}, with ${looks.skin} skin, ${looks.hair} hair and ${eyes} eyes.</p>`);
  const pain = painOf(p);
  const look = !p.alive ? `${he} is dead.` : pain > 0.5 ? `${he} grits ${his} teeth against the pain.` : p.mood > 0.35 ? `${he} looks cheerful.` : p.mood < -0.35 ? `${he} looks miserable.` : `${he} looks calm.`;
  const dis = disfigurement(p);
  const face = dis >= 0.65 ? ` ${his[0]!.toUpperCase()}${his.slice(1)} face is a ruin of scar tissue, and people look away.` : dis >= 0.4 ? ` A terrible scar disfigures ${his} face.` : dis >= 0.15 ? ` A scar marks ${his} face.` : "";
  parts.push(`<p>${look}${face}</p>`);
  const body: string[] = [];
  if (cannotWalk(p)) body.push(`${he} cannot walk and has to be carried.`);
  else {
    const mob = mobility(p);
    if (mob < 0.55) body.push(`${he} drags ${his} leg, walking at ${Math.round(mob * 100)}% of the usual pace${p.crutch ? ", leaning on a crutch" : ""}.`);
    else if (mob < 0.9) body.push(`${he} limps${p.crutch ? " on a crutch" : ""}.`);
    else if (p.crutch) body.push(`${he} still carries a crutch.`);
  }
  const arms = armFactor(p);
  if (arms < 0.6) body.push(`${his[0]!.toUpperCase()}${his.slice(1)} arms and hands are badly weakened, so ${he.toLowerCase()} works and fights poorly.`);
  else if (arms < 0.9) body.push(`${he} favours a hurt arm.`);
  const sight = sightFactor(p);
  if (sight < 0.3) body.push(`${he} is nearly blind.`);
  else if (sight < 0.85) body.push(`${he} sees poorly, with only one good eye.`);
  if (body.length) parts.push(`<p>${body.join(" ")}</p>`);
  const lasting = p.injuries.filter((i) => i.permanent);
  const fresh = p.injuries.filter((i) => !i.permanent && (i.severity >= 0.1 || i.infected));
  const wounds = [
    ...lasting.map((i) => `<li class="lasting">◆ ${esc(i.lasting ?? describeInjury(i))} <small>(${i.part.replace("foot", "ankle")}; ${esc(i.cause)})</small></li>`),
    ...fresh.map((i) => {
      const care = i.care < 0.1 ? "untended" : i.care < 0.5 ? "bandaged" : "well tended";
      const sev = severityWord(i);
      return `<li class="${i.severity >= 0.5 || i.infected ? "grave" : "wound"}">● ${esc(describeInjury(i))} — ${sev}, ${care}${i.infected ? ", <b>festering</b>" : ""} <small>(${esc(i.cause)}, ${clock(world, i.tick)})</small></li>`;
    }),
  ];
  parts.push(wounds.length ? `<ul class="wounds">${wounds.join("")}</ul>` : `<p>${p.alive ? `${he} has no injuries.` : ""}</p>`);
  return parts.join("");
}

const ANIMAL_STATE: Record<string, string> = { rest: "resting", graze: "grazing", roam: "ranging the woods", prowl: "slinking toward the road", ambush: "lying in wait by the road", hunt: "hunting", flee: "fleeing", ridden: "being ridden" };
const ANIMAL_NEEDS: Record<string, string> = {
  wolf: "A wolf sleeps at the den by day and ranges the deep woods morning and evening. Hungry at night, it chases deer (which mostly outrun it), lies in wait in the trees beside the roads for anyone walking alone, smells out the helpless from far off, and raids unguarded pens. It swims rivers. Groups, palisades and muskets drive it off.",
  deer: "Grazes its herd's range in the deep woods by day and beds down at night. It bolts from anyone walking near and from hunting wolves, and outruns a wolf more often than not. Hunters must sit still to get close.",
  rabbit: "Keeps close to its warren at the forest's edge. Quick enough to outrun a wolf most of the time; foxes are its bane.",
  fox: "Sleeps by day and hunts rabbits and unguarded hens at night. Its fur makes good coats.",
  horse: "Needs grazing and a pen at night. Carries a rider on long trips.",
};

function renderAnimal(el: HTMLElement, a: Animal): void {
  const owner = a.householdId === null ? "wild" : `the ${esc(world.households[a.householdId]?.name ?? "")} house`;
  let doing = ANIMAL_STATE[a.state] ?? a.state;
  if (a.target) {
    const [k, id] = a.target.split(":");
    const t = k === "p" ? world.maybePerson(Number(id)) : null;
    if (t) doing += ` — stalking <a href="#" data-person="${t.id}">${esc(t.name.split(" ")[0]!)}</a>`;
  }
  const rider = a.riderId !== null ? world.maybePerson(a.riderId) : null;
  const needs = ANIMAL_NEEDS[a.kind] ?? "Needs to graze by day and to be fed and penned at night. Wolves and foxes take the unguarded.";
  const history = a.log
    .slice(-14)
    .reverse()
    .map((n) => `<li><small>${clock(world, n.tick)}</small> ${esc(n.text)}</li>`)
    .join("");
  el.innerHTML = `
    <div class="pp-head"><canvas id="animalpic" class="animalpic" width="32" height="32"></canvas>
      <div class="who"><b>${a.kind[0]!.toUpperCase()}${a.kind.slice(1)} #${a.id}</b><small>${owner}${a.alive ? "" : " · dead"}</small></div></div>
    <div class="doing">${a.alive ? doing : `dead since ${clock(world, a.diedTick ?? world.tick)}${a.skinned ? ", skinned" : a.kind === "wolf" || a.kind === "deer" || a.kind === "fox" ? ", its fur still on it" : ""}`}${rider ? ` · ridden by ${personLink(rider)}` : ""}</div>
    <div class="cols"><div>${bar("Health", a.health, "#4ac060")}</div><div>${bar("Fed", 1 - a.hunger, "#e0a03a")}</div></div>
    <h4>Needs</h4><div class="desc"><p>${needs}</p></div>
    <h4>What it has been doing</h4><ul class="recent">${history || `<li class="hint">Nothing noted yet.</li>`}</ul>
    <label class="follow"><input type="checkbox" id="follow" ${follow ? "checked" : ""}> follow with camera</label>`;
  const pic = $<HTMLCanvasElement>("animalpic");
  const spr = animalSprite(a.kind, false);
  const g = pic.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  const sc = Math.max(1, Math.floor(30 / Math.max(spr.width, spr.height)));
  g.drawImage(spr, Math.floor((32 - spr.width * sc) / 2), Math.floor((32 - spr.height * sc) / 2), spr.width * sc, spr.height * sc);
  $<HTMLInputElement>("follow").onchange = (ev) => {
    follow = (ev.target as HTMLInputElement).checked;
  };
}

/** What holding (or scorning) each value looks like, as a verb phrase for "they". */
const VALUE_WORDS: Record<Value, [string, string]> = {
  law: ["respect the law", "have no respect for the law"],
  family: ["value family above all", "care little for family"],
  tradition: ["hold to the old ways", "scorn tradition"],
  craftsmanship: ["value good craftsmanship", "see no point in fine work"],
  hard_work: ["believe in hard work", "see work as a burden"],
  leisure: ["love a lazy afternoon", "think idleness a vice"],
  martial: ["admire strength at arms", "despise fighting"],
  peace: ["value peace", "think peace makes the weak"],
  nature: ["love the wild woods", "see the woods as something to use"],
  fairness: ["care deeply about fairness", "think fairness a fool's notion"],
  cooperation: ["value helping others", "would rather go it alone"],
  romance: ["are romantics at heart", "find romance foolish"],
  truth: ["value honesty", "see no harm in a lie"],
  merriment: ["love a celebration", "find merrymaking tiresome"],
  piety: ["are devout", "have no use for the gods"],
};
const NEED_LABELS: Record<NeedKind, string> = { pray: "to pray", create: "to make things", leisure: "to rest and play", family: "to be with family" };

function listJoin(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Skills, values, faith, needs and home comforts, Dwarf Fortress style. */
function lifeHtml(p: Person): string {
  const skills = SKILLS.map((s) => ({ s, l: skillLevel(world, p, s) })).filter((x) => x.l >= 1).sort((a, b) => b.l - a.l).slice(0, 6);
  const skillText = skills.map(({ s, l }) => `<span>${esc(skillTitle(l, s))}</span>`).join("");
  const held = VALUES.map((v) => ({ v, x: p.values[v] })).filter(({ x }) => Math.abs(x) >= 0.45).sort((a, b) => Math.abs(b.x) - Math.abs(a.x)).slice(0, 4);
  const pron = "They";
  const valueText = held.length ? `${pron} ${listJoin(held.map(({ v, x }) => VALUE_WORDS[v][x > 0 ? 0 : 1]))}.` : `${pron} hold no strong views.`;
  const god = deityOf(world, p);
  const faith = p.values.piety > 0.3 ? `Worships ${esc(god.name)}, god of ${esc(god.spheres.join(" and "))}, devoutly.` : p.values.piety > -0.3 ? `Worships ${esc(god.name)}, god of ${esc(god.spheres.join(" and "))}.` : `Pays little heed to ${esc(god.name)} or any god.`;
  const needs = NEED_KINDS.filter((n) => needStrength(p, n) >= 0.35)
    .map((n) => {
      const f = p.focus[n];
      const word = f < 0.15 ? `<span class="bad">badly unmet</span>` : f < 0.4 ? "unmet" : f > 0.75 ? "satisfied" : "fine";
      return `need ${NEED_LABELS[n]}: ${word}`;
    })
    .join(" · ");
  const bed = hasBed(world, p) ? "has a bed" : world.ageYears(p) < world.config.needs.infantAge ? "sleeps with their mother" : `<span class="bad">sleeps on the floor</span>`;
  const coat = p.inventory.coat > 0 ? " · wears a fur coat" : "";
  const silver = p.inventory.valuables > 0 ? ` · carries ${p.inventory.valuables} valuables` : "";
  return `${skillText ? `<h4>Skills</h4><div class="tags">${skillText}</div>` : ""}
    <h4>Beliefs</h4><div class="desc"><p>${valueText} ${faith}</p></div>
    <div class="traits">${bed}${coat}${silver}${needs ? ` · ${needs}` : ""}</div>`;
}

function renderInspector(): void {
  const el = $("inspector");
  const p = world.maybePerson(selected);
  if (!p) {
    const an = selectedAnimal !== null ? world.animals.find((x) => x.id === selectedAnimal) : undefined;
    if (an) {
      renderAnimal(el, an);
      return;
    }
    el.innerHTML = `<p class="hint">Click a villager or an animal (or a name anywhere) to follow their life.</p>`;
    return;
  }
  const age = Math.floor(world.ageYears(p));
  const status = !p.alive ? `☠ died of ${p.causeOfDeath}` : p.exiled ? (p.departure === "elopement" ? "ran away" : "exiled") : p.carriedById !== null ? `being carried by ${esc(world.person(p.carriedById).name.split(" ")[0]!)}` : p.plan ? esc(p.plan.cand.description) : cannotWalk(p) ? "lying hurt, calling for help" : "deciding";
  const s = p.survival, wn = p.wants, e = p.emotions, per = p.personality;
  const tags: string[] = [`<span>${TASK_NAMES[p.task] ?? p.task}</span>`];
  if (p.isHead) tags.push("<span>head of house</span>");
  if (p.mad) tags.push(`<span class="mad">mad: ${p.mad}</span>`);
  if (p.captorId !== null) tags.push(`<span class="blood">held captive</span>`);
  if (p.bloodyTool) tags.push(`<span class="blood">bloody tool</span>`);
  if (p.bloodyClothes) tags.push(`<span class="blood">blood on clothes</span>`);
  if (p.ridingHorseId !== null) tags.push("<span>on horseback</span>");
  if (p.inventory.musket > 0) tags.push("<span>musket</span>");
  if (p.crutch) tags.push("<span>crutch</span>");
  if (p.carryingId !== null) tags.push("<span>carrying someone</span>");
  if (p.pregnancy) tags.push("<span>expecting</span>");
  if (p.detainedUntil !== null && world.tick < p.detainedUntil) tags.push("<span>house arrest</span>");
  const grudges = Object.keys(p.injustice)
    .map((k) => ({ id: Number(k), v: p.injustice[Number(k)]! }))
    .filter(({ id, v }) => v >= 0.5 && world.isActive(id))
    .map(({ id, v }) => `<li>${personLink(world.person(id))} <small>let off by the council · ${v.toFixed(1)} acquittals</small></li>`)
    .join("");
  const rels = Object.keys(p.relationships)
    .map((k) => ({ id: Number(k), r: p.relationships[Number(k)]! }))
    .filter(({ id }) => world.isActive(id))
    .sort((a, b) => b.r.bond - a.r.bond || a.id - b.id)
    .slice(0, 5)
    .map(({ id, r }) => `<li>${personLink(world.person(id))} <small>${r.stage.replace("_", " ")} · bond ${r.bond.toFixed(2)} · trust ${r.trust.toFixed(2)}${r.attraction > 0.3 ? ` · ♥${r.attraction.toFixed(2)}` : ""}</small></li>`)
    .join("");
  const cases = p.caseFiles
    .filter((c) => c.status !== "closed")
    .map((c) => {
      const top = c.suspects[0];
      return `<li>${c.kind} case <small>${top ? `suspects ${personLink(world.person(top.personId))} (${top.score.toFixed(2)})` : "no suspects yet"}</small></li>`;
    })
    .join("");
  const plots = world.plots
    .filter((pl) => pl.status === "planning" && (pl.plannerId === p.id || pl.participants.includes(p.id)))
    .map((pl) => `<li>${pl.kind === "retribution" ? `vengeance (${pl.severity === "kill" ? "to kill" : pl.severity === "maim" ? "to cripple" : "to frighten"})` : `${pl.kind} plot`} <small>${pl.targetPersonId !== null ? `against ${personLink(world.person(pl.targetPersonId))}` : pl.targetHouseholdId !== null ? `against the ${world.households[pl.targetHouseholdId]!.name} house` : ""}${pl.sightings.length ? ` · knows ${pl.sightings.length} times they are alone` : ""}</small></li>`)
    .join("");
  const feelings = p.feelings
    .slice(-6)
    .reverse()
    .map((f) => `<li class="${POSITIVE.has(f.emotion) ? "pos" : "neg"}"><small>${clock(world, f.tick)}</small> felt <b>${esc(f.emotion)}</b> because ${esc(f.cause)}</li>`)
    .join("");
  const recent = p.recent
    .slice(-6)
    .reverse()
    .map((r) => `<li class="${r.ok ? "" : "fail"}"><small>${clock(world, r.tick)}</small> ${esc(r.text)}</li>`)
    .join("");
  const partner = world.maybePerson(p.partnerId);
  el.innerHTML = `
    <div class="pp-head"><canvas id="face" class="face" width="16" height="16"></canvas>
      <div class="who"><div><b>${esc(p.name)}</b><small>${p.sex === "f" ? "♀" : "♂"} ${age} · ${esc(world.households[p.householdId]!.name)} house${partner ? ` · partner ${personLink(partner)}` : ""}</small></div></div></div>
    <div class="doing">${status}</div>
    <div class="tags">${tags.join("")}</div>
    <div class="pp-mid"><canvas id="bodydiag" class="bodydiag" width="40" height="74"></canvas><div class="desc">${describeBody(p, age)}
      <div class="legend"><span><i style="background:#e8d060"></i>minor</span><span><i style="background:#e0a03a"></i>moderate</span><span><i style="background:#e05a2a"></i>serious</span><span><i style="background:#c01818"></i>grave</span><span><i style="background:#a0c020"></i>festering</span><span><i style="background:#8a5ab0"></i>lasting</span><span><i style="background:#0c0c0c"></i>lost</span></div></div></div>
    <div class="cols">
      <div>${bar("Food", s.food, "#e0a03a")}${bar("Water", s.water, "#4aa0f0")}${bar("Warmth", s.warmth, "#f0603a")}${bar("Rest", s.rest, "#9a7ae0")}${bar("Health", s.health, "#4ac060")}</div>
      <div>${bar("Mood", (p.mood + 1) / 2, p.mood >= 0 ? "#7ac860" : "#e05a4a")}${bar("Pain", painOf(p), "#e07a9a")}${bar("Company", wn.companionship, "#e0c050")}${bar("Security", wn.security, "#60b0c0")}${bar("Madness", p.madness, "#c070f0")}</div>
    </div>
    <div class="traits">bold ${per.boldness.toFixed(2)} · empathy ${per.empathy.toFixed(2)} · greed ${per.greed.toFixed(2)} · honesty ${per.honesty.toFixed(2)} · loyalty ${per.loyalty.toFixed(2)}</div>
    <div class="traits">guilt ${e.guilt.toFixed(2)} · grief ${e.grief.toFixed(2)} · jealousy ${e.jealousy.toFixed(2)} · ${p.beliefs.length} beliefs · carries 🍞${foodUnits(p.inventory)}</div>
    ${lifeHtml(p)}
    ${grudges ? `<h4>Grudges</h4><ul>${grudges}</ul>` : ""}
    ${feelings ? `<h4>Feelings</h4><ul class="feelings">${feelings}</ul>` : ""}
    ${recent ? `<h4>Recently</h4><ul class="recent">${recent}</ul>` : ""}
    ${plots ? `<h4>Plotting</h4><ul>${plots}</ul>` : ""}
    ${cases ? `<h4>Investigating</h4><ul>${cases}</ul>` : ""}
    ${rels ? `<h4>Closest</h4><ul>${rels}</ul>` : ""}
    <label class="follow"><input type="checkbox" id="follow" ${follow ? "checked" : ""}> follow with camera</label>`;
  paintPanel(p, age);
  $<HTMLInputElement>("follow").onchange = (ev) => {
    follow = (ev.target as HTMLInputElement).checked;
  };
}

function feedHtml(n: number, oldestFirst: boolean): string {
  const lines = feed.slice(-n).map((l) => `<li class="${l.category}"><time>${clock(world, l.tick)}</time> ${linkNames(l.text, l.people)}${l.badge ? ` <mark>${l.badge}</mark>` : ""}</li>`);
  return (oldestFirst ? lines : lines.reverse()).join("");
}

function renderFeed(): void {
  dirty.feed = false;
  $("feed").innerHTML = feedHtml(14, true);
  if ($("modal").classList.contains("open") && bookOpen) $("mbody").innerHTML = `<ul id="fullfeed">${feedHtml(400, false)}</ul>`;
}

let bookOpen = false;
function openBook(): void {
  bookOpen = true;
  panelOpen = null;
  openFightId = null;
  $("mtitle").textContent = "📖 Chronicle";
  $("mbody").innerHTML = `<ul id="fullfeed">${feedHtml(400, false)}</ul>`;
  $("modal").classList.add("open");
}

function renderIntrigue(): void {
  dirty.intrigue = false;
  const plots = world.plots
    .slice()
    .reverse()
    .slice(0, 40)
    .map((pl) => {
      const planner = world.person(pl.plannerId);
      const target = pl.targetPersonId !== null ? personLink(world.person(pl.targetPersonId)) : pl.targetHouseholdId !== null ? `the ${esc(world.households[pl.targetHouseholdId]!.name)} ${pl.kind === "theft" && pl.targetHolder?.t === "farm" ? "farm" : "house"}` : "the communal store";
      const icon = pl.kind === "murder" ? "🗡" : pl.kind === "raid" ? "🔥" : pl.kind === "retribution" ? "😠" : "🫳";
      const more = pl.kind === "retribution" ? ` · to ${pl.severity === "kill" ? "kill" : pl.severity === "maim" ? "cripple" : "frighten"}` : pl.kind === "murder" && pl.sightings.length ? ` · knows ${pl.sightings.length} times the target is alone` : pl.kind === "raid" ? ` · ${pl.participants.length} raiders` : "";
      return `<li class="plot intrigue"><time>${clock(world, pl.createdTick)}</time> ${icon} <b>${pl.kind}</b> ${personLink(planner)} → ${target} <small>(${esc(pl.motive)}${more})</small> <span class="status ${pl.status}">${pl.status}</span>${pl.outcome ? `<br><small>${esc(pl.outcome)}</small>` : ""}</li>`;
    })
    .join("");
  const events = major
    .slice(-60)
    .reverse()
    .map((l) => `<li class="${l.category}"><time>${clock(world, l.tick)}</time> ${linkNames(l.text, l.people)}</li>`)
    .join("");
  $("intrigue").innerHTML = `<h4>Plots</h4>${plots || `<li class="hint">No plots yet.</li>`}<h4>Major events</h4>${events || `<li class="hint">Nothing yet.</li>`}`;
}

/** The village's ways: values, gods, the festival, and what is being built. */
/** Which side panel the modal is showing, so it can refresh while open. */
let panelOpen: "culture" | "building" | null = null;

function openPanel(kind: "culture" | "building"): void {
  bookOpen = false;
  openFightId = null;
  panelOpen = kind;
  $("mtitle").textContent = kind === "culture" ? "🏛 Culture and faith" : "🔨 Building";
  $("mbody").innerHTML = kind === "culture" ? cultureHtml() : buildingHtml();
  $("modal").classList.add("open");
}

/** The village's ways: values, gods, festivals. */
function cultureHtml(): string {
  const c = world.culture;
  const held = VALUES.map((v) => ({ v, x: c.values[v] })).sort((a, b) => b.x - a.x);
  const love = listJoin(held.slice(0, 3).map(({ v }) => VALUE_WORDS[v][0]));
  const scorn = listJoin(held.slice(-2).filter(({ x }) => x < -0.1).map(({ v }) => VALUE_WORDS[v][1]));
  const temple = world.buildings.some((b) => b.kind === "temple");
  const people = world.active().filter((p) => world.ageYears(p) >= 12);
  const gods = c.deities
    .map((d) => {
      const n = people.filter((p) => p.deityId === d.id).length;
      return `<li><b>${esc(d.name)}</b>, god of ${esc(listJoin(d.spheres))} <small>· ${n} worshipper${n === 1 ? "" : "s"}</small></li>`;
    })
    .join("");
  const scale = (x: number) => (x >= 0.5 ? "holds dear" : x >= 0.15 ? "values" : x > -0.15 ? "is indifferent to" : x > -0.5 ? "doubts" : "scorns");
  const values = held.map(({ v, x }) => `<li>${scale(x)} <b>${VALUE_TOPICS[v]}</b> <small>(${x >= 0 ? "+" : ""}${x.toFixed(2)})</small></li>`).join("");
  const houses = world.households
    .map((h) => {
      const m = people.filter((p) => p.householdId === h.id);
      if (m.length === 0) return "";
      const avg = (v: Value) => m.reduce((a, p) => a + p.values[v], 0) / m.length;
      const top = VALUES.map((v) => ({ v, x: avg(v) })).sort((a, b) => b.x - a.x).slice(0, 2).map(({ v }) => VALUE_TOPICS[v]);
      return `<li>The <b>${esc(h.name)}</b> house leans toward ${listJoin(top)}</li>`;
    })
    .join("");
  const nextFest = world.config.culture.festivalFirstDay + Math.max(0, Math.ceil((world.env.day - world.config.culture.festivalFirstDay) / world.config.culture.festivalEveryDays)) * world.config.culture.festivalEveryDays;
  const fest = world.festival ? `<p>🎉 <b>${esc(world.festival.name)}</b> is under way in the square.</p>` : `<p>The next festival is on day ${nextFest + 1}.</p>`;
  return `<div class="desc"><p>${esc(c.name.charAt(0).toUpperCase() + c.name.slice(1))} ${love}${scorn ? `, but ${scorn}` : ""}.</p>${fest}</div>
    <h4>Gods${temple ? " (worshipped at the temple in town)" : ""}</h4><ul>${gods}</ul>
    <h4>Values</h4><ul>${values}</ul>
    <h4>Houses</h4><ul>${houses}</ul>`;
}

/** What is being built, what has been finished, and how each house is furnished. */
function buildingHtml(): string {
  const owner = (hid: number | null) => (hid === null ? "the village" : `the ${esc(world.households[hid]!.name)} house`);
  const active = world.projects
    .filter((pr) => pr.status === "planned")
    .map((pr) => {
      const wood = Math.max(0, pr.need.wood - pr.stock.wood), stone = Math.max(0, pr.need.stone - pr.stock.stone);
      const mats = wood + stone > 0 ? `waiting on ${wood ? `${wood} wood` : ""}${wood && stone ? " and " : ""}${stone ? `${stone} stone` : ""}` : `${Math.round((pr.done / pr.work) * 100)}% built`;
      const builders = pr.builders.filter((id) => world.isActive(id)).map((id) => personLink(world.person(id))).join(", ");
      return `<li><b>${PROJECT_NAMES[pr.kind] ?? pr.kind}</b> for ${owner(pr.householdId)} <small>· ${mats} · begun ${clock(world, pr.createdTick)}</small>${builders ? `<br><small>worked on by ${builders}</small>` : ""}</li>`;
    })
    .join("");
  const done = world.projects
    .filter((pr) => pr.status === "done")
    .slice(-20)
    .reverse()
    .map((pr) => {
      const f = world.furniture.find((x) => x.tick === pr.doneTick && x.x === pr.site.x && x.y === pr.site.y);
      const q = f && f.quality > 0 ? `${QUALITY_WORDS[f.quality]} ` : "";
      const by = f?.makerId ? ` by ${personLink(world.person(f.makerId))}` : "";
      return `<li><time>${clock(world, pr.doneTick ?? pr.createdTick)}</time> ${q}${(PROJECT_NAMES[pr.kind] ?? pr.kind).replace(/^an? /, "")} for ${owner(pr.householdId)}${by}</li>`;
    })
    .join("");
  const rows = world.households
    .map((h) => {
      const n = (k: string) => world.furniture.filter((f) => f.buildingId === h.buildingId && f.kind === k).length;
      const people = world.active().filter((p) => p.householdId === h.id);
      const bedless = people.filter((p) => world.ageYears(p) >= world.config.needs.infantAge && !hasBed(world, p)).length;
      return `<tr><td>${esc(h.name)}</td><td>${n("bed")}${bedless ? ` <span class="bad">(${bedless} on the floor)</span>` : ""}</td><td>${n("table")}</td><td>${n("chair")}</td><td>${n("chest")}</td><td>${n("altar")}</td><td>${world.fenced.includes(h.id) ? "✓" : ""}</td></tr>`;
    })
    .join("");
  return `<h4>Under way</h4><ul>${active || `<li class="hint">Nothing is being built right now.</li>`}</ul>
    <h4>Furnishings</h4><table class="furn"><tr><th></th><th>Beds</th><th>Tables</th><th>Chairs</th><th>Chests</th><th>Altars</th><th>Palisade</th></tr>${rows}</table>
    <h4>Recently finished</h4><ul>${done || `<li class="hint">Nothing yet.</li>`}</ul>`;
}

const VALUE_TOPICS: Record<Value, string> = {
  law: "the law", family: "family", tradition: "tradition", craftsmanship: "craftsmanship", hard_work: "hard work", leisure: "leisure",
  martial: "martial prowess", peace: "peace", nature: "nature", fairness: "fairness", cooperation: "cooperation", romance: "romance",
  truth: "truth", merriment: "merriment", piety: "piety",
};
const QUALITY_WORDS = ["", "well-crafted", "finely-crafted", "superior", "exceptional", "masterful"];

const PROJECT_NAMES: Record<string, string> = { bed: "a bed", table: "a table", chair: "a chair", chest: "a chest", altar: "a household altar", well: "a new well", pump: "a well pump", bridge: "a bridge over the river", extension: "new rooms", fence: "a palisade round the pen", temple: "a temple" };

function renderCouncil(): void {
  dirty.council = false;
  const list = [...council.sessions.values()].reverse();
  const inquests = world.inquests
    .slice()
    .reverse()
    .map((iq) => {
      const name = esc(world.person(iq.personId).name.split(" ")[0]!);
      const readings = iq.readings.map((r) => `${esc(world.person(r.judge).name.split(" ")[0]!)}: ${CAUSE_WORDS[r.cause] ?? r.cause}`).join("; ");
      const state = iq.status === "held" ? `<b>${FINDING_WORDS[iq.finding ?? ""] ?? iq.finding}</b>` : `<b>examining the body</b>`;
      return `<li class="justice"><time>${clock(world, iq.calledTick)}</time> Inquest into ${name}'s death — ${state}${readings ? `<br><small>${readings}</small>` : ""}</li>`;
    })
    .join("");
  $("council").innerHTML =
    (inquests ? `<h4>Inquests</h4>${inquests}<h4>Hearings</h4>` : "") +
    list
      .map((s) => {
        const state = s.verdict ? (s.verdict === "guilty" ? `guilty → ${s.sentence}` : "acquitted") : s.openedTick === null ? `scheduled ${clock(world, s.scheduledTick)}` : "in session";
        return `<li class="session justice" data-session="${s.hearingId}"><time>${clock(world, s.openedTick ?? s.scheduledTick)}</time> ${esc(world.person(s.accused).name.split(" ")[0]!)} accused of ${s.kind} — <b>${state}</b>${s.correct === false ? ` <mark>${s.verdict === "guilty" ? "WRONGFUL" : "culprit walks"}</mark>` : ""}</li>`;
      })
      .join("") || `<li class="hint">The council has not sat yet.</li>`;
}

const CAUSE_WORDS: Record<string, string> = { person: "killed by someone", wolf: "wolves", unknown: "no mark on the body", starvation: "starved", exposure: "cold", dehydration: "thirst", exhaustion: "exhaustion", infection: "a festering wound", wounds: "wounds" };
const FINDING_WORDS: Record<string, string> = { murder: "ruled a murder: an investigation is opened", wolves: "killed by wolves: the hunters go after the pack", natural: "a natural death: buried and mourned" };

function openSession(s: Session): void {
  bookOpen = false;
  panelOpen = null;
  openFightId = null;
  $("mtitle").textContent = `⚖ Council: ${world.person(s.accused).name} accused of ${s.kind}`;
  $("mbody").innerHTML =
    s.lines.map((l) => `<div class="tline ${l.kind}">${linkNames(l.text, l.speaker !== undefined ? [l.speaker, s.accused] : [s.accused])}${l.lie ? `<span class="liebadge">[${esc(l.lie)}]</span>` : ""}</div>`).join("") +
    (s.verdict ? "" : `<div class="tline note">The hearing has not finished.</div>`);
  $("modal").classList.add("open");
}

function renderRoster(): void {
  $("roster").innerHTML = world.people
    .map((p) => {
      const gone = !p.alive || p.exiled;
      const hurt = !gone && (cannotWalk(p) || p.injuries.some((i) => !i.permanent && i.severity >= 0.3));
      return `<a href="#" data-person="${p.id}" class="${gone ? "gone" : ""}${p.id === selected ? " sel" : ""}${p.mad ? " mad" : ""}"><em style="background:${HOUSEHOLD_COLORS[p.householdId % HOUSEHOLD_COLORS.length]}"></em>${esc(p.name.split(" ")[0]!)}${!p.alive ? " ☠" : p.exiled ? " ⇥" : p.mad ? " 🌀" : hurt ? " 🩹" : ""}</a>`;
    })
    .join(" ");
}

function select(id: number | null): void {
  selected = id;
  if (id !== null) selectedAnimal = null;
  renderer.selectedAnimal = selectedAnimal;
  renderInspector();
  renderRoster();
}

function selectAnimal(id: number | null): void {
  selectedAnimal = id;
  renderer.selectedAnimal = id;
  if (id !== null) selected = null;
  renderInspector();
  renderRoster();
}

// ---------- Input ----------

document.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const a = t.closest("[data-person]") as HTMLElement | null;
  if (a) {
    ev.preventDefault();
    select(Number(a.dataset.person));
    follow = true;
    if (tab !== "people") setTab("people");
    return;
  }
  const s = t.closest("[data-session]") as HTMLElement | null;
  if (s) {
    const session = council.sessions.get(Number(s.dataset.session));
    if (session) openSession(session);
  }
});
$("mclose").onclick = () => {
  bookOpen = false;
  panelOpen = null;
  openFightId = null;
  $("modal").classList.remove("open");
};
$("modal").addEventListener("click", (ev) => {
  if (ev.target === $("modal")) {
    bookOpen = false;
    panelOpen = null;
    openFightId = null;
    $("modal").classList.remove("open");
  }
});

function setPower(p: typeof power): void {
  power = p;
  canvas.className = p === "inspect" ? "" : `power-${p}`;
  document.querySelectorAll<HTMLButtonElement>("[data-power]").forEach((b) => b.classList.toggle("on", b.dataset.power === p));
}

/** Click tolerance in screen pixels: generous, and wider for things that are moving. */
function hitRadius(moving: boolean): number {
  return Math.max(26, 11 * cam.zoom) + (moving ? 10 : 0);
}

type Hit = { kind: "person"; id: number; d: number } | { kind: "animal"; id: number; d: number };

/** Whatever is closest to the click: a person or an animal, judged where it is drawn right now. */
function pickAt(sx: number, sy: number): Hit | null {
  let best: Hit | null = null;
  for (const p of world.active()) {
    if (world.isCarried(p)) continue;
    const from = prev.get(p.id);
    const moving = !!from && (from.x !== p.x || from.y !== p.y);
    const s = renderer.personScreen(p, cam, prev, renderer.alpha);
    const d = Math.hypot(s.x - sx, s.y - 6 * cam.zoom - sy);
    if (d < hitRadius(moving) && (!best || d < best.d)) best = { kind: "person", id: p.id, d };
  }
  // The dead: bodies awaiting burial, and carcasses lying in the woods.
  for (const t of world.traces) {
    if (t.kind !== "body") continue;
    const who = t.involves.find((r) => r.kind === "person");
    if (!who || who.kind !== "person") continue;
    const d = Math.hypot((t.location.x * TILE + 8 - cam.x) * cam.zoom - sx, (t.location.y * TILE + 9 - cam.y) * cam.zoom - sy);
    if (d < hitRadius(false) && (!best || d + 6 < best.d)) best = { kind: "person", id: who.id, d };
  }
  for (const a of world.animals) {
    if (a.alive || a.diedTick === null || world.tick - a.diedTick >= world.days(world.config.animals.carcassDays)) continue;
    const d = Math.hypot((a.x * TILE + 8 - cam.x) * cam.zoom - sx, (a.y * TILE + 12 - cam.y) * cam.zoom - sy);
    if (d < hitRadius(false) && (!best || d + 6 < best.d)) best = { kind: "animal", id: a.id, d };
  }
  for (const a of world.animals) {
    if (!a.alive || a.riderId !== null) continue;
    const from = renderer.prevAnimals.get(a.id);
    const moving = !!from && (from.x !== a.x || from.y !== a.y);
    const wp = renderer.animalWorld(a, renderer.alpha);
    const d = Math.hypot((wp.x - cam.x) * cam.zoom - sx, (wp.y - 4 - cam.y) * cam.zoom - sy);
    // People win ties: an animal must be clearly nearer.
    if (d < hitRadius(moving) && (!best || d + (best.kind === "person" ? 4 : 0) < best.d)) best = { kind: "animal", id: a.id, d };
  }
  return best;
}

let dragging = false, dragMoved = false, dragX = 0, dragY = 0;
/** Fingers on the map, for pinch zoom: the world point under their midpoint stays put. */
const touches = new Map<number, { x: number; y: number }>();
let pinch: { d: number; zoom: number; wx: number; wy: number } | null = null;

function pinchFrame(): { d: number; mx: number; my: number } {
  const [a, b] = [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
  const rect = canvas.getBoundingClientRect();
  return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2 - rect.left, my: (a.y + b.y) / 2 - rect.top };
}

canvas.addEventListener("pointerdown", (ev) => {
  touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  canvas.setPointerCapture(ev.pointerId);
  if (touches.size === 2) {
    const f = pinchFrame();
    pinch = { d: f.d, zoom: cam.zoom, wx: f.mx / cam.zoom + cam.x, wy: f.my / cam.zoom + cam.y };
    zoomGoal = null;
    dragMoved = true;
    return;
  }
  dragging = true;
  dragMoved = false;
  dragX = ev.clientX;
  dragY = ev.clientY;
});
canvas.addEventListener("pointermove", (ev) => {
  if (touches.has(ev.pointerId)) touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch && touches.size >= 2) {
    const f = pinchFrame();
    cam.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (pinch.zoom * f.d) / pinch.d));
    cam.x = pinch.wx - f.mx / cam.zoom;
    cam.y = pinch.wy - f.my / cam.zoom;
    follow = false;
    userCamera = true;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const wx = (ev.clientX - rect.left) / cam.zoom + cam.x, wy = (ev.clientY - rect.top) / cam.zoom + cam.y;
  const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
  renderer.hoverBuilding = world.map.inBounds(tx, ty) ? world.map.buildingAt(tx, ty) : -1;
  if (!dragging) return;
  const dx = ev.clientX - dragX, dy = ev.clientY - dragY;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
  if (dragMoved) {
    cam.x -= dx / cam.zoom;
    cam.y -= dy / cam.zoom;
    dragX = ev.clientX;
    dragY = ev.clientY;
    follow = false;
    userCamera = true;
  }
});
canvas.addEventListener("pointerup", (ev) => {
  touches.delete(ev.pointerId);
  if (pinch) {
    // One finger lifted: the other carries on panning from where it is.
    if (touches.size < 2) pinch = null;
    const rest = [...touches.values()][0];
    dragging = rest !== undefined;
    if (rest) {
      dragX = rest.x;
      dragY = rest.y;
    }
    return;
  }
  dragging = false;
  if (dragMoved) return;
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
  const hit = pickAt(sx, sy);
  const person = hit?.kind === "person" ? hit.id : null;
  if (power === "smite") {
    if (hit?.kind === "person") engine.intervene({ kind: "smite", personId: hit.id });
    else if (hit?.kind === "animal") engine.intervene({ kind: "smite_animal", animalId: hit.id });
    renderer.addEffect({ kind: "flash", x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y, born: performance.now() / 1000, dur: 0.8 });
    setPower("inspect");
    if (paused && !busy) void advance(1, true);
    return;
  }
  if (power === "madden") {
    if (person !== null) {
      engine.intervene({ kind: "madden", personId: person });
      select(person);
    }
    setPower("inspect");
    if (paused && !busy) void advance(1, true);
    return;
  }
  if (hit?.kind === "animal") selectAnimal(hit.id);
  else {
    selectedAnimal = null;
    select(person);
  }
  // On a phone, tapping someone opens their sheet; tapping empty ground goes back to the map.
  if (phone.matches) {
    document.body.classList.remove("menu-open");
    if (hit) openSheet("people");
    else if (sheet !== "none") openSheet("none");
  }
});
canvas.addEventListener("pointercancel", (ev) => {
  dragging = false;
  touches.delete(ev.pointerId);
  if (touches.size < 2) pinch = null;
});
canvas.addEventListener("pointerleave", () => {
  renderer.hoverBuilding = -1;
});
canvas.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    // Wheels report pixels, lines or pages; a mouse notch is about 100 px, a trackpad sends many small ones.
    const px = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? rect.height : 1);
    zoomToward((zoomGoal?.zoom ?? cam.zoom) * Math.exp(-Math.max(-250, Math.min(250, px)) * 0.0018), ev.clientX - rect.left, ev.clientY - rect.top);
  },
  { passive: false },
);

minimap.addEventListener("click", (ev) => {
  const r = minimap.getBoundingClientRect();
  const tx = ((ev.clientX - r.left) / r.width) * world.map.width, ty = ((ev.clientY - r.top) / r.height) * world.map.height;
  const rect = canvas.getBoundingClientRect();
  cam.x = tx * TILE - rect.width / cam.zoom / 2;
  cam.y = ty * TILE - rect.height / cam.zoom / 2;
  userCamera = true;
  follow = false;
});

function setSpeed(i: number): void {
  speed = i;
  paused = false;
  syncControls();
}

function syncControls(): void {
  $("pause").textContent = paused ? "▶" : "⏸";
  $("mspeed").textContent = SPEEDS[speed]!.label;
  document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => b.classList.toggle("on", !paused && Number(b.dataset.speed) === speed));
  document.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((b) => b.classList.toggle("on", opts[b.dataset.toggle as keyof ViewOptions]));
  $("chronicle").classList.toggle("hidden", !opts.chronicle);
}

$("speeds").innerHTML = SPEEDS.map((s, i) => `<button data-speed="${i}">${s.label}</button>`).join("");
document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => (b.onclick = () => setSpeed(Number(b.dataset.speed))));
document.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((b) => {
  b.onclick = () => {
    const k = b.dataset.toggle as keyof ViewOptions;
    opts[k] = !opts[k];
    syncControls();
  };
});
document.querySelectorAll<HTMLButtonElement>("[data-power]").forEach((b) => (b.onclick = () => setPower(b.dataset.power as typeof power)));
function setTab(name: string): void {
  tab = name;
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((x) => x.classList.toggle("on", x.dataset.tab === name));
  document.querySelectorAll<HTMLElement>(".tab").forEach((x) => x.classList.toggle("show", x.id === name));
  dirty = { feed: true, intrigue: true, council: true };
  updateHud(true);
}
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab!)));
$("book").onclick = openBook;

// The villager list folds away to give the person panel more room; the choice is remembered.
function setRosterCollapsed(collapsed: boolean): void {
  $("people").classList.toggle("collapsed", collapsed);
  $("rostertoggle").textContent = `${collapsed ? "▸" : "▾"} Villagers`;
  try {
    localStorage.setItem("village.rosterCollapsed", collapsed ? "1" : "0");
  } catch {
    // Preferences are optional.
  }
}
$("rostertoggle").onclick = () => setRosterCollapsed(!$("people").classList.contains("collapsed"));
try {
  setRosterCollapsed(localStorage.getItem("village.rosterCollapsed") === "1");
} catch {
  setRosterCollapsed(false);
}
$("culturebtn").onclick = () => openPanel("culture");
$("buildbtn").onclick = () => openPanel("building");

// ---------- Phone layout: bottom bar, sheets and a menu ----------

const phone = window.matchMedia("(max-width: 760px)");
const SHEET_TITLES: Record<string, string> = { people: "👤 People", intrigue: "🗡 Intrigue", council: "⚖ Council", village: "⌂ Village" };
let sheet = "none";

function openSheet(name: string): void {
  sheet = name;
  document.body.dataset.sheet = name;
  document.body.classList.toggle("sheet-open", name !== "none");
  document.querySelectorAll<HTMLButtonElement>("[data-sheet]").forEach((b) => b.classList.toggle("on", b.dataset.sheet === name));
  if (name === "none") return;
  $("sheettitle").textContent = SHEET_TITLES[name] ?? name;
  if (name !== "village") setTab(name);
  else updateHud(true);
}
document.querySelectorAll<HTMLButtonElement>("[data-sheet]").forEach((b) => (b.onclick = () => openSheet(sheet === b.dataset.sheet ? "none" : b.dataset.sheet!)));
$("sheetclose").onclick = () => openSheet("none");
$("mbook").onclick = openBook;
$("menubtn").onclick = () => document.body.classList.toggle("menu-open");
$("mspeed").onclick = () => setSpeed((speed + 1) % SPEEDS.length);
$("alertprefs").innerHTML = (Object.keys(ALERT_LABELS) as AlertKind[])
  .map((k) => `<label><input type="checkbox" data-alert="${k}" ${pauseOn[k] ? "checked" : ""}> ${ALERT_LABELS[k]}</label>`)
  .join("");
document.querySelectorAll<HTMLInputElement>("[data-alert]").forEach((c) => {
  c.onchange = () => {
    pauseOn[c.dataset.alert as AlertKind] = c.checked;
    try {
      localStorage.setItem("village.pauseOn", JSON.stringify(pauseOn));
    } catch {
      // Preferences are optional.
    }
  };
});
$("gear").onclick = () => $("settings").classList.toggle("open");
$("pause").onclick = () => {
  paused = !paused;
  syncControls();
};
$("step").onclick = () => {
  paused = true;
  syncControls();
  if (!busy) void advance(6, true);
};
$<HTMLFormElement>("seedform").onsubmit = (ev) => {
  ev.preventDefault();
  newVillage(Number($<HTMLInputElement>("seed").value) || 1);
};
$("random").onclick = () => {
  const seed = Math.floor(Math.random() * 100000);
  $<HTMLInputElement>("seed").value = String(seed);
  newVillage(seed);
};
const held = new Set<string>();

/** WASD pans (shift for faster); holding Q or E zooms smoothly about the middle of the view. */
function panCamera(dt: number): void {
  let dx = 0, dy = 0;
  if (held.has("a")) dx -= 1;
  if (held.has("d")) dx += 1;
  if (held.has("w")) dy -= 1;
  if (held.has("s")) dy += 1;
  const zoomDir = (held.has("e") ? 1 : 0) - (held.has("q") ? 1 : 0);
  if (zoomDir !== 0) {
    const rect = canvas.getBoundingClientRect();
    zoomToward((zoomGoal?.zoom ?? cam.zoom) * Math.exp(zoomDir * 2.2 * dt), rect.width / 2, rect.height / 2);
  }
  if (dx === 0 && dy === 0) return;
  const speed = (held.has("shift") ? 1100 : 520) / cam.zoom;
  const norm = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
  cam.x += dx * speed * dt * norm;
  cam.y += dy * speed * dt * norm;
  follow = false;
  userCamera = true;
}

/** Sets the zoom to ease toward, keeping the world point under screen point (sx, sy) in place. */
function zoomToward(zoom: number, sx: number, sy: number): void {
  zoomGoal = { zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)), sx, sy };
  userCamera = true;
}

/** Eases the zoom toward its goal in log space, so zooming in and out feel the same speed. */
function easeZoom(dt: number): void {
  if (!zoomGoal) return;
  const { zoom: goal, sx, sy } = zoomGoal;
  const wx = sx / cam.zoom + cam.x, wy = sy / cam.zoom + cam.y;
  const gap = Math.log(goal / cam.zoom);
  cam.zoom = Math.abs(gap) < 0.002 ? goal : cam.zoom * Math.exp(gap * (1 - Math.exp(-dt * 14)));
  if (cam.zoom === goal) zoomGoal = null;
  cam.x = wx - sx / cam.zoom;
  cam.y = wy - sy / cam.zoom;
}

window.addEventListener("keyup", (ev) => {
  held.delete(ev.key.toLowerCase());
});
window.addEventListener("blur", () => held.clear());
window.addEventListener("keydown", (ev) => {
  if ((ev.target as HTMLElement).tagName === "INPUT" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if ("wasdqe".includes(k) && k.length === 1 || k === "shift") {
    held.add(k);
    return;
  }
  if (ev.key === " ") { ev.preventDefault(); paused = !paused; syncControls(); }
  if (ev.key >= "1" && ev.key <= "6") setSpeed(Number(ev.key) - 1);
  if (k === "r") { opts.roofs = !opts.roofs; syncControls(); }
  if (k === "t") { opts.traces = !opts.traces; syncControls(); }
  if (k === "n") { opts.names = !opts.names; syncControls(); }
  if (k === "c") { opts.chronicle = !opts.chronicle; syncControls(); }
  if (k === "b") { if (bookOpen) { bookOpen = false; $("modal").classList.remove("open"); } else openBook(); }
  if (k === "i") setPower("inspect");
  if (k === "x") setPower("smite");
  if (k === "m") setPower("madden");
  if (ev.key === "Escape") { select(null); selectAnimal(null); setPower("inspect"); bookOpen = false; $("modal").classList.remove("open"); }
});

// Console hook for poking at the running village: village.advance(144) skips a day.
(window as unknown as { village: unknown }).village = {
  advance: (n: number) => advance(n, true),
  get world() {
    return world;
  },
  get engine() {
    return engine;
  },
  get camera() {
    return { ...cam };
  },
  get renderer() {
    return renderer;
  },
  /** Times drawing the map alone, n frames, at the current camera. */
  timeDraw: (n = 10) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) renderer.draw(world, cam, opts, prev, 1, selected, performance.now() / 1000);
    return (performance.now() - t0) / n;
  },
  select,
  draw: () => {
    renderer.draw(world, cam, opts, prev, 1, selected, performance.now() / 1000);
    const rect = canvas.getBoundingClientRect();
    drawMinimap(minimap, world, cam, rect.width, rect.height, miniBase);
    updateHud(true);
  },
  look: (x: number, y: number, zoom = 2) => {
    const rect = canvas.getBoundingClientRect();
    zoomGoal = null;
    cam.zoom = zoom;
    cam.x = x * TILE - rect.width / zoom / 2;
    cam.y = y * TILE - rect.height / zoom / 2;
    userCamera = true;
  },
  setPaused: (v: boolean) => {
    paused = v;
    syncControls();
  },
  openSession: (id: number) => {
    const s = council.sessions.get(id);
    if (s) openSession(s);
  },
  sessions: () => [...council.sessions.keys()],
  tab: (name: string) => (document.querySelector(`[data-tab="${name}"]`) as HTMLButtonElement | null)?.click(),
  selectAnimal,
  fights: () => [...fights.fights.values()],
  openFight,
};

const initialSeed = Number(new URLSearchParams(location.search).get("seed") ?? 42);
$<HTMLInputElement>("seed").value = String(initialSeed);
resize();
newVillage(initialSeed);
syncControls();
setPower("inspect");
requestAnimationFrame(frame);
