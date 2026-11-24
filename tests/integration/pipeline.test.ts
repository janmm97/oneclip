// Integration: the whole analyze → plan → render path on a generated test
// video, with real FFmpeg/FFprobe, real SQLite and the real JevHookEvaluator.
// MOCKS (labelled): the transcriber returns a fixed synthetic transcript, and
// the One client returns hand-written Jev answers instead of calling TypeSafe.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimNext,
  type ClipCandidate,
  config,
  createProject,
  enqueue,
  ensureDirs,
  JevHookEvaluator,
  FfmpegRenderer,
  type JevRequest,
  type JevResponse,
  openDb,
  type PipelineDeps,
  queueRenders,
  runJob,
  schema,
  TemplatePlanner,
  type Transcript,
  type TranscriptionProvider,
  WEIGHTS,
} from "@oneclip/core";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

const SENTENCES = [
  "Welcome back everyone to the show today.",
  "Ninety percent of our bugs came from four lines of config.",
  "Nobody reviewed them because they were not code.",
  "Now we review config like code every single time.",
  "Our incident count dropped by two thirds in a year.",
  "Anyway let me check the time we have left.",
  "Okay so that was the first part of the talk.",
  "The second part is about hiring good engineers.",
];

function syntheticTranscript(): Transcript {
  const words: Transcript["words"] = [];
  let t = 0.5;
  for (const s of SENTENCES) {
    for (const w of s.split(" ")) {
      words.push({ word: w, start: t, end: t + 0.35 });
      t += 0.45;
    }
    t += 0.4;
  }
  return { engine: "mock", model: "fixture", language: "en", duration: t, words };
}

/** MOCK transcriber: no model, same words every time. */
const mockTranscriber: TranscriptionProvider = {
  name: "mock-transcriber",
  available: async () => ({ ok: true, detail: "test fixture" }),
  transcribe: async () => syntheticTranscript(),
};

/** MOCK One client: clips containing "config" score high, the rest low. */
function mockOne() {
  const calls: JevRequest[] = [];
  return {
    calls,
    async executeJevDecision(req: JevRequest): Promise<JevResponse> {
      calls.push(req);
      const strong = JSON.stringify(req.state).includes("config");
      const answers: JevResponse["answers"] = {};
      for (const [k, q] of Object.entries(req.questions)) {
        if (q.type === "score") answers[k] = { type: "score", score: (strong ? 0.9 : 0.3) * (q.criteria.length - 1) };
        else if (q.type === "noul") answers[k] = { type: "noul", noul: strong ? 0.9 : 0.7 };
        else answers[k] = { type: "choice", choice: strong ? "surprising" : "none", confidence: 0.7 };
      }
      return { model: "jev-mock", answers, usage: { input_tokens: 1000, output_tokens: 10 } };
    },
  };
}

