import { askClaude } from "./ai.js";
import type { ProductInfo, ToolMentions, Topic, TopicResult } from "./types.js";

export async function analyzeCitations(
  product: ProductInfo,
  competitors: string[],
  topics: Topic[],
  onProgress?: (msg: string) => void,
): Promise<TopicResult[]> {
  const allTools = [product.name, ...competitors];
  const results: TopicResult[] = [];

  for (const topic of topics) {
    onProgress?.(`Analyzing: ${topic.name}`);

    const toolStats: Record<string, ToolMentions> = {};
    for (const tool of allTools) {
      toolStats[tool.toLowerCase()] = {
        mentions: 0,
        total: topic.questions.length,
        percentage: 0,
        contexts: [],
      };
    }

    for (const question of topic.questions) {
      const response = await askClaude(question);

      for (const tool of allTools) {
        const key = tool.toLowerCase();
        const regex = new RegExp(`\\b${escapeRegex(tool)}\\b`, "gi");

        if (regex.test(response)) {
          toolStats[key].mentions++;

          if (toolStats[key].contexts.length < 2) {
            const ctx = extractContext(response, tool);
            if (ctx) toolStats[key].contexts.push(ctx);
          }
        }
      }
    }

    // Calculate percentages and find leader
    let leader = "";
    let maxMentions = 0;

    for (const [tool, stats] of Object.entries(toolStats)) {
      stats.percentage = Math.round((stats.mentions / stats.total) * 100);
      if (stats.mentions > maxMentions) {
        maxMentions = stats.mentions;
        leader = tool;
      }
    }

    results.push({ topic: topic.name, results: toolStats, leader });
  }

  return results;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractContext(response: string, tool: string): string | null {
  const sentences = response.split(/[.!?]+/);
  const regex = new RegExp(`\\b${escapeRegex(tool)}\\b`, "gi");

  for (const sentence of sentences) {
    if (regex.test(sentence)) {
      const trimmed = sentence.trim();
      if (trimmed.length > 20 && trimmed.length < 150) {
        return trimmed;
      }
    }
  }
  return null;
}
