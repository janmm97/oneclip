import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";

/** Where CLIs land when the app was started without the user's shell PATH (desktop shortcut, service, GUI). */
function extraDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const home = env.USERPROFILE || env.HOME || homedir();
  if (platform === "win32") {
    const appData = env.APPDATA || join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [join(home, ".local", "bin"), join(appData, "npm"), join(local, "pnpm"), join(home, "scoop", "shims"), join(home, ".bun", "bin"), join(home, ".opencode", "bin")];
  }
  return [join(home, ".local", "bin"), join(home, ".npm-global", "bin"), join(home, ".bun", "bin"), join(home, ".opencode", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
}

/** The JS file an npm/pnpm `.cmd` shim runs (`"%dp0%\node_modules\…\cli.js"`), so it can be started with Node and no shell. */
export function shimTarget(shim: string, text: string): string | undefined {
  const m = /"%(?:~)?dp0%?\\?([^"%]+\.(?:c|m)?js)"/i.exec(text);
  // Shims always write `\`; split on it so the path is right on any OS.
  return m ? join(dirname(shim), ...m[1]!.split("\\")) : undefined;
}

const resolved = new Map<string, { cmd: string; pre: string[] }>(); // hits only: a CLI installed later is found without a restart

/**
 * Finds a program the way a shell would (PATH × PATHEXT, plus the usual install folders), so
 * `claude`, `codex` or `opencode` start on Windows too. Node can't spawn `.cmd`/`.bat` without a
 * shell (CVE-2024-27980), and a shell would parse transcript text, so an npm shim runs as
 * `node <its target .js>`. Returns null when the program isn't installed.
 */
export function resolveCommand(cmd: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { cmd: string; pre: string[] } | null {
  const key = `${platform}|${cmd}|${env.PATH ?? env.Path ?? ""}`;
  const hit = resolved.get(key);
  if (hit) return hit;
  const win = platform === "win32";
  const exts = win ? ["", ...(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter((e) => /^\.(com|exe|bat|cmd)$/i.test(e))] : [""];
  const hasDir = isAbsolute(cmd) || /[\\/]/.test(cmd);
  const dirs = hasDir ? [""] : [...(env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean), ...extraDirs(env, platform)];
  let found: { cmd: string; pre: string[] } | null = null;
  outer: for (const d of dirs) {
    for (const e of exts) {
      const p = d ? join(d, cmd + e) : cmd + e;
      if (win && e === "" && !/\.(com|exe|bat|cmd)$/i.test(p)) continue; // a bare file is a POSIX shell script on Windows
      if (!existsSync(p)) continue;
      if (win && /\.(cmd|bat)$/i.test(p)) {
        const js = shimTarget(p, readFileSync(p, "utf8"));
        if (!js || !existsSync(js)) continue;
        found = { cmd: process.execPath, pre: [js] };
      } else found = { cmd: p, pre: [] };
      break outer;
    }
  }
  if (found) resolved.set(key, found);
  return found;
}

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class ProcError extends Error {
  constructor(
    message: string,
    readonly kind: "spawn" | "timeout" | "exit",
    readonly result?: ProcResult,
  ) {
    super(message);
  }
}

/** Secrets never reach logs, errors or the UI. One keys, bearer tokens and long hex/base64 tokens are masked. */
export function redact(text: string): string {
  return text
    .replace(/\b(live|test)::[a-z0-9-]+::[a-z0-9-]+::[a-f0-9]{8,}\b/gi, "$1::***")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***")
    .replace(/\b(sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{10,}\b/g, "$1-***")
    .replace(/("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*")[^"]+"/gi, '$1***"');
}

/**
 * Runs a program with an argument array and no shell, so transcript text, file
 * names and agent output can never be parsed as shell syntax. Always time-boxed.
 */
export function runProcess(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; input?: string; env?: NodeJS.ProcessEnv; cwd?: string; onStderr?: (chunk: string) => void; onStdout?: (chunk: string) => void },
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    let child;
    const r = resolveCommand(cmd, opts.env ?? process.env);
    try {
      child = spawn(r?.cmd ?? cmd, [...(r?.pre ?? []), ...args], { shell: false, windowsHide: true, env: opts.env ?? process.env, cwd: opts.cwd });
    } catch (e) {
      reject(new ProcError(`Could not start ${cmd}: ${(e as Error).message}`, "spawn"));
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
      opts.onStdout?.(d);
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
      opts.onStderr?.(d);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new ProcError(`Could not start ${cmd}: ${e.message}`, "spawn"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = { code, stdout, stderr };
      if (timedOut) reject(new ProcError(`${cmd} did not finish within ${Math.round(opts.timeoutMs / 1000)}s`, "timeout", result));
      else resolve(result);
    });
    // A child that exits before reading its input raises EPIPE on stdin; without a listener that crashes the whole process.
    child.stdin.on("error", () => {});
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}
