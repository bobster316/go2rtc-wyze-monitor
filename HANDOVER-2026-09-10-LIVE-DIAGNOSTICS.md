# Wyze Monitor live diagnostics — 10 September 2026

## Latest state: all four cameras added and live

At the user's request, the three additional cameras saved in the Windows configuration were transferred privately and appended to the Pi configuration, preserving its existing Front camera and global stream settings. Cameras are now Front (192.168.1.133), Front Garden (192.168.1.154), Back Garden (192.168.1.183) and Office (192.168.1.57).

All six HD/Eco direct-camera tests for the three additions passed on the Pi, each decoding 60 frames. Private backups of cameras.yaml and generated go2rtc.yaml were stored in `/home/pi/wyze-monitor-private-backups`, directory mode 700 and files mode 600. The updated cameras.yaml is mode 600. Credentials were transferred through SSH stdin and never printed.

Passwordless sudo was available in this later session. The existing config-init image generated eight streams, and only the go2rtc and monitor-web services were recreated. Live `/api/health` reports go2rtc true, four cameras, all eight main/sub streams, ARM64, default main/HD. `/api/config` lists all four cameras.

A simultaneous Windows WebSocket/MSE capture of all four HD streams decoded H.264 at 2560 x 1440 without ffprobe errors: Front 396 frames, Front Garden 343, Back Garden 320, Office 310. These short samples verify concurrent media delivery, not sustained frame-rate guarantees or browser rendering. The previously deployed overlay layout fix remains in the existing web image. Refresh the dashboard to load the four-camera grid.

Private configuration is not committed. Diagnostic orchestration is in `../diagnostics/add-saved-cameras.cjs` and `../diagnostics/add-saved-cameras.py`; the configurable media probe is `scripts/probe-media.cjs`. Earlier one-camera state and sudo limitations below are historical.

## Later user verification and overlay fix

The user confirmed browser playback works and supplied a screenshot showing Eco at 640 x 360, WebRTC and Smooth30. Selecting HD improved the picture. The user is using Codex CLI and Chrome was not listed in its plugin menu; do not repeat instructions to find a desktop sidebar in the terminal.

A second screenshot shows the application's FPS/date badge covering the camera's burned-in timestamp at the bottom right. The local and Pi source CSS now places `.metrics` at `top: 46px` (below the resolution label) and `.focus-metrics` at `top: 18px`; the bottom positioning was removed. `git diff --check` passed. The Pi original is backed up at `/home/pi/go2rtc-wyze-monitor/src/styles.css.before-overlay-fix`.

The user ran `/home/pi/apply-monitor-overlay-fix.sh` through interactive SSH and reported completion. A subsequent HTTP fetch of the Pi's live `/styles.css` confirmed `.metrics` uses `top: 46px`, `.focus-metrics` uses `top: 18px`, and both old bottom positions are removed. The deployment is live. `/api/health` reports go2rtc true, one camera, both Front streams, ARM64 and default main quality. Browser layout after the fix has not been visually verified; refresh the dashboard to load it. The helper rebuilds/recreates only monitor-web with the Pi 4 Compose files.

## User direction

The user wants autonomous troubleshooting, including SSH work on the Pi and actual playback verification in the Windows browser. Do not ask the user to run camera tests or collect screenshots. Installing the needed browser plugin is authorized. Browser installation recovery must use the supported app flow.

## Verified live state

- Pi: `pi@192.168.1.93`, hostname `raspberrypi`, architecture `aarch64`.
- SSH works with `C:/Users/<you>/.ssh/id_ed25519_pi` and `IdentitiesOnly=yes`. The default key is rejected.
- Repository: `/home/pi/go2rtc-wyze-monitor`, HEAD `31df7bd`.
- Remote working tree has modifications to five Raspberry Pi shell scripts, consistent with the previous handover's line-ending repair. These were not changed during this diagnostic session.
- Dashboard health at `http://192.168.1.93:18765/api/health` reports go2rtc available, one camera, `front_main` and `front_sub`, ARM64, default main quality.
- The Pi account can read its private configuration and run `/usr/bin/ffmpeg` and Python with PyYAML. It is not in the Docker group. Direct Docker access is denied and `sudo -n` requires a password. No privilege settings were changed on the Pi.
- Windows and Pi Front settings match: username, password, IP, TLS, port 322, main path stream0 and sub path stream1. Secrets were compared in memory and not printed.

