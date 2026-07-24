import {
  advanceSurfboardDynamics,
  advanceRideCaptureState,
  advanceWaveTakeoffCapture,
  evaluateBoardWaterInteraction,
  evaluateWaveTakeoff,
  paddlingStaminaDelta,
  primaryWaveVelocityAt,
  rideRailInputFromPaddleSteer,
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

function staminaAfter(mode, seconds, effort) {
  let stamina = 100;
  const step = 1 / 60;
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    stamina = Math.max(
      0,
      Math.min(100, stamina + paddlingStaminaDelta(mode, effort, step)),
    );
  }
  return stamina;
}

const trainingPaddleReserve = staminaAfter("training", 300, 1);
const advancedPaddleReserve = staminaAfter("advanced", 300, 1);
if (trainingPaddleReserve < 48 || advancedPaddleReserve < 28) {
  throw new Error(
    `Five-minute paddle-out leaves too little reserve: training ${trainingPaddleReserve.toFixed(1)}, advanced ${advancedPaddleReserve.toFixed(1)}`,
  );
}
if (rideRailInputFromPaddleSteer(1) !== -1 || rideRailInputFromPaddleSteer(-1) !== 1) {
  throw new Error("Ride rail conversion no longer preserves paddle steering intent");
}

let overtakenCapture = { overtaken: 0, ahead: 0 };
for (let frame = 0; frame < 180; frame += 1) {
  overtakenCapture = advanceRideCaptureState(overtakenCapture, {
    deltaSeconds: 1 / 60,
    crestPhaseError: -.38,
    normalSpeed: 4.2,
    waveSpeed: 6,
    facePhaseSpan: .9,
    gravityPlaning: .18,
  });
}
if (overtakenCapture.overtaken < .9) {
  throw new Error(`An overtaking lip failed to end magnetic capture: ${overtakenCapture.overtaken.toFixed(2)}`);
}

let shoulderCapture = { overtaken: 0, ahead: 0 };
for (let frame = 0; frame < 100; frame += 1) {
  shoulderCapture = advanceRideCaptureState(shoulderCapture, {
    deltaSeconds: 1 / 60,
    crestPhaseError: 1.85,
    normalSpeed: 6.5,
    waveSpeed: 6,
    facePhaseSpan: .9,
    gravityPlaning: 0,
  });
}
if (shoulderCapture.ahead < .86) {
  throw new Error(`A board beyond the power failed to lose the wave: ${shoulderCapture.ahead.toFixed(2)}`);
}

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

const sharedBoardWater = {
  boardHeading: Math.atan2(0, 1),
  velocityX: 0,
  velocityZ: 0,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  slopeX: 0,
  slopeZ: -.18,
  surfaceRise: .56,
  surfaceLift: .82,
  crestDistance: 3.2,
  crestEnergy: .72,
  crestSurfable: true,
  boardStability: 1,
  waveHeight: 2,
};
const alignedBoard = evaluateBoardWaterInteraction({
  ...sharedBoardWater,
  velocityZ: 3.4,
});
if (alignedBoard.outcome !== "capture" || alignedBoard.capture < .2) {
  throw new Error(`An aligned, planing board failed to capture the face: ${JSON.stringify(alignedBoard)}`);
}

const broadsideBoard = evaluateBoardWaterInteraction({
  ...sharedBoardWater,
  boardHeading: Math.PI / 2,
});
if (
  broadsideBoard.outcome !== "tumble"
  || broadsideBoard.crossWaveLoad <= alignedBoard.crossWaveLoad
) {
  throw new Error(`A broadside board was not rolled by the face: ${JSON.stringify(broadsideBoard)}`);
}

const angleSweep = [0, 30, 45, 60, 75, 90].map((degrees) => ({
  degrees,
  reading: evaluateBoardWaterInteraction({
    ...sharedBoardWater,
    boardHeading: degrees * Math.PI / 180,
    velocityZ: 3.4,
  }),
}));
for (let index = 1; index < angleSweep.length; index += 1) {
  const previous = angleSweep[index - 1];
  const current = angleSweep[index];
  if (current.reading.capture > previous.reading.capture + .001) {
    throw new Error(`Capture improved while rotating broadside: ${previous.degrees}° to ${current.degrees}°`);
  }
  if (current.reading.crossWaveLoad + .001 < previous.reading.crossWaveLoad) {
    throw new Error(`Cross-wave load fell while rotating broadside: ${previous.degrees}° to ${current.degrees}°`);
  }
}
if (angleSweep.find(({ degrees }) => degrees === 75).reading.capture >= .2) {
  throw new Error("A board 75 degrees across the wave still acquired capture");
}
if (angleSweep.find(({ degrees }) => degrees === 45).reading.capture <= .3) {
  throw new Error("A diagonal 45-degree takeoff cannot engage the open shoulder");
}

