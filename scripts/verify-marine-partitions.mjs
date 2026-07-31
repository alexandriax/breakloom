import assert from "node:assert/strict";

import {
  buildEnergyConsistentSeaState,
  fallbackConditions,
} from "../lib/marine.ts";
import { BEACHES } from "../lib/beaches.ts";

const tolerance = 1e-10;

function verifyBudget(result, label) {
  const summedEnergy = Object.values(result.partitions).reduce(
    (sum, partition) => sum + partition.height ** 2,
    0,
  );
  assert.ok(
    summedEnergy <= result.totalEnergy + tolerance,
    `${label}: partitions must not exceed total Hs²`,
  );
  assert.ok(
    result.residualEnergy >= 0,
    `${label}: residual energy must not be negative`,
  );
  assert.ok(
    Math.abs(summedEnergy - result.partitionEnergy) <= tolerance,
    `${label}: reported partition energy must match component heights`,
  );
}

const overBudget = buildEnergyConsistentSeaState({
  waveHeight: 2,
  waveDirection: 275,
  wavePeriod: 12,
  swellHeight: 2,
  swellDirection: 280,
  swellPeriod: 14,
  secondarySwellHeight: 1.5,
  secondarySwellDirection: 225,
  secondarySwellPeriod: 10,
  windWaveHeight: 1,
  windWaveDirection: 300,
  windWavePeriod: 6,
});
verifyBudget(overBudget, "over-budget input");
assert.ok(overBudget.scaleApplied < 1, "over-budget components should be scaled");
assert.ok(
  Math.abs(overBudget.partitionEnergy - overBudget.totalEnergy) <= tolerance,
  "scaled partitions should consume, but never exceed, the total budget",
);

const missingWindSea = buildEnergyConsistentSeaState({
  waveHeight: 2.5,
  waveDirection: 240,
  wavePeriod: 13,
  swellHeight: 2,
  swellDirection: 230,
  swellPeriod: 15,
});
verifyBudget(missingWindSea, "missing wind sea");
assert.ok(
  Math.abs(missingWindSea.partitions.windWave.height - 1.5) <= tolerance,
  "missing wind sea should be inferred from residual squared height",
);
assert.ok(
  Number.isFinite(missingWindSea.partitions.windWave.period)
    && missingWindSea.partitions.windWave.period > 0,
  "missing wind period should receive a usable fallback",
);

const noComponents = buildEnergyConsistentSeaState({
  waveHeight: 1.75,
  waveDirection: 410,
  wavePeriod: 9,
});
verifyBudget(noComponents, "missing all components");
assert.equal(
  noComponents.partitions.windWave.height,
  1.75,
  "an absent partition forecast should fall back to residual wind-sea energy",
);
assert.equal(
  noComponents.partitions.windWave.direction,
  50,
  "partition directions should inherit and normalize total direction",
);

const malformed = buildEnergyConsistentSeaState({
  waveHeight: Number.NaN,
  waveDirection: Number.NaN,
  wavePeriod: -1,
  swellHeight: -4,
  swellDirection: -20,
  swellPeriod: 0,
  windWaveHeight: Number.POSITIVE_INFINITY,
});
verifyBudget(malformed, "malformed input");
assert.equal(malformed.totalHeight, 0, "invalid total height should become zero");
assert.equal(malformed.partitionEnergy, 0, "zero total height cannot allocate energy");
assert.equal(
  malformed.partitions.primarySwell.direction,
  340,
  "finite directions should be normalized",
);

const suppliedPartitions = buildEnergyConsistentSeaState({
  waveHeight: 3,
  waveDirection: 180,
  wavePeriod: 11,
  swellHeight: 2,
  secondarySwellHeight: 1,
  tertiarySwellHeight: .5,
  windWaveHeight: 1,
});
verifyBudget(suppliedPartitions, "complete partition input");
assert.ok(
  suppliedPartitions.partitions.windWave.height >= 1,
  "residual inference must never subtract from a supplied wind sea",
);

for (const beach of BEACHES) {
  const conditions = fallbackConditions(beach, "2026-07-28T12:00:00Z");
  assert.ok(
    Math.abs(conditions.swellHeight - beach.fallback.waveHeight * .8) <= tolerance,
    `${beach.id}: modeled fallback should preserve the primary-swell estimate`,
  );
  const points = [conditions, ...conditions.forecast];
  for (const [index, point] of points.entries()) {
    const result = buildEnergyConsistentSeaState(point);
    verifyBudget(result, `${beach.id} fallback point ${index}`);
    for (const partition of Object.values(result.partitions)) {
      assert.ok(Number.isFinite(partition.height) && partition.height >= 0);
      assert.ok(Number.isFinite(partition.direction));
      assert.ok(Number.isFinite(partition.period) && partition.period > 0);
      assert.ok(Number.isFinite(partition.peakPeriod) && partition.peakPeriod > 0);
    }
  }
}

console.log("Marine partition verification passed.");
