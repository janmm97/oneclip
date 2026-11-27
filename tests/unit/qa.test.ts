import { describe, expect, it } from "vitest";
import { type ClipCandidate, compilePlan, cutOffFaces, cutStarts, fixPlan, type PlanDraft, parseReview, parseTechnical, REVIEW_JSON_SCHEMA, reviewTimes, type Word } from "@oneclip/core";

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
  zoomAt: [],
  emphasis: [],
  title: "t",
  reasoning: "",
  segments: [
    { start: 10, end: 14, frame: { mode: "crop", x: 0.3, y: 0.5 } },
    { start: 28, end: 33 },
    { start: 48, end: 53, frame: { mode: "crop", x: 0.6, y: 0.5 } },
  ],
};
const plan = compilePlan(cand, words, base, "agent", "final", words, { sourceDuration: 100 });

describe("FFmpeg checks", () => {
  it("turns black, frozen, dead air and loudness lines into issues", () => {
    const stderr = [
      "[blackdetect @ 0x1] black_start:0 black_end:0.6 black_duration:0.6",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 4.2",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 2.1",
      "[silencedetect @ 0x3] silence_start: 6",
      "[silencedetect @ 0x3] silence_end: 8.5 | silence_duration: 2.5",
      "[Parsed_ebur128_0 @ 0x4] Summary:",
      "  Integrated loudness:",
      "    I:         -24.0 LUFS",
      "  True peak:",
      "    Peak:       -0.2 dBFS",
    ].join("\n");
    const kinds = parseTechnical(stderr, 12, -14).map((i) => i.kind);
    expect(kinds).toEqual(["black", "frozen", "dead_air", "too_quiet", "clipping"]);
  });

  it("catches silence running to the end and finds nothing on a clean file", () => {
    expect(parseTechnical("silence_start: 9.5", 12, -14).map((i) => i.kind)).toEqual(["dead_air"]);
    expect(parseTechnical("Summary:\n I: -14.2 LUFS\n Peak: -1.5 dBFS", 12, -14)).toEqual([]);
  });
});

describe("which frames get reviewed", () => {
  it("looks just after every cut, every 2 s and at the end, in order", () => {
    const starts = cutStarts(plan);
    expect(starts).toHaveLength(3);
    const ts = reviewTimes(plan);
    for (const s of starts.slice(1)) expect(ts.some((t) => Math.abs(t - (s + 0.2)) < 0.41)).toBe(true);
    expect(ts[ts.length - 1]).toBeGreaterThan(plan.outputDuration - 0.5);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it("caps the number of frames", () => {
    expect(reviewTimes(plan, 5)).toHaveLength(5);
  });
});

describe("face check", () => {
  it("flags a face touching the edge, ignores a centred or tiny one", () => {
    expect(cutOffFaces([{ x0: 0, x1: 0.2, y0: 0.2, y1: 0.4 }], 3)).toMatchObject([{ kind: "face_cut_off", fix: "fit", at: 3 }]);
    expect(cutOffFaces([{ x0: 0.3, x1: 0.6, y0: 0.2, y1: 0.4 }], 3)).toEqual([]);
    expect(cutOffFaces([{ x0: 0.99, x1: 1, y0: 0.2, y1: 0.21 }], 3)).toEqual([]);
  });
});

describe("the agent's review", () => {
  it("maps image numbers to times and unknown kinds and fixes to safe values", () => {
    const raw = `Here you go: ${JSON.stringify({ issues: [{ i: 2, kind: "duplicate_person", severity: "blocker", detail: "Same man in both halves.", fix: "fit" }, { i: 9, kind: "weird", severity: "huge", detail: "x", fix: "explode" }], score: 4 })}`;
    const r = parseReview(raw, [0.2, 2, 4], "Claude Code");
    expect(r.score).toBe(4);
    expect(r.issues[0]).toMatchObject({ at: 2, kind: "duplicate_person", severity: "blocker", fix: "fit", by: "Claude Code" });
    expect(r.issues[1]).toMatchObject({ at: 4, kind: "other", severity: "minor", fix: "none" });
  });

  it("throws on a reply without JSON", () => {
    expect(() => parseReview("looks great!", [1], "x")).toThrow(/no JSON/);
  });

  it("sends Claude Code a schema it accepts (no 2020-12 $schema)", () => {
    expect(REVIEW_JSON_SCHEMA).not.toContain("$schema");
    expect(JSON.parse(REVIEW_JSON_SCHEMA).required).toEqual(["issues", "score"]);
  });
});

describe("fixPlan", () => {
  it("fits the shot a framing problem is in and leaves the others alone", () => {
    const at = cutStarts(plan)[2]! + 0.5;
    const { plan: p, changes } = fixPlan(plan, [{ at, kind: "duplicate_person", severity: "blocker", detail: "", fix: "fit", by: "x" }]);
    expect(p.cuts[2]!.frame).toEqual({ mode: "fit" });
    expect(p.cuts[0]!.frame).toEqual(plan.cuts[0]!.frame);
    expect(changes).toHaveLength(1);
    expect(plan.cuts[2]!.frame).not.toEqual({ mode: "fit" }); // the input is not changed
  });

  it("moves an overlapping caption page to the other half once", () => {
    const page = plan.captions[0]!;
    const issue = { at: page.start, kind: "caption_over_face" as const, severity: "major" as const, detail: "", fix: "move_captions" as const, by: "x" };
    const { plan: p, changes } = fixPlan(plan, [issue, issue]);
    expect(p.captions[0]!.y! < 0.5 !== ((page.y ?? 0.74) < 0.5)).toBe(true);
    expect(changes).toHaveLength(1);
  });

  it("never flips a caption page back on a later pass", () => {
    const page = plan.captions[0]!;
    const issue = { at: page.start, kind: "caption_over_face" as const, severity: "major" as const, detail: "", fix: "move_captions" as const, by: "x" };
    const moved = new Set<number>();
    const first = fixPlan(plan, [issue], moved);
    const second = fixPlan(first.plan, [issue], moved);
    expect(second.changes).toEqual([]);
    expect(second.plan.captions[0]!.y).toBe(first.plan.captions[0]!.y);
  });

  it("reports no change when nothing has a fix, so the loop stops", () => {
    expect(fixPlan(plan, [{ at: 1, kind: "blurry", severity: "minor", detail: "", fix: "none", by: "x" }]).changes).toEqual([]);
  });
});
