/**
 * `pnpm app`: opens OneClip in its own window, like a desktop app, using the Chrome
 * (or Edge/Chromium) already on this computer. Starts the dev server first if it isn't running.
 * The window uses its own browser profile in .oneclip/browser, so it gets its own taskbar entry
 * and never touches your normal Chrome tabs, logins or extensions.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const URL_ = process.env.ONECLIP_URL ?? "http://127.0.0.1:3000";

type Env = Record<string, string | undefined>;

/** First Chromium-family browser found: ONECLIP_BROWSER, then Chrome, Edge, Chromium. */
export function findBrowser(platform: NodeJS.Platform, env: Env, exists: (p: string) => boolean): string | undefined {
  if (env.ONECLIP_BROWSER) return env.ONECLIP_BROWSER;
  let candidates: string[];
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean) as string[];
    const apps = ["Google\\Chrome\\Application\\chrome.exe", "Microsoft\\Edge\\Application\\msedge.exe", "Chromium\\Application\\chrome.exe"];
    candidates = apps.flatMap((a) => roots.map((r) => `${r}\\${a}`));
  } else if (platform === "darwin") {
    candidates = ["Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"].map(
      (n) => `/Applications/${n}.app/Contents/MacOS/${n}`,
    );
  } else {
    const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
    const bins = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"];
    candidates = bins.flatMap((b) => dirs.map((d) => join(d, b)));
  }
  return candidates.find(exists);
}

/** Flags for a chromeless app window with its own profile. */
export function appArgs(url: string, profileDir: string): string[] {
  return [`--app=${url}`, `--user-data-dir=${profileDir}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check"];
}

async function isUp(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** Stops the server we started, children included (on Windows child.kill() only reaches the shell). */
function stopServer(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
}

/** Waits for the server to answer; gives up if the dev process dies or 3 minutes pass. */
async function waitUntilUp(url: string, child: ChildProcess) {
  let exited = false;
  child.once("exit", () => (exited = true));
  const deadline = Date.now() + 180_000;
  while (!(await isUp(url))) {
    if (exited) throw new Error("`pnpm dev` stopped before OneClip was ready. Run `pnpm dev` to see why.");
    if (Date.now() > deadline) throw new Error(`OneClip didn't answer on ${url} within 3 minutes. Run \`pnpm dev\` to see why.`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  let server: ChildProcess | undefined;
  if (!(await isUp(URL_))) {
    console.log("Starting OneClip…");
    server = process.platform === "win32" ? spawn("pnpm dev", { stdio: "inherit", shell: true }) : spawn("pnpm", ["dev"], { stdio: "inherit" });
    try {
      await waitUntilUp(URL_, server);
    } catch (e) {
      stopServer(server);
      throw e;
    }
  }

  const browser = findBrowser(process.platform, process.env, existsSync);
  if (!browser) {
    console.log(`No Chrome, Edge or Chromium found. Open ${URL_} in your browser, or set ONECLIP_BROWSER to its path.`);
  } else {
    const profile = resolve(".oneclip", "browser");
    spawn(browser, appArgs(URL_, profile), { detached: true, stdio: "ignore" }).unref();
    console.log(`OneClip is open in its own window (${URL_}).`);
  }
  if (server) console.log("Keep this terminal open while you use OneClip. Press Ctrl+C to stop it.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
