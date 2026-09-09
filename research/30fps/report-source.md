# Wyze Cam v4 on Raspberry Pi: Full-Resolution 30 FPS Research

**Status:** research prototype and measured feasibility study

> Historical research snapshot. The shipped viewer now supports Smooth30 in
> all visible grid tiles as well as focus, enabled by default unless disabled by
> the viewer. References below to focus-only opt-in describe an earlier prototype.
> MVLS-30 remains a proposal, not implemented functionality. Current operational
> limits and subsequent Pi 4/Pi 5 results are in [performance](../../docs/PERFORMANCE.md).
**Date:** 8 September 2026
**Final certification target:** Raspberry Pi 5, Raspberry Pi OS 64-bit or 32-bit, Lite or Desktop; Pi 4 remains a separate compatibility build
**Constraint:** retain the camera's full 2560x1440 resolution; do not disturb the unrelated Compose application

## Executive conclusion

The stock Wyze Cam v4 does not transmit 30 captured frames per second. Wyze specifies 20 fps in daylight and 15 fps at night. A Raspberry Pi cannot recover scene information that the camera did not capture. It can produce a full-resolution 30 fps presentation by generating intermediate frames, but those frames must be visibly identified as synthetic and must never replace the original stream for recording or evidence.

The research produced two outcomes:

1. A deployed, opt-in **Full-Resolution Smooth 30** baseline. It retains a 2560x1440 backing canvas, uses the viewer GPU, measures source and output rates separately, and never silently reduces resolution. It is enabled only in the enlarged view so the original four-camera pass-through remains lightweight.
2. A stronger research architecture, **MVLS-30: Motion-Vector Late-Scanout 30**. It reuses motion vectors already present in Wyze H.264 P-frames, performs full-resolution warping in the Pi display compositor, and applies refinement only where motion-vector confidence is low. It avoids a 30 fps re-encode.

MVLS-30 is a potentially distinctive combination for this Wyze/Pi security-monitor context. It must not be represented as proven worldwide novelty. Codec-vector interpolation, late-stage frame warping, and neural residual refinement each have prior art, including the March 2026 ANVIL preprint. A patent search and a reproducible implementation would be required before making a novelty claim.

## What was measured on the actual Pi 5

The test host is a Raspberry Pi 5 running 64-bit Raspberry Pi OS. The monitor is isolated in its own Docker Compose project. All the unrelated Compose application containers remained running and healthy during every test.

The live Wyze `sample_main` stream was inspected for four seconds with FFmpeg motion-vector export enabled:

- source cadence: 20.00 fps, approximately one frame every 50 ms;
- frame structure: I-frame followed only by P-frames, with no B-frame reordering;
- GOP: approximately 2 seconds;
- motion-vector side data: present on every observed P-frame.

This is unusually favourable for MVLS-30. P-only ordering and exported motion vectors remove two major deployment risks identified by ANVIL.

Four short tests were then run inside only the Wyze go2rtc container. Output was discarded, so these figures isolate decode and interpolation rather than encoding:

| Method | Output target | Observed result | CPU time | Peak RSS | Verdict |
|---|---:|---:|---:|---:|---|
| `fps=30` duplication | 30 fps | real-time, 1.11x | 0.131 s | 55 MB | cadence only; no smoother motion |
| `minterpolate=blend` | 30 fps | real-time, 1.11x | 0.476 s | 61 MB | viable baseline; can ghost |
| `minterpolate=blend`, 2560x1440 | 30 fps | about 34 fps processing, 1.39x | 6.326 s | 188 MB | clears 30 for one full-resolution focused stream |
| `minterpolate=mci` AOBMC | 30 fps | 0.548x, about 16 fps | 18.328 s | 126 MB | fails the deadline even at 360p |

The software MCI result is decisive: conventional full-frame block search on the Pi CPU cannot guarantee 30 fps even at 360p. Full-resolution temporal blending does clear 30 for one focused stream, but it is not motion reconstruction and it does not prove four-stream capacity. High-quality synthesis must reuse encoder work, use the GPU/NPU selectively, or move refinement to a more capable viewing device.

