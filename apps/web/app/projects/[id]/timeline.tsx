"use client";

import type { EditPlan } from "@oneclip/core/browser";
import { Crosshair, Expand, Rows2, VolumeX, ZoomIn } from "lucide-react";
import { cn, fmtTime } from "@/lib/utils";

type Cut = EditPlan["cuts"][number];
const lengthOut = (c: Cut) => (c.end - c.start) / (c.speed ?? 1);

function FrameIcon({ cut }: { cut: Cut }) {
  const f = cut.frame;
  if (f?.mode === "split") return <Rows2 aria-label="split screen" />;
  if (f?.mode === "fit") return <Expand aria-label="whole shot" />;
  if (f?.zoom && f.zoom > 1) return <ZoomIn aria-label={`zoomed ${f.zoom}×`} />;
  return <Crosshair aria-label={f ? "follow" : "auto framing"} />;
}

/** The clip as an editor sees it: shots and captions on one output-time axis, with the playhead. Click a shot to jump to it. */
export function Timeline({ plan, at, onSeek }: { plan: EditPlan; at: number; onSeek: (t: number) => void }) {
  const total = plan.cuts.reduce((s, c) => s + lengthOut(c), 0) || 1;
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / total) * 100))}%`;
  let acc = 0;
  const shots = plan.cuts.map((c, i) => {
    const start = acc;
    acc += lengthOut(c);
    return { c, i, start, end: acc };
  });
  const ticks = Array.from({ length: Math.floor(total / 5) + 1 }, (_, i) => i * 5);

  return (
    <section aria-label="Timeline" className="glass rounded-lg p-3">
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
        <span />
        <div className="relative h-4 text-muted" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="num absolute -translate-x-1/2 first:translate-x-0" style={{ left: pct(t) }}>
              {fmtTime(t)}
            </span>
          ))}
        </div>

        <span className="self-center text-muted">Shots</span>
        <div className="relative">
          <ol className="flex h-11 gap-0.5 overflow-hidden rounded-md">
            {shots.map(({ c, i, start, end }) => {
              const live = at >= start && at < end;
              return (
                <li key={i} style={{ width: pct(end - start) }} className="min-w-0">
                  <button
                    onClick={() => onSeek(start)}
                    title={`Shot ${i + 1}: ${fmtTime(c.start)}–${fmtTime(c.end)} in the source, ${(end - start).toFixed(1)} s`}
                    aria-current={live || undefined}
                    className={cn(
                      "press flex h-full w-full items-center gap-1 overflow-hidden pr-1.5 pl-2.5 text-left transition-colors duration-150 [&_svg]:size-3 [&_svg]:shrink-0",
                      live ? "bg-tally/25 text-fg ring-1 ring-tally ring-inset" : "bg-raised text-muted hover:bg-line/70 hover:text-fg",
                    )}
                  >
                    <span className="num font-medium">{i + 1}</span>
                    <FrameIcon cut={c} />
                    {c.speed && c.speed !== 1 ? <span className="num">{c.speed}×</span> : null}
                    {c.muted ? <VolumeX aria-label="muted" /> : null}
                  </button>
                </li>
              );
            })}
          </ol>
          {/* Stays inside the shots row so it never covers the ruler labels (0:00 included). */}
          <span className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-tally shadow-[0_0_8px_var(--color-tally)]" style={{ left: pct(at) }} aria-hidden />
        </div>

        <span className="self-center text-muted">Captions</span>
        <div className="relative h-7 overflow-hidden rounded-md bg-raised">
          {plan.captions.map((p, i) => (
            <span
              key={i}
              className="absolute inset-y-0.5 truncate rounded-sm border-l-2 border-tally/60 bg-panel-strong px-1 leading-6 text-muted"
              style={{ left: pct(p.start), width: pct(p.end - p.start) }}
              title={p.words.map((w) => w.text).join(" ")}
            >
              {p.words.map((w) => w.text).join(" ")}
            </span>
          ))}
          {!plan.captions.length ? <span className="px-2 leading-7 text-muted">No captions</span> : null}
        </div>

        {plan.zoomEvents.length ? (
          <>
            <span className="self-center text-muted">Punch-ins</span>
            <div className="relative h-3">
              {plan.zoomEvents.map((z, i) => (
                <span key={i} className="absolute inset-y-0 rounded-sm bg-tally/40" style={{ left: pct(z.at), width: pct(z.duration) }} title={`Zoom ${Math.round((z.scale - 1) * 100)}% at ${fmtTime(z.at)}`} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
