export interface Scenario {
  name: string;
  prompt: string;
}

export interface ScenarioResult {
  scenario: Scenario;
  passed: boolean;
  response: string;
  error?: string;
}

export interface CheckReport {
  tool: {
    name: string;
    description: string;
    path: string;
  };
  scenarios: ScenarioResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    freshness: number;
  };
}

export interface ToolInfo {
  name: string;
  description: string;
  keywords: string[];
  path: string;
}

export interface McpServerConfig {
  type: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

export interface RunnerConfig {
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  maxTurns?: number;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface CheckConfig {
  tool: {
    name: string;
    description: string;
    keywords: string[];
  };
  scenarios: Scenario[];
  runner?: RunnerConfig;
  threshold?: number;
}
