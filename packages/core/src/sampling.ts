/**
 * Deterministic per-scenario cell sampling for matrix runs. The default seed
 * (`"default"`) makes sampling reproducible across re-runs without the user
 * having to pick one; passing `--seed VALUE` lets a CI job pin a specific
 * sample so a failing receipt can be regenerated exactly.
 *
 * The PRNG is mulberry32 seeded by a FNV-1a hash of the seed string. Both
 * are tiny, fast, and reproducible across Bun versions. We do not need
 * cryptographic strength here; we need every run with the same seed to
 * pick the same cells.
 */

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function hashSeed(seed: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically sample `n` cells per scenario from the planned list.
 * Cells of the same scenario are grouped together first so the sample is
 * per-scenario (so `--sample 3` is "3 cells per scenario", not "3 cells
 * total across the whole run"). When a scenario has `n` or fewer cells,
 * all of them are kept.
 *
 * The sampling is order-stable: cells preserve the order they arrived in
 * within each scenario so the receipt grid stays readable.
 */
export function sampleCellsPerScenario<T extends { scenario: string }>(
  cells: T[],
  n: number,
  seed: string,
): T[] {
  if (n <= 0) return [];
  const rng = mulberry32(hashSeed(seed));
  const byScenario = new Map<string, T[]>();
  // Preserve scenario-insertion order so the output grid order is stable.
  const scenarioOrder: string[] = [];
  for (const c of cells) {
    if (!byScenario.has(c.scenario)) {
      byScenario.set(c.scenario, []);
      scenarioOrder.push(c.scenario);
    }
    byScenario.get(c.scenario)!.push(c);
  }
  const selected: T[] = [];
  for (const name of scenarioOrder) {
    const list = byScenario.get(name)!;
    if (list.length <= n) {
      selected.push(...list);
      continue;
    }
    // Fisher-Yates partial shuffle: pick the first n positions of a
    // deterministically shuffled list. The same seed always produces the
    // same `n` cells in the same positions.
    const picked = list.slice();
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rng() * (picked.length - i));
      [picked[i], picked[j]] = [picked[j]!, picked[i]!];
    }
    // Re-sort the picked subset back to original input order so the
    // receipt grid stays readable.
    const pickedSet = new Set(picked.slice(0, n));
    for (const c of list) {
      if (pickedSet.has(c)) selected.push(c);
    }
  }
  return selected;
}
