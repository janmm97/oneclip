import { createProject, fetchYouTubeMeta, schema, type YouTubeMeta } from "@oneclip/core";
import { desc } from "drizzle-orm";
import { app, errorText, guard, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const rows = await app().db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).limit(50).all();
  return json({ projects: rows.map(({ id, title, status, createdAt, youtubeMeta }) => ({ id, title, status, createdAt, youtubeMeta })) });
}

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  try {
    const body = (await req.json()) as { sourcePath?: unknown; authorized?: unknown; youtubeUrl?: unknown; title?: unknown; settings?: unknown };
    let youtube: YouTubeMeta | undefined;
    // The preview is nice to have: a private or unlisted video still downloads without it.
    if (typeof body.youtubeUrl === "string" && body.youtubeUrl.trim()) youtube = await fetchYouTubeMeta(body.youtubeUrl.trim()).catch(() => undefined);
    const { projectId } = await createProject(app(), {
      sourcePath: String(body.sourcePath ?? ""),
      authorized: body.authorized === true,
      youtube,
      title: typeof body.title === "string" ? body.title : undefined,
      settings: (body.settings ?? {}) as never,
    });
    return json({ projectId }, 201);
  } catch (e) {
    return json({ error: errorText(e) }, 400);
  }
}
