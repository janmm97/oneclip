---
name: oneclip-clipping
description: The professional clipper's playbook for OneClip, end to end. Use when turning a long video, podcast, stream, interview, tutorial, sports or TV source into short vertical clips, or when asked which scenes to use, how long a clip should be, how to edit, reframe, caption, mix audio, loop, package or post a clip, or whether a clip is original enough to post. Covers moment selection by elimination, clip arc and in/out points, length, pacing, silences, J/L cuts, reframing, safe zones, captions, loudness, B-roll, retention, originality and copyright, clipping-program rules and a pre-render checklist, each mapped to OneClip plan fields. Works with oneclip-hooks (the first 1–3 seconds) and oneclip-editor (plan syntax and rendering).
---

# OneClip clipping

You are the clipper and the editor. This skill holds what professional clippers do between "here is a 2-hour video" and "here is a clip worth posting". It is distilled from 46 sources (platform docs, creator studies, tool vendors' data). The full research, with every figure and source, is in [`references/research.md`](references/research.md).

How the three OneClip skills fit:

| Skill | Use it for |
|---|---|
| **`oneclip-clipping`** (this one) | Which moments to use, how to shape, edit, package and post them. |
| **`oneclip-hooks`** | The first 1–3 seconds: hook types, on-screen text hook, hook variants, the hook scanner. |
| **`oneclip-editor`** | The plan JSON (segments, `frame`, `audioFrom`, `bed`, presets), rendering and chat edits. |

How to read the numbers: **(vendor)** means a figure from a company that sells a clipping tool (directional, no published method). **(unverified)** means no primary source was found. Where sources disagree, this skill gives the reconciled default and the research file has the range.

## 1. Pick the moments: elimination, not discovery

Start from OneClip's ranked candidates (`hooks.live.jsonl`, the project page) and the transcript, then **throw out** until only clips you would post are left. A 2-hour podcast usually has about 4–8 truly postable moments. Plan for **3–5 strong clips per hour** and treat any AI list (Jev's included) as a long list for you to cut down.

A moment survives only if **all three** are true:

1. **It stands alone.** A stranger understands it with zero context from the episode.
2. **The payoff lands within ~20 s of the setup.** Longer gaps lose the viewer before the reward.
3. **It is one of the moment types that work:**
   - a contradiction of what the audience believes;
   - a specific number or concrete fact;
   - an unguarded reaction: a pause, a laugh, a flinch;
   - a compressed how-to (one problem, one fix);
   - debate or tension; an emotional peak (laughter, anger, tears); a surprising statement from a guest;
   - a complete mini-story with a beginning, middle and end (the rarest and most valuable).

**The moment beats the edit.** A perfect edit of a mediocre moment is still mediocre; don't try to rescue one.

**Signals that point at moments** (OneClip already measures some of them):
- Sound: loudness peaks (often laughter), faster speech, rising volume, a ~2 s off-script pause before an answer. OneClip's `signals` stage and `sonic_drop` hooks cover the loudness side.
- Picture: an expression change, the speaker standing up or turning to camera. Look at the shot `action`s and contact sheets.
- When sound and picture signals line up, the odds go up. In streams, chat floods (same emote, all caps) mark the moment.

**Reject on sight:** intros, greetings, sponsor reads, inside jokes and callbacks, routine stream chat, menus/loading/black screens, game cutscenes and endings, music-only footage with no line to caption, anything funny but without an arc, and anything you picked because it was easy to find.

**Quick score** (a synthesis, not a published framework): rate each survivor 1–5 on *stands alone*, *clear payoff*, *makes you feel or learn something specific*, *fits in 45 s*. Render the top scorers. Before posting, ask: does it fit the channel, is the tone right this week, will it land with this audience?

## 2. Shape the clip

**Arc:** hook → context → build → payoff → loop or hard end. Shorts are "intros that need a conclusion" (Galloway).

