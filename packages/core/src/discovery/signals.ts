import { runProcess } from "../proc.ts";
import type { Word } from "../transcription/types.ts";
import { DURATION_PRESETS, joinWords, spread, type ClipCandidate, type DurationPreset } from "./segment.ts";

/** Per-second measurements of the source, from FFmpeg alone (no AI, nothing leaves the machine). */
export interface MediaSignals {
  /** RMS loudness per second in dBFS; -90 is silence. */
  loudness: number[];
  /** Largest scene-change score per second, 0..1 (frames sampled at 2 fps). */
  motion: number[];
}

/** What drives the source: talking, sound/music without much talking, or picture alone. */
export type MediaKind = "speech" | "music" | "visual";

/** What Jev sees about a clip's sound and picture. */
export interface CandidateMedia {
  kind: MediaKind;
  /** One digit per second: 0 = silent, 9 = as loud as it gets. */
  loudness: string;
  /** One digit per second: 0 = still, 9 = a hard cut or very fast motion. */
  motion: string;
  cuts: number;
  /** Plain-language summary of the first 3 seconds. */
  opening: string;
}

const SILENT_DB = -60;
const CUT_SCORE = 0.3;

/** Values printed by FFmpeg's (a)metadata=print filter, bucketed per whole second (largest value wins). */
export function parseMetadataLog(log: string, key: string, empty: number): number[] {
  const out: number[] = [];
  let t = -1;
  for (const line of log.split(/\r?\n/)) {
    const pts = /pts_time:(-?[\d.]+)/.exec(line);
    if (pts) {
      t = Math.max(0, Math.floor(Number(pts[1])));
      continue;
    }
    const i = line.indexOf(`${key}=`);
    if (i < 0 || t < 0) continue;
    const raw = line.slice(i + key.length + 1).trim();
    const v = /^-?inf$/i.test(raw) ? empty : Number(raw);
    if (!Number.isFinite(v)) continue;
    while (out.length <= t) out.push(empty);
    out[t] = Math.max(out[t] as number, Math.max(empty, v));
  }
  return out;
}

/** Loudness and visual change per second, in two parallel FFmpeg passes. */
export async function analyzeSignals(ffmpeg: string, path: string): Promise<MediaSignals> {
  const run = async (args: string[]) => {
    const r = await runProcess(ffmpeg, ["-hide_banner", "-nostats", "-i", path, ...args, "-f", "null", "-"], { timeoutMs: 4 * 60 * 60_000 });
    // No audio (or no picture) stream: nothing to measure on that side.
    if (r.code !== 0 && /does not contain any stream/.test(r.stderr)) return "";
    if (r.code !== 0) throw new Error(`FFmpeg couldn't measure the sound and picture: ${r.stderr.trim().slice(-300)}`);
    return r.stderr;
  };
  const [audio, video] = await Promise.all([
    run(["-vn", "-af", "aresample=8000,asetnsamples=n=8000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level"]),
    run(["-an", "-vf", "fps=2,scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score"]),
  ]);
  return { loudness: parseMetadataLog(audio, "lavfi.astats.Overall.RMS_level", -90), motion: parseMetadataLog(video, "lavfi.scene_score", 0) };
}

