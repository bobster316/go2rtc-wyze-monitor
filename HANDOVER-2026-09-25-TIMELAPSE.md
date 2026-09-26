# Timelapse feature — 25 September 2026

Full-resolution timelapse for the Windows app and the Raspberry Pi 5
dashboard. Built, live-tested against the four real cameras, deployed to the
Pi 5, committed and pushed to both GitHub repositories.

User-facing guide: [docs/TIMELAPSE.md](docs/TIMELAPSE.md).

## Status

| Item | State |
|---|---|
| Windows app (`go2rtc-wyze-monitor`) | Done, user-tested, v1.3.0 |
| Pi 5 at `192.168.1.155:18765` | Deployed and verified |
| `go2rtc-wyze-monitor` repo | Pushed to `main`, `d32c116` |
| `wyze-pi-camera-dashboard` repo | Pushed to `master`, `00a29bf`, v1.1.0 |
| Pi installer ZIP | Rebuilt locally, not uploaded |
| GitHub releases | Not published (user not yet asked/answered) |
| Tests | 18/18 (Windows repo), 15/15 (Pi repo) |

## What the user asked for, and the decisions made

- Timelapse of all four cameras or any selection, up to 24 hours, highest
  resolution, started/stopped manually or for a set period, and it must look
  good.
- User chose (AskUserQuestion):
  - **Toolbar drop-down + docked setup panel** (not panel only, not drop-down only).
  - **3 cameras: one large + two small** tiles. Note: this is 3840×1440, not
    3840×2160; 16:9 tiles cannot fill 16:9 without gaps. The user was told.
  - **Ready notification** and **auto tidy-up** of frames. Not chosen:
    daylight-only (sunrise/sunset) and repeat-daily. These remain good
    candidates for a next step.
- Downloaded/finished videos must go to the **Downloads** folder.
- Playback must show the same cameras that were selected (grid contains
  exactly the selected cameras).
- The user was unhappy with the first UI ("looks terrible", "messed everything
  up"). Fixed by docking the panel beside the grid, one quiet selection style,
  red only for recording states, and fixing the toolbar font bug below.

## Architecture

Capture and render run **server-side**, never in the browser:

- Windows: in the Electron main process (`src/main.js`).
- Pi: in the `monitor-web` container (`raspberry-pi/server.js`), so it runs
  with no browser open and resumes after restarts.

Shared code: `lib/timelapse.js` (`TimelapseManager` + HTTP handler under
`/api/timelapse`). UI: `src/timelapse-ui.js` (separate module so
`src/renderer.js` and its vm-based tests are untouched).

Capture: one FFmpeg per camera reading `rtsp://<go2rtc>:8554/<cam>_main`,
`-skip_frame nokey` (keyframes every ~2 s), select filter per interval, MJPEG
q2 over stdout, split on JPEG EOI, filed as `frames/<cam>/<slot>.jpg` where
slot = round(elapsed / interval). Watchdog restarts stalled cameras; disk
guard stops below 2 GB free.

Render: concat demuxer with real capture spacing (so the clock overlay shows
true time) → deflicker → scale/pad/labels → xstack → tmix 1-2-1 → drawtext
clock → libx264 High CRF 18, maxrate 80M (grid) / 50M (single), faststart.
Single render queue. Pi: preset `medium`, cores−1 threads, nice 19.

FFmpeg filter escaping is two-level (option parser, then graph parser); see
`escapeOption`/`escapeGraph` in `lib/timelapse.js`. The Bash tool strips
backslashes from heredocs, so test escaping from a file, not inline shell.

## File locations

| | Windows | Pi |
|---|---|---|
| Finished videos | `Downloads\Wyze Monitor\Timelapses` | Docker volume `wyze-monitor-rpi_timelapses`, `/timelapses` |
| Frames and `job.json` | `%LOCALAPPDATA%\Wyze Monitor\Timelapse frames\<id>` | same volume |
| Overlay font | Segoe UI Bold | DejaVu Sans Bold (`fonts-dejavu-core`) |

Windows "Remove" never deletes videos from Downloads. The app deletes
permanently (`fs.rm`), never via the Recycle Bin.

## Pi 5 deployment (25 Sep, ~17:49)

- SSH: `ssh -i ~/.ssh/id_ed25519_pi pi@192.168.1.155` (plain key auth fails).
- Script: `tmp/deploy-pi5-timelapse.sh` (local, gitignored). It patches the
  Pi's own `raspberry-pi/compose.yaml` in place (the Pi's file differs from the
  repo: no port 80, custom ports). Added: go2rtc `expose: "8554"`,
  `TIMELAPSE_DIR`, `timelapses` volume.
- Regenerated go2rtc config (`rtsp.listen: ':8554'`, private network only),
  restarted go2rtc once, recreated `monitor-web` with `--no-deps`.
- Backup for this deploy: `/home/pi/wyze-monitor-backup-20260925-174935` (source,
  go2rtc.yaml, image tag `wyze-monitor-rpi-web:backup-20260925-174935`,
  container list before/after).
- Postiz and all Temporal containers kept identical IDs and uptime.
- Verified on the Pi: 20 s capture from all four cameras, 3840×2160 H.264
  High, labels and clock rendered with DejaVu, cameras in sync; test job
  deleted afterwards.

Rollback: restore `source.tgz` and `go2rtc.yaml` from the backup, retag the
backup image as `wyze-monitor-rpi-web:local`, restart go2rtc and recreate
monitor-web.

## Fixes made along the way

- **Toolbar font bug (pre-existing):** `button { font-size: 11px; font: inherit }`
  reset every button to 16 px; adding one button made the toolbar wrap and clip.
  Now `font: inherit; font-size: 12px`, controls `nowrap`, status chips hide
  below 1750 px.
- **Pi repo had no `.dockerignore`:** building would copy `.env` and the
  generated go2rtc config (camera passwords) into the image. Added.
- **Pi repo installer allowlist** listed Windows-only files and would fail.
  Repaired.
- Bitrate: CRF 17 uncapped gave ~200 Mbit/s 4K; now capped (≈600 MB per 4K minute).
- Clock overlay moved top-right; bottom-right covered the cameras' own stamp.

## Measured

- Daylight 2560×1440 JPEG q2 ≈ 890 KB per frame (UI estimate uses 900 KB).
- First frame arrives ~8–10 s after start (producer spin-up + keyframe).
- 4K grid render at CRF 18: ~85 Mbit/s over 10 s, converging on the cap.

## Known limits and not verified

- Windows capture only runs while the app is open (warned on quit; resumes on reopen).
- Long (multi-hour, 24 h) captures and a long 4K render on the Pi have not been
  run end to end; only minutes-long captures were verified.
- Night/IR detection threshold (`SATAVG < 4`) is tested on synthetic
  monochrome frames, not real Wyze night footage.
- Windows notification: the app log shows a user-run capture rendered into
  `Downloads\Wyze Monitor\Timelapses`, but nobody has confirmed the
  notification appeared or that clicking it reveals the file.
- The Playwright test browser saves downloads to a temp folder, not Downloads;
  test downloads in a normal browser.

## Next steps

1. Ask whether to publish GitHub releases (both repos) with the rebuilt installer.
2. Candidates: daylight-only (sunrise/sunset) capture, repeat daily.
3. Run a full 24 h capture on the Pi and time the 4K render.
4. Validate night-frame detection on real IR footage.
5. Clean up local test data: `tmp/timelapse-proto/`, `.playwright-mcp/`,
   `%TEMP%\playwright-artifacts-*`, and the old `feat/timelapse` branches.
