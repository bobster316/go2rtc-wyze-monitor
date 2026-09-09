# Changelog

## 1.1.0 ? 2026-09-09

- Publish the Raspberry Pi 4 and Pi 5 deployment alongside the Windows app.
- Add camera wizard, architecture detection, Docker setup, desktop/SSH launchers
  and a friendly .local address.
- Publish full-resolution browser Smooth30 with source/output labels.
- Add quick start, detailed configuration, recovery, removal and troubleshooting.
- Package a dedicated Pi installer containing the public guides and examples.
- Exclude credentials, generated runtime data and private media from release inputs.
- Match container file access to the installing user's UID/GID.
- Use Docker's Debian repository for both Pi architectures and recreate the
  monitor services after camera configuration changes.

Historical hardware observations cover Pi 4 ARM32 and Pi 5 ARM64 with remote
viewers. Local-Pi 30 FPS display and the complete compatibility/soak matrix remain
uncertified. See docs/PERFORMANCE.md.

## Earlier Windows version

Local RTSPS/H.264 stream-copy dashboard with an adaptive camera grid, HD/Eco,
enlargement, reconnect, fullscreen and client-side statistics.
