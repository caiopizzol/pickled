import type { ScanResult } from "./schema.js";

export function renderAuditMarkdown(scan: ScanResult): string {
  const { config, files, pairs, findings } = scan;
  const lines: string[] = [];

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  lines.push("# Agent-context audit\n");
  lines.push(`Target: \`${config.targetRepo}\``);
  lines.push(
    `Budgets: root ≤ ${config.budgets.rootLines} lines, nested warn at ${config.budgets.nestedWarnLines} lines.`,
  );
  lines.push(
    `Found ${files.length} agent-doc files. ${errors} error(s), ${warnings} warning(s).\n`,
  );

  lines.push("## Inventory\n");
  if (files.length === 0) {
    lines.push("No agent-doc files found.\n");
  } else {
    lines.push("| File | Lines | Kind | Notes |");
    lines.push("|---|---|---|---|");
    const sortedFiles = [...files].sort((a, b) => b.lineCount - a.lineCount);
    for (const f of sortedFiles) {
      const isRoot = !f.relPath.includes("/");
      const budgetMark = budgetFlag(f.lineCount, isRoot, config);
      const kind = f.isSymlink
        ? `symlink → ${f.symlinkTarget?.replace(`${config.targetRepo}/`, "") ?? "?"}`
        : "file";
      lines.push(
        `| \`${f.relPath}\` | ${f.lineCount} | ${kind} | ${budgetMark} |`,
      );
    }
    lines.push("");
  }

  lines.push("## AGENTS.md / CLAUDE.md pairs\n");
  if (pairs.length === 0) {
    lines.push("No pairs found.\n");
  } else {
    lines.push("| Directory | A | C | Class | Detail |");
    lines.push("|---|---|---|---|---|");
    for (const p of pairs) {
      lines.push(
        `| \`${p.dir || "(root)"}\` | ${p.agentsExists ? "✓" : "·"} | ${p.claudeExists ? "✓" : "·"} | ${p.classification} | ${p.detail} |`,
      );
    }
    lines.push("");
  }

  const filesWithBroken = files.filter(
    (f) => !f.isSymlink && f.brokenPathRefs.length + f.brokenImports.length > 0,
  );
  lines.push("## Broken references\n");
  if (filesWithBroken.length === 0) {
    lines.push("None detected.\n");
  } else {
    for (const f of filesWithBroken) {
      lines.push(`### \`${f.relPath}\`\n`);
      if (f.brokenPathRefs.length > 0) {
        lines.push("Broken path references:");
        for (const r of f.brokenPathRefs) lines.push(`  - \`${r}\``);
        lines.push("");
      }
      if (f.brokenImports.length > 0) {
        lines.push("Broken `@`-imports:");
        for (const r of f.brokenImports) lines.push(`  - \`${r}\``);
        lines.push("");
      }
    }
  }

  const filesWithCmd = files.filter(
    (f) => !f.isSymlink && f.unresolvedCommands.length > 0,
  );
  lines.push("## Unresolved package-manager commands (advisory)\n");
  lines.push(
    "Looks like a script command in markdown that did not match anything in the target `package.json` `scripts` or the `knownCommands` allowlist. Workspace-filtered commands check against root scripts, so false positives are expected. Review, do not fail CI on this.\n",
  );
  if (filesWithCmd.length === 0) {
    lines.push("None flagged.\n");
  } else {
    for (const f of filesWithCmd) {
      lines.push(`### \`${f.relPath}\`\n`);
      for (const c of f.unresolvedCommands) lines.push(`  - \`${c}\``);
      lines.push("");
    }
  }

  const overBudget = files.filter((f) => {
    if (f.isSymlink) return false;
    const isRoot = !f.relPath.includes("/");
    return isRoot
      ? f.lineCount > config.budgets.rootLines
      : f.lineCount > config.budgets.nestedWarnLines;
  });
  lines.push("## Section breakdown for files over budget\n");
  if (overBudget.length === 0) {
    lines.push("All files within budget.\n");
  } else {
    for (const f of overBudget) {
      lines.push(`### \`${f.relPath}\` (${f.lineCount} lines)\n`);
      lines.push("Largest H2 sections (lines including any subsections):\n");
      lines.push("| Section | Lines |");
      lines.push("|---|---|");
      for (const s of f.sections.slice(0, 10)) {
        lines.push(`| ${s.header} | ${s.lines} |`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function renderAuditJSON(scan: ScanResult): string {
  return JSON.stringify(scan, null, 2);
}

function budgetFlag(
  lineCount: number,
  isRoot: boolean,
  config: ScanResult["config"],
): string {
  if (isRoot && lineCount > config.budgets.rootLines) {
    return `over root budget (${lineCount} > ${config.budgets.rootLines})`;
  }
  if (!isRoot && lineCount > config.budgets.nestedWarnLines) {
    return `over nested-warn (${lineCount} > ${config.budgets.nestedWarnLines})`;
  }
  return "";
}
