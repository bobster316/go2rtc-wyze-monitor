# App icons and Windows "Wyze Monitor Pi" viewer — 26 September 2026

New icon system for every platform (Windows, Raspberry Pi, and ready for
macOS, iOS and Android), plus a second Windows app, **Wyze Monitor Pi**, that
opens the Raspberry Pi dashboard in its own window so both can be pinned to
the Windows taskbar.

Nothing in this handover is committed or deployed to the Pi yet.

Previous handover: [HANDOVER-2026-09-25-TIMELAPSE.md](HANDOVER-2026-09-25-TIMELAPSE.md)
(its open items are unchanged; see "Carried over" at the end).

## Status

| Item | State |
|---|---|
| Icon design ("Live stack") | Chosen by the user, generated for all platforms |
| Windows desktop shortcut + taskbar pin | New icon installed. **The old pin was lost** (see "Pin lost"); both apps are running on the taskbar and waiting for the user to pin them |
| Windows Electron window icon + app ID | Done and verified: relaunched from the Start menu, it shows as one blue button |
| Wyze Monitor Pi viewer on Windows | Built, launched, window verified open with the Pi icon |
| Taskbar pins (order: 1 Pi, 2 Windows) | Both apps running on the taskbar at equal size (verified by screenshot). **User action:** right-click each → Pin to taskbar, then drag the red Pi icon before the blue one. Windows 11 blocks programmatic pinning. |
| Pi favicon + desktop/menu launcher icon | Updated in both repos; **Pi 5 not redeployed** |
| Pi installer ZIP | Allowlists fixed; ZIP **not rebuilt** |
| Tests | 18/18 (Windows repo), 15/15 (Pi repo) after the icon changes; `pi-viewer.js` has no tests (syntax-checked, run manually) |
| Git | Uncommitted in both repos (see "Files changed") |

## What the user asked for and decided

1. Start: "fix the icons". The Windows icon existed (a single 64 px `.ico`,
   red square, white camera, "WYZE"); the Pi used an unrelated red "W".
2. Rejected round 1 (my first attempt: camera + "WYZE"/"PI" text labels).
   User: needs better resolution; **Pi = Raspberry Pi red/white/black;
   Windows = standard Windows 11 colours.** Then: "looks terrible".
3. User asked for research into comparable apps. Microsoft's guidelines
   (learn.microsoft.com, *Design guidelines for Windows app icons*) say: no
   typography, one clear metaphor, subtle gradients, legible at 16 px.
4. User: must be **world class** because the app will later ship on **Apple
   and Android**.
5. Rejected round 2 (2×2 grid of screens + lens) because the user said the
   app will **not stay limited to 4 cameras**, so the icon must not imply a
   camera count. It also read as a flower.
6. User asked to look at real CCTV / Wyze app icons. I pulled 44 real icons
   from the UK App Store (iTunes Search API) into a contact sheet.
   Finding: about 15 of 44 are "blue tile + lens/eye" — the crowd looks the
   same. The best (UniFi Protect, Nest, Home Assistant, Scrypted, Canary) use
   one bold custom shape, flat, no text. Do not imitate Wyze's own gradient
   "W" (trademark / confusion).
7. Three concepts were placed into the real competitor grid:
   1. Cube cam: looked like V380 Pro / IP Camera Viewer. Dropped.
   2. **Live stack: recommended and approved ("ok").**
   3. View cone: read as a pie chart. Dropped.
8. User: "on my windows task bar i need to see both icons pinned" / "I want to
   be able to open the pi wyze cam from my windows as well as another icon for
   the windows version". This led to the Wyze Monitor Pi viewer.

These preferences are saved in Claude's memory
(`app-icon-branding`) for future sessions.

## The icon: "Live stack"

A front screen carrying a record/live dot, with more screens stacked behind
it: "your live camera feeds", with no fixed camera count. It uses one
metaphor, no text, and stays legible at 16 px.

| Family | Colours | Container |
|---|---|---|
| Windows | Fluent blue gradient `#62C6FF → #1A8CF0 → #0050B8`; back screens `#CFEAFF`, `#0B3F8F`; white ring, red dot `#FF6A5E → #E0261B` | Unplated (no tile), soft two-layer shadow, like Windows 11 inbox icons |
| Raspberry Pi | Raspberry red `#F0457A → #D01E54 → #9E0F3A`; back screens white and `#8E8E95`; white ring, black dot | Unplated, **identical geometry to Windows** so the two pins are the same size. (A black squircle plate was tried; it vanished on the dark taskbar and the Pi icon read smaller. The user asked for them to match.) |
| macOS | Windows blue mark | Midnight squircle `#16294A → #060D1C`, 824 px plate on 1024 canvas (Big Sur grid) |
| iOS | Windows blue mark | Full-bleed midnight square, opaque (iOS applies its own mask) |
| Android | Windows blue mark | Adaptive icon: foreground layer (mark inside the 66 dp safe zone), midnight background layer, **monochrome layer** for Android 13+ themed icons |

