import type { ToolInfo } from "../types.js";

/**
 * Build the discovery-mode system prompt for a target. Used by matrix cells
 * with a non-none toolset (web, MCP, etc.). Unlike the citation prompt,
 * this DOES NOT inject source content; the agent is told to research the
 * answer using its available tools, with the canonical source named as the
 * primary reference if one is provided for the cell.
 *
 * The prompt does not enumerate tool names: the agent sees the tools and
 * their descriptions from the SDK, and the cell's tool path may be web,
 * MCP, or a future shape. Naming a fixed example list would mislead the
 * agent on cells that do not actually have those tools.
 *
 * Pickled does not enforce citation grounding for discovery cells; scoring
 * relies on declared traps and `expected.includes`/`excludes` plus a
 * tool-use provenance check that the cell actually invoked at least one of
 * its configured tools. The prompt does not demand a `## Sources` block.
 */
export function buildDiscoveryPrompt(
  tool: ToolInfo,
  sourceHint: string | null,
): string {
  const hintLine =
    sourceHint && sourceHint.length > 0
      ? `\nThe canonical source for this question is: ${sourceHint}\nUse it as the primary reference; consult related authoritative sources if needed.`
      : "\nResearch the answer using authoritative sources you can reach with your tools.";

  return `You are answering a question about the tool "${tool.name}": ${tool.description}.

Use the tools available to you to research the answer. Be specific and accurate; do not invent facts.${hintLine}

If you cannot find the answer with the available tools, say so explicitly rather than guessing.`;
}
