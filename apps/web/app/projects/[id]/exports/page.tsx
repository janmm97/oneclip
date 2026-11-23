"use client";

import { ArrowLeft, Download, FileArchive } from "lucide-react";
import { use } from "react";
import { Badge, ButtonLink, Notice } from "@/components/ui";
import { useProject } from "@/lib/use-project";

export default function Exports({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { view, error, clips } = useProject(id);
  if (!view) return error ? <Notice>{error}</Notice> : <div className="h-40 animate-pulse rounded-lg bg-panel" aria-label="Loading exports" />;

  const rankOf = (clipId: string) => clips.find((c) => c.id === clipId)?.rank;
  const done = view.renders.filter((r) => r.status === "done").sort((a, b) => (rankOf(a.clipId) ?? 99) - (rankOf(b.clipId) ?? 99));
  const rendering = view.jobs.filter((j) => j.kind === "render" && (j.status === "queued" || j.status === "running"));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <a href={`/projects/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="size-4" aria-hidden />
            Clips
          </a>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">Exports · {view.project.title}</h1>
        </div>
        {done.some((r) => r.quality === "final") ? (
          <ButtonLink href={`/api/projects/${id}/zip`} variant="primary" download>
            <FileArchive aria-hidden />
            Download all (zip)
          </ButtonLink>
        ) : null}
      </div>

      {rendering.length ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <span className="tally-live size-2 rounded-full bg-tally" aria-hidden />
          <span className="num">{rendering.length}</span> render{rendering.length === 1 ? "" : "s"} in progress: {rendering[0].message}
        </p>
      ) : null}

      {done.length ? (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] sm:gap-5">
          {done.map((r) => (
            <li key={r.id} className="overflow-hidden rounded-lg border border-line bg-panel">
              <video
                src={`/api/media/render/${r.id}`}
                poster={r.hasThumb ? `/api/media/thumb/${r.id}` : undefined}
                controls
                preload="none"
                playsInline
                className="aspect-9/16 w-full bg-black object-contain"
              />
              <div className="flex min-w-0 items-center gap-2 p-3 text-sm">
                <span className="num font-medium">#{rankOf(r.clipId) ?? "?"}</span>
                <Badge tone={r.quality === "final" ? "good" : "neutral"}>{r.quality === "final" ? "1080p" : "preview"}</Badge>
                <span className="hidden text-xs text-muted sm:inline">{r.renderer}</span>
                <a href={`/api/media/render/${r.id}?download=1`} className="ml-auto rounded p-1 text-muted hover:bg-raised hover:text-fg" aria-label="Download">
                  <Download className="size-4" aria-hidden />
                </a>
              </div>
            </li>
          ))}
        </ul>
      ) : !rendering.length ? (
        <p className="mt-8 rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          Nothing rendered yet. Pick a clip and choose Render 1080p.
        </p>
      ) : null}
    </div>
  );
}
