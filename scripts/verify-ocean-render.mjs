import assert from "node:assert/strict";
import {
  bathymetryContourCoordinateAt,
  bathymetryDepthAt,
  shorelineReferenceAt,
} from "../lib/bathymetry.ts";
import { getBreakCharacter } from "../lib/beaches.ts";
import {
  MAX_RENDER_WAVE_COMPONENTS,
  OCEAN_BATHYMETRY_COASTAL_Z,
  OCEAN_BATHYMETRY_RENDER_WIDTH,
  OCEAN_BATHYMETRY_ROWS,
  OCEAN_BATHYMETRY_X_COUNT,
  OCEAN_BATHYMETRY_X_HALF_SPAN,
  OCEAN_BATHYMETRY_X_STEP,
  createOceanRenderState,
  packedBathymetryXInterpolation,
  samplePackedAggregate,
  samplePackedBathymetry,
  samplePackedOceanHeight,
  samplePackedTravel,
} from "../lib/ocean-render.ts";
import {
  OCEAN_SHORELINE_WORLD_Z,
  OCEAN_WAVE_PROFILE_X,
  applyOceanShoreTransition,
  coastWaveModelAt,
  oceanTideShorelineShift,
  sampleCoastWaveSurface,
} from "../lib/ocean.ts";
import { forecastFaceHeightForBreak } from "../lib/tide.ts";
import {
  solveFiniteDepthWaveNumber,
  varianceToSignificantHeight,
} from "../lib/waves.ts";

const SETTINGS = {
  waveHeight: 2.6,
  wavePeriod: 14,
  waveDirection: 285,
  windWaveHeight: 1.05,
  windWavePeriod: 7,
  windWavePeakPeriod: 7.4,
  windWaveDirection: 300,
  swellHeight: 2.25,
  swellPeriod: 14,
  swellPeakPeriod: 14.6,
  swellDirection: 282,
  secondarySwellHeight: .72,
  secondarySwellPeriod: 10.5,
  secondarySwellDirection: 318,
  tertiarySwellHeight: .38,
  tertiarySwellPeriod: 8.2,
  tertiarySwellDirection: 248,
  windSpeed: 11,
  windDirection: 305,
  coastHeading: 270,
  tide: .45,
};

const CASES = [
  ["rockaway", "Beach 92nd", -47],
  ["pipeline", "First Reef", 18],
  ["teahupoo", "The Bowl", -12],
  ["jeffreys-bay", "Supertubes", 61],
  ["nazare", "Praia do Norte", 0],
];

