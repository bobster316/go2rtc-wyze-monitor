# Windows installation

## Prerequisites

- Windows with a working H.264-capable browser/GPU stack.
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

The application opens a maximized dashboard. Its local address is
`http://127.0.0.1:8765` while Electron is running.

## Everyday use

Select HD for main streams, Eco for substreams, or double-click a tile to open
the main stream enlarged. Use Reconnect for one camera or Refresh for the grid.
Smooth30 is a per-browser preference and can be turned off at any time.

Close the app to stop the instance of go2rtc it started. A separately running
go2rtc instance may be reused and is not owned by this app. Avoid running multiple
copies or unrelated go2rtc configurations on the same ports.

There is no Windows installer EXE, Windows service or automatic Windows startup
registration in this release. Launch using `npm start` from the repository folder.

## Updating or recreating

Back up `cameras.yaml` privately. Close the app, install the selected release in a
new folder, restore that file, run setup and launch. This preserves your working
folder for rollback. Do not copy `node_modules`, browser profiles or generated
go2rtc configuration between installations.

The application includes the project's existing Electron major version. Dependency
refreshes need separate compatibility testing; this release does not claim that
every dependency is the newest available. See [security](../SECURITY.md).
