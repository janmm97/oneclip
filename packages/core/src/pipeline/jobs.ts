import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { jobs, projects } from "../db/schema.ts";

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

/** Fire-and-forget progress write: a failed progress tick (e.g. a busy DB) must not crash the worker. */
export function progressUpdate(db: Db, id: string, patch: { progress: number; message: string }): void {
  updateJob(db, id, patch).catch(() => {});
}

export const MAX_ATTEMPTS = 3;

/** Jobs left "running" by a crashed or stopped worker go back in the queue, unless they already crashed the worker MAX_ATTEMPTS times. */
export async function requeueStale(db: Db) {
  const now = Date.now();
  const error = `Gave up after ${MAX_ATTEMPTS} attempts (the worker stopped each time)`;
  const exhausted = and(eq(jobs.status, "running"), gte(jobs.attempts, MAX_ATTEMPTS));
  const gaveUp = await db.select({ projectId: jobs.projectId }).from(jobs).where(and(exhausted, eq(jobs.kind, "analyze"))).all();
  await db.update(jobs).set({ status: "failed", error, message: "Failed", updatedAt: now }).where(exhausted);
  // A project whose analysis gave up must show "failed" (with Retry), not "analyzing" forever.
  if (gaveUp.length) await db.update(projects).set({ status: "failed", error, updatedAt: now }).where(inArray(projects.id, gaveUp.map((j) => j.projectId)));
  await db.update(jobs).set({ status: "queued", message: "Resumed after restart", updatedAt: now }).where(eq(jobs.status, "running"));
}
