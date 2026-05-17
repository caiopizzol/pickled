import type { Trap } from "@pickled-dev/config";

export interface TrapHit {
  id: string;
  reason: string;
  matched: string;
  snippet: string;
}

export interface TrapDetails {
  fired: TrapHit[];
  avoided: string[];
}

const SNIPPET_RADIUS = 40;

export function scoreTraps(input: {
  response: string;
  traps: Trap[];
}): TrapDetails {
  const fired: TrapHit[] = [];
  const avoided: string[] = [];

  for (const trap of input.traps) {
    const hit = matchTrap(input.response, trap);
    if (hit) fired.push(hit);
    else avoided.push(trap.id);
  }

  return { fired, avoided };
}

function matchTrap(response: string, trap: Trap): TrapHit | null {
  if (trap.match !== undefined) {
    const idx = response.indexOf(trap.match);
    if (idx === -1) return null;
    return {
      id: trap.id,
      reason: trap.reason,
      matched: trap.match,
      snippet: buildSnippet(response, idx, trap.match.length),
    };
  }
  if (trap.pattern !== undefined) {
    const re = new RegExp(trap.pattern, trap.flags ?? "");
    const m = re.exec(response);
    if (!m) return null;
    return {
      id: trap.id,
      reason: trap.reason,
      matched: m[0],
      snippet: buildSnippet(response, m.index, m[0].length),
    };
  }
  return null;
}

function buildSnippet(text: string, start: number, length: number): string {
  const before = Math.max(0, start - SNIPPET_RADIUS);
  const after = Math.min(text.length, start + length + SNIPPET_RADIUS);
  let snippet = text.slice(before, after).replace(/\s+/g, " ").trim();
  if (before > 0) snippet = `...${snippet}`;
  if (after < text.length) snippet = `${snippet}...`;
  return snippet;
}
