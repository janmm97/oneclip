# OneClip

OneClip is an open-source AI video clipper powered by [One](https://withone.ai), TypeSafe Jev and AI editing agents. It finds the strongest hooks in a long video and turns them into short vertical clips, on your own computer.

- **Local first.** Transcription, cutting, captions and rendering all run on your machine. The only thing that leaves it is clip text: sent to Jev for scoring and, by default, to an AI planner (OpenRouter via One, Claude Code or OpenCode) for edit plans. Pick the `template` planner to keep it off every AI service except Jev ([Privacy](#privacy)).
- **Ranked by Jev, not by vibes.** Every candidate clip gets six scored dimensions, a context check and a hook type from TypeSafe's Jev, and the ranking explains itself.
- **Real files out.** You get playable 1080×1920, 30 fps MP4s with word-by-word captions, ready to post.

![OneClip's Hook Results screen: three clips ranked by Jev with a live caption preview and per-dimension scores](docs/images/results.png)

> **New to terminals, Claude Code or One?** Follow the [step-by-step getting-started guide](docs/GETTING-STARTED.md): it's illustrated and goes from a new computer to your first clips.

> **One is required, not a sponsor link.** OneClip calls TypeSafe's Jev through the [One CLI](https://withone.ai). One holds your TypeSafe connection and credentials; OneClip never sees or stores an API key.

## Contents

[How it works](#how-it-works) · [Requirements](#requirements) · [Quick start](#quick-start) · [Using the app](#using-the-app) · [Command line](#command-line) · [How Jev ranks hooks](#how-jev-ranks-hooks) · [Editing plans](#how-editing-plans-are-made) · [Rendering](#rendering) · [Costs](#costs-and-external-services) · [Privacy](#privacy) · [Troubleshooting](#troubleshooting) · [Roadmap](#roadmap) · [Licence](#licence)

## How it works

```mermaid
flowchart LR
  A[A video or podcast link<br/>or a local video/audio file] --> B[FFprobe + FFmpeg<br/>probe, 16 kHz audio]
  B --> C[Transcribe locally<br/>faster-whisper or ONNX Whisper]
  C --> S[Measure sound and picture<br/>FFmpeg loudness + scene changes]
  S --> D[Candidate clips<br/>spoken passages + sound/picture moments]
  D --> E[Jev via One CLI<br/>6 scores + context + hook type]
  E --> F[Rank, penalise,<br/>de-duplicate, top N]
  F --> G[Edit plan<br/>OpenRouter via One / Claude Code /<br/>OpenCode / template]
  G --> H[Render<br/>Remotion or FFmpeg]
  H --> I[Verify with FFprobe<br/>retry once]
  I --> J[MP4 + thumbnail<br/>in the Export gallery]
```

| Part | Where | What it does |
|---|---|---|
| `apps/web` | Next.js App Router, Tailwind, Remotion Player | The five screens: Setup, Video input, Processing, Hook results, Exports |
| `workers/media` | Node process | Claims jobs from SQLite and runs the pipeline; resumes after a restart |
| `packages/core` | TypeScript | One client, Jev questions and ranking, transcription, segmentation, plans, FFmpeg renderer, SQLite (Drizzle) |
| `packages/remotion` | Remotion | Three templates (`podcast-short`, `educational-short`, `storytelling-short`) with three caption styles |
| `python/transcribe.py` | Python | faster-whisper with word timestamps (optional; there is an ONNX fallback in Node) |
| `datasets/` | JSON | Synthetic hook examples and evaluation cases for `pnpm eval:hooks` |

## Requirements

| Need | Version | Notes |
|---|---|---|
| Node.js | 22.13 or newer | Tested on Node 26 |
| pnpm | 10 | `corepack enable` installs the pinned version |
| FFmpeg + FFprobe | 6 or newer, with libass | libass is only needed for the FFmpeg renderer's captions. On Windows, the gyan.dev "full" build has it |
| One CLI | 2.x | `npm i -g @withone/cli`, then a free One account |
| A TypeSafe account | — | Connected in One with `one add typesafe` |
| Python | 3.10 to 3.12 (needed for links) | Installs yt-dlp for YouTube and other links, and faster-whisper. Without it, local files still work and OneClip uses Whisper on ONNX Runtime (CPU) |
| OpenRouter (optional) | — | For AI edit plans with cheap models: `one add open-router`. Claude Code or OpenCode also work. Without any of them, the built-in template planner is used |
| Disk | ~1 GB free | Whisper model, Chrome Headless Shell (~131 MB, downloaded on the first Remotion render), renders |

No GPU is needed. Everything was tested on Windows 11 on CPU; macOS and Linux use the same code paths but haven't been run end to end yet ([help wanted](CONTRIBUTING.md)).

## Quick start

First time? The [getting-started guide](docs/GETTING-STARTED.md) walks through every step below with pictures.

```bash
git clone https://github.com/janmm97/oneclip.git
cd oneclip
corepack enable
pnpm install

# One account + TypeSafe account (once). Jev scoring uses TypeSafe tokens, ~34k per video (see Costs)
npm i -g @withone/cli
one init          # sign up or sign in at https://withone.ai
one add typesafe  # connect your TypeSafe account (create one when it asks you to sign in)
one add open-router  # optional: AI edit plans with cheap models

pnpm run setup    # checks One → TypeSafe → Jev, installs faster-whisper if Python is there, downloads the model
pnpm run doctor   # every check in one list; add --test-jev for one live call (~300 tokens)
pnpm dev          # web app on http://127.0.0.1:3000 plus the media worker
```

Use `pnpm run setup` and `pnpm run doctor`, not `pnpm setup` / `pnpm doctor`: those two names are pnpm's own built-in commands.

Want to try it without your own footage? `pnpm sample` makes a synthetic test video with speech, and `pnpm e2e` runs the whole pipeline on it.

## Using the app

1. **Setup** shows the same checks as `pnpm run doctor`, with the exact fix for anything red. "Test Jev live" sends one small request.
2. **New clip.** Paste a link (YouTube or any video, audio or podcast site yt-dlp supports) or the full path to a video or audio file on your computer, and tick that you own it or are authorised to edit it. Links are downloaded when the analysis starts; audio-only sources (podcasts, MP3s) are turned into a cover-art video first. Pick the clip length, how many clips to keep, the renderer, the edit planner and the captions:
   - **English (translated when needed)**, the default. For a link, OneClip uses the site's English subtitles when it has them (a K-pop video's official English lyrics, for example); otherwise Whisper translates the audio into English on your machine.
   - **Original language**: captions in the language that's spoken or sung.
   - **No captions**.

   **Content type** is **Auto-detect** by default. OneClip works out what the source is (music video, song, podcast or interview, talk or tutorial, live stream, gameplay, film or sketch, vlog, sports, or footage) from the page's title, tags and category and from the sound and picture. Each type tells Jev what the best clip looks like: the chorus or drop of a song, the payoff of a podcast story, the clutch play in gameplay. In a music video, OneClip finds where the song itself plays and which lyric repeats (the chorus). A spoken skit, intro or outro outside the song isn't picked, and if it is, it scores lower. Openings that are greetings or sponsor reads score lower in every type. If the guess is wrong, pick the type yourself. The project page shows what was detected, for example "Detected: Music video · song 1:08–4:48 · chorus at 1:42, 2:44, 4:17".
3. **Processing** shows each stage live: probe, audio, transcribe, signals, candidates, Jev, plan. Talks, podcasts, songs, music videos, film scenes and silent footage all work: videos with no sound get a silent track and skip transcription. You can close the tab; the worker keeps going and resumes after a restart.
4. **Hook results** lists the clips ranked by Jev. Pick one to see a live caption preview, the hook type, every score with its weight, any penalties and the transcript. Choose "Quick preview" (fast, low resolution) or "Render 1080p", and rate the pick good, average or bad. Ratings stay on your machine and feed `pnpm eval:hooks --feedback`.
5. **Exports** plays every finished MP4, with a download link for each and "Download all (zip)".

**Where your clips go.** Every 1080p clip is saved automatically in the `clips/` folder inside your OneClip folder, one subfolder per video: `clips/<video-title>-<id>/01-<clip-title>.mp4`, `02-…`, in rank order. You don't need to pick or create a folder; it's made on first use and git-ignored. Set `ONECLIP_CLIPS_DIR` to save them somewhere else. Quick previews stay in `.oneclip`.

## Command line

| Command | What it does |
|---|---|
| `pnpm run setup [--skip-python] [--model base]` | First-run setup (see above) |
| `pnpm run doctor [--test-jev]` | Checks Node, FFmpeg, libass, One, TypeSafe, Jev, transcription, editing agent, Remotion |
| `pnpm clip <video> [--preset standard] [--top 5] [--candidates 24] [--planner auto] [--renderer remotion] [--quality final] [--captions english\|original\|off] [--content auto\|music_video\|podcast\|gameplay\|…] [--no-render]` | The whole pipeline without the UI |
| `pnpm clip <video> --vision auto\|local\|openrouter\|off` | How shots are described (see [Editing with your agent](#editing-with-your-agent)) |
| `pnpm run edit --plan edit.json (--project <id> \| --source video.mp4) [--ratio 9:16,16:9] [--quality preview] [--dry-run]` | Render an edit plan your agent (or you) wrote: shot order, borrowed audio, speed, mutes, audio bed |
| `pnpm eval:hooks [--dry] [--feedback] [--json]` | Runs Jev over `datasets/` and reports precision@K, ranking agreement, strong-hook recall and false-positive rate |
| `pnpm sample` / `pnpm e2e [--renderer remotion]` | Synthetic test video / full run on it |
| `pnpm test` · `pnpm lint` · `pnpm build` | Unit and integration tests · type checks · production build |

Optional settings are in [`.env.example`](.env.example) (data folder, clips folder, Python path, binary paths, Jev model, concurrency, OpenRouter models). None of them is a secret.

## How Jev ranks hooks

### Hooks in any kind of media

Words aren't the only hook. Before picking candidates, OneClip measures every second of the source with FFmpeg (locally, no AI): how loud it is and how much the picture changes (scene cuts, motion). From that it decides what drives the source:

| Source | Example | Candidates |
|---|---|---|
| Speech | Talks, podcasts, interviews | Mostly complete spoken passages, plus about a quarter sound/picture moments |
| Music | Songs, instrumentals, sound-led scenes | Half spoken (lyrics) passages, half moments |
| Visual | Silent footage, b-roll, scenes with little sound | All moments |

A **moment** opens where the sound jumps (a drop, a chorus, a hit), on a loud stretch, or on a cut or fast motion, and ends near the preset length on a cut or a dip, never mid-word. Moments are rendered whole (no silence trimming, so the beat isn't broken). Jev gets each clip's opening summarised in words ("First 3 s: sound jumps 18 dB, louder than the rest of the source; 2 scene cuts; lots of visual change.") and a 0–9 strip per second for loudness and visual change, next to any words. Two hook types cover what words can't: **sonic drop** and **visual spectacle**.

Jev reads text, not the media itself, so it judges sound and picture from these measurements. Songs with lyrics all the way through are usually classed as speech; they still get moments and Jev still sees their sound and picture.

### The questions

For each candidate clip, OneClip sends **one** request to Jev (TypeSafe's "Answer questions using Systemone" action) through `one actions execute`. It asks eight questions about the clip's words, sound and picture:

| Question | Jev answer type | Weight |
|---|---|---|
| Hook strength: does the opening make you keep watching? | Score | 0.25 |
| Standalone clarity: does it make sense without the rest? | Score | 0.20 |
| Narrative payoff: does it deliver what the hook promised? | Score | 0.20 |
| Novelty | Score | 0.15 |
| Emotional engagement | Score | 0.10 |
| Editing suitability | Score | 0.10 |
| Context integrity: is it a complete thought? | Noul (0 to 1) | gate |
| Hook type (curiosity gap, contrarian, storytelling, sonic drop, visual spectacle, …) | Choice | label |

The final score is the weighted sum, then:

- ×0.5 if context integrity is below 0.5 (the clip depends on something outside it);
- ×0.8 if standalone clarity is below 0.35;
- ×0.9 if there's no recognisable hook and hook strength is below 0.5.

Clips that overlap a better clip by more than half, or repeat its text, are dropped, and the top N are kept. Answers are validated with Zod and cached in SQLite, so re-running a project costs nothing.

**Measured on the bundled datasets** (29 live Jev calls, 2026-11-24): precision@2 83%, ranking agreement 100%, strong-hook recall 100%, false-positive rate 0%. The datasets are small and synthetic; treat these as a smoke test, not a benchmark.

## How editing plans are made

The planner turns a ranked clip into an `EditPlan`: template, layout, crop, caption style, emphasis words, title card, transitions. The planner only chooses within fixed options; OneClip fills in the timings and checks the whole plan with Zod before rendering.

| Planner | How |
|---|---|
| `openrouter` | One chat completion per clip through `one actions execute open-router …`, on cheap models with JSON output: `deepseek/deepseek-v4-flash`, then `tencent/hy4-flash`, then `openai/gpt-6-luna` if one is down (change them with `ONECLIP_OPENROUTER_MODELS`). No tools are sent, so the model can only return text |
| `claude-code` | Runs `claude -p` with a JSON schema for the answer, all tools turned off, no MCP servers and no saved session |
| `opencode` | Runs `opencode run` with the clip on stdin, every tool and permission denied and an empty working folder, and reads the first JSON object from the reply |
| `template` | Deterministic rules, no AI, always available |
| `auto` (default) | OpenRouter via One, then Claude Code, then OpenCode, then template |

If an agent's output doesn't validate, OneClip falls back to the template planner and shows why in the results.

### Editing with your agent

OneClip saves what it saw and heard in each project folder (`.oneclip/projects/<id>/`), so Claude Code, OpenCode or any agent can re-cut a clip like an editor would:

- `scenes.json`: every shot with its times and, when a vision model ran, what's on screen and what happens;
- `frames/` and `sheets/`: one frame per shot and 4×4 contact sheets;
- `transcript.json`: every word with its time;
- `hooks.live.jsonl`: Jev's hook scores.

Shots are described by the `vision` setting:

| `vision` | Who describes the shots | Cost |
|---|---|---|
| `auto` (default) | A local vision model in [LM Studio](https://lmstudio.ai) if one is downloaded, otherwise nobody | Free |
| `local` | LM Studio or any OpenAI-compatible server (`ONECLIP_VISION_URL`, `ONECLIP_VISION_MODEL`) | Free, nothing leaves your PC |
| `openrouter` | Vision models through your One OpenRouter connection | Paid per frame |
| `off` | Nobody: your agent reads the contact sheets itself | Free |

Measured: `qwen/qwen3.5-4b` in LM Studio described 8 shots of a 89 s gameplay video in 101 s on an RTX 3050 Laptop GPU (4 GB). It got the setting and main events right, and misnamed some small objects.

The skill in [`skills/oneclip-editor/SKILL.md`](skills/oneclip-editor/SKILL.md) teaches your agent pro editing (hooks, cutting on action, J-cuts, replays, reactions, music beds) and **scene mixing**, meaning shots in any order with sound from another moment. The agent then renders with `pnpm run edit`.

## Agent skills

Clone OneClip and your agent gets the `oneclip-editor` skill plus 17 motion-graphics repos (the list in [Claude motion graphics repos 2026](https://trinhstudio.com/inside/claude-motion-graphics-repos-2026)) for captions, titles and animation. OneClip installs every skill those repos ship into `.claude/skills/` and `.agents/skills/`:

- **Claude Code** does it on the first session in the OneClip folder (a `SessionStart` hook in `.claude/settings.json`; Claude Code asks you to trust the folder first). If the skills don't show up in that first session, start a new one.
- **Codex, OpenCode, Cursor and other agents**: [`AGENTS.md`](AGENTS.md) tells them to run `pnpm skills`. `pnpm run setup` runs it too.

| Group | Repos |
|---|---|
| Render engines | HyperFrames (Apache-2.0), Remotion, Remotion skills |
| Video skills | animate, claude-motion, claude-motion-design, product-launch-motion, motion-graphics-skills, claude-remotion-skill, motion-graphics (Barty-Bart), hyperframes-motion-reel-skill |
| Motion taste | LottieFiles motion-design-skill, iart-ai motion-design-skills, awesome-motion-design-agent-skills |
| Web animation | GSAP, Motion, lottie-web |

Repos, links and pinned commits are in [`skills/motion-skills.json`](skills/motion-skills.json). `pnpm skills` installs or updates them, and `pnpm skills --only animate,gsap` installs just some. OneClip fetches each repo at its pinned commit and copies only the folders that have a `SKILL.md`, so libraries without agent skills (such as lottie-web) add nothing. What got installed is listed in `.claude/skills/.oneclip-skills.json`. It needs only Node and git. Set `ONECLIP_SKIP_SKILLS=1` to turn it off. Skills you already have with the same name are never overwritten. If a skill pre-approves tools or adds hooks (`allowed-tools` or `hooks` in its frontmatter), OneClip prints a warning.

These skills are third-party. OneClip doesn't ship them: it fetches them from their own repos on your machine. Each one is pinned to a commit, so a later push upstream doesn't reach your agent until a OneClip PR moves the pin. To move the pins, run `pnpm skills --latest --pin`, review what changed upstream, then open a PR. `pnpm skills --latest` on its own installs each repo's newest commit without pinning it (unreviewed). Read a skill's scripts before you let an agent run them, and check each repo's licence before client work.

## Rendering

- **Remotion** (default): animated word-by-word captions, title card and the three templates, rendered headless with Chrome Headless Shell (downloaded once, ~131 MB). Measured: about 107 s for a 46 s clip at 1080×1920 on CPU. `pnpm install` installs the Remotion packages OneClip needs; Remotion's agent skills come with the [agent skills](#agent-skills). Remotion is free for individuals and companies of up to 3 people; larger companies need a [company licence](https://www.remotion.dev/license).
- **FFmpeg**: faster and lighter. Captions are burned in with ASS/libass. Use it on slower machines or if Chrome can't be downloaded.

**Face-safe captions.** Before each render OneClip looks at three frames of every shot with a small local face detector ([YuNet](https://huggingface.co/opencv/face_detection_yunet), MIT, 233 kB, downloaded once into `.oneclip/models/` and checked by SHA-256) and places each caption page in the lower third, or wherever is clear of the faces in that shot for the chosen frame shape. Measured on a 3-shot podcast clip: about 3–5 s on CPU. If the model can't be downloaded or a frame can't be read, captions keep the default lower-third spot.

Every render is checked with FFprobe (size, duration, H.264 video, an audio track and audio/video drift). If the chosen renderer fails or its output doesn't pass the check, OneClip retries the clip with the FFmpeg renderer.

## Costs and external services

| Service | Used for | Cost |
|---|---|---|
| [One](https://withone.ai) | Runs the TypeSafe and OpenRouter actions and holds your credentials | See One's pricing |
| TypeSafe Jev | Scoring clips | About **1,400 tokens per candidate clip** on your TypeSafe account. The default 24 candidates ≈ 34k tokens per video. `pnpm run doctor --test-jev` ≈ 300 tokens. `pnpm eval:hooks` ≈ 41k tokens. Cached answers are free |
| OpenRouter (optional) | Edit plans | One request per kept clip (about 4k characters in) on your OpenRouter account. Measured with `deepseek/deepseek-v4-flash`: **$0.0001 to $0.0006 per clip** (6 plans, average $0.0003), so about $0.002 for the default 5 clips |
| Claude Code / OpenCode (optional) | Edit plans | One short prompt per clip on your own plan or API key |
| YouTube oEmbed | Title and thumbnail preview | Free, no key |
| yt-dlp | Downloads links from YouTube and other sites | Free, open source; installed with pip on first use |
| Hugging Face | One download of the YuNet face model (233 kB) for face-safe captions | Free, no key |
| Remotion | Rendering | Free for individuals and small companies; larger companies need a [Remotion company licence](https://www.remotion.dev/license) |

## Privacy

- Your video, audio and renders never leave your machine.
- Clip **text** (transcript excerpts) goes to TypeSafe through One for scoring, and to OpenRouter through One (or Claude Code or OpenCode) for edit plans. Pick the `template` planner to keep it off every AI service except TypeSafe.
- Links are downloaded to your computer; nothing is uploaded to YouTube or anywhere else. There is no telemetry.
- The web app listens on 127.0.0.1 only and rejects requests with another Host or Origin.
- Projects, transcripts and the database live in `./.oneclip`, finished clips in `./clips` (both git-ignored). Delete both folders to delete everything.

Only process videos you own or are authorised to edit.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm setup` does something unexpected | Use `pnpm run setup`; `setup` and `doctor` are pnpm built-ins |
| "One CLI not found" | `npm i -g @withone/cli`, or set `ONE_BIN` |
| "TypeSafe not connected" | `one add typesafe`; if you have several, set `ONE_TYPESAFE_KEY` |
| faster-whisper won't install or crashes | It needs Python 3.10–3.12. OneClip falls back to ONNX Whisper automatically. On Windows 11 with **Smart App Control** on, unsigned native Python wheels can be blocked; the ONNX fallback still works |
| ONNX transcripts are weaker | The ONNX fallback is a lighter path: it uses Whisper small for every model setting (medium and large-v3 included), transcribes in 30 s windows, and assumes English when the language is auto. Set the language explicitly for other languages, or install faster-whisper for best results |
| FFmpeg captions missing | Your FFmpeg has no libass; install a full build, or use the Remotion renderer |
| English captions of a song are off | Whisper's translation is made for speech and is weak on singing. Use a link that has English subtitles (official music videos usually do), or pick "Original language" |
| A local non-English file gets captions in its own language | The ONNX fallback can't detect the language of a local file. Install faster-whisper (`pnpm run setup`) or set the language, and English captions are translated |
| First Remotion render is slow | It downloads Chrome Headless Shell once (~131 MB) |
| "No complete thoughts fit this clip length" | Pick a shorter preset; very short or music-only videos have few complete sentences |
| A render failed | The results screen shows the error; "Render 1080p" again retries. Try the FFmpeg renderer |

## Roadmap

- Speaker-aware cropping (face tracking) for two-person podcasts
- More caption styles and brand colours per project
- macOS and Linux end-to-end runs in CI
- Batch mode across a folder of videos

Ideas and bugs: [open an issue](https://github.com/janmm97/oneclip/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `pnpm install`, `pnpm lint && pnpm test`, small PRs with Conventional Commit messages. Security issues: see [SECURITY.md](SECURITY.md).

## Licence

OneClip's own code is [MIT](LICENSE). Its dependencies keep their own licences: notably **Remotion**, which is free for individuals and companies of up to three people and needs a paid company licence beyond that (see [remotion.dev/license](https://www.remotion.dev/license)); faster-whisper (MIT); Whisper model weights (MIT, by OpenAI); FFmpeg (LGPL/GPL, installed separately, not bundled). If Remotion's licence doesn't fit you, use the FFmpeg renderer, which has no Remotion dependency at render time.
