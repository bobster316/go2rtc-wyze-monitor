# Project handover for Codex — Wyze Monitor — 28 September 2026

This is the complete handover of the Wyze Monitor project from Claude Code to
Codex. It is self-contained: read this file first, then the detailed
handovers it links to when you need history.

Everything described here is committed and pushed. There is **no
uncommitted code**. The work in progress (timelapse improvements, section 9)
has investigation results but no code changes yet.

---

## 1. What the product is

A local, multi-camera dashboard for **Wyze Cam v4 cameras running RTSP
firmware**. No Wyze account, no cloud, no subscription.

- **go2rtc** pulls each camera's RTSP(S) stream and re-serves it (WebRTC/MSE
  to viewers, RTSP on a private network for timelapse capture).
- A small **Node.js web server** serves the dashboard UI and a JSON API.
- The **dashboard UI** (plain HTML/CSS/JS, no framework) shows a grid of
  cameras, a focus view, HD/Eco quality, "Smooth30" browser-side frame
  smoothing, MP4 recording and full-resolution **timelapse**.

It runs as three kinds of install:

| Install | How it runs |
|---|---|
| **Windows 11 desktop app** | Electron (`src/main.js`) starts go2rtc and a loopback HTTP server, opens the dashboard in its own window |
| **Raspberry Pi 4 / Pi 5 server** | Docker Compose: `go2rtc` + `monitor-web` (Node, `raspberry-pi/server.js`); viewed from any browser on the LAN |
| **Windows "Pi viewer"** | A tiny Electron window (`src/pi-viewer.js`) that opens a Pi's dashboard, with that Pi's icon and taskbar pin |

The owner has **4 cameras**: `front`, `front_garden` ("Front Garden"),
`back_garden` ("Back Garden"), `office`. Each has `<id>_main`
(2560x1440, 20 fps, H.264 High, keyframe every 2.0 s) and `<id>_sub`
streams in go2rtc. The product must never assume 4 cameras (users can add
more).

---

## 2. Repositories

Both are GitHub repos owned by `bobster316`, **private since 26 Sep 2026**.

| Repo | Local path | Branch | Head at handover | Purpose |
|---|---|---|---|---|
| `go2rtc-wyze-monitor` | `D:\Wyze-Cam-v4\go2rtc-wyze-monitor` | `main` | this commit | **Main repo**: Windows app + Pi server + docs + icons. Source of truth. |
| `wyze-pi-camera-dashboard` | `D:\Wyze-Cam-v4\wyze-pi-camera-dashboard` | `master` | `284de2f` | Pi-only copy made on 22 Sep for a YouTube audience |

The Pi repo is a near-duplicate: 47 of its 56 files are byte-identical to
the main repo; 9 differ slightly (`.gitignore`, `README.md`,
`docs/ARCHITECTURE.md`, `package.json`, `package-lock.json`,
`raspberry-pi/server.js`, `scripts/build-pi-installer.ps1`,
`src/favicon.svg`, `tests/server.test.js`). Notable difference: its red
favicon is `src/favicon.svg`, where the main repo uses `src/favicon-pi.svg`
(its `src/favicon.svg` is the Windows blue one).

**Until the owner decides otherwise, every Pi-side change must be made in
both repos** (server, compose, install scripts, tests, Pi docs). The
recommendation (section 11) is to consolidate onto the main repo.

Other folders in `D:\Wyze-Cam-v4` are not code for this app: YouTube video
projects (`wyze-pi-youtube-video`, `wyze-pi5-youtube-video`,
`wyze-v4-youtube-video`), `diagnostics`, `docs`, `output`, `tmp`, and older
handovers (`HANDOVER.md`, `HANDOVER-2026-09-22-...`).

The working directory is **not** itself a git repo; each subfolder is.

---

## 3. The three devices (live)

