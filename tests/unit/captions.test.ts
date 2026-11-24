import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  captionTrack,
  cleanCaption,
  compilePlan,
  config,
  cuesToWords,
  openDb,
  parseVtt,
  pickEnglish,
  ProjectSettingsSchema,
  TemplatePlanner,
  type TranscribeOptions,
  type Transcript,
  type TranscriptionProvider,
  type Word,
} from "@oneclip/core";

// YouTube auto captions roll: each cue repeats the line before it.
const ROLLING = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.000 align:start position:0%
I'm the <c>one</c> &amp; only

00:00:03.000 --> 00:00:03.010
I'm the one & only

00:00:03.010 --> 00:00:05.000
I'm the one & only
[Music] ♪ walking on fire ♪
`;

describe("subtitles", () => {
  it("parses rolling YouTube VTT without repeating lines or labels", () => {
    expect(parseVtt(ROLLING)).toEqual([
      { start: 1, end: 3, text: "I'm the one & only" },
      { start: 3.01, end: 5, text: "walking on fire" },
    ]);
  });

  it("cleans tags, entities and sound labels", () => {
    expect(cleanCaption("<i>Hey</i> (laughs) you &#39;re")).toBe("Hey you 're");
  });

  it("spreads a cue's time over its words in order", () => {
    const w = cuesToWords([{ start: 2, end: 4, text: "go go go go" }]);
    expect(w.map((x) => x.word)).toEqual(["go", "go", "go", "go"]);
    expect(w[0]?.start).toBe(2);
    expect(w[3]?.end).toBeCloseTo(4, 3);
  });

  it("prefers plain English, then US/UK, and ignores other languages", () => {
    expect(pickEnglish(["subs.ko.vtt", "subs.en-de.vtt", "subs.en-US.vtt", "subs.en.vtt"])).toBe("subs.en.vtt");
    expect(pickEnglish(["subs.ko.vtt", "subs.en-de.vtt", "subs.en-GB.vtt"])).toBe("subs.en-GB.vtt");
    expect(pickEnglish(["subs.ko.vtt", "source.info.json"])).toBeUndefined();
  });
});

const korean: Transcript = {
  engine: "mock",
  model: "fixture",
  language: "ko",
  duration: 10,
  words: Array.from({ length: 12 }, (_, i) => ({ word: "사랑해", start: i * 0.8, end: i * 0.8 + 0.6 })),
};
const english = (n = 8): Word[] => Array.from({ length: n }, (_, i) => ({ word: `love${i}`, start: i, end: i + 0.8 }));

/** MOCK transcriber: records the task, "translates" to fixed English words. */
function mockProvider(fail = false) {
  const calls: TranscribeOptions[] = [];
  const p: TranscriptionProvider = {
    name: "mock",
    available: async () => ({ ok: true, detail: "" }),
    transcribe: async (_wav, opts) => {
      calls.push(opts);
      if (fail) throw new Error("model crashed");
      return { ...korean, language: "en", words: english() };
    },
  };
  return { p, calls };
}

describe("captionTrack", () => {
  const dir = mkdtempSync(join(tmpdir(), "oneclip-cap-"));
  const cfg = config({ ...process.env, ONECLIP_DATA_DIR: join(dir, "data") });
  const db = openDb(join(dir, "t.db"));
  afterAll(() => {
    (db as unknown as { $client?: { close?: () => void } }).$client?.close?.();
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows can keep the SQLite file locked until the worker exits; the OS temp dir is cleaned later.
    }
  });
  const base = (captions: string, key: string, provider: TranscriptionProvider, t = korean) =>
    captionTrack({ db, cfg }, ProjectSettingsSchema.parse({ captions }), t, { dir, provider, key, wav: async () => "audio.wav" });

  it("defaults to English captions", () => {
    expect(ProjectSettingsSchema.parse({}).captions).toBe("english");
  });

  it("off gives no caption words", async () => {
    const r = await base("off", "k-off", mockProvider().p);
    expect(r.words).toEqual([]);
  });

  it("original keeps the spoken words", async () => {
    const r = await base("original", "k-orig", mockProvider().p);
    expect(r.words).toBe(korean.words);
    expect(r.source).toContain("Korean");
  });

  it("english leaves English speech alone", async () => {
    const m = mockProvider();
    const r = await base("english", "k-en", m.p, { ...korean, language: "en" });
    expect(r.words).toBe(korean.words);
    expect(m.calls).toEqual([]);
  });

  it("english translates other languages with Whisper and caches the result", async () => {
    const m = mockProvider();
    const r = await base("english", "k-ko", m.p);
    expect(m.calls[0]?.task).toBe("translate");
    expect(r.words.map((w) => w.word)).toEqual(english().map((w) => w.word));
    expect(r.source).toMatch(/translated from Korean/);
    await base("english", "k-ko", m.p);
    expect(m.calls.length).toBe(1);
  });

  it("asks the page for the language when ONNX Whisper (which decodes in English) can't tell", async () => {
    const onnx = { ...korean, engine: "whisper-onnx", language: "en" };
    const m = mockProvider();
    const unknown = await captionTrack({ db, cfg }, ProjectSettingsSchema.parse({}), onnx, { dir, provider: m.p, key: "k-onnx", wav: async () => "a.wav" });
    expect(unknown.words).toBe(onnx.words);
    expect(m.calls).toEqual([]);
    const page = join(dir, "page");
    mkdirSync(page);
    writeFileSync(join(page, "source.info.json"), JSON.stringify({ language: "ko" }));
    const r = await captionTrack({ db, cfg }, ProjectSettingsSchema.parse({}), onnx, { dir: page, provider: m.p, key: "k-onnx-ko", wav: async () => "a.wav" });
    expect(m.calls[0]).toMatchObject({ task: "translate", language: "ko" });
    expect(r.source).toMatch(/translated from Korean/);
  });

  it("falls back to the spoken words, and says why, when translation fails", async () => {
    const r = await base("english", "k-fail", mockProvider(true).p);
    expect(r.words).toBe(korean.words);
    expect(r.source).toMatch(/translation failed: model crashed/);
  });
});

describe("compilePlan caption track", () => {
  const candidate = { id: "v-0-1", videoId: "v", start: 0, end: 9.6, openingText: "", transcript: "", precedingContext: "", followingContext: "", duration: 0 };
  const plan = async (captionWords?: Word[]) => {
    const draft = await new TemplatePlanner().plan({ candidate, words: korean.words, style: {} } as never);
    return compilePlan(candidate, korean.words, draft, "template", "final", captionWords);
  };

  it("captions show the English track while cuts follow the spoken words", async () => {
    const p = await plan(english());
    const text = p.captions.flatMap((c) => c.words.map((w) => w.text));
    expect(text.length).toBeGreaterThan(0);
    expect(text.every((t) => t.startsWith("love"))).toBe(true);
  });

  it("an empty track means a clip without captions", async () => {
    expect((await plan([])).captions).toEqual([]);
  });

  it("without a track it captions the spoken words, as before", async () => {
    const p = await plan();
    expect(p.captions[0]?.words[0]?.text).toBe("사랑해");
  });
});
