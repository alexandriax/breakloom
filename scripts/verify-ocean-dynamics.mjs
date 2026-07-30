import { BEACHES, getBreakCharacter } from "../lib/beaches.ts";
import {
  primaryWavePhaseAt,
  primaryWaveVelocityAt,
  findWaveBreakingContourAt,
  nextVisibleSurfableWaveAt,
  waveBreakingGeometryAt,
  waveCrestPropertiesAtPhase,
  waveSurfaceFrameAt,
} from "../lib/game.ts";
import {
  coastWaveModelAt,
  maximumVisibleHorizontalDisplacement,
  sampleCoastDominantWave,
  sampleCoastWaveSurface,
} from "../lib/ocean.ts";
import { forecastFaceHeightForBreak } from "../lib/tide.ts";

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
const HIGH_SWELL_CASES = [
  ["pipeline", "First Reef", 5.5, 15],
  ["teahupoo", "The Bowl", 5, 16],
  ["rockaway", "Beach 92nd", 4.2, 13],
  ["jeffreys-bay", "Supertubes", 5, 15],
  ["nazare", "Praia do Norte", 9, 17],
];

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
      || surfableCount > 60
      || longestSurfableRun < 3
      || longestSurfableRun > 8
      || longestLull < 3
      || longestLull > 8
      || firstHalf === secondHalf
    ) {
      throw new Error(
        `${beach.id}/${zone.name} regressed to clustered or repeating scripted sets`,
      );
    }
  }
}

for (
  const [
    coastId,
    zoneName,
    significantHeight,
    peakPeriod,
  ] of HIGH_SWELL_CASES
) {
  const beach = BEACHES.find((candidate) => candidate.id === coastId);
  if (!beach) throw new Error(`Missing high-swell coast ${coastId}`);
  const settings = {
    ...sessionFor(beach),
    waveHeight: significantHeight,
    wavePeriod: peakPeriod,
    swellHeight: significantHeight * .9,
    swellPeriod: peakPeriod,
    windSpeed: Math.max(9, beach.fallback.windSpeed),
  };
  const character = getBreakCharacter(coastId, zoneName);
  const breakingContour = findWaveBreakingContourAt(
    0,
    0,
    settings,
    character,
    .95,
  );
  if (breakingContour.ratioError > .002) {
    throw new Error(
      `${coastId}/${zoneName} could not locate the physical breaker contour`,
    );
  }
  const temporalHeights = [];
  const regimes = new Set();
  const offshoreRegimes = new Set();
  const nearshoreRegimes = new Set();
  let maximumBreakerSlope = 0;
  let maximumWhitewater = 0;
  const visibleSurfableCrests = [];
  for (let step = 0; step <= 288; step += 1) {
    const time = step * peakPeriod / 24;
    const temporalSurface = sampleCoastWaveSurface(
      0,
      -180,
      time,
      settings,
      character,
    );
    temporalHeights.push(temporalSurface.height);
    const breakerSurface = sampleCoastWaveSurface(
      0,
      breakingContour.z,
      time,
      settings,
      character,
    );
    maximumBreakerSlope = Math.max(
      maximumBreakerSlope,
      Math.hypot(
        breakerSurface.gradientX,
        breakerSurface.gradientZ,
      ),
    );
    maximumWhitewater = Math.max(
      maximumWhitewater,
      breakerSurface.whitewater,
    );
    const dominant = breakerSurface.dominant;
    if (
      dominant
      && dominant.crestEnergy >= .52
      && Math.abs(angleDifference(dominant.phase, 0)) <= .16
    ) {
      visibleSurfableCrests.push({
        height: breakerSurface.height,
        slope: Math.hypot(
          breakerSurface.gradientX,
          breakerSurface.gradientZ,
        ),
        whitewater: breakerSurface.whitewater,
      });
    }
    if (step > 16 && step % 12 !== 0) continue;
    for (
      const z of [-1000, -520, -260, -140, -82, -48, -28, -16]
    ) {
      const surface = sampleCoastWaveSurface(
        0,
        z,
        time,
        settings,
        character,
      );
      regimes.add(surface.regime);
      if (z <= -520) offshoreRegimes.add(surface.regime);
      if (z >= -48) nearshoreRegimes.add(surface.regime);
      if (
        !Number.isFinite(surface.height)
        || surface.horizontalJacobianMargin <= .015
        || Math.abs(surface.height)
          > significantHeight * 1.65 + .25
      ) {
        throw new Error(
          `${coastId}/${zoneName} produced an unstable high-swell surface`,
        );
      }
    }
  }
  if (
    visibleSurfableCrests.length < 3
    || visibleSurfableCrests.some((crest) => crest.height <= .08)
  ) {
    throw new Error(
      `${coastId}/${zoneName} labeled a visually absent crest as surfable`,
    );
  }
  const strongestVisibleCrest = visibleSurfableCrests.reduce(
    (best, crest) => (
      crest.slope + crest.whitewater * 2
        > best.slope + best.whitewater * 2
        ? crest
        : best
    ),
  );
  if (
    Math.max(...temporalHeights) - Math.min(...temporalHeights)
      < significantHeight * .35
  ) {
    throw new Error(
      `${coastId}/${zoneName} high swell rose and fell too little to be traveling water`,
    );
  }
  if (
    [...offshoreRegimes].every(
      (regime) => regime === "breaking" || regime === "broken",
    )
    || [...nearshoreRegimes].every(
      (regime) => regime === "deep" || regime === "shoaling",
    )
  ) {
    throw new Error(
      `${coastId}/${zoneName} high swell lost its offshore-to-break transition`,
    );
  }
  if (
    maximumBreakerSlope < .105
    || maximumWhitewater < .08
    || strongestVisibleCrest.slope < .09
    || strongestVisibleCrest.whitewater < .08
  ) {
    throw new Error(
      `${coastId}/${zoneName} reached breaking depth without a pitched face and crest-localized whitewater `
        + `(all slope=${maximumBreakerSlope.toFixed(3)}, all foam=${maximumWhitewater.toFixed(3)}, `
        + `surfable slope=${strongestVisibleCrest.slope.toFixed(3)}, `
        + `surfable foam=${strongestVisibleCrest.whitewater.toFixed(3)})`,
    );
  }
}

