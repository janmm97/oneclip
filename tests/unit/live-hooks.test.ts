import { describe, expect, it } from "vitest";
import { findCandidates, type ClipCandidate } from "../../packages/core/src/discovery/segment.ts";
import type { HookEvaluator } from "../../packages/core/src/jev/evaluator.ts";
import { LiveHookReader } from "../../packages/core/src/jev/live.ts";
import type { HookEvaluation } from "../../packages/core/src/jev/rank.ts";
import { lineReader } from "../../packages/core/src/transcription/providers.ts";
import type { Word } from "../../packages/core/src/transcription/types.ts";

/** 10-word sentences, 0.5 s per word, for `seconds` of speech. */
function speech(seconds: number): Word[] {
  const out: Word[] = [];
  for (let i = 0; i * 0.5 < seconds; i++) {
    const t = i * 0.5;
    const pos = i % 10;
    const word = pos === 0 ? `Story${i}` : pos === 9 ? "done." : `word${pos}`;
    out.push({ word, start: t, end: t + 0.45 });
  }
  return out;
}

function fakeJev(fail = false) {
  const seen: string[][] = [];
  const evaluator = {
    async evaluate(cs: ClipCandidate[]): Promise<HookEvaluation[]> {
      seen.push(cs.map((c) => c.id));
      if (fail) throw new Error("Jev down");
      return cs.map((c) => ({ candidateId: c.id, final: c.start / 1000 }) as HookEvaluation);
    },
  } as HookEvaluator;
  return { evaluator, seen };
}

const base = { videoId: "v", preset: "standard" as const, duration: 600, prepare: async (cs: ClipCandidate[]) => cs };

describe("live hook reading", () => {
  it("lineReader joins lines split across chunks", () => {
    const lines: string[] = [];
    const feed = lineReader((l) => lines.push(l));
    feed("PROGRESS 0.1\nWORDS [{\"wo");
    feed("rd\":\"hi\"}]\r\nPART");
    expect(lines).toEqual(["PROGRESS 0.1", 'WORDS [{"word":"hi"}]']);
  });

  it("scores a slice while transcription is still running, then reuses it", async () => {
    const words = speech(600);
    const { evaluator, seen } = fakeJev();
    const hooks: ClipCandidate[] = [];
    const r = new LiveHookReader({ ...base, budget: () => 10, evaluator, onHook: (c) => hooks.push(c) });
    // Feed the first 300 s only: slice 1 (0–120 s) is settled, the last ones aren't.
    r.push(words.filter((w) => w.end <= 300));
    const early = await r.finish(words.filter((w) => w.end <= 300)).then(() => seen.length);
    expect(early).toBeGreaterThan(0);
    expect(hooks.every((c) => c.start < 240)).toBe(true);
    expect(r.hooks[0]?.evaluation.final).toBeGreaterThanOrEqual(r.hooks.at(-1)?.evaluation.final ?? 0);
  });

  it("returns the full list in time order, within the budget, from candidates findCandidates would make", async () => {
    const words = speech(600);
    const { evaluator } = fakeJev();
    const r = new LiveHookReader({ ...base, budget: () => 10, evaluator });
    for (let i = 0; i < words.length; i += 25) r.push(words.slice(i, i + 25));
    const out = await r.finish(words);
    const all = new Set(findCandidates("v", words, "standard", { maxCandidates: Number.POSITIVE_INFINITY }).map((c) => c.id));
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.every((c) => all.has(c.id))).toBe(true);
    expect(out.map((c) => c.start)).toEqual([...out.map((c) => c.start)].sort((a, b) => a - b));
    // Covers the whole source, not only the start.
    expect(out.at(-1)?.start).toBeGreaterThan(400);
  });

  it("skips live scoring when prepare returns nothing, and survives Jev errors", async () => {
    const words = speech(600);
    const skip = fakeJev();
    const r1 = new LiveHookReader({ ...base, budget: () => 10, evaluator: skip.evaluator, prepare: async () => [] });
    r1.push(words);
    expect((await r1.finish(words)).length).toBeGreaterThan(0);
    expect(skip.seen).toEqual([]);

    const down = fakeJev(true);
    const r2 = new LiveHookReader({ ...base, budget: () => 10, evaluator: down.evaluator });
    r2.push(words);
    expect((await r2.finish(words)).length).toBeGreaterThan(0);
    expect(r2.error?.message).toBe("Jev down");
    expect(down.seen.length).toBe(1);
  });
});
