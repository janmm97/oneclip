import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditPlan } from "../plan/schema.ts";
import { runProcess } from "../proc.ts";
import { buildAss } from "./ass.ts";
import type { RenderJob, VideoRenderer } from "./types.ts";

const CROP_X = { center: 0.5, "left-third": 0.2, "right-third": 0.8 } as const;
const f = (n: number) => n.toFixed(3);

interface Range {
  start: number;
  end: number;
}

/**
 * The parts of the source a plan reads (pictures, borrowed sound, the bed),
 * merged into a few input windows so a scene mix that jumps across a long
 * video doesn't decode everything in between. Each window becomes one `-i`.
 */
export function inputWindows(plan: EditPlan, pad = 1, bridge = 20): Range[] {
  const used: Range[] = [];
  for (const c of plan.cuts) {
    used.push({ start: c.start, end: c.end });
    if (c.audioFrom !== undefined && !c.muted) used.push({ start: c.audioFrom, end: c.audioFrom + c.end - c.start });
  }
  if (plan.bed) used.push({ start: plan.bed.start, end: plan.bed.end });
  used.sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of used) {
    const last = out[out.length - 1];
    if (last && r.start - last.end < bridge) last.end = Math.max(last.end, r.end + pad);
    else out.push({ start: Math.max(0, r.start - pad), end: r.end + pad });
  }
  return out;
}

const windowOf = (windows: Range[], start: number, end: number) => {
  const i = windows.findIndex((w) => w.start <= start + 1e-6 && end <= w.end + 1e-6);
  if (i < 0) throw new Error(`No input window covers ${start}–${end}s`);
  return i;
};

/**
 * The FFmpeg filter graph for a plan. Pure function of allow-listed plan
 * fields and numbers: no text from a transcript or agent ever reaches it
 * (captions go through an .ass file). Input `i` is source window `windows[i]`.
 */
