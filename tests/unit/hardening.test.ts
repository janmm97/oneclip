import { describe, expect, it } from "vitest";
import { claimNext, enqueue, openDb, progressUpdate, requeueStale, runProcess, schema } from "@oneclip/core";
import { eq } from "drizzle-orm";

describe("progressUpdate", () => {
  it("swallows a failed progress write instead of raising an unhandled rejection", async () => {
    const failing = { update: () => ({ set: () => ({ where: () => Promise.reject(new Error("SQLITE_BUSY")) }) }) };
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      progressUpdate(failing as never, "job", { progress: 0.5, message: "x" });
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("runProcess", () => {
  it("survives a child that exits without reading its input (EPIPE)", async () => {
    const big = "x".repeat(8 * 1024 * 1024);
    const r = await runProcess(process.execPath, ["-e", "process.exit(0)"], { timeoutMs: 20_000, input: big });
    expect(r.code).toBe(0);
  });
});

describe("requeueStale", () => {
  it("requeues a crashed job once, then fails it after 3 attempts", async () => {
    const db = openDb(":memory:");
    const id = await enqueue(db, { projectId: "p", kind: "analyze" });
    for (let i = 1; i <= 3; i++) {
      const job = await claimNext(db);
      expect(job?.attempts).toBe(i);
      await requeueStale(db);
      const row = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
      expect(row?.status).toBe(i < 3 ? "queued" : "failed");
    }
    expect(await claimNext(db)).toBeUndefined();
  });

  it("marks the project failed when its analysis gives up, so the page doesn't spin forever", async () => {
    const db = openDb(":memory:");
    await db.insert(schema.projects).values({ id: "p", title: "t", sourcePath: "/x.mp4", settings: {}, status: "running" });
    await enqueue(db, { projectId: "p", kind: "analyze" });
    for (let i = 1; i <= 3; i++) {
      await claimNext(db);
      await requeueStale(db);
    }
    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, "p")).get();
    expect(project?.status).toBe("failed");
    expect(project?.error).toMatch(/Gave up after 3 attempts/);
  });
});
