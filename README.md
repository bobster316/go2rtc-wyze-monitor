# Wyze Monitor - Windows and Raspberry Pi

A local multi-camera dashboard for **Wyze Cam v4 cameras with RTSP-enabled firmware**.
Run it as a Windows desktop application or as a Raspberry Pi 4 / Pi 5 server
viewed from a browser on your LAN. Configure your own cameras; no Wyze account
credentials or API keys are needed by this application.

**Start here: [Quick start](docs/QUICKSTART.md).**
Pi users can download the dedicated installer ZIP from
[Releases](https://github.com/bobster316/go2rtc-wyze-monitor/releases).

## Choose your setup

| Setup | What runs where | Instructions |
|---|---|---|
| Raspberry Pi 4 or Pi 5, Lite | Docker server on the Pi; browser on another device | [Pi installation](raspberry-pi/README.md) |
| Raspberry Pi 4 or Pi 5, Desktop | Same server; local or remote browser | [Pi installation](raspberry-pi/README.md) |
| Windows | Electron dashboard, FFmpeg and go2rtc on the PC | [Windows installation](docs/WINDOWS.md) |

One repository keeps the shared player and configuration consistent. The Pi installer
does not require Windows, Electron, or a pre-existing deployment.

## Documentation

- [Quick start](docs/QUICKSTART.md) - shortest path to a working dashboard.
- [Camera and application configuration](docs/CONFIGURATION.md) - firmware prerequisite, every configuration field, adding cameras, ports and friendly names.
- [Raspberry Pi installation](raspberry-pi/README.md) - OS preparation, installer wizard, Docker, Desktop and SSH.
- [Windows installation](docs/WINDOWS.md) - prerequisites, setup, launch and configuration.
- [Operation, backup, recovery and removal](docs/OPERATIONS.md) - recreate your installation and maintain it.
- [Troubleshooting](docs/TROUBLESHOOTING.md) - camera, browser, network, Docker and installer problems.
- [Architecture](docs/ARCHITECTURE.md) - stream path, shared code and process ownership.
- [Performance and test status](docs/PERFORMANCE.md) - source FPS versus synthetic presentation and what has actually been tested.
- [Pi compatibility matrix](raspberry-pi/COMPATIBILITY.md) - remaining certification work.
- [Privacy and security](SECURITY.md) - credentials, logs and safe support reports.
- [Contributing and release checks](CONTRIBUTING.md) - reproduce validation and build the Pi archive.
- [Changelog](CHANGELOG.md).

## What it does

Displays all configured cameras in an adaptive grid, with HD/Eco selection,
per-camera reconnect, enlarged main-stream views and fullscreen monitoring.
Smooth30 optionally blends source frames in the viewing browser, with visible
`SRC`, `OUT` and synthetic-frame labels. Full-resolution HD sources retain
their 2560x1440 backing canvas. Eco is an explicit user choice.

```text
Wyze RTSPS/H.264 -> FFmpeg stream copy -> go2rtc -> WebRTC -> browser decode
                                                           v
                                               optional GPU Smooth30
```

The server does not transcode video. The application does not use Docker Wyze
Bridge. Audio, recording, object detection and a camera-management web UI are
not implemented.

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
