import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compilePlan, HOOK_TYPES, PlanDraftSchema } from "@oneclip/core";

const skillDir = join(import.meta.dirname, "..", "..", "skills", "oneclip-hooks");
const scanner = join(skillDir, "scripts", "find-hooks.mjs");
const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");

type Hook = { start: number; text: string; score: number; hookType: string; tags: string[]; notes: string[]; jev?: { score: number } };

// Builds a transcript from lines, one word every 0.3 s, a 1 s pause between lines.
function transcript(lines: string[]) {
  const words: { text: string; start: number; end: number }[] = [];
  let t = 0;
  for (const line of lines) {
    for (const text of line.split(" ")) {
      words.push({ text, start: t, end: t + 0.25 });
      t += 0.3;
    }
    t += 1;
  }
  return { language: "en", words, captions: words };
}

function scan(lines: string[], jev: object[] = []): Hook[] {
  const dir = mkdtempSync(join(tmpdir(), "oneclip-hooks-"));
  // With a byte-order mark, as Windows tools often save it.
  writeFileSync(join(dir, "transcript.json"), `﻿${JSON.stringify(transcript(lines))}`);
  writeFileSync(join(dir, "hooks.live.jsonl"), jev.map((h) => JSON.stringify(h)).join("\n"));
  return JSON.parse(execFileSync(process.execPath, [scanner, dir, "--json"], { encoding: "utf8" }));
}

describe("oneclip-hooks scanner", () => {
  const lines = [
    "So yeah, um, like I said earlier, it was fine.",
    "Hey guys, welcome back to the channel.",
    "Posting every day is the worst advice, everyone is wrong about it.",
    "We made $40,000 from one 20-second clip.",
    "Why do most podcast clips stop at ten thousand views?",
    "You know what?",
  ];
  const hooks = scan(lines);
  const find = (s: string) => hooks.find((h) => h.text.includes(s));

  it("ranks strong lines and drops filler, greetings and generic questions", () => {
    expect(hooks.length).toBeGreaterThanOrEqual(3);
    expect(find("worst advice")?.hookType).toBe("contrarian");
    expect(find("$40,000")?.tags).toContain("proof");
    expect(find("Why do most")?.tags).toContain("question");
    expect(find("like I said")).toBeUndefined();
    expect(find("welcome back")).toBeUndefined();
    expect(find("You know what")).toBeUndefined();
  });

  it("only uses Jev hook types", () => {
    for (const h of hooks) expect(Object.keys(HOOK_TYPES)).toContain(h.hookType);
  });

  it("adds Jev's score and flags a hook that lands late in its span", () => {
    const withJev = scan(lines, [{ start: 0, end: 40, score: 0.9, hookType: "contrarian", opening: "So yeah" }]);
    const advice = withJev.find((h) => h.text.includes("worst advice"));
    expect(advice?.jev?.score).toBe(0.9);
    expect(advice?.score).toBeGreaterThan(find("worst advice")?.score ?? 0);
    expect(advice?.notes.join(" ")).toMatch(/cut the first \d/);
  });
});

describe("oneclip-hooks skill", () => {
  it("names every Jev hook type except none", () => {
    for (const t of Object.keys(HOOK_TYPES).filter((t) => t !== "none")) expect(skill).toContain(`\`${t}\``);
  });

  it("has an example plan that compiles", () => {
    const json = skill.match(/## 4\. Example plan\s+```json\n([\s\S]+?)```/)?.[1];
    expect(json).toBeDefined();
    const defaults = { template: "podcast-short", layout: "crop-center", cropMode: "center", captionPreset: "bold-pop", transitionPreset: "fade", zoomIntensity: 0, removeSilences: false, keep: [], zoomAt: [], emphasis: [], title: "", reasoning: "" };
    const draft = PlanDraftSchema.parse({ ...defaults, ...JSON.parse(json ?? "{}") });
    const c = { id: "e", videoId: "e", start: 0, end: 2000, duration: 2000, openingText: "x", transcript: "", precedingContext: "", followingContext: "" };
    const plan = compilePlan(c, [], draft, "agent edit", "preview", [], { sourceDuration: 2000 });
    expect(plan.cuts.map((x) => x.start)).toEqual(draft.segments?.map((s) => s.start));
    expect(draft.title.split(" ").length).toBeLessThanOrEqual(9);
  });
});
