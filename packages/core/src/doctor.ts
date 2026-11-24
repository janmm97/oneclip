import type { Config } from "./config.ts";
import { OneClient, OneError } from "./one/client.ts";
import { pickPlanner } from "./plan/planners.ts";
import { runProcess } from "./proc.ts";
import { resolveYtDlp } from "./media/source.ts";
import { FfmpegRenderer } from "./render/ffmpeg-renderer.ts";
import { FasterWhisperProvider, OnnxWhisperProvider } from "./transcription/providers.ts";

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** Required checks block analysis; optional ones only change which engine is used. */
  required: boolean;
  detail: string;
  fix?: string;
}

async function version(bin: string, args: string[]) {
  try {
    const r = await runProcess(bin, args, { timeoutMs: 20_000 });
    return r.code === 0 ? (r.stdout || r.stderr).split(/\r?\n/)[0]?.trim() || "ok" : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Everything OneClip needs, checked for real. `testJev` sends one tiny Jev
 * request (a few hundred tokens on the user's TypeSafe account), so it is opt-in.
 */
export async function runChecks(cfg: Config, opts: { one?: OneClient; testJev?: boolean; remotion?: { available(): Promise<{ ok: boolean; detail: string }> } } = {}): Promise<Check[]> {
  const one = opts.one ?? new OneClient({ typesafeKey: cfg.typesafeKey, openrouterKey: cfg.openrouterKey });
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add({ id: "node", label: "Node.js 22.13+", required: true, ok: nodeMajor >= 23 || (nodeMajor === 22 && Number(process.versions.node.split(".")[1]) >= 13), detail: `v${process.versions.node}`, fix: "Install Node.js 22 LTS or newer from nodejs.org" });

  const ff = await version(cfg.ffmpeg, ["-hide_banner", "-version"]);
  const fp = await version(cfg.ffprobe, ["-hide_banner", "-version"]);
  add({ id: "ffmpeg", label: "FFmpeg and FFprobe", required: true, ok: !!ff && !!fp, detail: ff ?? "not found", fix: "Install FFmpeg (winget install Gyan.FFmpeg / brew install ffmpeg / apt install ffmpeg) or set FFMPEG_BIN and FFPROBE_BIN" });
  if (ff) {
    const lib = await new FfmpegRenderer(cfg.ffmpeg).available();
    add({ id: "libass", label: "FFmpeg captions (libass)", required: false, ok: lib.ok, detail: lib.detail, fix: "Use a full FFmpeg build; without libass the FFmpeg renderer can't burn captions (Remotion still can)" });
  }

  // One CLI → sign-in → TypeSafe → Jev. Each step only runs if the one before it passed.
  let oneOk = false;
  try {
    const v = await one.checkInstallation();
    add({ id: "one-cli", label: "One CLI installed", required: true, ok: true, detail: v.version });
    const who = await one.checkAuthentication();
    add({ id: "one-auth", label: "Signed in to One", required: true, ok: true, detail: who.organization ?? who.user ?? "signed in" });
    const conn = await one.findTypeSafeConnection();
    add({ id: "typesafe", label: "TypeSafe connected", required: true, ok: true, detail: `connection ${conn.key.replace(/(::[^:]{4})[^:]+$/, "$1…")}` });
    const action = await one.discoverJevAction();
    add({ id: "jev-action", label: "Jev action found", required: true, ok: true, detail: action.title });
    oneOk = true;
  } catch (e) {
    const err = e instanceof OneError ? e : undefined;
    const step = err?.code === "NOT_INSTALLED" ? "one-cli" : err?.code === "NOT_AUTHENTICATED" ? "one-auth" : err?.code === "NO_TYPESAFE" ? "typesafe" : "jev-action";
    const labels: Record<string, string> = { "one-cli": "One CLI installed", "one-auth": "Signed in to One", typesafe: "TypeSafe connected", "jev-action": "Jev action found" };
    add({ id: step, label: labels[step] as string, required: true, ok: false, detail: (e as Error).message, fix: err?.hint });
  }

  if (oneOk && opts.testJev) {
    try {
      const r = await one.executeJevDecision({
        model: cfg.jevModel,
        state: "Setup check for OneClip. Clip opening: 'Most people think productivity is about doing more. That is wrong.'",
        questions: { ok: { type: "noul", instructions: "Does this opening state a clear claim?" } },
      });
      add({ id: "jev-call", label: "Jev test call", required: true, ok: true, detail: `${r.model}, ${r.usage?.input_tokens ?? "?"} input tokens` });
    } catch (e) {
      add({ id: "jev-call", label: "Jev test call", required: true, ok: false, detail: (e as Error).message, fix: (e as OneError).hint });
    }
  }

  const yt = await resolveYtDlp(cfg, false).then((y) => version(y.cmd, [...y.pre, "--version"])).catch(() => undefined);
  add({ id: "yt-dlp", label: "Links (yt-dlp)", required: false, ok: !!yt, detail: yt ? `yt-dlp ${yt}` : "not installed", fix: `Run: ${cfg.python} -m pip install -U "yt-dlp[default]" (needed for YouTube and other links; local files work without it)` });

  const fw = await new FasterWhisperProvider(cfg.python).available();
  const onnx = await new OnnxWhisperProvider().available();
  add({ id: "transcriber", label: "Transcription engine", required: true, ok: fw.ok || onnx.ok, detail: fw.ok ? fw.detail : onnx.ok ? `${onnx.detail} (faster-whisper: ${fw.detail.replace(/^faster-whisper unavailable: /, "").slice(0, 160)})` : fw.detail, fix: fw.ok ? undefined : "Optional: run pnpm run setup (Python 3.10–3.12) for faster-whisper (faster, GPU). The built-in ONNX engine works without it." });

  const planner = await pickPlanner("auto", cfg, one);
  add({ id: "planner", label: "Editing agent", required: false, ok: !planner.name.startsWith("template"), detail: planner.name, fix: "Optional: run `one add open-router` for AI edit plans with cheap models (or install Claude Code or OpenCode); otherwise OneClip uses its deterministic template planner" });

  if (opts.remotion) {
    const r = await opts.remotion.available();
    add({ id: "remotion", label: "Remotion renderer", required: false, ok: r.ok, detail: r.detail, fix: "Run pnpm install; FFmpeg rendering still works without it" });
  }
  return checks;
}
