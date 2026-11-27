import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DRAFT_JSON_SCHEMA, editPlanners, resolveCommand, shimTarget } from "@oneclip/core";

const dir = mkdtempSync(join(tmpdir(), "oneclip-agents-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The npm shim Windows installs for `npm i -g @openai/codex` (trimmed).
const NPM_SHIM = `@ECHO off\r\nSETLOCAL\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`;

describe("shimTarget", () => {
  it("finds the script an npm .cmd shim runs", () => {
    expect(shimTarget(join(dir, "codex.cmd"), NPM_SHIM)).toBe(join(dir, "node_modules", "@openai", "codex", "bin", "codex.js"));
  });
  it("finds a native .exe an npm shim runs (newer Claude Code), not the local-node check before it", () => {
    const shim = `IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`;
    expect(shimTarget(join(dir, "claude.cmd"), shim)).toBe(join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
  });
  it("returns nothing for a shim with no target", () => {
    expect(shimTarget(join(dir, "x.cmd"), "@echo off")).toBeUndefined();
  });
});

describe.runIf(process.platform === "win32")("resolveCommand on Windows", () => {
  const env = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD", USERPROFILE: dir, APPDATA: dir, LOCALAPPDATA: dir };
  writeFileSync(join(dir, "codex.cmd"), NPM_SHIM);
  writeFileSync(join(dir, "codex"), "#!/bin/sh\n"); // the extensionless POSIX shim npm also writes: not runnable on Windows
  writeFileSync(join(dir, "claude.exe"), "");
  const js = join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
  mkdirSync(dirname(js), { recursive: true });
  writeFileSync(js, "");

  it("runs an npm .cmd shim's script with this Node, so spawn without a shell works", () => {
    expect(resolveCommand("codex", env, "win32")).toEqual({ cmd: process.execPath, pre: [js] });
  });
  it("finds an .exe on PATH", () => {
    const r = resolveCommand("claude", env, "win32");
    expect(r?.cmd.toLowerCase()).toBe(join(dir, "claude.exe").toLowerCase());
    expect(r?.pre).toEqual([]);
  });
  it("returns null when the command isn't installed", () => {
    expect(resolveCommand("opencode-missing", env, "win32")).toBeNull();
  });
});

describe("DRAFT_JSON_SCHEMA", () => {
  it("has no 2020-12 $schema line (Claude Code's --json-schema rejects it and every chat edit failed)", () => {
    const s = JSON.parse(DRAFT_JSON_SCHEMA) as Record<string, unknown>;
    expect(s.$schema).toBeUndefined();
    expect(s.type).toBe("object");
  });
});

describe("editPlanners", () => {
  const cfg = { claudeBin: "oneclip-no-such-claude", codexBin: "oneclip-no-such-codex", opencodeBin: "oneclip-no-such-opencode", openrouterModels: [] };
  it("asks nobody when AI is off", async () => {
    expect(await editPlanners("template", cfg)).toEqual([]);
  });
  it("skips agents that aren't installed", async () => {
    const one = { findOpenRouterConnection: async () => { throw new Error("none"); } } as never;
    expect((await editPlanners("codex", cfg, one)).map((p) => p.name)).toEqual([]);
  });
  it("asks only the picked agent, never another one", async () => {
    const one = { findOpenRouterConnection: async () => ({}) } as never; // OpenRouter would be available
    const installed = { ...cfg, claudeBin: process.execPath, codexBin: process.execPath }; // `node --version` stands in for an installed agent
    expect((await editPlanners("codex", installed, one)).map((p) => p.name)).toEqual([expect.stringMatching(/codex/i)]);
    expect((await editPlanners("auto", installed, one)).length).toBe(3);
  });
});
