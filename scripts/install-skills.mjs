#!/usr/bin/env node
/**
 * Installs agent skills for this repo: OneClip's own (skills/<name>/SKILL.md) and the
 * third-party motion-graphics skills in skills/motion-skills.json.
 * Each source repo is shallow-cloned (only the folders holding a SKILL.md are checked out),
 * and every skill folder is copied into .claude/skills/ (Claude Code, OpenCode) and
 * .agents/skills/ (Codex and other agents). Both folders are git-ignored.
 *
 *   node scripts/install-skills.mjs              install or update everything
 *   node scripts/install-skills.mjs --if-missing  do nothing if a full install is already there
 *   node scripts/install-skills.mjs --only gsap,animate
 *
 * Env: ONECLIP_SKIP_SKILLS=1 turns it off; ONECLIP_SKILLS_GIT_BASE overrides the git host.
 * Needs only Node and git. Always exits 0 so it never blocks an agent session.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(process.env.ONECLIP_SKILLS_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const TARGETS = [".claude/skills", ".agents/skills"].map((d) => path.join(ROOT, d));
const MARKER = path.join(TARGETS[0], ".oneclip-skills.json");
const BASE = (process.env.ONECLIP_SKILLS_GIT_BASE ?? "https://github.com").replace(/\/+$/, "");
const SKIP_DIRS = new Set([".git", "node_modules"]);

const args = process.argv.slice(2);
const ifMissing = args.includes("--if-missing");
const onlyArg = args[args.indexOf("--only") + 1];
const only = args.includes("--only") && onlyArg ? new Set(onlyArg.split(",")) : null;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const git = (cwd, ...a) => run("git", a, { cwd, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }).then((r) => r.stdout.trim());
const hash = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");

function main() {
  if (process.env.ONECLIP_SKIP_SKILLS) return Promise.resolve();
  const previous = readJson(MARKER);
  if (ifMissing && previous && previous.failed?.length === 0) return Promise.resolve();
  return install(previous);
}

async function install(previous) {
  const manifest = readJson(path.join(ROOT, "skills/motion-skills.json")) ?? { sources: [] };
  const sources = manifest.sources.filter((s) => !only || only.has(s.id));
  const owned = new Set(Object.values(previous?.sources ?? {}).flatMap((s) => s.skills ?? []));
  const claimed = new Map(); // skill folder name -> SKILL.md hash
  const result = { installedAt: new Date().toISOString(), sources: { ...(only ? previous?.sources : {}) }, failed: [] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oneclip-skills-"));
  console.log(`Installing agent skills into .claude/skills and .agents/skills (${sources.length} sources)…`);

  // OneClip's own skills first, so their names are never taken by a third-party one.
  const local = { skills: [] };
  for (const name of fs.readdirSync(path.join(ROOT, "skills"))) {
    const dir = path.join(ROOT, "skills", name);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) copySkill(dir, name, owned, claimed, local);
  }
  result.sources.oneclip = { repo: "local", ...local };

  // Clone up to 4 repos at a time, then copy in manifest order so names are stable.
  const fetched = await pool(sources, 4, (s) => fetchSource(s, tmp).catch((e) => ({ error: e })));
  sources.forEach((s, i) => {
    const f = fetched[i];
    if (f.error) {
      result.failed.push(s.id);
      const lines = String(f.error.stderr || f.error.message).trim().split(/\r?\n/);
      return console.log(`  ✖ ${s.repo}: ${lines.find((l) => l.startsWith("fatal:")) ?? lines[0]}`);
    }
    const entry = { repo: s.repo, commit: f.commit, skills: [] };
    for (const dir of f.dirs) {
      const name = dir === f.root ? s.id : path.basename(dir);
      copySkill(dir, name, owned, claimed, entry, s.id);
    }
    result.sources[s.id] = entry;
    console.log(entry.skills.length ? `  ✔ ${s.repo}: ${entry.skills.join(", ")}` : `  · ${s.repo}: no SKILL.md (a library, not an agent skill)`);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(TARGETS[0], { recursive: true });
  fs.writeFileSync(MARKER, JSON.stringify(result, null, 2));
  const total = Object.values(result.sources).reduce((n, s) => n + s.skills.length, 0);
  console.log(`${total} skills ready.${result.failed.length ? ` ${result.failed.length} sources failed; run \`pnpm skills\` to retry.` : ""} Third-party skills are not reviewed by OneClip: check a repo's README and licence before client work.`);
}

async function fetchSource(s, tmp) {
  const dir = path.join(tmp, s.id);
  await run("git", ["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--quiet", `${BASE}/${s.repo}.git`, dir], { timeout: 300_000 });
  const commit = await git(dir, "rev-parse", "HEAD");
  const files = (await git(dir, "ls-tree", "-r", "--name-only", "HEAD")).split("\n");
  const skillDirs = [...new Set(files.filter((f) => /(^|\/)SKILL\.md$/.test(f) && !f.split("/").some((p) => SKIP_DIRS.has(p))).map((f) => path.posix.dirname(f)))];
  if (!skillDirs.length) return { commit, dirs: [], root: dir };
  await git(dir, "sparse-checkout", "set", "--no-cone", ...(skillDirs.includes(".") ? ["/*"] : skillDirs.map((d) => `/${d}/`)));
  await git(dir, "checkout", "--quiet", "HEAD");
  // A skill nested inside another skill's folder ships with its parent; keep only the outermost.
  const outer = skillDirs.filter((d) => !skillDirs.some((o) => o !== d && (o === "." || d.startsWith(`${o}/`))));
  return { commit, dirs: outer.map((d) => (d === "." ? dir : path.join(dir, d))), root: dir };
}

function copySkill(src, name, owned, claimed, entry, prefix) {
  const h = hash(path.join(src, "SKILL.md"));
  if (claimed.get(name) === h) return; // same skill shipped by two repos
  if (claimed.has(name) && prefix) name = `${prefix}-${name}`;
  if (claimed.has(name)) return console.log(`  · skipped duplicate skill name ${name}`);
  const dests = TARGETS.map((t) => path.join(t, name));
  if (dests.some((d) => fs.existsSync(d)) && !owned.has(name)) return console.log(`  · kept your own ${name} (not overwritten)`);
  for (const d of dests) {
    fs.rmSync(d, { recursive: true, force: true });
    // No symlinks: a link in someone else's repo could point the agent at files outside the skill.
    fs.cpSync(src, d, { recursive: true, filter: (p) => !SKIP_DIRS.has(path.basename(p)) && !fs.lstatSync(p).isSymbolicLink() });
  }
  claimed.set(name, h);
  entry.skills.push(name);
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

main().catch((e) => console.log(`Skill install skipped: ${e.message}`));
