import type { Engine } from "../../src/engine/engine.ts";
import { EventLog, type SimEvent } from "../../src/log/events.ts";
import { createSimulation } from "../../src/sim.ts";
import { foodUnits } from "../../src/world/items.ts";
import type { Person } from "../../src/world/types.ts";
import type { World } from "../../src/world/world.ts";
import { ALERT_LABELS, toAlert, type Alert, type AlertKind } from "./alerts.ts";
import { CouncilBook, type Session } from "./council.ts";
import { clock, describe, resetFeed, type FeedLine } from "./feed.ts";
import { Renderer, drawMinimap, type Camera, type ViewOptions } from "./render.ts";
import { HOUSEHOLD_COLORS, TILE } from "./sprites.ts";

// Ticks (10 game minutes each) per real second. At 1x a walk across a compound takes a couple of seconds.
const SPEEDS = [
  { label: "1x", tps: 0.4 },
  { label: "3x", tps: 1.2 },
  { label: "10x", tps: 4 },
  { label: "30x", tps: 12 },
  { label: "100x", tps: 40 },
  { label: "300x", tps: 120 },
];
const ZOOMS = [0.25, 0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6];
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
let dirty = { feed: true, intrigue: true, council: true };
let speed = 1;
let paused = false;
let busy = false;
let acc = 0;
let lastTime = performance.now();
let prev = new Map<number, { x: number; y: number }>();
let selected: number | null = null;
let follow = false;
let userCamera = false;
let lastSize = "";
let power: "inspect" | "smite" | "madden" = "inspect";
let tab = "feed";
const opts: ViewOptions = { roofs: true, traces: true, names: false };
const cam: Camera = { x: 0, y: 0, zoom: 1.5 };
let stats = { thefts: 0, attacks: 0, accusations: 0, verdicts: 0, wrongful: 0, deaths: 0, births: 0, bonds: 0, plots: 0 };
const pauseOn: Record<AlertKind, boolean> = { fight: true, death: true, council: true, raid: true, madness: true, kidnap: true, wolf: true, love: false };
try {
  const saved = JSON.parse(localStorage.getItem("village.pauseOn") ?? "{}") as Partial<Record<AlertKind, boolean>>;
  Object.assign(pauseOn, saved);
} catch {
  // Preferences are optional.
}

// ---------- Events from the engine ----------

function onEvent(e: SimEvent): void {
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
    case "burial": {
      const i = renderer.graves.length;
      const sq = world.map.square;
      renderer.graves.push({ x: (sq.x - 10 + (i % 4)) * TILE + 4, y: (sq.y + 6 + Math.floor(i / 4)) * TILE + 4 });
      break;
    }
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
    if (line.category === "intrigue" || line.category === "danger" || line.category === "death" || e.type === "elopement" || e.type === "marriage_forbidden") {
      major.push(line);
      if (major.length > 300) major.shift();
      dirty.intrigue = true;
    }
    dirty.feed = true;
  }
  if (council.onEvent(e, world)) dirty.council = true;
  const alert = toAlert(e, world);
  if (alert) raiseAlert(alert);
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
  el.innerHTML = `<b>${a.icon} ${a.title} <small style="color:var(--dim)">${clock(world, a.tick)}</small></b>${esc(a.text)}<div class="row">${a.at || a.hearingId ? `<button data-watch="1">${a.hearingId ? "Read transcript" : "Watch"}</button>` : ""}<button data-close="1">Dismiss</button>${paused ? `<button data-resume="1">Resume ▶</button>` : ""}</div>`;
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

