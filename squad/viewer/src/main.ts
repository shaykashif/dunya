import type { Engine } from "../../src/engine/engine.ts";
import { aimFactor, armFactor, bleedingOf, cannotWalk, disfigurement, fightingPain, mobility, severityWord, sightFactor } from "../../src/entities/body.ts";
import { describeInjury } from "../../src/entities/injuries.ts";
import { firstBlood, verdict } from "../../src/battle/verdict.ts";
import { EventLog, type SimEvent } from "../../src/log/events.ts";
import { createSimulation } from "../../src/sim.ts";
import type { BodyPart, Injury, Side, Soldier, Squad } from "../../src/world/types.ts";
import type { World } from "../../src/world/world.ts";
import { Sfx, impactOf, surfaceOf } from "./audio.ts";
import { hydrateIcons, icon } from "./icons.ts";
import { clock, describe, label, roleName, worstWound, type FeedLine } from "./feed.ts";
import { BLAST_SECONDS } from "./fx.ts";
import { Renderer, drawMinimap, gridSquare, type Camera, type ViewOptions } from "./render.ts";
import { BODY_RECTS, SIDE_COLORS, TILE, appearance, faceCanvas, hash2, skinOf } from "./sprites.ts";
import { barrageTarget, bestFraming, contactDistance, framingZoom, frontLine } from "./cinematic.ts";
import { startHeartbeat, track, trackFirstInteraction } from "./analytics.ts";
import { shareResult } from "./share.ts";

// Ticks (seconds of battle) per real second.
const SPEEDS = [
  { label: "1x", tps: 1 },
  { label: "2x", tps: 2 },
  { label: "5x", tps: 5 },
  { label: "10x", tps: 10 },
  { label: "20x", tps: 20 },
  { label: "40x", tps: 40 },
];
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 7;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("world");
const minimap = $<HTMLCanvasElement>("minimap");
// The alerts fill the space beside the minimap on a phone, so CSS needs to know how wide it is.
new ResizeObserver(() => document.documentElement.style.setProperty("--mm-w", `${minimap.offsetWidth}px`)).observe(minimap);
// The alerts sit under the top bar, which wraps to a second row on a narrow screen.
const topbarEl = document.getElementById("topbar")!;
new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", `${topbarEl.offsetHeight}px`)).observe(topbarEl);
const gridref = $("gridref");
/** Where the pointer is over the battlefield, in screen pixels; null when it is off it. */
let hover: { sx: number; sy: number } | null = null;
const renderer = new Renderer(canvas);
const sfx = new Sfx();
// Shots and blasts inside a house ring off its walls; a church or warehouse booms. A house fallen in has no roof to ring.
sfx.acousticAt = (x, y) => {
  const tx = Math.round(x), ty = Math.round(y);
  if (!world || !world.map.inBounds(tx, ty)) return "open";
  const id = world.map.building[world.map.idx(tx, ty)]!;
  if (id < 0) return "open";
  const b = world.buildings[id]!;
  if (b.destroyed || !world.map.indoors(tx, ty)) return "open";
  return b.kind === "church" || b.kind === "warehouse" || b.kind === "barn" ? "hall" : "room";
};
const miniBase: { img: ImageData | null; version: number; world: World | null } = { img: null, version: -1, world: null };

let engine: Engine;
let world: World;
let feed: FeedLine[] = [];
let speed = 2;
let paused = false;
let busy = false;
let acc = 0;
let lastTime = performance.now();
let prev = new Map<number, { x: number; y: number }>();
let selected: number | null = null;
let follow = false;
let userCamera = false;
let lastSize = "";
let power: "inspect" | "artillery" | "smoke" | "sniper" = "inspect";
let tab = "men";
let dirty = { feed: true, events: true };
let reportShown = false;
let zoomGoal: { zoom: number; sx: number; sy: number } | null = null;
const opts: ViewOptions = { roofs: true, names: false, orders: true, sight: true, chronicle: true };
const cam: Camera = { x: 0, y: 0, zoom: 1.6 };

// ---------- Cinematic start ----------
// A first visit opens at first contact with a camera that follows the fighting and a simple screen:
// the clock, pause, sound, and one button to call a barrage. Everything else is a tap away.

const CINE_PREF = "squad.cinematic";
/** Battles that open hot: the first contact is in open ground and in view. */
const FEATURED_SEEDS = [19, 15];
/** Seeds whose first contact is in open ground and in view; one is "the battle of the day" (UTC). Keep in step with site/index.html. */
const DAILY_SEEDS = [19, 15, 10, 13, 8, 4, 2];
const dailySeed = (): number => DAILY_SEEDS[Math.floor(Date.now() / 86_400_000) % DAILY_SEEDS.length]!;
function cinematicPref(): boolean {
  try {
    return localStorage.getItem(CINE_PREF) !== "off";
  } catch {
    return true;
  }
}
function setCinematicPref(on: boolean): void {
  try {
    localStorage.setItem(CINE_PREF, on ? "on" : "off");
  } catch {
    // Not important.
  }
}
let battlesRun = 0;
let battleToken = 0;
/** True while the march up is being run through unseen, up to first contact. */
let ffActive = false;
let simpleUi = false;
let cinematic = false;
const director = {
  on: false,
  c: null as { x: number; y: number } | null,
  goal: null as { x: number; y: number } | null,
  lastX: NaN,
  lastY: NaN,
  lastZoom: NaN,
  nextLook: 0,
  quietSince: 0,
};

function setSimple(on: boolean): void {
  simpleUi = on;
  document.body.classList.toggle("simple", on);
  syncSideIcon();
  window.dispatchEvent(new Event("resize"));
}

function setDirector(on: boolean): void {
  director.on = on;
  director.c = null;
  director.goal = null;
  director.nextLook = 0;
  director.lastX = NaN;
  if (on) {
    zoomGoal = null;
    follow = false;
  }
  document.getElementById("cinebtn")?.classList.toggle("on", on);
}

/** One frame of the auto camera: glides to the busiest fight in view, never cuts, hands over at any input. */
function directorStep(dt: number): void {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || !world) return;
  const keyed = [...keys].some((k) => (k.length === 1 ? "wasdqe".includes(k) : k.startsWith("arrow")));
  const moved = !Number.isNaN(director.lastX) && (Math.abs(cam.x - director.lastX) > 1.5 || Math.abs(cam.y - director.lastY) > 1.5 || Math.abs(cam.zoom - director.lastZoom) > 0.01);
  if (keyed || moved || zoomGoal !== null || follow) {
    setDirector(false);
    trackFirstInteraction("camera");
    return;
  }
  const t = now();
  if (!director.c || t >= director.nextLook) {
    director.nextLook = t + 2.5;
    const cur = director.c;
    // What a view this wide would hold, so the camera goes where there are men to see.
    const z = framingZoom(rect.width, TILE);
    const halfW = rect.width / z / 2 / TILE, halfH = rect.height / z / 2 / TILE;
    let f: { x: number; y: number } | null = cur ? bestFraming(world, halfW, halfH, { x: cur.x, y: cur.y, r: 30 }) : bestFraming(world, halfW, halfH);
    if (f) director.quietSince = t;
    // Only go looking further afield when the neighbourhood has been quiet for a while.
    if (!f && (!cur || t - director.quietSince > 6)) f = bestFraming(world, halfW, halfH) ?? frontLine(world);
    if (f) {
      director.goal = { x: f.x, y: f.y };
      if (!cur) {
        director.c = { x: f.x, y: f.y };
        cam.zoom = framingZoom(rect.width, TILE);
      }
    }
  }
  const c = director.c, g = director.goal;
  if (!c || !g) return;
  const dx = g.x - c.x, dy = g.y - c.y, d = Math.hypot(dx, dy);
  if (d > 0.02) {
    const v = Math.min(d > 40 ? 9 : 4.5, d * 1.0);
    const step = Math.min(d, v * dt);
    c.x += (dx / d) * step;
    c.y += (dy / d) * step;
  }
  cam.zoom += (framingZoom(rect.width, TILE) - cam.zoom) * (1 - Math.exp(-dt * 1.2));
  cam.x = c.x * TILE + TILE / 2 - rect.width / cam.zoom / 2;
  cam.y = c.y * TILE + TILE / 2 - rect.height / cam.zoom / 2;
  director.lastX = cam.x;
  director.lastY = cam.y;
  director.lastZoom = cam.zoom;
  userCamera = true;
}

/** A function, so the type checker does not assume the phase cannot change while the engine runs. */
function isOver(): boolean {
  return world.phase === "over";
}

function setFfText(title: string, sub: string): void {
  $("ff").querySelector("b")!.textContent = title;
  $("ff").querySelector("small")!.textContent = sub;
}

