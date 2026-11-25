#!/usr/bin/env bash
# Kullanim: ./make-post.sh   -> sablon render + klibi yuvarlak kose maskeyle yerlestir -> post.mp4
set -euo pipefail
cd "$(dirname "$0")"
node render.js
read -r VX VY VW VH < <(python3 -c "import json;v=json.load(open('layout.json'))['video'];print(v['x'],v['y'],v['w'],v['h'])")
ffmpeg -y -v error -loop 1 -i .build/base.png -i clip.mp4 -loop 1 -i .build/mask.png -filter_complex \
"[2:v]scale=${VW}:${VH},format=gray[m];\
[1:v]scale=${VW}:${VH}:force_original_aspect_ratio=increase,crop=${VW}:${VH},fps=30,format=yuva420p[vv];\
[vv][m]alphamerge[va];[0:v][va]overlay=${VX}:${VY}:shortest=1,format=yuv420p[o]" \
  -map "[o]" -map 1:a -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 160k -shortest -movflags +faststart post.mp4
