/**
 * Headless OneClip: same pipeline as the web app, from the terminal.
 *
 *   pnpm clip <file-or-link> [--preset standard] [--top 5] [--candidates 24]
 *             [--transcriber auto|faster-whisper|whisper-onnx] [--model small]
 *             [--planner auto|openrouter|claude-code|opencode|template]
 *             [--captions english|original|off]
 *             [--content auto|music_video|song|podcast|talk|stream|gameplay|film|vlog|sports|footage]
 *             [--ratio 9:16|1:1|4:5|16:9|4:3 (comma-separated for several, e.g. 9:16,16:9)]
 *             [--renderer remotion|ffmpeg] [--quality final|preview] [--no-render]
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { clipFolder, config, createDeps, createProject, ensureDirs, isRemoteSource, openDb, queueRenders, runJob, schema, type Job } from "@oneclip/core";
import { asc, eq } from "drizzle-orm";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    preset: { type: "string", default: "standard" },
    top: { type: "string", default: "5" },
    candidates: { type: "string", default: "24" },
    transcriber: { type: "string", default: "auto" },
    model: { type: "string", default: "small" },
    planner: { type: "string", default: "auto" },
    renderer: { type: "string", default: "remotion" },
    captions: { type: "string", default: "english" },
    content: { type: "string", default: "auto" },
    ratio: { type: "string", default: "9:16" },
    quality: { type: "string", default: "final" },
    "no-render": { type: "boolean", default: false },
  },
});

const file = positionals[0];
if (!file) {
  console.error("Usage: pnpm clip <video, audio or link> [options]   (see scripts/cli.ts)");
  process.exit(2);
}

const cfg = config();
ensureDirs(cfg);
const db = openDb(cfg.dbPath);
const remotion = values.renderer === "remotion" ? new (await import("@oneclip/remotion")).RemotionRenderer() : undefined;
const deps = createDeps(db, cfg, { remotion });
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function drain(projectId: string) {
  for (;;) {
    const job = (await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.projectId, projectId))
      .orderBy(asc(schema.jobs.createdAt))
      .all()).find((j) => j.status === "queued");
    if (!job) return;
    await db.update(schema.jobs).set({ status: "running", attempts: job.attempts + 1 }).where(eq(schema.jobs.id, job.id));
    let lastMsg = "";
    const timer = setInterval(async () => {
      const j = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get();
      if (j?.message && j.message !== lastMsg) {
        lastMsg = j.message;
        console.log(`[${secs()}] ${j.message}`);
      }
    }, 1000);
    await runJob(deps, { ...job, status: "running" } as Job);
    clearInterval(timer);
    const done = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get();
    console.log(`[${secs()}] ${job.kind}${job.clipId ? ` ${job.clipId.split(":")[1]}` : ""}: ${done?.status}${done?.error ? `\n  ${done.error}` : ` (${done?.message})`}`);
    if (done?.status === "failed" && job.kind === "analyze") process.exit(1);
  }
}

const { projectId } = await createProject(deps, {
  sourcePath: isRemoteSource(file) ? file : resolve(file),
  authorized: true,
  settings: {
    preset: values.preset as never,
    topN: Number(values.top),
    maxCandidates: Number(values.candidates),
    transcriber: values.transcriber as never,
    model: values.model as never,
    planner: values.planner as never,
    renderer: values.renderer as never,
    captions: values.captions as never,
    content: values.content as never,
    ratios: values.ratio.split(",").map((r) => r.trim()) as never,
  },
});
console.log(`Project ${projectId}`);
await drain(projectId);

const analysed = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
if (analysed?.transcriber) console.log(`Transcript: ${analysed.transcriber}`);
const detected = (analysed?.sourceInfo as { content?: { summary: string; reasons: string[] } } | null)?.content;
if (detected) console.log(`Content: ${detected.summary} (${detected.reasons.join("; ")})`);
const clips = await db.select().from(schema.clips).where(eq(schema.clips.projectId, projectId)).orderBy(asc(schema.clips.rank)).all();
for (const c of clips) {
  const cand = c.candidate as { start: number; end: number; openingText: string };
  const ev = c.evaluation as { final: number; hookType: string; contextIntegrity: number };
  console.log(
    `#${c.rank} ${cand.start.toFixed(1)}–${cand.end.toFixed(1)}s  score ${ev.final.toFixed(3)}  ${ev.hookType}  context ${ev.contextIntegrity.toFixed(2)}  [${c.planner}${c.planError ? `; agent failed: ${c.planError.slice(0, 120)}` : ""}]\n   "${cand.openingText}"`,
  );
}

if (!values["no-render"]) {
  await queueRenders(db, projectId, values.quality === "preview" ? "preview" : "final");
  await drain(projectId);
  const outs = await db.select().from(schema.renders).where(eq(schema.renders.projectId, projectId)).all();
  for (const r of outs) console.log(`${r.status}  ${r.renderer}  ${r.ms ?? "-"}ms  ${r.path}${r.error ? `\n  ${r.error}` : ""}`);
  if (values.quality !== "preview") {
    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    if (project) console.log(`\nYour clips are in: ${clipFolder(cfg, project)}`);
  }
}
console.log(`Total ${secs()}`);
