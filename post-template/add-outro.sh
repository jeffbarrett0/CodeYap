#!/usr/bin/env bash
# Kullanim: ./add-outro.sh [ana-video] [cikti]
# Ana videonun sonuna outro.mp4 ekler (1080x1920, 30fps, 48kHz stereo)
# ve gecis sesini (transition.mp4) kesim anina hizalar.
set -euo pipefail
cd "$(dirname "$0")"
IN="${1:-post.mp4}"
OUT="${2:-post-final.mp4}"
PEAK=0.55           # transition.mp4 icinde sesin vurgu yaptigi an (sn): bu an kesime denk gelir
OFFSET_DB=0         # gecis sesi, videonun ses seviyesine gore kac dB fark etsin (0 = ayni seviye)

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
lufs() { ffmpeg -hide_banner -nostats -i "$1" -vn -af ebur128=framelog=quiet -f null - 2>&1 | awk '/^ *I:/{v=$2} END{print v}'; }
L_MAIN=$(lufs "$IN"); L_T=$(lufs transition.mp4)
read -r GAIN MS < <(python3 - "$L_MAIN" "$L_T" "$OFFSET_DB" "$DUR" "$PEAK" <<'PY'
import sys
m,t,o,d,p=map(float,sys.argv[1:])
g=0.0 if m<-60 or t<-60 else max(-30.0,min(30.0,m-t+o))
print(f"{g:.2f}", int(max(0,(d-p))*1000))
PY
)
echo "Video: ${L_MAIN} LUFS | Gecis sesi: ${L_T} LUFS | Gecis kazanci: ${GAIN} dB | Baslangic: ${MS} ms" >&2

ffmpeg -y -v error -i "$IN" -i outro.mp4 -i transition.mp4 -filter_complex \
"[0:v]scale=1080:1920,fps=30,setsar=1,format=yuv420p[v0];\
[1:v]scale=1080:1920,fps=30,setsar=1,format=yuv420p[v1];\
[0:a]aresample=48000,aformat=channel_layouts=stereo[a0];\
[1:a]aresample=48000,aformat=channel_layouts=stereo[a1];\
[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][ac];\
[2:a]aresample=48000,aformat=channel_layouts=stereo,volume=${GAIN}dB,adelay=${MS}|${MS}[t];\
[ac][t]amix=inputs=2:normalize=0:duration=first:dropout_transition=0,alimiter=limit=0.89[a]" \
-map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 160k -movflags +faststart "$OUT"
