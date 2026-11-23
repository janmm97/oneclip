import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import { clips, jevCache, projects, renders, transcripts } from "../db/schema.ts";
import { findCandidates, type ClipCandidate } from "../discovery/segment.ts";
import type { HookEvaluator, JevCache } from "../jev/evaluator.ts";
import { selectTop, type HookEvaluation } from "../jev/rank.ts";
import { ALLOWED_EXTENSIONS, extractAudio, probe, thumbnail, verifyRender, type MediaInfo } from "../media/ffmpeg.ts";
import type { JevResponse } from "../one/client.ts";
import { compilePlan } from "../plan/compile.ts";
import { TemplatePlanner, type EditingPlanner } from "../plan/planners.ts";
import { EditPlanSchema, OUTPUT_PRESETS, type EditPlan } from "../plan/schema.ts";
import { redact } from "../proc.ts";
import type { RenderJob, VideoRenderer } from "../render/types.ts";
import type { Transcript, TranscriptionProvider } from "../transcription/types.ts";
import type { YouTubeMeta } from "../youtube.ts";
import { enqueue, updateJob, type Job } from "./jobs.ts";
import { ProjectSettingsSchema, STAGE_LABELS, type ProjectSettings, type Stage } from "./settings.ts";

export interface PipelineDeps {
  db: Db;
  cfg: Config;
  transcriber(settings: ProjectSettings): Promise<TranscriptionProvider>;
  evaluator(cache: JevCache): HookEvaluator;
  planner(settings: ProjectSettings): Promise<EditingPlanner>;
  renderers: Partial<Record<ProjectSettings["renderer"], VideoRenderer>>;
}

/** Jev answers cached in SQLite, keyed by a hash of the exact request. */
export function dbJevCache(db: Db): JevCache {
  return {
    get: async (k) => (await db.select().from(jevCache).where(eq(jevCache.key, k)).get())?.data as JevResponse | undefined,
    set: async (k, v) => {
      await db.insert(jevCache).values({ key: k, data: v }).onConflictDoNothing();
    },
  };
}

export function projectDir(cfg: Config, id: string) {
  return join(cfg.projectsDir, id);
}

// ---------- create ----------

export interface NewProject {
  sourcePath: string;
  authorized: boolean;
  youtube?: YouTubeMeta;
  title?: string;
  settings?: Partial<ProjectSettings>;
}

export async function createProject(deps: Pick<PipelineDeps, "db" | "cfg">, input: NewProject): Promise<{ projectId: string; jobId: string }> {
  if (!input.authorized) throw new Error("Confirm you own this video or are authorised to use it.");
  const p = input.sourcePath.trim().replace(/^"(.*)"$/, "$1");
  if (!isAbsolute(p)) throw new Error("Give the full path to the video file.");
  if (!ALLOWED_EXTENSIONS.includes(extname(p).toLowerCase() as (typeof ALLOWED_EXTENSIONS)[number]))
    throw new Error(`Supported files: ${ALLOWED_EXTENSIONS.join(", ")}`);
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error("That file doesn't exist.");
  const settings = ProjectSettingsSchema.parse(input.settings ?? {});
  const id = randomUUID();
  await deps.db.insert(projects).values({
    id,
    title: (input.title || input.youtube?.title || basename(p)).slice(0, 200),
    youtubeUrl: input.youtube?.url ?? null,
    youtubeMeta: input.youtube ?? null,
    sourcePath: p,
    settings,
    status: "queued",
  });
  const jobId = await enqueue(deps.db, { projectId: id, kind: "analyze" });
  return { projectId: id, jobId };
}

// ---------- analyze ----------

/** size + mtime + first 4 MB: cheap and stable enough to reuse a transcript for the same file. */
export function fileFingerprint(path: string): string {
  const st = statSync(path);
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(Math.min(4 * 1024 * 1024, st.size));
    readSync(fd, buf, 0, buf.length, 0);
    return createHash("sha256").update(`${st.size}:${st.mtimeMs}:`).update(buf).digest("hex");
  } finally {
    closeSync(fd);
  }
}

