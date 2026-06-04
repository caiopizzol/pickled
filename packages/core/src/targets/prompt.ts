import type { ToolInfo } from "../types.js";
import { buildTaskPrompt } from "./build-prompt.js";
import { buildDiscoveryPrompt } from "./discovery-prompt.js";
import { buildInjectPrompt, buildMemoryPrompt } from "./question-prompt.js";
import type { PromptContext } from "./types.js";

/**
 * Build the system prompt for a run from its explicit prompt context. The
 * single dispatch point shared by every adapter, so none can fall back to a
 * citation prompt. Build cells use the build prompt for all three material
 * shapes; question cells use memory / inject / discovery.
 */
export function buildSystemPrompt(tool: ToolInfo, pc: PromptContext): string {
  if (pc.kind === "build") {
    if (pc.mode === "inject") return buildTaskPrompt(tool, pc.docs, null);
    if (pc.mode === "web" || pc.mode === "mcp") {
      return buildTaskPrompt(tool, [], pc.sourceHint);
    }
    return buildTaskPrompt(tool, [], null);
  }
  if (pc.mode === "inject") return buildInjectPrompt(tool, pc.docs);
  if (pc.mode === "web" || pc.mode === "mcp") {
    return buildDiscoveryPrompt(tool, pc.sourceHint);
  }
  return buildMemoryPrompt(tool);
}
