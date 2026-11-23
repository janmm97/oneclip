import { schema } from "@oneclip/core";
import { eq } from "drizzle-orm";
import { streamFile } from "@/lib/media";
import { app, guard, isId } from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

/** A finished render; `?download=1` sends it as an attachment. */
export async function GET(req: Request, { params }: Ctx) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const { id } = await params;
  const r = isId(id) ? await app().db.select().from(schema.renders).where(eq(schema.renders.id, id)).get() : undefined;
  if (!r || r.status !== "done") return new Response("Not found", { status: 404 });
  return streamFile(req, r.path, new URL(req.url).searchParams.has("download"));
}
