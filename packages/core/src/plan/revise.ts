import { CROP_X } from "./frame.ts";
import type { EditPlan, Frame, PlanDraft, Segment } from "./schema.ts";

/**
 * Chat edits. A finished plan goes back to a draft whose shots are the plan's
 * cuts (a scene mix, so order, framing, speed and sound stay as they are),
 * the change is made on that draft, and compilePlan validates it again.
 */

/** A plan as an editable draft: one segment per cut, punch-ins back in source time. */
export function planToDraft(plan: EditPlan): PlanDraft {
  const segments: Segment[] = plan.cuts.map((c) => ({ ...c }));
  const zoomAt = plan.zoomEvents.flatMap((z) => {
    let acc = 0;
    for (const c of plan.cuts) {
      const len = (c.end - c.start) / (c.speed ?? 1);
      if (z.at <= acc + len) return [c.start + (z.at - acc) * (c.speed ?? 1)];
      acc += len;
    }
    return [];
  });
  const emphasis = [...new Set(plan.captions.flatMap((p) => p.words.filter((w) => w.emphasis).map((w) => w.text.replace(/[^\p{L}\p{N}%$']/gu, ""))))].filter(Boolean).slice(0, 30);
  return {
    template: plan.template,
    layout: plan.editing.layout,
    cropMode: plan.editing.cropMode,
    captionPreset: plan.editing.captionPreset,
    transitionPreset: plan.editing.transitionPreset,
    zoomIntensity: plan.editing.zoomIntensity,
    removeSilences: false,
    keep: [],
    zoomAt: zoomAt.slice(0, 20),
    emphasis: emphasis.map((e) => e.slice(0, 40)),
    title: plan.title,
    reasoning: plan.reasoning,
    segments,
    ...(plan.bed ? { bed: { start: plan.bed.start, end: plan.bed.end, volume: plan.bed.volume, duck: plan.bed.duck } } : {}),
  };
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Which shots a clause names (0-based), or every shot. "shot 2", "shots 2-4", "shots 1 and 3", "first/last shot". */
function shotsIn(text: string, count: number): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  if (/\b(first|opening) (shot|scene)\b/.test(text)) return [0];
  if (/\b(last|final) (shot|scene)\b/.test(text)) return [count - 1];
  const m = text.match(/\b(?:shots?|scenes?)\s+((?:\d+\s*(?:-|to|and|,|&)?\s*)+)/);
  if (!m) return all;
  const picked = new Set<number>();
  for (const part of (m[1] as string).split(/,|and|&/)) {
    const [a, b] = part.split(/-|to/).map((s) => Number.parseInt(s, 10));
    if (!Number.isFinite(a)) continue;
    for (let i = a as number; i <= (Number.isFinite(b) ? (b as number) : (a as number)); i++) if (i >= 1 && i <= count) picked.add(i - 1);
  }
  return [...picked].sort((x, y) => x - y);
}

const seconds = (text: string) => {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:s\b|sec|second)/);
  return m ? Number.parseFloat(m[1] as string) : undefined;
};

/**
 * The deterministic editor: plain requests a viewer types ("split shot 2",
 * "karaoke captions", "make it faster", "mute shot 3", "cut the first 2 seconds").
 * Returns the edited draft, or undefined when no rule understood the request.
 */
export function applyInstruction(draft: PlanDraft, instruction: string): PlanDraft | undefined {
  const d: PlanDraft = structuredClone(draft);
  d.segments ??= [];
  let understood = false;
  for (const raw of instruction.split(/[;\n]+|\.(?!\d)|,?\s+(?:and then|then|also)\s+|,(?!\s*\d)/i)) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    const segs: Segment[] = d.segments;
    const ids = shotsIn(t, segs.length);
    const each = (f: (s: Segment) => void) => {
      for (const i of ids) f(segs[i] as Segment);
      understood ||= ids.length > 0;
    };
    const frame = (s: Segment, f: Frame) => {
      s.frame = f;
    };
    // Captions, transitions, zoom punch-ins, title: whole clip.
    if (/karaoke/.test(t)) (d.captionPreset = "karaoke"), (understood = true);
    else if (/\bclean\b.*caption|caption.*\b(clean|simple|minimal)\b/.test(t)) (d.captionPreset = "clean"), (understood = true);
    else if (/\bbold\b|\bpop\b/.test(t) && /caption|text|subtitle/.test(t)) (d.captionPreset = "bold-pop"), (understood = true);
    const title = raw.trim().match(/\btitle\b\s*(?:to|:|=|as|is)\s*["“']?([^"”]{2,80}?)["”']?$/i);
    if (title) {
      d.title = (title[1] as string).trim();
      understood = true;
      continue;
    }
    if (/no (zoom|punch)|(remove|stop|without) (the )?(zoom|punch)/.test(t)) (d.zoomAt = []), (d.zoomIntensity = 0), (understood = true);
    else if (/more (zoom|punch)|(stronger|bigger) (zoom|punch)/.test(t)) (d.zoomIntensity = 0.2), (understood = true);
    if (/no transition|hard cut/.test(t)) (d.transitionPreset = "none"), (understood = true);
    else if (/\bfade/.test(t)) (d.transitionPreset = "fade"), (understood = true);

    // Shots: remove, frame, speed, sound.
    if (/\b(remove|delete|drop|cut out|skip)\b/.test(t) && /\b(shot|scene)/.test(t)) {
      const keep: Segment[] = segs.filter((_, i) => !ids.includes(i));
      if (keep.length && keep.length < segs.length) (d.segments = keep), (understood = true);
      continue;
    }
    if (/split|side.by.side|both (people|speakers|faces)|reaction/.test(t)) each((s) => frame(s, { mode: "split" }));
    else if (/\bfit\b|whole (shot|frame|scene)|zoom out|show everything|\bwide\b/.test(t)) each((s) => frame(s, { mode: "fit" }));
    else if (/\b(left|right|cent(er|re))\b/.test(t) && /focus|crop|frame|move|pan|show|on the/.test(t)) {
      const x = /\bleft\b/.test(t) ? CROP_X["left-third"] : /\bright\b/.test(t) ? CROP_X["right-third"] : CROP_X.center;
      each((s) => frame(s, { mode: "crop", x, y: 0.5 }));
    } else if (/zoom in|closer|tighter/.test(t)) each((s) => frame(s, { ...(s.frame?.mode === "crop" ? s.frame : { mode: "crop" as const, x: 0.5, y: 0.5 }), zoom: clamp(round((s.frame?.zoom ?? 1) * 1.3), 1, 3) }));
    else if (/follow|fill the frame|full ?screen|\bcrop\b/.test(t)) each((s) => frame(s, { mode: "crop", x: s.frame?.x ?? 0.5, y: s.frame?.y ?? 0.5 }));

    if (/slow.?mo/.test(t)) each((s) => (s.speed = 0.5));
    else if (/(\d(?:\.\d+)?)\s*x\b/.test(t) && /speed|play|x\b/.test(t)) {
      const v = clamp(Number.parseFloat((t.match(/(\d(?:\.\d+)?)\s*x\b/) as RegExpMatchArray)[1] as string), 0.5, 2);
      each((s) => (s.speed = v));
    } else if (/faster|speed (it )?up|quicker/.test(t)) each((s) => (s.speed = clamp(round((s.speed ?? 1) * 1.25), 0.5, 2)));
    else if (/slower|slow (it )?down/.test(t)) each((s) => (s.speed = clamp(round((s.speed ?? 1) / 1.25), 0.5, 2)));
    else if (/normal speed|real.?time/.test(t)) each((s) => delete s.speed);

    if (/\bunmute\b/.test(t)) each((s) => delete s.muted);
    else if (/\bmute|silence the|no sound/.test(t)) each((s) => (s.muted = true));
    else if (/louder|turn (it )?up|more volume|boost/.test(t)) each((s) => (s.volume = clamp(round((s.volume ?? 1) * 1.5), 0, 2)));
    else if (/quieter|softer|turn (it )?down|less volume|lower the (volume|audio|sound)/.test(t)) each((s) => (s.volume = clamp(round((s.volume ?? 1) * 0.6), 0, 2)));

    // Trims: "cut the first 2 seconds", "trim 1.5 s off the end".
    const n = seconds(t);
    if (n && /\b(trim|cut|shorten|remove|drop)\b/.test(t) && segs.length) {
      if (/\b(first|start|beginning|intro|opening)\b/.test(t)) {
        const s = segs[0] as Segment;
        if (s.end - s.start > n + 0.5) (s.start = round(s.start + n)), (understood = true);
      } else if (/\b(last|end|ending|outro)\b/.test(t)) {
        const s = segs[segs.length - 1] as Segment;
        if (s.end - s.start > n + 0.5) (s.end = round(s.end - n)), (understood = true);
      }
    }
  }
  return understood ? d : undefined;
}

const frameName = (f?: Frame) => (!f ? "auto framing" : f.mode === "split" ? "split screen" : f.mode === "fit" ? "whole shot" : f.zoom && f.zoom > 1 ? `zoomed ${f.zoom}×` : `follow at ${Math.round((f.x ?? 0.5) * 100)}%`);

/** What changed between two drafts, as lines for the live edit feed ("Shot 2: split screen", "Captions: karaoke"). */
export function describeChanges(before: PlanDraft, after: PlanDraft): string[] {
  const out: string[] = [];
  const a = before.segments ?? [];
  const b = after.segments ?? [];
  if (b.length !== a.length) out.push(`Cutting: ${a.length} shots → ${b.length} shots`);
  else
    b.forEach((s, i) => {
      const o = a[i] as Segment;
      const n = `Shot ${i + 1}`;
      if (round(s.start) !== round(o.start) || round(s.end) !== round(o.end)) out.push(`${n}: trimmed to ${round(s.end - s.start, 1)} s`);
      if (frameName(s.frame) !== frameName(o.frame)) out.push(`${n}: ${frameName(s.frame)}`);
      if ((s.speed ?? 1) !== (o.speed ?? 1)) out.push(`${n}: speed ${s.speed ?? 1}×`);
      if (!!s.muted !== !!o.muted) out.push(`${n}: ${s.muted ? "muted" : "sound back on"}`);
      if ((s.volume ?? 1) !== (o.volume ?? 1)) out.push(`${n}: volume ${Math.round((s.volume ?? 1) * 100)}%`);
    });
  if (after.captionPreset !== before.captionPreset) out.push(`Captions: ${after.captionPreset}`);
  if (after.transitionPreset !== before.transitionPreset) out.push(`Transitions: ${after.transitionPreset}`);
  if (after.zoomIntensity !== before.zoomIntensity || after.zoomAt.length !== before.zoomAt.length) out.push(after.zoomIntensity > 0 && after.zoomAt.length ? `Zoom punch-ins: ${after.zoomAt.length} at ${Math.round(after.zoomIntensity * 100)}%` : "Zoom punch-ins: off");
  if (after.title !== before.title) out.push(`Title: ${after.title}`);
  if ((after.bed?.volume ?? 0) !== (before.bed?.volume ?? 0)) out.push(`Music bed: ${Math.round((after.bed?.volume ?? 0) * 100)}%`);
  return out;
}

/** Examples the UI and error messages show. */
export const EDIT_EXAMPLES = ["split shot 2", "show the whole shot on shot 1", "karaoke captions", "make it faster", "mute shot 3", "cut the first 2 seconds", "remove shot 4", "title: The one habit that changed everything"];
