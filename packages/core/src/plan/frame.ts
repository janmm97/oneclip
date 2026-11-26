import type { EditPlan, Frame } from "./schema.ts";

/** Crop-window position for the old crop modes (0 = left edge, 1 = right edge). */
export const CROP_X = { center: 0.5, "left-third": 0.2, "right-third": 0.8 } as const;
/** Default vertical position of a split half's window: a little above centre, where heads usually are. */
export const SPLIT_Y = 0.4;

type Cut = EditPlan["cuts"][number];

/** How a cut fills the frame: its own `frame`, else the plan's layout and crop mode. */
export function frameOf(cut: Cut, plan: EditPlan): Required<Pick<Frame, "mode">> & Frame {
  if (cut.frame) return cut.frame;
  if (plan.editing.layout === "blur-background") return { mode: "fit" };
  return { mode: "crop", x: CROP_X[cut.cropMode ?? plan.editing.cropMode] };
}

interface Size {
  width: number;
  height: number;
}

/** Where a box `w`×`h` (output px) must sit, as a window position 0..1, to centre source point `c` (0..1) in it. */
function windowPos(c: number, scaled: number, box: number, anchor = 0.5): number {
  if (scaled - box < 1) return 0.5;
  return Math.round(Math.min(1, Math.max(0, (c * scaled - box * anchor) / (scaled - box))) * 1000) / 1000;
}

/** Crop window that centres source x `cx` (0..1) in an output frame `out`. */
export function cropAt(cx: number, src: Size, out: Size): Frame {
  const k = Math.max(out.width / src.width, out.height / src.height);
  return { mode: "crop", x: windowPos(cx, src.width * k, out.width) };
}

/** Fraction of the source width a cover crop shows in `out`. */
export function visibleWidth(src: Size, out: Size): number {
  const k = Math.max(out.width / src.width, out.height / src.height);
  return Math.min(1, out.width / (src.width * k));
}

/**
 * Split screen: subject A (source centre ax, ay) on the top half, B on the bottom, zoomed so each half shows
 * about one subject (at most `dx` of the source width, at least 30%).
 */
export function splitAt(a: { x: number; y: number }, b: { x: number; y: number }, src: Size, out: Size): Frame {
  const half = { width: out.width, height: out.height / 2 };
  const k = Math.max(half.width / src.width, half.height / src.height);
  const vis = Math.min(1, half.width / (src.width * k));
  const target = Math.min(vis, Math.max(0.3, Math.abs(a.x - b.x) * 0.9));
  const zoom = Math.round(Math.min(3, Math.max(1, vis / target)) * 100) / 100;
  const sw = src.width * k * zoom;
  const sh = src.height * k * zoom;
  return {
    mode: "split",
    zoom,
    x: windowPos(a.x, sw, half.width),
    y: windowPos(a.y, sh, half.height, 0.45),
    x2: windowPos(b.x, sw, half.width),
    y2: windowPos(b.y, sh, half.height, 0.45),
  };
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where a source box (fractions) lands in the output (fractions) for a frame. A split shows the source twice,
 * so a box can land in both halves: every half it overlaps gives a box, clipped to that half.
 */
export function boxesOf(b: Box, src: Size, out: Size, f: Frame): Box[] {
  const { width: W, height: H } = out;
  const map = (k: number, ox: number, oy: number, bw: number, bh: number, top: number) => ({
    x0: (b.x0 * src.width * k - ox) / bw,
    x1: (b.x1 * src.width * k - ox) / bw,
    y0: (b.y0 * src.height * k - oy) / bh,
    y1: (b.y1 * src.height * k - oy) / bh,
    top,
  });
  if (f.mode === "fit") {
    const k = Math.min(W / src.width, H / src.height);
    const { top: _, ...r } = map(k, -(W - src.width * k) / 2, -(H - src.height * k) / 2, W, H, 0);
    return [r];
  }
  if (f.mode === "crop") {
    const k = Math.max(W / src.width, H / src.height);
    const { top: _, ...r } = map(k, (src.width * k - W) * (f.x ?? 0.5), (src.height * k - H) * (f.y ?? 0.5), W, H, 0);
    return [r];
  }
  const h = H / 2;
  const k = Math.max(W / src.width, h / src.height) * (f.zoom ?? 1);
  const sw = src.width * k;
  const sh = src.height * k;
  return [
    map(k, (sw - W) * (f.x ?? 0.5), (sh - h) * (f.y ?? SPLIT_Y), W, h, 0),
    map(k, (sw - W) * (f.x2 ?? 0.5), (sh - h) * (f.y2 ?? SPLIT_Y), W, h, 0.5),
  ]
    .filter((r) => r.y1 > 0 && r.y0 < 1)
    .map((r) => ({ x0: r.x0, x1: r.x1, y0: r.top + Math.max(0, r.y0) / 2, y1: r.top + Math.min(1, r.y1) / 2 }));
}
