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

const Range = z.object({ start: z.number().nonnegative(), end: z.number().nonnegative() }).refine((r) => r.end > r.start, "end must be after start");

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
});
export type PlanDraft = z.infer<typeof PlanDraftSchema>;

export const CaptionWordSchema = z.object({ text: z.string(), start: z.number(), end: z.number(), emphasis: z.boolean() });
export const CaptionSchema = z.object({ start: z.number(), end: z.number(), words: z.array(CaptionWordSchema) });

/** The full, validated plan the renderers consume. Caption and zoom times are output time (after cuts). */
export const EditPlanSchema = z.object({
  version: z.literal(1),
  clipId: z.string().max(120),
  planner: z.string().max(60),
  sourceStart: z.number().nonnegative(),
  sourceEnd: z.number().positive(),
  output: z.object({
    width: z.number().int().min(360).max(2160),
    height: z.number().int().min(640).max(3840),
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
  cuts: z.array(Range).min(1).max(200),
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
