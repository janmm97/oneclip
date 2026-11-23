import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { jobs } from "../db/schema.ts";

export type Job = typeof jobs.$inferSelect;

export async function enqueue(db: Db, job: { projectId: string; kind: "analyze" | "render"; clipId?: string; quality?: "final" | "preview" }): Promise<string> {
  const id = randomUUID();
  await db.insert(jobs).values({ id, ...job, status: "queued", message: "Waiting to start" });
  return id;
}

/** Oldest queued job, marked running. Only one worker should poll a database. */
export async function claimNext(db: Db): Promise<Job | undefined> {
  const next = await db.select().from(jobs).where(eq(jobs.status, "queued")).orderBy(asc(jobs.createdAt)).limit(1).get();
  if (!next) return undefined;
  await db
    .update(jobs)
    .set({ status: "running", attempts: next.attempts + 1, updatedAt: Date.now() })
    .where(and(eq(jobs.id, next.id), eq(jobs.status, "queued")));
  return { ...next, status: "running", attempts: next.attempts + 1 };
}

export async function updateJob(db: Db, id: string, patch: Partial<Pick<Job, "stage" | "progress" | "message" | "status" | "error">>) {
  await db.update(jobs).set({ ...patch, updatedAt: Date.now() }).where(eq(jobs.id, id));
}

/** Jobs left "running" by a crashed or stopped worker go back in the queue. */
export async function requeueStale(db: Db) {
  await db.update(jobs).set({ status: "queued", message: "Resumed after restart", updatedAt: Date.now() }).where(eq(jobs.status, "running"));
}
