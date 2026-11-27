"use client";

import { EDIT_EXAMPLES } from "@oneclip/core/browser";
import { Check, CornerDownLeft, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/components/ui";
import type { View } from "@/lib/use-project";
import { api, cn } from "@/lib/utils";

type Job = View["jobs"][number];
const busy = (j?: Job) => j?.status === "queued" || j?.status === "running";

function Steps({ edit, render }: { edit: Job; render?: Job }) {
  const steps = edit.log ?? [];
  const lines = busy(edit) && !steps.length ? [edit.message ?? "Starting up…"] : steps;
  return (
    <ol className="grid gap-1.5 text-sm">
      {lines.map((line, i) => {
        const live = busy(edit) && i === lines.length - 1;
        return (
          <li key={i} className={cn("flex items-start gap-2", live ? "text-fg" : "text-muted")}>
            <span className={cn("mt-1 grid size-3.5 shrink-0 place-items-center rounded-full", live ? "tally-live bg-tally" : "bg-good/15 text-good")}>
              {live ? null : <Check className="size-2.5" aria-hidden />}
            </span>
            {line}
          </li>
        );
      })}
      {edit.status === "failed" ? (
        <li className="flex items-start gap-2 text-bad">
          <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="whitespace-pre-wrap">{edit.error}</span>
        </li>
      ) : null}
      {edit.status === "done" && render ? (
        <li className={cn("flex items-start gap-2", busy(render) ? "text-fg" : render.status === "failed" ? "text-bad" : "text-muted")}>
          <span className={cn("mt-1 grid size-3.5 shrink-0 place-items-center rounded-full", busy(render) ? "tally-live bg-tally" : render.status === "failed" ? "bg-bad/15" : "bg-good/15 text-good")}>
            {render.status === "done" ? <Check className="size-2.5" aria-hidden /> : null}
          </span>
          {busy(render) ? `${render.message ?? "Making the preview"} · ${Math.round((render.progress ?? 0) * 100)}%` : render.status === "done" ? "New preview ready" : `Couldn't make the preview: try again. ${render.error ?? ""}`}
        </li>
      ) : null}
    </ol>
  );
}

/** Chat with the editor about one clip: each request becomes an edit job whose steps stream in as the worker makes them. */
export function EditChat({ projectId, clipId, jobs, refresh }: { projectId: string; clipId: string; jobs: Job[]; refresh: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const feed = useRef<HTMLOListElement>(null);
  const edits = jobs.filter((j) => j.kind === "edit" && j.clipId === clipId);
  const working = edits.some(busy);
  const renderAfter = (e: Job) => jobs.find((j) => j.kind === "render" && j.clipId === clipId && j.quality === "preview" && j.createdAt >= e.createdAt);
  const progress = edits.reduce((n, e) => n + (e.log?.length ?? 0), 0) + jobs.filter(busy).length;
  const [agent, setAgent] = useState<string>();

  // Say up front who will make the change: the user's own agent, or only the built-in rules.
  useEffect(() => {
    api<{ agents: string[]; aiOff: boolean }>(`/api/projects/${projectId}/edit`)
      .then((r) => setAgent(r.agents[0] ? `Editing with ${r.agents[0]}` : r.aiOff ? "AI is off: built-in rules only" : "No coding agent found: built-in rules only"))
      .catch(() => setAgent(undefined));
  }, [projectId]);

  // Scroll to the newest step whenever one arrives.
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [progress]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const instruction = text.trim();
    if (!instruction || working) return;
    setSending(true);
    setError(undefined);
    try {
      await api(`/api/projects/${projectId}/edit`, { method: "POST", body: JSON.stringify({ clipId, instruction }) });
      setText("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-labelledby="edit-chat" className="glass-thick flex min-h-[28rem] flex-col rounded-xl lg:sticky lg:top-4 lg:h-[calc(100dvh-11.5rem)]">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className={cn("size-2 rounded-full", working ? "tally-live bg-tally" : "bg-line")} aria-hidden />
        <h2 id="edit-chat" className="text-sm font-medium">
          Ask for changes
        </h2>
        <span className="ml-auto text-xs text-muted">{working ? "Working on it…" : (agent ?? "Ready")}</span>
      </header>

      <ol ref={feed} className="grid flex-1 content-start gap-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {edits.length ? (
          edits.map((e) => (
            <li key={e.id} className="grid gap-2">
              {/* iMessage-style: your request is the blue bubble on the right. */}
              <p className="ml-8 justify-self-end rounded-[1.1rem] rounded-br-md bg-[#0071e3] px-3.5 py-2 text-sm text-white">{e.instruction}</p>
              <Steps edit={e} render={renderAfter(e)} />
            </li>
          ))
        ) : (
          <li className="grid gap-3 text-sm text-muted">
            <p>Tell it what to change in plain words. It edits the clip and shows a new preview.</p>
            <p>Try:</p>
            <div className="flex flex-wrap gap-1.5">
              {EDIT_EXAMPLES.slice(0, 6).map((x) => (
                <button key={x} onClick={() => setText(x)} className="press rounded-full border border-line bg-raised px-3 py-1 text-xs text-fg transition-colors duration-150 hover:border-tally/60">
                  {x}
                </button>
              ))}
            </div>
          </li>
        )}
      </ol>

      <form onSubmit={send} className="grid gap-2 border-t border-line p-3">
        {error ? <Notice>{error}</Notice> : null}
        <label htmlFor="edit-input" className="sr-only">
          What should change?
        </label>
        <textarea
          id="edit-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send(e);
          }}
          maxLength={500}
          rows={2}
          placeholder={working ? "Wait for this edit to finish…" : "Like 'make the words bigger'"}
          className="w-full resize-none rounded-[1.1rem] border border-line bg-raised px-3.5 py-2 text-sm placeholder:text-muted focus:border-tally/60 focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <span className="num text-xs text-muted">{text.length > 400 ? `${text.length}/500` : "Enter to send · Shift+Enter for a new line"}</span>
          <Button type="submit" size="sm" variant="primary" className="ml-auto" loading={sending} disabled={!text.trim() || working}>
            <CornerDownLeft aria-hidden />
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}
