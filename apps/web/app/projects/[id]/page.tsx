"use client";

import { STAGE_LABELS, STAGES } from "@oneclip/core/browser";
import { Check, Film, RotateCw } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { Button, ButtonLink, Meter, Notice } from "@/components/ui";
import { useProject } from "@/lib/use-project";
import { api, cn } from "@/lib/utils";
import { Results } from "./results";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { view, error, refresh, clips } = useProject(id);
  const [retrying, setRetrying] = useState(false);

  if (!view) return error ? <Notice>{error}</Notice> : <div className="h-40 animate-pulse rounded-lg bg-panel" aria-label="Loading project" />;

  const analyze = [...view.jobs].reverse().find((j) => j.kind === "analyze");
  const analyzing = view.project.status === "queued" || view.project.status === "running";

  async function retry() {
    setRetrying(true);
    await api(`/api/projects/${id}`, { method: "POST" }).catch(() => undefined);
    await refresh();
    setRetrying(false);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{view.project.title}</h1>
          <p className="mt-1 truncate font-mono text-xs text-muted">{view.project.fileName}</p>
        </div>
        {view.project.status === "ready" ? (
          <ButtonLink href={`/projects/${id}/exports`}>
            <Film aria-hidden />
            Exports
            <span className="num text-muted">{view.renders.filter((r) => r.status === "done").length}</span>
          </ButtonLink>
        ) : null}
      </div>

      {analyzing ? <Processing stage={analyze?.stage ?? null} progress={analyze?.progress ?? 0} message={analyze?.message ?? "Waiting for the worker"} /> : null}

      {view.project.status === "failed" ? (
        <div className="mt-8 grid max-w-2xl gap-3">
          <Notice>
            <span className="whitespace-pre-wrap">{analyze?.error ?? view.project.error ?? "Analysis failed."}</span>
          </Notice>
          <div className="flex gap-2">
            <Button onClick={retry} loading={retrying}>
              <RotateCw aria-hidden />
              Try again
            </Button>
            <ButtonLink href="/setup" variant="ghost">
              Check setup
            </ButtonLink>
          </div>
        </div>
      ) : null}

      {view.project.status === "ready" ? (
        clips.length ? (
          <Results projectId={id} view={view} clips={clips} refresh={refresh} />
        ) : (
          <p className="mt-8 rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            No complete thoughts fit this clip length. Try a shorter preset from{" "}
            <Link href="/" className="text-fg underline underline-offset-4">
              a new project
            </Link>
            .
          </p>
        )
      ) : null}
    </div>
  );
}

function Processing({ stage, progress, message }: { stage: string | null; progress: number; message: string }) {
  const steps = STAGES.filter((s) => s !== "render");
  const at = stage ? steps.indexOf(stage as (typeof steps)[number]) : -1;
  return (
    <section className="mt-8 max-w-2xl rounded-lg border border-line bg-panel p-5" aria-live="polite">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm font-medium">{message}</p>
        <span className="num text-sm text-muted">{Math.round(progress * 100)}%</span>
      </div>
      <div className="mt-3">
        <Meter value={progress} tone="tally" label="Analysis progress" showValue={false} />
      </div>
      <ol className="mt-5 grid gap-2.5">
        {steps.map((s, i) => {
          const done = i < at;
          const now = i === at;
          return (
            <li key={s} className={cn("flex items-center gap-3 text-sm", done ? "text-fg" : now ? "text-fg" : "text-muted")}>
              <span className={cn("grid size-5 place-items-center rounded-full border", done ? "border-good bg-good/15 text-good" : now ? "tally-live border-tally bg-tally" : "border-line")}>
                {done ? <Check className="size-3" aria-hidden /> : null}
              </span>
              {STAGE_LABELS[s]}
              {now ? <span className="sr-only">(in progress)</span> : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-5 text-xs text-muted">You can leave this page. The worker keeps going and picks up where it stopped after a restart.</p>
    </section>
  );
}
