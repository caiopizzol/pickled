import { describe, expect, test } from "bun:test";
import type { ResolvedDocSource } from "@pickled-dev/config";
import { buildTaskPrompt } from "../../src/targets/build-prompt.js";

const tool = { name: "my-product", description: "a dev tool", path: "/tmp/x" };

const doc: ResolvedDocSource = {
  id: "llms",
  source: "https://x.dev/llms.txt",
  content: "INSTALL: bunx my-product",
  name: "llms.txt",
  type: "url",
};

describe("buildTaskPrompt", () => {
  test("forbids weakening tests and says verification runs after", () => {
    const p = buildTaskPrompt(tool, [], null);
    expect(p).toContain(
      "Do not delete, weaken, or rewrite the project's tests",
    );
    expect(p).toContain("verification will be run");
    // No citation contract in build mode.
    expect(p).not.toContain("## Sources");
  });

  test("injects doc content when sources are provided (tools: none)", () => {
    const p = buildTaskPrompt(tool, [doc], null);
    expect(p).toContain("INSTALL: bunx my-product");
  });

  test("names a discovery hint when no docs are injected (web/mcp)", () => {
    const p = buildTaskPrompt(tool, [], "https://x.dev/llms.txt");
    expect(p).toContain("https://x.dev/llms.txt");
    expect(p).not.toContain("INSTALL: bunx my-product");
  });
});
