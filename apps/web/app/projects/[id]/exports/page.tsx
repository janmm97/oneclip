"use client";

import { ArrowLeft, Download, FileArchive } from "lucide-react";
import { use } from "react";
import { Badge, ButtonLink, Notice } from "@/components/ui";
import { useProject } from "@/lib/use-project";

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
                <span className="num text-xs text-muted">{r.ratio ?? "9:16"}</span>
                <a href={`/api/media/render/${r.id}?download=1`} className="press ml-auto rounded-full p-1.5 text-muted hover:bg-raised hover:text-fg" aria-label="Download">
                  <Download className="size-4" aria-hidden />
                </a>
              </div>
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
