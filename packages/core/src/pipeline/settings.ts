import { z } from "zod";
import { CONTENT_TYPE_KEYS } from "../discovery/content-types.ts";
import { DURATION_PRESETS } from "../discovery/segment.ts";
import { CAPTION_PRESETS, RATIOS, TEMPLATES } from "../plan/schema.ts";
import { MODEL_SIZES } from "../transcription/types.ts";

export const CAPTION_MODES = ["english", "original", "off"] as const;

export const ProjectSettingsSchema = z.object({
  preset: z.enum(Object.keys(DURATION_PRESETS) as [keyof typeof DURATION_PRESETS, ...(keyof typeof DURATION_PRESETS)[]]).default("standard"),
  topN: z.number().int().min(1).max(20).default(5),
  maxCandidates: z.number().int().min(3).max(60).default(24),
  transcriber: z.enum(["auto", "faster-whisper", "whisper-onnx"]).default("auto"),
  model: z.enum(MODEL_SIZES).default("small"),
  language: z.string().regex(/^[a-z]{2,3}$/).optional(),
  planner: z.enum(["auto", "openrouter", "claude-code", "codex", "opencode", "template"]).default("auto"),
  renderer: z.enum(["remotion", "ffmpeg"]).default("remotion"),
  template: z.enum(["auto", ...TEMPLATES]).default("auto"),
  captionPreset: z.enum(["auto", ...CAPTION_PRESETS]).default("auto"),
  /** english: always English (the site's English subtitles, else Whisper's translation); original: the spoken language; off: no captions. */
  captions: z.enum(CAPTION_MODES).default("english"),
  /** What kind of source this is (music video, podcast, gameplay…). auto: detected from the page and the file. */
  content: z.enum(["auto", ...CONTENT_TYPE_KEYS]).default("auto"),
  /**
   * Who describes what's on screen: agent (the user's Claude Code, when installed) or off (frames and contact sheets only).
   * Projects saved with the old choices (auto, local, openrouter) read as agent.
   */
  vision: z.preprocess((v) => (v === "off" ? "off" : "agent"), z.enum(["agent", "off"])),
  /** Frame shapes to render each clip in (one file per ratio). */
  ratios: z.array(z.enum(RATIOS)).min(1).max(RATIOS.length).default(["9:16"]).transform((r) => [...new Set(r)]),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const STAGES = ["download", "prepare", "probe", "audio", "transcribe", "signals", "scenes", "candidates", "jev", "plan", "render"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  download: "Downloading from link",
  prepare: "Preparing source",
  probe: "Reading video",
  audio: "Extracting audio",
  transcribe: "Transcribing",
  signals: "Measuring sound and picture",
  scenes: "Looking at the scenes",
  candidates: "Finding hooks and moments",
  jev: "Ranking hooks with Jev",
  plan: "Planning edits",
  render: "Rendering",
};
