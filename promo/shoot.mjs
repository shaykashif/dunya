// Frame-exact 60 fps capture: virtual clock stepped one frame at a time, audio rendered offline on the same timeline.
import { chromium } from "playwright-core";
import os from "node:os"; import path from "node:path"; import fs from "node:fs";
const seed = process.argv[2] ?? "15";
const DUR = Number(process.argv[3] ?? 48);
const FPS = 60;
const NOTEXT = process.env.NOTEXT === "1";
const out = path.resolve("out60_" + seed + (NOTEXT ? "_notext" : "")); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
const exe = path.join(os.homedir(), "AppData","Local","ms-playwright","chromium_headless_shell-1243","chrome-headless-shell-win64","chrome-headless-shell.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--enable-gpu-rasterization"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript((nt) => { window.__NOTEXT = nt; }, NOTEXT);
await ctx.addInitScript(() => {
  // The sound engine gets an offline context whose clock is the page's (virtual) clock.
  class FakeAC extends OfflineAudioContext {
    constructor() { super(2, 48000 * 75, 48000); window.__ac = this; }
    get currentTime() { return window.__base === undefined ? 0 : (performance.now() - window.__base) / 1000; }
  }
  window.AudioContext = FakeAC; window.webkitAudioContext = FakeAC;
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`http://localhost:5174/?seed=${seed}`);
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const st = document.createElement("style");
  st.textContent = "#help,#minimap,#gridref,aside,#bolts,#topbar,#powers,#chronicle{display:none!important}" + (window.__NOTEXT ? "#toasts{display:none!important}" : "");
  document.head.appendChild(st);
});
await page.mouse.click(900, 500);
await page.evaluate(() => { document.body.classList.add("side-hidden"); window.squad.sfx.setEnabled(false); });
// fast-forward to first firefight (real clock)
await page.evaluate(async () => {
  const w = window.squad.world();
  const all = () => [...w.soldiers.values ? w.soldiers.values() : w.soldiers].filter((m) => m.status !== "dead" && m.conscious !== false);
  const near = () => {
    const s = all(); const us = s.filter((m) => m.side === "us"), de = s.filter((m) => m.side !== "us");
    let best = 1e9;
    for (const a of us) for (const b of de) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < best) best = d; }
    return best;
  };
  for (let i = 0; i < 90 && near() > 22; i++) await window.squad.advance(10);
});
// director
await page.evaluate(() => {
  const w = window.squad.world();
  const all = () => [...w.soldiers.values ? w.soldiers.values() : w.soldiers].filter((m) => m.status !== "dead" && m.conscious !== false);
  const used = [];
  const inB = (m) => w.buildings.some((b) => !b.destroyed && m.x >= b.x && m.x < b.x + b.w && m.y >= b.y && m.y < b.y + b.h);
  window.__hot = (avoidUsed = true, outdoor = true, both = false, around = null) => {
    const OPEN = new Set(["grass", "wheat", "road", "rubble", "crater", "foxhole", "ditch", "bridge", "marsh"]);
    const isOpen = (m) => OPEN.has(w.map.at(Math.floor(m.x), Math.floor(m.y)));
    const s = all().filter((m) => !outdoor || (!inB(m) && isOpen(m))); const t = w.tick;
    const firing = s.filter((m) => t - m.lastFiredTick < 8 || t - m.lastHitTick < 8);
    let best = null;
    for (const m of firing) {
      if (avoidUsed && used.some((u) => Math.hypot(u.x - m.x, u.y - m.y) < 30)) continue;
      if (around && Math.hypot(around.x - m.x, around.y - m.y) > around.r) continue;
      const near = s.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) < 11);
      if (outdoor && near.length < 6) continue;
      const nus = near.filter((o) => o.side === "us").length, nde = near.length - nus;
      if (both && (nus < 2 || nde < 2)) continue;
      const sc = near.filter((o) => t - o.lastFiredTick < 8).length * 2 + near.filter((o) => t - o.lastHitTick < 12).length * 3 + near.length * 0.8;
      const score = sc * (nus > 1 && nde > 1 ? 1.6 : 1) + Math.min(nus, nde) * 2;
      if (!best || score > best.score) best = { score, x: near.reduce((q, o) => q + o.x, 0) / near.length, y: near.reduce((q, o) => q + o.y, 0) / near.length, near };
    }
    if (!best) return outdoor ? window.__hot(avoidUsed, false, both, around) : null;
    const de = best.near.filter((o) => o.side !== "us");
    const e = de.length ? de : best.near;
    best.ex = e.reduce((q, o) => q + o.x, 0) / e.length; best.ey = e.reduce((q, o) => q + o.y, 0) / e.length;
    return best;
  };
  // The closest pair of enemies anywhere: where the two sides really are in contact.
  window.__front = () => {
    const s = all(); const us = s.filter((m) => m.side === "us"), de = s.filter((m) => m.side !== "us");
    let best = null;
    for (const a of us) for (const b of de) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (!best || d < best.d) best = { d, a, b }; }
    return best && { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2, ex: best.b.x, ey: best.b.y, d: best.d, score: 1, near: [] };
  };
  window.__markUsed = (h) => { used.push({ x: h.x, y: h.y }); if (used.length > 3) used.shift(); };
  let c = null, tz = 2.0, z = 2.0, goal = null;
  let follow = true, fr = 0, goalFn = null, hold = false;
  window.__cut = (zoom, hot, keepFollow = false) => { const h = hot ?? window.__hot(); if (!h) return null; window.__markUsed(h); goal = h; c = { x: h.x, y: h.y }; tz = z = zoom; follow = keepFollow || !hot; hold = false; goalFn = null; return h; };
  // A camera move, never a cut: glide to a spot (held) or to whatever fight is busiest (followed).
  window.__pan = (zoom, spot) => { const h = spot ?? window.__hot(false); if (!h) return null; goal = { x: h.x, y: h.y }; if (!c) c = { x: h.x, y: h.y }; tz = zoom; follow = true; hold = !!spot; goalFn = null; return h; };
  const usedSquads = [];
  // Frames a squad in the named state: its men and the position they are working against, followed as they move.
  window.__squadShot = (states, zoom) => {
    let pick = null;
    for (const st of states) {
      const cands = w.squads.filter((q) => !q.isHQ && q.side === "us" && q.state === st && !usedSquads.includes(q.id));
      for (const q of cands) {
        const live = q.members.map((id) => w.maybe(id)).filter((m) => m && m.status !== "dead" && m.conscious !== false);
        if (live.length >= 4 && (!pick || live.length > pick.n)) pick = { q, n: live.length };
      }
      if (pick) break;
    }
    if (!pick) return false;
    usedSquads.push(pick.q.id);
    const q = pick.q;
    goalFn = () => {
      const live = q.members.map((id) => w.maybe(id)).filter((m) => m && m.status !== "dead" && m.conscious !== false);
      if (!live.length) return null;
      const mx = live.reduce((a, m) => a + m.x, 0) / live.length, my = live.reduce((a, m) => a + m.y, 0) / live.length;
      const f = q.focus ?? q.flankPoint;
      return f ? { x: (mx * 2 + f.x) / 3, y: (my * 2 + f.y) / 3 } : { x: mx, y: my };
    };
    const g = goalFn(); goal = g; c = { x: g.x, y: g.y }; tz = z = zoom; follow = true;
    return true;
  };
  window.__maxStep = 0.07;
  window.__notext = !!window.__NOTEXT;
  window.__zoom = (v) => { tz = v; };
  window.__camPos = () => (c ? { x: c.x, y: c.y } : null);
  const tick = () => {
    fr++;
    if (c && goal) {
      if (follow) {
        if (goalFn) { if (fr % 12 === 0) { const g = goalFn(); if (g) goal = g; } }
        else if (!hold && fr % 180 === 0) { const h = window.__hot(false); if (h && Math.hypot(h.x - c.x, h.y - c.y) < 30) goal = h; }
        const dx = goal.x - c.x, dy = goal.y - c.y, d = Math.hypot(dx, dy);
        if (d > 0.02) { const st = Math.min(d * 0.012, window.__maxStep); c.x += (dx / d) * st; c.y += (dy / d) * st; }
      }
      window.squad.look(c.x, c.y, z); z += (tz - z) * 0.015;
    }
    requestAnimationFrame(tick);
  };
  tick();
  // caption, end card and fades, all driven per frame rather than by CSS transitions
  const cap = document.createElement("div"); cap.id = "cap";
  cap.style.cssText = "position:fixed;left:0;right:0;top:46px;z-index:99997;text-align:center;font:64px 'Silkscreen',monospace;letter-spacing:3px;color:#ece6cc;text-shadow:0 5px 0 #000,0 0 18px #000;opacity:0;pointer-events:none";
  document.body.appendChild(cap);
  window.__cap = (t) => { cap.textContent = t; cap.style.opacity = t ? "1" : "0"; };
  const end = document.createElement("div");
  end.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:230px;z-index:99998;background:linear-gradient(transparent,rgba(12,14,8,.94) 60%);display:flex;flex-direction:column;justify-content:flex-end;padding:0 80px 50px;font-family:'Silkscreen',monospace;opacity:0;pointer-events:none";
  end.innerHTML = `<div style="font-size:78px;letter-spacing:3px;color:#ece6cc;text-shadow:0 5px 0 #000">BATTLE SIMULATION</div><div style="font:46px 'VT323',monospace;color:#e8c84a;margin-top:8px">Call in barrages. Watch every man fight. Free in your browser · sim.shaykas.com</div>`;
  document.body.appendChild(end);
  const fade = document.createElement("div");
  fade.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0c0e08;opacity:0;pointer-events:none";
  document.body.appendChild(fade);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  window.__fx = (t, dur) => {
    fade.style.opacity = String(clamp((t - (dur - 0.7)) / 0.7));
    end.style.opacity = window.__notext ? "0" : String(clamp((t - (dur - 3.6)) / 0.6));
    window.squad.sfx.voices = 0; // sources never "end" in an offline context
  };
  window.__fx(0, 99);
});
await page.keyboard.press("4");
// switch to virtual time (paused, so the clock jump costs no sim time)
await page.keyboard.press("Space");
await page.clock.install({ time: 1e12 });
await page.clock.pauseAt(1e12 + 10000);
await page.clock.fastForward(300000);          // virtual performance.now must pass the real value the viewer last saw
await page.clock.runFor(100);
await page.keyboard.press("Space");
await page.evaluate(() => { window.__base = performance.now(); window.squad.sfx.setEnabled(true); });
const cdp = await ctx.newCDPSession(page);
const key = (k) => page.keyboard.press(k);
const shotFn = (zoom, barrage, speedKey = "4") => async () => {
  await key(barrage ? "3" : speedKey);
  const h = await page.evaluate((zoom) => { const h = window.__cut(zoom); return h && { x: h.x, y: h.y, ex: h.ex, ey: h.ey }; }, zoom);
  if (h && barrage) await page.evaluate((h) => { const sq = window.squad; sq.barrage(h.ex, h.ey); setTimeout(() => sq.barrage(h.ex + 4, h.ey - 3), 1000); setTimeout(() => sq.barrage(h.ex - 4, h.ey + 3), 2000); }, h);
};
// Pan to the enemy position of the busiest fight and drop three volleys on it, so the impacts are in frame.
const barrageShot = (zoom) => async () => {
  await key("3");
  const r = await page.evaluate((zoom) => {
    const w = window.squad.world();
    const cam = window.__camPos();
    const h = cam ? window.__hot(false, true, false, { x: cam.x, y: cam.y, r: 26 }) : null;
    let t = null;
    if (h) t = { x: h.ex, y: h.ey };
    else if (cam) {
      const foes = [...w.soldiers.values ? w.soldiers.values() : w.soldiers].filter((m) => m.side !== "us" && m.status !== "dead" && m.conscious !== false);
      foes.sort((p, q) => Math.hypot(p.x - cam.x, p.y - cam.y) - Math.hypot(q.x - cam.x, q.y - cam.y));
      const lead = foes[0];
      if (lead && Math.hypot(lead.x - cam.x, lead.y - cam.y) < 24) {
        const pool = foes.filter((m) => Math.hypot(m.x - lead.x, m.y - lead.y) < 9);
        t = { x: pool.reduce((q, m) => q + m.x, 0) / pool.length, y: pool.reduce((q, m) => q + m.y, 0) / pool.length };
      } else t = { x: cam.x + 4, y: cam.y - 2 };
    }
    if (cam && t) { // keep the impact inside the picture
      const half = 1080 / (zoom * 16) / 2;
      t.x = cam.x + Math.max(-half * 1.5, Math.min(half * 1.5, t.x - cam.x));
      t.y = cam.y + Math.max(-half * 0.6, Math.min(half * 0.6, t.y - cam.y));
    }
    const ref = cam ?? t;
    window.__zoom(zoom);
    const sq = window.squad;
    sq.barrage(t.x, t.y);
    setTimeout(() => sq.barrage(t.x + 4, t.y - 3), 1000);
    setTimeout(() => sq.barrage(t.x - 4, t.y + 3), 2000);
    return { ...t, cam: ref, d: Math.hypot(t.x - ref.x, t.y - ref.y) };
  }, zoom);
  console.log("barrage at", JSON.stringify(r));
};
const panFn = (zoom, speedKey = "4") => async () => { await key(speedKey); await page.evaluate((z) => window.__zoom(z), zoom); };
const squadShot = (states, zoom, fb) => async () => { await key("4"); const ok = await page.evaluate(([st, z]) => window.__squadShot(st, z), [states, zoom]); if (!ok) await shotFn(fb, false)(); };
const cap = (t) => () => NOTEXT ? Promise.resolve() : page.evaluate((t) => window.__cap(t), t);
let houseTarget = null;
const events = [
  [0, async () => { await key("4"); await page.evaluate(() => { const h = window.__hot(false, true, false); return window.__cut(3.6, h, true); }); }],
  [0, cap("EVERY SOLDIER SIMULATED")],
  [3.3, cap("")],
  [9, barrageShot(3.4)],
  [9.3, cap("CALL IN A BARRAGE")],
  [14.5, cap("")],
  [15, panFn(3.8)],
  [16.5, cap("FLANK. PIN. ASSAULT.")],
  [22, cap("")],
  [23.4, async () => {
    await key("r"); await key("3");
    houseTarget = await page.evaluate(() => {
      const w = window.squad.world(); const hot = window.__camPos() ?? window.__hot(false);
      const bs = w.buildings.filter((b) => !b.destroyed && b.w * b.h >= 30 && b.kind !== "church");
      if (!bs.length) return null;
      const ref = hot ?? { x: 120, y: 100 };
      bs.sort((a, b) => Math.hypot(a.x + a.w / 2 - ref.x, a.y + a.h / 2 - ref.y) - Math.hypot(b.x + b.w / 2 - ref.x, b.y + b.h / 2 - ref.y));
      const t = bs[0]; const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      window.__pan(3.6, { x: cx, y: cy });
      return { cx, cy };
    });
  }],
  [24.0, async () => { if (houseTarget) await page.evaluate((h) => { window.squad.barrage(h.cx, h.cy); setTimeout(() => window.squad.barrage(h.cx + 2, h.cy), 900); }, houseTarget); }],
  [24.5, cap("HOUSES COME DOWN")],
  [30, cap("")],
  [30, () => key("r")],
  [30.5, panFn(3.2)],
  [33, barrageShot(3.2)],
  [40, panFn(3.6)],
  ...(NOTEXT ? [] : [
    [41, () => page.evaluate(() => document.getElementById("reportbtn").click())],
    [44.9, () => page.evaluate(() => document.getElementById("modal").classList.remove("open"))],
  ]),
].sort((a, b) => a[0] - b[0]);
const N = Math.round(DUR * FPS);
let ei = 0;
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  const t = f / FPS;
  while (ei < events.length && events[ei][0] <= t + 1e-6) { await events[ei][1](); ei++; }
  await page.evaluate(([t, d]) => window.__fx(t, d), [t, DUR]);
  const step = Math.round((f + 1) * 1000 / FPS) - Math.round(f * 1000 / FPS);
  await page.clock.runFor(step);
  const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 93 });
  fs.writeFileSync(path.join(out, `f${String(f).padStart(5, "0")}.jpg`), Buffer.from(shot.data, "base64"));
  if (f % 120 === 0) console.log("frame", f, "/", N, ((Date.now() - t0) / 1000).toFixed(0) + "s");
}
// render the audio
const b64 = await page.evaluate(async (dur) => {
  const buf = await window.__ac.startRendering();
  const n = Math.min(buf.length, Math.round((dur + 0.2) * buf.sampleRate));
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) { pcm[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767; pcm[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767; }
  const u8 = new Uint8Array(pcm.buffer); let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}, DUR);
fs.writeFileSync(path.join(out, "audio.pcm"), Buffer.from(b64, "base64"));
await browser.close();
console.log("done");