| | Raspberry Pi 5 | Raspberry Pi 4 | Windows 11 PC |
|---|---|---|---|
| Icon colour | raspberry red | leaf green | blue |
| Address | `http://192.168.1.155:18765` | `http://192.168.1.93:18765` and `http://192.168.1.93` / `http://wyze-monitor.local` | local app |
| Hostname / OS | `postizpi`, Raspberry Pi OS 64-bit | `raspberrypi`, Pi OS / Debian 13 Trixie, arm64, Pi 4 Model B Rev 1.5, 4 GB | Windows 11 Pro |
| Disk | 917 GB NVMe, 845 GB free | 58 GB SD, 48 GB free | — |
| Other workloads | **Postiz, Temporal and other containers. Never touch them.** | none | many |
| Install type | Copied from the installer ZIP into `/home/pi/wyze-monitor-rpi`. Its compose files were **patched on the Pi** (no port 80, custom ports) and differ from the repo | Git checkout `/home/pi/go2rtc-wyze-monitor`, detached HEAD `27ffbe6` | The repo working tree itself |
| Compose project | `wyze-monitor-rpi` | `wyze-monitor-rpi` (`compose.yaml` + `compose.pi4.yaml`) | — |
| SSH | `ssh -i ~/.ssh/id_ed25519_pi pi@192.168.1.155` | `ssh -i ~/.ssh/id_ed25519_pi pi@192.168.1.93` | — |
| `pi` in `docker` group | yes | yes (since 28 Sep) | — |
| sudo | **password required** (ask the owner to run sudo commands) | **password required** | — |
| RTC battery | **none**: boots with the last saved time, then NTP jumps it (see 9.2) | none (Pi 4 has no RTC) | — |
| Latest backup | `/home/pi/wyze-monitor-backup-20260926-103124` | `/home/pi/wyze-monitor-backup-20260928-093804`, images `wyze-monitor-rpi-web:backup-20260928-093804` and `:backup-20260928-142502` | — |

Ports on the Pis bind to the Pi's LAN IP only. `curl 127.0.0.1:18765` on a
Pi fails; use the LAN IP. go2rtc API `1984` and RTSP `8554` are only on the
private Docker network. WebRTC media uses TCP/UDP `18555`.

Windows shortcuts (Start menu + Desktop), all running from the repo folder:

| Shortcut | Runs | App ID |
|---|---|---|
| Wyze Camera Monitor | `C:\Users\<you>\WyzeCameraMonitor\launchers\Open-Wyze-Monitor-Electron.ps1` → `scripts\start-windows.ps1` | `WyzeCameraMonitor.Windows` |
| Wyze Monitor Pi | `scripts\start-pi-viewer.ps1 -Url http://192.168.1.155:18765` | `WyzeCameraMonitor.Pi` |
| Wyze Monitor Pi 4 | `scripts\start-pi-viewer.ps1 -Device pi4 -Url http://192.168.1.93:18765` | `WyzeCameraMonitor.Pi4` |

All three are pinned to the owner's taskbar. **Never change the app ID of a
pinned shortcut**: Windows silently drops the pin (this happened once).

Secrets: camera IPs/users/passwords live only in `cameras.yaml` (repo root,
gitignored, mode 600 on Pis), generated `go2rtc/go2rtc.yaml` (Windows) and
`raspberry-pi/runtime/go2rtc.yaml` (Pi), and `raspberry-pi/.env` (Pi). None
are in git and none must ever be committed, logged, or baked into an image
(`.dockerignore` excludes them; keep it that way).

---

## 4. Architecture and file map (main repo)

