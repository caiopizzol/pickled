import path from "node:path";
import type { ResolvedDocSource } from "@pickled-dev/config";

function isUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

async function fetchUrl(id: string, url: string): Promise<ResolvedDocSource> {
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
  };
}

async function readFile(
  id: string,
  filePath: string,
  cwd: string,
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
  };
}

export async function fetchSource(
  id: string,
  source: string,
  cwd: string,
): Promise<ResolvedDocSource> {
  if (isUrl(source)) return fetchUrl(id, source);
  return readFile(id, source, cwd);
}

export async function fetchAllSources(
  sources: Record<string, string>,
  cwd: string,
): Promise<ResolvedDocSource[]> {
  const entries = Object.entries(sources);
  const resolved = await Promise.all(
    entries.map(([id, source]) => fetchSource(id, source, cwd)),
  );
  return resolved;
}