let skipCancel = false;
/** Runs the rest of the battle unseen and opens the report: for a visitor who wants the outcome, not the minutes. */
async function skipToResult(): Promise<void> {
  if (!world || ffActive || world.phase === "over") return;
  const token = battleToken;
  ffActive = true;
  busy = true;
  skipCancel = false;
  track("skip_to_result", { tick: world.tick, cinematic });
  trackFirstInteraction("skip");
  setFfText("Running the battle to its end", `Now ${world.clock()}`);
  $("ff").classList.add("on", "skip");
  try {
    for (let i = 0; i < 12000 && token === battleToken && !skipCancel && !isOver(); i++) {
      await engine.step();
      if (i % 25 === 0) {
        $("ff").querySelector("small")!.textContent = `Now ${world.clock()}`;
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    if (token === battleToken) {
      prev = new Map(world.soldiers.map((s) => [s.id, { x: s.x, y: s.y }]));
      acc = 0;
      $("toasts").innerHTML = "";
      lastSquadAlert.clear();
      boltsEl.innerHTML = "";
      chains.clear();
      dirty = { feed: true, events: true };
    }
    ffActive = false;
    busy = false;
    $("ff").classList.remove("on", "skip");
    setFfText("Moving up to the line", "Skipping the march to first contact");
    syncControls();
  }
  if (token === battleToken && isOver() && !reportShown) {
    reportShown = true;
    paused = true;
    syncControls();
    track("battle_end", { tick: world.tick, winner: String(world.result?.winner ?? "none"), cinematic, skipped: true });
    openReport();
  }
}

/** Runs the march up unseen, to the first shots, so a visitor lands in the fight and not in a field. */
async function fastForwardToContact(token: number): Promise<void> {
  ffActive = true;
  busy = true;
  setFfText("Moving up to the line", "Skipping the march to first contact");
  $("ff").classList.add("on");
  try {
    for (let i = 0; i < 260 && token === battleToken && !isOver(); i++) {
      if (contactDistance(world) < 28) break;
      for (let j = 0; j < 4; j++) {
        prev = new Map(world.soldiers.map((s) => [s.id, { x: s.x, y: s.y }]));
        await engine.step();
      }
      if (i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    if (token === battleToken) {
      prev = new Map(world.soldiers.map((s) => [s.id, { x: s.x, y: s.y }]));
      acc = 0;
      $("toasts").innerHTML = "";
      lastSquadAlert.clear();
      boltsEl.innerHTML = "";
      chains.clear();
      paused = false;
      dirty = { feed: true, events: true };
    }
    ffActive = false;
    busy = false;
    $("ff").classList.remove("on");
    syncControls();
  }
}

let hookCheckAt = 0;
let hookFightAt = -99;
let hookLabel = "";
let hookTarget: { x: number; y: number; seen: boolean; men: number } | null = null;
let goalText = "";
let turnShownAt = -1;
function updateHook(): void {
  const el = $("hook");
  const t = now();
  const live = simpleUi && !ffActive && world.phase !== "over";
  const skip = $("skipbtn");
  const canSkip = simpleUi && !ffActive && world.phase !== "over";
  if (skip.hidden === canSkip) skip.hidden = !canSkip;
  if (canSkip && !paused) {
    if (liveSince < 0) liveSince = t;
    watched = t - liveSince;
  }
  // After about two minutes of watching, the button becomes the way to see who won.
  const nudge = canSkip && watched > 120;
  if (nudge !== skipNudge) {
    skipNudge = nudge;
    skip.classList.toggle("nudge", nudge);
    skip.innerHTML = nudge ? "See who wins &#9656;&#9656;" : "Skip to result &#9656;&#9656;";
    if (nudge) track("skip_nudge", { tick: world.tick });
  }
  const rect = canvas.getBoundingClientRect();
  if (t >= hookCheckAt) {
    hookCheckAt = t + 0.5;
    let n = 0;
    if (live) for (const m of world.soldiers) if (world.tick - m.lastFiredTick < 10 && ++n >= 3) break;
    if (n >= 3) hookFightAt = t;
    if (live) {
      const halfW = rect.width / cam.zoom / 2 / TILE, halfH = rect.height / cam.zoom / 2 / TILE;
      hookTarget = barrageTarget(world, { x: cam.x / TILE + halfW, y: cam.y / TILE + halfH }, halfW, halfH);
    }
  }
  // Once the fighting has started the button stays up through lulls, so it does not flicker.
  const show = live && t - hookFightAt < 12;
  if (el.hidden === show) el.hidden = !show;
  const cool = t < hookCooldownUntil;
  el.classList.toggle("cool", cool);
  el.classList.toggle("fresh", hookUsed === 0);
  const soundOff = !sfx.ready && sfx.enabled;
  const label = cool ? `Reloading ${Math.ceil(hookCooldownUntil - t)}` : `Call in a barrage${soundOff && !isPhone() ? " · sound on" : ""}`;
  if (label !== hookLabel) {
    hookLabel = label;
    el.innerHTML = `${icon("barrage")} ${label}`;
  }
  // Sound starts on the first tap, as browsers insist: the sound button says so until then.
  $("sound").classList.toggle("attn", simpleUi && soundOff && world.phase !== "over");

  // Until the first barrage, show where it would land: a real enemy group on screen.
  const ret = $("reticle");
  const aim = show && hookUsed === 0 && !cool && hookTarget?.seen ? hookTarget : null;
  if (aim) {
    const sx = (aim.x * TILE + TILE / 2 - cam.x) * cam.zoom, sy = (aim.y * TILE + TILE / 2 - cam.y) * cam.zoom;
    const top = topbarEl.offsetHeight + 20, bottom = rect.height - 120;
    const inView = sx > 24 && sx < rect.width - 24 && sy > top && sy < bottom;
    ret.hidden = !inView;
    if (inView) {
      ret.style.left = `${Math.round(sx)}px`;
      ret.style.top = `${Math.round(sy)}px`;
      const lab = ret.firstElementChild as HTMLElement;
      const txt = `${aim.men > 1 ? `${aim.men} enemy` : "Enemy"} here · tap Barrage`;
      if (lab.textContent !== txt) lab.textContent = txt;
    }
  } else if (!ret.hidden) ret.hidden = true;

  // Who is winning, and for what.
  const goal = $("goal");
  if (live) {
    const fighting = (side: Side) => world.men(side).filter((s) => world.able(s)).length;
    const total = (side: Side) => world.men(side).length;
    const att = world.attacker === "us" ? "US attack" : "German attack";
    const txt = `${att} ${world.layout.objectiveName} · <span class="us">US ${fighting("us")}/${total("us")}</span> v <span class="de">DE ${fighting("de")}/${total("de")}</span>`;
    if (txt !== goalText) {
      goalText = txt;
      goal.innerHTML = txt;
    }
  }
  if (goal.hidden === live) goal.hidden = !live;

  // A phone held upright shows a narrow slice: say so once, early.
  const turn = $("turn");
  if (turnShownAt < 0 && live && isPhone() && rect.height > rect.width * 1.1 && t > 4) {
    let seen = false;
    try {
      seen = sessionStorage.getItem("squad.turnhint") === "1";
      sessionStorage.setItem("squad.turnhint", "1");
    } catch {
      // Not important.
    }
    turnShownAt = seen ? -2 : t;
  }
  const turnOn = turnShownAt >= 0 && t - turnShownAt < 7 && live;
  if (turn.hidden === turnOn) turn.hidden = !turnOn;
}

/** One tap: a barrage on the nearest enemy in view, or just off the middle if none is, so it is always in the picture. */
let hookCooldownUntil = 0;
let hookUsed = 0;
let liveSince = -1;
let watched = 0;
let skipNudge = false;
let dailyBattle = false;
function callBarrageFromView(): void {
  if (!world || world.phase === "over" || now() < hookCooldownUntil) return;
  const rect = canvas.getBoundingClientRect();
  const halfW = rect.width / cam.zoom / 2 / TILE, halfH = rect.height / cam.zoom / 2 / TILE;
  const centre = { x: cam.x / TILE + halfW, y: cam.y / TILE + halfH };
  const at = barrageTarget(world, centre, halfW, halfH);
  engine.intervene({ kind: "artillery", x: Math.round(at.x), y: Math.round(at.y) });
  hookUsed++;
  hookCooldownUntil = now() + 14;
  track("barrage", { via: "button", n: hookUsed });
  trackFirstInteraction("barrage");
  if (hookUsed === 1) toast("battle", "Barrage called", "Smoke and a sniper shot are under Take full control. Tap a man to see him, or any alert to look at it.");
}


const now = () => performance.now() / 1000;
const tickSeconds = () => 1 / SPEEDS[speed]!.tps;


// ---------- Radio chains: a report, the order it provokes, and the round that comes of it ----------

interface Chain {
  id: number;
  side: Side;
  kind: string;
  label: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  target: { x: number; y: number };
  tick: number;
  hq: { x: number; y: number } | null;
  ordered: boolean;
  pit: { x: number; y: number } | null;
  rounds: { from: { x: number; y: number }; at: { x: number; y: number }; thrown: number; burst: number }[];
  popup: HTMLButtonElement | null;
  born: number;
}
const chains = new Map<number, Chain>();
const boltsEl = document.createElement("div");
boltsEl.id = "bolts";
$("stage").appendChild(boltsEl);
const cineEl = document.createElement("div");
cineEl.id = "cine";
$("stage").appendChild(cineEl);

const KIND_WORDS: Record<string, string> = { machine_gun: "MACHINE GUN", tank: "TANK", sniper: "SNIPER" };

function chainFor(e: SimEvent): void {
  const d = e.data;
  if (e.type === "radio" && typeof d.msg === "number" && d.kind !== "contact") {
    const sq = world.squads[d.squad as number];
    const c: Chain = {
      id: d.msg,
      side: sq?.side ?? "us",
      kind: d.kind as string,
      label: `${sq?.name ?? "Forward team"} radios: ${KIND_WORDS[d.kind as string] ?? "enemy"}`,
      from: { x: (d.from as number[])[0]!, y: (d.from as number[])[1]! },
      to: { x: (d.to as number[])[0]!, y: (d.to as number[])[1]! },
      target: { x: (d.at as number[])[0]!, y: (d.at as number[])[1]! },
      tick: e.tick,
      hq: null,
      ordered: false,
      pit: null,
      rounds: [],
      popup: null,
      born: now(),
    };
    chains.set(c.id, c);
    const b = document.createElement("button");
    b.className = "bolt";
    b.title = `${c.label}: click to follow the message to command and the mortars`;
    b.innerHTML = icon("bolt");
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      startCine(c);
    });
    boltsEl.appendChild(b);
    c.popup = b;
    // Only the last few stay.
    const open = [...chains.values()].filter((x) => x.popup);
    for (const old of open.slice(0, Math.max(0, open.length - 6))) {
      old.popup?.remove();
      old.popup = null;
    }
    return;
  }
  const id = typeof d.msg === "number" ? d.msg : null;
  const c = id !== null ? chains.get(id) : undefined;
  if (!c) return;
  if (e.type === "fire_mission") {
    c.ordered = true;
    c.hq = { x: (d.from as number[])[0]!, y: (d.from as number[])[1]! };
  } else if (e.type === "mortar_fire") {
    const at = d.at as number[];
    c.pit = { x: at[0]!, y: at[1]! };
  } else if (e.type === "incoming") {
    const f = d.from as number[], at = d.at as number[];
    c.rounds.push({ from: { x: f[0]!, y: f[1]! }, at: { x: at[0]!, y: at[1]! }, thrown: e.tick, burst: d.burst as number });
  }
}

// Where shells are about to land: a flashing blast marker, so a fire mission can be seen from high above.
const blasts: { x: number; y: number; burst: number; el: HTMLElement }[] = [];
const BLAST_ZOOM = 0.75;

function markBlast(x: number, y: number, burst: number): void {
  const near = blasts.find((b) => Math.hypot(b.x - x, b.y - y) < 7 && world.tick < b.burst + 2);
  if (near) {
    near.burst = Math.max(near.burst, burst);
    return;
  }
  const el = document.createElement("div");
  el.className = "blast";
  el.innerHTML = icon("blast");
  boltsEl.appendChild(el);
  blasts.push({ x, y, burst, el });
}

function placeBlasts(): void {
  for (const o of world.ordnance) if (o.kind !== "smoke_shell") markBlast(o.x, o.y, o.burstTick);
  const rect = canvas.getBoundingClientRect();
  const wide = cam.zoom < BLAST_ZOOM;
  for (let i = blasts.length - 1; i >= 0; i--) {
    const b = blasts[i]!;
    if (world.tick >= b.burst + 2) {
      b.el.remove();
      blasts.splice(i, 1);
      continue;
    }
    b.el.style.display = wide ? "" : "none";
    if (!wide) continue;
    const sx = (b.x * TILE + 8 - cam.x) * cam.zoom, sy = (b.y * TILE + 8 - cam.y) * cam.zoom;
    const m = 16;
    const top = topbarEl.offsetHeight + 18, bottom = rect.height - (simpleUi ? 100 : m);
    const x = Math.max(m, Math.min(rect.width - m, sx)), y = Math.max(top, Math.min(bottom, sy));
    b.el.classList.toggle("edge", x !== sx || y !== sy);
    b.el.style.left = `${Math.round(x)}px`;
    b.el.style.top = `${Math.round(y)}px`;
  }
}

/** Keeps each popup on its sender, or on the edge of the screen pointing the way when the sender is off it. */
function placeBolts(): void {
  const rect = canvas.getBoundingClientRect();
  const t = now();
  for (const c of chains.values()) {
    if (!c.popup) continue;
    const age = t - c.born;
    // The order has been carried out when the first round lands; one that is never acted on is dropped after a while.
    const landed = c.rounds.length > 0 && world.tick >= c.rounds[0]!.burst + 1;
    const ignored = !c.ordered && world.tick - c.tick > 150;
    const watching = cine !== null && cine.chain === c;
    if ((landed || ignored || age > 240) && !watching) {
      c.popup.remove();
      c.popup = null;
      continue;
    }
    c.popup.classList.toggle("old", age > 45);
    const sx = (c.from.x * TILE + 8 - cam.x) * cam.zoom, sy = (c.from.y * TILE + 8 - cam.y) * cam.zoom - 22;
    const m = 20;
    const top = topbarEl.offsetHeight + 18, bottom = rect.height - (simpleUi ? 100 : m);
    const x = Math.max(m, Math.min(rect.width - m, sx)), y = Math.max(top, Math.min(bottom, sy));
    c.popup.classList.toggle("edge", x !== sx || y !== sy);
    c.popup.style.left = `${Math.round(x)}px`;
    c.popup.style.top = `${Math.round(y)}px`;
  }
}

interface Cine {
  chain: Chain;
  stage: number;
  t0: number;
  startedAt: number;
  saved: { x: number; y: number; zoom: number; paused: boolean; follow: boolean };
  hold: number;
}
let cine: Cine | null = null;

function startCine(c: Chain): void {
  if (cine) endCine(false);
  cine = { chain: c, stage: 0, t0: now(), startedAt: now(), saved: { x: cam.x, y: cam.y, zoom: cam.zoom, paused, follow }, hold: 0 };
  follow = false;
  userCamera = true;
  zoomGoal = null;
  cineEl.style.display = "block";
  cineEl.innerHTML = `${esc(c.label)}<small>following the message</small>`;
}

function endCine(restore: boolean): void {
  if (!cine) return;
  if (restore) {
    cam.x = cine.saved.x;
    cam.y = cine.saved.y;
    cam.zoom = cine.saved.zoom;
  }
  cine = null;
  cineEl.style.display = "none";
}

/** Drives the camera and the effects of a followed message, a stage at a time. */
function cineFrame(dt: number): void {
  const c = cine!;
  const ch = c.chain;
  const rect = canvas.getBoundingClientRect();
  const t = now();
  const el = t - c.t0;
  const look = (p: { x: number; y: number }, zoom: number, rate = 12) => {
    const a = 1 - Math.exp(-dt * rate);
    cam.zoom += (zoom - cam.zoom) * a;
    const tx = p.x * TILE + 8 - rect.width / cam.zoom / 2, ty = p.y * TILE + 8 - rect.height / cam.zoom / 2;
    cam.x += (tx - cam.x) * a;
    cam.y += (ty - cam.y) * a;
  };
  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  const caption = (title: string, sub: string) => {
    cineEl.innerHTML = `${esc(title)}<small>${esc(sub)}</small>`;
  };
  const hq = ch.hq ?? ch.to;
  const pit = ch.pit ?? world.platoons[ch.side]?.mortarPit ?? null;
  const signal = (a: { x: number; y: number }, b: { x: number; y: number }, dur: number) =>
    renderer.addEffect({ kind: "signal", x0: a.x * TILE + 8, y0: a.y * TILE + 6, x1: b.x * TILE + 8, y1: b.y * TILE + 6, born: t, dur, delay: 0, color: "#ffe070" });
  switch (c.stage) {
    case 0: {
      look(ch.from, 3.4);
      caption(ch.label, "the report is keyed in");
      if (el > 0.7) {
        signal(ch.from, ch.to, 1.1);
        c.stage = 1;
        c.t0 = t;
      }
      return;
    }
    case 1: {
      const u = Math.min(1, el / 1.1);
      look(lerp(ch.from, ch.to, u), 2.6, 16);
      caption("Message to platoon command", "on its way");
      if (u >= 1) {
        c.stage = 2;
        c.t0 = t;
      }
      return;
    }
    case 2: {
      look(hq, 3.4);
      if (ch.ordered) {
        caption("Platoon command", "the radioman puts the mortars on it");
        if (el > 0.7 && pit) {
          signal(hq, pit, 1.0);
          c.stage = 3;
          c.t0 = t;
        } else if (el > 0.7 && !pit) {
          c.stage = 6;
          c.t0 = t;
        }
      } else {
        caption("Platoon command", el > 7 ? "no fire mission is called on this one" : "weighing it up");
        if (el > 8 || paused) {
          c.stage = 6;
          c.t0 = t;
        }
      }
      return;
    }
    case 3: {
      const u = Math.min(1, el / 1.0);
      look(lerp(hq, pit ?? hq, u), 2.6, 16);
      caption("Fire order to the mortar", "on its way");
      if (u >= 1) {
        c.stage = 4;
        c.t0 = t;
      }
      return;
    }
    case 4: {
      if (pit) look(pit, 3.6);
      const r = ch.rounds[0];
      caption("The mortar", r ? "firing" : "laying the tube");
      if (r && pit) {
        const flight = Math.max(1.8, Math.min(4.5, (r.burst - r.thrown) * 0.3));
        renderer.addEffect({ kind: "round", x0: r.from.x * TILE + 8, y0: r.from.y * TILE + 4, x1: r.at.x * TILE + 8, y1: r.at.y * TILE + 8, born: t, dur: flight, delay: 0.25 });
        c.stage = 5;
        c.t0 = t + 0.25;
        c.hold = flight;
      } else if (el > 45 || paused) {
        c.stage = 6;
        c.t0 = t;
      }
      return;
    }
    case 5: {
      const r = ch.rounds[0]!;
      const u = Math.max(0, Math.min(1, (t - c.t0) / c.hold));
      const p = lerp({ x: r.from.x, y: r.from.y }, r.at, u);
      look(p, 2.2 + 0.8 * Math.abs(u - 0.5), 14);
      caption("Mortar round in the air", u >= 1 ? "impact" : "falling");
      if (u >= 1) {
        c.stage = 6;
        c.t0 = t;
      }
      return;
    }
    case 6: {
      const r = ch.rounds[0];
      if (r) look(r.at, 2.6);
      if (el > 0.9) {
        c.stage = 7;
        c.t0 = t;
      }
      return;
    }
    default: {
      const a = 1 - Math.exp(-dt * 10);
      cam.x += (c.saved.x - cam.x) * a;
      cam.y += (c.saved.y - cam.y) * a;
      cam.zoom += (c.saved.zoom - cam.zoom) * a;
      if (el > 0.7) endCine(true);
    }
  }
}

// ---------- Events from the engine ----------

function onEvent(e: SimEvent): void {
  if (!world) return;
  if (!ffActive) {
    chainFor(e);
    effectsFor(e);
    soundsFor(e);
  }
  const line = describe(e, world);
  if (line) {
    feed.push(line);
    if (feed.length > 1500) feed.shift();
    dirty.feed = true;
    if (line.major) dirty.events = true;
  }
  if (!ffActive) toastFor(e);
}

// ---------- Sound ----------

const BOLT_GUNS = new Set(["kar98k", "kar98k_scoped", "m1903_scoped"]);

function surfaceAt(x: number, y: number): string {
  const tx = Math.floor(x), ty = Math.floor(y);
  return world.map.inBounds(tx, ty) ? surfaceOf(world.map.at(tx, ty)) : "grass";
}

function soundsFor(e: SimEvent): void {
  if (!sfx.ready) return;
  const d = e.data;
  const span = Math.min(0.9, tickSeconds());
  const person = (id: unknown) => world.maybe(id as number);
  switch (e.type) {
    case "fire": {
      const [fx, fy] = d.from as [number, number];
      const [ax, ay] = d.at as [number, number];
      const weapon = (d.weapon as string | null) ?? "pistol";
      const rounds = d.rounds as number;
      const shown = Math.min(rounds, 8);
      sfx.noteGunfire();
      const loud = (weapon === "mg42" ? 4 : weapon === "pistol" ? 2.8 : 3.4) * (shown > 3 ? 0.8 : 1);
      for (let k = 0; k < shown; k++) {
        sfx.play(`shot.${weapon}`, { x: fx, y: fy, gain: loud, reach: 3.6, anywhere: true, delay: (k / shown) * span, byDistance: true, priority: k === 0 });
      }
      if (BOLT_GUNS.has(weapon)) sfx.play("gun.bolt", { x: fx, y: fy, gain: 0.2, reach: 0.9, close: true, delay: 0.55 + span });
      for (let k = 0; k < shown; k++) {
        if (weapon !== "pistol" || k === 0) sfx.bulletPass(fx, fy, ax, ay, (k / shown) * span, 1.6);
      }
      const delay = span * 0.6 + 0.05;
      if ((d.hits as number[]).length > 0) sfx.play("impact.flesh", { x: ax, y: ay, gain: 0.9, reach: 0.8, close: true, closeSpan: 14, delay });
      else {
        // A miss: a whizz past, then whatever it struck.
        const surf = world.map.inBounds(Math.floor(ax), Math.floor(ay)) ? impactOf(world.map.at(Math.floor(ax), Math.floor(ay))) : "dirt";
        const r = Math.random();
        if (r < 0.85) sfx.playLimited("crack", 45, "crack", { x: ax, y: ay, gain: 1.1, reach: 0.8, close: true, closeSpan: 14, delay: span * 0.4 });
        else if (r < 0.95) sfx.play("whiz", { x: ax, y: ay, gain: 0.3, reach: 0.8, close: true, closeSpan: 14, delay: span * 0.4 });
        sfx.play(`impact.${surf}`, { x: ax, y: ay, gain: surf === "stone" ? 1.1 : 0.9, reach: 0.8, close: true, closeSpan: 14, delay });
        if ((surf === "stone" || surf === "wood") && Math.random() < 0.3) sfx.play("impact.ricochet", { x: ax, y: ay, gain: 0.5, reach: 0.8, close: true, closeSpan: 14, delay: delay + 0.04 });
      }
      break;
    }
    case "reload": {
      const s = person(d.by);
      if (!s) break;
      const weapon = d.weapon as string | null;
      if (weapon && BOLT_GUNS.has(weapon)) sfx.playLimited(`r${s.id}`, 200, "gun.clip", { x: s.x, y: s.y, gain: 0.2, reach: 1, close: true });
      else if (weapon === "mg42" || weapon === "bar") sfx.playLimited(`r${s.id}`, 200, "clank", { x: s.x, y: s.y, gain: 0.2, reach: 1, close: true });
      else {
        sfx.playLimited(`r${s.id}`, 200, "gun.mag", { x: s.x, y: s.y, gain: 0.2, reach: 1, close: true });
        sfx.play("gun.slide", { x: s.x, y: s.y, gain: 0.15, reach: 1, close: true, delay: 0.45 });
      }
      break;
    }
    case "barrel_change": {
      const s = person(d.by);
      if (s) sfx.play("clank", { x: s.x, y: s.y, gain: 0.22, reach: 1, close: true });
      break;
    }
    case "tank_fire": {
      const [x, y] = d.from as [number, number];
      sfx.noteGunfire();
      sfx.play("tank.fire", { x, y, gain: 3.4, reach: 5, anywhere: true, carry: 2.5, priority: true });
      break;
    }
    case "tank_hit": {
      const [x, y] = d.at as [number, number];
      const r = d.result as string;
      if (r === "ping") sfx.playLimited("ping", 150, "tank.hit", { x, y, gain: 0.35, reach: 0.9, close: true, closeSpan: 16 });
      else sfx.play("tank.hit", { x, y, gain: r === "bounce" ? 1.4 : 2.4, reach: 2.5, priority: true });
      break;
    }
    case "tank_explodes": {
      const [x, y] = d.at as [number, number];
      sfx.noteGunfire();
      sfx.play("boom.artillery", { x, y, gain: 2.6, reach: 6, anywhere: true, carry: 2.5, priority: true });
      break;
    }
    case "mortar_fire": {
      const [x, y] = d.at as [number, number];
      sfx.noteGunfire();
      // The thump of the tube is only heard from close by: zoomed in on the mortar itself.
      sfx.play("mortar.fire", { x, y, gain: 3.2, reach: 2, close: true, closeSpan: 14, priority: true });
      break;
    }
    case "grenade_thrown": {
      const [fx, fy] = d.from as [number, number];
      if (d.kind === "at_rocket") {
        sfx.noteGunfire();
        sfx.play("at.launch", { x: fx, y: fy, gain: 2.4, reach: 3.5, anywhere: true, carry: 2, priority: true });
        break;
      }
      sfx.play("throw", { x: fx, y: fy, gain: 0.4, reach: 1.4 });
      break;
    }
    case "incoming": {
      const [x, y] = d.at as [number, number];
      const flight = Math.max(0.2, ((d.burst as number) - world.tick) * tickSeconds());
      const total = 2.2;
      sfx.play("whistle", { x, y, gain: 0.9, reach: 4, delay: Math.max(0, flight - total), offset: Math.max(0, total - flight) });
      break;
    }
    case "explosion": {
      const [x, y] = d.at as [number, number];
      const kind = d.kind === "artillery" ? "artillery" : d.kind === "mortar" ? "mortar" : "frag";
      sfx.noteGunfire();
      const gain = kind === "artillery" ? 2.6 : kind === "mortar" ? 4.2 : 4.6;
      sfx.play(`boom.${kind}`, { x, y, gain, reach: kind === "artillery" ? 7 : kind === "mortar" ? 5.5 : 4.5, anywhere: true, carry: kind === "artillery" ? 2.5 : 3.5, priority: true });
      break;
    }
    case "smoke": {
      const [x, y] = d.at as [number, number];
      sfx.play("smoke", { x, y, gain: 0.55, reach: 2 });
      break;
    }
    case "destroyed": {
      const tiles = d.tiles as [number, number, string][];
      for (let k = 0; k < Math.min(3, tiles.length); k++) sfx.play("debris", { x: tiles[k]![0], y: tiles[k]![1], gain: 0.6, reach: 2.2, delay: 0.05 + k * 0.12 });
      break;
    }
    case "building_collapse": {
      const b = world.buildings[d.building as number]!;
      sfx.play("collapse", { x: b.x + b.w / 2, y: b.y + b.h / 2, gain: 0.95, reach: 6, priority: true });
      break;
    }
    case "casualty":
    case "death": {
      const s = person(d.person ?? e.actors[0]);
      if (s) sfx.playLimited(`p${s.id}`, 600, "voice.pain", { x: s.x, y: s.y, gain: e.type === "death" ? 0.08 : 0.1, reach: 1.2, close: true, closeSpan: 12, rate: e.type === "death" ? 0.88 : 1 });
      break;
    }
    case "callout": {
      const s = person(d.by);
      if (s) sfx.playLimited("callout", 250, "voice.shout", { x: s.x, y: s.y, gain: 0.07, reach: 1.2, close: true, closeSpan: 12, rate: 0.9 });
      break;
    }
    case "stumble":
    case "dove": {
      const s = person(d.person ?? e.actors[0]);
      if (!s) break;
      sfx.playLimited(`d${s.id}`, 500, `land.${surfaceAt(s.x, s.y)}`, { x: s.x, y: s.y, gain: 0.2, reach: 1.3, close: true });
      sfx.play("voice.effort", { x: s.x, y: s.y, gain: 0.05, reach: 1.1, close: true, closeSpan: 12 });
      break;
    }
    case "breach": {
      if (d.stage !== "enter") break;
      const s = person(e.actors[0]);
      if (s) sfx.play("door", { x: s.x, y: s.y, gain: 0.7, reach: 1.8 });
      break;
    }
  }
}

const engineClock = new Map<number, number>();

/** Tanks rumble: loud and clanking when they move, an idle mutter when they sit. */
function engines(dt: number): void {
  if (!sfx.ready || paused || world.tanks.size === 0) return;
  for (const t of world.tanks.values()) {
    if (t.kind !== "tank" || (t.state !== "ready" && t.state !== "tracked")) continue;
    const s = world.soldier(t.id);
    const moving = world.tick - t.movedTick <= 2 && world.tick >= t.movedTick;
    const left = (engineClock.get(t.id) ?? 0) - dt;
    if (left > 0) {
      engineClock.set(t.id, left);
      continue;
    }
    engineClock.set(t.id, 0.85);
    if (!sfx.audible(s.x, s.y, 4)) continue;
    sfx.play("tank.engine", { x: s.x, y: s.y, gain: moving ? 0.7 : 0.18, reach: moving ? 3.2 : 1.4, rate: moving ? 1 : 0.8 });
  }
}

const strideAcc = new Map<number, number>();
const lastSpot = new Map<number, { x: number; y: number }>();

/** Boots on the ground: a step every stride a man covers, in the sound of what he stands on. */
function footsteps(alpha: number): void {
  if (!sfx.ready || paused || speed >= 4) return;
  let budget = 10;
  for (const s of world.soldiers) {
    if (s.status === "dead" || s.status === "casualty" || s.carriedById !== null || s.posture === "prone" || !world.onField(s)) continue;
    const p = renderer.worldPos(s, prev, alpha);
    const x = (p.x - 8) / TILE, y = (p.y - 8) / TILE;
    const last = lastSpot.get(s.id);
    if (!last) {
      lastSpot.set(s.id, { x, y });
      continue;
    }
    const moved = Math.hypot(x - last.x, y - last.y);
    last.x = x;
    last.y = y;
    if (moved === 0 || moved > 2) continue;
    if (!sfx.audible(x, y, 1.1)) {
      strideAcc.set(s.id, 0);
      continue;
    }
    const stride = s.posture === "crouch" ? 0.65 : 0.8;
    const acc = (strideAcc.get(s.id) ?? 0) + moved;
    if (acc < stride) {
      strideAcc.set(s.id, acc);
      continue;
    }
    strideAcc.set(s.id, acc - stride);
    if (budget-- <= 0) return;
    const was = prev.get(s.id);
    const run = was !== undefined && Math.hypot(s.x - was.x, s.y - was.y) > 0.9;
    const surf = s.z > 0 ? "wood" : surfaceAt(x, y);
    sfx.play(`step.${surf}.${run ? "run" : "walk"}`, { x, y, gain: run ? 0.15 : 0.1, reach: 1.1, close: true, rate: s.posture === "crouch" ? 0.92 : 1 });
  }
}

function effectsFor(e: SimEvent): void {
  const d = e.data;
  const t = now();
  const span = Math.min(0.9, tickSeconds());
  switch (e.type) {
    case "contact":
    case "squad_state": {
      const id = d.squad as number;
      const fl = renderer.squadFlash.get(id) ?? { contact: -99, decision: "", decidedAt: -99 };
      if (e.type === "contact") fl.contact = t;
      else if (d.from !== "deploy") {
        const intent = String(d.intent ?? "");
        fl.decision = intent.length > 52 ? `${intent.slice(0, 50)}…` : intent;
        fl.decidedAt = t;
      }
      renderer.squadFlash.set(id, fl);
      break;
    }
    case "fire": {
      const [fx, fy] = d.from as [number, number];
      const [ax, ay] = d.at as [number, number];
      const rounds = d.rounds as number;
      const shooter = world.maybe(e.actors[0]);
      const color = SIDE_COLORS[(d.side as Side) ?? shooter?.side ?? "us"].tracer;
      const hits = new Set(d.hits as number[]);
      const shown = Math.min(rounds, 8);
      for (let k = 0; k < shown; k++) {
        const delay = (k / shown) * span;
        const jx = (hash2(e.seq, k, 1) - 0.5) * (hits.size > 0 && k === 0 ? 2 : 22);
        const jy = (hash2(e.seq, k, 2) - 0.5) * (hits.size > 0 && k === 0 ? 2 : 22);
        const x0 = fx * TILE + 8, y0 = fy * TILE + 6, x1 = ax * TILE + 8 + jx, y1 = ay * TILE + 6 + jy;
        // Every fourth round of a belt is a tracer; rifles show a faint streak.
        const automatic = rounds > 1;
        if (!automatic || k % 2 === 0) renderer.addEffect({ kind: "tracer", x0, y0, x1, y1, color: automatic ? color : "rgba(255,240,200,0.55)", born: t, dur: 0.14, delay, by: shooter?.id });
        renderer.addEffect({ kind: "flash", x: x0 + (ax > fx ? 4 : -4), y: y0, r: automatic ? 3 : 2.5, born: t, dur: 0.07, delay, by: shooter?.id });
        renderer.addEffect({ kind: "puff", x: x1, y: y1 + 2, color: "rgba(200,180,140,A)", born: t, dur: 0.35, delay: delay + 0.1 });
      }
      break;
    }
    case "grenade_thrown": {
      const [fx, fy] = d.from as [number, number];
      const [ax, ay] = d.at as [number, number];
      if (d.kind === "at_rocket") {
        const flight = Math.max(0.15, ((d.burst as number) - world.tick) * tickSeconds() * 0.9);
        renderer.addEffect({ kind: "tracer", x0: fx * TILE + 8, y0: fy * TILE + 6, x1: ax * TILE + 8, y1: ay * TILE + 8, color: "#fff2c0", born: t, dur: Math.min(0.5, flight), delay: 0 });
        renderer.addEffect({ kind: "puff", x: fx * TILE + 8 - Math.sign(ax - fx) * 6, y: fy * TILE + 8, color: "rgba(220,210,190,A)", born: t, dur: 0.7, delay: 0 });
        break;
      }
      const flight = Math.max(1, (d.burst as number) - world.tick) * tickSeconds();
      renderer.addEffect({ kind: "arc", x0: fx * TILE + 8, y0: fy * TILE + 4, x1: ax * TILE + 8, y1: ay * TILE + 8, born: t, dur: Math.min(1.2, flight * (d.kind === "rifle_grenade" ? 0.9 : 0.35)), delay: 0, smoke: d.kind === "smoke_grenade" });
      break;
    }
    case "incoming": {
      const [x, y] = d.at as [number, number];
      const dur = Math.max(0.2, ((d.burst as number) - world.tick) * tickSeconds());
      renderer.addEffect({ kind: "shell", x: x * TILE + 8, y: y * TILE + 8, born: t, dur, delay: 0 });
      break;
    }
    case "explosion": {
      const [x, y] = d.at as [number, number];
      const size = d.kind === "artillery" ? 2 : d.kind === "mortar" ? 1 : 0;
      renderer.addEffect({ kind: "boom", x: x * TILE + 8, y: y * TILE + 8, size, seed: e.seq, born: t, dur: BLAST_SECONDS[size]!, delay: 0 });
      break;
    }
    case "destroyed": {
      // Each wall, tree or hedge knocked down throws up its pieces.
      for (const [k, tile] of (d.tiles as [number, number, string][]).entries()) {
        const [x, y, to] = tile;
        if (k > 12) break;
        renderer.addEffect({ kind: "debris", x: x * TILE + 8, y: y * TILE + 8, seed: e.seq * 31 + k, stuff: to === "rubble" ? 0 : to === "deadfall" ? 1 : 2, born: t, dur: 1.6, delay: 0.05 + k * 0.03 });
      }
      break;
    }
    case "building_collapse": {
      const b = world.buildings[d.building as number]!;
      renderer.addEffect({ kind: "collapse", x: b.x * TILE, y: b.y * TILE, w: b.w * TILE, h: b.h * TILE, seed: e.seq, born: t, dur: 4, delay: 0.1 });
      break;
    }
    case "smoke": {
      const [x, y] = d.at as [number, number];
      renderer.addEffect({ kind: "pop", x: x * TILE + 8, y: y * TILE + 8, seed: e.seq, born: t, dur: 1.2, delay: 0 });
      break;
    }
    case "tank_fire": {
      const [fx, fy] = d.from as [number, number];
      const [ax, ay] = d.at as [number, number];
      const dx = Math.sign(ax - fx), dy = Math.sign(ay - fy);
      const mx = fx * TILE + 8 + dx * 12, my = fy * TILE + 6 + dy * 6;
      renderer.addEffect({ kind: "flash", x: mx, y: my, r: 6, born: t, dur: 0.14, delay: 0 });
      renderer.addEffect({ kind: "puff", x: mx, y: my, color: "rgba(210,200,170,A)", born: t, dur: 0.8, delay: 0.04 });
      renderer.addEffect({ kind: "tracer", x0: mx, y0: my, x1: ax * TILE + 8, y1: ay * TILE + 8, color: "#ffe9a0", born: t, dur: 0.16, delay: 0 });
      break;
    }
    case "tank_hit": {
      if (d.result === "ping") break;
      const [x, y] = d.at as [number, number];
      renderer.addEffect({ kind: "flash", x: x * TILE + 8, y: y * TILE + 6, r: d.result === "bounce" ? 3 : 6, born: t, dur: 0.12, delay: 0 });
      renderer.addEffect({ kind: "puff", x: x * TILE + 8, y: y * TILE + 4, color: d.result === "bounce" ? "rgba(255,230,150,A)" : "rgba(60,56,50,A)", born: t, dur: 0.7, delay: 0.05 });
      break;
    }
    case "mortar_fire": {
      const [x, y] = d.at as [number, number];
      renderer.addEffect({ kind: "flash", x: x * TILE + 6, y: y * TILE + 3, r: 5, born: t, dur: 0.12, delay: 0 });
      renderer.addEffect({ kind: "puff", x: x * TILE + 6, y: y * TILE + 2, color: "rgba(200,200,190,A)", born: t, dur: 0.7, delay: 0.05 });
      renderer.addEffect({ kind: "puff", x: x * TILE + 8, y: y * TILE + 6, color: "rgba(180,170,150,A)", born: t, dur: 0.6, delay: 0.1 });
      break;
    }
    case "callout": {
      const s = world.maybe(d.by as number);
      if (!s) break;
      renderer.addEffect({ kind: "text", x: s.x * TILE + 8, y: s.y * TILE - 6, text: d.text as string, color: s.side === "us" ? "#fff0b0" : "#d8f0c8", born: t, dur: Math.max(1.6, Math.min(3, 2.4)), delay: 0, follow: s.id });
      break;
    }
    case "casualty": {
      const s = world.maybe(d.person as number);
      if (s) renderer.addEffect({ kind: "text", x: s.x * TILE + 8, y: s.y * TILE - 4, text: "hit!", color: "#ff7a6a", born: t, dur: 1.2, delay: 0, follow: s.id });
      break;
    }
  }
}

function toast(kind: string, title: string, text: string, people: number[] = [], accent: string | null = null, squad: number | null = null, at: { x: number; y: number } | null = null): HTMLElement {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  // A squad's alert takes the camera to that squad when clicked.
  if (squad !== null) {
    el.dataset.squad = String(squad);
    el.title = "Click to look at this squad";
  }
  // Any alert about a place or a man takes the camera there when tapped.
  if (squad === null && people.length > 0) el.dataset.focus = String(people[0]);
  if (at) el.dataset.at = `${at.x},${at.y}`;
  if (el.dataset.squad || el.dataset.focus || el.dataset.at) el.classList.add("tap");
  if (accent) el.style.borderLeft = `6px solid ${accent}`;
  el.innerHTML = `<b>${esc(title)}</b>${linkNames(esc(text), people)}`;
  const box = $("toasts");
  box.prepend(el);
  // On a phone the map is small: fewer alerts, and they go sooner.
  const phone = window.matchMedia("(max-width: 900px)").matches;
  const small = phone || simpleUi;
  while (box.children.length > (simpleUi && phone ? 1 : small ? 2 : 5)) box.lastElementChild?.remove();
  setTimeout(() => el.remove(), simpleUi && phone ? 4500 : small ? 6000 : 9000);
  return el;
}

/** What each change of squad state reads as in an alert: a title, and what the squad "is" doing. */
const SQUAD_ALERTS: Record<string, [string, string]> = {
  react: ["Contact", "has made contact and is returning fire"],
  fix: ["Pinning", "is pinning the enemy down with fire"],
  flank: ["Flanking", "is working round the flank"],
  assault: ["Assault", "is assaulting the position"],
  consolidate: ["Objective", "is digging in on the objective"],
  fall_back: ["Falling back", "is falling back"],
  withdraw: ["Retreating", "is retreating"],
  broken: ["Broken", "has broken and is drifting back"],
  displace: ["Under mortar fire", "is displacing out of the barrage"],
  reinforce: ["Reinforcing", "is moving up to help another squad"],
  hold: ["New line", "is holding a new line"],
  advance: ["Advancing", "is pushing on"],
};
const lastSquadAlert = new Map<number, { state: string; tick: number }>();
let lastCasualtyToast = -999;
let lastMedicToast = -999;

function squadAlert(e: SimEvent): void {
  const d = e.data;
  const sq = world.squads[d.squad as number];
  const to = d.to as string, from = d.from as string;
  const words = SQUAD_ALERTS[to];
  if (!sq || !words) return;
  // Not the opening orders, nor a squad that is only picking up its advance again.
  if (from === "deploy" || (to === "hold" && from !== "fall_back") || (to === "advance" && from !== "assault")) return;
  const last = lastSquadAlert.get(sq.id);
  if (last && last.state === to && e.tick - last.tick < 30) return;
  lastSquadAlert.set(sq.id, { state: to, tick: e.tick });
  toast("squad", `${words[0]} · ${sq.side === "us" ? "US" : "German"}`, `${sq.name} ${words[1]}.`, [], sq.color, sq.id);
}

/** A camera ride from a sniper to the man he is watching, along the line of sight. */
let scopeTour: { sniper: number; target: number; t0: number } | null = null;
let runnerFollow: { squad: number; lastMark: number } | null = null;

/** The runner a squad has out, if he is still on the way. */
function runnerOf(squadId: number): { x: number; y: number } | null {
  const r = world.runners.find((q) => q.squadId === squadId);
  return r ? { x: r.x, y: r.y } : null;
}

function toastFor(e: SimEvent): void {
  const d = e.data;
  const s = (k: string) => world.maybe(d[k] as number);
  switch (e.type) {
    case "squad_state":
      squadAlert(e);
      break;
    case "help_call": {
      const sq = world.squads[d.squad as number]!;
      const el = toast("squad", `${d.by === "radio" ? "Radio" : "Runner"} · ${sq.side === "us" ? "US" : "German"}`, `${sq.name} is ${d.why as string} and ${d.by === "radio" ? "radios" : "sends a runner"} for help.`, [], sq.color, sq.id);
      if (d.by === "runner") {
        // Clicking follows the runner across the field to the platoon leader.
        delete el.dataset.squad;
        el.dataset.runner = String(sq.id);
        el.title = "Click to follow the runner";
      }
      break;
    }
    case "runner_killed": {
      const sq = world.squads[d.squad as number]!;
      const at = d.at as number[];
      toast("death", `Runner down · ${sq.side === "us" ? "US" : "German"}`, `${sq.name}'s runner is ${d.by === "shell" ? "caught by a shell" : "shot down"} before he reaches the platoon leader.`, [], sq.color, sq.id);
      renderer.addEffect({ kind: "pop", x: at[0]! * TILE + 8, y: at[1]! * TILE + 8, seed: e.seq, born: now(), dur: 1.2, delay: 0 });
      break;
    }
    case "help_sent": {
      const to = world.squads[d.to as number]!;
      const sent = d.squad !== null ? world.squads[d.squad as number]! : null;
      toast("squad", `Support · ${to.side === "us" ? "US" : "German"}`, sent ? `${sent.name} is sent to help ${to.name}.` : `No squad to spare for ${to.name}${d.mortars ? "; the mortars will be told" : ""}.`, [], (sent ?? to).color, (sent ?? to).id);
      break;
    }
    case "ambush_sprung": {
      const sq = world.squads[d.squad as number]!;
      toast("fire", `Ambush · ${sq.side === "us" ? "US" : "German"}`, d.found ? `${sq.name}'s ambush is found; they open fire.` : `${sq.name} springs its ambush on ${d.enemies as number} men in the open!`, [], sq.color, sq.id);
      break;
    }
    case "breach": {
      const sq = world.squads[d.squad as number]!;
      const b = world.buildings[d.house as number]!;
      const what = d.stage === "stack" ? `is stacking up on ${b.name}` : d.stage === "grenades" ? `posts grenades through the windows of ${b.name}` : `storms into ${b.name}`;
      toast("squad", `Clearing a house · ${sq.side === "us" ? "US" : "German"}`, `${sq.name} ${what}.`, [], sq.color, sq.id);
      break;
    }
    case "building_collapse":
    {
      const b = world.buildings[d.building as number];
      toast("fire", "Collapse", `${(d.name as string).replace(/^./, (c) => c.toUpperCase())} falls in under the shelling${(d.hurt as number[]).length ? `; ${(d.hurt as number[]).length} men caught inside` : ""}.`, d.hurt as number[], null, null, b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null);
    }
      break;
    case "death": {
      const p = s("person");
      if (p && (p.role === "squad_leader" || p.role === "platoon_leader" || p.role === "medic" || p.role === "machine_gunner" || p.role === "auto_rifleman")) toast("death", "Killed", `${label(p)}, ${roleName(p)}, is dead.`, [p.id]);
      break;
    }
    case "fire_mission": {
      const r = s("by");
      if (r) toast("fire", "Fire mission", `${label(r)} is calling in mortars.`, [r.id]);
      break;
    }
    case "casualty": {
      // Not every man down: one every few seconds, so the screen tells the story and does not shout.
      const p = s("person");
      if (p && e.tick - lastCasualtyToast >= 25) {
        lastCasualtyToast = e.tick;
        toast("death", p.side === "us" ? "Man down" : "Enemy down", `${label(p)} is down${p.side === "us" ? ": a medic is needed" : ""}.`, [p.id]);
      }
      break;
    }
    case "wounds_treated": {
      const a = s("by"), p = s("person");
      if (a && p && a.role === "medic" && e.tick - lastMedicToast >= 40) {
        lastMedicToast = e.tick;
        toast("squad", "Medic", `${label(a)} is dressing ${label(p)}'s wounds under fire.`, [a.id, p.id]);
      }
      break;
    }
    case "platoon_withdraws":
      toast("battle", "Withdrawal", `${world.platoons[d.side as Side].name} is pulling back.`);
      break;
    case "position_taken":
      toast("battle", "Position taken", `${world.squads[d.squad as number]!.name} has overrun the enemy position.`, [], null, d.squad as number);
      break;
    case "surrender": {
      const p = s("person");
      if (p) toast("battle", "Surrender", `${label(p)} gives himself up.`, [p.id]);
      break;
    }
    case "takes_command": {
      const p = s("by");
      if (p) toast("battle", "Command", `${label(p)} takes over ${world.squads[d.squad as number]!.name}.`, [p.id]);
      break;
    }
    case "battle_end":
      track("battle_end", { tick: world.tick, winner: String(world.result?.winner ?? "none"), cinematic });
      toast("battle", "The fighting ends", d.reason as string);
      paused = true;
      syncControls();
      setTimeout(() => {
        if (!reportShown) {
          reportShown = true;
          openReport();
        }
      }, 600);
      break;
  }
}

// ---------- Battles ----------

function newBattle(seed: number, opts: { cinematic: boolean } = { cinematic: false }): void {
  const token = ++battleToken;
  const log = new EventLog({ hash: false });
  chains.clear();
  blasts.length = 0;
  boltsEl.innerHTML = "";
  endCine(false);
  feed = [];
  reportShown = false;
  quickId = null;
  $("quick").classList.remove("open");
  renderer.reset();
  lastSquadAlert.clear();
  miniBase.img = null;
  $("toasts").innerHTML = "";
  log.addSink((e) => onEvent(e));
  world = undefined as unknown as World;
  // ?map=urban (or hamlet, rural, road, town) picks the ground instead of the seed.
  const mapKind = new URLSearchParams(location.search).get("map");
  const kinds = ["hamlet", "rural", "road", "town", "urban"] as const;
  const kind = kinds.find((k) => k === mapKind) ?? null;
  engine = createSimulation({ seed, log, config: { checkInvariants: false, map: { kind } } });
  world = engine.world;
  // The opening event fired before the sink saw the world; describe it now.
  const start = describe({ seq: 0, tick: 0, type: "battle_start", actors: [], data: {} }, world);
  if (start) feed.push(start);
  prev = new Map(world.soldiers.map((s) => [s.id, { x: s.x, y: s.y }]));
  selected = null;
  follow = false;
  userCamera = false;
  acc = 0;
  paused = false;
  dirty = { feed: true, events: true };
  $("date").textContent = `${world.config.time.date} · ${world.weather.kind}`.toUpperCase();
  $("date").title = `${world.layout.name}, ${world.weather.label}`;
  fitCamera();
  renderRoster();
  // The cinematic start: simple screen, auto camera, run through the march up to the first shots.
  cinematic = opts.cinematic;
  hookUsed = 0;
  liveSince = -1;
  watched = 0;
  hookCooldownUntil = 0;
  setSimple(cinematic);
  setDirector(cinematic);
  if (cinematic) {
    paused = true;
    void fastForwardToContact(token);
  }
  syncControls();
  battlesRun++;
  dailyBattle = seed === dailySeed() && new URLSearchParams(location.search).get("daily") === "1";
  if (dailyBattle) {
    setTimeout(() => {
      if (token === battleToken) toast("battle", "Battle of the day", `${world.layout.name}, ${world.weather.label}. Everyone who opens today's battle gets this same fight.`);
    }, 4500);
  }
  track("battle_start", { seed, n: battlesRun, cinematic, phone: isPhone(), daily: dailyBattle });
  try {
    history.replaceState(null, "", `?seed=${seed}${kind ? `&map=${kind}` : ""}`);
  } catch {
    // Not important.
  }
}

function fitCamera(): void {
  const rect = canvas.getBoundingClientRect();
  if (!world || rect.width === 0) return;
  // Start looking at the attackers' line of departure, with the defended hedge in view.
  zoomGoal = null;
  cam.zoom = Math.max(1, Math.min(1.6, rect.height / ((world.map.height * 0.5) * TILE)));
  const att = world.side(world.attacker);
  const cx = att.reduce((a, s) => a + s.x, 0) / att.length;
  const cy = (att.reduce((a, s) => a + s.y, 0) / att.length + world.layout.line.y) / 2;
  cam.x = cx * TILE - rect.width / cam.zoom / 2;
  cam.y = cy * TILE - rect.height / cam.zoom / 2;
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

async function advance(n: number): Promise<void> {
  busy = true;
  for (let i = 0; i < n; i++) {
    prev = new Map(world.soldiers.map((s) => [s.id, { x: s.x, y: s.y }]));
    await engine.step();
  }
  busy = false;
}

const FRAME_BUDGET_MS = 14;

async function advanceWithin(budget: number): Promise<void> {
  busy = true;
  const start = performance.now();
  while (acc >= 1 && performance.now() - start < budget && !paused) {
    prev = new Map(world.soldiers.map((s) => [s.id, { x: s.x, y: s.y }]));
    await engine.step();
    acc -= 1;
  }
  if (acc > 2) acc = 1.99;
  busy = false;
}

function frame(t: number): void {
  resize();
  const dt = Math.min(0.25, (t - lastTime) / 1000);
  lastTime = t;
  if (!paused && !busy) {
    acc += dt * SPEEDS[speed]!.tps;
    if (acc >= 1) void advanceWithin(FRAME_BUDGET_MS);
  }
  const alpha = Math.min(1, acc);
  const sel = world.maybe(selected);
  const rect = canvas.getBoundingClientRect();
  if (follow && sel && sel.status !== "routed") {
    const p = renderer.worldPos(sel, prev, alpha);
    cam.x += (p.x - rect.width / cam.zoom / 2 - cam.x) * 0.15;
    cam.y += (p.y - rect.height / cam.zoom / 2 - cam.y) * 0.15;
  }
  if (scopeTour && !cine) {
    const a = world.maybe(scopeTour.sniper), b = world.maybe(scopeTour.target);
    const u = Math.min(1, (now() - scopeTour.t0) / 1.6);
    if (!a || !b) scopeTour = null;
    else {
      const e = u * u * (3 - 2 * u);
      const x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e;
      cam.x += ((x + 0.5) * TILE - rect.width / cam.zoom / 2 - cam.x) * 0.3;
      cam.y += ((y + 0.5) * TILE - rect.height / cam.zoom / 2 - cam.y) * 0.3;
      if (u >= 1) scopeTour = null;
    }
  }
  if (runnerFollow && !cine) {
    const rp = runnerOf(runnerFollow.squad);
    if (!rp) runnerFollow = null;
    else {
      cam.x += (rp.x * TILE + 8 - rect.width / cam.zoom / 2 - cam.x) * 0.2;
      cam.y += (rp.y * TILE + 8 - rect.height / cam.zoom / 2 - cam.y) * 0.2;
    }
  }
  if (cine) cineFrame(dt);
  else if (director.on && !ffActive) directorStep(dt);
  else {
    panCamera(dt);
    easeZoom(dt);
  }
  updateHook();
  placeBolts();
  placeBlasts();
  renderer.hovered = hover ? pickAt(hover.sx, hover.sy) : null;
  renderer.draw(world, cam, opts, prev, alpha, selected, t / 1000);
  const halfW = rect.width / cam.zoom / 2;
  sfx.setListener((cam.x + halfW) / TILE, (cam.y + rect.height / cam.zoom / 2) / TILE, halfW / TILE);
  sfx.ambience(dt, world.weather.kind);
  footsteps(alpha);
  engines(dt);
  drawMinimap(minimap, world, cam, rect.width, rect.height, miniBase);
  updateGridRef();
  updateHud();
  requestAnimationFrame(frame);
}

// ---------- HUD and panels ----------

/** The map reference of the tile under the pointer, shown under the minimap. Kept current as the camera moves too. */
function updateGridRef(): void {
  let text = "Grid —";
  if (hover) {
    const x = Math.floor((hover.sx / cam.zoom + cam.x) / TILE), y = Math.floor((hover.sy / cam.zoom + cam.y) / TILE);
    const map = world.map;
    if (map.inBounds(x, y)) {
      const i = map.idx(x, y);
      const b = map.building[i]!;
      const what = b >= 0 ? world.buildings[b]!.name : map.at(x, y).replace(/_/g, " ");
      text = `${gridSquare(x, y)} · ${String(x).padStart(3, "0")},${String(y).padStart(3, "0")} · ${Math.round(map.elev[i]!)}m · ${what}`;
    }
  }
  if (gridref.textContent !== text) gridref.textContent = text;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function personLink(s: Soldier): string {
  return `<a data-person="${s.id}">${esc(label(s))}</a>`;
}

function linkNames(html: string, people: number[]): string {
  for (const id of people) {
    const s = world.maybe(id);
    if (!s) continue;
    const name = esc(label(s));
    const i = html.indexOf(name);
    if (i >= 0) html = html.slice(0, i) + personLink(s) + html.slice(i + name.length);
  }
  return html;
}

function bar(name: string, v: number, color: string, text = ""): string {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return `<div class="bar"><span>${name}${text ? ` <small>${text}</small>` : ""}</span><i><b style="width:${pct}%;background:${color}"></b></i></div>`;
}

let hudThrottle = 0;

function updateHud(): void {
  const clockEl = $("clock");
  const pl = world.platoons;
  const state = world.phase === "over" ? `OVER — ${world.result?.winner === null ? "no decision" : world.result?.winner === "us" ? "US victory" : "German victory"}` : `${pl[world.attacker].role === "attack" ? "attack" : ""}: ${pl[world.attacker].phase}`;
  clockEl.textContent = `${world.clock()} · ${state}${paused ? " · PAUSED" : ""}`;
  clockEl.classList.toggle("paused", paused);
  if (++hudThrottle % 10 !== 0) return;
  renderForces();
  if (dirty.feed) {
    renderFeed();
    dirty.feed = false;
  }
  if (tab === "men") {
    renderRoster();
    renderInspector();
  } else if (tab === "squads") renderSquads();
  else if (tab === "events" && dirty.events) {
    renderEvents();
    dirty.events = false;
  }
}

function renderForces(): void {
  const rows: string[] = [];
  for (const side of [world.attacker, world.attacker === "us" ? "de" : "us"] as Side[]) {
    const pl = world.platoons[side];
    const all = world.men(side);
    const n = all.length;
    const able = all.filter((s) => world.able(s) && !s.pinned).length;
    const pinned = all.filter((s) => world.able(s) && s.pinned).length;
    const hurt = all.filter((s) => s.status === "casualty").length;
    const dead = all.filter((s) => s.status === "dead").length;
    const pow = all.filter((s) => s.status === "captured" || s.status === "surrendered").length;
    const gone = all.filter((s) => s.status === "routed").length;
    const seg = (k: number, c: string) => (k > 0 ? `<i style="width:${(k / n) * 100}%;background:${c}"></i>` : "");
    rows.push(`<div class="force"><div class="name"><span style="color:${SIDE_COLORS[side].name}">${icon(side === "us" ? "flagus" : "flagde")} ${esc(pl.name)}</span><small>${pl.role === "attack" ? "attacking" : "defending"} · ${esc(pl.phase)}</small></div>
      <div class="stack">${seg(able, "#7ac860")}${seg(pinned, "#f0963a")}${seg(hurt, "#e05a4a")}${seg(dead, "#3a3a3a")}${seg(pow, "#b0b0b0")}${seg(gone, "#6a5a8a")}</div>
      <div class="legend"><span><i style="background:#7ac860"></i>${able} fighting</span><span><i style="background:#f0963a"></i>${pinned} pinned</span><span><i style="background:#e05a4a"></i>${hurt} wounded</span><span><i style="background:#3a3a3a"></i>${dead} dead</span>${pow ? `<span><i style="background:#b0b0b0"></i>${pow} prisoners</span>` : ""}${gone ? `<span><i style="background:#6a5a8a"></i>${gone} gone</span>` : ""}<span>· ${pl.fireMissionsLeft} mortar missions</span></div></div>`);
  }
  $("forces").innerHTML = rows.join("");
}

function feedHtml(lines: FeedLine[]): string {
  return lines.map((l) => `<li class="l-${l.cat}"><time>${clock(world, l.tick)}</time> ${linkNames(esc(l.text), l.people)}</li>`).join("");
}

function renderFeed(): void {
  $("chronicle").classList.toggle("hidden", !opts.chronicle);
  $("feed").innerHTML = feedHtml(feed.slice(-10));
}

function renderEvents(): void {
  $("events").innerHTML = feedHtml(feed.filter((l) => l.major).slice(-200).reverse());
}

function statusIcon(s: Soldier): string {
  if (s.status === "dead") return icon("dead");
  if (s.status === "casualty") return icon("medic");
  if (s.status === "captured" || s.status === "surrendered") return icon("flag");
  if (s.status === "routed") return icon("back");
  if (s.broken) return "!";
  if (s.pinned) return "▼";
  return "";
}

function renderRoster(): void {
  if (!world) return;
  const parts: string[] = [];
  for (const sq of world.squads) {
    const men = sq.members.map((id) => world.soldier(id));
    parts.push(
      `<div class="sq"><em class="sw" style="background:${sq.color}"></em><b style="color:${SIDE_COLORS[sq.side].name}">${esc(sq.name)}</b> ` +
        men
          .map((s) => {
            const cls = s.id === selected ? "sel" : s.status === "dead" || s.status === "routed" || s.status === "captured" ? "gone" : s.status === "casualty" || s.injuries.some((i) => !i.permanent && i.severity > 0.2) ? "hurt" : "";
            return `<a data-person="${s.id}" class="${cls}" title="${esc(roleName(s))}">${esc(s.last)}${statusIcon(s)}</a>`;
          })
          .join(" ") +
        `</div>`,
    );
  }
  const html = parts.join("");
  const el = $("roster");
  if (el.innerHTML !== html) el.innerHTML = html;
}

function isEye(part: BodyPart): boolean {
  return part === "left eye" || part === "right eye";
}

function injuryColor(inj: Injury): string {
  if (inj.kind === "lost" || inj.lasting === "lost eye") return "#0c0c0c";
  if (inj.permanent) return "#8a5ab0";
  if (inj.infected) return "#a0c020";
  return inj.severity >= 0.75 ? "#c01818" : inj.severity >= 0.5 ? "#e05a2a" : inj.severity >= 0.25 ? "#e0a03a" : "#e8d060";
}

function paintPanel(s: Soldier): void {
  const face = document.getElementById("face") as HTMLCanvasElement | null;
  if (face) {
    face.width = 16;
    face.height = 16;
    const lostEyes: ("left" | "right")[] = [];
    let bruised = false, cut = false, scar = false, deepScar = false, ruined = false;
    for (const i of s.injuries) {
      if (isEye(i.part) && (i.kind === "lost" || i.lasting === "lost eye")) lostEyes.push(i.part === "left eye" ? "left" : "right");
      if (!(i.part === "face" || isEye(i.part) || i.part === "head")) continue;
      if (i.permanent) {
        if (i.lasting === "ruined face") ruined = true;
        else if (i.lasting === "disfiguring scar") deepScar = true;
        else scar = true;
      } else if (i.kind === "bruise" || i.kind === "fracture") bruised = true;
      else cut = true;
    }
    face.getContext("2d")!.drawImage(faceCanvas({ id: s.id, side: s.side, medic: s.role === "medic", pain: fightingPain(s), morale: s.morale, lostEyes, bruised, cut, scar, deepScar, ruined, bloody: s.bloodied, dead: s.status === "dead" }), 0, 0);
  }
  const body = document.getElementById("bodydiag") as HTMLCanvasElement | null;
  if (!body) return;
  body.width = 40;
  body.height = 74;
  const g = body.getContext("2d")!;
  const skin = skinOf(s.id);
  for (const part of Object.keys(BODY_RECTS)) {
    const [x, y, w, h] = BODY_RECTS[part]!;
    if (isEye(part as BodyPart)) continue;
    let col = part === "torso" || part.endsWith("arm") ? SIDE_COLORS[s.side].coat : part.endsWith("leg") ? SIDE_COLORS[s.side].trousers : part.endsWith("foot") ? SIDE_COLORS[s.side].boots : part === "head" ? SIDE_COLORS[s.side].helmet : skin;
    let worst = -1;
    for (const i of s.injuries) {
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
    // Blood still running.
    if (s.injuries.some((i) => i.part === part && i.bleeding > 0.05)) {
      g.fillStyle = "#ff2a1a";
      g.fillRect(x + Math.floor(w / 2), y + h, 1, 3);
    }
  }
  for (const part of ["left eye", "right eye"] as const) {
    const [x, y, w, h] = BODY_RECTS[part]!;
    const lost = s.injuries.some((i) => i.part === part && (i.kind === "lost" || i.lasting === "lost eye"));
    g.fillStyle = lost ? "#000" : "#f4f0e8";
    g.fillRect(x, y, w, h);
  }
}

function traitWords(s: Soldier): string {
  const t = s.traits;
  const w: string[] = [];
  w.push(t.nerve > 0.7 ? "cool under fire" : t.nerve < 0.35 ? "jumpy" : "steady enough");
  if (t.aggression > 0.66) w.push("aggressive");
  else if (t.aggression < 0.3) w.push("cautious");
  if (t.marksmanship > 0.7) w.push("a crack shot");
  else if (t.marksmanship < 0.3) w.push("a poor shot");
  if (t.discipline > 0.75) w.push("follows orders to the letter");
  else if (t.discipline < 0.35) w.push("a law unto himself");
  if (t.empathy > 0.72) w.push("looks after his buddies");
  if (t.leadership > 0.7) w.push("a natural leader");
  return w.join(", ");
}

function doingText(s: Soldier): string {
  if (s.status === "dead") return `Killed at ${clock(world, s.deathTick ?? 0)}`;
  if (s.status === "routed") return "Gone from the field";
  if (s.status === "captured") return `A prisoner of ${world.maybe(s.capturedBy) ? label(world.soldier(s.capturedBy!)) : "the enemy"}`;
  if (s.status === "surrendered") return "Hands up, waiting to be taken prisoner";
  if (s.carriedById !== null) return `Being carried back by ${label(world.soldier(s.carriedById))}`;
  if (!s.conscious) return "Unconscious";
  if (s.status === "casualty") {
    const near = world.soldiers.find((o) => o.id !== s.id && o.act?.cand.kind === "aid" && o.act.cand.targetId === s.id);
    return near ? `Wounded — ${label(near)} is coming to him` : bleedingOf(s) > 0.05 ? "Wounded and bleeding, calling for a medic" : "Wounded, lying low";
  }
  const parts: string[] = [];
  if (s.reloadLeft > 0) parts.push(s.heat === 0.3 ? "changing the barrel" : "reloading");
  if (s.act) parts.push(s.act.cand.description);
  else parts.push("taking stock");
  if (s.broken) parts.unshift("nerve broken —");
  else if (s.pinned) parts.unshift("pinned down —");
  return parts.join(" ").replace(/^./, (c) => c.toUpperCase());
}

function describeBody(s: Soldier): string {
  const he = "He", his = "his";
  const looks = appearance(s.id);
  const parts: string[] = [];
  const exp = s.experience === "veteran" ? (s.side === "de" ? "a veteran of the Eastern Front" : "a veteran of North Africa and Sicily") : s.experience === "green" ? "a green replacement" : "a trained but untried soldier";
  parts.push(`<p>${esc(s.first)} is ${s.age}, from ${esc(s.hometown)}: ${exp}, with ${looks.skin} skin and ${looks.hair} hair.</p>`);
  const pain = fightingPain(s);
  if (s.status !== "dead") {
    const look = !s.conscious ? `${he} lies senseless.` : pain > 0.6 ? `${he} is grey-faced, gasping with pain${s.morphineTick >= 0 ? " even through the morphine" : ""}.` : pain > 0.3 ? `${he} grits ${his} teeth against the pain.` : s.morale < 0.25 ? `${he} is shaking.` : s.pinned ? `${he} presses himself into the dirt.` : `${he} looks ${s.morale > 0.7 ? "determined" : "tense"}.`;
    const body: string[] = [];
    if (cannotWalk(s)) body.push(`${he} cannot walk.`);
    else if (mobility(s) < 0.6) body.push(`${he} drags a leg, moving at ${Math.round(mobility(s) * 100)}% of his pace.`);
    else if (mobility(s) < 0.92) body.push(`${he} limps.`);
    if (armFactor(s) < 0.6) body.push(`${his[0]!.toUpperCase()}${his.slice(1)} hands and arms are too hurt to shoot straight.`);
    if (sightFactor(s) < 0.85) body.push(`${he} sees poorly.`);
    if (disfigurement(s) >= 0.4) body.push(`${his[0]!.toUpperCase()}${his.slice(1)} face is badly scarred.`);
    parts.push(`<p>${look} ${body.join(" ")}</p>`);
  }
  const fresh = s.injuries.filter((i) => !i.permanent && (i.severity >= 0.05 || i.infected));
  const lasting = s.injuries.filter((i) => i.permanent);
  const wounds = [
    ...lasting.map((i) => `<li class="lasting">◆ ${esc(i.lasting ?? describeInjury(i))} <small>(${esc(i.part)})</small></li>`),
    ...fresh.map((i) => {
      const care = i.care < 0.1 ? "undressed" : i.care < 0.6 ? "field dressing" : "dressed by the medic";
      const bleed = i.bleeding > 0.3 ? ", <b>bleeding badly</b>" : i.bleeding > 0.05 ? ", bleeding" : "";
      return `<li class="${i.severity >= 0.5 ? "grave" : "wound"}">● ${esc(describeInjury(i))} — ${severityWord(i)}, ${care}${bleed} <small>(${esc(i.cause)}, ${clock(world, i.tick)})</small></li>`;
    }),
  ];
  parts.push(wounds.length ? `<ul class="wounds">${wounds.join("")}</ul>` : `<p class="hint">Not a scratch.</p>`);
  return parts.join("");
}

const FLOOR_NAMES = ["ground floor", "first floor", "second floor", "third floor"];

/** Where a man is: indoors and on which floor, or on what ground, and how high. */
function whereText(s: Soldier): string {
  const b = world.map.building[world.map.idx(s.x, s.y)]!;
  const up = Math.round(world.map.heightAt(s.x, s.y, s.z));
  if (b >= 0 && world.map.indoors(s.x, s.y, s.z)) return `In ${world.buildings[b]!.name}, ${FLOOR_NAMES[s.z] ?? `floor ${s.z}`}${s.role === "sniper" && s.hide && s.hide.x === s.x && s.hide.y === s.y ? " (his hide)" : ""} · ${up} m above the stream`;
  const t = world.map.at(s.x, s.y);
  const ground: Record<string, string> = { deadfall: "among shattered trees", grass: "in a pasture", wheat: "in the wheat", road: "on the road", orchard: "in an orchard", woods: "in the woods", hedge: "in a hedgerow", wall: "at a wall", water: "in the stream", bridge: "on the bridge", rubble: "in rubble", crater: "in a shell hole", foxhole: "in a foxhole", marsh: "in wet meadow", brush: "in the brambles", ditch: "in a ditch", floor: "indoors", door: "in a doorway", stairs: "on the stairs", sandbags: "behind sandbags", wire: "caught in the wire", wreck: "by a burnt-out wreck", pothole: "in a pothole", paving: "on the pavement", fountain: "at the fountain", statue: "by a statue", stall: "among the market stalls", debris: "in the debris" };
  return `${(ground[t] ?? t).replace(/^./, (c) => c.toUpperCase())} · ${up} m above the stream`;
}

const VEHICLE_BLURB: Record<string, string> = {
  "M4 Sherman": "A thirty-ton medium tank with a 75 mm gun and a machine gun beside it, built by the thousand and easy to keep running. Quick and reliable, but its sides are thin and a petrol engine burns readily when one is hit.",
  "Panzer IV": "A twenty-five-ton workhorse of the German armoured force with a long 75 mm gun. Thick across the front and dangerous at range, but slower to turn its turret and short of friends once the infantry about it are gone.",
  "57 mm anti-tank gun": "A towed American anti-tank gun on two small wheels behind a steel shield. Low and hard to see, it can punch through most of what the Germans drive, but it has no armour to speak of and its three-man crew are exposed beside it.",
  "5 cm Pak 38": "A light German anti-tank gun behind a thin shield, towed by its crew or a truck. It is hard to spot in a hedge and hits hard at close range, but one high-explosive shell silences it and its crew stand out in the open.",
};

function renderVehicleInspector(s: Soldier): void {
  const t = world.tanks.get(s.id);
  const el = $("inspector");
  if (!t) return;
  const gun = t.kind === "field_gun";
  const crew = t.crew.map((id) => world.soldier(id));
  const alive = crew.filter((c) => c.status !== "dead").length;
  const spec = s.weapon ? world.config.weapons[s.weapon] : null;
  const pl = world.platoons[t.side];
  const modeText = gun ? "dug in behind the hedge" : t.mode === "advance" ? "leading the attack" : t.mode === "fall_back" ? "falling back" : "dug in to fire";
  const state: Record<string, string> = { ready: "In action", tracked: "Track broken: immobilised", burning: "On fire", abandoned: "Abandoned by its crew", wrecked: gun ? "Knocked out" : "Knocked out" };
  let status = `${state[t.state] ?? t.state} · ${modeText}`;
  if (t.state === "tracked" && t.repair) status = `Crew out mending the track (${Math.min(100, Math.round((t.repair.done / t.repair.need) * 100))}%)`;
  if (t.state === "ready" && world.tick < t.stuckUntil) status = `Bogged down for another ${t.stuckUntil - world.tick} s`;
  if (t.state === "burning") status = `On fire: ${Math.max(0, t.cookAt - world.tick)} s to the ammunition`;
  const shellMax = gun ? world.config.armour.field.shells : world.config.armour.tank.shells;
  const crewLine = crew.map((c) => {
    const where = c.status === "aboard" ? "inside" : c.status === "dead" ? "dead" : c.status === "casualty" ? "wounded, out" : "outside";
    return `<li>${personLink(c)} <small>${esc(roleName(c))} · ${where}</small></li>`;
  }).join("");
  el.innerHTML = `
    <div class="pp-head"><canvas id="vface" class="face" width="48" height="48" style="background:#1c1d12"></canvas><div><b>${esc(t.name)}</b><small>${gun ? "Anti-tank gun" : "Tank"} · ${t.side === "us" ? "American" : "German"}, attached to ${esc(pl.name)}</small><small>${esc(world.squad(s.squadId).name)}</small><small>${esc(t.kind === "tank" ? `${alive} of ${crew.length} crew fit` : `${alive} of ${crew.length} gunners left`)}</small></div></div>
    <div class="doing">${esc(status)}</div>
    ${bar("Shells", Math.max(0, t.shells) / shellMax, "#e8c040", `${Math.max(0, t.shells)} left`)}
    ${spec ? bar("Machine gun", (s.loaded + s.ammo) / (spec.capacity * 6), "#f0963a", `${s.loaded + s.ammo} rounds`) : ""}
    ${bar("Crew", alive / Math.max(1, crew.length), alive === crew.length ? "#7ac860" : alive > 1 ? "#e0a03a" : "#e05a4a")}
    <p class="desc">${esc(VEHICLE_BLURB[t.name] ?? "")}</p>
    <h4>CREW</h4><ul class="plain">${crewLine}</ul>
    <div class="traits">${s.shots} machine-gun rounds · ${s.kills} killed${t.stuckCount > 0 ? ` · bogged ${t.stuckCount} time${t.stuckCount > 1 ? "s" : ""}` : ""}</div>
    <h4>RECENTLY</h4><ul class="plain">${s.recent.slice(-8).reverse().map((r) => `<li><time>${clock(world, r.tick)}</time> ${esc(r.text)}</li>`).join("")}</ul>
    <button id="followbtn" style="margin-top:6px">${follow ? "◉ Following" : "○ Follow (F)"}</button>`;
  // A little portrait of the machine, in the same pixels as on the map.
  const c = document.getElementById("vface") as HTMLCanvasElement | null;
  if (c) {
    const g = c.getContext("2d")!;
    const dead = t.state === "wrecked" || t.state === "abandoned";
    const top = dead ? "#403d36" : t.side === "us" ? "#6a7b44" : "#8a8a7e";
    const topL = dead ? "#4e4a42" : t.side === "us" ? "#8a9c5a" : "#aaaa9c";
    const face = dead ? "#2a2822" : t.side === "us" ? "#46522c" : "#5e5e56";
    const px = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(x, y, w, h);
    };
    g.clearRect(0, 0, 48, 48);
    if (gun) {
      px(10, 36, 28, 3, "rgba(0,0,0,0.35)");
      px(14, 30, 6, 6, "#1e1e19");
      px(26, 30, 6, 6, "#1e1e19");
      px(6, 26, 30, 3, dead ? "#16150f" : "#25251f");
      px(20, 14, 5, 16, face);
      px(20, 14, 5, 13, top);
      px(20, 14, 5, 2, topL);
    } else {
      px(4, 36, 40, 4, "rgba(0,0,0,0.35)");
      px(6, 26, 36, 9, face);
      px(6, 26, 36, 4, "#1e1e19");
      for (let k = 8; k < 40; k += 4) px(k, 27, 2, 2, "#5a5a50");
      px(7, 14, 34, 12, top);
      px(7, 14, 34, 2, topL);
      px(26, 14, 14, 12, topL);
      px(30, 10, 14, 3, dead ? "#16150f" : "#25251f");
      px(14, 8, 16, 7, face);
      px(14, 5, 16, 9, top);
      px(14, 5, 16, 2, topL);
      px(20, 8, 4, 3, dead ? "#16150f" : "#2a2a24");
      if (t.state === "burning") for (let k = 0; k < 8; k++) px(8 + k * 4, 6 + ((k * 5) % 10), 3, 3, k % 2 ? "#ff9a2a" : "#ffe070");
    }
  }
  $("followbtn").addEventListener("click", () => {
    follow = !follow;
  });
}

function renderInspector(): void {
  const el = $("inspector");
  const s = world.maybe(selected);
  if (!s) {
    el.innerHTML = `<p class="hint">Click a soldier on the map or a name above. Squads show as coloured bars under their men; ${icon("pinned")} pinned, ! broken, ${icon("medic")} wounded, ${icon("flag")} surrendered.</p>`;
    return;
  }
  if (s.role === "tank" || s.role === "field_gun") {
    renderVehicleInspector(s);
    return;
  }
  const sq = world.squad(s.squadId);
  const spec = s.weapon ? world.config.weapons[s.weapon] : null;
  const ammo = spec ? `${spec.name}: ${s.loaded} loaded, ${s.ammo} spare${s.teamAmmo ? `, ${s.teamAmmo} for the ${s.side === "us" ? "BAR" : "MG"}` : ""}` : "unarmed";
  const kit = [s.grenades ? `${s.grenades} grenade${s.grenades > 1 ? "s" : ""}` : "", s.smokes ? `${s.smokes} smoke` : "", s.rifleGrenades ? `${s.rifleGrenades} rifle grenades` : ""].filter(Boolean).join(", ");
  const after = world.aftermath?.[s.id];
  const bleeding = bleedingOf(s);
  el.innerHTML = `
    <div class="pp-head"><canvas id="face" class="face"></canvas><div><b>${esc(s.name)}</b><small>${esc(s.rank)} · ${esc(roleName(s))}</small><small><em class="sw" style="background:${sq.color}"></em>${esc(sq.name)}${sq.leaderId === s.id ? " (leading)" : ""}</small><small>${esc(traitWords(s))}</small></div></div>
    <div class="doing">${esc(doingText(s))}</div>
    ${bar("Health", s.survival.health, s.survival.health > 0.5 ? "#7ac860" : s.survival.health > 0.25 ? "#e0a03a" : "#e05a4a")}
    ${bar("Morale", s.morale, "#6ab0f0")}
    ${bar("Suppressed", s.suppression, "#f0963a")}
    ${bar("Pain", fightingPain(s), "#e07a9a", s.morphineTick >= 0 ? "morphine" : "")}
    ${bar("Fatigue", s.fatigue, "#c8b060", s.fatigue >= world.config.fatigue.winded ? "winded" : "")}
    ${bleeding > 0 ? bar("Bleeding", Math.min(1, bleeding), "#c01818") : ""}
    <div class="traits">${esc(ammo)}${kit ? ` · ${esc(kit)}` : ""} · aim ${Math.round(aimFactor(s) * 100)}%</div>
    <div class="traits">${esc(whereText(s))}</div>
    <div class="pp-mid"><canvas id="bodydiag" class="bodydiag"></canvas><div class="desc">${describeBody(s)}</div></div>
    ${after ? `<h4>A MONTH LATER</h4><p>${esc(after.outcome)}.</p>` : ""}
    <div class="traits">${s.shots} rounds fired · ${s.hits} hits · ${s.kills} killed${s.treated ? ` · ${s.treated} men treated` : ""}</div>
    <h4>RECENTLY</h4><ul class="plain">${s.recent.slice(-8).reverse().map((r) => `<li><time>${clock(world, r.tick)}</time> ${esc(r.text)}</li>`).join("")}</ul>
    <button id="followbtn" style="margin-top:6px">${follow ? "◉ Following" : "○ Follow (F)"}</button>`;
  paintPanel(s);
  $("followbtn").addEventListener("click", () => {
    follow = !follow;
  });
}

const STATE_NAMES: Record<string, string> = { ambush: "in ambush", reinforce: "reinforcing", displace: "displacing", deploy: "forming up", advance: "advancing", react: "contact", fix: "fixing", flank: "flanking", assault: "assault", consolidate: "consolidating", hold: "holding", fall_back: "falling back", withdraw: "withdrawing", broken: "broken", support: "support" };

function renderSquads(): void {
  const out: string[] = [];
  for (const side of [world.attacker, world.attacker === "us" ? "de" : "us"] as Side[]) {
    const pl = world.platoons[side];
    out.push(`<div class="side-h" style="color:${SIDE_COLORS[side].name}">${esc(pl.name.toUpperCase())} — ${pl.role === "attack" ? "ATTACKING" : "DEFENDING"}</div>`);
    for (const id of [...pl.squadIds, pl.hqSquadId]) {
      const sq = world.squad(id);
      const leader = world.maybe(sq.leaderId);
      const men = sq.members.map((m) => world.soldier(m));
      const able = men.filter((m) => world.able(m)).length;
      const teams = sq.isHQ
        ? ""
        : (["A", "B"] as const)
            .map((el) => {
              const o = sq.orders[el];
              const n = men.filter((m) => m.element === el && world.able(m)).length;
              return `<div class="men">${el === "A" ? (side === "us" ? "Base team (BAR)" : "MG-Trupp") : side === "us" ? "Rifle team" : "Schützentrupp"}: ${o.kind}${o.kind === "suppress" ? "ing" : ""}, ${o.pace}, fire ${o.fire} · ${n} men</div>`;
            })
            .join("");
      out.push(`<div class="squad" data-squad="${sq.id}"><em class="sw" style="background:${sq.color}"></em><b>${esc(sq.name)}</b><span class="st">${STATE_NAMES[sq.state] ?? sq.state}</span>
        <div class="intent">${esc(sq.intent)}</div>
        <div class="men">Led by ${leader ? personLink(leader) : "nobody"} · ${able}/${men.length} able · ${Object.values(sq.contacts).filter((c) => !c.down && world.tick - c.tick < 40).length} known enemies</div>${teams}
        <div class="men">${men.map((m) => `<a data-person="${m.id}" title="${esc(roleName(m))}">${esc(m.last)}${statusIcon(m)}</a>`).join(" ")}</div></div>`);
    }
  }
  const html = out.join("");
  const el = $("squads");
  if (el.innerHTML !== html) el.innerHTML = html;
}

function select(id: number | null): void {
  selected = id;
  if (id !== null && tab !== "men") setTab("men");
  renderRoster();
  renderInspector();
}

// ---------- Tap card (touch) and end-of-battle prompt ----------

let quickId: number | null = null;

function hideQuick(): void {
  quickId = null;
  $("quick").classList.remove("open");
}

function renderQuick(): void {
  const el = $("quick");
  const s = world.maybe(quickId);
  if (!s) {
    hideQuick();
    return;
  }
  const sq = world.squad(s.squadId);
  const t = world.tanks.get(s.id);
  let body: string;
  if (t) {
    const crew = t.crew.map((id) => world.soldier(id));
    const alive = crew.filter((c) => c.status !== "dead").length;
    body = `<b>${esc(t.name)}</b><small>${t.kind === "field_gun" ? "Anti-tank gun" : "Tank"} · ${esc(sq.name)}</small>
      <div class="doing">${esc(t.state === "ready" ? "In action" : t.state)}</div>
      ${bar("Crew", alive / Math.max(1, crew.length), alive === crew.length ? "#7ac860" : "#e0a03a", `${alive}/${crew.length}`)}`;
  } else {
    body = `<b>${esc(s.name)}</b><small>${esc(s.rank)} · ${esc(roleName(s))} · <em class="sw" style="background:${sq.color}"></em>${esc(sq.name)}</small>
      <div class="doing">${esc(doingText(s))}</div>
      ${bar("Health", s.survival.health, s.survival.health > 0.5 ? "#7ac860" : s.survival.health > 0.25 ? "#e0a03a" : "#e05a4a")}
      ${bar("Morale", s.morale, "#6ab0f0")}`;
  }
  el.innerHTML = `${body}<div class="qbtns"><button id="qmore">Full info</button><button id="qclose">Close</button></div>`;
  el.classList.add("open");
  $("qclose").addEventListener("click", hideQuick);
  $("qmore").addEventListener("click", () => {
    const id = quickId;
    hideQuick();
    // The full inspector lives in the side panel, which the simple screen (or a hidden panel) leaves out.
    if (simpleUi) setSimple(false);
    if (!isPhone() && document.body.classList.contains("side-hidden")) setSide(false);
    select(id);
    document.querySelector("aside")?.scrollIntoView({ behavior: "smooth" });
  });
}
setInterval(() => {
  if (quickId !== null) renderQuick();
}, 1000);

function setTab(name: string): void {
  tab = name;
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.classList.toggle("show", t.id === name));
  if (name === "events") {
    renderEvents();
    dirty.events = false;
  }
  if (name === "squads") renderSquads();
}

// ---------- The after-action report ----------

function openModal(title: string, html: string): void {
  $("mnew").style.display = "none";
  $("mtitle").textContent = title;
  $("mbody").innerHTML = html;
  $("modal").classList.add("open");
}

function openReport(): void {
  const r = world.result;
  const v = verdict(world);
  const blood = firstBlood(world, roleName);
  const head = r
    ? `<div class="verdict">${r.winner === null ? "No decision" : r.winner === "us" ? "American victory" : "German victory"} · ${esc(v.label)}${r.winner === null ? "" : ` <small>(${v.score}/100)</small>`}</div><p>${esc(r.reason[0]!.toUpperCase() + r.reason.slice(1))}, at ${clock(world, r.tick)} after ${Math.round(r.tick / 60)} minutes of fighting.</p><p>${esc(v.summary)}</p>`
    : `<p class="hint">The battle is still going on (${world.clock()}). This is how it stands.</p>`;
  const firstFall = blood ? `<h3>First to fall</h3><p>${esc(blood.text)}</p>` : "";
  const rows = (["us", "de"] as Side[]).map((side) => {
    const all = world.men(side);
    const c = (f: (s: Soldier) => boolean) => all.filter(f).length;
    const shots = all.reduce((a, s) => a + s.shots, 0), hits = all.reduce((a, s) => a + s.hits, 0);
    return `<tr><td style="color:${SIDE_COLORS[side].name}">${esc(world.platoons[side].name)}</td><td>${all.length}</td><td>${c((s) => s.status === "dead")}</td><td>${c((s) => s.status !== "dead" && s.injuries.some((i) => !i.permanent && i.severity >= 0.1))}</td><td>${c((s) => s.status === "captured" || s.status === "surrendered")}</td><td>${c((s) => s.status === "routed")}</td><td>${shots} / ${hits}</td></tr>`;
  });
  const fallen = world.soldiers.filter((s) => s.status === "dead").sort((a, b) => (a.deathTick ?? 0) - (b.deathTick ?? 0));
  const hurt = world.soldiers.filter((s) => s.status !== "dead" && s.injuries.some((i) => !i.permanent && i.severity >= 0.1));
  const deeds: string[] = [];
  const topKiller = [...world.soldiers].sort((a, b) => b.kills - a.kills || b.hits - a.hits)[0];
  if (topKiller && topKiller.kills > 0) deeds.push(`${personLink(topKiller)} (${esc(roleName(topKiller))}) killed ${topKiller.kills}.`);
  for (const m of world.soldiers.filter((s) => s.role === "medic")) deeds.push(`${personLink(m)}, ${esc(roleName(m))}, treated ${m.treated} men${m.status === "dead" ? " before he was killed" : ""}.`);
  const gun = world.soldiers.filter((s) => s.weapon === "mg42" || s.role === "machine_gunner").sort((a, b) => b.shots - a.shots)[0];
  if (gun && gun.shots > 0) deeds.push(`${personLink(gun)} fired ${gun.shots} rounds from the MG 42.`);
  const stateText: Record<string, string> = { ready: "still in action", tracked: "immobilised by a broken track", burning: "burning", abandoned: "abandoned by its crew", wrecked: "knocked out" };
  const armour = [...world.tanks.values()].map((t) => {
    const crew = t.crew.map((id) => world.soldier(id));
    const dead = crew.filter((c) => c.status === "dead").length;
    const hurt = crew.filter((c) => c.status !== "dead" && c.injuries.some((i) => i.severity >= 0.1)).length;
    return `<li><span style="color:${SIDE_COLORS[t.side].name}">${esc(t.side === "us" ? "American" : "German")} ${esc(t.name)}</span>: ${stateText[t.state] ?? t.state}; ${t.kind === "tank" ? `${t.shells} shells left; ` : ""}crew of ${crew.length}: ${dead} killed, ${hurt} wounded${t.stuckCount > 0 ? `; bogged down ${t.stuckCount} time${t.stuckCount > 1 ? "s" : ""}` : ""}.</li>`;
  });
  const after = world.aftermath ?? {};
  const seedNow = Number($<HTMLInputElement>("seed").value) || 1;
  const nextDaily = dailySeed();
  const share = r
    ? `<div class="after"><button id="sharebtn" class="primary"><i data-icon="report"></i> Share this result</button><button id="againbtn" class="primary alt"><i data-icon="dice"></i> Play another battle</button>${nextDaily !== seedNow ? `<button id="dailybtn" data-seed="${nextDaily}">Today's battle</button>` : ""}<button id="replaybtn" data-seed="${seedNow}">Replay this one</button></div><p id="sharemsg" class="hint"></p>`
    : "";
  const html = `${head}${share}
    <table class="aar"><tr><th></th><th>men</th><th>killed</th><th>wounded</th><th>prisoners</th><th>left field</th><th>rounds / hits</th></tr>${rows.join("")}</table>
    ${firstFall}
    ${armour.length ? `<h3>Armour</h3><ul class="plain">${armour.join("")}</ul>` : ""}
    ${deeds.length ? `<h3>Notable</h3><p>${deeds.join("<br>")}</p>` : ""}
    <h3>The fallen</h3>
    <ul class="plain">${fallen.map((s) => `<li class="l-death"><time>${clock(world, s.deathTick ?? 0)}</time> ${personLink(s)}, ${esc(roleName(s))} of ${esc(world.squad(s.squadId).name)}, ${s.age}, ${esc(s.hometown)} — ${s.causeOfDeath === "wounds" ? "died of wounds" : "killed"}${worstWound(s) || s.injuries.length ? `: ${esc(describeInjury(s.injuries.slice().sort((a, b) => b.severity - a.severity)[0]!))}` : ""}</li>`).join("") || "<li>None.</li>"}</ul>
    <h3>The wounded, and a month later</h3>
    <ul class="plain">${hurt.map((s) => `<li class="l-wound">${personLink(s)} (${esc(world.squad(s.squadId).name)}): ${s.injuries.filter((i) => !i.permanent && i.severity >= 0.1).map((i) => esc(describeInjury(i))).join("; ")}${after[s.id] ? ` — <i>${esc(after[s.id]!.outcome)}</i>` : ""}</li>`).join("") || "<li>None.</li>"}</ul>`;
  openModal(`After-action report · ${world.config.time.date}`, html);
  hydrateIcons($("mbody"));
  $("mnew").style.display = r ? "" : "none";
}

// ---------- Input ----------

function setPower(p: typeof power): void {
  power = p;
  canvas.className = p === "inspect" ? "" : `power-${p}`;
  document.querySelectorAll<HTMLButtonElement>("[data-power]").forEach((b) => b.classList.toggle("on", b.dataset.power === p));
}

function pickAt(sx: number, sy: number): number | null {
  let best: number | null = null, bd = Math.max(22, 10 * cam.zoom);
  for (const s of world.soldiers) {
    if (s.status === "routed" || s.carriedById !== null) continue;
    const p = renderer.screenOf(s, cam, prev);
    const d = Math.hypot(p.x - sx, p.y - 2 * cam.zoom - sy) + (s.status === "dead" ? 6 : 0);
    if (d < bd) {
      bd = d;
      best = s.id;
    }
  }
  return best;
}

let dragging = false, dragMoved = false, dragX = 0, dragY = 0;
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
    runnerFollow = null;
    scopeTour = null;
    follow = false;
    userCamera = true;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  hover = { sx: ev.clientX - rect.left, sy: ev.clientY - rect.top };
  const tx = Math.floor(((ev.clientX - rect.left) / cam.zoom + cam.x) / TILE), ty = Math.floor(((ev.clientY - rect.top) / cam.zoom + cam.y) / TILE);
  renderer.hoverBuilding = world.map.inBounds(tx, ty) ? world.map.building[world.map.idx(tx, ty)]! : -1;
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
  const tx = Math.floor((sx / cam.zoom + cam.x) / TILE), ty = Math.floor((sy / cam.zoom + cam.y) / TILE);
  // A runner: click him to run along with him.
  for (const r of world.runners) {
    const rx = r.x * TILE + 8, ry = r.y * TILE + 8;
    const px = (rx - cam.x) * cam.zoom, py = (ry - cam.y) * cam.zoom;
    if (Math.hypot(px - sx, py - 4 * cam.zoom - sy) <= Math.max(18, 10 * cam.zoom)) {
      runnerFollow = { squad: r.squadId, lastMark: 0 };
      scopeTour = null;
      follow = false;
      userCamera = true;
      zoomGoal = null;
      return;
    }
  }
  // A sniper's scope: ride the line of sight to whoever he is watching.
  const scope = renderer.scopeAt(sx, sy);
  if (scope) {
    const a = world.maybe(scope.sniper), b = world.maybe(scope.target);
    if (a && b) {
      scopeTour = { sniper: scope.sniper, target: scope.target, t0: now() };
      runnerFollow = null;
      follow = false;
      userCamera = true;
      zoomGoal = null;
      renderer.addEffect({ kind: "signal", x0: a.x * TILE + 8, y0: a.y * TILE + 6, x1: b.x * TILE + 8, y1: b.y * TILE + 6, born: now(), dur: 1.6, delay: 0, color: "#ff6a5a" });
    }
    return;
  }
  // The floor button by a house: show the next floor up.
  const house = renderer.buttonAt(sx, sy);
  if (house >= 0) {
    renderer.cycleFloor(world, house);
    return;
  }
  if (power === "artillery" || power === "smoke") {
    if (world.map.inBounds(tx, ty)) {
      engine.intervene({ kind: power, x: tx, y: ty });
      track(power === "artillery" ? "barrage" : power, { via: "map" });
      trackFirstInteraction(power);
    }
    setPower("inspect");
    if (paused && !busy) void advance(1);
    return;
  }
  const hit = pickAt(sx, sy);
  if (power === "sniper") {
    if (hit !== null) {
      engine.intervene({ kind: "sniper", personId: hit });
      select(hit);
    }
    setPower("inspect");
    if (paused && !busy) void advance(1);
    return;
  }
  // A click on a house itself (not a man): step through its floors, same as the button.
  if (hit === null && world.map.inBounds(tx, ty)) {
    const b = world.map.building[world.map.idx(tx, ty)]!;
    if (b >= 0) {
      renderer.cycleFloor(world, b);
      return;
    }
  }
  // A finger tap: a little card with just that unit, not the whole inspector.
  // With no side panel on screen (touch, the simple screen, or a panel the player has hidden) there is
  // nowhere else to show him, so he gets the card.
  if ((ev.pointerType === "touch" || simpleUi || document.body.classList.contains("side-hidden")) && hit !== null) {
    selected = hit;
    quickId = hit;
    renderQuick();
    return;
  }
  hideQuick();
  select(hit);
});
canvas.addEventListener("pointercancel", (ev) => {
  dragging = false;
  touches.delete(ev.pointerId);
  if (touches.size < 2) pinch = null;
});
canvas.addEventListener("pointerleave", () => {
  renderer.hoverBuilding = -1;
  hover = null;
});
canvas.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? rect.height : 1);
    const from = zoomGoal?.zoom ?? cam.zoom;
    zoomToward(from * Math.exp(-Math.max(-250, Math.min(250, px)) * 0.002), ev.clientX - rect.left, ev.clientY - rect.top);
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

