import assert from "node:assert/strict";
import { solveFiniteDepthWaveNumber } from "../lib/waves.ts";
import { sampleCoastWaveSurface } from "../lib/ocean.ts";
import { waveHeightAt, settingsFromConditions } from "../lib/game.ts";
import { BEACHES, getBreakCharacter } from "../lib/beaches.ts";
import { fallbackConditions } from "../lib/marine.ts";

// Independent dispersion residual over shallow/deep water, followed by cache
// eviction. Cache residency must have no effect on the returned physics.
const readings = [];
for (const period of [3, 5, 11, 19, 24]) for (const depth of [.08, .2, 1, 4, 20, 180]) {
  const omega = Math.PI * 2 / period;
  const k = solveFiniteDepthWaveNumber(omega, depth);
  assert.ok(Math.abs(9.81 * k * Math.tanh(k * depth) - omega * omega) < 1e-9);
  readings.push({ omega, depth, k });
}
for (let frequency = 1; frequency < 110; frequency++) {
  for (let depth = 1; depth < 270; depth++) solveFiniteDepthWaveNumber(frequency / 10, depth / 3);
}
for (const { omega, depth, k } of readings) assert.equal(solveFiniteDepthWaveNumber(omega, depth), k);

const beach = BEACHES.find((entry) => entry.id === "trestles");
const settings = settingsFromConditions(fallbackConditions(beach), beach.heading);
const character = { ...getBreakCharacter(beach.id, "Lowers") };
const sample = (gradient = true) => sampleCoastWaveSurface(0, -30, 101.25, settings, character, gradient);
const original = sample();
assert.equal(sample(), original, "identical consumers repeat the full water solve");
assert.equal(waveHeightAt(0, -30, 101.25, settings, character), original.height);
assert.equal(sample(false).height, original.height, "gradient resolution changed the surface height");
const originalTide = settings.tide;
settings.tide += .5;
assert.notDeepEqual(sample(), original, "tide changes returned stale water");
settings.tide = originalTide;
const originalPower = character.power;
character.power += .7;
assert.notEqual(sample(), original, "breaker changes reused an incompatible surface");
character.power = originalPower;
assert.deepEqual(sample(), original);
for (let i = 0; i < 280; i++) sampleCoastWaveSurface(i * .125, -30, 101.25, settings, character);
assert.deepEqual(sample(), original, "surface eviction changed contact physics");
console.log("Exact ocean reuse: dispersion residuals, eviction, height, tide, and breaker invalidation pass.");
