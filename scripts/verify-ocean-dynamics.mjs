import { BEACHES, getBreakCharacter } from "../lib/beaches.ts";
import {
  primaryWavePhaseAt,
  primaryWaveVelocityAt,
  waveBreakingGeometryAt,
  waveCrestPropertiesAtPhase,
  waveSurfaceFrameAt,
} from "../lib/game.ts";
import {
  coastWaveModelAt,
  sampleCoastWaveSurface,
} from "../lib/ocean.ts";

const TAU = Math.PI * 2;

function sessionFor(beach) {
  return {
    mode: "training",
    assist: "guided",
    board: "performance",
    waveHeight: beach.fallback.waveHeight,
    wavePeriod: beach.fallback.wavePeriod,
    waveDirection: beach.fallback.waveDirection,
    swellHeight: beach.fallback.waveHeight * .82,
    swellPeriod: beach.fallback.wavePeriod,
    swellDirection: beach.fallback.waveDirection,
    currentStrength: .35,
    currentDirection: beach.heading,
    windSpeed: beach.fallback.windSpeed,
    windDirection: beach.heading + 12,
    waterTemperature: beach.fallback.waterTemperature,
    airTemperature: beach.fallback.waterTemperature + 3,
    coastHeading: beach.heading,
    tide: 0,
    timeOfDay: 15,
    weatherCode: 1,
  };
}

function angleDifference(left, right) {
  return Math.atan2(
    Math.sin(left - right),
    Math.cos(left - right),
  );
}

function relativeError(actual, expected, floor = .025) {
  return Math.abs(actual - expected)
    / Math.max(floor, Math.abs(expected));
}

const coastBreakSignatures = new Set();
let zoneCount = 0;
let minimumJacobian = Infinity;
let maximumDerivativeError = 0;
let maximumPhaseAdvectionError = 0;

