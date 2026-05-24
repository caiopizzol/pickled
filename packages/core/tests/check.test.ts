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

  test("web toolset on Claude Code: passes WebSearch+WebFetch to the cell target, does NOT inject source", async () => {
    await withTempProject("# README", async (path) => {
      // Capture the per-cell target config so we can verify what the runner
      // passed in (allowedTools should be the web tools, no Read/Edit/etc).
      const captured: {
        allowedTools: string[] | undefined;
        restrictBuiltinTools: string[] | undefined;
        docsCount: number;
      }[] = [];
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: {
          none: {},
          web: { webSearch: true, webFetch: true },
        },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Discovery probe",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["web"],
            },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: (_name, cfg) => ({
            category: "cli",
            provider: "claude-code",
            name: "captured",
            async run(_p, opts) {
              captured.push({
                allowedTools: cfg?.allowedTools,
                restrictBuiltinTools: opts.restrictBuiltinTools,
                docsCount: opts.docs.length,
              });
              return {
                response: "x answer from web research",
                allResponses: [{ type: "final", text: "x" }],
                toolsUsed: ["WebFetch"],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      expect(report.scenarios[0]!.cells).toHaveLength(1);
      expect(report.scenarios[0]!.cells![0]?.cell.toolset).toBe("web");
      expect(report.scenarios[0]!.cells![0]?.answerable).toBe("YES");
      // allowedTools (SDK auto-permission list) carries the web tools.
      expect(captured).toHaveLength(1);
      expect(captured[0]?.allowedTools).toEqual(["WebSearch", "WebFetch"]);
      // restrictBuiltinTools (SDK `tools` option) scopes built-ins to
      // ONLY the web tools so Read/Glob/Bash cannot leak as a fallback.
      expect(captured[0]?.restrictBuiltinTools).toEqual([
        "WebSearch",
        "WebFetch",
      ]);
      // Source NOT injected (cellDocs is empty when discovery mode).
      expect(captured[0]?.docsCount).toBe(0);
    });
  });

  test("web toolset on an unsupported provider throws clearly", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: { none: {}, web: { webSearch: true } },
        targets: {
          a: { category: "cli", provider: "codex-cli", model: "gpt-5.5" },
        },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Wrong-interface probe",
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
      expect(report.scenarios[0]!.error).toMatch(
        /implemented on claude-code and anthropic interfaces today/,
      );
    });
  });

  test("web toolset on the anthropic interface passes webTools.search to the adapter", async () => {
    await withTempProject("# README", async (path) => {
      const captured: { webTools?: { search?: boolean }; docsCount: number }[] =
        [];
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: { none: {}, web: { webSearch: true, webFetch: true } },
        targets: {
          a: {
            category: "api",
            provider: "anthropic",
            model: "claude-haiku-4-5",
          },
        },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Anthropic API web cell",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["web"],
            },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "api",
            provider: "anthropic",
            name: "captured",
            async run(_p, opts) {
              captured.push({
                webTools: opts.webTools,
                docsCount: opts.docs.length,
              });
              return {
                response: "x answer from anthropic web research",
                allResponses: [{ type: "final", text: "x" }],
                toolsUsed: ["web_search"],
                sources: [],
                metadata: {
                  model: "claude-haiku-4-5",
                  category: "api",
                  provider: "anthropic",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      expect(report.scenarios[0]!.cells).toHaveLength(1);
      expect(report.scenarios[0]!.cells![0]?.cell.toolset).toBe("web");
      expect(report.scenarios[0]!.cells![0]?.answerable).toBe("YES");
      // webTools.search reaches the adapter so it can wire the
      // server-side web_search tool. Source is NOT injected (discovery
      // mode for non-none cells).
      expect(captured).toHaveLength(1);
      expect(captured[0]?.webTools).toEqual({ search: true });
      expect(captured[0]?.docsCount).toBe(0);
    });
  });

  test("web cell on anthropic that does not invoke web_search hard-vetoes via provenance", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: { none: {}, web: { webSearch: true } },
        targets: {
          a: {
            category: "api",
            provider: "anthropic",
            model: "claude-haiku-4-5",
          },
        },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Anthropic web cell that skips the tool",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["web"],
            },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "api",
            provider: "anthropic",
            name: "captured",
            async run() {
              return {
                response: "x answer from model prior knowledge",
                allResponses: [{ type: "final", text: "x" }],
                toolsUsed: [],
                sources: [],
                metadata: {
                  model: "claude-haiku-4-5",
                  category: "api",
                  provider: "anthropic",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.answerable).toBe("NO");
      expect(cell.confidence).toBe(0);
    });
  });

  test("web toolset on anthropic with only webFetch:true rejects at config-gate", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: { none: {}, fetchOnly: { webFetch: true } },
        targets: {
          a: {
            category: "api",
            provider: "anthropic",
            model: "claude-haiku-4-5",
          },
        },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Fetch-only probe",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["fetchOnly"],
            },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        { targetFactory: () => makeMockTarget("x") },
      );
      expect(report.scenarios[0]!.error).toMatch(
        /on anthropic provider requires webSearch: true/,
      );
    });
  });

  test("toolset with no recognized shape (empty body) throws a clear error", async () => {
    // Empty toolset (no webSearch/webFetch flags, no mcpServers) has no
    // runtime shape; the runner cannot pick a tool path for it.
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: { none: {}, mystery: {} },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Mystery probe",
            prompt: "?",
            matrix: { interfaces: ["a"], toolsets: ["mystery"] },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        { targetFactory: () => makeMockTarget("x") },
      );
      expect(report.scenarios[0]!.error).toMatch(/no runtime shape/);
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

  test("web cell with no expected tools used: downgrades to NO with provenance reason", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: { none: {}, web: { webSearch: true, webFetch: true } },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "No-tool-use probe",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["web"],
            },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "prior-knowledge",
            async run(): Promise<TargetResult> {
              return {
                response: "pickled is a thing I just happen to know about",
                allResponses: [{ type: "final", text: "pickled..." }],
                toolsUsed: [],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.answerable).toBe("NO");
      // Hard veto: provenance failure forces confidence 0, mirroring trap
      // semantics. Cell cannot testify to the toolset axis even if the
      // response happens to satisfy expected.includes.
      expect(cell.confidence).toBe(0);
      expect(cell.reason).toMatch(/Provenance failed/);
      expect(cell.reason).toMatch(/configured but none of \[/);
      expect(cell.reason).toMatch(/prior knowledge/);
      // Diagnostics are appended so a reader still sees what the response
      // happened to say. Here expected.includes was satisfied.
      expect(cell.reason).toMatch(/expected checks satisfied/);
      expect(cell.toolsUsed).toEqual([]);
    });
  });

  test("web cell that uses one of the configured tools: passes provenance check", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: { none: {}, web: { webSearch: true, webFetch: true } },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "One-tool probe",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["web"],
            },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "one-tool",
            async run(): Promise<TargetResult> {
              return {
                response: "pickled answer from search",
                allResponses: [{ type: "final", text: "pickled" }],
                toolsUsed: ["WebSearch"],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.answerable).toBe("YES");
      expect(cell.reason).toMatch(/tool use verified \(WebSearch\)/);
    });
  });

  test("web cell that only used unrelated tools: downgraded as if no tool was used", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: { none: {}, web: { webSearch: true, webFetch: true } },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Unrelated-tool probe",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["web"],
            },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "unrelated-tool",
            async run(): Promise<TargetResult> {
              return {
                response: "pickled answer",
                allResponses: [{ type: "final", text: "pickled" }],
                toolsUsed: ["Bash"],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.answerable).toBe("NO");
      expect(cell.confidence).toBe(0);
      expect(cell.reason).toMatch(/Provenance failed/);
      expect(cell.reason).toMatch(/configured but none of \[/);
      expect(cell.toolsUsed).toEqual(["Bash"]);
    });
  });

  test("none cell with empty toolsUsed: provenance check does NOT fire", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "None probe",
            prompt: "?",
            matrix: { interfaces: ["a"], toolsets: ["none"] },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        { targetFactory: () => makeMockTarget("pickled answer") },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.answerable).toBe("YES");
      expect(cell.reason).not.toMatch(/configured but none of/);
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

  test("mcp cell: passes scoped allowedTools and mcpServers, does NOT inject source", async () => {
    await withTempProject("# README", async (path) => {
      const captured: {
        allowedTools: string[] | undefined;
        restrictBuiltinTools: string[] | undefined;
        mcpServers: unknown;
        docsCount: number;
      }[] = [];
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: {
          none: {},
          docs_mcp: {
            mcpServers: {
              docs: { type: "http", url: "https://example.com/mcp" },
            },
          },
        },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "MCP discovery probe",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["docs_mcp"],
            },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: (_name, cfg) => ({
            category: "cli",
            provider: "claude-code",
            name: "captured",
            async run(_p, opts) {
              captured.push({
                allowedTools: cfg?.allowedTools,
                restrictBuiltinTools: opts.restrictBuiltinTools,
                mcpServers: cfg?.mcpServers,
                docsCount: opts.docs.length,
              });
              return {
                response: "x answer via MCP",
                allResponses: [{ type: "final", text: "x" }],
                toolsUsed: ["mcp__docs__get-library-docs"],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      expect(report.scenarios[0]!.cells).toHaveLength(1);
      expect(report.scenarios[0]!.cells![0]?.cell.toolset).toBe("docs_mcp");
      expect(report.scenarios[0]!.cells![0]?.answerable).toBe("YES");
      expect(captured).toHaveLength(1);
      expect(captured[0]?.allowedTools).toEqual(["mcp__docs__*"]);
      // restrictBuiltinTools = [] disables all built-ins (Read, Glob,
      // Bash, ...) so the agent cannot fall back to local filesystem.
      // The MCP tools come from the SDK's mcpServers option, not from
      // the built-in tool set.
      expect(captured[0]?.restrictBuiltinTools).toEqual([]);
      expect(captured[0]?.mcpServers).toEqual({
        docs: { type: "http", url: "https://example.com/mcp" },
      });
      expect(captured[0]?.docsCount).toBe(0);
    });
  });

  test("mcp cell: prefix-matches mcp__<server>__* for provenance", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: {
          none: {},
          docs_mcp: {
            mcpServers: {
              docs: { type: "http", url: "https://example.com/mcp" },
            },
          },
        },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "MCP provenance probe",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["docs_mcp"],
            },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "mcp-mock",
            async run(): Promise<TargetResult> {
              return {
                response: "pickled answer from MCP",
                allResponses: [{ type: "final", text: "pickled" }],
                toolsUsed: ["mcp__docs__resolve-library-id"],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.answerable).toBe("YES");
      expect(cell.reason).toMatch(/tool use verified/);
      expect(cell.reason).toMatch(/mcp__docs__resolve-library-id/);
    });
  });

  test("mcp cell with no mcp tool used: hard-veto NO/0 with provenance reason", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: {
          none: {},
          docs_mcp: {
            mcpServers: {
              docs: { type: "http", url: "https://example.com/mcp" },
            },
          },
        },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "MCP no-use probe",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["docs_mcp"],
            },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "no-mcp-call",
            async run(): Promise<TargetResult> {
              return {
                response: "pickled answer from model prior knowledge",
                allResponses: [{ type: "final", text: "pickled" }],
                toolsUsed: [],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.answerable).toBe("NO");
      expect(cell.confidence).toBe(0);
      expect(cell.reason).toMatch(/Provenance failed/);
      expect(cell.reason).toMatch(/mcp__docs__\*/);
    });
  });

  test("mcp cell: only unrelated tool used counts as no provenance", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: {
          none: {},
          docs_mcp: {
            mcpServers: {
              docs: { type: "http", url: "https://example.com/mcp" },
            },
          },
        },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "MCP unrelated-tool probe",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["docs_mcp"],
            },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "unrelated",
            async run(): Promise<TargetResult> {
              return {
                response: "pickled answer",
                allResponses: [{ type: "final", text: "pickled" }],
                toolsUsed: ["mcp__other__tool"],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.answerable).toBe("NO");
      expect(cell.confidence).toBe(0);
      expect(cell.reason).toMatch(/Provenance failed/);
    });
  });

  test("mcp cell with multiple servers: any one server's tool counts", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: {
          none: {},
          two_mcp: {
            mcpServers: {
              a_srv: { type: "http", url: "https://a.example.com/mcp" },
              b_srv: { type: "http", url: "https://b.example.com/mcp" },
            },
          },
        },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Two-server probe",
            prompt: "?",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["two_mcp"],
            },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "two-mock",
            async run(): Promise<TargetResult> {
              return {
                response: "pickled answer from b_srv",
                allResponses: [{ type: "final", text: "pickled" }],
                toolsUsed: ["mcp__b_srv__fetch"],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.answerable).toBe("YES");
      expect(cell.reason).toMatch(/tool use verified \(mcp__b_srv__fetch\)/);
    });
  });

  test("mixed-shape toolset (web flags + mcpServers) is rejected", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: {
          none: {},
          mixed: {
            webSearch: true,
            mcpServers: {
              docs: { type: "http", url: "https://example.com/mcp" },
            },
          },
        },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Mixed probe",
            prompt: "?",
            matrix: { interfaces: ["a"], toolsets: ["mixed"] },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        { targetFactory: () => makeMockTarget("x") },
      );
      expect(report.scenarios[0]!.error).toMatch(
        /mixes webSearch\/webFetch with mcpServers/,
      );
    });
  });

  test("mcp toolset on non-claude-code interface throws clearly", async () => {
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: {
          none: {},
          docs_mcp: {
            mcpServers: {
              docs: { type: "http", url: "https://example.com/mcp" },
            },
          },
        },
        targets: {
          a: { category: "cli", provider: "codex-cli", model: "gpt-5.5" },
        },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Wrong-interface MCP probe",
            prompt: "?",
            matrix: { interfaces: ["a"], toolsets: ["docs_mcp"] },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        { targetFactory: () => makeMockTarget("x") },
      );
      expect(report.scenarios[0]!.error).toMatch(
        /implemented only on the claude-code interface/,
      );
    });
  });

  test("non-none cell ignores scenario context override of allowedTools/mcpServers", async () => {
    // Matrix contract: the cell label is the single source of truth
    // for what the agent had available. A scenario/context-level
    // override of allowedTools or mcpServers would let an unrelated
    // context config swap in a different tool set and make the cell
    // label dishonest. The matrix runner must drop context for
    // non-none cells.
    await withTempProject("# README", async (path) => {
      const captured: {
        contextSeen: unknown;
      }[] = [];
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: {
          none: {},
          web: { webSearch: true, webFetch: true },
        },
        targets: { a: { category: "cli", provider: "claude-code" } },
        contexts: {
          attempted_override: {
            allowedTools: ["Read", "Bash", "WeirdTool"],
            mcpServers: {
              rogue: { type: "http", url: "https://rogue.example.com/mcp" },
            },
          },
        },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Override probe",
            prompt: "?",
            context: "attempted_override",
            matrix: {
              interfaces: ["a"],
              sources: ["readme"],
              toolsets: ["web"],
            },
            expected: { includes: ["x"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "ctx-capture",
            async run(_p, opts) {
              captured.push({ contextSeen: opts.context });
              return {
                response: "x answer",
                allResponses: [{ type: "final", text: "x" }],
                toolsUsed: ["WebSearch"],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      expect(report.scenarios[0]!.cells![0]?.answerable).toBe("YES");
      // Adapter received no context for this non-none cell, so it falls
      // through to the cell's per-target config (the toolset's tools).
      expect(captured).toHaveLength(1);
      expect(captured[0]?.contextSeen).toBeUndefined();
    });
  });

  test("none cell still honors scenario context", async () => {
    // The override drop is scoped to non-none cells; none cells should
    // continue to receive context as before.
    await withTempProject("# README", async (path) => {
      const captured: {
        contextSeen: unknown;
      }[] = [];
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        targets: { a: { category: "cli", provider: "claude-code" } },
        contexts: {
          ctx: {
            allowedTools: ["Read", "Glob"],
          },
        },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "None probe with context",
            prompt: "?",
            context: "ctx",
            matrix: { interfaces: ["a"], toolsets: ["none"] },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "ctx-capture-none",
            async run(_p, opts) {
              captured.push({ contextSeen: opts.context });
              return {
                response: "pickled answer",
                allResponses: [{ type: "final", text: "pickled" }],
                toolsUsed: [],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      expect(report.scenarios[0]!.cells![0]?.answerable).toBe("YES");
      expect(captured).toHaveLength(1);
      expect(
        (captured[0]?.contextSeen as { allowedTools?: string[] } | undefined)
          ?.allowedTools,
      ).toEqual(["Read", "Glob"]);
    });
  });

  test("source 'none' + toolset 'none' = no-context baseline (model prior)", async () => {
    // The reserved sentinel says "give the agent no source content
    // and no discovery hint." This is the model-prior baseline: what
    // does the model already think when asked the scenario question
    // with zero help?
    await withTempProject("# README content", async (path) => {
      const captured: { docsCount: number; promptSeen: string }[] = [];
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "No-context baseline",
            prompt: "What is pickled?",
            matrix: {
              interfaces: ["a"],
              sources: ["none"],
              toolsets: ["none"],
            },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "model-prior-mock",
            async run(prompt, opts): Promise<TargetResult> {
              captured.push({
                docsCount: opts.docs.length,
                promptSeen: prompt,
              });
              return {
                response: "pickled is a thing the model already knows about",
                allResponses: [{ type: "final", text: "pickled..." }],
                toolsUsed: [],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.cell.source).toBe("none");
      expect(cell.answerable).toBe("YES");
      // No source content was injected (cellDocs is empty).
      expect(captured[0]?.docsCount).toBe(0);
      // Prompt is the bare scenario prompt; no canonical-source hint.
      expect(captured[0]?.promptSeen).toBe("What is pickled?");
    });
  });

  test("source 'none' + toolset 'web' = open discovery (no hint, tool-use still required)", async () => {
    // No source content, no canonical-URL hint. The agent has web
    // tools and must find the answer from scratch. Tool-use provenance
    // still vetoes a cell that answers without invoking any web tool.
    await withTempProject("# README", async (path) => {
      const config: CheckConfig = {
        tool: { name: "t", description: "d" },
        toolsets: { none: {}, web: { webSearch: true, webFetch: true } },
        targets: { a: { category: "cli", provider: "claude-code" } },
        docs: { sources: { readme: "./README.md" } },
        scenarios: [
          {
            name: "Open discovery",
            prompt: "What is pickled?",
            matrix: {
              interfaces: ["a"],
              sources: ["none"],
              toolsets: ["web"],
            },
            expected: { includes: ["pickled"] },
          },
        ],
      };
      const report = await runCheck(
        { name: "t", description: "d", path },
        config,
        {
          targetFactory: () => ({
            category: "cli",
            provider: "claude-code",
            name: "open-discovery-mock",
            async run(_p, _o): Promise<TargetResult> {
              return {
                response: "pickled answer from prior knowledge",
                allResponses: [{ type: "final", text: "pickled" }],
                // Empty toolsUsed simulates the agent answering without
                // invoking any of the configured web tools.
                toolsUsed: [],
                sources: [],
                metadata: {
                  model: "mock",
                  category: "cli",
                  provider: "claude-code",
                  target: "a",
                },
              };
            },
          }),
        },
      );
      const cell = report.scenarios[0]!.cells![0]!;
      expect(cell.cell.source).toBe("none");
      expect(cell.cell.toolset).toBe("web");
      // Tool-use provenance hard-vetoes: web cell, no web tool used.
      expect(cell.answerable).toBe("NO");
      expect(cell.confidence).toBe(0);
      expect(cell.reason).toMatch(/Provenance failed/);
    });
  });
});
