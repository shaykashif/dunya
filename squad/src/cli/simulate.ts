// npm run simulate -- --seed 42 [--ticks 1800] [--out runs/seed42]
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventLog } from "../log/events.ts";
import { firstBlood, verdict } from "../battle/verdict.ts";
import { createSimulation, summarize, type SideSummary } from "../sim.ts";
import { parseArgs } from "./args.ts";

const args = parseArgs(process.argv.slice(2));
const seed = Number(args.seed ?? 42);
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
const t0 = performance.now();
if (args.ticks) await engine.runTicks(Number(args.ticks));
else await engine.runBattle();
const summary = summarize(engine.world);
const ms = Math.round(performance.now() - t0);

if (out) {
  await new Promise<void>((resolve) => events!.end(resolve));
  writeFileSync(join(out, "decisions.ndjson"), engine.decisionLog.map((d) => JSON.stringify(d)).join("\n") + "\n");
  writeFileSync(join(out, "interventions.ndjson"), engine.interventionLog.map((d) => JSON.stringify(d)).join("\n") + "\n");
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
}

const side = (name: string, s: SideSummary) =>
  `  ${name.padEnd(9)} ${String(s.men).padStart(2)} men: ${s.killed} killed, ${s.wounded} wounded, ${s.captured} captured, ${s.fled} left the field; ${s.shots} rounds, ${s.hits} hits`;
const w = engine.world;
console.log(`Squad simulation, seed ${seed}: ${w.config.time.date}, ${w.attacker === "us" ? "the US platoon attacks" : "the German Zug attacks"} (${summary.ticks} ticks, to ${summary.clock}; ${ms} ms)`);
console.log(`  ground    ${w.layout.name}, ${w.weather.label}${w.side("us").concat(w.side("de")).some((s) => s.role === "sniper") ? `; snipers: ${w.soldiers.filter((s) => s.role === "sniper").map((s) => s.side).join(", ")}` : ""}`);
console.log(`  outcome   ${summary.winner === null ? "no decision" : summary.winner === "us" ? "US victory" : "German victory"}: ${summary.reason}`);
console.log(side("US", summary.us));
console.log(side("German", summary.de));
console.log(`  ordnance  ${summary.grenades} grenades thrown, ${summary.mortarRounds} mortar and artillery rounds`);
console.log(`  medics    ${summary.medicTreatments} treatments; a month on, ${summary.diedLater} more dead of wounds, ${summary.crippled} never to fight again`);
const v = verdict(w);
console.log(`  verdict   ${v.label}${v.winner === null ? "" : ` (${v.score}/100)`}: ${v.summary}`);
const fb = firstBlood(w);
if (fb) console.log(`  first     ${fb.text}`);
console.log(`  events    ${summary.events}`);
console.log(`  hash      ${summary.hash}`);
if (out) console.log(`  written to ${out}`);
