# Timelapse

Capture a full-resolution timelapse of one, several or all cameras for up to
24 hours, then turn it into a smooth H.264 video. Windows and Raspberry Pi use
the same capture and render code (`lib/timelapse.js`) and the same controls.

## Using it

Click **Timelapse** in the toolbar. The menu shows:

- anything capturing, scheduled or rendering, with **Stop** or **Cancel**;
- **Quick start**: every camera for one hour, made into a 30-second grid video;
- **New timelapse…**: opens the setup panel beside the cameras;
- **Recent**: the last three finished timelapses, with **Play** and
  **Download** (**Show** on Windows);
- **All timelapses…**: the full list, with re-render and delete.

While a capture runs, the toolbar button shows the elapsed time and each
captured camera's tile shows a **TIMELAPSE** badge. If a camera is enlarged when
you open the setup panel, that camera is preselected.

### Setting up a timelapse

1. **Cameras**: choose any number. The grid video contains exactly those cameras.
2. **Video**: with more than one camera, choose a grid video, one video per
   camera, or both.
3. **Start**: now, or at a date and time up to seven days ahead.
4. **Stop**: after a set time (30 minutes to 24 hours), or when you stop it.
   A manual timelapse still ends after 24 hours.
5. **Finished video length**: the app works out the capture interval. For
   example, 24 hours made into a 1-minute video at 30 fps captures a frame every
   48 seconds. For a manual stop you choose the interval instead.

The summary under the form shows the interval, frame count, video length and
estimated disk space. Estimates assume about 900 KB per daylight frame per
camera.

### Look and quality

| Option | Default | Effect |
|---|---|---|
| Frame rate | 30 fps | 24, 30 or 60 fps output |
| Deflicker | On | Evens out auto-exposure pumping and passing clouds |
| Motion smoothing | On | Blends each frame with its neighbours (1-2-1) for smoother motion |
| Camera names | On | Labels each grid tile |
| Date and time | Off | Adds the real capture time, top right, clear of the cameras' own timestamps |
| Skip night-vision frames | Off | Drops monochrome infrared frames (very low colour saturation) |
| Delete frames after the video is made | On | Frees disk space; the timelapse can no longer be re-rendered |

## Grid layouts

Every tile is 16:9, and no layout leaves an empty tile.

| Cameras | Layout | Video size |
|---|---|---|
| 1 | Single camera | 2560×1440 (native) |
| 2 | Side by side | 3840×1080 |
| 3 | One large tile and two small ones stacked | 3840×1440; the large tile is native 2560×1440 |
| 4 | 2×2 | 3840×2160 |
| 5–6 | 3×2 | 3840×1440 |

Per-camera videos are always native 2560×1440.

## Where files go

| | Windows app | Raspberry Pi |
|---|---|---|
| Finished videos | `Downloads\Wyze Monitor\Timelapses` | `timelapses` Docker volume; **Download** saves to the viewing device's Downloads folder |
| Working frames | `%LOCALAPPDATA%\Wyze Monitor\Timelapse frames` | `timelapses` Docker volume |
| Ready notice | Windows notification (click to show the file) and an in-app banner | In-page banner |

On Windows, **Remove** takes a timelapse off the list but never deletes videos
from Downloads. On the Pi, **Delete** removes its frames and videos from the Pi.

## How it works

**Capture.** One FFmpeg process per camera reads the camera's main stream from
go2rtc's RTSP restream and decodes keyframes only (`-skip_frame nokey`). The
cameras send a keyframe roughly every two seconds, so each camera costs one
intra-frame decode per keyframe instead of 20 full decodes a second. A select
filter keeps one keyframe per interval and writes it as a JPEG at quality 2,
which is visually lossless. Frames are filed by wall-clock slot, so frame N from
every camera shows the same moment, to within one keyframe interval.

A camera that stops sending frames is restarted with back-off. Capture stops if
free disk space falls below 2 GB. If the app or container restarts, capture
resumes when the timelapse's time window has not ended; the gap becomes a cut
in the video.

**Render.** Frames enter FFmpeg through the concat demuxer with their real
capture spacing as durations, so the optional clock shows true capture time
even across gaps. The filter graph applies deflicker, scaling and labels per
camera, `xstack` for the grid, then `tmix` smoothing and the clock. Output is
H.264 High, CRF 18, `yuv420p`, `+faststart`. The bitrate is capped at 80 Mbit/s
for grid videos and 50 Mbit/s for single cameras, so noisy scenes such as
foliage or night grain stay a reasonable size. A one-minute 4K grid is about
600 MB.

Only one render runs at a time. On the Pi, rendering uses the `medium` preset,
leaves one CPU core free and runs at the lowest scheduling priority. A Pi 5 has
no hardware H.264 encoder, so a long 4K render can take a while.

## Platform behaviour

**Windows.** Capture runs in the Electron main process, so it only runs while
Wyze Monitor is open. While a timelapse is capturing or scheduled, the app keeps
Windows from suspending, and closing the window asks for confirmation.

**Raspberry Pi.** Capture runs in the `monitor-web` container. It continues
with no browser open and resumes after a container or Pi restart.

## Limits

- 24 hours maximum per timelapse; interval 2–600 seconds.
- Even-second intervals line up best with the cameras' keyframes.
- Grid tiles are synchronised to within one keyframe interval, about two seconds.
- The Wyze Cam v4's switch to infrared at dusk cannot be removed from frames;
  use **Skip night-vision frames** to drop those frames.

## Updating an existing Pi

The timelapse feature needs go2rtc's RTSP restream on the private Compose
network, plus a `timelapses` volume. On an existing deployment:

1. Back up the project source and `raspberry-pi/runtime/go2rtc.yaml`.
2. Add `"8554"` to go2rtc's `expose` list, and to `monitor-web` add
   `TIMELAPSE_DIR: /timelapses`, the volume `timelapses:/timelapses`, and
   `timelapses:` under the top-level `volumes:`.
3. Build `monitor-web`, run `config-init` to regenerate the go2rtc config,
   restart `go2rtc`, and recreate `monitor-web` with `--no-deps`.

Restarting go2rtc interrupts live view for a few seconds. Port 8554 is not
published to the LAN. Other Compose projects are not affected.

Optional environment variables for `monitor-web`: `TIMELAPSE_PRESET` (x264
preset, default `medium`), `TIMELAPSE_THREADS` (default: CPU cores minus one),
`TIMELAPSE_FONT` (overlay font path) and `GO2RTC_RTSP_PORT` (default 8554).
