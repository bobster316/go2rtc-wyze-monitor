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
   example, 24 hours made into a 1-minute video at 25 fps captures a frame every
   58 seconds. For a manual stop you choose the interval instead.

Intervals are always a whole number of the cameras' 2-second keyframes (2, 4,
6, 10, 16 s and so on). An odd interval such as 5 s is rounded to 6 s:
otherwise frames would arrive unevenly and the video would stutter.

### Choosing an interval

| Subject | Interval |
|---|---|
| People, street, traffic | 2 s |
| Sunset, golden hour | 4–6 s |
| Clouds | 6–10 s |
| A whole day (24 h into 1 minute) | about 58 s |
| Garden growth | 5–10 min (daylight only) |

Aim for 10–30 seconds of video per scene. If unsure, pick a shorter interval
than you think you need. The cameras' lenses are very wide, so things move
slowly across the frame and slightly longer intervals than usual work well.

The summary under the form shows the interval, frame count, video length and
estimated disk space. Estimates assume about 900 KB per daylight frame per
camera.

### Look and quality

The defaults are the recommended settings; **Use recommended settings** at the
bottom of the section restores them.

| Option | Default | Effect |
|---|---|---|
| Frame rate | 25 fps | 24 (film look), 25, 30 or 60 fps output. 60 makes the steps between frames more visible |
| Natural motion blur | On | Each saved frame averages the camera's keyframes over half the interval (the 180° shutter rule), up to 16 s. Clouds, water and leaves move smoothly, and noise and compression blocks fade. Set when the capture starts |
| Deflicker | On | Evens out auto-exposure pumping and passing clouds |
| Steady colour | On | Evens out the camera's automatic white balance jumping between frames, while keeping slow changes such as a sunset |
| Motion smoothing | On | Blends each frame with its neighbours (1-2-1). Only used when there is no natural motion blur (intervals under 6 s, or blur switched off) |
| Camera names | On | Labels each grid tile |
| Date and time | Off | Adds the real capture time, top right, clear of the cameras' own timestamps |
| Skip night-vision frames | On | Drops monochrome infrared frames, so a 24-hour capture becomes a daylight video |
| 4K for YouTube | Off | Upscales single-camera videos to 3840×2160. YouTube gives 4K uploads a higher-quality stream |
| Delete frames after the video is made | On | Frees disk space; the timelapse can no longer be re-rendered |

### Getting the best results

The Wyze Cam v4 has automatic exposure and white balance that cannot be
locked, a fixed wide lens, and a stream of about 1–1.5 Mbit/s. The options
above make up for most of that in software. On the camera side:

- Mount the camera firmly; wind shake shows as jitter.
- Keep the lens clean and avoid shooting through window glass.
- Turn off the motion-triggered spotlight on cameras used for timelapses, or
  it causes bright flash frames at night.
- If the Wyze app offers them, turn off the camera's own time and logo
  watermarks.

## Grid layouts

Every tile is 16:9, and no layout leaves an empty tile.

| Cameras | Layout | Video size |
|---|---|---|
| 1 | Single camera | 2560×1440 (native), or 3840×2160 with **4K for YouTube** |
| 2 | Side by side | 3840×1080 |
| 3 | One large tile and two small ones stacked | 3840×1440; the large tile is native 2560×1440 |
| 4 | 2×2 | 3840×2160 |
| 5–6 | 3×2 | 3840×1440 |

Per-camera videos are native 2560×1440 unless **4K for YouTube** is on.

## Where files go

| | Windows app | Raspberry Pi |
|---|---|---|
| Finished videos | `Downloads\Wyze Monitor\Timelapses` | `timelapses` Docker volume; **Download** saves to the viewing device's Downloads folder |
| Working frames | `%LOCALAPPDATA%\Wyze Monitor\Timelapse frames` | `timelapses` Docker volume |
| Ready notice | Windows notification (click to show the file) and an in-app banner | In-page banner |

**Delete** (press twice to confirm) removes the timelapse from the list and
deletes its frames and finished videos. On Windows that includes its videos in
`Downloads\Wyze Monitor\Timelapses`; copy a video somewhere else first to keep
it. On the Pi, videos already downloaded to another device are not affected.

## How it works

**Capture.** One FFmpeg process per camera reads the camera's main stream from
go2rtc's RTSP restream and decodes keyframes only (`-skip_frame nokey`). The
cameras send a keyframe roughly every two seconds, so each camera costs one
intra-frame decode per keyframe instead of 20 full decodes a second. With
natural motion blur on, `tmix` averages the last N keyframes (N = half the
interval in keyframes, at most 8), which the Wyze stream's keyframes suit well:
they carry almost all of its detail (about 180 KB each, against 2–4 KB for the
frames between). A select filter keeps one frame per interval and writes it as
a JPEG at quality 2, which is visually lossless. Frames are filed by wall-clock slot, so frame N from
every camera shows the same moment, to within one keyframe interval.

A camera that stops sending frames is restarted with back-off. Capture stops if
free disk space falls below 2 GB. If the app or container restarts, capture
resumes when the timelapse's time window has not ended; the gap becomes a cut
in the video.

**Render.** Frames enter FFmpeg through the concat demuxer with their real
capture spacing as durations, so the optional clock shows true capture time
even across gaps. With **Steady colour**, a quick first pass measures each
frame's average colour, and per-frame red, green and blue gains pull its
red:green and blue:green ratios to the median of the 15 frames around it
(corrections are capped at about ±17% and keep the frame's brightness).
`sendcmd` feeds the gains to a `colorchannelmixer`. The filter graph then
applies deflicker, scaling and labels per camera, `xstack` for the grid, then
`tmix` smoothing and the clock. Output is
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
- Intervals are rounded to whole 2-second keyframes.
- Grid tiles are synchronised to within one keyframe interval, about two seconds.
- The Wyze Cam v4's switch to infrared at dusk cannot be removed from frames;
  **Skip night-vision frames** drops them. A frame counts as night when the
  median colour saturation of it and its four neighbours is below 4 (measured
  on real footage: daylight 10–16, dusk 5–9, infrared 0–0.3), so a passing
  headlight cannot splice a single colour frame into the night.

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
