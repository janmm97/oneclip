import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAPTION_STYLES } from "../render/ass.ts";
import type { EditPlan } from "../plan/schema.ts";
import { runProcess } from "../proc.ts";

/** A face as fractions of a frame: left, top, right, bottom in 0..1. */
export interface FaceBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** YuNet (OpenCV Zoo, MIT licence), 233 kB, fetched once into the data folder and checked by hash. */
export const YUNET = {
  url: "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
  sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
  file: "face_detection_yunet_2023mar.onnx",
};
const SIZE = 640;
const CROP_X = { center: 0.5, "left-third": 0.2, "right-third": 0.8 } as const;
/** Where a caption centre may go: below the title pill, above the platform buttons and description. */
const SAFE = { top: 0.2, bottom: 0.8 };

/** Face boxes from YuNet's 12 outputs (cls/obj/bbox per stride 8, 16, 32), in 640×640 input pixels, after NMS. */
export function decodeYunet(out: Record<string, { data: ArrayLike<number> }>, threshold = 0.6): (FaceBox & { score: number })[] {
  const found: (FaceBox & { score: number })[] = [];
  for (const s of [8, 16, 32]) {
    const cls = out[`cls_${s}`]?.data;
    const obj = out[`obj_${s}`]?.data;
    const bb = out[`bbox_${s}`]?.data;
    if (!cls || !obj || !bb) continue;
    const cols = SIZE / s;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(clamp01(cls[i] as number) * clamp01(obj[i] as number));
      if (score < threshold) continue;
      const cx = ((i % cols) + (bb[i * 4] as number)) * s;
      const cy = (Math.floor(i / cols) + (bb[i * 4 + 1] as number)) * s;
      const w = Math.exp(bb[i * 4 + 2] as number) * s;
      const h = Math.exp(bb[i * 4 + 3] as number) * s;
      found.push({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, score });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const kept: typeof found = [];
  for (const b of found) if (kept.every((k) => iou(k, b) < 0.3)) kept.push(b);
  return kept;
}

/** A face in the source frame (fractions) to where it lands in the output frame (fractions), for the plan's layout. */
export function toOutput(face: FaceBox, src: { width: number; height: number }, plan: EditPlan, cropMode: keyof typeof CROP_X): FaceBox {
  const { width: W, height: H } = plan.output;
  const blur = plan.editing.layout === "blur-background";
  const k = blur ? Math.min(W / src.width, H / src.height) : Math.max(W / src.width, H / src.height);
  const ox = blur ? (src.width * k - W) / 2 : (src.width * k - W) * CROP_X[cropMode];
  const oy = (src.height * k - H) / 2;
  const fx = (v: number) => (v * src.width * k - ox) / W;
  const fy = (v: number) => (v * src.height * k - oy) / H;
  return { x0: fx(face.x0), y0: fy(face.y0), x1: fx(face.x1), y1: fy(face.y1) };
}

/**
 * The caption centre (fraction of height) closest to `preferred` whose block
 * (± `half`) touches no face that is on screen. With no free spot, the lowest safe line.
 */
export function pickCaptionY(faces: FaceBox[], preferred: number, half: number, margin = 0.02): number {
  const lo = SAFE.top + half;
  const hi = SAFE.bottom;
  const blocked = faces
    .filter((f) => f.x1 > 0.08 && f.x0 < 0.92 && f.y1 > 0 && f.y0 < 1)
    .map((f) => [f.y0 - margin - half, f.y1 + margin + half] as const)
    .sort((a, b) => a[0] - b[0]);
  // Free stretches for the centre between lo and hi.
  const free: [number, number][] = [];
  let from = lo;
  for (const [a, b] of blocked) {
    if (a > from) free.push([from, Math.min(a, hi)]);
    from = Math.max(from, b);
  }
  if (from < hi) free.push([from, hi]);
  let best = hi;
  let dist = Infinity;
  for (const [a, b] of free) {
    if (b < a) continue;
    const y = Math.min(b, Math.max(a, preferred));
    if (Math.abs(y - preferred) < dist) [best, dist] = [y, Math.abs(y - preferred)];
  }
  return Math.round(best * 1000) / 1000;
}

/** Sets each caption page's `y` from the faces (output fractions) seen in the cuts it plays over. */
export function placeCaptions(plan: EditPlan, facesPerCut: FaceBox[][]): EditPlan {
  const st = CAPTION_STYLES[plan.editing.captionPreset];
  // About two lines of text, half of it, plus the 15% pop on emphasised words.
  const half = st.size * 0.85 * 1.15 * 1.15;
  const spans: { start: number; end: number; faces: FaceBox[] }[] = [];
  let t = 0;
  plan.cuts.forEach((c, i) => {
    const len = (c.end - c.start) / (c.speed ?? 1);
    spans.push({ start: t, end: t + len, faces: facesPerCut[i] ?? [] });
    t += len;
  });
  const captions = plan.captions.map((page) => {
    const faces = spans.filter((s) => s.start < page.end && s.end > page.start).flatMap((s) => s.faces);
    return faces.length ? { ...page, y: pickCaptionY(faces, st.y, half) } : page;
  });
  return { ...plan, captions };
}

let session: Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>> }> | undefined;

