import { schema } from "@oneclip/core";
import { eq } from "drizzle-orm";
import { streamFile } from "@/lib/media";
import { app, guard, isId } from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

/** The project's source video for the Remotion Player. The path comes from the DB, never from the request. */
export async function GET(req: Request, { params }: Ctx) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const { id } = await params;
  const p = isId(id) ? await app().db.select().from(schema.projects).where(eq(schema.projects.id, id)).get() : undefined;
  return p ? streamFile(req, p.sourcePath) : new Response("Not found", { status: 404 });
}