## Media tests passed

Windows connected to the dashboard WebSocket endpoint and requested MSE H.264 media from each stream. Short samples were held in memory and decoded with ffprobe; footage was not saved.

| Stream | WebSocket binary messages | Bytes | Resolution | Decoded frames |
| --- | ---: | ---: | --- | ---: |
| front_sub (Eco) | 252 | 305,515 | 640 x 360 | 251 |
| front_main (HD) | 255 | 2,585,358 | 2560 x 1440 | 254 |

Both reported H.264 and decoded without ffprobe errors. These are short functional samples, not frame-rate or long-term stability certification.

Direct FFmpeg tests on the Pi also decoded both camera paths successfully: 100 frames across approximately five seconds each, exit code 0, empty stderr. Credentials were loaded privately from cameras.yaml and URLs were redacted from error output.

The previous direct-camera failure was therefore not reproduced. No camera credentials, production code, container configuration or Pi service state were changed to obtain these successes. Browser WebRTC, visible playback, reconnection, and Smooth30 still require verification.

The previous handover's `consumers: null` snapshot does not establish a WebSocket or authentication root cause. Eco uses `/api/ws?src=front_sub`; HD uses `front_main`.

## Windows automation blocker repaired

Browser tooling and sandboxed commands initially failed before startup with `helper_unknown_error: setup refresh had errors`.

The sandbox log identified `SetNamedSecurityInfoW failed: 5` while applying the sandbox write ACL to `D:/Wyze-Cam-v4`. The folder belonged to Administrators; the user's inherited Modify permission did not include ChangePermissions.

An administrator-approved repair granted only the existing Windows user ChangePermissions on the workspace directory itself, with no inheritance. Existing permissions and owner were preserved. Browser tooling and normal sandboxed shell execution then started successfully.

Repair script: `../repair-browser-workspace-permissions.ps1`.
Original ACL: `../diagnostics/workspace-acl-before-browser-repair.sddl`.
Repair result: `../diagnostics/workspace-acl-repair-result.txt`.

## Remaining browser integration blocker

After the sandbox repair, browser discovery returned an empty list and `No browser is available`.

Official installation checks run outside the sandbox verified:

- Chrome is installed and running.
- ChatGPT Chrome Extension is installed and enabled in the Default profile, version `1.26.901.11451_0`.
- The native host manifest `C:/Users/<you>/AppData/Local/OpenAI/extension/com.openai.codexextension.json` is missing.
- Its HKCU Chrome NativeMessagingHosts registration is also missing.

The installed browser recovery instructions require reinstalling the Chrome plugin through this app's plugin UI and prohibit manually installing or repairing the native host. No callable plugin installation tool was exposed in this session. Do not claim browser playback was verified or substitute another browser-control implementation to bypass this recovery restriction.

Once the supported Chrome plugin connection is restored, use the browser skill to connect, inspect the dashboard, check HD and Eco playback, reconnection and focus mode with Smooth30 off, then verify Smooth30 separately. Read the selected browser's full documentation before controlling it. A persistent browser runtime was initialized, but no browser or tab binding was acquired.

## Privacy and remaining work

The earlier handover reports an exposed RTSP password. It was not rotated in this session. Keep camera configuration and generated URLs private. Do not publish diagnostic footage or credentials.

True wizard inline editing, double-entry password confirmation, LF enforcement and long-duration stability tests remain separate outstanding tasks.
