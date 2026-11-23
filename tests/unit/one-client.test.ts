// MOCK: every One CLI reply below is a hand-written fixture shaped like real
// `one --agent` output (captured 2026-11-23). No network, no One account needed.
import { describe, expect, it } from "vitest";
import { JEV_PATH, normalizeErrors, OneClient, OneError, parseJevResponse, ProcError, type OneRunner } from "@oneclip/core";

type Reply = { code?: number; stdout?: string; stderr?: string } | Error;

function mockRunner(routes: Record<string, Reply | Reply[]>) {
  const calls: string[][] = [];
  const runner: OneRunner = async (args) => {
    calls.push(args);
    const key = args.includes("execute") ? "execute" : args.includes("find") ? "find" : args.includes("list") ? "list" : (args.find((a) => !a.startsWith("--")) ?? args[0] ?? "");
    const r = routes[key];
    const next = Array.isArray(r) ? r.shift() : r;
    if (!next) throw new Error(`no mock for ${key}`);
    if (next instanceof Error) throw next;
    return { code: next.code ?? 0, stdout: next.stdout ?? "", stderr: next.stderr ?? "" };
  };
  return { runner, calls };
}

const KEY = "live::typesafe::default::0123456789abcdef";
const LIST = JSON.stringify({ connections: [{ platform: "github", key: "live::github::default::aa", state: "operational" }, { platform: "typesafe", key: KEY, state: "operational" }] });
const FIND = JSON.stringify({ answers: [{ selected: [{ actionId: "conn_mod_def::test::jev", title: "Answer Questions Using Systemone", path: JEV_PATH }], alternatives: [] }] });
const JEV_OK = JSON.stringify({ request: {}, response: { model: "jev-1.14.0", answers: { ok: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 297, output_tokens: 3 } } });
const noSleep = async () => {};