let minimumForecastFaceRatio = Infinity;
let maximumForecastFaceRatio = 0;
let minimumSpatialFaceRatio = Infinity;
let maximumSpatialFaceRatio = 0;
let minimumLocalWallRatio = Infinity;
let maximumLocalWallRatio = 0;
const REFERENCE_ADULT_SURFER_HEIGHT_METERS = 1.72;
for (const beach of BEACHES) {
  const settings = sessionFor(beach);
  const zone = beach.zones[0];
  const character = getBreakCharacter(beach.id, zone.name);
  const targetFaceHeight = forecastFaceHeightForBreak(
    settings.waveHeight,
    settings.tide,
    character,
  );
  const breakingContour = findWaveBreakingContourAt(
    0,
    0,
    settings,
    character,
    .9,
  );
  const realizedFaces = [];
  const spatialFaces = [];
  const localWallHeights = [];
  let arrivalCursor = 0;
  for (let crestIndex = 0; crestIndex < 8; crestIndex += 1) {
    const next = nextVisibleSurfableWaveAt(
      0,
      breakingContour.z,
      arrivalCursor,
      settings,
      character,
    );
    const arrivalTime = arrivalCursor + next.secondsToPeak;
    const crest = sampleCoastWaveSurface(
      0,
      breakingContour.z,
      arrivalTime,
      settings,
      character,
    );
    let troughHeight = Infinity;
    for (let step = -30; step <= 30; step += 1) {
      const surface = sampleCoastWaveSurface(
        0,
        breakingContour.z,
        arrivalTime + step * settings.wavePeriod / 60,
        settings,
        character,
      );
      troughHeight = Math.min(troughHeight, surface.height);
    }
    realizedFaces.push(Math.max(0, crest.height - troughHeight));
    const dominant = sampleCoastDominantWave(
      0,
      breakingContour.z,
      arrivalTime,
      settings,
      character,
    );
    if (!dominant) {
      throw new Error(
        `${beach.id}/${zone.name} lost its dominant wave at the breaking contour`,
      );
    }
    const scanRadius = Math.min(34, dominant.wavelength * .58);
    const spatialSamples = [];
    for (let step = -72; step <= 72; step += 1) {
      const distance = step * scanRadius / 72;
      const surface = sampleCoastWaveSurface(
        dominant.directionX * distance,
        breakingContour.z + dominant.directionZ * distance,
        arrivalTime,
        settings,
        character,
      );
      spatialSamples.push({ distance, height: surface.height });
    }
    const spatialCrest = spatialSamples.reduce(
      (highest, sample) => (
        sample.height > highest.height ? sample : highest
      ),
    );
    const spatialTrough = spatialSamples.reduce(
      (lowest, sample) => (
        sample.height < lowest.height ? sample : lowest
      ),
    );
    spatialFaces.push(spatialCrest.height - spatialTrough.height);
    const wallReach = Math.max(
      9,
      Math.min(18, targetFaceHeight * 4.8),
    );
    const localTrough = spatialSamples
      .filter(
        (sample) => (
          Math.abs(sample.distance - spatialCrest.distance) <= wallReach
        ),
      )
      .reduce(
        (lowest, sample) => (
          sample.height < lowest ? sample.height : lowest
        ),
        Infinity,
      );
    localWallHeights.push(spatialCrest.height - localTrough);
    const displacement = Math.hypot(
      crest.displacementX,
      crest.displacementZ,
    );
    if (
      displacement
        > maximumVisibleHorizontalDisplacement(targetFaceHeight) + 1e-9
    ) {
      throw new Error(
        `${beach.id}/${zone.name} shifted its visible crest away from board contact`,
      );
    }
    arrivalCursor = arrivalTime + settings.wavePeriod * .32;
  }
  realizedFaces.sort((left, right) => left - right);
  spatialFaces.sort((left, right) => left - right);
  localWallHeights.sort((left, right) => left - right);
  const medianFace = realizedFaces[Math.floor(realizedFaces.length / 2)];
  const medianSpatialFace =
    spatialFaces[Math.floor(spatialFaces.length / 2)];
  const medianLocalWall =
    localWallHeights[Math.floor(localWallHeights.length / 2)];
  const faceRatio = medianFace / Math.max(.1, targetFaceHeight);
  const spatialFaceRatio =
    medianSpatialFace / Math.max(.1, targetFaceHeight);
  minimumForecastFaceRatio = Math.min(
    minimumForecastFaceRatio,
    faceRatio,
  );
  maximumForecastFaceRatio = Math.max(
    maximumForecastFaceRatio,
    faceRatio,
  );
  minimumSpatialFaceRatio = Math.min(
    minimumSpatialFaceRatio,
    spatialFaceRatio,
  );
  maximumSpatialFaceRatio = Math.max(
    maximumSpatialFaceRatio,
    spatialFaceRatio,
  );
  const localWallRatio =
    medianLocalWall / Math.max(.1, targetFaceHeight);
  minimumLocalWallRatio = Math.min(
    minimumLocalWallRatio,
    localWallRatio,
  );
  maximumLocalWallRatio = Math.max(
    maximumLocalWallRatio,
    localWallRatio,
  );
  if (faceRatio < .82 || faceRatio > 1.75) {
    throw new Error(
      `${beach.id}/${zone.name} realized ${medianFace.toFixed(2)}m `
        + `against a ${targetFaceHeight.toFixed(2)}m face forecast`,
    );
  }
  if (spatialFaceRatio < .78 || spatialFaceRatio > 1.95) {
    throw new Error(
      `${beach.id}/${zone.name} spatial wall measured `
        + `${medianSpatialFace.toFixed(2)}m against a `
        + `${targetFaceHeight.toFixed(2)}m face forecast`,
    );
  }
  if (
    targetFaceHeight >= 2.25
    && medianLocalWall < Math.max(
      REFERENCE_ADULT_SURFER_HEIGHT_METERS,
      targetFaceHeight * .78,
    )
  ) {
    throw new Error(
      `${beach.id}/${zone.name} forecast a `
        + `${targetFaceHeight.toFixed(2)}m face but its visible local wall `
        + `was only ${medianLocalWall.toFixed(2)}m tall`,
    );
  }
}

