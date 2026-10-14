# Printer cameras and camera selection — 4 October 2026

## Final status

Windows and both monitoring Pis have the six-camera configuration and the
adaptive camera-selection interface. The Windows app was running at the final
check: `/api/health` returned `go2rtc: true` and all twelve stream entries.
Both Pis served HTML, JavaScript and CSS matching the final local files.
Source/behaviour verification is complete; visual browser verification of the
final layout remains outstanding because the browser runtime was unavailable.

## Adaptive layout and dedicated camera information strips

The owner approved information outside each picture and an adaptive grid. Tiles
now have a 32 px header (name/live state), a flexible centre containing a
16:9 video stage, and a 58 px footer (source size, FPS, time, Enlarge and
Reconnect). The 4:3 garage feed fits within that stage with side bars. CSS
container units constrain the stage to both available width and height;
column selection allows for the 90 px information strips. Camera visibility,
focus view and full-resolution source streams remain supported. Mirrored to
the Pi repository and deployed to Windows files and both Pi dashboards.
Open viewers require Ctrl+R to load the new markup and stylesheet. Browser
automation remains unavailable, so a final visual inspection is outstanding.

The grid must remain adaptive, not fixed at 3×2. Camera checkboxes drive visible
count and layout. At the owner's widescreen desktop size:

| Selected cameras | Display arrangement |
|---|---|
| 1 | One large view |
| 2 | Two views side by side |
| 3–4 | Two columns × two rows |
| 5–6 | Three columns × two rows |
| 0 | Prompt to choose cameras from the Cameras menu |

**Cameras → tick/untick feeds** updates the grid immediately. **Show all** restores
all cameras. Selections persist independently for each viewer/origin. Hidden
cameras remain configured and available for timelapses. New cameras start visible.

Added a behaviour
test for selection transitions 6→4→2→1→0→3→5→6 at the owner's desktop size,
checking 3×2, 2×2, side-by-side and single-camera arrangements. Zero cameras
shows the selection prompt. Narrow windows retain the scrolling single column.

Reviewed the main 28 September handover and the 29–30 September updates.
This session adds two printer cameras to Windows and both monitoring Pis.

## Cameras

- `ender3v2`, **Ender 3 V2**: Wyze v2 at `192.168.1.75`, plain RTSP port
  554, `live` path. H.264 at 1920×1080; the user's live screenshot measured
  15 FPS (the stream metadata advertises 30, so do not promise 30 captured FPS).
- `ender3v2garage`, **Ender 3 V2 Garage**: Logitech C920 on printer Pi 4
  `ender3v2garage`, `192.168.1.214`. Existing Crowsnest/ustreamer feed at
  `/webcam/?action=stream`, MJPEG 640×480, configured for 15 FPS. The user's
  screenshot measured about 14 FPS. Klipper, Mainsail and Crowsnest settings
  were inspected, not changed.
- All three monitors have six cameras / twelve main-sub stream entries.
- Credentials remain in private ignored configuration, not this handover.

## Implementation

- Shared generator supports per-camera `tls`, `port`, `streams` overrides.
  A single `streams.main` aliases Eco to main. Existing v4 defaults remain.
- `type: mjpeg` plus an HTTP(S) `url` encodes to H.264 on the monitor host
  only when consumed, at source dimensions and with arrival timestamps.
  Eco aliases the same encoder. Concurrent viewers on separate hosts each
  cause their own encode; this does not run an encoder on the printer Pi.
- Live video and Smooth30 use `contain`. Grid recording also preserves aspect
  ratio. This fixes cropping/stretching when six tiles have different aspect
  ratios. Black bars are expected. Timelapse thumbnails also use `contain`.
- Cameras menu has checkboxes and **Show all**. Hidden IDs are saved in that
  viewer's localStorage; new cameras appear automatically. Hidden streams are
  disconnected, existing visible players are retained, and grid layout uses
  visible count. An empty selection gives instructions. Configured/timelapse
  camera lists are unchanged. Preferences are independent per viewer/origin.
