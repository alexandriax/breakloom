import assert from "node:assert/strict";
import { getBreakCharacter } from "../lib/beaches.ts";
import {
  MAX_RENDER_WAVE_COMPONENTS,
  OCEAN_BATHYMETRY_COASTAL_Z,
  createOceanRenderState,
  samplePackedAggregate,
  samplePackedBathymetry,
  samplePackedOceanHeight,
  samplePackedTravel,
} from "../lib/ocean-render.ts";
import {
  coastWaveModelAt,
  sampleCoastWaveSurface,
} from "../lib/ocean.ts";
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

for (const [coastId, zoneName, x] of CASES) {
  const character = getBreakCharacter(coastId, zoneName);
  const state = createOceanRenderState(SETTINGS, character, x);
  const again = createOceanRenderState(SETTINGS, character, x);
  const label = `${coastId}:${zoneName}`;

  assert.equal(state.coastId, coastId);
  assert.equal(state.zoneName, zoneName);
  assert.ok(state.componentBank.count <= MAX_RENDER_WAVE_COMPONENTS);
  assert.equal(state.componentBank.count, MAX_RENDER_WAVE_COMPONENTS);
  assert.ok(state.componentBank.dominantIndex >= 0, `${label} lost dominant component`);
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
    state.travel.width >= 24 && state.travel.width <= 32,
    `${label} travel table is not an adaptive 24–32 knots`,
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

  for (const coastalZ of [-900, -180, -70, -20, -4, 3]) {
    const sample = samplePackedBathymetry(state, coastalZ);
    for (const value of Object.values(sample)) {
      assert.ok(Number.isFinite(value), `${label} sampled bathymetry is not finite`);
    }
    assert.ok(sample.depth > 0, `${label} packed bathymetry is not positive`);
  }

  let squaredSurfaceError = 0;
  let maximumSurfaceError = 0;
  let comparisonCount = 0;
  for (
    const sampleX of [
      state.profileX - 4,
      state.profileX,
      state.profileX + 4,
    ]
  ) {
    for (const sampleZ of [-300, -180, -100, -75, -60, -52, -44, -32]) {
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
        maximumSurfaceError = Math.max(maximumSurfaceError, error);
        comparisonCount += 1;
      }
    }
  }
  const rmsSurfaceError = Math.sqrt(
    squaredSurfaceError / comparisonCount,
  );
  assert.ok(
    rmsSurfaceError < .05,
    `${label} CPU/GPU RMS height drifted ${rmsSurfaceError.toFixed(3)}m`,
  );
  assert.ok(
    maximumSurfaceError < .15,
    `${label} CPU/GPU maximum height drifted ${maximumSurfaceError.toFixed(3)}m`,
  );

  assertIdenticalFloat32(
    state.componentBank.parameters.data,
    again.componentBank.parameters.data,
    `${label} component parameters`,
  );
  assertIdenticalFloat32(state.travel.data, again.travel.data, `${label} travel`);
  assertIdenticalFloat32(state.aggregate.data, again.aggregate.data, `${label} aggregate`);
  assertIdenticalFloat32(state.bathymetry.data, again.bathymetry.data, `${label} bathymetry`);
}

assert.equal(OCEAN_BATHYMETRY_COASTAL_Z.length, 40);

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
const nearReef = samplePackedBathymetry(reef, -59);
const nearPoint = samplePackedBathymetry(point, -90);
const nearCanyon = samplePackedBathymetry(canyon, -105);
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

console.log(
  `Ocean render packing verified across ${CASES.length} coast classes: `
  + `${MAX_RENDER_WAVE_COMPONENTS} components, 24–32 travel knots, RGBA32F tables.`,
);