Sizing (enlarged after the user said the icons were too small on the
taskbar): the mark fills 238/256 of the canvas (full art) and 250/256 (small
art), for both Windows and Pi. The Apple and Android versions keep their
platform containers (squircle / full-bleed / adaptive layers).

At ≤ 32 px a simplified mark is used: one back screen instead of two, wider
gaps, bigger record ring. The `.ico` files pick the small art automatically
for 16/20/24/32 px.

Construction details: designed on a 208-unit box. Each back screen is masked
away around the screen in front of it (gap), so layers separate on any
background without relying on shadow. The mark is pure shapes, with no fonts, so
the SVGs render identically on the Pi, in browsers, and on Windows.

### Generating

```powershell
cd D:\Wyze-Cam-v4
python go2rtc-wyze-monitor\scripts\icons\generate-icons.py
```

Requires Python with Pillow and Google Chrome (or Edge). SVGs are rasterised
by headless Chrome at 1024 px, then downscaled with Lanczos. It rewrites
`go2rtc-wyze-monitor\assets\icons\` only. The copies the apps use are
separate and must be re-copied after a design change (see "Where each icon is
used").

Note: the script's printed lines ("Icons written to ...") are output, not
commands. The user pasted them into PowerShell once by mistake.

### Output (`go2rtc-wyze-monitor/assets/icons/`)

```
windows/  wyze-monitor.svg, wyze-monitor-small.svg, wyze-monitor.ico (16,20,24,32,40,48,64,96,128,256), png/16…1024
pi/       wyze-monitor.svg, wyze-monitor-small.svg, wyze-monitor.ico, png/16…1024
apple/    macos-1024.svg/.png, wyze-monitor.icns (16…1024), ios-1024.svg/.png (opaque RGB)
android/  ic_launcher_foreground/background/monochrome .svg/.png (432 px = 108 dp @ xxxhdpi), play-store-512.svg/.png
```

For Android Studio: import the foreground/background/monochrome SVGs via
*Image Asset → Launcher Icons (Adaptive and Legacy)*, or convert with
*Vector Asset*. For Xcode: drop `ios-1024.png` into the AppIcon set
(single-size), and use `wyze-monitor.icns` / `macos-1024.png` for macOS.

### Where each icon is used

| Use | File | Source |
|---|---|---|
| Windows desktop shortcut + taskbar pin (`Wyze Camera Monitor.lnk`) | `C:\Users\<you>\WyzeCameraMonitor\launchers\Wyze-Camera-Monitor.ico` | copy of `windows/wyze-monitor.ico` |
| Windows Electron window/taskbar | `assets/icons/windows/wyze-monitor.ico` (referenced from `src/main.js`) | direct |
| Windows app browser-tab favicon | `src/favicon.svg` | copy of `windows/wyze-monitor-small.svg` |
| Pi dashboard favicon (Windows repo's Pi server) | `src/favicon-pi.svg`, served as `/favicon.svg` by `raspberry-pi/server.js` | copy of `pi/wyze-monitor-small.svg` |
| Pi dashboard favicon (Pi repo) | `wyze-pi-camera-dashboard/src/favicon.svg` | copy of `pi/wyze-monitor-small.svg` |
| Pi desktop + app-menu launcher (both repos) | `raspberry-pi/wyze-monitor.svg` → installed to `/usr/local/share/icons/hicolor/scalable/apps/` | copy of `pi/wyze-monitor.svg` |
| Wyze Monitor Pi viewer (Windows) window | `assets/icons/pi/wyze-monitor.ico` (from `src/pi-viewer.js`) | direct |
| Wyze Monitor Pi viewer (Windows) shortcut / taskbar | `C:\Users\<you>\WyzeCameraMonitor\launchers\Wyze-Monitor-Pi-<hash>.ico` | copied by `install-pi-viewer-shortcut.ps1`. The hash in the name changes per design, which bypasses Windows' shortcut-icon cache (the old tiled icon stuck until this was done). |

Backup of the original Windows icon:
`C:\Users\<you>\WyzeCameraMonitor\backups\Wyze-Camera-Monitor-old-20260926.ico`.

## Taskbar grouping (AppUserModelID)

The Windows shortcut launches PowerShell, which then starts Electron, so
Windows could not tell the running window belonged to the pin and showed a
**second** taskbar button. Fixed by giving the app and its shortcuts the same
AppUserModelID:

| App | ID | Set in |
|---|---|---|
| Windows monitor | `WyzeCameraMonitor.Windows` | `src/main.js` (`app.setAppUserModelId`), taskbar pin + desktop shortcut |
| Pi viewer | `WyzeCameraMonitor.Pi` | `src/pi-viewer.js`, Start-menu + desktop shortcut |

`scripts/icons/set-shortcut-app-id.ps1` writes `System.AppUserModel.ID` onto
`.lnk` files (via `IPropertyStore`). Both IDs were read back and confirmed.
Shortcut backups (before the ID was stamped):
`C:\Users\<you>\WyzeCameraMonitor\backups\taskbar-Wyze-Camera-Monitor-20260926.lnk`
and `desktop-Wyze-Camera-Monitor-20260926.lnk`.

**Verified:** launched from the Start menu, the Windows monitor shows as one
blue button.

### Pin lost (my mistake), and the fix

Stamping the new app ID onto the **already-pinned** `.lnk` made Windows drop
the pin from the taskbar (it disappeared from the `Taskband` registry list,
but the `.lnk` was left in `User Pinned\TaskBar`). The user noticed the icon had
"disappeared". The blue icon the user then saw was the Windows **Photos** app,
not Wyze. Fix:

- Removed the orphaned `User Pinned\TaskBar\Wyze Camera Monitor.lnk` (backup in
  `WyzeCameraMonitor\backups\`).
- Added `Start Menu\Programs\Wyze Camera Monitor.lnk` (copy of the desktop
  shortcut, app ID `WyzeCameraMonitor.Windows`) beside `Wyze Monitor Pi.lnk`.
  A Start-menu shortcut with a matching ID is what lets Windows pin a running
  window correctly.
- Launched Pi first, then Windows, so they sit in the requested order.
  **The user pins each: right-click → Pin to taskbar.** Or: Start → search
  "Wyze" → right-click → Pin to taskbar (Pi first, then Windows; drag to
  reorder if needed).

Lesson: never change the AppUserModelID on a shortcut that is already pinned.
Set it before pinning, or unpin and re-pin.

If a pin ever shows the old icon, it is Windows' icon cache. Sign out and back
in, or restart Explorer (`Stop-Process -Name explorer -Force`, taskbar
disappears ~2 s). After this session's `ie4uinit -show`, the taskbar
screenshot showed the new blue pin.

## Wyze Monitor Pi viewer (Windows)

A small Electron entry point that opens the Pi dashboard in its own window:

- `src/pi-viewer.js`: loads `http://192.168.1.155:18765` (override with
  `--url=`), with the Pi icon, the title "Wyze Monitor Pi" (the page's own
  title is suppressed), and the app ID `WyzeCameraMonitor.Pi`.
  - Single-instance: clicking the pin again focuses the existing window.
  - Links to other sites open in the default browser.
  - Downloads (timelapse / MP4) save straight to **Downloads** and reveal the
    file.
  - If the Pi is unreachable, it shows a message with a Retry button.
  - Sandboxed renderer, no Node integration, no preload.
