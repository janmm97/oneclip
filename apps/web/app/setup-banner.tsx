"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/utils";

/** Home's heads-up when a required setup check fails, so nobody finds out after pressing Make my clips. Silent while checking or if the check itself errors. */
export function SetupBanner() {
  const [toFix, setToFix] = useState(0);
  useEffect(() => {
    api<{ checks: { ok: boolean; required: boolean }[] }>("/api/doctor")
      .then(({ checks }) => setToFix(checks.filter((c) => c.required && !c.ok).length))
      .catch(() => {});
  }, []);
  if (!toFix) return null;
  return (
    <div role="status" className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
      <CircleAlert className="size-4 shrink-0 text-warn" aria-hidden />
      <span className="flex-1">
        {toFix} {toFix === 1 ? "thing" : "things"} to fix on this computer before OneClip can make clips.
      </span>
      <Link href="/setup" className="press inline-flex min-h-[44px] items-center rounded-full bg-raised px-4 font-medium hover:text-tally-fg">
        Fix it
      </Link>
    </div>
  );
}
