import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Runs the real installer against local git repos standing in for the skill hosts.
const repoRoot = join(import.meta.dirname, "..", "..");
const script = join(repoRoot, "scripts", "install-skills.mjs");
const work = mkdtempSync(join(tmpdir(), "oneclip-skills-test-"));
const hosts = join(work, "hosts");
const root = join(work, "clone");
afterAll(() => rmSync(work, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const pins: Record<string, string> = { missing: "0".repeat(40) };
// Makes (or adds a commit to) a hosted repo and pins its id to that commit.
function host(repo: string, files: Record<string, string>) {
  const src = join(work, "src", repo);
  const bare = join(hosts, `${repo}.git`);
  const fresh = !existsSync(src);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(src, f, ".."), { recursive: true });
    writeFileSync(join(src, f), body);
  }
  if (fresh) git(src, "init", "-q", "-b", "main");
  git(src, "add", ".");
  git(src, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "c");
  if (fresh) git(work, "clone", "-q", "--bare", src, bare);
  else git(src, "push", "-q", bare, "main");
  return (pins[repo.slice(repo.indexOf("/") + 1)] = git(src, "rev-parse", "HEAD"));
}
const install = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ONECLIP_SKILLS_ROOT: root, ONECLIP_SKILLS_GIT_BASE: pathToFileURL(hosts).href, ONECLIP_SKIP_SKILLS: "" },
  });
const skill = (name: string) => `---\nname: ${name}\ndescription: test\n---\n# ${name}\n`;
const has = (name: string) => [".claude", ".agents"].every((d) => existsSync(join(root, d, "skills", name, "SKILL.md")));
const marker = () => JSON.parse(readFileSync(join(root, ".claude", "skills", ".oneclip-skills.json"), "utf8"));
const manifestFile = join(root, "skills", "motion-skills.json");
const manifest = (ids: string[], pinned = true) =>
  writeFileSync(manifestFile, JSON.stringify({ about: "t", sources: ids.map((id) => ({ id, repo: `o/${id}`, ...(pinned ? { commit: pins[id] } : {}) })) }));

host("o/multi", { "skills/captions/SKILL.md": skill("captions"), "skills/captions/scripts/x.js": "1", "skills/captions/inner/SKILL.md": skill("inner"), "plugin/reel/SKILL.md": skill("reel"), "README.md": "r" });
host("o/rootskill", { "SKILL.md": skill("rootskill"), "rules/easing.md": "e" });
host("o/library", { "src/index.js": "1" });
host("o/dupe", { "captions/SKILL.md": skill("other captions") });
mkdirSync(join(root, "skills", "oneclip-editor"), { recursive: true });
writeFileSync(join(root, "skills", "oneclip-editor", "SKILL.md"), skill("oneclip-editor"));
mkdirSync(join(root, ".claude", "skills", "reel"), { recursive: true });
writeFileSync(join(root, ".claude", "skills", "reel", "SKILL.md"), "mine");