- `scripts/start-pi-viewer.ps1`: launcher. It **clears `NODE_OPTIONS`**
  first. This machine has `NODE_OPTIONS=--use-system-ca`, which makes Electron
  exit immediately ("--use-system-ca is not allowed in NODE_OPTIONS"). The
  Windows monitor's `scripts/start-windows.ps1` does the same.
  - Do **not** pass `-WindowStyle Hidden` to the Electron `Start-Process`. It
    hid the viewer's window (the process ran with no window). The PowerShell
    host is already hidden by the shortcut.
- `scripts/install-pi-viewer-shortcut.ps1 [-Url ...]`: creates
  `Start Menu\Programs\Wyze Monitor Pi.lnk` and `Desktop\Wyze Monitor Pi.lnk`,
  sets the Pi icon, and stamps the app ID. Rerun it if the project moves or
  the Pi's address changes.

Verified: launched from the Start-menu shortcut, the window "Wyze Monitor Pi"
opened and the taskbar showed the red Pi icon next to the blue Windows pin.

The Pi viewer shows the **Pi 5** (`192.168.1.155:18765`). The Pi 4
(`wyze-monitor.local` / `192.168.1.93`) would need a second shortcut with
`-Url`, and a different shortcut name / app ID if both are wanted.

## Bugs fixed along the way

- **Pi installer ZIPs never contained the favicon** (both repos' allowlists
  omitted it), so Pi installs had no browser-tab icon. Added
  `src/favicon-pi.svg` (Windows repo) and `src/favicon.svg` (Pi repo) to
  `scripts/build-pi-installer.ps1`.
