// Reads the collector's events and prints the funnel: node analytics/report.ts [events.ndjson]
// On the server: sudo node --no-warnings analytics/report.ts
import { existsSync, readFileSync } from "node:fs";

const candidates = [process.argv[2], "/var/lib/private/sim-analytics/events.ndjson", "/var/lib/sim-analytics/events.ndjson", "data/events.ndjson"].filter(Boolean) as string[];
const path = candidates.find((p) => existsSync(p));
if (!path) {
  console.error("No events file found. Tried:\n  " + candidates.join("\n  "));
  process.exit(1);
}
type Ev = Record<string, string | number | boolean> & { name: string; sid: string; ts: string };
const events: Ev[] = [];
for (const f of [`${path}.1`, path]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    try {
      if (line) events.push(JSON.parse(line) as Ev);
    } catch {
      // Skip a torn line.
    }
  }
}

const by = new Map<string, Ev[]>();
for (const e of events) (by.get(e.sid) ?? by.set(e.sid, []).get(e.sid)!).push(e);
const sessions = [...by.values()];
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "n/a");
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN);
const has = (s: Ev[], name: string) => s.some((e) => e.name === name);
const sec = (ms: number) => (Number.isNaN(ms) ? "n/a" : `${(ms / 1000).toFixed(1)}s`);

const first = events.length ? events[0]!.ts.slice(0, 10) : "-";
const last = events.length ? events[events.length - 1]!.ts.slice(0, 10) : "-";
console.log(`Events ${events.length}, tabs ${sessions.length}, ${first} to ${last}\n`);

// Landing page.
const landing = sessions.filter((s) => has(s, "landing_view"));
const played = landing.filter((s) => has(s, "landing_play"));
console.log(`LANDING   ${landing.length} views, ${played.length} pressed play (${pct(played.length, landing.length)})`);

// The battle viewer.
const squad = sessions.filter((s) => has(s, "session_start"));
const timeOf = (s: Ev[]) => Math.max(0, ...s.map((e) => Number(e.open_s ?? 0)), ...s.map((e) => Number(e.t ?? 0) / 1000));
const opens = squad.map(timeOf);
console.log(`\nBATTLE    ${squad.length} tabs`);
const fi = squad.map((s) => s.find((e) => e.name === "first_interaction")).filter(Boolean) as Ev[];
console.log(`  interacted        ${pct(fi.length, squad.length)}   median time to first interaction ${sec(median(fi.map((e) => Number(e.ms))))}`);
console.log(`  used a barrage    ${pct(squad.filter((s) => has(s, "barrage")).length, squad.length)}`);
console.log(`  opened Controls   ${pct(squad.filter((s) => has(s, "controls_opened")).length, squad.length)}`);
console.log(`  saw a battle end  ${pct(squad.filter((s) => has(s, "battle_end")).length, squad.length)}`);
console.log(`  shared a result   ${pct(squad.filter((s) => has(s, "share")).length, squad.length)}`);
console.log(`  played again      ${pct(squad.filter((s) => s.filter((e) => e.name === "battle_start").length > 1).length, squad.length)}`);
console.log(`  stayed 15s / 30s / 1m / 2m / 5m   ${[15, 30, 60, 120, 300].map((t) => pct(opens.filter((o) => o >= t).length, squad.length)).join(" / ")}   median ${sec(median(opens) * 1000)}`);

const group = (label: string, key: (s: Ev[]) => string) => {
  const m = new Map<string, Ev[][]>();
  for (const s of squad) (m.get(key(s)) ?? m.set(key(s), []).get(key(s))!).push(s);
  console.log(`\n  by ${label}`);
  for (const [k, list] of [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
    const o = list.map(timeOf);
    console.log(`    ${(k || "(none)").padEnd(22)} ${String(list.length).padStart(5)} tabs   stay>=30s ${pct(o.filter((x) => x >= 30).length, list.length).padStart(4)}   barrage ${pct(list.filter((s) => has(s, "barrage")).length, list.length).padStart(4)}`);
  }
};
group("device", (s) => String(s[0]!.dev));
group("cinematic start", (s) => String(s.find((e) => e.name === "session_start")!.cinematic));
group("source", (s) => String(s.find((e) => e.name === "session_start")!.src ?? ""));
group("country", (s) => String(s[0]!.cc));
