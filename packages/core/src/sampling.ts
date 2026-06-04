/**
 * Deterministic per-task cell sampling. The default seed (`"default"`) makes
 * sampling reproducible across re-runs without the user picking one; `--seed
 * VALUE` lets a CI job pin a sample so a failing receipt regenerates exactly.
 *
 * The PRNG is mulberry32 seeded by an FNV-1a hash of the seed string. Tiny,
 * fast, reproducible across Bun versions. Not cryptographic; we only need every
 * run with the same seed to pick the same cells.
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
 * Deterministically sample `n` cells per task. Cells are grouped by task first
 * so `--sample 3` means "3 cells per task," not "3 total." A task with `n` or
 * fewer cells keeps all of them. Output is order-stable within each task so the
 * receipt grid stays readable.
 */
export function sampleCellsPerTask<T extends { task: string }>(
  cells: T[],
  n: number,
  seed: string,
): T[] {
  if (n <= 0) return [];
  const rng = mulberry32(hashSeed(seed));
  const byTask = new Map<string, T[]>();
  const taskOrder: string[] = [];
  for (const c of cells) {
    let list = byTask.get(c.task);
    if (list === undefined) {
      list = [];
      byTask.set(c.task, list);
      taskOrder.push(c.task);
    }
    list.push(c);
  }

  const selected: T[] = [];
  for (const name of taskOrder) {
    const list = byTask.get(name);
    if (list === undefined) continue;
    if (list.length <= n) {
      selected.push(...list);
      continue;
    }
    // Fisher-Yates partial shuffle: deterministically pick the first n.
    const picked = list.slice();
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rng() * (picked.length - i));
      const a = picked[i];
      const b = picked[j];
      if (a !== undefined && b !== undefined) {
        picked[i] = b;
        picked[j] = a;
      }
    }
    // Re-emit in original input order so the receipt grid stays readable.
    const pickedSet = new Set(picked.slice(0, n));
    for (const c of list) {
      if (pickedSet.has(c)) selected.push(c);
    }
  }
  return selected;
}