- **Electron window used Electron's default icon** on the taskbar. Now set
  via `BrowserWindow({ icon })`.
- **The Windows pin and the running window showed as two taskbar buttons.**
  Fixed with the AppUserModelID (verification pending, see above).

## Files changed

Windows repo `go2rtc-wyze-monitor` (uncommitted):

```
 M raspberry-pi/server.js            /favicon.svg now serves favicon-pi.svg
 M raspberry-pi/wyze-monitor.svg     new Pi launcher icon
 M scripts/build-pi-installer.ps1    + src/favicon-pi.svg
 M src/favicon.svg                   new Windows favicon
 M src/main.js                       AppUserModelID + window icon
?? assets/icons/                     generated icon system (all platforms)
?? docs/icon-design/                 research + concept sheets (see caution)
?? scripts/icons/generate-icons.py   production generator
?? scripts/icons/concepts.py         the three-concept review renderer
?? scripts/icons/set-shortcut-app-id.ps1
?? scripts/install-pi-viewer-shortcut.ps1
?? scripts/start-pi-viewer.ps1
?? src/favicon-pi.svg
?? src/pi-viewer.js
?? HANDOVER-2026-09-25-TIMELAPSE.md  (from the previous session, still untracked)
?? HANDOVER-2026-09-26-ICONS-AND-PI-VIEWER.md
```

Pi repo `wyze-pi-camera-dashboard` (uncommitted):

```
 M raspberry-pi/wyze-monitor.svg
 M scripts/build-pi-installer.ps1    + src/favicon.svg
 M src/favicon.svg
```

Outside the repos (live on this PC):

- `C:\Users\<you>\WyzeCameraMonitor\launchers\Wyze-Camera-Monitor.ico` (replaced)
- Desktop `Wyze Camera Monitor.lnk` (app ID added); old taskbar pin removed (lost, see above)
- New: Start menu `Wyze Camera Monitor.lnk` and Start menu + Desktop `Wyze Monitor Pi.lnk`

### Caution before committing

`docs/icon-design/icon-research-competitors.png` and
`icon-concepts-in-market.png` contain **other companies' app icons** (Ring,
Hikvision, Arlo, Wyze, etc.). Both repos are public on GitHub, so do not
commit these. Keep them local or add `docs/icon-design/` to `.gitignore`.
`icon-concepts.png` (our designs only) is safe.

`scripts/icons/concepts.py` expects the downloaded competitor icons in
`<out-dir>/competitors/` with `final.csv`. Those were in this session's temp
scratchpad and are gone. It is a review tool, not needed for production. It
can be deleted, or kept for future design rounds.

## Next steps

1. **User:** both apps are open on the taskbar. Right-click the red Pi icon →
   **Pin to taskbar**, then the blue Windows icon → **Pin to taskbar**, and
   drag red before blue (requested order: 1 Pi, 2 Windows).
2. After pinning, close both apps and click each pin to confirm it launches
   and shows one button each (app ID grouping). Note for editors: Windows
   PowerShell 5.1 `Get-Content -Raw`/`Set-Content` corrupted UTF-8 in these
   handovers once (`—` became `â€”`). It was repaired; edit Markdown with an
   editor or pass `-Encoding UTF8` explicitly.
3. Decide on `docs/icon-design/` (gitignore the competitor sheets), then
   commit both repos.
4. Redeploy `monitor-web` on the Pi 5 so its favicon and launcher icon update.
   Use the same method as the timelapse deploy (backup first; keep
   Postiz/Temporal untouched; `--no-deps`). The Pi's desktop launcher icon
   also needs `raspberry-pi/wyze-monitor.svg` reinstalled to
   `/usr/local/share/icons/hicolor/scalable/apps/`, then
   `gtk-update-icon-cache` if the menu keeps the old one.
5. Rebuild the Pi installer ZIP (`scripts/build-pi-installer.ps1`) so it
   contains the favicon and the new launcher icon.
6. Optional polish:
   - light/dark "unplated" taskbar variants (Windows supports separate assets)
   - an Android vector-drawable export
   - a 1-bit high-contrast version

## Carried over from the timelapse handover (unchanged)

- Ask whether to publish GitHub releases (both repos) with the rebuilt installer.
- Candidates: daylight-only capture, repeat daily.
- Run a full 24 h capture on the Pi and time the 4K render.
- Validate night/IR detection on real footage.
- Clean up `tmp/timelapse-proto/`, `D:\Wyze-Cam-v4\.playwright-mcp/`,
  `%TEMP%\playwright-artifacts-*`, and the local `feat/timelapse` branch.
- Change the exposed/default Pi passwords.
