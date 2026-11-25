import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assEscape,
  assTime,
  buildAss,
  buildFilterGraph,
  graphArgs,
  inputWindows,
  clipFolder,
  config,
  type EditPlan,
  extractYouTubeId,
  fetchYouTubeMeta,
  findRoot,
  mean,
  precisionAtK,
  rankingAgreement,
  rate,
  redact,
  safeName,
} from "@oneclip/core";
import { assToCss, zoomAt } from "@oneclip/remotion/compositions";

const plan = (over: Partial<EditPlan> = {}): EditPlan => ({
  version: 1,
  clipId: "c",
  planner: "template",
  sourceStart: 10,
  sourceEnd: 30,
  output: { width: 1080, height: 1920, fps: 30 },
  editing: { removeSilences: true, layout: "crop-center", cropMode: "center", captionPreset: "bold-pop", transitionPreset: "fade", zoomIntensity: 0.1 },
  template: "podcast-short",
  title: "t",
  cuts: [
    { start: 10, end: 15 },
    { start: 20, end: 30 },
  ],
  captions: [
    {
      start: 0,
      end: 1,
      words: [
        { text: "hi", start: 0, end: 0.4, emphasis: false },
        { text: "{\\pos(0,0)}evil", start: 0.5, end: 1, emphasis: true },
      ],
    },
  ],
  zoomEvents: [{ at: 2, duration: 1.2, scale: 1.1 }],
  audio: { normalize: true, targetLufs: -14 },
  outputDuration: 15,
  reasoning: "",
  ...over,
});

describe("ASS captions", () => {
  it("formats times as h:mm:ss.cc", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(3723.456)).toBe("1:02:03.46");
    expect(assTime(-1)).toBe("0:00:00.00");
  });

  it("strips override tags and line breaks from transcript text", () => {
    expect(assEscape("a{\\b1}b\\Nc\r\nd")).toBe("ab1bNc d");
  });

  it("writes one event per word with the current word highlighted", () => {
    const ass = buildAss(plan());
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(2);
    expect(events[0]).toContain("0:00:00.00,0:00:00.50");
    expect(events[1]).toContain("EVIL");
    expect(ass).not.toContain("\\pos");
    expect(ass).toContain("PlayResX: 1080");
  });
});

describe("FFmpeg filter graph", () => {
  it("keeps short graphs inline and sends long ones through graph.txt", () => {
    const dir = mkdtempSync(join(tmpdir(), "oneclip-graph-"));
    expect(graphArgs("[0:v]null[vout]", dir)).toEqual(["-filter_complex", "[0:v]null[vout]"]);
    expect(existsSync(join(dir, "graph.txt"))).toBe(false);
    const long = "x".repeat(8001);
    expect(graphArgs(long, dir)).toEqual(["-/filter_complex", "graph.txt"]);
    expect(readFileSync(join(dir, "graph.txt"), "utf8")).toBe(long);
  });

  it("trims each cut relative to the seek point, concatenates and finishes the chain", () => {
    expect(inputWindows(plan())).toEqual([{ start: 9, end: 31 }]);
    const g = buildFilterGraph(plan(), inputWindows(plan()), "captions.ass");
    expect(g).toContain("trim=start=1.000:end=6.000");
    expect(g).toContain("trim=start=11.000:end=21.000");
    expect(g).toContain("concat=n=2:v=1:a=1[vc][ac]");
    expect(g).toContain("crop=1080:1920");
    expect(g).toContain("between(t,2.000,3.200)");
    expect(g).toContain("subtitles=captions.ass");
    expect(g).toContain("loudnorm=I=-14");
    expect(g).toMatch(/\[vout\].*\[aout\]$/s);
  });

  it("uses the blur layout when asked", () => {
    expect(buildFilterGraph(plan({ editing: { ...plan().editing, layout: "blur-background" } }), [{ start: 9, end: 31 }])).toContain("boxblur");
  });

  it("opens far-apart moments as separate inputs and mixes borrowed sound, speed, mute and a ducked bed", () => {
    const p = plan({
      sourceStart: 10,
      sourceEnd: 205,
      cuts: [
        { start: 10, end: 14, audioFrom: 200, cropMode: "left-third" },
        { start: 20, end: 22, speed: 0.5, volume: 1.5 },
        { start: 12, end: 13, muted: true },
      ],
      bed: { start: 100, end: 108, volume: 0.4, duck: 0.25, duckUnder: [{ start: 4, end: 6 }] },
      outputDuration: 9,
    });
    const w = inputWindows(p);
    expect(w).toEqual([
      { start: 9, end: 23 },
      { start: 99, end: 109 },
      { start: 199, end: 205 },
    ]);
    const g = buildFilterGraph(p, w);
    expect(g).toContain("[0:v]split=3[vs0][vs1][vs2]");
    expect(g).toContain("[0:a]asplit=1[as1]");
    expect(g).toContain("[1:a]asplit=1[bs]");
    expect(g).toContain("[2:a]asplit=1[as0]");
    expect(g).toContain("[as0]atrim=start=1.000:end=5.000");
    expect(g).toContain("crop=1080:1920:(iw-ow)*0.2:(ih-oh)/2");
    expect(g).toContain("setpts=(PTS-STARTPTS)/0.500");
    expect(g).toContain("atempo=0.500,volume=1.500");
    expect(g).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=1.000[a2]");
    expect(g).toContain("volume='if(gt(between(t,4.000,6.000),0),0.100,0.400)':eval=frame[bed]");
    expect(g).toContain("[ac][bed]amix=inputs=2:duration=first:normalize=0[am]");
    expect(g).toMatch(/\[am\]loudnorm/);
  });
});

