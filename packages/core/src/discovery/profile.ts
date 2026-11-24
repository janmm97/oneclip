import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Word } from "../transcription/types.ts";
import { CONTENT_TYPE_KEYS, CONTENT_TYPES, type ContentType } from "./content-types.ts";
import type { ClipCandidate } from "./segment.ts";
import type { MediaKind, MediaSignals } from "./signals.ts";

export * from "./content-types.ts";

const MUSIC: ContentType[] = ["music_video", "song"];

/** What the page says about the source (yt-dlp's info.json for links, the file name for local files). */
export interface SourceMeta {
  title: string;
  uploader: string;
  site: string;
  categories: string[];
  tags: string[];
  description: string;
  wasLive: boolean;
}

export function readSourceMeta(dir: string, title: string): SourceMeta {
  const meta: SourceMeta = { title, uploader: "", site: "", categories: [], tags: [], description: "", wasLive: false };
  const p = join(dir, "source.info.json");
  if (!existsSync(p)) return meta;
  try {
    const i = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 40) : []);
    return {
      title: String(i.title ?? title),
      uploader: String(i.uploader ?? i.channel ?? ""),
      site: String(i.extractor_key ?? ""),
      categories: strs(i.categories),
      tags: strs(i.tags),
      description: String(i.description ?? "").slice(0, 1500),
      wasLive: i.was_live === true || i.live_status === "was_live",
    };
  } catch {
    return meta;
  }
}

export interface Span {
  start: number;
  end: number;
}

export interface ContentProfile {
  type: ContentType;
  /** Share of the evidence for the winning type, 0..1. 1 when the user picked it. */
  confidence: number;
  reasons: string[];
  /** Music: where the song itself plays (skits, intros and outros are outside). */
  main?: Span;
  /** Music: stretches whose lyric comes back later (the chorus or hook). */
  choruses: Span[];
}

