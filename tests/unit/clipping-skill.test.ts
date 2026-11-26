import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTION_PRESETS, compilePlan, LAYOUTS, PlanDraftSchema, TRANSITION_PRESETS } from "@oneclip/core";

const skillDir = join(import.meta.dirname, "..", "..", "skills", "oneclip-clipping");
const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");

describe("oneclip-clipping skill", () => {
  it("has frontmatter the skill installers read", () => {
    expect(skill).toMatch(/^---\nname: oneclip-clipping\ndescription: .{50,1024}\n---\n/);
  });

  it("ships its research with sources and points to the other OneClip skills", () => {
    const research = join(skillDir, "references", "research.md");
    expect(existsSync(research)).toBe(true);
    expect(readFileSync(research, "utf8")).toContain("## Sources");
    expect(skill).toContain("references/research.md");
    for (const s of ["oneclip-hooks", "oneclip-editor"]) expect(skill).toContain(`\`${s}\``);
  });

  it("names only plan values that exist", () => {
    for (const v of [...LAYOUTS, ...CAPTION_PRESETS]) expect(skill).toContain(v);
    for (const v of skill.matchAll(/transitionPreset: "([a-z-]+)"/g)) expect(TRANSITION_PRESETS).toContain(v[1]);
    for (const v of skill.matchAll(/captionPreset: "([a-z-]+)"/g)) expect(CAPTION_PRESETS).toContain(v[1]);
    for (const v of skill.matchAll(/layout: "([a-z-]+)"/g)) expect(LAYOUTS).toContain(v[1]);
  });

  it("has an example plan that compiles to a clip of the default length", () => {
    const json = skill.match(/## 5\. Example plan[\s\S]*?```json\n([\s\S]+?)```/)?.[1];
    expect(json).toBeDefined();
    const defaults = { template: "podcast-short", layout: "crop-center", cropMode: "center", captionPreset: "bold-pop", transitionPreset: "fade", zoomIntensity: 0, removeSilences: false, keep: [], zoomAt: [], emphasis: [], title: "", reasoning: "" };
    const draft = PlanDraftSchema.parse({ ...defaults, ...JSON.parse(json ?? "{}") });
    const c = { id: "e", videoId: "e", start: 0, end: 3000, duration: 3000, openingText: "x", transcript: "", precedingContext: "", followingContext: "" };
    const plan = compilePlan(c, [], draft, "agent edit", "preview", [], { sourceDuration: 3000 });
    expect(plan.cuts.map((x) => x.start)).toEqual(draft.segments?.map((s) => s.start));
    expect(plan.outputDuration).toBeGreaterThanOrEqual(20);
    expect(plan.outputDuration).toBeLessThanOrEqual(45);
    expect(plan.zoomEvents.length).toBeGreaterThan(0);
  });
});
