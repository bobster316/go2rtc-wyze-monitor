# Windows playback fix — 20 September 2026

## Correct application and launcher

Use `D:\Wyze-Cam-v4\go2rtc-wyze-monitor`, package version 1.2.0, with native
MP4 recording, Cameras, Diagnostics and the Smooth 30 toggle.

Start with `scripts\start-windows.ps1`. The existing launcher at
`C:\Users\<you>\WyzeCameraMonitor\launchers\Open-Wyze-Monitor-Electron.ps1`
now forwards to this script. Its CMD wrapper remains intact.

The older application under `C:\Users\<you>\WyzeCameraMonitor\app` was what
the user's shortcut originally launched. Initial diagnosis and a buffered
playback trial ran there. Its renderer, main process and go2rtc configuration
were restored from the backup at
`C:\Users\<you>\WyzeCameraMonitor\backups\playback-fix-20260920-112859`.
That directory also contains the original launcher script.

## Symptom and diagnosis

Moving cars and people briefly paused in the Windows monitor, including enlarged
view. The user reported smooth playback in the Wyze phone app.

Local go2rtc receive-counter sampling showed gaps of several hundred milliseconds.
The initial 20-second sample had maximum observed counter gaps of approximately
0.63 s Front, 0.60 s Front Garden, 0.95 s Back Garden and 0.47 s Office.
These are polling observations, not exact presentation measurements. FFprobe
also found approximately 50 ms media timestamp intervals despite uneven delivery.

The observations do not isolate the original cause to a particular camera,
network component or relay operation. A trial of FFmpeg output flushing in the
older app did not clearly remove the gaps. That configuration change was restored
and was not ported to the newer project.

## Changes applied to the current app

- Every new WebRTC video receiver requests a 1000 ms jitter buffer, including
  reconnects. Resolution and captured cadence are preserved; the trade-off is
  approximately one second of buffering.
- Enlarging a camera disconnects hidden grid players instead of adding a fifth
  decoder. Closing the enlarged view recreates the grid.
- Reconnect and grid rebuild explicitly dispose of old players and timers.
- FPS accounting excludes frames reported as dropped by the video element.
- Smooth 30 is off by default unless previously explicitly enabled. It remains
  available, but synthetic smoothing is separate from this buffering fix.
- A loopback `/api/playback` endpoint receives numeric playback diagnostics,
  without images, credentials or complete camera URLs.
- The new Windows launcher selects the correct application and clears
  incompatible inherited NODE_OPTIONS.

Native recording code and its preload bridge were retained. No new end-to-end
MP4 recording was made during this repair.

Buffering reference: [W3C WebRTC specification](https://www.w3.org/TR/webrtc/).

## Camera reboot and runtime status

After switching applications, Back Garden became stuck around 1 FPS with a
growing effective buffer delay. The other three cameras were near 20 FPS.
The user rebooted Back Garden; it subsequently returned to approximately 20 FPS.

An Electron 43.4.0 update was attempted because the older application used that
runtime during its successful trial. The npm installation failed with access
errors before changing the runtime or dependency declaration. Further engine
changes were paused to isolate the camera reboot.

The final passing test used Electron 31.7.7 and the existing ^31.0.0 dependency.
Do not claim that an engine upgrade fixed the issue or that the runtime was
established as its cause.

## Validation

All seven automated tests passed, including new coverage for receiver buffer
configuration, focus/grid connection lifecycle and dropped-frame FPS accounting.
JavaScript syntax checks and `git diff --check` passed.

Final live sample: 20 September 2026, 10:52:59.799–10:53:44.800 UTC,
approximately 45 seconds after the camera was reported back online.

| Camera | Frames decoded | New freezes | Dropped frames | Packet loss | Resolution |
|---|---:|---:|---:|---:|---|
| Front | 900 | 0 | 0 | 0 | 2560×1440 |
| Front Garden | 901 | 0 | 0 | 0 | 2560×1440 |
| Back Garden | 900 | 0 | 0 | 0 | 2560×1440 |
| Office | 901 | 0 | 0 | 0 | 2560×1440 |

All cameras remained ready and counters were monotonic. Mean jitter-buffer
residence was approximately 0.93–0.99 seconds. This is a short measured pass,
not a long-duration guarantee or a visual assessment of passing traffic.

Evidence and diagnostic scripts are in `D:\Wyze-Cam-v4\diagnostics`:
`playback-after-fix.json`, `verify-playback.cjs`, `measure-stream-cadence.cjs`
and `measure-ingress.cjs`. They retain timing and counters, not camera video.

## Repository and outstanding work

No commit, push, release or Pi deployment was performed. The pre-existing
untracked `research/30fps/build_pdf.py` remains untouched.
Application changes are in `src/main.js`, `src/renderer.js`, the new launcher
and playback regression tests.

The Pi 5 video project was paused for this repair. Its creative treatment is at
`D:\Wyze-Cam-v4\wyze-pi5-youtube-video\source\story-treatment.md`.
Real versus automated demo footage preference and optional Windows-video
analytics remain pending.
