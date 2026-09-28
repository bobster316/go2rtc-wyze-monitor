# Camera and application configuration

## 1. Prepare each camera

This project was developed against Wyze Cam v4 native RTSP/RTSPS. Other models
and firmware may use different stream paths and are not certified.

Wyze's [27 July 2026 v4 beta announcement](https://forums.wyze.com/t/wyze-cam-v4-firmware-beta-test-7-27-2026/344026/1)
lists RTSP support in firmware `4.52.17.10`. This is a historical compatibility
reference, not a promise that this exact beta is still offered to your account.
Check Wyze's current release instructions for your exact camera and app version.

1. In the Wyze app, open the camera's settings and check its firmware version.
2. Look under Advanced Settings for RTSP. If absent, consult the model-specific
   Wyze beta/release instructions. Installing this monitor cannot add that option.
3. Follow Wyze's supported installation/update route for that model.
4. Enable RTSP and choose a separate camera username and password. Record the
   generated address privately.
5. Reserve the camera's LAN IPv4 address using your router's DHCP settings.
6. Repeat for each camera.

Do not apply v2/v3/Pan recovery filenames or flashing instructions to a v4.
Wyze's [older RTSP support article](https://support.wyze.com/hc/en-us/articles/360026245231-Wyze-Cam-RTSP)
covers those earlier models and is not a v4 flashing recipe. Obtain any firmware
directly from Wyze. Check whether future firmware changes preserve RTSP before
updating; weigh beta limitations and security updates rather than disabling
updates indefinitely.

## 2. Camera wizard on Raspberry Pi

First install asks for each camera's name, IPv4 address, username and password,
then asks whether to add another. Password entry is hidden. The wizard creates
a unique lowercase ID from the name and checks TCP port 322 reachability.
That check does not authenticate or prove that a video stream can be decoded.

To replace the camera list later:

```bash
wyze-monitor configure
```

This backs up an existing camera file before replacing it and redeploys the monitor.
Redeployment restarts the monitor's two services; viewers briefly disconnect.
Enter all cameras you want to retain. The wizard is not an incremental editor.
For offline preparation, `./raspberry-pi/install.sh --skip-camera-check` skips
reachability checks. Use `--configure` with it to replace an existing list.

## 3. Manual cameras.yaml reference

Copy `cameras.example.yaml` to `cameras.yaml` on Windows, or edit the wizard-created
file on the Pi. This file is private and ignored by Git. Example with two cameras:

```yaml
ffmpeg: ffmpeg
defaultQuality: main
port: 322
tls: true
streams:
  main: stream0
  sub: stream1
cameras:
  - id: entrance
    name: Entrance
    ip: 192.168.1.10
    user: REPLACE_USER
    password: CHANGE_ME
  - id: garden
    name: Garden
    ip: 192.168.1.11
    user: REPLACE_USER
    password: CHANGE_ME
```

Replace both usernames and passwords. The generator rejects `CHANGE_ME`.

| Field | Default / meaning |
|---|---|
| `ffmpeg` | `ffmpeg` on PATH. Windows uses this for both camera stream-copy producers and native Electron MP4 conversion. It may be a forward-slash path without spaces, e.g. `C:/ffmpeg/bin/ffmpeg.exe`. Pi generation forces container FFmpeg. |
| `defaultQuality` | `main` (HD) or `sub` (Eco). Saved browser preference takes precedence. |
| `port` | Camera port, default `322`. Global for all cameras. |
| `tls` | `true` for RTSPS. Set `false` only if your camera provides plain RTSP, usually on 554. |
| `streams.main` | Main path, default `stream0`. Global. |
| `streams.sub` | Substream path, default `stream1`. Global. |
| `cameras[].id` | Unique lowercase letters, digits and underscores; becomes `ID_main` and `ID_sub`. |
| `cameras[].name` | Label shown in the dashboard. |
| `cameras[].ip` | Camera's reserved IPv4 address. |
| `cameras[].user` | RTSP username from that camera's settings. |
| `cameras[].password` | RTSP password, never a Wyze account password. |

Use spaces for YAML indentation. Quote values containing punctuation; inside
single quotes, represent a literal apostrophe with two apostrophes.
Do not percent-encode your password yourself; the URL generator does that.
Do not put an entire RTSP URL into the `ip` field. Mixed per-camera ports or
stream paths are not supported by this schema.

