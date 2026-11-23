import { Composition, registerRoot } from "remotion";
import type { EditPlan } from "@oneclip/core/browser";
import { Clip, COMPOSITION_ID, planVideoConfig, type ClipProps } from "./compositions/index.tsx";

// Placeholder props only exist so the composition can be listed; real renders pass a plan.
const placeholder: EditPlan = {
  version: 1,
  clipId: "placeholder",
  planner: "none",
  sourceStart: 0,
  sourceEnd: 1,
  output: { width: 1080, height: 1920, fps: 30 },
  editing: { removeSilences: false, layout: "crop-center", cropMode: "center", captionPreset: "bold-pop", transitionPreset: "none", zoomIntensity: 0 },
  template: "podcast-short",
  title: "",
  cuts: [{ start: 0, end: 1 }],
  captions: [],
  zoomEvents: [],
  audio: { normalize: false, targetLufs: -14 },
  outputDuration: 1,
  reasoning: "",
};

function Root() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={Clip}
      defaultProps={{ plan: placeholder, src: "" } satisfies ClipProps}
      {...planVideoConfig(placeholder)}
      calculateMetadata={({ props }) => planVideoConfig((props as ClipProps).plan)}
    />
  );
}

registerRoot(Root);