function watch(a: Alert): void {
  if (a.hearingId !== undefined) {
    const s = council.sessions.get(a.hearingId);
    if (s) openSession(s);
    return;
  }
  if (a.at) {
    const rect = canvas.getBoundingClientRect();
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
  const log = new EventLog();
  feed = [];
  major = [];
  council = new CouncilBook();
  resetFeed();
  stats = { thefts: 0, attacks: 0, accusations: 0, verdicts: 0, wrongful: 0, deaths: 0, births: 0, bonds: 0, plots: 0 };
  renderer.reset();
  miniBase.img = null;
  $("toasts").innerHTML = "";
  log.addSink((e) => onEvent(e));
  engine = createSimulation({ seed, log });
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
  fitCamera();
  renderRoster();
}

function fitCamera(): void {
  const rect = canvas.getBoundingClientRect();
  if (!world || rect.width === 0 || rect.height === 0) return;
  // Start looking at the town, close enough to see people.
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

function frame(now: number): void {
  resize();
  const dt = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  const tps = SPEEDS[speed]!.tps;
  if (!paused && !busy) {
    acc += dt * tps;
    const n = Math.min(Math.floor(acc), 12);
    if (n > 0) {
      acc -= n;
      if (acc > 12) acc = 0;
      void advance(n);
    }
  }
  const alpha = paused ? 1 : Math.min(1, acc);
  const sel = world.maybePerson(selected);
  if (follow && sel && sel.alive && !sel.exiled) {
    const rect = canvas.getBoundingClientRect();
    cam.x += (sel.x * TILE + 8 - rect.width / cam.zoom / 2 - cam.x) * 0.15;
    cam.y += (sel.y * TILE + 8 - rect.height / cam.zoom / 2 - cam.y) * 0.15;
  }
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
    return `<div class="store"><em style="background:${color}"></em>${esc(h.name)} <small>(${n})</small><span>🍞${foodUnits(h.store)} 🌾${world.farms[h.id]!.crop.grain} 🐑${herd}${feud >= 0.4 ? ` <span class="bad">⚔${feud.toFixed(1)}</span>` : ""}</span></div>`;
  });
  stores.push(`<div class="store"><em style="background:#7a5230"></em>Communal store<span>🌾 ${world.communal.grain}</span></div>`);
  $("stores").innerHTML = stores.join("");

  if (hudThrottle % 12 === 0 || force) renderInspector();
  if (dirty.feed && tab === "feed") renderFeed();
  if ((dirty.intrigue || hudThrottle % 60 === 0) && tab === "intrigue") renderIntrigue();
  if (dirty.council && tab === "council") renderCouncil();
  if ((hudThrottle % 60 === 0 || force) && tab === "roster") renderRoster();
}