```
lib/timelapse.js            948  TimelapseManager (capture + render) and the /api/timelapse HTTP handler. Shared by Windows and Pi.
src/main.js                 354  Electron main (Windows): starts go2rtc.exe, loopback HTTP server on 127.0.0.1, recording (FFmpeg MP4), timelapse, notifications, power-save blocker.
src/pi-viewer.js             80  Electron window for a Pi dashboard. DEVICES = { pi: Pi 5, pi4: Pi 4 } (name, appId, icon, url).
src/preload.js                6  contextBridge for native recording save.
src/renderer.html/.js   178/621  Dashboard UI: grid, focus, quality, reconnect, record.
src/smooth30.js             234  Browser-side 30 fps presentation smoothing.
src/timelapse-ui.js         583  Timelapse toolbar menu + docked setup panel (separate module so renderer.js tests stay untouched).
src/styles.css              544
src/vendor/video-rtc.js     587  go2rtc's WebRTC/MSE player (vendored).
src/favicon*.svg                 favicon.svg = Windows blue, favicon-pi.svg = red, favicon-pi4.svg = green.
raspberry-pi/server.js      163  Pi web server: static files, /api/config, /api/health, recordings, /api/timelapse. Favicon chosen by ICON_VARIANT.
raspberry-pi/recordings.js   83  Pi-side WebM→MP4 conversion.
raspberry-pi/compose.yaml    70  config-init (generates go2rtc.yaml), go2rtc (alexxit/go2rtc:1.9.14), monitor-web. Volumes: recording-tmp, timelapses.
raspberry-pi/compose.pi4.yaml / compose.pi5.yaml   per-model overrides (Pi 4: DEFAULT_QUALITY main, ICON_VARIANT pi4).
raspberry-pi/Dockerfile      15  node:22-bookworm-slim + ffmpeg + fonts-dejavu-core.
raspberry-pi/install.sh     284  First-run installer (detects Pi 4/5, Docker, launchers, friendly .local name).
raspberry-pi/setup.sh        73  Low-level deploy: build, run config-init, force-recreate go2rtc + monitor-web.
raspberry-pi/configure.sh   165  Camera configuration wizard.
raspberry-pi/wyze-monitor   114  CLI (url/open/start...).
raspberry-pi/generate-go2rtc-config.js    go2rtc config for the Pi (rtsp listen :8554 on the private network).
scripts/generate-go2rtc-config.js         shared config builder (Windows + Pi).
scripts/setup.ps1                         Windows setup: downloads pinned go2rtc, npm ci, config.
scripts/build-pi-installer.ps1            Builds output/wyze-monitor-rpi-installer.zip (+ .sha256) from an allowlist. Writes '/' entry names (fixed 28 Sep).
scripts/start-windows.ps1 / start-pi-viewer.ps1 / install-pi-viewer-shortcut.ps1   Windows launchers; they clear NODE_OPTIONS.
scripts/icons/generate-icons.py           Icon system generator (needs Pillow + Chrome/Edge). Themes BLUE, RASPBERRY, LEAF.
scripts/icons/set-shortcut-app-id.ps1     Stamps System.AppUserModel.ID onto .lnk files.
assets/icons/{windows,pi,pi4,apple,android}/   generated icon sets.
tests/*.test.js                           node:test; 18 tests (main repo), 15 (Pi repo).
docs/                                     user docs; TIMELAPSE.md, WINDOWS.md, CONFIGURATION.md, ICONS.md are the most recent.
.github/workflows/validate.yml            CI validation.
```

### Timelapse engine (the area you will work in)

- **Capture**: one FFmpeg per camera reading `rtsp://<go2rtc>:8554/<cam>_main`
  with `-skip_frame nokey` (keyframes only, every 2 s), a `select` filter
  keeping one keyframe per interval, MJPEG q2 to stdout, split on JPEG EOI.
  Frames are filed as `frames/<cam>/<slot>.jpg`, where
  `slot = round((now - startedAt) / interval)`, so all cameras' frame N is
  the same moment.
- A **watchdog** kills a camera's FFmpeg if no frame arrives for
  `max(45 s, 2 × interval + 20 s)`; it restarts with back-off
  (2 s × 2^(restarts−1), capped at 60 s; `restarts` resets on each frame).
- **Disk guard** stops captures below 2 GB free.
- **Scheduler**: `tick()` runs every second via `setInterval`; starts
  scheduled jobs, finishes captures at `endAt`, resumes captures after a
  restart.
- **Render**: concat demuxer with real capture spacing → deflicker → scale/pad
  → labels → xstack grid → tmix 1-2-1 → optional clock → libx264 High CRF 18,
  maxrate 80M (grid) / 50M (single), `+faststart`. One render at a time.
  Pi: preset `medium`, cores−1 threads, lowest priority. A camera that missed
  a slot **holds its previous frame** in the grid.
- **Night skip** (render option `skipNight`): ffmpeg `signalstats` SATAVG per
  frame; `< 4` (constant `NIGHT_SATURATION`) = IR/monochrome; a grid step is
  dropped if most cameras are night.
- Storage: Windows frames `%LOCALAPPDATA%\Wyze Monitor\Timelapse frames\<id>`,
  videos `Downloads\Wyze Monitor\Timelapses`. Pi: Docker volume
  `wyze-monitor-rpi_timelapses` at `/timelapses/<id>/{job.json,frames,output}`.
- Limits: 24 h per job, interval 2–600 s, schedule up to 7 days ahead,
  fps 24/25/30/60.
