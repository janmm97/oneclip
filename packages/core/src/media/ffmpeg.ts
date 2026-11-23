import { runProcess } from "../proc.ts";

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec?: string;
  videoDuration?: number;
  audioDuration?: number;
}

export const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm"] as const;

function fpsOf(rate: string | undefined): number {
  const [n, d] = (rate ?? "0/1").split("/").map(Number);
  return n && d ? n / d : 0;
}

interface ProbeJson {
  format?: { duration?: string };
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string; side_data_list?: { rotation?: number }[] }[];
}

export function parseProbe(j: ProbeJson): MediaInfo {
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  if (!v) throw new Error("No video stream found");
  const rot = Math.abs(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
  const swap = rot === 90 || rot === 270;
  return {
    duration: Number(j.format?.duration ?? v.duration ?? 0),
    width: (swap ? v.height : v.width) ?? 0,
    height: (swap ? v.width : v.height) ?? 0,
    fps: fpsOf(v.avg_frame_rate) || fpsOf(v.r_frame_rate),
    hasAudio: Boolean(a),
    videoCodec: v.codec_name ?? "unknown",
    audioCodec: a?.codec_name,
    videoDuration: v.duration ? Number(v.duration) : undefined,
    audioDuration: a?.duration ? Number(a.duration) : undefined,
  };
}

export async function probe(ffprobe: string, path: string): Promise<MediaInfo> {
  const r = await runProcess(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`FFprobe could not read the file: ${r.stderr.trim().slice(-300)}`);
  return parseProbe(JSON.parse(r.stdout) as ProbeJson);
}

/** 16 kHz mono 16-bit WAV, what both transcription engines read. */
export async function extractAudio(ffmpeg: string, input: string, out: string): Promise<void> {
  const r = await runProcess(ffmpeg, ["-y", "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out], { timeoutMs: 60 * 60_000 });
  if (r.code !== 0) throw new Error(`Audio extraction failed: ${r.stderr.trim().slice(-300)}`);
}

export async function thumbnail(ffmpeg: string, input: string, at: number, out: string, width = 540): Promise<void> {
  const r = await runProcess(ffmpeg, ["-y", "-v", "error", "-ss", at.toFixed(3), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3", out], {
    timeoutMs: 60_000,
  });
  if (r.code !== 0) throw new Error(`Thumbnail failed: ${r.stderr.trim().slice(-300)}`);
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  info?: MediaInfo;
}

/** Output checks: file readable, right size, duration as planned, audio and video in sync. */
export async function verifyRender(ffprobe: string, path: string, expect: { width: number; height: number; duration: number }): Promise<VerifyResult> {
  let info: MediaInfo;
  try {
    info = await probe(ffprobe, path);
  } catch (e) {
    return { ok: false, problems: [(e as Error).message] };
  }
  const problems: string[] = [];
  if (info.width !== expect.width || info.height !== expect.height) problems.push(`size ${info.width}×${info.height}, expected ${expect.width}×${expect.height}`);
  if (Math.abs(info.duration - expect.duration) > Math.max(0.5, expect.duration * 0.03))
    problems.push(`duration ${info.duration.toFixed(2)}s, expected ${expect.duration.toFixed(2)}s`);
  if (!info.hasAudio) problems.push("no audio stream");
  if (info.videoDuration !== undefined && info.audioDuration !== undefined && Math.abs(info.videoDuration - info.audioDuration) > 0.2)
    problems.push(`audio/video drift ${Math.abs(info.videoDuration - info.audioDuration).toFixed(2)}s`);
  if (info.videoCodec !== "h264") problems.push(`video codec ${info.videoCodec}, expected h264`);
  return { ok: problems.length === 0, problems, info };
}