function zoomToward(zoom: number, sx: number, sy: number): void {
  zoomGoal = { zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)), sx, sy };
  userCamera = true;
}

function easeZoom(dt: number): void {
  if (!zoomGoal) return;
  const { sx, sy } = zoomGoal;
  // The world point under the cursor stays put while the zoom eases in.
  const wx = sx / cam.zoom + cam.x, wy = sy / cam.zoom + cam.y;
  cam.zoom += (zoomGoal.zoom - cam.zoom) * (1 - Math.exp(-dt * 40));
  if (Math.abs(cam.zoom - zoomGoal.zoom) < 0.002) {
    cam.zoom = zoomGoal.zoom;
    zoomGoal = null;
  }
  cam.x = wx - sx / cam.zoom;
  cam.y = wy - sy / cam.zoom;
}

const keys = new Set<string>();
window.addEventListener("keydown", (ev) => {
  if ((ev.target as HTMLElement).tagName === "INPUT") return;
  const k = ev.key.toLowerCase();
  keys.add(k);
  if (k === " ") {
    paused = !paused;
    syncControls();
    ev.preventDefault();
  } else if (k >= "1" && k <= "6") setSpeed(Number(k) - 1);
  else if (k === "r") toggle("roofs");
  else if (k === "n") toggle("names");
  else if (k === "o") toggle("orders");
  else if (k === "v") toggle("sight");
  else if (k === "c") toggle("chronicle");
  else if (k === "b") openModal("Battle log", `<ul class="plain">${feedHtml(feed)}</ul>`);
  else if (k === "f") follow = !follow;
  else if (k === "m") {
    sfx.setEnabled(!sfx.enabled);
    syncSound();
  } else if (k === "h") setSide(!document.body.classList.contains("side-hidden"));
  else if (k === "x") setPower(power === "artillery" ? "inspect" : "artillery");
  else if (k === "z") setPower(power === "smoke" ? "inspect" : "smoke");
  else if (k === "k") setPower(power === "sniper" ? "inspect" : "sniper");
  else if (k === "i") setPower("inspect");
  else if (k === "escape") {
    $("modal").classList.remove("open");
    setPower("inspect");
  }
});
window.addEventListener("keyup", (ev) => keys.delete(ev.key.toLowerCase()));

