#!/usr/bin/env bash
# Kullanim: ./build.sh
# post.mp4 (sablon + klip) -> YouTube butonu (3. sn + her 30 sn) -> outro -> post-final.mp4
set -euo pipefail
cd "$(dirname "$0")"
./add-button.sh post.mp4 post-btn.mp4
./add-outro.sh post-btn.mp4 post-final.mp4
