import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  baselineWorkspace,
  captureDiff,
  cleanupWorkspace,
  createWorkspace,
  parseNameStatus,
  runProcess,
  runSetup,
  SetupError,
} from "../../src/implement/workspace.js";

const created: string[] = [];

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pickled-fixture-"));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

afterEach(() => {
  for (const d of created.splice(0))
    rmSync(d, { recursive: true, force: true });
});

describe("workspace", () => {
  test("createWorkspace copies the fixture into a fresh dir", async () => {
    const fixture = makeFixture({ "a.txt": "hello\n" });
    const ws = await createWorkspace(fixture);
    created.push(ws.dir);
    expect(ws.dir).not.toBe(fixture);
    expect(existsSync(join(ws.dir, "a.txt"))).toBe(true);
  });

  test("captureDiff reports a modified file against the baseline", async () => {
    const fixture = makeFixture({ "a.txt": "hello\n" });
    const ws = await createWorkspace(fixture);
    created.push(ws.dir);
    await baselineWorkspace(ws);
    writeFileSync(join(ws.dir, "a.txt"), "hello\nworld\n");
    const diff = await captureDiff(ws);
    expect(diff.changedFiles).toEqual([{ status: "M", path: "a.txt" }]);
    expect(diff.diff).toContain("world");
  });

  test("captureDiff reports an added file", async () => {
    const fixture = makeFixture({ "a.txt": "hello\n" });
    const ws = await createWorkspace(fixture);
    created.push(ws.dir);
    await baselineWorkspace(ws);
    mkdirSync(join(ws.dir, "src"), { recursive: true });
    writeFileSync(join(ws.dir, "src", "new.tsx"), "export const x = 1;\n");
    const diff = await captureDiff(ws);
    expect(diff.changedFiles).toEqual([{ status: "A", path: "src/new.tsx" }]);
  });

  test("captureDiff is empty when the agent changes nothing", async () => {
    const fixture = makeFixture({ "a.txt": "hello\n" });
    const ws = await createWorkspace(fixture);
    created.push(ws.dir);
    await baselineWorkspace(ws);
    const diff = await captureDiff(ws);
    expect(diff.changedFiles).toEqual([]);
    expect(diff.diff).toBe("");
  });

  test("runSetup resolves when every command exits 0", async () => {
    const fixture = makeFixture({ "a.txt": "hi\n" });
    const ws = await createWorkspace(fixture);
    created.push(ws.dir);
    await expect(runSetup(ws, ["true", "echo ready"])).resolves.toBeUndefined();
  });

  test("runSetup throws SetupError on the first non-zero exit", async () => {
    const fixture = makeFixture({ "a.txt": "hi\n" });
    const ws = await createWorkspace(fixture);
    created.push(ws.dir);
    let err: unknown;
    try {
      await runSetup(ws, ["exit 3"]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SetupError);
    expect((err as SetupError).result.exitCode).toBe(3);
  });

  test("cleanupWorkspace removes the dir by default", async () => {
    const fixture = makeFixture({ "a.txt": "hi\n" });
    const ws = await createWorkspace(fixture);
    const res = await cleanupWorkspace(ws);
    expect(res.kept).toBe(false);
    expect(existsSync(ws.dir)).toBe(false);
  });

  test("cleanupWorkspace keeps the dir on failure when asked", async () => {
    const fixture = makeFixture({ "a.txt": "hi\n" });
    const ws = await createWorkspace(fixture);
    created.push(ws.dir);
    const res = await cleanupWorkspace(ws, {
      keepOnFailure: true,
      failed: true,
    });
    expect(res.kept).toBe(true);
    expect(existsSync(ws.dir)).toBe(true);
  });

  test("setup output is baselined and absent from the agent diff", async () => {
    const ws = await createWorkspace(makeFixture({ "a.txt": "hi\n" }));
    created.push(ws.dir);
    await runSetup(ws, ["echo generated > artifact.txt"]);
    await baselineWorkspace(ws);
    const diff = await captureDiff(ws);
    expect(diff.changedFiles).toEqual([]);
    expect(diff.diff).toBe("");
  });

  test("captureDiff throws when the git repo is broken", async () => {
    const ws = await createWorkspace(makeFixture({ "a.txt": "hi\n" }));
    created.push(ws.dir);
    rmSync(join(ws.dir, ".git"), { recursive: true, force: true });
    let err: unknown;
    try {
      await captureDiff(ws);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("git add");
  });

  test("runProcess times out and reports exit 124", async () => {
    const ws = await createWorkspace(makeFixture({ "a.txt": "hi\n" }));
    created.push(ws.dir);
    const r = await runProcess(["sh", "-c", "sleep 5"], {
      cwd: ws.dir,
      timeoutMs: 200,
    });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBe(124);
  });
});

describe("parseNameStatus", () => {
  const tab = String.fromCharCode(9);
  const nl = String.fromCharCode(10);

  test("normalizes modify, add, delete, and rename", () => {
    const out = `${[
      `M${tab}src/a.ts`,
      `A${tab}src/b.ts`,
      `D${tab}src/c.ts`,
      `R100${tab}old.txt${tab}new.txt`,
    ].join(nl)}${nl}`;
    expect(parseNameStatus(out)).toEqual([
      { status: "M", path: "src/a.ts" },
      { status: "A", path: "src/b.ts" },
      { status: "D", path: "src/c.ts" },
      { status: "R", path: "new.txt", oldPath: "old.txt" },
    ]);
  });

  test("keeps paths that contain spaces", () => {
    expect(parseNameStatus(`M${tab}src/my file.tsx${nl}`)).toEqual([
      { status: "M", path: "src/my file.tsx" },
    ]);
  });
});
