import assert from "node:assert/strict";
import { redirectRailMomentum } from "../lib/surf-dynamics.ts";
import { advanceOceanClock } from "../lib/performance.ts";
import {
  advanceSurfboardDynamics, evaluateBoardWaterInteraction,
  settingsFromConditions, waveSurfaceFrameAt, primaryWavePhaseAt,
  resolveWavePocketFrame, findWaveBreakingContourAt,
} from "../lib/game.ts";
import { quickSurfSettings, findSurfEntry } from "../lib/surf-session.ts";
import { BEACHES, getBreakCharacter } from "../lib/beaches.ts";
import { fallbackConditions } from "../lib/marine.ts";

const turn = {
  velocityX: 0, velocityZ: 8, currentX: 0, currentZ: 0,
  headingDelta: .02, deltaSeconds: 1 / 60,
  grip: 1, planing: 1, waterContact: 1, whitewater: 0,
};
let velocity = { velocityX: 0, velocityZ: 8 };
for (let i = 0; i < 10000; i++) velocity = redirectRailMomentum({ ...turn, ...velocity });
assert.ok(Math.abs(Math.hypot(velocity.velocityX, velocity.velocityZ) - 8) < 1e-9,
  "rail lift must not manufacture or dissipate kinetic energy");
for (const channel of ["grip", "planing", "waterContact"]) {
  const released = redirectRailMomentum({ ...turn, [channel]: 0 });
  assert.equal(released.velocityX, 0, `${channel}=0 must preserve flight/slip trajectory`);
  assert.equal(released.velocityZ, 8);
}
const clean = redirectRailMomentum(turn);
const current = redirectRailMomentum({ ...turn, currentX: 2, currentZ: -.5, velocityX: 2, velocityZ: 7.5 });
assert.ok(Math.abs(current.velocityX - 2 - clean.velocityX) < 1e-12);
assert.ok(Math.abs(current.velocityZ + .5 - clean.velocityZ) < 1e-12);
const foamy = redirectRailMomentum({ ...turn, whitewater: 1 });
assert.ok(foamy.velocityX < clean.velocityX * .4, "aerated fins must release traction");
const hardTurn = redirectRailMomentum({ ...turn, headingDelta: 5 });
assert.ok(Math.hypot(hardTurn.accelerationX, hardTurn.accelerationZ) <= 9.81 * 1.15 + 1e-9);

const hull = {
  surfaceSlopeX: 0, surfaceSlopeZ: 0, waveVelocityX: 0, waveVelocityZ: 6,
  currentVelocityX: 0, currentVelocityZ: 0, waveContact: 0, waterContact: 1,
  stance: 0, railGrip: .95, whitewater: 0, boardLength: 2.5,
  boardWidth: .34, boardTurn: 1, boardStability: 1, waveHeight: 0,
};
function coast(hz, railInput) {
  let state = { velocityX: 0, velocityZ: 8, heading: 0, yawRate: 0 };
  let x = 0, z = 0;
  for (let frame = 0; frame < hz * 3; frame++) {
    state = advanceSurfboardDynamics(state, { ...hull, railInput, deltaSeconds: 1 / hz });
    x += state.velocityX / hz;
    z += state.velocityZ / hz;
  }
  return { ...state, x, z, speed: Math.hypot(state.velocityX, state.velocityZ) };
}
const runs = [30, 60, 120].map((hz) => coast(hz, .5));
const straight = coast(60, 0);
for (const run of runs) {
  assert.ok(run.heading > 1 && run.sideslip < .16, "a committed rail must draw an arc, not skid sideways");
  assert.ok(run.speed > straight.speed * .94 && run.speed < 8, "carves should carry glide without adding thrust");
  assert.ok(Math.abs(run.heading - runs[2].heading) < .01, "turn rate depends on refresh rate");
  assert.ok(Math.hypot(run.x - runs[2].x, run.z - runs[2].z) < .25, "30–120 Hz trajectories diverged");
}
const cutback = {
  boardHeading: Math.PI * .56, velocityX: Math.sin(Math.PI * .56) * 6,
  velocityZ: Math.cos(Math.PI * .56) * 6, waveVelocityX: 0, waveVelocityZ: 6,
  slopeX: 0, slopeZ: -.25, surfaceRise: .8, surfaceLift: .7,
  crestDistance: 3, crestEnergy: .8, crestSurfable: true,
  boardStability: 1, waveHeight: 2,
};
const engaged = evaluateBoardWaterInteraction({ ...cutback, faceTrimSupport: 1 });
const unengaged = evaluateBoardWaterInteraction(cutback);
assert.ok(engaged.planing > .9, "a fast cutback must retain hull planing across the wave");
assert.ok(engaged.crossWaveLoad < unengaged.crossWaveLoad * .5,
  "an engaged cutback must not be treated as a prone broadside impact");

let elapsed = 0;
for (let i = 0; i < 60; i++) elapsed = advanceOceanClock(elapsed, 1 / 60, true);
assert.ok(Math.abs(elapsed - 1) < 1e-12);
assert.equal(advanceOceanClock(elapsed, 20, true), elapsed, "tab resume moved the crest out from under the rider");
assert.equal(advanceOceanClock(elapsed, 1 / 60, false), elapsed, "pause advanced the ocean");
assert.equal(advanceOceanClock(elapsed, .2, true), elapsed + .05, "ocean and hull use different stall timesteps");

const beach = BEACHES.find((coast) => coast.id === "trestles");
const character = getBreakCharacter(beach.id, "Lowers");
const settings = quickSurfSettings(settingsFromConditions(fallbackConditions(beach), beach.heading));
let previousTime = -1;
for (let sequence = 1; sequence <= 12; sequence++) {
  const entry = findSurfEntry(settings, character, sequence);
  assert.ok(entry, `quick drop ${sequence} did not find an actual surfable face`);
  assert.ok(entry.elapsed > previousTime, "Next wave repeated the same crest");
  previousTime = entry.elapsed;
  const surface = waveSurfaceFrameAt(entry.x, entry.z, entry.elapsed, settings, character);
  assert.equal(surface.height, entry.surfaceHeight, "spawn and rendered water disagree");
  assert.ok(surface.depth > 1 && entry.crestEnergy >= .3);
  assert.ok(Object.values(entry).every(Number.isFinite), "non-finite initial surf state");
  const origin = findWaveBreakingContourAt(0, entry.elapsed, settings, character, .86);
  const pocket = (at) => resolveWavePocketFrame({
    crestPhase: entry.crestPhase,
    referencePhase: primaryWavePhaseAt(0, origin.z, at, settings, character),
    elapsed: at, wavePeriod: settings.wavePeriod, waveSpeed: 5,
    peel: character.peel, breakLength: character.length,
    lineSide: entry.lineSide, variability: 0,
  });
  assert.ok((pocket(entry.elapsed + .5).pocketAlong - pocket(entry.elapsed).pocketAlong)
    * entry.lineSide > 0, "the pocket must peel past a fixed seabed peak");
}
console.log(JSON.stringify({
  railEnergyAfter10000Turns: Math.hypot(velocity.velocityX, velocity.velocityZ),
  arcSpeeds30To120Hz: runs.map((run) => +run.speed.toFixed(3)),
  maximumTrajectoryDifferenceMetres: +Math.hypot(runs[0].x - runs[2].x, runs[0].z - runs[2].z).toFixed(3),
  consecutiveSurfableDrops: 12,
}, null, 2));