- API: `GET/POST /api/timelapse`, `GET/DELETE /api/timelapse/<id>`,
  `POST .../stop|render|prune`, `GET .../preview/<cam>`, `GET .../files/<name>[?download]`.
  Mutations must be same-origin JSON.

Full design notes: [HANDOVER-2026-09-25-TIMELAPSE.md](HANDOVER-2026-09-25-TIMELAPSE.md)
and [docs/TIMELAPSE.md](docs/TIMELAPSE.md).

---

## 5. How to run, test, build

Windows (PowerShell). **Always clear `NODE_OPTIONS` first**: this machine has
`NODE_OPTIONS=--use-system-ca`, which makes Electron exit immediately.

```powershell
cd D:\Wyze-Cam-v4\go2rtc-wyze-monitor
$env:NODE_OPTIONS = ''
npm test                      # 18 tests; Pi repo: 15
npm start                     # Windows app (or use the shortcut)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-pi-installer.ps1
python scripts\icons\generate-icons.py      # only after an icon design change
```

Windows PowerShell 5.1 notes: `Set-Content`/`Get-Content -Raw` without
`-Encoding UTF8` has corrupted UTF-8 in these Markdown files before
(`—` → `â€”`). Edit Markdown with an editor or write UTF-8 explicitly.

---

## 6. How to deploy

**Pi 4** (git checkout; repo is private so the Pi cannot pull):

```bash
# on Windows (Git Bash), from go2rtc-wyze-monitor
git bundle create tmp/pi4-update.bundle <pi4-HEAD>..main
scp -i ~/.ssh/id_ed25519_pi tmp/pi4-update.bundle pi@192.168.1.93:/tmp/
# on the Pi 4
cd /home/pi/go2rtc-wyze-monitor
docker tag wyze-monitor-rpi-web:local wyze-monitor-rpi-web:backup-$(date +%Y%m%d-%H%M%S)
git fetch /tmp/pi4-update.bundle main:refs/remotes/bundle/main && git checkout --detach bundle/main
cd raspberry-pi
docker compose -f compose.yaml -f compose.pi4.yaml up -d --build --no-deps monitor-web   # dashboard-only change
# or: bash ./setup.sh pi4    # also regenerates go2rtc config and restarts go2rtc (cameras blip)
```

Full backup script used on 28 Sep: `tmp/deploy-pi4-update.sh` (local,
gitignored).

**Pi 5** (installer copy, patched compose; shares the host with Postiz):
back up, copy only changed files from a pushed commit (`git archive`), then
`docker compose -p wyze-monitor-rpi --env-file raspberry-pi/.env -f raspberry-pi/compose.yaml -f raspberry-pi/compose.pi5.yaml build monitor-web`
and `... up -d --no-deps monitor-web`. Script: `tmp/deploy-pi5-icons.sh`.
**Before recreating `monitor-web`, check `GET /api/timelapse` has no job in
`capturing`/`scheduled`/`rendering`.** Never run a Compose command that could
touch other projects. The Pi 5's compose files differ from the repo: do not
overwrite them with repo copies; patch them.

**Windows**: runs from the working tree; restart the app after changes.

**Verify after a deploy**: `GET /api/health` (4 cameras, 8 streams), the
favicon colour, `GET /api/timelapse` 200, and decode one frame per camera:

```bash
docker exec wyze-monitor-rpi-monitor-web-1 timeout 20 ffmpeg -v error -rtsp_transport tcp \
  -i rtsp://go2rtc:8554/front_sub -frames:v 1 -f null -
```

---

## 7. Owner preferences and conventions (keep these)

- The owner is not a developer. Explain in plain language, give exact
  commands, and use `!`-style copy-paste commands. They run sudo commands
  themselves. They have confused "Pi 4 terminal" and "Pi 5 terminal" before,
  so say which device and what the prompt should look like
  (`pi@raspberrypi` = Pi 4, `pi@postizpi` = Pi 5).
- Icons: **no text in icons**, never imply a fixed camera count, one mark
  for all platforms; Windows blue, Pi 5 red, Pi 4 leaf green. Do not imitate
  Wyze's own "W" logo. Details: [docs/ICONS.md](docs/ICONS.md).
- UI: the owner rejected the first timelapse UI as "terrible". Keep the
  docked panel, quiet styling, red only for recording states.
- Finished videos must land in **Downloads** (Windows) / download to the
  viewer's Downloads (Pi).
