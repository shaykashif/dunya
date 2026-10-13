import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NanoJevDecisionSource } from "../src/decision/sources.ts";
import { NotImplementedError } from "../src/decision/types.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("engine purity", () => {
  it("engine code uses no Node, DOM, Math.random or Date.now", () => {
    const root = fileURLToPath(new URL("../src", import.meta.url));
    for (const f of files(root).filter((f) => !f.includes(join("src", "cli")))) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/from\s+"node:/);
      expect(src, f).not.toMatch(/Math\.random|Date\.now|\bdocument\.|\bwindow\./);
    }
  });

  it("the NanoJev decision source is a stub that calls no model", () => {
    expect(() => new NanoJevDecisionSource().decide()).toThrow(NotImplementedError);
  });
});
