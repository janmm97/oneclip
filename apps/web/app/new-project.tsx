"use client";

import { CONTENT_TYPES, DURATION_PRESETS, extractYouTubeId, RATIO_LABELS, RATIOS, type Ratio, type YouTubeMeta } from "@oneclip/core/browser";
import { Check, Link2, Minus, Play, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button, Field, Input, Notice, Segmented, Select } from "@/components/ui";
import { clampTopN, TOP_N_MAX, TOP_N_MIN, toggleRatio } from "@/lib/form";
import { api, cn } from "@/lib/utils";

/** "Quick (10–20s)" shows as "Quick" over "10–20s" so four segments fit a phone. */
const PRESETS = Object.entries(DURATION_PRESETS).map(([k, v]) => {
  const [name, range] = v.label.replace(")", "").split(" (");
  return [
    k,
    <span key={k} className="grid py-1 leading-tight">
      {name}
      {range ? <span className="num text-[0.6875rem] font-normal text-muted">{range}</span> : null}
    </span>,
  ] as const;
});
const RENDERERS = [
  ["remotion", "Remotion · animated captions"],
  ["ffmpeg", "FFmpeg · fastest"],
] as const;

/** A settings group, like a section in iOS Settings. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-lg border border-line bg-raised p-4">
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** A labelled row for controls that aren't a single input (segments, stepper, chips). */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}
const CAPTIONS = [
  ["english", "English (translated when needed)"],
  ["original", "Original language"],
  ["off", "No captions"],
] as const;
const CONTENT = [["auto", "Auto-detect"], ...Object.entries(CONTENT_TYPES).map(([k, v]) => [k, v.label] as const)] as const;
const PLANNERS = [
  ["auto", "Auto (best available)"],
  ["openrouter", "OpenRouter via One (cheap models)"],
  ["claude-code", "Claude Code"],
  ["opencode", "OpenCode"],
  ["template", "Template (no agent)"],
] as const;

