# OneClip for coding agents

OneClip is a local AI video clipper (TypeScript, pnpm workspace). Start with `README.md`.

## Skills

This repo gives your agent a set of skills:

- **`oneclip-editor`** (`skills/oneclip-editor/SKILL.md`): how to edit and remix clips with OneClip. Read it before any editing task.
- **`oneclip-hooks`** (`skills/oneclip-hooks/SKILL.md`): how to find the moments worth clipping and open each clip on a hook that stops the scroll (hook types, per-genre and per-platform rules, a local hook scanner, variants). Use it before `oneclip-editor` when picking or judging clips.
- **Motion-graphics skills** (HyperFrames, Remotion, LottieFiles motion design, animate, claude-motion and the others in `skills/motion-skills.json`): for captions, titles, animation and motion design.

They are installed into `.claude/skills/` and `.agents/skills/` (both git-ignored):

- **Claude Code** installs them by itself on the first session in this folder (the `SessionStart` hook in `.claude/settings.json`). If the skills don't show up in that first session, start a new one.
- **Any other agent** (Codex, OpenCode, Cursor, …): if `.agents/skills/` is missing or empty, run `pnpm skills` (or `node scripts/install-skills.mjs`) once, before anything else.

`pnpm skills` also updates them. It needs only Node and git. Third-party skills come from their own repos, at the commit pinned in `skills/motion-skills.json`. To move the pins, run `pnpm skills --latest --pin` and send the diff as a PR. Read a skill's scripts before running them.

## Working in this repo

- `pnpm install`, then `pnpm setup` (checks One CLI, TypeSafe, Whisper, yt-dlp, installs the skills).
- Before a PR: `pnpm lint` and `pnpm test`. Conventional Commits, small PRs.
- Never commit `.env`, keys, media or anything in `.oneclip/`.