function panCamera(dt: number): void {
  const v = (keys.has("shift") ? 2500 : 1100) * dt / cam.zoom;
  let moved = false;
  if (keys.has("w") || keys.has("arrowup")) { cam.y -= v; moved = true; }
  if (keys.has("s") || keys.has("arrowdown")) { cam.y += v; moved = true; }
  if (keys.has("a") || keys.has("arrowleft")) { cam.x -= v; moved = true; }
  if (keys.has("d") || keys.has("arrowright")) { cam.x += v; moved = true; }
  if (keys.has("q") || keys.has("e")) {
    const rect = canvas.getBoundingClientRect();
    zoomToward(cam.zoom * Math.exp((keys.has("e") ? 1 : -1) * dt * 2.4), rect.width / 2, rect.height / 2);
  }
  if (moved) {
    follow = false;
    userCamera = true;
  }
}

function toggle(name: keyof ViewOptions): void {
  opts[name] = !opts[name];
  syncControls();
  if (name === "chronicle") renderFeed();
}

function setSpeed(i: number): void {
  track("speed", { to: SPEEDS[i]!.label });
  trackFirstInteraction("speed");
  speed = i;
  paused = false;
  syncControls();
}

/** Bring a squad into view: the middle of its men still in the fight, or of all of them if none are. */
function lookAtSquad(id: number): void {
  const sq = world.squads[id];
  if (!sq) return;
  const all = sq.members.map((m) => world.soldier(m));
  const able = all.filter((m) => world.onField(m) && m.status === "active");
  const men = able.length > 0 ? able : all.filter((m) => world.onField(m));
  if (men.length === 0) return;
  const x = men.reduce((a, m) => a + m.x, 0) / men.length, y = men.reduce((a, m) => a + m.y, 0) / men.length;
  const rect = canvas.getBoundingClientRect();
  cam.x = (x + 0.5) * TILE - rect.width / cam.zoom / 2;
  cam.y = (y + 0.5) * TILE - rect.height / cam.zoom / 2;
  userCamera = true;
  follow = false;
  // A marker over each man for a moment, so the eye finds them.
  const t = now();
  for (const m of men) renderer.addEffect({ kind: "text", x: m.x * TILE + 8, y: m.y * TILE - 6, text: "▼", color: sq.color, born: t, dur: 1.6, delay: 0, follow: m.id });
}

