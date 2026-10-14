// Frame-exact 60 fps capture: virtual clock stepped one frame at a time, audio rendered offline on the same timeline.
import { chromium } from "playwright-core";
import os from "node:os"; import path from "node:path"; import fs from "node:fs";
const seed = process.argv[2] ?? "15";
const DUR = Number(process.argv[3] ?? 42);
const FPS = 60;
const out = path.resolve("out60_" + seed); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
const exe = path.join(os.homedir(), "AppData","Local","ms-playwright","chromium_headless_shell-1243","chrome-headless-shell-win64","chrome-headless-shell.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--enable-gpu-rasterization"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
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
  const d = document.createElement("div"); d.id = "card";
  d.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none;background:#0c0e08;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Silkscreen',monospace;color:#ece6cc";
  d.innerHTML = `<div style="font-size:92px;letter-spacing:6px;text-shadow:0 6px 0 #000">BATTLE MODE</div><div style="font:44px 'VT323',monospace;color:#e8c84a;margin-top:14px">Normandy, June 1944 · every soldier simulated</div>`;
  document.body.appendChild(d);
  const st = document.createElement("style");
  st.textContent = "#help,#minimap,#gridref,aside,#bolts,#topbar,#powers,#chronicle{display:none!important}";
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
  window.__hot = (avoidUsed = true) => {
    const s = all(); const t = w.tick;
    const firing = s.filter((m) => t - m.lastFiredTick < 8 || t - m.lastHitTick < 8);
    let best = null;
    for (const m of firing) {
      if (avoidUsed && used.some((u) => Math.hypot(u.x - m.x, u.y - m.y) < 30)) continue;
      const near = s.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) < 14);
      const sc = near.filter((o) => t - o.lastFiredTick < 8).length * 2 + near.filter((o) => t - o.lastHitTick < 12).length * 3 + near.length * 0.3;
      const hasBoth = near.some((o) => o.side === "us") && near.some((o) => o.side !== "us");
      const score = sc * (hasBoth ? 1.5 : 1);
      if (!best || score > best.score) best = { score, x: near.reduce((q, o) => q + o.x, 0) / near.length, y: near.reduce((q, o) => q + o.y, 0) / near.length, near };
    }
    if (!best) return null;
    const de = best.near.filter((o) => o.side !== "us");
    const e = de.length ? de : best.near;
    best.ex = e.reduce((q, o) => q + o.x, 0) / e.length; best.ey = e.reduce((q, o) => q + o.y, 0) / e.length;
    return best;
  };
  window.__markUsed = (h) => { used.push({ x: h.x, y: h.y }); if (used.length > 3) used.shift(); };
  let c = null, tz = 2.0, z = 2.0, goal = null;
  window.__cut = (zoom, hot) => { const h = hot ?? window.__hot(); if (!h) return null; window.__markUsed(h); goal = h; c = { x: h.x, y: h.y }; tz = z = zoom; return h; };
  window.__zoom = (v) => { tz = v; };
  const tick = () => {
    if (c && goal) { window.squad.look(c.x, c.y, z); z += (tz - z) * 0.03; }
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
  const card = document.getElementById("card");
  const clamp = (v) => Math.max(0, Math.min(1, v));
  window.__fx = (t, dur) => {
    card.style.opacity = String(Math.max(1 - clamp(t / 1.2), clamp((t - (dur - 1.2)) / 1.2)));
    if (t > dur - 1.2) card.innerHTML = "";
    end.style.opacity = String(clamp((t - (dur - 8)) / 1));
    window.squad.sfx.voices = 0; // sources never "end" in an offline context
  };
  window.__fx(0, 99);
});
await page.keyboard.press("4");
// switch to virtual time (paused, so the clock jump costs no sim time)
await page.keyboard.press("Space");
await page.clock.install({ time: 1e12 });
await page.clock.pauseAt(1e12 + 100);
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
const cap = (t) => () => page.evaluate((t) => window.__cap(t), t);
let houseTarget = null;
const events = [
  [0, async () => { await key("4"); await page.evaluate(() => window.__cut(3.2)); }],
  [0, cap("EVERY SOLDIER SIMULATED")],
  [3.3, cap("")],
  [3.6, shotFn(5, false)],
  [7.5, shotFn(4, false)],
  [11, shotFn(3.4, true)],
  [11.2, cap("CALL IN A BARRAGE")],
  [15.5, cap("")],
  [16, shotFn(5.5, false)],
  [17, cap("FLANK. PIN. ASSAULT.")],
  [21, shotFn(4.5, false)],
  [22.5, cap("")],
  [23.4, async () => {
    await key("r"); await key("3");
    houseTarget = await page.evaluate(() => {
      const w = window.squad.world(); const hot = window.__hot(false);
      const bs = w.buildings.filter((b) => !b.destroyed && b.w * b.h >= 30 && b.kind !== "church");
      if (!bs.length) return null;
      const ref = hot ?? { x: 120, y: 100 };
      bs.sort((a, b) => Math.hypot(a.x + a.w / 2 - ref.x, a.y + a.h / 2 - ref.y) - Math.hypot(b.x + b.w / 2 - ref.x, b.y + b.h / 2 - ref.y));
      const t = bs[0]; const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      window.__cut(3.6, { x: cx, y: cy, ex: cx, ey: cy, score: 1, near: [] });
      return { cx, cy };
    });
  }],
  [24.0, async () => { if (houseTarget) await page.evaluate((h) => { window.squad.barrage(h.cx, h.cy); setTimeout(() => window.squad.barrage(h.cx + 2, h.cy), 900); }, houseTarget); }],
  [24.5, cap("HOUSES COME DOWN")],
  [30, cap("")],
  [30, () => key("r")],
  [30.5, shotFn(5.5, false)],
  [34, shotFn(3.4, true)],
  [38, shotFn(5, false)],
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
