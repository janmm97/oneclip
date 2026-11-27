import { describe, expect, it } from "vitest";
import { boxesOf, chooseFrame, cropAt, frameOf, parseShowinfo, samplesDisagree, splitAt, splitAtShots, visibleWidth, type EditPlan } from "@oneclip/core";

const src = { width: 1920, height: 1080 };
const out = { width: 1080, height: 1920 };
const face = (cx: number, h = 0.25) => ({ x0: cx - h * 0.3, y0: 0.25, x1: cx + h * 0.3, y1: 0.25 + h });

describe("frame maths", () => {
  it("a 9:16 cover crop of 16:9 shows about a third of the width", () => {
    expect(visibleWidth(src, out)).toBeCloseTo(0.316, 3);
  });

  it("cropAt centres a subject and clamps at the edges", () => {
    expect(cropAt(0.5, src, out).x).toBe(0.5);
    expect(cropAt(0.02, src, out).x).toBe(0);
    expect(cropAt(0.99, src, out).x).toBe(1);
    // The subject lands in the middle of the output.
    const f = cropAt(0.3, src, out);
    const [b] = boxesOf({ x0: 0.3, y0: 0.4, x1: 0.3, y1: 0.4 }, src, out, f);
    expect(b!.x0).toBeCloseTo(0.5, 2);
  });

  it("splitAt puts each subject near the middle of its half", () => {
    const f = splitAt({ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.4 }, src, out);
    expect(f.mode).toBe("split");
    const a = boxesOf({ x0: 0.3, y0: 0.4, x1: 0.3, y1: 0.4 }, src, out, f).find((b) => b.y0 < 0.5);
    const b = boxesOf({ x0: 0.7, y0: 0.4, x1: 0.7, y1: 0.4 }, src, out, f).find((b) => b.y0 >= 0.5);
    expect(a!.x0).toBeCloseTo(0.5, 1);
    expect(b!.x0).toBeCloseTo(0.5, 1);
  });

  it("frameOf keeps old plans working: cropMode and blur layout", () => {
    const plan = { editing: { layout: "crop-center", cropMode: "left-third" } } as EditPlan;
    expect(frameOf({ start: 0, end: 1 }, plan)).toEqual({ mode: "crop", x: 0.2 });
    expect(frameOf({ start: 0, end: 1 }, { editing: { layout: "blur-background", cropMode: "center" } } as EditPlan)).toEqual({ mode: "fit" });
    expect(frameOf({ start: 0, end: 1, frame: { mode: "split" } }, plan)).toEqual({ mode: "split" });
  });
});

describe("chooseFrame", () => {
  it("fits a wide shot with no faces or only tiny ones", () => {
    expect(chooseFrame([[], [], []], src, out)).toEqual({ mode: "fit" });
    expect(chooseFrame([[face(0.3, 0.04)]], src, out)).toEqual({ mode: "fit" });
  });

  it("follows one speaker off-centre", () => {
    const f = chooseFrame([[face(0.7)], [face(0.7)], [face(0.72)]], src, out);
    expect(f.mode).toBe("crop");
    expect(f.x).toBeGreaterThan(0.6);
  });

  it("splits two people too far apart for one crop (host and guest)", () => {
    const f = chooseFrame([[face(0.25), face(0.75)], [face(0.25), face(0.75)]], src, out);
    expect(f.mode).toBe("split");
    expect(f.x).toBeLessThan(0.5);
    expect(f.x2).toBeGreaterThan(0.5);
  });

  it("keeps two people close together in one crop", () => {
    expect(chooseFrame([[face(0.45, 0.15), face(0.55, 0.15)]], src, out).mode).toBe("crop");
  });

  it("fits a spread-out group of three", () => {
    expect(chooseFrame([[face(0.15), face(0.5), face(0.85)]], src, out)).toEqual({ mode: "fit" });
  });

  it("ignores small background faces next to the speaker", () => {
    expect(chooseFrame([[face(0.3, 0.3), face(0.9, 0.06)]], src, out).mode).toBe("crop");
  });

  // Client clip 2026-11: a piece held a wide two-shot and a close-up (missed cut); the split showed one person twice.
  it("never splits a piece whose samples disagree on the number of people", () => {
    const f = chooseFrame([[face(0.25), face(0.75)], [face(0.5, 0.4)], [face(0.5, 0.4)]], src, out);
    expect(f.mode).not.toBe("split");
    expect(samplesDisagree([[face(0.25), face(0.75)], [face(0.5, 0.4)]])).toBe(true);
  });

  it("does not split when a sample sees nobody", () => {
    expect(chooseFrame([[face(0.25), face(0.75)], []], src, out).mode).not.toBe("split");
  });

  it("splits on the average position across samples", () => {
    const f = chooseFrame([[face(0.2), face(0.8)], [face(0.3), face(0.7)]], src, out);
    expect(f).toEqual(splitAt({ x: 0.25, y: 0.375 }, { x: 0.75, y: 0.375 }, src, out));
    expect(samplesDisagree([[face(0.2), face(0.8)], [face(0.3), face(0.7)]])).toBe(false);
  });
});

describe("shot changes", () => {
  it("parses showinfo times and adds the window offset", () => {
    const log = "[Parsed_showinfo_2 @ 0x1] n:   0 pts:  12345 pts_time:2.5   duration...\n[Parsed_showinfo_2 @ 0x1] n:   1 pts: 1 pts_time:7.04 x";
    expect(parseShowinfo(log, 10)).toEqual([12.5, 17.04]);
  });

  it("splits a cut at a shot change, keeping output length and mix fields", () => {
    const cuts = splitAtShots([{ start: 10, end: 20, audioFrom: 50, volume: 0.5 }], [14]);
    expect(cuts).toEqual([
      { start: 10, end: 14, audioFrom: 50, volume: 0.5 },
      { start: 14, end: 20, audioFrom: 54, volume: 0.5 },
    ]);
  });

  it("ignores changes outside the cut or too close to its ends", () => {
    expect(splitAtShots([{ start: 10, end: 20 }], [5, 10.2, 19.9, 25])).toEqual([{ start: 10, end: 20 }]);
  });
});