function syncControls(): void {
  $("pause").innerHTML = icon(paused ? "play" : "pause");
  $("speeds").innerHTML = SPEEDS.map((s, i) => `<button data-speed="${i}" class="${i === speed ? "on" : ""}">${s.label}</button>`).join("");
  document.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((b) => b.classList.toggle("on", opts[b.dataset.toggle as keyof ViewOptions]));
}

let lastPersonPress = 0;
function openPerson(id: number): void {
  select(id);
  const s = world.maybe(id);
  if (s) {
    const rect = canvas.getBoundingClientRect();
    cam.x = s.x * TILE - rect.width / cam.zoom / 2;
    cam.y = s.y * TILE - rect.height / cam.zoom / 2;
    userCamera = true;
    runnerFollow = null;
  }
  // The inspector may be below the fold on a phone.
  $("inspector").scrollIntoView({ block: "nearest" });
}
// The roster is redrawn as the battle goes on, which can swallow a click: act on the press instead.
document.addEventListener("pointerdown", (ev) => {
  const a = (ev.target as HTMLElement).closest<HTMLElement>("#roster [data-person]");
  if (!a) return;
  lastPersonPress = performance.now();
  openPerson(Number(a.dataset.person));
});
document.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const person = t.closest<HTMLElement>("[data-person]");
  if (person) {
    ev.preventDefault();
    if (performance.now() - lastPersonPress < 600 && person.closest("#roster")) return;
    const id = Number(person.dataset.person);
    select(id);
    const s = world.maybe(id);
    if (s) {
      const rect = canvas.getBoundingClientRect();
      cam.x = s.x * TILE - rect.width / cam.zoom / 2;
      cam.y = s.y * TILE - rect.height / cam.zoom / 2;
      userCamera = true;
    }
    if (t.closest("#modal")) $("modal").classList.remove("open");
    return;
  }
  const run = t.closest<HTMLElement>("[data-runner]");
  if (run) {
    const id = Number(run.dataset.runner);
    if (runnerOf(id)) {
      runnerFollow = { squad: id, lastMark: 0 };
      follow = false;
      userCamera = true;
      zoomGoal = null;
    }
    return;
  }
  const tap = t.closest<HTMLElement>(".toast[data-focus], .toast[data-at]");
  if (tap && !tap.dataset.squad) {
    if (tap.dataset.focus) return openPerson(Number(tap.dataset.focus));
    const [x, y] = tap.dataset.at!.split(",").map(Number) as [number, number];
    const rect = canvas.getBoundingClientRect();
    cam.x = x * TILE + TILE / 2 - rect.width / cam.zoom / 2;
    cam.y = y * TILE + TILE / 2 - rect.height / cam.zoom / 2;
    userCamera = true;
    follow = false;
    return;
  }
  const alert = t.closest<HTMLElement>("[data-squad]");
  if (alert) return lookAtSquad(Number(alert.dataset.squad));
  const sp = t.closest<HTMLElement>("[data-speed]");
  if (sp) return setSpeed(Number(sp.dataset.speed));
  const tg = t.closest<HTMLElement>("[data-toggle]");
  if (tg) return toggle(tg.dataset.toggle as keyof ViewOptions);
  const pw = t.closest<HTMLElement>("[data-power]");
  if (pw) return setPower(pw.dataset.power as typeof power);
  const tb = t.closest<HTMLElement>("[data-tab]");
  if (tb) return setTab(tb.dataset.tab!);
  const sq = t.closest<HTMLElement>("[data-squad]");
  if (sq) {
    const squad: Squad = world.squad(Number(sq.dataset.squad));
    const men = squad.members.map((id) => world.soldier(id)).filter((m) => world.onField(m));
    if (men.length) {
      const rect = canvas.getBoundingClientRect();
      cam.x = (men.reduce((a, m) => a + m.x, 0) / men.length) * TILE - rect.width / cam.zoom / 2;
      cam.y = (men.reduce((a, m) => a + m.y, 0) / men.length) * TILE - rect.height / cam.zoom / 2;
      userCamera = true;
      follow = false;
    }
  }
});