- Commits: conventional style (`feat:`, `fix:`, `docs:`), with a
  `Co-Authored-By` trailer. Commit and push when a piece of work is done and
  tested (the owner has accepted this throughout).
- **iOS/Android apps are planned but ON HOLD.** Do not work on them or let
  them drive decisions unless the owner raises them. Notes are in
  [HANDOVER-2026-09-28-THREE-DEVICES.md](HANDOVER-2026-09-28-THREE-DEVICES.md).
- British English in docs.

---

## 8. What happened recently (history)

| Date | Work | Handover |
|---|---|---|
| 9–14 Sep | Pi deployment, stream fixes, standalone Electron app, port conflict fix | `HANDOVER-2026-09-09*.md`, `-10-*`, `-14-*` |
| 20 Sep | Pi 5 feature parity, playback fix | `HANDOVER-2026-09-20-*.md` |
| 22 Sep | Pi-only repo created, marketing | `D:\Wyze-Cam-v4\HANDOVER-2026-09-22-2154-*.md` |
| 25 Sep | Timelapse feature (v1.3.0) | `HANDOVER-2026-09-25-TIMELAPSE.md` |
| 26 Sep | Icon system, Windows Pi viewer, repos made private | `HANDOVER-2026-09-26-ICONS-AND-PI-VIEWER.md` |
| 28 Sep | Installer ZIP path fix, Pi 4 updated to current, Pi 4 green icon + Windows Pi 4 viewer, docs | `HANDOVER-2026-09-28-THREE-DEVICES.md` |

---

## 9. Work in progress: timelapse improvements ("option 5")

The owner asked to implement the timelapse follow-ups and improvements on
**Pi 4, Pi 5 and Windows**:

- A. **Daylight-only capture** (sunrise to sunset) and **repeat daily**.
- B. **Long capture + 4K render test** (24 h capture; time the render).
- C. **Validate night/IR detection on real footage.**
- plus reliability improvements found while investigating (below).

No code has been written for this yet. The investigation results follow.

> **Update 29 Sep 2026 (Claude, commits `0f95122`, `ce47a49`, deployed to Pi 4,
> Pi 5 and Windows):** done: 9.2 item 1 (tick guard, finish-once, chained
> saves), 9.4 (night detection validated on the 27 Sep video: day SATAVG
> 10–16, dusk 5–9, IR 0–0.3; now a median of five frames). New: natural motion
> blur (keyframe averaging over half the interval), steady colour, 4K-for-YouTube
> option, recommended defaults (25 fps, skip night), intervals snapped to whole
> 2 s keyframes (odd intervals used to stutter). See CHANGELOG and
> docs/TIMELAPSE.md. Still open: 9.2 items 2–3 (clock jumps, gap log), 9.3,
> 9.5, 9.6.

### 9.1 Real-world evidence: the owner's own timelapses on the Pi 5

`GET http://192.168.1.155:18765/api/timelapse` lists two jobs the owner ran:

| Job | Cameras | Interval | Frames | Window |
|---|---|---|---|---|
| `tl-20260926-104949-3a4f` | front | 8 s | front 1796 | 26 Sep 10:49, 4 h, daytime |
| `tl-20260927-142531-b2aa` | front, front_garden | 16 s | **front 1753, front_garden 556** | 27 Sep 14:25 BST, 8 h (endAt 22:25 BST) |

Both are `ready` with frames pruned (tidy on). The 27 Sep video still exists:
`/timelapses/tl-20260927-142531-b2aa/output/timelapse-grid-2026-09-27-1425.mp4`
(3840x1080, 1753 frames, 58.4 s, 561 MB, inside the `monitor-web` container
on the Pi 5). It spans 14:25 to about 22:13 BST, so it **contains dusk and
real IR night footage** (sunset 27 Sep ≈ 18:50 BST).

A stray folder `tl-20260925-163028-a456` was seen once in `/timelapses` but
not in a second listing; it is not a listed job. Check whether `remove()`
can leave folders behind (it is not referenced by `job.json`).

### 9.2 Finding 1 — the 8-hour-late stop was a Pi 5 outage and clock jump (not a code bug), but exposes clock-handling gaps

Evidence (Pi 5 `docker logs --timestamps` of `monitor-web`, journal):

