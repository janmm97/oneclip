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

/** Source time → output time, or undefined if the moment was cut. */
export function toOutputTime(t: number, cuts: Range[]): number | undefined {
  let acc = 0;
  for (const c of cuts) {
    if (t >= c.start && t <= c.end) return acc + (t - c.start);
    acc += c.end - c.start;
  }
  return undefined;
}

export function totalDuration(cuts: Range[]) {
  return cuts.reduce((s, c) => s + (c.end - c.start), 0);
}

/** Group kept words into caption pages of up to `maxWords`, breaking at sentence ends. */
export function buildCaptions(words: Word[], cuts: Range[], emphasis: string[], maxWords = 4): Caption[] {
  const emph = new Set(emphasis.map((e) => e.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")));
  const mapped = words.flatMap((w) => {
    // A word belongs to the cut holding its midpoint; clamp its edges into that cut.
    const cut = cuts.find((c) => (w.start + w.end) / 2 >= c.start && (w.start + w.end) / 2 <= c.end);
    if (!cut) return [];
    const s = toOutputTime(Math.max(w.start, cut.start), cuts) as number;
    const e = toOutputTime(Math.min(w.end, cut.end), cuts) as number;
    const text = w.word.trim();
    return [{ text, start: s, end: Math.max(e, s + 0.05), emphasis: emph.has(text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")) }];
  });
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

/**
 * Draft (from an agent or the template planner) → full EditPlan. Every time
 * is clamped to the candidate and snapped to word boundaries, so a bad or
 * hostile draft can at worst produce a dull clip, never a broken one.
 */
export function compilePlan(
  candidate: ClipCandidate,
  words: Word[],
  draft: PlanDraft,
  planner: string,
  output: "final" | "preview" = "final",
): EditPlan {
  const bounds = { start: candidate.start, end: candidate.end };
  const clipWords = words.filter((w) => w.end > bounds.start && w.start < bounds.end);
  let cuts = draft.keep.length
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

  const zoomEvents = draft.zoomAt
    .map((t) => toOutputTime(Math.min(bounds.end, Math.max(bounds.start, t)), cuts))
    .filter((t): t is number => t !== undefined)
    .map((at) => ({ at, duration: 1.2, scale: 1 + draft.zoomIntensity }))
    .filter((z) => z.scale > 1);

  return EditPlanSchema.parse({
    version: 1,
    clipId: candidate.id,
    planner,
    sourceStart: bounds.start,
    sourceEnd: bounds.end,
    output: OUTPUT_PRESETS[output],
    editing: {
      removeSilences: draft.removeSilences,
      layout: draft.layout,
      cropMode: draft.cropMode,
      captionPreset: draft.captionPreset,
      transitionPreset: draft.transitionPreset,
      zoomIntensity: draft.zoomIntensity,
    },
    template: draft.template,
    title: draft.title.trim() || candidate.openingText.slice(0, 80),
    cuts,
    captions: buildCaptions(clipWords, cuts, draft.emphasis),
    zoomEvents,
    audio: { normalize: true, targetLufs: -14 },
    outputDuration: totalDuration(cuts),
    reasoning: draft.reasoning,
  });
}
