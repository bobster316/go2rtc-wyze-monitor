# Stop button, delete, summary — 30 September 2026

Follows [HANDOVER-2026-09-29-TIMELAPSE-QUALITY.md](HANDOVER-2026-09-29-TIMELAPSE-QUALITY.md)
(the timelapse quality work) and
[HANDOVER-2026-09-28-CODEX.md](HANDOVER-2026-09-28-CODEX.md), which is still
the main project handover (devices, architecture, deploy steps, owner
preferences, safety rules). This file covers one session of bug fixes the
owner reported, plus a feature backlog they chose not to build yet.

## Status

| Item | State |
|---|---|
| `go2rtc-wyze-monitor` (main) | `84ee083`, `0512408`, `c7810a3`, `89d033e`, `2617912` + docs. **Not pushed** |
| `wyze-pi-camera-dashboard` (Pi repo) | Same code changes (`557ab97`, `f57a38e`, `1241298`, then the two summary commits). **Not pushed** |
| Raspberry Pi 4 (`192.168.1.93`) | Deployed: git checkout detached at `2617912`. Image backup `wyze-monitor-rpi-web:backup-20260930-0540` (taken before the empty-frame fix; the earlier `-stopfix` tag failed because the image is `:local`) |
| Raspberry Pi 5 (`192.168.1.155`) | Deployed: `lib/timelapse.js`, `src/timelapse-ui.js`, `src/styles.css` copied into `/home/pi/wyze-monitor-rpi`. Backups `/home/pi/wyze-monitor-backup-20260930-064308` and `-070518`. Other containers unchanged (before/after lists compared) |
| Windows app | Code in the working tree; the app was not running, so it picks the changes up on next launch. Not run live |
| Tests | 24/24 main repo, 21/21 Pi repo |
| Timelapses | **All deleted on all three devices at the owner's request.** No jobs anywhere. The owner's two files in `C:\Users\<you>\Downloads` (`timelapse-front-2026-09-28-1645.mp4`, `Wyze-Monitor-Pi5-2026-09-20-1222-recovered.mp4`) were deliberately kept |

## 1. Stop timelapse button did nothing (`84ee083`)

- **Cause:** while capturing, `renderMenu()` and `renderJobs()` replaced
  `innerHTML` every 2 s poll (the clock changes each time). A press that
  spanned a redraw landed on a replaced button, so no `click` fired. Quick
  clicks sometimes worked, so it looked random. The server `stop` was always
  fine (under 0.2 s).
- **Fix:** `patchHtml()` / `patchChildren()` in `src/timelapse-ui.js` update
  the DOM in place (elements matched by position, tag and `data-id`; `src`
  and `style` are left alone because script sets them). Both places now say
  **Stop timelapse**, and show **Stopping…** (disabled) at once via the
  `stopping` set.
- **Verified** on the Pi 4 with Playwright: the button element survives
  refreshes, and a 2.6 s press stopped the job.
- The Record button was checked: it already says "Stop grid/camera
  recording" and was not affected.

## 2. Delete removes everything (`0512408`)

- On Windows the button said **Remove** and left the videos in
  `Downloads\Wyze Monitor\Timelapses` (outputs in `outputRoot`). The owner
  wants Delete to remove the entry and everything associated.
- `remove()` in `lib/timelapse.js` now also deletes the job's videos in
  `outputRoot`. The UI always says **Delete** / **Confirm delete**.
  `docs/TIMELAPSE.md` and the shared-folder test were updated.

## 3. Empty frames after a power cut (`c7810a3`)

- The Pi 5 rebooted at 06:14 on 30 Sep (no RTC, clock jumped). Five frames
  written just before were 0-byte (renamed but not flushed), and FFmpeg
  failed the whole render ("Impossible to open …000001.jpg").
- Frames are now written with `fsync` before the rename, and `recount()`
  (now also run at the start of every render) deletes 0-byte frames. There's a
  new test (it fails without the fix).

## 4. Summary looked stuck (`89d033e`, `2617912`)

- Start time, skip night, deflicker, steady colour, smoothing, clock and
  tidy never appeared in the summary, so changing them looked like it did
  nothing.
- The summary now shows: start and end time; interval and cameras; frames,
  length, size and fps; a warning when the 2 s minimum (or clamping) stops
  the video matching the chosen length; motion blur; a **Look** line (on /
  off); night frames removed or kept; frame size and free space; frames
  deleted or kept.
- "Both" layout lists grid and single sizes. **4K for YouTube** is greyed
  out for grid-only videos (the grid is already 3840 wide). Smoothing shows
  as "off" when unticked (it has no effect while motion blur is on).
- The start-time box updates the summary on `input`, not only on `change`.
- Verified on the Pi 4 by toggling every control; no console errors.

## 5. Lessons

- The Bash heredoc again stripped backslashes (in a docs path). Check any
  heredoc output that contains `\`.
- `docker tag wyze-monitor-rpi-web:latest` fails on the Pis: the image tag
  is `:local`.
- When testing camera chips, remember they toggle: clicking a selected
  camera deselects it.

## 6. Feature backlog (discussed, owner said "not now")

Ranked by value for effort. The owner was recommended to start with 1 and 2.

1. **Sunrise/sunset and daily scheduling** — "Sunset ±1 h", automatic
   day-to-day shift and the 25 Oct clock change; "repeat daily" and
   one-frame-a-day long timelapses. **Needs the owner's town.**
2. **Camera dropout warning** — per-camera missed-frame counts and a panel
   warning (main handover 9.3; Front Garden froze on 27 Sep).
3. **Stabilisation** — `vidstab` is in all FFmpeg builds checked.
4. **Crossfade at the dusk infrared switch.**
5. **Quick low-res preview** before the full render.
6. **Motion highlights** — keep only the parts where something happened.
7. **Event clips and phone notifications** (base for the on-hold mobile apps).
8. **Upload to YouTube** from the app (4K export already exists).
9. **Storage auto-clean** — keep N days or X GB; the Pi 4 SD card has ~50 GB.

Still open from earlier handovers: wall-clock jump detection and
`job.capture.gaps` (9.2), long-render benchmarks (9.5), a first live
timelapse on Windows with the new code.
