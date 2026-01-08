import type {
  DocSourceType,
  Scenario,
  TargetCategory,
} from "@pickled-dev/config";
import type { ResponseEntry } from "./targets/types.js";

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
    target: string;
    category: TargetCategory;
    provider: string;
    model: string;
  };
  context?: {
    name: string;
  };
  toolsUsed?: string[];
  sources?: string[];
  allResponses?: ResponseEntry[];
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
