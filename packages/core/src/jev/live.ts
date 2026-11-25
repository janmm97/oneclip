import { type ClipCandidate, DURATION_PRESETS, type DurationPreset, findCandidates, spread } from "../discovery/segment.ts";
import type { Word } from "../transcription/types.ts";
import type { HookEvaluator } from "./evaluator.ts";
import type { HookEvaluation } from "./rank.ts";

export interface LiveReaderOptions {
  videoId: string;
  preset: DurationPreset;
  /** Source length in seconds (known from probe before transcription starts). */
  duration: number;
  /** How many spoken candidates Jev may score in total. Asked at each slice, since the content type firms up as words arrive. */
  budget: (wordsSoFar: Word[]) => number | Promise<number>;
  evaluator: HookEvaluator;
  /**
   * Gives raw candidates what the final pass will give them (media strips,
   * content type) so Jev's answers are cached under the same request. Return
   * [] to skip live scoring (for example when the source isn't speech).
   */
  prepare: (candidates: ClipCandidate[], wordsSoFar: Word[]) => Promise<ClipCandidate[]>;
  onHook?: (candidate: ClipCandidate, evaluation: HookEvaluation) => void;
  /** Seconds per slice of the source; each slice gets its share of the budget. */
  sliceSeconds?: number;
  /** Seconds of transcript needed past a slice before its candidates are final (longest clip + following context). */
  settleAfter?: number;
}

/**
 * Reads the transcript while Whisper is still writing it. The source is cut
 * into slices; once the words are in well past a slice, its sentence
 * candidates are final, so Jev scores them right away instead of after the
 * whole transcript. The final ranking reuses those answers from the cache:
 * same candidates, same budget, no extra Jev calls, just earlier.
 */
export class LiveHookReader {
  private words: Word[] = [];
  private readonly slices: { start: number; end: number }[];
  private settled = 0;
  private readonly picked: (ClipCandidate[] | undefined)[] = [];
  private queue: Promise<void> = Promise.resolve();
  /** Hooks Jev has scored so far, best first. */
  readonly hooks: { candidate: ClipCandidate; evaluation: HookEvaluation }[] = [];
  /** The first live failure, if any (the final pass asks again and reports it properly). */
  error?: Error;

  constructor(private readonly o: LiveReaderOptions) {
    const n = Math.max(1, Math.ceil(o.duration / (o.sliceSeconds ?? 120)));
    const len = o.duration / n;
    this.slices = Array.from({ length: n }, (_, i) => ({ start: i * len, end: i === n - 1 ? Number.POSITIVE_INFINITY : (i + 1) * len }));
  }

  private get margin() {
    return this.o.settleAfter ?? DURATION_PRESETS[this.o.preset].max + 20;
  }

  /** New words from the transcriber, in order. */
  push(words: Word[]): void {
    this.words.push(...words);
    const heard = this.words.at(-1)?.end ?? 0;
    while (this.settled < this.slices.length && heard >= (this.slices[this.settled] as { end: number }).end + this.margin) this.score(this.settled++);
  }

  /** The slice's sentence candidates: its share of the budget, spread evenly. */
  private async pick(i: number, words: Word[]): Promise<ClipCandidate[]> {
    const s = this.slices[i] as { start: number; end: number };
    const all = findCandidates(this.o.videoId, words, this.o.preset, { maxCandidates: Number.POSITIVE_INFINITY });
    const quota = Math.max(1, Math.round((await this.o.budget(words)) / this.slices.length));
    return spread(
      all.filter((c) => c.start >= s.start && c.start < s.end),
      quota,
    );
  }

  private score(i: number) {
    const words = [...this.words];
    // One slice at a time: the evaluator already runs its own requests in parallel.
    this.queue = this.queue.then(async () => {
      if (this.error) return;
      try {
        const mine = await this.pick(i, words);
        this.picked[i] = mine;
        const ready = mine.length ? await this.o.prepare(mine, words) : [];
        if (!ready.length) return;
        for (const e of await this.o.evaluator.evaluate(ready)) {
          const candidate = ready.find((c) => c.id === e.candidateId);
          if (!candidate) continue;
          this.hooks.push({ candidate, evaluation: e });
          this.o.onHook?.(candidate, e);
        }
        this.hooks.sort((a, b) => b.evaluation.final - a.evaluation.final);
      } catch (e) {
        this.error = e as Error;
      }
    });
  }

  /**
   * The full transcript is in. Waits for live scoring, then picks the slices
   * not settled yet from the final words (the final pass scores those).
   * Returns every spoken candidate in time order.
   */
  async finish(words: Word[]): Promise<ClipCandidate[]> {
    await this.queue;
    const out: ClipCandidate[] = [];
    for (let i = 0; i < this.slices.length; i++) out.push(...(this.picked[i] ?? (await this.pick(i, words))));
    return out.sort((a, b) => a.start - b.start);
  }
}
