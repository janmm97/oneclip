import { z } from "zod";

export const WordSchema = z.object({ word: z.string(), start: z.number(), end: z.number(), probability: z.number().optional() });
export const TranscriptSchema = z.object({
  engine: z.string(),
  model: z.string(),
  language: z.string(),
  duration: z.number(),
  words: z.array(WordSchema),
});

export type Word = z.infer<typeof WordSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;

export const MODEL_SIZES = ["tiny", "base", "small", "medium", "large-v3"] as const;
export type ModelSize = (typeof MODEL_SIZES)[number];

export interface TranscribeOptions {
  model: ModelSize;
  language?: string;
  /** "translate" asks Whisper for English text instead of the spoken language. */
  task?: "transcribe" | "translate";
  device?: "auto" | "cpu" | "cuda";
  onProgress?: (fraction: number) => void;
  /** New words, in order, as soon as the engine has them (before the transcript is done). */
  onWords?: (words: Word[]) => void;
}

/** Turns a 16 kHz mono WAV into words with timestamps. Runs locally; nothing is uploaded. */
export interface TranscriptionProvider {
  readonly name: string;
  available(): Promise<{ ok: boolean; detail: string }>;
  transcribe(wavPath: string, opts: TranscribeOptions): Promise<Transcript>;
}
