import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Target, TargetCategory } from "@pickled-dev/config";
import { buildCitationPrompt } from "../citation-prompt.js";
import type {
  ResponseEntry,
  RunOptions,
  TargetResult,
  TargetRunner,
} from "../types.js";

/**
 * Codex CLI adapter. Shells out to `codex exec` with --json + --output-last-message.
 *
 * Isolation note: the flags below disable codex's user-level config.toml
 * (--ignore-user-config) and execpolicy .rules (--ignore-rules). They do NOT
 * isolate AGENTS.md or other project-level context that codex may pick up
 * from cwd or $CODEX_HOME. If you need to test against a clean context,
 * point `cwd` at a directory without those files.
 */

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  options: { cwd: string; stdin: string },
) => Promise<SpawnResult>;

export interface CodexCliTargetOptions {
  spawn?: SpawnFn;
  readFile?: (path: string) => Promise<string>;
  binary?: string;
}

const DEFAULT_BINARY = "codex";

export class CodexCliTarget implements TargetRunner {
  readonly category: TargetCategory = "cli";
  readonly provider = "codex-cli";
  readonly name: string;

  private config: Target;
  private spawnFn: SpawnFn;
  private readFileFn: (path: string) => Promise<string>;
  private binary: string;

  constructor(
    name: string,
    config: Target,
    options: CodexCliTargetOptions = {},
  ) {
    this.name = name;
    this.config = config;
    this.spawnFn = options.spawn ?? defaultSpawn;
    this.readFileFn = options.readFile ?? defaultReadFile;
    this.binary = options.binary ?? DEFAULT_BINARY;
  }

  async run(prompt: string, options: RunOptions): Promise<TargetResult> {
    const { tool, cwd, docs, requiredSources } = options;
    const model = this.config.model;
    if (!model) {
      throw new Error(
        `CodexCliTarget "${this.name}" requires an explicit model. Validation should have caught this at config load.`,
      );
    }

    const systemPrompt = buildCitationPrompt(tool, docs, requiredSources);
    const fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;

    const lastMessageFile = join(tmpdir(), `pickled-codex-${randomUUID()}.txt`);

    const args = [
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--skip-git-repo-check",
      "--cd",
      cwd,
      "--model",
      model,
      "--output-last-message",
      lastMessageFile,
      "-",
    ];

    try {
      const result = await this.spawnFn(this.binary, args, {
        cwd,
        stdin: fullPrompt,
      });

      const { allResponses, toolsUsed } = parseJsonlStream(result.stdout);

      if (result.exitCode !== 0) {
        throw new Error(
          `codex exec failed (exit ${result.exitCode}): ${result.stderr.trim() || "no stderr output"}`,
        );
      }

      let response = "";
      try {
        response = (await this.readFileFn(lastMessageFile)).trim();
      } catch {
        // Fall back to the last assistant entry from the stream if the
        // last-message file was never written (e.g. codex errored early).
        response =
          allResponses.length > 0
            ? allResponses[allResponses.length - 1]!.text
            : "";
      }

      if (allResponses.length > 0) {
        allResponses[allResponses.length - 1]!.type = "final";
      }

      return {
        response,
        allResponses,
        toolsUsed,
        sources: [],
        metadata: {
          model,
          category: this.category,
          provider: this.provider,
          target: this.name,
        },
      };
    } finally {
      await rm(lastMessageFile, { force: true });
    }
  }
}

interface ParsedStream {
  allResponses: ResponseEntry[];
  toolsUsed: string[];
}

function parseJsonlStream(stdout: string): ParsedStream {
  const allResponses: ResponseEntry[] = [];
  const toolsUsed: string[] = [];

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      // Best-effort: silently skip malformed lines. The --output-last-message
      // file is the authoritative source for the final answer.
      continue;
    }
    const text = extractAssistantText(event);
    if (text) {
      const type: ResponseEntry["type"] =
        allResponses.length === 0 ? "initial" : "intermediate";
      allResponses.push({ type, text });
    }
    const toolName = extractToolName(event);
    if (toolName && !toolsUsed.includes(toolName)) {
      toolsUsed.push(toolName);
    }
  }

  return { allResponses, toolsUsed };
}

function extractAssistantText(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  // Codex JSONL shape varies across versions. Best-effort: look for common
  // fields. If schema drifts, --output-last-message still gives us the answer.
  if (typeof e.message === "string") return e.message;
  if (typeof e.content === "string") return e.content;
  if (
    typeof e.type === "string" &&
    (e.type === "assistant_message" || e.type === "agent_message") &&
    typeof e.text === "string"
  ) {
    return e.text;
  }
  if (e.type === "message" && typeof e.text === "string") return e.text;
  return null;
}

function extractToolName(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  if (typeof e.tool === "string") return e.tool;
  if (
    typeof e.type === "string" &&
    (e.type === "tool_call" || e.type === "function_call") &&
    typeof e.name === "string"
  ) {
    return e.name;
  }
  return null;
}

const defaultSpawn: SpawnFn = async (cmd, args, options) => {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: options.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(options.stdin);
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

const defaultReadFile = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Last-message file not found: ${path}`);
  }
  return file.text();
};
