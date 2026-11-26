import { describe, expect, it } from "vitest";
import { type EditPlan, fitToFrame, openDb, outputFor, planForRatio, ProjectSettingsSchema, queueRenders, RATIOS, ratioSlug, schema } from "@oneclip/core";

const plan = (width: number, height: number): EditPlan =>
  ({
    version: 1,
    clipId: "c",
    planner: "template",
    sourceStart: 0,
    sourceEnd: 10,
    output: { width, height, fps: 30 },
    editing: { removeSilences: false, layout: "crop-center", cropMode: "center", captionPreset: "bold-pop", transitionPreset: "fade", zoomIntensity: 0 },
    cuts: [{ start: 0, end: 10 }],
    captions: [],
    zoomEvents: [],
    audio: { normalize: true, targetLufs: -14 },
    outputDuration: 10,
  }) as unknown as EditPlan;

describe("frame ratios", () => {
  it("sizes every ratio with a 1080 (final) or 540 (preview) short side and even dimensions", () => {
    expect(outputFor("final", "9:16")).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(outputFor("final", "16:9")).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(outputFor("final", "1:1")).toEqual({ width: 1080, height: 1080, fps: 30 });
    expect(outputFor("final", "4:5")).toEqual({ width: 1080, height: 1350, fps: 30 });
    expect(outputFor("final", "4:3")).toEqual({ width: 1440, height: 1080, fps: 30 });
    expect(outputFor("preview", "9:16")).toEqual({ width: 540, height: 960, fps: 30 });
    for (const r of RATIOS) for (const q of ["final", "preview"] as const) {
      const o = outputFor(q, r);
      expect(o.width % 2 + (o.height % 2)).toBe(0);
    }
    expect(ratioSlug("16:9")).toBe("16x9");
  });

  it("defaults to 9:16 and drops repeats", () => {
    expect(ProjectSettingsSchema.parse({}).ratios).toEqual(["9:16"]);
    expect(ProjectSettingsSchema.parse({ ratios: ["16:9", "16:9", "1:1"] }).ratios).toEqual(["16:9", "1:1"]);
    expect(() => ProjectSettingsSchema.parse({ ratios: ["21:9"] })).toThrow();
    expect(() => ProjectSettingsSchema.parse({ ratios: [] })).toThrow();
  });

  it("puts a phone video on a blurred background in a wide frame, crops when shapes are close", () => {
    const phone = { width: 1080, height: 1920 };
    expect(fitToFrame(plan(1920, 1080), phone).editing.layout).toBe("blur-background");
    expect(fitToFrame(plan(1080, 1920), phone).editing.layout).toBe("crop-center");
    expect(fitToFrame(plan(1080, 1920), { width: 1920, height: 1080 }).editing.layout).toBe("crop-center");
    expect(fitToFrame(plan(1920, 1080), null).editing.layout).toBe("crop-center");
  });

  it("previews and renders a 9:16 analysis plan in the chosen ratio", () => {
    const wide = planForRatio(plan(1080, 1920), "16:9", { width: 1080, height: 1920 });
    expect(wide.output).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(wide.editing.layout).toBe("blur-background");
    expect(planForRatio(plan(1080, 1920), "1:1", { width: 1920, height: 1080 }, "preview").output).toEqual({ width: 540, height: 540, fps: 30 });
    expect(planForRatio(plan(1080, 1920), "9:16", null).output).toEqual({ width: 1080, height: 1920, fps: 30 });
  });

  it("queues one render per clip and ratio, previews in the first ratio only", async () => {
    const db = openDb(":memory:");
    await db.insert(schema.projects).values({ id: "p", title: "t", sourcePath: "/x.mp4", settings: { ratios: ["9:16", "16:9"] } });
    for (const [id, rank] of [["a", 1], ["b", 2]] as const) await db.insert(schema.clips).values({ id, projectId: "p", rank, candidate: {}, evaluation: {} });
    const ratiosOf = async () => (await db.select().from(schema.jobs).all()).map((j) => `${j.clipId}:${j.quality}:${j.ratio}`).sort();

    expect(await queueRenders(db, "p", "final")).toHaveLength(4);
    expect(await ratiosOf()).toEqual(["a:final:16:9", "a:final:9:16", "b:final:16:9", "b:final:9:16"]);

    await db.delete(schema.jobs);
    await queueRenders(db, "p", "preview", "a");
    expect(await ratiosOf()).toEqual(["a:preview:9:16"]);

    await db.delete(schema.jobs);
    await queueRenders(db, "p", "final", "b", ["1:1"]);
    expect(await ratiosOf()).toEqual(["b:final:1:1"]);
  });
});