for (const beach of BEACHES) {
  const settings = sessionFor(beach);
  for (const zone of beach.zones) {
    zoneCount += 1;
    const character = getBreakCharacter(beach.id, zone.name);
    const model = coastWaveModelAt(0, settings, character);
    const energyError = Math.abs(
      model.bank.significantHeight - settings.waveHeight,
    );
    if (energyError > 1e-10) {
      throw new Error(
        `${beach.id}/${zone.name} violated the Hs energy budget: ${energyError}`,
      );
    }

    const breakSamples = [];
    const heightSamples = [];
    for (const x of [-120, 0, 120]) {
      for (const z of [-900, -320, -170, -110, -72, -48, -30, -18, -7]) {
        const surface = sampleCoastWaveSurface(
          x,
          z,
          31.25,
          settings,
          character,
        );
        const numbers = Object.values(surface).filter(
          (value) => typeof value === "number",
        );
        if (!numbers.every(Number.isFinite)) {
          throw new Error(
            `${beach.id}/${zone.name} produced a non-finite surface at ${x},${z}`,
          );
        }
        if (
          Math.abs(surface.height)
            > settings.waveHeight * 1.65 + Math.abs(settings.tide) + .25
        ) {
          throw new Error(
            `${beach.id}/${zone.name} produced an unbounded mountain crest`,
          );
        }
        if (surface.horizontalJacobianMargin <= .015) {
          throw new Error(
            `${beach.id}/${zone.name} folded its horizontal wave mapping`,
          );
        }
        minimumJacobian = Math.min(
          minimumJacobian,
          surface.horizontalJacobianMargin,
        );
        heightSamples.push(surface.height);
        if (x === 0) {
          breakSamples.push({
            z,
            coordinate: waveBreakingGeometryAt(
              x,
              z,
              31.25,
              settings,
              character,
            ).breakingCoordinate,
          });
        }
      }
    }
    if (
      Math.max(...heightSamples) - Math.min(...heightSamples)
        < Math.max(.16, settings.waveHeight * .16)
    ) {
      throw new Error(
        `${beach.id}/${zone.name} left the sampled ocean implausibly flat`,
      );
    }
    if (
      Math.min(...breakSamples.map((sample) => sample.coordinate)) > -20
      || Math.max(...breakSamples.map((sample) => sample.coordinate)) < -10
    ) {
      throw new Error(
        `${beach.id}/${zone.name} never crossed a natural breaking transition`,
      );
    }
    const closestBreak = breakSamples.reduce((best, sample) => (
      Math.abs(sample.coordinate + 12)
        < Math.abs(best.coordinate + 12)
        ? sample
        : best
    ));
    coastBreakSignatures.add(
      `${beach.id}:${Math.round(closestBreak.z / 6) * 6}`,
    );

    const x = 1.25;
    const z = -118;
    const time = 28.4;
    const step = .025;
    const surface = sampleCoastWaveSurface(
      x,
      z,
      time,
      settings,
      character,
    );
    const heightBefore = sampleCoastWaveSurface(
      x,
      z,
      time - step,
      settings,
      character,
    ).height;
    const heightAfter = sampleCoastWaveSurface(
      x,
      z,
      time + step,
      settings,
      character,
    ).height;
    const numericalRise = (heightAfter - heightBefore) / (2 * step);
    const riseError = relativeError(
      surface.timeDerivative,
      numericalRise,
      .06,
    );
    maximumDerivativeError = Math.max(
      maximumDerivativeError,
      riseError,
    );
    if (riseError > .05) {
      throw new Error(
        `${beach.id}/${zone.name} surface-rise derivative drifted ${(riseError * 100).toFixed(1)}%`,
      );
    }

    const spaceStep = .04;
    const numericalSlopeX = (
      sampleCoastWaveSurface(
        x + spaceStep,
        z,
        time,
        settings,
        character,
      ).height
      - sampleCoastWaveSurface(
        x - spaceStep,
        z,
        time,
        settings,
        character,
      ).height
    ) / (spaceStep * 2);
    const numericalSlopeZ = (
      sampleCoastWaveSurface(
        x,
        z + spaceStep,
        time,
        settings,
        character,
      ).height
      - sampleCoastWaveSurface(
        x,
        z - spaceStep,
        time,
        settings,
        character,
      ).height
    ) / (spaceStep * 2);
    if (
      relativeError(surface.gradientX, numericalSlopeX, .08) > .05
      || relativeError(surface.gradientZ, numericalSlopeZ, .08) > .05
    ) {
      throw new Error(
        `${beach.id}/${zone.name} surface normal diverged from the displaced water`,
      );
    }

    const transport = primaryWaveVelocityAt(
      x,
      z,
      time,
      settings,
      character,
    );
    const phase = primaryWavePhaseAt(
      x,
      z,
      time,
      settings,
      character,
    );
    const advectionStep = .01;
    const advectedPhase = primaryWavePhaseAt(
      x + transport.x * advectionStep,
      z + transport.z * advectionStep,
      time + advectionStep,
      settings,
      character,
    );
    const phaseError = Math.abs(
      angleDifference(advectedPhase, phase),
    );
    maximumPhaseAdvectionError = Math.max(
      maximumPhaseAdvectionError,
      phaseError,
    );
    if (phaseError > .015) {
      throw new Error(
        `${beach.id}/${zone.name} visible crest and reported celerity diverged`,
      );
    }
    if (
      Math.hypot(transport.waterX, transport.waterZ)
        > Math.max(2.5, transport.speed * .96)
    ) {
      throw new Error(
        `${beach.id}/${zone.name} orbital water flow exceeded crest transport`,
      );
    }

    const frame = waveSurfaceFrameAt(
      x,
      z,
      time,
      settings,
      character,
    );
    if (
      frame.height !== surface.height
      || frame.surfaceRise !== surface.timeDerivative
      || frame.waterVelocityX !== surface.horizontalVelocityX
      || frame.waterVelocityZ !== surface.horizontalVelocityZ
    ) {
      throw new Error(
        `${beach.id}/${zone.name} gameplay stopped sampling the visible water state`,
      );
    }

    const crestPattern = Array.from({ length: 96 }, (_, index) =>
      waveCrestPropertiesAtPhase(
        Math.PI * .5 - index * TAU,
        settings,
        character,
      ));
    const surfableCount = crestPattern.filter(
      (crest) => crest.surfable,
    ).length;
    let longestSurfableRun = 0;
    let longestLull = 0;
    let surfableRun = 0;
    let lullRun = 0;
    for (const crest of crestPattern) {
      surfableRun = crest.surfable ? surfableRun + 1 : 0;
      lullRun = crest.surfable ? 0 : lullRun + 1;
      longestSurfableRun = Math.max(
        longestSurfableRun,
        surfableRun,
      );
      longestLull = Math.max(longestLull, lullRun);
    }
    const firstHalf = crestPattern
      .slice(0, 48)
      .map((crest) => crest.energy.toFixed(4))
      .join(",");
    const secondHalf = crestPattern
      .slice(48)
      .map((crest) => crest.energy.toFixed(4))
      .join(",");
    if (
      surfableCount < 6
      || surfableCount > 52
      || longestSurfableRun > 9
      || longestLull < 3
      || firstHalf === secondHalf
    ) {
      throw new Error(
        `${beach.id}/${zone.name} regressed to clustered or repeating scripted sets`,
      );
    }
  }
}

if (coastBreakSignatures.size < BEACHES.length) {
  throw new Error(
    "Coast-specific bathymetry stopped producing distinct break signatures",
  );
}

const performanceBeach = BEACHES.find(
  (beach) => beach.id === "pipeline",
);
const performanceSettings = sessionFor(performanceBeach);
const performanceCharacter = getBreakCharacter(
  performanceBeach.id,
  "First Reef",
);
for (let index = 0; index < 24; index += 1) {
  sampleCoastWaveSurface(
    index % 12,
    -150 + index,
    index / 60,
    performanceSettings,
    performanceCharacter,
  );
}
const benchmarkStart = performance.now();
for (let index = 0; index < 500; index += 1) {
  sampleCoastWaveSurface(
    index % 24,
    -170 + index % 80,
    index / 60,
    performanceSettings,
    performanceCharacter,
  );
}
const benchmarkMilliseconds = performance.now() - benchmarkStart;
if (benchmarkMilliseconds > 650) {
  throw new Error(
    `Shared coast-wave sampling exceeded its runtime budget: ${benchmarkMilliseconds.toFixed(1)}ms`,
  );
}

console.log("ocean dynamics verified", {
  coasts: BEACHES.length,
  zones: zoneCount,
  minimumJacobian: minimumJacobian.toFixed(3),
  maximumDerivativeError: `${(maximumDerivativeError * 100).toFixed(2)}%`,
  maximumPhaseAdvectionError:
    maximumPhaseAdvectionError.toExponential(2),
  benchmarkMilliseconds: benchmarkMilliseconds.toFixed(1),
});
