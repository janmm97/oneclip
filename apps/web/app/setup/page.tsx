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
          <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
          <p className="mt-1 text-sm text-muted">
            Same checks as <code className="font-mono text-fg">pnpm run doctor</code>. Fix anything red, then start a project.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => run(false)} loading={busy === "get"} disabled={!!busy}>
            <RefreshCw aria-hidden />
            Re-check
          </Button>
          <Button onClick={() => run(true)} loading={busy === "jev"} disabled={!!busy} title="Sends one tiny question to Jev (~300 tokens on your TypeSafe account)">
            <Zap aria-hidden />
            Test Jev live
          </Button>
        </div>
      </div>

      {error ? <div className="mt-6"><Notice>{error}</Notice></div> : null}

      {checks ? (
        <>
          <p className={cn("mt-6 text-sm font-medium", blocking ? "text-bad" : "text-good")}>
            {blocking ? `${blocking} required ${blocking === 1 ? "check fails" : "checks fail"}` : "Ready to clip"}
          </p>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-panel">
            {checks.map((c) => {
              const Icon = c.ok ? CircleCheck : c.required ? CircleX : CircleAlert;
              return (
                <li key={c.id} className="flex gap-3 px-4 py-3">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", c.ok ? "text-good" : c.required ? "text-bad" : "text-warn")} aria-label={c.ok ? "passes" : "fails"} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex items-center gap-2 font-medium">
                      {c.label}
                      {!c.required ? <Badge>optional</Badge> : null}
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
        <ul className="mt-6 grid gap-px overflow-hidden rounded-lg border border-line" aria-label="Running checks">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="h-14 animate-pulse bg-panel" />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
