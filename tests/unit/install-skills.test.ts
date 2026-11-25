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

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, stdio: "pipe" });
function host(repo: string, files: Record<string, string>) {
  const src = join(work, "src", repo);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(src, f, ".."), { recursive: true });
    writeFileSync(join(src, f), body);
  }
  git(src, "init", "-q", "-b", "main");
  git(src, "add", ".");
  git(src, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  git(work, "clone", "-q", "--bare", src, join(hosts, `${repo}.git`));
}
const install = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ONECLIP_SKILLS_ROOT: root, ONECLIP_SKILLS_GIT_BASE: pathToFileURL(hosts).href, ONECLIP_SKIP_SKILLS: "" },
  });
const skill = (name: string) => `---\nname: ${name}\ndescription: test\n---\n# ${name}\n`;
const has = (name: string) => [".claude", ".agents"].every((d) => existsSync(join(root, d, "skills", name, "SKILL.md")));
const marker = () => JSON.parse(readFileSync(join(root, ".claude", "skills", ".oneclip-skills.json"), "utf8"));
const manifest = (ids: string[]) =>
  writeFileSync(join(root, "skills", "motion-skills.json"), JSON.stringify({ sources: ids.map((id) => ({ id, repo: `o/${id}` })) }));

host("o/multi", { "skills/captions/SKILL.md": skill("captions"), "skills/captions/scripts/x.js": "1", "skills/captions/inner/SKILL.md": skill("inner"), "plugin/reel/SKILL.md": skill("reel"), "README.md": "r" });
host("o/rootskill", { "SKILL.md": skill("rootskill"), "rules/easing.md": "e" });
host("o/library", { "src/index.js": "1" });
host("o/dupe", { "captions/SKILL.md": skill("other captions") });
mkdirSync(join(root, "skills", "oneclip-editor"), { recursive: true });
writeFileSync(join(root, "skills", "oneclip-editor", "SKILL.md"), skill("oneclip-editor"));
mkdirSync(join(root, ".claude", "skills", "reel"), { recursive: true });
writeFileSync(join(root, ".claude", "skills", "reel", "SKILL.md"), "mine");

describe("install-skills", () => {
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

  it("--if-missing retries after a failure and is a no-op once complete", () => {
    manifest(["multi", "rootskill"]);
    expect(install("--if-missing").stdout).toContain("Installing");
    expect(marker().failed).toEqual([]);
    expect(install("--if-missing").stdout).toBe("");
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
    manifest(["linky"]);
    install("--only", "linky");
    expect(has("s")).toBe(true);
    expect(existsSync(join(root, ".claude", "skills", "s", "escape"))).toBe(false);
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
