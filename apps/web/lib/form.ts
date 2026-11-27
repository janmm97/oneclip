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

/** "Where will you post?" options, in menu order: plain name plus the shape it renders. */
export const PLACES = [
  ["9:16", "TikTok, Reels, Shorts", "9:16 tall"],
  ["4:5", "Instagram post", "4:5"],
  ["1:1", "Square", "1:1"],
  ["16:9", "YouTube", "16:9 wide"],
  ["4:3", "Old-TV shape", "4:3"],
] as const;

/** The picker button's label: what's picked, in menu order, never longer than two names. */
export function placesLabel(selected: readonly string[]): string {
  const names = PLACES.filter(([r]) => selected.includes(r)).map(([, name]) => name);
  return names.length > 2 ? `${names[0]} + ${names.length - 1} more` : names.join(" · ");
}
