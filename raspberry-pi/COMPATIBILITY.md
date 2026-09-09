# Raspberry Pi 5 and Pi 4 Compatibility Contract

The final Wyze Monitor release must run on a Raspberry Pi 5 with any of these
Raspberry Pi OS combinations:

| Userland | Edition | Required behaviour |
|---|---|---|
| 64-bit (`arm64`/`aarch64`) | Lite | Headless server; dashboard viewed from another device |
| 64-bit (`arm64`/`aarch64`) | Desktop | Server plus supported local Chromium/kiosk display |
| 32-bit (`armhf`; kernel may report `armv7l` or `aarch64`) | Lite | Headless server; dashboard viewed from another device |
| 32-bit (`armhf`; kernel may report `armv7l` or `aarch64`) | Desktop | Server plus supported local Chromium/kiosk display |

## Non-negotiable application requirements

- Raspberry Pi 5 is the final certification target.
- Four Wyze Cam v4 cameras are visible simultaneously.
- Each output tile targets at least 30 displayed frames per second, day and night.
- Full 2560x1440 source resolution is retained; there is no silent resolution downgrade.
- Actual camera FPS, generated output FPS, stale input and missed deadlines are reported separately.
- Original camera packets remain available for recording/evidence and are never replaced by generated frames.
- Installation uses its own ports, network, paths and service names.
- No existing Docker project, host service, firewall rule or desktop configuration is changed without explicit approval.
- The release must work on a clean Pi without the unrelated Compose application; coexistence with the unrelated Compose application is a separate acceptance test.

## Architecture and packaging rules

- `node:22-bookworm-slim` must resolve natively to `arm64v8` or `arm32v7`.
- `alexxit/go2rtc` must resolve natively to `arm64` or `arm/v7`.
- Compose files must not hard-code `platform: linux/arm64`.
- Setup must verify `uname -m`, `dpkg --print-architecture`, available RAM, free storage,
  Docker/Compose versions, required ports and image architectures before starting.
- Raspberry Pi OS Lite is a server target. Local display on Lite requires a separately
  selected kiosk/browser package and must not be installed implicitly.
- Raspberry Pi OS Desktop is tested both with a remote browser and with local Chromium.

## Docker 32-bit lifecycle caveat

The development notes identify Docker Engine v28 as the last release with dedicated Raspberry Pi OS 32-bit
(`armhf`) packages. Docker Engine v29 and later require Debian `armhf` packages
for 32-bit ARMv7. The installer selects Debian armhf packages from the signed
repository. Engine packages currently follow that repository rather than a pinned
version; version-pinned OS package certification remains future work.

## Release acceptance matrix

Every row below must pass before the final package is described as universal:

| Test | ARM64 Lite | ARM64 Desktop | ARM32 Lite | ARM32 Desktop |
|---|:---:|:---:|:---:|:---:|
| Clean installation | Required | Required | Required | Required |
| Reboot/autostart | Required | Required | Required | Required |
| Four-camera live grid | Required | Required | Required | Required |
| Full-resolution backing frames | Required | Required | Required | Required |
| 30-minute 30 fps presentation soak | Remote viewer | Local and remote | Remote viewer | Local and remote |
| Thermal/undervoltage telemetry | Required | Required | Required | Required |
| Network interruption and recovery | Required | Required | Required | Required |
| Uninstall without host collateral | Required | Required | Required | Required |
| Coexistence with unrelated Compose project | Required | Required | Required | Required |

Passing on the current 64-bit `the Pi 5 test host` host validates only the ARM64 coexistence
column. ARM32 certification requires a separate 32-bit OS test image or storage device;
it cannot be inferred from a multi-architecture image manifest alone.

The Pi 4 Model B first-install and four-camera remote-viewer path has now passed
on a real `armhf` userland with an `aarch64` kernel. Full matrix certification
still requires the 30-minute soak, reboot, interruption/recovery and uninstall
tests listed above; a short live pass is not represented as universal certification.
