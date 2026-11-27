import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import { JevHookEvaluator } from "../jev/evaluator.ts";
import { OneClient } from "../one/client.ts";
import { editPlanners, pickPlanner } from "../plan/planners.ts";
import { FfmpegRenderer } from "../render/ffmpeg-renderer.ts";
import { ClaudeCodeRenderReviewer } from "../render/qa.ts";
import type { VideoRenderer } from "../render/types.ts";
import { pickTranscriber } from "../transcription/providers.ts";
import { ClaudeCodeVisionDescriber, pickDescriber } from "../vision/scenes.ts";
import type { PipelineDeps } from "./pipeline.ts";

/** Real dependencies. Pass extra renderers (Remotion lives in its own package). */
export function createDeps(db: Db, cfg: Config, extra: { remotion?: VideoRenderer; one?: OneClient } = {}): PipelineDeps {
  const one = extra.one ?? new OneClient({ typesafeKey: cfg.typesafeKey, openrouterKey: cfg.openrouterKey });
  return {
    db,
    cfg,
    transcriber: (s) => pickTranscriber(s.transcriber, cfg.python),
    evaluator: (cache) => new JevHookEvaluator(one, { model: cfg.jevModel, concurrency: cfg.jevConcurrency, cache }),
    planner: (s) => pickPlanner(s.planner, cfg, one),
    editPlanners: (s) => editPlanners(s.planner, cfg, one),
    describer: (s) => pickDescriber(s.vision, { claudeBin: cfg.claudeBin }),
    // Same rule as the scene describer: only with vision on and the user's Claude Code installed.
    reviewer: async (s) => (s.qa === "off" || s.vision === "off" || !(await new ClaudeCodeVisionDescriber(cfg.claudeBin).available()) ? undefined : new ClaudeCodeRenderReviewer(cfg.claudeBin)),
    renderers: { ffmpeg: new FfmpegRenderer(cfg.ffmpeg), remotion: extra.remotion },
  };
}
