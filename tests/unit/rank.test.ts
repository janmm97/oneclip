// MOCK: Jev replies here are hand-written fixtures in the jev-1.14.0 wire format.
import { describe, expect, it } from "vitest";
import {
  applyPenalties,
  type ClipCandidate,
  CONTEXT_GATE,
  type HookEvaluation,
  normalizeScore,
  overlapRatio,
  QUESTIONS,
  selectTop,
  textSimilarity,
  toEvaluation,
  WEIGHTS,
} from "@oneclip/core";

type Dim = keyof typeof WEIGHTS;
const dims = Object.keys(WEIGHTS) as Dim[];
const levels = (d: Dim) => {
  const q = QUESTIONS[d];
  return q.type === "score" ? q.criteria.length : 0;
};

function reply(level: number, ctx: number, hookType = "curiosity") {
  const answers: Record<string, unknown> = {};
  for (const d of dims) answers[d] = { type: "score", score: level * (levels(d) - 1) };
  answers.contextIntegrity = { type: "noul", noul: ctx };
  answers.hookType = { type: "choice", choice: hookType, confidence: 0.8 };
  return { model: "jev-1.14.0", answers, usage: { input_tokens: 1400, output_tokens: 20 } } as never;
}

describe("weights", () => {
  it("sum to 1", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe("normalizeScore", () => {
  it("maps an index 0..n-1 to 0..1 and clamps", () => {
    expect(normalizeScore(0, 5)).toBe(0);
    expect(normalizeScore(4, 5)).toBe(1);
    expect(normalizeScore(2, 5)).toBe(0.5);
    expect(normalizeScore(9, 5)).toBe(1);
    expect(normalizeScore(-1, 5)).toBe(0);
    expect(normalizeScore(1, 1)).toBe(0);
  });
});

describe("toEvaluation", () => {
  it("weights a perfect clip to 1 with no penalties", () => {
    const e = toEvaluation("c1", reply(1, 0.9));
    expect(e.weighted).toBeCloseTo(1);
    expect(e.final).toBeCloseTo(1);
    expect(e.penalties).toEqual([]);
    expect(e.hookType).toBe("curiosity");
    expect(e.inputTokens).toBe(1400);
  });

  it("halves a clip that fails the context gate", () => {
    const e = toEvaluation("c1", reply(1, CONTEXT_GATE - 0.1));
    expect(e.final).toBeCloseTo(0.5);
    expect(e.penalties[0]).toMatch(/context integrity/);
  });

  it("falls back to hook type none for unknown choices", () => {
    expect(toEvaluation("c1", reply(1, 0.9, "made_up")).hookType).toBe("none");
  });

  it("throws when a score answer is missing", () => {
    const r = reply(1, 0.9) as { answers: Record<string, unknown> };
    delete r.answers.novelty;
    expect(() => toEvaluation("c1", r as never)).toThrow(/novelty/);
  });
});

describe("applyPenalties", () => {
  const scores = (over: Partial<Record<Dim, number>> = {}) => ({ ...Object.fromEntries(dims.map((d) => [d, 0.8])), ...over }) as Record<Dim, number>;
  it("stacks all three penalties", () => {
    const { final, penalties } = applyPenalties(1, scores({ standaloneClarity: 0.2, hookStrength: 0.3 }), 0.1, "none");
    expect(final).toBeCloseTo(0.5 * 0.8 * 0.9);
    expect(penalties).toHaveLength(3);
  });
  it("leaves a clean clip alone", () => {
    expect(applyPenalties(0.7, scores(), 0.9, "contrarian")).toEqual({ final: 0.7, penalties: [] });
  });
});

describe("overlap and similarity", () => {
  it("measures overlap as a share of the shorter clip", () => {
    expect(overlapRatio({ start: 0, end: 10 }, { start: 5, end: 30 })).toBe(0.5);
    expect(overlapRatio({ start: 0, end: 10 }, { start: 20, end: 30 })).toBe(0);
    expect(overlapRatio({ start: 0, end: 30 }, { start: 10, end: 20 })).toBe(1);
  });
  it("computes word Jaccard similarity", () => {
    expect(textSimilarity("a b c", "a b c")).toBe(1);
    expect(textSimilarity("a b", "c d")).toBe(0);
    expect(textSimilarity("A b", "a c")).toBeCloseTo(1 / 3);
    expect(textSimilarity("", "a")).toBe(0);
  });
});

describe("selectTop", () => {
  const cand = (id: string, start: number, end: number, transcript = id): ClipCandidate => ({
    id,
    videoId: "v",
    start,
    end,
    openingText: id,
    transcript,
    precedingContext: "",
    followingContext: "",
    duration: end - start,
  });
  const ev = (id: string, final: number, ctx = 0.9) => ({ candidateId: id, final, contextIntegrity: ctx }) as HookEvaluation;

  it("ranks by final score, dedupes overlaps and repeated text", () => {
    const items = [
      { candidate: cand("a", 0, 30, "one two three four"), evaluation: ev("a", 0.9) },
      { candidate: cand("b", 10, 40, "five six seven"), evaluation: ev("b", 0.8) }, // overlaps a by 2/3
      { candidate: cand("c", 100, 130, "one two three four"), evaluation: ev("c", 0.7) }, // same words as a
      { candidate: cand("d", 200, 230, "eight nine ten"), evaluation: ev("d", 0.6) },
    ];
    const top = selectTop(items, 5);
    expect(top.map((t) => t.candidate.id)).toEqual(["a", "d"]);
    expect(top.map((t) => t.rank)).toEqual([1, 2]);
  });

  it("only uses gate-failing clips when clean ones run out", () => {
    const items = [
      { candidate: cand("x", 0, 20, "x words"), evaluation: ev("x", 0.95, 0.1) },
      { candidate: cand("y", 50, 70, "y words"), evaluation: ev("y", 0.4) },
    ];
    expect(selectTop(items, 1).map((t) => t.candidate.id)).toEqual(["y"]);
    expect(selectTop(items, 2).map((t) => t.candidate.id)).toEqual(["x", "y"]); // both kept; final order is by score
  });
});
