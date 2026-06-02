import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadConfig } from "../src/loader.js";

// The repo's own pickled.yml is the in-repo acceptance fixture: pickled
// testing itself under the public tasks schema. Loading it here guards the
// dogfood config from drifting out of the schema the loader accepts.
const REPO_ROOT = join(import.meta.dir, "../../..");

describe("dogfood pickled.yml (in-repo acceptance fixture)", () => {
  test("loads and compiles under the public tasks schema", async () => {
    const config = await loadConfig(REPO_ROOT);
    const names = config.scenarios.map((s) => s.name);
    expect(names).toEqual(["positioning", "install", "tool_modes"]);
    // Every task is an answer task today (no build kind in the dogfood yet).
    expect(config.scenarios.every((s) => s.kind !== "build")).toBe(true);
    // Access compiled to sparse accessPairs, not the legacy cross-product.
    expect(config.scenarios[0]?.matrix?.accessPairs?.length).toBe(4);
    expect(config.tool.name).toBe("pickled");
  });
});
