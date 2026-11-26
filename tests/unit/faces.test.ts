import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTION_STYLES, decodeYunet, faceSafeCaptions, pickCaptionY, placeCaptions, toOutput, type EditPlan } from "@oneclip/core";

const plan = (over: Partial<EditPlan> = {}): EditPlan => ({
  version: 1,
  clipId: "c",
  planner: "template",
  sourceStart: 0,
  sourceEnd: 10,
  output: { width: 1080, height: 1920, fps: 30 },
  editing: { removeSilences: false, layout: "crop-center", cropMode: "center", captionPreset: "bold-pop", transitionPreset: "none", zoomIntensity: 0 },
  template: "podcast-short",
  title: "",
  cuts: [
    { start: 0, end: 5 },
    { start: 5, end: 10 },
  ],
  captions: [
    { start: 0, end: 1, words: [{ text: "a", start: 0, end: 1, emphasis: false }] },
    { start: 6, end: 7, words: [{ text: "b", start: 6, end: 7, emphasis: false }] },
  ],
  zoomEvents: [],
  audio: { normalize: true, targetLufs: -14 },
  outputDuration: 10,
  reasoning: "",
  ...over,
});

describe("pickCaptionY", () => {
  it("keeps the preferred spot when no face is in the way", () => {
    expect(pickCaptionY([], 0.72, 0.08)).toBe(0.72);
    expect(pickCaptionY([{ x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.4 }], 0.72, 0.08)).toBe(0.72);
  });

  it("moves the page clear of a face that sits on the lower third", () => {
    // Face 0.6–0.85: the block (±0.08 + 0.02 margin) must end above 0.6.
    expect(pickCaptionY([{ x0: 0.3, y0: 0.6, x1: 0.7, y1: 0.85 }], 0.72, 0.08)).toBe(0.5);
  });

  it("ignores faces cut off at the side of the frame", () => {
    expect(pickCaptionY([{ x0: -0.2, y0: 0.6, x1: 0.05, y1: 0.85 }], 0.72, 0.08)).toBe(0.72);
  });

  it("falls back to the lowest safe line when faces fill the frame", () => {
    expect(pickCaptionY([{ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.95 }], 0.72, 0.08)).toBe(0.8);
  });
});

describe("toOutput", () => {
  const face = { x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.5 };
  const src = { width: 1920, height: 1080 };

  it("maps a 16:9 face into a centre-cropped 9:16 frame", () => {
    const f = toOutput(face, src, plan(), "center");
    expect(f.x0).toBeCloseTo(0.184, 3);
    expect(f.x1).toBeCloseTo(0.816, 3);
    expect(f.y0).toBeCloseTo(0.2, 5);
    expect(f.y1).toBeCloseTo(0.5, 5);
  });

  it("maps a face into the middle band of a blur-background frame", () => {
    const f = toOutput(face, src, plan({ editing: { ...plan().editing, layout: "blur-background" } }), "center");
    expect(f.x0).toBeCloseTo(0.4, 5);
    expect(f.y0).toBeCloseTo(0.405, 3);
    expect(f.y1).toBeCloseTo(0.5, 3);
  });
});

describe("decodeYunet", () => {
  const empty = (n: number, k = 1) => ({ data: new Float32Array(n * k) });
  const out = () => {
    const o: Record<string, { data: Float32Array }> = {};
    for (const s of [8, 16, 32]) {
      const n = (640 / s) ** 2;
      o[`cls_${s}`] = empty(n);
      o[`obj_${s}`] = empty(n);
      o[`bbox_${s}`] = empty(n, 4);
    }
    return o;
  };

  it("decodes a box from stride 32 and drops an overlapping weaker one", () => {
    const o = out();
    const set = (i: number, score: number, bb: number[]) => {
      o.cls_32!.data[i] = score;
      o.obj_32!.data[i] = score;
      o.bbox_32!.data.set(bb, i * 4);
    };
    set(5 * 20 + 3, 0.9, [0, 0, Math.log(2), Math.log(3)]); // centre (96,160), 64×96
    set(5 * 20 + 4, 0.8, [0, 0, Math.log(2), Math.log(3)]); // same size, 32 px to the right
    const boxes = decodeYunet(o);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x0).toBeCloseTo(64, 3);
    expect(boxes[0]!.y0).toBeCloseTo(112, 3);
    expect(boxes[0]!.x1).toBeCloseTo(128, 3);
    expect(boxes[0]!.y1).toBeCloseTo(208, 3);
    expect(boxes[0]!.score).toBeCloseTo(0.9, 5);
  });

  it("finds nothing below the threshold", () => {
    const o = out();
    o.cls_8!.data[0] = 0.5;
    o.obj_8!.data[0] = 0.5;
    expect(decodeYunet(o)).toEqual([]);
  });
});

describe("placeCaptions", () => {
  const low = { x0: 0.3, y0: 0.6, x1: 0.7, y1: 0.85 };

  it("moves only the pages that play over a shot with a face in the way", () => {
    const p = placeCaptions(plan(), [[low], []]);
    expect(p.captions[0]!.y).toBeLessThan(0.6);
    expect(p.captions[1]!.y).toBeUndefined();
  });

  it("follows cut speed when matching pages to shots", () => {
    // Cut 0 at 2× lasts 2.5 s, so the page at 3–4 s plays over cut 1.
    const p = placeCaptions(plan({ cuts: [{ start: 0, end: 5, speed: 2 }, { start: 5, end: 10 }], captions: [{ start: 3, end: 4, words: [] }] }), [[], [low]]);
    expect(p.captions[0]!.y).toBeLessThan(0.6);
  });

  it("keeps a face-free page at the preset default (no y)", () => {
    const p = placeCaptions(plan(), [[{ x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.35 }], []]);
    expect(p.captions[0]!.y).toBe(CAPTION_STYLES["bold-pop"].y);
  });
});

describe("faceSafeCaptions", () => {
  const workDir = mkdtempSync(join(tmpdir(), "oneclip-faces-"));
  const o = { ffmpeg: "ffmpeg", sourcePath: join(workDir, "missing.mp4"), workDir, modelsDir: join(workDir, "models") };

  it("leaves the plan alone without a source size", async () => {
    const p = plan();
    expect(await faceSafeCaptions(p, { ...o, source: null })).toBe(p);
  });

  it("leaves the plan alone when frames can't be read (no download, no throw)", async () => {
    const p = await faceSafeCaptions(plan(), { ...o, ffmpeg: join(workDir, "no-ffmpeg"), source: { width: 1920, height: 1080 } });
    expect(p.captions.map((c) => c.y)).toEqual([undefined, undefined]);
  });
});
