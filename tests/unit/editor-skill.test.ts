import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compilePlan, PlanDraftSchema } from "@oneclip/core";

// The editor skill's recipes must stay valid plans: if the schema changes, these fail.
const dir = join(import.meta.dirname, "..", "..", "skills", "oneclip-editor", "examples");
const defaults = { template: "podcast-short", layout: "crop-center", cropMode: "center", captionPreset: "bold-pop", transitionPreset: "fade", zoomIntensity: 0, removeSilences: false, keep: [], zoomAt: [], emphasis: [], title: "", reasoning: "" };

describe("oneclip-editor skill examples", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("has the recipes the skill names", () => {
    expect(files.sort()).toEqual(["music-montage.json", "sports-replay.json", "voice-over-broll.json"]);
    const skill = readFileSync(join(dir, "..", "SKILL.md"), "utf8");
    for (const f of files) expect(skill).toContain(f);
  });

  it.each(files)("%s compiles into a plan with every segment in order", (f) => {
    const draft = PlanDraftSchema.parse({ ...defaults, ...JSON.parse(readFileSync(join(dir, f), "utf8")) });
    const c = { id: "e", videoId: "e", start: 0, end: 600, duration: 600, openingText: "x", transcript: "", precedingContext: "", followingContext: "" };
    const plan = compilePlan(c, [], draft, "agent edit", "preview", [], { sourceDuration: 600 });
    expect(plan.cuts.map((x) => x.start)).toEqual(draft.segments?.map((s) => s.start));
    expect(!!plan.bed).toBe(!!draft.bed);
  });
});
