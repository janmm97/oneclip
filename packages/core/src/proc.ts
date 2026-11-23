import { spawn } from "node:child_process";

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
  opts: { timeoutMs: number; input?: string; env?: NodeJS.ProcessEnv; cwd?: string; onStderr?: (chunk: string) => void },
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { shell: false, windowsHide: true, env: opts.env ?? process.env, cwd: opts.cwd });
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
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
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
