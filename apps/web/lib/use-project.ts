"use client";

import type { ClipCandidate, EditPlan, HookEvaluation } from "@oneclip/core/browser";
import { useCallback, useEffect, useState } from "react";
import type { ProjectView } from "./server";
import { api } from "./utils";

export type View = ProjectView;
export type ClipRow = View["clips"][number] & { candidate: ClipCandidate; evaluation: HookEvaluation; plan: EditPlan | null };

/** Polls the project every 1.5s while anything is queued or running, then stops. */
export function useProject(id: string) {
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    try {
      setView(await api<View>(`/api/projects/${id}`));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  const active = !view || view.jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    void refresh();
    if (!active) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh, active]);
  return { view, error, refresh, clips: (view?.clips ?? []) as ClipRow[] };
}
