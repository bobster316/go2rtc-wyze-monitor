# Timelapse quality — 29 September 2026

Follows [HANDOVER-2026-09-28-CODEX.md](HANDOVER-2026-09-28-CODEX.md), which is
still the main project handover (devices, architecture, deploy steps, owner
preferences, safety rules). This file covers one session's work: research on
professional timelapse technique, what the Wyze Cam v4 can do, and the
changes built from it. Everything is committed, pushed and deployed.

## Status

| Item | State |
|---|---|
| `go2rtc-wyze-monitor` (main) | `0f95122` feature, `ce47a49` UI fix, `6bb85d0` docs note, plus this handover. Pushed to `main` |
| `wyze-pi-camera-dashboard` (Pi repo) | Same code: `2cec1d0` feature, then the UI fix. Pushed to `master` |
| Raspberry Pi 4 (`192.168.1.93`) | Deployed (git checkout, detached at `ce47a49`), verified with a real 4-camera capture |
| Raspberry Pi 5 (`192.168.1.155`) | Deployed (changed files copied into `/home/pi/wyze-monitor-rpi`), verified with a real 1-camera capture. Backup `/home/pi/wyze-monitor-backup-20260929-145741`. Postiz/Temporal untouched |
| Windows app | Code is in the working tree; the app was closed and picks it up on next launch. **Not yet run live on Windows** (automated tests pass on Windows with FFmpeg 8.1.1) |
| Tests | 24/24 main repo, 21/21 Pi repo |

Today's timelapse work is done. Only the owner's own timelapses are running
(see below).

## 1. Research findings (summary)

How professionals get realistic timelapses, and what applies here:

- **Interval by subject:** traffic and people 1–2 s; fast clouds 1–3 s,
  slower clouds 5–10 s; sunsets 2–5 s; shadows and the sun 15–30 s; stars
  20–30 s; plants 90–120 s; construction 5–15 min.
- **180° shutter rule:** expose for about half the interval (with ND filters
  in daylight). This motion blur is the biggest difference between
  professional and amateur timelapses.
- **Locked exposure and white balance** (manual mode); otherwise flicker.
  Deflicker in post (LRTimelapse; Resolve/Premiere flicker reduction 20–40%).
- **Frame stacking/averaging** looks like a long exposure: smoother motion,
  less noise, less flicker.
- **Clip length** 10–30 s per scene; 24/25/30 fps (60 shows the stepping).
- **Delivery:** YouTube 4K30 35–45 Mbit/s, 4K60 53–68 Mbit/s; 4K uploads get
  a better YouTube encode.
- **Common mistakes:** shake/jitter, clouds racing (interval too long),
  flicker, uneven frame spacing, clips too short.

### What the Wyze Cam v4 can and cannot do

Measured on the Pi 5 with ffprobe (read-only, 10 s samples):

| Stream | Bitrate | Keyframes | P-frames |
|---|---|---|---|
| `front_main` | 1.53 Mbit/s | every 2 s, ~183 KB | ~4.0 KB |
| `back_garden_main` | 1.11 Mbit/s | every 2 s, ~170 KB | ~1.7 KB |

2560×1440, 20 fps, H.264. Almost all detail is in the keyframes, so the
existing keyframes-only capture is right. The sensor is one of three 4 MP parts
(OS04D10, GC4653 or SC401AI); fixed 115° lens. **Exposure, white balance,
ISO and shutter are all automatic and cannot be set.** Thingino (open
firmware) cannot run on the v4 without physically replacing the secure-boot
SoC. So the realism gains must come from software, and detail and dynamic
range will never match a DSLR.

## 2. What was built

All in `lib/timelapse.js` (shared by Windows and both Pis), `src/timelapse-ui.js`,
`src/renderer.html`, `src/styles.css`, with tests in `tests/timelapse.test.js`
and the user guide in `docs/TIMELAPSE.md`.

### Natural motion blur (virtual shutter), capture time

- Each saved frame is `tmix` of the last N keyframes, placed before the
  existing `select` in the capture FFmpeg (`spawnCamera`).
