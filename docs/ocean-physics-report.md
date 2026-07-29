# Ocean and surfing physics report

## Executive summary

The old ocean looked like groups of stationary coastal mountains because it
combined a short, fixed 24-crest pattern with independently layered Gerstner
waves, an artificial fifth-power crest spike, and a narrow nearshore
amplification band. Those waves did not share a phase field, bathymetry, water
velocity, or surface normal with the surfing simulation. The result was
periodic clumps that rose and fell in place, flat water between sets, abrupt
walls at high swell, and a board reacting to different water than the player
could see.

This change replaces that stack with one deterministic, energy-conserving
finite-depth sea shared by marine data, coast bathymetry, the CPU surfing
simulation, and the GPU renderer. Swell and wind-sea components remain spread
throughout the ocean. Each component advances continuously, refracts and
shoals over the local bottom, and is depth- and steepness-limited as it breaks.
Natural interference between nearby frequencies creates non-repeating sets
and lulls without switching the rest of the ocean off.

The board now keeps three velocities distinct: crest celerity defines the
stable wave normal and capture frame, orbital flow drives water-relative hull
drag, and breaking-bore transport drives whitewater. This prevents the
orbital half-cycle from reversing the interpreted wave direction. Forecast
bearings that resolve behind a local coastline are also refracted into the
incoming half-plane, so an oblique or ambiguous marine bearing cannot make a
surfable crest run back out to sea. Takeoff timing, lift, rail loading, and
acceleration therefore follow the same moving wave that is visible on screen
without turning crest speed into a conveyor.

A second audit found two subtler sources of the reported “calm-water wipeout.”
Gameplay and foam were following the phase and energy of one spectral
component while the screen showed the sum of all 28; that component could be
at a crest while its visible partition was in a trough. The safety limiter
also added every component's maximum slope as though all 28 peaked
simultaneously, suppressing short-period and multi-partition forecasts. Crest
identity, energy, nonlinear breaking, takeoff, tow release, shorebreak load,
and the surf radar now use the coherent complex sum of the dominant
partition. The steepness limiter now adds spectral slope variance by
root-sum-square. A surfable crest must therefore exist in the water that is
actually drawn, and valid forecast energy is no longer flattened away.

The follow-up replay also exposed an instrumentation trap: the radar sampled
the surfer's current shore/paddle position rather than the physical breaker
contour, while the QA preset changed summary period values without clearing a
stale wind sea and peak-period override. It could therefore display an
8.3-second swell while forecasting a different 15-second spectrum and a
multi-minute lull. Radar forecasts are now anchored at the solved breakpoint,
and the replay resets the complete partition description.

## Why the old waves behaved unnaturally

1. **A fixed set loop.** A hard-coded 24-value energy sequence repeated
   forever. A small cluster was assigned most of the energy, so high-swell
   sessions became a periodic wall pack separated by nearly flat water.
2. **A stationary-looking envelope.** Set energy was indexed from a single
   local phase and then reused for height and the break band. The envelope did
   not have the independent group velocity of a real wave packet, making
   crests appear to inflate and collapse in place.
3. **Artificial crest geometry.** A fifth-power positive crest term forced
   large waves into narrow peaks. Multiple separately tuned Gerstner layers
   then added height without one conserved energy budget.
4. **Generic nearshore geometry.** Every coast used variations of the same
   break-coordinate formula. Sandbars, reef ledges, points, slabs, and the
   Nazaré canyon could not produce their defining refraction or breaking
   behavior.
5. **Visual and gameplay divergence.** Rendering, takeoff windows, board
   forces, and HUD wave identity used related but separate approximations.
   Crest celerity was also used as if it were the water particle velocity,
   over-driving the board.
6. **Single-component crest identity.** Even after the first spectral pass,
   one carrier component selected gameplay crests while the renderer summed
   its whole partition. Destructive interference could therefore make a
   nominal 100% crest visually absent.
7. **Over-conservative slope limiting.** Adding `|a × k|` across all
   components assumed an impossible phase-aligned maximum. It attenuated the
   very short-period, crossed, and high-swell seas that most needed a readable
   face.