describe("Remotion helpers", () => {
  it("converts ASS &HAABBGGRR to CSS rgba", () => {
    expect(assToCss("&H00FFFFFF")).toBe("rgba(255,255,255,1.00)");
    expect(assToCss("&H0000E5FF")).toBe("rgba(255,229,0,1.00)");
    expect(assToCss("&H80FFFFFF")).toBe("rgba(255,255,255,0.50)");
  });

  it("zooms only inside a zoom event", () => {
    const p = plan({ editing: { ...plan().editing, transitionPreset: "none" } });
    expect(zoomAt(1, p)).toBe(1);
    expect(zoomAt(2.6, p)).toBeCloseTo(1.1);
    expect(zoomAt(5, p)).toBe(1);
  });
});

describe("YouTube metadata (oEmbed only, no download)", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=10", "dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://evil.example/watch?v=dQw4w9WgXcQ", undefined],
    ["javascript:alert(1)", undefined],
    ["https://www.youtube.com/watch?v=short", undefined],
  ])("%s", (url, id) => {
    expect(extractYouTubeId(url)).toBe(id);
  });

  it("reads oEmbed through the injected fetch (MOCK)", async () => {
    let asked = "";
    const fake = (async (u: string) => {
      asked = u;
      return new Response(JSON.stringify({ title: "A talk", author_name: "Someone", thumbnail_url: "https://i.ytimg.com/x.jpg" }));
    }) as unknown as typeof fetch;
    const m = await fetchYouTubeMeta("https://youtu.be/dQw4w9WgXcQ", fake);
    expect(asked).toContain("/oembed?");
    expect(m).toMatchObject({ videoId: "dQw4w9WgXcQ", title: "A talk", author: "Someone" });
  });

  it("explains private and missing videos (MOCK)", async () => {
    const status = (s: number) => (async () => new Response("", { status: s })) as unknown as typeof fetch;
    await expect(fetchYouTubeMeta("https://youtu.be/dQw4w9WgXcQ", status(401))).rejects.toThrow(/private/);
    await expect(fetchYouTubeMeta("https://youtu.be/dQw4w9WgXcQ", status(404))).rejects.toThrow(/couldn't find/);
    await expect(fetchYouTubeMeta("not a link")).rejects.toThrow(/YouTube video link/);
  });
});

describe("clips folder", () => {
  it("defaults to ./clips in the OneClip folder and honours ONECLIP_CLIPS_DIR", () => {
    const def = config({});
    expect(basename(def.clipsDir)).toBe("clips");
    expect(dirname(def.clipsDir)).toBe(dirname(def.dataDir));
    expect(config({ ONECLIP_CLIPS_DIR: "my-clips" }).clipsDir).toBe(resolve(findRoot(), "my-clips"));
    expect(config({ ONECLIP_CLIPS_DIR: resolve("abs-clips") }).clipsDir).toBe(resolve("abs-clips"));
  });
  it("makes safe file names from titles", () => {
    expect(safeName("Why We Review Config: Like Code!")).toBe("why-we-review-config-like-code");
    expect(safeName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeName("Café déjà vu")).toBe("café-déjà-vu");
    expect(safeName("???")).toBe("");
    expect(safeName("a".repeat(80)).length).toBe(50);
  });
  it("gives each video its own folder", () => {
    const cfg = config({ ONECLIP_CLIPS_DIR: "c" });
    const id = "1234abcd-0000-4000-8000-000000000000";
    expect(clipFolder(cfg, { id, title: "My Talk" })).toBe(join(resolve("c"), "my-talk-1234abcd"));
    expect(clipFolder(cfg, { id, title: "" })).toBe(join(resolve("c"), "1234abcd"));
  });
});

describe("redact", () => {
  it("masks One keys, bearer tokens, API keys and JSON secrets", () => {
    const out = redact(
      'key live::typesafe::default::0123456789abcdef Authorization: Bearer abcdefghijkl ghp_ABCDEFGHIJKLMNOP {"token":"s3cr3t"}',
    );
    expect(out).not.toMatch(/0123456789abcdef|abcdefghijkl|ABCDEFGHIJKLMNOP|s3cr3t/);
    expect(out).toContain("live::***");
  });
});

describe("eval metrics", () => {
  const items = [
    { score: 0.9, label: "good" as const },
    { score: 0.8, label: "bad" as const },
    { score: 0.5, label: "average" as const },
    { score: 0.1, label: "bad" as const },
  ];
  it("precision at K", () => {
    expect(precisionAtK(items, 2)).toBe(0.5);
    expect(precisionAtK([], 2)).toBe(0);
  });
  it("pairwise ranking agreement, ties count half", () => {
    // Pairs with different labels: g>b(.8) ok, g>a ok, g>b(.1) ok, b(.8)<a wrong, a>b(.1) ok → 4/5.
    expect(rankingAgreement(items)).toBeCloseTo(4 / 5);
    expect(rankingAgreement([{ score: 1, label: "good" }, { score: 1, label: "bad" }])).toBe(0.5);
  });
  it("rate and mean are 0 on empty input", () => {
    expect(rate([], () => true)).toBe(0);
    expect(mean([])).toBe(0);
    expect(rate([1, 2, 3, 4], (x) => x > 2)).toBe(0.5);
  });
});
