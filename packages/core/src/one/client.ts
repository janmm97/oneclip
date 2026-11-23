import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ProcError, redact, runProcess, type ProcResult } from "../proc.ts";

/**
 * The One CLI is the only way OneClip reaches TypeSafe and OpenRouter. OneClip
 * never calls either API directly and never stores the user's credentials: the
 * CLI owns authentication, OneClip only spawns it.
 */

export type OneErrorCode =
  | "NOT_INSTALLED"
  | "NOT_AUTHENTICATED"
  | "NO_TYPESAFE"
  | "NO_OPENROUTER"
  | "TOO_LARGE"
  | "ACTION_NOT_FOUND"
  | "RATE_LIMITED"
  | "VALIDATION"
  | "UPSTREAM"
  | "TIMEOUT"
  | "BAD_RESPONSE"
  | "UNKNOWN";

const HINTS: Record<OneErrorCode, string> = {
  NOT_INSTALLED: "Install the One CLI: npm install -g @withone/cli (or set ONE_BIN to its path).",
  NOT_AUTHENTICATED: "Sign in to One: run `one init` and follow the prompts.",
  NO_TYPESAFE: "Connect TypeSafe: run `one add typesafe`, then re-run the setup check.",
  NO_OPENROUTER: "Optional, for AI edit plans: run `one add open-router`, then re-run the setup check.",
  TOO_LARGE: "This request is too long to pass to the One CLI. Use a shorter clip length preset.",
  ACTION_NOT_FOUND: "One could not find the action OneClip needs. Update the CLI (npm i -g @withone/cli) and retry.",
  RATE_LIMITED: "The service is rate-limiting requests. Lower ONECLIP_JEV_CONCURRENCY or wait a minute and retry.",
  VALIDATION: "The service rejected the request. This is a OneClip bug: please open an issue with the log.",
  UPSTREAM: "TypeSafe, OpenRouter or One had a temporary error. Retry in a moment.",
  TIMEOUT: "The One CLI did not answer in time. Check your connection and retry.",
  BAD_RESPONSE: "The One CLI returned output OneClip could not read. Update the CLI and retry.",
  UNKNOWN: "Unexpected One CLI error. Run `pnpm doctor` for details.",
};

export class OneError extends Error {
  readonly hint: string;
  constructor(
    readonly code: OneErrorCode,
    message: string,
  ) {
    super(redact(message));
    this.hint = HINTS[code];
  }
  get retryable() {
    return this.code === "RATE_LIMITED" || this.code === "UPSTREAM" || this.code === "TIMEOUT";
  }
}

export interface OneConnection {
  platform: string;
  key: string;
  state: string;
}

export interface JevAction {
  actionId: string;
  title: string;
  path: string;
}

export type OneRunner = (args: string[], opts: { timeoutMs: number }) => Promise<ProcResult>;

/** How to start the CLI. On Windows `one` is a .cmd shim that can't be spawned without a shell, so we run its cli.js with node. */
export function oneCommand(env: NodeJS.ProcessEnv = process.env): { cmd: string; prefix: string[] } {
  const bin = env.ONE_BIN;
  if (bin) return bin.endsWith(".js") ? { cmd: process.execPath, prefix: [bin] } : { cmd: bin, prefix: [] };
  if (process.platform === "win32" && env.APPDATA) {
    const js = join(env.APPDATA, "npm", "node_modules", "@withone", "cli", "bin", "cli.js");
    if (existsSync(js)) return { cmd: process.execPath, prefix: [js] };
    return { cmd: "one.cmd", prefix: [] };
  }
  return { cmd: "one", prefix: [] };
}

export function makeRunner(env: NodeJS.ProcessEnv = process.env): OneRunner {
  const { cmd, prefix } = oneCommand(env);
  return (args, opts) => runProcess(cmd, [...prefix, ...args], { timeoutMs: opts.timeoutMs });
}

const ListSchema = z.object({
  connections: z.array(z.object({ platform: z.string(), key: z.string(), state: z.string().optional() }).passthrough()),
});