describe.skipIf(!hasFfmpeg)("pipeline (integration, mocked transcriber and Jev)", () => {
  const dir = mkdtempSync(join(tmpdir(), "oneclip-it-"));
  const cfg = config({ ...process.env, ONECLIP_DATA_DIR: join(dir, "data") });
  const video = join(dir, "talk.mp4");
  const one = mockOne();
  let deps: PipelineDeps;

  beforeAll(() => {
    ensureDirs(cfg);
    const r = spawnSync(
      "ffmpeg",
      ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=45", "-f", "lavfi", "-i", "sine=frequency=440:duration=45", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", video],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(r.stderr);
    deps = {
      db: openDb(cfg.dbPath),
      cfg,
      transcriber: async () => mockTranscriber,
      // Real evaluator, MOCK One client.
      evaluator: (cache) => new JevHookEvaluator(one, { model: "jev-mock", concurrency: 2, cache }),
      planner: async () => new TemplatePlanner(),
      renderers: { ffmpeg: new FfmpegRenderer(cfg.ffmpeg) },
    };
  });
  afterAll(() => {
    (deps?.db as unknown as { $client?: { close?: () => void } })?.$client?.close?.();
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows can keep the SQLite file locked until the worker exits; the OS temp dir is cleaned later.
    }
  });

  it("rejects unauthorised or unsupported input", async () => {
    await expect(createProject(deps, { sourcePath: video, authorized: false })).rejects.toThrow(/authorised/);
    await expect(createProject(deps, { sourcePath: join(dir, "x.txt"), authorized: true })).rejects.toThrow(/Supported/);
    await expect(createProject(deps, { sourcePath: "//attacker/share/x.mp4", authorized: true })).rejects.toThrow(/network share/);
    await expect(createProject(deps, { sourcePath: "\\\\attacker\\share\\x.mp4", authorized: true })).rejects.toThrow(/network share|full path/);
  });

  let projectId = "";
  it("analyzes: probe, audio, transcript, candidates, Jev ranking, plans", async () => {
    ({ projectId } = await createProject(deps, { sourcePath: video, authorized: true, settings: { preset: "quick", topN: 2, renderer: "ffmpeg" } }));
    const job = await claimNext(deps.db);
    expect(job?.kind).toBe("analyze");
    await runJob(deps, job as NonNullable<typeof job>);

    const j = await deps.db.select().from(schema.jobs).all();
    expect(j[0]?.error ?? null).toBeNull();
    const clips = await deps.db.select().from(schema.clips).all();
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.length).toBeLessThanOrEqual(2);
    const best = clips.find((c) => c.rank === 1) as (typeof clips)[number];
    expect(JSON.stringify(best.candidate)).toContain("config");
    expect(best.planner).toMatch(/template/);
    expect(one.calls.length).toBeGreaterThan(0);
    expect(Object.keys(one.calls[0]?.questions ?? {})).toEqual(expect.arrayContaining(Object.keys(WEIGHTS)));
  }, 120_000);

  it("re-analysis reuses cached transcript and Jev answers", async () => {
    const before = one.calls.length;
    const { db } = deps;
    await db.update(schema.projects).set({ status: "queued" });
    await enqueue(db, { projectId, kind: "analyze" });
    const job = await claimNext(db);
    await runJob(deps, job as NonNullable<typeof job>);
    expect(one.calls.length).toBe(before);
  }, 120_000);

  it("renders a verified 540x960 preview without re-analysis", async () => {
    const before = one.calls.length;
    const [clip] = await deps.db.select().from(schema.clips).all();
    await queueRenders(deps.db, projectId, "preview", clip?.id);
    const job = await claimNext(deps.db);
    expect(job?.kind).toBe("render");
    await runJob(deps, job as NonNullable<typeof job>);
    const [r] = await deps.db.select().from(schema.renders).all();
    expect(r?.status).toBe("done");
    expect(existsSync(r?.path ?? "")).toBe(true);
    expect(r?.verify).toMatchObject({ width: 540, height: 960 });
    expect(one.calls.length).toBe(before);
  }, 180_000);

  it("queues a link for download instead of rejecting it", async () => {
    const link = "https://youtu.be/icXUkIfZxyg?si=dd89rDAfK76Y8Znu";
    const { projectId: id } = await createProject(deps, { sourcePath: link, authorized: true });
    const [p] = await deps.db.select().from(schema.projects).where(eq(schema.projects.id, id)).all();
    expect(p?.sourceUrl).toBe(link);
    expect(p?.sourcePath).toBe("");
    // Leave the real download to the end-to-end run; drop the queued job.
    await deps.db.delete(schema.jobs).where(eq(schema.jobs.projectId, id));
  });

  it("turns a podcast MP3 into a cover-art video and analyzes it", async () => {
    const mp3 = join(dir, "episode.mp3");
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=45", "-c:a", "libmp3lame", mp3], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    const { projectId: id } = await createProject(deps, { sourcePath: mp3, authorized: true, settings: { preset: "quick", topN: 1, renderer: "ffmpeg" } });
    const job = await claimNext(deps.db);
    await runJob(deps, job as NonNullable<typeof job>);
    const [p] = await deps.db.select().from(schema.projects).where(eq(schema.projects.id, id)).all();
    expect(p?.error ?? null).toBeNull();
    expect(p?.status).toBe("ready");
    expect(p?.sourcePath).toMatch(/source-video\.mp4$/);
    expect(p?.sourceInfo).toMatchObject({ width: 1080, height: 1080, hasAudio: true });
  }, 180_000);

  it("finds visual moments in a silent video, without transcribing", async () => {
    const mute = join(dir, "broll.mp4");
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=40", "-c:v", "libx264", "-preset", "ultrafast", mute], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    let transcribed = false;
    const d: PipelineDeps = { ...deps, transcriber: async () => ({ ...mockTranscriber, transcribe: async () => ((transcribed = true), syntheticTranscript()) }) };
    const { projectId: id } = await createProject(d, { sourcePath: mute, authorized: true, settings: { preset: "quick", topN: 1, renderer: "ffmpeg" } });
    await runJob(d, (await claimNext(d.db)) as NonNullable<Awaited<ReturnType<typeof claimNext>>>);
    const [p] = await d.db.select().from(schema.projects).where(eq(schema.projects.id, id)).all();
    expect(p?.error ?? null).toBeNull();
    expect(p?.status).toBe("ready");
    expect(p?.sourceInfo).toMatchObject({ hasAudio: true });
    expect(transcribed).toBe(false);
    const [c] = await d.db.select().from(schema.clips).where(eq(schema.clips.projectId, id)).all();
    expect(c?.candidate).toMatchObject({ kind: "moment", media: { kind: "visual" } });
    expect(c?.plan).toMatchObject({ editing: { removeSilences: false } });
    expect(one.calls.at(-1)?.state).toMatchObject({ source_kind: "visual", picked_by: "sound and picture" });
    // A moment with no words renders like any clip (no captions, nothing trimmed).
    await queueRenders(d.db, id, "preview", c?.id);
    await runJob(d, (await claimNext(d.db)) as NonNullable<Awaited<ReturnType<typeof claimNext>>>);
    const [out] = await d.db.select().from(schema.renders).where(eq(schema.renders.clipId, c?.id as string)).all();
    expect(out?.error ?? null).toBeNull();
    expect(out?.status).toBe("done");
    expect(out?.verify).toMatchObject({ width: 540, height: 960 });
  }, 240_000);

  it("finds sound moments in music with no lyrics", async () => {
    const song = join(dir, "song.mp4");
    // Quiet for 15 s, then loud: the jump is the hook.
    const r = spawnSync(
      "ffmpeg",
      ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=640x360:r=30:d=45", "-f", "lavfi", "-i", "sine=frequency=220:duration=45,volume='if(lt(t,15),0.05,1)':eval=frame", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", song],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(r.stderr);
    const instrumental: TranscriptionProvider = { ...mockTranscriber, transcribe: async () => ({ ...syntheticTranscript(), words: [] }) };
    const d: PipelineDeps = { ...deps, transcriber: async () => instrumental };
    const { projectId: id } = await createProject(d, { sourcePath: song, authorized: true, settings: { preset: "quick", topN: 3, renderer: "ffmpeg" } });
    await runJob(d, (await claimNext(d.db)) as NonNullable<Awaited<ReturnType<typeof claimNext>>>);
    const [p] = await d.db.select().from(schema.projects).where(eq(schema.projects.id, id)).all();
    expect(p?.error ?? null).toBeNull();
    const clips = (await d.db.select().from(schema.clips).where(eq(schema.clips.projectId, id)).all()).map((c) => c.candidate as ClipCandidate);
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.every((c) => c.kind === "moment" && c.media?.kind === "music")).toBe(true);
    expect(clips.some((c) => Math.abs(c.start - 15) <= 1)).toBe(true);
  }, 180_000);
});
