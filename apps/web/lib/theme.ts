export type Theme = "dark" | "light";
export const THEME_KEY = "oneclip-theme";

/** The user's pick wins; otherwise follow the OS; otherwise dark. */
export function resolveTheme(stored: string | null, osPrefersLight: boolean): Theme {
  if (stored === "dark" || stored === "light") return stored;
  return osPrefersLight ? "light" : "dark";
}

/** Runs before first paint (inline in <head>) so the page never flashes the wrong theme. Mirrors resolveTheme. */
export const themeBootScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}`;
