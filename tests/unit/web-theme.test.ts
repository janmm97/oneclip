import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_KEY, themeBootScript } from "../../apps/web/lib/theme";

/** Runs the inline <head> script against fake browser globals and returns the theme it set. */
function boot(stored: string | null, osPrefersLight: boolean, storageThrows = false) {
  const documentElement = { dataset: {} as Record<string, string> };
  const localStorage = {
    getItem: (k: string) => {
      if (storageThrows) throw new Error("blocked");
      return k === THEME_KEY ? stored : null;
    },
  };
  const matchMedia = (q: string) => ({ matches: q.includes("light") && osPrefersLight });
  new Function("localStorage", "matchMedia", "document", themeBootScript)(localStorage, matchMedia, { documentElement });
  return documentElement.dataset.theme;
}

describe("theme", () => {
  const cases: [string | null, boolean, string][] = [
    ["light", false, "light"],
    ["dark", true, "dark"],
    [null, true, "light"],
    [null, false, "dark"],
    ["purple", true, "light"],
  ];

  it.each(cases)("stored %s, OS light %s → %s", (stored, os, want) => {
    expect(resolveTheme(stored, os)).toBe(want);
  });

  it.each(cases)("boot script agrees: stored %s, OS light %s → %s", (stored, os, want) => {
    expect(boot(stored, os)).toBe(want);
  });

  it("boot script falls back to dark when storage is blocked", () => {
    expect(boot("light", true, true)).toBe("dark");
  });
});