- Last log before the gap: 27 Sep 21:13:32 UTC (22:13 BST). Next: 28 Sep
  05:40:01 UTC (06:40 BST), where **both** cameras "stalled" at the same
  instant, a scheduler error was logged, and the render finished 05:49 UTC.
- Only one boot in the journal (volatile journal). Its first entry is
  "27 Sep 22:14:04 BST", but `uptime -s` says **06:39:26 28 Sep**. The kernel
  log shows `rpi-rtc: setting system clock to 1970-01-01T00:00:15` and
  `System time advanced to timestamp on /var/lib/systemd/timesync/clock:
  Sun 2026-09-27 22:14:03 BST`.
- Conclusion: the Pi 5 was **off from ~22:13 BST 27 Sep to ~06:39 BST 28
  Sep** (cause unknown — ask the owner: power cut?). With no RTC battery it
  booted believing it was 22:14, the container restarted and resumed the
  job, then NTP jumped the clock ~8.4 h forward, every watchdog fired, and
  `tick()` finished the job. Docker's `StartedAt 21:14Z` is the stale
  clock, not a real 21:14 restart.

Code issues this exposes (fix these):

1. **Overlapping `tick()` runs + shared temp file name → lost/failed
   `job.json` saves.** `setInterval(() => this.tick(), 1000)` does not wait
   for an async tick; a slow `finishCapture()` overlaps the next tick, and
   `save()` uses `${file}.${process.pid}.tmp`, identical for concurrent
   saves of the same job. Observed:
   `scheduler error ... ENOENT: rename '/timelapses/tl-20260927-142531-b2aa/job.json.7.tmp' -> '.../job.json'`.

   ```js
   // lib/timelapse.js — current
   this.timer = setInterval(() => this.tick(), 1000);
   ...
   async save(job) {
     const file = path.join(this.jobDir(job.id), 'job.json');
     await fsp.mkdir(path.dirname(file), { recursive: true });
     const temp = `${file}.${process.pid}.tmp`;
     await fsp.writeFile(temp, JSON.stringify(job, null, 2));
     await fsp.rename(temp, file);
   }
   ```

   Suggested fix: a `ticking` guard in `tick()` (skip if the previous tick is
   still running), a per-job `finishing` flag so `finishCapture()` cannot run
   twice, and a unique temp name (`${file}.${process.pid}.${counter}.tmp`)
   or a per-job save chain (`job._saving = (job._saving || Promise.resolve()).then(...)`,
   stripped from JSON).

2. **Wall-clock jumps.** Slots use `Date.now()`:
   `slot = round((now - job.capture.startedAt) / (intervalSec * 1000))`.
   A forward jump makes a gap (acceptable, becomes a cut); a **backward**
   jump makes `slot <= lastSlot`, silently dropping frames until the clock
   catches up. The watchdog also uses wall time, so a jump kills every
   camera. Suggested: detect jumps (compare `Date.now()` delta with
   `process.hrtime`/`performance.now()` delta each tick; if they differ by
   > 30 s, log it, reset `lastFrameAt` for all runtimes, and do not treat it
   as a stall); use a monotonic clock for the watchdog. Keep wall time for
   slot filing, as now.
3. **Resume after an outage when the job window already ended**: currently
   it resumes capture with the stale clock, then finishes. Fine, but log
   "capture interrupted from X to Y" in `job.capture.gaps` so the UI can say
   the video has a cut and why.
4. Recommend to the owner (hardware, no code): a **Raspberry Pi 5 RTC
   battery** (official part) so the clock survives power loss; the Pi 4
   cannot have one.

### 9.3 Finding 2 — `front_garden` lost two-thirds of its frames on 27 Sep (intermittent, not reproduced)

Evidence: 467 × "front_garden stalled; restarting capture" + "capture exited
(255); retry in 2s", about 126 per hour, continuously from 14:49 to 22:13
BST. Each FFmpeg run delivered **one frame** and then nothing until the
watchdog (52 s for a 16 s interval) killed it: 556 frames ≈ one per ~57 s
cycle. `front` was fine all day. The "retry in 2s" never grew, because
`restarts` resets whenever a frame arrives.

What was ruled out on 28 Sep:

- Keyframe spacing: all four cameras send a keyframe every **2.0 s**
  (ffprobe, `-skip_frame nokey`, 30 s sample).
