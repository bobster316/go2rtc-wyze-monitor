# Performance and validation status

## Interpret SRC and OUT correctly

Wyze's [v4 specifications](https://support.wyze.com/hc/en-us/articles/23746258989851-Wyze-Cam-v4-Tech-Specs)
list 20 FPS daylight and 15 FPS night. Actual received rates depend on firmware,
lighting and network conditions.

- `SRC`: measured camera-source playback/frame-callback rate.
- `OUT`: generated canvas draw cadence while Smooth30 is active.
- `SYNTHETIC 30`: generated presentations, not additional captured evidence.
- `LATE`: scheduler delay events counted within the reporting interval.

Smooth30 adds roughly one source-frame of delay and can produce ghosting or
blend artifacts. Turn it off to inspect the original video. A 30 Hz draw loop
can continue showing a frozen input, so OUT alone does not establish live video.
The current UI does not provide a robust independent stale-input alarm.
A LATE count is not an exhaustive measurement of every physical-display deadline.

## Recorded hardware tests

These are historical observations from 8 September 2026, not fresh verification
of every release or a guarantee for another viewer.

| Server | Viewer | Observation |
|---|---|---|
| Pi 5, Raspberry Pi OS ARM64 | External Chrome client | Four 2560x1440 canvases, OUT 30.0 for ten consecutive samples over about 20 seconds; no LATE indicator |
| Pi 4 Model B Rev 1.5, 4 GB, Trixie armhf userland / aarch64 kernel | External browser | Four 2560x1440 canvases, OUT 30.0 for ten consecutive samples; 47.7 C and throttling flags 0x0 |
| Pi 5 coexistence | Existing unrelated Compose application | Other application remained running during the test |

The Pi 4 images resolved to native ARM32; Pi 5 used ARM64. These results establish
the server-plus-external-viewer path. They do not establish local Pi GPU display
performance, arbitrary camera counts, or uninterrupted day/night operation.

The original Windows comparison reported approximately 1.3% combined CPU versus
27% for an older MJPEG pipeline on one test machine. It was a short sample, not
a minimum hardware specification or a portable performance promise.

## Not yet certified

- Full Pi 4/Pi 5 x ARM32/ARM64 x Lite/Desktop matrix.
- Four-stream local Pi display at 30 FPS.
- 30-minute thermal and overnight changing-light soak.
- Long-duration stale-input detection and automatic recovery.
- Reboot, network interruption and removal across every supported OS variant.
- Frame synthesis quality during headlights, rain, moving people and scene cuts.

[COMPATIBILITY.md](../raspberry-pi/COMPATIBILITY.md) retains the release acceptance
matrix. Multi-architecture image availability is not physical-device certification.

## Reproduce a useful test

1. Record Pi model, OS, userland architecture, camera firmware, viewer hardware,
   browser version and network connection.
2. Select HD and show every camera. Confirm each picture actually changes.
3. Record SRC/OUT and source/canvas dimensions; toggle Smooth30 off/on.
4. On the Pi run `vcgencmd measure_temp` and `vcgencmd get_throttled` if available.
5. Observe for at least 30 minutes and repeat across day/night transitions.
6. Test camera disconnection and recovery separately; record stale/frozen behavior.
7. Record observations without camera footage or credentials in public issues.

Health endpoint success means the web server can reach go2rtc. It lists configured
stream names; it does not prove all those streams currently have healthy producers.

## Research

The optional [research notes](../research/30fps/report-source.md) describe historical
benchmarks and a proposed motion-vector/Vulkan architecture. That proposal is
not the shipped renderer and is not required for installation.
