export interface AuditConfig {
  targetRepo: string;
  budgets: {
    rootLines: number;
    nestedWarnLines: number;
  };
  ignore: string[];
  intentionalDifferentPairs: string[];
  knownCommands: string[];
}

export const DEFAULT_IGNORE_PATTERNS = [
  "node_modules/**",
  "**/node_modules/**",
  ".git/**",
  "**/.git/**",
  "dist/**",
  "**/dist/**",
  "build/**",
  "**/build/**",
  ".next/**",
  "**/.next/**",
  ".turbo/**",
  "**/.turbo/**",
  ".cache/**",
  "**/.cache/**",
  ".runs/**",
  "**/.runs/**",
  "coverage/**",
  "**/coverage/**",
  "**/__fixtures__/**",
  "**/tests/**/fixture/**",
  "**/tests/**/fixtures/**",
  "**/test/**/fixture/**",
  "**/test/**/fixtures/**",
];

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  targetRepo: ".",
  budgets: {
    rootLines: 120,
    nestedWarnLines: 200,
  },
  ignore: DEFAULT_IGNORE_PATTERNS,
  intentionalDifferentPairs: [],
  knownCommands: [],
};

export function resolveAuditConfig(
  partial?: Partial<AuditConfig>,
): AuditConfig {
  if (!partial) return DEFAULT_AUDIT_CONFIG;
  return {
    targetRepo: partial.targetRepo ?? DEFAULT_AUDIT_CONFIG.targetRepo,
    budgets: {
      rootLines:
        partial.budgets?.rootLines ?? DEFAULT_AUDIT_CONFIG.budgets.rootLines,
      nestedWarnLines:
        partial.budgets?.nestedWarnLines ??
        DEFAULT_AUDIT_CONFIG.budgets.nestedWarnLines,
    },
    ignore: partial.ignore ?? DEFAULT_IGNORE_PATTERNS,
    intentionalDifferentPairs: partial.intentionalDifferentPairs ?? [],
    knownCommands: partial.knownCommands ?? [],
  };
}

export interface DocFile {
  relPath: string;
  absPath: string;
  isSymlink: boolean;
  symlinkTarget: string | null;
  realRelPath: string;
  lineCount: number;
  brokenPathRefs: string[];
  brokenImports: string[];
  unresolvedCommands: string[];
  sections: Array<{ header: string; lines: number }>;
}

export type PairClass =
  | "linked"
  | "intentional-different"
  | "unexpected-duplicate"
  | "single";

export interface DocPair {
  dir: string;
  agentsExists: boolean;
  claudeExists: boolean;
  classification: PairClass;
  detail: string;
}

export interface AuditFinding {
  severity: "error" | "warning";
  category:
    | "broken-import"
    | "broken-path-ref"
    | "unresolved-command"
    | "over-budget"
    | "divergent-pair"
    | "duplicate-pair";
  file: string;
  message: string;
}

export interface ScanResult {
  config: AuditConfig;
  files: DocFile[];
  pairs: DocPair[];
  findings: AuditFinding[];
}
