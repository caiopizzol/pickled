import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Source } from "@pickled-dev/config";
import { fetchAllSources, fetchSource } from "../src/sources.js";

const created: string[] = [];

afterEach(() => {
  for (const d of created.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pickled-sources-"));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

function codebase(path: string, extra: Partial<Source> = {}): Source {
  return { kind: "codebase", path, ...extra } as Source;
}

describe("fetchSource codebase loader", () => {
  test("expands a glob into a single source with matched files listed", async () => {
    const dir = makeRepo({
      "src/a.ts": "alpha",
      "src/b.ts": "beta",
      "src/c.txt": "gamma",
    });
    const res = await fetchSource("code", codebase("src/**/*.ts"), dir);
    expect(res.type).toBe("codebase");
    expect(res.matchedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(res.content).toContain("alpha");
    expect(res.content).toContain("beta");
    expect(res.content).not.toContain("gamma");
  });

  test("sorts matched files lexicographically (determinism)", async () => {
    const dir = makeRepo({ "z.ts": "zzz", "a.ts": "aaa", "m.ts": "mmm" });
    const res = await fetchSource("code", codebase("*.ts"), dir);
    expect(res.matchedFiles).toEqual(["a.ts", "m.ts", "z.ts"]);
    expect(res.content.indexOf("aaa")).toBeLessThan(res.content.indexOf("mmm"));
    expect(res.content.indexOf("mmm")).toBeLessThan(res.content.indexOf("zzz"));
  });

  test("concatenates with file-separator headers", async () => {
    const dir = makeRepo({ "x.ts": "X content" });
    const res = await fetchSource("code", codebase("*.ts"), dir);
    expect(res.content).toContain("// === x.ts ===");
  });

  test("exclude list filters matched files", async () => {
    const dir = makeRepo({
      "src/lib.ts": "lib",
      "src/lib.test.ts": "test",
      "src/util.spec.ts": "spec",
    });
    const res = await fetchSource(
      "code",
      codebase("src/**/*.ts", { exclude: ["**/*.test.ts", "**/*.spec.ts"] }),
      dir,
    );
    expect(res.matchedFiles).toEqual(["src/lib.ts"]);
  });

  test("hard cap throws to prevent accidental multi-megabyte prompts", async () => {
    const big = "x".repeat(200 * 1024);
    const files: Record<string, string> = {};
    for (const c of "abcdefghijklmnopqrstu") files[`${c}.ts`] = big; // 21 × 200KB > 4MB
    const dir = makeRepo(files);
    await expect(
      fetchSource("code", codebase("*.ts", { maxBytes: 4 * 1024 * 1024 }), dir),
    ).rejects.toThrow(/exceeded hard cap/);
  });

  test("soft cap emits progress warning but still loads", async () => {
    const dir = makeRepo({
      "a.ts": "x".repeat(200 * 1024),
      "b.ts": "x".repeat(200 * 1024),
    });
    const messages: string[] = [];
    const res = await fetchSource("code", codebase("*.ts"), dir, (m) =>
      messages.push(m),
    );
    expect(res.matchedFiles).toHaveLength(2);
    expect(messages.some((m) => m.includes("soft cap"))).toBe(true);
  });

  test("name reflects matched count (plural / singular)", async () => {
    const two = await fetchSource(
      "code",
      codebase("*.ts"),
      makeRepo({ "a.ts": "x", "b.ts": "y" }),
    );
    expect(two.name).toBe("2 files in *.ts");
    const one = await fetchSource(
      "code",
      codebase("*.ts"),
      makeRepo({ "only.ts": "x" }),
    );
    expect(one.name).toBe("1 file in *.ts");
  });

  test("empty content + zero matches when glob matches nothing", async () => {
    const dir = makeRepo({ "irrelevant.md": "x" });
    const res = await fetchSource("code", codebase("*.ts"), dir);
    expect(res.matchedFiles).toEqual([]);
    expect(res.content).toBe("");
  });
});

describe("fetchSource file + url", () => {
  test("file kind loads a local file", async () => {
    const dir = makeRepo({ "readme.md": "hello" });
    const res = await fetchSource(
      "doc",
      { kind: "file", path: "readme.md" },
      dir,
    );
    expect(res.type).toBe("file");
    expect(res.content).toBe("hello");
    expect(res.name).toBe("readme.md");
  });

  test("file kind throws when the file is missing", async () => {
    const dir = makeRepo({});
    await expect(
      fetchSource("doc", { kind: "file", path: "nope.md" }, dir),
    ).rejects.toThrow(/not found/);
  });
});

describe("fetchAllSources onProgress threading", () => {
  test("forwards onProgress to per-source loaders (codebase soft-cap warning)", async () => {
    const dir = makeRepo({
      "big-a.ts": "x".repeat(200 * 1024),
      "big-b.ts": "x".repeat(200 * 1024),
      "readme.md": "hello",
    });
    const messages: string[] = [];
    const sources: Record<string, Source> = {
      code: { kind: "codebase", path: "*.ts" },
      readme: { kind: "file", path: "readme.md" },
    };
    await fetchAllSources(sources, dir, (m) => messages.push(m));
    expect(messages.some((m) => m.includes("soft cap"))).toBe(true);
  });
});
