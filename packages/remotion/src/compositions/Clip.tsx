import type { CSSProperties } from "react";
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { CAPTION_STYLES, frameOf, SPLIT_Y, type Caption, type EditPlan } from "@oneclip/core/browser";

export interface ClipProps {
  plan: EditPlan;
  /** URL of the source video (a 127.0.0.1 URL when rendering, a /api URL in the Player). */
  src: string;
  [key: string]: unknown;
}

/** ASS &HAABBGGRR to CSS rgba. */
export function assToCss(c: string): string {
  const h = c.replace(/^&H/i, "").padStart(8, "0");
  const a = 1 - parseInt(h.slice(0, 2), 16) / 255;
  const [b, g, r] = [h.slice(2, 4), h.slice(4, 6), h.slice(6, 8)].map((x) => parseInt(x, 16));
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

/** Same envelope as the FFmpeg path, with short eases so punch-ins don't jump. */
export function zoomAt(t: number, plan: EditPlan): number {
  let s = 1;
  for (const z of plan.zoomEvents) {
    if (t < z.at || t > z.at + z.duration) continue;
    const ease = Math.min(1, (t - z.at) / 0.12, (z.at + z.duration - t) / 0.12);
    s += (z.scale - 1) * ease;
  }
  if (plan.editing.transitionPreset === "punch-in") s *= interpolate(t, [0, 0.4], [1.08, 1], { extrapolateRight: "clamp" });
  return s;
}

/** Same timing as the FFmpeg path: a cut lasts (end - start) / speed. */
const cutFrames = (c: EditPlan["cuts"][number], fps: number) => Math.max(1, Math.round(((c.end - c.start) / (c.speed ?? 1)) * fps));

function Footage({ plan, src }: ClipProps) {
  const { fps } = useVideoConfig();
  let from = 0;
  return (
    <>
      {plan.cuts.map((c, i) => {
        const frames = cutFrames(c, fps);
        const f = frameOf(c, plan);
        const rate = c.speed ?? 1;
        const trim = Math.round(c.start * fps);
        // The picture's own sound plays unless the shot is muted or borrows sound from another moment.
        const ownSound = !c.muted && c.audioFrom === undefined;
        const volume = c.volume ?? 1;
        const video = (style: CSSProperties, sound = true) => <OffthreadVideo src={src} trimBefore={trim} playbackRate={rate} muted={!sound || !ownSound} volume={volume} style={style} />;
        const seq = (
          <Sequence key={i} from={from} durationInFrames={frames} layout="none">
            {f.mode === "fit" ? (
              <>
                {video({ ...cover(0.5, 0.5), filter: "blur(40px) brightness(0.6)", transform: "scale(1.15)" }, false)}
                {video({ position: "absolute", width: "100%", height: "100%", objectFit: "contain" })}
              </>
            ) : f.mode === "split" ? (
              // Same maths as FFmpeg: cover each half, zoom, then place the window at x/y.
              <>
                <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "50%", overflow: "hidden" }}>
                  {video(zoomed(f.x ?? 0.5, f.y ?? SPLIT_Y, f.zoom ?? 1))}
                </div>
                <div style={{ position: "absolute", left: 0, top: "50%", width: "100%", height: "50%", overflow: "hidden" }}>
                  {video(zoomed(f.x2 ?? 0.5, f.y2 ?? SPLIT_Y, f.zoom ?? 1), false)}
                </div>
              </>
            ) : (
              video(cover(f.x ?? 0.5, f.y ?? 0.5))
            )}
            {!c.muted && c.audioFrom !== undefined ? <Audio src={src} trimBefore={Math.round(c.audioFrom * fps)} playbackRate={rate} volume={volume} /> : null}
          </Sequence>
        );
        from += frames;
        return seq;
      })}
    </>
  );
}

/** Audio bed from another moment, lowered while someone speaks. */
function Bed({ plan, src }: ClipProps) {
  const { fps } = useVideoConfig();
  const b = plan.bed;
  if (!b) return null;
  const frames = Math.max(1, Math.round((b.end - b.start) * fps));
  const gain = (f: number) => (b.duckUnder.some((r) => f / fps >= r.start && f / fps <= r.end) ? b.volume * b.duck : b.volume);
  return (
    <Sequence from={0} durationInFrames={frames} layout="none">
      <Audio src={src} trimBefore={Math.round(b.start * fps)} volume={gain} />
    </Sequence>
  );
}

