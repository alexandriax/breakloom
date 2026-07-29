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

The board now receives the sampled water's slope, vertical rise, and orbital
velocity rather than treating crest travel speed as water velocity. This
makes takeoff timing, lift, rail loading, and acceleration follow the same
moving wave that is visible on screen.

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
breaking index prevent foldover and unbounded peaks. The sampled surface
provides analytic height, time derivative, gradient, normal, orbital
velocity, celerity, wavelength, breaking ratio, and regime.

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

The renderer receives an energy-preserving 20-component subset of the CPU
bank, component parameters, integrated travel phase, local shoaling,
steepness limits, depth limits, and a local bathymetry table. The shader
advances every component with its own angular frequency and shades with the
analytic displaced-surface normal. It no longer contains the fixed crest
sequence, the artificial crest spike, or a second Gerstner ocean.

Surfing samples the same field. Board response uses orbital water velocity,
surface slope, and exact vertical surface rise; crest celerity remains the
speed of the wave form and is not injected as water flow. Stable spectral
crest IDs replace ordinal positions in the old repeating set.

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
- non-repeating wave groups and realistic takeoff opportunities;
- deterministic, energy-preserving GPU packing and coast-specific contour
  signatures; and
- a source contract preventing the fixed 24-crest loop, fifth-power mountain
  spike, or separate Gerstner ocean from returning.

The muted browser pass covers representative reef (Pipeline), beach
(Rockaway), point (Jeffreys Bay), and canyon (Nazaré) sessions. It verifies
continuous ocean movement, spaced wave lines, coast-specific shape, stable
shading, and renderer startup without the prior clustered mountain artifact.

## Remaining high-value improvements

This is a coherent physical foundation, not a full computational-fluid-
dynamics solver. The next realism gains should build on it:

1. Add a separate foam and whitewater transport field so broken-wave energy
   moves shoreward, spreads, decays, and pushes the surfer rather than existing
   mainly as crest shading.
2. Add nonlinear bound harmonics derived from component steepness for more
   asymmetric troughs and pitching lips, while retaining the energy and
   foldover limits.
3. Extend the packed bathymetry window or use a clipmap when the player travels
   far alongshore, reducing local linearization error at the distant mesh edge.
4. Calibrate each zone from measured bathymetric grids and buoy spectra where
   licensing and resolution allow, then compare virtual breakpoint and
   celerity against video or instrumented references.
5. Replace the board's remaining point-sample contacts with several pressure
   samples across the hull and fins for more accurate trim, rail engagement,
   cavitation, and recovery in turbulent whitewater.
