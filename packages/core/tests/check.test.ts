import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckConfig } from "@pickled-dev/config";
import { runCheck } from "../src/check.js";
import type {
  RunOptions,
  TargetResult,
  TargetRunner,
} from "../src/targets/types.js";

function makeMockTarget(response: string): TargetRunner {
  return {
    category: "cli",
    provider: "claude-code",
    name: "mock",
    async run(_prompt: string, _options: RunOptions): Promise<TargetResult> {
      return {
        response,
        allResponses: [{ type: "final", text: response }],
        toolsUsed: [],
        sources: [],
        metadata: {
          model: "mock",
          category: "cli",
          provider: "claude-code",
          target: "default",
        },
      };
    },
  };
}

function withTempProject<T>(
  readme: string,
  fn: (toolPath: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "pickled-check-"));
  writeFileSync(join(dir, "README.md"), readme);
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe("runCheck (mocked target)", () => {
  test("scores YES when mocked target cites required sources", async () => {
    await withTempProject("# README content", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Install",
            prompt: "how to install",
            requiredSources: ["readme"],
          },
        ],
      };

      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () =>
            makeMockTarget(
              `Install via npm.\n\n## Sources\n- [readme] install steps`,
            ),
        },
      );

      expect(report.scenarios).toHaveLength(1);
      expect(report.scenarios[0]!.answerable).toBe("YES");
      expect(report.scenarios[0]!.citations.cited).toEqual(["readme"]);
      expect(report.docs).toHaveLength(1);
      expect(report.docs[0]!.id).toBe("readme");
    });
  });

  test("scores NO when mocked target omits citations", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Install",
            prompt: "how to install",
            requiredSources: ["readme"],
          },
        ],
      };

      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () =>
            makeMockTarget("Install via npm. No sources cited."),
        },
      );

      expect(report.scenarios[0]!.answerable).toBe("NO");
      expect(report.scenarios[0]!.citations.cited).toEqual([]);
    });
  });

  test("scores PARTIAL when required source missing", async () => {
    await withTempProject("# README", async (path) => {
      writeFileSync(join(path, "MIGRATION.md"), "# Migration");
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        docs: {
          sources: { readme: "./README.md", migration: "./MIGRATION.md" },
        },
        scenarios: [
          {
            name: "Upgrade",
            prompt: "how to upgrade",
            requiredSources: ["readme", "migration"],
          },
        ],
      };

      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () =>
            makeMockTarget(`Upgrade with X.\n\n## Sources\n- [readme] base`),
        },
      );

      expect(report.scenarios[0]!.answerable).toBe("PARTIAL");
      expect(report.scenarios[0]!.citations.missing).toEqual(["migration"]);
    });
  });

  test("trap firing overrides citation YES to NO with confidence 0", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Config",
            prompt: "what does pickled.yml look like",
            requiredSources: ["readme"],
            traps: [
              {
                id: "old_schema",
                match: "docs.source:",
                reason: "removed singular schema",
              },
            ],
          },
        ],
      };

      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () =>
            makeMockTarget(
              "Use `docs.source: ./README.md` in pickled.yml.\n\n## Sources\n- [readme] the README",
            ),
        },
      );

      const r = report.scenarios[0]!;
      expect(r.answerable).toBe("NO");
      expect(r.confidence).toBe(0);
      expect(r.traps.fired).toHaveLength(1);
      expect(r.traps.fired[0]!.id).toBe("old_schema");
      // Citation details preserved for debugging
      expect(r.citations.cited).toEqual(["readme"]);
      expect(r.reason).toContain("Trap fired");
    });
  });

  test("trap avoided when response doesn't match", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Config",
            prompt: "schema",
            requiredSources: ["readme"],
            traps: [
              {
                id: "old_schema",
                match: "docs.source:",
                reason: "removed singular schema",
              },
            ],
          },
        ],
      };

      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () =>
            makeMockTarget(
              "Use `docs.sources:` (plural).\n\n## Sources\n- [readme] schema",
            ),
        },
      );

      const r = report.scenarios[0]!;
      expect(r.answerable).toBe("YES");
      expect(r.traps.fired).toEqual([]);
      expect(r.traps.avoided).toEqual(["old_schema"]);
    });
  });

  test("penalizes fabricated citation IDs", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Install",
            prompt: "how to install",
            requiredSources: ["readme"],
          },
        ],
      };

      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () =>
            makeMockTarget(
              `Install via npm.\n\n## Sources\n- [readme] base\n- [imaginary] not registered`,
            ),
        },
      );

      expect(report.scenarios[0]!.answerable).toBe("PARTIAL");
      expect(report.scenarios[0]!.citations.unknown).toEqual(["imaginary"]);
      expect(report.scenarios[0]!.confidence).toBeLessThan(100);
    });
  });

  test("preserves configured target metadata on target errors", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        docs: { sources: { readme: "./README.md" } },
        targets: {
          codex: {
            category: "cli",
            provider: "codex-cli",
            model: "gpt-5.5",
          },
        },
        matrix: { target: ["codex"] },
        scenarios: [
          {
            name: "Install",
            prompt: "how to install",
            requiredSources: ["readme"],
          },
        ],
      };

      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "codex-cli",
            name: "codex",
            async run(): Promise<TargetResult> {
              throw new Error("codex failed");
            },
          }),
        },
      );

      expect(report.scenarios[0]!.error).toContain("codex failed");
      expect(report.scenarios[0]!.target).toEqual({
        target: "codex",
        category: "cli",
        provider: "codex-cli",
        model: "gpt-5.5",
      });
    });
  });
});

