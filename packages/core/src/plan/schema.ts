import { z } from "zod";

/**
 * Edit plans are data, never code. Every field is an allow-listed enum or a
 * bounded number; OneClip turns a plan into FFmpeg/Remotion inputs itself
 * and never runs a command, path or string from a plan.
 */

export const LAYOUTS = ["crop-center", "blur-background"] as const;
export const CROP_MODES = ["center", "left-third", "right-third"] as const;
export const CAPTION_PRESETS = ["bold-pop", "clean", "karaoke"] as const;
export const TRANSITION_PRESETS = ["none", "fade", "punch-in"] as const;
export const TEMPLATES = ["podcast-short", "educational-short", "storytelling-short"] as const;

/** How one shot fills the frame: crop and follow a subject, fit the whole shot over a blurred copy, or stack two subjects. */
export const FRAME_MODES = ["crop", "fit", "split"] as const;
const Frac = z.number().min(0).max(1);
/**
 * A shot's framing. `x`/`y` place the crop window (0 = left/top edge of the scaled picture, 1 = right/bottom),
 * the same meaning as CSS object-position. `split`: top half uses x/y, bottom half x2/y2, both zoomed by `zoom`.
 */
export const FrameSchema = z.object({
  mode: z.enum(FRAME_MODES),
  x: Frac.optional(),
  y: Frac.optional(),
  x2: Frac.optional(),
  y2: Frac.optional(),
  zoom: z.number().min(1).max(3).optional(),
});
export type Frame = z.infer<typeof FrameSchema>;

const Range = z.object({ start: z.number().nonnegative(), end: z.number().nonnegative() }).refine((r) => r.end > r.start, "end must be after start");

/** Per-shot mixing controls shared by draft segments and plan cuts. */
const MixFields = {
  /** Play the audio from this source time instead of the shot's own (the audio length matches the shot). */
  audioFrom: z.number().nonnegative().optional(),
  /** Drop the shot's audio (the bed, if any, still plays). */
  muted: z.boolean().optional(),
  /** 0.5 = slow motion, 2 = double speed. Audio follows. */
  speed: z.number().min(0.5).max(2).optional(),
  /** Gain for this shot's audio. */
  volume: z.number().min(0).max(2).optional(),
  /** Reframe this shot differently from the clip default. */
  cropMode: z.enum(CROP_MODES).optional(),
  /** Framing for this shot; overrides layout and cropMode. Set by smart reframe or an agent. */
  frame: FrameSchema.optional(),
};
const Segment = z
  .object({ start: z.number().nonnegative(), end: z.number().nonnegative(), ...MixFields })
  .refine((r) => r.end > r.start, "end must be after start");
const Bed = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative().optional(),
  volume: z.number().min(0).max(1),
  /** Lower the bed to this gain while someone speaks (0 = silence, 1 = no ducking). */
  duck: z.number().min(0).max(1),
});
const Cut = z
  .object({ start: z.number().nonnegative(), end: z.number().nonnegative(), ...MixFields })
  .refine((r) => r.end > r.start, "end must be after start");

/** What an editing agent may decide. OneClip fills in the rest. */
export const PlanDraftSchema = z.object({
  template: z.enum(TEMPLATES),
  layout: z.enum(LAYOUTS),
  cropMode: z.enum(CROP_MODES),
  captionPreset: z.enum(CAPTION_PRESETS),
  transitionPreset: z.enum(TRANSITION_PRESETS),
  zoomIntensity: z.number().min(0).max(0.3),
  removeSilences: z.boolean(),
  /** Source-time ranges to keep, inside the clip. Empty = keep the whole clip. */
  keep: z.array(Range).max(40),
  /** Source times for a short zoom punch-in. */
  zoomAt: z.array(z.number().nonnegative()).max(20),
  /** Words to highlight in captions (matched case-insensitively). */
  emphasis: z.array(z.string().max(40)).max(30),
  title: z.string().max(80),
  reasoning: z.string().max(600),
  /**
   * Scene mixing (optional). Shots played in this order, which may jump back and
   * forth or repeat. When set, it replaces `keep`/`removeSilences`.
   */
  segments: z.array(Segment).max(60).optional(),
  /** An audio bed from another part of the source (music, crowd, ambience) under the whole clip. */
  bed: Bed.optional(),
});
export type PlanDraft = z.infer<typeof PlanDraftSchema>;
export type Segment = z.infer<typeof Segment>;

