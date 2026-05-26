import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const parent = abs.slice(0, abs.lastIndexOf("/"));
    mkdirSync(parent, { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

describe("fetchSource codebase loader", () => {
  test("expands a glob into a single source with matched files listed", async () => {
    const dir = makeRepo({
      "src/a.ts": "alpha",
      "src/b.ts": "beta",
      "src/c.txt": "gamma",
    });
    const res = await fetchSource(
      "code",
      { type: "codebase", path: "src/**/*.ts" },
      dir,
    );
    expect(res.type).toBe("codebase");
    expect(res.matchedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(res.content).toContain("alpha");
    expect(res.content).toContain("beta");
    expect(res.content).not.toContain("gamma");
  });

  test("sorts matched files lexicographically (determinism)", async () => {
    const dir = makeRepo({
      "z.ts": "zzz",
      "a.ts": "aaa",
      "m.ts": "mmm",
    });
    const res = await fetchSource(
      "code",
      { type: "codebase", path: "*.ts" },
      dir,
    );
    expect(res.matchedFiles).toEqual(["a.ts", "m.ts", "z.ts"]);
    // Content order follows the sorted list (a comes before m comes before z)
    const aIdx = res.content.indexOf("aaa");
    const mIdx = res.content.indexOf("mmm");
    const zIdx = res.content.indexOf("zzz");
    expect(aIdx).toBeLessThan(mIdx);
    expect(mIdx).toBeLessThan(zIdx);
  });

  test("concatenates with file-separator headers", async () => {
    const dir = makeRepo({
      "x.ts": "X content",
    });
    const res = await fetchSource(
      "code",
      { type: "codebase", path: "*.ts" },
      dir,
    );
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
      {
        type: "codebase",
        path: "src/**/*.ts",
        exclude: ["**/*.test.ts", "**/*.spec.ts"],
      },
      dir,
    );
    expect(res.matchedFiles).toEqual(["src/lib.ts"]);
  });

  test("hard cap throws to prevent accidental multi-megabyte prompts", async () => {
    const big = "x".repeat(200 * 1024); // 200KB per file
    const dir = makeRepo({
      "a.ts": big,
      "b.ts": big,
      "c.ts": big,
      "d.ts": big,
      "e.ts": big,
      "f.ts": big,
      "g.ts": big,
      "h.ts": big,
      "i.ts": big,
      "j.ts": big,
      "k.ts": big,
      "l.ts": big,
      "m.ts": big,
      "n.ts": big,
      "o.ts": big,
      "p.ts": big,
      "q.ts": big,
      "r.ts": big,
      "s.ts": big,
      "t.ts": big,
      "u.ts": big,
      // 21 files × 200KB = 4.2MB, exceeds hard cap 4MB
    });
    await expect(
      fetchSource(
        "code",
        { type: "codebase", path: "*.ts", maxBytes: 4 * 1024 * 1024 },
        dir,
      ),
    ).rejects.toThrow(/exceeded hard cap/);
  });

  test("soft cap emits progress warning but still loads", async () => {
    const dir = makeRepo({
      "a.ts": "x".repeat(200 * 1024),
      "b.ts": "x".repeat(200 * 1024),
    });
    const messages: string[] = [];
    const res = await fetchSource(
      "code",
      { type: "codebase", path: "*.ts" },
      dir,
      (m) => messages.push(m),
    );
    expect(res.matchedFiles).toHaveLength(2);
    expect(messages.some((m) => m.includes("soft cap"))).toBe(true);
  });

  test("name reflects matched count", async () => {
    const dir = makeRepo({ "a.ts": "x", "b.ts": "y" });
    const res = await fetchSource(
      "code",
      { type: "codebase", path: "*.ts" },
      dir,
    );
    expect(res.name).toBe("2 files in *.ts");
  });

  test("name uses singular when one file matches", async () => {
    const dir = makeRepo({ "only.ts": "x" });
    const res = await fetchSource(
      "code",
      { type: "codebase", path: "*.ts" },
      dir,
    );
    expect(res.name).toBe("1 file in *.ts");
  });

  test("returns empty content and zero matched files when glob matches nothing", async () => {
    const dir = makeRepo({ "irrelevant.md": "x" });
    const res = await fetchSource(
      "code",
      { type: "codebase", path: "*.ts" },
      dir,
    );
    expect(res.matchedFiles).toEqual([]);
    expect(res.content).toBe("");
  });
});

describe("fetchSource explicit type", () => {
  test("type: file rejects an http URL path", async () => {
    const dir = makeRepo({ "x.md": "x" });
    await expect(
      fetchSource(
        "remote",
        { type: "file", path: "https://example.com/x.md" },
        dir,
      ),
    ).rejects.toThrow(/type: file but path .* is an http\(s\) URL/);
  });

  test("type: url rejects a local file path", async () => {
    const dir = makeRepo({ "x.md": "x" });
    await expect(
      fetchSource("local", { type: "url", path: "./x.md" }, dir),
    ).rejects.toThrow(/type: url but path .* is not an http\(s\) URL/);
  });

  test("type: file loads a local file", async () => {
    const dir = makeRepo({ "readme.md": "hello" });
    const res = await fetchSource(
      "doc",
      { type: "file", path: "readme.md" },
      dir,
    );
    expect(res.type).toBe("file");
    expect(res.content).toBe("hello");
  });

  test("omitted type still auto-detects", async () => {
    const dir = makeRepo({ "readme.md": "auto" });
    const res = await fetchSource("doc", { path: "readme.md" }, dir);
    expect(res.type).toBe("file");
    expect(res.content).toBe("auto");
  });
});

describe("fetchAllSources onProgress threading", () => {
  test("forwards onProgress to per-source loaders (codebase soft-cap warning surfaces)", async () => {
    const dir = makeRepo({
      "big-a.ts": "x".repeat(200 * 1024),
      "big-b.ts": "x".repeat(200 * 1024),
      "readme.md": "hello",
    });
    const messages: string[] = [];
    const sources = {
      code: { type: "codebase" as const, path: "*.ts" },
      readme: "readme.md",
    };
    await fetchAllSources(sources, dir, (m) => messages.push(m));
    expect(messages.some((m) => m.includes("soft cap"))).toBe(true);
  });
});
