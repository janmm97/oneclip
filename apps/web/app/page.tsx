import { schema } from "@oneclip/core";
import { desc } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { app } from "@/lib/server";
import { NewProject } from "./new-project";

export const dynamic = "force-dynamic";

/** Green ready, red failed, grey queued; anything else is a running step, shown blue. */
const TONE = { ready: "good", failed: "bad", queued: "neutral" } as const;

export default async function Home() {
  const projects = await app().db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).limit(20).all();
  return (
    <div className="mx-auto grid max-w-[110rem] gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
      <section>
        <h1 className="max-w-[18ch] text-[clamp(2.1rem,1rem+2.8vw,4.5rem)] leading-[1.02] font-bold tracking-[-0.035em] text-balance">
          Find the clips worth posting
        </h1>
        <p className="mt-3 max-w-[62ch] text-[clamp(0.95rem,0.85rem+0.3vw,1.15rem)] text-muted">
          Point OneClip at a video you own. It transcribes it locally, asks Jev to score every complete thought for hook strength, clarity and payoff,
          then renders the best ones as 1080p clips in the frame ratios you pick (9:16, 1:1, 4:5, 16:9, 4:3).
        </p>
        <NewProject />
      </section>
      <aside aria-labelledby="recent" className="lg:sticky lg:top-6 lg:self-start">
        <div className="glass rounded-xl p-2">
          <h2 id="recent" className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
            Recent projects
          </h2>
          {projects.length ? (
            <ul className="grid gap-0.5">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="press flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-raised">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.title}</span>
                      <span className="num text-xs text-muted">{new Date(p.createdAt).toLocaleString()}</span>
                    </span>
                    <Badge tone={TONE[p.status as keyof typeof TONE] ?? "info"}>{p.status}</Badge>
                    <ChevronRight className="size-4 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-1 rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-muted">No projects yet. Your first one shows up here.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
