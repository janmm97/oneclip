export const TOP_N_MIN = 1;
export const TOP_N_MAX = 20;

/** Clips to keep, always a whole number in 1..20 (the API's range). */
export function clampTopN(n: number): number {
  if (!Number.isFinite(n)) return TOP_N_MIN;
  return Math.min(TOP_N_MAX, Math.max(TOP_N_MIN, Math.round(n)));
}

/** Adds or removes a ratio chip. The last selected one stays: every project renders at least one ratio. */
export function toggleRatio<T extends string>(selected: readonly T[], r: T): T[] {
  if (!selected.includes(r)) return [...selected, r];
  return selected.length === 1 ? [...selected] : selected.filter((x) => x !== r);
}
