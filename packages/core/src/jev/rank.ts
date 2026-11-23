import type { ClipCandidate } from "../discovery/segment.ts";
import type { JevResponse } from "../one/client.ts";
import { HOOK_TYPES, QUESTIONS, WEIGHTS, type Dimension, type HookType } from "./questions.ts";

export interface HookEvaluation {
  candidateId: string;
  /** Each dimension normalised to 0..1. */
  scores: Record<Dimension, number>;
  contextIntegrity: number;
  hookType: HookType;
  hookTypeConfidence: number;
  /** Weighted sum before penalties, 0..1. */
  weighted: number;
  /** After penalties, 0..1. This is what ranking uses. */
  final: number;
  penalties: string[];
  model: string;
  inputTokens: number;
}

/** Score answers are an index 0..n-1 (possibly fractional: Jev returns the expectation). Normalise to 0..1. */
export function normalizeScore(score: number, levels: number): number {
  if (levels <= 1) return 0;
  return Math.min(1, Math.max(0, score / (levels - 1)));
}

export const CONTEXT_GATE = 0.5;

export function toEvaluation(candidateId: string, res: JevResponse): HookEvaluation {
  const scores = {} as Record<Dimension, number>;
  for (const dim of Object.keys(WEIGHTS) as Dimension[]) {
    const a = res.answers[dim];
    const q = QUESTIONS[dim];
    if (!a || a.type !== "score" || q.type !== "score") throw new Error(`Jev answer for ${dim} missing or not a score`);
    scores[dim] = normalizeScore(a.score, q.criteria.length);
  }
  const ci = res.answers.contextIntegrity;
  const contextIntegrity = ci && ci.type === "noul" ? ci.noul : 0;
  const ht = res.answers.hookType;
  const hookType = (ht && ht.type === "choice" && ht.choice in HOOK_TYPES ? ht.choice : "none") as HookType;
  const hookTypeConfidence = ht && ht.type === "choice" ? (ht.confidence ?? 0) : 0;

  const weighted = (Object.keys(WEIGHTS) as Dimension[]).reduce((s, d) => s + WEIGHTS[d] * scores[d], 0);
  const { final, penalties } = applyPenalties(weighted, scores, contextIntegrity, hookType);
  return {
    candidateId,
    scores,
    contextIntegrity,
    hookType,
    hookTypeConfidence,
    weighted,
    final,
    penalties,
    model: res.model,
    inputTokens: res.usage?.input_tokens ?? 0,
  };
}

export function applyPenalties(weighted: number, scores: Record<Dimension, number>, contextIntegrity: number, hookType: HookType) {
  let final = weighted;
  const penalties: string[] = [];
  if (contextIntegrity < CONTEXT_GATE) {
    final *= 0.5;
    penalties.push(`context integrity ${contextIntegrity.toFixed(2)} below gate ${CONTEXT_GATE}: ×0.5`);
  }
  if (scores.standaloneClarity < 0.35) {
    final *= 0.8;
    penalties.push("low standalone clarity: ×0.8");
  }
  if (hookType === "none" && scores.hookStrength < 0.5) {
    final *= 0.9;
    penalties.push("no recognisable hook: ×0.9");
  }
  return { final, penalties };
}

/** Time overlap as a share of the shorter clip. */
export function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shorter > 0 ? inter / shorter : 0;
}

/** Word-set Jaccard similarity of two transcripts. */
export function textSimilarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);
  const wb = new Set(b.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

export interface RankedClip {
  candidate: ClipCandidate;
  evaluation: HookEvaluation;
  rank: number;
}

/**
 * Greedy selection: best final score first, skipping clips that overlap a
 * chosen one by more than half or repeat its words. Clips that fail the
 * context gate are only used when there aren't enough clean ones.
 */
export function selectTop(
  items: { candidate: ClipCandidate; evaluation: HookEvaluation }[],
  topN: number,
  opts: { maxOverlap?: number; maxSimilarity?: number } = {},
): RankedClip[] {
  const maxOverlap = opts.maxOverlap ?? 0.5;
  const maxSimilarity = opts.maxSimilarity ?? 0.6;
  const sorted = [...items].sort((a, b) => b.evaluation.final - a.evaluation.final);
  const passes = [sorted.filter((i) => i.evaluation.contextIntegrity >= CONTEXT_GATE), sorted.filter((i) => i.evaluation.contextIntegrity < CONTEXT_GATE)];
  const chosen: typeof items = [];
  for (const pool of passes) {
    for (const item of pool) {
      if (chosen.length >= topN) break;
      const dup = chosen.some(
        (c) =>
          overlapRatio(c.candidate, item.candidate) > maxOverlap ||
          textSimilarity(c.candidate.transcript, item.candidate.transcript) > maxSimilarity,
      );
      if (!dup) chosen.push(item);
    }
  }
  return chosen.sort((a, b) => b.evaluation.final - a.evaluation.final).map((c, i) => ({ ...c, rank: i + 1 }));
}
