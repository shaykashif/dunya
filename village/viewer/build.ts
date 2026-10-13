// Bundles the viewer (and the engine it runs) into viewer/dist/viewer.js.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
await build({
  entryPoints: [root + "src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: root + "dist/viewer.js",
  sourcemap: true,
  logLevel: "info",
});
