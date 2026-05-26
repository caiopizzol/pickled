import path from "node:path";
import {
  type DocSourceEntry,
  normalizeDocSource,
  type ResolvedDocSource,
} from "@pickled-dev/config";
import { Glob } from "bun";

const CODEBASE_SOFT_CAP_BYTES = 256 * 1024;
const CODEBASE_HARD_CAP_BYTES = 4 * 1024 * 1024;

function isUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

async function fetchUrl(
  id: string,
  url: string,
  auditTraps: boolean | string[],
): Promise<ResolvedDocSource> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch source "${id}" from ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const content = await response.text();
  return {
    id,
    source: url,
    content,
    name: new URL(url).hostname + new URL(url).pathname,
    type: "url",
    auditTraps,
  };
}

async function readFile(
  id: string,
  filePath: string,
  cwd: string,
  auditTraps: boolean | string[],
): Promise<ResolvedDocSource> {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(cwd, filePath);
  const file = Bun.file(resolved);
  if (!(await file.exists())) {
    throw new Error(`Source "${id}" not found at ${resolved}`);
  }
  const content = await file.text();
  return {
    id,
    source: filePath,
    content,
    name: path.basename(resolved),
    type: "file",
    auditTraps,
  };
}

async function loadCodebase(
  id: string,
  entry: DocSourceEntry,
  cwd: string,
  auditTraps: boolean | string[],
  onProgress?: (msg: string) => void,
): Promise<ResolvedDocSource> {
  const includeGlob = new Glob(entry.path);
  const excludeGlobs = (entry.exclude ?? []).map((p) => new Glob(p));
  const matched: string[] = [];
  for await (const rel of includeGlob.scan({
    cwd,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    if (excludeGlobs.some((g) => g.match(rel))) continue;
    matched.push(rel);
  }
  matched.sort();

  const softCap = entry.maxBytes ?? CODEBASE_SOFT_CAP_BYTES;
  const hardCap = CODEBASE_HARD_CAP_BYTES;

  const parts: string[] = [];
  let totalBytes = 0;
  for (const rel of matched) {
    const abs = path.resolve(cwd, rel);
    const text = await Bun.file(abs).text();
    const header = `// === ${rel} ===\n`;
    parts.push(header, text);
    if (!text.endsWith("\n")) parts.push("\n");
    totalBytes += header.length + text.length;
    if (totalBytes > hardCap) {
      throw new Error(
        `Codebase source "${id}" exceeded hard cap of ${hardCap} bytes (matched glob ${entry.path}). Tighten the glob; the 4 MB ceiling is fixed to protect the agent request size.`,
      );
    }
  }
  if (totalBytes > softCap) {
    onProgress?.(
      `  warn: codebase source [${id}] is ${totalBytes} bytes (soft cap ${softCap}); consider tightening the glob`,
    );
  }

  const content = parts.join("");
  return {
    id,
    source: entry.path,
    content,
    name: `${matched.length} file${matched.length === 1 ? "" : "s"} in ${entry.path}`,
    type: "codebase",
    auditTraps,
    matchedFiles: matched,
  };
}

export async function fetchSource(
  id: string,
  source: string | DocSourceEntry,
  cwd: string,
  onProgress?: (msg: string) => void,
): Promise<ResolvedDocSource> {
  const { path: srcPath, auditTraps } = normalizeDocSource(source);
  const explicitType = typeof source !== "string" ? source.type : undefined;

  if (explicitType === "codebase") {
    return loadCodebase(
      id,
      source as DocSourceEntry,
      cwd,
      auditTraps,
      onProgress,
    );
  }
  if (explicitType === "url") {
    if (!isUrl(srcPath)) {
      throw new Error(
        `Source "${id}" declares type: url but path "${srcPath}" is not an http(s) URL. Use type: file for local paths, or omit type to auto-detect.`,
      );
    }
    return fetchUrl(id, srcPath, auditTraps);
  }
  if (explicitType === "file") {
    if (isUrl(srcPath)) {
      throw new Error(
        `Source "${id}" declares type: file but path "${srcPath}" is an http(s) URL. Use type: url for remote paths, or omit type to auto-detect.`,
      );
    }
    return readFile(id, srcPath, cwd, auditTraps);
  }
  if (isUrl(srcPath)) return fetchUrl(id, srcPath, auditTraps);
  return readFile(id, srcPath, cwd, auditTraps);
}

export async function fetchAllSources(
  sources: Record<string, string | DocSourceEntry>,
  cwd: string,
  onProgress?: (msg: string) => void,
): Promise<ResolvedDocSource[]> {
  const entries = Object.entries(sources);
  const resolved = await Promise.all(
    entries.map(([id, source]) => fetchSource(id, source, cwd, onProgress)),
  );
  return resolved;
}
