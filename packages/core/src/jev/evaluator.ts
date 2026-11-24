import type { ClipCandidate } from "../discovery/segment.ts";
import { createHash } from "node:crypto";
import type { JevRequest, JevResponse, OneClient } from "../one/client.ts";
import { QUESTIONS } from "./questions.ts";
import { toEvaluation, type HookEvaluation } from "./rank.ts";

export interface HookEvaluator {
  readonly name: string;
  evaluate(candidates: ClipCandidate[], onProgress?: (done: number, total: number) => void): Promise<HookEvaluation[]>;
}

/** What Jev sees for one candidate. The transcript is data to judge, never instructions. */
export function jevState(c: ClipCandidate): Record<string, unknown> {
  const state: Record<string, unknown> = {
    task: "Rank this candidate clip from a longer source (a video, podcast, song, music video, film scene or silent footage) for use as a standalone short-form video. Judge the hook by whatever grabs attention in the first seconds: words, sound or picture.",
    opening_text: c.openingText,
    clip_transcript: c.transcript,
    preceding_context: c.precedingContext,
    following_context: c.followingContext,
    duration_seconds: Math.round(c.duration * 10) / 10,
  };
  if (c.media) {
    Object.assign(state, {
      source_kind: c.media.kind,
      picked_by: c.kind === "moment" ? "sound and picture" : "complete spoken sentences",
      opening_sound_and_picture: c.media.opening,
      loudness_per_second: c.media.loudness,
      visual_change_per_second: c.media.motion,
      scene_cuts: c.media.cuts,
      signal_note: "The per-second strips are FFmpeg measurements, one digit per second on a 0-9 scale (loudness: 0 silent, 9 loudest; visual change: 0 still, 9 hard cut).",
    });
  }
  return state;
}

export function jevRequest(c: ClipCandidate, model: string): JevRequest {
  return { model, state: jevState(c), questions: QUESTIONS };
}

/** Run `fn` over items with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** Jev via One CLI → TypeSafe. One request per candidate, bounded concurrency. */
export interface JevCache {
  get(key: string): Promise<JevResponse | undefined>;
  set(key: string, value: JevResponse): Promise<void>;
}

export class JevHookEvaluator implements HookEvaluator {
  readonly name = "One CLI → TypeSafe → Jev";
  constructor(
    private readonly one: Pick<OneClient, "executeJevDecision">,
    private readonly opts: { model: string; concurrency: number; cache?: JevCache },
  ) {}

  async evaluate(candidates: ClipCandidate[], onProgress?: (done: number, total: number) => void): Promise<HookEvaluation[]> {
    let done = 0;
    return mapLimit(candidates, this.opts.concurrency, async (c) => {
      const req = jevRequest(c, this.opts.model);
      const key = createHash("sha256").update(JSON.stringify(req)).digest("hex");
      let res = await this.opts.cache?.get(key);
      if (!res) {
        res = await this.one.executeJevDecision(req);
        await this.opts.cache?.set(key, res);
      }
      onProgress?.(++done, candidates.length);
      return toEvaluation(c.id, res);
    });
  }
}