- The exact capture command for `front_garden` and `front`, run in parallel
  for 75 s with a 16 s interval inside the Pi 5 `monitor-web` container:
  **both produced a frame every 16 s** (pts 0, 15.99, 31.98, 47.97, 63.96).
  So the filter and timestamps are fine; the failure is intermittent and
  was probably the camera/go2rtc stream (Wi-Fi, producer) on that day.
- go2rtc logs for 27 Sep show only a couple of producer warnings
  (`i/o timeout` at 18:52 UTC, `EOF` at 20:22 UTC) — inconclusive.

The user-visible effect: in the grid video, **front_garden's tile froze**
for most of the run (held frames), with no warning.

Improvements to make:

1. **Surface it**: record per-camera stall/restart counts and "frames vs
   expected" in `job.capture` and show a warning in the timelapse UI and the
   finished-job list ("Front Garden missed 69% of frames").
2. **Diagnose next time**: on a stall, log go2rtc's view of the stream
   (`GET http://<go2rtc>:1984/api/streams?src=<cam>_main` → producers,
   bytes received) and FFmpeg stderr, rate-limited.
3. **Recover better**: after 3 consecutive one-frame-then-stall cycles,
   try the next restart via a fresh go2rtc producer (e.g. request
   `?src=<cam>_main` with a new consumer after a longer back-off) or fall
   back to the `_sub` stream for that camera and mark those frames
   (lower resolution beats a frozen tile). Owner decision on the fallback.
