import path from "node:path";
import type { ResolvedSource, Source } from "@pickled-dev/config";
import { Glob } from "bun";

const CODEBASE_SOFT_CAP_BYTES = 256 * 1024;
const CODEBASE_HARD_CAP_BYTES = 4 * 1024 * 1024;

async function fetchUrl(id: string, url: string): Promise<ResolvedSource> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch source "${id}" from ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const content = await response.text();
  return {
    id,
    type: "url",
    source: url,
    content,
    name: new URL(url).hostname + new URL(url).pathname,
  };
}

async function readFile(
  id: string,
  filePath: string,
  cwd: string,
): Promise<ResolvedSource> {
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
    type: "file",
    source: filePath,
    content,
    name: path.basename(resolved),
  };
}

async function loadCodebase(
  id: string,
  src: { path: string; exclude?: string[]; maxBytes?: number },
  cwd: string,
  onProgress?: (msg: string) => void,
): Promise<ResolvedSource> {
  const includeGlob = new Glob(src.path);
  const excludeGlobs = (src.exclude ?? []).map((p) => new Glob(p));
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

  const softCap = src.maxBytes ?? CODEBASE_SOFT_CAP_BYTES;
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
        `Codebase source "${id}" exceeded hard cap of ${hardCap} bytes (matched glob ${src.path}). Tighten the glob; the 4 MB ceiling is fixed to protect the agent request size.`,
      );
    }
  }
  if (totalBytes > softCap) {
    onProgress?.(
      `  warn: codebase source [${id}] is ${totalBytes} bytes (soft cap ${softCap}); consider tightening the glob`,
    );
  }

  return {
    id,
    type: "codebase",
    source: src.path,
    content: parts.join(""),
    name: `${matched.length} file${matched.length === 1 ? "" : "s"} in ${src.path}`,
    matchedFiles: matched,
  };
}

/**
 * Load one registered source to its content. The source kind is authoritative
 * (set by the validator), so there is no auto-detect or type-mismatch path.
 */
export async function fetchSource(
  id: string,
  source: Source,
  cwd: string,
  onProgress?: (msg: string) => void,
): Promise<ResolvedSource> {
  switch (source.kind) {
    case "url":
      return fetchUrl(id, source.url);
    case "file":
      return readFile(id, source.path, cwd);
    case "codebase":
      return loadCodebase(id, source, cwd, onProgress);
  }
}

export async function fetchAllSources(
  sources: Record<string, Source>,
  cwd: string,
  onProgress?: (msg: string) => void,
): Promise<ResolvedSource[]> {
  const entries = Object.entries(sources);
  return Promise.all(
    entries.map(([id, source]) => fetchSource(id, source, cwd, onProgress)),
  );
}
