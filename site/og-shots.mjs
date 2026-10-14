// Writes og-squad.png and og-civ.png from real screenshots of each sim: node site/og-shots.mjs
// Needs Playwright with a Chromium (PLAYWRIGHT_BROWSERS_PATH or executablePath below) and `node site/serve.ts 5175` running.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dir = fileURLToPath(new URL(".", import.meta.url));
const base = process.env.BASE ?? "http://localhost:5175";

const pages = [
  { file: "og-squad.png", path: "/squad/?seed=42", title: "BATTLE SIMULATION", sub: "A US rifle platoon attacks a German position, Normandy 1944", accent: "#e8c84a", wait: 9000, hide: "#topbar,#powers,#minimap,#gridref,#help,#chronicle,#toasts,aside,#bolts" },
  { file: "og-civ.png", path: "/civ/", title: "CIVILIZATION SIMULATION", sub: "A living village that farms, feuds, falls in love and judges", accent: "#f2c84a", wait: 12000, hide: "#topbar,#powers,#settings,#alertprefs,#chronicle,#toasts,#minimap,#help,aside,#bolts" },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" });
for (const p of pages) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(base + p.path);
  await page.waitForTimeout(2500);
  await page.mouse.click(600, 300); // the start gate
  await page.evaluate(() => document.body.classList.add("side-hidden"));
  await page.keyboard.press("6"); // fastest speed
  await page.waitForTimeout(p.wait);
  await page.addStyleTag({ content: p.hide ? `${p.hide}{display:none!important} body{grid-template-columns:1fr!important}` : "html{}" });
  await page.evaluate(({ title, sub, accent }) => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:170px;z-index:99999;background:linear-gradient(transparent,rgba(12,14,8,.94) 55%);display:flex;flex-direction:column;justify-content:flex-end;padding:0 48px 28px;font-family:'Silkscreen',monospace";
    d.innerHTML = `<div style="font-size:54px;letter-spacing:2px;color:#ece6cc;text-shadow:0 4px 0 #000">${title}</div><div style="font:30px 'VT323',monospace;color:${accent};margin-top:6px">${sub} · sim.shaykas.com</div>`;
    document.body.appendChild(d);
  }, p);
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(800);
  await page.screenshot({ path: dir + p.file });
  console.log("wrote", p.file);
  await page.close();
}
await browser.close();
