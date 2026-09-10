# Quick start

## Before either installation

1. Enable RTSP/RTSPS separately on every camera using firmware that supports it.
   See [camera preparation](CONFIGURATION.md#1-prepare-each-camera).
2. Record each camera's display name, reserved LAN IPv4 address, RTSP username
   and RTSP password privately. These are camera credentials, not your Wyze account login.
3. Keep the viewing device and cameras on a reachable, trusted LAN. Disable guest
   network/client isolation where it prevents communication.
4. For a Pi, reserve its address in your router as well.

## Raspberry Pi 4 or Pi 5

Use Raspberry Pi OS and a normal user with sudo access. Enable SSH if using Lite.
Install prerequisites in a Pi terminal:

```bash
sudo apt-get update
sudo apt-get install -y git curl
git clone https://github.com/bobster316/go2rtc-wyze-monitor.git
cd go2rtc-wyze-monitor
chmod +x raspberry-pi/*.sh raspberry-pi/wyze-monitor
./raspberry-pi/install.sh --dry-run
./raspberry-pi/install.sh
```

The first command checks compatibility without changing the deployment. The second
runs the actual installation and asks for your cameras and network settings.
Allow Docker installation if it is missing. Use the default friendly name unless
another server already owns it. Do not run the entire installer with `sudo`;
it requests sudo only for the system changes it needs.

Open **http://wyze-monitor.local** from a browser on the same LAN.
On Desktop, use the **Wyze Monitor** icon. Over SSH, run:

```bash
wyze-monitor
```

Alternatively download `wyze-monitor-rpi-installer.zip` from
[Releases](https://github.com/bobster316/go2rtc-wyze-monitor/releases), transfer it
to the Pi, install `unzip` if needed, and extract into a new folder:

```bash
unzip wyze-monitor-rpi-installer.zip
cd wyze-monitor-rpi
chmod +x raspberry-pi/*.sh raspberry-pi/wyze-monitor
./raspberry-pi/install.sh
```

Never extract an upgrade over your only working installation.
[Full Pi guide](../raspberry-pi/README.md).

## Windows standalone app (recommended)

Install Node.js 22 LTS, Git and FFmpeg, and reopen PowerShell so PATH updates apply.
Then:

```powershell
git clone https://github.com/bobster316/go2rtc-wyze-monitor.git
cd go2rtc-wyze-monitor
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1
notepad cameras.yaml
```

The first setup creates an example camera file and stops. Replace the examples
with your own cameras and credentials, save, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1
npm start
```

The Electron window is the primary Windows viewer. It records the grid or a
focused camera as MP4 files under `%USERPROFILE%\Downloads\Wyze Monitor`.

[Full Windows guide](WINDOWS.md).

## Confirm it is working

- Every configured tile shows a changing live picture.
- HD reports your camera's main-stream resolution, normally 2560x1440 on v4.
- Turn Smooth30 off and on. `SRC` is source cadence; `OUT` is generated cadence.
- On the Pi, `wyze-monitor status` reports running services.
- A healthy API alone confirms server availability, not every camera's live picture.

If any step fails, use [troubleshooting](TROUBLESHOOTING.md). No API subscription
or video-production tools are required to run the monitor.
