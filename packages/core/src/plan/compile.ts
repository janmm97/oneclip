import type { ClipCandidate } from "../discovery/segment.ts";
import type { Word } from "../transcription/types.ts";
import { EditPlanSchema, OUTPUT_PRESETS, type Caption, type EditPlan, type PlanDraft } from "./schema.ts";

export interface Range {
  start: number;
  end: number;
}

/** Keep ranges that skip pauses longer than `minGap` between words, with a little padding. */
export function silenceKeepRanges(words: Word[], bounds: Range, minGap = 0.6, pad = 0.12): Range[] {
  const inside = words.filter((w) => w.end > bounds.start && w.start < bounds.end);
  if (!inside.length) return [bounds];
  const out: Range[] = [];
  let cur: Range = { start: Math.max(bounds.start, (inside[0] as Word).start - pad), end: (inside[0] as Word).end };
  for (const w of inside.slice(1)) {
    if (w.start - cur.end > minGap) {
      out.push({ start: cur.start, end: Math.min(bounds.end, cur.end + pad) });
      cur = { start: Math.max(bounds.start, w.start - pad), end: w.end };
    } else cur.end = w.end;
  }
  out.push({ start: cur.start, end: Math.min(bounds.end, cur.end + pad) });
  return out;
}

/** Clamp to bounds, sort, merge overlaps, drop slivers. */
export function normalizeRanges(ranges: Range[], bounds: Range, minLen = 0.2): Range[] {
  const clamped = ranges
    .map((r) => ({ start: Math.max(bounds.start, r.start), end: Math.min(bounds.end, r.end) }))
    .filter((r) => r.end - r.start >= minLen)
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of clamped) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 0.05) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * Give each cut room to breathe: transcript word times sit tight on the
 * syllables, so a cut exactly on them clips the first consonant and the last
 * word's tail. Pads stop short of the neighbouring word, so nothing extra is heard.
 */
export function padCuts(cuts: Range[], words: Word[], bounds: Range, head = 0.15, tail = 0.3): Range[] {
  return cuts.map((c) => {
    const before = Math.max(bounds.start, ...words.filter((w) => w.end <= c.start + 0.01).map((w) => w.end));
    const after = Math.min(bounds.end, ...words.filter((w) => w.start >= c.end - 0.01).map((w) => w.start));
    return { start: Math.max(before, c.start - head), end: Math.min(after, c.end + tail) };
  });
}

