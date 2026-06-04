import { describe, expect, test } from "bun:test";
import type { PublicConfig } from "../src/public-types.js";
import { resolvePublicConfig, validatePublicConfig } from "../src/transform.js";

/** A minimal valid v2 config. Tests clone and mutate one thing at a time. */
function base(): PublicConfig {
  return {
    schemaVersion: 2,
    product: { name: "pickled", description: "Agent legibility checker" },
    sources: { docs: { url: "https://example.com/llms.txt" } },
    agents: {
      quick: { provider: "claude-code", model: "claude-haiku-4-5" },
      api: { provider: "openai", model: "gpt-5.2" },
    },
    contexts: {
      memory: { mode: "memory" },
      injected: { mode: "inject", source: "docs" },
      web: { mode: "web" },
    },
    facts: {
      install: { statement: "install cmd", match: { allOf: ["bunx pickled"] } },
    },
    misstatements: {
      npm: {
        statement: "npm install",
        match: { anyOf: ["npm install pickled"] },
      },
    },
    questions: [
      {
        id: "positioning",
        question: "what does it do?",
        agents: ["quick"],
        contexts: ["memory", "injected"],
        expects: ["install"],
      },
    ],
  };
}

function first<T>(arr: T[] | undefined): T {
  const v = arr?.[0];
  if (v === undefined)
    throw new Error("test fixture: expected a non-empty array");
  return v;
}

function buildTask(): NonNullable<PublicConfig["builds"]>[number] {
  return {
    id: "toolbar",
    goal: "Add a toolbar.",
    agents: ["quick"],
    contexts: ["injected"],
    workspace: { path: "./fixtures/app", setup: ["bun install"] },
    verifier: { failToPass: [{ name: "tb", run: "bun test" }] },
    trials: 3,
  };
}

describe("validatePublicConfig - shape", () => {
  test("accepts the base config", () => {
    expect(() => validatePublicConfig(base())).not.toThrow();
  });

  test("requires schemaVersion: 2", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    (pub as any).schemaVersion = undefined;
    expect(() => validatePublicConfig(pub)).toThrow(/schemaVersion: 2/);
  });

  test("rejects v1 top-level keys with a migration hint", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: old-schema config
    (pub as any).tasks = [];
    expect(() => validatePublicConfig(pub)).toThrow(/"tasks" is a v1 key/);
  });

  test("rejects an unknown top-level key", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    (pub as any).widgets = {};
    expect(() => validatePublicConfig(pub)).toThrow(/unknown top-level key/);
  });

  test("requires product.name and product.description", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    (pub as any).product = { name: "x" };
    expect(() => validatePublicConfig(pub)).toThrow(/product.description/);
  });

  test("requires at least one question or build", () => {
    const pub = base();
    pub.questions = [];
    expect(() => validatePublicConfig(pub)).toThrow(
      /at least one non-empty 'questions' or 'builds'/,
    );
  });
});

describe("validatePublicConfig - sources", () => {
  test("rejects a source with no kind", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.sources = { docs: {} as any };
    expect(() => validatePublicConfig(pub)).toThrow(/exactly one of url/);
  });

  test("rejects a source with two kinds", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.sources = { docs: { url: "https://x", path: "./y" } as any };
    expect(() => validatePublicConfig(pub)).toThrow(/exactly one of url/);
  });

  test("rejects exclude/maxBytes on a non-codebase source", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.sources = { docs: { path: "./x", exclude: ["y"] } as any };
    expect(() => validatePublicConfig(pub)).toThrow(/unknown field "exclude"/);
  });

  test("accepts a codebase source with exclude + maxBytes", () => {
    const pub = base();
    pub.sources = {
      code: { codebase: "./src/**", exclude: ["**/*.test.ts"], maxBytes: 1000 },
    };
    pub.contexts = {
      memory: { mode: "memory" },
      injected: { mode: "inject", source: "code" },
    };
    expect(() => validatePublicConfig(pub)).not.toThrow();
  });
});

describe("validatePublicConfig - agents", () => {
  test("rejects an unknown provider", () => {
    const pub = base();
    pub.agents.quick = { provider: "mistral", model: "x" };
    expect(() => validatePublicConfig(pub)).toThrow(/needs a provider/);
  });

  test("rejects maxTurns on an API agent", () => {
    const pub = base();
    pub.agents.api = { provider: "openai", model: "gpt-5.2", maxTurns: 5 };
    expect(() => validatePublicConfig(pub)).toThrow(/maxTurns does not apply/);
  });

  test("rejects maxTurns on codex-cli", () => {
    const pub = base();
    pub.agents.cx = {
      provider: "codex-cli",
      model: "gpt-5-codex",
      maxTurns: 5,
    };
    expect(() => validatePublicConfig(pub)).toThrow(
      /codex-cli\) does not support maxTurns/,
    );
  });
});

