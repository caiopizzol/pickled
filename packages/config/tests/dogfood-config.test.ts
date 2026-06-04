import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadConfig } from "../src/loader.js";

// The repo's own pickled.yml is the in-repo acceptance fixture: pickled testing
// itself under the public v2 schema. Loading it here guards the dogfood config
// from drifting out of the schema the loader accepts.
const REPO_ROOT = join(import.meta.dir, "../../..");

describe("dogfood pickled.yml (in-repo acceptance fixture)", () => {
  test("loads and resolves under the public v2 schema", async () => {
    const config = await loadConfig(REPO_ROOT);
    expect(config.product.name).toBe("pickled");

    expect(config.questions.map((q) => q.id)).toEqual([
      "positioning",
      "install",
      "tool_modes",
    ]);
    // Positioning compares the full context gradient.
    expect(config.questions[0]?.contexts).toEqual([
      "memory",
      "given_docs",
      "web_open",
      "web_docs",
    ]);

    expect(config.builds.map((b) => b.id)).toEqual(["write_pickled_config"]);
    const build = config.builds[0];
    expect(build?.agents).toEqual(["builder"]);
    expect(build?.contexts).toEqual(["memory", "given_llms"]);
    expect(build?.trials).toBe(3);
    expect(build?.workspace.path).toBe("./fixtures/pickled-config-authoring");
    expect(build?.verifier.failToPass[0]?.run).toBe(
      "./tests/verify-pickled-config.sh",
    );

    // Contexts cover all four modes.
    const modes = new Set(Object.values(config.contexts).map((c) => c.mode));
    expect(modes).toEqual(new Set(["memory", "inject", "web"]));

    // Thresholds are per-kind.
    expect(config.thresholds.questions).toBe(60);
    expect(config.thresholds.builds).toBe(60);
  });
});
