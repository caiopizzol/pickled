import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Glob } from "bun";
import {
  type AuditConfig,
  type AuditFinding,
  type DocFile,
  type DocPair,
  resolveAuditConfig,
  type ScanResult,
} from "./schema.js";

const DOC_PATTERNS = [
  "AGENTS.md",
  "CLAUDE.md",
  "CLAUDE.local.md",
  "llms.txt",
  "llms-full.txt",
  ".claude/CLAUDE.md",
  ".claude/rules/*.md",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/CLAUDE.local.md",
  "**/llms.txt",
  "**/llms-full.txt",
  "**/.claude/CLAUDE.md",
  "**/.claude/rules/*.md",
];

export async function scan(
  partial?: Partial<AuditConfig>,
): Promise<ScanResult> {
  const config = resolveAuditConfig(partial);
  const target = resolve(config.targetRepo);
  if (!existsSync(target)) {
    throw new Error(`targetRepo does not exist: ${target}`);
  }

  const found = new Set<string>();
  for (const pattern of DOC_PATTERNS) {
    const glob = new Glob(pattern);
    for await (const p of glob.scan({
      cwd: target,
      dot: true,
      onlyFiles: false,
      followSymlinks: false,
    })) {
      if (config.ignore.some((ig) => new Glob(ig).match(p))) continue;
      const abs = join(target, p);
      const lst = lstatSync(abs);
      if (lst.isFile()) {
        found.add(p);
        continue;
      }
      if (lst.isSymbolicLink()) {
        try {
          if (statSync(abs).isFile()) found.add(p);
        } catch {
          // dangling symlink: skip
        }
      }
    }
  }

  const files: DocFile[] = [];
  for (const relPath of [...found].sort()) {
    files.push(
      await inspectFile(target, relPath, join(target, relPath), config),
    );
  }

  const pairs = classifyPairs(files, config);
  const findings = collectFindings(files, pairs, config);

  return { config, files, pairs, findings };
}

async function inspectFile(
  target: string,
  relPath: string,
  absPath: string,
  config: AuditConfig,
): Promise<DocFile> {
  const lstat = lstatSync(absPath);
  const isSymlink = lstat.isSymbolicLink();
  let symlinkTarget: string | null = null;
  let realRelPath = relPath;
  if (isSymlink) {
    const linkRaw = readlinkSync(absPath);
    const linkAbs = isAbsolute(linkRaw)
      ? linkRaw
      : resolve(dirname(absPath), linkRaw);
    symlinkTarget = linkAbs;
    if (existsSync(linkAbs)) {
      realRelPath = relative(target, linkAbs);
    }
  }

  const readPath =
    isSymlink && symlinkTarget && existsSync(symlinkTarget)
      ? symlinkTarget
      : absPath;
  const content = readFileSync(readPath, "utf8");
  const newlineCount = (content.match(/\n/g) ?? []).length;
  const lineCount = content.endsWith("\n") ? newlineCount : newlineCount + 1;

  return {
    relPath,
    absPath,
    isSymlink,
    symlinkTarget,
    realRelPath,
    lineCount,
    brokenPathRefs: findBrokenPathRefs(content, target, relPath),
    brokenImports: findBrokenImports(content, dirname(absPath)),
    unresolvedCommands: findUnresolvedCommands(
      content,
      target,
      config.knownCommands,
    ),
    sections: extractSections(content),
  };
}

function findPackageRoot(docRelPath: string): string | null {
  const parts = docRelPath.split("/");
  if (parts.length < 2) return null;
  if (parts[0] === "packages" || parts[0] === "apps" || parts[0] === "shared") {
    return `${parts[0]}/${parts[1]}`;
  }
  if (parts[0] === "tests") return parts.slice(0, 2).join("/");
  return null;
}

