"use client";

import { HOOK_TYPES, type HookType, planForRatio, ProjectSettingsSchema, type Ratio, WEIGHTS } from "@oneclip/core/browser";
import { Clip, planVideoConfig } from "@oneclip/remotion/compositions";
import { Player, type PlayerRef } from "@remotion/player";
import { Clapperboard, Eye, Meh, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Meter, Notice } from "@/components/ui";
import type { ClipRow, View } from "@/lib/use-project";
import { api, cn, fmtTime } from "@/lib/utils";
import { EditChat } from "./edit-chat";
import { Timeline } from "./timeline";

const DIMENSIONS: Record<keyof typeof WEIGHTS, string> = {
  hookStrength: "Hook",
  standaloneClarity: "Clarity",
  narrativePayoff: "Payoff",
  novelty: "Novelty",
  emotionalEngagement: "Emotion",
  editingSuitability: "Editability",
};
const hookName = (h: HookType) => (h === "none" ? "No clear hook" : h.replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase()));

/** The editor: clips on the left, the monitor and timeline in the middle, the chat that edits the clip on the right. */
export function Results({ projectId, view, clips, refresh }: { projectId: string; view: View; clips: ClipRow[]; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState(clips[0].id);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [at, setAt] = useState(0);
  const player = useRef<PlayerRef>(null);
  const clip = clips.find((c) => c.id === selected) ?? clips[0];
  // Preview in the shape the user picked, framed the way the render will be (not the 9:16 analysis plan).
  const ratios = ProjectSettingsSchema.safeParse(view.project.settings).data?.ratios ?? ["9:16"];
  const [chosen, setRatio] = useState<Ratio>(ratios[0]);
  const ratio = ratios.includes(chosen) ? chosen : ratios[0];
  const source = view.project.sourceInfo as { width?: number; height?: number } | null;
  const shaped = useMemo(() => (clip.plan ? planForRatio(clip.plan, ratio, source) : null), [clip.plan, ratio, source]);
  const video = shaped ? planVideoConfig(shaped) : null;
  const fps = video?.fps ?? 30;

  useEffect(() => {
    setAt(0);
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setAt(e.detail.frame / fps);
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [clip.id, fps, ratio]);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }
  const render = (quality: "preview" | "final", clipId?: string) =>
    act(`${quality}:${clipId ?? "all"}`, () => api(`/api/projects/${projectId}/render`, { method: "POST", body: JSON.stringify({ quality, clipId }) }));
  const rate = (rating: string) => act(`rate:${rating}`, () => api("/api/feedback", { method: "POST", body: JSON.stringify({ projectId, clipId: clip.id, rating }) }));

  const live = (j: View["jobs"][number]) => j.status === "queued" || j.status === "running";
  const pending = (clipId: string) => view.jobs.some((j) => (j.kind === "render" || j.kind === "edit") && j.clipId === clipId && live(j));
  const anyPending = view.jobs.some((j) => j.kind === "render" && live(j));
  const lastFail = view.renders.find((r) => r.clipId === clip.id && r.status === "failed");

  return (
    // Side panels grow with the screen, the monitor takes the rest. --monitor-h sizes the player from the
    // window height so the player and timeline fit on one screen at any size or ratio.
    <div className="mt-4 grid gap-4 [--monitor-h:min(70dvh,40rem)] lg:grid-cols-[minmax(11rem,15vw)_minmax(0,1fr)_minmax(18rem,22vw)] lg:[--monitor-h:clamp(24rem,calc(100dvh_-_30rem),120rem)]">
      <section aria-labelledby="ranked" className="grid content-start gap-3">
        <div className="flex items-center justify-between">
          <h2 id="ranked" className="text-sm font-medium text-muted">
            Clips
          </h2>
          <Button size="sm" variant="primary" onClick={() => render("final")} loading={busy === "final:all"} disabled={anyPending}>
            <Clapperboard aria-hidden />
            Render all
          </Button>
        </div>
        <ol className="grid gap-1.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-1">
          {clips.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setSelected(c.id)}
                aria-current={c.id === clip.id}
                className={cn(
                  "press glass grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-shadow duration-150",
                  c.id === clip.id ? "ring-2 ring-tally/70" : "hover:ring-1 hover:ring-line",
                )}
              >
                <span className={cn("num font-semibold", c.rank === 1 ? "text-tally-fg" : "text-muted")}>{c.rank}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm">“{c.candidate.openingText}”</span>
                  <span className="num block truncate text-xs text-muted">
                    {fmtTime(c.candidate.start)}–{fmtTime(c.candidate.end)}
                    {pending(c.id) ? " · working" : ""}
                  </span>
                </span>
                <span className="num text-xs font-medium">{Math.round(c.evaluation.final * 100)}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label={`Clip ${clip.rank}`} className="glass grid min-w-0 content-start gap-4 rounded-xl p-4">
        <div className="grid place-items-center rounded-lg bg-black/80 p-3">
          {shaped && video ? (
            <Player
              key={`${clip.id}:${ratio}`}
              ref={player}
              component={Clip}
              inputProps={{ plan: shaped, src: `/api/media/source/${projectId}` }}
              compositionWidth={video.width}
              compositionHeight={video.height}
              fps={video.fps}
              durationInFrames={video.durationInFrames}
              controls
              acknowledgeRemotionLicense
              style={{ width: "100%", maxWidth: `calc(var(--monitor-h) * ${video.width} / ${video.height})`, aspectRatio: `${video.width} / ${video.height}`, borderRadius: 6, overflow: "hidden", background: "black" }}
            />
          ) : (
            <div className="grid w-56 place-items-center p-4 text-center text-xs text-muted" style={{ aspectRatio: ratio.replace(":", " / ") }}>
              {clip.planError ?? "No edit plan for this clip."}
            </div>
          )}
        </div>

        {ratios.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Preview shape">
            <span className="mr-1 text-xs text-muted">Shape</span>
            {ratios.map((r) => (
              <Button key={r} size="sm" variant="ghost" aria-pressed={r === ratio} onClick={() => setRatio(r)} className={cn(r === ratio && "bg-raised")}>
                {r}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => render("preview", clip.id)} loading={busy === `preview:${clip.id}`} disabled={pending(clip.id) || !clip.plan}>
            <Eye aria-hidden />
            Quick preview
          </Button>
          <Button size="sm" variant="primary" onClick={() => render("final", clip.id)} loading={busy === `final:${clip.id}`} disabled={pending(clip.id) || !clip.plan}>
            <Clapperboard aria-hidden />
            Render 1080p
          </Button>
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="Rate this pick">
            <span className="mr-1 text-xs text-muted">Good pick?</span>
            {(
              [
                ["good", ThumbsUp, "text-good"],
                ["average", Meh, "text-warn"],
                ["bad", ThumbsDown, "text-bad"],
              ] as const
            ).map(([r, Icon, tone]) => (
              <Button key={r} size="icon" variant="ghost" aria-label={r} aria-pressed={clip.rating === r} onClick={() => rate(r)} disabled={!!busy} className={cn(clip.rating === r && `bg-raised ${tone}`)}>
                <Icon aria-hidden />
              </Button>
            ))}
          </div>
        </div>

        {lastFail && !pending(clip.id) ? <Notice tone="warn">Last render failed: {lastFail.error}</Notice> : null}
        {error ? <Notice>{error}</Notice> : null}

        {clip.plan ? <Timeline plan={clip.plan} at={at} onSeek={(t) => player.current?.seekTo(Math.round(t * fps))} /> : null}

        <details className="group text-sm">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-muted hover:text-fg">
            Why Jev picked it
            <Badge tone="tally">{hookName(clip.evaluation.hookType)}</Badge>
            {clip.evaluation.penalties.map((p) => (
              <Badge key={p} tone="warn">
                {p}
              </Badge>
            ))}
            <span className="ml-auto text-xs">{clip.planner ? `Plan: ${clip.planner}` : null}</span>
          </summary>
          <div className="mt-3 grid gap-4">
            {clip.evaluation.hookType !== "none" ? <p className="text-muted">{HOOK_TYPES[clip.evaluation.hookType]}</p> : null}
            <dl className="grid gap-2 sm:grid-cols-2 sm:gap-x-6">
              {(Object.keys(DIMENSIONS) as (keyof typeof WEIGHTS)[]).map((d) => (
                <div key={d} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
                  <dt className="text-muted">
                    {DIMENSIONS[d]} <span className="num text-xs">×{WEIGHTS[d]}</span>
                  </dt>
                  <dd>
                    <Meter value={clip.evaluation.scores[d]} label={DIMENSIONS[d]} />
                  </dd>
                </div>
              ))}
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
                <dt className="text-muted">Stands alone</dt>
                <dd>
                  <Meter value={clip.evaluation.contextIntegrity} label="Context integrity" />
                </dd>
              </div>
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
                <dt className="font-medium">Final</dt>
                <dd>
                  <Meter value={clip.evaluation.final} label="Final score" tone="tally" />
                </dd>
              </div>
            </dl>
            <div>
              <p className="text-muted">Transcript</p>
              <p className="mt-1 max-h-48 overflow-auto leading-relaxed">{clip.candidate.transcript}</p>
            </div>
          </div>
        </details>
      </section>

      {clip.plan ? (
        <EditChat key={clip.id} projectId={projectId} clipId={clip.id} jobs={view.jobs} refresh={refresh} />
      ) : (
        <p className="glass rounded-xl p-4 text-sm text-muted">This clip has no edit plan yet, so there is nothing to edit.</p>
      )}
    </div>
  );
}
