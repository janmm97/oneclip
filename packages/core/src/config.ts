import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** All runtime settings come from env vars (see .env.example). None of them is a secret. */
export function config(env: NodeJS.ProcessEnv = process.env) {
  const dataDir = resolve(env.ONECLIP_DATA_DIR || join(findRoot(), ".oneclip"));
  return {
    dataDir,
    dbPath: join(dataDir, "oneclip.db"),
    projectsDir: join(dataDir, "projects"),
    python: env.ONECLIP_PYTHON || (process.platform === "win32" ? "python" : "python3"),
    jevModel: env.ONECLIP_JEV_MODEL || "jev-latest",
    jevConcurrency: clampInt(env.ONECLIP_JEV_CONCURRENCY, 3, 1, 8),
    typesafeKey: env.ONE_TYPESAFE_KEY || undefined,
    claudeBin: env.CLAUDE_BIN || "claude",
    opencodeBin: env.OPENCODE_BIN || "opencode",
    ffmpeg: env.FFMPEG_BIN || "ffmpeg",
    ffprobe: env.FFPROBE_BIN || "ffprobe",
  };
}

export type Config = ReturnType<typeof config>;

export function ensureDirs(c: Config) {
  mkdirSync(c.projectsDir, { recursive: true });
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
