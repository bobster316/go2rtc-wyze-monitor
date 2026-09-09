# Privacy and security

This is a trusted-LAN viewing application with no authentication.
Do not expose its dashboard, player proxy or go2rtc ports to the public internet.
Use a VPN or an independently authenticated access layer for remote viewing.

## Private files

Never commit or publish:

- cameras.yaml and any backups or temporary copies.
- raspberry-pi/.env and runtime/go2rtc.yaml.
- Windows go2rtc/go2rtc.yaml.
- API tokens, SSH keys, passwords, cookies or browser profiles.
- Real camera images, video, audio or unredacted logs.

These are excluded by Git and/or Docker build-context rules. The Pi release archive
uses an explicit file allowlist. Generated output and temporary directories are
not application source. The public example contains placeholder credentials only.

Credentials are stored in plaintext locally because FFmpeg needs them. The Pi
installer limits camera/config file permissions. Root and Docker administrators
can still inspect them. Store backups privately and rotate any credentials exposed
in chat, logs or previous uploads.

The dashboard intentionally displays camera labels and LAN IPs to its viewers.
Changing those labels before sharing screenshots may also be necessary.
IP addresses are not passwords, but full RTSP URLs contain credentials.

## Reporting a problem

Do not put exploit details or secrets in a public issue. Use GitHub's private
vulnerability reporting if enabled, or request a private contact route without
including the sensitive material. A full security audit is not claimed by this
release. Keep the OS and dependencies under review.

## Dependency and network scope

The server copies video locally; it does not need Wyze cloud API credentials.
Initial downloads require internet access. Camera firmware/account setup remains
a separate Wyze process. The project does not disable camera cloud behavior.

The player WebSocket proxy is required for streaming and is not an authorization
layer. Treat anyone who can reach the dashboard as potentially able to view cameras.
