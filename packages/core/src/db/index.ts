import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema.ts";

export type Db = SqliteRemoteDatabase<typeof schema>;

/**
 * SQLite through Node's built-in `node:sqlite` (no native addon to compile),
 * exposed to Drizzle via its proxy driver. WAL lets the web app and the
 * worker share the file.
 */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  raw.exec(schema.DDL);
  // Databases made before link support lack source_url.
  const cols = raw.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "source_url")) raw.exec("ALTER TABLE projects ADD COLUMN source_url TEXT");
  return drizzle(
    async (sql, params, method) => {
      const stmt = raw.prepare(sql);
      if (method === "run") {
        stmt.run(...params);
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      // Drizzle expects `rows` to be the single row (or undefined) for "get".
      if (method === "get") return { rows: stmt.get(...params) as unknown as unknown[] };
      return { rows: stmt.all(...params) as unknown[] };
    },
    { schema },
  );
}

export { schema };
