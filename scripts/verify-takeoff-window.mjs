import {
  advanceWaveTakeoffCapture,
  evaluateWaveTakeoff,
  primaryWaveVelocityAt,
  waveHeightAt,
  waveSetStateAt,
  waveSurfaceFrameAt,
  waveTakeoffCanStand,
} from "../lib/game.ts";

const settings = {
  mode: "training",
  board: "performance",
  waveHeight: 2,
  wavePeriod: 8,
  waveDirection: 168,
  swellHeight: 1.2,
  swellPeriod: 10,
  swellDirection: 168,
  currentStrength: .6,
  currentDirection: 90,
  windSpeed: 5,
  windDirection: 156,
  waterTemperature: 20,
  airTemperature: 24,
  coastHeading: 156,
  tide: 0,
  timeOfDay: 16,
  weatherCode: 1,
};

const character = {
  kind: "beach",
  line: "A-FRAME",
  peel: .18,
  power: 1,
  steepness: .72,
  hollow: .38,
  variability: .32,
  length: 1,
};

const x = 0;
const z = -34;
const lookback = .16;

function readingAt(time, alignment, paddleDrive, mode, sampleZ = z) {
  const session = { ...settings, mode };
  const state = waveSetStateAt(x, sampleZ, time, session, character);
  const transport = primaryWaveVelocityAt(x, sampleZ, time, session, character);
  const frame = waveSurfaceFrameAt(x, sampleZ, time, session, character);
  const normalX = transport.x / transport.speed;
  const normalZ = transport.z / transport.speed;
  const faceSlope = Math.max(
    0,
    -(frame.slopeX * normalX + frame.slopeZ * normalZ),
  );
  const surfaceRise = (
    frame.height
    - waveHeightAt(x, sampleZ, time - lookback, session, character)
  ) / lookback;
  const waveNumber = Math.PI * 2 / transport.wavelength;
  return evaluateWaveTakeoff({
    mode,
    crestDistance: state.crestPhaseError / waveNumber,
    crestEnergy: state.crestEnergy,
    crestSurfable: state.crestSurfable,
    faceSlope,
    surfaceRise,
    surfaceLift: frame.height - settings.tide * .3,
    breakProgress: .9,
    alignment,
    paddleDrive,
    waveHeight: settings.waveHeight,
  });
}

function catchWindows(alignment, paddleDrive, mode, sampleZ = z) {
  const step = .05;
  const windows = [];
  let start = null;
  let quality = [];
  for (let time = settings.wavePeriod; time <= settings.wavePeriod * 17; time += step) {
    const reading = readingAt(time, alignment, paddleDrive, mode, sampleZ);
    if (reading.catchable) {
      if (start === null) {
        start = time;
        quality = [];
      }
      quality.push(reading.quality);
    } else if (start !== null) {
      windows.push({
        duration: time - start,
        quality: quality.reduce((total, value) => total + value, 0) / quality.length,
      });
      start = null;
    }
  }
  return windows;
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function verifyWindows(label, windows, minimumMedian) {
  if (windows.length < 12) {
    throw new Error(`${label}: expected repeated surfable faces, found ${windows.length}`);
  }
  const medianDuration = median(windows.map((window) => window.duration));
  if (medianDuration < minimumMedian) {
    throw new Error(`${label}: median catch window ${medianDuration.toFixed(2)}s is too short`);
  }
  return {
    count: windows.length,
    medianDuration,
    averageQuality: windows.reduce((total, window) => total + window.quality, 0) / windows.length,
  };
}

const idealTraining = verifyWindows(
  "ideal training takeoff",
  catchWindows(1, .85, "training"),
  2.2,
);
const marginalTraining = verifyWindows(
  "marginal training takeoff",
  catchWindows(.35, .15, "training"),
  1.9,
);
const idealAdvanced = verifyWindows(
  "ideal advanced takeoff",
  catchWindows(1, .85, "advanced"),
  2,
);
const marginalAdvanced = verifyWindows(
  "marginal advanced takeoff",
  catchWindows(.35, .15, "advanced"),
  1.7,
);
const insideReform = verifyWindows(
  "inside reform takeoff",
  catchWindows(.55, .35, "training", -20),
  1.6,
);

if (idealTraining.averageQuality - marginalTraining.averageQuality < .2) {
  throw new Error("Position and paddle quality no longer have a meaningful ride-quality cost");
}

const sharedSample = {
  mode: "training",
  crestEnergy: .42,
  crestSurfable: true,
  faceSlope: .08,
  surfaceRise: .34,
  surfaceLift: .62,
  breakProgress: .9,
  alignment: .35,
  paddleDrive: .15,
  waveHeight: 2,
};
const earlyFace = evaluateWaveTakeoff({ ...sharedSample, crestDistance: 8 });
const pocketFace = evaluateWaveTakeoff({ ...sharedSample, crestDistance: 3.2 });
const lateFace = evaluateWaveTakeoff({ ...sharedSample, crestDistance: -1.8 });
if (!earlyFace.catchable || !pocketFace.catchable || !lateFace.catchable) {
  throw new Error("The rising face is not catchable across early, pocket, and late positions");
}
if (pocketFace.quality <= earlyFace.quality || pocketFace.quality <= lateFace.quality) {
  throw new Error("Better face placement should improve takeoff quality without gating other entries");
}

const visiblyStandingWeakCrest = evaluateWaveTakeoff({
  ...sharedSample,
  crestDistance: 3,
  crestEnergy: .2,
  crestSurfable: false,
});
if (!visiblyStandingWeakCrest.catchable) {
  throw new Error("A visibly standing lower-energy crest should remain catchable");
}

const flatWater = evaluateWaveTakeoff({
  ...sharedSample,
  crestDistance: 3,
  crestEnergy: .18,
  crestSurfable: false,
  faceSlope: 0,
  surfaceRise: 0,
  surfaceLift: 0,
});
if (flatWater.catchable) {
  throw new Error("Flat water must not produce a takeoff opportunity");
}

let marginalCapture = .22 + marginalTraining.averageQuality * .22;
let marginalCaptureElapsed = 0;
const marginalCaptureStrength = Math.min(
  1,
  earlyFace.opportunity * .68 + earlyFace.slopeStrength * .12 + .2 * .2,
);
while (
  marginalCaptureElapsed < 1.2
  && !waveTakeoffCanStand(
    marginalCaptureElapsed,
    marginalCapture,
    earlyFace.physicalLift,
  )
) {
  marginalCapture = advanceWaveTakeoffCapture(
    marginalCapture,
    1 / 60,
    true,
    marginalCaptureStrength,
  );
  marginalCaptureElapsed += 1 / 60;
}
if (!waveTakeoffCanStand(
  marginalCaptureElapsed,
  marginalCapture,
  earlyFace.physicalLift,
)) {
  throw new Error("A marginal but engaged takeoff cannot complete its pop-up");
}
if (marginalCaptureElapsed > .92) {
  throw new Error(`Marginal pop-up took too long: ${marginalCaptureElapsed.toFixed(2)}s`);
}

console.log(JSON.stringify({
  idealTraining,
  marginalTraining,
  idealAdvanced,
  marginalAdvanced,
  insideReform,
  faceQuality: {
    early: earlyFace.quality,
    pocket: pocketFace.quality,
    late: lateFace.quality,
  },
  marginalPopUpSeconds: marginalCaptureElapsed,
}, null, 2));
