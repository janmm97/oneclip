"use client";

import { CircleAlert, CircleCheck, CircleX, RefreshCw, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Notice } from "@/components/ui";
import { api, cn } from "@/lib/utils";

interface Check {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
  fix?: string;
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

  const blocking = checks?.filter((c) => c.required && !c.ok).length ?? 0;

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[clamp(1.9rem,1rem+2vw,3.25rem)] leading-tight font-bold tracking-[-0.03em]">Check my computer</h1>
          <p className="mt-1 text-sm text-muted">
            We check that everything OneClip needs is installed. Fix anything red, then make clips.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => run(false)} loading={busy === "get"} disabled={!!busy}>
            <RefreshCw aria-hidden />
            Check again
          </Button>
          <Button onClick={() => run(true)} loading={busy === "jev"} disabled={!!busy}>
            <Zap aria-hidden />
            Test the clip judge (uses a tiny bit of credit)
          </Button>
        </div>
      </div>

      {error ? <div className="mt-6"><Notice>{error}</Notice></div> : null}

      {checks ? (
        <>
          <p className={cn("mt-6 text-sm font-medium", blocking ? "text-bad" : "text-good")}>
            {blocking ? `${blocking} ${blocking === 1 ? "thing" : "things"} to fix before you can make clips` : "All set: go make clips!"}
          </p>
          <ul className="mt-3 divide-y divide-line glass rounded-xl">
            {checks.map((c) => {
              const Icon = c.ok ? CircleCheck : c.required ? CircleX : CircleAlert;
              return (
                <li key={c.id} className="flex gap-3 px-4 py-3">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", c.ok ? "text-good" : c.required ? "text-bad" : "text-warn")} aria-label={c.ok ? "passes" : "fails"} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex items-center gap-2 font-medium">
                      {c.label}
                      {!c.required ? <Badge>Nice to have</Badge> : null}
                    </p>
                    <p className="mt-0.5 break-words text-muted">{c.detail}</p>
                    {!c.ok && c.fix ? <p className="mt-1 font-mono text-xs text-fg">{c.fix}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
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
