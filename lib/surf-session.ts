import type { BreakCharacter } from "./beaches";
import {
  type SessionSettings,
  findWaveBreakingContourAt,
  nextVisibleSurfableWaveAt,
  primaryWavePhaseAt,
  primaryWaveVelocityAt,
  waveSurfaceFrameAt,
} from "./game.ts";

export type SurfEntry = {
  elapsed: number;
  x: number;
  z: number;
  heading: number;
  velocityX: number;
  velocityZ: number;
  crestPhase: number;
  crestEnergy: number;
  surfaceHeight: number;
  verticalVelocity: number;
  lineSide: number;
};

/** Quick sessions use a repeatable, fair-weather ocean independent of forecasts. */
export function quickSurfSettings(settings: SessionSettings): SessionSettings {
  return {
    ...settings,
    mode: "playground",
    assist: "guided",
    waveHeight: 1.5,
    wavePeriod: 11,
    waveDirection: settings.coastHeading,
    swellHeight: 1.5,
    swellPeriod: 11,
    swellPeakPeriod: 11,
    swellDirection: settings.coastHeading,
    windWaveHeight: .12,
    windWavePeriod: 4,
    windWavePeakPeriod: 4,
    windWaveDirection: settings.coastHeading,
    secondarySwellHeight: 0,
    tertiarySwellHeight: 0,
    currentStrength: .15,
    currentDirection: settings.coastHeading + 90,
    windSpeed: 6,
    windDirection: (settings.coastHeading + 180) % 360,
    tide: .35,
    timeOfDay: 16,
    weatherCode: 0,
  };
}

/**
 * Find a real, shoaling crest before starting the clock. This is session setup,
 * never an in-ride correction: all subsequent motion belongs to the live solver.
 * The bounded search runs once per drop, not per rendered frame.
 */
export function findSurfEntry(
  settings: SessionSettings,
  character: BreakCharacter,
  sequence = 0,
): SurfEntry | null {
  const tau = Math.PI * 2;
  const startTime = Math.max(0, sequence - 1) * settings.wavePeriod * 12;
  const lineSide = character.line === "LEFT" ? -1
    : character.line === "RIGHT" ? 1 : sequence % 2 === 0 ? 1 : -1;
  let best: SurfEntry | null = null;
  let bestScore = -Infinity;
  for (const anchorX of [-10, 0, 10]) {
    const contour = findWaveBreakingContourAt(anchorX, startTime, settings, character, .86);
    const arrival = nextVisibleSurfableWaveAt(anchorX, contour.z, startTime, settings, character);
    if (!Number.isFinite(arrival.secondsToPeak)) continue;
    const elapsed = startTime + arrival.secondsToPeak;
    const crestPhase = Math.PI * .5 + Math.round((primaryWavePhaseAt(
      anchorX, contour.z, elapsed, settings, character,
    ) - Math.PI * .5) / tau) * tau;
    let crestX = anchorX;
    let crestZ = contour.z;
    for (let iteration = 0; iteration < 4; iteration++) {
      const transport = primaryWaveVelocityAt(crestX, crestZ, elapsed, settings, character);
      const phaseError = primaryWavePhaseAt(crestX, crestZ, elapsed, settings, character) - crestPhase;
      const distance = phaseError * transport.wavelength / tau;
      crestX -= transport.x / transport.speed * distance;
      crestZ -= transport.z / transport.speed * distance;
    }
    const transport = primaryWaveVelocityAt(crestX, crestZ, elapsed, settings, character);
    const nx = transport.x / transport.speed;
    const nz = transport.z / transport.speed;
    for (const distance of [2, 3.5, 5]) {
      const x = crestX + nx * distance;
      const z = crestZ + nz * distance;
      const surface = waveSurfaceFrameAt(x, z, elapsed, settings, character);
      const downhill = -(surface.slopeX * nx + surface.slopeZ * nz);
      const energy = surface.dominant?.crestEnergy ?? 0;
      if (downhill < .035 || energy < .3 || surface.depth < 1) continue;
      const score = Math.min(.55, downhill) * 2 + energy
        - Math.abs(surface.breakingRatio - .86) * .6 - Math.abs(x) * .008;
      if (score <= bestScore) continue;
      bestScore = score;
      // A diagonal entry has already completed its paddle-in before the reveal.
      const velocityX = transport.x * .92 + nz * transport.speed * .6 * lineSide;
      const velocityZ = transport.z * .92 - nx * transport.speed * .6 * lineSide;
      best = {
        elapsed, x, z, velocityX, velocityZ, crestPhase, crestEnergy: energy,
        heading: Math.atan2(velocityX, velocityZ),
        surfaceHeight: surface.height,
        verticalVelocity: surface.verticalVelocity,
        lineSide,
      };
    }
  }
  return best;
}
