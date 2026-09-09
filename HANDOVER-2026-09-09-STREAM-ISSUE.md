# Wyze Monitor handover — 9 September 2026

Prepared 9 September 2026. This handover covers the fresh Raspberry Pi 4 rebuild and the remaining Front camera WebRTC issue.

## Privacy

No password, private key, or complete credential-bearing URL is included here. An RTSP password was exposed during troubleshooting and must be changed in Wyze after testing. Never commit cameras.yaml, .env, generated go2rtc files, or real credentials.

## Project

Wyze Monitor is a local dashboard for cameras that already provide RTSP/RTSPS. The path is camera -> local RTSP/RTSPS -> FFmpeg stream copy -> go2rtc -> WebRTC -> browser. It does not require a Wyze account password or API key, does not use Wyze Bridge, and does not transcode video.

Public repository: https://github.com/bobster316/go2rtc-wyze-monitor

Recent public commits include the from-scratch guide (`ce0315b`), README hero image (`4ace4b1`), and restored valid camera wizard (`31df7bd`). The hero image is `assets/wyze-monitor-four-camera-hero.png`.

## Current Pi

- Raspberry Pi 4 Model B Rev 1.5, 4 GB.
- Raspberry Pi OS/Debian 13 (trixie), ARM64 userspace, aarch64 kernel.
- Kernel 6.18.34+rpt-rpi-v8.
- LAN address 192.168.1.93.
- Docker Engine 29.8.0 and Compose v5.5.1.
- Repository: /home/pi/go2rtc-wyze-monitor.
- Approximately 49 GB free storage.
- No CPU/GPU overclock or voltage modification has been applied.

The previous SD card became unreachable after manual overclocking. This is a new card and should remain at stock settings until the system is stable.

## Installation

The Pi was synchronised to origin/main and installed with `./raspberry-pi/install.sh --configure`. Shell scripts arrived with Windows line endings once; the temporary Pi repair was `sed -i 's/\r$//' raspberry-pi/*.sh raspberry-pi/wyze-monitor`.

The two running services are `wyze-monitor-rpi-go2rtc-1` and `wyze-monitor-rpi-monitor-web-1`. The dashboard is available at http://192.168.1.93:18765 and http://wyze-monitor.local. The numeric URL is preferred for diagnostics.

Health currently reports go2rtc true, one camera, streams `front_main` and `front_sub`, and ARM64.

Useful commands are `wyze-monitor status`, `wyze-monitor logs`, and `wyze-monitor restart`.

## Camera configuration

Only the Front camera is configured on the Pi: ID `front`, name `Front`, IP `192.168.1.133`, RTSP user `Front`. Its password is stored locally and intentionally omitted. The Windows configuration contains four cameras, but only Front was selected for this rebuild.

Generated streams are `front_main` (stream0) and `front_sub` (stream1), using port 322 with TLS enabled.

## Current failure

The browser reports `MEDIA_ERR_SRC_NOT_SUPPORTED`, `Empty src attribute`, and Smooth30 timing out. The favicon 404 is harmless. go2rtc starts normally, but `/api/streams` reports both producers with `consumers: null`. This means the browser WebRTC consumer is not reaching go2rtc. Direct private FFmpeg tests from the Pi also failed for the supplied credential and both stream paths; the exact Windows working protocol/path/credential interpretation still needs comparison.

## Next steps

1. Use a new Chrome or Edge private window on the same LAN.
2. Open http://192.168.1.93:18765, disable Smooth30, choose Eco, click Reconnect and wait 15 seconds.
3. Run `sudo docker logs --since 2m wyze-monitor-rpi-go2rtc-1` and `sudo docker exec wyze-monitor-rpi-go2rtc-1 wget -qO- http://127.0.0.1:1984/api/streams`.
4. If consumers remains null, inspect the browser Network tab for `ws://192.168.1.93:18765/api/ws?src=front_main`; this indicates a WebSocket/browser issue rather than camera authentication.
5. If a consumer appears but video remains blank, compare the exact Windows protocol, port, path and credential handling.
6. After video works, change the exposed RTSP password in Wyze and rerun `./raspberry-pi/install.sh --configure`, then `wyze-monitor restart`.

## Outstanding improvements

The wizard safely cancels with Ctrl+C and shows a hidden-password summary, but it still needs true numbered inline editing and double-entry hidden password confirmation. The repository should also enforce LF endings for shell scripts and run `bash -n` in CI from a fresh Linux checkout.