const forecastBeach = BEACHES.find((beach) => beach.id === "pipeline");
if (!forecastBeach) throw new Error("Missing Pipeline forecast regression coast");
const forecastSettings = sessionFor(forecastBeach);
const forecastCharacter = getBreakCharacter("pipeline", "First Reef");
const forecastContour = findWaveBreakingContourAt(
  0,
  0,
  forecastSettings,
  forecastCharacter,
  .9,
);
const visibleForecast = nextVisibleSurfableWaveAt(
  0,
  forecastContour.z,
  0,
  forecastSettings,
  forecastCharacter,
);
if (
  !Number.isFinite(visibleForecast.secondsToPeak)
  || visibleForecast.secondsToPeak
    > forecastSettings.wavePeriod * 48
) {
  throw new Error(
    "visible-set forecast did not find a bounded surfable group crest",
  );
}
const forecastCrest = sampleCoastWaveSurface(
  0,
  forecastContour.z,
  visibleForecast.secondsToPeak,
  forecastSettings,
  forecastCharacter,
);
if (
  !forecastCrest.dominant
  || forecastCrest.dominant.crestEnergy < .45
  || Math.abs(angleDifference(forecastCrest.dominant.phase, 0)) > .002
) {
  throw new Error(
    "HUD forecast diverged from the next realized visible group crest",
  );
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
  highSwellCases: HIGH_SWELL_CASES.length,
  forecastFaceRatio:
    `${minimumForecastFaceRatio.toFixed(2)}–${maximumForecastFaceRatio.toFixed(2)}`,
  spatialFaceRatio:
    `${minimumSpatialFaceRatio.toFixed(2)}–${maximumSpatialFaceRatio.toFixed(2)}`,
  localWallRatio:
    `${minimumLocalWallRatio.toFixed(2)}–${maximumLocalWallRatio.toFixed(2)}`,
  benchmarkMilliseconds: benchmarkMilliseconds.toFixed(1),
});
