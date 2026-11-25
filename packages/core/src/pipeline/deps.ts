import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import { JevHookEvaluator } from "../jev/evaluator.ts";
import { OneClient } from "../one/client.ts";
import { pickPlanner } from "../plan/planners.ts";
import { FfmpegRenderer } from "../render/ffmpeg-renderer.ts";
import type { VideoRenderer } from "../render/types.ts";
import { pickTranscriber } from "../transcription/providers.ts";
import { pickDescriber } from "../vision/scenes.ts";
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
    describer: (s) => pickDescriber(s.vision, { localUrl: cfg.visionUrl, localModel: cfg.visionModel, openrouterModels: cfg.visionModels, one: () => one }),
    renderers: { ffmpeg: new FfmpegRenderer(cfg.ffmpeg), remotion: extra.remotion },
  };
}
