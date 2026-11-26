import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildScenes, CLAUDE_VISION_ARGS, type ClipCandidate, findShots, jevState, parseReply, pickDescriber, ProjectSettingsSchema, resultMessage, type Scene, type SceneDescriber, visionMessage, withScenes } from "@oneclip/core";

describe("findShots", () => {
  it("cuts at scene changes and merges blips into the shot before", () => {
    const motion = Array(30).fill(0.02);
    motion[10] = 0.8; // a cut
    motion[11] = 0.9; // a flash right after: too short to be a shot
    motion[20] = 0.5;
    const shots = findShots(motion, 30);
    expect(shots.map((s) => [s.start, s.end])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
    expect(shots[0]?.at).toBe(5);
  });

  it("splits long moving shots, keeps a still picture whole", () => {
    expect(findShots(Array(60).fill(0.05), 60)).toHaveLength(3);
    expect(findShots(Array(600).fill(0), 600)).toHaveLength(1);
  });

  it("caps the number of shots", () => {
    const motion = Array.from({ length: 1000 }, (_, t) => (t % 2 === 0 ? 0.9 : 0));
    const shots = findShots(motion, 1000, { minShot: 1.5, maxShot: 20, maxShots: 50 });
    expect(shots.length).toBeLessThanOrEqual(50);
    expect(shots[0]?.start).toBe(0);
    expect(shots.at(-1)?.end).toBe(1000);
  });

  it("returns nothing for an empty source", () => {
    expect(findShots([], 0)).toEqual([]);
  });
});

describe("parseReply", () => {
  it("reads JSON wrapped in a code fence and keeps frame order by index", () => {
    const text = '```json\n{"frames":[{"i":2,"description":"Wide shot of a stadium.","tags":["Crowd"]},{"i":1,"description":"Close-up of a striker.","action":"shoots"}]}\n```';
    const r = parseReply(text, 2);
    expect(r[0]).toEqual({ description: "Close-up of a striker.", action: "shoots", tags: undefined });
    expect(r[1]?.tags).toEqual(["crowd"]);
  });

  it("accepts 0-based indexes and trims over-long fields", () => {
    const r = parseReply(`{"frames":[{"i":1,"description":"second"},{"i":0,"description":"${"a".repeat(500)}","tags":["a","b","c","d","e","f","g","h","i"]}]}`, 2);
    expect(r[1]?.description).toBe("second");
    expect(r[0]?.description).toHaveLength(400);
    expect(r[0]?.tags).toHaveLength(8);
  });

  it("fails on no JSON or a skipped frame", () => {
    expect(() => parseReply("I can't see images", 1)).toThrow(/no JSON/);
    expect(() => parseReply('{"frames":[{"i":1,"description":"x"}]}', 2)).toThrow(/skipped frame 2/);
  });
});

describe("withScenes and Jev", () => {
  const c = { id: "v-0-30", videoId: "v", start: 30, end: 60, openingText: "", transcript: "", precedingContext: "", followingContext: "", duration: 30 } as ClipCandidate;
  const scenes: Scene[] = [
    { start: 0, end: 30, at: 15, frame: "frames/0001.jpg", description: "Before the clip." },
    { start: 30, end: 45, at: 37, frame: "frames/0002.jpg", description: "A chef plates a dish.", action: "plating" },
    { start: 45, end: 70, at: 57, frame: "frames/0003.jpg", description: "Guests taste it." },
    { start: 70, end: 80, at: 75, frame: "frames/0004.jpg" },
  ];

  it("lists the shots inside the clip, timed from its start", () => {
    expect(withScenes(c, scenes).onScreen).toBe("0:00 A chef plates a dish. (plating)\n0:15 Guests taste it.");
    expect(withScenes(c, [])).toBe(c);
  });

  it("Jev sees on_screen only when there is something", () => {
    expect(jevState(c)).not.toHaveProperty("on_screen");
    expect(jevState(withScenes(c, scenes))).toHaveProperty("on_screen");
  });

  it("off, or no Claude Code installed, means nobody describes the shots", async () => {
    expect(await pickDescriber("off", { claudeBin: process.execPath })).toBeUndefined();
    expect(await pickDescriber("agent", { claudeBin: "no-such-claude-bin" })).toBeUndefined();
  });

  it("reads the old vision choices as agent, keeps off", () => {
    for (const v of [undefined, "auto", "local", "openrouter", "agent"]) expect(ProjectSettingsSchema.parse({ vision: v }).vision).toBe("agent");
    expect(ProjectSettingsSchema.parse({ vision: "off" }).vision).toBe("off");
  });
});

describe("Claude Code vision flags", () => {
  it("gives Claude no tools at all, so a frame's text can't read files even when the user's settings allow Read", () => {
    expect(CLAUDE_VISION_ARGS[CLAUDE_VISION_ARGS.indexOf("--tools") + 1]).toBe("");
    expect(CLAUDE_VISION_ARGS.some((a) => /^--(allowed-?tools|dangerously|permission-mode|add-dir)/i.test(a))).toBe(false);
    expect(CLAUDE_VISION_ARGS).toContain("--strict-mcp-config");
  });

  it("sends the frames inline as one stream-json user message", () => {
    const m = JSON.parse(visionMessage([{ data: "AAA", at: 3 }, { data: "BBB", at: 70 }], "ctx"));
    expect(m.type).toBe("user");
    const images = m.message.content.filter((c: { type: string }) => c.type === "image");
    expect(images.map((c: { source: { data: string } }) => c.source.data)).toEqual(["AAA", "BBB"]);
  });

  it("reads the last result message of the stream", () => {
    const out = ['{"type":"system","subtype":"init"}', "not json", '{"type":"result","is_error":false,"structured_output":{"frames":[]}}', ""].join("\r\n");
    expect(resultMessage(out)?.structured_output).toEqual({ frames: [] });
    expect(resultMessage('{"type":"assistant"}')).toBeUndefined();
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("buildScenes (real FFmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "oneclip-scenes-"));
  const src = join(dir, "src.mp4");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes frames, contact sheets and scenes.json; a describer fills them in", async () => {
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=12", "-c:v", "libx264", "-preset", "ultrafast", src], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const motion = Array(12).fill(0.02);
    motion[4] = 0.9;
    motion[8] = 0.9;

    const bare = await buildScenes({ ffmpeg: "ffmpeg", source: src, dir, motion, duration: 12, context: "test" });
    expect(bare.describedBy).toBeNull();
    expect(bare.scenes).toHaveLength(3);
    expect(bare.note).toMatch(/contact sheets/);
    expect(existsSync(join(dir, "frames", "0003.jpg"))).toBe(true);
    expect(bare.sheets).toEqual([{ file: "sheets/sheet-01.jpg", scenes: [1, 3] }]);
    expect(existsSync(join(dir, bare.sheets[0]?.file ?? "x"))).toBe(true);

    // MOCK describer: proves the wiring, not a model's quality.
    const seen: number[] = [];
    const mock: SceneDescriber = {
      name: "mock",
      batch: 2,
      describe: async (frames) => {
        seen.push(frames.length);
        return frames.map((f) => ({ description: `frame at ${f.at}`, action: "test pattern" }));
      },
    };
    const done = await buildScenes({ ffmpeg: "ffmpeg", source: src, dir, motion, duration: 12, context: "test", describer: mock });
    expect(seen.sort()).toEqual([1, 2]);
    expect(done.describedBy).toBe("mock");
    expect(done.scenes.map((s) => s.description)).toEqual(["frame at 2", "frame at 6", "frame at 10"]);
    expect(JSON.parse(readFileSync(join(dir, "scenes.json"), "utf8")).scenes).toHaveLength(3);

    const failing: SceneDescriber = { name: "broken", batch: 4, describe: async () => Promise.reject(new Error("model offline")) };
    const failed = await buildScenes({ ffmpeg: "ffmpeg", source: src, dir, motion, duration: 12, context: "test", describer: failing });
    expect(failed.describedBy).toBeNull();
    expect(failed.note).toMatch(/model offline/);
  }, 60_000);
});