export function buildFilterGraph(plan: EditPlan, windows: Range[], captionsFile?: string): string {
  const { width: W, height: H, fps } = plan.output;
  const blur = plan.editing.layout === "blur-background";
  const parts: string[] = [];
  const AF = "aformat=sample_rates=48000:channel_layouts=stereo";

  // Who reads which input stream, so each one is split exactly as many times as it is used.
  const vUse: string[][] = windows.map(() => []);
  const aUse: string[][] = windows.map(() => []);
  const vIn = plan.cuts.map((c, i) => {
    const w = windowOf(windows, c.start, c.end);
    (vUse[w] as string[]).push(`vs${i}`);
    return w;
  });
  const aIn = plan.cuts.map((c, i) => {
    if (c.muted) return -1;
    const a0 = c.audioFrom ?? c.start;
    const w = windowOf(windows, a0, a0 + c.end - c.start);
    (aUse[w] as string[]).push(`as${i}`);
    return w;
  });
  const bedIn = plan.bed ? windowOf(windows, plan.bed.start, plan.bed.end) : -1;
  if (plan.bed) (aUse[bedIn] as string[]).push("bs");
  windows.forEach((_, w) => {
    const v = vUse[w] as string[];
    const a = aUse[w] as string[];
    if (v.length) parts.push(`[${w}:v]split=${v.length}${v.map((l) => `[${l}]`).join("")}`);
    if (a.length) parts.push(`[${w}:a]asplit=${a.length}${a.map((l) => `[${l}]`).join("")}`);
  });

  plan.cuts.forEach((c, i) => {
    const off = (windows[vIn[i] as number] as Range).start;
    const sp = c.speed ?? 1;
    const len = c.end - c.start;
    const v = [`trim=start=${f(c.start - off)}:end=${f(c.end - off)}`, sp === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${f(sp)}`];
    // Crop layouts are framed per shot (each cut may pick its own crop); blur is framed after the join.
    if (!blur) v.push(`fps=${fps}`, `scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}:(iw-ow)*${CROP_X[c.cropMode ?? plan.editing.cropMode]}:(ih-oh)/2`, "setsar=1");
    parts.push(`[vs${i}]${v.join(",")}[v${i}]`);
    if (c.muted) {
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f(len / sp)}[a${i}]`);
    } else {
      const a0 = (c.audioFrom ?? c.start) - (windows[aIn[i] as number] as Range).start;
      const a = [`atrim=start=${f(a0)}:end=${f(a0 + len)}`, "asetpts=PTS-STARTPTS"];
      if (sp !== 1) a.push(`atempo=${f(sp)}`);
      if (c.volume !== undefined && c.volume !== 1) a.push(`volume=${f(c.volume)}`);
      a.push(AF);
      parts.push(`[as${i}]${a.join(",")}[a${i}]`);
    }
  });
  const n = plan.cuts.length;
  parts.push(`${plan.cuts.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[vc][ac]`);

  let chain = "[vc]";
  if (blur) {
    parts.push(
      `[vc]fps=${fps},split[bg][fg]`,
      `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2[bgb]`,
      `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgs]`,
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2[lay]`,
    );
    chain = "[lay]";
  }

  const filters: string[] = [];
  if (plan.zoomEvents.length) {
    const z = `1${plan.zoomEvents.map((e) => `+${f(e.scale - 1)}*between(t,${f(e.at)},${f(e.at + e.duration)})`).join("")}`;
    filters.push(`scale=w='trunc(${W}*(${z})/2)*2':h='trunc(${H}*(${z})/2)*2':eval=frame`, `crop=${W}:${H}`);
  }
  const D = plan.outputDuration;
  if (plan.editing.transitionPreset === "fade" && D > 1) filters.push(`fade=t=in:st=0:d=0.3`, `fade=t=out:st=${f(D - 0.3)}:d=0.3`);
  if (captionsFile) filters.push(`subtitles=${captionsFile}`);
  filters.push("setsar=1", "format=yuv420p");
  parts.push(`${chain}${filters.join(",")}[vout]`);

  chain = "[ac]";
  if (plan.bed) {
    const b = plan.bed;
    const off = (windows[bedIn] as Range).start;
    const speaking = b.duckUnder.map((r) => `between(t,${f(r.start)},${f(r.end)})`).join("+");
    const gain = speaking && b.duck < 1 ? `volume='if(gt(${speaking},0),${f(b.volume * b.duck)},${f(b.volume)})':eval=frame` : `volume=${f(b.volume)}`;
    parts.push(`[bs]atrim=start=${f(b.start - off)}:end=${f(b.end - off)},asetpts=PTS-STARTPTS,${AF},${gain}[bed]`, `[ac][bed]amix=inputs=2:duration=first:normalize=0[am]`);
    chain = "[am]";
  }
  const af: string[] = [];
  if (plan.audio.normalize) af.push(`loudnorm=I=${plan.audio.targetLufs}:TP=-1.5:LRA=11`);
  if (plan.editing.transitionPreset === "fade" && D > 1) af.push(`afade=t=in:st=0:d=0.2`, `afade=t=out:st=${f(D - 0.3)}:d=0.3`);
  af.push("aresample=48000");
  parts.push(`${chain}${af.join(",")}[aout]`);
  return parts.join(";");
}

/** FFmpeg-only renderer: no Node bundling, no browser. Always available when FFmpeg is. */
export class FfmpegRenderer implements VideoRenderer {
  readonly name = "ffmpeg";
  constructor(private readonly ffmpeg: string) {}

  async available() {
    try {
      const r = await runProcess(this.ffmpeg, ["-hide_banner", "-filters"], { timeoutMs: 20_000 });
      if (r.code !== 0) return { ok: false, detail: "ffmpeg did not run" };
      return /\bsubtitles\b/.test(r.stdout) ? { ok: true, detail: "ffmpeg with libass" } : { ok: false, detail: "this ffmpeg build has no libass (subtitles filter)" };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async render(job: RenderJob): Promise<void> {
    const { plan } = job;
    writeFileSync(join(job.workDir, "captions.ass"), buildAss(plan), "utf8");
    const windows = inputWindows(plan);
    const graph = buildFilterGraph(plan, windows, plan.captions.length ? "captions.ass" : undefined);
    const final = job.quality === "final";
    const args = [
      "-y", "-hide_banner", "-v", "error", "-stats",
      ...windows.flatMap((w) => ["-ss", f(w.start), "-t", f(w.end - w.start), "-i", job.sourcePath]),
      "-filter_complex", graph,
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", final ? "medium" : "veryfast", "-crf", final ? "20" : "28",
      "-r", String(plan.output.fps),
      "-c:a", "aac", "-b:a", final ? "160k" : "96k", "-ar", "48000",
      "-movflags", "+faststart",
      "-t", f(plan.outputDuration),
      job.outPath,
    ];
    const total = plan.outputDuration;
    // cwd = workDir so the subtitles filter gets a plain relative file name (no path escaping).
    const r = await runProcess(this.ffmpeg, args, {
      cwd: job.workDir,
      timeoutMs: 60 * 60_000,
      onStderr: (chunk) => {
        const m = [...chunk.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
        if (m) job.onProgress?.(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / total));
      },
    });
    if (r.code !== 0) throw new Error(`FFmpeg render failed: ${r.stderr.trim().slice(-600)}`);
  }
}