- **In point:** the first word of the answer or story. Not the question, not the silence before it. Put the question in the on-screen text or `title` instead.
- **Out point:** one beat after the payoff, while energy is still high. Never let it fade out. For a loop, end on a line that flows into the opening line (§6).
- **Cut by meaning, not by silence.** Start where the story starts and end where the arc closes. Never cut into a build because there is a pause before the punchline.
- **Payoff first is allowed:** cold-open on the outcome or the reaction (2–4 s), then rewind into how it happened. In OneClip, list the payoff segment first, then the setup (segments may repeat source time).
- **Reordering must keep the meaning.** Never rearrange a guest's words into something they didn't say. No out-of-context clickbait.

**Length follows the moment.** Default **20–45 s**.

| Kind | Length |
|---|---|
| Comedy, a single quote | 18–28 s (vendor), payoff on a clean cut |
| Tutorial, how-to | 25–45 s |
| Podcast, interview | ~40 s; 45–75 s only when the moment earns it |
| Vlog, storytelling | 30–45 s, a new beat every 5–7 s (vendor) |
| Stream, gaming | 30–60 s; up to ~90 s for a full story |
| Sports | best performers ran 51–60 s (1,430 sports Shorts) |
| TikTok Creator Rewards | over 60 s, or it doesn't pay |

Go past 45 s only if the clip holds: viewers who stay matter more than raw length. Shorts with Content ID-claimed music over 60 s may be blocked. YouTube Shorts and Reels accept up to 3 min.

## 3. Genre rules

