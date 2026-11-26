import { cropAt, splitAt, visibleWidth } from "../plan/frame.ts";
import type { EditPlan, Frame } from "../plan/schema.ts";
import { runProcess } from "../proc.ts";
import { type FaceBox, facesAt } from "./faces.ts";

type Cut = EditPlan["cuts"][number];
interface Size {
  width: number;
  height: number;
}

/** Shot-change times (source seconds) from FFmpeg `showinfo` output of a window that starts at `offset`. */
export function parseShowinfo(stderr: string, offset: number): number[] {
  return [...stderr.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Math.round((offset + Number(m[1])) * 1000) / 1000);
}

/** Hard cuts inside [start, end] of the source, found on a small copy of the picture. */
export async function shotChanges(ffmpeg: string, sourcePath: string, start: number, end: number, threshold = 0.3): Promise<number[]> {
  const r = await runProcess(
    ffmpeg,
    ["-hide_banner", "-nostats", "-ss", start.toFixed(3), "-t", (end - start).toFixed(3), "-i", sourcePath, "-an", "-vf", `scale=160:-2,select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"],
    { timeoutMs: 5 * 60_000 },
  );
  return r.code === 0 ? parseShowinfo(r.stderr, start) : [];
}

/** Cuts split where the shot changes, so each piece shows one shot and can be framed on its own. Pieces shorter than `minPiece` aren't split off. */
export function splitAtShots(cuts: Cut[], changes: number[], minPiece = 0.5, max = 200): Cut[] {
  const out: Cut[] = [];
  for (const c of cuts) {
    let from = c.start;
    for (const t of changes) {
      if (t - from < minPiece || c.end - t < minPiece || out.length >= max - 1) continue;
      out.push({ ...c, start: from, end: t, ...(c.audioFrom !== undefined ? { audioFrom: c.audioFrom + (from - c.start) } : {}) });
      from = t;
    }
    out.push({ ...c, start: from, ...(c.audioFrom !== undefined ? { audioFrom: c.audioFrom + (from - c.start) } : {}) });
  }
  return out;
}

/**
 * The framing for one shot from the faces seen in a few of its frames (source fractions):
 * - no faces, or only small ones (a wide shot): `fit`, so the whole scene and its details stay on screen;
 * - the people fit in one crop: `crop` centred on them;
 * - two people too far apart for one crop: `split`, one on top, one below (a reaction stays in view);
 * - a spread-out group: `fit`.
 */
export function chooseFrame(samples: FaceBox[][], src: Size, out: Size): Frame {
  const all = samples.flat();
  const tallest = Math.max(0, ...all.map((f) => f.y1 - f.y0));
  if (tallest < 0.07) return { mode: "fit" };
  const people = samples
    .map((s) => s.filter((f) => f.y1 - f.y0 >= tallest * 0.45).sort((a, b) => a.x0 - b.x0))
    .reduce((best, s) => (s.length > best.length ? s : best), [] as FaceBox[]);
  const x0 = Math.min(...people.map((f) => f.x0));
  const x1 = Math.max(...people.map((f) => f.x1));
  if (x1 - x0 <= visibleWidth(src, out) * 0.85) return cropAt((x0 + x1) / 2, src, out);
  if (people.length === 2) {
    const c = (f: FaceBox) => ({ x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2 });
    return splitAt(c(people[0] as FaceBox), c(people[1] as FaceBox), src, out);
  }
  return { mode: "fit" };
}

/** Merged source ranges the cuts read, so shot detection runs once per stretch, not once per cut. */
function stretches(cuts: Cut[], bridge = 5): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && c.start - last.end < bridge) last.end = Math.max(last.end, c.end);
    else out.push({ start: c.start, end: c.end });
  }
  return out;
}

/**
 * Smart reframe: splits the cuts at shot changes and frames each shot from the faces in it
 * (follow the subject, fit a wide shot, or split two people). Only for cropped layouts, only cuts
 * nobody framed yet (an agent's or user's `frame` wins), and only when the source is wider than
 * the frame. Any failure leaves the plan as it was. Returns the faces per cut for caption placement.
 */
export async function smartReframe(
  plan: EditPlan,
  o: { ffmpeg: string; sourcePath: string; source: Size | null; workDir: string; modelsDir: string; onStep?: (msg: string) => void },
): Promise<{ plan: EditPlan; faces?: FaceBox[][] }> {
  const src = o.source;
  if (!src?.width || !src.height || plan.editing.layout !== "crop-center") return { plan };
  if (src.width / src.height <= (plan.output.width / plan.output.height) * 1.15) return { plan };
  try {
    const changes: number[] = [];
    for (const s of stretches(plan.cuts)) changes.push(...(await shotChanges(o.ffmpeg, o.sourcePath, s.start, s.end)));
    const cuts = splitAtShots(plan.cuts, changes.sort((a, b) => a - b));
    const faces: FaceBox[][] = [];
    const framed: Cut[] = [];
    for (const [i, c] of cuts.entries()) {
      const len = c.end - c.start;
      const samples: FaceBox[][] = [];
      for (const f of [0.2, 0.5, 0.8]) samples.push(await facesAt(o.ffmpeg, o.sourcePath, c.start + len * f, src, o.workDir, o.modelsDir));
      faces.push(samples.flat());
      const frame = c.frame ?? chooseFrame(samples, src, plan.output);
      o.onStep?.(`Shot ${i + 1}: ${frame.mode === "split" ? "split screen" : frame.mode === "fit" ? "fit the whole shot" : "follow the subject"}`);
      framed.push({ ...c, frame });
    }
    return { plan: { ...plan, cuts: framed }, faces };
  } catch {
    return { plan };
  }
}