4. **Render**: optionally mark long held-frame runs (e.g. a small "no
   signal" badge on the tile) instead of silently freezing it.

### 9.4 C — Validate night/IR detection on real footage (ready to run)

The 27 Sep video is real footage across dusk. Measure saturation per half
(left = front, right = front_garden, 1920x1080 each) on the Pi 5:

```bash
docker exec wyze-monitor-rpi-monitor-web-1 sh -c '
f=/timelapses/tl-20260927-142531-b2aa/output/timelapse-grid-2026-09-27-1425.mp4
for side in "0:0" "1920:0"; do
  ffmpeg -nostdin -hide_banner -i "$f" -vf "crop=1920:1080:${side},signalstats,metadata=mode=print:key=lavfi.signalstats.SATAVG" \
    -f null - 2>&1 | grep -oE "SATAVG=[0-9.]+" | awk -F= "{print NR, \$2}" > /tmp/sat-${side%%:*}.txt
done'
```

Frame N ≈ 14:25 BST + N × 16 s (frames are consecutive slots). Plot or
bucket SATAVG over time: daytime should be well above 4, IR night near 0,
and the dusk transition shows where the camera switches. Caveats: the
video has deflicker and tmix applied, so the transition is smeared by ±1
frame; front_garden has held frames. Confirm or tune `NIGHT_SATURATION = 4`
and consider hysteresis (require 3 consecutive night frames) so a single
dark/grey daytime frame is not dropped. For a clean test, run a new capture
across dusk with `tidy: false` so raw frames are kept:

```bash
curl -s -X POST http://192.168.1.155:18765/api/timelapse -H 'Content-Type: application/json' \
  -d '{"cameras":["front","front_garden","back_garden","office"],"intervalSec":30,
       "startAt": <epoch ms for 18:00 local>, "durationSec": 10800, "tzOffsetMinutes": 60,
       "render": {"tidy": false, "skipNight": false}}'
```

### 9.5 B — Long capture and render benchmark (not started)

Plan: 24 h at a 48 s interval = 1800 frames per camera (1 min at 30 fps).
To measure render time without waiting 24 h, capture 1 hour at a 2 s
interval (also 1800 frames per camera, real varying content), all four
cameras, grid, then time the render. Do this on the **Pi 5, Pi 4 and
Windows** and record: wall time, CPU temperature/throttling
(`vcgencmd measure_temp`, `vcgencmd get_throttled`), output size.
Disk: ~1800 × 4 × 0.9 MB ≈ 6.5 GB per run (Pi 4 has 48 GB free).
Expectations to test: the Pi 4 (Cortex-A72, no usable 4K H.264 encoder) will
be much slower than the Pi 5; the render must not starve live view (it runs
at nice 19 with cores−1 threads). If the Pi 4 is too slow, offer a
`TIMELAPSE_PRESET=faster` default on `compose.pi4.yaml` or a 1080p grid
option. Only then run one real 24 h capture.

### 9.6 A — Daylight-only and repeat-daily (design proposal, not started)

Proposed design (confirm with the owner before building the UI):

- `lib/sun.js`: NOAA sunrise/sunset calculation (no network), with tests
  for known dates/locations and polar edge cases.
- **Location setting** per host (latitude/longitude), stored in
  `<timelapse root>/settings.json`, editable in the timelapse panel.
  Browser geolocation is unavailable on plain `http://` LAN pages, so ask
  for coordinates or a town the owner types in (no online lookup needed if
  coordinates are entered). **Ask the owner for their location**; do not
  guess it.
- Job spec additions: `window: { type: 'daylight', sunriseOffsetMin, sunsetOffsetMin }`
  sets `startAt`/`endAt` from the sun times for that date.
- **Repeat daily**: a recurring "series" record that creates one normal job
  per day (so each day is a separate video and the 24 h limit still holds),
  with retention (keep last N days' videos) because 4K grids are ~600 MB
  per minute of video. Series survive restarts (store in `series.json`).
- UI (`src/timelapse-ui.js`): "Start: now / at a time / **at sunrise**",
  "Stop: after / when I stop / **at sunset**", "**Repeat every day**",
  plus a Series list with pause/delete. Keep the existing quiet style.
- Windows only captures while the app is open; say so in the UI for series.
- `skipNight` stays useful for the dusk transition minutes.

### 9.7 Suggested order

1. 9.2 fixes (tick guard, save race, clock-jump handling) + tests.
2. 9.3 surfacing of per-camera gaps + tests.
3. 9.4 night validation on the existing video; tune detection.
4. 9.5 render benchmark on all three devices.
5. 9.6 daylight + repeat daily (after the owner confirms design and gives
   their location).
6. Update `docs/TIMELAPSE.md`, CHANGELOG, both repos, deploy to Pi 4 and
   Pi 5 (check for running jobs first), test on Windows.

Tests: `tests/timelapse.test.js` runs the real `TimelapseManager` with real
FFmpeg (must be on PATH) and synthetic cameras from `lavfi` (`testsrc2`, plus
a `hue=s=0` monochrome "night IR" camera), a tiny canvas and a 0.2 s minimum
interval. `TimelapseManager` also accepts a `now` option, which the tests do
not use yet; inject it to test clock jumps and sunrise/sunset scheduling
without waiting. No real cameras in tests.

---

## 10. Other open items

- **Repo consolidation decision** (section 11).
- Pi 5 tidy-up: convert it to a git checkout like the Pi 4, with its port
  changes in `.env` / a local override, so both Pis update the same way.
- Version: CHANGELOG has an "Unreleased" section; app is 1.3.0. Bump to
  1.4.0 on release.
- GitHub releases of the installer ZIP: waiting on the owner (repos are
  private now).
- Public links in the YouTube/TikTok descriptions 404 since the repos went
  private (`wyze-v4-youtube-video/source/youtube-metadata.md`,
  `output/tiktok/TIKTOK-METADATA.md`, `scripts/build.py`).
- Change the default Pi passwords (both Pis) — owner action.
- Pi 4 has an untracked leftover `src/styles.css.before-overlay-fix` (unused).
- Unverified: Windows timelapse-ready notification click behaviour.

## 11. Recommendation on repositories

One repo (`go2rtc-wyze-monitor`) for everything; the three installs differ
by configuration (Compose profile, `.env` `ICON_VARIANT`/ports, Windows
shortcut `-Device`/`-Url`), not code. Retire `wyze-pi-camera-dashboard`
(pointer README, then `gh repo archive`, reversible) and ship the Pi-only
package as the installer ZIP release. **Not done: the owner has not
decided.** Do not archive or delete anything without explicit approval.

## 12. Safety rules learned the hard way

- Never change a pinned shortcut's AppUserModelID.
- Never recreate `monitor-web` during a capture/render; check the API first.
- Never touch non-Wyze containers on the Pi 5.
- Never copy repo compose files over the Pi 5's patched ones.
- Keep secrets out of git, logs, images and the installer ZIP (the build
  script's allowlist and `.dockerignore` enforce this; audit the ZIP after
  changes).
- Do not use `-WindowStyle Hidden` on the Electron `Start-Process` (hides the
  window); the shortcut already hides PowerShell.
- The Bash tool strips backslashes in heredocs; test FFmpeg filter escaping
  from a file.