function findBrokenPathRefs(
  content: string,
  target: string,
  docRelPath: string,
): string[] {
  const proseOnly = stripCodeBlocks(content);
  const docDir = dirname(docRelPath);
  const pkgRoot = findPackageRoot(docRelPath);
  const refs = new Set<string>();
  const re = /`([^`\n]{2,200})`/g;
  let m: RegExpExecArray | null;
  m = re.exec(proseOnly);
  while (m !== null) {
    const candidate = m[1]!.trim().replace(/[#?].*$/, "");
    if (
      looksLikeFilesystemPath(candidate) &&
      !resolveInContext(target, candidate, docDir, pkgRoot).found
    ) {
      refs.add(candidate);
    }
    m = re.exec(proseOnly);
  }
  return [...refs].sort();
}

function resolveInContext(
  target: string,
  candidate: string,
  docDir: string,
  pkgRoot: string | null,
): { found: boolean; resolvedAs?: string } {
  const tryPaths: string[] = [candidate];
  if (docDir && docDir !== ".") tryPaths.push(`${docDir}/${candidate}`);
  if (pkgRoot) tryPaths.push(`${pkgRoot}/${candidate}`);
  tryPaths.push(
    `packages/${candidate}`,
    `apps/${candidate}`,
    `shared/${candidate}`,
  );
  for (const p of tryPaths) {
    const norm = p.replace(/\/+/g, "/");
    if (existsSync(`${target}/${norm}`)) {
      return { found: true, resolvedAs: norm };
    }
  }
  return { found: false };
}

function findBrokenImports(content: string, fileDir: string): string[] {
  const refs = new Set<string>();
  const re = /@([\w./@~-]+\.md)/g;
  let m: RegExpExecArray | null;
  m = re.exec(content);
  while (m !== null) {
    const path = m[1]!;
    if (path.startsWith("~/")) {
      m = re.exec(content);
      continue;
    }
    const resolved = path.startsWith("/") ? path : resolve(fileDir, path);
    if (!existsSync(resolved)) refs.add(path);
    m = re.exec(content);
  }
  return [...refs].sort();
}

const PACKAGE_MANAGERS = ["bun", "pnpm", "npm", "yarn"] as const;
const BUILTIN_SCRIPTS = new Set([
  "install",
  "add",
  "remove",
  "update",
  "i",
  "audit",
  "list",
  "ls",
  "why",
  "outdated",
  "exec",
  "run",
  "create",
  "init",
  "x",
]);

// AIDEV-NOTE: Per-PM built-in subcommands that are real commands, not run
// scripts. `bun build` is a Bun-specific subcommand (npm/yarn/pnpm do not
// have `build` as a built-in; for those it would be a real false positive).
// Keep this map narrow: add a name only when the PM ships it as a built-in
// subcommand and the false-positive shows up in docs.
const PM_BUILTINS: Record<string, Set<string>> = {
  bun: new Set(["build", "test", "link", "unlink", "upgrade"]),
};

function findUnresolvedCommands(
  content: string,
  target: string,
  knownCommands: string[],
): string[] {
  const refs = new Set<string>();
  const pkgJsonPath = join(target, "package.json");
  let scripts: Set<string> = new Set();
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
        scripts?: Record<string, unknown>;
      };
      scripts = new Set(Object.keys(pkg.scripts ?? {}));
    } catch {
      // ignore unparseable package.json
    }
  }
  const knownSet = new Set(knownCommands.map((c) => c.trim()));

  for (const pm of PACKAGE_MANAGERS) {
    const re = new RegExp(
      `\\b${pm}\\s+(?:run\\s+|--filter\\s+\\S+\\s+(?:run\\s+)?)?([a-zA-Z][\\w:.\\-]*)`,
      "g",
    );
    let m: RegExpExecArray | null;
    m = re.exec(content);
    while (m !== null) {
      const script = m[1]!;
      if (
        !scripts.has(script) &&
        !knownSet.has(`${pm} ${script}`) &&
        !knownSet.has(`${pm} run ${script}`) &&
        !BUILTIN_SCRIPTS.has(script) &&
        !PM_BUILTINS[pm]?.has(script)
      ) {
        refs.add(`${pm} ${script}`);
      }
      m = re.exec(content);
    }
  }
  return [...refs].sort();
}

function extractSections(
  content: string,
): Array<{ header: string; lines: number }> {
  const lines = content.split("\n");
  const sections: Array<{ header: string; lines: number }> = [];
  let cur: { header: string; start: number } | null = null;
  lines.forEach((line, i) => {
    if (/^##\s+/.test(line)) {
      if (cur) sections.push({ header: cur.header, lines: i - cur.start });
      cur = { header: line.replace(/^##\s+/, "").trim(), start: i };
    }
  });
  if (cur) {
    const final = cur as { header: string; start: number };
    sections.push({ header: final.header, lines: lines.length - final.start });
  }
  return sections.sort((a, b) => b.lines - a.lines);
}

function looksLikeFilesystemPath(s: string): boolean {
  if (s.length === 0 || s.length > 160) return false;
  if (!s.includes("/")) return false;
  if (/\s/.test(s)) return false;
  if (/^https?:\/\//.test(s)) return false;
  if (/[*?{}[\]<>]/.test(s)) return false;
  if (s.startsWith("@")) return false;
  if (s.startsWith("~/")) return false;
  if (/^[a-z]+:\/\//i.test(s)) return false;
  if (/^cdn\./.test(s) || /^unpkg\./.test(s) || /^npm\./.test(s)) return false;
  if (/^\/[a-z]/.test(s) && /(?:icon|image|img|asset|file|path)/i.test(s)) {
    return false;
  }
  if (
    /^(cd|pnpm|npm|yarn|bun|node|git|ls|cat|grep|find|sed|awk|mkdir|rm|mv|cp|echo|export|source|sudo|brew|docker|curl|wget)\b/.test(
      s,
    )
  ) {
    return false;
  }
  return /[a-zA-Z0-9_.-]\/[a-zA-Z0-9_.-]/.test(s);
}

function stripCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "");
}

function classifyPairs(files: DocFile[], config: AuditConfig): DocPair[] {
  const byDir = new Map<string, { agents?: DocFile; claude?: DocFile }>();
  for (const f of files) {
    const base = f.relPath.split("/").pop() ?? "";
    if (base !== "AGENTS.md" && base !== "CLAUDE.md") continue;
    const dir = dirname(f.relPath);
    const entry = byDir.get(dir) ?? {};
    if (base === "AGENTS.md") entry.agents = f;
    if (base === "CLAUDE.md") entry.claude = f;
    byDir.set(dir, entry);
  }

  const intentionalAllow = new Set(config.intentionalDifferentPairs);
  const pairs: DocPair[] = [];
  for (const [dir, e] of byDir) {
    const agentsExists = !!e.agents;
    const claudeExists = !!e.claude;
    if (!agentsExists && !claudeExists) continue;
    if (!agentsExists || !claudeExists) {
      pairs.push({
        dir,
        agentsExists,
        claudeExists,
        classification: "single",
        detail: agentsExists ? "only AGENTS.md" : "only CLAUDE.md",
      });
      continue;
    }
    const a = e.agents!;
    const c = e.claude!;
    const allowKey1 = `${a.relPath}:${c.relPath}`;
    const allowKey2 = `${c.relPath}:${a.relPath}`;
    if (intentionalAllow.has(allowKey1) || intentionalAllow.has(allowKey2)) {
      pairs.push({
        dir,
        agentsExists,
        claudeExists,
        classification: "intentional-different",
        detail: `allowlisted: ${a.lineCount}L vs ${c.lineCount}L`,
      });
      continue;
    }
    const linked =
      (a.isSymlink && a.symlinkTarget === c.absPath) ||
      (c.isSymlink && c.symlinkTarget === a.absPath);
    if (linked) {
      const canonical = a.isSymlink ? "CLAUDE.md" : "AGENTS.md";
      pairs.push({
        dir,
        agentsExists,
        claudeExists,
        classification: "linked",
        detail: `canonical: ${canonical}`,
      });
      continue;
    }
    const aContent = readFileSync(a.absPath, "utf8");
    const cContent = readFileSync(c.absPath, "utf8");
    if (aContent === cContent) {
      pairs.push({
        dir,
        agentsExists,
        claudeExists,
        classification: "unexpected-duplicate",
        detail: `byte-for-byte duplicate (${a.lineCount}L), not symlinked`,
      });
    } else {
      pairs.push({
        dir,
        agentsExists,
        claudeExists,
        classification: "unexpected-duplicate",
        detail: `divergent (${a.lineCount}L vs ${c.lineCount}L), not in intentional-different allowlist`,
      });
    }
  }
  pairs.sort((p, q) => p.dir.localeCompare(q.dir));
  return pairs;
}

function collectFindings(
  files: DocFile[],
  pairs: DocPair[],
  config: AuditConfig,
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const f of files) {
    if (f.isSymlink) continue;
    for (const ref of f.brokenImports) {
      findings.push({
        severity: "error",
        category: "broken-import",
        file: f.relPath,
        message: `broken @-import: ${ref}`,
      });
    }
    for (const ref of f.brokenPathRefs) {
      findings.push({
        severity: "error",
        category: "broken-path-ref",
        file: f.relPath,
        message: `broken path reference: ${ref}`,
      });
    }
    for (const cmd of f.unresolvedCommands) {
      findings.push({
        severity: "warning",
        category: "unresolved-command",
        file: f.relPath,
        message: `unresolved command: ${cmd}`,
      });
    }
    const isRoot = !f.relPath.includes("/");
    const budget = isRoot
      ? config.budgets.rootLines
      : config.budgets.nestedWarnLines;
    if (f.lineCount > budget) {
      findings.push({
        severity: "warning",
        category: "over-budget",
        file: f.relPath,
        message: `${f.lineCount} lines exceeds ${isRoot ? "root" : "nested"} budget of ${budget}`,
      });
    }
  }

  for (const p of pairs) {
    if (p.classification === "unexpected-duplicate") {
      const severity = p.detail.startsWith("divergent") ? "error" : "warning";
      findings.push({
        severity,
        category: severity === "error" ? "divergent-pair" : "duplicate-pair",
        file: p.dir || "(root)",
        message: `AGENTS.md / CLAUDE.md ${p.detail}`,
      });
    }
  }

  return findings;
}
