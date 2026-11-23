import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

/** Streams a file the server already resolved from the DB, with Range support for video seeking. */
export function streamFile(req: Request, path: string, download = false): Response {
  if (!existsSync(path)) return new Response("File not found", { status: 404 });
  const size = statSync(path).size;
  const headers: Record<string, string> = {
    "Content-Type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${basename(path).replace(/[^\w.-]/g, "_")}"`;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
}