export async function runAnalyze(deps: PipelineDeps, job: Job): Promise<void> {
  const { db, cfg } = deps;
  const project = await db.select().from(projects).where(eq(projects.id, job.projectId)).get();
  if (!project) throw new Error("Project not found");
  const settings = ProjectSettingsSchema.parse(project.settings);
  const dir = projectDir(cfg, project.id);
  mkdirSync(dir, { recursive: true });
  const stage = async (s: Stage, progress: number, message?: string) => {
    await updateJob(db, job.id, { stage: s, progress, message: message ?? STAGE_LABELS[s] });
  };
  await db.update(projects).set({ status: "running", error: null, updatedAt: Date.now() }).where(eq(projects.id, project.id));

  await stage("probe", 0.02);
  const info = await probe(cfg.ffprobe, project.sourcePath);
  if (!info.hasAudio) throw new Error("This video has no audio track, so there's nothing to transcribe.");
  await db.update(projects).set({ sourceInfo: info }).where(eq(projects.id, project.id));

  const provider = await deps.transcriber(settings);
  const key = `${fileFingerprint(project.sourcePath)}:${provider.name}:${settings.model}:${settings.language ?? "auto"}`;
  let transcript = (await db.select().from(transcripts).where(eq(transcripts.cacheKey, key)).get())?.data as Transcript | undefined;
  if (transcript) {
    await stage("transcribe", 0.5, "Using cached transcript");
  } else {
    await stage("audio", 0.05);
    const wav = join(dir, "audio.wav");
    await extractAudio(cfg.ffmpeg, project.sourcePath, wav);
    await stage("transcribe", 0.08, `Transcribing with ${provider.name} (${settings.model})`);
    let last = 0;
    transcript = await provider.transcribe(wav, {
      model: settings.model,
      language: settings.language,
      onProgress: (f) => {
        if (f - last >= 0.02 || f === 1) {
          last = f;
          void updateJob(db, job.id, { progress: 0.08 + f * 0.42, message: `Transcribing with ${provider.name}: ${Math.round(f * 100)}%` });
        }
      },
    });
    await db.insert(transcripts).values({ cacheKey: key, engine: transcript.engine, model: transcript.model, data: transcript }).onConflictDoNothing();
  }
  await db.update(projects).set({ transcriber: `${transcript.engine} ${transcript.model}` }).where(eq(projects.id, project.id));
  if (transcript.words.length < 20) throw new Error("Too little speech was found to make clips.");

  await stage("candidates", 0.52);
  const candidates = findCandidates(project.youtubeMeta ? (project.youtubeMeta as YouTubeMeta).videoId : project.id, transcript.words, settings.preset, {
    maxCandidates: settings.maxCandidates,
  });
  if (!candidates.length) throw new Error("No complete thoughts of the chosen length were found. Try another duration preset.");

  await stage("jev", 0.55, `Ranking ${candidates.length} candidates with Jev`);
  const evaluator = deps.evaluator(dbJevCache(db));
  const evaluations = await evaluator.evaluate(candidates, (done, total) => {
    void updateJob(db, job.id, { progress: 0.55 + (done / total) * 0.3, message: `Ranking hooks with Jev: ${done}/${total}` });
  });
  const byId = new Map(evaluations.map((e) => [e.candidateId, e]));
  const ranked = selectTop(
    candidates.map((c) => ({ candidate: c, evaluation: byId.get(c.id) as HookEvaluation })).filter((x) => x.evaluation),
    settings.topN,
  );

  await stage("plan", 0.86);
  const planner = await deps.planner(settings);
  await db.delete(clips).where(eq(clips.projectId, project.id));
  for (const [i, r] of ranked.entries()) {
    await updateJob(db, job.id, { progress: 0.86 + (i / ranked.length) * 0.13, message: `Planning clip ${i + 1}/${ranked.length} with ${planner.name}` });
    const { plan, planError } = await planClip(planner, r.candidate, transcript, r.evaluation, settings);
    await db.insert(clips).values({
      id: `${project.id}:${r.candidate.id}`,
      projectId: project.id,
      rank: r.rank,
      candidate: r.candidate,
      evaluation: r.evaluation,
      plan,
      planner: plan.planner,
      planError,
    });
  }
  await db.update(projects).set({ status: "ready", updatedAt: Date.now() }).where(eq(projects.id, project.id));
  await updateJob(db, job.id, { status: "done", progress: 1, stage: "plan", message: `${ranked.length} clips ready` });
}

/** Agent plan when it works; the labelled template plan when it doesn't. Never fails the project. */
export async function planClip(
  planner: EditingPlanner,
  candidate: ClipCandidate,
  transcript: Transcript,
  evaluation: HookEvaluation,
  settings: ProjectSettings,
): Promise<{ plan: EditPlan; planError: string | null }> {
  const style = {
    template: settings.template === "auto" ? undefined : settings.template,
    captionPreset: settings.captionPreset === "auto" ? undefined : settings.captionPreset,
  };
  const input = { candidate, words: transcript.words, evaluation, style };
  try {
    const draft = await planner.plan(input);
    if (style.template) draft.template = style.template;
    if (style.captionPreset) draft.captionPreset = style.captionPreset;
    return { plan: compilePlan(candidate, transcript.words, draft, planner.name), planError: null };
  } catch (e) {
    const fallback = new TemplatePlanner();
    const draft = await fallback.plan(input);
    const why = planner instanceof TemplatePlanner ? null : redact((e as Error).message).slice(0, 400);
    return { plan: compilePlan(candidate, transcript.words, draft, fallback.name), planError: why };
  }
}

