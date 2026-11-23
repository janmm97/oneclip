"use client";

import { DURATION_PRESETS, type YouTubeMeta } from "@oneclip/core/browser";
import { Link2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { api } from "@/lib/utils";

const PRESETS = Object.entries(DURATION_PRESETS).map(([k, v]) => [k, v.label] as const);
const RENDERERS = [
  ["remotion", "Remotion (animated captions)"],
  ["ffmpeg", "FFmpeg only (fastest)"],
] as const;
const PLANNERS = [
  ["auto", "Auto (best available)"],
  ["openrouter", "OpenRouter via One (cheap models)"],
  ["claude-code", "Claude Code"],
  ["opencode", "OpenCode"],
  ["template", "Template (no agent)"],
] as const;

export function NewProject() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<YouTubeMeta>();
  const [path, setPath] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [s, setS] = useState({ preset: "standard", topN: 5, renderer: "remotion", planner: "auto" });
  const [busy, setBusy] = useState<"meta" | "go">();
  const [error, setError] = useState<string>();

  async function lookup() {
    if (!url.trim()) return setMeta(undefined);
    setBusy("meta");
    setError(undefined);
    try {
      setMeta(await api<YouTubeMeta>("/api/youtube", { method: "POST", body: JSON.stringify({ url }) }));
    } catch (e) {
      setMeta(undefined);
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("go");
    setError(undefined);
    try {
      const { projectId } = await api<{ projectId: string }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ sourcePath: path.trim().replace(/^"|"$/g, ""), authorized, youtubeUrl: url, settings: s }),
      });
      router.push(`/projects/${projectId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(undefined);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 grid gap-5 rounded-lg border border-line bg-panel p-5">
      <Field label="YouTube link (optional)" hint="Used for title and thumbnail only. OneClip never downloads from YouTube.">
        <div className="flex gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} onBlur={lookup} placeholder="https://www.youtube.com/watch?v=…" inputMode="url" />
          <Button type="button" onClick={lookup} loading={busy === "meta"} aria-label="Look up video">
            <Link2 aria-hidden />
          </Button>
        </div>
      </Field>
      {meta ? (
        <div className="flex items-center gap-3 rounded-md border border-line bg-bg p-2">
          {/* oEmbed thumbnails are remote and tiny; next/image would need a remote pattern for one 120px image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={meta.thumbnailUrl} alt="" className="h-14 w-24 rounded object-cover" />
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{meta.title}</p>
            <p className="truncate text-muted">{meta.author}</p>
          </div>
        </div>
      ) : null}

      <Field label="Video file on this computer" hint="Full path to an MP4, MOV, MKV or WebM. On Windows, Shift + right-click the file → Copy as path.">
        <Input required value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Videos\episode-12.mp4" spellCheck={false} className="font-mono" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Clip length">
          <Select options={PRESETS} value={s.preset} onChange={(e) => setS({ ...s, preset: e.target.value })} />
        </Field>
        <Field label="Clips to keep">
          <Input type="number" min={1} max={20} value={s.topN} onChange={(e) => setS({ ...s, topN: Number(e.target.value) || 1 })} className="num" />
        </Field>
        <Field label="Renderer">
          <Select options={RENDERERS} value={s.renderer} onChange={(e) => setS({ ...s, renderer: e.target.value })} />
        </Field>
        <Field label="Edit planner" hint="Auto tries OpenRouter via One, then Claude Code, then OpenCode, then the built-in template.">
          <Select options={PLANNERS} value={s.planner} onChange={(e) => setS({ ...s, planner: e.target.value })} />
        </Field>
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-0.5 size-4 accent-(--color-tally)" />
        <span>I own this video or am authorised to edit it.</span>
      </label>

      {error ? <Notice>{error}</Notice> : null}

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted">Ranking costs about 1,400 Jev tokens per candidate on your TypeSafe account. Re-runs use the cache.</p>
        <Button type="submit" variant="primary" loading={busy === "go"} disabled={!authorized || !path.trim()}>
          <Play aria-hidden />
          Find clips
        </Button>
      </div>
    </form>
  );
}
