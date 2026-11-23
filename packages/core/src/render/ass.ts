import type { EditPlan } from "../plan/schema.ts";

/** Caption looks shared by both renderers (colors are ASS &HBBGGRR). */
export const CAPTION_STYLES = {
  "bold-pop": { font: "Arial Black", size: 0.06, primary: "&H00FFFFFF", highlight: "&H0000E5FF", outline: 6, upper: true, y: 0.68 },
  clean: { font: "Arial", size: 0.05, primary: "&H00FFFFFF", highlight: "&H00FFC94D", outline: 3, upper: false, y: 0.78 },
  karaoke: { font: "Arial Black", size: 0.055, primary: "&H80FFFFFF", highlight: "&H0066FF66", outline: 5, upper: true, y: 0.7 },
} as const;

export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Transcript text is untrusted: strip anything ASS could read as an override tag or line break. */
export function assEscape(text: string): string {
  return text.replace(/[{}\\]/g, "").replace(/[\r\n]+/g, " ");
}

/**
 * Word-highlight captions as ASS: one event per spoken word, showing the whole
 * caption page with the current word highlighted (emphasised words stay bigger).
 */
export function buildAss(plan: EditPlan): string {
  const st = CAPTION_STYLES[plan.editing.captionPreset];
  const { width: W, height: H } = plan.output;
  const size = Math.round(H * st.size * 0.85);
  const head = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,${st.font},${size},${st.primary},&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${st.outline},2,2,${Math.round(W * 0.08)},${Math.round(W * 0.08)},${Math.round(H * (1 - st.y))},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines: string[] = [];
  for (const page of plan.captions) {
    page.words.forEach((w, i) => {
      const end = i + 1 < page.words.length ? (page.words[i + 1] as typeof w).start : page.end;
      if (end <= w.start) return;
      const text = page.words
        .map((x, j) => {
          const t = assEscape(st.upper ? x.text.toUpperCase() : x.text);
          const big = x.emphasis ? "\\fscx115\\fscy115" : "";
          return j === i ? `{\\c${st.highlight}${big}}${t}{\\r}` : big ? `{${big}}${t}{\\r}` : t;
        })
        .join(" ");
      lines.push(`Dialogue: 0,${assTime(w.start)},${assTime(end)},Cap,,0,0,0,,${text}`);
    });
  }
  return `${[...head, ...lines].join("\n")}\n`;
}