const SIDE_KEY = "squad.side";
const isPhone = (): boolean => window.matchMedia("(max-width: 900px)").matches;
/** On a phone the toggle reads as + (open the info panel) or − (close it); elsewhere it is the panel icon. */
function syncSideIcon(): void {
  const hidden = document.body.classList.contains("side-hidden");
  $("sidetoggle").innerHTML = icon(isPhone() ? (hidden ? "plus" : "minus") : "panel");
}
function setSide(hidden: boolean): void {
  document.body.classList.toggle("side-hidden", hidden);
  syncSideIcon();
  // On a phone the panel always starts closed, so there is nothing to remember.
  if (!isPhone()) {
    try {
      localStorage.setItem(SIDE_KEY, hidden ? "0" : "1");
    } catch {
      // Not important.
    }
  }
  // The battlefield is wider now, or narrower.
  window.dispatchEvent(new Event("resize"));
}
try {
  if (isPhone() || localStorage.getItem(SIDE_KEY) === "0") document.body.classList.add("side-hidden");
} catch {
  // Not important.
}
$("sidetoggle").addEventListener("click", () => setSide(!document.body.classList.contains("side-hidden")));

function syncSound(): void {
  const b = $("sound");
  b.innerHTML = icon(!sfx.enabled || sfx.volume === 0 ? "mute" : "sound");
  b.classList.toggle("on", sfx.enabled);
  $<HTMLInputElement>("vol").value = String(Math.round(sfx.volume * 100));
}
let started = false;
// iOS only counts touchend and click as audio-unlocking gestures (not pointerdown), and drops audio when the tab is hidden.
for (const ev of ["pointerdown", "touchend", "click", "keydown"] as const) window.addEventListener(ev, () => started && sfx.unlock(), { capture: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && started) sfx.unlock();
});
// Any input of the player's own takes the camera back from a followed message.
window.addEventListener("pointerdown", (ev) => {
  if (cine && !(ev.target as HTMLElement).closest(".bolt")) endCine(true);
}, { capture: true });
window.addEventListener("wheel", () => {
  if (cine) endCine(true);
}, { capture: true, passive: true });
window.addEventListener("keydown", (ev) => {
  if (cine && ev.key.toLowerCase() !== "m") endCine(true);
}, { capture: true });
$("sound").addEventListener("click", () => {
  // Sound is switched on but the browser has not let it start yet (the "tap for sound" prompt): this tap is the unlock, not a mute.
  const pending = sfx.enabled && !sfx.running;
  sfx.unlock();
  if (!pending) sfx.setEnabled(!sfx.enabled);
  syncSound();
});
$<HTMLInputElement>("vol").addEventListener("input", (ev) => {
  sfx.unlock();
  sfx.setVolume(Number((ev.target as HTMLInputElement).value) / 100);
  if (!sfx.enabled) sfx.setEnabled(true);
  syncSound();
});
hydrateIcons();
syncSideIcon();
window.matchMedia("(max-width: 900px)").addEventListener("change", syncSideIcon);
syncSound();