8. **Forecasting at the wrong place and from stale partitions.** The radar
   searched at the player even when the player was still on shore, and the
   visual test could retain live wind-sea and peak-period fields after changing
   only the displayed swell period. The countdown, stated forecast, and
   breaker could then refer to three different conditions.

## Replacement model

### Energy-consistent sea state

The marine layer now carries wind sea, primary swell, and optional secondary
and tertiary swells into a session. Their variances are reconciled so that
the combined component bank exactly preserves the reported significant wave
height:

`Hs = 4 × sqrt(total variance)`

Twenty-eight deterministic components span the available frequency and
directional bands. Close frequencies naturally beat against one another,
creating moving wave groups with irregular three-to-eight-wave sets rather
than a repeating on/off sequence. A deterministic seed keeps sessions
replayable.

### Finite-depth propagation

Each component solves the gravity-wave dispersion relation
`ω² = g k tanh(k h)`. As depth changes, the model integrates the local
cross-shore wave number along the bathymetric contour. Integrating phase is
important: multiplying position by a locally changing `k` introduces phase
jumps and waves that appear to breathe in place.

Group velocity controls shoaling. Combined steepness and a 0.78 depth-limited
breaking index prevent foldover and unbounded peaks. Combined steepness is
the significant spectral slope
`2 × sqrt(sum(0.5 × (amplitude × wave number)²))`, rather than the sum of
every component's theoretical maximum. As the ratio approaches
breaking, bounded second-through-fifth bound harmonics sharpen the crest and
pitch its shoreward face. Their amplitude and asymmetry respond to each
break's power, steepness, and hollow character, then decay into a
crest-localized bore/whitewater field after breaking. The sampled surface
provides analytic height, time derivative, gradient, normal, orbital
velocity, celerity, bore velocity, wavelength, breaking ratio, break progress,
whitewater, and regime.

### Coast-specific bathymetry

All 13 coasts and 41 selectable zones now resolve through shared,
differentiable bathymetry:

- Beach breaks use two sand or cobble bars, alongshore bar warp, and channels.
- Reefs use shallow shelves, smooth offshore ledges, channels, and relief.
- Teahupoʻo-style slabs use an abrupt but continuous ledge and shallow shelf.
- Points curve depth contours so refraction produces a running shoulder.
- Nazaré uses a tapered, skewed canyon that retains deep-water energy farther
  shoreward.

The same depth and contour gradients drive phase, shoaling, breaker regime,
gameplay sampling, and the compact GPU tables. Coast behavior therefore
comes from bottom geometry instead of coast-name branches in the wave shader.

### Shared rendering and surfing physics

The renderer receives the exact same 28-component realization as the CPU
bank—without dropping components, regenerating amplitudes, or changing
phases—plus integrated travel phase, local shoaling, steepness limits, depth
limits, and adaptive bathymetry tables. The shader advances every component
with its own angular frequency, applies the same nonlinear breaker transform,
and shades with the displaced-surface normal. It no longer contains the fixed
crest sequence, the artificial crest spike, or a second Gerstner ocean.

Surfing samples the same field. Board response uses orbital water velocity
for drag, surface slope and exact vertical surface rise for gravity and
support, crest celerity for wave identity and pressure direction, and bore
transport for broken-water load. Stable spectral crest IDs replace ordinal
positions in the old repeating set.

The shared crest is the analytic phase of the complete dominant partition,
not whichever individual component happened to be largest offshore. Its
complex amplitude supplies the realized group energy, while a
variance-weighted carrier supplies a stable propagation direction and
celerity. The surf radar searches the next zero-phase crossing of this same
visible group at the solved bathymetric breaker contour, so its countdown and
energy no longer promise a wave that cancels out on screen or measure a
shoreline phase that cannot yet break.

Because a single-valued height field cannot geometrically overturn, the break
also has a synchronized explicit face/lip volume. It follows the solved
finite-depth crest through the physical breaker band, pitches shoreward,
collapses its whitewater down the face, and leaves the aerated trail offshore.
During an engaged ride, a smaller board-level section of the same face remains
anchored to the sampled water and propagation frame, making the slope, lip,
foam pressure, and board position readable together instead of drawing a flat
decal under the surfer.

