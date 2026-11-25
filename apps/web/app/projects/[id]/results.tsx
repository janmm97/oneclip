"use client";

import { HOOK_TYPES, type HookType, WEIGHTS } from "@oneclip/core/browser";
import { Clip, planVideoConfig } from "@oneclip/remotion/compositions";
import { Player } from "@remotion/player";
import { Clapperboard, Eye, Meh, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Meter, Notice } from "@/components/ui";
import type { ClipRow, View } from "@/lib/use-project";
import { api, cn, fmtTime } from "@/lib/utils";

const DIMENSIONS: Record<keyof typeof WEIGHTS, string> = {
  hookStrength: "Hook",
  standaloneClarity: "Clarity",
  narrativePayoff: "Payoff",
  novelty: "Novelty",
  emotionalEngagement: "Emotion",
  editingSuitability: "Editability",
};
const hookName = (h: HookType) => (h === "none" ? "No clear hook" : h.replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase()));

export function Results({ projectId, view, clips, refresh }: { projectId: string; view: View; clips: ClipRow[]; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState(clips[0].id);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const clip = clips.find((c) => c.id === selected) ?? clips[0];

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

  const pending = (clipId: string) => view.jobs.some((j) => j.kind === "render" && j.clipId === clipId && (j.status === "queued" || j.status === "running"));
  const anyPending = view.jobs.some((j) => j.kind === "render" && (j.status === "queued" || j.status === "running"));
  const lastFail = view.renders.find((r) => r.clipId === clip.id && r.status === "failed");

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section aria-labelledby="ranked">
        <div className="flex items-center justify-between">
          <h2 id="ranked" className="text-sm font-medium text-muted">
            Ranked by Jev
          </h2>
          <Button size="sm" variant="primary" onClick={() => render("final")} loading={busy === "final:all"} disabled={anyPending}>
            <Clapperboard aria-hidden />
            Render all
          </Button>
        </div>
        <ol className="mt-3 grid gap-2">
          {clips.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setSelected(c.id)}
                aria-current={c.id === clip.id}
                className={cn(
                  "grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  c.id === clip.id ? "border-tally/60 bg-raised" : "border-line bg-panel hover:bg-raised",
                )}
              >
                <span className={cn("num text-lg font-semibold", c.rank === 1 ? "text-tally" : "text-muted")}>{c.rank}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm">“{c.candidate.openingText}”</span>
                  <span className="num text-xs text-muted">
                    {fmtTime(c.candidate.start)}–{fmtTime(c.candidate.end)} · {hookName(c.evaluation.hookType)}
                    {pending(c.id) ? " · rendering" : ""}
                  </span>
                </span>
                <span className="num text-sm font-medium">{Math.round(c.evaluation.final * 100)}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label={`Clip ${clip.rank}`} className="grid content-start gap-6 rounded-lg border border-line bg-panel p-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-60">
          {clip.plan ? (
            <Player
              key={clip.id}
              component={Clip}
              inputProps={{ plan: clip.plan, src: `/api/media/source/${projectId}` }}
              compositionWidth={planVideoConfig(clip.plan).width}
              compositionHeight={planVideoConfig(clip.plan).height}
              fps={planVideoConfig(clip.plan).fps}
              durationInFrames={planVideoConfig(clip.plan).durationInFrames}
              controls
              acknowledgeRemotionLicense
              style={{ width: "100%", aspectRatio: `${planVideoConfig(clip.plan).width} / ${planVideoConfig(clip.plan).height}`, borderRadius: 8, overflow: "hidden", background: "black" }}
            />
          ) : (
            <div className="grid aspect-9/16 place-items-center rounded-lg bg-bg p-4 text-center text-xs text-muted">{clip.planError ?? "No edit plan for this clip."}</div>
          )}
        </div>

        <div className="grid content-start gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="tally">{hookName(clip.evaluation.hookType)}</Badge>
              {clip.evaluation.penalties.map((p) => (
                <Badge key={p} tone="warn">
                  {p}
                </Badge>
              ))}
              <span className="ml-auto text-xs text-muted">{clip.planner ? `Plan: ${clip.planner}` : null}</span>
            </div>
            {clip.evaluation.hookType !== "none" ? <p className="mt-2 text-sm text-muted">{HOOK_TYPES[clip.evaluation.hookType]}</p> : null}
          </div>

          <dl className="grid gap-2">
            {(Object.keys(DIMENSIONS) as (keyof typeof WEIGHTS)[]).map((d) => (
              <div key={d} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-sm">
                <dt className="text-muted">
                  {DIMENSIONS[d]} <span className="num text-xs">×{WEIGHTS[d]}</span>
                </dt>
                <dd>
                  <Meter value={clip.evaluation.scores[d]} label={DIMENSIONS[d]} />
                </dd>
              </div>
            ))}
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 border-t border-line pt-2 text-sm">
              <dt className="text-muted">Stands alone</dt>
              <dd>
                <Meter value={clip.evaluation.contextIntegrity} label="Context integrity" />
              </dd>
            </div>
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <dt className="font-medium">Final</dt>
              <dd>
                <Meter value={clip.evaluation.final} label="Final score" tone="tally" />
              </dd>
            </div>
          </dl>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted hover:text-fg">Transcript</summary>
            <p className="mt-2 max-h-48 overflow-auto leading-relaxed">{clip.candidate.transcript}</p>
          </details>

          {lastFail && !pending(clip.id) ? <Notice tone="warn">Last render failed: {lastFail.error}</Notice> : null}
          {error ? <Notice>{error}</Notice> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
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
        </div>
      </section>
    </div>
  );
}
