# Raspberry Pi 4 and Pi 5 installation

The Pi dashboard shares Windows camera controls, diagnostics and camera-only
recording. MP4 downloads use browser encoding when supported, otherwise conversion
inside the web container. See [platform features](../docs/PLATFORM-FEATURES.md)
for download behaviour and conversion limits.

## What you need

- Raspberry Pi 4 or Pi 5, suitable power supply, cooling and reliable storage.
- Raspberry Pi OS, 32-bit or 64-bit, Lite or Desktop; at least 2 GiB free storage.
- A normal user with sudo access. The default runtime user mapping is configured
  by setup; your login does not need to be named pi.
- Working network access to your cameras and internet access for packages/images.
- One or more cameras with RTSP enabled, plus their camera credentials.
- A modern browser on another computer for the tested viewing path.

Four cameras have been tested. The camera wizard has no fixed four-camera limit.
Lite is a headless server installation: it does not install a browser.
Desktop provides an icon that opens your default browser, but local Pi decoding
and Smooth30 performance still need device-specific testing.

## 1. Prepare Raspberry Pi OS

Use Raspberry Pi Imager and select the OS for your hardware. Configure your own
username, strong password, Wi-Fi if needed, hostname and SSH access. Boot the Pi,
connect it to the LAN and find its address through your router.

For a remote terminal, substitute your own account and address:

```bash
ssh YOUR_USER@192.168.1.100
```

Reserve the Pi's IPv4 address and each camera address in your router.
An Ethernet connection for the Pi is preferable where available.
Confirm the architecture from the userland as well as the kernel:

```bash
uname -m
dpkg --print-architecture
cat /etc/os-release
```

An aarch64 kernel with armhf userland needs ARM32 images. The installer handles
this combination; do not force ARM64 images based only on uname.

## 2. Obtain the project

Clone with Git:

```bash
sudo apt-get update
sudo apt-get install -y git curl
git clone https://github.com/bobster316/go2rtc-wyze-monitor.git
cd go2rtc-wyze-monitor
```

Or download the dedicated ZIP from
[GitHub Releases](https://github.com/bobster316/go2rtc-wyze-monitor/releases),
copy it to the Pi and extract:

```bash
sudo apt-get install -y unzip curl
unzip wyze-monitor-rpi-installer.zip
cd wyze-monitor-rpi
```

Extract each release to a new directory. The ZIP is a source installer, not an
offline image: it still downloads Docker packages and container dependencies.
It deliberately contains no configured cameras, passwords or runtime files.

## 3. Check compatibility

```bash
chmod +x raspberry-pi/*.sh raspberry-pi/wyze-monitor
./raspberry-pi/install.sh --dry-run
```

This reports model, architecture, memory, storage, Docker availability and whether
camera configuration exists. It does not install anything and is not a live
camera or complete port-conflict test.

## 4. Run the installer

Run as your normal login, not with sudo in front:

```bash
./raspberry-pi/install.sh
```

The installer detects Pi 4/5 and ARM32/ARM64; checks storage and Docker; and asks
before installing Docker if missing. Docker comes from its signed apt repository.
Both architectures use Docker's signed Debian repository, following
[Docker's Pi OS guidance](https://docs.docker.com/engine/install/raspberry-pi-os/).
ARM32 uses armhf packages and ARM64 uses arm64 packages. OS and apt package availability still determine
which Docker version is installed; Docker Engine itself is not version-pinned.

Enter each camera's name, reserved IPv4 address, RTSP username and password.
Passwords are hidden. Choose Add another until the list is complete, review the
summary and save. See [configuration](../docs/CONFIGURATION.md) for details.

When prompted for server settings, confirm this Pi's IPv4 address and choose a
unique friendly name. Defaults are HTTP 80, diagnostic HTTP 18765, WebRTC 18555.
Port 80 must be available; the installer must not displace another application.

It then installs Avahi name support, the CLI and desktop entries, builds the web
image, generates private go2rtc configuration and starts only
`wyze-monitor-rpi`. It retains existing cameras.yaml on ordinary reruns.

## 5. Open and verify

Open **http://wyze-monitor.local** on the same LAN, or the friendly name you chose.
If mDNS is unavailable, use `http://YOUR_PI_IP:18765`.

On Desktop, double-click **Wyze Monitor**, or find it in the application menu.
If the desktop asks whether to trust the launcher, inspect the installed launcher
and allow it. The launcher uses the default browser.

Over SSH:

```bash
wyze-monitor
wyze-monitor status
wyze-monitor url
```

With no argument, the CLI starts services if necessary and prints the URL.
It does not open a remote browser over SSH. `wyze-monitor open` opens a browser
when a graphical session is available.

Check each camera visually; a successful health response alone is insufficient.

## Installed components

| Location | Purpose |
|---|---|
| Project/cameras.yaml | Private camera list, mode 600 |
| Project/raspberry-pi/.env | Private deployment values, mode 600 |
| Project/raspberry-pi/runtime/go2rtc.yaml | Generated stream credentials |
| /usr/local/bin/wyze-monitor | Symlink into your project |
| /usr/local/share/applications/wyze-monitor.desktop | Menu launcher |
| /usr/local/share/icons/hicolor/scalable/apps/wyze-monitor.svg | Icon |
| /usr/local/lib/wyze-monitor/publish-friendly-url.sh | Name publisher |
| /etc/default/wyze-monitor-url | Publisher name configuration |
| /etc/systemd/system/wyze-monitor-url.service | Dedicated systemd service |

Keep the project at its installed path: the CLI symlink and Docker bind mounts
depend on it. The monitor runtime is containerized. Docker and Avahi are host
prerequisites and may be shared with other applications.

## Reboot and coexistence

Containers use restart-unless-stopped and the publisher service is enabled at
boot. Verify a reboot on your own OS; it is not certified across the entire matrix.
Services deliberately stopped with `wyze-monitor stop` may need
`wyze-monitor` to start them again.

A separate existing Docker application can coexist if ports and resources are
available. Do not change its configuration. The Pi 5 historical coexistence test
did not require a particular companion application.
Only one monitor Compose deployment per host is supported by these fixed project,
network, CLI and service names. Two different Pis can run monitors using different
friendly names.

## Installer options

| Option | Meaning |
|---|---|
| --dry-run | Read-only prerequisite check |
| --configure | Replace camera list through wizard (backup created) |
| --skip-camera-check | Allow configuration without reachability check |
| --install-docker | Request signed-repository Docker installation when missing |
| --pi4 / --pi5 | Override detected profile; normally unnecessary |
| --yes | Accept installation defaults/confirmations; camera input still required |

`setup.sh pi4` or `setup.sh pi5` is the low-level deploy command for an existing
camera configuration. Prefer `install.sh` for first installation and launchers.

Next: [configuration](../docs/CONFIGURATION.md),
[operations and restore](../docs/OPERATIONS.md),
[troubleshooting](../docs/TROUBLESHOOTING.md),
[compatibility](COMPATIBILITY.md).
