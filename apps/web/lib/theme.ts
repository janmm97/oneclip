export type Theme = "dark" | "light";
export const THEME_KEY = "oneclip-theme";

/** The user's pick wins; otherwise follow the OS; otherwise dark. */
export function resolveTheme(stored: string | null, osPrefersLight: boolean): Theme {
  if (stored === "dark" || stored === "light") return stored;
  return osPrefersLight ? "light" : "dark";
}

/** Runs before first paint (inline in <head>) so the page never flashes the wrong theme. Mirrors resolveTheme. */
export const themeBootScript = `var t=null;try{t=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}if(t!=="dark"&&t!=="light"){try{t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}catch(e){t="dark"}}document.documentElement.dataset.theme=t`;