- Header says **Mixed** for different visible source sizes, with dimensions
  in its tooltip, instead of showing the last camera's size as GRID RES.
- All shared code, tests and configuration docs mirrored to Pi-only repository.

## Deployment and verification

- Both Pis: checked there were no capturing/scheduled/rendering timelapses
  before each dashboard restart. Existing completed jobs were retained.
- Pi 4 camera backup: `/home/pi/wyze-monitor-backup-printers-20261004-083151`.
- Pi 5 camera backup: `/home/pi/wyze-monitor-backup-printers-20261004-083408`.
- Initial UI backup on both Pis: `/home/pi/wyze-monitor-backup-camera-view-20261004-084804`.
- Final information-strip deployment backups:
  Pi 4 `/home/pi/wyze-monitor-backup-camera-view-20261004-090131`;
  Pi 5 `/home/pi/wyze-monitor-backup-camera-view-20261004-090135`.
- Camera deployment built monitor-web, regenerated configuration, restarted
  go2rtc and recreated monitor-web. UI follow-up recreated monitor-web only.
  Compared container IDs before/after: unrelated services unchanged, including
  all Postiz/Temporal containers. Pi 5 custom Compose files preserved.
- Windows camera backup: ignored `cameras.yaml.bak-20261004`. App launched to
  verify new sources, then reopened following the final UI update.
- Later Windows checks initially found no running app/server. A diagnostic
  launch of the same Electron app stayed open, and the subsequent health
  check succeeded with go2rtc and all twelve streams. No startup cause was
  established and no launcher fix was made. Ignored diagnostic logs:
  `tmp/camera-layout-launch.log` and `tmp/camera-layout-launch-error.log`.
- Both new feeds probed through Pi 4; frames decoded through Pi 5 and Windows,
  including the garage Eco alias. User screenshot confirmed all six views live
  before the aspect-ratio/selection follow-up.
- Full test suite: **29/29 passed in each repository** after the tile-layout
  changes. One additional adaptive-selection regression test was then added;
  the affected playback suite passed **9/9 in each repository**. The full suite
  was not rerun after that test-only addition. Coverage includes mixed camera
  config, visibility persistence, layout transitions, mixed-resolution header
  and aspect-safe recording.
- Browser runtime returned no available browser. Final UI automation/visual
  validation was unavailable; do not claim a post-update browser interaction
  test. Served source checks and Node VM behaviour tests were used instead.
- Changes are in working trees; no commit or push during this session.

For print timelapses, consider disabling **Skip night-vision frames**: the
existing saturation-based filter can discard a nearly monochrome printer scene.

The Windows app is the blue taskbar shortcut. Pi 5 is red, Pi 4 green. Existing
open viewers must reload (Ctrl+R) or reopen to receive the new UI. The dashboard
**Refresh** button reconnects feeds; it does not reload JavaScript/CSS.

## Next-session checks

1. Visually inspect the final layout after Ctrl+R: camera names/status above
   the image, metadata and working Enlarge/Reconnect buttons below, with no
   overlays or cropping in the grid. Confirm the 4:3 garage view has side bars.
2. Exercise the Cameras checkboxes in a live viewer with 1, 2, 4 and 6 feeds,
   then reopen the viewer to confirm persistence. Automated behaviour tests
   cover these transitions, but live browser interaction was unavailable.
3. Keep the distinction between the monitoring Pi 4 (`192.168.1.93`) and the
   printer Pi 4 (`192.168.1.214`); this work did not install the monitor on the
   printer Pi or change its Klipper/Mainsail/Crowsnest settings.
4. Changes remain uncommitted/unpushed. Preserve the working trees and keep
   credentials, camera backups, generated configuration and diagnostic logs
   out of commits. The earlier timelapse backlog remains in the September
   handovers; it was not implemented as part of this camera integration.
