import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  buildWaveComponentBank,
  coastalIncomingDirectionDegrees,
  createWaveDepthProfile,
  deserializeWaveComponentBank,
  dominantCrestPropertiesAtPhase,
  groupVelocity,
  packWaveComponentsForGpu,
  phaseCelerity,
  sampleDominantWave,
  sampleWaveSurface,
  serializeWaveComponentBank,
  significantHeightToVariance,
  solveFiniteDepthWaveNumber,
  spectralCrestAtOrdinal,
  varianceToSignificantHeight,
  waveSpectrumInputFromMarine,
} from "../lib/waves.ts";

const TAU = Math.PI * 2;

function close(actual, expected, tolerance, label) {
  const error = Math.abs(actual - expected);
  assert.ok(
    error <= tolerance,
    `${label}: expected ${expected}, received ${actual} (error ${error})`,
  );
}

function relativeClose(actual, expected, tolerance, label) {
  const scale = Math.max(1e-9, Math.abs(actual), Math.abs(expected));
  close(actual / scale, expected / scale, tolerance, label);
}

function finiteTree(value, path = "value") {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite, received ${value}`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    finiteTree(child, `${path}.${key}`);
  }
}

const spectrumInput = {
  totalSignificantHeight: 3.2,
  peakPeriod: 14,
  directionDegrees: 4,
  swellPartitions: [
    {
      significantHeight: 2.7,
      peakPeriod: 15,
      directionDegrees: 2,
      directionalSpreadDegrees: 6,
      label: "primary",
    },
    {
      significantHeight: 2.2,
      peakPeriod: 11,
      directionDegrees: -13,
      directionalSpreadDegrees: 10,
      label: "secondary",
    },
  ],
  windSea: {
    significantHeight: 1.6,
    peakPeriod: 6.2,
    directionDegrees: 22,
  },
  windSpeed: 13,
  componentCount: 32,
  referenceDepth: 160,
  seed: "pipeline-2026-07-28T20",
};

const bank = buildWaveComponentBank(spectrumInput);
const expectedVariance = significantHeightToVariance(
  spectrumInput.totalSignificantHeight,
);
const componentVariance = bank.components.reduce(
  (sum, component) => sum + component.variance,
  0,
);
const partitionVariance = bank.partitions.reduce(
  (sum, partition) => sum + partition.variance,
  0,
);
close(componentVariance, expectedVariance, 1e-12, "component energy budget");
close(partitionVariance, expectedVariance, 1e-12, "partition energy budget");
close(bank.totalVariance, expectedVariance, 1e-12, "bank energy budget");
close(
  bank.significantHeight,
  spectrumInput.totalSignificantHeight,
  1e-12,
  "significant height reconstruction",
);
close(
  varianceToSignificantHeight(componentVariance),
  spectrumInput.totalSignificantHeight,
  1e-12,
  "Hs = 4 sqrt(m0)",
);
assert.equal(bank.components.length, 32, "requested component count is preserved");

const sameBank = buildWaveComponentBank(spectrumInput);
const differentBank = buildWaveComponentBank({
  ...spectrumInput,
  seed: "pipeline-2026-07-28T21",
});
assert.equal(
  serializeWaveComponentBank(bank),
  serializeWaveComponentBank(sameBank),
  "same input and seed must reproduce byte-identical component data",
);
assert.notEqual(
  serializeWaveComponentBank(bank),
  serializeWaveComponentBank(differentBank),
  "a different seed must alter the deterministic realization",
);
assert.deepEqual(
  deserializeWaveComponentBank(serializeWaveComponentBank(bank)),
  bank,
  "serialized component banks must round-trip without loss",
);

const marineInput = waveSpectrumInputFromMarine({
  waveHeight: 3,
  wavePeriod: 14,
  waveDirection: 330,
  windWaveHeight: 1.1,
  windWavePeriod: 6,
  windWavePeakPeriod: 6.5,
  windWaveDirection: 350,
  swellHeight: 2.4,
  swellPeriod: 15,
  swellPeakPeriod: 15.5,
  swellDirection: 328,
  secondarySwellHeight: .9,
  secondarySwellPeriod: 11,
  secondarySwellDirection: 305,
  tertiarySwellHeight: .45,
  tertiarySwellPeriod: 8,
  tertiarySwellDirection: 15,
  windSpeed: 12,
  windDirection: 350,
  coastHeading: 330,
}, "partition-adapter");
assert.equal(marineInput.swellPartitions?.length, 3);
assert.equal(marineInput.windSea?.significantHeight, 1.1);
const marineBank = buildWaveComponentBank(marineInput);
close(
  marineBank.significantHeight,
  3,
  1e-12,
  "marine partitions remain inside total significant height",
);
assert.equal(marineBank.partitions.length, 4);
assert.equal(
  coastalIncomingDirectionDegrees(70 - 322),
  72,
  "a forecast bearing from behind the coast must refract into the incoming hemisphere",
);
assert.equal(
  coastalIncomingDirectionDegrees(322 - 70),
  -72,
  "incoming-direction folding must preserve the alongshore side",
);
const obliqueCoastalBank = buildWaveComponentBank(
  waveSpectrumInputFromMarine({
    waveHeight: 2.1,
    wavePeriod: 8,
    waveDirection: 70,
    swellHeight: 2.1,
    swellPeriod: 8,
    swellDirection: 70,
    windSpeed: 17,
    windDirection: 48,
    coastHeading: 322,
  }, "pipeline-oblique-live-direction"),
);
assert.ok(
  obliqueCoastalBank.components.every(
    (component) => component.directionZ > 0,
  ),
  "no nearshore spectral component may propagate out of the beach",
);

const omega = TAU / 12;
const deepWaveNumber = solveFiniteDepthWaveNumber(omega, 200);
const shelfWaveNumber = solveFiniteDepthWaveNumber(omega, 5);
const shallowWaveNumber = solveFiniteDepthWaveNumber(omega, 1.5);
const deepCelerity = phaseCelerity(omega, deepWaveNumber);
const shelfCelerity = phaseCelerity(omega, shelfWaveNumber);
const shallowCelerity = phaseCelerity(omega, shallowWaveNumber);
assert.ok(deepWaveNumber < shelfWaveNumber && shelfWaveNumber < shallowWaveNumber);
assert.ok(deepCelerity > shelfCelerity && shelfCelerity > shallowCelerity);
for (const [depth, waveNumber] of [
  [200, deepWaveNumber],
  [5, shelfWaveNumber],
  [1.5, shallowWaveNumber],
]) {
  relativeClose(
    9.81 * waveNumber * Math.tanh(waveNumber * depth),
    omega * omega,
    1e-10,
    `dispersion residual at ${depth}m`,
  );
  assert.ok(
    groupVelocity(omega, waveNumber, depth) <= phaseCelerity(omega, waveNumber)
      + 1e-12,
    "group velocity cannot exceed phase celerity",
  );
}

const profile = createWaveDepthProfile([
  { z: -650, depth: 160 },
  { z: -430, depth: 92 },
  { z: -260, depth: 34 },
  { z: -125, depth: 10 },
  { z: -45, depth: 3.5 },
  { z: 5, depth: .55 },
], -650);

const propagationBank = buildWaveComponentBank({
  totalSignificantHeight: 1.8,
  peakPeriod: 13,
  directionDegrees: 11,
  swellPartitions: [{
    significantHeight: 1.6,
    peakPeriod: 13.5,
    directionDegrees: 11,
    directionalSpreadDegrees: 3,
  }],
  windSpeed: 7,
  windDirectionDegrees: 20,
  componentCount: 20,
  referenceDepth: 160,
  seed: "phase-verification",
});

const deepState = sampleDominantWave(propagationBank, profile, 17, -560, 23);
const shallowState = sampleDominantWave(propagationBank, profile, 17, -35, 23);
assert.ok(deepState && shallowState);
assert.ok(
  deepState.celerity > shallowState.celerity,
  "the same carrier must slow as depth decreases",
);

for (const z of [-540, -330, -170, -75, -24]) {
  const x = 13;
  const elapsed = 31;
  const epsilon = .025;
  const state = sampleDominantWave(propagationBank, profile, x, z, elapsed);
  const xBefore = sampleDominantWave(
    propagationBank,
    profile,
    x - epsilon,
    z,
    elapsed,
  );
  const xAfter = sampleDominantWave(
    propagationBank,
    profile,
    x + epsilon,
    z,
    elapsed,
  );
  const zBefore = sampleDominantWave(
    propagationBank,
    profile,
    x,
    z - epsilon,
    elapsed,
  );
  const zAfter = sampleDominantWave(
    propagationBank,
    profile,
    x,
    z + epsilon,
    elapsed,
  );
  assert.ok(state && xBefore && xAfter && zBefore && zAfter);
  const numericalX = (xAfter.phase - xBefore.phase) / (epsilon * 2);
  const numericalZ = (zAfter.phase - zBefore.phase) / (epsilon * 2);
  relativeClose(
    numericalX,
    state.gradientX,
    2e-5,
    `integrated phase x-gradient at z=${z}`,
  );
  relativeClose(
    numericalZ,
    state.gradientZ,
    2e-4,
    `integrated phase z-gradient at z=${z}`,
  );
  const dominant = propagationBank.components[propagationBank.dominantComponentId];
  const transportedAngularFrequency = state.gradientX * state.celerityX
    + state.gradientZ * state.celerityZ;
  relativeClose(
    transportedAngularFrequency,
    dominant.angularFrequency,
    2e-8,
    `phase velocity identity at z=${z}`,
  );
  const deltaTime = 1e-3;
  const advected = sampleDominantWave(
    propagationBank,
    profile,
    x + state.celerityX * deltaTime,
    z + state.celerityZ * deltaTime,
    elapsed + deltaTime,
  );
  assert.ok(advected);
  close(
    advected.phase,
    state.phase,
    3e-6,
    `crest phase remains fixed under local phase velocity at z=${z}`,
  );
}

const crestEnergies = Array.from(
  { length: 512 },
  (_, ordinal) => spectralCrestAtOrdinal(propagationBank, ordinal).crestEnergy,
);
const meanCrestEnergy = crestEnergies.reduce((sum, value) => sum + value, 0)
  / crestEnergies.length;
const crestEnergyDeviation = Math.sqrt(
  crestEnergies.reduce(
    (sum, value) => sum + (value - meanCrestEnergy) ** 2,
    0,
  ) / crestEnergies.length,
);
assert.ok(
  crestEnergyDeviation > .09,
  "nearby spectral frequencies must create natural groups and lulls",
);
assert.ok(Math.min(...crestEnergies) < .2);
assert.ok(Math.max(...crestEnergies) > .8);
assert.deepEqual(
  spectralCrestAtOrdinal(propagationBank, 37),
  dominantCrestPropertiesAtPhase(propagationBank, 37 * TAU + .3),
  "carrier phase must resolve to the same stable crest identity",
);

for (const z of [-620, -500, -380, -260, -150, -80, -35, -5]) {
  for (const x of [-120, -60, 0, 60, 120]) {
    for (const elapsed of [0, 17, 63]) {
      const surface = sampleWaveSurface(
        propagationBank,
        profile,
        x,
        z,
        elapsed,
        { includeComponents: true },
      );
      finiteTree(surface, `surface(${x}, ${z}, ${elapsed})`);
      const normalLength = Math.hypot(
        surface.normalX,
        surface.normalY,
        surface.normalZ,
      );
      close(normalLength, 1, 1e-10, "surface normal length");
      assert.ok(
        surface.horizontalJacobianMargin >= .31,
        "bounded horizontal displacement must retain a positive Jacobian margin",
      );
      assert.ok(surface.localSignificantHeight <= .78 * surface.depth + 1e-9);
    }
  }
}

const derivativePoint = { x: 21, z: -112, elapsed: 19 };
const derivativeStep = 1e-4;
const derivativeSurface = sampleWaveSurface(
  propagationBank,
  profile,
  derivativePoint.x,
  derivativePoint.z,
  derivativePoint.elapsed,
);
const derivativeBefore = sampleWaveSurface(
  propagationBank,
  profile,
  derivativePoint.x,
  derivativePoint.z,
  derivativePoint.elapsed - derivativeStep,
);
const derivativeAfter = sampleWaveSurface(
  propagationBank,
  profile,
  derivativePoint.x,
  derivativePoint.z,
  derivativePoint.elapsed + derivativeStep,
);
relativeClose(
  (derivativeAfter.height - derivativeBefore.height) / (2 * derivativeStep),
  derivativeSurface.timeDerivative,
  2e-6,
  "analytic surface time derivative",
);

const curvedField = {
  referenceZ: -650,
  sample(x, z) {
    const offshore = Math.max(0, -z);
    return {
      depth: Math.max(.45, .5 + offshore * .16 + 2.2 * Math.exp(
        -(((x - 18) / 42) ** 2),
      )),
      contourCoordinate: z + 7 * Math.sin(x / 85)
        * Math.exp(-(((offshore - 95) / 70) ** 2)),
    };
  },
};
const curvedState = sampleDominantWave(
  propagationBank,
  curvedField,
  35,
  -95,
  12,
);
assert.ok(curvedState);
finiteTree(curvedState, "curved bathymetry adapter");
assert.ok(
  Math.abs(curvedState.gradientX) > 1e-4,
  "a curved contour field must bend the phase gradient",
);

const gpu = packWaveComponentsForGpu(propagationBank);
assert.equal(gpu.count, propagationBank.components.length);
assert.equal(gpu.directions.length, gpu.count * 2);
for (const array of [
  gpu.amplitudes,
  gpu.angularFrequencies,
  gpu.referenceWaveNumbers,
  gpu.phaseOffsets,
  gpu.directions,
]) {
  for (const value of array) assert.ok(Number.isFinite(value));
}

// Warm the cached travel tables before timing the steady-state sampling path.
sampleWaveSurface(propagationBank, profile, 0, -200, 0);
const benchmarkStart = performance.now();
for (let index = 0; index < 120; index += 1) {
  sampleWaveSurface(
    propagationBank,
    profile,
    (index % 17) * 4 - 32,
    -620 + (index % 113) * 5.2,
    index * .11,
  );
}
const benchmarkMilliseconds = performance.now() - benchmarkStart;
assert.ok(
  benchmarkMilliseconds < 3000,
  `cached profile sampling regressed: ${benchmarkMilliseconds.toFixed(1)}ms`,
);

console.log("wave-core verification passed", {
  components: propagationBank.components.length,
  totalHs: propagationBank.significantHeight,
  deepCelerity: deepState.celerity.toFixed(3),
  shallowCelerity: shallowState.celerity.toFixed(3),
  groupEnergyDeviation: crestEnergyDeviation.toFixed(3),
  benchmarkMilliseconds: benchmarkMilliseconds.toFixed(1),
});
