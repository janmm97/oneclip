/** Hook-ranking metrics. Pure functions so they can be unit-tested without Jev. */

export type Label = "good" | "average" | "bad";
export const GRADE: Record<Label, number> = { good: 2, average: 1, bad: 0 };
/** A normalised score at or above this counts as "the model called it strong". */
export const STRONG = 0.6;

/** Share of the top-k (by score) labelled good. */
export function precisionAtK(items: { score: number; label: Label }[], k: number): number {
  const top = [...items].sort((a, b) => b.score - a.score).slice(0, k);
  return top.length ? top.filter((i) => i.label === "good").length / top.length : 0;
}

/**
 * Pairwise ranking agreement (Kendall-style concordance, 0..1): of all pairs
 * with different labels, the share the scores order the same way. Score ties count half.
 */
export function rankingAgreement(items: { score: number; label: Label }[]): number {
  let pairs = 0;
  let agree = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i] as (typeof items)[number];
      const b = items[j] as (typeof items)[number];
      const dl = GRADE[a.label] - GRADE[b.label];
      if (dl === 0) continue;
      pairs++;
      const ds = a.score - b.score;
      if (ds === 0) agree += 0.5;
      else if (Math.sign(ds) === Math.sign(dl)) agree++;
    }
  }
  return pairs ? agree / pairs : 0;
}

/** Share of items in `of` for which `hit` is true (0 when empty). */
export function rate<T>(of: T[], hit: (t: T) => boolean): number {
  return of.length ? of.filter(hit).length / of.length : 0;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
