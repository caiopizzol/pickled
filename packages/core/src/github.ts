import type { RepoData } from "./types.js";

export function parseGitHubUrl(
  input: string,
): { owner: string; repo: string } | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  const parts = cleaned.split("/");
  return parts.length >= 2 ? { owner: parts[0], repo: parts[1] } : null;
}

export async function fetchRepo(input: string): Promise<RepoData> {
  const parsed = parseGitHubUrl(input);
  if (!parsed) throw new Error(`🥒 Can't find that jar. Is the repo URL correct? (${input})`);

  const { owner, repo } = parsed;
  const repoUrl = `https://github.com/${owner}/${repo}`;

  // Fetch README
  const readme = await fetchFile(owner, repo, "README.md");

  // Fetch package.json (JS/TS projects)
  let packageJson: Record<string, unknown> | null = null;
  try {
    const pkgText = await fetchFile(owner, repo, "package.json");
    if (pkgText) packageJson = JSON.parse(pkgText);
  } catch {}

  if (!readme && !packageJson) {
    throw new Error(`🥒 Couldn't open the jar. GitHub might be having a moment. (${repoUrl})`);
  }

  return { readme, packageJson, repoUrl, owner, repo };
}

async function fetchFile(
  owner: string,
  repo: string,
  file: string,
): Promise<string> {
  const urls = [
    `https://raw.githubusercontent.com/${owner}/${repo}/main/${file}`,
    `https://raw.githubusercontent.com/${owner}/${repo}/master/${file}`,
  ];

  for (const url of urls) {
    const res = await fetch(url);
    if (res.ok) return res.text();
  }
  return "";
}
