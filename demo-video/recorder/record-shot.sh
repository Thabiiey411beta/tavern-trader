#!/bin/bash
# Record one shot: starts ffmpeg x11grab on :99, drives Chrome via record.js,
# stops ffmpeg. Usage: ./record-shot.sh <shot-id> <plan.json>
set -e
cd "$(dirname "$0")"
SHOT="$1"
PLAN="$2"
mkdir -p clips
# Display and capture size come from the environment so the same script
# records landscape (DISPLAY=:99, 1920x1080) or vertical Shorts
# (DISPLAY=:98, 1080x1920). Defaults to the landscape display.
export DISPLAY="${DISPLAY:-:99}"
CAP_SIZE="${CAP_SIZE:-1920x1080}"
ffmpeg -y -loglevel error -f x11grab -video_size "$CAP_SIZE" -framerate 30 \
  -i "$DISPLAY" -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf 20 \
  "clips/${SHOT}.mp4" &
FFPID=$!
sleep 2
node record.js "$PLAN" || true
sleep 1
kill -INT $FFPID || true
wait $FFPID || true
ffprobe -v error -show_entries format=duration,size -of csv=p=0 "clips/${SHOT}.mp4"
