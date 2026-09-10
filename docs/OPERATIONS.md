# Operation, backup, recovery and removal

## Dashboard controls

| Control | Behavior |
|---|---|
| HD | Use camera main streams |
| Eco | Explicitly switch grid to substreams |
| Smooth 30 | Toggle synthetic temporal blending |
| Enlarge / double-click | Open selected camera's main stream |
| Close / Escape | Return to grid |
| Reconnect | Rebuild one camera player |
| Refresh | Rebuild grid players |
| Record | In the Electron app, record the visible grid or focused camera to a native MP4 in `Downloads/Wyze Monitor`; browser viewers use WebM fallback |
| Fullscreen | Ask browser to enter fullscreen |

Quality and smoothing preferences are stored in the browser. A new server default
does not override an existing saved browser choice. The Electron app converts
recordings with FFmpeg and saves them locally as MP4 files. Browser viewers use
the WebM fallback because browsers cannot reliably encode MP4.

## Pi commands

```bash
wyze-monitor
wyze-monitor open
wyze-monitor status
wyze-monitor restart
wyze-monitor stop
wyze-monitor logs
wyze-monitor configure
wyze-monitor url
```

Logs may contain sensitive connection details; redact them before sharing.

## Back up your setup privately

The public repository reconstructs the software. To restore your exact camera
setup, separately protect `cameras.yaml` and `raspberry-pi/.env`.
Also note the application release/commit, OS version and router reservations.
Do not upload this backup as a GitHub issue or release attachment.

From the project root on a Pi:

```bash
umask 077
tar -czf ../wyze-monitor-private-backup.tar.gz cameras.yaml raspberry-pi/.env
chmod 600 ../wyze-monitor-private-backup.tar.gz
```

Use a new backup filename if one already exists. This archive is permission-limited,
not encrypted: store it in encrypted private storage.
Generated runtime YAML can be recreated and need not be backed up.
Never publish camera configuration backup files ending in .bak or .bak-*.

On Windows, copy cameras.yaml to encrypted private storage and note your release.
There is no need to back up node_modules, go2rtc logs or Electron user data.

## Recreate on a new Pi

1. Prepare Raspberry Pi OS with your own user and reserved address.
2. Download the same application release into a new directory.
3. Copy your backed-up cameras.yaml into that project root.
4. For a different Pi, let the installer create a fresh .env so the IP and friendly
   name cannot accidentally point at the old machine.
5. Run the normal installer. It retains the existing camera list.
6. Confirm every picture and verify the friendly URL, reboot behavior and performance.

If restoring on the same Pi with the same address, you may restore .env as well,
but review it before installation. Never activate two servers with the same
friendly name simultaneously.

## Update and roll back

Back up privately first. Record `git rev-parse HEAD` for Git installs.
Use a release tag for repeatable versions. For a clean working tree, Git users
can fetch tags and check out the intended release; do not discard local changes.

The simplest cautious upgrade is a new release directory:

1. Stop the monitor using the existing CLI.
2. Download/extract the new release to a new directory.
3. Copy cameras.yaml and a reviewed .env from the previous installation.
4. Run install.sh from the new directory. It updates launchers and Compose mounts.
5. Verify every camera before archiving the previous directory.

A ZIP install has no Git metadata and cannot be upgraded using git pull.
To roll back, stop the monitor, return to the previous project directory and rerun
its installer. The local Docker image tag is reused; rebuilding the previous source
is necessary. Keep the old source and configuration until verification passes.

## Recover after a Pi IP address change

A DHCP reservation is strongly recommended. Avahi follows the address but the
saved Docker host bindings and WebRTC ICE candidate do not.

1. Locate the Pi's new address using your router and reconnect over SSH.
2. Open the installed project directory.
3. Edit raspberry-pi/.env and change PI_HOST_IP to the new reserved address.
4. Rerun the installer:

```bash
./raspberry-pi/install.sh
sudo systemctl restart wyze-monitor-url
wyze-monitor status
```

The installer regenerates go2rtc configuration and recreates changed services.
Refresh the browser to establish a new media connection. It preserves cameras.yaml.

## Remove the Pi deployment

These commands change the system. Back up private configuration first. Run from
the exact installed project directory, and use pi5 instead of pi4 on a Pi 5:

```bash
sudo docker compose --env-file raspberry-pi/.env -f raspberry-pi/compose.yaml -f raspberry-pi/compose.pi4.yaml down
sudo systemctl disable --now wyze-monitor-url.service
sudo rm -f /etc/systemd/system/wyze-monitor-url.service
sudo rm -f /etc/default/wyze-monitor-url
sudo rm -f /usr/local/lib/wyze-monitor/publish-friendly-url.sh
sudo rm -f /usr/local/bin/wyze-monitor
sudo rm -f /usr/local/share/applications/wyze-monitor.desktop
sudo rm -f /usr/local/share/icons/hicolor/scalable/apps/wyze-monitor.svg
sudo systemctl daemon-reload
```

This targets the monitor's Compose project and specifically named launcher files.
Remove the Wyze Monitor desktop shortcut manually if present. Archive the project
directory and delete it manually only after verifying your backup. It contains
private configuration, generated YAML and possibly backup copies.

Do not uninstall Docker or Avahi or run Docker-wide prune commands: other
applications may depend on them. Images may remain cached after removal.
Removal and rollback procedures still need physical testing on every OS variant.

## Remove the Windows app

Close the app, preserve cameras.yaml privately and remove the dedicated project
folder manually. Node.js and FFmpeg may be used by other software; they are not
automatically removed. Electron user data may remain in its standard user-data
directory; inspect it before deleting anything outside the project.
