#!/bin/bash
# Builds the distribution files from the rendered master + the soundtrack mix:
#   dist-student-guide.mp4            master, crf23/slow, narration+music+SFX (aac 96k)
#   dist-student-guide-<clip>.mp4     the 4 short clips, cut from the master, same mix
#   poster-*.jpg                      poster frames pulled from the final encodes
# Run after `node render.mjs full` and `python3 make_music.py`.
set -euo pipefail
cd "$(dirname "$0")/out"
FF=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
MASTER=lasuatos-student-guide.mp4
MIX=mix-full.wav

# segment starts (seconds) — keep in sync with scenes.js / make_music.py
# clip-a = segs 1..4 (02..05), b = seg 5 (06), c = segs 6..7 (07..08), d = segs 8..9 (09..10)
A0=20.32; A1=78.48
B0=78.48; B1=98.48
C0=98.48; C1=131.44
D0=131.44; D1=169.44

echo "== master (crf23 slow, mixed audio) =="
$FF -y -i "$MASTER" -i "$MIX" -map 0:v -map 1:a \
  -c:v libx264 -pix_fmt yuv420p -crf 23 -preset slow \
  -c:a aac -b:a 96k -movflags +faststart -shortest \
  dist-student-guide.mp4

for spec in "open-account $A0 $A1" "face $B0 $B1" "mark $C0 $C1" "problems $D0 $D1"; do
  set -- $spec
  echo "== clip $1 ($2 -> $3) =="
  $FF -y -ss "$2" -to "$3" -i "$MASTER" -ss "$2" -to "$3" -i "$MIX" \
    -map 0:v -map 1:a \
    -c:v libx264 -pix_fmt yuv420p -crf 23 -preset medium \
    -c:a aac -b:a 96k -movflags +faststart -shortest \
    "dist-student-guide-$1.mp4"
done

echo "== posters (from the final encodes) =="
$FF -y -v error -ss 38.8 -i dist-student-guide.mp4 -frames:v 1 -q:v 3 poster-student-guide.jpg
$FF -y -v error -ss 18.5 -i dist-student-guide-open-account.mp4 -frames:v 1 -q:v 3 poster-open-account.jpg
$FF -y -v error -ss 13.5 -i dist-student-guide-face.mp4 -frames:v 1 -q:v 3 poster-face.jpg
$FF -y -v error -ss 22.0 -i dist-student-guide-mark.mp4 -frames:v 1 -q:v 3 poster-mark.jpg
$FF -y -v error -ss 9.0 -i dist-student-guide-problems.mp4 -frames:v 1 -q:v 3 poster-problems.jpg

ls -la dist-*.mp4 poster-*.jpg
echo "DIST DONE"