// ---------- render ----------

export async function runRender(deps: PipelineDeps, job: Job): Promise<void> {
  const { db, cfg } = deps;
  const project = await db.select().from(projects).where(eq(projects.id, job.projectId)).get();
  const clip = job.clipId ? await db.select().from(clips).where(eq(clips.id, job.clipId)).get() : undefined;
  if (!project || !clip?.plan) throw new Error("Clip or plan not found");
  const settings = ProjectSettingsSchema.parse(project.settings);
  const quality = job.quality === "preview" ? "preview" : "final";
  const plan = EditPlanSchema.parse({ ...(clip.plan as EditPlan), output: OUTPUT_PRESETS[quality] });
  const dir = join(projectDir(cfg, project.id), "renders");
  const slug = `${String(clip.rank).padStart(2, "0")}-${quality}`;
  const workDir = join(projectDir(cfg, project.id), "work", slug);
  mkdirSync(workDir, { recursive: true });
  const outPath = join(dir, `clip-${slug}.mp4`);
  const thumbPath = join(dir, `clip-${slug}.jpg`);
  mkdirSync(dir, { recursive: true });

  // Chosen renderer first; FFmpeg-only as the fallback if it fails or isn't installed.
  const order = [...new Set([settings.renderer, "ffmpeg" as const])].map((k) => deps.renderers[k]).filter((r): r is VideoRenderer => Boolean(r));
  const problems: string[] = [];
  for (const renderer of order) {
    const started = Date.now();
    await updateJob(db, job.id, { stage: "render", progress: 0, message: `Rendering ${quality} with ${renderer.name}` });
    const rj: RenderJob = {
      sourcePath: project.sourcePath,
      source: project.sourceInfo as MediaInfo,
      plan,
      outPath,
      workDir,
      quality,
      onProgress: (f) => void updateJob(db, job.id, { progress: Math.min(0.97, f), message: `Rendering ${quality} with ${renderer.name}: ${Math.round(f * 100)}%` }),
    };
    try {
      await renderer.render(rj);
      const v = await verifyRender(cfg.ffprobe, outPath, { width: plan.output.width, height: plan.output.height, duration: plan.outputDuration });
      if (!v.ok) throw new Error(`Output check failed: ${v.problems.join("; ")}`);
      await thumbnail(cfg.ffmpeg, outPath, Math.min(1, plan.outputDuration / 2), thumbPath);
      await db.insert(renders).values({
        id: randomUUID(),
        projectId: project.id,
        clipId: clip.id,
        quality,
        renderer: renderer.name,
        path: outPath,
        thumbPath,
        status: "done",
        verify: v.info,
        ms: Date.now() - started,
      });
      await updateJob(db, job.id, { status: "done", progress: 1, message: `Rendered with ${renderer.name}${problems.length ? ` (after: ${problems.join("; ")})` : ""}` });
      return;
    } catch (e) {
      problems.push(`${renderer.name}: ${redact((e as Error).message).slice(0, 300)}`);
    }
  }
  await db.insert(renders).values({
    id: randomUUID(),
    projectId: project.id,
    clipId: clip.id,
    quality,
    renderer: order.map((r) => r.name).join("→") || "none",
    path: outPath,
    status: "failed",
    error: problems.join(" | ") || "No renderer available",
  });
  throw new Error(problems.join(" | ") || "No renderer available");
}

/** Queue renders for every clip in a project (or one clip). Analysis is never re-run. */
export async function queueRenders(db: Db, projectId: string, quality: "final" | "preview", clipId?: string): Promise<string[]> {
  const rows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(clipId ? and(eq(clips.projectId, projectId), eq(clips.id, clipId)) : eq(clips.projectId, projectId))
    .orderBy(asc(clips.rank));
  const ids: string[] = [];
  for (const r of rows) ids.push(await enqueue(db, { projectId, kind: "render", clipId: r.id, quality }));
  return ids;
}

export async function runJob(deps: PipelineDeps, job: Job): Promise<void> {
  try {
    if (job.kind === "analyze") await runAnalyze(deps, job);
    else await runRender(deps, job);
  } catch (e) {
    const msg = redact((e as Error).message ?? String(e)).slice(0, 1000);
    const hint = (e as { hint?: string }).hint;
    await updateJob(deps.db, job.id, { status: "failed", error: hint ? `${msg}\n${hint}` : msg, message: "Failed" });
    if (job.kind === "analyze") await deps.db.update(projects).set({ status: "failed", error: msg, updatedAt: Date.now() }).where(eq(projects.id, job.projectId));
  }
}
