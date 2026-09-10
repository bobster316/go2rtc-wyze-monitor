# Windows installation (standalone desktop app)

## Prerequisites

- Windows 10/11 with a working H.264-capable GPU stack.
- Node.js 22 LTS, Git, and FFmpeg available on PATH.
- RTSP-enabled cameras on reachable, reserved LAN addresses.
- Internet access for npm packages and the go2rtc download.

Install Node.js from [nodejs.org](https://nodejs.org/), Git from
[git-scm.com](https://git-scm.com/), and FFmpeg from a distribution linked by
[ffmpeg.org](https://ffmpeg.org/download.html). The optional Windows package command
is `winget install Gyan.FFmpeg`. Reopen PowerShell after installation.

Confirm:

```powershell
node --version
npm --version
git --version
ffmpeg -version
```

## Install and configure

```powershell
git clone https://github.com/bobster316/go2rtc-wyze-monitor.git
cd go2rtc-wyze-monitor
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1
notepad cameras.yaml
```

On first run, setup copies the example and exits. Replace or remove every example
camera. Each retained camera requires its own values; see
[configuration](CONFIGURATION.md).

Run setup again:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1
npm start
```

Setup downloads the pinned go2rtc Windows x64 binary, installs locked npm dependencies
including Electron, and generates private `go2rtc/go2rtc.yaml`. If a go2rtc binary
already exists it is reused. For a repeatable fresh installation use a new checkout.

The application opens a maximized standalone dashboard. It uses a local
loopback HTTP server internally; you do not need to open Chrome. The Electron
window is the recommended Windows viewer.

## Everyday use

Select HD for main streams, Eco for substreams, or double-click a tile to open
the main stream enlarged. Use Reconnect for one camera or Refresh for the grid.
Smooth30 is a saved viewer preference and can be turned off at any time.

Click **Record** to record the visible grid. Enlarge a camera first to record
that camera only. When recording stops, Electron sends the capture to FFmpeg
and saves a native H.264 MP4 in:

```text
C:\Users\YOUR_USER\Downloads\Wyze Monitor
```

The browser viewer on the Pi cannot use this native path and falls back to a
browser WebM recording.

Close the app to stop the instance of go2rtc it started. A separately running
go2rtc instance may be reused and is not owned by this app. Avoid running multiple
copies or unrelated go2rtc configurations on the same ports.

There is no Windows installer EXE, Windows service or automatic Windows startup
registration in this release. Launch using `npm start` from the repository folder.
FFmpeg must remain available on PATH because Electron uses it for MP4 conversion.

## Updating or recreating

Back up `cameras.yaml` privately. Close the app, install the selected release in a
new folder, restore that file, run setup and launch. This preserves your working
folder for rollback. Do not copy `node_modules`, browser profiles or generated
go2rtc configuration between installations.

The application includes the project's existing Electron major version. Dependency
refreshes need separate compatibility testing; this release does not claim that
every dependency is the newest available. See [security](../SECURITY.md).

## Troubleshooting the desktop app

- If Electron refuses to start with a `NODE_OPTIONS` error, run
  `$env:NODE_OPTIONS=$null` in PowerShell before `npm.cmd start`.
- If cameras are black, confirm FFmpeg is on PATH and run `ffmpeg -version`.
- If an MP4 is not created, check the terminal output for the FFmpeg error and
  confirm the `Downloads\Wyze Monitor` folder is writable.
- The Pi browser viewer remains available at `http://PI_IP:18765` when remote
  access is required.
