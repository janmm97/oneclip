import { describe, expect, it } from "vitest";
import { attachMedia, classifyMedia, findMoments, jevState, mixCandidates, parseMetadataLog, type ClipCandidate, type MediaSignals, type Word } from "@oneclip/core";

// Real FFmpeg stderr shape (astats per 1 s, scene score at 2 fps).
const AUDIO_LOG = `[Parsed_ametadata_3 @ 0000] frame:0    pts:0       pts_time:0
[Parsed_ametadata_3 @ 0000] lavfi.astats.Overall.RMS_level=-inf
[Parsed_ametadata_3 @ 0000] frame:1    pts:8000    pts_time:1
[Parsed_ametadata_3 @ 0000] lavfi.astats.Overall.RMS_level=-21.5
[Parsed_ametadata_3 @ 0000] frame:2    pts:16000   pts_time:2\r
[Parsed_ametadata_3 @ 0000] lavfi.astats.Overall.RMS_level=-12.25\r
`;
const VIDEO_LOG = `[Parsed_metadata_3 @ 0000] frame:0 pts:1 pts_time:0.5
[Parsed_metadata_3 @ 0000] lavfi.scene_score=0.04
[Parsed_metadata_3 @ 0000] frame:1 pts:2 pts_time:1
[Parsed_metadata_3 @ 0000] lavfi.scene_score=0.6
[Parsed_metadata_3 @ 0000] frame:2 pts:3 pts_time:1.5
[Parsed_metadata_3 @ 0000] lavfi.scene_score=0.1
`;

const words = (n: number, every = 1, from = 0): Word[] => Array.from({ length: n }, (_, i) => ({ word: `w${i}`, start: from + i * every, end: from + i * every + 0.4 }));
const flat = (n: number, db: number) => Array.from({ length: n }, () => db);

describe("FFmpeg signal parsing", () => {
  it("reads one loudness value per second, silence as the floor", () => {
    expect(parseMetadataLog(AUDIO_LOG, "lavfi.astats.Overall.RMS_level", -90)).toEqual([-90, -21.5, -12.25]);
  });
  it("keeps the largest scene score in each second", () => {
    expect(parseMetadataLog(VIDEO_LOG, "lavfi.scene_score", 0)).toEqual([0.04, 0.6]);
  });
  it("ignores lines before the first timestamp and garbage values", () => {
    expect(parseMetadataLog("lavfi.scene_score=0.9\nframe:0 pts_time:0\nlavfi.scene_score=nan", "lavfi.scene_score", 0)).toEqual([]);
  });
});

describe("what drives the source", () => {
  it("talk: words and pauses", () => {
    const loud = flat(120, -20).map((db, t) => (t % 10 === 9 ? -80 : db));
    expect(classifyMedia({ loudness: loud, motion: flat(120, 0) }, words(110))).toBe("speech");
  });
  it("song: always loud, long stretches without words", () => {
    expect(classifyMedia({ loudness: flat(120, -15), motion: flat(120, 0) }, words(40, 1, 30))).toBe("music");
  });
  it("no words: music when there's sound, visual when there isn't", () => {
    expect(classifyMedia({ loudness: flat(60, -15), motion: flat(60, 0) }, [])).toBe("music");
    expect(classifyMedia({ loudness: flat(60, -90), motion: flat(60, 0.2) }, [])).toBe("visual");
  });
});

