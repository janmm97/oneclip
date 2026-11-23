/**
 * End-to-end run on the redistributable sample (scripts/make-sample.ts), with
 * the real stack: FFprobe, local transcription, live Jev through the One CLI,
 * the editing planner and the renderer. Fails loudly if any stage breaks.
 *
 *   pnpm e2e [--planner template|claude-code|opencode|auto] [--renderer ffmpeg|remotion] [--quality preview|final]
 *
 * Costs: about 6 Jev calls (~1,400 input tokens each) on your TypeSafe account.
 * Stop the worker (`pnpm dev`) first: this script drains the job queue itself.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { claimNext, config, createDeps, createProject, ensureDirs, openDb, probe, queueRenders, runJob, schema } from "@oneclip/core";
import { eq } from "drizzle-orm";
import { makeSample } from "./make-sample.ts";

const { values } = parseArgs({
  options: {
    planner: { type: "string", default: "template" },
    renderer: { type: "string", default: "ffmpeg" },
    quality: { type: "string", default: "preview" },
  },
});

const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const fail = (m: string): never => {
  console.error(`E2E FAILED: ${m}`);
  process.exit(1);
};

const cfg0 = config();
const sample = join(cfg0.dataDir, "samples", "oneclip-sample.mp4");
if (!existsSync(sample)) {
  log("building the sample video");
  await makeSample();
}

// Fresh database so earlier runs can't make this one pass.
const cfg = config({ ...process.env, ONECLIP_DATA_DIR: mkdtempSync(join(tmpdir(), "oneclip-e2e-")) });
ensureDirs(cfg);
const db = openDb(cfg.dbPath);
const remotion = values.renderer === "remotion" ? new (await import("@oneclip/remotion")).RemotionRenderer() : undefined;
const deps = createDeps(db, cfg, { remotion });

const { projectId } = await createProject(deps, {
  sourcePath: sample,
  authorized: true,
  title: "OneClip sample (e2e)",
  settings: { preset: "short", topN: 2, maxCandidates: 6, planner: values.planner as never, renderer: values.renderer as never },
});
log(`project ${projectId}`);

async function drain() {
  for (let job = await claimNext(db); job; job = await claimNext(db)) {
    await runJob(deps, job);
    const done = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get();
    log(`${job.kind}: ${done?.status}${done?.error ? ` — ${done.error}` : ""}`);
    if (done?.status !== "done") fail(`${job.kind} job ${done?.status}`);
  }
}

await drain();
const clips = await db.select().from(schema.clips).where(eq(schema.clips.projectId, projectId)).all();
if (clips.length === 0) fail("no clips ranked");
for (const c of clips) {
  const ev = c.evaluation as { final: number; hookType: string };
  log(`clip #${c.rank}: score ${ev.final.toFixed(3)}, ${ev.hookType}, planner ${c.planner}`);
}

await queueRenders(db, projectId, values.quality === "final" ? "final" : "preview");
await drain();
const renders = await db.select().from(schema.renders).where(eq(schema.renders.projectId, projectId)).all();
if (renders.length !== clips.length) fail(`expected ${clips.length} renders, got ${renders.length}`);
const [w, h] = values.quality === "final" ? [1080, 1920] : [540, 960];
for (const r of renders) {
  if (r.status !== "done" || !r.path) fail(`render ${r.id} ${r.status}: ${r.error}`);
  const m = await probe(cfg.ffprobe, r.path as string);
  if (m.width !== w || m.height !== h || !m.hasAudio) fail(`render ${r.path} is ${m.width}x${m.height}, audio ${m.hasAudio}`);
  log(`render ok: ${r.renderer}, ${m.width}x${m.height}, ${m.duration.toFixed(1)}s, ${r.ms}ms → ${r.path}`);
}
log("E2E PASSED");
