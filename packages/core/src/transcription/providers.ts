import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config, findRoot } from "../config.ts";
import { runProcess } from "../proc.ts";
import { z } from "zod";
import { TranscriptSchema, WordSchema, type ModelSize, type TranscribeOptions, type Transcript, type TranscriptionProvider } from "./types.ts";

/** faster-whisper via python/transcribe.py. The default engine. */
export class FasterWhisperProvider implements TranscriptionProvider {
  readonly name = "faster-whisper";
  private readonly script = join(findRoot(), "python", "transcribe.py");
  constructor(private readonly python: string) {}

  async available() {
    try {
      const r = await runProcess(this.python, [this.script, "--input", "-", "--check"], { timeoutMs: 60_000 });
      const j = JSON.parse(r.stdout.trim() || "{}") as { ok?: boolean; version?: string; error?: string };
      return j.ok ? { ok: true, detail: `faster-whisper ${j.version}` } : { ok: false, detail: j.error ?? r.stderr.slice(-300) };
    } catch (e) {
      return { ok: false, detail: `Python not runnable (${this.python}): ${(e as Error).message}` };
    }
  }

  async transcribe(wavPath: string, opts: TranscribeOptions): Promise<Transcript> {
    const args = [this.script, "--input", wavPath, "--model", opts.model, "--device", opts.device ?? "auto"];
    if (opts.language) args.push("--language", opts.language);
    if (opts.task === "translate") args.push("--task", "translate");
    const lines = lineReader((line) => {
      if (line.startsWith("PROGRESS ")) opts.onProgress?.(Number(line.slice(9)));
      else if (line.startsWith("WORDS ") && opts.onWords) {
        const w = z.array(WordSchema).safeParse(safeJson(line.slice(6)));
        if (w.success && w.data.length) opts.onWords(w.data);
      }
    });
    const r = await runProcess(this.python, args, { timeoutMs: 4 * 60 * 60_000, onStderr: lines });
    if (r.code !== 0) {
      const err = safeJson(r.stdout)?.error;
      throw new Error(`faster-whisper failed: ${err ?? r.stderr.slice(-800)}`);
    }
    return TranscriptSchema.parse(JSON.parse(r.stdout));
  }
}

/** Calls `onLine` for each complete line across chunk boundaries. */
export function lineReader(onLine: (line: string) => void): (chunk: string) => void {
  let rest = "";
  return (chunk) => {
    const parts = (rest + chunk).split(/\r?\n/);
    rest = parts.pop() ?? "";
    for (const p of parts) onLine(p.trim());
  };
}

function safeJson(s: string): { error?: string } | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

const ONNX_MODELS: Record<ModelSize, string> = {
  tiny: "onnx-community/whisper-tiny_timestamped",
  base: "onnx-community/whisper-base_timestamped",
  small: "onnx-community/whisper-small_timestamped",
  medium: "onnx-community/whisper-small_timestamped",
  "large-v3": "onnx-community/whisper-small_timestamped",
};

/**
 * Whisper on ONNX Runtime inside Node (transformers.js). No Python needed.
 * Used when faster-whisper isn't installed or can't load (for example when
 * Windows Smart App Control blocks its native library). CPU only.
 */
export class OnnxWhisperProvider implements TranscriptionProvider {
  readonly name = "whisper-onnx";

  async available() {
    try {
      await import("@huggingface/transformers");
      return { ok: true, detail: "transformers.js (ONNX Runtime, CPU)" };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  private async load(model: ModelSize) {
    const { pipeline, env } = await import("@huggingface/transformers");
    // Keep models with the user's data, not inside node_modules (a reinstall would wipe them).
    env.cacheDir = join(config().dataDir, "models");
    return pipeline("automatic-speech-recognition", ONNX_MODELS[model], { dtype: "q8" });
  }

  /** Downloads the model ahead of the first job. */
  async prepare(model: ModelSize) {
    await this.load(model);
  }

  async transcribe(wavPath: string, opts: TranscribeOptions): Promise<Transcript> {
    const repo = ONNX_MODELS[opts.model];
    const audio = readWav16kMono(wavPath);
    const asr = await this.load(opts.model);
    // Transcribe in 30 s windows ourselves so we can report progress.
    const win = 30 * 16_000;
    const words: Transcript["words"] = [];
    for (let off = 0; off < audio.length; off += win) {
      const slice = audio.subarray(off, Math.min(audio.length, off + win));
      const base = off / 16_000;
      const out = (await asr(slice, { return_timestamps: "word", language: opts.language ?? "en", task: opts.task ?? "transcribe" })) as {
        chunks?: { text: string; timestamp: [number, number | null] }[];
      };
      const before = words.length;
      for (const c of out.chunks ?? []) {
        const word = c.text.trim();
        if (!word) continue;
        words.push({ word, start: base + c.timestamp[0], end: base + (c.timestamp[1] ?? c.timestamp[0] + 0.3) });
      }
      if (words.length > before) opts.onWords?.(words.slice(before));
      opts.onProgress?.(Math.min(1, (off + win) / audio.length));
    }
    return { engine: this.name, model: repo.split("/")[1] ?? repo, language: opts.language ?? "en", duration: audio.length / 16_000, words };
  }
}

/** Reads a 16-bit PCM mono WAV (what OneClip's FFmpeg step writes) into float samples. */
export function readWav16kMono(path: string): Float32Array {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === "data") {
      const n = Math.floor(Math.min(size, buf.length - p - 8) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(p + 8 + i * 2) / 32768;
      return out;
    }
    p += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

export type TranscriberChoice = "auto" | "faster-whisper" | "whisper-onnx";

/** auto: faster-whisper when it loads, else the ONNX fallback. */
export async function pickTranscriber(choice: TranscriberChoice, python: string): Promise<TranscriptionProvider> {
  if (choice === "whisper-onnx") return new OnnxWhisperProvider();
  const fw = new FasterWhisperProvider(python);
  if (choice === "faster-whisper") return fw;
  return (await fw.available()).ok ? fw : new OnnxWhisperProvider();
}