describe("OneClient (mock runner)", () => {
  it("reads the CLI version", async () => {
    const { runner } = mockRunner({ "--version": { stdout: "2.17.0\n" } });
    expect(await new OneClient({ runner }).checkInstallation()).toEqual({ installed: true, version: "2.17.0" });
  });

  it("maps a missing binary to NOT_INSTALLED", async () => {
    const { runner } = mockRunner({ "--version": new ProcError("spawn one ENOENT", "spawn") });
    await expect(new OneClient({ runner }).checkInstallation()).rejects.toMatchObject({ code: "NOT_INSTALLED" });
  });

  it("checks authentication with whoami", async () => {
    const { runner } = mockRunner({ whoami: { stdout: JSON.stringify({ user: { name: "Test" }, organization: { name: "Org" } }) } });
    expect(await new OneClient({ runner }).checkAuthentication()).toEqual({ authenticated: true, user: "Test", organization: "Org" });
  });

  it("reports NOT_AUTHENTICATED when whoami has no user", async () => {
    const { runner } = mockRunner({ whoami: { stdout: JSON.stringify({ error: "Run one init" }) } });
    await expect(new OneClient({ runner }).checkAuthentication()).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
  });

  it("finds the operational TypeSafe connection", async () => {
    const { runner } = mockRunner({ list: { stdout: LIST } });
    expect((await new OneClient({ runner }).findTypeSafeConnection()).key).toBe(KEY);
  });

  it("honours ONE_TYPESAFE_KEY and fails when it doesn't match", async () => {
    const { runner } = mockRunner({ list: { stdout: LIST } });
    await expect(new OneClient({ runner, typesafeKey: "live::typesafe::default::ffff" }).findTypeSafeConnection()).rejects.toMatchObject({ code: "NO_TYPESAFE" });
  });

  it("fails with NO_TYPESAFE when the connection is not operational", async () => {
    const list = JSON.stringify({ connections: [{ platform: "typesafe", key: KEY, state: "failed" }] });
    const { runner } = mockRunner({ list: { stdout: list } });
    await expect(new OneClient({ runner }).findTypeSafeConnection()).rejects.toMatchObject({ code: "NO_TYPESAFE" });
  });

  it("discovers the Jev action through actions find, never a hardcoded ID", async () => {
    const { runner, calls } = mockRunner({ find: { stdout: FIND } });
    const a = await new OneClient({ runner }).discoverJevAction();
    expect(a.actionId).toBe("conn_mod_def::test::jev");
    expect(calls[0]).toEqual(expect.arrayContaining(["actions", "find", "typesafe"]));
  });

  it("throws ACTION_NOT_FOUND when no System One action comes back", async () => {
    const empty = JSON.stringify({ answers: [{ selected: [{ actionId: "x", title: "List models", path: "/v1/models" }], alternatives: [] }] });
    const { runner } = mockRunner({ find: { stdout: empty } });
    await expect(new OneClient({ runner }).discoverJevAction()).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
  });

  it("executes a Jev decision with --confirm-write and parses the wrapped reply", async () => {
    const { runner, calls } = mockRunner({ list: { stdout: LIST }, find: { stdout: FIND }, execute: { stdout: JEV_OK } });
    const res = await new OneClient({ runner }).executeJevDecision({ model: "jev", state: "s", questions: { ok: { type: "noul", instructions: "ok?" } } });
    expect(res.model).toBe("jev-1.14.0");
    expect(res.answers.ok).toMatchObject({ type: "noul", noul: 0.9 });
    const exec = calls.find((c) => c.includes("execute")) as string[];
    expect(exec).toContain("--confirm-write");
    expect(exec).toContain(KEY);
  });

  it("retries rate limits and then succeeds", async () => {
    const { runner, calls } = mockRunner({
      list: { stdout: LIST },
      find: { stdout: FIND },
      execute: [{ code: 1, stderr: "429 Too Many Requests" }, { code: 1, stderr: "502 Bad Gateway" }, { stdout: JEV_OK }],
    });
    const res = await new OneClient({ runner, sleep: noSleep }).executeJevDecision({ model: "jev", state: "s", questions: {} });
    expect(res.model).toBe("jev-1.14.0");
    expect(calls.filter((c) => c.includes("execute"))).toHaveLength(3);
  });

  it("does not retry a 422 and surfaces VALIDATION", async () => {
    const r422 = JSON.stringify({ response: { detail: [{ loc: ["body", "questions"], msg: "bad" }] } });
    const { runner, calls } = mockRunner({ list: { stdout: LIST }, find: { stdout: FIND }, execute: [{ stdout: r422 }, { stdout: JEV_OK }] });
    await expect(new OneClient({ runner, sleep: noSleep }).executeJevDecision({ model: "jev", state: "s", questions: {} })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(calls.filter((c) => c.includes("execute"))).toHaveLength(1);
  });

  it("gives up after the retry budget", async () => {
    const fail = { code: 1, stderr: "503 Service Unavailable" };
    const { runner } = mockRunner({ list: { stdout: LIST }, find: { stdout: FIND }, execute: [fail, fail, fail] });
    await expect(new OneClient({ runner, retries: 2, sleep: noSleep }).executeJevDecision({ model: "jev", state: "s", questions: {} })).rejects.toMatchObject({ code: "UPSTREAM" });
  });
});

describe("normalizeErrors", () => {
  it.each([
    ["429 rate limit", "RATE_LIMITED", true],
    ["422 Unprocessable Entity", "VALIDATION", false],
    ["401 Unauthorized", "NOT_AUTHENTICATED", false],
    ["Not logged in. Run one init", "NOT_AUTHENTICATED", false],
    ["502 Bad Gateway", "UPSTREAM", true],
    ["request timed out", "TIMEOUT", true],
    ["something odd", "UNKNOWN", false],
  ])("%s → %s", (msg, code, retryable) => {
    const e = normalizeErrors(new Error(msg));
    expect(e).toBeInstanceOf(OneError);
    expect(e.code).toBe(code);
    expect(e.retryable).toBe(retryable);
  });

  it("maps a ProcError timeout to TIMEOUT", () => {
    expect(normalizeErrors(new ProcError("killed after 1000ms", "timeout")).code).toBe("TIMEOUT");
  });
});

describe("parseJevResponse", () => {
  it("accepts the bare reply too", () => {
    expect(parseJevResponse({ model: "m", answers: {} }).model).toBe("m");
  });
  it("rejects unexpected shapes as BAD_RESPONSE", () => {
    expect(() => parseJevResponse({ nope: 1 })).toThrow(expect.objectContaining({ code: "BAD_RESPONSE" }));
  });
});
