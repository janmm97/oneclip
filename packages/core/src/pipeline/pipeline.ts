import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { clipFolder, safeName, type Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import { clips, jevCache, projects, renders, transcripts } from "../db/schema.ts";
import { findCandidates, type ClipCandidate } from "../discovery/segment.ts";
import { buildProfile, clock, CONTENT_TYPES, contentAdjust, describeProfile, outsideMain, readSourceMeta, withContent } from "../discovery/profile.ts";
import { analyzeSignals, attachMedia, classifyMedia, findMoments, mixCandidates } from "../discovery/signals.ts";
import type { HookEvaluator, JevCache } from "../jev/evaluator.ts";
import { LiveHookReader } from "../jev/live.ts";
import { selectTop, type HookEvaluation } from "../jev/rank.ts";
import { ALLOWED_EXTENSIONS, extractAudio, probe, thumbnail, verifyRender, type MediaInfo } from "../media/ffmpeg.ts";
import { downloadSource, ensureAudio, ensureVideo, isRemoteSource } from "../media/source.ts";
import type { JevResponse } from "../one/client.ts";
import { compilePlan } from "../plan/compile.ts";
import { TemplatePlanner, type EditingPlanner } from "../plan/planners.ts";
import { EditPlanSchema, outputFor, RATIOS, ratioSlug, type EditPlan, type Ratio } from "../plan/schema.ts";
import { redact } from "../proc.ts";
import type { RenderJob, VideoRenderer } from "../render/types.ts";
import { fetchEnglishSubtitles } from "../transcription/subtitles.ts";
import type { Transcript, TranscriptionProvider, Word } from "../transcription/types.ts";
import type { YouTubeMeta } from "../youtube.ts";
import { faceSafeCaptions } from "../vision/faces.ts";
import { smartReframe } from "../vision/reframe.ts";
import { buildScenes, withScenes, type Scene, type SceneDescriber } from "../vision/scenes.ts";
import { enqueue, progressUpdate, updateJob, type Job } from "./jobs.ts";
import { ProjectSettingsSchema, STAGE_LABELS, type ProjectSettings, type Stage } from "./settings.ts";

export interface PipelineDeps {
  db: Db;
  cfg: Config;
  transcriber(settings: ProjectSettings): Promise<TranscriptionProvider>;
  evaluator(cache: JevCache): HookEvaluator;
  planner(settings: ProjectSettings): Promise<EditingPlanner>;
  /** The vision model that describes each shot; none: frames and contact sheets only. */
  describer?(settings: ProjectSettings): Promise<SceneDescriber | undefined>;
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
  /** A file on this computer, or a link (YouTube, any video site, a podcast episode). */
  sourcePath: string;
  authorized: boolean;
  youtube?: YouTubeMeta;
  title?: string;
  settings?: Partial<ProjectSettings>;
}

export async function createProject(deps: Pick<PipelineDeps, "db" | "cfg">, input: NewProject): Promise<{ projectId: string; jobId: string }> {
  if (!input.authorized) throw new Error("Confirm you own this video or are authorised to use it.");
  const p = input.sourcePath.trim().replace(/^"(.*)"$/, "$1");
  const settings = ProjectSettingsSchema.parse(input.settings ?? {});
  const id = randomUUID();
  if (isRemoteSource(p)) {
    await deps.db.insert(projects).values({
      id,
      title: (input.title || input.youtube?.title || new URL(p).hostname).slice(0, 200),
      youtubeUrl: input.youtube?.url ?? null,
      youtubeMeta: input.youtube ?? null,
      sourcePath: "",
      sourceUrl: p,
      settings,
      status: "queued",
    });
    return { projectId: id, jobId: await enqueue(deps.db, { projectId: id, kind: "analyze" }) };
  }
  if (!isAbsolute(p)) throw new Error("Paste a video or podcast link, or the full path to a file on this computer.");
  // Network shares (\\host\share, //host/share) would make the machine authenticate to that host: local files only.
  if (/^[\\/]{2}/.test(p)) throw new Error("Use a file on this computer, not a network share.");
  if (!ALLOWED_EXTENSIONS.includes(extname(p).toLowerCase() as (typeof ALLOWED_EXTENSIONS)[number]))
    throw new Error(`Supported files: ${ALLOWED_EXTENSIONS.join(", ")}`);
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error("That file doesn't exist.");
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

  let source = project.sourcePath;
  let cover: string | undefined;
  let title = project.title;
  if (!source && project.sourceUrl) {
    await stage("download", 0);
    const d = await downloadSource(cfg, project.sourceUrl, dir, (f) => progressUpdate(db, job.id, { progress: f * 0.02, message: `Downloading: ${Math.round(f * 100)}%` }));
    source = d.path;
    cover = d.cover;
    // Replace the placeholder (the link's host name) with the real title.
    title = project.title === new URL(project.sourceUrl).hostname ? d.title.slice(0, 200) : project.title;
    await db.update(projects).set({ sourcePath: source, title }).where(eq(projects.id, project.id));
  }
  await stage("prepare", 0.02);
  const video = await ensureVideo(cfg, source, dir, cover);
  if (video !== source) await db.update(projects).set({ sourcePath: (source = video) }).where(eq(projects.id, project.id));

  await stage("probe", 0.02);
  let info = await probe(cfg.ffprobe, source);
  // Silent videos get a silent track; there are no words to find, only moments.
  const silent = !info.hasAudio;
  if (silent) {
    await db.update(projects).set({ sourcePath: (source = await ensureAudio(cfg, source, dir, false)) }).where(eq(projects.id, project.id));
    info = await probe(cfg.ffprobe, source);
  }
  await db.update(projects).set({ sourceInfo: info }).where(eq(projects.id, project.id));

  // Sound and picture are measured while Whisper runs, so the live reader can use them.
  const signalsP = analyzeSignals(cfg.ffmpeg, source);
  signalsP.catch(() => undefined);
  const meta = readSourceMeta(dir, project.sourceUrl ? title : basename(project.sourcePath ?? source, extname(project.sourcePath ?? source)));
  const profileOf = async (words: Word[]) => {
    const signals = await signalsP;
    const heard = classifyMedia(signals, words);
    const profile = buildProfile(meta, signals, words, heard, settings.content);
    // Whisper "hears" words in instrumentals; a source known to be a song is music.
    const kind = profile.type === "music_video" || profile.type === "song" ? "music" : heard;
    return { signals, profile, kind };
  };
  // What's on screen, shot by shot, also while Whisper runs. The context comes
  // from the page only (not the words), so live and final Jev requests match.
  let scenesDone = "";
  const scenesP = signalsP
    .then(async (s) =>
      buildScenes({
        ffmpeg: cfg.ffmpeg,
        source,
        dir,
        motion: s.motion,
        duration: info.duration,
        context: `Source: "${meta.title.slice(0, 120)}"${meta.site ? ` on ${meta.site}` : ""}${meta.categories.length ? ` (${meta.categories.slice(0, 3).join(", ")})` : ""}.`,
        describer: await deps.describer?.(settings).catch(() => undefined),
        onProgress: (d, t) => (scenesDone = ` · scenes ${d}/${t}`),
      }),
    )
    .then((f) => f.scenes, () => [] as Scene[]);
  const videoId = project.youtubeMeta ? (project.youtubeMeta as YouTubeMeta).videoId : project.id;
  const max = settings.maxCandidates;
  const evaluator = deps.evaluator(dbJevCache(db));

  const provider = await deps.transcriber(settings);
  const key = `${fileFingerprint(source)}:${provider.name}:${settings.model}:${settings.language ?? "auto"}`;
  const wav = join(dir, "audio.wav");
  let reader: LiveHookReader | undefined;
  let transcript = (await db.select().from(transcripts).where(eq(transcripts.cacheKey, key)).get())?.data as Transcript | undefined;
  if (silent) {
    transcript = { engine: "none", model: "silent", language: settings.language ?? "", duration: info.duration, words: [] };
  } else if (transcript) {
    await stage("transcribe", 0.5, "Using cached transcript");
  } else {
    await stage("audio", 0.05);
    await extractAudio(cfg.ffmpeg, source, wav);
    await stage("transcribe", 0.08, `Transcribing with ${provider.name} (${settings.model})`);
    let last = 0;
    let lastHook = "";
    // Jev reads the words as they arrive and scores each settled part of the source.
    const hooksLog = join(dir, "hooks.live.jsonl");
    writeFileSync(hooksLog, "", "utf8");
    reader = new LiveHookReader({
      videoId,
      preset: settings.preset,
      duration: info.duration,
      evaluator,
      budget: async (w) => {
        const { profile } = await profileOf(w);
        return max - Math.round(max * CONTENT_TYPES[profile.type].share);
      },
      prepare: async (cs, w) => {
        const { signals, profile, kind } = await profileOf(w);
        if (kind !== "speech") return [];
        const scenes = await scenesP;
        return cs.filter((c) => !outsideMain(profile, c)).map((c) => withScenes(withContent(attachMedia(c, signals, kind), profile), scenes));
      },
      onHook: (c, e) => {
        appendFileSync(hooksLog, `${JSON.stringify({ start: c.start, end: c.end, score: e.final, hookType: e.hookType, opening: c.openingText })}\n`, "utf8");
        lastHook = ` · Jev: ${e.final.toFixed(2)} hook at ${clock(c.start)} "${c.openingText.slice(0, 50)}${c.openingText.length > 50 ? "…" : ""}"`;
      },
    });
    transcript = await provider.transcribe(wav, {
      model: settings.model,
      language: settings.language,
      onWords: (w) => reader?.push(w),
      onProgress: (f) => {
        if (f - last >= 0.02 || f === 1) {
          last = f;
          progressUpdate(db, job.id, { progress: 0.08 + f * 0.42, message: `Transcribing with ${provider.name}: ${Math.round(f * 100)}%${scenesDone}${lastHook}` });
        }
      },
    });
    await db.insert(transcripts).values({ cacheKey: key, engine: transcript.engine, model: transcript.model, data: transcript }).onConflictDoNothing();
  }
  const captions = await captionTrack(deps, settings, transcript, {
    url: project.sourceUrl,
    dir,
    provider,
    key,
    wav: async () => {
      if (!existsSync(wav)) await extractAudio(cfg.ffmpeg, source, wav);
      return wav;
    },
    onStage: (m) => stage("transcribe", 0.5, m),
  });
  await db.update(projects).set({ transcriber: `${transcript.engine} ${transcript.model} · ${captions.source}` }).where(eq(projects.id, project.id));
  // For editing agents and `pnpm run edit`: every spoken word and caption word with its time.
  writeFileSync(join(dir, "transcript.json"), JSON.stringify({ language: transcript.language, words: transcript.words, captions: captions.words }), "utf8");

  await stage("signals", 0.5);
  const { signals, profile, kind } = await profileOf(transcript.words);
  const content = { type: profile.type, label: CONTENT_TYPES[profile.type].label, summary: describeProfile(profile), confidence: profile.confidence, reasons: profile.reasons };
  await db.update(projects).set({ sourceInfo: { ...info, content } }).where(eq(projects.id, project.id));

  await stage("scenes", 0.51, `Looking at the scenes${scenesDone}`);
  const timer = setInterval(() => void progressUpdate(db, job.id, { progress: 0.51, message: `Looking at the scenes${scenesDone}` }), 2000);
  const scenes = await scenesP.finally(() => clearInterval(timer));

  await stage("candidates", 0.52, `Finding the best parts of a ${content.label.toLowerCase()} (${content.summary})`);
  // Sentences only when there is real speech; moments always, from sound and picture.
  // In a song, only passages inside the song itself (not a skit before or after it).
  // After a live read, the same sentences Jev already scored (cache hits below).
  const spoken = transcript.words.length < 20 ? [] : reader ? await reader.finish(transcript.words) : findCandidates(videoId, transcript.words, settings.preset, { maxCandidates: max });
  const sentences = spoken.filter((c) => !outsideMain(profile, c));
  const moments = findMoments(videoId, signals, transcript.words, settings.preset, kind, max, info.duration, profile);
  const candidates = mixCandidates(sentences, moments, kind, max, CONTENT_TYPES[profile.type].share).map((c) => withScenes(withContent(attachMedia(c, signals, kind), profile), scenes));
  if (!candidates.length) throw new Error("No moments of the chosen length were found. Try a shorter duration preset.");

  await stage("jev", 0.55, `Ranking ${candidates.length} candidates with Jev${reader?.hooks.length ? ` (${reader.hooks.length} already read live)` : ""}`);
  const evaluations = await evaluator.evaluate(candidates, (done, total) => {
    progressUpdate(db, job.id, { progress: 0.55 + (done / total) * 0.3, message: `Ranking hooks with Jev: ${done}/${total}` });
  });
  const byId = new Map(evaluations.map((e) => [e.candidateId, e]));
  const ranked = selectTop(
    candidates
      .map((c) => ({ candidate: c, evaluation: byId.get(c.id) as HookEvaluation }))
      .filter((x) => x.evaluation)
      .map((x) => {
        const adj = contentAdjust(profile, x.candidate, x.evaluation.final);
        return { ...x, evaluation: { ...x.evaluation, final: adj.final, penalties: [...x.evaluation.penalties, ...adj.penalties] } };
      }),
    settings.topN,
  );

  await stage("plan", 0.86);
  const planner = await deps.planner(settings);
  await db.delete(clips).where(eq(clips.projectId, project.id));
  for (const [i, r] of ranked.entries()) {
    await updateJob(db, job.id, { progress: 0.86 + (i / ranked.length) * 0.13, message: `Planning clip ${i + 1}/${ranked.length} with ${planner.name}` });
    const { plan, planError } = await planClip(planner, r.candidate, transcript, r.evaluation, settings, captions.words);
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

const LANGUAGES: Record<string, string> = { ko: "Korean", ja: "Japanese", zh: "Chinese", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", hi: "Hindi", tl: "Tagalog", id: "Indonesian", th: "Thai", vi: "Vietnamese", ru: "Russian", ar: "Arabic", it: "Italian" };
const languageName = (code: string) => LANGUAGES[code] ?? (code ? code.toUpperCase() : "the spoken language");

/**
 * The words the captions show. English mode keeps English speech as it is;
 * other languages get the link's English subtitles (the uploader's, then the
 * site's translation) or, failing that, Whisper's own English translation.
 */
export async function captionTrack(
  deps: Pick<PipelineDeps, "db" | "cfg">,
  settings: ProjectSettings,
  transcript: Transcript,
  o: { url?: string | null; dir: string; provider: TranscriptionProvider; key: string; wav: () => Promise<string>; onStage?: (message: string) => Promise<unknown> },
): Promise<{ words: Word[]; source: string }> {
  // The ONNX fallback decodes in English unless told a language, so its "en" says nothing: ask the site instead.
  const heard = transcript.engine === "whisper-onnx" && !settings.language ? "" : transcript.language;
  const lang = (heard || siteLanguage(o.dir)).toLowerCase();
  const spoken = { words: transcript.words, source: `captions in ${languageName(lang)}` };
  if (settings.captions === "off") return { words: [], source: "no captions" };
  if (settings.captions === "original" || !transcript.words.length || lang.startsWith("en")) return spoken;
  if (o.url) {
    await o.onStage?.("Looking for English subtitles");
    const subs = await fetchEnglishSubtitles(deps.cfg, o.url, o.dir);
    if (subs) return { words: subs, source: "English captions from the site's subtitles" };
  }
  if (!lang) return spoken;
  const key = `${o.key}:translate`;
  let english = (await deps.db.select().from(transcripts).where(eq(transcripts.cacheKey, key)).get())?.data as Transcript | undefined;
  if (!english) {
    await o.onStage?.(`Translating ${languageName(lang)} captions to English`);
    try {
      english = await o.provider.transcribe(await o.wav(), { model: settings.model, language: settings.language ?? lang, task: "translate" });
    } catch (e) {
      return { ...spoken, source: `${spoken.source} (English translation failed: ${redact((e as Error).message).slice(0, 120)})` };
    }
    await deps.db.insert(transcripts).values({ cacheKey: key, engine: english.engine, model: english.model, data: english }).onConflictDoNothing();
  }
  return english.words.length ? { words: english.words, source: `English captions translated from ${languageName(lang)} by Whisper` } : spoken;
}

/** The language a link's page declares (yt-dlp's info file), or "" when it says none. */
function siteLanguage(dir: string): string {
  try {
    const lang = (JSON.parse(readFileSync(join(dir, "source.info.json"), "utf8")) as { language?: unknown }).language;
    return typeof lang === "string" && /^[a-z]{2,3}(-[\w]+)?$/i.test(lang) ? lang.split("-")[0] as string : "";
  } catch {
    return "";
  }
}

/** Agent plan when it works; the labelled template plan when it doesn't. Never fails the project. */
export async function planClip(
  planner: EditingPlanner,
  candidate: ClipCandidate,
  transcript: Transcript,
  evaluation: HookEvaluation,
  settings: ProjectSettings,
  captionWords: Word[] = transcript.words,
): Promise<{ plan: EditPlan; planError: string | null }> {
  const style = {
    template: settings.template === "auto" ? undefined : settings.template,
    captionPreset: settings.captionPreset === "auto" ? undefined : settings.captionPreset,
  };
  const input = { candidate, words: transcript.words, evaluation, style };
  try {
    const draft = await planner.plan(input);
    if (style.template) draft.template = style.template;
    // Moments are a stretch of sound and picture: cutting the quiet parts would break the beat.
    if (candidate.kind === "moment") Object.assign(draft, { removeSilences: false, keep: [] });
    if (style.captionPreset) draft.captionPreset = style.captionPreset;
    return { plan: compilePlan(candidate, transcript.words, draft, planner.name, "final", captionWords), planError: null };
  } catch (e) {
    const fallback = new TemplatePlanner();
    const draft = await fallback.plan(input);
    const why = planner instanceof TemplatePlanner ? null : redact((e as Error).message).slice(0, 400);
    return { plan: compilePlan(candidate, transcript.words, draft, fallback.name, "final", captionWords), planError: why };
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
  const ratio: Ratio = (RATIOS as readonly string[]).includes(job.ratio ?? "") ? (job.ratio as Ratio) : "9:16";
  const fitted = fitToFrame(EditPlanSchema.parse({ ...(clip.plan as EditPlan), output: outputFor(quality, ratio) }), project.sourceInfo as MediaInfo | null);
  const dir = join(projectDir(cfg, project.id), "renders");
  // 9:16 keeps the old names; other ratios get a suffix so they sit side by side.
  const tag = ratio === "9:16" ? "" : `-${ratioSlug(ratio)}`;
  const slug = `${String(clip.rank).padStart(2, "0")}-${quality}${tag}`;
  const workDir = join(projectDir(cfg, project.id), "work", slug);
  mkdirSync(workDir, { recursive: true });
  const vision = { ffmpeg: cfg.ffmpeg, sourcePath: project.sourcePath, source: project.sourceInfo as MediaInfo | null, workDir, modelsDir: join(cfg.dataDir, "models") };
  // Each shot framed on its own: follow the subject, fit a wide shot, or split two people.
  await updateJob(db, job.id, { stage: "render", progress: 0, message: "Reframing shots" });
  const reframed = await smartReframe(fitted, { ...vision, onStep: (message) => void updateJob(db, job.id, { message }) });
  // Captions go where no face is, per page, for this frame shape.
  await updateJob(db, job.id, { stage: "render", progress: 0, message: "Placing captions clear of faces" });
  const plan = await faceSafeCaptions(reframed.plan, vision, reframed.faces);
  // Finished clips go straight to the visible clips folder; previews stay in the project's scratch folder.
  const outDir = quality === "final" ? clipFolder(cfg, project) : dir;
  const name = safeName(plan.title, 60);
  const outPath = join(outDir, quality === "final" ? `${String(clip.rank).padStart(2, "0")}${name ? `-${name}` : ""}${tag}.mp4` : `clip-${slug}.mp4`);
  const thumbPath = join(dir, `clip-${slug}.jpg`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

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
      onProgress: (f) => progressUpdate(db, job.id, { progress: Math.min(0.97, f), message: `Rendering ${quality} with ${renderer.name}: ${Math.round(f * 100)}%` }),
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
        ratio,
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
    ratio,
    renderer: order.map((r) => r.name).join("→") || "none",
    path: outPath,
    status: "failed",
    error: problems.join(" | ") || "No renderer available",
  });
  throw new Error(problems.join(" | ") || "No renderer available");
}

/**
 * A plan made for one frame shape, fitted to another: when the frame is much
 * wider than the source (a phone video in 16:9), cropping would throw most of
 * the picture away, so the clip sits on a blurred copy of itself instead.
 */
export function fitToFrame(plan: EditPlan, source: Pick<MediaInfo, "width" | "height"> | null): EditPlan {
  if (!source?.width || !source.height) return plan;
  const frame = plan.output.width / plan.output.height;
  const src = source.width / source.height;
  return frame > src * 1.3 ? { ...plan, editing: { ...plan.editing, layout: "blur-background" } } : plan;
}

/** Queue renders for every clip in a project (or one clip), once per ratio (the project's ratios when not given). Analysis is never re-run. */
export async function queueRenders(db: Db, projectId: string, quality: "final" | "preview", clipId?: string, ratios?: Ratio[]): Promise<string[]> {
  if (!ratios?.length) {
    const p = await db.select({ settings: projects.settings }).from(projects).where(eq(projects.id, projectId)).get();
    ratios = p ? ProjectSettingsSchema.parse(p.settings).ratios : ["9:16"];
  }
  // A preview is for judging the edit: one ratio is enough.
  if (quality === "preview") ratios = ratios.slice(0, 1);
  const rows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(clipId ? and(eq(clips.projectId, projectId), eq(clips.id, clipId)) : eq(clips.projectId, projectId))
    .orderBy(asc(clips.rank));
  const ids: string[] = [];
  for (const r of rows) for (const ratio of ratios) ids.push(await enqueue(db, { projectId, kind: "render", clipId: r.id, quality, ratio }));
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
