/**
 * Render an edit an agent (or you) wrote by hand: shots in any order, sound
 * borrowed from other moments, speed changes, mutes and an audio bed.
 *
 *   pnpm run edit --plan edit.json (--project <id> | --source video.mp4 [--words transcript.json])
 *             [--ratio 9:16,16:9] [--quality final|preview] [--renderer remotion|ffmpeg]
 *             [--out folder] [--dry-run]
 *
 * edit.json is a plan draft (see skills/oneclip-editor/SKILL.md). Only
 * `segments` is required; everything else has a sensible default. Times are
 * seconds in the source video. --dry-run prints the compiled plan and stops.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type ClipCandidate,
  compilePlan,
  config,
  ensureDirs,
  FfmpegRenderer,
  fitToFrame,
  type MediaInfo,
  openDb,
  outputFor,
  PlanDraftSchema,
  probe,
  projectDir,
  type Ratio,
  RATIOS,
  ratioSlug,
  safeName,
  schema,
  verifyRender,
  type VideoRenderer,
  type Word,
} from "@oneclip/core";
import { eq } from "drizzle-orm";

const { values } = parseArgs({
  options: {
    plan: { type: "string" },
    project: { type: "string" },
    source: { type: "string" },
    words: { type: "string" },
    ratio: { type: "string", default: "9:16" },
    quality: { type: "string", default: "final" },
    renderer: { type: "string", default: "remotion" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(2);
};
if (!values.plan || (!values.project && !values.source)) fail("Usage: pnpm run edit --plan edit.json (--project <id> | --source video.mp4) [options]   (see scripts/edit.ts)");
const ratios = (values.ratio ?? "9:16").split(",").map((r) => r.trim());
for (const r of ratios) if (!(RATIOS as readonly string[]).includes(r)) fail(`Unknown ratio ${r}. Use ${RATIOS.join(", ")}.`);
const quality = values.quality === "preview" ? "preview" : "final";

const cfg = config();
ensureDirs(cfg);

// Source, its info and its words: from a OneClip project, or a file plus an optional transcript.
let sourcePath: string;
let info: MediaInfo;
let words: Word[] = [];
let captionWords: Word[] | undefined;
let outDir: string;
const readWords = (path: string) => {
  const t = JSON.parse(readFileSync(path, "utf8")) as { words?: Word[]; captions?: Word[] };
  words = t.words ?? [];
  captionWords = t.captions;
};
if (values.project) {
  const db = openDb(cfg.dbPath);
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, values.project)).get();
  if (!project) fail(`No project ${values.project}. Run pnpm clip first; it prints the project id.`);
  sourcePath = project!.sourcePath;
  info = project!.sourceInfo as MediaInfo;
  try {
    readWords(join(projectDir(cfg, project!.id), "transcript.json"));
  } catch {
    console.warn("No transcript.json for this project (analysed before it existed): the edit renders without captions or ducking.");
  }
  outDir = values.out ? resolve(values.out) : join(projectDir(cfg, project!.id), "edits");
} else {
  sourcePath = resolve(values.source as string);
  info = await probe(cfg.ffprobe, sourcePath);
  if (values.words) readWords(resolve(values.words));
  outDir = values.out ? resolve(values.out) : resolve("edits");
}

const raw = JSON.parse(readFileSync(resolve(values.plan as string), "utf8")) as Record<string, unknown>;
const draft = PlanDraftSchema.parse({
  template: "podcast-short",
  layout: "crop-center",
  cropMode: "center",
  captionPreset: "bold-pop",
  transitionPreset: "fade",
  zoomIntensity: 0,
  removeSilences: false,
  keep: [],
  zoomAt: [],
  emphasis: [],
  title: "",
  reasoning: "",
  ...raw,
});
if (!draft.segments?.length) fail("The plan needs at least one entry in `segments`.");

// The whole source is in play: a mix may take any shot and any sound from it.
const candidate = {
  id: "edit",
  videoId: "edit",
  start: 0,
  end: info.duration,
  duration: info.duration,
  openingText: draft.title || basename(sourcePath, extname(sourcePath)),
  transcript: "",
  precedingContext: "",
  followingContext: "",
} satisfies ClipCandidate;
const plan = compilePlan(candidate, words, draft, "agent edit", quality, captionWords ?? words, { sourceDuration: info.duration });

if (values["dry-run"]) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const renderers: VideoRenderer[] = [];
if (values.renderer === "remotion") renderers.push(new (await import("@oneclip/remotion")).RemotionRenderer());
renderers.push(new FfmpegRenderer(cfg.ffmpeg));

mkdirSync(outDir, { recursive: true });
const name = safeName(plan.title, 60) || "edit";
writeFileSync(join(outDir, `${name}.plan.json`), JSON.stringify(plan, null, 2), "utf8");
console.log(`${plan.cuts.length} shots, ${plan.outputDuration.toFixed(2)}s${plan.bed ? ", with an audio bed" : ""}`);

let failed = false;
for (const ratio of ratios as Ratio[]) {
  const fitted = fitToFrame({ ...plan, output: outputFor(quality, ratio) }, info);
  const tag = ratio === "9:16" ? "" : `-${ratioSlug(ratio)}`;
  const outPath = join(outDir, `${name}${quality === "preview" ? "-preview" : ""}${tag}.mp4`);
  const workDir = join(outDir, "work", `${name}-${quality}${tag}`);
  mkdirSync(workDir, { recursive: true });
  const problems: string[] = [];
  for (const r of renderers) {
    const t0 = Date.now();
    try {
      await r.render({ sourcePath, source: info, plan: fitted, outPath, workDir, quality, onProgress: (f) => process.stdout.write(`\r${ratio} ${r.name} ${Math.round(f * 100)}%   `) });
      const v = await verifyRender(cfg.ffprobe, outPath, { width: fitted.output.width, height: fitted.output.height, duration: fitted.outputDuration });
      if (!v.ok) throw new Error(`Output check failed: ${v.problems.join("; ")}`);
      console.log(`\rdone  ${ratio}  ${r.name}  ${Date.now() - t0}ms  ${outPath}`);
      problems.length = 0;
      break;
    } catch (e) {
      problems.push(`${r.name}: ${(e as Error).message.slice(0, 300)}`);
    }
  }
  if (problems.length) {
    failed = true;
    console.error(`\rfailed ${ratio}: ${problems.join(" | ")}`);
  }
}
process.exit(failed ? 1 : 0);