| Source | Select | Edit in OneClip |
|---|---|---|
| **Podcast, interview** | Start on the answer, end one beat after the payoff; cut on speaker changes, never mid-sentence | Follow the active speaker (`crop-center` auto-framing). For arguments and comedy, force a stacked split on the exchange: `frame: { mode: "split", x, x2, zoom }` |
| **Stream, gaming** | Reactions and action, clutch plays, fails with setup and payoff inside 15 s | Facecam on top, gameplay below (creators use ~25–30 % for the facecam; OneClip's `split` is a fixed 50/50 stack, so the facecam gets half the frame). Keep the original game audio. No webcam: centre crop. A facecam scaled 3–4× looks soft |
| **Sports** | The unexpected play and funny moments a highlight package would skip; post fast, the moment goes stale | Minimal editing; the play at full speed, then a slow replay (`speed: 0.5`). Sports Shorts did better **without** added text and music |
| **Tutorial, demo, slides** | One problem, one fix | Show the whole frame: `layout: "blur-background"` or `frame: { mode: "fit" }`; cropping hides the information |
| **Comedy** | The bit with its setup inside 20 s | Split so the listener's reaction shows; payoff on a hard cut, no transition |
| **Vlog, story** | The strangest image, the peak reaction | A new beat every 5–7 s; B-roll from later in the video under the narration (`audioFrom`) |
| **TV, film scene** | The riskiest category (see §7) | Only with real commentary, narration or your own storyline. A raw scene with a border is "unoriginal" |
| **Music** | Chorus, drop, the hook line | No sourced clipping framework exists; use `oneclip-hooks` (`sonic_drop`). Mind both copyrights: composition and recording |

## 4. Edit

Top clips are edited **lightly**: in 13.5M clips (vendor), text overlays appear in ~4.5 %, B-roll in 6 %, music in under 2 %, branded intros in ~1 %. Captions are the exception (80 %). Spend effort on the moment and the cut, not effects.

**Pacing.** Something should change every 2–4 s in talking clips (a cut, a punch-in, a caption highlight, a reaction shot). Sources range from 1 to 6 s, so match the energy of the source. Every pattern interrupt must support the message, not add noise. Cut on movement.
- Punch-ins: `zoomAt` (source times) with `zoomIntensity` around 0.08–0.12; that size hides a jump cut and resets attention (unverified). Keep it under ~0.15 so it reads as a cut, not a zoom effect.

**Silences.** Trim pauses, don't delete them: aim for ~0.3 s gaps. `removeSilences: true` cuts pauses longer than 0.6 s and leaves ~0.25 s of padding. **Keep meaningful silence**: the pause before a punchline or an answer is part of the moment. To keep one, split the segments so the pause sits inside one segment, or leave `removeSilences` off for that clip. In fast clips remove breaths; in emotional ones leave them.

**J-cuts and L-cuts.** A J-cut starts the next shot's sound before its picture; an L-cut carries the previous sound over the next picture. Use them to show a reaction, B-roll or a screen recording while the speaker keeps talking, and to avoid ping-pong cutting in dialogue. In OneClip: a segment with `audioFrom` plays another moment's sound over this picture. See `skills/oneclip-editor/examples/voice-over-broll.json`.

**Reframing 16:9 to 9:16.**

| Situation | Method | OneClip |
|---|---|---|
| One speaker | Face-tracking crop, face in the upper ⅔ | `layout: "crop-center"` (auto-framing follows faces); override with `frame: { mode: "crop", x }` |
| Two people who both matter (debate, comedy, reaction) | Stacked split; each half is half the frame (1080×960 on 1080×1920), so a wide shot is zoomed to about one subject per half; use it only when both faces matter | `frame: { mode: "split", x, x2, zoom }`; auto-framing splits when two people are too far apart for one crop |
| Demo, slides, screen, wide sports shot | Fit the whole frame over a blurred fill | `layout: "blur-background"` or `frame: { mode: "fit" }` |
| Gaming with facecam | Facecam on top, gameplay below | `split` with the facecam position in `x`/`y` and the gameplay in `x2`/`y2` |

A static centre crop of a two-person table misses both faces: check the preview. Render every shape you post (`--ratio 9:16,1:1,4:5`) instead of one export for all platforms.

**Safe zones (9:16, 1080×1920).** No platform publishes one for organic posts, so use the cross-platform box: keep text, captions and faces inside a centred **~900×1400** area. Roughly: top ~15 %, bottom 25–35 %, right ~120 px (the like/comment rail) are covered. OneClip's captions sit in the lower third and move off faces by themselves; put the on-screen text hook below the top 15 %.

**Captions.**
- Always caption (80 % of top clips; most viewers start muted). One caption system only: never burned-in captions plus platform auto-captions.
- Kinetic style for clips: **1–3 words on screen**, the keyword highlighted. That is `captionPreset: "bold-pop"`; `karaoke` highlights word by word; `clean` is the calm subtitle style for tutorials, slides and accessibility. Put the words that carry the clip in `emphasis`.
- Readable: 12–17 characters per second is comfortable, 20 is the ceiling. Bold sans-serif, high contrast (outline, shadow or a 60–80 % box). Caps for emphasis only (the Hormozi style is all caps; pick one and be consistent).
- Never cover the mouth or hands, and never let the last word touch the right edge.

**Audio.**
- Loudness: export at **−14 LUFS integrated, about −1 dBTP**. OneClip normalises every render to −14 LUFS with a −1.5 dBTP ceiling, so leave `audio` alone.
- Music: most top clips use none, and sports and gaming do better with the original sound. If you add a `bed`, duck it 6–12 dB under speech: `duck` 0.25–0.5 (0.3 ≈ −10 dB is the default). Music-led moments: 0.5.
- Sound effects (whoosh, pop) on cuts and zooms are common practice with no sourced rule: use them sparingly.

**B-roll, emphasis, transitions.**
- B-roll only to show a specific noun or number the speaker names, carried by a J/L cut. Pull it from elsewhere in the same source.
- Emphasis: punch in on the key line, highlight the keyword, or add a short text line that adds something. Text that only describes what is on screen adds nothing (and doesn't count as an original edit on Instagram).
- Transitions: `transitionPreset: "none"` or `"punch-in"` for most clips. Avoid flashy wipes. No branded intro, no outro card, no fade at the end (it breaks the loop).

## 5. Example plan

A ~34 s podcast clip: cold-open on the payoff, rewind into the story, a stacked split for the exchange, then the full payoff and the laugh.

```json
{
  "title": "He charged $9 and lost the deal",
  "segments": [
    { "start": 2412.4, "end": 2415.0 },
    { "start": 2388.0, "end": 2405.5 },
    { "start": 2405.5, "end": 2412.4, "frame": { "mode": "split", "x": 0.25, "x2": 0.75, "zoom": 1.6 } },
    { "start": 2412.4, "end": 2419.0 }
  ],
  "captionPreset": "bold-pop",
  "transitionPreset": "none",
  "emphasis": ["$9", "lost"],
  "zoomIntensity": 0.1,
  "zoomAt": [2413.2],
  "reasoning": "Moment type: specific number + reversal. Cold open on the payoff line, rewind to the setup at 39:48, split on the back-and-forth so both reactions show, then the full payoff and one beat of the laugh. Payoff is 7 s after the setup ends. No music: the conversation carries it."
}
```

## 6. Retention and loops

**Benchmarks** (definitions vary by source):
- Viewed vs swiped (Shorts): under 60 % rarely performs; aim for 70–90 %.
- Average completion: Shorts ~73 %, TikTok ~78 %, Reels ~65 %.
- Average view duration drives Shorts views; likes and comments barely predict them.
- 50–60 % of drop-off happens in the first 3 s (vendor). That part is `oneclip-hooks`' job.

**Loops:** write or pick the last line so it flows grammatically into the first one, end on a hard cut (no fade), and keep the audio continuous across the loop point. Loops work best on short clips (performing looped Shorts rarely run past 7–8 s), and they don't guarantee double the watch time.

**What kills retention:** "hey guys" openings, slow build-up, dead air and padding, running long, needing context, a payoff more than 20 s after the setup, a hook or cover that promises something the clip doesn't deliver, captions or faces under the platform UI, and reposting another platform's export (native sports Shorts got ~18× the views of reformatted ones).

## 7. Originality and rights

Platforms down-rank or demonetise copies. Check this before rendering anything that isn't the user's own footage.

- **The Instagram test:** if your contribution could be removed and the content stays essentially the same, it needs more work. Borders, watermarks, speed changes, credit, a new caption, or text that only describes the video do **not** make it original. Commentary, narration, a storyline, recontextualising graphics or your own joke **do**.
- **YouTube:** clips with little narrative, compilations, content others uploaded many times, non-verbal reactions, reading others' text, and pitch/speed changes alone are "inauthentic content". Allowed: critical reviews, rewritten dialogue with voiceover, sports replays that explain the play, reactions with real commentary. The policy applies channel-wide, and having permission doesn't exempt you.
- **TikTok:** unoriginal content with no creative change is kept off the For You feed.
- **Fair use is a defence, not a right.** There is no safe number of seconds; credit is not permission; disclaimers do nothing. Fiction weighs against fair use, news footage is safer. Songs have two copyrights (composition and recording).
- Podcast guests: the user needs a release that covers short-form clips. Sponsored clips need an FTC disclosure.

When the source isn't the user's, say so in the `reasoning` and tell the user what transformation the clip needs (commentary, narration, a storyline). Never claim a clip is "safe".

## 8. Package and post

Help the user with these when they ask; OneClip renders, it doesn't post.

- **Cadence:** more posts raise the views per post (Buffer, 11.4M posts: +17 % at 2–5 a week, +34 % at 11+), but the median post stays ~500 views; the gain is in the tail. For a podcast: 2–3 clips in the 48 h after the episode, the rest over the week, the strongest held for mid-week. Shorts keep growing for weeks: judge each one at 7 days.
- **Text:** a short on-screen title line in the top safe zone (see `oneclip-hooks` for the hook text). YouTube Shorts titles and descriptions are searchable; `#Shorts` is unnecessary. TikTok: 8–12 hashtags, mostly niche plus 2–4 broad (vendor, correlation only).
- **Testing:** Instagram Trial Reels show a Reel to non-followers first (insights after 24 h). Judge on watch time and sends per reach. Or test three openings of the same clip on different days (render them with `oneclip-hooks` variants).
- **Clipping programs** (Content Rewards, Whop): the campaign's "Content requirements" box is the only rule that counts. Clips get rejected for being submitted more than 30 min after posting, for the wrong hook/tag/length, for a missing FTC disclosure, for reused edits or missing analytics. Fake views mean a permanent ban. Pay is about $1 per 1,000 views, usually capped per clip; X's program allows at most 30 % of the source video in one clip.

## 9. Named frameworks, in one line each

- **MrBeast production guide:** meet the promise of the thumbnail and hook immediately; CTR, average view duration and average percentage viewed are the metrics.
- **Paddy Galloway (5,400 Shorts):** viewed vs swiped above 70 % is the bar; hold viewers rather than run longer; engagement doesn't predict views.
- **OpusClip Virality Score** (vendor): Hook, Flow, Value, Trend; 80+ boost, 50–79 test, under 50 archive. A prediction, not a promise.
- **AutoClip podcast strategy:** elimination, four moment types, the 20 s payoff rule, ~40 s clips, 2–3 posts in the first 48 h.
- **Cut.pro "gold moment":** sound, picture and chat signals; cut by meaning, not by silence.
- **Hormozi / Submagic captions:** bold uppercase (Anton), 1–3 words, keyword highlight, pop-in. His editing SOP is not public.
- **Little Dot Studios sports Shorts:** native to the platform, 51–60 s, minimal editing, no in-app text or music.

## 10. Checklist before you render

1. The moment survived elimination: stands alone, payoff within 20 s of the setup, one of the moment types.
2. In on the first word of the answer or story; out one beat after the payoff; the strongest frame first; nothing reordered into a new meaning.
3. Length fits the kind (default 20–45 s); every second past 45 earns its place.
4. Hook checked with `oneclip-hooks` (first 1–3 s and the on-screen text).
5. Framing: face-tracking crop for one speaker, split for two who matter, fit/blur for demos. Faces in the upper ⅔, nothing important in the covered edges.
6. Silences trimmed (`removeSilences`), dramatic pauses kept; J/L cuts for reactions and B-roll.
7. `bold-pop` (or `karaoke`) captions, 1–3 words, `emphasis` on the words that carry the clip.
8. Audio: no music unless it helps; any `bed` ducked (`duck` 0.25–0.5). Loudness left to OneClip (−14 LUFS).
9. Hard end or a loop; no fade-out, intro card or outro.
10. Originality: if the footage isn't the user's, the clip adds commentary, narration or a storyline, and the user knows the rights question.
11. Rendered in every shape the user posts to; previewed, then the final render.

### What's wrong with this render? (check every preview, ~2 minutes)

Make two contact sheets and look at them, don't trust the plan:

```sh
# One frame every 2 s of the render, 6 per row
ffmpeg -v error -i clip.mp4 -vf "fps=1/2,scale=216:-2,tile=6x4" -frames:v 1 sheet.png
# Real shot changes of the source range (cuts between similar podcast angles score 0.2–0.3)
ffmpeg -hide_banner -ss START -t LEN -i source.mp4 -an -vf "scale=160:-2,select='gt(scene,0.1)',metadata=print" -f null - 2>&1 | grep scene_score
```

Reject and fix when any of these is true:

| Fault | What it looks like | Fix |
|---|---|---|
| Same person twice | Both halves of a split show one face | Split the cut at the shot change; `frame: { mode: "crop", x }` on the close-up |
| Face cut off | A face touches the left/right edge of a crop or half | Move `x`, or lower `zoom` on the split |
| Reframe mid-shot | The picture jumps while the camera didn't cut | Make the cut boundary match the shot change exactly |
| Tiny faces / logo wins | Wide shot split or fitted, faces under ~10 % of the height | Crop on the speaker, or skip the wide shot |
| Ends on a new topic | The last seconds hold a new question or "so, next…" | End one beat after the payoff line |
| Cold open without context | The first line refers to something the viewer never saw | Start earlier, or add on-screen context |
| Dead air / black / freeze | Same frame for >1 s, black frames | Trim it |

## 11. Rules

- Don't invent numbers: when you quote a benchmark, quote it as a range from `references/research.md` and say if it's vendor data.
- The user's goal wins over a rule here (a 3-minute story, an all-caps style, a music bed). Say what the research suggests once, then do what they asked.
- Never promise views, virality or that a clip is safe to post.

## Sources

The full report, with the 46 sources (platform help pages, Paddy Galloway, Buffer, Little Dot Studios, OpusClip, AutoClip, Cut.pro, Submagic, the MrBeast guide and others) and every disagreement between them: [`references/research.md`](references/research.md). Researched 2026-11-27.
