import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { ProcError, runProcess } from "../proc.ts";

/** True for an http(s) link (YouTube, any video site, a podcast episode or a direct media URL). */
export function isRemoteSource(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

type YtDlp = { cmd: string; pre: string[] };
let cached: YtDlp | undefined;

async function works(t: YtDlp) {
  try {
    return (await runProcess(t.cmd, [...t.pre, "--version"], { timeoutMs: 30_000 })).code === 0;
  } catch {
    return false;
  }
}

/** yt-dlp from YTDLP_BIN or PATH, else the Python module; installs it with pip on first use if missing. */
export async function resolveYtDlp(cfg: Config, install = true): Promise<YtDlp> {
  if (cached) return cached;
  const options: YtDlp[] = [{ cmd: cfg.ytdlp, pre: [] }, { cmd: cfg.python, pre: ["-m", "yt_dlp"] }];
  for (const t of options) if (await works(t)) return (cached = t);
  if (!install) throw new Error("yt-dlp is not installed.");
  const pip = await runProcess(cfg.python, ["-m", "pip", "install", "--user", "--upgrade", "yt-dlp[default]"], { timeoutMs: 10 * 60_000 }).catch((e: Error) => ({ code: 1, stderr: e.message }));
  const mod = options[1] as YtDlp;
  if (pip.code === 0 && (await works(mod))) return (cached = mod);
  throw new Error(`yt-dlp is needed to read links and could not be installed (${pip.stderr.trim().split(/\r?\n/).pop()}). Run: ${cfg.python} -m pip install -U "yt-dlp[default]"`);
}

export interface DownloadedSource {
  path: string;
  title: string;
  uploader: string;
  url: string;
  site: string;
  id: string;
  cover?: string;
}

/**
 * Downloads the best audio+video (≤1080p is plenty for 1080-wide shorts) from
 * any site yt-dlp supports, or the audio alone when there's no video (podcasts).
 */
export async function downloadSource(cfg: Config, url: string, dir: string, onProgress?: (fraction: number) => void): Promise<DownloadedSource> {
  if (!isRemoteSource(url)) throw new Error("Only http(s) links can be downloaded.");
  const y = await resolveYtDlp(cfg);
  const args = [
    ...y.pre,
    "--no-playlist",
    "--newline",
    "--no-color",
    // --print implies --quiet, which would silence the [download] lines the progress bar reads.
    "--progress",
    // A live stream never ends; a stalled connection should fail, not hang for hours.
    "--match-filters",
    "!is_live",
    "--socket-timeout",
    "30",
    "--js-runtimes",
    `node:${process.execPath}`,
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "--write-info-json",
    "--write-thumbnail",
    "--convert-thumbnails",
    "jpg",
    "-o",
    join(dir, "source.%(ext)s"),
    "-o",
    `thumbnail:${join(dir, "cover.%(ext)s")}`,
    "--print",
    "after_move:filepath",
  ];
  if (cfg.ffmpeg !== "ffmpeg") args.push("--ffmpeg-location", cfg.ffmpeg);
  args.push("--", url.trim());
  let buf = "";
  let lastPct = -1;
  const r = await runProcess(y.cmd, args, {
    timeoutMs: 4 * 60 * 60_000,
    onStdout: (d) => {
      buf = (buf + d).slice(-400);
      const m = [...buf.matchAll(/\[download\]\s+([\d.]+)%/g)].pop();
      const pct = m ? Math.floor(Number(m[1])) : -1;
      if (pct > lastPct) {
        lastPct = pct; // one database write per percent, not per output line
        onProgress?.(pct / 100);
      }
    },
  }).catch((e: ProcError) => {
    throw new Error(e.message);
  });
  const path = findDownloaded(r.stdout, dir);
  if (r.code !== 0 || !path) throw new Error(downloadFailure(r.stdout, r.stderr));
  let info: { title?: string; uploader?: string; channel?: string; webpage_url?: string; extractor_key?: string; id?: string } = {};
  try {
    info = JSON.parse(readFileSync(join(dir, "source.info.json"), "utf8"));
  } catch {
    /* metadata is optional */
  }
  const cover = readdirSync(dir).find((f) => /^cover\.(jpg|jpeg|png|webp)$/i.test(f));
  return {
    path,
    title: String(info.title ?? "Untitled"),
    uploader: String(info.uploader ?? info.channel ?? ""),
    url: String(info.webpage_url ?? url),
    site: String(info.extractor_key ?? "web"),
    id: String(info.id ?? ""),
    cover: cover ? join(dir, cover) : undefined,
  };
}

/**
 * Why yt-dlp left no file. A live stream skipped by `--match-filters !is_live`
 * exits 0 and says so on stdout, so stderr alone would give an empty reason.
 */
export function downloadFailure(stdout: string, stderr: string): string {
  if (/does not pass filter[^\n]*is_live/.test(stdout)) return "Live streams can't be clipped until they've ended. Try the link again once the stream is over.";
  const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const why = lines(stderr).filter((l) => /ERROR/.test(l)).pop() ?? lines(stderr).pop() ?? lines(stdout).filter((l) => !/^\[download\]\s+[\d.]+%/.test(l)).pop() ?? "yt-dlp didn't save a file.";
  return `Couldn't download that link: ${why.replace(/^ERROR:\s*/, "").slice(0, 300)}`;
}

/**
 * The downloaded file: the path yt-dlp printed, or (when a non-ASCII folder name
 * was mangled by the console code page) the `source.<ext>` media file in `dir`.
 */
export function findDownloaded(stdout: string, dir: string): string | undefined {
  const printed = stdout.split(/\r?\n/).map((l) => l.trim()).reverse().find((l) => l && !l.startsWith("[") && existsSync(l));
  if (printed) return printed;
  const f = readdirSync(dir).find((n) => /^source\.[a-z0-9]+$/i.test(n) && !/\.(json|jpe?g|png|webp|part|ytdl)$/i.test(n));
  return f ? join(dir, f) : undefined;
}

/** A real video stream, not an MP3/M4A's embedded cover art. */
export async function hasVideoStream(ffprobe: string, path: string): Promise<boolean> {
  const r = await runProcess(ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", path], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`FFprobe could not read the file: ${r.stderr.trim().slice(-300)}`);
  const j = JSON.parse(r.stdout) as { streams?: { codec_type?: string; disposition?: { attached_pic?: number } }[] };
  return !!j.streams?.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
}

/**
 * Audio-only sources (podcasts, MP3s) become a 1080×1080 video: the cover art
 * (downloaded, or embedded in the file) over a blurred copy of itself, sized so
 * a 9:16 crop keeps the whole cover. Video sources are returned unchanged.
 */
export async function ensureVideo(cfg: Config, input: string, dir: string, cover?: string): Promise<string> {
  if (await hasVideoStream(cfg.ffprobe, input)) return input;
  const out = join(dir, "source-video.mp4");
  const frame = join(dir, "cover-frame.png");
  let art = cover && existsSync(cover) ? cover : undefined;
  if (!art) {
    const embedded = join(dir, "cover-embedded.png");
    const e = await runProcess(cfg.ffmpeg, ["-y", "-v", "error", "-i", input, "-an", "-frames:v", "1", embedded], { timeoutMs: 60_000 });
    if (e.code === 0 && existsSync(embedded)) art = embedded;
  }
  const still = art
    ? ["-i", art, "-filter_complex", "[0:v]split[a][b];[a]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=30:3,eq=brightness=-0.15[bg];[b]scale=560:560:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2"]
    : ["-f", "lavfi", "-i", "color=c=0x16161a:s=1080x1080"];
  const f = await runProcess(cfg.ffmpeg, ["-y", "-v", "error", ...still, "-frames:v", "1", frame], { timeoutMs: 60_000 });
  if (f.code !== 0) throw new Error(`Couldn't make the podcast background: ${f.stderr.trim().slice(-300)}`);
  const r = await runProcess(
    cfg.ffmpeg,
    ["-y", "-v", "error", "-loop", "1", "-framerate", "30", "-i", frame, "-i", input, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", out],
    { timeoutMs: 4 * 60 * 60_000 },
  );
  if (r.code !== 0) throw new Error(`Couldn't turn the audio into a video: ${r.stderr.trim().slice(-300)}`);
  return out;
}

/**
 * Silent videos (screen captures, B-roll, animations) get a silent audio track,
 * so they can be analysed and rendered like anything else. The picture is copied,
 * not re-encoded.
 */
export async function ensureAudio(cfg: Config, input: string, dir: string, hasAudio: boolean): Promise<string> {
  if (hasAudio) return input;
  const out = join(dir, "source-with-audio.mp4");
  const r = await runProcess(
    cfg.ffmpeg,
    ["-y", "-v", "error", "-i", input, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v:0", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", out],
    { timeoutMs: 4 * 60 * 60_000 },
  );
  if (r.code !== 0) throw new Error(`Couldn't add a silent audio track: ${r.stderr.trim().slice(-300)}`);
  return out;
}