/** Snap a time to the nearest word boundary so cuts never split a word. */
export function snapToWords(t: number, words: Word[], edge: "start" | "end"): number {
  let best = t;
  let bestD = Infinity;
  for (const w of words) {
    const b = edge === "start" ? w.start : w.end;
    const d = Math.abs(b - t);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return bestD <= 1.5 ? best : t;
}

/** A kept shot. Mixing fields are optional; without them a cut plays its own picture and sound at 1×. */
export type Cut = EditPlan["cuts"][number];
const speedOf = (c: Range & { speed?: number }) => c.speed ?? 1;
const lengthOut = (c: Range & { speed?: number }) => (c.end - c.start) / speedOf(c);

/** Source (picture) time → output time, or undefined if the moment was cut. */
export function toOutputTime(t: number, cuts: (Range & { speed?: number })[]): number | undefined {
  let acc = 0;
  for (const c of cuts) {
    if (t >= c.start && t <= c.end) return acc + (t - c.start) / speedOf(c);
    acc += lengthOut(c);
  }
  return undefined;
}

export function totalDuration(cuts: (Range & { speed?: number })[]) {
  return cuts.reduce((s, c) => s + lengthOut(c), 0);
}

/**
 * Where a source-audio interval is heard in the output. Follows each cut's
 * sound (its own, or `audioFrom`), skips muted cuts, and returns every place
 * it is heard (a repeated shot repeats its words).
 */
export function heardAt(w: Range, cuts: Cut[]): Range[] {
  const mid = (w.start + w.end) / 2;
  const out: Range[] = [];
  let acc = 0;
  for (const c of cuts) {
    const a0 = c.audioFrom ?? c.start;
    const a1 = a0 + (c.end - c.start);
    if (!c.muted && mid >= a0 && mid <= a1) {
      const sp = speedOf(c);
      out.push({ start: acc + (Math.max(w.start, a0) - a0) / sp, end: acc + (Math.min(w.end, a1) - a0) / sp });
    }
    acc += lengthOut(c);
  }
  return out;
}

/** Group kept words into caption pages of up to `maxWords`, breaking at sentence ends. */
export function buildCaptions(words: Word[], cuts: Cut[], emphasis: string[], maxWords = 4): Caption[] {
  const emph = new Set(emphasis.map((e) => e.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")));
  // Captions follow what is heard: a word belongs to the cut whose sound holds its midpoint.
  const mapped = words
    .flatMap((w) => {
      const text = w.word.trim();
      const em = emph.has(text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ""));
      return heardAt(w, cuts).map((r) => ({ text, start: r.start, end: Math.max(r.end, r.start + 0.05), emphasis: em }));
    })
    .sort((a, b) => a.start - b.start);
  const pages: Caption[] = [];
  let cur: Caption["words"] = [];
  for (const w of mapped) {
    cur.push(w);
    if (cur.length >= maxWords || /[.!?,]$/.test(w.text)) {
      pages.push({ start: (cur[0] as Caption["words"][number]).start, end: w.end, words: cur });
      cur = [];
    }
  }
  if (cur.length) pages.push({ start: (cur[0] as Caption["words"][number]).start, end: (cur[cur.length - 1] as Caption["words"][number]).end, words: cur });
  return pages;
}

/** Merge output-time speech ranges into duck zones (gaps under `gap` seconds are bridged). */
function speechZones(words: Word[], cuts: Cut[], gap = 0.6, pad = 0.1): Range[] {
  const heard = words.flatMap((w) => heardAt(w, cuts)).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of heard) {
    const last = out[out.length - 1];
    if (last && r.start - pad <= last.end + gap) last.end = Math.max(last.end, r.end + pad);
    else out.push({ start: Math.max(0, r.start - pad), end: r.end + pad });
  }
  return out;
}

/** A scene mix longer than this is cut off (a short is seconds; this stops a plan that repeats a long shot 60 times). */
export const MAX_MIX_SECONDS = 600;

/** Scene-mix segments → cuts: clamped into `limit`, kept in the agent's order (repeats allowed), never word-snapped. */
function mixCuts(segments: NonNullable<PlanDraft["segments"]>, limit: Range): Cut[] {
  let total = 0;
  return segments.flatMap((sg) => {
    if (total >= MAX_MIX_SECONDS) return [];
    const start = Math.max(limit.start, sg.start);
    const end = Math.min(limit.end, sg.end);
    const len = end - start;
    if (len < 0.2) return [];
    const cut: Cut = { start, end };
    // Up to 60 repeats of a long shot would render for hours: cut the mix off at the cap.
    const over = total + len / (sg.speed ?? 1) - MAX_MIX_SECONDS;
    if (over > 0) cut.end = Math.max(start + 0.2, end - over * (sg.speed ?? 1));
    total += (cut.end - start) / (sg.speed ?? 1);
    const kept = cut.end - start;
    if (sg.audioFrom !== undefined) cut.audioFrom = Math.min(Math.max(limit.start, sg.audioFrom), limit.end - kept);
    if (sg.muted) cut.muted = true;
    if (sg.speed !== undefined && sg.speed !== 1) cut.speed = sg.speed;
    if (sg.volume !== undefined && sg.volume !== 1) cut.volume = sg.volume;
    if (sg.cropMode) cut.cropMode = sg.cropMode;
    if (sg.frame) cut.frame = sg.frame;
    return [cut];
  });
}

export interface CompileOptions {
  /** Full source length. With it, scene-mix segments and the bed may use any part of the source; without it they stay inside the clip. */
  sourceDuration?: number;
}

/**
 * Draft (from an agent or the template planner) → full EditPlan. Every time
 * is clamped to the candidate and snapped to word boundaries, so a bad or
 * hostile draft can at worst produce a dull clip, never a broken one.
 * `captionWords` is what the captions say (an English track, or none); cuts
 * always follow the spoken `words`. A draft with `segments` is a scene mix:
 * shots play in the given order, may borrow another moment's sound, change
 * speed or go silent, and captions follow the sound actually heard.
 */
export function compilePlan(
  candidate: ClipCandidate,
  words: Word[],
  draft: PlanDraft,
  planner: string,
  output: "final" | "preview" = "final",
  captionWords: Word[] = words,
  opts: CompileOptions = {},
): EditPlan {
  const bounds = { start: candidate.start, end: candidate.end };
  const limit = opts.sourceDuration ? { start: 0, end: opts.sourceDuration } : bounds;
  const clipWords = words.filter((w) => w.end > bounds.start && w.start < bounds.end);
  const mix = !!draft.segments?.length;
  let cuts: Cut[];
  if (mix) {
    cuts = mixCuts(draft.segments ?? [], limit);
    if (!cuts.length || totalDuration(cuts) < 1) cuts = [bounds];
  } else {
    cuts = draft.keep.length
      ? normalizeRanges(
          draft.keep.map((r) => ({ start: snapToWords(r.start, clipWords, "start"), end: snapToWords(r.end, clipWords, "end") })),
          bounds,
        )
      : [bounds];
    if (draft.removeSilences) {
      cuts = normalizeRanges(
        cuts.flatMap((c) => silenceKeepRanges(clipWords, c)),
        bounds,
      );
    }
    if (!cuts.length || totalDuration(cuts) < 3) cuts = [bounds];
    cuts = normalizeRanges(padCuts(cuts, words, limit), limit);
  }
  const outputDuration = totalDuration(cuts);

  const zoomEvents = draft.zoomAt
    .map((t) => toOutputTime(Math.min(limit.end, Math.max(limit.start, t)), cuts))
    .filter((t): t is number => t !== undefined)
    .map((at) => ({ at, duration: 1.2, scale: 1 + draft.zoomIntensity }))
    .filter((z) => z.scale > 1);

  let bed: EditPlan["bed"];
  if (draft.bed) {
    const start = Math.min(Math.max(limit.start, draft.bed.start), limit.end);
    const end = Math.min(limit.end, draft.bed.end ?? limit.end, start + outputDuration);
    if (end - start >= 0.5 && draft.bed.volume > 0) {
      bed = { start, end, volume: draft.bed.volume, duck: draft.bed.duck, duckUnder: speechZones(words, cuts).slice(0, 400) };
    }
  }

  // Everything the renderers read from the source: pictures, borrowed sound, the bed.
  const used = [
    ...cuts.map((c) => ({ start: c.start, end: c.end })),
    ...cuts.filter((c) => c.audioFrom !== undefined && !c.muted).map((c) => ({ start: c.audioFrom as number, end: (c.audioFrom as number) + c.end - c.start })),
    ...(bed ? [{ start: bed.start, end: bed.end }] : []),
  ];

  return EditPlanSchema.parse({
    version: 1,
    clipId: candidate.id,
    planner,
    sourceStart: Math.min(...used.map((r) => r.start)),
    sourceEnd: Math.max(...used.map((r) => r.end)),
    output: OUTPUT_PRESETS[output],
    editing: {
      removeSilences: mix ? false : draft.removeSilences,
      layout: draft.layout,
      cropMode: draft.cropMode,
      captionPreset: draft.captionPreset,
      transitionPreset: draft.transitionPreset,
      zoomIntensity: draft.zoomIntensity,
    },
    template: draft.template,
    title: draft.title.trim() || candidate.openingText.slice(0, 80),
    cuts,
    ...(bed ? { bed } : {}),
    captions: buildCaptions(mix ? captionWords : captionWords.filter((w) => w.end > bounds.start && w.start < bounds.end), cuts, draft.emphasis),
    zoomEvents,
    audio: { normalize: true, targetLufs: -14 },
    outputDuration,
    reasoning: draft.reasoning,
  });
}
