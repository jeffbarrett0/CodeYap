#!/usr/bin/env bash
# Kullanim: ./add-outro.sh [ana-video] [cikti]
# Ana videonun sonuna outro.mp4 ekler (1080x1920, 30fps, 48kHz stereo).
set -euo pipefail
cd "$(dirname "$0")"
IN="${1:-post.mp4}"
OUT="${2:-post-final.mp4}"
ffmpeg -y -v error -i "$IN" -i outro.mp4 -filter_complex \
"[0:v]scale=1080:1920,fps=30,setsar=1,format=yuv420p[v0];\
[1:v]scale=1080:1920,fps=30,setsar=1,format=yuv420p[v1];\
[0:a]aresample=48000,aformat=channel_layouts=stereo[a0];\
[1:a]aresample=48000,aformat=channel_layouts=stereo[a1];\
[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
-map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 160k -movflags +faststart "$OUT"
