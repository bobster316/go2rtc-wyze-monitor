# Pi 5 dashboard feature parity — 20 September 2026

## Deployment

Updated `pi@192.168.1.155` (`postizpi`), project
`/home/pi/wyze-monitor-rpi`, Compose project `wyze-monitor-rpi`.
Dashboard remains **http://192.168.1.155:18765**. Hard-refresh after the update.

Only `monitor-web` was recreated. Existing published ports, `.env`, camera
credentials, runtime go2rtc config and other Compose projects were preserved.
The Pi's existing Compose file received only the recording-volume addition;
the local template's port-80 mapping was not deployed onto this shared host.

Backup: `/home/pi/wyze-monitor-backup-20260920-121353/source.tgz`.
Previous image tag: `wyze-monitor-rpi-web:backup-20260920-121353`.
Container inventory before deployment is in the same backup directory.

## Shared dashboard features

The Pi now serves the current shared Windows renderer, including adaptive grid,
HD/Eco, Cameras menu, enlarged views, per-camera reconnect, Diagnostics,
fullscreen, optional Smooth 30, the one-second receiver buffer request, and
disconnecting hidden grid streams during enlarged viewing.

Recording captures only camera images, never the desktop/taskbar/app toolbar.
Both grid and enlarged-camera recording use the existing 1920×1080 canvas.

Pi browser recording now saves MP4 natively if supported by the browser.
Otherwise it uploads WebM to `/api/recordings`, which converts the finished clip
to H.264 MP4. Conversion is single-job, thread-limited and low-priority on Linux;
the 512 MB upload limit and timeout bound resource use. Failed conversion keeps
a WebM download available. Downloads go to the viewing device's browser download
location, not automatically to Windows' native `Downloads/Wyze Monitor` folder.

FFmpeg is installed inside the updated web image, not on the Pi host. Temporary
recordings use the `wyze-monitor-rpi_recording-tmp` volume and are removed after
the response. Live camera forwarding remains stream copy; finished-recording
conversion is a separate operation and does use encoding resources.

See [platform features and limitations](docs/PLATFORM-FEATURES.md).

## Verification

- Ten automated tests passed, including real codec conversion, input validation,
  temporary-file cleanup, native browser MP4 handling, failed-conversion recovery,
  receiver buffering and grid/focus lifecycle.
- Syntax checks and `git diff --check` passed.
- Deployed renderer SHA-256 matches local Windows renderer:
  `fb69df63e59e4661a45b51267321b93a982b594ea28236f3eb4dd22e66372930`.
- Pi health: go2rtc true; four cameras, eight streams; main quality; arm64.
- Synthetic two-second 1920×1080 WebM converted on the Pi via the real HTTP
  endpoint to H.264 MP4, 30/1 FPS, 2.000 seconds, HTTP 200. Conversion and probe
  took about 2.24 seconds. No temporary clip files remained.
- No private camera footage was recorded in testing.
- Existing go2rtc container stayed `172cc53723a6`, with 12 hours uptime.
- Postiz stayed `aa2897c89bf5`, healthy with five hours uptime. Its Temporal,
  PostgreSQL, Redis and Elasticsearch container IDs and health were unchanged.
- Browser-control integration was unavailable. Actual user-browser capture,
  download permissions, interaction and long-duration playback still need a
  user smoke test; backend and shared-code tests do not certify every browser.

## Repository status and follow-up

No commit, push or public release was made. The installer allowlist now includes
the recording worker and relevant tests/docs, but the public release and local
installer archive were not rebuilt as part of this deployment.

The existing Windows source also received the shared recording reliability
changes. Its native MP4 bridge remains in place.

Resume the Pi/Linux-focused video with this tested feature set. Show the Pi 5
as the demonstrated host, distinguish live stream copying from post-recording
MP4 encoding, and do not claim desktop file-saving semantics in a browser.
The user's camera-recording requirement excludes all desktop and app chrome.