On the Pi, keep the file private:

```bash
chmod 600 cameras.yaml
./raspberry-pi/setup.sh pi4
```

Use `pi5` on a Pi 5. This regenerates private runtime configuration.
On Windows, close the application and restart it after editing.

The Windows Electron app saves native recordings under
`%USERPROFILE%\Downloads\Wyze Monitor`. The browser viewer does not have access
to this native save path and uses a WebM download fallback.

## 4. Pi server configuration

The installer writes `raspberry-pi/.env` (private, mode 600). The public
`.env.example` contains placeholders only.

```dotenv
PI_HOST_IP=192.168.1.100
FRIENDLY_HOSTNAME=wyze-monitor
FRIENDLY_HTTP_PORT=80
MONITOR_PUBLIC_PORT=18765
WEBRTC_PUBLIC_PORT=18555
DEFAULT_QUALITY=main
```

| Setting | Meaning |
|---|---|
| `PI_HOST_IP` | Reserved IPv4 address of this Pi, not a camera. Docker binds to it and WebRTC advertises it. |
| `FRIENDLY_HOSTNAME` | Name without `.local`; lowercase letters, digits and internal hyphens. |
| `FRIENDLY_HTTP_PORT` | Must be 80 for the installer-supported no-port friendly URL. |
| `MONITOR_PUBLIC_PORT` | Diagnostic HTTP port; 1024-65535. |
| `WEBRTC_PUBLIC_PORT` | TCP and UDP media port; 1024-65535; different from diagnostic HTTP. |
| `DEFAULT_QUALITY` | `main` recommended; `sub` explicitly selects lower resolution. |
| `ICON_VARIANT` | Optional. Browser-tab icon colour: `pi` (raspberry red) or `pi4` (leaf green). Defaults to `pi4` on the Pi 4 profile and `pi` otherwise, so several Pis on one LAN are easy to tell apart. |

The optional `PI_PROFILE` environment value can select `pi4` or `pi5` for the
launcher. Normally hardware detection handles this.

Setup also records `LOCAL_UID` and `LOCAL_GID` for container access to mode-600
camera files. These must match the normal login that owns the project. When
restoring onto another user's account, let setup recreate these values rather
than copying them from a different machine.

The normal installer requires port 80 to be free. If another service owns it,
do not stop that service just to install this app. Use a separate Pi or an
explicitly planned reverse-proxy deployment; that advanced variant is not supplied
as an automatic installation mode.

## 5. Friendly names and address changes

Only one host on a LAN can publish `wyze-monitor.local`. A second Pi should use,
for example, `wyze-monitor-pi5`. The installer checks for an existing name.

Avahi updates the published address, but Docker bindings and ICE candidates remain
tied to the saved `PI_HOST_IP`. Reserve the Pi's address. If it changes, update
`.env` and rerun the installer to regenerate and recreate the deployment.
See [recovery](OPERATIONS.md#recover-after-a-pi-ip-address-change).

To change the friendly name, edit `FRIENDLY_HOSTNAME` in `.env`, rerun
`./raspberry-pi/install.sh`, then restart the publisher:

```bash
sudo systemctl restart wyze-monitor-url
wyze-monitor url
```

`.local` discovery is normally limited to the same network segment. Use the
numeric diagnostic address if your network does not carry mDNS.

## 6. Network ports

| Purpose | Windows | Pi host |
|---|---|---|
| Dashboard | 127.0.0.1:8765 | Pi IPv4:80 and :18765 |
| Player signalling | 127.0.0.1:1984/api/ws | Dashboard /api/ws proxy |
| WebRTC media | :8555 TCP/UDP | Pi IPv4:18555 TCP/UDP |
| go2rtc management API | 127.0.0.1:1984 | Private Docker network only |
| Internal RTSP | 127.0.0.1:8554 | Loopback inside go2rtc container |
| Camera input | Outbound TCP 322 | Outbound TCP 322 |

The installer does not change firewall rules. If you use a host firewall, allow
only the needed dashboard and WebRTC ports from trusted clients. Do not forward
these ports through your internet router.
