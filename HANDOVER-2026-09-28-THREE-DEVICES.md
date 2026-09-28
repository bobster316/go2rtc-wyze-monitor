# Three devices, one app — 28 September 2026

Wyze Monitor now runs on three machines, and each has its own icon colour
and its own Windows taskbar pin. This session also fixed the Pi installer
ZIP, updated the Pi 4 to the current version, and documented everything.
Both repos are committed and pushed.

Previous handover: [HANDOVER-2026-09-26-ICONS-AND-PI-VIEWER.md](HANDOVER-2026-09-26-ICONS-AND-PI-VIEWER.md)
(its "Follow-up (28 Sep)" section has the step-by-step detail of today's work).

## The three devices

| | Raspberry Pi 5 | Raspberry Pi 4 | Windows 11 PC |
|---|---|---|---|
| Icon colour | Raspberry red | Leaf green | Blue |
| Windows pin | Wyze Monitor Pi | Wyze Monitor Pi 4 | Wyze Camera Monitor |
| Taskbar app ID | `WyzeCameraMonitor.Pi` | `WyzeCameraMonitor.Pi4` | `WyzeCameraMonitor.Windows` |
| Address | `http://192.168.1.155:18765` | `http://192.168.1.93:18765`, `http://wyze-monitor.local` | local Electron app |
| Host / OS | `postizpi`, Pi OS 64-bit | `raspberrypi`, Pi OS / Debian 13 Trixie arm64, Pi 4 Model B Rev 1.5 4 GB | Windows 11 Pro |
| Other apps on it | Postiz, Temporal, others (must stay untouched) | none: Wyze Monitor only | many |
| Install type | Copy from the installer ZIP at `/home/pi/wyze-monitor-rpi`; its compose files are **patched locally** (no port 80, custom ports) and differ from the repo | Git checkout at `/home/pi/go2rtc-wyze-monitor` (detached HEAD) | The repo working tree `D:\Wyze-Cam-v4\go2rtc-wyze-monitor`; all three shortcuts run scripts from it |
| Code version | Files from `670a5d2` (26 Sep icons deploy) plus the 25 Sep timelapse deploy | `27ffbe6` (28 Sep) | `main` (current) |
| Docker access for `pi` | yes (in `docker` group) | yes (added 28 Sep) | n/a |
| sudo | needs password | needs password | n/a |
| SSH | `ssh pi@192.168.1.155` (PowerShell) | `ssh -i ~/.ssh/id_ed25519_pi pi@192.168.1.93` | n/a |
| Latest backup | `/home/pi/wyze-monitor-backup-20260926-103124` | `/home/pi/wyze-monitor-backup-20260928-093804` + image `wyze-monitor-rpi-web:backup-20260928-142502` | n/a |

All three were healthy at the end of the session: 4 cameras, 8 streams. On
the Pi 4, one frame was decoded from each camera after the update.

The Pi 5 does not need today's code. It shows red by default, and the only
Pi change since its last deploy is the `ICON_VARIANT` option.

Ports on both Pis bind to the LAN address only, so `curl 127.0.0.1:18765` on
a Pi fails. Use the LAN IP.

## What was done today

1. **Installer ZIP paths:** `build-pi-installer.ps1` (both repos) now writes
   `/` in ZIP entry names instead of `Compress-Archive`'s `\`. Tested with
   `unzip` on the Pi 5. Also `*.svg text eol=lf` in `.gitattributes`.
2. **Handover fixes and cleanup:** stale sections of the 26 Sep handover
   corrected; removed `tmp/timelapse-proto/` (163 MB), `.playwright-mcp/`,
   Playwright temp folders and the merged `feat/timelapse` branches.
3. **Pi 4 updated** from `9d20b76` (10 Sep) to current: timelapse,
   recordings and new icons. Method: git bundle from this PC (the repos are
   private, so the Pi cannot pull), then `raspberry-pi/setup.sh pi4`.
4. **Leaf-green Pi 4 colourway** (user's choice from red / green / black):
   `LEAF` theme in `generate-icons.py` → `assets/icons/pi4/`;
   `ICON_VARIANT` (`pi` | `pi4`) selects the favicon, and `compose.pi4.yaml`
   defaults it to `pi4`; `install.sh` installs the green launcher on a Pi 4.
   The user installed the green launcher icon on the Pi 4 (`sudo install`).
5. **Pi 4 viewer on Windows:** `pi-viewer.js`, `start-pi-viewer.ps1` and
   `install-pi-viewer-shortcut.ps1` take a device (`pi` / `pi4`). Created
   `Wyze Monitor Pi 4.lnk` (Start menu + Desktop). The Pi 4 viewer uses its
   own `userData`, so it runs at the same time as the Pi 5 viewer. The
   existing Pi 5 and Windows shortcuts were not touched.
6. **Documentation:** new [docs/ICONS.md](docs/ICONS.md); Windows guide
   section "Open a Raspberry Pi dashboard from Windows"; `ICON_VARIANT` in
   CONFIGURATION.md and `.env.example`; Pi README icon notes; CHANGELOG
   "Unreleased" entry. Pi repo got the matching config and README changes.

Tests: 18/18 (Windows repo), 15/15 (Pi repo). The server test now checks
that `ICON_VARIANT=pi4` serves the green favicon.

Commits (all pushed): Windows repo `go2rtc-wyze-monitor` `main` up to
`ad2e2a8` plus this handover; Pi repo `wyze-pi-camera-dashboard` `master`
`284de2f`.

## Question: one repo per device?

The user asked whether each of the three versions should have its own repo.
**Recommendation: no. Go the other way, to one repo.**

- **Pi 4 and Pi 5 are the same app.** They differ only by a Compose profile
  (`compose.pi4.yaml` / `compose.pi5.yaml`) and the icon colour. Windows and
  the Pis already share the dashboard code (`src/renderer.*`, `styles.css`,
  timelapse). A repo per device would mean making every change three times.
- **Two repos already cost double work.** `wyze-pi-camera-dashboard` was
  created on 22 Sep as a Pi-only copy for the YouTube audience. 47 of its 56
  files are identical to the main repo and the other 9 differ in small ways
  (e.g. its red favicon is `src/favicon.svg`, not `src/favicon-pi.svg`).
  Today every Pi change (server, compose, installer, tests, docs) had to be
  made twice by hand, and the copies can drift apart.
- **The Pi-only package already exists:** the installer ZIP
  (`scripts/build-pi-installer.ps1`) is exactly the Pi subset of the main
  repo. Pi-only users can get that instead of a separate repo.
- **Now is the cheapest time to consolidate.** Both repos are private, so the
  links in the YouTube/TikTok descriptions already return 404 and must be
  changed anyway.

What stays "different per device" is **configuration**, which is where it
belongs: the Compose profile, `.env` (`ICON_VARIANT`, ports, address) and
the Windows shortcut (`-Device`, `-Url`).

**Decision needed from the user** (nothing has been changed yet):

1. Keep `go2rtc-wyze-monitor` as the single source of truth.
2. Retire `wyze-pi-camera-dashboard`: add a README pointing to the main repo,
   then archive it on GitHub (`gh repo archive`). Archiving is reversible.
3. Publish the Pi installer ZIP as a release of the main repo, and point the
   video descriptions at the main repo or the release, once it is made
   public again.

Alternative if a separate Pi repo is wanted for the video: generate it from
the main repo with a script and never edit it by hand.

### Planned iOS and Android apps (user, 28 Sep)

The user plans iOS and Android apps. This strengthens the one-repo case.

- Phones would be **viewers**, not hosts: they connect to go2rtc and the
  dashboard API on a Pi (or the PC), like the Windows Pi viewers. Phones
  cannot keep camera capture or timelapse running (iOS background limits).
  Product = hosts (Pi 4, Pi 5, Windows) + viewers (Windows, browser, iOS,
  Android).
- The apps depend on the host API (`/api/config`, `/api/health`,
  `/api/timelapse`, stream WebSocket). Keeping API and apps in one repo lets
  one change and its tests cover both. Suggested layout: `server/`, `web/`
  (shared UI), `windows/` (Electron), `mobile/`.
- Already in place: iOS and Android icon sets (`assets/icons/apple`,
  `assets/icons/android`); per-device colours can label hosts in the app.

Decisions to make before building:

1. **App-store name.** Apple and Google reject third-party trademarks in app
   names or icons without permission. "Wyze Monitor" is risky in the
   stores; use a neutral name plus "works with Wyze Cam v4" in the
   description.
2. **Home-only or remote access.** Today everything is LAN-only with no
   login. Remote viewing needs secure access (e.g. Tailscale or a relay) and
   authentication on the dashboard. This is the largest piece of work.
3. **Technology.** Capacitor wrapper of the existing web UI (fastest, reuses
   the streaming code; risk of Apple "minimal functionality" rejection);
   React Native / Expo or Flutter (one codebase, native feel; leaning React
   Native + Expo, whose cloud build covers iOS); or fully native Swift +
   Kotlin (two codebases). **iOS builds need a Mac or a cloud build
   service**; the user is on Windows.
4. **Windows as a host for phones.** The Windows app listens on
   `127.0.0.1` only (`src/main.js`), so phones can reach the Pis but not
   the PC. Opening it to the LAN needs the same security review as the Pis.
5. Phone details: iOS local-network permission, cleartext `http://` on the
   LAN (iOS ATS local networking, Android network security config), and
   host discovery via mDNS (`wyze-monitor.local`) or manual address entry.

A tidy-up worth doing either way: make the Pi 5 a git checkout like the Pi 4,
with its port changes in `.env` / a local override file instead of patched
compose files. Both Pis could then be updated the same way.

## Open items

- **Repo decision** above.
- Pin the green **Wyze Monitor Pi 4** icon on the Windows taskbar, if not done
  yet (right-click → Pin to taskbar).
- CHANGELOG is under "Unreleased"; the app is still 1.3.0. Bump to 1.4.0 when
  releasing.
- GitHub releases for the installer ZIP: still waiting for the user's
  go-ahead (now private releases while the repos are private).
- Change the default Pi passwords (both Pis).
- Pi 4 leftover `src/styles.css.before-overlay-fix` (untracked, unused).
- From the timelapse handover: daylight-only capture and daily repeat; a full
  24 h capture on a Pi and timing the 4K render; checking night/IR detection
  on real footage.

## Updating each device

- **Windows:** it runs from the repo folder, so `git pull` there and restart
  the app. Pi viewer shortcuts: `scripts\install-pi-viewer-shortcut.ps1
  [-Device pi4] [-Url ...]`. Never change the app ID on a pinned shortcut.
- **Pi 4:** from this PC, `git bundle create tmp/pi4-update.bundle <pi4 HEAD>..main`,
  copy it to `/tmp`, then on the Pi `git fetch /tmp/pi4-update.bundle
  main:refs/remotes/bundle/main && git checkout --detach bundle/main`. Then
  either `raspberry-pi/setup.sh pi4` (restarts go2rtc too) or, for dashboard
  only changes, `docker compose -f compose.yaml -f compose.pi4.yaml up -d
  --build --no-deps monitor-web` in `raspberry-pi/`. Scripts:
  `tmp/deploy-pi4-update.sh` (local, gitignored).
- **Pi 5:** copy changed files from a pushed commit (`git archive`), back up,
  rebuild `monitor-web` only (`tmp/deploy-pi5-icons.sh`). Do not touch
  Postiz or the other containers. Check `/api/timelapse` has no running job
  before recreating the container.
