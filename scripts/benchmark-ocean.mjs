// Representative board, transport, camera, and instrument queries.
// Report timings; do not gate CI on the speed of its host.
import { performance } from "node:perf_hooks";
import {
  waveSurfaceFrameAt, waveHeightAt, waveSetStateAt, primaryWaveVelocityAt,
  waveBreakingGeometryAt, settingsFromConditions,
} from "../lib/game.ts";
import { BEACHES, getBreakCharacter } from "../lib/beaches.ts";
import { fallbackConditions } from "../lib/marine.ts";

const coast = BEACHES.find((beach) => beach.id === "trestles");
const character = getBreakCharacter(coast.id, "Lowers");
const settings = settingsFromConditions(fallbackConditions(coast), coast.heading);
const times = [];
let checksum = 0;
for (let frame = 0; frame < 1200; frame++) {
  const start = performance.now();
  const time = 100 + frame / 60;
  const x = Math.sin(frame * .01) * 15;
  const z = -25 + Math.cos(frame * .003) * 5;
  const face = waveSurfaceFrameAt(x, z, time, settings, character);
  checksum += face.height
    + waveHeightAt(x, z, time, settings, character)
    + primaryWaveVelocityAt(x, z, time, settings, character).speed
    + waveSetStateAt(x, z, time, settings, character).crestEnergy
    + waveBreakingGeometryAt(x, z, time, settings, character).breakingRatio;
  for (const [dx, dz] of [[0, 1], [0, -1], [.3, 0], [-.3, 0]]) {
    checksum += waveSurfaceFrameAt(x + dx, z + dz, time, settings, character).height;
    checksum += waveHeightAt(x + dx, z + dz, time, settings, character);
  }
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({
  checksum,
  frames: times.length,
  meanMs: times.reduce((sum, value) => sum + value, 0) / times.length,
  p50Ms: times[600],
  p95Ms: times[1140],
  p99Ms: times[1188],
}, null, 2));
