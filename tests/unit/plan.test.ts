import { describe, expect, it } from "vitest";
import {
  buildCaptions,
  compilePlan,
  extractJsonObject,
  findCandidates,
  normalizeRanges,
  OPENCODE_AGENT,
  OPENCODE_LOCKDOWN,
  parseDraft,
  type PlanDraft,
  silenceKeepRanges,
  snapToWords,
  spread,
  TemplatePlanner,
  toOutputTime,
  toSentences,
  totalDuration,
  type Word,
} from "@oneclip/core";

/** Synthetic transcript: each sentence's words 0.4 s apart, `gap` seconds of silence between sentences. */
function words(sentences: string[], gap = 0.3, wordLen = 0.4): Word[] {
  const out: Word[] = [];
  let t = 0;
  for (const s of sentences) {
    for (const w of s.split(" ")) {
      out.push({ word: w, start: t, end: t + wordLen * 0.9 } as Word);
      t += wordLen;
    }
    t += gap;
  }
  return out;
}

describe("toSentences", () => {
  it("splits on terminal punctuation and long pauses", () => {
    const w = words(["One two three.", "Four five"], 2);
    w.push({ word: "six", start: 20, end: 20.3 } as Word);
    const s = toSentences(w);
    expect(s.map((x) => x.text)).toEqual(["One two three.", "Four five", "six"]);
  });
});

describe("findCandidates", () => {
  // 10 sentences of 10 words, ~4.3 s each.
  const s = Array.from({ length: 10 }, (_, i) => `Sentence ${i} has a few words in it right here.`);

  it("builds whole-sentence windows inside the preset range", () => {
    const c = findCandidates("vid", words(s), "quick");
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) {
      expect(x.duration).toBeGreaterThanOrEqual(10);
      expect(x.duration).toBeLessThanOrEqual(20);
      expect(x.openingText).toMatch(/^Sentence \d/);
      expect(x.transcript.endsWith(".")).toBe(true);
      expect(x.id).toBe(`vid-${Math.round(x.start * 1000)}-${Math.round(x.end * 1000)}`);
    }
  });

  it("offers both the shortest and the mid-range ending for a start", () => {
    const c = findCandidates("vid", words(s), "short").filter((x) => x.start === 0);
    expect(c.length).toBe(2);
    expect((c[0] as { duration: number }).duration).toBeLessThan((c[1] as { duration: number }).duration);
  });

  it("never starts on a dangling conjunction or a cut lowercase sentence", () => {
    const mixed = ["And this is a dangling start here.", ...s.slice(0, 4), "but also dangling now.", "lowercase means a cut thought."];
    const starts = findCandidates("vid", words(mixed), "quick").map((x) => x.openingText);
    expect(starts.some((t) => /^(And|but|lowercase)/.test(t))).toBe(false);
  });

  it("caps candidates evenly", () => {
    expect(findCandidates("vid", words(s), "quick", { maxCandidates: 3 })).toHaveLength(3);
    expect(spread([1, 2, 3, 4, 5, 6], 3)).toEqual([1, 3, 5]);
  });
});

describe("cut helpers", () => {
  const w = [
    { word: "a", start: 0, end: 0.5 },
    { word: "b", start: 0.6, end: 1 },
    { word: "c", start: 3, end: 3.5 },
  ] as Word[];

  it("removes long silences with padding", () => {
    const r = silenceKeepRanges(w, { start: 0, end: 4 });
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ start: 0, end: 1.12 });
    expect(r[1]?.start).toBeCloseTo(2.88);
  });

  it("clamps, sorts, merges and drops slivers", () => {
    expect(normalizeRanges([{ start: 5, end: 9 }, { start: -1, end: 2 }, { start: 1.5, end: 3 }, { start: 7, end: 7.1 }], { start: 0, end: 8 })).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 8 },
    ]);
  });

  it("snaps to the nearest word edge within 1.5 s only", () => {
    expect(snapToWords(0.9, w, "end")).toBe(1);
    expect(snapToWords(2.8, w, "start")).toBe(3);
    expect(snapToWords(10, w, "start")).toBe(10);
  });

  it("maps source time to output time across cuts", () => {
    const cuts = [{ start: 0, end: 2 }, { start: 5, end: 6 }];
    expect(toOutputTime(1, cuts)).toBe(1);
    expect(toOutputTime(5.5, cuts)).toBe(2.5);
    expect(toOutputTime(3, cuts)).toBeUndefined();
    expect(totalDuration(cuts)).toBe(3);
  });

  it("pages captions at sentence ends and flags emphasis", () => {
    const ws = words(["Big numbers like 40% matter.", "Yes"]);
    const pages = buildCaptions(ws, [{ start: 0, end: 100 }], ["40%"], 4);
    expect(pages[0]?.words.map((x) => x.text)).toEqual(["Big", "numbers", "like", "40%"]);
    expect(pages[0]?.words[3]?.emphasis).toBe(true);
    expect(pages[1]?.words.map((x) => x.text)).toEqual(["matter."]);
  });
});