function nearlyEqual(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual} != ${expected} ± ${tolerance}`,
  );
}

function assertFiniteTable(table, label) {
  assert.equal(table.channels, 4, `${label} is not RGBA`);
  assert.equal(table.data.length, table.width * table.height * 4);
  for (const value of table.data) {
    assert.ok(Number.isFinite(value), `${label} contains ${value}`);
  }
}

function assertIdenticalFloat32(left, right, label) {
  assert.equal(left.length, right.length, `${label} length changed`);
  assert.equal(
    Buffer.compare(
      Buffer.from(left.buffer, left.byteOffset, left.byteLength),
      Buffer.from(right.buffer, right.byteOffset, right.byteLength),
    ),
    0,
    `${label} is not deterministic`,
  );
}

function worldZFromCoastalZ(coastalZ, tide) {
  return coastalZ
    + OCEAN_SHORELINE_WORLD_Z
    + oceanTideShorelineShift(tide);
}

for (const [coastId, zoneName, x] of CASES) {
  const character = getBreakCharacter(coastId, zoneName);
  const state = createOceanRenderState(SETTINGS, character, x);
  const again = createOceanRenderState(SETTINGS, character, x);
  const label = `${coastId}:${zoneName}`;

  assert.equal(state.coastId, coastId);
  assert.equal(state.zoneName, zoneName);
  assert.equal(
    state.profileX,
    x,
    `${label} render center was quantized`,
  );
  assert.equal(state.bathymetry.width, OCEAN_BATHYMETRY_COASTAL_Z.length);
  assert.equal(
    state.bathymetry.height,
    OCEAN_BATHYMETRY_X_COUNT * OCEAN_BATHYMETRY_ROWS,
  );
  assert.equal(state.bathymetry.xStep, OCEAN_BATHYMETRY_X_STEP);
  assert.equal(state.bathymetry.xCount, OCEAN_BATHYMETRY_X_COUNT);
  assert.equal(
    state.bathymetry.xMin,
    Math.floor(
      (x - OCEAN_BATHYMETRY_X_HALF_SPAN) / OCEAN_BATHYMETRY_X_STEP,
    ) * OCEAN_BATHYMETRY_X_STEP,
  );
  assert.ok(
    Math.abs(state.bathymetry.xMin % OCEAN_BATHYMETRY_X_STEP) < 1e-12,
    `${label} bathymetry x grid is not globally anchored`,
  );
  const bathymetryXMax = state.bathymetry.xMin
    + (state.bathymetry.xCount - 1) * state.bathymetry.xStep;
  assert.ok(
    x - OCEAN_BATHYMETRY_RENDER_WIDTH * .5 >= state.bathymetry.xMin,
    `${label} bathymetry misses the left side of the visible ocean`,
  );
  assert.ok(
    x + OCEAN_BATHYMETRY_RENDER_WIDTH * .5 <= bathymetryXMax,
    `${label} bathymetry misses the right side of the visible ocean`,
  );
  assert.ok(
    (state.bathymetry.xCount - 1) * state.bathymetry.xStep
      > OCEAN_BATHYMETRY_RENDER_WIDTH,
    `${label} bathymetry has no recenter margin`,
  );
  assert.deepEqual(
    packedBathymetryXInterpolation(state.bathymetry, state.bathymetry.xMin),
    { low: 0, high: 1, blend: 0 },
  );
  assert.deepEqual(
    packedBathymetryXInterpolation(state.bathymetry, bathymetryXMax),
    {
      low: state.bathymetry.xCount - 1,
      high: state.bathymetry.xCount - 1,
      blend: 0,
    },
  );

  const fixedProfileModel = coastWaveModelAt(x, SETTINGS, character);
  assert.equal(
    fixedProfileModel.profileX,
    OCEAN_WAVE_PROFILE_X,
    `${label} wave profile did not use the fixed coast/zone reference`,
  );
  for (const profileQueryX of [
    x - 310,
    -12.0001,
    -11.9999,
    -.0001,
    .0001,
    11.9999,
    12.0001,
    x + 310,
  ]) {
    const queryModel = coastWaveModelAt(
      profileQueryX,
      SETTINGS,
      character,
    );
    assert.equal(queryModel.profileX, OCEAN_WAVE_PROFILE_X);
    assert.strictEqual(
      queryModel.profile,
      fixedProfileModel.profile,
      `${label} changed wave travel profile at x=${profileQueryX}`,
    );
  }
  nearlyEqual(
    state.targetFaceHeight,
    forecastFaceHeightForBreak(
      SETTINGS.waveHeight,
      SETTINGS.tide,
      character,
    ),
    1e-12,
    `${label} forecast/mesh face target`,
  );
  assert.ok(state.componentBank.count <= MAX_RENDER_WAVE_COMPONENTS);
  assert.equal(state.componentBank.count, MAX_RENDER_WAVE_COMPONENTS);
  assert.ok(state.componentBank.dominantIndex >= 0, `${label} lost dominant component`);
  const dominantComponent =
    state.componentBank.components[state.componentBank.dominantIndex];
  const expectedDominantPartitionTag = (
    dominantComponent.kind === "swell" ? 1 : -1
  ) * (dominantComponent.partitionId + 1);
  assert.equal(
    state.componentBank.dominantPartitionTag,
    expectedDominantPartitionTag,
    `${label} lost its signed dominant spectral partition`,
  );
  assert.ok(
    new Set(state.componentBank.components.map((component) => component.partitionId)).size >= 3,
    `${label} failed to preserve spectral partitions`,
  );
  assertFiniteTable(state.componentBank.parameters, `${label} component parameters`);
  assertFiniteTable(state.travel, `${label} travel`);
  assertFiniteTable(state.aggregate, `${label} aggregate`);
  assertFiniteTable(state.bathymetry, `${label} bathymetry`);
  const sourceBank = coastWaveModelAt(x, SETTINGS, character).bank;
  assert.deepEqual(
    state.componentBank.components.map((component) => component.sourceId),
    sourceBank.components.map((component) => component.id),
    `${label} renderer did not retain the exact CPU realization`,
  );
  for (const component of state.componentBank.components) {
    const packedPartitionTag = state.componentBank.parameters.data[
      (MAX_RENDER_WAVE_COMPONENTS + component.id) * 4 + 3
    ];
    assert.equal(
      packedPartitionTag,
      (component.kind === "swell" ? 1 : -1)
        * (component.partitionId + 1),
      `${label} component ${component.id} lost its packed partition tag`,
    );
    nearlyEqual(
      component.amplitude,
      sourceBank.components[component.sourceId].amplitude,
      1e-12,
      `${label} component ${component.id} amplitude`,
    );
    nearlyEqual(
      component.phaseOffset,
      sourceBank.components[component.sourceId].phaseOffset,
      1e-12,
      `${label} component ${component.id} phase`,
    );
  }

  assert.ok(
    state.travel.width >= 24 && state.travel.width <= 80,
    `${label} travel table is not an adaptive 24–80 knots`,
  );
  for (let knot = 1; knot < state.travel.contourKnots.length; knot += 1) {
    assert.ok(
      state.travel.contourKnots[knot] > state.travel.contourKnots[knot - 1],
      `${label} contour knots are not strictly monotonic`,
    );
  }
  for (let knot = 1; knot < state.bathymetry.coastalZKnots.length; knot += 1) {
    assert.ok(
      state.bathymetry.coastalZKnots[knot] > state.bathymetry.coastalZKnots[knot - 1],
      `${label} coastal-z knots are not strictly monotonic`,
    );
  }

  const variance = state.componentBank.components.reduce(
    (sum, component) => sum + component.variance,
    0,
  );
  nearlyEqual(
    varianceToSignificantHeight(variance),
    SETTINGS.waveHeight,
    1e-10,
    `${label} capped component Hs budget`,
  );
  nearlyEqual(
    state.componentBank.significantHeight,
    SETTINGS.waveHeight,
    1e-10,
    `${label} bank Hs`,
  );
  nearlyEqual(
    state.aggregate.data[0],
    SETTINGS.waveHeight,
    2e-5,
    `${label} offshore aggregate Hs`,
  );

  // The derivative of linearly interpolated packed phase is its interval
  // secant. It should agree with the local packed k at the interval midpoint.
  for (const componentIndex of [0, state.componentBank.dominantIndex, 19]) {
    for (let knot = 0; knot < state.travel.width - 1; knot += 2) {
      const startZ = state.travel.contourKnots[knot];
      const endZ = state.travel.contourKnots[knot + 1];
      const middleZ = (startZ + endZ) * .5;
      const start = samplePackedTravel(state, componentIndex, startZ);
      const end = samplePackedTravel(state, componentIndex, endZ);
      const derivative = (end.phaseIntegral - start.phaseIntegral) / (endZ - startZ);
      const component = state.componentBank.components[componentIndex];
      const middleDepth = samplePackedAggregate(state, middleZ).depth;
      const fullWaveNumber = solveFiniteDepthWaveNumber(
        component.angularFrequency,
        middleDepth,
      );
      const expectedCrossShoreK = component.crossShoreSign * Math.sqrt(Math.max(
        1e-12,
        fullWaveNumber * fullWaveNumber
          - component.alongshoreWaveNumber * component.alongshoreWaveNumber,
      ));
      nearlyEqual(
        derivative,
        expectedCrossShoreK,
        Math.max(.002, Math.abs(expectedCrossShoreK) * .12),
        `${label} component ${componentIndex} physical phase derivative at knot ${knot}`,
      );
    }
  }

  for (let knot = 0; knot < state.travel.width; knot += 1) {
    const z = state.travel.contourKnots[knot];
    const aggregate = samplePackedAggregate(state, z);
    assert.ok(aggregate.rawSignificantHeight >= 0);
    assert.ok(aggregate.steepnessScale > 0 && aggregate.steepnessScale <= 1);
    assert.ok(aggregate.depth > 0);
    assert.ok(aggregate.depthScale > 0 && aggregate.depthScale <= 1);
  }

  let maximumContourError = 0;
  let maximumDepthError = 0;
  let maximumShorelineError = 0;
  let maximumNearshoreContourError = 0;
  let maximumNearshoreDepthError = 0;
  const fullVisibleOffsets = [-310, -240, -120, 0, 120, 240, 310];
  for (const sampleX of fullVisibleOffsets.map((offset) => x + offset)) {
    for (const coastalZ of [
      -900, -300, -180, -105, -70, -44, -31, -20, -15, -7, -4, 0, 3, 8, 12,
    ]) {
      const sample = samplePackedBathymetry(state, sampleX, coastalZ);
      for (const value of Object.values(sample)) {
        assert.ok(Number.isFinite(value), `${label} sampled bathymetry is not finite`);
      }
      assert.ok(sample.depth > 0, `${label} packed bathymetry is not positive`);
      const exactContour = bathymetryContourCoordinateAt(
        coastId,
        zoneName,
        sampleX,
        coastalZ,
      );
      const exactDepth = bathymetryDepthAt(
        coastId,
        zoneName,
        sampleX,
        coastalZ,
      );
      const exactShoreline = shorelineReferenceAt(
        coastId,
        zoneName,
        sampleX,
      );
      maximumContourError = Math.max(
        maximumContourError,
        Math.abs(sample.contourCoordinate - exactContour),
      );
      maximumDepthError = Math.max(
        maximumDepthError,
        Math.abs(sample.depth - exactDepth),
      );
      maximumShorelineError = Math.max(
        maximumShorelineError,
        Math.abs(sample.shorelineZ - exactShoreline),
      );
      if (Math.abs(coastalZ - exactShoreline) <= 15) {
        maximumNearshoreContourError = Math.max(
          maximumNearshoreContourError,
          Math.abs(sample.contourCoordinate - exactContour),
        );
        maximumNearshoreDepthError = Math.max(
          maximumNearshoreDepthError,
          Math.abs(sample.depth - exactDepth),
        );
      }
      nearlyEqual(
        sample.shoreDistance,
        coastalZ - sample.shorelineZ,
        1e-12,
        `${label} physical shore distance`,
      );
    }
  }
  assert.ok(
    maximumContourError < 1.2,
    `${label} 2D contour error reached ${maximumContourError.toFixed(3)}m`,
  );
  assert.ok(
    maximumDepthError < 1.3,
    `${label} 2D depth error reached ${maximumDepthError.toFixed(3)}m`,
  );
  assert.ok(
    maximumShorelineError < .002,
    `${label} 2D shoreline error reached ${maximumShorelineError.toFixed(4)}m`,
  );
  assert.ok(
    maximumNearshoreContourError < .02,
    `${label} nearshore contour error reached ${maximumNearshoreContourError.toFixed(3)}m`,
  );
  assert.ok(
    maximumNearshoreDepthError < .16,
    `${label} nearshore depth error reached ${maximumNearshoreDepthError.toFixed(3)}m`,
  );

  let squaredSurfaceError = 0;
  let maximumSurfaceError = 0;
  let maximumNearshoreSurfaceError = 0;
  let maximumSurfaceContext = "";
  let comparisonCount = 0;
  for (const sampleX of fullVisibleOffsets.map((offset) => x + offset)) {
    const shorelineZ = shorelineReferenceAt(coastId, zoneName, sampleX);
    const coastalSamples = [
      -300, -180, -100, -75, -60, -52, -44, -32, -20,
      shorelineZ - 8,
      shorelineZ - 6,
      shorelineZ - 4,
      shorelineZ - 2,
      shorelineZ - .12,
      shorelineZ,
      shorelineZ + 1.5,
      shorelineZ + 3,
    ];
    for (const coastalZ of coastalSamples) {
      const sampleZ = worldZFromCoastalZ(coastalZ, SETTINGS.tide);
      for (const elapsed of [0, 3.3, 7.1, 12.7]) {
        const cpu = sampleCoastWaveSurface(
          sampleX,
          sampleZ,
          elapsed,
          SETTINGS,
          character,
        );
        const gpu = samplePackedOceanHeight(
          state,
          sampleX,
          sampleZ,
          elapsed,
          SETTINGS,
          character,
        );
        const error = Math.abs(cpu.height - gpu.height);
        squaredSurfaceError += error * error;
        if (error > maximumSurfaceError) {
          maximumSurfaceError = error;
          maximumSurfaceContext =
            ` at x=${sampleX.toFixed(1)}, z=${sampleZ}, t=${elapsed}`;
        }
        if (Math.abs(coastalZ - shorelineZ) <= 8) {
          maximumNearshoreSurfaceError = Math.max(
            maximumNearshoreSurfaceError,
            error,
          );
        }
        comparisonCount += 1;
        assert.ok(
          Math.hypot(cpu.displacementX, cpu.displacementZ)
            <= state.maximumHorizontalDisplacement + 1e-9,
          `${label} CPU crest shifted away from board contact`,
        );
        assert.ok(
          Math.hypot(gpu.displacementX, gpu.displacementZ)
            <= state.maximumHorizontalDisplacement + 1e-9,
          `${label} GPU crest shifted away from board contact`,
        );
        assert.ok(
          cpu.whitewater >= 0
            && cpu.whitewater <= 1
            && gpu.whitewater >= 0
            && gpu.whitewater <= 1,
          `${label} produced invalid crest foam`,
        );
        nearlyEqual(
          gpu.shoreDistance,
          cpu.shoreDistance,
          .002,
          `${label} raw/packed shore distance`,
        );
        nearlyEqual(
          gpu.shoreCollapse,
          cpu.shoreCollapse,
          .002,
          `${label} raw/packed shore collapse`,
        );
      }
    }

    const towWorldZ = worldZFromCoastalZ(
      shorelineZ - 6,
      SETTINGS.tide,
    );
    const shoreWorldZ = worldZFromCoastalZ(
      shorelineZ,
      SETTINGS.tide,
    );
    assert.ok(
      sampleCoastWaveSurface(
        sampleX,
        towWorldZ,
        2.4,
        SETTINGS,
        character,
      ).shoreCollapse < .01,
      `${label} collapsed the full wave at the -6m tow/surf band`,
    );
    assert.ok(
      sampleCoastWaveSurface(
        sampleX,
        shoreWorldZ,
        2.4,
        SETTINGS,
        character,
      ).shoreCollapse > .999,
      `${label} failed to collapse at the physical shoreline`,
    );
  }
  const rmsSurfaceError = Math.sqrt(
    squaredSurfaceError / comparisonCount,
  );
  assert.ok(
    // Packed bathymetry/travel interpolation may differ by a few centimetres
    // across a whole render window. Explicit active-break fixtures below keep
    // the physically surfed band to a much tighter four-centimetre contract.
    rmsSurfaceError < .035,
    `${label} CPU/GPU RMS height drifted ${rmsSurfaceError.toFixed(3)}m`,
  );
  assert.ok(
    maximumSurfaceError < .2,
    `${label} CPU/GPU maximum height drifted ${maximumSurfaceError.toFixed(3)}m${maximumSurfaceContext}`,
  );
  assert.ok(
    maximumNearshoreSurfaceError < .02,
    `${label} CPU/GPU nearshore height drifted ${maximumNearshoreSurfaceError.toFixed(3)}m`,
  );

  assertIdenticalFloat32(
    state.componentBank.parameters.data,
    again.componentBank.parameters.data,
    `${label} component parameters`,
  );
  assertIdenticalFloat32(state.travel.data, again.travel.data, `${label} travel`);
  assertIdenticalFloat32(state.aggregate.data, again.aggregate.data, `${label} aggregate`);
  assertIdenticalFloat32(state.bathymetry.data, again.bathymetry.data, `${label} bathymetry`);

  // Crossing a render-window boundary swaps one globally anchored row pair.
  // Every overlapping row and every overlapping interpolation result must be
  // identical, so camera recentering cannot make crests or shoreline pop.
  const recenterBoundary = Math.ceil(x / OCEAN_BATHYMETRY_X_STEP)
    * OCEAN_BATHYMETRY_X_STEP;
  const beforeRecenter = createOceanRenderState(
    SETTINGS,
    character,
    recenterBoundary - 1e-6,
  );
  const afterRecenter = createOceanRenderState(
    SETTINGS,
    character,
    recenterBoundary + 1e-6,
  );
  assert.equal(
    afterRecenter.bathymetry.xMin - beforeRecenter.bathymetry.xMin,
    OCEAN_BATHYMETRY_X_STEP,
    `${label} recenter fixture did not cross one x row`,
  );
  const overlapMin = afterRecenter.bathymetry.xMin;
  const overlapMax = beforeRecenter.bathymetry.xMin
    + (beforeRecenter.bathymetry.xCount - 1)
      * beforeRecenter.bathymetry.xStep;
  const rowPairLength = beforeRecenter.bathymetry.width
    * OCEAN_BATHYMETRY_ROWS * 4;
  for (
    let overlapX = overlapMin;
    overlapX <= overlapMax;
    overlapX += OCEAN_BATHYMETRY_X_STEP
  ) {
    const beforeIndex = Math.round(
      (overlapX - beforeRecenter.bathymetry.xMin)
        / OCEAN_BATHYMETRY_X_STEP,
    );
    const afterIndex = Math.round(
      (overlapX - afterRecenter.bathymetry.xMin)
        / OCEAN_BATHYMETRY_X_STEP,
    );
    const beforeStart = beforeIndex * rowPairLength;
    const afterStart = afterIndex * rowPairLength;
    assertIdenticalFloat32(
      beforeRecenter.bathymetry.data.subarray(
        beforeStart,
        beforeStart + rowPairLength,
      ),
      afterRecenter.bathymetry.data.subarray(
        afterStart,
        afterStart + rowPairLength,
      ),
      `${label} overlapping x=${overlapX} bathymetry rows`,
    );
  }
  for (const overlapX of [
    overlapMin + .001,
    recenterBoundary,
    overlapMax - .001,
  ]) {
    for (const coastalZ of [-180, -44, -15, -4, 0, 5]) {
      assert.deepEqual(
        samplePackedBathymetry(beforeRecenter, overlapX, coastalZ),
        samplePackedBathymetry(afterRecenter, overlapX, coastalZ),
        `${label} bathymetry changed across recenter at x=${overlapX}`,
      );
    }
    const continuityWorldZ = worldZFromCoastalZ(-15, SETTINGS.tide);
    for (const elapsed of [0, 5.2]) {
      assert.deepEqual(
        samplePackedOceanHeight(
          beforeRecenter,
          overlapX,
          continuityWorldZ,
          elapsed,
          SETTINGS,
          character,
        ),
        samplePackedOceanHeight(
          afterRecenter,
          overlapX,
          continuityWorldZ,
          elapsed,
          SETTINGS,
          character,
        ),
        `${label} packed surface changed across recenter`,
      );
    }
  }

  // The retired 12 m profile snapping boundaries must now be ordinary smooth
  // points in the exact alongshore bathymetry field.
  for (const formerProfileBoundary of [-24, -12, 0, 12, 24]) {
    const epsilon = 1e-4;
    const continuityWorldZ = worldZFromCoastalZ(-20, SETTINGS.tide);
    const left = sampleCoastWaveSurface(
      formerProfileBoundary - epsilon,
      continuityWorldZ,
      4.7,
      SETTINGS,
      character,
    );
    const right = sampleCoastWaveSurface(
      formerProfileBoundary + epsilon,
      continuityWorldZ,
      4.7,
      SETTINGS,
      character,
    );
    assert.ok(
      Math.abs(left.height - right.height) < .001,
      `${label} retained a wave jump at old x=${formerProfileBoundary} profile boundary`,
    );
    assert.ok(
      Math.abs(left.breakingRatio - right.breakingRatio) < .002,
      `${label} retained a break-onset jump at old x=${formerProfileBoundary} profile boundary`,
    );
  }
}

assert.equal(OCEAN_BATHYMETRY_COASTAL_Z.length, 76);

// The fixed x=0 propagation profile keeps crest phase continuous, but break
// onset must follow the actual two-dimensional seabed. These fixtures cover
// the strongest reef, canyon, slab, and beach-bar deviations from that
// reference profile.
const LOCAL_BREAKING_DEPTH_CASES = [
  ["mavericks", "The Bowl", -120, 60],
  ["nazare", "Praia do Norte", -120, 40],
  ["nazare", "Praia do Norte", -120, 60],
  ["nazare", "Praia do Norte", 120, 40],
  ["nazare", "Praia do Norte", 120, 60],
  ["teahupoo", "The Bowl", 240, 60],
  ["uluwatu", "The Peak", -240, 60],
  ["hossegor", "La Nord", 310, 25],
];
for (
  const [
    coastId,
    zoneName,
    x,
    offshore,
  ] of LOCAL_BREAKING_DEPTH_CASES
) {
  const character = getBreakCharacter(coastId, zoneName);
  const state = createOceanRenderState(SETTINGS, character, x);
  const coastalZ = shorelineReferenceAt(coastId, zoneName, x)
    - offshore;
  const worldZ = worldZFromCoastalZ(coastalZ, SETTINGS.tide);
  const exactDepth = bathymetryDepthAt(
    coastId,
    zoneName,
    x,
    coastalZ,
  );
  const packedDepth = samplePackedBathymetry(
    state,
    x,
    coastalZ,
  ).depth;
  const label = `${coastId}:${zoneName}@${x},${offshore}m`;
  nearlyEqual(
    packedDepth,
    exactDepth,
    .16,
    `${label} packed physical depth`,
  );
  for (const elapsed of [0, 3.3, 7.1, 12.7]) {
    const cpu = sampleCoastWaveSurface(
      x,
      worldZ,
      elapsed,
      SETTINGS,
      character,
    );
    const gpu = samplePackedOceanHeight(
      state,
      x,
      worldZ,
      elapsed,
      SETTINGS,
      character,
    );
    nearlyEqual(
      cpu.depth,
      exactDepth,
      1e-9,
      `${label} gameplay physical depth`,
    );
    nearlyEqual(
      gpu.breakingRatio,
      cpu.breakingRatio,
      cpu.breakingRatio > 3
        ? Math.abs(cpu.breakingRatio) * .025
        : .015,
      `${label} packed break onset`,
    );
    nearlyEqual(
      gpu.height,
      cpu.height,
      .04,
      `${label} packed breaking height`,
    );
  }
}

// The branch-free sampler must retain class-specific contour signatures.
const reef = createOceanRenderState(
  SETTINGS,
  getBreakCharacter("pipeline", "First Reef"),
  18,
);
const point = createOceanRenderState(
  SETTINGS,
  getBreakCharacter("jeffreys-bay", "Supertubes"),
  61,
);
const canyon = createOceanRenderState(
  SETTINGS,
  getBreakCharacter("nazare", "Praia do Norte"),
  0,
);
const nearReef = samplePackedBathymetry(reef, reef.profileX, -59);
const nearPoint = samplePackedBathymetry(point, point.profileX, -90);
const nearCanyon = samplePackedBathymetry(canyon, canyon.profileX, -105);
assert.ok(Math.abs(nearReef.depthGradientZ) > .04, "reef ledge derivative was flattened");
assert.ok(Math.abs(nearPoint.contourGradientX) > .01, "point contour derivative was flattened");
assert.ok(nearCanyon.depth > nearPoint.depth + 4, "canyon depth signature was flattened");

const calm = createOceanRenderState(
  {
    ...SETTINGS,
    waveHeight: 0,
    windWaveHeight: 0,
    swellHeight: 0,
    secondarySwellHeight: 0,
    tertiarySwellHeight: 0,
  },
  getBreakCharacter("rockaway", "Beach 90th"),
  0,
);
assert.equal(calm.componentBank.count, 0);
assert.equal(samplePackedTravel(calm, 0, -80).amplitude, 0);
assertFiniteTable(calm.aggregate, "calm aggregate");
assertFiniteTable(calm.bathymetry, "calm bathymetry");

const transitionFixture = {
  x: 37,
  elapsed: 8.5,
  shoreDistance: -2,
  rawHeight: 1.35,
  displacementX: .42,
  displacementZ: -.31,
  tideSurface: .12,
  targetFaceHeight: 3.1,
};
const transition = applyOceanShoreTransition(transitionFixture);
const derivativeEpsilon = 1e-5;
const finiteDifference = (field, key) => {
  const before = applyOceanShoreTransition({
    ...transitionFixture,
    [key]: transitionFixture[key] - derivativeEpsilon,
  })[field];
  const after = applyOceanShoreTransition({
    ...transitionFixture,
    [key]: transitionFixture[key] + derivativeEpsilon,
  })[field];
  return (after - before) / (derivativeEpsilon * 2);
};
nearlyEqual(
  transition.heightDerivativeShoreDistance,
  finiteDifference("height", "shoreDistance"),
  2e-6,
  "shore transition analytic shore-distance derivative",
);
nearlyEqual(
  transition.heightDerivativeX,
  finiteDifference("height", "x"),
  2e-6,
  "shore transition analytic x derivative",
);
nearlyEqual(
  transition.heightDerivativeTime,
  finiteDifference("height", "elapsed"),
  2e-6,
  "shore transition analytic time derivative",
);
const fullWaveTransition = applyOceanShoreTransition({
  ...transitionFixture,
  shoreDistance: -6,
});
const shorelineTransition = applyOceanShoreTransition({
  ...transitionFixture,
  shoreDistance: 0,
});
const buriedTransition = applyOceanShoreTransition({
  ...transitionFixture,
  shoreDistance: 8,
});
assert.equal(fullWaveTransition.collapse, 0);
nearlyEqual(fullWaveTransition.height, transitionFixture.rawHeight, 1e-12);
nearlyEqual(
  fullWaveTransition.displacementX,
  transitionFixture.displacementX,
  1e-12,
);
assert.equal(shorelineTransition.collapse, 1);
assert.equal(shorelineTransition.horizontalScale, 0);
assert.ok(buriedTransition.burial > .999);
assert.ok(buriedTransition.coverage < .001);
assert.ok(
  buriedTransition.height < shorelineTransition.height,
  "shore transition did not bury water beyond runup",
);
const crestMaximumBurial = applyOceanShoreTransition({
  ...transitionFixture,
  x: 65,
  elapsed: 0,
  shoreDistance: 8,
  tideSurface: .54,
  targetFaceHeight: 0,
});
assert.ok(
  crestMaximumBurial.height <= -.6 + 1e-12,
  `fully buried high-tide water remained above wet sand (${crestMaximumBurial.height})`,
);

console.log(
  `Ocean render packing verified across ${CASES.length} coast classes: `
  + `${MAX_RENDER_WAVE_COMPONENTS} components, 24–80 travel knots, `
  + `${OCEAN_BATHYMETRY_X_COUNT}×${OCEAN_BATHYMETRY_COASTAL_Z.length} `
  + "globally anchored 2D bathymetry.",
);
