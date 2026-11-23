/**
 * pnpm doctor [--test-jev]
 * Checks every dependency for real and prints how to fix what's missing.
 * --test-jev sends one small Jev request (a few hundred TypeSafe tokens).
 */
import { parseArgs } from "node:util";
import { config, ensureDirs, runChecks } from "@oneclip/core";

const { values } = parseArgs({ options: { "test-jev": { type: "boolean", default: false }, json: { type: "boolean", default: false } } });
const cfg = config();
ensureDirs(cfg);

let remotion;
try {
  remotion = new (await import("@oneclip/remotion")).RemotionRenderer();
} catch {
  remotion = { available: async () => ({ ok: false, detail: "@oneclip/remotion not installed" }) };
}

const checks = await runChecks(cfg, { testJev: values["test-jev"], remotion });
if (values.json) {
  console.log(JSON.stringify(checks, null, 2));
} else {
  console.log("OneClip doctor\n");
  for (const c of checks) {
    const mark = c.ok ? "✔" : c.required ? "✖" : "•";
    console.log(`${mark} ${c.label.padEnd(26)} ${c.detail}`);
    if (!c.ok && c.fix) console.log(`  ↳ ${c.fix}`);
  }
  if (!values["test-jev"]) console.log("\nTip: pnpm run doctor --test-jev also sends one small live Jev request.");
}
const failed = checks.filter((c) => c.required && !c.ok);
if (!values.json) console.log(failed.length ? `\n${failed.length} required check(s) failed.` : "\nReady to clip.");
process.exit(failed.length ? 1 : 0);
