import type { ResolvedDocSource } from "@pickled-dev/config";
import type { ToolInfo } from "../types.js";

/**
 * Build the citation-mode prompt for a target. Both Claude (as systemPrompt)
 * and Codex (prepended to stdin) consume this string verbatim, so changes
 * here affect every target's scoring contract.
 */
export function buildCitationPrompt(
  tool: ToolInfo,
  docs: ResolvedDocSource[],
  requiredSources: string[],
): string {
  const inventory =
    docs.length > 0
      ? docs.map((d) => `- ${d.id}: ${d.name} (${d.source})`).join("\n")
      : "(no sources provided)";

  const sourcesBlock = docs
    .map((d) => `<source id="${d.id}">\n${d.content.trimEnd()}\n</source>`)
    .join("\n\n");

  const requiredLine =
    requiredSources.length > 0
      ? `The scenario REQUIRES citations from: ${requiredSources.join(", ")}.`
      : "No specific source is required, but every claim must cite a registered source.";

  return `You are answering a question about the tool "${tool.name}": ${tool.description}.

Answer using ONLY information from the provided sources below. Do not draw on general knowledge.

Available sources:
${inventory}

${sourcesBlock}

${requiredLine}

End your response with a "## Sources" section that lists every source you actually used. Use this exact format:

## Sources
- [source-id] short note on what this source contributed
- [other-id] short note

Rules:
- Only cite IDs that appear in the inventory above. Do not invent IDs.
- If you cannot answer from the provided sources, say so explicitly and write an empty "## Sources" section (just the heading, no bullets).
- The "## Sources" heading must be the last heading in your response.`;
}
