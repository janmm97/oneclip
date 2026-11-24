import { describe, expect, it } from "vitest";
import {
  buildProfile,
  contentAdjust,
  detectContentType,
  findChoruses,
  findMoments,
  findSongSpan,
  jevState,
  parseLevels,
  withContent,
  type ClipCandidate,
  type MediaSignals,
  type SourceMeta,
  type Word,
} from "@oneclip/core";

const meta = (m: Partial<SourceMeta>): SourceMeta => ({ title: "", uploader: "", site: "", categories: [], tags: [], description: "", wasLive: false, ...m });

/** 60 s of talking (quiet, jumpy) then 200 s of a dense song: the King for a Day shape. */
function skitThenSong(): MediaSignals {
  const loudness: number[] = [];
  const variation: number[] = [];
  const motion: number[] = [];
  for (let t = 0; t < 260; t++) {
    const song = t >= 60;
    loudness.push(song ? -10 + (t % 3) * 0.5 : -22 + (t % 5) * 2);
    variation.push(song ? 1 + (t % 2) * 0.5 : 4 + (t % 3));
    motion.push(t % 4 === 0 ? 0.4 : 0.05);
  }
  return { loudness, motion, variation };
}

const say = (text: string, start: number, step = 0.4): Word[] => text.split(" ").map((w, i) => ({ word: w, start: start + i * step, end: start + i * step + step * 0.9 }));
const CHORUS = "now I don't wanna feel a thing anymore I'm tired of begging for the things I want";
const words = (): Word[] => [
  ...say("I want to thank you all for the pay cut and the audit this year", 5),
  ...say("walking down the street at night with nowhere left to go", 70),
  ...say(CHORUS, 95),
  ...say("the city lights are fading out behind me slowly", 130),
  ...say(CHORUS, 160),
  ...say("oh oh oh oh oh oh", 200),
  ...say(CHORUS, 230),
];

const cand = (start: number, end: number, transcript = "words"): ClipCandidate => ({
  id: `c${start}`,
  videoId: "v",
  start,
  end,
  openingText: transcript,
  transcript,
  precedingContext: "",
  followingContext: "",
  duration: end - start,
});

describe("parseLevels", () => {
  it("turns 100 ms RMS levels into a per-second power mean and spread", () => {
    const log = ["pts_time:0", "lavfi.astats.Overall.RMS_level=-10", "pts_time:0.5", "lavfi.astats.Overall.RMS_level=-10", "pts_time:1.0", "lavfi.astats.Overall.RMS_level=-inf", "pts_time:1.5\r", "lavfi.astats.Overall.RMS_level=-20\r"].join("\n");
    const { loudness, variation } = parseLevels(log);
    expect(loudness[0]).toBeCloseTo(-10);
    expect(variation[0]).toBe(0);
    expect(loudness[1]).toBeCloseTo(-23, 0);
    expect(variation[1]).toBeCloseTo(20); // -60 (clamped silence) vs -20
  });
});

describe("findSongSpan", () => {
  it("finds where the dense, loud song starts after a spoken skit", () => {
    const span = findSongSpan(skitThenSong());
    expect(span?.start).toBeGreaterThanOrEqual(58);
    expect(span?.start).toBeLessThanOrEqual(64);
    expect(span?.end).toBe(260);
  });
  it("finds nothing in plain talking", () => {
    const s = skitThenSong();
    expect(findSongSpan({ ...s, variation: s.variation?.map(() => 5) })).toBeUndefined();
    expect(findSongSpan({ loudness: s.loudness, motion: s.motion })).toBeUndefined();
  });
});

describe("findChoruses", () => {
  it("marks lyrics that come back, not one-word chants or nearby loops", () => {
    const c = findChoruses(words());
    expect(c.map((x) => Math.round(x.start))).toEqual([95, 160, 230]);
    const loop = findChoruses([...say("a little bit of a fan of the music but", 80), ...say("a little bit of a fan of the music but", 84.5)]);
    expect(loop).toEqual([]);
  });
});

describe("detectContentType", () => {
  const s = skitThenSong();
  it("reads an official music video from the page and the sound", () => {
    const d = detectContentType(meta({ title: "Pierce The Veil - King for a Day ft. Kellin Quinn", categories: ["Music"] }), s, words(), "speech");
    expect(d.type).toBe("music_video");
    expect(d.reasons.join(" ")).toMatch(/Music category/);
  });
  it.each([
    [meta({ title: "The Diary Of A CEO Podcast Episode #212", categories: ["People & Blogs"] }), "podcast"],
    [meta({ title: "Elden Ring boss fight no hit", categories: ["Gaming"] }), "gameplay"],
    [meta({ title: "Friday night chill", site: "TwitchVod", wasLive: true }), "stream"],
    [meta({ title: "How to grow your audience | TEDx", categories: ["Education"] }), "talk"],
    [meta({ title: "Lakers vs Celtics full game highlights", categories: ["Sports"] }), "sports"],
    [meta({ title: "Song name (Official Audio)", categories: ["Music"] }), "song"],
  ])("%o → %s", (m, type) => {
    const talk: MediaSignals = { loudness: Array(600).fill(-20), motion: Array(600).fill(0.02), variation: Array(600).fill(5) };
    expect(detectContentType(m, talk, words(), "speech").type).toBe(type);
  });
  it("falls back on what the file sounds like when the page says nothing", () => {
    const still: MediaSignals = { loudness: Array(300).fill(-12), motion: Array(300).fill(0), variation: Array(300).fill(1) };
    expect(detectContentType(meta({ title: "track01" }), still, [], "music").type).toBe("song");
  });
});

describe("content profile in ranking", () => {
  const p = buildProfile(meta({ title: "Band - Song (Official Music Video)", categories: ["Music"] }), skitThenSong(), words(), "music");

  it("drops a skit before the song below a chorus Jev scored lower", () => {
    const skit = contentAdjust(p, cand(0, 40), 0.82);
    const chorus = contentAdjust(p, cand(90, 125), 0.7);
    expect(skit.final).toBeLessThan(chorus.final);
    expect(skit.penalties[0]).toMatch(/outside the song/);
    expect(chorus.penalties[0]).toMatch(/chorus/);
  });

  it("drops a clip that opens with a sponsor read", () => {
    const a = contentAdjust(buildProfile(meta({ title: "My Podcast Episode 4" }), { loudness: [], motion: [] }, [], "speech"), cand(0, 30, "today's sponsor is a VPN and you can use code CLIP"), 0.8);
    expect(a.final).toBeCloseTo(0.6);
  });

  it("tells Jev what kind of source it is and where the clip sits", () => {
    const state = jevState(withContent(cand(0, 40), p));
    expect(state.content_type).toBe("Music video");
    expect(String(state.what_makes_the_best_clip)).toMatch(/chorus/);
    expect(String(state.clip_section)).toMatch(/before the song/i);
  });

  it("only opens music moments inside the song", () => {
    const m = findMoments("v", skitThenSong(), words(), "standard", "music", 6, 260, p);
    expect(m.length).toBeGreaterThan(0);
    for (const c of m) expect(c.start).toBeGreaterThanOrEqual((p.main?.start ?? 0) - 2);
  });
});
