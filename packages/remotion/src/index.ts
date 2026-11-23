/**
 * Remotion renderer for OneClip. Bundles the compositions once per process,
 * serves the user's source video from a one-file 127.0.0.1 server with a
 * random path, renders H.264/AAC, then normalises loudness with FFmpeg
 * (video stream copied). Remotion has its own licence: see README "Remotion licence".
 */
import { randomBytes } from "node:crypto";
import { createReadStream, renameSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, runProcess, type RenderJob, type VideoRenderer } from "@oneclip/core";
import { COMPOSITION_ID, type ClipProps } from "./compositions/index.tsx";

export { COMPOSITION_ID, planVideoConfig } from "./compositions/index.tsx";

const MIME: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".webm": "video/webm" };

/** Serves exactly one file, with Range support, on 127.0.0.1 under an unguessable path. */
export async function serveOneFile(path: string): Promise<{ url: string; close: () => Promise<void> }> {
  const token = randomBytes(16).toString("hex");
  const size = statSync(path).size;
  const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  const server: Server = createServer((req, res) => {
    if (req.url !== `/${token}${extname(path).toLowerCase()}`) {
      res.writeHead(404).end();
      return;
    }
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (m) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      createReadStream(path, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": size });
      createReadStream(path).pipe(res);
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/${token}${extname(path).toLowerCase()}`,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}

let bundled: Promise<string> | undefined;

async function bundleOnce(): Promise<string> {
  bundled ??= (async () => {
    const { bundle } = await import("@remotion/bundler");
    const entryPoint = join(dirname(fileURLToPath(import.meta.url)), "entry.tsx");
    return bundle({ entryPoint, outDir: join(config().dataDir, "remotion-bundle") });
  })();
  return bundled;
}

export class RemotionRenderer implements VideoRenderer {
  readonly name = "remotion";

  async available() {
    try {
      await import("@remotion/renderer");
      await import("@remotion/bundler");
      return { ok: true, detail: "Remotion 4 (downloads Chrome Headless Shell on first render)" };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async render(job: RenderJob): Promise<void> {
    const { renderMedia, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await bundleOnce();
    const file = await serveOneFile(job.sourcePath);
    const raw = join(job.workDir, "remotion-raw.mp4");
    const final = job.quality === "final";
    try {
      const inputProps: ClipProps = { plan: job.plan, src: file.url };
      const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        audioCodec: "aac",
        crf: final ? 20 : 28,
        x264Preset: final ? "medium" : "veryfast",
        audioBitrate: final ? "160k" : "96k",
        pixelFormat: "yuv420p",
        outputLocation: raw,
        inputProps,
        overwrite: true,
        enforceAudioTrack: true,
        onProgress: ({ progress }) => job.onProgress?.(Math.min(0.95, progress * 0.95)),
      });
    } finally {
      await file.close();
    }
    if (!job.plan.audio.normalize) {
      renameSync(raw, job.outPath);
      job.onProgress?.(1);
      return;
    }
    const r = await runProcess(
      config().ffmpeg,
      [
        "-y", "-hide_banner", "-v", "error", "-i", raw,
        "-c:v", "copy",
        "-af", `loudnorm=I=${job.plan.audio.targetLufs}:TP=-1.5:LRA=11,aresample=48000`,
        "-c:a", "aac", "-b:a", final ? "160k" : "96k",
        "-movflags", "+faststart", job.outPath,
      ],
      { timeoutMs: 20 * 60_000 },
    );
    if (r.code !== 0) throw new Error(`Loudness pass failed: ${r.stderr.trim().slice(-400)}`);
    job.onProgress?.(1);
  }
}
