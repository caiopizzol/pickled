import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type Trap } from "@pickled-dev/config";
import { scoreTraps } from "../scorers/traps.js";
import { fetchAllSources } from "../sources.js";
import type { AuditFinding, SourceTrapMatch } from "./schema.js";

/**
 * Scan registered docs.sources against declared traps. Returns one match per
 * fired trap per source, plus matching AuditFinding entries for the
 * --fail-on severity rollup.
 *
 * The function silently returns empty arrays when no pickled.yml is present
 * (e.g., a project that uses audit without check). It propagates loadConfig
 * errors otherwise so a malformed pickled.yml is loud, not silently skipped.
 *
 * Sources with `audit.traps: false` are excluded from the scan. Other audit
 * rules (broken refs, etc.) are not affected by this opt-out.
 */
export async function scanSourceTraps(
  targetRepo: string,
): Promise<{ matches: SourceTrapMatch[]; findings: AuditFinding[] }> {
  if (!existsSync(join(targetRepo, "pickled.yml"))) {
    return { matches: [], findings: [] };
  }

  const config = await loadConfig(targetRepo);

  const sourcesMap = config.docs?.sources;
  if (!sourcesMap || Object.keys(sourcesMap).length === 0) {
    return { matches: [], findings: [] };
  }

  const trapsList: Trap[] = [];
  const severityByTrapId = new Map<string, "warning" | "error">();
  for (const scenario of config.scenarios) {
    for (const trap of scenario.traps ?? []) {
      trapsList.push(trap);
      severityByTrapId.set(trap.id, trap.auditSeverity ?? "warning");
    }
  }

  if (trapsList.length === 0) {
    return { matches: [], findings: [] };
  }

  const sources = await fetchAllSources(sourcesMap, targetRepo);

  const matches: SourceTrapMatch[] = [];
  const findings: AuditFinding[] = [];

  for (const source of sources) {
    if (source.auditTraps === false) continue;

    const result = scoreTraps({ response: source.content, traps: trapsList });

    for (const hit of result.fired) {
      const line = computeLine(source.content, hit.index);
      const severity = severityByTrapId.get(hit.id) ?? "warning";
      matches.push({
        sourceId: source.id,
        sourcePath: source.source,
        trapId: hit.id,
        trapReason: hit.reason,
        matched: hit.matched,
        snippet: hit.snippet,
        line,
        severity,
      });
      findings.push({
        severity,
        category: "trap-source-match",
        file: source.source,
        message: `source [${source.id}] matches trap '${hit.id}' ("${hit.matched}"). ${hit.reason} Fix: remove the stale claim from the source, retire the trap if no longer relevant, or set audit.traps: false on the source if it is deliberately stale or test-only.`,
      });
    }
  }

  return { matches, findings };
}

function computeLine(content: string, byteOffset: number): number {
  let line = 1;
  const limit = Math.min(byteOffset, content.length);
  for (let i = 0; i < limit; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}
