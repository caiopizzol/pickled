// Target categories for different LLM interaction modes
export type TargetCategory = "api" | "cli" | "ide";

// Providers by category
export type ApiProvider = "anthropic" | "openai" | "google";
export type CliProvider = "claude-code" | "gemini-cli" | "amazon-q";
export type IdeProvider = "cursor" | "copilot" | "windsurf";

export interface McpServerConfig {
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

// Target definition - reusable LLM interface configuration
export interface Target {
  category: TargetCategory;
  provider: string;
  model?: string;

  // CLI-specific (agentic)
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  maxTurns?: number;

  // API-specific
  temperature?: number;
  maxTokens?: number;

  // IDE-specific (future)
  workspaceContext?: boolean;

  // Per-target threshold
  threshold?: number;
}

// Context definition - reusable capability configuration
export interface Context {
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
}

// Scenario - a test case
export interface Scenario {
  name: string;
  prompt: string;
  target?: string; // Reference to named target
  context?: string; // Reference to named context
}

export type Answerable = "YES" | "PARTIAL" | "NO";

export interface ScenarioResult {
  scenario: Scenario;
  answerable: Answerable;
  confidence: number;
  response: string;
  reason: string;
  missing?: string[];
  error?: string;
  target?: {
    name: string;
    category: TargetCategory;
    provider: string;
    model: string;
  };
  toolsUsed?: string[];
  sources?: string[];
}

export type DocSourceType = "url" | "file" | "mcp" | "codebase";

export interface DocSource {
  content: string;
  name: string;
  type: DocSourceType;
}

export interface DocsConfig {
  source: string;
}

export interface CheckReport {
  tool: {
    name: string;
    description: string;
    path: string;
  };
  docs?: {
    source: string;
    type: DocSourceType;
  };
  scenarios: ScenarioResult[];
  summary: {
    total: number;
    answered: number;
    unanswered: number;
    score: number;
  };
}

export interface ToolInfo {
  name: string;
  description: string;
  path: string;
}

// Matrix configuration for running scenarios across multiple targets/contexts
export interface MatrixConfig {
  target?: string[];
  context?: string[];
}

export interface CheckConfig {
  tool: {
    name: string;
    description: string;
  };

  // Named targets (reusable LLM interface definitions)
  targets?: Record<string, Target>;

  // Named contexts (reusable capability configurations) - future
  contexts?: Record<string, Context>;

  // Matrix for running all scenarios across multiple targets/contexts - future
  matrix?: MatrixConfig;

  // Scenarios to run
  scenarios: Scenario[];

  // Documentation source (optional)
  docs?: DocsConfig;

  // Global threshold
  threshold?: number;
}
