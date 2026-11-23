/**
 * Builds a redistributable sample video for tests and demos: an original
 * script (written for OneClip, MIT like the rest of the repo) read by the
 * OS's built-in text-to-speech, over FFmpeg test-pattern visuals.
 *
 *   pnpm sample            -> .oneclip/samples/oneclip-sample.mp4
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { config, runProcess } from "@oneclip/core";

export const SAMPLE_SCRIPT = [
  "Welcome back to the show. Today we are talking about habits, sleep and a little bit about money.",
  "Most people think productivity is about doing more. That is completely wrong. The most productive people I know do less, on purpose, every single day.",
  "Here is what happened when I tested it. For thirty days I cut my task list to three items. Just three. My output went up by forty percent, and I slept better than I had in years.",
  "Anyway, let me check the time. Okay. We have a few minutes. So, um, where was I. Right.",
  "So the weather here has been fine. Not much to say about that. It rained on Tuesday and then it stopped.",
  "Now, the mistake that costs most beginners thousands of dollars is simple. They buy tools before they have a problem. Write down the problem first. Then spend money only when the problem costs you more than the tool.",
  "And that is why the other thing matters, which we will get to later, because of what I said before.",
  "Let me tell you a story. Ten years ago I was broke, sleeping on a friend's couch, and I had one idea. I wrote it on a napkin. That napkin became a company with fifty employees. The idea was not special. What was special was that I started that night.",
  "Here is a quick tip you can use today. Put your phone in another room for the first hour after you wake up. That single change gave me back an hour of focus every morning.",
  "Okay, that is all for today. Thanks for listening, and see you next week.",
].join(" ");

async function tts(text: string, wav: string) {
  if (process.platform === "win32") {
    const txt = `${wav}.txt`;
    writeFileSync(txt, text, "utf8");
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 0; $s.SetOutputToWaveFile($env:ONECLIP_WAV); $s.Speak([IO.File]::ReadAllText($env:ONECLIP_TXT)); $s.Dispose()`;
    const r = await runProcess("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      timeoutMs: 300_000,
      env: { ...process.env, ONECLIP_WAV: wav, ONECLIP_TXT: txt },
    });
    if (r.code !== 0) throw new Error(`Windows speech failed: ${r.stderr}`);
  } else if (process.platform === "darwin") {
    const aiff = wav.replace(/\.wav$/, ".aiff");
    const r = await runProcess("say", ["-o", aiff, text], { timeoutMs: 300_000 });
    if (r.code !== 0) throw new Error(`say failed: ${r.stderr}`);
    await runProcess(config().ffmpeg, ["-y", "-v", "error", "-i", aiff, wav], { timeoutMs: 60_000 });
  } else {
    const r = await runProcess("espeak-ng", ["-w", wav, text], { timeoutMs: 300_000 });
    if (r.code !== 0) throw new Error("Install espeak-ng (apt install espeak-ng) to build the sample.");
  }
}

export async function makeSample(): Promise<string> {
  const cfg = config();
  const dir = join(cfg.dataDir, "samples");
  mkdirSync(dir, { recursive: true });
  const wav = join(dir, "voice.wav");
  const out = join(dir, "oneclip-sample.mp4");
  await tts(SAMPLE_SCRIPT, wav);
  const r = await runProcess(
    cfg.ffmpeg,
    [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30",
      "-i", wav,
      "-filter_complex", "[0:v]hue=H=t/8,format=yuv420p[v]",
      "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-shortest", "-movflags", "+faststart", out,
    ],
    { timeoutMs: 600_000 },
  );
  if (r.code !== 0) throw new Error(`FFmpeg failed: ${r.stderr}`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  makeSample().then(
    (p) => console.log(`Sample video: ${p}`),
    (e) => {
      console.error((e as Error).message);
      process.exit(1);
    },
  );
}
