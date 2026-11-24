// Real FFmpeg: silent videos get a silent track, even when MP4 can't hold the picture codec.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { config, ensureAudio, probe } from "@oneclip/core";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("ensureAudio (real FFmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "oneclip-ea-"));
  const cfg = config({ ...process.env, ONECLIP_DATA_DIR: join(dir, "data") });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const make = (name: string, codec: string) => {
    const src = join(dir, name);
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=2", "-c:v", codec, src], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return src;
  };

  it("copies the picture when MP4 can hold it", async () => {
    const out = await ensureAudio(cfg, make("h264.mp4", "libx264"), dir, false);
    expect(await probe(cfg.ffprobe, out)).toMatchObject({ hasAudio: true, width: 320, height: 240 });
  }, 60_000);

  it("re-encodes a codec MP4 can't hold (FLV1) instead of failing", async () => {
    const out = await ensureAudio(cfg, make("old.flv", "flv1"), dir, false);
    expect(await probe(cfg.ffprobe, out)).toMatchObject({ hasAudio: true, width: 320, height: 240 });
  }, 60_000);

  it("leaves a video that already has audio alone", async () => {
    expect(await ensureAudio(cfg, "x.mp4", dir, true)).toBe("x.mp4");
  });
});
