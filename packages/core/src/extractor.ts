import { askClaudeJSON } from "./ai.js";
import type { ProductInfo, RepoData, Topic } from "./types.js";

export async function extractProduct(repoData: RepoData): Promise<ProductInfo> {
  const { readme, packageJson, repoUrl, repo } = repoData;

  let context = "";
  if (packageJson) {
    context += `Package: ${packageJson.name || repo}\n`;
    context += `Description: ${packageJson.description || "N/A"}\n`;
    context += `Keywords: ${(packageJson.keywords as string[])?.join(", ") || "N/A"}\n\n`;
  }
  if (readme) {
    context += `README:\n${readme.slice(0, 3000)}`;
  }

  const result = await askClaudeJSON<{
    name: string;
    description: string;
    domain: string;
    language: string;
  }>(`Analyze this developer tool:

${context}

Return JSON:
{
  "name": "tool name",
  "description": "one sentence description",
  "domain": "problem domain (e.g., 'schema validation')",
  "language": "primary language (e.g., 'TypeScript')"
}`);

  return { ...result, url: repoUrl };
}

export async function discoverCompetitors(
  product: ProductInfo,
): Promise<string[]> {
  const result = await askClaudeJSON<{ competitors: string[] }>(`Given:
- Name: ${product.name}
- Description: ${product.description}
- Domain: ${product.domain}
- Language: ${product.language}

List 3-5 direct competitors. Return JSON:
{ "competitors": ["tool1", "tool2", "tool3"] }`);

  return result.competitors;
}

export async function generateTopics(
  product: ProductInfo,
  competitors: string[],
): Promise<Topic[]> {
  const result = await askClaudeJSON<{ topics: Topic[] }>(`Given:
- Name: ${product.name}
- Description: ${product.description}
- Domain: ${product.domain}
- Competitors: ${competitors.join(", ")}

Generate 3-4 topics where developers would search for this tool.
For each, create 5 natural questions a developer might ask an AI.

Return JSON:
{
  "topics": [
    { "name": "topic name", "questions": ["q1", "q2", "q3", "q4", "q5"] }
  ]
}`);

  return result.topics;
}
