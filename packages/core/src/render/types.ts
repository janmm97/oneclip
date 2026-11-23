import type { MediaInfo } from "../media/ffmpeg.ts";
import type { EditPlan } from "../plan/schema.ts";

export interface RenderJob {
  /** Absolute path of the authorised local source video. */
  sourcePath: string;
  source: MediaInfo;
  plan: EditPlan;
  /** Absolute output path (.mp4). */
  outPath: string;
  /** Scratch folder for this render (caption files, bundles). */
  workDir: string;
  quality: "final" | "preview";
  onProgress?: (fraction: number) => void;
}

/** Turns a validated EditPlan into an MP4. Swap implementations without touching analysis. */
export interface VideoRenderer {
  readonly name: string;
  available(): Promise<{ ok: boolean; detail: string }>;
  render(job: RenderJob): Promise<void>;
}
