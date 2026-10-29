#!/usr/bin/env python3
"""ClipForge köprüsü: faster-whisper ile kelime düzeyinde transkripsiyon.

Kullanım: faster_whisper_cli.py <wav> <model: tiny|base|small|medium> <dil|auto>
Çıktı (stdout): {"words": [{"text": ..., "start": ..., "end": ..., "confidence": ...}]}
"""
import json
import sys


def main() -> int:
    if len(sys.argv) < 4:
        print("kullanım: faster_whisper_cli.py <wav> <model> <dil>", file=sys.stderr)
        return 2
    wav, model_name, lang = sys.argv[1:4]
    from faster_whisper import WhisperModel  # noqa: WPS433 (isteğe bağlı bağımlılık)

    model = WhisperModel(model_name, device="auto", compute_type="auto")
    segments, _ = model.transcribe(
        wav,
        language=None if lang == "auto" else lang,
        word_timestamps=True,
        vad_filter=True,
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"text": w.word.strip(), "start": w.start, "end": w.end, "confidence": w.probability})
    json.dump({"words": words}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
