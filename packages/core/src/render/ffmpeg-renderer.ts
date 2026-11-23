import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditPlan } from "../plan/schema.ts";
import { runProcess } from "../proc.ts";
import { buildAss } from "./ass.ts";
import type { RenderJob, VideoRenderer } from "./types.ts";

const CROP_X = { center: 0.5, "left-third": 0.2, "right-third": 0.8 } as const;
const f = (n: number) => n.toFixed(3);

/**
 * The FFmpeg filter graph for a plan. Pure function of allow-listed plan
 * fields and numbers: no text from a transcript or agent ever reaches it
 * (captions go through an .ass file). `seek` is where the input was opened.
 */
export function buildFilterGraph(plan: EditPlan, seek: number, captionsFile?: string): string {
  const { width: W, height: H, fps } = plan.output;
  const n = plan.cuts.length;
  const parts: string[] = [`[0:v]split=${n}${plan.cuts.map((_, i) => `[vs${i}]`).join("")}`, `[0:a]asplit=${n}${plan.cuts.map((_, i) => `[as${i}]`).join("")}`];
  plan.cuts.forEach((c, i) => {
    const s = f(c.start - seek);
    const e = f(c.end - seek);
    parts.push(`[vs${i}]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`, `[as${i}]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
  });
  parts.push(`${plan.cuts.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[vc][ac]`);

  const x = CROP_X[plan.editing.cropMode];
  if (plan.editing.layout === "blur-background") {
    parts.push(
      `[vc]fps=${fps},split[bg][fg]`,
      `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2[bgb]`,
      `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgs]`,
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2[lay]`,
    );
  } else {
    parts.push(`[vc]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-ow)*${x}:(ih-oh)/2[lay]`);
  }

  let chain = "[lay]";
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
    const seek = Math.max(0, plan.sourceStart - 1);
    const span = plan.sourceEnd - seek + 1;
    const graph = buildFilterGraph(plan, seek, plan.captions.length ? "captions.ass" : undefined);
    const final = job.quality === "final";
    const args = [
      "-y", "-hide_banner", "-v", "error", "-stats",
      "-ss", f(seek), "-t", f(span), "-i", job.sourcePath,
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
