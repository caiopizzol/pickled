import type { ResolvedSource } from "@pickled-dev/config";
import type { ToolInfo } from "../types.js";

/**
 * Build the build-mode (kind: build) system prompt. The agent edits a
 * throwaway workspace to complete the task; Pickled runs the project's
 * verification afterward and scores deterministically.
 *
 * Unlike the citation/discovery prompts this demands no `## Sources` block and
 * no citation grounding - the verdict rests on the diff and the verify
 * commands, not on what the answer text says. It deliberately does NOT name
 * the verify commands: naming them invites teaching-to-the-test. The agent
 * inspects the project like a developer would.
 *
 * Source context is injected when provided (`tools: none` cells); otherwise a
 * discovery hint names the canonical source the agent should reach with its
 * tools (`web`/`mcp` cells). Either way the workspace files are the agent's
 * primary material.
 */
export function buildTaskPrompt(
  tool: ToolInfo,
  docs: ResolvedSource[],
  sourceHint: string | null,
): string {
  let contextBlock = "";
  if (docs.length > 0) {
    const injected = docs
      .map((d) => `### ${d.name} (${d.id})\n${d.content}`)
      .join("\n\n");
    contextBlock = `\n\nReference material about ${tool.name}:\n\n${injected}`;
  } else if (sourceHint && sourceHint.length > 0) {
    contextBlock = `\n\nThe canonical reference for ${tool.name} is: ${sourceHint}\nUse your available tools to consult it.`;
  }

  return `You are working in a project that uses "${tool.name}": ${tool.description}.

Modify the files in your working directory to complete the task. Use the project's existing files and any reference material available to you.

Rules:
- Do not delete, weaken, or rewrite the project's tests to make verification pass. Adding new tests is fine.
- Finish when the implementation is complete; you do not need to run the project's checks yourself.

After you stop, the project's existing verification will be run to judge the result.${contextBlock}`;
}
