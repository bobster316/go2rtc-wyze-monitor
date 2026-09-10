# Raspberry Pi 4 quality example

The [Wyze Monitor 1.2.0 GitHub release](https://github.com/bobster316/go2rtc-wyze-monitor/releases/tag/v1.2.0)
includes a [short MP4 quality example](https://github.com/bobster316/go2rtc-wyze-monitor/releases/download/v1.2.0/wyze-monitor-grid-2026-09-10T17-36-25-404Z.mp4)
captured from the four-camera dashboard running on the
Raspberry Pi 4 deployment.

The example is a representative operator-view capture, not an original camera
file. It demonstrates the quality delivered by the 2×2 HD dashboard after the
Pi receives the cameras' H.264 streams and passes them to the viewing device.

Example properties:

- Four simultaneous camera tiles.
- 1920×1080 desktop capture of the dashboard.
- H.264 MP4 at 30 fps.
- Approximately nine seconds long.
- Captured locally from the Windows Electron viewer while the Pi supplied the
  live streams.

The source camera streams remain 2560×1440 where the camera and selected HD
profile provide that resolution. A desktop capture is limited by the viewer
window resolution and should not be confused with the source stream resolution.
