# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Hooks in any kind of media: a new "signals" stage measures loudness and visual change per second with FFmpeg, classes the source as speech, music or visual, and adds sound/picture "moments" (drops, choruses, hits, cuts, motion) next to spoken passages. Jev sees each clip's sound and picture and has two new hook types, `sonic_drop` and `visual_spectacle`. Silent videos and instrumentals now work instead of failing. Existing projects re-score once because the Jev request changed.
- Links as input: paste a YouTube link or a link from any site yt-dlp supports (other video platforms, SoundCloud, podcast pages, direct media URLs). OneClip downloads it (best quality up to 1080p) in the analyze job, with progress, and uses the page's title. yt-dlp is found on PATH or installed with pip on first use.
- Audio and podcasts: MP3, M4A, WAV, AAC, FLAC, OGG, Opus and WMA files (and audio-only links) become a 1080×1080 video of the cover art over a blurred background, then clip like any video. More video containers accepted (M4V, AVI, WMV, FLV, TS, MTS, MPG, 3GP, OGV).
- Project scaffold: MIT licence, README, contributing guide, code of conduct, security policy, issue and PR templates, CI.
- Core pipeline: FFprobe/FFmpeg ingestion, local transcription (faster-whisper with an ONNX Whisper fallback), sentence-aligned candidate clips with four length presets.
- Jev hook ranking through the One CLI: six weighted scores, a context-integrity gate, hook types, penalties, de-duplication, top N, SQLite cache.
- Evaluation harness (`pnpm eval:hooks`) with synthetic datasets and local good/average/bad feedback.
- OpenRouter edit planner through One (`one actions execute open-router`), on cheap models with JSON output and fallbacks; the default for `auto`.
- Edit planners (Claude Code, OpenCode, deterministic template) with Zod-validated plans and automatic fallback.
- Renderers: Remotion (three templates, word-by-word captions, 1080×1920 at 30 fps) and FFmpeg (ASS captions), with FFprobe output checks and an FFmpeg fallback.
- Local web app: Setup, Video input, Processing, Hook results (live Remotion preview), Exports (per-clip download and zip).
- `pnpm run setup`, `pnpm run doctor`, `pnpm clip`, `pnpm e2e`, and a resumable media worker.
