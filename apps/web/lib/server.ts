import { basename } from "node:path";
import { clipFolder, config, type Db, ensureDirs, openDb, type QaReport, schema } from "@oneclip/core";
import { asc, desc, eq } from "drizzle-orm";

/** One DB handle per server process (survives Next dev hot reloads). */
const g = globalThis as unknown as { __oneclip?: { db: Db; cfg: ReturnType<typeof config> } };
export function app() {
  if (!g.__oneclip) {
    const cfg = config();
    ensureDirs(cfg);
    g.__oneclip = { db: openDb(cfg.dbPath), cfg };
  }
  return g.__oneclip;
}

const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

/**
 * OneClip is a local app: refuse requests whose Host or Origin isn't this
 * machine (DNS rebinding, cross-site form posts from a web page you visit).
 */
export function guard(req: Request): Response | undefined {
  const host = req.headers.get("host") ?? "";
  if (!LOCAL_HOSTS.test(host)) return json({ error: "OneClip only answers on 127.0.0.1." }, 403);
  const origin = req.headers.get("origin");
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (origin && !LOCAL_HOSTS.test(origin.replace(/^https?:\/\//, ""))) return json({ error: "Cross-site request refused." }, 403);
  }
  return undefined;
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isId = (s: string) => UUID.test(s);

/** Everything a project screen needs in one read. */
export async function projectView(id: string) {
  const { db } = app();
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) return undefined;
  const [jobs, clips, renders, feedback] = await Promise.all([
    db.select().from(schema.jobs).where(eq(schema.jobs.projectId, id)).orderBy(asc(schema.jobs.createdAt)).all(),
    db.select().from(schema.clips).where(eq(schema.clips.projectId, id)).orderBy(asc(schema.clips.rank)).all(),
    db.select().from(schema.renders).where(eq(schema.renders.projectId, id)).orderBy(desc(schema.renders.createdAt)).all(),
    db.select().from(schema.feedback).where(eq(schema.feedback.projectId, id)).orderBy(desc(schema.feedback.createdAt)).all(),
  ]);
  // Never send local file paths to the browser; the media routes resolve them by ID.
  // The clips folder is shown by name only: "clips/<folder>", or "<ONECLIP_CLIPS_DIR>/<folder>".
  const { sourcePath: _s, ...safeProject } = project;
  const clipsFolder = `${process.env.ONECLIP_CLIPS_DIR ? "<ONECLIP_CLIPS_DIR>" : "clips"}/${basename(clipFolder(app().cfg, project))}`;
  return {
    project: { ...safeProject, fileName: _s.split(/[\\/]/).pop() ?? "", clipsFolder },
    jobs,
    clips: clips.map((c) => ({ ...c, rating: feedback.find((f) => f.clipId === c.id)?.rating ?? null })),
    renders: renders.map(({ path: _p, thumbPath, qa, ...r }) => ({ ...r, qa: (qa ?? null) as QaReport | null, hasThumb: Boolean(thumbPath) })),
  };
}

export type ProjectView = NonNullable<Awaited<ReturnType<typeof projectView>>>;
