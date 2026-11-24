import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { resolveYtDlp } from "../media/source.ts";
import { runProcess } from "../proc.ts";
import type { Word } from "./types.ts";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function clock(s: string): number {
  const p = s.trim().replace(",", ".").split(":").map(Number);
  return p.reduce((acc, n) => acc * 60 + n, 0);
}

/** Clean caption text: no tags, entities, speaker/sound labels or music notes. */
export function cleanCaption(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m)
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[♪♫]/g, " ")
    .replace(/^\s*-\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * WebVTT → cues. YouTube's auto captions roll: each cue repeats the line
 * before it, so lines already shown by the previous cue are dropped.
 */
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  let prev: string[] = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = (lines[i] as string).split("-->");
    const start = clock(a as string);
    const end = clock((b as string).trim().split(/\s+/)[0] as string);
    const text = lines.slice(i + 1).map(cleanCaption).filter(Boolean);
    const fresh = text.filter((l) => !prev.includes(l));
    prev = text;
    if (end - start < 0.05 || !fresh.length) continue;
    cues.push({ start, end, text: fresh.join(" ") });
  }
  return cues;
}

/** Cue → words, sharing the cue's time by word length (subtitles have no word timings). */
export function cuesToWords(cues: Cue[]): Word[] {
  const words: Word[] = [];
  for (const c of cues) {
    const parts = c.text.split(/\s+/).filter(Boolean);
    const total = parts.reduce((n, w) => n + w.length + 1, 0);
    let t = c.start;
    for (const w of parts) {
      const d = ((c.end - c.start) * (w.length + 1)) / total;
      words.push({ word: w, start: Number(t.toFixed(3)), end: Number((t + d).toFixed(3)) });
      t += d;
    }
  }
  return words;
}

/** Best English track among yt-dlp's `subs.<lang>.vtt` files: plain `en`, then regional, then any. */
export function pickEnglish(files: string[]): string | undefined {
  const en = files.filter((f) => /^subs\.en([-_.][\w-]+)?\.vtt$/i.test(f));
  const rank = (f: string) => (/^subs\.en\.vtt$/i.test(f) ? 0 : /^subs\.en-(us|gb)\.vtt$/i.test(f) ? 1 : 2);
  return en.sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * English subtitles published with a link (the uploader's own first, then the
 * site's machine translation). Undefined when there are none or the site refuses.
 */
export async function fetchEnglishSubtitles(cfg: Config, url: string, dir: string): Promise<Word[] | undefined> {
  try {
    const y = await resolveYtDlp(cfg, false);
    const args = [
      ...y.pre,
      "--skip-download",
      "--no-playlist",
      "--no-color",
      "--socket-timeout",
      "30",
      "--js-runtimes",
      `node:${process.execPath}`,
      // Both flags: yt-dlp keeps the uploader's track for a language and adds auto captions only where there is none.
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "en,en-.*",
      "--sub-format",
      "vtt",
      "-o",
      join(dir, "subs.%(ext)s"),
      "--",
      url.trim(),
    ];
    await runProcess(y.cmd, args, { timeoutMs: 3 * 60_000 });
    const file = pickEnglish(readdirSync(dir));
    if (!file) return undefined;
    const words = cuesToWords(parseVtt(readFileSync(join(dir, file), "utf8")));
    return words.length ? words : undefined;
  } catch {
    return undefined;
  }
}