$("pause").addEventListener("click", () => {
  paused = !paused;
  syncControls();
});
$("step").addEventListener("click", () => {
  paused = true;
  syncControls();
  if (!busy) void advance(10);
});
$("book").addEventListener("click", () => openModal("Battle log", `<ul class="plain">${feedHtml(feed)}</ul>`));
$("reportbtn").addEventListener("click", () => openReport());
$("mclose").addEventListener("click", () => $("modal").classList.remove("open"));
$("mnew").addEventListener("click", () => {
  $("modal").classList.remove("open");
  $("random").click();
});
$("modal").addEventListener("click", (ev) => {
  if (ev.target === $("modal")) $("modal").classList.remove("open");
});
$<HTMLFormElement>("seedform").addEventListener("submit", (ev) => {
  ev.preventDefault();
  requestNewBattle(Number($<HTMLInputElement>("seed").value) || 1);
});
$("random").addEventListener("click", () => {
  const seed = 1 + Math.floor(Math.random() * 99999);
  $<HTMLInputElement>("seed").value = String(seed);
  requestNewBattle(seed);
});

/** The first battle opens cinematic; after that the player chooses how to watch, and can turn the lot off. */
let pendingSeed = 1;
function requestNewBattle(seed: number): void {
  $("modal").classList.remove("open");
  if (battlesRun === 0) return newBattle(seed, { cinematic: cinematicPref() });
  if (!cinematicPref()) return newBattle(seed, { cinematic: false });
  pendingSeed = seed;
  const box = $("nextmodal");
  box.innerHTML = `<div class="box"><h2>Next battle <small>seed ${seed}</small></h2>
    <button class="big" data-go="cine"><b>Jump to the action</b><small>Skips the march up. The camera follows the fighting and the screen stays simple.</small></button>
    <button class="big" data-go="start"><b>Watch from the start</b><small>Your own camera and all the controls, from the first minute.</small></button>
    <label><input type="checkbox" id="cinoff"> Turn cinematic features off for good</label>
    <p class="hint">Auto camera, simple screen and skipping the march. The Auto-cam button brings them back.</p></div>`;
  box.classList.add("open");
}
$("nextmodal").addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const go = t.closest<HTMLElement>("[data-go]")?.dataset.go;
  if (!go) {
    if (t === $("nextmodal")) $("nextmodal").classList.remove("open");
    return;
  }
  const off = $<HTMLInputElement>("cinoff").checked;
  if (off) setCinematicPref(false);
  $("nextmodal").classList.remove("open");
  track("watch_choice", { go, off });
  newBattle(pendingSeed, { cinematic: go === "cine" && !off });
});
$("cinebtn").addEventListener("click", () => {
  if (!cinematicPref()) setCinematicPref(true);
  setDirector(!director.on);
  track("auto_cam", { on: director.on });
});
$("morebtn").addEventListener("click", () => {
  setSimple(false);
  // Full control includes the panel with every man's details, unless a phone has no room for it.
  if (!isPhone() && document.body.classList.contains("side-hidden")) setSide(false);
  track("controls_opened", {});
});
$("hook").addEventListener("click", () => callBarrageFromView());
$("skipbtn").addEventListener("click", () => void skipToResult());
$("ffstop").addEventListener("click", () => {
  skipCancel = true;
});
$("mbody").addEventListener("click", async (ev) => {
  const t = ev.target as HTMLElement;
  if (t.closest("#againbtn")) {
    track("play_again", { from: "report" });
    $("modal").classList.remove("open");
    $("random").click();
    return;
  }
  const go = t.closest<HTMLElement>("#dailybtn, #replaybtn");
  if (go) {
    track(go.id === "dailybtn" ? "daily_from_report" : "replay_from_report", {});
    $("modal").classList.remove("open");
    const seed = Number(go.dataset.seed) || 1;
    $<HTMLInputElement>("seed").value = String(seed);
    requestNewBattle(seed);
    return;
  }
  if (!t.closest("#sharebtn") || !world.result) return;
  const r = world.result, v = verdict(world);
  const side = (sd: Side) => {
    const all = world.men(sd);
    return { name: world.platoons[sd].name, men: all.length, dead: all.filter((x) => x.status === "dead").length, wounded: all.filter((x) => x.status !== "dead" && x.injuries.some((i) => !i.permanent && i.severity >= 0.1)).length };
  };
  const seed = Number($<HTMLInputElement>("seed").value) || 1;
  const winner = r.winner === null ? "No decision" : r.winner === "us" ? "American victory" : "German victory";
  const res = await shareResult({
    seed,
    place: `${dailyBattle ? "Battle of the day · " : ""}${world.layout.name}, ${world.weather.label}`,
    headline: v.label.toLowerCase().includes("victory") ? `${winner.split(" ")[0]} ${v.label.toLowerCase()}` : `${winner}: ${v.label}`,
    detail: `${r.reason[0]!.toUpperCase() + r.reason.slice(1)}. ${v.summary}`,
    us: side("us"),
    de: side("de"),
    rounds: world.soldiers.reduce((a, x) => a + x.shots, 0),
    // Hosted elsewhere (an itch.io frame, say), the link a result points to is still the real site.
    url: /^(localhost|127\.0\.0\.1|sim\.shaykas\.com)$/.test(location.hostname) ? `${location.origin}${location.pathname}?seed=${seed}` : `https://sim.shaykas.com/squad/?seed=${seed}&utm_source=itch`,
  });
  const msg = document.getElementById("sharemsg");
  if (msg) msg.textContent = res === "shared" ? "Shared." : res === "saved" ? "Card saved and link copied." : "";
  track("share", { res });
});

