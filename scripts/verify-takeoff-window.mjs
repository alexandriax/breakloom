import {
  advanceBoardHeaveDynamics,
  advanceBoardPitchDynamics,
  advanceBoardRollDynamics,
  advancePaddleboardDynamics,
  advancePaddleStrokeCycle,
  advanceProneBoardAttitude,
  advanceSurfboardDynamics,
  advanceRideCaptureState,
  advanceWaveTakeoffCapture,
  evaluateBoardWaterInteraction,
  evaluateProneBoardFailure,
  evaluateWaveTakeoff,
  initialWavePopUpCapture,
  paddlingStaminaDelta,
  primaryWaveVelocityAt,
  rideRailInputFromPaddleSteer,
  surfboardReleaseVerticalImpulse,
  surfboardReleaseYawImpulse,
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
const alignedPopUpStart = initialWavePopUpCapture(
  alignedBoard.capture,
  alignedBoard.planing,
);
if (
  alignedPopUpStart < .2
  || alignedPopUpStart >= .72
  || waveTakeoffCanStand(0, alignedPopUpStart, 1)
) {
  throw new Error("An engaged pop-up skipped its physical hand-plant transition");
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
const airborneDynamics = advanceSurfboardDynamics(dynamicsState, {
  ...dynamicsSample,
  surfaceSlopeZ: -.2,
  railInput: 1,
  waterContact: 0,
});
if (
  Math.abs(airborneDynamics.gravityDrive) > .001
  || Math.abs(airborneDynamics.railLoad) > .001
  || Math.abs(airborneDynamics.wavePressure) > .001
) {
  throw new Error("An airborne board is still receiving rail, slope, or wave pressure");
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
const steepNosePressure = advanceSurfboardDynamics(
  { velocityX: 0, velocityZ: 6, heading: 0, yawRate: 0 },
  {
    ...dynamicsSample,
    surfaceSlopeZ: -.28,
    stance: .92,
    waveContact: .9,
  },
);
const centeredSteepDrop = advanceSurfboardDynamics(
  { velocityX: 0, velocityZ: 6, heading: 0, yawRate: 0 },
  {
    ...dynamicsSample,
    surfaceSlopeZ: -.28,
    stance: 0,
    waveContact: .9,
  },
);
if (steepNosePressure.pearlingRisk < .4 || centeredSteepDrop.pearlingRisk > .01) {
  throw new Error("Steep-face nose pressure is not producing a distinct pearling risk");
}
const clearNoseContact = advanceSurfboardDynamics(
  { velocityX: 0, velocityZ: 6, heading: 0, yawRate: 0 },
  {
    ...dynamicsSample,
    stance: .68,
    waveContact: .9,
    noseImmersion: 0,
  },
);
const immersedNoseContact = advanceSurfboardDynamics(
  { velocityX: 0, velocityZ: 6, heading: 0, yawRate: 0 },
  {
    ...dynamicsSample,
    stance: .68,
    waveContact: .9,
    noseImmersion: .15,
  },
);
if (
  immersedNoseContact.pearlingRisk < .35
  || immersedNoseContact.accelerationZ >= clearNoseContact.accelerationZ - .25
) {
  throw new Error("Measured nose immersion is not creating additional hydrodynamic deceleration");
}
const lowSpeedTailPressure = advanceSurfboardDynamics(
  { velocityX: 0, velocityZ: 1, heading: 0, yawRate: 0 },
  {
    ...dynamicsSample,
    stance: -.92,
    waveContact: .9,
  },
);
if (lowSpeedTailPressure.tailStall < .3) {
  throw new Error("Heavy tail pressure at low speed is not stalling the board");
}

const rollSample = {
  deltaSeconds: 1 / 60,
  railInput: 0,
  counterweight: 0,
  crossSlope: 0,
  lateralAcceleration: 0,
  crossWaveLoad: 0,
  crossWaveSide: 1,
  speed: 5,
  planing: .82,
  boardWidth: .32,
  boardStability: .9,
  whitewater: 0,
};
function rollForFrames(frameCount, sample = rollSample, initial = {
  rollAngle: 0,
  rollRate: 0,
}) {
  let state = initial;
  for (let frame = 0; frame < frameCount; frame += 1) {
    state = advanceBoardRollDynamics(state, sample);
  }
  return state;
}
const centeredRoll = rollForFrames(180);
if (Math.abs(centeredRoll.rollAngle) > .001 || Math.abs(centeredRoll.rollRate) > .001) {
  throw new Error("A centered board developed roll without an applied torque");
}
const loadedPerformanceRail = rollForFrames(60, {
  ...rollSample,
  railInput: .8,
});
const loadedLongboardRail = rollForFrames(60, {
  ...rollSample,
  railInput: .8,
  boardWidth: .43,
  boardStability: 1.28,
});
if (
  loadedPerformanceRail.effectiveRail < .32
  || loadedLongboardRail.rollAngle >= loadedPerformanceRail.rollAngle * .84
) {
  throw new Error("Board width and stability no longer produce distinct roll inertia");
}
const recoveredRail = rollForFrames(
  150,
  rollSample,
  loadedPerformanceRail,
);
if (Math.abs(recoveredRail.rollAngle) >= Math.abs(loadedPerformanceRail.rollAngle) * .45) {
  throw new Error("Hydrodynamic righting force did not recover a released rail");
}
const crossWaveProbe = advanceBoardRollDynamics(
  { rollAngle: 0, rollRate: 0 },
  {
    ...rollSample,
    speed: 1.2,
    planing: .12,
    crossSlope: .12,
    crossWaveLoad: .72,
    whitewater: .3,
  },
);
const unbalancedCrossWave = rollForFrames(75, {
  ...rollSample,
  speed: 1.2,
  planing: .12,
  crossSlope: .12,
  crossWaveLoad: .72,
  whitewater: .3,
});
const counterweightedCrossWave = rollForFrames(75, {
  ...rollSample,
  speed: 1.2,
  planing: .12,
  crossSlope: .12,
  crossWaveLoad: .72,
  whitewater: .3,
  counterweight: crossWaveProbe.balanceTarget,
});
if (
  unbalancedCrossWave.edgeRisk < .35
  || Math.abs(counterweightedCrossWave.rollAngle) >= Math.abs(unbalancedCrossWave.rollAngle) * .55
) {
  throw new Error("Counterweight is not physically opposing cross-wave roll torque");
}
const airborneRoll = rollForFrames(45, {
  ...rollSample,
  planing: 0,
  crossSlope: .2,
  crossWaveLoad: .8,
  waterContact: 0,
}, {
  rollAngle: .2,
  rollRate: .55,
});
if (airborneRoll.edgeRisk > .001 || airborneRoll.rollAngle <= .24) {
  throw new Error("Airborne roll is still being righted or edge-checked by absent water");
}

const pitchSample = {
  deltaSeconds: 1 / 60,
  stance: 0,
  longitudinalAcceleration: 0,
  noseSurfaceOffset: 0,
  tailSurfaceOffset: 0,
  speed: 5,
  planing: .78,
  boardLength: 2.5,
  boardStability: .9,
  waveContact: .9,
  whitewater: 0,
};
function pitchForFrames(frameCount, sample = pitchSample, initial = {
  pitchAngle: 0,
  pitchRate: 0,
}) {
  let state = initial;
  for (let frame = 0; frame < frameCount; frame += 1) {
    state = advanceBoardPitchDynamics(state, sample);
  }
  return state;
}
const centeredPitch = pitchForFrames(180);
if (Math.abs(centeredPitch.pitchAngle) > .001 || Math.abs(centeredPitch.pitchRate) > .001) {
  throw new Error("A centered board developed pitch without fore-aft torque");
}
const noseWeightedPitch = pitchForFrames(75, {
  ...pitchSample,
  stance: .82,
});
const tailWeightedPitch = pitchForFrames(75, {
  ...pitchSample,
  stance: -.82,
  speed: 1.1,
  planing: .08,
});
if (noseWeightedPitch.pitchAngle <= .025 || tailWeightedPitch.pitchAngle >= -.025) {
  throw new Error("Fore-aft stance is not rotating the board around its center of buoyancy");
}
const recoveredPitch = pitchForFrames(180, pitchSample, noseWeightedPitch);
if (Math.abs(recoveredPitch.pitchAngle) >= Math.abs(noseWeightedPitch.pitchAngle) * .45) {
  throw new Error("Nose and tail contact did not restore neutral trim after stance release");
}
const risingNoseContact = pitchForFrames(45, {
  ...pitchSample,
  stance: .76,
  noseSurfaceOffset: .15,
  longitudinalAcceleration: -2.4,
});
if (
  risingNoseContact.noseImmersion < .04
  || risingNoseContact.pearlingRisk < .35
  || risingNoseContact.pitchOverRisk < .2
) {
  throw new Error("A loaded nose meeting a rising polygon did not produce a physical pearling risk");
}
const sunkTailContact = pitchForFrames(75, {
  ...pitchSample,
  stance: -.9,
  speed: .8,
  planing: .04,
  tailSurfaceOffset: .08,
});
if (sunkTailContact.tailImmersion < .03 || sunkTailContact.tailStallRisk < .25) {
  throw new Error("A low-speed, tail-heavy board did not sink and stall");
}
const airbornePitch = pitchForFrames(45, {
  ...pitchSample,
  waveContact: 0,
  planing: 0,
  noseSurfaceOffset: .2,
  turbulenceTorque: .4,
}, {
  pitchAngle: .12,
  pitchRate: .42,
});
if (
  airbornePitch.pearlingRisk > .001
  || airbornePitch.tailStallRisk > .001
  || airbornePitch.pitchAngle <= .16
) {
  throw new Error("Airborne pitch is still reacting to absent nose or tail water contact");
}

const heaveSample = {
  deltaSeconds: 1 / 60,
  surfaceHeight: 0,
  flotationOffset: .3,
  planing: 0,
  speed: 0,
  waveContact: 0,
  boardLength: 2.5,
  boardWidth: .32,
  boardStability: .9,
  whitewater: 0,
};
function heaveForFrames(frameCount, sample = heaveSample, initial = {
  elevation: .15,
  verticalVelocity: 0,
  previousSurfaceHeight: 0,
  waterContact: 1,
}) {
  let state = initial;
  for (let frame = 0; frame < frameCount; frame += 1) {
    state = advanceBoardHeaveDynamics(state, sample);
  }
  return state;
}
const staticHeave = heaveForFrames(600);
if (
  staticHeave.elevation < .1
  || staticHeave.elevation > .21
  || Math.abs(staticHeave.verticalVelocity) > .02
  || staticHeave.waterContact < .9
) {
  throw new Error("A floating board did not settle into a stable buoyant waterline");
}
const planingHeave = heaveForFrames(360, {
  ...heaveSample,
  planing: .86,
  speed: 6.2,
  waveContact: .82,
});
if (planingHeave.elevation <= staticHeave.elevation + .018) {
  throw new Error("Planing pressure is not lifting the hull relative to static flotation");
}
const droppedSurface = advanceBoardHeaveDynamics(staticHeave, {
  ...heaveSample,
  surfaceHeight: -.55,
});
if (droppedSurface.waterContact > .2 || droppedSurface.airborneHeight < .22) {
  throw new Error("A falling polygon surface did not release the board into ballistic heave");
}
let fallingBoard = droppedSurface;
let peakLandingImpact = 0;
for (let frame = 0; frame < 120; frame += 1) {
  fallingBoard = advanceBoardHeaveDynamics(fallingBoard, {
    ...heaveSample,
    surfaceHeight: -.55,
  });
  peakLandingImpact = Math.max(peakLandingImpact, fallingBoard.landingImpact);
}
if (peakLandingImpact < .08 || fallingBoard.waterContact < .85) {
  throw new Error("An airborne board did not reconnect with a measurable landing impact");
}
const risingSurface = advanceBoardHeaveDynamics(staticHeave, {
  ...heaveSample,
  surfaceHeight: .2,
  waveContact: .8,
});
if (risingSurface.verticalAcceleration < 3) {
  throw new Error("A rising polygon did not transfer upward pressure into the hull");
}
const proneSample = {
  deltaSeconds: 1 / 60,
  balance: 0,
  trim: -.06,
  crossSlope: 0,
  lateralAcceleration: 0,
  longitudinalAcceleration: 0,
  crossWaveLoad: 0,
  crossWaveSide: 1,
  noseSurfaceOffset: 0,
  tailSurfaceOffset: 0,
  turbulenceTorque: 0,
  speed: 3,
  planing: .42,
  waveContact: .32,
  boardLength: 2.5,
  boardWidth: .32,
  boardStability: .9,
  whitewater: 0,
  surfaceHeight: 0,
  flotationOffset: .3,
};
function proneForFrames(frameCount, sample = proneSample) {
  let state = {
    roll: { rollAngle: 0, rollRate: 0 },
    pitch: { pitchAngle: 0, pitchRate: 0 },
    heave: {
      elevation: staticHeave.elevation,
      verticalVelocity: staticHeave.verticalVelocity,
      previousSurfaceHeight: 0,
      waterContact: 1,
    },
  };
  let reading = null;
  for (let frame = 0; frame < frameCount; frame += 1) {
    reading = advanceProneBoardAttitude(state, sample);
    state = {
      roll: reading.roll,
      pitch: reading.pitch,
      heave: reading.heave,
    };
  }
  return reading;
}
const neutralProne = proneForFrames(360);
if (
  Math.abs(neutralProne.roll.rollAngle) > .02
  || Math.abs(neutralProne.pitch.pitchAngle) > .08
  || neutralProne.heave.waterContact < .84
) {
  throw new Error("A neutral prone board did not settle into a stable contact state");
}
const broadsideProne = proneForFrames(90, {
  ...proneSample,
  crossSlope: .11,
  crossWaveLoad: 1.18,
  waveContact: .9,
  whitewater: .42,
});
const counterweightedProne = proneForFrames(90, {
  ...proneSample,
  balance: 1,
  crossSlope: .11,
  crossWaveLoad: 1.18,
  waveContact: .9,
  whitewater: .42,
});
if (
  Math.abs(broadsideProne.roll.rollAngle) < .28
  || broadsideProne.roll.capsizeRisk < .2
  || Math.abs(counterweightedProne.roll.rollAngle)
    >= Math.abs(broadsideProne.roll.rollAngle) * .78
) {
  throw new Error("Prone roll no longer reacts physically to broadside load and body counterweight");
}
const noseLoadedProne = proneForFrames(75, {
  ...proneSample,
  trim: .3,
  noseSurfaceOffset: .19,
  speed: 5.4,
  planing: .74,
  waveContact: .92,
});
if (
  noseLoadedProne.pitch.noseImmersion < .08
  || noseLoadedProne.pitch.pearlingRisk < .2
) {
  throw new Error("Prone nose contact no longer produces a physical pearling risk");
}
const settledProneFailure = evaluateProneBoardFailure({
  capsizeRisk: neutralProne.roll.capsizeRisk,
  pitchOverRisk: neutralProne.pitch.pitchOverRisk,
  crossWaveLoad: 0,
  whitewater: 0,
  waveEnergy: .4,
});
const broadsideProneFailure = evaluateProneBoardFailure({
  capsizeRisk: broadsideProne.roll.capsizeRisk,
  pitchOverRisk: broadsideProne.pitch.pitchOverRisk,
  crossWaveLoad: 1.18,
  whitewater: .42,
  waveEnergy: .7,
});
const noseLoadedProneFailure = evaluateProneBoardFailure({
  capsizeRisk: noseLoadedProne.roll.capsizeRisk,
  pitchOverRisk: .94,
  crossWaveLoad: .28,
  whitewater: .08,
  waveEnergy: .68,
});
if (
  settledProneFailure.failed
  || !broadsideProneFailure.failed
  || !noseLoadedProneFailure.failed
  || broadsideProneFailure.power <= settledProneFailure.power
) {
  throw new Error("Prone separation no longer distinguishes stable contact from rail and nose failure");
}
const flatReleaseImpulse = surfboardReleaseVerticalImpulse({
  compression: 1,
  tailPressure: .7,
  facePosition: -.1,
  waveQuality: .8,
  speed: 12,
  planing: .9,
  waterContact: 1,
  boardLength: 2.1,
});
const lipReleaseImpulse = surfboardReleaseVerticalImpulse({
  compression: .92,
  tailPressure: .62,
  facePosition: .54,
  waveQuality: .86,
  speed: 12.4,
  planing: .88,
  waterContact: .94,
  boardLength: 2.1,
});
if (
  flatReleaseImpulse > 1.15
  || lipReleaseImpulse < 3
  || lipReleaseImpulse <= flatReleaseImpulse * 3
) {
  throw new Error("Tail release no longer distinguishes a live upper-face ramp from flat water");
}
let launchedBoard = {
  ...staticHeave,
  verticalVelocity: staticHeave.verticalVelocity + lipReleaseImpulse,
};
let peakReleaseHeight = 0;
let releaseLandingImpact = 0;
let releaseLostContact = false;
for (let frame = 0; frame < 180; frame += 1) {
  launchedBoard = advanceBoardHeaveDynamics(launchedBoard, {
    ...heaveSample,
    planing: .84,
    speed: 11.8,
    waveContact: .82,
  });
  peakReleaseHeight = Math.max(peakReleaseHeight, launchedBoard.airborneHeight);
  releaseLandingImpact = Math.max(releaseLandingImpact, launchedBoard.landingImpact);
  if (launchedBoard.waterContact < .2) releaseLostContact = true;
}
if (
  !releaseLostContact
  || peakReleaseHeight < .32
  || releaseLandingImpact < .06
  || launchedBoard.waterContact < .82
) {
  throw new Error("A lip release did not produce ballistic flight and a physical reconnection");
}
const performanceYawRelease = surfboardReleaseYawImpulse({
  desiredRotation: Math.PI,
  verticalImpulse: lipReleaseImpulse,
  charge: .92,
  waterContact: .94,
  boardLength: 2.1,
});
const longboardYawRelease = surfboardReleaseYawImpulse({
  desiredRotation: Math.PI,
  verticalImpulse: lipReleaseImpulse,
  charge: .92,
  waterContact: .94,
  boardLength: 3,
});
const disconnectedYawRelease = surfboardReleaseYawImpulse({
  desiredRotation: Math.PI,
  verticalImpulse: lipReleaseImpulse,
  charge: .92,
  waterContact: 0,
  boardLength: 2.1,
});
if (
  performanceYawRelease < 3.5
  || longboardYawRelease >= performanceYawRelease * .72
  || disconnectedYawRelease !== 0
) {
  throw new Error("Tail-release yaw impulse no longer respects contact and board inertia");
}
let airborneSpin = {
  velocityX: 0,
  velocityZ: 11.8,
  heading: 0,
  yawRate: performanceYawRelease,
};
let accumulatedAirYaw = 0;
for (let frame = 0; frame < 52; frame += 1) {
  const priorHeading = airborneSpin.heading;
  airborneSpin = advanceSurfboardDynamics(airborneSpin, {
    ...dynamicsSample,
    waveContact: 0,
    waterContact: 0,
    railInput: 0,
  });
  accumulatedAirYaw += Math.atan2(
    Math.sin(airborneSpin.heading - priorHeading),
    Math.cos(airborneSpin.heading - priorHeading),
  );
}
if (
  accumulatedAirYaw < Math.PI * .72
  || airborneSpin.yawRate < performanceYawRelease * .45
) {
  throw new Error("Airborne board yaw no longer conserves release angular momentum");
}

const paddlingSample = {
  deltaSeconds: 1 / 60,
  stroke: 1,
  steer: 0,
  surfaceSlopeX: 0,
  surfaceSlopeZ: 0,
  waveVelocityX: 0,
  waveVelocityZ: 0,
  currentVelocityX: 0,
  currentVelocityZ: 0,
  boardLength: 2.5,
  boardWidth: .32,
  boardTurn: 1,
  paddleEfficiency: 1,
};
function paddleForFrames(frameCount, sample = paddlingSample) {
  let state = {
    velocityX: 0,
    velocityZ: 0,
    heading: 0,
    yawRate: 0,
  };
  let strokeCycle = { phase: 0 };
  for (let frame = 0; frame < frameCount; frame += 1) {
    const cycle = advancePaddleStrokeCycle(strokeCycle, {
      deltaSeconds: sample.deltaSeconds,
      effort: Math.max(0, sample.stroke),
      steer: sample.steer,
      stamina: 82,
    });
    strokeCycle = cycle;
    state = advancePaddleboardDynamics(state, {
      ...sample,
      stroke: sample.stroke > 0 ? cycle.drive : sample.stroke,
      strokeSide: cycle.strokeSide,
    });
  }
  return state;
}
const steadyPaddle = paddleForFrames(600);
if (steadyPaddle.velocityZ < 2 || steadyPaddle.velocityZ > 3.4) {
  throw new Error(`Human paddle force produced an implausible terminal speed: ${steadyPaddle.velocityZ.toFixed(2)}m/s`);
}
let paddleCoast = steadyPaddle;
for (let frame = 0; frame < 120; frame += 1) {
  paddleCoast = advancePaddleboardDynamics(paddleCoast, {
    ...paddlingSample,
    stroke: 0,
  });
}
if (paddleCoast.velocityZ >= steadyPaddle.velocityZ || paddleCoast.velocityZ <= .3) {
  throw new Error("Paddling momentum did not decay continuously after the stroke stopped");
}
const paddleCurrent = advancePaddleboardDynamics(
  { velocityX: 0, velocityZ: 0, heading: 0, yawRate: 0 },
  {
    ...paddlingSample,
    stroke: 0,
    currentVelocityX: .8,
  },
);
if (paddleCurrent.velocityX <= 0) {
  throw new Error("A prone board did not begin drifting with the current");
}
const performancePaddleTurn = paddleForFrames(120, {
  ...paddlingSample,
  steer: 1,
});
const longboardPaddleTurn = paddleForFrames(120, {
  ...paddlingSample,
  steer: 1,
  boardLength: 3.45,
  boardWidth: .43,
  boardTurn: .82,
});
if (
  Math.abs(performancePaddleTurn.heading) < .5
  || Math.abs(longboardPaddleTurn.heading) >= Math.abs(performancePaddleTurn.heading) * .78
) {
  throw new Error("Prone board yaw inertia no longer distinguishes a longboard from a shortboard");
}
let cycleProbe = { phase: 0 };
let leftStrokeImpulse = 0;
let rightStrokeImpulse = 0;
let neutralDriveIntegral = 0;
for (let frame = 0; frame < 1200; frame += 1) {
  const cycle = advancePaddleStrokeCycle(cycleProbe, {
    deltaSeconds: 1 / 60,
    effort: 1,
    steer: 0,
    stamina: 82,
  });
  cycleProbe = cycle;
  neutralDriveIntegral += cycle.drive;
  if (cycle.strokeSide < 0) leftStrokeImpulse += cycle.drive;
  else rightStrokeImpulse += cycle.drive;
}
const averageStrokeDrive = neutralDriveIntegral / 1200;
if (
  averageStrokeDrive < .4
  || averageStrokeDrive > .55
  || Math.abs(leftStrokeImpulse - rightStrokeImpulse)
    / Math.max(1, leftStrokeImpulse + rightStrokeImpulse) > .025
) {
  throw new Error("Alternating paddle cadence no longer produces balanced pulsed thrust");
}
let steeringCycle = { phase: 0 };
let steeringLeftImpulse = 0;
let steeringRightImpulse = 0;
for (let frame = 0; frame < 360; frame += 1) {
  const cycle = advancePaddleStrokeCycle(steeringCycle, {
    deltaSeconds: 1 / 60,
    effort: 1,
    steer: 1,
    stamina: 82,
  });
  steeringCycle = cycle;
  if (cycle.strokeSide < 0) steeringLeftImpulse += cycle.drive;
  else steeringRightImpulse += cycle.drive;
}
if (Math.abs(steeringLeftImpulse - steeringRightImpulse) < 20) {
  throw new Error("Paddle steering is not biasing force between left and right pulls");
}
const leftHandPull = advancePaddleboardDynamics(
  {
    velocityX: 0,
    velocityZ: 1.4,
    heading: 0,
    yawRate: 0,
  },
  {
    ...paddlingSample,
    stroke: .8,
    strokeSide: -1,
    steer: 0,
  },
);
const rightHandPull = advancePaddleboardDynamics(
  {
    velocityX: 0,
    velocityZ: 1.4,
    heading: 0,
    yawRate: 0,
  },
  {
    ...paddlingSample,
    stroke: .8,
    strokeSide: 1,
    steer: 0,
  },
);
if (leftHandPull.yawRate <= 0 || rightHandPull.yawRate >= 0) {
  throw new Error("Paddle-side torque is rotating the board toward the pulling hand");
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
  alignedPopUpStart,
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
    steepNosePearlingRisk: steepNosePressure.pearlingRisk,
    immersedNosePearlingRisk: immersedNoseContact.pearlingRisk,
    immersedNoseDeceleration: immersedNoseContact.accelerationZ,
    lowSpeedTailStall: lowSpeedTailPressure.tailStall,
  },
  paddlingDynamics: {
    terminalSpeed: steadyPaddle.velocityZ,
    twoSecondCoastSpeed: paddleCoast.velocityZ,
    currentDrift: paddleCurrent.velocityX,
    performanceTurnRadians: performancePaddleTurn.heading,
    longboardTurnRadians: longboardPaddleTurn.heading,
    averageStrokeDrive,
    steeringImpulseDifference: steeringRightImpulse - steeringLeftImpulse,
  },
  rollDynamics: {
    performanceRailAngle: loadedPerformanceRail.rollAngle,
    longboardRailAngle: loadedLongboardRail.rollAngle,
    releasedRailAngle: recoveredRail.rollAngle,
    crossWaveEdgeRisk: unbalancedCrossWave.edgeRisk,
    counterweightedAngle: counterweightedCrossWave.rollAngle,
    airborneAngle: airborneRoll.rollAngle,
  },
  pitchDynamics: {
    noseWeightedAngle: noseWeightedPitch.pitchAngle,
    tailWeightedAngle: tailWeightedPitch.pitchAngle,
    releasedAngle: recoveredPitch.pitchAngle,
    pearlingRisk: risingNoseContact.pearlingRisk,
    pitchOverRisk: risingNoseContact.pitchOverRisk,
    tailStallRisk: sunkTailContact.tailStallRisk,
    airborneAngle: airbornePitch.pitchAngle,
  },
  heaveDynamics: {
    staticElevation: staticHeave.elevation,
    planingElevation: planingHeave.elevation,
    droppedAirborneHeight: droppedSurface.airborneHeight,
    landingImpact: peakLandingImpact,
    risingAcceleration: risingSurface.verticalAcceleration,
    flatReleaseImpulse,
    lipReleaseImpulse,
    releaseAirborneHeight: peakReleaseHeight,
    releaseLandingImpact,
    performanceYawRelease,
    longboardYawRelease,
    accumulatedAirYaw,
    proneBroadsideRoll: broadsideProne.roll.rollAngle,
    proneBroadsideCapsize: broadsideProne.roll.capsizeRisk,
    proneCounterweightedRoll: counterweightedProne.roll.rollAngle,
    proneNoseImmersion: noseLoadedProne.pitch.noseImmersion,
    proneBroadsideFailurePower: broadsideProneFailure.power,
  },
}, null, 2));
