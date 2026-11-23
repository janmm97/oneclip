import type { EditPlan } from "@oneclip/core/browser";
export { Clip, assToCss, zoomAt, type ClipProps } from "./Clip.tsx";

export const COMPOSITION_ID = "OneClip";

/** Size and length come from the plan, so the Player and the renderer agree. */
export function planVideoConfig(plan: EditPlan) {
  const { width, height, fps } = plan.output;
  return { width, height, fps, durationInFrames: Math.max(1, Math.round(plan.outputDuration * fps)) };
}
