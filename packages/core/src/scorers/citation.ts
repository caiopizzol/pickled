export type Answerable = "YES" | "PARTIAL" | "NO";

export interface Citation {
  id: string;
  note?: string;
}

export interface CitationScore {
  answerable: Answerable;
  confidence: number;
  reason: string;
  citations: {
    cited: string[];
    required: string[];
    missing: string[];
    unknown: string[];
  };
}

export function parseCitations(response: string): Citation[] {
  const section = extractSourcesSection(response);
  if (section === null) return [];

  const out: Citation[] = [];
  const itemRe = /^\s*-\s+\[([^\]]+)\]\s*(.*)$/gm;
  let m: RegExpExecArray | null = itemRe.exec(section);
  while (m !== null) {
    out.push({
      id: m[1]!.trim(),
      note: m[2]!.trim() || undefined,
    });
    m = itemRe.exec(section);
  }
  return out;
}

function extractSourcesSection(response: string): string | null {
  const headingRe = /^##\s+Sources\s*$/im;
  const headingMatch = headingRe.exec(response);
  if (!headingMatch) return null;
  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = response.slice(startIdx);
  const nextHeading = /^##\s+/m.exec(rest);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

export interface ScoreInput {
  response: string;
  requiredSources: string[];
  registeredIds: string[];
}

export function scoreCitations(input: ScoreInput): CitationScore {
  const citations = parseCitations(input.response);
  const citedSet = new Set(citations.map((c) => c.id));
  const registeredSet = new Set(input.registeredIds);
  const requiredSet = new Set(input.requiredSources);

  const cited = [...citedSet];
  const missing = [...requiredSet].filter((r) => !citedSet.has(r));
  const unknown = [...citedSet].filter((c) => !registeredSet.has(c));
  const required = [...requiredSet];

  let answerable: Answerable;
  let confidence: number;
  let reason: string;

  if (cited.length === 0) {
    answerable = "NO";
    confidence = 0;
    reason = "No citations in response";
  } else if (unknown.length === cited.length) {
    answerable = "NO";
    confidence = 0;
    reason = `All cited sources are unknown: ${unknown.join(", ")}`;
  } else if (missing.length === 0 && unknown.length === 0) {
    answerable = "YES";
    confidence = 100;
    reason =
      required.length > 0
        ? `All required sources cited: ${required.join(", ")}`
        : `Cited registered sources: ${cited.join(", ")}`;
  } else {
    answerable = "PARTIAL";
    const denom = required.length > 0 ? required.length : 1;
    const covered = required.length - missing.length;
    const base = required.length > 0 ? (covered / denom) * 100 : 60;
    const unknownPenalty = unknown.length * 15;
    confidence = Math.max(0, Math.min(100, Math.round(base - unknownPenalty)));
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    if (unknown.length > 0) parts.push(`unknown: ${unknown.join(", ")}`);
    reason = parts.join("; ");
  }

  return {
    answerable,
    confidence,
    reason,
    citations: { cited, required, missing, unknown },
  };
}