const FindSchema = z.object({
  answers: z.array(
    z.object({
      platform: z.string().optional(),
      selected: z.array(z.object({ actionId: z.string(), title: z.string().optional(), path: z.string().optional() }).passthrough()).default([]),
      alternatives: z.array(z.object({ actionId: z.string(), title: z.string().optional(), path: z.string().optional() }).passthrough()).default([]),
    }),
  ),
});

export const JEV_PATH = "/v1/systemone";
export const OPENROUTER_CHAT_PATH = "/api/v1/chat/completions";

/** Windows caps a command line at 32,767 characters; stay under it with room for the CLI path. */
export const MAX_ARGV_CHARS = 30_000;

/** Map anything the CLI or spawn layer throws to a OneError with a user-facing hint. */
export function normalizeErrors(err: unknown): OneError {
  if (err instanceof OneError) return err;
  if (err instanceof ProcError) {
    if (err.kind === "spawn") return new OneError("NOT_INSTALLED", err.message);
    if (err.kind === "timeout") return new OneError("TIMEOUT", err.message);
  }
  const text = err instanceof Error ? err.message : String(err);
  return classify(text);
}

function classify(text: string): OneError {
  const t = text.toLowerCase();
  if (/\b429\b|rate.?limit|too many requests/.test(t)) return new OneError("RATE_LIMITED", text);
  if (/\b422\b|unprocessable|validation/.test(t)) return new OneError("VALIDATION", text);
  if (/\b401\b|\b403\b|not (logged|signed) in|unauthori[sz]ed|one init|no api key|invalid api key/.test(t)) return new OneError("NOT_AUTHENTICATED", text);
  if (/\b5\d\d\b|bad gateway|service unavailable|econnreset|enotfound|fetch failed|network/.test(t)) return new OneError("UPSTREAM", text);
  if (/timed? ?out|etimedout/.test(t)) return new OneError("TIMEOUT", text);
  return new OneError("UNKNOWN", text);
}

function parseJson(r: ProcResult): unknown {
  for (const s of [r.stdout, r.stderr]) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      // The CLI may print a banner before the JSON: take the last JSON object.
      const i = trimmed.indexOf("{");
      if (i >= 0) {
        try {
          return JSON.parse(trimmed.slice(i));
        } catch {
          /* fall through */
        }
      }
    }
  }
  return undefined;
}

function errorText(r: ProcResult, json: unknown): string {
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const resp = o.response as Record<string, unknown> | undefined;
    const parts = [o.error, o.message, o.status, resp?.detail, resp?.error, resp?.status].filter((x) => x !== undefined);
    if (parts.length) return parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  }
  return (r.stderr || r.stdout || `exit code ${r.code}`).slice(0, 2000);
}

