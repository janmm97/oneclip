import { enqueue, schema } from "@oneclip/core";
import { and, eq } from "drizzle-orm";
import { app, guard, isId, json } from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

/** Queue a chat edit on one clip: `{ clipId, instruction }`. The worker revises the plan and renders a new preview. */
export async function POST(req: Request, { params }: Ctx) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { clipId?: unknown; instruction?: unknown };
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) return json({ error: "Type what to change." }, 400);
  if (instruction.length > 500) return json({ error: "Keep it under 500 characters." }, 400);
  const { db } = app();
  const clipId = typeof body.clipId === "string" ? body.clipId : "";
  const clip = isId(id) && clipId ? await db.select().from(schema.clips).where(and(eq(schema.clips.id, clipId), eq(schema.clips.projectId, id))).get() : undefined;
  if (!clip) return json({ error: "No such clip." }, 404);
  if (!clip.plan) return json({ error: "This clip has no edit yet: wait for analysis to finish." }, 409);
  return json({ jobId: await enqueue(db, { projectId: id, kind: "edit", clipId, instruction }) }, 202);
}
