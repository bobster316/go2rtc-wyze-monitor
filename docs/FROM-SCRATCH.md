# From-scratch Wyze Cam v4 + Raspberry Pi guide

This is the complete beginner path for building the monitor on a Raspberry Pi 4 or Pi 5, and the recommended chapter order for a video tutorial. You do not need prior knowledge of RTSP, Docker, Linux, or this repository.

## What you are building

Each camera sends a private RTSP/RTSPS video stream over your home network. The Pi receives those streams, keeps them local, and serves a browser dashboard:

```text
Wyze camera -> local RTSP/RTSPS -> Raspberry Pi -> browser on your LAN
```

The application does not need your Wyze account password or API key. You supply a separate RTSP username and password for each camera.

## Equipment and prerequisites

- Raspberry Pi 4 (2 GB or more; 4 GB recommended) or Pi 5.
- Correct power supply, cooled case, quality 32 GB or larger microSD card.
- Ethernet or strong 5 GHz Wi-Fi (Ethernet preferred).
- Wyze Cam v4 cameras with RTSP support enabled by firmware.
- A second computer or phone on the same LAN.

Reserve DHCP addresses for the Pi and every camera. The dashboard has no login screen, so keep it on a trusted LAN or behind a VPN. Do not overclock during initial setup.

## Raspberry Pi OS

Use Raspberry Pi Imager to install Raspberry Pi OS Lite (64-bit) for a headless server, or Desktop (64-bit) if the Pi has a monitor. Set your own username/password, hostname, country, time zone, network and SSH access in the Imager customisation screen. Boot the card and connect with `ssh USERNAME@PI_IP`.

Verify the platform:

```bash
uname -m
dpkg --print-architecture
df -h /
```

Expected 64-bit values are `aarch64` and `arm64`. The installer also supports 32-bit ARM Pi OS, but 64-bit is recommended.

## Camera preparation

Pair every camera normally in the Wyze app, connect it to the same LAN, and use only official Wyze updates. RTSP availability is model- and firmware-specific and can change. Follow current Wyze instructions for the exact camera; for Cam v4 use the supported beta/official path applicable to your device. Never flash a recovery image for another model. If RTSP is absent, stop and solve that prerequisite first; this application cannot add RTSP.

When RTSP is available, enable it, create a unique RTSP username/password (not your Wyze account password), record the exact URL privately, and reserve the camera IP in the router. Use [`cameras.example.yaml`](../cameras.example.yaml) as the shape; real `cameras.yaml` and `.env` files are local-only secrets.

## Test the network

From the Pi, test each camera's RTSP port. Most setups use port `322`; use the port specified for your camera:

```bash
sudo apt-get update && sudo apt-get install -y netcat-openbsd
nc -vz CAMERA_IP 322
```

A successful TCP check proves reachability only, not credentials or stream validity. An optional `ffprobe` test may be run privately; never paste a real URL or output into chat or GitHub.

## Install

Run as your normal Pi user, not by prefixing the whole installer with `sudo`:

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates curl
git clone https://github.com/bobster316/go2rtc-wyze-monitor.git
cd go2rtc-wyze-monitor
git checkout v1.2.0
chmod +x raspberry-pi/*.sh raspberry-pi/wyze-monitor
./raspberry-pi/install.sh --dry-run
./raspberry-pi/install.sh
```

The dry run checks model, architecture, memory, storage, network and Docker access without changing the system. The real installer installs Docker if needed, asks for camera details, selects the Pi 4/Pi 5 profile, starts services, and creates the `wyze-monitor` command. Enter credentials directly at the Pi prompt; never send them to another person.

## Open and verify

Open `http://wyze-monitor.local` or `http://PI_IP:18765`. If `.local` does not resolve, use the numeric URL. Useful SSH commands are:

```bash
wyze-monitor status
wyze-monitor logs
wyze-monitor restart
```

A healthy service does not prove every camera is streaming. Check each tile and use its reconnect control if needed.

## Controls and troubleshooting

HD selects full resolution, Eco selects lower bandwidth, Enlarge opens a larger view, Reconnect restarts one camera path, and Refresh reloads the page. Smooth30 regularises browser presentation; `SRC` is measured source cadence and `OUT` is displayed cadence. `OUT 30` does not mean the camera captured 30 new frames per second.

Troubleshoot in this order: confirm Pi power/network/address; camera power and Wyze visibility; RTSP enabled for the exact model/firmware; camera IP and port; `nc -vz CAMERA_IP 322`; credentials, URL scheme and path; `wyze-monitor logs`; then try the numeric Pi URL. See [Troubleshooting](TROUBLESHOOTING.md), [Configuration](CONFIGURATION.md), and [Operations](OPERATIONS.md).

## Backup, recreation and video chapters

Keep a private copy of `raspberry-pi/cameras.yaml`, `.env`, and router reservations. Never commit them. To rebuild on a replacement card, install Raspberry Pi OS, clone this repository, repeat the dry run and installer, and enter camera details again.

Suggested video chapters: finished architecture; hardware; Imager/SSH; Wyze pairing and RTSP; IP reservations and port test; clone/dry run/installer; dashboard controls; troubleshooting; privacy, backups and rebuilding. In a public recording use placeholder IPs and blur credentials; show entering secrets locally without showing the values.
