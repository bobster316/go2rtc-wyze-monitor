# Agent notes

Start with [HANDOVER-2026-09-28-CODEX.md](HANDOVER-2026-09-28-CODEX.md), then
[HANDOVER-2026-09-29-TIMELAPSE-QUALITY.md](HANDOVER-2026-09-29-TIMELAPSE-QUALITY.md) and
[HANDOVER-2026-09-30-STOP-DELETE-SUMMARY.md](HANDOVER-2026-09-30-STOP-DELETE-SUMMARY.md) (latest, with the feature backlog): devices,
architecture, deploy steps, owner preferences and the work in progress.

- Tests: `$env:NODE_OPTIONS=''; npm test` (clear `NODE_OPTIONS`, or Electron
  and some tooling fail on this machine).
- Pi-side changes (server, compose, install scripts, tests, Pi docs) must
  also be made in `../wyze-pi-camera-dashboard` until the repos are
  consolidated. Its red favicon is `src/favicon.svg`, not `src/favicon-pi.svg`.
- Never commit `cameras.yaml`, `.env`, or generated `go2rtc.yaml` files.
- Never change the AppUserModelID of a pinned Windows shortcut.
- Before recreating `monitor-web` on a Pi, check `/api/timelapse` for
  running captures or renders. Never touch other containers on the Pi 5.
- Commits: `feat:` / `fix:` / `docs:`, British English in docs.
