import { basename } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { schema } from "@oneclip/core";
import { ZipArchive } from "archiver";
import { and, eq } from "drizzle-orm";
import { app, guard, isId, json } from "@/lib/server";

type Ctx = { params: Promise<{ id: string }> };

/** Every finished final render of a project in one zip (stored, not recompressed: MP4 is already compressed). */
export async function GET(req: Request, { params }: Ctx) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const { id } = await params;
  if (!isId(id)) return json({ error: "No such project." }, 404);
  const rows = await app()
    .db.select()
    .from(schema.renders)
    .where(and(eq(schema.renders.projectId, id), eq(schema.renders.status, "done"), eq(schema.renders.quality, "final")))
    .all();
  if (!rows.length) return json({ error: "No final renders yet." }, 404);
  const zip = new ZipArchive({ store: true });
  const out = new PassThrough();
  zip.pipe(out);
  const seen = new Set<string>();
  for (const r of rows) {
    const name = basename(r.path);
    if (seen.has(name)) continue;
    seen.add(name);
    zip.file(r.path, { name });
  }
  void zip.finalize();
  return new Response(Readable.toWeb(out) as ReadableStream, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="oneclip-${id.slice(0, 8)}.zip"` },
  });
}