export interface OneClientOptions {
  runner?: OneRunner;
  typesafeKey?: string;
  openrouterKey?: string;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class OneClient {
  private readonly run: OneRunner;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly actions = new Map<string, JevAction>();
  private readonly connections = new Map<string, OneConnection>();

  constructor(private readonly opts: OneClientOptions = {}) {
    this.run = opts.runner ?? makeRunner();
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.retries = opts.retries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async call(args: string[], timeoutMs = this.timeoutMs): Promise<{ r: ProcResult; json: unknown }> {
    let r: ProcResult;
    try {
      r = await this.run(args, { timeoutMs });
    } catch (e) {
      throw normalizeErrors(e);
    }
    const json = parseJson(r);
    if (r.code !== 0) throw classify(errorText(r, json));
    return { r, json };
  }

  async checkInstallation(): Promise<{ installed: true; version: string }> {
    const { r } = await this.call(["--version"], 30_000);
    const version = (r.stdout.match(/\d+\.\d+\.\d+/) ?? [r.stdout.trim()])[0] ?? "unknown";
    return { installed: true, version };
  }

  async checkAuthentication(): Promise<{ authenticated: true; user?: string; organization?: string }> {
    const { json } = await this.call(["--agent", "whoami"], 30_000);
    const o = json as { user?: { name?: string }; organization?: { name?: string }; error?: string } | undefined;
    if (!o || o.error || !o.user) throw new OneError("NOT_AUTHENTICATED", o?.error ?? "whoami returned no user");
    return { authenticated: true, user: o.user.name, organization: o.organization?.name };
  }

  async listConnections(): Promise<OneConnection[]> {
    const { json } = await this.call(["--agent", "list", "--limit", "1000"], 60_000);
    const parsed = ListSchema.safeParse(json);
    if (!parsed.success) throw new OneError("BAD_RESPONSE", "Unexpected `one list` output");
    return parsed.data.connections.map((c) => ({ platform: c.platform, key: c.key, state: c.state ?? "unknown" }));
  }

  /** The connection to use for a platform: the pinned key if set, else the first operational one. */
  private async findConnection(platform: string, pinned: string | undefined, code: OneErrorCode, label: string): Promise<OneConnection> {
    const cached = this.connections.get(platform);
    if (cached) return cached;
    const all = (await this.listConnections()).filter((c) => c.platform === platform);
    const wanted = pinned ? all.filter((c) => c.key === pinned) : all;
    const pick = wanted.find((c) => c.state === "operational") ?? wanted[0];
    if (!pick) throw new OneError(code, pinned ? `The pinned ${label} key does not match any ${label} connection` : `No ${label} connection in One`);
    if (pick.state !== "operational") throw new OneError(code, `${label} connection is ${pick.state}, not operational`);
    this.connections.set(platform, pick);
    return pick;
  }

  /** The TypeSafe connection: ONE_TYPESAFE_KEY if set, else the first operational one. */
  findTypeSafeConnection(): Promise<OneConnection> {
    return this.findConnection("typesafe", this.opts.typesafeKey, "NO_TYPESAFE", "TypeSafe");
  }

  /** The OpenRouter connection: ONE_OPENROUTER_KEY if set, else the first operational one. */
  findOpenRouterConnection(): Promise<OneConnection> {
    return this.findConnection("open-router", this.opts.openrouterKey, "NO_OPENROUTER", "OpenRouter");
  }

  /** Found at runtime through One's action search by its API path: OneClip never hardcodes action IDs. */
  private async discover(platform: string, intent: string, task: string, path: string, title: RegExp): Promise<JevAction> {
    const cached = this.actions.get(path);
    if (cached) return cached;
    const { json } = await this.call(["--agent", "actions", "find", platform, intent, "--task", task, "--no-knowledge"], 90_000);
    const parsed = FindSchema.safeParse(json);
    if (!parsed.success) throw new OneError("BAD_RESPONSE", "Unexpected `one actions find` output");
    const candidates = parsed.data.answers.flatMap((a) => [...a.selected, ...a.alternatives]);
    const hit = candidates.find((c) => c.path === path) ?? candidates.find((c) => title.test(c.title ?? ""));
    if (!hit) throw new OneError("ACTION_NOT_FOUND", `No ${platform} action for ${path}`);
    const action = { actionId: hit.actionId, title: hit.title ?? "", path: hit.path ?? path };
    this.actions.set(path, action);
    return action;
  }

  discoverJevAction(): Promise<JevAction> {
    return this.discover("typesafe", "answer questions using System One", "score video clip hooks", JEV_PATH, /system ?one/i);
  }

  discoverOpenRouterChatAction(): Promise<JevAction> {
    return this.discover("open-router", "create chat completion", "plan a video edit as JSON", OPENROUTER_CHAT_PATH, /^create a chat completion$/i);
  }

  /** `one actions execute` with backoff on rate limits, 5xx and timeouts. `parse` runs inside the retry loop. */
  private async execute<T>(platform: string, actionId: string, key: string, body: unknown, parse: (json: unknown) => T): Promise<T> {
    const data = JSON.stringify(body);
    if (data.length > MAX_ARGV_CHARS) throw new OneError("TOO_LARGE", `Request body is ${data.length} characters; the limit is ${MAX_ARGV_CHARS}`);
    const args = ["--agent", "actions", "execute", platform, actionId, key, "-d", data, "--confirm-write"];
    let last: OneError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const { json } = await this.call(args);
        return parse(json);
      } catch (e) {
        last = normalizeErrors(e);
        if (!last.retryable || attempt === this.retries) throw last;
        await this.sleep(Math.min(30_000, 1000 * 2 ** attempt + Math.floor(Math.random() * 400)));
      }
    }
    throw last ?? new OneError("UNKNOWN", "unreachable");
  }

