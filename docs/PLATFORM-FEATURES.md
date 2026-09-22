# Windows and Raspberry Pi feature parity

The Windows Electron app and Raspberry Pi/Linux web service use the same
dashboard renderer. Open the Pi 5 dashboard at `http://192.168.1.155:18765` on
the current LAN and hard-refresh after an update.

| Feature | Windows | Raspberry Pi/Linux browser |
|---|---|---|
| Adaptive multi-camera grid | Yes | Yes |
| HD main streams and Eco substreams | Yes | Yes |
| Enlarged camera, Cameras menu, reconnect, fullscreen | Yes | Yes |
| Source/output FPS, bitrate and resolution diagnostics | Yes | Yes |
| One-second WebRTC buffer request | Yes, supported runtime | Browser support dependent |
| Hidden grid streams disconnected during enlarged view | Yes | Yes |
| Optional Smooth 30 presentation | Yes | WebGL 2 browser required |
| Record grid or enlarged camera only | Yes | Yes |
| MP4 output | Electron saves through FFmpeg | Browser MP4, or Pi conversion of WebM |
| Desktop/taskbar/app toolbar in recorded image | No | No |

Recording uses the same 1920×1080 canvas, with a target of 30 output frames per
second. This does not change the cameras' captured frame rate or make every
output frame unique. HD live views retain the full camera stream resolution.

## Saving recordings

In either interface, click **Record**, then click the stop button. To capture a
single camera, enlarge it before starting. The capture canvas draws only video
elements, not the desktop or application UI.

Windows saves MP4 to `Downloads\Wyze Monitor` through its native bridge.
On a Pi-served page, the browser downloads the clip to the viewing device's
normal download location. The download link remains available if automatic
downloads are blocked. A web page cannot silently select the same filesystem
directory as a desktop application.

Browsers supporting H.264 MP4 recording save directly. Otherwise, the browser
uploads its WebM capture to the Pi for H.264 MP4 conversion after recording
stops. Only one conversion can run at a time. The conversion upload limit is
512 MB; browser capture using this path stops shortly before the limit.
An unconverted WebM download remains available if conversion fails or the Pi
is busy. Long recordings use browser memory while being captured.

The web image includes FFmpeg. Conversion uses one codec thread, low process
priority on Linux, a timeout and temporary files in a dedicated Docker volume.
Temporary clip files are removed after the response. These limits reduce
contention; conversion still consumes CPU and disk and has not been capacity
certified alongside every other home-server workload.

## Deployment

`monitor-web` requires a writable `/recordings` volume while its root filesystem
remains read-only. Keep existing published ports and private camera configuration.
For an existing Pi 5 deployment, build and recreate only `monitor-web` with
`--no-deps`; do not recreate other Compose projects or the go2rtc service.

Features absent in both implementations include scheduled recording, motion
triggers, audio recording and a recording-history UI. This update does not
claim to add those features.
