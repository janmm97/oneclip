/**
 * The media worker: one process, one job at a time, so transcription and
 * rendering never fight over the CPU/GPU. Jobs live in SQLite, so a crash or
 * restart resumes where it stopped (running jobs go back in the queue).
 */
import { claimNext, config, createDeps, ensureDirs, openDb, requeueStale, runJob } from "@oneclip/core";
import { RemotionRenderer } from "@oneclip/remotion";

const cfg = config();
ensureDirs(cfg);
const db = openDb(cfg.dbPath);
const deps = createDeps(db, cfg, { remotion: new RemotionRenderer() });
await requeueStale(db);
console.log(`OneClip worker ready (data: ${cfg.dataDir})`);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));

while (!stopping) {
  const job = await claimNext(db);
  if (!job) {
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }
  console.log(`→ ${job.kind} ${job.id}`);
  await runJob(deps, job);
}
process.exit(0);
