# Architecture

## Shared stream path

```text
Camera RTSPS H.264
  -> FFmpeg exec producer: -an -c:v copy
  -> go2rtc internal RTSP
  -> WebRTC (MSE fallback)
  -> Electron or browser H.264 decode
  -> optional WebGL Smooth30 canvas
```

FFmpeg demuxes and remuxes the camera video without decoding or re-encoding.
The browser decodes the video; hardware acceleration depends on its platform.
Audio is disabled. The Electron viewer composites decoded video frames and sends
the capture to its main process, where FFmpeg writes H.264 MP4. Remote browser
viewers save MP4 directly when their MediaRecorder supports H.264 MP4. Otherwise
the Pi web service converts the finished WebM capture to MP4 using a bounded,
single-job FFmpeg worker. This conversion is separate from live stream forwarding.
See [recording behaviour and limits](PLATFORM-FEATURES.md).

Direct go2rtc RTSPS connections failed with the cameras used for development.
The shared generator retains explicit FFmpeg `exec:` sources with TCP transport
and `-protocol_whitelist tcp,tls,rtsp`. Do not replace these with direct camera
URLs without testing against the actual firmware.

Each camera defines `ID_main` and `ID_sub`. Producers start on demand. Four
definitions being consumed normally means four FFmpeg producers, not eight.
A second consumer can share an existing producer.

## Code map

| Path | Responsibility |
|---|---|
| scripts/generate-go2rtc-config.js | Validate cameras.yaml and generate stream-copy sources |
| src/main.js | Windows Electron entrypoint, localhost HTTP, go2rtc supervision and native MP4 recording |
| src/preload.js | Narrow context-isolated bridge for native recording saves |
| src/renderer.js | Shared grid, focus view, quality, reconnect and telemetry |
| src/smooth30.js | WebGL temporal blending and output scheduler |
| src/vendor/video-rtc.js | Upstream go2rtc browser player |
| raspberry-pi/server.js | LAN HTTP server and player WebSocket proxy |
| raspberry-pi/generate-go2rtc-config.js | Private container config with Pi ICE candidate |
| raspberry-pi/install.sh | First-install coordination and host prerequisites |
| raspberry-pi/configure.sh | Camera wizard and private configuration |
| raspberry-pi/setup.sh | Build and start selected Compose profile |
| raspberry-pi/wyze-monitor | Installed CLI and desktop launch target |
| raspberry-pi/publish-friendly-url.sh | Avahi name publication |
| scripts/build-pi-installer.ps1 | Explicitly allowlisted installer archive |

## Windows lifecycle

The app generates config, starts go2rtc if needed, waits for its API, serves the
dashboard on loopback and opens Electron. It restarts a failed child with backoff
and attempts to terminate its process tree on exit. An existing go2rtc listener is
reused; it must already have compatible stream definitions.

## Pi lifecycle and isolation

The Compose project is `wyze-monitor-rpi`, with a dedicated bridge network.
A one-shot `config-init` service generates the private go2rtc configuration.
The go2rtc and monitor-web containers use `restart: unless-stopped`.
The web image installs production npm dependencies only, not Electron.
The go2rtc image contains FFmpeg.

The web process serves only an allowlist of UI files, sanitized camera metadata,
health status and a WebSocket proxy. Credentials are not returned in
`/api/config`; camera labels and LAN addresses are returned.
The management HTTP API and internal RTSP socket are not published to the LAN.
The player proxy is not a substitute for authentication or a security boundary
against hostile LAN users.

The host receives Docker if missing, Avahi support, a dedicated name-publisher
service, CLI symlink, icon and desktop/application-menu entry. The monitor runtime
does not install host Node.js, Electron, FFmpeg or go2rtc.

## Rendering and measurement

Smooth30 uses the previous and current decoded frames and a per-pixel change gate
to reduce some double-edge blending. It is temporal blending, not optical flow,
AI enhancement or the proposed MVLS-30 research compositor.

Output counts are WebGL draw submissions on a nominal 30 Hz scheduler, not
independent measurements of physical display scanout. Source counters come from
video playback statistics and frame callbacks. Hidden grid smoothers stop while
a focus view is open; the underlying grid players may remain connected.

A canvas matches source dimensions when initialized. Switching HD/Eco rebuilds
players. In-place source-resolution changes, stalls and GPU-context recovery
need further validation. See [performance](PERFORMANCE.md).
