# Architecture

## The problem with the obvious approach

The straightforward way to show an RTSP camera in a desktop app is to let FFmpeg
do everything:

```
RTSPS H.264 -> FFmpeg decode -> scale to tile size -> MJPEG -> <img>
```

It works, and it is what this project replaced. Three things are wrong with it:

1. **It decodes and re-encodes every frame.** Four cameras cost about 27% CPU on
   a 20-core machine, all of it avoidable.
2. **It throws away most of the picture.** The v4 sends 2560x1440. Scaling to
   960x540 discards about 87% of the pixels, then JPEG compresses what is left —
   a second generation loss on top of the camera's own H.264.
3. **MJPEG has no interframe compression.** Every frame is a complete JPEG, so
   the link between FFmpeg and the UI carries far more data than the camera
   produced in the first place.

Push it harder and it degrades badly: tiles blank out, and FFmpeg processes get
orphaned when a stream is torn down under load.

## What this does instead

```
RTSPS H.264 -> FFmpeg copy -> go2rtc -> WebRTC -> <video> -> GPU decode
```

FFmpeg still connects to the camera, because it is the only client that reliably
can (see [TROUBLESHOOTING](TROUBLESHOOTING.md)), but it runs with `-c:v copy`.
It demuxes the RTSPS stream and remuxes it into go2rtc without touching a single
frame of video. go2rtc republishes it over WebRTC, and Chromium decodes it once,
on the GPU, at native resolution.

The result on the same hardware and cameras:

| | MJPEG | Passthrough |
|---|---:|---:|
| Grid resolution | 960x540 | 2560x1440 |
| Frame rate | 12-24 fps, uneven | ~20 fps, steady |
| CPU, whole stack | ~27% | 1.3% |
| Latency | ~1-3s | ~0.3-0.8s |

CPU measured across all Electron, go2rtc and FFmpeg processes over a 12s sample.

**Quality goes up, frame rate gets *stable* rather than higher.** The camera
encodes at 20 fps and nothing downstream can change that. What passthrough fixes
is the variance — with no re-encode, every tile sits at the camera's own rate.

## Streams

Every camera gets two go2rtc stream definitions:

| Stream | Source | Resolution |
|---|---|---|
| `<id>_main` | `stream0` | 2560x1440 @ 20fps |
| `<id>_sub` | `stream1` | 640x360 @ 20fps |

Both are H.264 High with AAC audio. Both are passthrough.

go2rtc only starts an FFmpeg process for a stream while something is consuming
it, so the eight definitions cost nothing until watched. A four-camera grid means
four FFmpeg processes.

This substream/mainstream split is why there are no quality *profiles*. There is
no transcode left to configure, so the only meaningful choice is which of the
camera's own two streams a tile pulls — hence just HD and Eco. Enlarging a camera
always switches that tile to `_main`, which is the standard NVR pattern: cheap
grid, full detail on demand.

## Audio

Disabled. The cameras emit AAC, which WebRTC will not carry, so enabling it needs
a per-stream Opus transcode in go2rtc. That is cheap — it is only audio — but it
keeps an extra FFmpeg process alive per stream, and the whole point here is that
nothing transcodes. Both the FFmpeg commands (`-an`) and the player (`media =
'video'`) opt out.

## Process supervision

The Electron app owns go2rtc's lifecycle:

- Starts it on launch, or reuses an already-running instance
- Regenerates `go2rtc.yaml` from `cameras.yaml` first, so the two cannot drift
- Restarts it with exponential backoff (1s doubling to 30s) if it exits
- On quit, kills it **and its FFmpeg children** via `taskkill /T`

That last point matters. go2rtc spawns FFmpeg per stream; killing only the parent
leaves orphans holding camera connections, and the cameras have a finite number
of concurrent RTSP clients.

## Measurement

FPS is measured in the renderer from `video.getVideoPlaybackQuality()` —
`totalVideoFrames` sampled once a second. That is what the GPU actually rendered,
so a stall shows up immediately rather than being masked by a server-side counter.

Bitrate comes from `RTCPeerConnection.getStats()`, summing `bytesReceived` across
`inbound-rtp` video reports.

Both are client-side by design: they measure what you are seeing, not what the
server believes it sent.

## Network exposure

Everything binds to `127.0.0.1` except go2rtc's WebRTC listener. There is no
authentication anywhere, because nothing is meant to leave the machine.

**Do not port-forward any of this.** If you want the dashboard from elsewhere,
use a VPN or a tunnel with its own authentication in front. An exposed go2rtc API
is an open door to every camera it knows about, credentials included.

## Choices deliberately not made

- **Recording.** Not built. The architecture supports it — FFmpeg could write
  segmented MP4 alongside the live output with `-f segment` at near-zero extra
  cost, since the stream is already copied rather than decoded.
- **Object detection.** Not built. [Frigate](https://github.com/blakeblackshear/frigate)
  does this properly. If you want it, run detection against the `_sub` streams
  and leave this for viewing.
- **Docker Wyze Bridge.** Worth using if you cannot get RTSP firmware onto your
  cameras — it works through the Wyze cloud API instead. Direct RTSPS is lower
  latency and has no cloud dependency, so it is preferred where it is possible.
