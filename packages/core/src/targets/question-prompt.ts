import type { ResolvedSource } from "@pickled-dev/config";
import type { ToolInfo } from "../types.js";

/**
 * v2 question prompts. There is no `## Sources` citation contract: a question
 * is scored on fact coverage + misstatement rejection (and, for web/mcp,
 * tool-use provenance), not on a citations block. The memory and inject prompts
 * live here; web/mcp question cells use the discovery prompt.
 */

/** memory cells: answer from the model's own knowledge, no source, no tools. */
export function buildMemoryPrompt(tool: ToolInfo): string {
  return `You are answering a question about "${tool.name}": ${tool.description}.

Answer from your own knowledge. Be specific and accurate. If you are unsure, say so rather than guessing.`;
}

/** inject cells: the source content is placed in the prompt; answer from it. */
export function buildInjectPrompt(
  tool: ToolInfo,
  docs: ResolvedSource[],
): string {
  const sourcesBlock = docs
    .map((d) => `<source id="${d.id}">\n${d.content.trimEnd()}\n</source>`)
    .join("\n\n");

  return `You are answering a question about "${tool.name}": ${tool.description}.

Answer using the source material below. Be specific and accurate; prefer what the sources say over general knowledge.

${sourcesBlock}`;
}
