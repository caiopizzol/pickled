import path from "node:path";
import type { DocSource } from "./types.js";

function isUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

async function fetchFromUrl(url: string): Promise<DocSource> {
  const llmsTxtUrl = new URL("/llms.txt", url).href;

  let response = await fetch(llmsTxtUrl);

  if (!response.ok) {
    response = await fetch(url);
    if (!response.ok) {
      throw new Error(`No llms.txt found at ${url}`);
    }
  }

  const content = await response.text();
  const hostname = new URL(url).hostname;

  return {
    content,
    name: `llms.txt from ${hostname}`,
    type: "url",
  };
}

async function readFromFile(filePath: string): Promise<DocSource> {
  const resolvedPath = path.resolve(filePath);
  const file = Bun.file(resolvedPath);

  if (!(await file.exists())) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const content = await file.text();

  return {
    content,
    name: path.basename(resolvedPath),
    type: "file",
  };
}

export async function fetchDocs(source: string): Promise<DocSource> {
  if (source.startsWith("mcp:")) {
    return {
      content: "",
      name: source,
      type: "mcp",
    };
  }

  if (isUrl(source)) {
    return fetchFromUrl(source);
  }

  return readFromFile(source);
}

export function getCodebaseSource(cwd: string): DocSource {
  return {
    content: "",
    name: `codebase at ${cwd}`,
    type: "codebase",
  };
}
