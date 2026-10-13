// npm run simulate -- --seed 42 --days 90 [--out runs/seed42]
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventLog } from "../log/events.ts";
import { createSimulation, summarize } from "../sim.ts";
import { parseArgs } from "./args.ts";

const args = parseArgs(process.argv.slice(2));
const seed = Number(args.seed ?? 42);
const days = Number(args.days ?? 90);
const out = args.out;

const log = new EventLog();
let events: ReturnType<typeof createWriteStream> | null = null;
if (out) {
  mkdirSync(out, { recursive: true });
  events = createWriteStream(join(out, "events.ndjson"));
  log.addSink((_e, line) => {
    events!.write(line + "\n");
  });
}

const engine = createSimulation({ seed, log });
const start = engine.world.active().length;
const t0 = performance.now();
await engine.runDays(days);
const summary = summarize(engine.world, days, start);
const ms = Math.round(performance.now() - t0);

if (out) {
  await new Promise<void>((resolve) => events!.end(resolve));
  writeFileSync(join(out, "decisions.ndjson"), engine.decisionLog.map((d) => JSON.stringify(d)).join("\n") + "\n");
  writeFileSync(join(out, "interventions.ndjson"), engine.interventionLog.map((d) => JSON.stringify(d)).join("\n") + "\n");
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
}

const causes = Object.entries(summary.deathCauses).map(([k, v]) => `${k} ${v}`).join(", ");
console.log(`Village simulation, seed ${seed}, ${days} days (${summary.ticks} ticks, ${ms} ms)`);
console.log(`  population   ${summary.population} (started ${summary.startPopulation}, births ${summary.births}, exiled ${summary.exiled})`);
console.log(`  deaths       ${summary.deaths}${causes ? ` (${causes})` : ""}`);
console.log(`  thefts       ${summary.thefts} (+${summary.failedThefts} caught in the act)`);
console.log(`  attacks      ${summary.attacks}`);
console.log(`  accusations  ${summary.accusations}`);
console.log(`  verdicts     ${summary.verdicts} (${summary.guilty} guilty, ${summary.wrongful} convicted the wrong person)`);
console.log(`  pair bonds   ${summary.pairBonds} formed, ${summary.breakUps} break-ups`);
console.log(`  events       ${summary.events}`);
console.log(`  hash         ${summary.hash}`);
if (out) console.log(`  written to   ${out}`);
