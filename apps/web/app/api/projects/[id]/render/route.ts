import { queueRenders, schema } from "@oneclip/core";
import { and, eq } from "drizzle-orm";
import { app, guard, isId, json } from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

/** Queue renders: one clip or all, preview or final. Uses the stored plans: no re-analysis. */
export async function POST(req: Request, { params }: Ctx) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { quality?: unknown; clipId?: unknown };
  const quality = body.quality === "preview" ? "preview" : "final";
  const clipId = typeof body.clipId === "string" ? body.clipId : undefined;
  const { db } = app();
  if (!isId(id)) return json({ error: "No such project." }, 404);
  if (clipId && !(await db.select().from(schema.clips).where(and(eq(schema.clips.id, clipId), eq(schema.clips.projectId, id))).get()))
    return json({ error: "No such clip." }, 404);
  const jobs = await queueRenders(db, id, quality, clipId);
  return jobs.length ? json({ jobs }, 202) : json({ error: "Nothing to render yet: wait for analysis to finish." }, 409);
}