describe("runCheck compare-surfaces mode", () => {
  // A surface-aware mock target: looks at which source ids were passed in
  // options.docs and returns a response keyed off the active surface. Lets
  // tests assert that per-surface dispatch actually changed what the target
  // received.
  function makeSurfaceAwareTarget(
    responsesByActive: Record<string, string>,
  ): TargetRunner {
    return {
      category: "cli",
      provider: "claude-code",
      name: "surface-aware-mock",
      async run(_prompt: string, options: RunOptions): Promise<TargetResult> {
        const key = options.docs
          .map((d) => d.id)
          .sort()
          .join(",");
        const response =
          responsesByActive[key] ??
          `(no response configured for surface "${key}")`;
        return {
          response,
          allResponses: [{ type: "final", text: response }],
          toolsUsed: [],
          sources: [],
          metadata: {
            model: "mock",
            category: "cli",
            provider: "claude-code",
            target: "default",
          },
        };
      },
    };
  }

  function withTempCompareProject<T>(
    files: Record<string, string>,
    fn: (toolPath: string) => Promise<T>,
  ): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), "pickled-check-cmp-"));
    for (const [rel, content] of Object.entries(files)) {
      writeFileSync(join(dir, rel), content);
    }
    return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  test("populates surfaces[] and sets top-level evaluation fields to null", async () => {
    await withTempCompareProject(
      { "README.md": "x", "llms.txt": "y" },
      async (path) => {
        const config: CheckConfig = {
          tool: { name: "t", description: "d" },
          docs: { sources: { readme: "./README.md", llms: "./llms.txt" } },
          scenarios: [
            {
              name: "Install",
              prompt: "how",
              requiredSources: ["readme"],
              compareSurfaces: [["readme"], ["llms"]],
            },
          ],
        };
        const report = await runCheck(
          { name: "t", description: "d", path },
          config,
          {
            targetFactory: () =>
              makeSurfaceAwareTarget({
                readme: "via npm\n\n## Sources\n- [readme]",
                llms: "no info here",
              }),
          },
        );
        const scenario = report.scenarios[0]!;
        expect(scenario.surfaces).toBeDefined();
        expect(scenario.surfaces).toHaveLength(2);
        expect(scenario.answerable).toBeNull();
        expect(scenario.confidence).toBeNull();
        expect(scenario.response).toBeNull();
        expect(scenario.citations).toBeNull();
        expect(scenario.traps).toBeNull();
      },
    );
  });

  test("each surface counts as one data point in the run-level score", async () => {
    // 2 surfaces, one passes (100), one fails (0). Expect Overall ~= 50.
    await withTempCompareProject(
      { "README.md": "x", "llms.txt": "y" },
      async (path) => {
        const config: CheckConfig = {
          tool: { name: "t", description: "d" },
          docs: { sources: { readme: "./README.md", llms: "./llms.txt" } },
          scenarios: [
            {
              name: "Install",
              prompt: "how",
              requiredSources: ["readme"],
              compareSurfaces: [["readme"], ["llms"]],
            },
          ],
        };
        const report = await runCheck(
          { name: "t", description: "d", path },
          config,
          {
            targetFactory: () =>
              makeSurfaceAwareTarget({
                readme: "Answer\n\n## Sources\n- [readme]",
                llms: "no citation provided",
              }),
          },
        );
        expect(report.summary.total).toBe(2);
        expect(report.summary.answered).toBe(1);
        expect(report.summary.unanswered).toBe(1);
        expect(report.summary.score).toBe(50);
      },
    );
  });

  test("intersection citation contract: requiredSources outside active surface softens to anything-in-surface", async () => {
    // requiredSources: [readme], surface [llms]. Intersection is empty.
    // Surface should pass as long as the response cites llms.
    await withTempCompareProject(
      { "README.md": "x", "llms.txt": "y" },
      async (path) => {
        const config: CheckConfig = {
          tool: { name: "t", description: "d" },
          docs: { sources: { readme: "./README.md", llms: "./llms.txt" } },
          scenarios: [
            {
              name: "Install",
              prompt: "how",
              requiredSources: ["readme"],
              compareSurfaces: [["llms"]],
            },
          ],
        };
        const report = await runCheck(
          { name: "t", description: "d", path },
          config,
          {
            targetFactory: () =>
              makeSurfaceAwareTarget({
                llms: "Answer from llms.\n\n## Sources\n- [llms]",
              }),
          },
        );
        const surface = report.scenarios[0]!.surfaces![0]!;
        expect(surface.answerable).toBe("YES");
        expect(surface.citations.cited).toEqual(["llms"]);
      },
    );
  });

  test("trap fired in one surface does not affect another surface", async () => {
    await withTempCompareProject(
      { "README.md": "x", "stale.md": "y" },
      async (path) => {
        const config: CheckConfig = {
          tool: { name: "t", description: "d" },
          docs: { sources: { readme: "./README.md", stale: "./stale.md" } },
          scenarios: [
            {
              name: "Install",
              prompt: "how",
              requiredSources: ["readme"],
              compareSurfaces: [["readme"], ["stale"]],
              traps: [
                {
                  id: "bad_phrase",
                  match: "BAD_PHRASE",
                  reason: "stale claim",
                },
              ],
            },
          ],
        };
        const report = await runCheck(
          { name: "t", description: "d", path },
          config,
          {
            targetFactory: () =>
              makeSurfaceAwareTarget({
                readme: "Clean answer.\n\n## Sources\n- [readme]",
                stale: "BAD_PHRASE appears here.\n\n## Sources\n- [stale]",
              }),
          },
        );
        const surfaces = report.scenarios[0]!.surfaces!;
        const readmeSurface = surfaces.find((s) =>
          s.active.includes("readme"),
        )!;
        const staleSurface = surfaces.find((s) => s.active.includes("stale"))!;
        expect(readmeSurface.answerable).toBe("YES");
        expect(readmeSurface.traps.fired).toHaveLength(0);
        expect(staleSurface.answerable).toBe("NO");
        expect(staleSurface.traps.fired).toHaveLength(1);
        expect(staleSurface.traps.fired[0]!.id).toBe("bad_phrase");
      },
    );
  });

  test("scenarios without compareSurfaces behave exactly as v0.10.0", async () => {
    await withTempProject("# README content", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Install",
            prompt: "how",
            requiredSources: ["readme"],
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () =>
            makeMockTarget("Answer\n\n## Sources\n- [readme]"),
        },
      );
      expect(report.scenarios[0]!.surfaces).toBeUndefined();
      expect(report.scenarios[0]!.answerable).toBe("YES");
    });
  });

  test("scenario without requiredSources but with expected: passes on substring hits", async () => {
    await withTempProject("# README content", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Expected only",
            prompt: "p",
            expected: { includes: ["hello", "world"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () =>
            makeMockTarget("the agent says hello world to you"),
        },
      );
      expect(report.scenarios[0]!.cells).toBeUndefined();
      expect(report.scenarios[0]!.answerable).toBe("YES");
    });
  });
});

