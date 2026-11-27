"use client";

import { Check as CheckIcon, CircleAlert, CircleCheck, CircleX, Copy, RefreshCw, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { api, cn } from "@/lib/utils";

interface Check {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
  fix?: string;
  help?: { why: string; command?: string; done: string };
}

export default function Setup() {
  const [checks, setChecks] = useState<Check[]>();
  const [busy, setBusy] = useState<"get" | "jev">();
  const [error, setError] = useState<string>();

  const run = useCallback(async (testJev: boolean) => {
    setBusy(testJev ? "jev" : "get");
    setError(undefined);
    try {
      setChecks((await api<{ checks: Check[] }>("/api/doctor", { method: testJev ? "POST" : "GET" })).checks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }, []);

  useEffect(() => void run(false), [run]);

  const must = checks?.filter((c) => c.required && !c.ok) ?? [];
  const nice = checks?.filter((c) => !c.required && !c.ok) ?? [];
  const good = checks?.filter((c) => c.ok) ?? [];

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[clamp(1.9rem,1rem+2vw,3.25rem)] leading-tight font-bold tracking-[-0.03em]">Check my computer</h1>
          <p className="mt-1 text-sm text-muted">We check that everything OneClip needs is installed. Fix the Must fix list, then make clips.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run(false)} loading={busy === "get"} disabled={!!busy} className="min-h-[44px]">
            <RefreshCw aria-hidden />
            Check again
          </Button>
          <Button onClick={() => run(true)} loading={busy === "jev"} disabled={!!busy} className="min-h-[44px]">
            <Zap aria-hidden />
            Test the clip judge (uses a tiny bit of credit)
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-6">
          <Notice>{error}</Notice>
        </div>
      ) : null}

      {checks ? (
        <>
          <p role="status" className={cn("mt-6 text-sm font-medium", must.length ? "text-bad" : "text-good")}>
            {must.length ? `${must.length} ${must.length === 1 ? "thing" : "things"} to fix before you can make clips` : "All set: go make clips!"}
          </p>
          <Section title="Must fix" items={must} tone="bad" />
          <Section title="Nice to have" items={nice} tone="warn" />
          <Section title="All good" items={good} tone="good" />
        </>
      ) : !error ? (
        <ul className="glass mt-6 grid gap-px overflow-hidden rounded-xl" aria-label="Running checks">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="h-14 animate-pulse bg-panel" />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Section({ title, items, tone }: { title: string; items: Check[]; tone: "bad" | "warn" | "good" }) {
  if (!items.length) return null;
  const Icon = tone === "good" ? CircleCheck : tone === "bad" ? CircleX : CircleAlert;
  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
        {title} ({items.length})
      </h2>
      <ul className="mt-2 divide-y divide-line glass rounded-xl">
        {items.map((c) => (
          <li key={c.id} className="flex gap-3 px-4 py-3">
            <Icon className={cn("mt-0.5 size-4 shrink-0", { bad: "text-bad", warn: "text-warn", good: "text-good" }[tone])} aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{c.label}</p>
              {tone !== "good" && c.help ? <p className="mt-0.5">{c.help.why}</p> : null}
              <p className="mt-0.5 break-words text-xs text-muted">{c.detail}</p>
              {tone !== "good" ? <Fix c={c} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Fix({ c }: { c: Check }) {
  const [copied, setCopied] = useState(false);
  const command = c.help?.command;
  if (!command) return c.fix ? <p className="mt-2 text-xs">{c.fix}</p> : null;
  return (
    <div className="mt-2 grid gap-1.5">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-raised px-3 py-2.5 font-mono text-xs whitespace-nowrap">{command}</code>
        <Button
          className="min-h-[44px] shrink-0"
          aria-label={`Copy the command for ${c.label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <CheckIcon aria-hidden /> : <Copy aria-hidden />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <p className="text-xs text-muted">Run it in a terminal. When it works: {c.help?.done}</p>
    </div>
  );
}