export const CaptionWordSchema = z.object({ text: z.string(), start: z.number(), end: z.number(), emphasis: z.boolean() });
/** `y`: where the page sits (centre, fraction of the frame height), set by face-safe placement; unset: the preset's default. */
export const CaptionSchema = z.object({ start: z.number(), end: z.number(), words: z.array(CaptionWordSchema), y: z.number().min(0.05).max(0.95).optional() });

/** The full, validated plan the renderers consume. Caption and zoom times are output time (after cuts). */
export const EditPlanSchema = z.object({
  version: z.literal(1),
  clipId: z.string().max(120),
  planner: z.string().max(60),
  sourceStart: z.number().nonnegative(),
  sourceEnd: z.number().positive(),
  output: z.object({
    width: z.number().int().min(270).max(3840),
    height: z.number().int().min(270).max(3840),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
  }),
  editing: z.object({
    removeSilences: z.boolean(),
    layout: z.enum(LAYOUTS),
    cropMode: z.enum(CROP_MODES),
    captionPreset: z.enum(CAPTION_PRESETS),
    transitionPreset: z.enum(TRANSITION_PRESETS),
    zoomIntensity: z.number().min(0).max(0.3),
  }),
  template: z.enum(TEMPLATES),
  title: z.string().max(80),
  /** Source-time ranges kept, in order. */
  cuts: z.array(Cut).min(1).max(200),
  /** Audio bed, played from `start` in source time; `duckUnder` are output-time ranges with speech. */
  bed: z
    .object({ start: z.number().nonnegative(), end: z.number().positive(), volume: z.number().min(0).max(1), duck: z.number().min(0).max(1), duckUnder: z.array(Range).max(400) })
    .optional(),
  captions: z.array(CaptionSchema).max(1000),
  zoomEvents: z.array(z.object({ at: z.number().nonnegative(), duration: z.number().positive().max(3), scale: z.number().min(1).max(1.3) })).max(50),
  audio: z.object({ normalize: z.boolean(), targetLufs: z.number().min(-24).max(-9) }),
  outputDuration: z.number().positive(),
  reasoning: z.string().max(600),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;
export type Caption = z.infer<typeof CaptionSchema>;

export const OUTPUT_PRESETS = {
  final: { width: 1080, height: 1920, fps: 30 as const },
  preview: { width: 540, height: 960, fps: 30 as const },
};

/** Frame shapes: 9:16 Reels/Shorts/TikTok, 1:1 and 4:5 feed posts, 16:9 YouTube/desktop, 4:3 classic. */
export const RATIOS = ["9:16", "1:1", "4:5", "16:9", "4:3"] as const;
export type Ratio = (typeof RATIOS)[number];
export const RATIO_LABELS: Record<Ratio, string> = {
  "9:16": "9:16 vertical (Reels, Shorts, TikTok)",
  "1:1": "1:1 square (feed)",
  "4:5": "4:5 portrait (Instagram feed)",
  "16:9": "16:9 landscape (YouTube, desktop)",
  "4:3": "4:3 classic",
};

/** Output size for a ratio: the short side is 1080 for final, 540 for preview (even numbers for H.264). */
export function outputFor(quality: "final" | "preview", ratio: Ratio = "9:16") {
  const [a, b] = ratio.split(":").map(Number) as [number, number];
  const short = quality === "final" ? 1080 : 540;
  const long = Math.round((short * Math.max(a, b)) / Math.min(a, b) / 2) * 2;
  return { width: a >= b ? long : short, height: a >= b ? short : long, fps: 30 as const };
}

/** "16:9" → "16x9", safe for file names. */
export const ratioSlug = (r: Ratio) => r.replace(":", "x");