/** Seconds that have at least one transcribed word in them. */
function spokenSeconds(words: Word[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (const w of words) for (let t = Math.max(0, Math.floor(w.start)); t <= Math.min(n - 1, Math.floor(w.end)); t++) out[t] = 1;
  return out;
}

/**
 * Speech: talking carries it (talks, podcasts, interviews). Music: sound plays
 * on long stretches with no words, and it's rarely quiet (songs, instrumentals,
 * sound-led scenes). Visual: little speech and little sound.
 */
export function classifyMedia(s: MediaSignals, words: Word[]): MediaKind {
  const n = Math.max(1, s.loudness.length);
  const audible = s.loudness.filter((db) => db > SILENT_DB + 20).length / n;
  if (words.length < 20) return audible >= 0.5 ? "music" : "visual";
  const spoken = spokenSeconds(words, n);
  const quiet = s.loudness.filter((db) => db < SILENT_DB + 20).length / n;
  const soundNoWords = s.loudness.filter((db, t) => db > SILENT_DB + 20 && !spoken[t]).length / n;
  return quiet < 0.05 && soundNoWords >= 0.25 ? "music" : "speech";
}

const avg = (xs: number[], a: number, b: number, empty: number) => {
  let sum = 0;
  let c = 0;
  for (let t = Math.max(0, a); t < Math.min(xs.length, b); t++, c++) sum += xs[t] as number;
  return c ? sum / c : empty;
};

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Moments that grab attention without relying on words: the sound jumps
 * (a drop, a chorus, a hit), a loud stretch, or the picture cuts and moves.
 * Each second is scored as a possible opening; the best openings at least one
 * clip length apart win. Clips end near the preset's middle, on a cut or a dip
 * when there is one, and never split a word.
 */
export function findMoments(
  videoId: string,
  s: MediaSignals,
  words: Word[],
  preset: DurationPreset,
  kind: MediaKind,
  max: number,
  duration = Math.max(s.loudness.length, s.motion.length),
): ClipCandidate[] {
  const { min, max: longest } = DURATION_PRESETS[preset];
  const target = Math.round((min + longest) / 2);
  const n = Math.floor(duration);
  const loud = s.loudness;
  const overall = avg(loud, 0, n, -90);
  const starts: { t: number; score: number }[] = [];
  for (let t = 0; t + min <= n; t++) {
    const rise = t >= 3 ? Math.max(0, avg(loud, t, t + 3, -90) - avg(loud, t - 3, t, -90)) : 0;
    const level = avg(loud, t, t + target, -90) - overall;
    const visual = avg(s.motion, t, t + 3, 0);
    const cut = (s.motion[t] ?? 0) >= CUT_SCORE ? 0.5 : 0;
    starts.push({ t, score: rise / 12 + level / 12 + visual * 3 + cut });
  }
  starts.sort((a, b) => b.score - a.score);
  const picked: number[] = [];
  for (const { t } of starts) {
    if (picked.length >= max) break;
    if (picked.every((p) => Math.abs(p - t) >= min)) picked.push(t);
  }
  const wordAt = (t: number) => words.find((w) => w.start < t && w.end > t);
  return picked.map((t) => {
    let best = Math.min(n, t + target);
    let bestScore = -Infinity;
    for (let e = t + min; e <= Math.min(n, t + longest); e++) {
      const boundary = ((s.motion[e] ?? 0) >= CUT_SCORE ? 0.5 : 0) + ((loud[e] ?? -90) < (loud[e - 1] ?? -90) - 6 ? 0.3 : 0);
      const sc = boundary - Math.abs(e - t - target) / target;
      if (sc > bestScore) [best, bestScore] = [e, sc];
    }
    const start = wordAt(t)?.start ?? t;
    const end = Math.min(duration, wordAt(best)?.end ?? best);
    const inside = words.filter((w) => w.end > start && w.start < end);
    const label = `${kind === "visual" ? "Visual" : kind === "music" ? "Music" : "Sound"} moment at ${clock(start)}`;
    return {
      id: `${videoId}-m${Math.round(start * 1000)}-${Math.round(end * 1000)}`,
      videoId,
      start,
      end,
      openingText: joinWords(inside.filter((w) => w.start < start + 4)) || label,
      transcript: joinWords(inside),
      precedingContext: joinWords(words.filter((w) => w.end <= start).slice(-40)),
      followingContext: joinWords(words.filter((w) => w.start >= end).slice(0, 40)),
      duration: end - start,
      kind: "moment" as const,
    };
  });
}

/** Spoken passages and sound/picture moments, shared by what drives the source. Kept in time order. */
export function mixCandidates(sentences: ClipCandidate[], moments: ClipCandidate[], kind: MediaKind, max: number): ClipCandidate[] {
  const share = { speech: 0.25, music: 0.5, visual: 1 }[kind];
  const m = Math.min(moments.length, Math.max(Math.round(max * share), max - sentences.length));
  const kept = [...spread(sentences, max - m), ...moments.slice(0, m)];
  return kept.sort((a, b) => a.start - b.start);
}

const digits = (xs: number[], f: (x: number) => number) => xs.map((x) => String(Math.round(Math.min(1, Math.max(0, f(x))) * 9))).join("");

/** The clip's own slice of the signals, as short strips Jev can read. */
export function attachMedia(c: ClipCandidate, s: MediaSignals, kind: MediaKind): ClipCandidate {
  const a = Math.floor(c.start);
  const b = Math.ceil(c.end);
  const loud = s.loudness.slice(a, b);
  const motion = s.motion.slice(a, b);
  const cuts = motion.filter((x) => x >= CUT_SCORE).length;
  const first = avg(s.loudness, a, a + 3, -90);
  const before = avg(s.loudness, a - 3, a, first);
  const rest = avg(s.loudness, 0, s.loudness.length, -90);
  const parts = [
    first < SILENT_DB ? "silent" : `sound ${first - before >= 6 ? `jumps ${Math.round(first - before)} dB` : first - before <= -6 ? `drops ${Math.round(before - first)} dB` : "steady"}, ${first > rest + 3 ? "louder than" : first < rest - 3 ? "quieter than" : "about as loud as"} the rest of the source`,
    `${motion.slice(0, 3).filter((x) => x >= CUT_SCORE).length} scene cuts`,
    `${avg(s.motion, a, a + 3, 0) >= 0.1 ? "lots of" : avg(s.motion, a, a + 3, 0) >= 0.03 ? "some" : "little"} visual change`,
  ];
  return {
    ...c,
    media: {
      kind,
      loudness: digits(loud, (db) => (db + 60) / 60),
      motion: digits(motion, (x) => x / 0.5),
      cuts,
      opening: `First 3 s: ${parts.join("; ")}.`,
    },
  };
}