/** Title, tags and categories that name a kind of content. Each match adds points. */
const META_RULES: [ContentType, number, RegExp][] = [
  ["music_video", 4, /official (music )?video|music video|\bm\/?v\b|\(video\)|\[video\]/],
  ["music_video", 2, /lyric video|performance video|dance practice|choreography/],
  ["song", 4, /official audio|\(audio\)|\[audio\]|visuali[sz]er|full album| - topic$/],
  ["podcast", 4, /podcast|\bep(isode)?\.? ?#?\d+|\binterview\b|\bshow #?\d+/],
  ["talk", 4, /\bted(x)?\b|keynote|lecture|sermon|masterclass|commencement|tutorial|how to |explained|course|webinar/],
  ["stream", 4, /\bvod\b|livestream|live stream|stream highlights|twitch|\bkick\.com/],
  ["gameplay", 4, /gameplay|walkthrough|let'?s play|playthrough|speedrun|boss fight|minecraft|fortnite|valorant|league of legends|elden ring|call of duty|\bgta\b/],
  ["film", 4, /trailer|teaser|short film|full scene|movie clip|\bsketch\b|\bskit\b|\bsnl\b|episode \d+ clip/],
  ["vlog", 4, /\bvlog|day in (my|the) life|travel diary|room tour|week in my life/],
  ["sports", 4, /highlights|\bvs\.? |knockout|\bgoals?\b|\bnba\b|\bnfl\b|\bufc\b|premier league|world cup/],
];

const CATEGORY_RULES: Record<string, [ContentType, number][]> = {
  music: [
    ["music_video", 2],
    ["song", 2],
  ],
  gaming: [
    ["gameplay", 3],
    ["stream", 1],
  ],
  education: [["talk", 2]],
  "science & technology": [["talk", 1]],
  "nonprofits & activism": [["talk", 1]],
  "film & animation": [["film", 3]],
  comedy: [["film", 2]],
  entertainment: [["film", 1]],
  "people & blogs": [
    ["vlog", 2],
    ["podcast", 1],
  ],
  "travel & events": [["vlog", 2]],
  sports: [["sports", 3]],
  "news & politics": [["talk", 1]],
};

const pct = (xs: number[], q: number) => {
  if (!xs.length) return -90;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
};

/**
 * Where a song plays: seconds that are loud for this source and dense (a
 * mixed track barely moves within a second; speech and ambience do), smoothed
 * so a breakdown or a quiet bar doesn't split it. The span runs from the first
 * long run of song to the last; anything before or after is intro or outro.
 */
export function findSongSpan(s: MediaSignals, minRun = 15): Span | undefined {
  const n = s.loudness.length;
  if (!s.variation || n < minRun) return undefined;
  const ref = pct(s.loudness, 0.8);
  const raw = s.loudness.map((db, t) => db >= ref - 8 && db > -40 && (s.variation?.[t] ?? 9) <= 2.5);
  const on = raw.map((_, t) => {
    let c = 0;
    let k = 0;
    for (let u = Math.max(0, t - 4); u <= Math.min(n - 1, t + 4); u++, k++) if (raw[u]) c++;
    return c / k >= 0.6;
  });
  const runs: Span[] = [];
  for (let t = 0; t < n; t++) {
    if (!on[t]) continue;
    let e = t;
    while (e + 1 < n && on[e + 1]) e++;
    if (e + 1 - t >= minRun) runs.push({ start: t, end: e + 1 });
    t = e;
  }
  if (!runs.length) return undefined;
  return { start: (runs[0] as Span).start, end: (runs[runs.length - 1] as Span).end };
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Lines that come back: every 4-word phrase heard again at least `gap` seconds
 * later marks both places. Runs of marked time are the chorus or hook. Phrases
 * of one or two different words ("oh oh oh oh") and Whisper's own loops (the
 * same line over and over within seconds) don't count.
 */
export function findChoruses(words: Word[], gap = 20, ngram = 4): Span[] {
  const toks = words.map((w) => ({ t: norm(w.word), start: w.start, end: w.end })).filter((w) => w.t);
  const seen = new Map<string, number[]>();
  for (let i = 0; i + ngram <= toks.length; i++) {
    const g = toks.slice(i, i + ngram);
    if (new Set(g.map((x) => x.t)).size < 3) continue;
    const key = g.map((x) => x.t).join(" ");
    seen.set(key, [...(seen.get(key) ?? []), i]);
  }
  const marked: Span[] = [];
  for (const idx of seen.values()) {
    const times = idx.map((i) => (toks[i] as { start: number }).start);
    const far = idx.filter((_, a) => times.some((tb) => Math.abs(tb - (times[a] as number)) >= gap));
    for (const i of far) marked.push({ start: (toks[i] as { start: number }).start, end: (toks[i + ngram - 1] as { end: number }).end });
  }
  marked.sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const m of marked) {
    const last = out[out.length - 1];
    if (last && m.start - last.end <= 4) last.end = Math.max(last.end, m.end);
    else out.push({ ...m });
  }
  return out.filter((c) => c.end - c.start >= 5);
}

/**
 * Picks the content type from what the page says (title, tags, category,
 * live or not) and what the file shows (talking vs. a dense song, how often
 * the picture cuts, how much it moves, how long it is). Each clue adds points;
 * the most points win, with `reasons` saying why.
 */
export function detectContentType(meta: SourceMeta, s: MediaSignals, words: Word[], kind: MediaKind): { type: ContentType; confidence: number; reasons: string[] } {
  const score = Object.fromEntries(CONTENT_TYPE_KEYS.map((k) => [k, 0])) as Record<ContentType, number>;
  const reasons: Partial<Record<ContentType, string[]>> = {};
  const add = (t: ContentType, pts: number, why: string) => {
    score[t] += pts;
    (reasons[t] ??= []).push(why);
  };
  const text = `${meta.title} ${meta.tags.join(" ")} ${meta.uploader}`.toLowerCase();
  for (const [t, pts, re] of META_RULES) {
    const m = re.exec(text);
    if (m) add(t, pts, `"${m[0].trim()}" in the title or tags`);
  }
  for (const c of meta.categories) for (const [t, pts] of CATEGORY_RULES[c.toLowerCase()] ?? []) add(t, pts, `${c} category`);
  if (/ (ft\.?|feat\.?|featuring) /i.test(meta.title) || /^[^-–]+ [-–] [^-–]+$/.test(meta.title.trim())) {
    if (meta.categories.some((c) => /music/i.test(c)) || kind === "music") add("music_video", 1, "'Artist - Song' title");
  }
  if (meta.wasLive) add("stream", 4, "was a live stream");
  if (/twitch|kick/i.test(meta.site)) add("stream", 4, `${meta.site} link`);
  if (/soundcloud|bandcamp|audiomack/i.test(meta.site)) add("song", 3, `${meta.site} link`);
  if (/podcast|spotify|apple/i.test(meta.site)) add("podcast", 3, `${meta.site} link`);

  const n = Math.max(1, s.loudness.length);
  const minutes = n / 60;
  const cutsPerMin = s.motion.filter((x) => x >= 0.3).length / minutes;
  const motion = s.motion.reduce((a, b) => a + b, 0) / Math.max(1, s.motion.length);
  const still = motion < 0.01 && cutsPerMin < 1;
  const song = findSongSpan(s);
  const songShare = song ? (song.end - song.start) / n : 0;
  if (kind === "music" || songShare >= 0.5) {
    if (still) add("song", 3, "a song over a still picture");
    else add("music_video", 3, "a song with moving pictures");
  }
  if (song && songShare >= 0.4 && song.start >= 15 && words.some((w) => w.end <= song.start)) add("music_video", 1, `talking before the song starts at ${clock(song.start)}`);
  if (kind === "speech") {
    if (still) {
      add("podcast", 2, "talking over a still picture");
      add("talk", 1, "talking over a still picture");
    } else if (cutsPerMin < 3 && motion < 0.05) {
      add(minutes >= 20 ? "podcast" : "talk", 2, "talking with few cuts");
      add("vlog", 0.5, "talking on camera");
    } else if (cutsPerMin >= 8) {
      add("film", 1, "talking with fast cuts");
      add("vlog", 1, "talking with fast cuts");
    }
    if (minutes >= 40) add("podcast", 1, "long conversation");
    if (minutes >= 90) add("stream", 1, "very long");
  }
  if (motion >= 0.06 && cutsPerMin < 4) {
    add("gameplay", 1.5, "constant motion with few cuts");
    add("stream", 0.5, "constant motion with few cuts");
  }
  if (kind === "visual") add("footage", 3, "little talking or music");

  const ranked = CONTENT_TYPE_KEYS.map((k) => [k, score[k]] as const).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked as [readonly [ContentType, number], readonly [ContentType, number]];
  if (top[1] < 2) {
    const type: ContentType = kind === "music" ? (still ? "song" : "music_video") : kind === "visual" ? "footage" : minutes >= 20 ? "podcast" : "talk";
    return { type, confidence: 0.4, reasons: [`no strong clues; ${kind}-led source`] };
  }
  return { type: top[0], confidence: Math.round((top[1] / (top[1] + Math.max(0, second[1]))) * 100) / 100, reasons: reasons[top[0]] ?? [] };
}

export function buildProfile(meta: SourceMeta, s: MediaSignals, words: Word[], kind: MediaKind, chosen: ContentType | "auto" = "auto"): ContentProfile {
  const d = chosen === "auto" ? detectContentType(meta, s, words, kind) : { type: chosen, confidence: 1, reasons: ["chosen in settings"] };
  if (!MUSIC.includes(d.type)) return { ...d, choruses: [] };
  const main = findSongSpan(s);
  const choruses = findChoruses(words).filter((c) => !main || (c.end > main.start && c.start < main.end));
  return { ...d, main, choruses };
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** One line for the UI and CLI: "Music video · song 1:07–4:51 · chorus at 1:43, 2:41, 4:15". */
export function describeProfile(p: ContentProfile): string {
  const parts: string[] = [CONTENT_TYPES[p.type].label];
  if (p.main) parts.push(`song ${clock(p.main.start)}–${clock(p.main.end)}`);
  if (p.choruses.length) parts.push(`chorus at ${p.choruses.slice(0, 4).map((c) => clock(c.start)).join(", ")}`);
  return parts.join(" · ");
}

/** True when the clip opens before the song or is mostly outside it (a music video's skit, intro or outro). */
export function outsideMain(p: ContentProfile, c: Span): boolean {
  if (!p.main) return false;
  return c.start < p.main.start - 3 || overlap(c, p.main) < (c.end - c.start) * 0.5;
}

export function hasChorus(p: ContentProfile, c: Span): boolean {
  return p.choruses.some((ch) => overlap(c, ch) >= Math.min(5, ch.end - ch.start));
}

/** Openings that say "skip me": greetings, sponsor reads and subscribe asks. */
const FILLER = /\b(welcome back|welcome to (the|my|our)|hey (guys|everyone|everybody)|what'?s up (guys|everyone)|sponsored by|brought to you by|today'?s sponsor|use (my )?code|link in (the )?description|(like and|don'?t forget to) subscribe|hit (the|that) (bell|like)|smash (the|that) like|patreon|before we (get started|begin))\b/i;

export function fillerOpening(c: ClipCandidate): string | undefined {
  return FILLER.exec(c.transcript.split(/\s+/).slice(0, 25).join(" "))?.[0];
}

/** Where the clip sits in the source, in words Jev can use. */
export function clipSection(p: ContentProfile, c: ClipCandidate): string {
  if (p.main && outsideMain(p, c)) return c.start < p.main.start ? `Opens before the song starts (${clock(p.main.start)}): an intro, skit or dialogue, not the song` : `After the song ends (${clock(p.main.end)}): an outro or skit, not the song`;
  const bits: string[] = [];
  if (p.main) bits.push("Inside the song");
  if (hasChorus(p, c)) bits.push(`contains the chorus or hook (a lyric that repeats ${p.choruses.length > 1 ? `${p.choruses.length} times` : "later"})`);
  else if (p.choruses.length) bits.push("a verse or bridge, not the chorus");
  const f = fillerOpening(c);
  if (f) bits.push(`opens with filler ("${f}")`);
  return bits.join("; ");
}

export function withContent(c: ClipCandidate, p: ContentProfile): ClipCandidate {
  return { ...c, content: { type: p.type, label: CONTENT_TYPES[p.type].label, guide: CONTENT_TYPES[p.type].guide, section: clipSection(p, c) } };
}

/**
 * Score changes that follow from the content type: a music video's skit or
 * outro isn't the song (×0.55), a clip with the chorus gets a small lift
 * (×1.1, capped at 1) and a clip that opens with a greeting or sponsor read
 * drops (×0.75). Each change is listed so the results screen can show it.
 */
export function contentAdjust(p: ContentProfile, c: ClipCandidate, final: number): { final: number; penalties: string[] } {
  const penalties: string[] = [];
  let f = final;
  if (outsideMain(p, c)) {
    f *= 0.55;
    penalties.push(`outside the song in a ${CONTENT_TYPES[p.type].label.toLowerCase()} (intro, skit or outro): ×0.55`);
  } else if (hasChorus(p, c)) {
    f = Math.min(1, f * 1.1);
    penalties.push("contains the chorus: ×1.1");
  }
  const filler = fillerOpening(c);
  if (filler) {
    f *= 0.75;
    penalties.push(`opens with filler ("${filler}"): ×0.75`);
  }
  return { final: f, penalties };
}
