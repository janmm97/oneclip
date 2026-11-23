/**
 * pnpm run setup [--skip-python] [--model base]
 * 1. Checks One CLI → sign-in → TypeSafe → Jev (prints the exact command for each missing step).
 * 2. If a Python 3.10–3.12 is found, installs faster-whisper (python/requirements.txt) for it.
 * 3. Pre-downloads the transcription model so the first job doesn't wait.
 * Never stores keys: One keeps its own credentials.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { config, ensureDirs, findRoot, OneClient, OneError, OnnxWhisperProvider, pickTranscriber, runProcess, type ModelSize } from "@oneclip/core";

const { values } = parseArgs({ options: { "skip-python": { type: "boolean", default: false }, model: { type: "string", default: "base" } } });
const cfg = config();
ensureDirs(cfg);
const step = (s: string) => console.log(`\n▸ ${s}`);

step("One CLI and TypeSafe");
const one = new OneClient({ typesafeKey: cfg.typesafeKey });
let oneOk = true;
try {
  console.log(`  One CLI ${(await one.checkInstallation()).version}`);
  await one.checkAuthentication();
  console.log("  Signed in");
  await one.findTypeSafeConnection();
  console.log("  TypeSafe connected");
  console.log(`  Jev action: ${(await one.discoverJevAction()).title}`);
} catch (e) {
  oneOk = false;
  console.log(`  ✖ ${(e as Error).message}`);
  if (e instanceof OneError) console.log(`  ↳ ${e.hint}`);
}

async function pythonVersion(bin: string) {
  try {
    const r = await runProcess(bin, ["-c", "import sys;print(f'{sys.version_info[0]}.{sys.version_info[1]}')"], { timeoutMs: 15_000 });
    return r.code === 0 ? r.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

if (!values["skip-python"]) {
  step("faster-whisper (optional, faster and GPU-capable)");
  const candidates = [cfg.python, "python3.12", "python3.11", "python3.10", "python3", "python"];
  let py: string | undefined;
  for (const bin of [...new Set(candidates)]) {
    const v = await pythonVersion(bin);
    if (v && /^3\.1[0-2]$/.test(v)) {
      py = bin;
      console.log(`  Using ${bin} (Python ${v})`);
      break;
    }
  }
  if (!py) {
    console.log("  No Python 3.10–3.12 found; OneClip will use its built-in ONNX Whisper. Set ONECLIP_PYTHON to use a specific Python.");
  } else {
    const req = join(findRoot(), "python", "requirements.txt");
    const r = await runProcess(py, ["-m", "pip", "install", "--user", "-r", req], { timeoutMs: 15 * 60_000 });
    if (r.code !== 0) console.log(`  pip install failed (OneClip still works with ONNX Whisper):\n  ${r.stderr.trim().split(/\r?\n/).slice(-3).join("\n  ")}`);
    else if (py !== cfg.python) console.log(`  Installed. Add ONECLIP_PYTHON=${py} to .env so OneClip uses it.`);
    else console.log("  Installed.");
  }
}

step(`Transcription model (${values.model})`);
const t = await pickTranscriber("auto", cfg.python);
console.log(`  Engine: ${t.name}`);
if (t instanceof OnnxWhisperProvider) {
  await t.prepare(values.model as ModelSize);
  console.log("  Model ready");
} else {
  console.log("  faster-whisper downloads the model on the first transcription.");
}

console.log(oneOk ? "\nSetup done. Run pnpm doctor, then pnpm dev." : "\nFix the One step above, then run pnpm run setup again.");
process.exit(oneOk ? 0 : 1);