## Camera-originated 30 fps

Wyze's official v4 specification is 2560x1440 at 20 fps by day and 15 fps at night. Its current RTSP beta exposes transport and credentials, not frame-rate controls.

However, the FCC filing shows three sensor variants were certified for WYZEC4: SmartSens SC401AI, OMNIVISION OS04D10, and GalaxyCore GC4653. Their published specifications support approximately 2560x1440 at 30 fps. The camera uses an Ingenic T41NQ SoC; Ingenic advertises hardware H.264/H.265 encoding up to 3840x2160 at 20 fps. QHD30 has a lower raw pixel rate than 4K20, so QHD30 appears hardware-plausible, but this is an inference rather than a tested Wyze mode.

Authentic 30 fps therefore requires a Wyze-signed firmware mode that configures sensor timing, exposure, ISP and encoder together. A safe vendor R&D proposal is a `QHD30 Linear` performance mode with:

- sensor output and encoder timestamps at 30 Hz;
- exposure limited to less than one 33.3 ms frame period;
- increased bitrate;
- an explicit low-light warning or fallback;
- profiling of WDR, 3D noise reduction, Smart Focus and edge-AI workloads.

No safe third-party firmware route is known. Community maintainers report secure boot on the v4, and the reported hardware workaround requires SoC replacement. That is not appropriate for working cameras.

## MVLS-30 architecture

The output clock is 30 Hz. A 20 Hz source and a 30 Hz output coincide every 100 ms. Between those coincidences, the required synthetic timestamps alternate at approximately one-third and two-thirds of a source-frame interval. Generating only one midpoint per camera frame pair is therefore incorrect for exact 20-to-30 conversion.

MVLS-30 uses this pipeline:

```text
Original Wyze H.264 packets --------------------------------> evidence/recording
            |
            v
Software decode with export_mvs
            |
            +--> decoded full-resolution I/P frames
            +--> sparse H.264 block vectors and references
                         |
                         v
Confidence map: vector agreement + residual + occlusion + scene cut
                         |
                         v
Vulkan late-scanout warp at exact 30 Hz timestamps
                         |
                         +--> confident tiles: compositor output directly
                         +--> uncertain tiles: optional INT8 residual corrector
                                                    |
                                                    v
                                      labelled SYNTHETIC 30 display
```

The central optimisation is to spend work on uncertainty, not on every pixel:

1. H.264 vectors are densified and smoothed only around block boundaries.
2. Static tiles are copied; coherent moving tiles are warped directly.
3. Occlusions, conflicting vectors, newly revealed regions, headlights, rain and scene cuts receive a confidence penalty.
4. Only low-confidence tiles are refined. On Pi 5 this could use a small convolution-only INT8 network on an AI HAT. Pi 4 omits neural refinement and falls back to warp, edge-gated blend, or a real source frame.
5. The compositor always meets its presentation deadline by reducing refinement complexity, never resolution. The fallback order is residual correction, vector warp, edge-gated temporal blend, then nearest real frame.
6. The original stream is immutable and immediately switchable. Generated display frames are always labelled.

This deadline-first order is more important than average benchmark speed. A production claim of 30 fps should require a 30-minute thermal soak with the one-percent-low presentation rate at or above 30, zero resolution changes, and explicit missed-deadline telemetry.

## Deployed baseline

The current baseline lives in `src/smooth30.js`. It is deliberately smaller than MVLS-30 so it can be tested safely before native Vulkan development:

- WebGL 2 uploads only newly decoded source frames;
- a 30 Hz output scheduler blends the two surrounding real frames;
- a per-pixel change gate pulls large differences towards the nearest real frame to reduce double edges;
- the canvas backing dimensions exactly equal `videoWidth` and `videoHeight`;
- the UI reports `OUT`, `SRC`, dimensions and missed deadlines;
- disabling Smooth 30 returns instantly to the untouched WebRTC video.