/** Window position x/y (0..1) has the same meaning as CSS object-position. */
const cover = (x: number, y: number): CSSProperties => ({ position: "absolute", width: "100%", height: "100%", objectFit: "cover", objectPosition: `${x * 100}% ${y * 100}%` });
/** Cover, then zoom about the window position: scaling about the same point keeps (scaled − box) · x as the offset. */
const zoomed = (x: number, y: number, z: number): CSSProperties => ({ ...cover(x, y), transform: `scale(${z})`, transformOrigin: `${x * 100}% ${y * 100}%` });

function Captions({ plan, boxed }: { plan: EditPlan; boxed?: boolean }) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const st = CAPTION_STYLES[plan.editing.captionPreset];
  const page: Caption | undefined = plan.captions.find((c) => t >= c.start && t < c.end);
  if (!page) return null;
  const size = Math.round(height * st.size * 0.85);
  return (
    // Centred on `y` of the frame height (a %-padding would be % of the width and put captions over faces).
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${(page.y ?? st.y) * 100}%`,
          transform: "translate(-50%, -50%)",
          width: "max-content",
          maxWidth: "84%",
          textAlign: "center",
          fontFamily: `"${st.font}", Arial, sans-serif`,
          fontWeight: 900,
          fontSize: size,
          lineHeight: 1.15,
          color: assToCss(st.primary),
          WebkitTextStroke: `${Math.max(1, st.outline / 2)}px black`,
          paintOrder: "stroke fill",
          textShadow: "0 4px 12px rgba(0,0,0,0.6)",
          padding: boxed ? "0.2em 0.45em" : 0,
          background: boxed ? "rgba(0,0,0,0.55)" : undefined,
          borderRadius: boxed ? "0.3em" : undefined,
        }}
      >
        {page.words.map((w, i) => {
          const next = page.words[i + 1];
          const active = t >= w.start && t < (next ? next.start : page.end);
          const pop = active ? interpolate(t - w.start, [0, 0.08], [1.0, 1.08], { extrapolateRight: "clamp" }) : 1;
          return (
            <span
              key={`${w.start}-${i}`}
              style={{
                display: "inline-block",
                // Emphasis is a real size (layout makes room); a scale() would overlap the next word.
                margin: "0 0.16em",
                fontSize: w.emphasis ? "1.15em" : undefined,
                color: active ? assToCss(st.highlight) : undefined,
                transform: `scale(${pop})`,
              }}
            >
              {st.upper ? w.text.toUpperCase() : w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function Title({ text, until }: { text: string; until: number }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  if (!text) return null;
  const t = frame / fps;
  const o = interpolate(t, [0, 0.25, until - 0.3, until], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (o <= 0) return null;
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: "9%" }}>
      <div style={{ opacity: o, maxWidth: "82%", padding: "0.4em 0.8em", borderRadius: 999, background: "rgba(10,10,12,0.78)", color: "white", fontFamily: "Arial, sans-serif", fontWeight: 700, fontSize: width * 0.042, textAlign: "center" }}>{text}</div>
    </AbsoluteFill>
  );
}

function Progress() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start" }}>
      <div style={{ height: 10, width: `${(frame / durationInFrames) * 100}%`, background: "#4DC9FF" }} />
    </AbsoluteFill>
  );
}

/** One component, three looks. The plan decides everything; nothing here runs plan text. */
export function Clip(props: ClipProps) {
  const { plan } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const scale = zoomAt(t, plan);
  const end = durationInFrames / fps;
  const fade = plan.editing.transitionPreset === "fade" || plan.template === "storytelling-short";
  const opacity = fade ? interpolate(t, [0, 0.35, end - 0.35, end], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, opacity }}>
        <Footage {...props} />
      </AbsoluteFill>
      <Bed {...props} />
      {plan.template === "storytelling-short" && (
        <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.65) 100%)" }} />
      )}
      {plan.template === "educational-short" && <Progress />}
      <Title text={plan.title} until={plan.template === "educational-short" ? end : 2.5} />
      <Captions plan={plan} boxed={plan.template === "educational-short"} />
    </AbsoluteFill>
  );
}