/** The YuNet session, downloading and hash-checking the model on first use. */
async function yunet(modelsDir: string) {
  const path = join(modelsDir, YUNET.file);
  if (!existsSync(path)) {
    const res = await fetch(YUNET.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Face model download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (createHash("sha256").update(buf).digest("hex") !== YUNET.sha256) throw new Error("Face model download failed: hash mismatch");
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(path, buf);
  }
  const ort = await import("onnxruntime-node");
  const s = await ort.InferenceSession.create(path);
  return {
    run: async (feeds: Record<string, unknown>) => (await s.run(feeds as never)) as unknown as Record<string, { data: ArrayLike<number> }>,
    tensor: (data: Float32Array) => new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]),
  };
}

/** Faces in one source frame (fractions of the source), from a 640×640 letterboxed BGR grab. */
async function facesAt(ffmpeg: string, sourcePath: string, at: number, src: { width: number; height: number }, workDir: string, modelsDir: string): Promise<FaceBox[]> {
  const raw = join(workDir, "face-frame.bgr");
  const r = await runProcess(ffmpeg, ["-y", "-v", "error", "-ss", at.toFixed(3), "-i", sourcePath, "-frames:v", "1", "-vf", `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease,pad=${SIZE}:${SIZE}:0:0`, "-pix_fmt", "bgr24", "-f", "rawvideo", raw], { timeoutMs: 30_000 });
  if (r.code !== 0 || !existsSync(raw)) return [];
  const px = readFileSync(raw);
  rmSync(raw, { force: true });
  if (px.length < SIZE * SIZE * 3) return [];
  const plane = SIZE * SIZE;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) for (let ch = 0; ch < 3; ch++) data[ch * plane + i] = px[i * 3 + ch] as number;
  session ??= yunet(modelsDir);
  const s = (await session) as Awaited<ReturnType<typeof yunet>>;
  const k = Math.min(SIZE / src.width, SIZE / src.height);
  return decodeYunet(await s.run({ input: s.tensor(data) })).map((b) => ({ x0: b.x0 / k / src.width, y0: b.y0 / k / src.height, x1: b.x1 / k / src.width, y1: b.y1 / k / src.height }));
}

/**
 * Face-safe captions: looks at three frames of every cut with a small local
 * face detector and moves each caption page off the faces. Any failure (no
 * model, no network on first run, a bad frame) leaves the plan as it was.
 */
export async function faceSafeCaptions(
  plan: EditPlan,
  o: { ffmpeg: string; sourcePath: string; source: { width: number; height: number } | null; workDir: string; modelsDir: string },
): Promise<EditPlan> {
  if (!plan.captions.length || !o.source?.width || !o.source.height) return plan;
  const src = o.source;
  try {
    const perCut: FaceBox[][] = [];
    for (const c of plan.cuts.slice(0, 40)) {
      const len = c.end - c.start;
      const faces: FaceBox[] = [];
      for (const f of [0.2, 0.5, 0.8]) faces.push(...(await facesAt(o.ffmpeg, o.sourcePath, c.start + len * f, src, o.workDir, o.modelsDir)));
      perCut.push(faces.map((b) => toOutput(b, src, plan, c.cropMode ?? plan.editing.cropMode)));
    }
    return placeCaptions(plan, perCut);
  } catch {
    session = undefined;
    return plan;
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
function iou(a: FaceBox, b: FaceBox) {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = w * h;
  return inter / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter || 1);
}