This baseline improves cadence but does not reconstruct motion as accurately as MVLS-30. It adds approximately one source-frame of latency. Browser throttling, a display refresh below 30 Hz, or insufficient GPU capacity can still cause missed deadlines; the app reports these instead of hiding them.

## Pi 5 and Pi 4 decisions

### Raspberry Pi 5

Use native Vulkan 1.3 for the MV warp and compositor. Avoid a 30 fps H.264 re-encode: Raspberry Pi 5 has no H.264 hardware encoder, and full-resolution multi-stream software encoding wastes the CPU budget. An AI HAT+ or AI HAT+ 2 is promising only for a redesigned convolution-only residual stage. Stock RIFE cannot simply be compiled for Hailo because dynamic GridSample/warping is unsupported; warping belongs on the host GPU.

### Raspberry Pi 4

Use the same exact-cadence and codec-vector design with OpenGL ES/Vulkan where available, but omit the neural stage. Retain full resolution and use deadline fallbacks. The Pi 4 hardware H.264 block can decode up to its published limit, but four full-resolution interpolation pipelines still require measured proof. The focused-camera path should be completed first.

## Acceptance tests

A build is not accepted as "minimum 30 fps" unless all of the following pass:

- output backing resolution stays 2560x1440;
- source FPS and generated output FPS are displayed separately;
- 30-minute test, with one-percent-low output at least 30.0 fps;
- no thermal or undervoltage throttling;
- scene cuts do not create cross-scene blends;
- people entering frame, hands, wheels, rain, foliage and headlights are reviewed for artifacts;
- added latency is measured and shown;
- raw recording hashes are identical with Smooth 30 on and off;
- the unrelated Compose application container health and resource limits remain unchanged.

## Recommendation

Keep the deployed GPU cadence renderer as an experimental baseline, not as the final invention. The next engineering milestone is a native MVLS-30 focused-camera prototype using FFmpeg `export_mvs` plus a Vulkan warp. Only after it passes the 30-minute 1440p test should work expand to four simultaneous views. In parallel, submit the evidence for a Wyze-signed `QHD30 Linear` mode; that is the only path to 30 genuinely captured frames.

## Primary references

1. Wyze, "Wyze Cam v4 Tech Specs," updated 3 March 2026. https://support.wyze.com/hc/en-us/articles/23746258989851-Wyze-Cam-v4-Tech-Specs
2. FFmpeg Project, "minterpolate" filter documentation. https://ffmpeg.org/ffmpeg-filters.html#minterpolate
3. FFmpeg Project, `extract_mvs.c`. https://ffmpeg.org/doxygen/trunk/extract__mvs_8c_source.html
4. Liu, "ANVIL: Accelerator-Native Video Interpolation via Codec Motion Vector Priors," arXiv:2603.26835, 2026. https://arxiv.org/abs/2603.26835
5. Huang et al., "Real-Time Intermediate Flow Estimation for Video Frame Interpolation," ECCV 2022. https://arxiv.org/abs/2011.06294
6. Raspberry Pi, Raspberry Pi 5 product specification. https://www.raspberrypi.com/products/raspberry-pi-5/
7. Raspberry Pi, AI HAT documentation. https://www.raspberrypi.com/documentation/accessories/ai-hat-plus.html
8. Hailo, Model Zoo. https://github.com/hailo-ai/hailo_model_zoo
9. Ingenic, T41 product specification. https://www.ingenic.com.cn/products-detail/id-33.html
10. FCC ID 2AUIUWYZEC4, internal photographs. https://fccid.io/2AUIUWYZEC4/Internal-Photos/FCC-Interal-Photos-Rev01-7194677.pdf
11. OMNIVISION, OS04D10 product brief. https://www.omnivision-group.com/files/pd/file/OS04D10-PB-v1.1-WEB.pdf
12. GalaxyCore, GC4653 datasheet. https://dl.sipeed.com/fileList/MaixIII/AXera/07_Chip_manual/GC4653_CSP_datasheet%C2%A0for%C2%A0release_Rev.1.0_20190712.pdf
