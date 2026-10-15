// A tiny collector for the viewers' anonymous events: node analytics/collect.ts
// Listens on 127.0.0.1:5180 (nginx proxies /a/e to it), appends one JSON line per event to
// $STATE_DIRECTORY/events.ndjson. No IP address, cookie or user agent string is stored: only a
// random per-tab session id, the event, a coarse device class and country from the CDN, and `vid`, a
// one-day visitor id derived from a salted hash (see visitorId) that cannot be reversed or matched after the day ends.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

const port = Number(process.env.PORT ?? 5180);
const dir = process.env.STATE_DIRECTORY ?? join(process.cwd(), "data");
const file = join(dir, "events.ndjson");
const MAX_BYTES = 80 * 1024 * 1024;
mkdirSync(dir, { recursive: true });

const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) {
    hits.set(ip, { n: 1, t: now });
    return false;
  }
  return ++h.n > 240;
}
setInterval(() => hits.clear(), 10 * 60_000).unref();

function clean(raw: unknown): Record<string, string | number | boolean> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z_][a-z0-9_]{0,23}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 60);
    if (Object.keys(out).length >= 16) break;
  }
  return typeof out.name === "string" && out.name.length > 0 ? out : null;
}

function write(line: string): void {
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
  } catch {
    // No file yet.
  }
  appendFileSync(file, `${line}\n`);
}

// An approximate count of distinct visitors per day, without keeping anything that identifies one:
// a hash of address and browser with a random salt that is generated fresh each UTC day and only ever
// held in memory. Once the day is over (or the service restarts) the ids can no longer be matched to anyone.
let saltDay = "";
let salt = randomBytes(16);
function visitorId(ip: string, ua: string): string {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== saltDay) {
    saltDay = day;
    salt = randomBytes(16);
  }
  return createHash("sha256").update(salt).update(ip).update("|").update(ua).digest("hex").slice(0, 12);
}

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|monitor|uptime|curl|wget|python|node-fetch/i;

createServer((req, res) => {
  const url = req.url ?? "/";
  if (req.method === "GET" && url.startsWith("/a/health")) {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (req.method !== "POST" || !url.startsWith("/a/e")) {
    res.writeHead(404).end();
    return;
  }
  const ip = String(req.headers["cf-connecting-ip"] ?? req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "");
  if (limited(ip)) {
    res.writeHead(429).end();
    return;
  }
  // Crawlers run the page too; their "sessions" would only blur the funnel.
  if (BOT.test(String(req.headers["user-agent"] ?? ""))) {
    res.writeHead(204).end();
    return;
  }
  let size = 0;
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > 4096) req.destroy();
    else chunks.push(c);
  });
  req.on("end", () => {
    try {
      const ev = clean(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (ev) {
        const ua = String(req.headers["user-agent"] ?? "");
        write(JSON.stringify({ ts: new Date().toISOString(), vid: visitorId(ip, ua), cc: String(req.headers["cf-ipcountry"] ?? "").slice(0, 2), dev: /mobi|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop", ...ev }));
      }
    } catch {
      // Bad input is dropped without a word.
    }
    res.writeHead(204).end();
  });
}).listen(port, "127.0.0.1", () => console.log(`analytics collector on 127.0.0.1:${port}, writing ${file}`));
