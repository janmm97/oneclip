import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appArgs, findBrowser } from "../../scripts/app.ts";

const only = (...paths: string[]) => (p: string) => paths.includes(p);

describe("pnpm app: browser lookup", () => {
  it("prefers ONECLIP_BROWSER", () => {
    expect(findBrowser("win32", { ONECLIP_BROWSER: "D:\\b.exe" }, () => true)).toBe("D:\\b.exe");
  });

  it("finds Chrome, then Edge, on Windows", () => {
    const env = { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\L" };
    const chrome = "C:\\L\\Google\\Chrome\\Application\\chrome.exe";
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    expect(findBrowser("win32", env, only(chrome, edge))).toBe(chrome);
    expect(findBrowser("win32", env, only(edge))).toBe(edge);
  });

  it("finds the macOS app bundle", () => {
    const edge = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    expect(findBrowser("darwin", {}, only(edge))).toBe(edge);
  });

  it("searches PATH on Linux and returns undefined when nothing is there", () => {
    const chromium = join("/usr/bin", "chromium");
    expect(findBrowser("linux", { PATH: ["/opt/x", "/usr/bin"].join(process.platform === "win32" ? ";" : ":") }, only(chromium))).toBe(chromium);
    expect(findBrowser("linux", { PATH: "/usr/bin" }, () => false)).toBeUndefined();
  });

  it("opens a chromeless window with its own profile", () => {
    const args = appArgs("http://127.0.0.1:3000", "/x/.oneclip/browser");
    expect(args).toContain("--app=http://127.0.0.1:3000");
    expect(args).toContain("--user-data-dir=/x/.oneclip/browser");
  });
});
