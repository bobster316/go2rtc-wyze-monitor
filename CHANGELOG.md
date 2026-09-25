# Changelog

## 1.3.0 - 2026-09-25

- Add full-resolution timelapse capture for any combination of cameras, up to
  24 hours, starting now or at a scheduled time, stopping after a set time or
  manually.
- Capture 2560x1440 keyframes only through go2rtc's RTSP restream, aligned to
  wall-clock slots so grid tiles stay in step; reconnect stalled cameras, stop
  on low disk space and resume after restarts.
- Render with deflicker, motion smoothing, optional camera names, clock and
  night-frame skipping, as H.264 High CRF 18 with a bitrate cap.
- Grid layouts with no empty tiles, including one large and two small tiles
  for three cameras.
- Add a toolbar Timelapse menu with Quick start, progress and recent videos,
  plus a setup panel that docks beside the cameras.
- Windows: save timelapse videos to `Downloads/Wyze Monitor/Timelapses`, show a
  notification when ready, keep the PC awake while capturing and confirm before
  quitting.
- Raspberry Pi: capture and render in the web container with no browser open,
  store in a `timelapses` volume and expose go2rtc RTSP on the private network.
- Fix toolbar buttons rendering at 16px because `font: inherit` overrode their
  size.

## 1.2.0 - 2026-09-10

- Make the Windows Electron application the primary desktop viewer.
- Add native MP4 recording for the visible grid or focused camera.
- Save recordings automatically to `Downloads/Wyze Monitor` through FFmpeg.
- Add a context-isolated preload bridge for the native recording save operation.
- Keep the Raspberry Pi browser viewer as a supported remote option with WebM fallback.
- Improve recording frame timing, opaque capture and constant-frame-rate conversion.
- Document the desktop and browser workflows, recording locations and troubleshooting.

## 1.1.1 - 2026-09-09

- Correct text encoding in public guides and installer documentation.
- No application behavior changes from 1.1.0.

## 1.1.0 - 2026-09-09

- Publish the Raspberry Pi 4 and Pi 5 deployment alongside the Windows app.
- Add camera wizard, architecture detection, Docker setup, desktop/SSH launchers
  and a friendly .local address.
- Publish full-resolution browser Smooth30 with source/output labels.
- Add quick start, detailed configuration, recovery, removal and troubleshooting.
- Package a dedicated Pi installer containing the public guides and examples.
- Exclude credentials, generated runtime data and private media from release inputs.
- Match container file access to the installing user's UID/GID.
- Use Docker's Debian repository for both Pi architectures and recreate the
  monitor services after camera configuration changes.

Historical hardware observations cover Pi 4 ARM32 and Pi 5 ARM64 with remote
viewers. Local-Pi 30 FPS display and the complete compatibility/soak matrix remain
uncertified. See docs/PERFORMANCE.md.

## Earlier Windows version

Local RTSPS/H.264 stream-copy dashboard with an adaptive camera grid, HD/Eco,
enlargement, reconnect, fullscreen and client-side statistics.