describe("validatePublicConfig - contexts", () => {
  test("memory cannot declare a source", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.contexts.memory = { mode: "memory", source: "docs" } as any;
    expect(() => validatePublicConfig(pub)).toThrow(/memory\) cannot declare/);
  });

  test("inject requires a source", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.contexts.injected = { mode: "inject" } as any;
    expect(() => validatePublicConfig(pub)).toThrow(
      /inject\) requires a source/,
    );
  });

  test("web source is optional (open discovery)", () => {
    const pub = base();
    pub.contexts.web = { mode: "web" };
    expect(() => validatePublicConfig(pub)).not.toThrow();
  });

  test("mcp requires a servers map", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.contexts.m = { mode: "mcp" } as any;
    expect(() => validatePublicConfig(pub)).toThrow(
      /mcp\) requires a non-empty/,
    );
  });

  test("mcp server needs an http url", () => {
    const pub = base();
    pub.contexts.m = {
      mode: "mcp",
      servers: { s: { url: "ftp://nope" } },
    };
    expect(() => validatePublicConfig(pub)).toThrow(/needs an http\(s\) 'url'/);
  });

  test("rejects non-string mcp headers", () => {
    const pub = base();
    pub.contexts.m = {
      mode: "mcp",
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
      servers: { s: { url: "https://x", headers: { A: 1 as any } } },
    };
    expect(() => validatePublicConfig(pub)).toThrow(
      /headers.A must be a string/,
    );
  });

  test("rejects a context referencing an unknown source", () => {
    const pub = base();
    pub.contexts.injected = { mode: "inject", source: "ghost" };
    expect(() => validatePublicConfig(pub)).toThrow(/unknown source "ghost"/);
  });
});

describe("validatePublicConfig - facts/misstatements", () => {
  test("rejects a match with neither allOf nor anyOf", () => {
    const pub = base();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    pub.facts = { f: { statement: "s", match: {} as any } };
    first(pub.questions).expects = ["f"];
    expect(() => validatePublicConfig(pub)).toThrow(/at least one of allOf/);
  });

  test("rejects an unknown field in match", () => {
    const pub = base();
    pub.facts = {
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
      f: { statement: "s", match: { allOf: ["x"], oops: 1 } as any },
    };
    first(pub.questions).expects = ["f"];
    expect(() => validatePublicConfig(pub)).toThrow(/has unknown field "oops"/);
  });
});

describe("validatePublicConfig - questions", () => {
  test("requires at least one of expects/rejects", () => {
    const pub = base();
    first(pub.questions).expects = [];
    first(pub.questions).rejects = [];
    expect(() => validatePublicConfig(pub)).toThrow(
      /at least one of expects \/ rejects/,
    );
  });

  test("rejects an unknown fact id in expects", () => {
    const pub = base();
    first(pub.questions).expects = ["ghost"];
    expect(() => validatePublicConfig(pub)).toThrow(
      /unknown fact \(expects\) "ghost"/,
    );
  });

  test("rejects an unknown misstatement id in rejects", () => {
    const pub = base();
    first(pub.questions).rejects = ["ghost"];
    first(pub.questions).examples = { pass: ["a"], fail: ["b"] };
    expect(() => validatePublicConfig(pub)).toThrow(
      /unknown misstatement \(rejects\) "ghost"/,
    );
  });

  test("a question with rejects requires non-empty examples.pass AND .fail", () => {
    const pub = base();
    first(pub.questions).rejects = ["npm"];
    first(pub.questions).examples = { pass: ["a"] };
    expect(() => validatePublicConfig(pub)).toThrow(
      /needs non-empty examples.pass AND examples.fail/,
    );
  });

  test("accepts a question with rejects when both example sides exist", () => {
    const pub = base();
    first(pub.questions).rejects = ["npm"];
    first(pub.questions).examples = {
      pass: ["bunx pickled"],
      fail: ["npm install pickled"],
    };
    expect(() => validatePublicConfig(pub)).not.toThrow();
  });

  test("rejects duplicate task ids", () => {
    const pub = base();
    pub.builds = [{ ...buildTask(), id: "positioning" }];
    expect(() => validatePublicConfig(pub)).toThrow(/duplicate task id/);
  });
});

