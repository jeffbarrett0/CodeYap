#!/usr/bin/env python3
"""YouTube videosunun transkriptini çeker (youtube-transcript-api >= 1.0)."""
import argparse
import re
import sys

from youtube_transcript_api import YouTubeTranscriptApi

ID_RE = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})")


def video_id_al(url_or_id: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url_or_id):
        return url_or_id
    m = ID_RE.search(url_or_id)
    if not m:
        raise ValueError("Geçerli bir YouTube URL'si veya video ID'si girin.")
    return m.group(1)


def zaman(sn: float) -> str:
    sn = int(sn)
    return f"{sn // 3600:02d}:{sn % 3600 // 60:02d}:{sn % 60:02d}"


def main() -> int:
    p = argparse.ArgumentParser(description="YouTube transkripti çek")
    p.add_argument("url", help="Video URL'si veya ID'si")
    p.add_argument("-l", "--diller", nargs="+", default=["tr", "en"],
                   help="Öncelik sırasıyla dil kodları (varsayılan: tr en)")
    p.add_argument("--zamansiz", action="store_true", help="Zaman damgalarını gizle")
    p.add_argument("-o", "--cikti", help="Sonucu bu dosyaya kaydet")
    a = p.parse_args()

    try:
        vid = video_id_al(a.url)
        transcript = YouTubeTranscriptApi().fetch(vid, languages=a.diller)
    except Exception as e:
        print(f"Transkript alınamadı: {e}", file=sys.stderr)
        return 1

    satirlar = [s.text if a.zamansiz else f"[{zaman(s.start)}] {s.text}" for s in transcript]
    metin = "\n".join(satirlar)
    if a.cikti:
        with open(a.cikti, "w", encoding="utf-8") as f:
            f.write(metin + "\n")
        print(f"{len(satirlar)} satır {a.cikti} dosyasına yazıldı.")
    else:
        print(metin)
    return 0


if __name__ == "__main__":
    sys.exit(main())
