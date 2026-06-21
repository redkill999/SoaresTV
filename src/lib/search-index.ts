/**
 * Caches lowercased names per data array so filtering by search text
 * doesn't re-call `.toLowerCase()` on tens of thousands of strings
 * on every keystroke. Keyed by array reference via WeakMap, so the
 * cache is GC'd as soon as TanStack Query swaps the underlying array.
 */
const lowerNameCache = new WeakMap<object, string[]>();

export function getLowerNames<T>(arr: readonly T[], getName: (item: T) => string): string[] {
  const cached = lowerNameCache.get(arr as unknown as object);
  if (cached) return cached;
  const out = new Array<string>(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = getName(arr[i]).toLowerCase();
  lowerNameCache.set(arr as unknown as object, out);
  return out;
}

/** Filter using the precomputed lowercase index. */
export function filterBySearch<T>(
  arr: readonly T[],
  getName: (item: T) => string,
  needle: string,
): T[] {
  if (!needle) return arr as T[];
  const q = needle.toLowerCase();
  const idx = getLowerNames(arr, getName);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (idx[i].includes(q)) out.push(arr[i]);
  }
  return out;
}

/** Sort cache keyed by source array + direction. Avoids re-sorting on re-renders. */
const sortCache = new WeakMap<object, { az?: unknown[]; za?: unknown[] }>();
const collator = typeof Intl !== "undefined" ? new Intl.Collator(undefined, { sensitivity: "base", numeric: true }) : null;

export function getSorted<T>(arr: readonly T[], getName: (item: T) => string, dir: "az" | "za"): T[] {
  let bucket = sortCache.get(arr as unknown as object);
  if (!bucket) {
    bucket = {};
    sortCache.set(arr as unknown as object, bucket);
  }
  if (bucket[dir]) return bucket[dir] as T[];
  const cmp = collator
    ? (a: T, b: T) => collator.compare(getName(a), getName(b))
    : (a: T, b: T) => getName(a).localeCompare(getName(b));
  const sorted = dir === "az" ? [...arr].sort(cmp) : [...arr].sort((a, b) => cmp(b, a));
  bucket[dir] = sorted;
  return sorted;
}
