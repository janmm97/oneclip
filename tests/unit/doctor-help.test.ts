import { describe, expect, it } from "vitest";
import { checkHelp } from "../../packages/core/src/doctor-help.ts";

describe("checkHelp", () => {
  it("gives one command per OS", () => {
    expect(checkHelp("ffmpeg", "win32")?.command).toBe("winget install Gyan.FFmpeg");
    expect(checkHelp("ffmpeg", "darwin")?.command).toBe("brew install ffmpeg");
    expect(checkHelp("ffmpeg", "linux")?.command).toBe("sudo apt install ffmpeg");
  });

  it("uses the configured python for yt-dlp", () => {
    expect(checkHelp("yt-dlp", "win32", "py")?.command).toBe('py -m pip install -U "yt-dlp[default]"');
  });

  it("has a why and a success line for every known check", () => {
    for (const id of ["node", "ffmpeg", "libass", "one-cli", "one-auth", "typesafe", "jev-action", "jev-call", "yt-dlp", "transcriber", "planner", "remotion"]) {
      const h = checkHelp(id, "linux");
      expect(h?.why, id).toBeTruthy();
      expect(h?.done, id).toBeTruthy();
    }
    expect(checkHelp("unknown", "linux")).toBeUndefined();
  });
});
