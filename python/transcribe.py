"""OneClip transcription worker: faster-whisper, word timestamps, JSON on stdout.

Usage: python transcribe.py --input audio.wav --model small [--device auto|cpu|cuda] [--language en]
Progress lines go to stderr as "PROGRESS <0..1>". Everything runs locally.
"""

import argparse
import json
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--model", default="small")
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--language", default=None)
    ap.add_argument("--check", action="store_true", help="only check that faster-whisper imports")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as e:  # noqa: BLE001 - report any import failure to the caller
        print(json.dumps({"error": f"faster-whisper unavailable: {e}"}))
        return 3
    if args.check:
        import faster_whisper

        print(json.dumps({"ok": True, "version": faster_whisper.__version__}))
        return 0

    try:
        model = WhisperModel(args.model, device=args.device, compute_type="default")
    except Exception:  # CUDA libraries missing or out of memory: fall back to CPU
        model = WhisperModel(args.model, device="cpu", compute_type="int8")

    segments, info = model.transcribe(args.input, word_timestamps=True, vad_filter=True, language=args.language)
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3), "probability": round(w.probability, 3)})
        if info.duration:
            print(f"PROGRESS {min(1.0, seg.end / info.duration):.3f}", file=sys.stderr, flush=True)

    json.dump(
        {"engine": "faster-whisper", "model": args.model, "language": info.language, "duration": info.duration, "words": words},
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
