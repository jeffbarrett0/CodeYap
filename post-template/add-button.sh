#!/usr/bin/env bash
# Kullanim: ./add-button.sh [ana-video] [cikti]
# YouTube butonunu 3. saniyede ve sonra her 30 saniyede bir ekler (5 sn'lik animasyon sigarsa).
# Butonun sesi, videonun kendi ses seviyesine (LUFS) gore otomatik ayarlanir.
set -euo pipefail
cd "$(dirname "$0")"
IN="${1:-post.mp4}"
OUT="${2:-post-btn.mp4}"
BTN=youtube-button.mov
START=3; EVERY=30; BTN_DUR=5
X=130; Y=1211          # videonun alt kenarina hizali (butonun animasyonu video kenarinin ardindan cikar)

[ -f "$BTN" ] || ./prep-button.sh

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")

# Ortalama (entegre) ses seviyesi, LUFS
lufs() { ffmpeg -hide_banner -nostats -i "$1" -vn -af ebur128=framelog=quiet -f null - 2>&1 | awk '/^ *I:/{v=$2} END{print v}'; }
L_MAIN=$(lufs "$IN"); L_BTN=$(lufs "$BTN")
# Butonun sesini videonunkiyle ayni seviyeye getir (ses cok kisik/yok ise dokunma)
GAIN=$(python3 - "$L_MAIN" "$L_BTN" <<'PY'
import sys
m,b=float(sys.argv[1]),float(sys.argv[2])
g=0.0 if m<-60 or b<-60 else max(-24.0,min(30.0,m-b))
print(f"{g:.2f}")
PY
)
echo "Video: ${L_MAIN} LUFS | Buton: ${L_BTN} LUFS | Buton kazanci: ${GAIN} dB" >&2

# Buton zamanlari
TIMES=()
python3 - "$DUR" "$START" "$EVERY" "$BTN_DUR" > /tmp/btn_times.$$ <<'PY'
import sys
d,s,e,b=map(float,sys.argv[1:])
t=s
while t+b<=d+0.01:
    print(int(t)); t+=e
PY
while read -r t; do TIMES+=("$t"); done < /tmp/btn_times.$$; rm -f /tmp/btn_times.$$
N=${#TIMES[@]}
if [ "$N" -eq 0 ]; then cp "$IN" "$OUT"; echo "Video cok kisa, buton eklenmedi" >&2; exit 0; fi

INPUTS=(-i "$IN"); FC=""; V="[0:v]"; AMIX="[0:a]"
for i in $(seq 0 $((N-1))); do
  t=${TIMES[$i]}; n=$((i+1)); ms=$((t*1000))
  INPUTS+=(-i "$BTN")
  FC+="[$n:v]setpts=PTS-STARTPTS+${t}/TB[b$n];"
  FC+="${V}[b$n]overlay=${X}:${Y}:eof_action=pass:repeatlast=0[v$n];"
  FC+="[$n:a]volume=${GAIN}dB,adelay=${ms}|${ms}[a$n];"
  V="[v$n]"; AMIX+="[a$n]"
done
FC+="${AMIX}amix=inputs=$((N+1)):normalize=0:duration=first:dropout_transition=0,alimiter=limit=0.89[aout]"
ffmpeg -y -v error "${INPUTS[@]}" -filter_complex "$FC" -map "${V}" -map "[aout]" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$OUT"
echo "Buton ${N} kez eklendi (saniye: ${TIMES[*]})" >&2
