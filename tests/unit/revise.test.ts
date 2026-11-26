import { describe, expect, it } from "vitest";
import { applyInstruction, type ClipCandidate, compilePlan, describeChanges, type PlanDraft, planToDraft, type Word } from "@oneclip/core";

const w = (word: string, start: number, end = start + 0.4) => ({ word, start, end }) as Word;
const words = [w("what", 10), w("a", 10.5), w("pass", 11), w("goal!", 30), w("unbelievable", 50), w("scenes", 51)];
const cand = { id: "c", videoId: "v", start: 10, end: 55, duration: 45, openingText: "what a pass", transcript: "", precedingContext: "", followingContext: "" } satisfies ClipCandidate;
const base: PlanDraft = {
  template: "podcast-short",
  layout: "crop-center",
  cropMode: "center",
  captionPreset: "bold-pop",
  transitionPreset: "none",
  zoomIntensity: 0.1,
  removeSilences: false,
  keep: [],
  zoomAt: [30],
  emphasis: [],
  title: "t",
  reasoning: "",
  segments: [
    { start: 10, end: 14, frame: { mode: "crop", x: 0.3, y: 0.5 } },
    { start: 28, end: 33 },
    { start: 48, end: 53, frame: { mode: "fit" } },
  ],
};
const plan = compilePlan(cand, words, base, "agent", "final", words, { sourceDuration: 100 });
const draft = planToDraft(plan);

describe("planToDraft", () => {
  it("gives one shot per cut and compiles back to the same cuts and punch-ins", () => {
    expect(draft.segments).toEqual(plan.cuts);
    const again = compilePlan(cand, words, draft, "agent", "final", words, { sourceDuration: 100 });
    expect(again.cuts).toEqual(plan.cuts);
    expect(again.zoomEvents.map((z) => z.at)).toEqual(plan.zoomEvents.map((z) => z.at));
    expect(again.editing).toEqual(plan.editing);
  });
});

describe("applyInstruction", () => {
  const seg = (d: PlanDraft | undefined, i: number) => d?.segments?.[i];

  it("targets the named shots only", () => {
    const d = applyInstruction(draft, "split shot 2");
    expect(seg(d, 1)?.frame).toEqual({ mode: "split" });
    expect(seg(d, 0)?.frame).toEqual(base.segments?.[0]?.frame);
    expect(applyInstruction(draft, "mute shots 1, 3")?.segments?.map((s) => !!s.muted)).toEqual([true, false, true]);
    expect(applyInstruction(draft, "mute shots 1 and 3")?.segments?.map((s) => !!s.muted)).toEqual([true, false, true]);
    expect(applyInstruction(draft, "slow-mo shots 2-3")?.segments?.map((s) => s.speed ?? 1)).toEqual([1, 0.5, 0.5]);
    expect(seg(applyInstruction(draft, "fit the last shot"), 2)?.frame).toEqual({ mode: "fit" });
  });

  it("handles whole-clip styles and several clauses at once", () => {
    const d = applyInstruction(draft, "karaoke captions, then no zoom; fade transitions") as PlanDraft;
    expect(d.captionPreset).toBe("karaoke");
    expect(d.zoomAt).toEqual([]);
    expect(d.zoomIntensity).toBe(0);
    expect(d.transitionPreset).toBe("fade");
  });

  it("keeps the title's case and removes shots but never all of them", () => {
    expect(applyInstruction(draft, "title: The One Habit")?.title).toBe("The One Habit");
    expect(applyInstruction(draft, "remove shot 2")?.segments?.map((s) => s.start)).toEqual([10, 48]);
    expect(applyInstruction(draft, "remove shots 1-3")).toBeUndefined();
  });

  it("trims, speeds up and changes volume", () => {
    expect(seg(applyInstruction(draft, "cut the first 2 seconds"), 0)?.start).toBe(12);
    expect(seg(applyInstruction(draft, "trim 1.5 s off the end"), 2)?.end).toBe(51.5);
    expect(applyInstruction(draft, "make it faster")?.segments?.every((s) => s.speed === 1.25)).toBe(true);
    expect(seg(applyInstruction(draft, "make shot 1 louder"), 0)?.volume).toBe(1.5);
    expect(seg(applyInstruction(draft, "focus on the left in shot 2"), 1)?.frame?.mode).toBe("crop");
  });

  it("returns undefined when nothing matched and never touches the input", () => {
    const copy = structuredClone(draft);
    expect(applyInstruction(draft, "make it go viral please")).toBeUndefined();
    applyInstruction(draft, "split shot 1");
    expect(draft).toEqual(copy);
  });
});

describe("describeChanges", () => {
  it("lists what changed in plain lines", () => {
    const after = applyInstruction(draft, "split shot 2, mute shot 3, karaoke captions") as PlanDraft;
    expect(describeChanges(draft, after)).toEqual(["Shot 2: split screen", "Shot 3: muted", "Captions: karaoke"]);
    expect(describeChanges(draft, applyInstruction(draft, "remove shot 1") as PlanDraft)).toEqual(["Cutting: 3 shots → 2 shots"]);
    expect(describeChanges(draft, draft)).toEqual([]);
  });
});
