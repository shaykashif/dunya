// npm run replay -- --dir runs/seed42   (or: --seed 42 to record and replay in one go)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DecisionRecord } from "../decision/sources.ts";
import type { ScheduledIntervention } from "../engine/interventions.ts";
import { replayRun } from "../log/replay.ts";
import { runSimulation, type RunSummary } from "../sim.ts";
import { parseArgs } from "./args.ts";

const args = parseArgs(process.argv.slice(2));
let seed: number, ticks: number, expectedHash: string, decisions: DecisionRecord[];
let interventions: ScheduledIntervention[] = [];
let config = {};

const readLines = <T>(file: string): T[] => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

if (args.dir) {
  const summary = JSON.parse(readFileSync(join(args.dir, "summary.json"), "utf8")) as RunSummary & { mapChosen?: boolean; seasonChosen?: boolean };
  // A run made with --map had its ground chosen, not rolled from the seed.
  if (summary.mapChosen) config = { map: { kind: summary.map } };
  if (summary.seasonChosen) config = { ...config, season: { kind: summary.season } };
  seed = summary.seed;
  ticks = summary.ticks;
  expectedHash = summary.hash;
  decisions = readLines<DecisionRecord>(join(args.dir, "decisions.ndjson"));
  const ivFile = join(args.dir, "interventions.ndjson");
  if (existsSync(ivFile)) interventions = readLines<ScheduledIntervention>(ivFile);
} else {
  seed = Number(args.seed ?? 42);
  const { engine, summary } = await runSimulation({ seed });
  ticks = summary.ticks;
  expectedHash = summary.hash;
  decisions = engine.decisionLog;
}

const result = await replayRun(seed, ticks, decisions, { interventions, config });
console.log(`replay seed ${seed}, ${ticks} ticks, ${decisions.length} decisions, ${interventions.length} interventions`);
console.log(`  recorded hash ${expectedHash}`);
console.log(`  replayed hash ${result.hash}`);
if (result.hash === expectedHash && result.consumed === decisions.length) {
  console.log("  OK: replay reproduced the event stream exactly");
} else {
  console.log(`  MISMATCH (consumed ${result.consumed} of ${decisions.length} decisions)`);
  process.exitCode = 1;
}