describe("validatePublicConfig - builds", () => {
  test("accepts a valid build", () => {
    const pub = base();
    pub.builds = [buildTask()];
    expect(() => validatePublicConfig(pub)).not.toThrow();
  });

  test("rejects a build on a non-edit-capable agent", () => {
    const pub = base();
    pub.builds = [{ ...buildTask(), agents: ["api"] }];
    expect(() => validatePublicConfig(pub)).toThrow(/cannot run builds/);
  });

  test("requires verifier.failToPass", () => {
    const pub = base();
    const b = buildTask();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    b.verifier = { failToPass: [] } as any;
    pub.builds = [b];
    expect(() => validatePublicConfig(pub)).toThrow(
      /failToPass needs at least one/,
    );
  });

  test("rejects trials < 1", () => {
    const pub = base();
    pub.builds = [{ ...buildTask(), trials: 0 }];
    expect(() => validatePublicConfig(pub)).toThrow(
      /trials must be a positive/,
    );
  });

  test("accepts referenceSolution.patch", () => {
    const pub = base();
    pub.builds = [
      { ...buildTask(), referenceSolution: { patch: "./fix.patch" } },
    ];
    expect(() => validatePublicConfig(pub)).not.toThrow();
  });
});

describe("validatePublicConfig - thresholds", () => {
  test("rejects threshold 0", () => {
    const pub = base();
    pub.thresholds = { questions: 0 };
    expect(() => validatePublicConfig(pub)).toThrow(/between 1 and 100/);
  });

  test("accepts 1-100", () => {
    const pub = base();
    pub.thresholds = { questions: 80, builds: 100 };
    expect(() => validatePublicConfig(pub)).not.toThrow();
  });
});

describe("resolvePublicConfig - normalization", () => {
  test("resolves agents to Target with inferred category", () => {
    const c = resolvePublicConfig(base());
    expect(c.agents.quick?.category).toBe("cli");
    expect(c.agents.api?.category).toBe("api");
  });

  test("resolves sources to discriminated kinds", () => {
    const pub = base();
    pub.sources = {
      u: { url: "https://x" },
      f: { path: "./y" },
      c: { codebase: "./src/**" },
    };
    pub.contexts = { memory: { mode: "memory" } };
    first(pub.questions).contexts = ["memory"];
    const c = resolvePublicConfig(pub);
    expect(c.sources.u).toEqual({ kind: "url", url: "https://x" });
    expect(c.sources.f).toEqual({ kind: "file", path: "./y" });
    expect(c.sources.c?.kind).toBe("codebase");
  });

  test("resolves contexts to discriminated modes", () => {
    const c = resolvePublicConfig(base());
    expect(c.contexts.memory).toEqual({ mode: "memory" });
    expect(c.contexts.injected).toEqual({ mode: "inject", source: "docs" });
    expect(c.contexts.web).toEqual({ mode: "web" });
  });

  test("mcp context resolves servers with http transport", () => {
    const pub = base();
    pub.contexts.m = {
      mode: "mcp",
      source: "docs",
      servers: { s: { url: "https://mcp.x", headers: { K: "v" } } },
    };
    first(pub.questions).contexts = ["m"];
    const c = resolvePublicConfig(pub);
    const ctx = c.contexts.m;
    expect(ctx?.mode).toBe("mcp");
    if (ctx?.mode === "mcp") {
      expect(ctx.servers.s).toEqual({
        type: "http",
        url: "https://mcp.x",
        headers: { K: "v" },
      });
    }
  });

  test("applies question defaults (expects/rejects empty arrays)", () => {
    const pub = base();
    first(pub.questions).expects = ["install"];
    delete first(pub.questions).rejects;
    const c = resolvePublicConfig(pub);
    expect(first(c.questions).expects).toEqual(["install"]);
    expect(first(c.questions).rejects).toEqual([]);
  });

  test("applies build defaults (trials 1, requires [], passToPass [], command name)", () => {
    const pub = base();
    const b = buildTask();
    b.trials = undefined;
    b.verifier = { failToPass: [{ run: "bun test" }] };
    pub.builds = [b];
    const c = resolvePublicConfig(pub);
    const build = first(c.builds);
    expect(build.trials).toBe(1);
    expect(build.requires).toEqual([]);
    expect(build.verifier.passToPass).toEqual([]);
    expect(build.verifier.failToPass[0]).toEqual({
      name: "bun test",
      run: "bun test",
    });
    expect(build.workspace.setup).toEqual(["bun install"]);
  });

  test("resolves thresholds (undefined when absent)", () => {
    const c = resolvePublicConfig(base());
    expect(c.thresholds).toEqual({ questions: undefined, builds: undefined });
  });
});
