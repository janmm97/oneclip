import { schema } from "@oneclip/core";
import { and, eq } from "drizzle-orm";
import { app, guard, isId, json } from "@/lib/server";

const RATINGS = ["good", "average", "bad"] as const;

/** Local-only good/average/bad labels. They stay in your SQLite file; `pnpm run eval:hooks --feedback` can score Jev against them. */
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const b = (await req.json().catch(() => ({}))) as { projectId?: unknown; clipId?: unknown; rating?: unknown; note?: unknown };
  const projectId = String(b.projectId ?? "");
  const clipId = String(b.clipId ?? "");
  const rating = RATINGS.find((r) => r === b.rating);
  if (!isId(projectId) || !isId(clipId) || !rating) return json({ error: "Send projectId, clipId and a rating of good, average or bad." }, 400);
  const { db } = app();
  if (!(await db.select().from(schema.clips).where(and(eq(schema.clips.id, clipId), eq(schema.clips.projectId, projectId))).get()))
    return json({ error: "No such clip." }, 404);
  await db.delete(schema.feedback).where(eq(schema.feedback.clipId, clipId));
  await db.insert(schema.feedback).values({ projectId, clipId, rating, note: typeof b.note === "string" ? b.note.slice(0, 500) : null });
  return json({ ok: true });
}
