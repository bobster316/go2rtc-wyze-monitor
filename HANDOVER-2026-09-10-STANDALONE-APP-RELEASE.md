# Wyze Monitor standalone app and Raspberry Pi 4 release handover — 10 September 2026, 19:43 BST

## Purpose

This handover records the complete state of the Wyze Monitor project at the end
of the 10 September 2026 session. It covers the four-camera Raspberry Pi 4
deployment, the Windows Electron desktop application, native MP4 recording, the
public GitHub release, the verified quality example and the remaining work.

## Current product direction

The Windows Electron application is now the primary viewer. It runs the shared
dashboard locally, starts or reuses the local go2rtc process and saves native
H.264 MP4 recordings. The Raspberry Pi remains the camera stream server and
supports remote browser viewing on the LAN. Browser recording is only a fallback
and produces WebM because browsers cannot reliably encode MP4.

```text
Wyze cameras -> Raspberry Pi 4 / go2rtc -> Windows Electron dashboard -> MP4
                                      \-> optional LAN browser viewer -> WebM fallback
```

## GitHub and release state

- Repository: `https://github.com/bobster316/go2rtc-wyze-monitor`
- Branch: `main`
- Latest repository commit: `e228f97`
- Release: `v1.2.0`
- Release page: `https://github.com/bobster316/go2rtc-wyze-monitor/releases/tag/v1.2.0`
- Package version: `1.2.0`
- The release includes the Raspberry Pi 4 quality MP4 asset.
- The pre-existing untracked `research/30fps/build_pdf.py` is intentionally not
  part of the release.

## Camera configuration

The active four-camera names and reserved LAN addresses are:

| Name | IP | Streams |
|---|---|---|
| Front | `192.168.1.133` | `front_main`, `front_sub` |
| Front Garden | `192.168.1.154` | `front_garden_main`, `front_garden_sub` |
| Back Garden | `192.168.1.183` | `back_garden_main`, `back_garden_sub` |
| Office | `192.168.1.57` | `office_main`, `office_sub` |

Private usernames, passwords and complete RTSP URLs are stored only in private
`cameras.yaml` files and are never committed. The shared camera settings are:

- RTSP over TLS (`rtsps`), camera port `322`.
- Main path `stream0`; sub path `stream1`.
- Default quality `main` (HD).
- Wyze Cam v4 units with RTSP-enabled firmware.

The configuration schema has no four-camera limit. The wizard accepts additional
cameras and the renderer calculates an adaptive grid. Four cameras are the
validated performance baseline; larger counts need separate capacity testing.

## Raspberry Pi 4 deployment

- Host: `pi@192.168.1.93`.
- Architecture: ARM64 (`aarch64`).
- OS: Raspberry Pi OS 64-bit, Trixie.
- Hardware: Raspberry Pi 4, 4 GB RAM, Ice Tower cooler.
- Project path: `/home/pi/go2rtc-wyze-monitor`.
- Compose project: `wyze-monitor-rpi`.
- Services: `go2rtc` and `monitor-web`.
- Dashboard: `http://192.168.1.93` or `http://192.168.1.93:18765`.
- WebRTC media: TCP/UDP `18555`.
- go2rtc management API is private to the Docker network.
- The Pi runtime was deployed from commit `9d20b76`; later commits are
  documentation and release-link changes only.

The verified Pi health response reports four cameras, eight main/sub streams,
`go2rtc: true`, `defaultQuality: main` and `architecture: arm64`. The last
telemetry check reported approximately 28.2°C CPU temperature, low load (0.65)
and `vcgencmd get_throttled` returned `0x0`.

To update the Pi from GitHub:

```powershell
ssh -t -i "$env:USERPROFILE\.ssh\id_ed25519_pi" pi@192.168.1.93 "cd /home/pi/go2rtc-wyze-monitor/raspberry-pi && git fetch origin main && git reset --hard origin/main && sudo docker compose --env-file .env -f compose.yaml -f compose.pi4.yaml up -d --build --no-deps monitor-web"
```

Enter the Pi sudo password when prompted. After deployment, refresh the browser
with `Ctrl+F5`.

## Windows Electron application

Start the standalone app from the repository root:

```powershell
cd D:\Wyze-Cam-v4\go2rtc-wyze-monitor
$env:NODE_OPTIONS=$null
npm.cmd start
```

`NODE_OPTIONS` must be cleared if the shell inherits `--use-system-ca`, because
Electron rejects that option. The app uses `src/main.js` for Electron lifecycle,
the local HTTP server, go2rtc supervision and native recording; `src/preload.js`
for the context-isolated save bridge; and `src/renderer.js` for the shared grid,
focus view, diagnostics and capture canvas.

The app records the visible grid or focused camera. Electron sends the temporary
capture through the preload bridge to FFmpeg, which writes H.264 MP4 with a
constant 30 fps rate to:

```text
C:\Users\<user>\Downloads\Wyze Monitor
```

FFmpeg must be available on PATH. Audio, motion detection, authentication and
recording schedules are not included. Remote Pi browser viewing remains
supported; it uses the WebM fallback.

## Quality example

The verified source file was:

```text
C:\Users\<you>\Downloads\Wyze Monitor\wyze-monitor-grid-2026-09-10T17-36-25-404Z.mp4
```

It is H.264, 1920×1080, 30 fps, approximately 8.77 seconds and approximately
5.8 MB. It shows the four-camera dashboard while the Raspberry Pi supplies the
live streams. The release asset is:

`https://github.com/bobster316/go2rtc-wyze-monitor/releases/download/v1.2.0/wyze-monitor-grid-2026-09-10T17-36-25-404Z.mp4`

Documentation: [docs/QUALITY-EXAMPLE.md](docs/QUALITY-EXAMPLE.md).

The planned separate hardware video should use:

```text
C:\Users\<you>\Downloads\Wyze Monitor\wyze-monitor-pi4-hardware-10s.mp4
```

It should show the Raspberry Pi 4, 4 GB RAM, Ice Tower cooler and Raspberry Pi
OS 64-bit Trixie. It has not yet been uploaded to GitHub.

## Validation completed

- Four simultaneous HD camera streams decoded successfully.
- Four-camera adaptive grid is live on the Pi.
- HD and Eco modes work.
- Reconnect, fullscreen, Cameras and Diagnostics controls work.
- Compact top bar and thin grid separators are implemented.
- Synthetic 30 tile badges are hidden from the grid.
- Favicon is included.
- Native Electron MP4 recording is user-tested and working after frame-timing
  and black-canvas fixes.
- `node --check` passes for `src/main.js`, `src/preload.js` and `src/renderer.js`.
- All four automated tests pass.
- `git diff --check` passes for release changes.

## Remaining work

1. Upload the Pi hardware video after it is placed in the Downloads folder.
2. Test 6, 9 and 16-camera configurations for browser GPU, Pi load and LAN
   bandwidth; arbitrary counts are supported but not certified.
3. Add camera grouping, pagination/lazy loading and capacity warnings.
4. Add recording history, retention limits and scheduled or motion-triggered
   recording.
5. Add optional authentication and HTTPS outside a trusted LAN.
6. Add a packaged Windows installer and optional startup registration.
7. Complete long-duration and reboot/restore testing.
8. Restore browser-control integration if live Chrome inspection is required;
   the connector was unavailable in the last session.

## Privacy and safety

Never commit `cameras.yaml`, `.env`, generated go2rtc YAML, private camera URLs,
credentials or unredacted property footage. Review release videos for house
numbers, number plates, faces, browser tabs, email notifications and other
identifying information before publication.