function renderInspector(): void {
  const el = $("inspector");
  const p = world.maybePerson(selected);
  if (!p) {
    el.innerHTML = `<p class="hint">Click a villager (or a name anywhere) to follow their life.</p>`;
    return;
  }
  const age = Math.floor(world.ageYears(p));
  const status = !p.alive ? `☠ died of ${p.causeOfDeath}` : p.exiled ? (p.departure === "elopement" ? "ran away" : "exiled") : p.plan ? esc(p.plan.cand.description) : "deciding";
  const s = p.survival, wn = p.wants, e = p.emotions, per = p.personality;
  const tags: string[] = [`<span>${p.task}</span>`];
  if (p.role === "elder") tags.push("<span>village elder</span>");
  if (p.isHead) tags.push("<span>head of house</span>");
  if (p.mad) tags.push(`<span class="mad">mad: ${p.mad}</span>`);
  if (p.captorId !== null) tags.push(`<span class="blood">held captive</span>`);
  if (p.bloodyTool) tags.push(`<span class="blood">bloody tool</span>`);
  if (p.bloodyClothes) tags.push(`<span class="blood">blood on clothes</span>`);
  if (p.ridingHorseId !== null) tags.push("<span>on horseback</span>");
  if (p.inventory.musket > 0) tags.push("<span>musket</span>");
  if (p.pregnancy) tags.push("<span>expecting</span>");
  if (p.detainedUntil !== null && world.tick < p.detainedUntil) tags.push("<span>house arrest</span>");
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
    .map((pl) => `<li>${pl.kind} plot <small>${pl.targetPersonId !== null ? `against ${personLink(world.person(pl.targetPersonId))}` : pl.targetHouseholdId !== null ? `against the ${world.households[pl.targetHouseholdId]!.name} house` : ""}${pl.sightings.length ? ` · knows ${pl.sightings.length} times they are alone` : ""}</small></li>`)
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
    <div class="who"><em style="background:${HOUSEHOLD_COLORS[p.householdId % HOUSEHOLD_COLORS.length]}"></em><div><b>${esc(p.name)}</b><small>${p.sex === "f" ? "♀" : "♂"} ${age} · ${esc(world.households[p.householdId]!.name)}${partner ? ` · partner ${personLink(partner)}` : ""}</small></div></div>
    <div class="doing">${status}</div>
    <div class="tags">${tags.join("")}</div>
    <div class="cols">
      <div>${bar("Food", s.food, "#e0a03a")}${bar("Water", s.water, "#4aa0f0")}${bar("Warmth", s.warmth, "#f0603a")}${bar("Rest", s.rest, "#9a7ae0")}${bar("Health", s.health, "#4ac060")}</div>
      <div>${bar("Mood", (p.mood + 1) / 2, p.mood >= 0 ? "#7ac860" : "#e05a4a")}${bar("Company", wn.companionship, "#e0c050")}${bar("Affection", wn.affection, "#e06090")}${bar("Security", wn.security, "#60b0c0")}${bar("Madness", p.madness, "#c070f0")}</div>
    </div>
    <div class="traits">bold ${per.boldness.toFixed(2)} · empathy ${per.empathy.toFixed(2)} · greed ${per.greed.toFixed(2)} · honesty ${per.honesty.toFixed(2)} · loyalty ${per.loyalty.toFixed(2)}</div>
    <div class="traits">guilt ${e.guilt.toFixed(2)} · grief ${e.grief.toFixed(2)} · jealousy ${e.jealousy.toFixed(2)} · ${p.beliefs.length} beliefs · carries 🍞${foodUnits(p.inventory)}</div>
    ${feelings ? `<h4>Feelings</h4><ul class="feelings">${feelings}</ul>` : ""}
    ${recent ? `<h4>Recently</h4><ul class="recent">${recent}</ul>` : ""}
    ${plots ? `<h4>Plotting</h4><ul>${plots}</ul>` : ""}
    ${cases ? `<h4>Investigating</h4><ul>${cases}</ul>` : ""}
    ${rels ? `<h4>Closest</h4><ul>${rels}</ul>` : ""}
    <label class="follow"><input type="checkbox" id="follow" ${follow ? "checked" : ""}> follow with camera</label>`;
  $<HTMLInputElement>("follow").onchange = (ev) => {
    follow = (ev.target as HTMLInputElement).checked;
  };
}

function renderFeed(): void {
  dirty.feed = false;
  $("feed").innerHTML = feed
    .slice(-150)
    .reverse()
    .map((l) => `<li class="${l.category}"><time>${clock(world, l.tick)}</time> ${linkNames(l.text, l.people)}${l.badge ? ` <mark>${l.badge}</mark>` : ""}</li>`)
    .join("");
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
      const icon = pl.kind === "murder" ? "🗡" : pl.kind === "raid" ? "🔥" : "🫳";
      const more = pl.kind === "murder" && pl.sightings.length ? ` · knows ${pl.sightings.length} times the target is alone` : pl.kind === "raid" ? ` · ${pl.participants.length} raiders` : "";
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

function renderCouncil(): void {
  dirty.council = false;
  const list = [...council.sessions.values()].reverse();
  $("council").innerHTML =
    list
      .map((s) => {
        const state = s.verdict ? (s.verdict === "guilty" ? `guilty → ${s.sentence}` : "acquitted") : s.openedTick === null ? `scheduled ${clock(world, s.scheduledTick)}` : "in session";
        return `<li class="session justice" data-session="${s.hearingId}"><time>${clock(world, s.openedTick ?? s.scheduledTick)}</time> ${esc(world.person(s.accused).name.split(" ")[0]!)} accused of ${s.kind} — <b>${state}</b>${s.correct === false ? ` <mark>${s.verdict === "guilty" ? "WRONGFUL" : "culprit walks"}</mark>` : ""}</li>`;
      })
      .join("") || `<li class="hint">The council has not sat yet.</li>`;
}

function openSession(s: Session): void {
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
      return `<a href="#" data-person="${p.id}" class="${gone ? "gone" : ""}${p.id === selected ? " sel" : ""}${p.mad ? " mad" : ""}"><em style="background:${HOUSEHOLD_COLORS[p.householdId % HOUSEHOLD_COLORS.length]}"></em>${esc(p.name.split(" ")[0]!)}${!p.alive ? " ☠" : p.exiled ? " ⇥" : p.mad ? " 🌀" : ""}</a>`;
    })
    .join(" ");
}

function select(id: number | null): void {
  selected = id;
  renderInspector();
  if (tab === "roster") renderRoster();
}

// ---------- Input ----------

document.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const a = t.closest("[data-person]") as HTMLElement | null;
  if (a) {
    ev.preventDefault();
    select(Number(a.dataset.person));
    follow = true;
    return;
  }
  const s = t.closest("[data-session]") as HTMLElement | null;
  if (s) {
    const session = council.sessions.get(Number(s.dataset.session));
    if (session) openSession(session);
  }
});
$("mclose").onclick = () => $("modal").classList.remove("open");
$("modal").addEventListener("click", (ev) => {
  if (ev.target === $("modal")) $("modal").classList.remove("open");
});

function setPower(p: typeof power): void {
  power = p;
  canvas.className = p === "inspect" ? "" : `power-${p}`;
  document.querySelectorAll<HTMLButtonElement>("[data-power]").forEach((b) => b.classList.toggle("on", b.dataset.power === p));
}

function nearestPerson(sx: number, sy: number): Person | null {
  let best: Person | null = null, bestD = 14 * Math.max(1, cam.zoom / 2);
  for (const p of world.active()) {
    if (world.isCarried(p)) continue;
    const s = renderer.personScreen(p, cam, prev, 1);
    const d = Math.hypot(s.x - sx, s.y - 6 * cam.zoom - sy);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function nearestAnimal(sx: number, sy: number): number | null {
  let best: number | null = null, bestD = 14 * Math.max(1, cam.zoom / 2);
  for (const a of world.animals) {
    if (!a.alive) continue;
    const x = (a.x * TILE + 8 - cam.x) * cam.zoom, y = (a.y * TILE + 10 - cam.y) * cam.zoom;
    const d = Math.hypot(x - sx, y - sy);
    if (d < bestD) { bestD = d; best = a.id; }
  }
  return best;
}

let dragging = false, dragMoved = false, dragX = 0, dragY = 0;
canvas.addEventListener("pointerdown", (ev) => {
  dragging = true;
  dragMoved = false;
  dragX = ev.clientX;
  dragY = ev.clientY;
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener("pointermove", (ev) => {
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
  dragging = false;
  if (dragMoved) return;
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
  const person = nearestPerson(sx, sy);
  if (power === "smite") {
    if (person) engine.intervene({ kind: "smite", personId: person.id });
    else {
      const animal = nearestAnimal(sx, sy);
      if (animal !== null) engine.intervene({ kind: "smite_animal", animalId: animal });
    }
    renderer.addEffect({ kind: "flash", x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y, born: performance.now() / 1000, dur: 0.8 });
    setPower("inspect");
    if (paused && !busy) void advance(1, true);
    return;
  }
  if (power === "madden") {
    if (person) {
      engine.intervene({ kind: "madden", personId: person.id });
      select(person.id);
    }
    setPower("inspect");
    if (paused && !busy) void advance(1, true);
    return;
  }
  select(person?.id ?? null);
});
canvas.addEventListener("pointerleave", () => {
  renderer.hoverBuilding = -1;
});
canvas.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const wx = mx / cam.zoom + cam.x, wy = my / cam.zoom + cam.y;
    let i = ZOOMS.findIndex((z) => z >= cam.zoom - 1e-6);
    if (i < 0) i = ZOOMS.length - 1;
    i = Math.max(0, Math.min(ZOOMS.length - 1, i + (ev.deltaY < 0 ? 1 : -1)));
    cam.zoom = ZOOMS[i]!;
    userCamera = true;
    cam.x = wx - mx / cam.zoom;
    cam.y = wy - my / cam.zoom;
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
  document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => b.classList.toggle("on", !paused && Number(b.dataset.speed) === speed));
  document.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((b) => b.classList.toggle("on", opts[b.dataset.toggle as keyof ViewOptions]));
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
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => {
  b.onclick = () => {
    tab = b.dataset.tab!;
    document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll<HTMLElement>(".tab").forEach((x) => x.classList.toggle("show", x.id === tab));
    dirty = { feed: true, intrigue: true, council: true };
    updateHud(true);
  };
});
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
window.addEventListener("keydown", (ev) => {
  if ((ev.target as HTMLElement).tagName === "INPUT") return;
  if (ev.key === " ") { ev.preventDefault(); paused = !paused; syncControls(); }
  if (ev.key >= "1" && ev.key <= "6") setSpeed(Number(ev.key) - 1);
  if (ev.key === "r") { opts.roofs = !opts.roofs; syncControls(); }
  if (ev.key === "t") { opts.traces = !opts.traces; syncControls(); }
  if (ev.key === "n") { opts.names = !opts.names; syncControls(); }
  if (ev.key === "i") setPower("inspect");
  if (ev.key === "s") setPower("smite");
  if (ev.key === "m") setPower("madden");
  if (ev.key === "Escape") { select(null); setPower("inspect"); $("modal").classList.remove("open"); }
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
  select,
  draw: () => {
    renderer.draw(world, cam, opts, prev, 1, selected, performance.now() / 1000);
    const rect = canvas.getBoundingClientRect();
    drawMinimap(minimap, world, cam, rect.width, rect.height, miniBase);
    updateHud(true);
  },
  look: (x: number, y: number, zoom = 2) => {
    const rect = canvas.getBoundingClientRect();
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
};

const initialSeed = Number(new URLSearchParams(location.search).get("seed") ?? 42);
$<HTMLInputElement>("seed").value = String(initialSeed);
resize();
newVillage(initialSeed);
syncControls();
setPower("inspect");
requestAnimationFrame(frame);
