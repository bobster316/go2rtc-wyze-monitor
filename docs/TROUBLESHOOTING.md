# Troubleshooting

## Start with the right layer

1. Camera: RTSP enabled, reachable IP/port, correct camera credentials.
2. Server: go2rtc and monitor-web available.
3. Signalling/media: WebSocket and WebRTC connectivity.
4. Viewer: changing frames, correct quality, GPU capacity and Smooth30 state.
   Prefer the Windows Electron viewer when you need native MP4 recording.

A health response is not an end-to-end camera test.

## No RTSP option in the Wyze app

Use [camera preparation](CONFIGURATION.md#1-prepare-each-camera).
The v4 beta announcement and the older v2/v3/Pan RTSP support page describe
different firmware routes. Do not flash another model's image.
The application cannot add RTSP support to the camera.

## Pi: installer will not run

- Permission denied: `chmod +x raspberry-pi/*.sh raspberry-pi/wyze-monitor`.
- Bad interpreter / ^M: use the release ZIP or a Git checkout honoring .gitattributes;
  shell scripts must use LF line endings.
- Unsupported architecture: inspect both `uname -m` and
  `dpkg --print-architecture`.
- Insufficient storage: the preflight requires 2 GiB free.
- Docker inaccessible: check `sudo docker info` and
  `sudo docker compose version`; do not reinstall a working Docker deployment.
- Apt/image download failure: check DNS, internet access, system clock and the
  OS release's repository support.
- Private runtime directory permission failure: rerun setup as the same normal
  login that owns the project. Do not make credentials world-readable.

## Pi: port 80 already in use

```bash
sudo ss -ltnp
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Do not terminate unrelated services. The standard friendly-URL installer needs
port 80; use another Pi or plan a separate reverse-proxy configuration.

## Friendly URL does not resolve

Check the numeric diagnostic URL using your actual Pi address:

```bash
curl -fsS http://192.168.1.100:18765/api/health
systemctl status wyze-monitor-url --no-pager
systemctl status avahi-daemon --no-pager
```

If numeric HTTP works, check mDNS support, same-LAN connectivity and friendly-name
conflicts. Guest Wi-Fi and routed VLANs may block mDNS. Two servers cannot own the
same name. If the Pi IP changed, follow [address recovery](OPERATIONS.md#recover-after-a-pi-ip-address-change).

## Dashboard loads but every tile is black

Check `wyze-monitor status` and then `wyze-monitor logs` privately.
Verify camera addresses and credentials. Ensure the viewer can reach the Pi's
WebRTC TCP/UDP port (default 18555); the ICE candidate must contain the current
Pi address. Refresh the page after redeploying.

Disable Smooth30 to isolate GPU presentation problems. On Windows, try the
standalone Electron viewer first; it uses the same local stream path without
Chrome download restrictions. For remote Pi viewing, use a current desktop
Chrome/Chromium browser and inspect GPU acceleration.
MSE may be used as fallback; a working HTTP page alone does not prove WebRTC works.

## One tile is offline

Use per-camera Reconnect. Check the camera's Wi-Fi and DHCP reservation.
A successful TCP 322 check only proves the port is reachable, not that the
username/password or stream path is correct. Check the camera's RTSP settings.
After editing cameras.yaml, regenerate/redeploy on Pi or restart the Windows app.

## RTSPS timeout

Development testing found direct go2rtc RTSPS unreliable with these cameras.
Keep the generated FFmpeg exec sources, TCP transport and whitelist including
tcp,tls,rtsp. FFmpeg uses stream copy, not transcoding.

TLS-inspecting antivirus software on Windows may interfere. Check its logs and
camera-specific exceptions rather than disabling system protection globally.

## YAML and Windows path errors

Use spaces, not tabs. Quote passwords containing YAML punctuation.
Use forward slashes in ffmpeg paths, e.g. C:/ffmpeg/bin/ffmpeg.exe.
A path with spaces is not supported by the current unquoted exec command;
install FFmpeg on PATH or use a path without spaces.

Do not share cameras.yaml to request help. Make a separate sanitized example.

## Low FPS or frozen images

Turn Smooth30 off and inspect source cadence. Night mode can lower camera FPS.
Check Wi-Fi, browser visibility/throttling, decode capacity and Pi temperature.
Eco is a manual reduced-resolution option; it is never proof of full-resolution
performance. An OUT counter can continue while an input is stale.
See [performance limitations](PERFORMANCE.md).

## Windows: no startup or conflicting process

Run setup again and read its error. Check that node, npm and ffmpeg are on PATH.
If port 8765 or go2rtc ports are occupied, identify the owning application before
stopping anything. The app may reuse an existing go2rtc instance with an incompatible
configuration. Do not kill every FFmpeg or Electron process on the machine.

Local health check while the app runs:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/api/health
```

## Windows: recording problems

The Electron viewer converts recordings to H.264 MP4 with FFmpeg and saves them
under `%USERPROFILE%\Downloads\Wyze Monitor`. Check `ffmpeg -version` and make
sure that folder is writable. A browser viewer cannot reliably encode MP4; its
WebM fallback is intended for remote viewing only. Do not rename a WebM file to
`.mp4`, because the container and codec remain WebM.

## Useful Pi diagnostics

```bash
wyze-monitor status
curl -fsS http://192.168.1.100:18765/api/health
vcgencmd measure_temp
vcgencmd get_throttled
```

Substitute the Pi's configured LAN address in the curl command.
vcgencmd is only available on systems that provide it.

Before posting an issue, include your release, Pi model, OS architecture, browser,
camera count and sanitized error text. Remove credentials, full RTSP URLs,
private footage, keys, cookies and identifying camera labels.