const stillWaterStand = evaluateBoardWaterInteraction({
  ...sharedBoardWater,
  waveVelocityZ: 5,
  slopeZ: 0,
  surfaceRise: 0,
  surfaceLift: 0,
  crestDistance: 28,
  crestEnergy: .1,
  crestSurfable: false,
});
if (stillWaterStand.outcome !== "stand" || stillWaterStand.capture !== 0) {
  throw new Error(`Standing in still water incorrectly created a ride: ${JSON.stringify(stillWaterStand)}`);
}

const backwardsBoard = evaluateBoardWaterInteraction({
  ...sharedBoardWater,
  boardHeading: Math.PI,
  velocityZ: -1,
});
if (backwardsBoard.outcome === "capture" || backwardsBoard.capture > .02) {
  throw new Error(`A board facing offshore captured the wave: ${JSON.stringify(backwardsBoard)}`);
}

const dynamicsSample = {
  deltaSeconds: 1 / 60,
  surfaceSlopeX: 0,
  surfaceSlopeZ: 0,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  currentVelocityX: 0,
  currentVelocityZ: 0,
  waveContact: .8,
  railInput: 0,
  stance: 0,
  railGrip: .9,
  whitewater: 0,
  boardLength: 2.5,
  boardWidth: .32,
  boardTurn: 1,
  boardStability: 1,
  waveHeight: 2,
};
const dynamicsState = {
  velocityX: 0,
  velocityZ: 2,
  heading: 0,
  yawRate: 0,
};
const flatDynamics = advanceSurfboardDynamics(dynamicsState, {
  ...dynamicsSample,
  waveContact: 0,
});
if (flatDynamics.velocityZ >= dynamicsState.velocityZ || flatDynamics.velocityZ < 1.9) {
  throw new Error(`Flat-water dynamics created thrust or excessive drag: ${JSON.stringify(flatDynamics)}`);
}
const downhillDynamics = advanceSurfboardDynamics(dynamicsState, {
  ...dynamicsSample,
  surfaceSlopeZ: -.2,
});
const uphillDynamics = advanceSurfboardDynamics(dynamicsState, {
  ...dynamicsSample,
  surfaceSlopeZ: .2,
});
if (
  downhillDynamics.gravityDrive <= 0
  || uphillDynamics.gravityDrive >= 0
  || downhillDynamics.accelerationZ <= uphillDynamics.accelerationZ
) {
  throw new Error("Polygon slope is not producing directional gravity along the board");
}
if (downhillDynamics.velocityZ > dynamicsState.velocityZ + .2) {
  throw new Error("One dynamics step snapped the board toward crest phase speed");
}

function dynamicsAfterOneSecond(board) {
  let state = {
    velocityX: 0,
    velocityZ: 5,
    heading: 0,
    yawRate: 0,
  };
  for (let frame = 0; frame < 60; frame += 1) {
    state = advanceSurfboardDynamics(state, {
      ...dynamicsSample,
      railInput: 1,
      stance: -.3,
      ...board,
    });
  }
  return state;
}
const performanceTurn = dynamicsAfterOneSecond({
  boardLength: 2.5,
  boardWidth: .32,
  boardTurn: 1,
  boardStability: 1,
});
const longboardTurn = dynamicsAfterOneSecond({
  boardLength: 3.45,
  boardWidth: .43,
  boardTurn: .82,
  boardStability: 1.28,
});
if (performanceTurn.heading < .3) {
  throw new Error(`A loaded performance rail failed to redirect momentum: ${performanceTurn.heading.toFixed(2)}rad`);
}
if (longboardTurn.heading >= performanceTurn.heading * .78) {
  throw new Error("Longboard yaw inertia no longer distinguishes it from a shortboard");
}
const currentDrift = advanceSurfboardDynamics(
  { velocityX: 0, velocityZ: 0, heading: 0, yawRate: 0 },
  {
    ...dynamicsSample,
    waveContact: 0,
    currentVelocityX: .8,
  },
);
if (currentDrift.velocityX <= 0) {
  throw new Error("A resting board did not begin drifting with the current");
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
  endurance: {
    trainingPaddleReserve,
    advancedPaddleReserve,
  },
  captureLoss: {
    overtaken: overtakenCapture.overtaken,
    ahead: shoulderCapture.ahead,
  },
  boardWater: {
    alignedCapture: alignedBoard.capture,
    broadsideLoad: broadsideBoard.crossWaveLoad,
    broadsideWipeoutRisk: broadsideBoard.wipeoutRisk,
    stillWater: stillWaterStand.outcome,
    angleSweep: angleSweep.map(({ degrees, reading }) => ({
      degrees,
      capture: reading.capture,
      crossWaveLoad: reading.crossWaveLoad,
    })),
  },
  dynamics: {
    downhillAcceleration: downhillDynamics.accelerationZ,
    uphillAcceleration: uphillDynamics.accelerationZ,
    performanceTurnRadians: performanceTurn.heading,
    longboardTurnRadians: longboardTurn.heading,
    currentDrift: currentDrift.velocityX,
  },
}, null, 2));
