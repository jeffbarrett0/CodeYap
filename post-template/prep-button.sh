#!/usr/bin/env bash
# YouTube butonunu (yesil perde) sadece bir kere hazirlar: yesili siler, kirpar, 820px'e kucultur.
# Cikti: youtube-button.mov (sefaf + ses). Buton ses/gorsel degisirse tekrar calistir.
set -euo pipefail
cd "$(dirname "$0")"
# 4K kaynaktan x 700..3140, y 960..1680 bolgesi (butonun animasyon alani) 640x188 olarak kucultulur.
ffmpeg -y -v error -i youtube-button.mp4 \
  -vf "crop=2440:720:700:960,chromakey=0x00FF00:0.14:0.10,despill=type=green,fps=30,scale=640:188:flags=lanczos,format=argb" \
  -c:v qtrle -c:a pcm_s16le -ar 48000 -ac 2 youtube-button.mov
