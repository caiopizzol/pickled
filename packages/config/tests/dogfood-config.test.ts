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
      "first_check",
      "github_actions",
      "public_docs_eval",
      "provider_context_modes",
      "mcp_context",
      "build_verifier",
    ]);
    expect(config.sources.github_actions).toBeDefined();

    // GitHub Actions is a first-class adoption path, not generic product trivia.
    expect(config.questions[1]?.contexts).toEqual([
      "given_github_actions",
      "given_docs",
    ]);

    expect(config.builds.map((b) => b.id)).toEqual([
      "add_github_actions_workflow",
    ]);
    const build = config.builds[0];
    expect(build?.agents).toEqual(["builder"]);
    expect(build?.contexts).toEqual(["memory", "given_llms"]);
    expect(build?.trials).toBe(3);
    expect(build?.workspace.path).toBe("./fixtures/github-actions");
    expect(build?.verifier.failToPass[0]?.run).toBe(
      "./tests/verify-workflow.sh",
    );
    // SWE-bench bracket is complete: a regression guard plus a positive control.
    expect(build?.verifier.passToPass.length).toBeGreaterThan(0);
    expect(build?.referenceSolution?.patch).toBe(
      "./fixtures/github-actions.solution.patch",
    );

    const mcpQuestion = config.questions.find((q) => q.id === "mcp_context");
    expect(mcpQuestion?.contexts).toEqual(["given_docs", "context7_docs"]);
    const context7 = config.contexts.context7_docs;
    expect(context7?.mode).toBe("mcp");
    if (context7?.mode === "mcp") {
      expect(context7.servers.context7?.url).toBe(
        "https://mcp.context7.com/mcp",
      );
    }

    // The dogfood contexts span all four modes, including the Context7 MCP
    // path.
    const modes = new Set(Object.values(config.contexts).map((c) => c.mode));
    expect(modes).toEqual(new Set(["memory", "inject", "web", "mcp"]));

    // Thresholds are per-kind.
    expect(config.thresholds.questions).toBe(60);
    expect(config.thresholds.builds).toBe(60);
  });
});
