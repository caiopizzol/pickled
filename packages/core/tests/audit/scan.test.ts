import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  renderAuditMarkdown,
  renderAuditTerminal,
  scan,
} from "../../src/audit/index.js";

const FIXTURE = join(import.meta.dir, "fixture");

describe("audit scan", () => {
  test("detects AGENTS.md in target", async () => {
    const result = await scan({ targetRepo: FIXTURE });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.relPath).toBe("AGENTS.md");
  });

  test("flags broken path reference", async () => {
    const result = await scan({ targetRepo: FIXTURE });
    const findings = result.findings.filter(
      (f) => f.category === "broken-path-ref",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.message.includes("does/not/exist.ts"))).toBe(
      true,
    );
  });

  test("flags broken @-import", async () => {
    const result = await scan({ targetRepo: FIXTURE });
    const findings = result.findings.filter(
      (f) => f.category === "broken-import",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.message.includes("missing.md"))).toBe(true);
  });

  test("does not flag valid path reference", async () => {
    const result = await scan({ targetRepo: FIXTURE });
    const findings = result.findings.filter(
      (f) =>
        f.category === "broken-path-ref" && f.message.includes("package.json"),
    );
    expect(findings).toHaveLength(0);
  });

  test("flags unresolved package-manager command as warning", async () => {
    const result = await scan({ targetRepo: FIXTURE });
    const findings = result.findings.filter(
      (f) => f.category === "unresolved-command",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.severity === "warning")).toBe(true);
    expect(findings.some((f) => f.message.includes("test:fake"))).toBe(true);
  });

  test("does not flag bun built-in subcommands like bun build", async () => {
    const result = await scan({ targetRepo: FIXTURE });
    const findings = result.findings.filter(
      (f) => f.category === "unresolved-command",
    );
    expect(findings.some((f) => f.message.includes("bun build"))).toBe(false);
  });

  test("still flags non-bun PMs that lack a build built-in", async () => {
    const result = await scan({ targetRepo: FIXTURE });
    const findings = result.findings.filter(
      (f) => f.category === "unresolved-command",
    );
    expect(findings.some((f) => f.message.includes("npm build"))).toBe(true);
  });

  test("renders markdown without throwing on empty target", async () => {
    const result = await scan({ targetRepo: import.meta.dir });
    const md = renderAuditMarkdown(result);
    expect(md).toContain("Agent-context audit");
  });

  test("terminal renderer produces plain text without markdown table chrome", async () => {
    const result = await scan({ targetRepo: FIXTURE });
    const out = renderAuditTerminal(result);
    expect(out).toContain("pickled audit");
    expect(out).toContain("Inventory");
    expect(out).toContain("Broken references");
    // No markdown table syntax in default terminal output
    expect(out).not.toMatch(/^\|/m);
    expect(out).not.toMatch(/^\|---/m);
    // No markdown headers
    expect(out).not.toMatch(/^#+ /m);
  });

  test("terminal and markdown renderers carry the same findings", async () => {
    const result = await scan({ targetRepo: FIXTURE });
    const terminal = renderAuditTerminal(result);
    const markdown = renderAuditMarkdown(result);
    // Both should mention the broken path reference fixture
    expect(terminal).toContain("does/not/exist.ts");
    expect(markdown).toContain("does/not/exist.ts");
  });

  test("errors are severity=error, budget warnings are severity=warning", async () => {
    const result = await scan({ targetRepo: FIXTURE });
    const errors = result.findings.filter((f) => f.severity === "error");
    const warnings = result.findings.filter((f) => f.severity === "warning");
    expect(errors.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
