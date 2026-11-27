"use client";

import { CONTENT_TYPES, DURATION_PRESETS, extractYouTubeId, type Ratio, type YouTubeMeta } from "@oneclip/core/browser";
import { ChevronRight, Link2, Minus, Play, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";
import { Button, Field, Input, Notice, Segmented, Select } from "@/components/ui";
import { clampTopN, TOP_N_MAX, TOP_N_MIN } from "@/lib/form";
import { api, cn } from "@/lib/utils";
import { PlacesPicker } from "./places-picker";

/** Plain names for the length presets; the seconds stay as a small second line so four segments fit a phone. */
const LENGTH_NAMES: Record<string, string> = { quick: "Super short", short: "Short", standard: "Medium", extended: "Long" };
const PRESETS = Object.entries(DURATION_PRESETS).map(([k, v]) => {
  const range = v.label.match(/\((.+)\)/)?.[1];
  const name = LENGTH_NAMES[k] ?? v.label;
  return [
    k,
    <span key={k} className="grid py-1 leading-tight">
      {name}
      {range ? <span className="num text-[0.6875rem] font-normal text-muted">{range}</span> : null}
    </span>,
  ] as const;
});
const RENDERERS = [
  ["remotion", "Animated (slower)"],
  ["ffmpeg", "Simple (faster)"],
] as const;

/** A fold-away group: beginners never need to open it, every setting is still one tap away. */
function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group/d rounded-lg border border-line bg-raised/50">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-lg px-4 text-sm font-medium text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform duration-150 group-open/d:rotate-90" aria-hidden />
        {title}
      </summary>
      <div className="grid gap-4 px-4 pt-1 pb-4">{children}</div>
    </details>
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
  ["english", "English"],
  ["original", "Same language as the video"],
  ["off", "No subtitles"],
] as const;
const CONTENT = [["auto", "Let OneClip guess"], ...Object.entries(CONTENT_TYPES).map(([k, v]) => [k, k === "footage" ? "Other" : v.label] as const)] as const;
const PLANNERS = [
  ["auto", "Automatic"],
  ["openrouter", "Online AI (small cost)"],
  ["claude-code", "Claude Code (on this computer)"],
  ["opencode", "OpenCode (on this computer)"],
  ["template", "Basic, no AI"],
] as const;

export function NewProject() {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [meta, setMeta] = useState<YouTubeMeta>();
  const [authorized, setAuthorized] = useState(false);
  const [s, setS] = useState({ preset: "standard", topN: 5, renderer: "remotion", planner: "auto", captions: "english", content: "auto", ratios: ["9:16"] as Ratio[] });
  const [busy, setBusy] = useState<"meta" | "go">();
  const [error, setError] = useState<string>();
  const [needsTick, setNeedsTick] = useState(false);
  const ownership = useRef<HTMLInputElement>(null);

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
    if (!authorized) {
      setNeedsTick(true);
      return ownership.current?.focus();
    }
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
        label="Your video"
        hint="Paste a YouTube link (or any video link), or the full path to a video on this computer."
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
        <p className="-mt-2 text-xs text-muted">OneClip gets this video when it starts making clips.</p>
      ) : null}

      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm">
        <input
          ref={ownership}
          type="checkbox"
          role="switch"
          checked={authorized}
          onChange={(e) => {
            setAuthorized(e.target.checked);
            setNeedsTick(false);
          }}
          aria-describedby={needsTick ? "tick-first" : undefined}
          aria-invalid={needsTick || undefined}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-tally peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg",
            authorized ? "border-tally bg-tally" : needsTick ? "border-bad bg-raised" : "border-line bg-raised",
          )}
        >
          <span className={cn("absolute top-0.5 size-4.5 rounded-full bg-fg shadow transition-[left] duration-150", authorized ? "left-[1.1rem] bg-tally-ink" : "left-0.5")} />
        </span>
        <span>This is my video, or I have permission to use it</span>
      </label>
      {needsTick ? (
        <p id="tick-first" role="alert" className="-mt-3 text-sm font-medium text-bad">
          Tick this first
        </p>
      ) : null}

      {error ? <Notice>{error}</Notice> : null}

      <Button type="submit" variant="primary" loading={busy === "go"} className="min-h-[44px] w-full sm:w-fit">
        <Play aria-hidden />
        Make my clips
      </Button>

      <Disclosure title="More options">
        <PlacesPicker value={s.ratios} onChange={(ratios) => setS({ ...s, ratios })} />
        <Row label="How long?">
          <Segmented label="How long?" options={PRESETS} value={s.preset} onChange={(preset) => setS({ ...s, preset })} />
        </Row>
        <Row label="How many clips?" hint={`${s.topN} ${s.topN === 1 ? "clip" : "clips"} × ${s.ratios.length} ${s.ratios.length === 1 ? "shape" : "shapes"} = ${s.topN * s.ratios.length} videos`}>
          <div className="flex h-[44px] w-fit items-center gap-1 rounded-md bg-raised p-1">
            <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Fewer clips" disabled={s.topN <= TOP_N_MIN} onClick={() => setS({ ...s, topN: clampTopN(s.topN - 1) })}>
              <Minus aria-hidden />
            </Button>
            <output className="num w-8 text-center font-semibold" aria-live="polite">
              {s.topN}
            </output>
            <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="More clips" disabled={s.topN >= TOP_N_MAX} onClick={() => setS({ ...s, topN: clampTopN(s.topN + 1) })}>
              <Plus aria-hidden />
            </Button>
          </div>
        </Row>

        <Disclosure title="Expert settings">
          <Field label="What kind of video is it?" hint="Helps Jev, OneClip's clip judge, spot the best part: the chorus of a song, the end of a story, the big play in a game.">
            <Select options={CONTENT} value={s.content} onChange={(e) => setS({ ...s, content: e.target.value })} />
          </Field>
          <Field label="AI helper" hint="Automatic tries the online AI, then Claude Code, then OpenCode, then the basic one. The words of each clip go to the AI helper you pick (and to Jev). Pick Basic to keep this step on this computer.">
            <Select options={PLANNERS} value={s.planner} onChange={(e) => setS({ ...s, planner: e.target.value })} />
          </Field>
          <Row label="Caption style">
            <Segmented label="Caption style" options={RENDERERS} value={s.renderer} onChange={(renderer) => setS({ ...s, renderer })} />
          </Row>
          <Field label="Subtitles" hint="English uses the video's own English subtitles when it has them, otherwise OneClip translates the words on this computer.">
            <Select options={CAPTIONS} value={s.captions} onChange={(e) => setS({ ...s, captions: e.target.value })} />
          </Field>
          <p className="text-xs text-muted">Uses a little Jev credit for each moment it checks. Making clips again from the same video is free.</p>
        </Disclosure>
      </Disclosure>
    </form>
  );
}