- `shutterFrames(interval) = clamp(round(interval / 2 / keyframeSec), 1, 8)`,
  so the averaging window is about half the interval (180° rule), capped at 8
  keyframes (16 s) to bound memory (~44 MB per camera at 1440p).
- Examples: 2–4 s → 1 (no blur); 6–8 s → 2; 10 s → 3; 16 s → 4; ≥30 s → 8.
- Stored per job as `job.shutter = { frames, windowSec }` at creation, so a
  resumed capture keeps it. `spec.shutter === false` turns it off.
- Cost is small: only keyframes were being decoded already.
- Side effect: the cameras' own burned-in clock smears at long intervals.
  Advise turning off the Wyze time watermark if the app offers it.

### Even intervals (bug fix)

- **Bug:** frames exist only at keyframes (every 2 s), and capture chose the
  first keyframe at least `interval − 0.25 s` after the last. An odd interval
  such as 5 s really captured every 6 s while slots counted 5 s, leaving empty
  slots, which made video stutter.
- **Fix:** `create()` snaps the interval to whole keyframes
  (`snapInterval`, e.g. 5 → 6, 57.6 → 58). The select gap is now
  `interval − keyframeSec / 2` (tolerates timestamp jitter). The UI's
  interval buttons are now 2, 4, 6, 10, 16, 30 s, 1, 2, 5 min.
- `TimelapseManager` has a new `keyframeSec` option (default 2). Tests use
  `0.1`, because lavfi test sources make every frame a keyframe at 10 fps.

### Steady colour (auto white balance evened out), render time

- `measureColour()`: one fast pass per camera (`-lowres 3`, `scale=1:1`,
  rawvideo rgb24 to a pipe) gives each frame's mean RGB.
- `colourGains()`: pulls each frame's R:G and B:G ratios to the **median** of
  the 15 frames around it (median, so one odd frame does not tint its
  neighbours). Corrections are capped at 0.85–1.18, keep the frame's luma, and
  leave dark (<16) and night/IR frames alone. Slow changes such as a sunset
  survive.
- Applied with `sendcmd` (`colourCommands()`, fires half a frame early) into a
  named `colorchannelmixer@c<i>`, then `format=yuv420p` **before**
  `deflicker`. deflicker only corrects the first plane, which in RGB is green.
- Verified that `colorchannelmixer` rr/gg/bb are runtime (`T`) options on
  FFmpeg 5.1.9 (Pi containers) and 8.1.1 (Windows).
- Night detection now also runs when colour is on (to exclude IR frames), but
  frames are only dropped when `skipNight` is on.

### Other render changes

- **4K for YouTube** (`render.uhd`, default off): single-camera plans are
  scaled with lanczos to 3840×2160 (80 Mbit/s cap). The grid is unchanged.
- **Motion smoothing** (`tmix` 1-2-1 in the render) is skipped when the job's
  shutter averages more than one keyframe, to avoid ghosting people and cars.
  So it only applies below 6 s intervals, or with blur off.
- **Night detection:** median of five neighbouring SATAVG values against
  `NIGHT_SATURATION = 4`. Validated on the owner's 27 Sep video
  (`tl-20260927-142531-b2aa`, 14:25–22:13 BST, front + front_garden):
  daylight 10–16, dusk 5–9, IR 0–0.3, with one stray 4.9 spike at night
  (headlight or spotlight). The threshold stays at 4; the median stops a single
  colour frame being spliced into the night. The cameras kept colour until
  about **19:40 BST** that day (sunset ~18:47).

### Reliability fixes (handover 9.2 item 1)

- `tick()` has a `ticking` guard (the body moved to `runTick()`), so a slow
  `finishCapture()` cannot overlap the next tick.
- `finishCapture()` runs once per job (`this.finishing` set; the body is
  `completeCapture()`).
- `save()` chains writes per job (`this.saving` map) through unique temp names
  (`job.json.<pid>.<counter>.tmp`), and `writeJob()` skips removed jobs;
  `remove()` waits for a pending save before deleting the folder. This fixes
  the `ENOENT rename job.json.7.tmp` seen after the Pi 5 power cut.