describe("moments from sound and picture", () => {
  // Quiet intro, a drop at 40 s, quiet again at 70 s; a hard cut at 100 s.
  const loudness = Array.from({ length: 120 }, (_, t) => (t >= 40 && t < 70 ? -10 : -40));
  const motion = Array.from({ length: 120 }, (_, t) => (t === 100 ? 0.9 : 0.01));
  const s: MediaSignals = { loudness, motion };

  it("opens on the drop, ends inside the preset, ids are unique", () => {
    const m = findMoments("v", s, [], "quick", "music", 3);
    expect(m.length).toBeGreaterThan(0);
    expect(m.map((c) => Math.round(c.start))).toContain(40);
    for (const c of m) {
      expect(c.duration).toBeGreaterThanOrEqual(10);
      expect(c.duration).toBeLessThanOrEqual(20);
      expect(c.kind).toBe("moment");
      expect(c.openingText).toMatch(/^Music moment at \d+:\d\d$/);
    }
    expect(new Set(m.map((c) => c.id)).size).toBe(m.length);
  });
  it("opens where the sentence under the drop begins, and ends on a full stop", () => {
    // One sentence 38.2–43.4 s spans the drop at 40 s; another runs 52–55.4 s.
    const line = (from: number, n: number): Word[] => Array.from({ length: n }, (_, i) => ({ word: i === n - 1 ? `w${i}.` : `w${i}`, start: from + i * 0.4, end: from + i * 0.4 + 0.35 }));
    const said = [...line(38.2, 14), ...line(52, 9)];
    const m = findMoments("v", s, said, "quick", "music", 1)[0]!;
    expect(m.start).toBeCloseTo(38.2, 5);
    const last = said.filter((w) => w.end <= m.end + 0.01).at(-1)!;
    expect(last.word.endsWith(".") || said.every((w) => w.start >= m.end || w.end <= m.end)).toBe(true);
  });
  it("keeps openings at least one minimum length apart", () => {
    const starts = findMoments("v", s, [], "quick", "music", 8).map((c) => c.start).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) expect((starts[i] as number) - (starts[i - 1] as number)).toBeGreaterThanOrEqual(10);
  });
  it("never splits a word and uses lyrics as the opening", () => {
    const w: Word[] = [{ word: "Here", start: 39.8, end: 40.3 }, { word: "we", start: 40.4, end: 40.6 }, { word: "go", start: 40.7, end: 41 }];
    const [first] = findMoments("v", { loudness: loudness.slice(0, 60), motion: motion.slice(0, 60) }, w, "quick", "music", 1);
    expect(first?.start).toBe(39.8);
    expect(first?.openingText).toBe("Here we go");
  });
  it("finds nothing when the source is shorter than the preset", () => {
    expect(findMoments("v", { loudness: flat(5, -10), motion: flat(5, 0) }, [], "quick", "visual", 3)).toEqual([]);
  });
});

describe("mixing sentences and moments", () => {
  const c = (id: string, start: number, kind?: "moment"): ClipCandidate => ({ id, videoId: "v", start, end: start + 10, openingText: id, transcript: "", precedingContext: "", followingContext: "", duration: 10, kind });
  const sentences = Array.from({ length: 10 }, (_, i) => c(`s${i}`, i * 20));
  const moments = Array.from({ length: 10 }, (_, i) => c(`m${i}`, i * 20 + 5, "moment"));

  it("talks keep mostly sentences, songs split evenly, visuals are all moments", () => {
    const count = (k: "speech" | "music" | "visual") => mixCandidates(sentences, moments, k, 8).filter((x) => x.kind === "moment").length;
    expect(count("speech")).toBe(2);
    expect(count("music")).toBe(4);
    expect(count("visual")).toBe(8);
  });
  it("fills spare room from the other side and keeps time order", () => {
    const out = mixCandidates([], moments, "speech", 8);
    expect(out).toHaveLength(8);
    expect(out.map((x) => x.start)).toEqual([...out.map((x) => x.start)].sort((a, b) => a - b));
  });
});

describe("what Jev sees about sound and picture", () => {
  const loudness = Array.from({ length: 30 }, (_, t) => (t >= 10 ? -6 : -40));
  const motion = Array.from({ length: 30 }, (_, t) => (t === 10 ? 0.8 : 0));
  const c: ClipCandidate = { id: "x", videoId: "v", start: 10, end: 20, openingText: "Music moment at 0:10", transcript: "", precedingContext: "", followingContext: "", duration: 10, kind: "moment" };

  it("one digit per second and a plain opening summary", () => {
    const m = attachMedia(c, { loudness, motion }, "music").media;
    expect(m?.loudness).toBe("8888888888");
    expect(m?.motion).toBe("9000000000");
    expect(m?.cuts).toBe(1);
    expect(m?.opening).toMatch(/jumps 34 dB/);
    expect(m?.opening).toMatch(/1 scene cuts/);
  });
  it("goes into the Jev request with a note on the scale", () => {
    const st = jevState(attachMedia(c, { loudness, motion }, "music"));
    expect(st).toMatchObject({ source_kind: "music", picked_by: "sound and picture", loudness_per_second: "8888888888", scene_cuts: 1 });
    expect(String(st.signal_note)).toContain("0-9");
    expect(jevState({ ...c, media: undefined })).not.toHaveProperty("source_kind");
  });
});
