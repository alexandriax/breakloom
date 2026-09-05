# Runtime performance and menu access

The September 2026 follow-up targets redundant CPU work and frame pacing while
preserving the wave spectrum, board solver, contact samples, and simulation rate.

## Measured CPU work

A Node CPU profile of the board/contact/transport/camera query pattern identified
finite-depth dispersion and repeated full surface solves as the dominant work.
`npm run benchmark:ocean` reproduces 1,200 frames of this query pattern. It is a
microbenchmark, not a measurement of the complete game or its GPU cost.

| Local sample | Original main | Optimized |
| --- | ---: | ---: |
| Mean query time/frame | 2.115 ms | 0.764 ms |
| Median | 2.045 ms | 0.676 ms |
| 95th percentile | 2.396 ms | 1.301 ms |
| 99th percentile | 2.937 ms | 1.573 ms |

The numerical checksum was identical: `13463.437875857795`. A separate comparison
against the archived main implementation covered 728 complete surface samples
across all 13 coasts, three tides, offshore/face/shore points, both gradient modes,
and changed breaker power. The serialized outputs were identical.

Dispersion reuse keys exact frequency/depth pairs. Surface reuse keys exact
position, time, tide, target face height, breaker parameters, and gradient mode
within the wave bank. Both caches are bounded; neither rounds the physics.
Height-only callers reuse full contact results without changing surface height.
The cache regression checks dispersion residuals, eviction, and invalidation.

## Rendering

Adaptation now recognizes sustained 55 fps as pressure and only treats stable
60 fps or better as recovery headroom. Frame measurements retain the full frame
duration rather than clipping slow frames to 50 ms. Resolution responds before
structural detail changes; riding requires sustained pressure at the resolution
floor before rebuilding scene detail.

The image composer and its targets remain mounted across quality changes. The
canvas no longer allocates redundant antialiasing for the final fullscreen quad;
desktop scene antialiasing remains in the composer. Colour grading and underwater
effects remain present at every detail tier, avoiding visible effect changes.

Local canvas diagnostics expose mean and 95th-percentile frame duration, jank
percentage (frames over 28 ms), draw calls, triangles, detail tier, and DPR. These
are rolling local samples, not uploaded telemetry. They exclude loading, the
initial warmup, and tab-resume frames; use a foreground production build when
comparing them.

## Main menu

The pause dialog places **Main menu** directly below **Return to water**. The
session panel provides the same exit. Pause content scrolls on short screens,
keeping exit controls accessible. Leaving clears gameplay input and returns to
the launch flow while preserving saved progress and mute preferences.

Validation includes release contracts, cache regressions, lint, TypeScript, the
production build/download budgets, and muted desktop/portrait/landscape browser
checks. Viewport emulation is not physical iOS/Android GPU or thermal testing;
hardware-specific performance still needs real-device verification.

One foreground 390×844 sample on the development Mac recorded 16.67 ms mean,
17.60 ms p95, and 0% frames over 28 ms at balanced detail/DPR 0.90. This was a
post-ride wading sample; it is not a worst-case surfing or phone-hardware result.
A heavier desktop riding view measured 18.09 ms mean and 21.90 ms p95 at high
detail/DPR 1.34 (469 draw calls, 621,140 triangles). That prompted the final
threshold change so 55 fps triggers relief rather than being treated as stable.
