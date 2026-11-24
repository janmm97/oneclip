import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_EXTENSIONS, findDownloaded, isRemoteSource, openDb, parseProbe, schema } from "@oneclip/core";

describe("isRemoteSource", () => {
  it("accepts http(s) links from any site", () => {
    expect(isRemoteSource("https://youtu.be/icXUkIfZxyg?si=dd89rDAfK76Y8Znu")).toBe(true);
    expect(isRemoteSource("https://www.youtube.com/watch?v=icXUkIfZxyg")).toBe(true);
    expect(isRemoteSource("http://example.com/episode.mp3")).toBe(true);
    expect(isRemoteSource("  https://vimeo.com/123  ")).toBe(true);
  });
  it("rejects local paths and other schemes", () => {
    expect(isRemoteSource("C:\\videos\\talk.mp4")).toBe(false);
    expect(isRemoteSource("/home/me/talk.mp4")).toBe(false);
    expect(isRemoteSource("file:///etc/passwd")).toBe(false);
    expect(isRemoteSource("javascript:alert(1)")).toBe(false);
    expect(isRemoteSource("-o /tmp/x")).toBe(false);
  });
});

describe("accepted files", () => {
  it("covers common video containers and podcast audio", () => {
    for (const e of [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mp3", ".m4a", ".wav", ".flac", ".ogg", ".opus"]) expect(ALLOWED_EXTENSIONS).toContain(e);
  });
});

describe("parseProbe", () => {
  it("treats an MP3 with embedded cover art as audio-only", () => {
    const streams = [
      { codec_type: "audio", codec_name: "mp3" },
      { codec_type: "video", codec_name: "mjpeg", width: 600, height: 600, disposition: { attached_pic: 1 } },
    ];
    expect(() => parseProbe({ format: { duration: "60" }, streams })).toThrow(/No video stream/);
    const real = parseProbe({ format: { duration: "60" }, streams: [...streams, { codec_type: "video", codec_name: "h264", width: 1080, height: 1080 }] });
    expect(real.width).toBe(1080);
    expect(real.videoCodec).toBe("h264");
  });
});

describe("db migration", () => {
  it("adds source_url to a database made before link support", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "oneclip-mig-")), "old.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, youtube_url TEXT, youtube_meta TEXT, source_path TEXT NOT NULL, source_info TEXT, settings TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', transcriber TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    old.close();
    const db = openDb(path);
    await db.insert(schema.projects).values({ id: "p", title: "t", sourcePath: "", sourceUrl: "https://youtu.be/x", settings: {} });
    const [row] = await db.select().from(schema.projects).all();
    expect(row?.sourceUrl).toBe("https://youtu.be/x");
  });
});

describe("findDownloaded", () => {
  it("uses the printed path, else falls back to source.<ext> in the folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-dl-"));
    for (const n of ["source.info.json", "cover.jpg", "source.f137.mp4", "source.mp4"]) writeFileSync(join(dir, n), "x");
    expect(findDownloaded(`[download] 100%\n${join(dir, "source.mp4")}\n`, dir)).toBe(join(dir, "source.mp4"));
    expect(findDownloaded("C:\Mangled ??\source.mp4\n", dir)).toBe(join(dir, "source.mp4"));
    expect(findDownloaded("", mkdtempSync(join(tmpdir(), "oc-empty-")))).toBeUndefined();
  });
});
