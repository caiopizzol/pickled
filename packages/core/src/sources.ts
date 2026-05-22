import path from "node:path";
import {
  type DocSourceEntry,
  normalizeDocSource,
  type ResolvedDocSource,
} from "@pickled-dev/config";

function isUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

async function fetchUrl(
  id: string,
  url: string,
  auditTraps: boolean,
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
  auditTraps: boolean,
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

export async function fetchSource(
  id: string,
  source: string | DocSourceEntry,
  cwd: string,
): Promise<ResolvedDocSource> {
  const { path: srcPath, auditTraps } = normalizeDocSource(source);
  if (isUrl(srcPath)) return fetchUrl(id, srcPath, auditTraps);
  return readFile(id, srcPath, cwd, auditTraps);
}

export async function fetchAllSources(
  sources: Record<string, string | DocSourceEntry>,
  cwd: string,
): Promise<ResolvedDocSource[]> {
  const entries = Object.entries(sources);
  const resolved = await Promise.all(
    entries.map(([id, source]) => fetchSource(id, source, cwd)),
  );
  return resolved;
}