// Each test spawns git many times; Windows CI runners take over the 5 s default.
describe("install-skills", { timeout: 30_000 }, () => {
  it("installs every skill folder from every source into both agent folders", () => {
    manifest(["multi", "rootskill", "library", "dupe", "missing"]);
    const r = install();
    expect(r.status).toBe(0);
    for (const s of ["oneclip-editor", "captions", "rootskill", "dupe-captions"]) expect(has(s)).toBe(true);
    expect(existsSync(join(root, ".agents", "skills", "captions", "scripts", "x.js"))).toBe(true);
    expect(existsSync(join(root, ".agents", "skills", "captions", "inner", "SKILL.md"))).toBe(true); // nested ships with parent
    expect(existsSync(join(root, ".claude", "skills", "rootskill", "rules", "easing.md"))).toBe(true);
    expect(readFileSync(join(root, ".claude", "skills", "reel", "SKILL.md"), "utf8")).toBe("mine"); // user's own kept
    const m = marker();
    expect(m.sources.library.skills).toEqual([]);
    expect(m.sources.multi.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(m.failed).toEqual(["missing"]);
    expect(r.stdout).toContain("o/library: no SKILL.md");
    expect(r.stdout).toMatch(/✖ o\/missing: fatal:/);
  });

  it("--if-missing redoes only failed or re-pinned sources, and is a no-op once complete", () => {
    manifest(["multi", "rootskill", "missing"]);
    const retry = install("--if-missing").stdout; // only the failed source, not all of them
    expect(retry).toContain("o/missing");
    expect(retry).not.toContain("o/multi");
    manifest(["multi", "rootskill"]);
    expect(install("--if-missing").stdout).toBe("");
    host("o/rootskill", { "SKILL.md": skill("rootskill v2") }); // a pin bump
    manifest(["multi", "rootskill"]);
    const bumped = install("--if-missing").stdout;
    expect(bumped).toContain("o/rootskill");
    expect(bumped).not.toContain("o/multi");
    expect(readFileSync(join(root, ".agents", "skills", "rootskill", "SKILL.md"), "utf8")).toContain("rootskill v2");
    expect(install("--if-missing").stdout).toBe("");
  });

  it("installs the pinned commit, not the newest one", () => {
    const old = host("o/pinned", { "p/SKILL.md": skill("old") });
    host("o/pinned", { "p/SKILL.md": skill("new") });
    pins.pinned = old;
    manifest(["pinned"]);
    install("--only", "pinned");
    expect(readFileSync(join(root, ".claude", "skills", "p", "SKILL.md"), "utf8")).toContain("name: old");
    expect(marker().sources.pinned.commit).toBe(old);
  });

  it("skips unpinned sources unless --latest, and --pin writes the commits", () => {
    const tip = host("o/loose", { "l/SKILL.md": skill("loose") });
    manifest(["loose"], false);
    expect(install("--only", "loose").stdout).toContain("no pinned commit, skipped");
    expect(has("l")).toBe(false);
    install("--only", "loose", "--latest", "--pin");
    expect(has("l")).toBe(true);
    expect(JSON.parse(readFileSync(manifestFile, "utf8")).sources[0].commit).toBe(tip);
    expect(readFileSync(manifestFile, "utf8")).toContain(`{ "id": "loose", "repo": "o/loose", "commit": "${tip}" }`);
  });

  it("flags a third-party skill that pre-approves tools", () => {
    host("o/tools", { "t/SKILL.md": "---\nname: t\nallowed-tools: Bash\n---\n" });
    manifest(["tools"]);
    expect(install("--only", "tools").stdout).toContain("! t pre-approves tools");
  });

  it("prints usage for --only without ids", () => {
    expect(install("--only").stdout).toContain("Usage:");
    expect(install("--pin").stdout).toContain("Usage:");
  });

  it.skipIf(process.platform === "win32")("never copies symlinks out of a skill", () => {
    const src = join(work, "src", "o", "linky");
    mkdirSync(join(src, "s"), { recursive: true });
    writeFileSync(join(src, "s", "SKILL.md"), skill("s"));
    symlinkSync(tmpdir(), join(src, "s", "escape"));
    git(src, "init", "-q", "-b", "main");
    git(src, "add", ".");
    git(src, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    git(work, "clone", "-q", "--bare", src, join(hosts, "o/linky.git"));
    pins.linky = git(src, "rev-parse", "HEAD");
    manifest(["linky"]);
    install("--only", "linky");
    expect(has("s")).toBe(true);
    expect(existsSync(join(root, ".claude", "skills", "s", "escape"))).toBe(false);
  });

  it("skips a skill whose folder name is not a plain name", () => {
    host("o/oddname", { "ok/SKILL.md": skill("ok"), "-rf bad/SKILL.md": skill("bad") });
    manifest(["oddname"]);
    const r = install("--only", "oddname");
    expect(has("ok")).toBe(true);
    expect(has("-rf bad")).toBe(false);
    expect(r.stdout).toContain("unsafe folder name");
  });

  it("is off with ONECLIP_SKIP_SKILLS", () => {
    const r = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, ONECLIP_SKILLS_ROOT: root, ONECLIP_SKIP_SKILLS: "1" } });
    expect(r.stdout).toBe("");
  });

  it("lists every repo from the article in the real manifest", () => {
    const real = JSON.parse(readFileSync(join(repoRoot, "skills", "motion-skills.json"), "utf8"));
    expect(real.sources).toHaveLength(17);
    expect(new Set(real.sources.map((s: { id: string }) => s.id)).size).toBe(17);
  });
});
