import { describe, expect, it } from "vitest";
import { clampTopN, placesLabel, toggleRatio } from "../../apps/web/lib/form";

describe("clampTopN", () => {
  it.each([
    [5, 5],
    [0, 1],
    [-3, 1],
    [21, 20],
    [4.6, 5],
    [Number.NaN, 1],
  ])("%s → %s", (n, want) => expect(clampTopN(n)).toBe(want));
});

describe("toggleRatio", () => {
  it("adds a ratio that is off", () => expect(toggleRatio(["9:16"], "1:1")).toEqual(["9:16", "1:1"]));
  it("removes a ratio that is on", () => expect(toggleRatio(["9:16", "1:1"], "9:16")).toEqual(["1:1"]));
  it("keeps the last ratio", () => expect(toggleRatio(["9:16"], "9:16")).toEqual(["9:16"]));
});

describe("placesLabel", () => {
  it("names the default", () => expect(placesLabel(["9:16"])).toBe("TikTok, Reels, Shorts"));
  it("follows menu order, not pick order", () => expect(placesLabel(["1:1", "9:16"])).toBe("TikTok, Reels, Shorts · Square"));
  it("shortens three or more", () => expect(placesLabel(["16:9", "4:3", "9:16"])).toBe("TikTok, Reels, Shorts + 2 more"));
});
