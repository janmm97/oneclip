import { enqueue, schema } from "@oneclip/core";
import { eq } from "drizzle-orm";
import { app, guard, isId, json, projectView } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const { id } = await params;
  const view = isId(id) ? await projectView(id) : undefined;
  return view ? json(view) : json({ error: "No such project." }, 404);
}

/** POST: re-run analysis (cached transcript and Jev answers are reused, so it's cheap). */
export async function POST(req: Request, { params }: Ctx) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const { id } = await params;
  const { db } = app();
  if (!isId(id) || !(await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get())) return json({ error: "No such project." }, 404);
  await db.update(schema.projects).set({ status: "queued", error: null }).where(eq(schema.projects.id, id));
  return json({ jobId: await enqueue(db, { projectId: id, kind: "analyze" }) }, 202);
}
