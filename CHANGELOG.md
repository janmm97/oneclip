# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Project scaffold: MIT licence, README, contributing guide, code of conduct, security policy, issue and PR templates, CI.
- Core pipeline: FFprobe/FFmpeg ingestion, local transcription (faster-whisper with an ONNX Whisper fallback), sentence-aligned candidate clips with four length presets.
- Jev hook ranking through the One CLI: six weighted scores, a context-integrity gate, hook types, penalties, de-duplication, top N, SQLite cache.
- Evaluation harness (`pnpm eval:hooks`) with synthetic datasets and local good/average/bad feedback.
- Edit planners (Claude Code, OpenCode, deterministic template) with Zod-validated plans and automatic fallback.
- Renderers: Remotion (three templates, word-by-word captions, 1080×1920 at 30 fps) and FFmpeg (ASS captions), with FFprobe output checks and an FFmpeg fallback.
- Local web app: Setup, Video input, Processing, Hook results (live Remotion preview), Exports (per-clip download and zip).
- `pnpm run setup`, `pnpm run doctor`, `pnpm clip`, `pnpm e2e`, and a resumable media worker.
