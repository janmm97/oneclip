# Contributing to OneClip

Thanks for helping. OneClip is small on purpose: a local pipeline (transcribe → candidates → Jev ranking → edit plan → render) with clear module boundaries. Please keep changes small and tested.

## Set up

```bash
git clone https://github.com/janmm97/oneclip.git
cd oneclip
corepack enable          # gives you the pinned pnpm
pnpm install
pnpm run setup           # Python deps, Remotion browser, then the doctor
pnpm test
pnpm dev                 # http://127.0.0.1:3000
```

`pnpm run setup` (with `run`) matters: plain `pnpm setup` is pnpm's own built-in command.

You need Node 22.12+, Python 3.10+, FFmpeg on PATH and, for real runs, the One CLI with a TypeSafe connection (see the README). Tests don't need One, TypeSafe or an agent.

## Where things live

| Path | What |
|---|---|
| `packages/core/src/one` | One CLI client (the only way OneClip reaches TypeSafe) |
| `packages/core/src/jev` | Jev questions, normalisation, ranking, dedupe |
| `packages/core/src/transcription` | faster-whisper bridge (`python/transcribe.py`) |
| `packages/core/src/discovery` | transcript → clip candidates |
| `packages/core/src/plan` | edit-plan schema and planners (OpenRouter via One, Claude Code, OpenCode, template) |
| `packages/core/src/ffmpeg` | FFmpeg / FFprobe engine |
| `packages/remotion` | Remotion compositions and renderer |
| `apps/web` | Next.js UI |
| `workers/media` | background job runner |

## Branches and commits

- Branch from `main`; one topic per branch.
- [Conventional Commits](https://www.conventionalcommits.org/): `feat: …`, `fix: …`, `docs: …`, `test: …`, `chore: …`.
- Open an issue first for big changes (new agents, new templates, a different transcription engine).

## Pull request checklist

- [ ] `pnpm lint` and `pnpm test` pass.
- [ ] New behaviour has a test that fails without the change.
- [ ] Mocks of One, TypeSafe or agents live only in tests and are named as mocks.
- [ ] Docs and `CHANGELOG.md` (under `[Unreleased]`) are updated.
- [ ] No media, model weights, `.env` files, connection keys or tokens are committed.

## Reviews

A maintainer reviews every PR. CI must be green before merge. We may ask you to split large PRs.

## Questions

Open a GitHub issue with the `question` label.

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).
