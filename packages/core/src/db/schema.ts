import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = () => Date.now();

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  youtubeUrl: text("youtube_url"),
  youtubeMeta: text("youtube_meta", { mode: "json" }),
  sourcePath: text("source_path").notNull(),
  sourceInfo: text("source_info", { mode: "json" }),
  settings: text("settings", { mode: "json" }).notNull(),
  status: text("status").notNull().default("queued"),
  transcriber: text("transcriber"),
  error: text("error"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  kind: text("kind").notNull(), // analyze | render
  clipId: text("clip_id"),
  quality: text("quality"),
  status: text("status").notNull().default("queued"), // queued | running | done | failed
  stage: text("stage"),
  progress: real("progress").notNull().default(0),
  message: text("message"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

export const transcripts = sqliteTable("transcripts", {
  cacheKey: text("cache_key").primaryKey(),
  engine: text("engine").notNull(),
  model: text("model").notNull(),
  data: text("data", { mode: "json" }).notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const clips = sqliteTable("clips", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  rank: integer("rank").notNull(),
  candidate: text("candidate", { mode: "json" }).notNull(),
  evaluation: text("evaluation", { mode: "json" }).notNull(),
  plan: text("plan", { mode: "json" }),
  planner: text("planner"),
  planError: text("plan_error"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const renders = sqliteTable("renders", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  clipId: text("clip_id").notNull(),
  quality: text("quality").notNull(),
  renderer: text("renderer").notNull(),
  path: text("path").notNull(),
  thumbPath: text("thumb_path"),
  status: text("status").notNull(), // done | failed
  verify: text("verify", { mode: "json" }),
  error: text("error"),
  ms: integer("ms"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const feedback = sqliteTable("feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  clipId: text("clip_id").notNull(),
  rating: text("rating").notNull(), // good | average | bad
  note: text("note"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

/** Jev answers keyed by a hash of the exact request, so re-running a project doesn't pay twice. */
export const jevCache = sqliteTable("jev_cache", {
  key: text("key").primaryKey(),
  data: text("data", { mode: "json" }).notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const DDL = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, youtube_url TEXT, youtube_meta TEXT, source_path TEXT NOT NULL, source_info TEXT, settings TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', transcriber TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, clip_id TEXT, quality TEXT, status TEXT NOT NULL DEFAULT 'queued', stage TEXT, progress REAL NOT NULL DEFAULT 0, message TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
CREATE TABLE IF NOT EXISTS transcripts (cache_key TEXT PRIMARY KEY, engine TEXT NOT NULL, model TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, rank INTEGER NOT NULL, candidate TEXT NOT NULL, evaluation TEXT NOT NULL, plan TEXT, planner TEXT, plan_error TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS clips_project ON clips(project_id, rank);
CREATE TABLE IF NOT EXISTS renders (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, clip_id TEXT NOT NULL, quality TEXT NOT NULL, renderer TEXT NOT NULL, path TEXT NOT NULL, thumb_path TEXT, status TEXT NOT NULL, verify TEXT, error TEXT, ms INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jev_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, clip_id TEXT NOT NULL, rating TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL);
`;