describe("compilePlan", () => {
  const ws = words(Array.from({ length: 4 }, (_, i) => `Line ${i} of the clip goes here now.`), 1.5);
  const candidate = { id: "v-0-1", videoId: "v", start: 0, end: (ws.at(-1) as Word).end, openingText: "Line 0", transcript: "", precedingContext: "", followingContext: "", duration: 0 };

  it("turns the template draft into a valid 1080x1920 plan with silences cut", async () => {
    const draft = await new TemplatePlanner().plan({ candidate, words: ws, style: {} } as never);
    const plan = compilePlan(candidate, ws, draft, "template");
    expect(plan.output).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(plan.cuts.length).toBe(4);
    expect(plan.outputDuration).toBeLessThan(candidate.end);
    expect(plan.captions.length).toBeGreaterThan(0);
  });

  it("clamps a hostile draft to the clip", () => {
    const draft: PlanDraft = {
      template: "podcast-short",
      layout: "crop-center",
      cropMode: "center",
      captionPreset: "clean",
      transitionPreset: "none",
      zoomIntensity: 0.1,
      removeSilences: false,
      keep: [{ start: -50, end: 1e6 }],
      zoomAt: [9999],
      emphasis: [],
      title: "t",
      reasoning: "r",
    };
    const plan = compilePlan(candidate, ws, draft, "agent", "preview");
    expect(plan.cuts).toEqual([{ start: 0, end: candidate.end }]);
    expect(plan.output.width).toBe(540);
    for (const z of plan.zoomEvents) expect(z.at).toBeLessThanOrEqual(plan.outputDuration);
  });
});

describe("agent output parsing", () => {
  it("finds the first balanced JSON object in prose or fences", () => {
    expect(extractJsonObject('Sure!\n```json\n{"a":{"b":"}"},"c":1}\n```')).toEqual({ a: { b: "}" }, c: 1 });
    expect(extractJsonObject("{broken {\"ok\":true}")).toEqual({ ok: true });
    expect(extractJsonObject("no json")).toBeUndefined();
  });

  it("rejects values outside the allow-list", () => {
    const bad = { template: "rm -rf /", layout: "crop-center", cropMode: "center", captionPreset: "clean", transitionPreset: "none", zoomIntensity: 0.1, removeSilences: true, keep: [], zoomAt: [], emphasis: [], title: "", reasoning: "" };
    expect(() => parseDraft(bad, "Agent")).toThrow(/Agent returned an invalid plan: template/);
    expect(() => parseDraft({ ...bad, template: "podcast-short", zoomIntensity: 5 }, "Agent")).toThrow(/zoomIntensity/);
    expect(parseDraft({ ...bad, template: "podcast-short" }, "Agent").template).toBe("podcast-short");
  });

  it("runs OpenCode with no tools, so injected speech can't act", () => {
    expect(OPENCODE_LOCKDOWN.permission).toMatchObject({ bash: "deny", edit: "deny", webfetch: "deny" });
    expect(OPENCODE_LOCKDOWN.tools).toMatchObject({ "*": false, bash: false, edit: false, write: false, webfetch: false });
    // The dedicated agent is locked too, so user agent-level config can't re-enable tools for it.
    const agent = OPENCODE_LOCKDOWN.agent[OPENCODE_AGENT];
    expect(agent.permission).toMatchObject({ bash: "deny", edit: "deny", webfetch: "deny" });
    expect(agent.tools).toMatchObject({ "*": false, bash: false, edit: false, write: false, webfetch: false });
  });
});
