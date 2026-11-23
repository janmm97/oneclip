import { schema } from "@oneclip/core";
import { desc } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { app } from "@/lib/server";
import { NewProject } from "./new-project";

export const dynamic = "force-dynamic";

const TONE = { ready: "good", failed: "bad", queued: "neutral" } as const;

export default async function Home() {
  const projects = await app().db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).limit(20).all();
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Find the clips worth posting</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Point OneClip at a video you own. It transcribes it locally, asks Jev to score every complete thought for hook strength, clarity and payoff,
          then renders the best ones as 1080×1920 clips.
        </p>
        <NewProject />
      </section>
      <aside aria-labelledby="recent">
        <h2 id="recent" className="text-sm font-medium text-muted">
          Recent projects
        </h2>
        {projects.length ? (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-panel">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-raised">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{p.title}</span>
                    <span className="num text-xs text-muted">{new Date(p.createdAt).toLocaleString()}</span>
                  </span>
                  <Badge tone={TONE[p.status as keyof typeof TONE] ?? "tally"}>{p.status}</Badge>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
            No projects yet. Your first one shows up here.
          </p>
        )}
      </aside>
    </div>
  );
}
