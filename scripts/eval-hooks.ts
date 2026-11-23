/**
 * pnpm eval:hooks [--dry] [--feedback] [--json]
 *
 * Runs Jev over the synthetic datasets and reports:
 *   P@K, ranking agreement, strong-hook recall, false-positive rate, clarity failure rate.
 * One Jev request per example (about 1,400 TypeSafe input tokens each, 29 examples, ~41k total; measured 2026-11-24); answers are
 * cached in SQLite, so re-runs are free. --dry validates the datasets and makes no calls.
 * --feedback also scores the good/average/bad ratings you gave clips in the app (no Jev calls).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  type ClipCandidate,
  config,
  CONTEXT_GATE,
  dbJevCache,
  ensureDirs,
  findRoot,
  type HookEvaluation,
  HOOK_TYPES,
  JevHookEvaluator,
  mean,
  OneClient,
  openDb,
  precisionAtK,
  rankingAgreement,
  rate,
  schema,
  selectTop,
  STRONG,
} from "@oneclip/core";

const { values } = parseArgs({ options: { dry: { type: "boolean", default: false }, feedback: { type: "boolean", default: false }, json: { type: "boolean", default: false } } });

const Clip = z.object({
  id: z.string(),
  openingText: z.string().min(1),
  transcript: z.string().min(1),
  precedingContext: z.string(),
  followingContext: z.string(),
  duration: z.number().positive(),
  standalone: z.boolean(),
});
const Hooks = z.object({
  synthetic: z.literal(true),
  examples: z.array(Clip.extend({ hookType: z.enum(Object.keys(HOOK_TYPES) as [keyof typeof HOOK_TYPES]), strength: z.enum(["strong", "average", "weak"]) })).min(1),
});
const Cases = z.object({
  synthetic: z.literal(true),
  k: z.number().int().positive(),
  cases: z.array(z.object({ id: z.string(), title: z.string(), candidates: z.array(Clip.extend({ label: z.enum(["good", "average", "bad"]) })).min(2) })).min(1),
});

const dir = join(findRoot(), "datasets");
const hooks = Hooks.parse(JSON.parse(readFileSync(join(dir, "hook-examples.json"), "utf8")));
const cases = Cases.parse(JSON.parse(readFileSync(join(dir, "evaluation-cases.json"), "utf8")));
const ids = [...hooks.examples.map((e) => e.id), ...cases.cases.flatMap((c) => c.candidates.map((x) => x.id))];
if (new Set(ids).size !== ids.length) throw new Error("Duplicate ids in datasets");
const total = ids.length;

if (values.dry) {
  console.log(`Datasets OK: ${hooks.examples.length} hook examples, ${cases.cases.length} cases (${total - hooks.examples.length} candidates). No Jev calls made.`);
  process.exit(0);
}

const cfg = config();
ensureDirs(cfg);
const db = openDb(cfg.dbPath);
const toCandidate = (c: z.infer<typeof Clip>, videoId: string): ClipCandidate => ({ ...c, videoId, start: 0, end: c.duration });
const evaluator = new JevHookEvaluator(new OneClient({ typesafeKey: cfg.typesafeKey }), { model: cfg.jevModel, concurrency: cfg.jevConcurrency, cache: dbJevCache(db) });

console.error(`Evaluating ${total} examples with Jev (cached answers are reused)…`);
const progress = (d: number, t: number) => process.stderr.write(`\r  ${d}/${t}`);
const hookEvals = await evaluator.evaluate(hooks.examples.map((e) => toCandidate(e, "hooks")), progress);
const byId = new Map<string, HookEvaluation>(hookEvals.map((e) => [e.candidateId, e]));
for (const c of cases.cases) for (const e of await evaluator.evaluate(c.candidates.map((x) => toCandidate(x, c.id)), progress)) byId.set(e.candidateId, e);
process.stderr.write("\n");
const ev = (id: string) => byId.get(id) as HookEvaluation;

// Per-case ranking metrics.
const perCase = cases.cases.map((c) => {
  const items = c.candidates.map((x) => ({ score: ev(x.id).final, label: x.label }));
  const picked = selectTop(c.candidates.map((x) => ({ candidate: toCandidate(x, c.id), evaluation: ev(x.id) })), cases.k);
  const pickedLabels = picked.map((p) => c.candidates.find((x) => x.id === p.candidate.id) as (typeof c.candidates)[number]);
  return {
    id: c.id,
    pAtK: precisionAtK(items, cases.k),
    agreement: rankingAgreement(items),
    clarityFailures: pickedLabels.filter((x) => !x.standalone).length,
    picked: pickedLabels.length,
    ranking: [...c.candidates].sort((a, b) => ev(b.id).final - ev(a.id).final).map((x) => `${x.id}(${x.label[0]}) ${ev(x.id).final.toFixed(2)}`),
  };
});

const strong = hooks.examples.filter((e) => e.strength === "strong");
const weak = hooks.examples.filter((e) => e.strength === "weak");
const notStandalone = [...hooks.examples, ...cases.cases.flatMap((c) => c.candidates)].filter((x) => !x.standalone);
const typed = strong.filter((e) => e.hookType !== "none");

const report = {
  examples: total,
  k: cases.k,
  precisionAtK: mean(perCase.map((c) => c.pAtK)),
  rankingAgreement: mean(perCase.map((c) => c.agreement)),
  strongHookRecall: rate(strong, (e) => ev(e.id).scores.hookStrength >= STRONG),
  falsePositiveRate: rate(weak, (e) => ev(e.id).scores.hookStrength >= STRONG),
  clarityFailureRate: perCase.reduce((a, c) => a + c.clarityFailures, 0) / Math.max(1, perCase.reduce((a, c) => a + c.picked, 0)),
  contextGateCatchRate: rate(notStandalone, (x) => ev(x.id).contextIntegrity < CONTEXT_GATE),
  hookTypeAccuracy: rate(typed, (e) => ev(e.id).hookType === e.hookType),
  inputTokens: [...byId.values()].reduce((a, e) => a + (e.inputTokens || 0), 0),
  perCase,
  feedback: undefined as undefined | { ratings: number; agreement: number; meanScore: Record<string, number> },
};

if (values.feedback) {
  const rows = await db.select({ rating: schema.feedback.rating, evaluation: schema.clips.evaluation }).from(schema.feedback).innerJoin(schema.clips, (await import("drizzle-orm")).eq(schema.feedback.clipId, schema.clips.id));
  const items = rows.map((r) => ({ score: (r.evaluation as HookEvaluation).final, label: r.rating as "good" | "average" | "bad" }));
  report.feedback = {
    ratings: items.length,
    agreement: rankingAgreement(items),
    meanScore: Object.fromEntries((["good", "average", "bad"] as const).map((l) => [l, mean(items.filter((i) => i.label === l).map((i) => i.score))])),
  };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
if (values.json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`\nOneClip hook eval: ${total} synthetic examples, Jev ${cfg.jevModel}\n`);
  console.log(`P@${cases.k}                    ${pct(report.precisionAtK)}`);
  console.log(`Ranking agreement       ${pct(report.rankingAgreement)}  (pairs with different labels ordered correctly)`);
  console.log(`Strong-hook recall      ${pct(report.strongHookRecall)}  (strong openings scored ≥ ${STRONG})`);
  console.log(`False-positive rate     ${pct(report.falsePositiveRate)}  (weak openings scored ≥ ${STRONG})`);
  console.log(`Clarity failure rate    ${pct(report.clarityFailureRate)}  (picked clips that need earlier context)`);
  console.log(`Context-gate catch rate ${pct(report.contextGateCatchRate)}  (context-dependent clips flagged)`);
  console.log(`Hook-type accuracy      ${pct(report.hookTypeAccuracy)}`);
  console.log(`Input tokens (new + cached answers) ${report.inputTokens}`);
  for (const c of perCase) console.log(`\n${c.id}\n  ${c.ranking.join("\n  ")}`);
  if (report.feedback) console.log(`\nYour feedback: ${report.feedback.ratings} ratings, agreement ${pct(report.feedback.agreement)}, mean score ${JSON.stringify(report.feedback.meanScore)}`);
}
process.exit(0);
