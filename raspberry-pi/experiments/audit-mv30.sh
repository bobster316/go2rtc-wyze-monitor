#!/usr/bin/env bash
set -euo pipefail

# Read-only preflight for the MVLS-30 compositor. It does not change go2rtc,
# camera settings, recordings, or any other Compose project.
stream="${1:-office_main}"
seconds="${2:-4}"
container="${WYZE_GO2RTC_CONTAINER:-wyze-monitor-rpi-go2rtc-1}"

case "$stream" in
  *_main|*_sub) ;;
  *) echo "Stream must end in _main or _sub." >&2; exit 2 ;;
esac

case "$seconds" in
  ''|*[!0-9]*) echo "Seconds must be a positive integer." >&2; exit 2 ;;
esac

echo "Auditing ${stream} for ${seconds}s in ${container}"
echo "Expected for MVLS-30: I/P frames, no B frames, Motion vectors on P frames."

docker exec "$container" ffprobe \
  -v error \
  -flags2 +export_mvs \
  -rtsp_transport tcp \
  -read_intervals "%+${seconds}" \
  -select_streams v:0 \
  -show_frames \
  -show_entries frame=pts_time,pict_type,key_frame:frame_side_data=side_data_type \
  -of compact \
  "rtsp://127.0.0.1:8554/${stream}"
