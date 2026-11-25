import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** Cheap models with JSON output for edit plans, tried in order by OpenRouter. Override with ONECLIP_OPENROUTER_MODELS. */
export const DEFAULT_OPENROUTER_MODELS = ["deepseek/deepseek-v4-flash", "tencent/hy4-flash", "openai/gpt-6-luna"];

/** Cheap image-reading models on OpenRouter (listed by its models API on 2026-11-25). Override with ONECLIP_VISION_OPENROUTER_MODELS. */
export const DEFAULT_VISION_MODELS = ["qwen/qwen3.7-flash", "google/gemma-3-12b-it", "openai/gpt-5-nano"];

/** All runtime settings come from env vars (see .env.example). None of them is a secret. */
export function config(env: NodeJS.ProcessEnv = process.env) {
  const dataDir = resolve(env.ONECLIP_DATA_DIR || join(findRoot(), ".oneclip"));
  return {
    dataDir,
    dbPath: join(dataDir, "oneclip.db"),
    projectsDir: join(dataDir, "projects"),
    /** Finished 1080p clips, one sub-folder per video. Made automatically; visible, outside the hidden data folder. */
    clipsDir: resolve(findRoot(), env.ONECLIP_CLIPS_DIR || "clips"),
    python: env.ONECLIP_PYTHON || (process.platform === "win32" ? "python" : "python3"),
    jevModel: env.ONECLIP_JEV_MODEL || "jev-latest",
    jevConcurrency: clampInt(env.ONECLIP_JEV_CONCURRENCY, 3, 1, 8),
    typesafeKey: env.ONE_TYPESAFE_KEY || undefined,
    openrouterKey: env.ONE_OPENROUTER_KEY || undefined,
    openrouterModels: list(env.ONECLIP_OPENROUTER_MODELS, 3) ?? DEFAULT_OPENROUTER_MODELS,
    /** OpenAI-compatible local server with a vision model (LM Studio's default address). */
    visionUrl: env.ONECLIP_VISION_URL || "http://localhost:1234/v1",
    /** The local vision model; empty: the first vision model LM Studio has. */
    visionModel: env.ONECLIP_VISION_MODEL || undefined,
    /** Vision models tried in order on OpenRouter (only when vision is set to openrouter). */
    visionModels: list(env.ONECLIP_VISION_OPENROUTER_MODELS, 3) ?? DEFAULT_VISION_MODELS,
    claudeBin: env.CLAUDE_BIN || "claude",
    opencodeBin: env.OPENCODE_BIN || "opencode",
    ffmpeg: env.FFMPEG_BIN || "ffmpeg",
    ffprobe: env.FFPROBE_BIN || "ffprobe",
    ytdlp: env.YTDLP_BIN || "yt-dlp",
  };
}

export type Config = ReturnType<typeof config>;

export function ensureDirs(c: Config) {
  mkdirSync(c.projectsDir, { recursive: true });
  mkdirSync(c.clipsDir, { recursive: true });
}

/** A file or folder name safe on Windows, macOS and Linux: letters and digits joined by "-", at most `max` chars. */
export function safeName(s: string, max = 50): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, max).replace(/^-+|-+$/g, "");
}

/** The folder a project's finished clips go to: `<clipsDir>/<title>-<first 8 of id>`. */
export function clipFolder(c: Config, project: { id: string; title: string }): string {
  const title = safeName(project.title);
  return join(c.clipsDir, `${title ? `${title}-` : ""}${project.id.slice(0, 8)}`);
}

/** A comma-separated env list, at most `max` items; undefined when empty. */
function list(v: string | undefined, max: number) {
  const items = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, max);
  return items.length ? items : undefined;
}

function clampInt(v: string | undefined, def: number, min: number, max: number) {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/** The repo root: walk up from cwd until the pnpm workspace file. Falls back to cwd. */
export function findRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = resolve(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  return resolve(start);
}
