# Surf feel and quick-session validation

This pass retains the pump, aerial, barrel, and chain-scoring work from PR #20.
It addresses the underlying control and momentum problems and adds an immediate
Quick Surf entry at Lower Trestles. The full coastline/paddle-out mode remains
available.

## Mechanics

- Space crouches/extends; Shift returns prone. Previously Space dispatched both.
- Rail/fin lift redirects water-relative momentum without adding kinetic energy.
  Contact, planing, grip, foam, and a lateral-load limit constrain that redirection.
- A planing hull can trim across the face and cut back without being treated as
  a prone board broadside to an incoming wave.
- The peeling pocket references a fixed seabed point. It no longer follows the
  surfer's wave-normal position.
- CPU water contact and GPU water rendering share bounded ocean time, including
  pause and the first frame after tab suspension.
- Quick Surf searches the existing spectral ocean for a real shoaling face,
  initializes one diagonal entry, then hands motion entirely to the live solver.

## Automated checks

`npm run verify:release`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`
pass. The build also verifies the static export and download budgets.

The new `verify:feel` regression checks:

- 10,000 rail rotations preserve speed to within 1e-9 m/s.
- Released fins, airborne contact, and non-planing hulls retain their trajectory.
- Current-frame invariance, reduced whitewater traction, and bounded lateral load.
- Three-second carves at 30/60/120 Hz: terminal speeds 5.429/5.435/5.439 m/s;
  largest trajectory difference 0.199 m; no generated thrust.
- Engaged cutbacks retain planing and avoid excessive broadside loading.
- Pause, stalled frames, and tab-resume ocean timing.
- Twelve successive drops find finite, surfable faces matching the water surface;
  the pocket continues peeling in the selected direction.

## Browser checks

Tested the production static export with `?muted`: launch, Quick Surf, repeated
Next Wave, Space without dismount, pause/resume, and responsive portrait and
landscape layouts. Muting now persists across sessions and is applied before
audio startup. Guided HUD removes duplicated touch telemetry to keep the prone
button clear.

Foreground samples on the development Mac were approximately 13 ms/frame in the
desktop viewport and 15–16 ms/frame at 390×844. The latter sample reported 67 draw
calls and 116,642 triangles at DPR 1. These are local diagnostic samples, not
phone-hardware benchmarks or sustained performance guarantees. Rendering still
adapts resolution and detail under pressure.

Physical iOS/Android, controller feel, sustained thermal performance, and longer
surfer playtesting remain follow-up validation. This is a substantial gameplay
and rendering foundation pass; it does not establish production AAA quality or
replace the spectral ocean with a volumetric overturning-fluid simulation.