  /** One Jev request through the user's TypeSafe connection. */
  async executeJevDecision(body: JevRequest): Promise<JevResponse> {
    const [action, conn] = await Promise.all([this.discoverJevAction(), this.findTypeSafeConnection()]);
    return this.execute("typesafe", action.actionId, conn.key, body, parseJevResponse);
  }

  /** One chat completion through the user's OpenRouter connection. OneClip never sends tools. */
  async openRouterChat(body: OpenRouterChatRequest): Promise<OpenRouterChatResult> {
    const [action, conn] = await Promise.all([this.discoverOpenRouterChatAction(), this.findOpenRouterConnection()]);
    return this.execute("open-router", action.actionId, conn.key, body, parseOpenRouterResponse);
  }
}

// ---- OpenRouter wire format (verified through One on 2026-11-24) ----

export interface OpenRouterChatRequest {
  models: string[];
  messages: { role: "system" | "user"; content: string }[];
  response_format?: { type: "json_object" };
  max_completion_tokens?: number;
  temperature?: number;
  provider?: { require_parameters?: boolean };
}

export interface OpenRouterChatResult {
  model: string;
  content: string;
  cost?: number;
}

const OpenRouterResponseSchema = z.object({
  model: z.string(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ cost: z.number().optional() }).partial().optional(),
});

/** One wraps the API reply as {request, response}; accept the bare reply too. OpenRouter errors come back as {error:{code,message}}. */
export function parseOpenRouterResponse(json: unknown): OpenRouterChatResult {
  const inner = json && typeof json === "object" && "response" in json ? (json as { response: unknown }).response : json;
  const err = inner && typeof inner === "object" && "error" in inner ? (inner as { error: { code?: unknown; message?: unknown } }).error : undefined;
  if (err) throw classify(`OpenRouter ${String(err.code ?? "")} ${String(err.message ?? "")}`);
  const parsed = OpenRouterResponseSchema.safeParse(inner);
  if (!parsed.success) throw new OneError("BAD_RESPONSE", `Unexpected OpenRouter response: ${parsed.error.message.slice(0, 300)}`);
  const content = parsed.data.choices[0]?.message.content;
  if (!content) throw new OneError("BAD_RESPONSE", "OpenRouter returned an empty message");
  return { model: parsed.data.model, content, cost: parsed.data.usage?.cost };
}

// ---- Jev wire format (verified against jev-1.14.0 on 2026-11-23) ----

export type JevQuestion =
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export interface JevRequest {
  model: string;
  state: string | Record<string, unknown>;
  questions: Record<string, JevQuestion>;
}

const AnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("score"), score: z.number(), confidence: z.number().optional() }).passthrough(),
  z.object({ type: z.literal("noul"), noul: z.number() }).passthrough(),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().optional(),
    probabilities: z.record(z.string(), z.number()).optional(),
  }).passthrough(),
]);

const JevResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), AnswerSchema),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().optional(),
});

export type JevAnswer = z.infer<typeof AnswerSchema>;
export type JevResponse = z.infer<typeof JevResponseSchema>;

/** One wraps the API reply as {request, response}; accept the bare reply too. */
export function parseJevResponse(json: unknown): JevResponse {
  const inner = json && typeof json === "object" && "response" in json ? (json as { response: unknown }).response : json;
  if (inner && typeof inner === "object" && "detail" in inner) {
    throw new OneError("VALIDATION", `TypeSafe 422: ${JSON.stringify((inner as { detail: unknown }).detail).slice(0, 500)}`);
  }
  const parsed = JevResponseSchema.safeParse(inner);
  if (!parsed.success) throw new OneError("BAD_RESPONSE", `Unexpected Jev response: ${parsed.error.message.slice(0, 300)}`);
  return parsed.data;
}