describe("runCheck matrix mode", () => {
  test("populates cells[] and nulls top-level evaluation fields", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        targets: {
          a: { category: "cli", provider: "claude-code" },
          b: { category: "cli", provider: "claude-code" },
        },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Probe",
            prompt: "what",
            matrix: { interfaces: ["a", "b"], sources: ["readme"] },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        { targetFactory: () => makeMockTarget("pickled answer here") },
      );
      const r = report.scenarios[0]!;
      expect(r.cells).toBeDefined();
      expect(r.cells).toHaveLength(2);
      expect(r.answerable).toBeNull();
      expect(r.confidence).toBeNull();
      expect(r.cells![0]?.cell.interface).toBe("a");
      expect(r.cells![1]?.cell.interface).toBe("b");
      expect(r.cells![0]?.cell.toolset).toBe("none");
      expect(r.cells![0]?.answerable).toBe("YES");
    });
  });

  test("non-none toolset throws (only 'none' implemented in v0.16.0)", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: { none: {}, web: { webSearch: true } },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Probe",
            prompt: "?",
            matrix: { interfaces: ["a"], toolsets: ["web"] },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        { targetFactory: () => makeMockTarget("x") },
      );
      expect(report.scenarios[0]!.error).toContain("not yet implemented");
    });
  });

  test("cellFilter.interface skips cells with non-matching interface", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        targets: {
          a: { category: "cli", provider: "claude-code" },
          b: { category: "cli", provider: "claude-code" },
        },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Probe",
            prompt: "?",
            matrix: { interfaces: ["a", "b"] },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => makeMockTarget("x"),
          cellFilter: { interface: "a" },
        },
      );
      const cells = report.scenarios[0]!.cells!;
      expect(cells).toHaveLength(1);
      expect(cells[0]?.cell.interface).toBe("a");
    });
  });

  test("scenarioFilter restricts to named scenarios", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          { name: "Wanted", prompt: "?", expected: { includes: ["x"] } },
          { name: "Unwanted", prompt: "?", expected: { includes: ["x"] } },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => makeMockTarget("x"),
          scenarioFilter: ["Wanted"],
        },
      );
      expect(report.scenarios).toHaveLength(1);
      expect(report.scenarios[0]!.scenario.name).toBe("Wanted");
    });
  });

  test("verifier sources are loaded and attached to ScenarioResult.verifierSamples", async () => {
    await withTempProject("# README essential content", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Verifier visible",
            prompt: "?",
            matrix: { interfaces: ["a"] },
            expected: { includes: ["x"] },
            verifiers: { sources: ["readme"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        { targetFactory: () => makeMockTarget("x answer") },
      );
      const r = report.scenarios[0]!;
      expect(r.verifierSamples).toBeDefined();
      expect(r.verifierSamples).toHaveLength(1);
      expect(r.verifierSamples![0]?.id).toBe("readme");
      expect(r.verifierSamples![0]?.content).toContain("essential content");
    });
  });

  test("trap firing vetoes a matrix cell to NO/0 regardless of expected hits", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Trap test",
            prompt: "?",
            matrix: { interfaces: ["a"] },
            expected: { includes: ["pickled"] },
            traps: [{ id: "bad", match: "BANNED", reason: "Stale claim" }],
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () =>
            makeMockTarget("pickled answer but BANNED phrase"),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.answerable).toBe("NO");
      expect(cell.confidence).toBe(0);
      expect(cell.traps.fired).toHaveLength(1);
    });
  });
});
