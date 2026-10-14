import { chromium } from "playwright-core";
import os from "node:os"; import path from "node:path"; import fs from "node:fs";
const seed = process.argv[2] ?? "42";
const DUR = Number(process.argv[3] ?? 50); // seconds of footage
const out = path.resolve("out_" + seed); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
const exe = path.join(os.homedir(), "AppData","Local","ms-playwright","chromium_headless_shell-1243","chrome-headless-shell-win64","chrome-headless-shell.exe");
const browser = await chromium.launch({ executablePath: exe, args: ["--autoplay-policy=no-user-gesture-required", "--enable-gpu-rasterization"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(() => {
  const tee = new WeakMap();
  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...a) {
    if (dest instanceof AudioDestinationNode) {
      let t = tee.get(dest.context);
      if (!t) { t = dest.context.createMediaStreamDestination(); tee.set(dest.context, t); window.__tap = t; }
      orig.call(this, t);
    }
    return orig.call(this, dest, ...a);
  };
});
const page = await ctx.newPage();
const t0 = Date.now();
const cdp = await ctx.newCDPSession(page);
const times = []; let nf = 0;
cdp.on("Page.screencastFrame", async (f) => {
  fs.writeFileSync(path.join(out, `f${String(nf).padStart(5, "0")}.jpg`), Buffer.from(f.data, "base64"));
  times.push(f.metadata.timestamp); nf++;
  try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
});
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`http://localhost:5174/?seed=${seed}`);
await page.waitForTimeout(1500);
// black title card while the sim is fast-forwarded to first contact
await page.evaluate(() => {
  const d = document.createElement("div"); d.id = "card"; d.style.pointerEvents = "none";
  d.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none;background:#0c0e08;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity 1.2s;font-family:'Silkscreen',monospace;color:#ece6cc";
  d.innerHTML = `<div style="font-size:92px;letter-spacing:6px;text-shadow:0 6px 0 #000">BATTLE MODE</div><div style="font:44px 'VT323',monospace;color:#e8c84a;margin-top:14px">Normandy, June 1944 · every soldier simulated</div>`;
  document.body.appendChild(d);
  const st = document.createElement("style");
  st.textContent = "#help,#minimap,#gridref,aside,#bolts,#topbar,#powers,#chronicle{display:none!important}";
  document.head.appendChild(st);
});
await page.mouse.click(900, 500);
await page.evaluate(() => document.body.classList.add("side-hidden"));
// fast-forward to first firefight
await page.evaluate(async () => {
  const w = window.squad.world();
  const near = () => {
    const s = [...w.soldiers.values ? w.soldiers.values() : w.soldiers].filter((m) => m.status !== "dead" && m.conscious !== false);
    const us = s.filter((m) => m.side === "us"), de = s.filter((m) => m.side !== "us");
    let best = 1e9;
    for (const a of us) for (const b of de) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < best) best = d; }
    return best;
  };
  window.__near = near;
  for (let i = 0; i < 90 && near() > 22; i++) await window.squad.advance(10);
});
console.log("near", await page.evaluate(() => window.__near()));
// director: cuts between the busiest fights
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
});
await page.keyboard.press("3"); // 5x
await page.keyboard.press("r"); // roofs off
// audio tap recorder
const started = await page.evaluate(async () => {
  window.squad.sfx.unlock();
  for (let i = 0; i < 90 && !window.__tap; i++) await new Promise((r) => setTimeout(r, 100));
  if (!window.__tap) return false;
  const rec = new MediaRecorder(window.__tap.stream, { mimeType: "audio/webm;codecs=opus" });
  window.__chunks = []; rec.ondataavailable = (e) => window.__chunks.push(e.data);
  rec.start(500); window.__recorder = rec; return true;
});
console.log("audio tap", started);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const recStart = Date.now();
await page.evaluate(() => { document.getElementById("card").style.opacity = "0"; });
const at = async (s, fn) => { const wait = recStart + s * 1000 - Date.now(); if (wait > 0) await page.waitForTimeout(wait); await fn(); };
await page.evaluate(() => {
  window.__cut(3.2);
  const c = document.createElement("div"); c.id = "cap";
  c.style.cssText = "position:fixed;left:0;right:0;top:46px;z-index:99997;text-align:center;font:64px 'Silkscreen',monospace;letter-spacing:3px;color:#ece6cc;text-shadow:0 5px 0 #000,0 0 18px #000;opacity:0;transition:opacity .35s;pointer-events:none";
  document.body.appendChild(c);
  window.__cap = (t) => { c.style.opacity = "0"; if (t) setTimeout(() => { c.textContent = t; c.style.opacity = "1"; }, 380); };
});
const cap = (t) => page.evaluate((t) => window.__cap(t), t);
const key = (k) => page.keyboard.press(k);
const shot = async (sec, zoom, barrage, speedKey = "4") => at(sec, async () => {
  await key(barrage ? "3" : speedKey);
  const h = await page.evaluate((zoom) => { const h = window.__cut(zoom); return h && { x: h.x, y: h.y, ex: h.ex, ey: h.ey }; }, zoom);
  if (h && barrage) await page.evaluate((h) => { const sq = window.squad; sq.barrage(h.ex, h.ey); setTimeout(() => sq.barrage(h.ex + 4, h.ey - 3), 1000); setTimeout(() => sq.barrage(h.ex - 4, h.ey + 3), 2000); }, h);
});
await key("4");
await cap("EVERY SOLDIER SIMULATED");
await at(3.3, () => cap(""));
await shot(3.6, 5, false);
await shot(7.5, 4, false);
await shot(11, 3.4, true);   // barrage 1
await at(11.2, () => cap("CALL IN A BARRAGE"));
await at(15.5, () => cap(""));
await shot(16, 5.5, false);
await at(17, () => cap("FLANK. PIN. ASSAULT."));
await shot(21, 4.5, false);
await at(22.5, () => cap(""));
await at(23.4, async () => {
  await key("r"); // roofs on, so the fall-in shows
  await key("3");
  const h = await page.evaluate(() => {
    const w = window.squad.world(); const hot = window.__hot(false);
    const bs = w.buildings.filter((b) => !b.destroyed && b.w * b.h >= 30 && b.kind !== "church");
    if (!bs.length) return null;
    const ref = hot ?? { x: 120, y: 100 };
    bs.sort((a, b) => Math.hypot(a.x + a.w / 2 - ref.x, a.y + a.h / 2 - ref.y) - Math.hypot(b.x + b.w / 2 - ref.x, b.y + b.h / 2 - ref.y));
    const t = bs[0]; const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    window.__cut(3.6, { x: cx, y: cy, ex: cx, ey: cy, score: 1, near: [] });
    return { cx, cy };
  });
  if (h) {
    await page.waitForTimeout(600);
    await page.evaluate((h) => { window.squad.barrage(h.cx, h.cy); setTimeout(() => window.squad.barrage(h.cx + 2, h.cy), 900); }, h);
  }
});
await at(24.5, () => cap("HOUSES COME DOWN"));
await at(30, () => cap(""));
await at(30, () => key("r"));  // roofs off again
await shot(30.5, 5.5, false);
await shot(34, 3.4, true);   // barrage 3
await shot(38, 5, false);
await at(DUR - 8, () => page.evaluate(() => {
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:230px;z-index:99998;background:linear-gradient(transparent,rgba(12,14,8,.94) 60%);display:flex;flex-direction:column;justify-content:flex-end;padding:0 80px 50px;font-family:'Silkscreen',monospace;opacity:0;transition:opacity 1s";
  d.innerHTML = `<div style="font-size:78px;letter-spacing:3px;color:#ece6cc;text-shadow:0 5px 0 #000">BATTLE SIMULATION</div><div style="font:46px 'VT323',monospace;color:#e8c84a;margin-top:8px">Call in barrages. Watch every man fight. Free in your browser · sim.shaykas.com</div>`;
  document.body.appendChild(d); requestAnimationFrame(() => (d.style.opacity = "1"));
}));
await at(DUR - 1, async () => {});
await page.evaluate(() => { const d = document.getElementById("card"); d.style.opacity = "1"; d.innerHTML = ""; });
await page.waitForTimeout(1300);
const b64 = await page.evaluate(async () => {
  const rec = window.__recorder; await new Promise((r) => { rec.onstop = r; rec.stop(); });
  const blob = new Blob(window.__chunks, { type: "audio/webm" });
  const buf = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});
fs.writeFileSync(path.join(out, "audio.webm"), Buffer.from(b64, "base64"));
await cdp.send("Page.stopScreencast");
await ctx.close();
fs.writeFileSync(path.join(out, "sync.json"), JSON.stringify({ recStart: recStart / 1000, times }));
await browser.close();
console.log("done", (recStart - t0) / 1000);
