# OneClip datasets

Both files are **synthetic**. Every line was written for OneClip; none of it comes from a real video, person or channel. You can use, change and redistribute them under the repo's MIT licence.

| File | What it holds |
|---|---|
| `hook-examples.json` | 16 clip openings, each with the hook type a human editor would assign (`curiosity`, `contrarian`, `surprising`, `emotional_stakes`, `storytelling`, `practical_value`, `problem_solution`, `unexpected_revelation`, or `none`), a strength (`strong`, `average`, `weak`) and whether it stands alone. |
| `evaluation-cases.json` | 3 imagined long videos (a podcast, a cooking tutorial, a conference talk), with 4–5 candidate clips each, labelled `good`, `average` or `bad` as shorts. `k` is the top-K used for P@K. |

Every item has the fields Jev sees in the app: `openingText`, `transcript`, `precedingContext`, `followingContext` and `duration`.

## Running the eval

```bash
pnpm eval:hooks --dry       # check the files, no Jev calls
pnpm eval:hooks             # ask Jev about every item (answers are cached in .oneclip/oneclip.db)
pnpm eval:hooks --feedback  # also score the good/average/bad ratings you gave clips in the app
pnpm eval:hooks --json      # machine-readable report
```

The first full run sends 29 Jev requests through One CLI → TypeSafe (about 1,400 input tokens each, about 41k in total, measured 2026-11-24). Re-runs reuse the cached answers and cost nothing. Changing a question in `packages/core/src/jev/questions.ts` changes the cache key, so the next run asks Jev again.

## Metrics

| Metric | Meaning |
|---|---|
| **P@K** | Share of each case's top-K clips (by final score) labelled `good`, averaged over the cases. A case with fewer than K good clips can't reach 100%. |
| **Ranking agreement** | Of all pairs of clips with different labels, the share the scores put in the right order (Kendall-style concordance). |
| **Strong-hook recall** | Share of `strong` openings whose hook-strength score is at least 0.6. |
| **False-positive rate** | Share of `weak` openings whose hook-strength score is at least 0.6. |
| **Clarity failure rate** | Share of clips OneClip would actually pick (`selectTop`, with dedupe and the context gate) that need earlier context to make sense. |
| **Context-gate catch rate** | Share of context-dependent items that fall below the context gate (0.5). |
| **Hook-type accuracy** | Share of typed `strong` openings whose hook type matches the label. |

## Result on 2026-11-24 (jev-1.14.0)

| P@2 | Ranking agreement | Strong-hook recall | False-positive rate | Clarity failure rate | Context-gate catch rate | Hook-type accuracy |
|---|---|---|---|---|---|---|
| 83% | 100% | 100% | 0% | 0% | 100% | 88% |

The P@2 of 83% is the ceiling for this set: the tech-talk case has only one `good` clip. These cases are deliberately clear-cut, so read the numbers as a regression check, not as a measure of quality on real footage. Your own ratings (`--feedback`) are the better signal there.

## Adding cases

Keep them synthetic or use material you have the rights to. Give every item a unique `id`, then run `pnpm eval:hooks --dry` to validate.
