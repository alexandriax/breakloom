import {
  advanceBoardHeaveDynamics,
  advanceBoardPitchDynamics,
  advanceBoardRollDynamics,
  advancePaddleboardDynamics,
  advancePaddleStrokeCycle,
  advanceProneBoardAttitude,
  advanceSurferCompression,
  advanceSurfboardDynamics,
  advanceSurfboardInstability,
  advanceSurfboardRailSlip,
  advanceSurfboardStance,
  advanceSurfboardTumble,
  advanceRideCaptureState,
  advanceWaveEngagement,
  boardRailContactFrame,
  duckDiveSubmersionAt,
  evaluateBoardWaterInteraction,
  evaluatePopUpTransition,
  evaluateProneBoardFailure,
  evaluateWaveTakeoff,
  paddlingStaminaDelta,
  primaryWaveVelocityAt,
  readPaddleTrainingMechanics,
  readSurfTrainingForces,
  recognizeSurfboardLipManeuver,
  recognizeSurfboardSurfaceManeuver,
  resolveSurfboardPlaning,
  resolveDuckDiveInitiation,
  resolveSurfboardRailDemand,
  resolveSurfboardRailGrip,
  resolveSurfboardRailSlip,
  resolveSurfboardSeparationRelease,
  resolveSurfboardTumbleRelease,
  resolveSurfboardTurbulence,
  resolveSurfboardWavePressure,
  resolveSurfboardWipeout,
  resolveWaveLineSide,
  resolveWavePocketFrame,
  resolveWaveSectionPressure,
  resolveWaveTubePressure,
  RIDE_RESULT_LINE_Z,
  rideRailInputFromPaddleSteer,
  SHALLOW_DISMOUNT_Z,
  shorelineRideOutProgress,
  surfboardLandingSucceeded,
  surfboardReleaseVerticalImpulse,
  surfboardReleaseYawImpulse,
  surfboardWipeoutTriggered,
  surfboardLipLaunchSupport,
  waveCrestDistanceAtPhase,
  waveFacePositionAtPhase,
  waveHeightAt,
  waveSetStateAt,
  waveSurfaceFrameAt,
} from "../lib/game.ts";

function engagementFor(seconds, sample, hz = 60, initial = 0) {
  let engagement = initial;
  let reading = null;
  const frames = Math.round(seconds * hz);
  for (let frame = 0; frame < frames; frame += 1) {
    reading = advanceWaveEngagement(engagement, {
      ...sample,
      deltaSeconds: 1 / hz,
    });
    engagement = reading.engagement;
  }
  return reading;
}

const alignedEngagementSample = {
  capture: .86,
  waveContact: .82,
  waterContact: .96,
  headingAlignment: .92,
  planing: .72,
  crossWaveLoad: .08,
};
const sustainedEngagement = engagementFor(
  1.1,
  alignedEngagementSample,
);
const sustainedEngagement120 = engagementFor(
  1.1,
  alignedEngagementSample,
  120,
);
const misalignedEngagement = engagementFor(1.1, {
  ...alignedEngagementSample,
  headingAlignment: -.45,
  crossWaveLoad: .92,
});
const releasedEngagement = engagementFor(
  2.4,
  {
    ...alignedEngagementSample,
    capture: 0,
    waveContact: .03,
    waterContact: .42,
    headingAlignment: -.3,
    planing: .08,
    crossWaveLoad: .72,
  },
  60,
  sustainedEngagement.engagement,
);
if (
  sustainedEngagement.engagement < .54
  || Math.abs(
    sustainedEngagement.engagement
      - sustainedEngagement120.engagement
  ) > .012
  || misalignedEngagement.engagement > .04
  || releasedEngagement.engagement
    >= sustainedEngagement.engagement * .36
) {
  throw new Error("Wave engagement no longer builds from sustained aligned pressure and releases continuously");
}

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

function staminaAfter(seconds, effort) {
  let stamina = 100;
  const step = 1 / 60;
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    stamina = Math.max(
      0,
      Math.min(100, stamina + paddlingStaminaDelta(effort, step)),
    );
  }
  return stamina;
}

