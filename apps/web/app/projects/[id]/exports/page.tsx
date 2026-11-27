"use client";

import { ArrowLeft, Download, FileArchive } from "lucide-react";
import { use } from "react";
import { Badge, ButtonLink, Notice } from "@/components/ui";
import type { ProjectView } from "@/lib/server";
import { useProject } from "@/lib/use-project";

type Qa = NonNullable<ProjectView["renders"][number]["qa"]>;
const QA_BADGE: Record<Qa["verdict"], { tone: "good" | "warn" | "info"; label: string }> = {
  pass: { tone: "good", label: "Checked" },
  fixed: { tone: "good", label: "Fixed" },
  issues: { tone: "warn", label: "Needs a look" },
  "checks-only": { tone: "info", label: "Basic check" },
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** What the quality check found and fixed, under each finished video. */
function QaDetails({ qa }: { qa: Qa }) {
  if (!qa.issues.length && !qa.fixed.length) return null;
  return (
    <details className="border-t border-line px-3 py-2 text-xs text-muted">
      <summary className="cursor-pointer select-none">
        Quality check: {qa.fixed.length ? `fixed ${qa.fixed.length}` : ""}
        {qa.fixed.length && qa.issues.length ? ", " : ""}
        {qa.issues.length ? `${qa.issues.length} left` : ""}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {qa.fixed.map((f) => (
          <li key={f} className="text-good">Fixed: {f}</li>
        ))}
        {qa.issues.map((i, k) => (
          <li key={k}>
            <span className={i.severity === "minor" ? "" : "text-warn"}>
              <span className="num">{clock(i.at)}</span> · {i.severity}
            </span>{" "}
            {i.detail}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function Exports({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { view, error, clips } = useProject(id);
  if (!view) return error ? <Notice>{error}</Notice> : <div className="glass h-40 animate-pulse rounded-lg" aria-label="Loading your videos" />;

  const rankOf = (clipId: string) => clips.find((c) => c.id === clipId)?.rank;
  const done = view.renders.filter((r) => r.status === "done").sort((a, b) => (rankOf(a.clipId) ?? 99) - (rankOf(b.clipId) ?? 99));
  const rendering = view.jobs.filter((j) => j.kind === "render" && (j.status === "queued" || j.status === "running"));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <a href={`/projects/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="size-4" aria-hidden />
            Your clips
          </a>
          <h1 className="mt-1 truncate text-[clamp(1.5rem,1rem+1.2vw,2.5rem)] leading-tight font-bold tracking-[-0.03em]">My videos · {view.project.title}</h1>
        </div>
        {done.some((r) => r.quality === "final") ? (
          <ButtonLink href={`/api/projects/${id}/zip`} variant="primary" download>
            <FileArchive aria-hidden />
            Download all
          </ButtonLink>
        ) : null}
      </div>

      <p className="mt-3 text-sm text-muted">
        Also saved on this computer, in the <span className="font-medium text-fg">{view.project.clipsFolder}</span> folder inside your OneClip folder.
      </p>

      {rendering.length ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <span className="tally-live size-2 rounded-full bg-tally" aria-hidden />
          <span className="num">{rendering.length}</span> video{rendering.length === 1 ? "" : "s"} saving: {rendering[0].message}
        </p>
      ) : null}

      {done.length ? (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] sm:gap-5">
          {done.map((r) => (
            <li key={r.id} className="glass overflow-hidden rounded-xl">
              <video
                src={`/api/media/render/${r.id}`}
                poster={r.hasThumb ? `/api/media/thumb/${r.id}` : undefined}
                controls
                preload="none"
                playsInline
                style={{ aspectRatio: (r.ratio ?? "9:16").replace(":", " / ") }}
                className="w-full bg-black object-contain"
              />
              <div className="flex min-w-0 items-center gap-2 p-3 text-sm">
                <span className="num font-medium">#{rankOf(r.clipId) ?? "?"}</span>
                <Badge tone={r.quality === "final" ? "good" : "neutral"}>{r.quality === "final" ? "HD" : "Draft"}</Badge>
                {r.qa ? (
                  <Badge tone={QA_BADGE[r.qa.verdict].tone} title={`Quality check by ${r.qa.reviewer}, ${r.qa.frames} frames, ${r.qa.passes} pass(es)`}>
                    {QA_BADGE[r.qa.verdict].label}
                  </Badge>
                ) : null}
                <span className="num text-xs text-muted">{r.ratio ?? "9:16"}</span>
                <a href={`/api/media/render/${r.id}?download=1`} className="press ml-auto rounded-full p-1.5 text-muted hover:bg-raised hover:text-fg" aria-label="Download">
                  <Download className="size-4" aria-hidden />
                </a>
              </div>
              {r.qa ? <QaDetails qa={r.qa} /> : null}
            </li>
          ))}
        </ul>
      ) : !rendering.length ? (
        <p className="glass mt-8 rounded-xl px-4 py-10 text-center text-sm text-muted">
          No videos yet. Open a clip and press <span className="font-medium text-fg">Save video</span>.
        </p>
      ) : null}
    </div>
  );
}
