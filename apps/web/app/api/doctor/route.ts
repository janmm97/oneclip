import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRoot, runChecks } from "@oneclip/core";
import { app, errorText, guard, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Remotion renders in the media worker (its own Node process), so here we only check
 * that its renderer is installed. Importing Remotion inside a Next route breaks on React's server build.
 */
const remotion = {
  available: async () =>
    existsSync(join(findRoot(), "packages", "remotion", "node_modules", "@remotion", "renderer", "package.json"))
      ? { ok: true, detail: "Installed; Chrome Headless Shell downloads on the first render (~131 MB)" }
      : { ok: false, detail: "@remotion/renderer is not installed" },
};

/** GET: every local check. POST: the same plus one tiny live Jev call (~300 tokens on the user's TypeSafe account). */
async function handle(req: Request, testJev: boolean) {
  const blocked = guard(req);
  if (blocked) return blocked;
  try {
    return json({ checks: await runChecks(app().cfg, { testJev, remotion }) });
  } catch (e) {
    return json({ error: errorText(e) }, 500);
  }
}

export const GET = (req: Request) => handle(req, false);
export const POST = (req: Request) => handle(req, true);
