import { describe, expect, it } from "vitest";
import { type ClipCandidate, compilePlan, EditPlanSchema, heardAt, type PlanDraft, PlanDraftSchema, toOutputTime, totalDuration, type Word } from "@oneclip/core";

const w = (word: string, start: number, end = start + 0.4) => ({ word, start, end }) as Word;
// "goal" is said at 50 s, the commentator's call at 120 s.
const words = [w("what", 10), w("a", 10.5), w("pass", 11), w("goal!", 50), w("unbelievable", 120), w("scenes", 121)];
const cand = { id: "c", videoId: "v", start: 10, end: 20, duration: 10, openingText: "what a pass", transcript: "", precedingContext: "", followingContext: "" } satisfies ClipCandidate;
const base: PlanDraft = {
  template: "podcast-short",
  layout: "crop-center",
  cropMode: "center",
  captionPreset: "bold-pop",
  transitionPreset: "none",
  zoomIntensity: 0,
  removeSilences: false,
  keep: [],
  zoomAt: [],
  emphasis: [],
  title: "t",
  reasoning: "",
};

describe("scene mixing", () => {
  it("keeps shots in the agent's order (repeats too), swaps sound and follows it with captions", () => {
    const plan = compilePlan(
      cand,
      words,
      {
        ...base,
        segments: [
          { start: 48, end: 52 }, // the goal, its own sound
          { start: 48, end: 50, speed: 0.5, audioFrom: 120 }, // slow-mo replay under the commentator's call
          { start: 10, end: 12, muted: true, cropMode: "left-third" },
        ],
      },
      "agent",
      "final",
      words,
      { sourceDuration: 200 },
    );
    expect(plan.cuts).toEqual([
      { start: 48, end: 52 },
      { start: 48, end: 50, speed: 0.5, audioFrom: 120 },
      { start: 10, end: 12, muted: true, cropMode: "left-third" },
    ]);
    expect(plan.outputDuration).toBe(4 + 4 + 2);
    expect(plan.sourceStart).toBe(10);
    expect(plan.sourceEnd).toBe(122);
    const said = plan.captions.flatMap((c) => c.words.map((x) => [x.text, +x.start.toFixed(2)]));
    // "goal!" at 2 s; the call plays at half speed from 4 s; nothing from the muted shot.
    expect(said).toEqual([
      ["goal!", 2],
      ["unbelievable", 4],
      ["scenes", 6],
    ]);
    expect(EditPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("without the source length keeps every shot inside the clip and pulls borrowed sound back in", () => {
    const plan = compilePlan(cand, words, { ...base, segments: [{ start: 5, end: 14, audioFrom: 300 }, { start: 30, end: 40 }] }, "agent");
    expect(plan.cuts).toEqual([{ start: 10, end: 14, audioFrom: 16 }]);
  });

  it("falls back to the whole clip when every shot is a sliver", () => {
    expect(compilePlan(cand, words, { ...base, segments: [{ start: 11, end: 11.1 }] }, "agent").cuts).toEqual([{ start: 10, end: 20 }]);
  });

  it("lays a bed under the mix and ducks it where speech is heard", () => {
    const plan = compilePlan(
      cand,
      words,
      { ...base, segments: [{ start: 10, end: 12 }, { start: 60, end: 64, muted: true }], bed: { start: 150, volume: 0.5, duck: 0.2 } },
      "agent",
      "final",
      words,
      { sourceDuration: 200 },
    );
    expect(plan.bed?.start).toBe(150);
    expect(plan.bed?.end).toBe(156); // as long as the mix
    expect(plan.bed?.duckUnder).toHaveLength(1);
    expect(plan.bed?.duckUnder[0]?.start).toBeCloseTo(0);
    expect(plan.bed?.duckUnder[0]?.end).toBeCloseTo(1.5);
    expect(plan.sourceEnd).toBe(156);
  });

  it("speed changes stretch output time", () => {
    const cuts = [{ start: 0, end: 4, speed: 2 }, { start: 10, end: 11, speed: 0.5 }];
    expect(totalDuration(cuts)).toBe(4);
    expect(toOutputTime(10.5, cuts)).toBe(3);
    expect(heardAt({ start: 10, end: 10.4 }, [{ start: 0, end: 1, audioFrom: 10 }, { start: 0, end: 1, audioFrom: 10 }])).toHaveLength(2);
  });

  it("rejects out-of-range mix values", () => {
    expect(PlanDraftSchema.safeParse({ ...base, segments: [{ start: 0, end: 1, speed: 4 }] }).success).toBe(false);
    expect(PlanDraftSchema.safeParse({ ...base, segments: [{ start: 2, end: 1 }] }).success).toBe(false);
    expect(PlanDraftSchema.safeParse({ ...base, bed: { start: 0, volume: 3, duck: 0.2 } }).success).toBe(false);
    expect(PlanDraftSchema.safeParse({ ...base, segments: Array.from({ length: 61 }, () => ({ start: 0, end: 1 })) }).success).toBe(false);
  });
});