const params = new URLSearchParams(location.search);
const startSeed = Number(params.get("seed")) || FEATURED_SEEDS[Math.floor(Math.random() * FEATURED_SEEDS.length)]!;
$<HTMLInputElement>("seed").value = String(startSeed);
started = true;
// Nothing waits behind a "click to start": the battle is already under way, muted until the first tap.
const wantCinematic = params.get("start") === "1" || params.get("cinematic") === "0" ? false : cinematicPref();
newBattle(startSeed, { cinematic: wantCinematic });
for (const ev of ["pointerdown", "keydown"] as const) window.addEventListener(ev, () => trackFirstInteraction(ev), { capture: true, once: true });
function savedSrc(): string | null {
  try {
    return sessionStorage.getItem("squad.src");
  } catch {
    return null;
  }
}
let refHost = "";
try {
  refHost = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : "";
} catch {
  // No usable referrer.
}
track("session_start", { daily: params.get("daily") === "1", seed: startSeed, cinematic: wantCinematic, phone: isPhone(), w: window.innerWidth, ref: refHost, src: params.get("utm_source") ?? savedSrc() ?? (/(^|\.)shaykas\.com$/.test(refHost) ? "" : refHost) });
startHeartbeat(() => ({ tick: world?.tick ?? 0, battle: battlesRun, cinematic, simple: simpleUi, over: world?.phase === "over" }));
requestAnimationFrame(frame);

// For the console: squad.advance(60) runs a minute.
(window as unknown as { squad: unknown }).squad = {
  advance,
  world: () => world,
  /** Looks at a tile at a zoom: squad.look(70, 50, 3). */
  look(x: number, y: number, zoom = 3) {
    const rect = canvas.getBoundingClientRect();
    cam.zoom = zoom;
    cam.x = x * TILE - rect.width / zoom / 2;
    cam.y = y * TILE - rect.height / zoom / 2;
    userCamera = true;
    follow = false;
  },
  select,
  director,
  cam,
  /** Where a man is on screen right now, for tests. */
  screenOf: (id: number) => renderer.screenOf(world.soldier(id), cam, prev),
  sfx,
  chains,
  /** Calls down the player's 105 mm barrage on a tile: squad.barrage(127, 90). */
  barrage: (x: number, y: number) => engine.intervene({ kind: "artillery", x, y }),
  startCine: (id: number) => {
    const c = chains.get(id);
    if (c) startCine(c);
  },
};
