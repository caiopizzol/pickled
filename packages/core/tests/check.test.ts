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