const fiveMinutePaddleReserve = staminaAfter(300, 1);
if (fiveMinutePaddleReserve < 40) {
  throw new Error(
    `Five-minute paddle-out leaves too little reserve: ${fiveMinutePaddleReserve.toFixed(1)}`,
  );
}
if (rideRailInputFromPaddleSteer(1) !== -1 || rideRailInputFromPaddleSteer(-1) !== 1) {
  throw new Error("Ride rail conversion no longer preserves paddle steering intent");
}
const shallowMidpoint = (
  RIDE_RESULT_LINE_Z + SHALLOW_DISMOUNT_Z
) * .5;
const shallowMidpointProgress = shorelineRideOutProgress(
  shallowMidpoint,
);
if (
  shorelineRideOutProgress(RIDE_RESULT_LINE_Z) !== 0
  || !Number.isFinite(shallowMidpointProgress)
  || Math.abs(shallowMidpointProgress - .5) > .000001
  || shorelineRideOutProgress(SHALLOW_DISMOUNT_Z) !== 1
) {
  throw new Error("Shallow ride-out progress no longer follows coastal position");
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
  return evaluateWaveTakeoff({
    crestDistance: waveCrestDistanceAtPhase(
      state.crestPhaseError,
      transport.wavelength,
    ),
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

if (
  idealTraining.count !== idealAdvanced.count
  || marginalTraining.count !== marginalAdvanced.count
  || Math.abs(
    idealTraining.averageQuality - idealAdvanced.averageQuality
  ) > .000001
  || Math.abs(
    marginalTraining.averageQuality
      - marginalAdvanced.averageQuality
  ) > .000001
) {
  throw new Error("Tutorial mode changed physical takeoff opportunities");
}

if (idealTraining.averageQuality - marginalTraining.averageQuality < .2) {
  throw new Error("Position and paddle quality no longer have a meaningful ride-quality cost");
}

const sharedSample = {
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
const alignedProneEngagement = engagementFor(.8, {
  capture: alignedBoard.capture,
  waveContact: alignedBoard.waveContact,
  waterContact: 1,
  headingAlignment: alignedBoard.headingAlignment,
  planing: alignedBoard.planing,
  crossWaveLoad: alignedBoard.crossWaveLoad,
}).engagement;
if (
  alignedProneEngagement < .2
  || alignedProneEngagement >= .72
) {
  throw new Error("Prone wave engagement no longer builds continuously below full capture");
}
const facePhaseSpan = .92;
const facePhaseSweep = [.14, .32, .5, .7, facePhaseSpan].map(
  (crestPhaseError) => ({
    crestPhaseError,
    facePosition: waveFacePositionAtPhase(
      crestPhaseError,
      facePhaseSpan,
    ),
  }),
);
for (let index = 1; index < facePhaseSweep.length; index += 1) {
  if (
    facePhaseSweep[index].facePosition
      >= facePhaseSweep[index - 1].facePosition
  ) {
    throw new Error("Polygon phase no longer maps monotonically from lip to trough");
  }
}
if (
  facePhaseSweep[0].facePosition < .99
  || facePhaseSweep.at(-1).facePosition > -.99
  || Math.abs(
    waveFacePositionAtPhase(.5, facePhaseSpan) - .0769230769
  ) > .001
) {
  throw new Error("Instantaneous wave-face measurement no longer clamps to the physical face");
}
const longPeriodCrestDistance = waveCrestDistanceAtPhase(.2, 320);
if (
  longPeriodCrestDistance < 10
  || waveCrestDistanceAtPhase(-.2, 320) >= 0
) {
  throw new Error("Crest phase no longer preserves signed physical distance on long waves");
}

const sharedPocketSample = {
  crestPhase: Math.PI * .5 - Math.PI * 2 * 3,
  referencePhase: Math.PI * .5 - Math.PI * 2 * 3 - .8,
  elapsed: 26,
  wavePeriod: 8,
  waveSpeed: 6,
  peel: .32,
  breakLength: 1,
  lineSide: 1,
  variability: .28,
};
const absolutePocket = resolveWavePocketFrame(sharedPocketSample);
const oppositePocket = resolveWavePocketFrame({
  ...sharedPocketSample,
  lineSide: -1,
});
const repeatedPocket = resolveWavePocketFrame(sharedPocketSample);
const laterPocket = resolveWavePocketFrame({
  ...sharedPocketSample,
  referencePhase: sharedPocketSample.referencePhase - Math.PI * 2 / 8 * .1,
  elapsed: sharedPocketSample.elapsed + .1,
});
if (
  absolutePocket.pocketAlong !== repeatedPocket.pocketAlong
  || Math.abs(
    laterPocket.pocketAlong - absolutePocket.pocketAlong
      - absolutePocket.peelRate * .1
  ) > .02
  || absolutePocket.peelRate <= 0
) {
  throw new Error("Wave pocket no longer follows crest age independently of capture time");
}
const rightPocketSelection = resolveWaveLineSide({
  surferAlong: absolutePocket.pocketAlong + .18,
  tangentSpeed: .9,
  leftPocketAlong: oppositePocket.pocketAlong,
  rightPocketAlong: absolutePocket.pocketAlong,
  currentSide: -1,
  switchHysteresis: .72,
});
const peakMomentumSelection = resolveWaveLineSide({
  surferAlong: (
    oppositePocket.pocketAlong + absolutePocket.pocketAlong
  ) * .5,
  tangentSpeed: -.74,
  leftPocketAlong: oppositePocket.pocketAlong,
  rightPocketAlong: absolutePocket.pocketAlong,
  currentSide: 1,
  switchHysteresis: .72,
});
const peakHysteresisSelection = resolveWaveLineSide({
  surferAlong: (
    oppositePocket.pocketAlong + absolutePocket.pocketAlong
  ) * .5 + .12,
  tangentSpeed: .05,
  leftPocketAlong: oppositePocket.pocketAlong,
  rightPocketAlong: absolutePocket.pocketAlong,
  currentSide: -1,
  switchHysteresis: .72,
});
if (
  rightPocketSelection.lineSide !== 1
  || peakMomentumSelection.lineSide !== -1
  || peakHysteresisSelection.lineSide !== -1
) {
  throw new Error("A-frame line side no longer follows board position, tangent momentum, and peak hysteresis");
}
const pocketSection = resolveWaveSectionPressure({
  surferAlong: absolutePocket.pocketAlong,
  pocketAlong: absolutePocket.pocketAlong,
  pocketWidth: 4.8,
  lineSide: 1,
  facePosition: .3,
  waveEnergy: .72,
  tidePower: .8,
  tideVariability: .3,
  onshoreChop: .12,
});
const deepSection = resolveWaveSectionPressure({
  surferAlong: absolutePocket.pocketAlong - 7,
  pocketAlong: absolutePocket.pocketAlong,
  pocketWidth: 4.8,
  lineSide: 1,
  facePosition: .3,
  waveEnergy: .72,
  tidePower: .8,
  tideVariability: .3,
  onshoreChop: .12,
});
if (
  pocketSection.lineControl < .99
  || pocketSection.whitewaterPressure > .001
  || deepSection.whitewaterPressure < .65
  || deepSection.lineControl > .05
) {
  throw new Error("Absolute wave section no longer distinguishes the clean pocket from broken water");
}
const sharedTurbulenceSample = {
  elapsed: 24.6,
  positionX: -6.4,
  positionZ: -31.2,
  windSpeed: 9,
  onshoreChop: .34,
  waveEnergy: .72,
  waveSpeed: 6.1,
  lineSide: 1,
  whitewater: .28,
};
const standingTurbulence = resolveSurfboardTurbulence(
  sharedTurbulenceSample,
);
const engagedTurbulence = resolveSurfboardTurbulence(
  sharedTurbulenceSample,
);
const foamTurbulence = resolveSurfboardTurbulence({
  ...sharedTurbulenceSample,
  whitewater: .92,
});
if (
  standingTurbulence.rollTorque !== engagedTurbulence.rollTorque
  || standingTurbulence.pitchTorque !== engagedTurbulence.pitchTorque
  || standingTurbulence.tangentForce !== engagedTurbulence.tangentForce
  || Math.abs(
    foamTurbulence.rollTorque - standingTurbulence.rollTorque
  ) < .01
  || Math.abs(standingTurbulence.surfaceRoll) < .001
) {
  throw new Error("Water turbulence changed across ride engagement");
}
const sharedTubeSample = {
  linePosition: -.12,
  facePosition: .46,
  tideHollow: .82,
  tideSteepness: .76,
  waveEnergy: .78,
  offshoreGroom: .3,
  onshoreChop: .08,
  whitewater: .04,
};
const standingTube = resolveWaveTubePressure(sharedTubeSample);
const engagedTube = resolveWaveTubePressure(sharedTubeSample);
const washedTube = resolveWaveTubePressure({
  ...sharedTubeSample,
  whitewater: .92,
});
if (
  standingTube.tubePressure !== engagedTube.tubePressure
  || standingTube.tubePressure < .35
  || washedTube.tubePressure
    >= standingTube.tubePressure * .3
) {
  throw new Error("Geometric tube pressure changed across ride engagement");
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
const sharedPlaning = resolveSurfboardPlaning({
  forwardSpeed: dynamicsState.velocityZ,
  waveContact: dynamicsSample.waveContact,
  waterContact: 1,
  stance: 0,
  boardLength: dynamicsSample.boardLength,
  boardWidth: dynamicsSample.boardWidth,
});
const dryPlaning = resolveSurfboardPlaning({
  forwardSpeed: 8,
  waveContact: 1,
  waterContact: 0,
  stance: 0,
  boardLength: 2.5,
  boardWidth: .32,
});
const flatHighSpeedPlaning = resolveSurfboardPlaning({
  forwardSpeed: 8,
  waveContact: 0,
  waterContact: 1,
  stance: 0,
  boardLength: 2.5,
  boardWidth: .32,
});
const longboardPlaning = resolveSurfboardPlaning({
  forwardSpeed: 2.6,
  waveContact: .72,
  waterContact: 1,
  stance: 0,
  boardLength: 3.45,
  boardWidth: .43,
});
const shortboardPlaning = resolveSurfboardPlaning({
  forwardSpeed: 2.6,
  waveContact: .72,
  waterContact: 1,
  stance: 0,
  boardLength: 2.1,
  boardWidth: .3,
});
const nosePlaning = resolveSurfboardPlaning({
  forwardSpeed: 2.6,
  waveContact: .72,
  waterContact: 1,
  stance: .8,
  boardLength: 2.5,
  boardWidth: .32,
});
const tailPlaningReading = resolveSurfboardPlaning({
  forwardSpeed: 2.6,
  waveContact: .72,
  waterContact: 1,
  stance: -.8,
  boardLength: 2.5,
  boardWidth: .32,
});
if (
  sharedPlaning.planing <= 0
  || dryPlaning.planing !== 0
  || flatHighSpeedPlaning.planing < .8
  || longboardPlaning.threshold >= shortboardPlaning.threshold
  || longboardPlaning.planing <= shortboardPlaning.planing
  || nosePlaning.threshold >= tailPlaningReading.threshold
  || nosePlaning.planing <= tailPlaningReading.planing
) {
  throw new Error("Shared planing no longer responds consistently to speed, geometry, stance, and contact");
}
const alignedWavePressure = resolveSurfboardWavePressure({
  velocityX: dynamicsState.velocityX,
  velocityZ: dynamicsState.velocityZ,
  heading: dynamicsState.heading,
  waveVelocityX: dynamicsSample.waveVelocityX,
  waveVelocityZ: dynamicsSample.waveVelocityZ,
  waveContact: dynamicsSample.waveContact,
  waterContact: 1,
  waveHeight: dynamicsSample.waveHeight,
  stance: 0,
});
const broadsideWavePressure = resolveSurfboardWavePressure({
  velocityX: dynamicsState.velocityX,
  velocityZ: dynamicsState.velocityZ,
  heading: Math.PI / 2,
  waveVelocityX: dynamicsSample.waveVelocityX,
  waveVelocityZ: dynamicsSample.waveVelocityZ,
  waveContact: dynamicsSample.waveContact,
  waterContact: 1,
  waveHeight: dynamicsSample.waveHeight,
  stance: 0,
});
const stillWaterPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 0,
  heading: 0,
  waveVelocityX: 0,
  waveVelocityZ: 0,
  waveContact: 1,
  waterContact: 1,
  waveHeight: 0,
  stance: 0,
});
const symmetricHullPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 2,
  heading: Math.PI / 4,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  waveContact: .8,
  waterContact: 1,
  waveHeight: 2,
  stance: 0,
  noseSurfaceOffset: .08,
  tailSurfaceOffset: .08,
  boardLength: 2.5,
  boardTurn: 1,
});
const noseLoadedDiagonalPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 2,
  heading: Math.PI / 4,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  waveContact: .8,
  waterContact: 1,
  waveHeight: 2,
  stance: 0,
  noseSurfaceOffset: .12,
  tailSurfaceOffset: -.08,
  boardLength: 2.5,
  boardTurn: 1,
});
const tailLoadedDiagonalPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 2,
  heading: Math.PI / 4,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  waveContact: .8,
  waterContact: 1,
  waveHeight: 2,
  stance: 0,
  noseSurfaceOffset: -.08,
  tailSurfaceOffset: .12,
  boardLength: 2.5,
  boardTurn: 1,
});
if (
  alignedWavePressure.forwardDrive < 3
  || Math.abs(alignedWavePressure.lateralLoad) > .001
  || Math.abs(broadsideWavePressure.forwardDrive) > .001
  || Math.abs(broadsideWavePressure.lateralLoad) < 1
  || stillWaterPressure.pressure !== 0
) {
  throw new Error("Shared wave pressure no longer distinguishes aligned drive, broadside load, and still water");
}
if (
  Math.abs(symmetricHullPressure.centerOfPressure) > .001
  || Math.abs(symmetricHullPressure.yawAcceleration) > .001
  || noseLoadedDiagonalPressure.centerOfPressure <= .08
  || noseLoadedDiagonalPressure.yawAcceleration >= -.08
  || tailLoadedDiagonalPressure.centerOfPressure >= -.08
  || tailLoadedDiagonalPressure.yawAcceleration <= .08
) {
  throw new Error("Nose and tail polygon contact is not producing symmetric and directional pressure torque");
}
function pressureCatchAfterOneSecond(hz) {
  const deltaSeconds = 1 / hz;
  let state = { velocityX: .7, velocityZ: 1.2 };
  for (let frame = 0; frame < hz; frame += 1) {
    const pressure = resolveSurfboardWavePressure({
      ...state,
      heading: 0,
      waveVelocityX: 0,
      waveVelocityZ: 6,
      waveContact: .8,
      waterContact: 1,
      waveHeight: 2,
      stance: -.06,
    });
    state = {
      velocityX: state.velocityX + pressure.accelerationX * deltaSeconds,
      velocityZ: state.velocityZ + pressure.accelerationZ * deltaSeconds,
    };
  }
  return state;
}
const pressureCatch60 = pressureCatchAfterOneSecond(60);
const pressureCatch120 = pressureCatchAfterOneSecond(120);
if (
  pressureCatch60.velocityZ <= 3.4
  || Math.abs(pressureCatch60.velocityZ - pressureCatch120.velocityZ) > .025
  || Math.abs(pressureCatch60.velocityX - .7) > .001
) {
  throw new Error("Prone catch pressure is not frame-stable or is deleting cross-wave momentum");
}
function diagonalPressureTurnAfterOneSecond(hz) {
  const deltaSeconds = 1 / hz;
  let state = {
    velocityX: 0,
    velocityZ: 2,
    heading: Math.PI / 4,
    yawRate: 0,
  };
  for (let frame = 0; frame < hz; frame += 1) {
    const pressure = resolveSurfboardWavePressure({
      velocityX: state.velocityX,
      velocityZ: state.velocityZ,
      heading: state.heading,
      waveVelocityX: 0,
      waveVelocityZ: 6,
      waveContact: .8,
      waterContact: 1,
      waveHeight: 2,
      stance: 0,
      noseSurfaceOffset: .12,
      tailSurfaceOffset: -.08,
      boardLength: 2.5,
      boardTurn: 1,
    });
    state.velocityX += pressure.accelerationX * deltaSeconds;
    state.velocityZ += pressure.accelerationZ * deltaSeconds;
    state.yawRate += pressure.yawAcceleration * deltaSeconds;
    state.heading += state.yawRate * deltaSeconds;
  }
  return state;
}
const diagonalTurn60 = diagonalPressureTurnAfterOneSecond(60);
const diagonalTurn120 = diagonalPressureTurnAfterOneSecond(120);
if (
  diagonalTurn60.heading >= Math.PI / 4 - .035
  || Math.abs(diagonalTurn60.heading - diagonalTurn120.heading) > .012
) {
  throw new Error("Distributed wave-pressure yaw is not turning a diagonally loaded nose consistently");
}
const flatDynamics = advanceSurfboardDynamics(dynamicsState, {
  ...dynamicsSample,
  waveContact: 0,
});
if (Math.abs(flatDynamics.planing - resolveSurfboardPlaning({
  forwardSpeed: dynamicsState.velocityZ,
  waveContact: 0,
  waterContact: 1,
  stance: 0,
  boardLength: dynamicsSample.boardLength,
  boardWidth: dynamicsSample.boardWidth,
}).planing) > 1e-9) {
  throw new Error("Horizontal dynamics diverged from the shared planing resolver");
}
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
const sharedGripSample = {
  baseGrip: .9,
  planing: .72,
  waveContact: .64,
  crossWaveLoad: .18,
  railSlip: .12,
  stance: 0,
  facePosition: .2,
  tubePressure: .1,
  whitewater: .08,
  onshoreChop: .2,
};
const standingBoundaryGrip = resolveSurfboardRailGrip(sharedGripSample);
const engagedBoundaryGrip = resolveSurfboardRailGrip(sharedGripSample);
const cleanPlaningGrip = resolveSurfboardRailGrip({
  ...sharedGripSample,
  planing: 1,
  waveContact: 1,
  crossWaveLoad: 0,
  railSlip: 0,
  facePosition: 0,
  tubePressure: 0,
  whitewater: 0,
});
const washedBroadsideGrip = resolveSurfboardRailGrip({
  ...sharedGripSample,
  planing: .3,
  waveContact: .8,
  crossWaveLoad: 1.2,
  railSlip: .55,
  stance: .6,
  facePosition: .6,
  tubePressure: .4,
  whitewater: 1,
  onshoreChop: 1,
});
const tailWeightedGrip = resolveSurfboardRailGrip({
  ...sharedGripSample,
  stance: -.8,
});
const noseWeightedGrip = resolveSurfboardRailGrip({
  ...sharedGripSample,
  stance: .8,
});
if (
  standingBoundaryGrip !== engagedBoundaryGrip
  || cleanPlaningGrip < .98
  || washedBroadsideGrip >= standingBoundaryGrip * .55
  || tailWeightedGrip <= noseWeightedGrip
) {
  throw new Error("Shared physical rail grip no longer preserves boundary continuity or responds to hull load");
}
const cleanRailSlip = resolveSurfboardRailSlip({
  railDemand: .36,
  railGrip: .82,
  sideslip: .04,
  edgeRisk: .08,
});
const overloadedRailSlip = resolveSurfboardRailSlip({
  railDemand: 1.08,
  railGrip: .72,
  sideslip: .12,
  edgeRisk: .18,
});
const lateralRailSlip = resolveSurfboardRailSlip({
  railDemand: .4,
  railGrip: .82,
  sideslip: .72,
  edgeRisk: .1,
});
const edgeRailSlip = resolveSurfboardRailSlip({
  railDemand: .4,
  railGrip: .82,
  sideslip: .08,
  edgeRisk: .9,
});
if (
  cleanRailSlip.target < .04
  || cleanRailSlip.target > .06
  || overloadedRailSlip.gripSlip < .99
  || lateralRailSlip.target !== .72
  || Math.abs(edgeRailSlip.target - .504) > .001
) {
  throw new Error("Mode-free rail slip no longer tracks clean contact, overload, sideslip, and edge risk");
}
const sharedRailDemandSample = {
  railInput: .72,
  speed: 8.4,
  stance: .24,
  tideSteepness: .82,
  facePosition: .34,
  tubePressure: .18,
};
const standingRailDemand = resolveSurfboardRailDemand(
  sharedRailDemandSample,
);
const engagedRailDemand = resolveSurfboardRailDemand(
  sharedRailDemandSample,
);
const tailRailDemand = resolveSurfboardRailDemand({
  ...sharedRailDemandSample,
  stance: -.8,
});
const noseRailDemand = resolveSurfboardRailDemand({
  ...sharedRailDemandSample,
  stance: .8,
});
function railSlipAfterOneSecond(hz) {
  let railSlip = .04;
  for (let frame = 0; frame < hz; frame += 1) {
    railSlip = advanceSurfboardRailSlip(
      railSlip,
      {
        railDemand: standingRailDemand,
        railGrip: .62,
        sideslip: .46,
        edgeRisk: .58,
      },
      1 / hz,
    ).railSlip;
  }
  return railSlip;
}
const standingRailSlip60 = railSlipAfterOneSecond(60);
const engagedRailSlip120 = railSlipAfterOneSecond(120);
if (
  standingRailDemand !== engagedRailDemand
  || noseRailDemand <= tailRailDemand
  || Math.abs(standingRailSlip60 - engagedRailSlip120) > .002
  || standingRailSlip60 < .44
) {
  throw new Error("Rail demand or slip integration changed across engagement");
}
const sharedInstabilitySample = {
  rollEdgeRisk: .65,
  rollCapsizeRisk: .5,
  rollRate: 1.8,
  whitewater: .4,
  shoulderStall: .12,
  tubePressure: .28,
  balanceError: .74,
  balanceFailureThreshold: 1,
  crossWaveLoad: .8,
  sideslip: .4,
  waveContact: .8,
  pearlingRisk: .2,
  pitchOverRisk: .25,
  tailStall: .2,
};
function instabilityAfterOneSecond(hz) {
  let instability = 0;
  for (let frame = 0; frame < hz; frame += 1) {
    instability = advanceSurfboardInstability(
      instability,
      {
        ...sharedInstabilitySample,
        deltaSeconds: 1 / hz,
      },
    ).instability;
  }
  return instability;
}
const standingInstability60 = instabilityAfterOneSecond(60);
const engagedInstability120 = instabilityAfterOneSecond(120);
if (
  Math.abs(
    standingInstability60 - engagedInstability120
  ) > .002
  || !surfboardWipeoutTriggered(
    standingInstability60,
    sharedInstabilitySample.rollCapsizeRisk,
    sharedInstabilitySample.pitchOverRisk,
  )
  || surfboardWipeoutTriggered(.2, .2, .2)
) {
  throw new Error("Instability or wipeout threshold changed across engagement");
}
const sharedWipeoutSample = {
  waveHeight: 2.4,
  wavePeriod: 11,
  waveEnergy: .78,
  tidePower: .86,
  speed: 9.2,
  tubePressure: .34,
  whitewater: .46,
  shoulderStall: .18,
  railSlip: .62,
  crossWaveLoad: .88,
  sideslip: .54,
  pearlingRisk: .28,
  pitchOverRisk: .34,
  rollCapsizeRisk: .52,
  rollEdgeRisk: .66,
};
const standingWipeout = resolveSurfboardWipeout(
  sharedWipeoutSample,
);
const engagedWipeout = resolveSurfboardWipeout(
  sharedWipeoutSample,
);
const lightWipeout = resolveSurfboardWipeout({
  ...sharedWipeoutSample,
  waveEnergy: .18,
  whitewater: .04,
  crossWaveLoad: .12,
  sideslip: .08,
  pearlingRisk: .04,
  pitchOverRisk: .04,
  rollCapsizeRisk: .08,
  rollEdgeRisk: .1,
});
if (
  standingWipeout.power !== engagedWipeout.power
  || standingWipeout.duration !== engagedWipeout.duration
  || standingWipeout.washSpeed !== engagedWipeout.washSpeed
  || standingWipeout.power <= lightWipeout.power
  || standingWipeout.duration <= lightWipeout.duration
) {
  throw new Error("Wipeout severity changed across engagement");
}
const sharedTumbleRelease = {
  rollAngle: .32,
  rollRate: .8,
  pitchAngle: .08,
  pitchRate: .18,
  yawRate: .3,
  crossWaveLoad: 1.1,
  crossWaveSide: 1,
  railSlip: .64,
  rollCapsizeRisk: .96,
  pitchOverRisk: .24,
  pearlingRisk: .18,
  impactPower: .82,
  boardLength: 2.1,
  boardWidth: .5,
};
const broadsideTumble = resolveSurfboardTumbleRelease(
  sharedTumbleRelease,
);
const alignedTumble = resolveSurfboardTumbleRelease({
  ...sharedTumbleRelease,
  crossWaveLoad: .08,
  railSlip: .05,
  rollCapsizeRisk: .12,
  impactPower: .28,
});
const oppositeBroadsideTumble = resolveSurfboardTumbleRelease({
  ...sharedTumbleRelease,
  rollAngle: -.32,
  rollRate: -.8,
  crossWaveSide: -1,
});
const pearlingTumble = resolveSurfboardTumbleRelease({
  ...sharedTumbleRelease,
  crossWaveLoad: .08,
  railSlip: .12,
  rollCapsizeRisk: .1,
  pitchOverRisk: .98,
  pearlingRisk: .9,
});
if (
  broadsideTumble.rollRate < alignedTumble.rollRate + 2.5
  || oppositeBroadsideTumble.rollRate > -alignedTumble.rollRate - 2.5
  || pearlingTumble.pitchRate < alignedTumble.pitchRate + 1.8
) {
  throw new Error("Tumble release no longer inherits broadside rail side or nose-over momentum");
}
function simulateTumble(hz) {
  let tumble = broadsideTumble;
  for (let frame = 0; frame < hz * 1.2; frame += 1) {
    tumble = advanceSurfboardTumble(tumble, {
      deltaSeconds: 1 / hz,
      waterDrag: .58,
      washTorque: .7,
      washSide: 1,
    });
  }
  return tumble;
}
const tumble60 = simulateTumble(60);
const tumble120 = simulateTumble(120);
if (
  tumble60.roll < 3.2
  || Math.abs(tumble60.roll - tumble120.roll) > .025
  || Math.abs(tumble60.pitch - tumble120.pitch) > .025
  || Math.abs(tumble60.yaw - tumble120.yaw) > .025
) {
  throw new Error("Separated board tumble is no longer physical or frame-rate stable");
}
const broadsideSeparation = resolveSurfboardSeparationRelease({
  rollRate: broadsideTumble.rollRate,
  pitchRate: broadsideTumble.pitchRate,
  yawRate: broadsideTumble.yawRate,
  boardLength: 2.1,
  boardWidth: .5,
});
const alignedSeparation = resolveSurfboardSeparationRelease({
  rollRate: alignedTumble.rollRate,
  pitchRate: alignedTumble.pitchRate,
  yawRate: alignedTumble.yawRate,
  boardLength: 2.1,
  boardWidth: .5,
});
const oppositeSeparation = resolveSurfboardSeparationRelease({
  rollRate: oppositeBroadsideTumble.rollRate,
  pitchRate: oppositeBroadsideTumble.pitchRate,
  yawRate: oppositeBroadsideTumble.yawRate,
  boardLength: 2.1,
  boardWidth: .5,
});
if (
  broadsideSeparation.lateralVelocity
    > alignedSeparation.lateralVelocity - .8
  || oppositeSeparation.lateralVelocity < .8
  || broadsideSeparation.verticalVelocity
    < alignedSeparation.verticalVelocity + .35
) {
  throw new Error("Board separation no longer follows measured rail edge speed and side");
}
const surfaceObservation = {
  durationSeconds: .82,
  startFacePosition: .02,
  endFacePosition: .08,
  startLinePosition: .1,
  endLinePosition: .06,
  accumulatedYaw: .58,
  peakYawRate: .76,
  peakRailLoad: .62,
  nosePressureSeconds: 0,
  minimumWaterContact: .82,
  endPlaning: .76,
  endWaveContact: .74,
  boardLength: 2.1,
};
const observedBottomTurn = recognizeSurfboardSurfaceManeuver({
  ...surfaceObservation,
  startFacePosition: -.58,
  endFacePosition: .12,
  accumulatedYaw: .46,
});
const observedRoundhouse = recognizeSurfboardSurfaceManeuver({
  ...surfaceObservation,
  startLinePosition: .72,
  endLinePosition: .16,
  accumulatedYaw: .88,
});
const observedLongboardNoseRide = recognizeSurfboardSurfaceManeuver({
  ...surfaceObservation,
  durationSeconds: .94,
  startFacePosition: .18,
  endFacePosition: .22,
  accumulatedYaw: .08,
  peakYawRate: .12,
  peakRailLoad: .18,
  nosePressureSeconds: .78,
  boardLength: 3,
});
const untracedTurn = recognizeSurfboardSurfaceManeuver({
  ...surfaceObservation,
  accumulatedYaw: .04,
  peakYawRate: .1,
  peakRailLoad: .2,
});
const disconnectedTurn = recognizeSurfboardSurfaceManeuver({
  ...surfaceObservation,
  minimumWaterContact: .28,
});
if (
  observedBottomTurn?.name !== "Bottom Turn"
  || observedRoundhouse?.name !== "Roundhouse Cutback"
  || observedLongboardNoseRide?.name !== "Nose Ride"
  || untracedTurn !== null
  || disconnectedTurn !== null
) {
  throw new Error("Surface maneuver recognition no longer follows the board's measured path and contact");
}
const lipObservation = {
  durationSeconds: .72,
  startFacePosition: .64,
  endFacePosition: .24,
  launchVelocity: 1.42,
  accumulatedYaw: .52,
  peakAirborne: .14,
  peakRailLoad: .62,
  peakTailPressure: .58,
  minimumWaterContact: .32,
  endWaterContact: .86,
  endPlaning: .72,
  endWaveContact: .68,
};
const observedLipSnap = recognizeSurfboardLipManeuver(
  lipObservation,
);
const observedTailRelease = recognizeSurfboardLipManeuver({
  ...lipObservation,
  accumulatedYaw: .14,
  peakRailLoad: .32,
  peakTailPressure: .74,
});
const observedFoamFloater = recognizeSurfboardLipManeuver({
  ...lipObservation,
  endFacePosition: .34,
  accumulatedYaw: .12,
  peakAirborne: .02,
  peakRailLoad: .24,
  minimumWaterContact: .7,
});
const missedLipReconnection = recognizeSurfboardLipManeuver({
  ...lipObservation,
  endWaterContact: .24,
  endPlaning: .12,
});
const flatWaterRelease = recognizeSurfboardLipManeuver({
  ...lipObservation,
  startFacePosition: .04,
});
if (
  observedLipSnap?.name !== "Lip Snap"
  || observedTailRelease?.name !== "Tail Release"
  || observedFoamFloater?.name !== "Foam Floater"
  || missedLipReconnection !== null
  || flatWaterRelease !== null
) {
  throw new Error("Lip maneuver recognition no longer follows release trajectory and reconnection");
}
const stableAirLanding = surfboardLandingSucceeded({
  airborneManeuver: true,
  physicalAirLanding: true,
  peakAirborne: .42,
  physicalLandingControl: .74,
  rotationCompletion: .96,
  railSlip: .22,
  rollCapsizeRisk: .18,
  pitchOverRisk: .16,
});
const missedAirLanding = surfboardLandingSucceeded({
  airborneManeuver: true,
  physicalAirLanding: false,
  peakAirborne: .42,
  physicalLandingControl: .74,
  rotationCompletion: .96,
  railSlip: .22,
  rollCapsizeRisk: .18,
  pitchOverRisk: .16,
});
const underRotatedLanding = surfboardLandingSucceeded({
  airborneManeuver: true,
  physicalAirLanding: true,
  peakAirborne: .42,
  physicalLandingControl: .74,
  rotationCompletion: .52,
  railSlip: .22,
  rollCapsizeRisk: .18,
  pitchOverRisk: .16,
});
const overRotatedLanding = surfboardLandingSucceeded({
  airborneManeuver: true,
  physicalAirLanding: true,
  peakAirborne: .42,
  physicalLandingControl: .74,
  rotationCompletion: 1.2,
  railSlip: .22,
  rollCapsizeRisk: .18,
  pitchOverRisk: .16,
});
const slippingSurfaceManeuver = surfboardLandingSucceeded({
  airborneManeuver: false,
  physicalAirLanding: false,
  peakAirborne: 0,
  physicalLandingControl: 1,
  rotationCompletion: 1,
  railSlip: .94,
  rollCapsizeRisk: .18,
  pitchOverRisk: .16,
});
if (
  !stableAirLanding
  || missedAirLanding
  || underRotatedLanding
  || overRotatedLanding
  || slippingSurfaceManeuver
) {
  throw new Error("Maneuver landing no longer follows physical contact, attitude, rotation, and rail state");
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
const tiltedRailContact = boardRailContactFrame(0, .1, -.1, .25);
const crownedRailContact = boardRailContactFrame(0, .06, .06, .25);
if (
  Math.abs(tiltedRailContact.crossSlope - .4) > 1e-9
  || Math.abs(tiltedRailContact.railWarp) > 1e-9
  || Math.abs(crownedRailContact.crossSlope) > 1e-9
  || Math.abs(crownedRailContact.railWarp - .06) > 1e-9
) {
  throw new Error("Explicit left/right rail samples no longer resolve slope and vertical polygon warp independently");
}
const popUpStart = evaluatePopUpTransition(0, 100);
const popUpHandPlant = evaluatePopUpTransition(.25, 100);
const popUpFootPlant = evaluatePopUpTransition(.48, 100);
const popUpStanding = evaluatePopUpTransition(.7, 100);
const noseHeavyPopUp = evaluatePopUpTransition(.7, 100, .7);
const tailHeavyPopUp = evaluatePopUpTransition(.7, 100, -.7);
const tiredPopUp = evaluatePopUpTransition(.7, 0);
function controlledPopUpFootPlacement(hz, input) {
  let placement = 0;
  let elapsed = 0;
  const duration = popUpStanding.duration;
  for (let frame = 0; frame < Math.ceil(duration * hz); frame += 1) {
    const transition = evaluatePopUpTransition(elapsed, 100, placement);
    placement = advanceSurfboardStance(
      placement,
      input * transition.footSupport,
      1 / hz,
    );
    elapsed += 1 / hz;
  }
  return placement;
}
const forwardPopUpPlacement60 = controlledPopUpFootPlacement(60, 1);
const forwardPopUpPlacement120 = controlledPopUpFootPlacement(120, 1);
if (
  popUpStart.progress !== 0
  || popUpHandPlant.handLoad < .45
  || popUpFootPlant.footImpact < .35
  || popUpStanding.progress < .99
  || popUpStanding.frontFootLoad < .95
  || popUpStanding.footSupport < .95
  || noseHeavyPopUp.trim < .5
  || tailHeavyPopUp.trim > -.45
  || forwardPopUpPlacement60 < .08
  || Math.abs(
    forwardPopUpPlacement60 - forwardPopUpPlacement120,
  ) > .012
  || popUpStanding.stabilityScale >= popUpStart.stabilityScale
  || tiredPopUp.progress >= popUpStanding.progress
) {
  throw new Error("Pop-up body loads no longer move from hands into physical fore-aft foot pressure");
}
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
const handLoadedProne = proneForFrames(24, {
  ...proneSample,
  trim: popUpHandPlant.trim,
  stabilityScale: popUpHandPlant.stabilityScale,
  counterweightScale: popUpHandPlant.counterweightScale,
  verticalWaterAcceleration: popUpHandPlant.verticalLoadAcceleration,
});
if (
  handLoadedProne.heave.elevation
    >= neutralProne.heave.elevation - .01
  || handLoadedProne.pitch.pitchAngle
    <= neutralProne.pitch.pitchAngle + .015
) {
  throw new Error("Pop-up hand pressure no longer sinks and nose-loads the prone hull");
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
const flatLipSupport = surfboardLipLaunchSupport({
  facePosition: -.1,
  faceSlope: .01,
  surfaceRise: .04,
  waveContact: .82,
  planing: .9,
  waterContact: 1,
});
const liveLipSupport = surfboardLipLaunchSupport({
  facePosition: .54,
  faceSlope: .18,
  surfaceRise: 1.1,
  waveContact: .9,
  planing: .88,
  waterContact: .94,
});
const disconnectedLipSupport = surfboardLipLaunchSupport({
  facePosition: .7,
  faceSlope: .24,
  surfaceRise: 1.5,
  waveContact: 1,
  planing: 1,
  waterContact: 0,
});
const flatReleaseImpulse = surfboardReleaseVerticalImpulse({
  compression: 1,
  extensionSpeed: 1.6,
  tailPressure: .7,
  lipSupport: flatLipSupport,
  speed: 12,
  planing: .9,
  waterContact: 1,
  boardLength: 2.1,
});
const lipReleaseImpulse = surfboardReleaseVerticalImpulse({
  compression: .92,
  extensionSpeed: 1.6,
  tailPressure: .62,
  lipSupport: liveLipSupport,
  speed: 12.4,
  planing: .88,
  waterContact: .94,
  boardLength: 2.1,
});
const longboardLipReleaseImpulse = surfboardReleaseVerticalImpulse({
  compression: .92,
  extensionSpeed: 1.6,
  tailPressure: .62,
  lipSupport: liveLipSupport,
  speed: 12.4,
  planing: .88,
  waterContact: .94,
  boardLength: 3.45,
});
if (
  flatLipSupport !== 0
  || liveLipSupport < .65
  || disconnectedLipSupport !== 0
  || flatReleaseImpulse > 1.15
  || lipReleaseImpulse < 3
  || lipReleaseImpulse <= flatReleaseImpulse * 3
  || longboardLipReleaseImpulse >= lipReleaseImpulse
) {
  throw new Error("Tail release no longer distinguishes a live upper-face ramp from flat water");
}
function simulateLipReleaseHeave(hz) {
  let board = {
    ...staticHeave,
    verticalVelocity: staticHeave.verticalVelocity + lipReleaseImpulse,
  };
  let peakHeight = 0;
  let landingImpact = 0;
  let lostContact = false;
  let reconnectionSeconds = null;
  for (let frame = 0; frame < hz * 3; frame += 1) {
    board = advanceBoardHeaveDynamics(board, {
      ...heaveSample,
      deltaSeconds: 1 / hz,
      planing: .84,
      speed: 11.8,
      waveContact: .82,
    });
    peakHeight = Math.max(peakHeight, board.airborneHeight);
    landingImpact = Math.max(landingImpact, board.landingImpact);
    if (board.waterContact < .2) lostContact = true;
    if (
      lostContact
      && reconnectionSeconds === null
      && board.waterContact > .62
    ) {
      reconnectionSeconds = (frame + 1) / hz;
    }
  }
  return {
    board,
    peakHeight,
    landingImpact,
    lostContact,
    reconnectionSeconds,
  };
}
const release60 = simulateLipReleaseHeave(60);
const release120 = simulateLipReleaseHeave(120);
const launchedBoard = release60.board;
const peakReleaseHeight = release60.peakHeight;
const releaseLandingImpact = release60.landingImpact;
const releaseLostContact = release60.lostContact;
if (
  !releaseLostContact
  || peakReleaseHeight < .32
  || releaseLandingImpact < .06
  || launchedBoard.waterContact < .82
  || release60.reconnectionSeconds === null
  || release120.reconnectionSeconds === null
  || Math.abs(release60.peakHeight - release120.peakHeight) > .02
  || Math.abs(
    release60.reconnectionSeconds - release120.reconnectionSeconds,
  ) > .02
  || release120.board.waterContact < .82
) {
  throw new Error("A lip release no longer produces frame-rate-stable ballistic flight and reconnection");
}
const performanceYawRelease = surfboardReleaseYawImpulse({
  railInput: .68,
  tailPressure: .62,
  lipSupport: liveLipSupport,
  speed: 12.4,
  verticalImpulse: lipReleaseImpulse,
  charge: .92,
  waterContact: .94,
  boardLength: 2.1,
  boardTurn: 1.15,
});
const longboardYawRelease = surfboardReleaseYawImpulse({
  railInput: .68,
  tailPressure: .62,
  lipSupport: liveLipSupport,
  speed: 12.4,
  verticalImpulse: lipReleaseImpulse,
  charge: .92,
  waterContact: .94,
  boardLength: 3,
  boardTurn: .72,
});
const disconnectedYawRelease = surfboardReleaseYawImpulse({
  railInput: .68,
  tailPressure: .62,
  lipSupport: liveLipSupport,
  speed: 12.4,
  verticalImpulse: lipReleaseImpulse,
  charge: .92,
  waterContact: 0,
  boardLength: 2.1,
  boardTurn: 1.15,
});
const unloadedYawRelease = surfboardReleaseYawImpulse({
  railInput: 0,
  tailPressure: .62,
  lipSupport: liveLipSupport,
  speed: 12.4,
  verticalImpulse: lipReleaseImpulse,
  charge: .92,
  waterContact: .94,
  boardLength: 2.1,
  boardTurn: 1.15,
});
if (
  performanceYawRelease < 3.5
  || longboardYawRelease >= performanceYawRelease * .72
  || disconnectedYawRelease !== 0
  || unloadedYawRelease !== 0
) {
  throw new Error("Tail-release yaw impulse no longer respects contact and board inertia");
}
function simulateAirYaw(hz, seconds = 52 / 60) {
  let state = {
    velocityX: 0,
    velocityZ: 11.8,
    heading: 0,
    yawRate: performanceYawRelease,
  };
  let accumulatedYaw = 0;
  const frames = Math.round(seconds * hz);
  for (let frame = 0; frame < frames; frame += 1) {
    const priorHeading = state.heading;
    state = advanceSurfboardDynamics(state, {
      ...dynamicsSample,
      deltaSeconds: 1 / hz,
      waveContact: 0,
      waterContact: 0,
      railInput: 0,
    });
    accumulatedYaw += Math.atan2(
      Math.sin(state.heading - priorHeading),
      Math.cos(state.heading - priorHeading),
    );
  }
  return { state, accumulatedYaw };
}
const airYaw60 = simulateAirYaw(60);
const airYaw120 = simulateAirYaw(120);
const airborneSpin = airYaw60.state;
const accumulatedAirYaw = airYaw60.accumulatedYaw;
if (
  accumulatedAirYaw < Math.PI * .72
  || airborneSpin.yawRate < performanceYawRelease * .45
  || Math.abs(airYaw60.accumulatedYaw - airYaw120.accumulatedYaw) > .012
  || Math.abs(airYaw60.state.yawRate - airYaw120.state.yawRate) > .012
) {
  throw new Error("Airborne board yaw no longer conserves frame-rate-stable release angular momentum");
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
const optimalDiveInitiation = resolveDuckDiveInitiation({
  secondsToImpact: .3,
  shorebreakPower: .82,
  stamina: 88,
});
const earlyDiveInitiation = resolveDuckDiveInitiation({
  secondsToImpact: 1.4,
  shorebreakPower: .82,
  stamina: 88,
});
const flatWaterDiveInitiation = resolveDuckDiveInitiation({
  secondsToImpact: 0,
  shorebreakPower: 0,
  stamina: 88,
});
const lateDiveSubmersion = duckDiveSubmersionAt(.02);
const timedDiveSubmersion = duckDiveSubmersionAt(.3);
if (
  optimalDiveInitiation.timingQuality < .99
  || earlyDiveInitiation.timingQuality !== 0
  || flatWaterDiveInitiation.timingQuality !== 0
  || flatWaterDiveInitiation.effortCost <= 0
  || lateDiveSubmersion >= .1
  || timedDiveSubmersion < .7
) {
  throw new Error("Duck diving no longer separates physical action from wall timing and achieved depth");
}
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
const dryProneState = {
  velocityX: .4,
  velocityZ: 1.2,
  heading: .2,
  yawRate: .3,
};
const dryProne = advancePaddleboardDynamics(
  dryProneState,
  {
    ...paddlingSample,
    stroke: 1,
    strokeSide: -1,
    steer: 1,
    waterContact: 0,
    surfaceSlopeX: .18,
    currentVelocityX: .8,
  },
);
const halfWetProne = advancePaddleboardDynamics(
  { velocityX: 0, velocityZ: 0, heading: 0, yawRate: 0 },
  {
    ...paddlingSample,
    stroke: 1,
    waterContact: .5,
  },
);
const fullyWetProne = advancePaddleboardDynamics(
  { velocityX: 0, velocityZ: 0, heading: 0, yawRate: 0 },
  {
    ...paddlingSample,
    stroke: 1,
    waterContact: 1,
  },
);
const surfaceStrokeAtSpeed = advancePaddleboardDynamics(
  { velocityX: 0, velocityZ: 2, heading: 0, yawRate: 0 },
  {
    ...paddlingSample,
    stroke: 1,
    submersion: 0,
  },
);
const submergedStrokeAtSpeed = advancePaddleboardDynamics(
  { velocityX: 0, velocityZ: 2, heading: 0, yawRate: 0 },
  {
    ...paddlingSample,
    stroke: 1,
    submersion: 1,
  },
);
function submergedCoastAfterOneSecond(hz) {
  let state = { velocityX: 0, velocityZ: 2, heading: 0, yawRate: 0 };
  for (let frame = 0; frame < hz; frame += 1) {
    state = advancePaddleboardDynamics(state, {
      ...paddlingSample,
      deltaSeconds: 1 / hz,
      stroke: 0,
      submersion: .8,
    });
  }
  return state;
}
const submergedCoast60 = submergedCoastAfterOneSecond(60);
const submergedCoast120 = submergedCoastAfterOneSecond(120);
function dryProneAfterOneSecond(hz) {
  let state = dryProneState;
  for (let frame = 0; frame < hz; frame += 1) {
    state = advancePaddleboardDynamics(state, {
      ...paddlingSample,
      deltaSeconds: 1 / hz,
      stroke: 1,
      strokeSide: -1,
      steer: 1,
      waterContact: 0,
      surfaceSlopeX: .18,
      currentVelocityX: .8,
    });
  }
  return state;
}
const dryProne60 = dryProneAfterOneSecond(60);
const dryProne120 = dryProneAfterOneSecond(120);
if (
  Math.abs(dryProne.accelerationX) > .001
  || Math.abs(dryProne.accelerationZ) > .001
  || Math.abs(dryProne.velocityX - dryProneState.velocityX) > .001
  || Math.abs(dryProne.velocityZ - dryProneState.velocityZ) > .001
  || dryProne.strokeForce !== 0
  || dryProne.yawRate < dryProneState.yawRate * .995
  || halfWetProne.strokeForce <= 0
  || halfWetProne.strokeForce >= fullyWetProne.strokeForce
  || submergedStrokeAtSpeed.strokeForce
    >= surfaceStrokeAtSpeed.strokeForce * .1
  || submergedStrokeAtSpeed.accelerationZ >= 0
  || Math.abs(
    submergedCoast60.velocityZ - submergedCoast120.velocityZ,
  ) > .035
  || Math.abs(dryProne60.velocityX - dryProneState.velocityX) > .001
  || Math.abs(dryProne60.velocityZ - dryProneState.velocityZ) > .001
  || Math.abs(dryProne60.yawRate - dryProne120.yawRate) > .001
  || Math.abs(dryProne60.heading - dryProne120.heading) > .002
) {
  throw new Error("Prone paddle authority no longer follows live hull water contact");
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
const rightTurnLeftPullGuide = readPaddleTrainingMechanics({
  boardWaveAngle: Math.PI / 3,
  paddleStroke: -.72,
  paddleEffort: 1,
  waterContact: 1,
  waveForwardDrive: 1.4,
  waveLateralLoad: .2,
});
const leftTurnBroadsideGuide = readPaddleTrainingMechanics({
  boardWaveAngle: -Math.PI / 2,
  paddleStroke: .64,
  paddleEffort: 1,
  waterContact: 1,
  waveForwardDrive: .18,
  waveLateralLoad: 1.2,
});
const alignedRecoveryGuide = readPaddleTrainingMechanics({
  boardWaveAngle: .04,
  paddleStroke: 0,
  paddleEffort: 1,
  waterContact: 1,
  waveForwardDrive: 0,
  waveLateralLoad: 0,
});
const airborneGuide = readPaddleTrainingMechanics({
  boardWaveAngle: 0,
  paddleStroke: -.8,
  paddleEffort: 1,
  waterContact: .04,
  waveForwardDrive: 2,
  waveLateralLoad: 0,
});
if (
  rightTurnLeftPullGuide.turnDirection !== "right"
  || rightTurnLeftPullGuide.turnDegrees !== 60
  || rightTurnLeftPullGuide.recommendedHand !== "left"
  || rightTurnLeftPullGuide.activeHand !== "left"
  || rightTurnLeftPullGuide.strokePhase !== "pull"
  || rightTurnLeftPullGuide.pressureMode !== "drive"
  || leftTurnBroadsideGuide.turnDirection !== "left"
  || leftTurnBroadsideGuide.recommendedHand !== "right"
  || leftTurnBroadsideGuide.activeHand !== "right"
  || leftTurnBroadsideGuide.pressureMode !== "broadside"
  || alignedRecoveryGuide.turnDirection !== "hold"
  || alignedRecoveryGuide.recommendedHand !== null
  || alignedRecoveryGuide.strokePhase !== "recovery"
  || airborneGuide.pressureMode !== "airborne"
) {
  throw new Error("Physical paddle training guidance no longer matches heading, hand cycle, or hull load");
}
const liveForceGuide = readSurfTrainingForces({
  boardWaveAngle: -Math.PI / 4,
  waveLateralLoad: 1.24,
  waterContact: .91,
  balance: -.18,
  balanceTarget: .46,
});
const settledForceGuide = readSurfTrainingForces({
  boardWaveAngle: .04,
  waveLateralLoad: .03,
  waterContact: .86,
  balance: .21,
  balanceTarget: .24,
});
const airborneForceGuide = readSurfTrainingForces({
  boardWaveAngle: Math.PI / 2,
  waveLateralLoad: -2.1,
  waterContact: .04,
  balance: .8,
  balanceTarget: -.8,
});
if (
  liveForceGuide.noseDirection !== "left"
  || liveForceGuide.noseDegrees !== 45
  || liveForceGuide.waterDirection !== "right"
  || liveForceGuide.counterweightDirection !== "right"
  || liveForceGuide.counterweightPercent !== 64
  || settledForceGuide.noseDirection !== "hold"
  || settledForceGuide.waterDirection !== "hold"
  || settledForceGuide.counterweightDirection !== "hold"
  || airborneForceGuide.waterDirection !== "hold"
  || airborneForceGuide.counterweightDirection !== "left"
  || airborneForceGuide.counterweightPercent !== 100
) {
  throw new Error("Live force training no longer reports board alignment, water push, and counterweight error");
}
function stanceAfterOneSecond(input, hz = 60, initial = 0, forcedCenter = false) {
  let stance = initial;
  for (let frame = 0; frame < hz; frame += 1) {
    stance = advanceSurfboardStance(
      stance,
      input,
      1 / hz,
      forcedCenter,
    );
  }
  return stance;
}
const forwardStance60 = stanceAfterOneSecond(1);
const forwardStance120 = stanceAfterOneSecond(1, 120);
const tailStance = stanceAfterOneSecond(-1);
const neutralStance = stanceAfterOneSecond(0, 60, .8);
const rideOutStance = stanceAfterOneSecond(0, 60, .8, true);
if (
  Math.abs(forwardStance60 - .72) > .001
  || Math.abs(forwardStance60 - forwardStance120) > .001
  || Math.abs(tailStance + .86) > .001
  || neutralStance >= .3
  || rideOutStance >= .01
) {
  throw new Error("Fore-aft body pressure no longer integrates consistently across engagement and frame rate");
}
function compressionReleaseAfter(holdSeconds, hz = 60, stamina = 100) {
  let state = { compression: 0, velocity: 0 };
  const frames = Math.round(holdSeconds * hz);
  for (let frame = 0; frame < frames; frame += 1) {
    state = advanceSurferCompression(state, {
      deltaSeconds: 1 / hz,
      crouchIntent: 1,
      stamina,
    });
  }
  const loadedCompression = state.compression;
  const release = advanceSurferCompression(state, {
    deltaSeconds: 1 / hz,
    crouchIntent: 0,
    stamina,
  });
  return { loadedCompression, release };
}
const shortCompression = compressionReleaseAfter(.12);
const fullCompression60 = compressionReleaseAfter(.8);
const fullCompression120 = compressionReleaseAfter(.8, 120);
const fatiguedCompression = compressionReleaseAfter(.8, 60, 8);
if (
  shortCompression.loadedCompression >= fullCompression60.loadedCompression * .45
  || fullCompression60.loadedCompression < .9
  || Math.abs(
    fullCompression60.loadedCompression
      - fullCompression120.loadedCompression,
  ) > .004
  || fullCompression60.release.extensionPotentialSpeed < 3
  || Math.abs(
    fullCompression60.release.extensionPotentialSpeed
      - fullCompression120.release.extensionPotentialSpeed,
  ) > .004
  || fatiguedCompression.release.extensionPotentialSpeed
    >= fullCompression60.release.extensionPotentialSpeed
) {
  throw new Error("Surfer compression no longer behaves as a frame-rate-stable crouch and extension");
}

let marginalCapture = 0;
for (let frame = 0; frame < 72; frame += 1) {
  const reading = advanceWaveEngagement(marginalCapture, {
    deltaSeconds: 1 / 60,
    capture: .66,
    waveContact: .72,
    waterContact: .94,
    headingAlignment: .7,
    planing: .46,
    crossWaveLoad: .08,
  });
  marginalCapture = reading.engagement;
}
let lostWaveCapture = marginalCapture;
for (let frame = 0; frame < 72; frame += 1) {
  const reading = advanceWaveEngagement(lostWaveCapture, {
    deltaSeconds: 1 / 60,
    capture: 0,
    waveContact: 0,
    waterContact: .92,
    headingAlignment: .7,
    planing: .22,
    crossWaveLoad: .08,
  });
  lostWaveCapture = reading.engagement;
}
const independentPopUp = evaluatePopUpTransition(.7, 100);
if (
  marginalCapture <= .2
  || lostWaveCapture >= marginalCapture
  || independentPopUp.progress < .99
) {
  throw new Error("Wave engagement no longer evolves independently from the body transition");
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
  alignedProneEngagement,
  independentPopUpSeconds: independentPopUp.duration,
  endurance: {
    fiveMinutePaddleReserve,
  },
  captureLoss: {
    overtaken: overtakenCapture.overtaken,
    ahead: shoulderCapture.ahead,
  },
  waveEngagement: {
    sustained: sustainedEngagement.engagement,
    sustained120Hz: sustainedEngagement120.engagement,
    misaligned: misalignedEngagement.engagement,
    released: releasedEngagement.engagement,
  },
  boardWater: {
    alignedCapture: alignedBoard.capture,
    broadsideLoad: broadsideBoard.crossWaveLoad,
    broadsideWipeoutRisk: broadsideBoard.wipeoutRisk,
    alignedWavePressure: alignedWavePressure.forwardDrive,
    broadsideWaveLoad: Math.abs(broadsideWavePressure.lateralLoad),
    proneCatchSpeed60Hz: pressureCatch60.velocityZ,
    proneCatchSpeed120Hz: pressureCatch120.velocityZ,
    diagonalPressureTurn60Hz: diagonalTurn60.heading,
    diagonalPressureTurn120Hz: diagonalTurn120.heading,
    facePhaseSweep,
    longPeriodCrestDistance,
    absolutePocketAlong: absolutePocket.pocketAlong,
    pocketPeelRate: absolutePocket.peelRate,
    cleanPocketLineControl: pocketSection.lineControl,
    brokenSectionPressure: deepSection.whitewaterPressure,
    sharedRollTurbulence: standingTurbulence.rollTorque,
    foamRollTurbulence: foamTurbulence.rollTorque,
    standingTubePressure: standingTube.tubePressure,
    engagedTubePressure: engagedTube.tubePressure,
    sharedPlaning: sharedPlaning.planing,
    flatHighSpeedPlaning: flatHighSpeedPlaning.planing,
    longboardPlaning: longboardPlaning.planing,
    shortboardPlaning: shortboardPlaning.planing,
    nosePlaning: nosePlaning.planing,
    tailPlaning: tailPlaningReading.planing,
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
    standingBoundaryGrip,
    engagedBoundaryGrip,
    cleanPlaningGrip,
    washedBroadsideGrip,
    cleanRailSlip: cleanRailSlip.target,
    overloadedRailSlip: overloadedRailSlip.target,
    lateralRailSlip: lateralRailSlip.target,
    edgeRailSlip: edgeRailSlip.target,
    standingRailDemand,
    engagedRailDemand,
    standingRailSlip60,
    engagedRailSlip120,
    standingInstability60,
    engagedInstability120,
    standingWipeoutPower: standingWipeout.power,
    engagedWipeoutPower: engagedWipeout.power,
    lightWipeoutPower: lightWipeout.power,
    broadsideTumbleRollRate: broadsideTumble.rollRate,
    alignedTumbleRollRate: alignedTumble.rollRate,
    pearlingTumblePitchRate: pearlingTumble.pitchRate,
    tumbleRoll60Hz: tumble60.roll,
    tumbleRoll120Hz: tumble120.roll,
    broadsideBoardRelease: broadsideSeparation,
    alignedBoardRelease: alignedSeparation,
  },
  surfaceManeuvers: {
    bottomTurn: observedBottomTurn.name,
    roundhouse: observedRoundhouse.name,
    longboardNoseRide: observedLongboardNoseRide.name,
    untracedTurn,
    disconnectedTurn,
  },
  lipManeuvers: {
    snap: observedLipSnap.name,
    tailRelease: observedTailRelease.name,
    floater: observedFoamFloater.name,
    missedReconnection: missedLipReconnection,
    flatWaterRelease,
  },
  paddlingDynamics: {
    terminalSpeed: steadyPaddle.velocityZ,
    twoSecondCoastSpeed: paddleCoast.velocityZ,
    currentDrift: paddleCurrent.velocityX,
    dryHullAcceleration: Math.hypot(dryProne.accelerationX, dryProne.accelerationZ),
    dryHullYawRetention: dryProne.yawRate / dryProneState.yawRate,
    dryHullHeading60Hz: dryProne60.heading,
    dryHullHeading120Hz: dryProne120.heading,
    halfContactStrokeForce: halfWetProne.strokeForce,
    fullContactStrokeForce: fullyWetProne.strokeForce,
    performanceTurnRadians: performancePaddleTurn.heading,
    longboardTurnRadians: longboardPaddleTurn.heading,
    averageStrokeDrive,
    steeringImpulseDifference: steeringRightImpulse - steeringLeftImpulse,
    guideTurnDegrees: rightTurnLeftPullGuide.turnDegrees,
    guideActiveHand: rightTurnLeftPullGuide.activeHand,
    guideBroadsideMode: leftTurnBroadsideGuide.pressureMode,
    forwardStance60Hz: forwardStance60,
    forwardStance120Hz: forwardStance120,
    tailStance,
    neutralStance,
    rideOutStance,
  },
  bodyDynamics: {
    shortCompression: shortCompression.loadedCompression,
    fullCompression60Hz: fullCompression60.loadedCompression,
    fullCompression120Hz: fullCompression120.loadedCompression,
    extensionPotential60Hz:
      fullCompression60.release.extensionPotentialSpeed,
    extensionPotential120Hz:
      fullCompression120.release.extensionPotentialSpeed,
    fatiguedExtensionPotential:
      fatiguedCompression.release.extensionPotentialSpeed,
  },
  duckDiveDynamics: {
    optimalTiming: optimalDiveInitiation.timingQuality,
    earlyTiming: earlyDiveInitiation.timingQuality,
    idleEffortCost: flatWaterDiveInitiation.effortCost,
    lateSubmersion: lateDiveSubmersion,
    timedSubmersion: timedDiveSubmersion,
    surfaceStrokeForce: surfaceStrokeAtSpeed.strokeForce,
    submergedStrokeForce: submergedStrokeAtSpeed.strokeForce,
    submergedCoast60Hz: submergedCoast60.velocityZ,
    submergedCoast120Hz: submergedCoast120.velocityZ,
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
    flatLipSupport,
    liveLipSupport,
    disconnectedLipSupport,
    flatReleaseImpulse,
    lipReleaseImpulse,
    longboardLipReleaseImpulse,
    releaseAirborneHeight: peakReleaseHeight,
    releaseLandingImpact,
    releasePeakHeight120Hz: release120.peakHeight,
    releaseReconnect60Hz: release60.reconnectionSeconds,
    releaseReconnect120Hz: release120.reconnectionSeconds,
    performanceYawRelease,
    longboardYawRelease,
    accumulatedAirYaw,
    accumulatedAirYaw120Hz: airYaw120.accumulatedYaw,
    proneBroadsideRoll: broadsideProne.roll.rollAngle,
    proneBroadsideCapsize: broadsideProne.roll.capsizeRisk,
    proneCounterweightedRoll: counterweightedProne.roll.rollAngle,
    popUpHandLoadedElevation: handLoadedProne.heave.elevation,
    proneNoseImmersion: noseLoadedProne.pitch.noseImmersion,
    proneBroadsideFailurePower: broadsideProneFailure.power,
    popUpDuration: popUpStanding.duration,
    popUpFootImpact: popUpFootPlant.footImpact,
    popUpNoseTrim: noseHeavyPopUp.trim,
    popUpTailTrim: tailHeavyPopUp.trim,
    popUpForwardPlacement60Hz: forwardPopUpPlacement60,
    popUpForwardPlacement120Hz: forwardPopUpPlacement120,
    tiltedRailSlope: tiltedRailContact.crossSlope,
    crownedRailWarp: crownedRailContact.railWarp,
  },
}, null, 2));
