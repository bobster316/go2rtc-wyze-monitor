# Wyze Monitor port-conflict fix handover — 14 September 2026

## Purpose

This handover records a single focused fix made during the 14 September 2026
session: the Windows Electron app was crashing on launch with an uncaught
`EADDRINUSE` error. It covers the root cause, the fix, verification performed,
and current repository state. It supplements, and does not replace,
[HANDOVER-2026-09-10-STANDALONE-APP-RELEASE.md](HANDOVER-2026-09-10-STANDALONE-APP-RELEASE.md),
which remains the most complete description of overall product state.

## What was reported

Launching the app produced a native Electron error dialog:

```text
A JavaScript error occurred in the main process
Uncaught Exception:
Error: listen EADDRINUSE: address already in use 127.0.0.1:8765
    at Server.setupListenHandle [as _listen2] (node:net:2009:16)
    at listenInCluster (node:net:2066:12)
    at node:net:2275:7
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)
```

## Root cause

`src/main.js` hardcoded the local dashboard HTTP server to
`127.0.0.1:8765` and called `.listen()` with no `'error'` handler. On this
Windows PC, port 8765 is permanently held by an unrelated background process:

```text
python.exe -m signalvault.cli serve
```

`signalvault` is not part of this project. Because `main.js` had no error
handling around `listen()`, the resulting `EADDRINUSE` was an uncaught
exception that crashed the entire Electron main process, producing the native
dialog shown above. This was not a leftover/duplicate instance of Wyze Monitor
itself — a live check at the time confirmed PID 41092 (`python.exe`) owned the
port, not `electron.exe`.

## Fix applied

File changed: `src/main.js`.

- `PORT` changed from a `const` to a `let`, and a new `PORT_CANDIDATES` list
  was added: `[8765, 8766, 8767, 8768]`.
- `createServer()` now attempts to bind each candidate port in order. On
  `EADDRINUSE` it logs `port <n> is already in use, trying the next
  candidate` and tries the next one. On any other listen error, or if every
  candidate is taken, it rejects with a clear explanatory message instead of
  throwing an uncaught exception.
- `app.whenReady()` now wraps the `createServer()` call in `try/catch` and
  routes a failure through the existing `fatal()` helper (a friendly
  `dialog.showErrorBox` message), rather than letting a rejected promise
  crash the process.
- `createWindow()` already read the module-level `PORT` when building the
  `loadURL()` string; since `PORT` is now updated in place once the server
  actually binds, the window opens against whichever port was really used.

No other file references port 8765 (verified with a repo-wide search for
`8765`, excluding the unrelated Raspberry Pi diagnostic port `18765`, which is
a different, already-distinct number).

## Verification performed

- `node --check src/main.js` passes.
- `node --test tests/*.test.js` — all 4 existing automated tests pass
  unchanged.
- Live run with port 8765 still occupied by `signalvault`:
  - Started via `npm.cmd start` (`NODE_OPTIONS` cleared first).
  - Log showed `port 8765 is already in use, trying the next candidate`.
  - Server bound `127.0.0.1:8766` instead.
  - `netstat` confirmed `8765` still held by the pre-existing `python.exe`
    process and `8766` newly held by the Electron process, with active
    request/response traffic on `8766`.
  - The Electron window came up normally at the fallback port; multiple
    `electron.exe` processes were present as expected (main, renderer,
    GPU/utility helpers).
- The unrelated `signalvault` process was left untouched, as it is outside
  this project's scope and not something to kill without the owner's
  explicit instruction.

## Follow-up: fix committed, recurrence investigated

Later the same day, the app crashed again with the identical `EADDRINUSE`
dialog. Investigation found:

- Port 8765 was again held by `python.exe` (PID 41092) — the same
  `signalvault` process described above, still running from earlier. It was
  killed manually to unblock the immediate relaunch.
- The `src/main.js` port-fallback fix above was still sitting **uncommitted**
  in the working tree at that point, so it's unclear whether the crash the
  user hit was from before or after the fix was effectively in place; either
  way, an uncommitted fix on a dev machine is not something to rely on.
- Checked for anything that would auto-restart `signalvault`: Task
  Scheduler (`schtasks /query`), the current user's Startup folder, and the
  `HKCU\...\CurrentVersion\Run` registry key. None reference `signalvault` —
  it is not wired into any known auto-start mechanism on this machine, and
  `pip show signalvault` / `python -c "import signalvault"` both fail against
  the default Python install, so it isn't even installed there. It was most
  likely started manually (or by some other tool/session) and simply never
  exited.
- The `src/main.js` fix was committed as `7c38e99` ("fix: fall back to
  alternate ports instead of crashing on EADDRINUSE").

Net effect: the immediate crash is resolved twice over — the fallback logic
means a future `signalvault` (or anything else) squatting on 8765 no longer
crashes the app, and the fix is now safely committed instead of living only
in the working tree. What's still unresolved is *why* `signalvault` was
running at all; if it recurs, worth asking whoever/whatever starts it to stop
using 8765, since this project's fallback range (8765–8768) could eventually
collide with it again if it also retries adjacent ports.

## Current repository state

```text
On branch main, up to date with origin/main.

Untracked files:
    research/30fps/build_pdf.py   (pre-existing, intentionally excluded from releases)
```

The `src/main.js` port-fallback fix is committed as `7c38e99`.

Latest commit on `main`: `7c38e99` ("fix: fall back to alternate ports
instead of crashing on EADDRINUSE").

## Immediate next steps

1. If `signalvault` keeps reappearing on port 8765, track down what's
   launching it (it isn't Task Scheduler, Startup folder, or an
   `HKCU...Run` entry, and it isn't installed under the default Python) and
   either stop it or ask its owner to use a different port.
2. Confirm the fixed port range (`8765`–`8768`) doesn't need to avoid any
   other locally-known service beyond `signalvault`; extend the candidate
   list if further conflicts appear.
3. Everything else outstanding from the 10 September 2026 handover remains
   open and unaffected by this fix: multi-camera capacity testing beyond
   four cameras, recording history/retention, optional auth/HTTPS, a
   packaged Windows installer, long-duration/reboot testing, and the
   Raspberry Pi YouTube video production (narration generation, caption
   regeneration, privacy review, final assembly).

## Security and privacy reminders

Unchanged from prior handovers:

- Never commit `cameras.yaml`, `.env`, generated go2rtc YAML, private camera
  URLs, credentials or unredacted property footage.
- Do not expose ports 80, 18765 or 18555 through the internet router.
- Treat synthetic Smooth30 frames as a viewing aid, not evidential video.
- Do not disturb Postiz or reuse its ports/configuration without explicit
  review.