### Recommended defaults

Server `DEFAULT_RENDER` and UI `RECOMMENDED`: 25 fps, natural motion blur on,
deflicker on, steady colour on, motion smoothing on, camera names on, clock
off, **skip night on**, 4K off, tidy on. The API listing now returns
`keyframeSec`, `maxShutterFrames` and `defaults`.

UI prefs are versioned (`PREFS_VERSION = 2` in `src/timelapse-ui.js`). Saved
prefs from an older version keep layout, stop mode, duration and length, but
reset the look to the recommendations. Bump the version when the
recommendations change. There is a **Use recommended settings** link at the
bottom of "Look & quality". The summary shows the blur window ("Natural
motion blur: each frame averages 16 s of camera footage").

## 3. Deploy notes from this session

- **Pi 4:** `git bundle create tmp/pi4-update.bundle <pi4-HEAD>..main`, fetch
  and `checkout --detach`, then
  `docker compose -f compose.yaml -f compose.pi4.yaml up -d --build --no-deps monitor-web`.
  Image backup tags were created before each update.
- **Pi 5:** `git archive` of only the changed files (`lib/timelapse.js`,
  `src/timelapse-ui.js`, `src/renderer.html`, `src/styles.css`), extracted into
  `/home/pi/wyze-monitor-rpi`, then the project-scoped build and
  `up -d --no-deps monitor-web` from the main handover. **The Pi 5 install has
  no `docs/` folder**: do not include it in the backup `tar`, or the backup
  step fails. Before/after container lists showed every non-Wyze container
  unchanged.
- Both Pis were checked for running captures or renders before recreating
  `monitor-web`.
- Test jobs ("Claude test (delete me)") were created and deleted on both Pis.

## 4. Lessons

- **`npm test` does not load the browser script.** The first deploy shipped a
  temporal-dead-zone error (`PREFS_VERSION` used before its `const`), and the
  whole timelapse button was dead. It was caught by opening the Pi 4 dashboard
  with Playwright and fixed in `ce47a49`. **After any UI change, open the panel
  in a browser and check the console.**
- The Bash tool strips backslashes in heredocs (as the main handover warns). It
  corrupted both a Python patch and a test regex. Write patch scripts to a file
  with the Write tool, or use Edit.
- Perplexity and Firecrawl failed at first because this PC's DNS was down; the
  built-in WebSearch/WebFetch still worked. DNS recovered later (git push worked).

## 5. Owner guidance given (plain-language settings)

The owner is not a developer and asked for concrete settings. What they were told:

- The panel has **no separate interval control** in "After a set time" mode:
  the interval comes from **Stop** ÷ (**Finished video length** × fps) and shows
  in the summary line ("Every 4 s …"). Only "When I stop it" shows interval
  buttons.
- Suggested presets (25 fps):

| Timelapse | Start | Stop after | Video length | Interval |
|---|---|---|---|---|
| Sunset | 17:45 | 2 h | 1 min | 4 s |
| Sunrise | 06:15 | 2 h | 1 min | 4 s |
| Afternoon clouds | 13:00 | 4 h | 1 min | 10 s |
| Street or people | now | 30 min | 30 s | 2 s |
| Full day | 06:00 | 24 h | 1 min (about 30 s after night is skipped; choose 2 min for about 1 min) | 58 s |

- Sunrise and sunset times were approximated for south-east England (sunrise
  about 07:00, sunset about 18:45 BST at the end of September; 2 minutes
  earlier each day; clocks go back 25 Oct). **Their exact location is still
  unknown: ask for their town before building sunrise/sunset scheduling.**
- 30 min into 30 s hits the 2 s minimum, so the video comes out at about 36 s,
  and motion blur has no effect below 6 s.
- On the camera side: turn off the Wyze time and logo watermarks if the app
  offers them, turn off the motion spotlight on timelapse cameras, keep lenses
  clean, mount firmly.

## 6. The owner's own timelapses at the time of writing (20:25 BST)

| Device | Job | Cameras | Settings | State |
|---|---|---|---|---|
| Pi 4 | `tl-20260929-152017-b403` | front | 30 min, 4 s, 4K for YouTube | ready: 3840×2160, 16.9 s, 168 MB (422 frames of ~450 expected) |
| Pi 4 | `tl-20260929-174702-e98e` | front_garden | 17:47 start, 4 h (ends ~21:47 BST), 4 s, 4K for YouTube, **skip night off** | capturing: 2,340 frames at 2 h 38 min (~98% of expected), no camera errors |

Both use a 4 s interval, so they have no natural motion blur (smoothing is
used instead). The evening job has skip night **off** and runs past dusk, so
its video will end with black-and-white infrared footage. If the owner does
not want that, re-render it with "Skip night-vision frames" on. That needs
the frames, so it only works if "Delete frames after the video is made" was
off. Check the finished video with them.

## 7. Still open

From the main handover, section 9:

1. **9.2 items 2–3:** wall-clock jump detection (monotonic watchdog, reset
   `lastFrameAt` on a jump) and `job.capture.gaps` logging.
2. **9.3:** per-camera missed-frame counts and a UI warning (the Front Garden
   froze on 27 Sep); better recovery / `_sub` fallback (owner decision).
3. **9.5:** long render benchmark on Pi 4, Pi 5 and Windows. The new colour
   pass adds an RGB conversion per frame, so measure it on the Pi 4.
4. **9.6:** daylight-only and repeat-daily scheduling. Needs the owner's
   location.
5. Run a first timelapse on **Windows** with the new code and confirm the
   notification and the video.

Ideas raised but not built:

- Crossfade at the dusk infrared switch.
- Optional stabilisation (`vidstab` is available in all FFmpeg builds checked).
- "Full motion blur" (decode every frame in the window). Windows and Pi 5
  only; too heavy for the Pi 4.

## 8. Follow-up, 30 September 2026

Three fixes, in both repos (`84ee083`, `0512408`, `c7810a3` main; the same in
the Pi repo). Deployed to the Pi 4 (git checkout at `c7810a3`, image backup
`wyze-monitor-rpi-web:backup-20260930-0540`) and the Pi 5 (files copied,
backup `/home/pi/wyze-monitor-backup-20260930-064308`, other containers
unchanged). Windows picks them up on next launch. **Not pushed.**

1. **Stop button did nothing.** The menu and panel replaced their HTML every
   2 s while capturing, so the button changed between press and release and
   the click was lost. `patchHtml()` in `src/timelapse-ui.js` now updates them
   in place. The button reads **Stop timelapse** in both places and shows
   "Stopping…" at once. Checked on the Pi 4 with a 2.6 s press.
2. **Delete keeps nothing.** On Windows, Delete (was "Remove") left the videos
   in Downloads. `remove()` now deletes the job's videos in `outputRoot` too.
3. **Empty frames after a power cut.** The Pi 5 rebooted at 06:14 on 30 Sep;
   five 0-byte JPEGs made the render fail. Frames are now fsynced before the
   rename, and `recount()` (run before each render) deletes 0-byte frames.
   The owner's affected Office job was re-rendered (167 frames).

The owner stopped two duplicate 8 h Office captures on the Pi 5 that morning
(they had been unable to stop them).

Later the same morning:

- The owner had all timelapses deleted on all three devices (3 on the Pi 4,
  6 on the Pi 5, 1 leftover entry on Windows). Their two files in
  `Downloads` were left alone.
- **Summary looked stuck** (`89d033e`, `2617912`). Start time, skip night,
  deflicker, steady colour, smoothing, clock and tidy were missing from the
  summary, so changing them seemed to do nothing. It now shows start/end
  time, a Look line (on and off), night frames kept or removed, and whether
  frames are kept, and it warns when the 2 s minimum makes the video longer than
  chosen. "4K for YouTube" is greyed out for grid-only videos (already
  3840 wide), and "Both" lists grid and single sizes. Deployed to the Pi 4
  and the Pi 5 (backup `/home/pi/wyze-monitor-backup-20260930-070518`).
