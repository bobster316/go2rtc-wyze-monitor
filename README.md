# Wyze Monitor - Windows and Raspberry Pi

A local multi-camera dashboard for **Wyze Cam v4 cameras with RTSP-enabled firmware**.
Use the Windows Electron desktop app as the primary viewer, or run the Raspberry
Pi server and view it remotely in a browser on your LAN. Configure your own cameras; no Wyze account
credentials or API keys are needed by this application.

![Wyze Monitor four-camera dashboard](assets/wyze-monitor-four-camera-hero.png)

**Start here: [Quick start](docs/QUICKSTART.md), or follow the [from-scratch guide](docs/FROM-SCRATCH.md) if you are new to Wyze RTSP and Raspberry Pi.**
Pi users can download the dedicated installer ZIP from
[Releases](https://github.com/bobster316/go2rtc-wyze-monitor/releases).

## Choose your setup

| Setup | What runs where | Instructions |
|---|---|---|
| Raspberry Pi 4 or Pi 5, Lite | Docker server on the Pi; browser on another device | [Pi installation](raspberry-pi/README.md) |
| Raspberry Pi 4 or Pi 5, Desktop | Same server; local or remote browser | [Pi installation](raspberry-pi/README.md) |
| Windows desktop (recommended) | Electron dashboard, native MP4 recording, FFmpeg and go2rtc on the PC | [Windows installation](docs/WINDOWS.md) |
| Browser viewer | Shared dashboard and MP4 downloads, with Pi conversion where needed | [Pi installation](raspberry-pi/README.md) |

One repository keeps the shared player and configuration consistent. The Pi installer
does not require Windows, Electron, or a pre-existing deployment.

## Documentation

- [Quick start](docs/QUICKSTART.md) - shortest path to a working dashboard.
- [From-scratch setup](docs/FROM-SCRATCH.md) - complete beginner build and suggested YouTube chapter order.
- [Camera and application configuration](docs/CONFIGURATION.md) - firmware prerequisite, every configuration field, adding cameras, ports and friendly names.
- [Raspberry Pi installation](raspberry-pi/README.md) - OS preparation, installer wizard, Docker, Desktop and SSH.
- [Windows installation](docs/WINDOWS.md) - prerequisites, setup, launch and configuration.
- [Platform features and recording](docs/PLATFORM-FEATURES.md) - Windows/Pi parity and browser download behaviour.
- [Operation, backup, recovery and removal](docs/OPERATIONS.md) - recreate your installation and maintain it.
- [Troubleshooting](docs/TROUBLESHOOTING.md) - camera, browser, network, Docker and installer problems.
- [Architecture](docs/ARCHITECTURE.md) - stream path, shared code and process ownership.
- [Performance and test status](docs/PERFORMANCE.md) - source FPS versus synthetic presentation and what has actually been tested.
- [Raspberry Pi 4 quality example](docs/QUALITY-EXAMPLE.md) - downloadable MP4 showing the four-camera HD dashboard output.
- [Pi compatibility matrix](raspberry-pi/COMPATIBILITY.md) - remaining certification work.
- [Privacy and security](SECURITY.md) - credentials, logs and safe support reports.
- [Contributing and release checks](CONTRIBUTING.md) - reproduce validation and build the Pi archive.
- [Changelog](CHANGELOG.md).

## What it does

Displays all configured cameras in an adaptive grid, with HD/Eco selection,
per-camera reconnect, enlarged main-stream views, fullscreen monitoring and
diagnostics. The Electron app records the grid or focused camera as native MP4
files in the Windows Downloads folder.
Smooth30 optionally blends source frames in the viewing browser, with visible
`SRC`, `OUT` and synthetic-frame labels. Full-resolution HD sources retain
their 2560x1440 backing canvas. Eco is an explicit user choice.

```text
Wyze RTSPS/H.264 -> FFmpeg stream copy -> go2rtc -> WebRTC -> browser decode
                                                           v
                                               optional GPU Smooth30
```

Live camera forwarding does not transcode video. The application does not use Docker Wyze
Bridge. Audio, object detection and a camera-management web UI are not
implemented. Both viewers record only the camera images. Windows saves MP4 through
Electron; Pi browser viewers save MP4 directly when supported, or convert a WebM
capture on the Pi after recording stops. A WebM backup is retained if conversion
fails. See [recording limits and download behaviour](docs/PLATFORM-FEATURES.md).

## Requirements and limits

Each camera must already provide a working local RTSP/RTSPS stream. The monitor
cannot enable missing camera firmware features. Read the
[firmware prerequisite](docs/CONFIGURATION.md#1-prepare-each-camera) before buying
hardware or attempting installation.

The Pi deployment targets Raspberry Pi OS ARM32/ARM64, Lite/Desktop. Real tests
cover Pi 4 ARM32 and Pi 5 ARM64 with an external Chrome viewer; the full matrix
and local-Pi display performance are not certified. Four cameras were tested;
the wizard accepts other counts, but capacity depends on your network and viewer.

A displayed `OUT 30` is synthetic presentation cadence, **not 30 captured camera
frames per second**. It is also not proof that the input is still moving.
See [performance](docs/PERFORMANCE.md).

Use the dashboard on a trusted LAN or behind a VPN. It has no login screen.
Reserve DHCP addresses for both the cameras and the Pi. The friendly name does
not automatically update Docker bindings when the Pi's IP changes.

## License and credits

MIT licensed; see [LICENSE](LICENSE). Not affiliated with or endorsed by Wyze Labs.
Uses [go2rtc](https://github.com/AlexxIT/go2rtc) and FFmpeg.
`src/vendor/video-rtc.js` comes from go2rtc and retains its upstream licensing.
Firmware is obtained from Wyze and is not redistributed here.