export function NewProject() {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [meta, setMeta] = useState<YouTubeMeta>();
  const [authorized, setAuthorized] = useState(false);
  const [s, setS] = useState({ preset: "standard", topN: 5, renderer: "remotion", planner: "auto", captions: "english", content: "auto", ratios: ["9:16"] as Ratio[] });
  const [busy, setBusy] = useState<"meta" | "go">();
  const [error, setError] = useState<string>();

  const clean = source.trim().replace(/^"|"$/g, "");
  const isLink = /^https?:\/\//i.test(clean);

  /** YouTube links get a title/thumbnail preview; other links show theirs once downloaded. */
  async function lookup() {
    if (!extractYouTubeId(clean)) return setMeta(undefined);
    setBusy("meta");
    setError(undefined);
    try {
      setMeta(await api<YouTubeMeta>("/api/youtube", { method: "POST", body: JSON.stringify({ url: clean }) }));
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
        body: JSON.stringify({ sourcePath: clean, authorized, youtubeUrl: extractYouTubeId(clean) ? clean : "", settings: s }),
      });
      router.push(`/projects/${projectId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(undefined);
    }
  }

  return (
    <form onSubmit={submit} className="glass mt-8 grid gap-5 rounded-xl p-[clamp(1rem,1.6vw,1.75rem)]">
      <Field
        label="Video or podcast"
        hint="Paste a link from YouTube or any video, audio or podcast site, or the full path to a video or audio file on this computer (on Windows: Shift + right-click the file → Copy as path)."
      >
        <div className="flex gap-2">
          <Input
            required
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setMeta(undefined);
            }}
            onBlur={lookup}
            placeholder="https://youtu.be/…  or  C:\Videos\episode-12.mp4"
            spellCheck={false}
            className="font-mono"
          />
          <Button type="button" onClick={lookup} loading={busy === "meta"} disabled={!extractYouTubeId(clean)} aria-label="Preview video">
            <Link2 aria-hidden />
          </Button>
        </div>
      </Field>
      {meta ? (
        <div className="flex items-center gap-3 rounded-md border border-line bg-raised p-2">
          {/* oEmbed thumbnails are remote and tiny; next/image would need a remote pattern for one 120px image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={meta.thumbnailUrl} alt="" className="h-14 w-24 rounded object-cover" />
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{meta.title}</p>
            <p className="truncate text-muted">{meta.author}</p>
          </div>
        </div>
      ) : isLink ? (
        <p className="-mt-2 text-xs text-muted">OneClip downloads this link when the analysis starts.</p>
      ) : null}

      <Group title="Clips">
        <Row label="Clip length">
          <Segmented label="Clip length" options={PRESETS} value={s.preset} onChange={(preset) => setS({ ...s, preset })} />
        </Row>
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <Row label="Clips to keep">
            <div className="flex h-10 w-fit items-center gap-1 rounded-md bg-raised p-1">
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Fewer clips" disabled={s.topN <= TOP_N_MIN} onClick={() => setS({ ...s, topN: clampTopN(s.topN - 1) })}>
                <Minus aria-hidden />
              </Button>
              <output className="num w-8 text-center font-semibold" aria-live="polite">
                {s.topN}
              </output>
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="More clips" disabled={s.topN >= TOP_N_MAX} onClick={() => setS({ ...s, topN: clampTopN(s.topN + 1) })}>
                <Plus aria-hidden />
              </Button>
            </div>
          </Row>
          <Row label="Frame ratios" hint="Each clip renders once per ratio. 9:16 for phones, 16:9 for desktop.">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Frame ratios">
              {RATIOS.map((r) => {
                const on = s.ratios.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    aria-disabled={on && s.ratios.length === 1 ? true : undefined}
                    onClick={() => setS({ ...s, ratios: toggleRatio(s.ratios, r) })}
                    className={cn(
                      "press inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[0.8125rem] font-medium",
                      on ? "border-tally/50 bg-tally/15 text-tally-fg" : "border-line text-muted hover:text-fg",
                    )}
                  >
                    {on ? <Check className="size-3.5" aria-hidden /> : null}
                    {RATIO_LABELS[r]}
                  </button>
                );
              })}
            </div>
          </Row>
        </div>
      </Group>

      <Group title="Render">
        <Row label="Renderer">
          <Segmented label="Renderer" options={RENDERERS} value={s.renderer} onChange={(renderer) => setS({ ...s, renderer })} />
        </Row>
        <Field label="Captions" hint="English uses the link's own English subtitles when it has them, otherwise Whisper translates the speech or lyrics on this computer.">
          <Select options={CAPTIONS} value={s.captions} onChange={(e) => setS({ ...s, captions: e.target.value })} />
        </Field>
      </Group>

      <Group title="Understanding">
        <Field label="Content type" hint="Tells Jev what the best part looks like: the chorus of a song, the payoff of a podcast story, the play in gameplay. Auto reads the title, category and the sound and picture.">
          <Select options={CONTENT} value={s.content} onChange={(e) => setS({ ...s, content: e.target.value })} />
        </Field>
        <Field label="Edit planner" hint="Auto tries OpenRouter via One, then Claude Code, then OpenCode, then the built-in template. Clip transcripts go to the AI planner you use (and to Jev for scoring). Pick Template to skip the AI planner and keep that step on this computer.">
          <Select options={PLANNERS} value={s.planner} onChange={(e) => setS({ ...s, planner: e.target.value })} />
        </Field>
      </Group>

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-0.5 size-4 accent-(--color-tally)" />
        <span>I own this video or am authorised to edit it.</span>
      </label>

      {error ? <Notice>{error}</Notice> : null}

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted">Ranking costs about 1,400 Jev tokens per candidate on your TypeSafe account. Re-runs use the cache.</p>
        <Button type="submit" variant="primary" loading={busy === "go"} disabled={!authorized || !clean}>
          <Play aria-hidden />
          Find clips
        </Button>
      </div>
    </form>
  );
}
