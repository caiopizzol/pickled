import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type DocSourceEntry,
  loadConfig,
  type Trap,
} from "@pickled-dev/config";
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
 *
 * URL sources are skipped in v1. The audit is expected to be local and
 * deterministic; including URL sources would make every run network-dependent
 * (latency, flake, rate limits). Vendors who want URL coverage today still
 * get it via `pickled check`. A follow-up may add opt-in URL scanning with
 * timeouts and caching.
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

  const localSourcesMap: Record<string, string | DocSourceEntry> = {};
  for (const [id, value] of Object.entries(sourcesMap)) {
    const path = typeof value === "string" ? value : value.path;
    if (path.startsWith("http://") || path.startsWith("https://")) continue;
    localSourcesMap[id] = value;
  }
  if (Object.keys(localSourcesMap).length === 0) {
    return { matches: [], findings: [] };
  }

  // Track severity per trap object, not per id. Same id appearing in two
  // scenarios with different auditSeverity stays independent; an id-keyed
  // map would let the second overwrite the first.
  const trapsList: Trap[] = [];
  const severityByTrap = new Map<Trap, "warning" | "error">();
  for (const scenario of config.scenarios) {
    for (const trap of scenario.traps ?? []) {
      trapsList.push(trap);
      severityByTrap.set(trap, trap.auditSeverity ?? "warning");
    }
  }

  if (trapsList.length === 0) {
    return { matches: [], findings: [] };
  }

  const sources = await fetchAllSources(localSourcesMap, targetRepo);

  const matches: SourceTrapMatch[] = [];
  const findings: AuditFinding[] = [];

  for (const source of sources) {
    if (source.auditTraps === false) continue;

    // scoreTraps returns hits in trap-list order with fired/avoided IDs only.
    // Re-evaluate per trap so we can map back to the Trap object for severity.
    for (const trap of trapsList) {
      const { fired } = scoreTraps({
        response: source.content,
        traps: [trap],
      });
      const hit = fired[0];
      if (!hit) continue;
      const line = computeLine(source.content, hit.index);
      const severity = severityByTrap.get(trap) ?? "warning";
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
