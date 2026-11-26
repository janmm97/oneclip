import type { Word } from "../transcription/types.ts";
import type { CandidateMedia } from "./signals.ts";

export interface ClipCandidate {
  id: string;
  videoId: string;
  start: number;
  end: number;
  openingText: string;
  transcript: string;
  precedingContext: string;
  followingContext: string;
  duration: number;
  /** "moment": picked from sound and picture, not sentences. Never silence-trimmed. */
  kind?: "speech" | "moment";
  media?: CandidateMedia;
  /** What kind of source this is and where the clip sits in it (see profile.ts). */
  content?: { type: string; label: string; guide: string; section: string };
  /** What the scene describer saw on screen, one line per shot ("0:03 close-up of… (action)"). */
  onScreen?: string;
}

export const DURATION_PRESETS = {
  quick: { label: "Quick (10–20s)", min: 10, max: 20 },
  short: { label: "Short (20–40s)", min: 20, max: 40 },
  standard: { label: "Standard (30–60s)", min: 30, max: 60 },
  extended: { label: "Extended (60–90s)", min: 60, max: 90 },
} as const;

export type DurationPreset = keyof typeof DURATION_PRESETS;

export interface Sentence {
  start: number;
  end: number;
  /** Index range into the word list, end exclusive. */
  from: number;
  to: number;
  text: string;
}

/** Starting a clip on these words almost always means a cut thought. */
const DANGLING_START = /^(and|but|because|which|that|or|nor|then|also|plus|although|though|whereas)\b/i;

export function joinWords(words: Word[]): string {
  return words
    .map((w) => w.word.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1");
}

/** Split words into sentences at terminal punctuation or long pauses. */
export function toSentences(words: Word[], pause = 1.2): Sentence[] {
  const out: Sentence[] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    const next = words[i + 1];
    const terminal = /[.!?]["')\]]?$/.test(w.word.trim());
    const gap = next ? next.start - w.end : Infinity;
    if (terminal || gap >= pause || !next) {
      const slice = words.slice(from, i + 1);
      out.push({ start: (words[from] as Word).start, end: w.end, from, to: i + 1, text: joinWords(slice) });
      from = i + 1;
    }
  }
  return out;
}

function lastWords(words: Word[], end: number, n: number) {
  return joinWords(words.slice(Math.max(0, end - n), end));
}

/**
 * Candidate windows built from whole sentences, so every clip starts and ends
 * on a complete thought. One candidate per starting sentence (the length
 * closest to the preset's middle); windows may overlap. Capped evenly across
 * the video to keep Jev costs predictable.
 */
export function findCandidates(
  videoId: string,
  words: Word[],
  preset: DurationPreset,
  opts: { maxCandidates?: number; contextWords?: number } = {},
): ClipCandidate[] {
  const { min, max } = DURATION_PRESETS[preset];
  const target = (min + max) / 2;
  const ctx = opts.contextWords ?? 40;
  const sentences = toSentences(words);
  const out: ClipCandidate[] = [];
  // In a cased transcript, a "sentence" opening in lowercase usually means the
  // recogniser dropped words, so the thought is already cut.
  const cased = sentences.filter((s) => /^[A-Z]/.test(s.text)).length > sentences.length / 2;

  for (let s = 0; s < sentences.length; s++) {
    const first = sentences[s] as Sentence;
    if (DANGLING_START.test(first.text)) continue;
    if (cased && /^[a-z]/.test(first.text)) continue;
    // Two endings per start: the shortest complete one (tight, less filler) and
    // the one closest to the preset's middle. Jev's context check picks between them.
    let shortest: Sentence | undefined;
    let best: Sentence | undefined;
    for (let e = s; e < sentences.length; e++) {
      const last = sentences[e] as Sentence;
      const dur = last.end - first.start;
      if (dur > max) break;
      if (dur < min) continue;
      shortest ??= last;
      if (!best || Math.abs(dur - target) < Math.abs(best.end - first.start - target)) best = last;
    }
    for (const last of new Set([shortest, best])) {
      if (!last) continue;
      out.push({
        id: `${videoId}-${Math.round(first.start * 1000)}-${Math.round(last.end * 1000)}`,
        videoId,
        start: first.start,
        end: last.end,
        openingText: first.text,
        transcript: joinWords(words.slice(first.from, last.to)),
        precedingContext: lastWords(words, first.from, ctx),
        followingContext: joinWords(words.slice(last.to, last.to + ctx)),
        duration: last.end - first.start,
      });
    }
  }
  return spread(out, opts.maxCandidates ?? 30);
}

/** Keep at most n items, evenly spaced, preserving order. */
export function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)] as T);
}