The optional tow now solves the offshore-most physical
`Hs / (0.78 × depth)` contour rather than subtracting a dimensionless HUD
coordinate from world metres. Craft motion is acceleration- and speed-limited;
a damped seven-metre rope carries the surfer without per-frame position
snapping. During crest acquisition the craft stages at that breaker contour
instead of chasing an oblique crest a full wavelength offshore. The green
release cue requires the live board position to measure a depth-limited front
face, crest phase, slope/rise, and crest-localized whitewater; elapsed tow
progress alone cannot light it. If a crest passes, the tow acquires the next
one instead of auto-releasing into flat water. Release only commits a pop-up
while that physical support remains. A pop-up that loses support settles back
to prone, and rider whitewater emission requires both an engaged ride and real
crest-localized breaking water.

## Expected coast behavior

| Coast class | Expected result |
| --- | --- |
| Beach break | Spaced peaks over bars, channel interruptions, predominantly spilling to plunging transitions |
| Reef shelf | Energy focuses at the ledge, then runs consistently across the shelf without a vertical wall cluster |
| Slab | Later, more abrupt plunge over the ledge while remaining depth-limited |
| Point | Curved, refracted lines with a persistent shoulder and progressive peel |
| Canyon | Energy stays organized through deeper water and focuses shoreward without flattening the surrounding sea |

## Validation

Automated release verification now checks:

- exact significant-height energy conservation across spectral partitions;
- deterministic finite-depth dispersion and integrated phase travel;
- every one of the 13 coasts and 41 zones for finite values, non-flat motion,
  natural breaking transitions, and bounded crest height;
- positive horizontal mapping margin to prevent Gerstner-style foldover;
- analytic surface rise and normal against numerical derivatives;
- dominant phase advection against local celerity;
- bounded orbital velocities and agreement between gameplay and ocean samples;
- spectral-beat sets with three-to-eight surfable waves and bounded lulls;
- coherent visible-group crests that remain above the surface when labeled
  surfable, with the radar forecast resolving the same future crest;
- breakpoint-anchored radar timing and a QA spectrum that resets stale
  peak-period and wind-sea partitions rather than changing display values only;
- root-sum-square spectral steepness, preventing component count from
  flattening a valid multi-partition forecast;
- stable crest direction across a full orbital cycle, including explicit
  regression coverage for reversing particle flow and behind-coast forecast
  bearings;
- acceleration-limited tow motion, bounded rope stretch, physical contour
  staging, live face-gated release, next-crest reacquisition, and rejection of
  flat release water;
- unsupported pop-ups returning prone and engaged-breaker-only whitewater;
- deterministic, identity-preserving 28-component GPU packing, bounded
  CPU/GPU height interpolation error, and coast-specific contour signatures;
  and
- a source contract preventing the fixed 24-crest loop, fifth-power mountain
  spike, or separate Gerstner ocean from returning.

The muted browser pass covers representative reef (Pipeline), beach
(Rockaway), point (Jeffreys Bay), and canyon (Nazaré) sessions. It verifies
continuous ocean movement, spaced wave lines, coast-specific shape, stable
shading, and renderer startup without the prior clustered mountain artifact.

## Remaining high-value improvements

This is a coherent physical foundation, not a full computational-fluid-
dynamics solver. The next realism gains should build on it:

1. Extend the crest-localized bore into a full Eulerian foam transport texture
   so detached whitewater can merge, spread, and decay across multiple waves
   rather than using a shader signal plus rider-local particle persistence.
2. Replace the current synchronized explicit lip meshes with a local
   signed-distance or particle-level-set air/water volume for fully volumetric
   tube closure, splash-sheet breakup, entrained air, and view-correct
   refraction through an overturning lip.
3. Extend the packed bathymetry window or use a clipmap when the player travels
   far alongshore, reducing local linearization error at the distant mesh edge.
4. Calibrate each zone from measured bathymetric grids and buoy spectra where
   licensing and resolution allow, then compare virtual breakpoint and
   celerity against video or instrumented references.
5. Extend the current four hull contacts into distributed pressure and fin
   samples for more accurate trim, rail engagement, cavitation, and recovery
   in turbulent whitewater.
