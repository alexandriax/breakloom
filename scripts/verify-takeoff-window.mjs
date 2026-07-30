import {
  advanceBoardHeaveDynamics,
  advanceBoardPitchDynamics,
  advanceBoardRollDynamics,
  advanceOptionalTowCraft,
  advanceOptionalTowProgress,
  advanceOptionalTowRope,
  advancePaddleboardDynamics,
  advancePaddleStrokeCycle,
  advancePopUpBodyTransition,
  advanceProneShorebreakResponse,
  advanceProneBoardAttitude,
  advanceReturnProneTransition,
  advanceSeparatedSurferHorizontalDynamics,
  advanceSeparatedSurferRecovery,
  advanceSeparatedSurferVerticalDynamics,
  advanceSurferCompression,
  advanceSurferCounterweightDynamics,
  advanceSurfboardDynamics,
  advanceSurfboardInstability,
  advanceSurfboardRailSlip,
  advanceSurfboardStance,
  advanceSurfboardTumble,
  advanceRideCaptureState,
  advanceWaveEngagement,
  boardRailContactFrame,
  BREAK_OFFSHORE_OFFSET,
  duckDiveSubmersionAt,
  deepWaterWavelengthForPeriod,
  evaluateBoardWaterInteraction,
  evaluatePopUpTransition,
  evaluateProneBoardFailure,
  evaluateWaveTakeoff,
  findWaveBreakingContourAt,
  forecastFaceHeightForBreak,
  INITIAL_STATS,
  paddleStrokeWorkDelta,
  paddlingStaminaDelta,
  popUpStaminaDelta,
  optionalTowReleasePhysicallySupported,
  optionalTowReleaseFaceQuality,
  optionalTowReleaseQuality,
  optionalTowNavigableZ,
  optionalTowRouteClearance,
  optionalTowTakeoffTargetScore,
  OPTIONAL_TOW_BERTH_OFFSHORE,
  OPTIONAL_TOW_DURATION_SECONDS,
  OPTIONAL_TOW_HULL_BOW_REACH,
  OPTIONAL_TOW_HULL_HALF_BEAM,
  OPTIONAL_TOW_HULL_HALF_LENGTH,
  OPTIONAL_TOW_HULL_MAX_VERTICAL_ACCELERATION,
  OPTIONAL_TOW_HULL_MAX_VERTICAL_SPEED,
  OPTIONAL_TOW_HULL_STERN_REACH,
  OPTIONAL_TOW_LAUNCH_CLEARANCE_PROGRESS,
  OPTIONAL_TOW_NAVIGABLE_OFFSHORE,
  OPTIONAL_TOW_RETURN_BERTH_PROGRESS,
  primaryWaveVelocityAt,
  readCrestTimingMechanics,
  readDuckDiveCue,
  readPaddleTrainingMechanics,
  readSurfTrainingForces,
  reachedSurfTrainingStep,
  resolveBoardTakeoffOpportunity,
  resolvePaddleHeadingTarget,
  recognizeSurfboardLipManeuver,
  recognizeSurfboardSurfaceManeuver,
  resolveSeparatedSurfboardWaterForces,
  resolveSeparatedSurferBreakingWash,
  resolveSeparatedSurferProjectedArea,
  resolveShorebreakBandLoad,
  resolveSurfboardBodyRelease,
  resolveSurfboardPlaning,
  resolveDuckDiveInitiation,
  resolveLineupFromBreakingGeometry,
  advanceOptionalTowHullFloat,
  resolveOptionalTowHullAttitude,
  resolvePopUpLandingSupport,
  resolveSurfboardFailureRelease,
  resolveSurfboardLeashReaction,
  resolveSurfboardLeashTorque,
  resolveSurfboardRailDemand,
  resolveSurfboardRailGrip,
  resolveSurfboardRailSlip,
  resolveSurfboardContactPatchOffsets,
  resolveSurferPassiveCompression,
  resolveSurfboardTumbleRelease,
  resolveSurfboardTurbulence,
  resolveSurfboardWavePatchContact,
  resolveSurfboardWavePressure,
  resolveSurfboardWipeout,
  resolveTakeoffPaddleDrive,
  resolveTakeoffSpeedMatch,
  resolveWaveCrestPhaseIdentity,
  resolveWaveLineSide,
  resolveWavePocketFrame,
  resolveWaveSectionPressure,
  resolveWaveTubePressure,
  resolveWaveWallApproach,
  RIDE_RESULT_LINE_Z,
  rideRailInputFromPaddleSteer,
  SHALLOW_DISMOUNT_Z,
  SHORELINE_REFERENCE_Z,
  shorelineRideOutProgress,
  shorelineShiftForTide,
  stageOptionalTowCrestAtBreaker,
  stabilizeHeadingGuideDegrees,
  surfboardLandingSucceeded,
  surfboardReleaseVerticalImpulse,
  surfboardReleaseYawImpulse,
  surfboardWipeoutTriggered,
  surfboardLipLaunchSupport,
  surfingStaminaDelta,
  SURF_ASSIST_PROFILES,
  waveBreakOffsetForEnergy,
  waveCrestDistanceAtPhase,
  waveCrestPropertiesAtPhase,
  waveFacePositionAtPhase,
  waveBreakingGeometryAt,
  waveBreakingCoordinateAt,
  waveHeightAt,
  waveSetStateAt,
  waveSetState,
  waveSurfaceFrameAt,
} from "../lib/game.ts";
import {
  BEACHES,
  getBreakCharacter,
} from "../lib/beaches.ts";
import { shorelineReferenceAt } from "../lib/bathymetry.ts";
import {
  OCEAN_SHORELINE_WORLD_Z,
  sampleCoastDominantWave,
  sampleCoastWaveSurface,
} from "../lib/ocean.ts";

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
const sustainedEngagement30 = engagementFor(
  1.1,
  alignedEngagementSample,
  30,
);
const sustainedEngagement120 = engagementFor(
  1.1,
  alignedEngagementSample,
  120,
);
const briefPressurePulse = engagementFor(
  .12,
  alignedEngagementSample,
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
      - sustainedEngagement30.engagement
  ) > .025
  || briefPressurePulse.engagement >= .2
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

const alignedTrainingState = {
  ...INITIAL_STATS,
  phase: "paddling",
  paddleLeftWork: .3,
  paddleRightWork: .3,
  inLineup: true,
  takeoffAlignment: .82,
};
const matchedWithoutFace = {
  ...alignedTrainingState,
  takeoffSpeedMatch: .72,
  takeoffOpportunity: 0,
};
const matchedLiveFaceTraining = {
  ...matchedWithoutFace,
  takeoffOpportunity: .24,
};
const unsupportedStandingTraining = {
  ...matchedLiveFaceTraining,
  phase: "riding",
  rideTakeoffQuality: .12,
  waveEngagement: 0,
  wavePressure: 0,
  hullPatchContact: 0,
};
const supportedStandingTraining = {
  ...unsupportedStandingTraining,
  rideTakeoffQuality: .72,
  wavePressure: .34,
  hullPatchContact: .48,
};
if (
  reachedSurfTrainingStep(alignedTrainingState) !== 4
  || reachedSurfTrainingStep(matchedWithoutFace) !== 4
  || reachedSurfTrainingStep(matchedLiveFaceTraining) !== 5
  || reachedSurfTrainingStep(unsupportedStandingTraining) !== 5
  || reachedSurfTrainingStep(supportedStandingTraining) !== 6
) {
  throw new Error(
    "Training progression no longer requires demonstrated alignment, live speed match, and supported standing",
  );
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
const fiveSecondWavelength = deepWaterWavelengthForPeriod(5);
const tenSecondWavelength = deepWaterWavelengthForPeriod(10);
const twentySecondWavelength = deepWaterWavelengthForPeriod(20);
const shortPeriodTransport = primaryWaveVelocityAt(
  0,
  -180,
  10,
  {
    ...settings,
    wavePeriod: 5,
    swellHeight: 1.95,
    swellPeriod: 5,
  },
  character,
);
const longPeriodTransport = primaryWaveVelocityAt(
  0,
  -180,
  10,
  {
    ...settings,
    wavePeriod: 20,
    swellHeight: 1.95,
    swellPeriod: 20,
  },
  character,
);
if (
  Math.abs(fiveSecondWavelength - 39.03275) > .001
  || Math.abs(
    tenSecondWavelength / fiveSecondWavelength - 4,
  ) > .000001
  || Math.abs(
    twentySecondWavelength / tenSecondWavelength - 4,
  ) > .000001
  || longPeriodTransport.speed
    <= shortPeriodTransport.speed * 1.15
  || longPeriodTransport.wavelength
    <= shortPeriodTransport.wavelength * 3
  || longPeriodTransport.wavelength
    >= twentySecondWavelength
) {
  throw new Error(
    "Finite-depth wave transport no longer preserves dispersion and shallow-water slowing",
  );
}

const physicalTowContour = findWaveBreakingContourAt(
  8,
  12,
  settings,
  character,
  .9,
);
const stagedTowCrest = stageOptionalTowCrestAtBreaker(
  8,
  -48,
  31,
  -82,
  .6,
  .8,
);
const stagedTowTangentX = stagedTowCrest.x - 8
  - stagedTowCrest.normalOffset * .6;
const stagedTowTangentZ = stagedTowCrest.z + 48
  - stagedTowCrest.normalOffset * .8;
const stagedTowTangentOffset = stagedTowTangentX * .8
  + stagedTowTangentZ * -.6;
const originalTowNormalOffset = (31 - 8) * .6 + (-82 + 48) * .8;
const originalTowTangentX = 31 - 8 - originalTowNormalOffset * .6;
const originalTowTangentZ = -82 + 48 - originalTowNormalOffset * .8;
const supportedTowFaceQuality = optionalTowReleaseFaceQuality({
  breakingRatio: .94,
  crestPhaseError: .58,
  faceSlope: .075,
  surfaceRise: .28,
  whitewater: .14,
});
const flatTowFaceQuality = optionalTowReleaseFaceQuality({
  breakingRatio: .94,
  crestPhaseError: -.8,
  faceSlope: 0,
  surfaceRise: -.12,
  whitewater: 0,
});
const foamedTowFaceQuality = optionalTowReleaseFaceQuality({
  breakingRatio: .94,
  crestPhaseError: .58,
  faceSlope: .075,
  surfaceRise: .28,
  whitewater: .92,
});
const spentTowFaceQuality = optionalTowReleaseFaceQuality({
  breakingRatio: 1.45,
  crestPhaseError: .58,
  faceSlope: .075,
  surfaceRise: .28,
  whitewater: .14,
});
const idealTowInterceptQuality = optionalTowReleaseQuality({
  routeProgress: .72,
  faceQuality: supportedTowFaceQuality,
  distanceToTarget: .4,
  headingAlignment: .96,
  speedMatch: .94,
});
const missedTowInterceptQuality = optionalTowReleaseQuality({
  routeProgress: .92,
  faceQuality: supportedTowFaceQuality,
  distanceToTarget: 9,
  headingAlignment: .96,
  speedMatch: .94,
});
const scaledTowTargetScore = optionalTowTakeoffTargetScore(
  supportedTowFaceQuality,
  4,
  2.5,
);
const lipTowTargetScore = optionalTowTakeoffTargetScore(
  supportedTowFaceQuality,
  1.35,
  2.5,
);
const towClampedFromSand = optionalTowNavigableZ(14, 12);
const towAlreadyOffshore = optionalTowNavigableZ(-20, 12);
const towCustomClearance = optionalTowNavigableZ(8, 12, 8);
const towBerthClearance = optionalTowNavigableZ(12, 12, .5);
const launchClearances = Array.from(
  { length: OPTIONAL_TOW_DURATION_SECONDS * 60 + 1 },
  (_, frame) => optionalTowRouteClearance(
    frame / (OPTIONAL_TOW_DURATION_SECONDS * 60),
  ),
);
const returnClearances = Array.from(
  { length: 8.5 * 60 + 1 },
  (_, frame) => optionalTowRouteClearance(
    frame / (8.5 * 60),
    true,
  ),
);
const maximumClearanceFrameDelta = (values) => Math.max(
  ...values.slice(1).map((value, index) => (
    Math.abs(value - values[index])
  )),
);
const towSurveySettingsFor = (beach) => ({
  ...settings,
  mode: "playground",
  board: "gun",
  waveHeight: beach.fallback.waveHeight,
  wavePeriod: beach.fallback.wavePeriod,
  waveDirection: beach.fallback.waveDirection,
  swellHeight: beach.fallback.waveHeight * .8,
  swellPeriod: beach.fallback.wavePeriod,
  swellDirection: beach.fallback.waveDirection,
  currentStrength: .4,
  currentDirection: beach.heading,
  windSpeed: beach.fallback.windSpeed,
  windDirection: beach.heading,
  waterTemperature: beach.fallback.waterTemperature,
  airTemperature: beach.fallback.waterTemperature + 2,
  coastHeading: beach.heading,
  tide: 0,
});
const towBerthSurvey = BEACHES.flatMap((beach) => (
  beach.zones.map((zone) => {
    const character = getBreakCharacter(beach.id, zone.name);
    const zoneSettings = towSurveySettingsFor(beach);
    const centerX = 10;
    const shorelineWorldZ = OCEAN_SHORELINE_WORLD_Z
      + shorelineReferenceAt(beach.id, zone.name, centerX);
    const centerZ = optionalTowNavigableZ(
      shorelineWorldZ,
      shorelineWorldZ,
      OPTIONAL_TOW_BERTH_OFFSHORE,
    );
    const centerSurface = sampleCoastWaveSurface(
      centerX,
      centerZ,
      0,
      zoneSettings,
      character,
    );
    return {
      id: `${beach.id}:${zone.name}`,
      centerDepth: centerSurface.depth,
      shoreCollapse: centerSurface.shoreCollapse,
      interactionDistance: Math.hypot(
        centerX - centerX,
        centerZ - shorelineWorldZ,
      ),
    };
  })
));
const surveyTowHullFootprint = (
  coastId,
  zoneName,
  clearance,
) => {
  const beach = BEACHES.find((candidate) => (
    candidate.id === coastId
  ));
  if (!beach) {
    throw new Error(`Unknown tow survey coast: ${coastId}`);
  }
  const zone = beach.zones.find((candidate) => (
    candidate.name === zoneName
  ));
  if (!zone) {
    throw new Error(
      `Unknown tow survey zone: ${coastId}:${zoneName}`,
    );
  }
  const character = getBreakCharacter(coastId, zoneName);
  const zoneSettings = towSurveySettingsFor(beach);
  const centerX = 10;
  const shorelineWorldZ = OCEAN_SHORELINE_WORLD_Z
    + shorelineReferenceAt(coastId, zoneName, centerX);
  const centerZ = optionalTowNavigableZ(
    shorelineWorldZ,
    shorelineWorldZ,
    clearance,
  );
  const heading = Math.sign(character.peel || 1) * Math.PI / 2;
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  let maximumProbeRange = 0;
  let maximumPitch = 0;
  let minimumDepth = Infinity;
  let minimumCollapse = Infinity;
  let minimumWaterline = Infinity;
  let maximumWaterline = -Infinity;
  const sampleCount = 96;
  for (let index = 0; index < sampleCount; index += 1) {
    const elapsed = index
      / (sampleCount - 1)
      * beach.fallback.wavePeriod
      * 2;
    const sampleAt = (localX, localZ) => (
      sampleCoastWaveSurface(
        centerX + rightX * localX + forwardX * localZ,
        centerZ + rightZ * localX + forwardZ * localZ,
        elapsed,
        zoneSettings,
        character,
      )
    );
    const centerSurface = sampleAt(0, 0);
    const bowSurface = sampleAt(
      0,
      OPTIONAL_TOW_HULL_BOW_REACH,
    );
    const sternSurface = sampleAt(
      0,
      -OPTIONAL_TOW_HULL_STERN_REACH,
    );
    const leftSurface = sampleAt(
      -OPTIONAL_TOW_HULL_HALF_BEAM,
      0,
    );
    const rightSurface = sampleAt(
      OPTIONAL_TOW_HULL_HALF_BEAM,
      0,
    );
    const heights = [
      centerSurface.height,
      bowSurface.height,
      sternSurface.height,
      leftSurface.height,
      rightSurface.height,
    ];
    maximumProbeRange = Math.max(
      maximumProbeRange,
      Math.max(...heights) - Math.min(...heights),
    );
    const attitude = resolveOptionalTowHullAttitude({
      centerHeight: centerSurface.height,
      bowHeight: bowSurface.height,
      sternHeight: sternSurface.height,
      leftHeight: leftSurface.height,
      rightHeight: rightSurface.height,
      speed: 0,
    });
    maximumPitch = Math.max(
      maximumPitch,
      Math.abs(attitude.pitch),
    );
    minimumWaterline = Math.min(
      minimumWaterline,
      attitude.waterlineHeight,
    );
    maximumWaterline = Math.max(
      maximumWaterline,
      attitude.waterlineHeight,
    );
    minimumDepth = Math.min(
      minimumDepth,
      centerSurface.depth,
    );
    minimumCollapse = Math.min(
      minimumCollapse,
      centerSurface.shoreCollapse,
    );
  }
  return {
    id: `${coastId}:${zoneName}@${clearance}m`,
    maximumProbeRange,
    maximumPitch,
    waterlineExcursion: maximumWaterline - minimumWaterline,
    minimumDepth,
    minimumCollapse,
  };
};
const mavericksLegacyTowBerth = surveyTowHullFootprint(
  "mavericks",
  "The Bowl",
  OPTIONAL_TOW_NAVIGABLE_OFFSHORE,
);
const mavericksTowBerth = surveyTowHullFootprint(
  "mavericks",
  "The Bowl",
  OPTIONAL_TOW_BERTH_OFFSHORE,
);
const hossegorTowBerth = surveyTowHullFootprint(
  "hossegor",
  "La Nord",
  OPTIONAL_TOW_BERTH_OFFSHORE,
);
const uluwatuTowBerth = surveyTowHullFootprint(
  "uluwatu",
  "The Peak",
  OPTIONAL_TOW_BERTH_OFFSHORE,
);
const levelTowHull = resolveOptionalTowHullAttitude({
  centerHeight: 1,
  bowHeight: 1,
  sternHeight: 1,
  leftHeight: 1,
  rightHeight: 1,
  speed: 0,
});
const climbingTowHull = resolveOptionalTowHullAttitude({
  centerHeight: 1,
  bowHeight: 1.8,
  sternHeight: .2,
  leftHeight: 1,
  rightHeight: 1,
  speed: 11,
});
const bankedTowHull = resolveOptionalTowHullAttitude({
  centerHeight: 1,
  bowHeight: 1,
  sternHeight: 1,
  leftHeight: .65,
  rightHeight: 1.35,
  speed: 8,
});
const convexTowHull = resolveOptionalTowHullAttitude({
  centerHeight: 1.7,
  bowHeight: .9,
  sternHeight: .9,
  leftHeight: .9,
  rightHeight: .9,
  speed: 14.5,
});
const invalidTowHull = resolveOptionalTowHullAttitude({
  centerHeight: Number.NaN,
  bowHeight: Number.NaN,
  sternHeight: Number.NaN,
  leftHeight: Number.NaN,
  rightHeight: Number.NaN,
  speed: Number.NaN,
});
const newTowHullFloatState = () => ({
  elevation: 0,
  verticalVelocity: 0,
  integrationVelocity: 0,
  referenceVelocity: 0,
  referenceAcceleration: 0,
  pitch: 0,
  pitchVelocity: 0,
  roll: 0,
  rollVelocity: 0,
  targetElevation: 0,
  targetVerticalVelocity: 0,
  targetPitch: 0,
  targetRoll: 0,
  initialized: false,
});
const simulateTowHullStep = (framesPerSecond) => {
  let state = newTowHullFloatState();
  const deltaSeconds = 1 / framesPerSecond;
  let maximumStep = 0;
  let maximumElevation = -Infinity;
  let maximumVerticalVelocity = 0;
  let maximumRelativeVelocity = 0;
  let maximumTargetError = 0;
  let maximumWorldAcceleration = 0;
  let previousVerticalVelocity = 0;
  for (
    let frame = 0;
    frame < framesPerSecond * 3;
    frame += 1
  ) {
    const elapsed = frame * deltaSeconds;
    const riseProgress = Math.max(
      0,
      Math.min(1, (elapsed - .5) / .4),
    );
    const easedRise = riseProgress * riseProgress
      * (3 - 2 * riseProgress);
    const next = advanceOptionalTowHullFloat(state, {
      targetElevation: .11 + easedRise,
      targetPitch: -.12 * easedRise,
      targetRoll: .1 * easedRise,
      planing: .75,
      deltaSeconds,
    });
    if (state.initialized) {
      maximumStep = Math.max(
        maximumStep,
        Math.abs(next.elevation - state.elevation),
      );
    }
    maximumElevation = Math.max(maximumElevation, next.elevation);
    maximumVerticalVelocity = Math.max(
      maximumVerticalVelocity,
      Math.abs(next.verticalVelocity),
    );
    maximumRelativeVelocity = Math.max(
      maximumRelativeVelocity,
      Math.abs(next.integrationVelocity ?? 0),
    );
    maximumTargetError = Math.max(
      maximumTargetError,
      Math.abs(next.elevation - (.11 + easedRise)),
    );
    maximumWorldAcceleration = Math.max(
      maximumWorldAcceleration,
      Math.abs(
        (next.verticalVelocity - previousVerticalVelocity)
          / deltaSeconds,
      ),
    );
    previousVerticalVelocity = next.verticalVelocity;
    state = next;
  }
  return {
    state,
    maximumStep,
    maximumElevation,
    maximumVerticalVelocity,
    maximumRelativeVelocity,
    maximumTargetError,
    maximumWorldAcceleration,
  };
};
const simulateTowHullWave = (
  framesPerSecond,
  frequency,
  amplitude,
  duration,
) => {
  let state = newTowHullFloatState();
  const deltaSeconds = 1 / framesPerSecond;
  let minimumElevation = Infinity;
  let maximumElevation = -Infinity;
  let minimumDraft = Infinity;
  let maximumDraft = -Infinity;
  let maximumVerticalVelocity = 0;
  let maximumRelativeVelocity = 0;
  let maximumTargetError = 0;
  let maximumWorldAcceleration = 0;
  let maximumFrameDisplacement = 0;
  let maximumReferenceAcceleration = 0;
  let previousVerticalVelocity = 0;
  let previousElevation = state.elevation;
  for (
    let frame = 0;
    frame < framesPerSecond * duration;
    frame += 1
  ) {
    const elapsed = frame * deltaSeconds;
    const targetElevation = .16
      + Math.sin(
        elapsed * Math.PI * 2 * frequency,
      ) * amplitude;
    state = advanceOptionalTowHullFloat(state, {
      targetElevation,
      targetPitch: Math.sin(
        elapsed * Math.PI * 2 * frequency + .4,
      ) * .08,
      targetRoll: Math.sin(
        elapsed * Math.PI * 2 * frequency - .7,
      ) * .06,
      planing: 1,
      deltaSeconds,
    });
    const frameDisplacement = state.elevation - previousElevation;
    const worldAcceleration = (
      state.verticalVelocity - previousVerticalVelocity
    ) / deltaSeconds;
    if (elapsed >= Math.min(2, duration * .25)) {
      minimumElevation = Math.min(
        minimumElevation,
        state.elevation,
      );
      maximumElevation = Math.max(
        maximumElevation,
        state.elevation,
      );
      const workingDraft = .17
        - (state.elevation - targetElevation);
      minimumDraft = Math.min(minimumDraft, workingDraft);
      maximumDraft = Math.max(maximumDraft, workingDraft);
      maximumVerticalVelocity = Math.max(
        maximumVerticalVelocity,
        Math.abs(state.verticalVelocity),
      );
      maximumRelativeVelocity = Math.max(
        maximumRelativeVelocity,
        Math.abs(state.integrationVelocity ?? 0),
      );
      maximumTargetError = Math.max(
        maximumTargetError,
        Math.abs(state.elevation - targetElevation),
      );
      maximumWorldAcceleration = Math.max(
        maximumWorldAcceleration,
        Math.abs(worldAcceleration),
      );
      maximumFrameDisplacement = Math.max(
        maximumFrameDisplacement,
        Math.abs(frameDisplacement),
      );
      maximumReferenceAcceleration = Math.max(
        maximumReferenceAcceleration,
        Math.abs(state.referenceAcceleration ?? 0),
      );
    }
    previousVerticalVelocity = state.verticalVelocity;
    previousElevation = state.elevation;
  }
  return {
    state,
    amplitude: (maximumElevation - minimumElevation) * .5,
    minimumDraft,
    maximumDraft,
    maximumVerticalVelocity,
    maximumRelativeVelocity,
    maximumTargetError,
    maximumWorldAcceleration,
    maximumFrameDisplacement,
    maximumReferenceAcceleration,
  };
};
const towHullStep30 = simulateTowHullStep(30);
const towHullStep60 = simulateTowHullStep(60);
const towHullStep120 = simulateTowHullStep(120);
// Five footprint samples reduce local chop, but the remaining 3-6 Hz water
// plane must still be materially attenuated by hull inertia. A full
// half-metre, eight-second swell should pass through essentially unchanged.
const towHullChop30 = simulateTowHullWave(30, 3, .12, 4);
const towHullChop60 = simulateTowHullWave(60, 3, .12, 4);
const towHullChop120 = simulateTowHullWave(120, 3, .12, 4);
const towHullFastChop = simulateTowHullWave(60, 6, .12, 3);
const towHullSwell = simulateTowHullWave(60, 1 / 8, .5, 16);
const breakingTowSettings = {
  ...settings,
  mode: "playground",
  board: "gun",
  waveHeight: 3.1,
  wavePeriod: 15,
  waveDirection: 285,
  swellHeight: 3.1,
  swellPeriod: 15,
  swellDirection: 285,
  windSpeed: 17,
  windDirection: 285,
  waterTemperature: 13,
  airTemperature: 15,
  coastHeading: 250,
};
const breakingTowCharacter = {
  kind: "reef",
  line: "RIGHT",
  peel: .76,
  power: 1.34,
  steepness: 1.06,
  hollow: .62,
  variability: .32,
  length: .88,
  coastId: "mavericks",
  zoneName: "The Bowl",
};
const simulateBreakingTowHull = () => {
  let state = newTowHullFloatState();
  let maximumFrameDisplacement = 0;
  let maximumTargetError = 0;
  let minimumFreeboard = Infinity;
  let maximumPitch = 0;
  for (let frame = 0; frame < 24 * 60; frame += 1) {
    const elapsed = frame / 60;
    const surfaceAt = (x, z) => waveHeightAt(
      x,
      z,
      elapsed,
      breakingTowSettings,
      breakingTowCharacter,
    );
    const centerHeight = surfaceAt(10, -60);
    const bowHeight = surfaceAt(
      10,
      -60 - OPTIONAL_TOW_HULL_BOW_REACH,
    );
    const sternHeight = surfaceAt(
      10,
      -60 + OPTIONAL_TOW_HULL_STERN_REACH,
    );
    const leftHeight = surfaceAt(
      10 - OPTIONAL_TOW_HULL_HALF_BEAM,
      -60,
    );
    const rightHeight = surfaceAt(
      10 + OPTIONAL_TOW_HULL_HALF_BEAM,
      -60,
    );
    const attitude = resolveOptionalTowHullAttitude({
      centerHeight,
      bowHeight,
      sternHeight,
      leftHeight,
      rightHeight,
      speed: 12,
    });
    const targetElevation = attitude.waterlineHeight
      + .145 + .04 * attitude.planing;
    const previousElevation = state.elevation;
    state = advanceOptionalTowHullFloat(state, {
      targetElevation,
      targetPitch: attitude.pitch,
      targetRoll: attitude.roll,
      planing: attitude.planing,
      deltaSeconds: 1 / 60,
    });
    if (elapsed < 5) continue;
    maximumFrameDisplacement = Math.max(
      maximumFrameDisplacement,
      Math.abs(state.elevation - previousElevation),
    );
    maximumTargetError = Math.max(
      maximumTargetError,
      Math.abs(state.elevation - targetElevation),
    );
    maximumPitch = Math.max(maximumPitch, Math.abs(state.pitch));
    const bowRise = -Math.sin(state.pitch)
      * OPTIONAL_TOW_HULL_BOW_REACH;
    const sternRise = Math.sin(state.pitch)
      * OPTIONAL_TOW_HULL_STERN_REACH;
    const rightRise = Math.sin(state.roll)
      * OPTIONAL_TOW_HULL_HALF_BEAM;
    const leftRise = -Math.sin(state.roll)
      * OPTIONAL_TOW_HULL_HALF_BEAM;
    const highestWaterline = Math.max(
      centerHeight - state.elevation,
      bowHeight - state.elevation - bowRise,
      sternHeight - state.elevation - sternRise,
      leftHeight - state.elevation - leftRise,
      rightHeight - state.elevation - rightRise,
    );
    minimumFreeboard = Math.min(
      minimumFreeboard,
      .17 - highestWaterline,
    );
  }
  return {
    state,
    maximumFrameDisplacement,
    maximumTargetError,
    minimumFreeboard,
    maximumPitch,
  };
};
const breakingTowHull = simulateBreakingTowHull();
const movingTowSettings = {
  ...settings,
  mode: "playground",
  assist: "guided",
  board: "performance",
  waveHeight: 2,
  wavePeriod: 8,
  waveDirection: 330,
  windWaveHeight: .35,
  windWavePeriod: 5.5,
  windWavePeakPeriod: 5.5,
  windWaveDirection: 330,
  swellHeight: 2,
  swellPeriod: 8.25,
  swellPeakPeriod: 8.25,
  swellDirection: 330,
  secondarySwellHeight: 0,
  secondarySwellPeriod: 0,
  secondarySwellDirection: 330,
  tertiarySwellHeight: 0,
  tertiarySwellPeriod: 0,
  tertiarySwellDirection: 330,
  currentStrength: .4,
  currentDirection: 322,
  windSpeed: 5,
  windDirection: 322,
  coastHeading: 322,
  tide: .1,
  timeOfDay: 16,
  weatherCode: 0,
};
const movingTowCharacter = getBreakCharacter(
  "pipeline",
  "First Reef",
);
const clampTowValue = (value, minimum, maximum) => Math.max(
  minimum,
  Math.min(maximum, value),
);
const smoothTowValue = (value, minimum, maximum) => {
  const unit = clampTowValue(
    (value - minimum) / Math.max(1e-9, maximum - minimum),
    0,
    1,
  );
  return unit * unit * (3 - 2 * unit);
};
const smootherTowValue = (value, minimum, maximum) => {
  const unit = clampTowValue(
    (value - minimum) / Math.max(1e-9, maximum - minimum),
    0,
    1,
  );
  return unit * unit * unit
    * (unit * (unit * 6 - 15) + 10);
};
const dampTowValue = (
  current,
  target,
  responsiveness,
  deltaSeconds,
) => current + (target - current)
  * (1 - Math.exp(-responsiveness * deltaSeconds));
const dampTowAngle = (
  current,
  target,
  responsiveness,
  deltaSeconds,
) => {
  const difference = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current),
  );
  return current + difference
    * (1 - Math.exp(-responsiveness * deltaSeconds));
};
const movingTowPointOnCrest = (
  anchorX,
  anchorZ,
  elapsed,
  targetPhase,
) => {
  let x = anchorX;
  let z = anchorZ;
  let dominant = sampleCoastDominantWave(
    x,
    z,
    elapsed,
    movingTowSettings,
    movingTowCharacter,
  );
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const speed = dominant?.celerity ?? 0;
    const normalX = (dominant?.celerityX ?? 0)
      / Math.max(.001, speed);
    const normalZ = (dominant?.celerityZ ?? 0)
      / Math.max(.001, speed);
    const phaseError = (
      (dominant?.phase ?? 0) + Math.PI * .5
    ) - targetPhase;
    const waveNumber = (Math.PI * 2)
      / Math.max(.1, dominant?.wavelength ?? 1);
    x -= normalX * phaseError / waveNumber;
    z -= normalZ * phaseError / waveNumber;
    dominant = sampleCoastDominantWave(
      x,
      z,
      elapsed,
      movingTowSettings,
      movingTowCharacter,
    );
  }
  const speed = dominant?.celerity ?? 0;
  return {
    x,
    z,
    normalX: (dominant?.celerityX ?? 0)
      / Math.max(.001, speed),
    normalZ: (dominant?.celerityZ ?? 0)
      / Math.max(.001, speed),
    speed,
  };
};
const simulateMovingBreakingTowHull = ({
  label,
  rawDeltaAtFrame,
}) => {
  const tideShift = shorelineShiftForTide(
    movingTowSettings.tide,
  );
  const towShorelineZAt = (x) => (
    SHORELINE_REFERENCE_Z
      + tideShift
      + shorelineReferenceAt(
        "pipeline",
        "First Reef",
        x,
      )
  );
  const towHomeX = 10;
  const towHomeZ = optionalTowNavigableZ(
    towShorelineZAt(towHomeX),
    towShorelineZAt(towHomeX),
    OPTIONAL_TOW_BERTH_OFFSHORE,
  );
  const routeNavigableTowZAt = (
    x,
    targetZ,
    routeProgress,
  ) => optionalTowNavigableZ(
    targetZ,
    towShorelineZAt(x),
    optionalTowRouteClearance(routeProgress),
  );
  let craft = {
    x: towHomeX,
    z: towHomeZ,
    heading: Math.sign(movingTowCharacter.peel || 1)
      * Math.PI / 2,
    speed: 0,
  };
  let surfer = {
    x: towHomeX - 1.7,
    z: towHomeZ + 1.2,
    velocityX: 0,
    velocityZ: 0,
  };
  let visualHeading = craft.heading;
  let hullState = newTowHullFloatState();
  let elapsed = 0;
  let progress = 0;
  let duration = OPTIONAL_TOW_DURATION_SECONDS;
  let targetWavePhase = 0;
  let targetX = 0;
  let targetZ = 0;
  let towStarted = false;
  let scanRefreshAt = -1;
  let targetFaceDistance = clampTowValue(
    2.8 + movingTowSettings.waveHeight * .32,
    3,
    4.6,
  );
  let currentFaceDistance = targetFaceDistance;
  let scanFaceQuality = 0;
  let scanTransportSpeed = 8;
  let maximumFrameDisplacement = 0;
  let maximumQuarterSecondDisplacement = 0;
  let maximumTargetError = 0;
  let maximumTargetErrorSample = null;
  let maximumDraft = -Infinity;
  let minimumFreeboard = Infinity;
  let minimumFreeboardSample = null;
  let minimumElevation = Infinity;
  let maximumElevation = -Infinity;
  let maximumPitch = 0;
  let maximumPitchFrameStep = 0;
  let maximumPitchAngularVelocity = 0;
  let maximumVerticalVelocity = 0;
  let maximumWorldAcceleration = 0;
  let maximumVelocityConsistencyError = 0;
  let maximumWorldAccelerationSample = null;
  let maximumTargetAcceleration = 0;
  let maximumMinimumContactAcceleration = 0;
  let previousTargetElevation = null;
  let previousTargetVelocity = 0;
  let previousMinimumContactElevation = null;
  let previousMinimumContactVelocity = 0;
  let maximumSupportLag = 0;
  let maximumSupportLagSample = null;
  let supportLagDuration = 0;
  let maximumSupportLagDuration = 0;
  let submergedDuration = 0;
  let maximumSubmergedDuration = 0;
  let maximumBelowTarget = 0;
  let maximumAboveTarget = 0;
  let maximumQuarterSecondRelativeDisplacement = 0;
  let previousVerticalVelocity = 0;
  let previousSample = null;
  let maximumRawDelta = 0;
  let maximumCraftSpeed = 0;
  let finalLiveTargetDistance = Infinity;
  let finalCraftTargetDistance = Infinity;
  let frame = 0;
  const targetFaceHeight = forecastFaceHeightForBreak(
    movingTowSettings.waveHeight,
    movingTowSettings.tide,
    movingTowCharacter,
  );
  while (
    elapsed < 45
    && (!towStarted || progress < .84)
  ) {
    const rawDelta = rawDeltaAtFrame(frame);
    const simulationDelta = Math.min(rawDelta, .05);
    elapsed += rawDelta;
    maximumRawDelta = Math.max(maximumRawDelta, rawDelta);
    if (!towStarted && elapsed >= 3.2) {
      towStarted = true;
      const towSide = movingTowCharacter.peel < 0 ? -1 : 1;
      targetX = towSide * 8;
      targetZ = findWaveBreakingContourAt(
        targetX,
        elapsed,
        movingTowSettings,
        movingTowCharacter,
        .9,
      ).z;
      const crestArrivalProgress = .94;
      const minimumArrival =
        OPTIONAL_TOW_DURATION_SECONDS * crestArrivalProgress;
      const maximumArrival = 27.5 * crestArrivalProgress;
      let arrivalSeconds = minimumArrival;
      let primeWavePhase = (
        sampleCoastDominantWave(
          targetX,
          targetZ,
          elapsed + minimumArrival,
          movingTowSettings,
          movingTowCharacter,
        )?.phase ?? 0
      ) + Math.PI * .5;
      let primeScore = -1;
      for (
        let candidateArrival = minimumArrival;
        candidateArrival <= maximumArrival + .001;
        candidateArrival += .2
      ) {
        const candidate = waveSetStateAt(
          targetX,
          targetZ,
          elapsed + candidateArrival,
          movingTowSettings,
          movingTowCharacter,
        );
        const crestProximity = 1 - smoothTowValue(
          Math.abs(candidate.crestPhaseError),
          .08,
          .62,
        );
        const score = candidate.crestEnergy
          * (.32 + crestProximity * .68)
          + (candidate.crestSurfable ? .12 : 0);
        if (score <= primeScore) continue;
        primeScore = score;
        arrivalSeconds = candidateArrival;
        primeWavePhase = candidate.crestPhase;
      }
      duration = clampTowValue(
        arrivalSeconds / crestArrivalProgress,
        OPTIONAL_TOW_DURATION_SECONDS,
        27.5,
      );
      targetWavePhase = primeWavePhase;
    }

    if (towStarted) {
      progress = advanceOptionalTowProgress(
        progress,
        simulationDelta,
        duration,
      );
      const towSide = movingTowCharacter.peel < 0 ? -1 : 1;
      const outboundX = towSide * 22;
      const outboundZ = targetZ - 24;
      let desiredTowX = craft.x;
      let desiredTowZ = craft.z;
      let liveTakeoffX = surfer.x;
      let liveTakeoffZ = surfer.z;
      let liveTakeoffTransportSpeed = 8;
      let liveCraftX = craft.x;
      let liveCraftZ = craft.z;
      if (progress >= .38) {
        const liveCrest = movingTowPointOnCrest(
          targetX,
          targetZ,
          elapsed,
          targetWavePhase,
        );
        const stagedCrest = stageOptionalTowCrestAtBreaker(
          targetX,
          targetZ,
          liveCrest.x,
          liveCrest.z,
          liveCrest.normalX,
          liveCrest.normalZ,
        );
        if (elapsed >= scanRefreshAt) {
          const firstScan = scanRefreshAt < 0;
          let bestTakeoffScore = -1;
          let bestFaceDistance = targetFaceDistance;
          let bestFaceQuality = scanFaceQuality;
          let bestTransportSpeed = scanTransportSpeed;
          for (
            let candidateIndex = 0;
            candidateIndex < 12;
            candidateIndex += 1
          ) {
            const faceDistance = 1.35 + candidateIndex * .52;
            const candidateX = stagedCrest.x
              + liveCrest.normalX * faceDistance;
            const candidateZ = stagedCrest.z
              + liveCrest.normalZ * faceDistance;
            const candidateSurface = waveSurfaceFrameAt(
              candidateX,
              candidateZ,
              elapsed,
              movingTowSettings,
              movingTowCharacter,
            );
            const candidateSlope = Math.max(
              0,
              -(
                candidateSurface.slopeX * liveCrest.normalX
                  + candidateSurface.slopeZ * liveCrest.normalZ
              ),
            );
            const candidateFaceQuality = optionalTowReleaseFaceQuality({
              breakingRatio: candidateSurface.breakingRatio,
              crestPhaseError: (
                (candidateSurface.dominant?.phase ?? 0)
                  + Math.PI * .5
              ) - targetWavePhase,
              faceSlope: candidateSlope,
              surfaceRise: candidateSurface.surfaceRise,
              whitewater: candidateSurface.whitewater,
            });
            const candidateScore = optionalTowTakeoffTargetScore(
              candidateFaceQuality,
              faceDistance,
              targetFaceHeight,
            );
            if (candidateScore <= bestTakeoffScore) continue;
            bestTakeoffScore = candidateScore;
            bestFaceDistance = faceDistance;
            bestFaceQuality = candidateFaceQuality;
            bestTransportSpeed =
              candidateSurface.dominant?.celerity
                ?? bestTransportSpeed;
          }
          targetFaceDistance = bestFaceDistance;
          if (firstScan) currentFaceDistance = bestFaceDistance;
          scanFaceQuality = bestFaceQuality;
          scanTransportSpeed = bestTransportSpeed;
          scanRefreshAt = elapsed + .1;
        }
        currentFaceDistance = dampTowValue(
          currentFaceDistance,
          targetFaceDistance,
          12,
          simulationDelta,
        );
        liveTakeoffX = stagedCrest.x
          + liveCrest.normalX * currentFaceDistance;
        liveTakeoffZ = stagedCrest.z
          + liveCrest.normalZ * currentFaceDistance;
        liveTakeoffTransportSpeed = scanTransportSpeed;
        liveCraftX = liveTakeoffX + liveCrest.normalX * 7;
        liveCraftZ = liveTakeoffZ + liveCrest.normalZ * 7;
      }
      if (progress < .38) {
        const outboundProgress = smootherTowValue(
          progress,
          0,
          .38,
        );
        desiredTowX = towHomeX
          + (outboundX - towHomeX) * outboundProgress;
        desiredTowZ = towHomeZ
          + (outboundZ - towHomeZ) * outboundProgress;
      } else if (progress < .6) {
        const turnProgress = smootherTowValue(
          progress,
          .38,
          .6,
        );
        desiredTowX = outboundX
          + (liveCraftX - outboundX) * turnProgress;
        desiredTowZ = outboundZ
          + (liveCraftZ - outboundZ) * turnProgress;
      } else {
        desiredTowX = liveCraftX;
        desiredTowZ = liveCraftZ;
      }
      desiredTowZ = routeNavigableTowZAt(
        desiredTowX,
        desiredTowZ,
        progress,
      );
      const routeSpeedLimit = 10.5 + (
        14.5 - 10.5
      ) * smootherTowValue(progress, .42, .72);
      const liveTargetDistance = Math.hypot(
        surfer.x - liveTakeoffX,
        surfer.z - liveTakeoffZ,
      );
      const matchedFaceSpeed = clampTowValue(
        liveTakeoffTransportSpeed * .88,
        5.5,
        11,
      );
      const catchupDemand = smoothTowValue(
        liveTargetDistance,
        4,
        22,
      );
      const interceptSpeedLimit = matchedFaceSpeed
        + (14.5 - matchedFaceSpeed) * catchupDemand;
      const maximumTowSpeed = progress < .6
        ? routeSpeedLimit
        : Math.min(routeSpeedLimit, interceptSpeedLimit);
      const previousCraftX = craft.x;
      const previousCraftZ = craft.z;
      const craftStep = advanceOptionalTowCraft(
        {
          x: craft.x,
          z: craft.z,
          velocityX: Math.sin(craft.heading) * craft.speed,
          velocityZ: Math.cos(craft.heading) * craft.speed,
          heading: craft.heading,
        },
        desiredTowX,
        desiredTowZ,
        simulationDelta,
        maximumTowSpeed,
      );
      const safeCraftZ = routeNavigableTowZAt(
        craftStep.x,
        craftStep.z,
        progress,
      );
      const shorelineClamped = safeCraftZ
        < craftStep.z - .0001;
      const resolvedVelocityX = (
        craftStep.x - previousCraftX
      ) / simulationDelta;
      const resolvedVelocityZ = (
        safeCraftZ - previousCraftZ
      ) / simulationDelta;
      craft = {
        x: craftStep.x,
        z: shorelineClamped ? safeCraftZ : craftStep.z,
        speed: shorelineClamped
          ? Math.min(
              maximumTowSpeed,
              Math.hypot(resolvedVelocityX, resolvedVelocityZ),
            )
          : craftStep.speed,
        heading: shorelineClamped && craftStep.speed > .08
          ? Math.atan2(resolvedVelocityX, resolvedVelocityZ)
          : craftStep.heading,
      };
      const ropeStep = advanceOptionalTowRope(
        surfer,
        {
          ...craftStep,
          ...craft,
          velocityX: shorelineClamped
            ? resolvedVelocityX
            : craftStep.velocityX,
          velocityZ: shorelineClamped
            ? resolvedVelocityZ
            : craftStep.velocityZ,
        },
        simulationDelta,
        7,
      );
      surfer = {
        x: ropeStep.x,
        z: ropeStep.z,
        velocityX: ropeStep.velocityX,
        velocityZ: ropeStep.velocityZ,
      };
      maximumCraftSpeed = Math.max(
        maximumCraftSpeed,
        craft.speed,
      );
      finalLiveTargetDistance = Math.hypot(
        surfer.x - liveTakeoffX,
        surfer.z - liveTakeoffZ,
      );
      finalCraftTargetDistance = Math.hypot(
        craft.x - liveCraftX,
        craft.z - liveCraftZ,
      );
    }

    visualHeading = towStarted
      ? dampTowAngle(
          visualHeading,
          craft.heading,
          12,
          rawDelta,
        )
      : craft.heading;
    const forwardX = Math.sin(visualHeading);
    const forwardZ = Math.cos(visualHeading);
    const rightX = Math.cos(visualHeading);
    const rightZ = -Math.sin(visualHeading);
    const surfaceAtHullPoint = (localX, localZ) => waveHeightAt(
      craft.x + rightX * localX + forwardX * localZ,
      craft.z + rightZ * localX + forwardZ * localZ,
      elapsed,
      movingTowSettings,
      movingTowCharacter,
    );
    const centerHeight = surfaceAtHullPoint(0, 0);
    const bowHeight = surfaceAtHullPoint(
      0,
      OPTIONAL_TOW_HULL_BOW_REACH,
    );
    const sternHeight = surfaceAtHullPoint(
      0,
      -OPTIONAL_TOW_HULL_STERN_REACH,
    );
    const leftHeight = surfaceAtHullPoint(
      -OPTIONAL_TOW_HULL_HALF_BEAM,
      0,
    );
    const rightHeight = surfaceAtHullPoint(
      OPTIONAL_TOW_HULL_HALF_BEAM,
      0,
    );
    const attitude = resolveOptionalTowHullAttitude({
      centerHeight,
      bowHeight,
      sternHeight,
      leftHeight,
      rightHeight,
      speed: craft.speed,
    });
    const displacementOriginY = attitude.waterlineHeight
      + .145 + .04 * attitude.planing;
    const targetElevation = displacementOriginY;
    const hullAnticipationSeconds = .1;
    const anticipatedCenterX = craft.x
      + forwardX
        * craft.speed
        * hullAnticipationSeconds;
    const anticipatedCenterZ = craft.z
      + forwardZ
        * craft.speed
        * hullAnticipationSeconds;
    const anticipatedSurfaceAtHullPoint = (
      localX,
      localZ,
    ) => waveHeightAt(
      anticipatedCenterX
        + rightX * localX
        + forwardX * localZ,
      anticipatedCenterZ
        + rightZ * localX
        + forwardZ * localZ,
      elapsed + hullAnticipationSeconds,
      movingTowSettings,
      movingTowCharacter,
    );
    const anticipatedCenterHeight =
      anticipatedSurfaceAtHullPoint(0, 0);
    const anticipatedBowHeight =
      anticipatedSurfaceAtHullPoint(
        0,
        OPTIONAL_TOW_HULL_BOW_REACH,
      );
    const anticipatedSternHeight =
      anticipatedSurfaceAtHullPoint(
        0,
        -OPTIONAL_TOW_HULL_STERN_REACH,
      );
    const anticipatedLeftHeight =
      anticipatedSurfaceAtHullPoint(
        -OPTIONAL_TOW_HULL_HALF_BEAM,
        0,
      );
    const anticipatedRightHeight =
      anticipatedSurfaceAtHullPoint(
        OPTIONAL_TOW_HULL_HALF_BEAM,
        0,
      );
    const anticipatedAttitude = resolveOptionalTowHullAttitude({
      centerHeight: anticipatedCenterHeight,
      bowHeight: anticipatedBowHeight,
      sternHeight: anticipatedSternHeight,
      leftHeight: anticipatedLeftHeight,
      rightHeight: anticipatedRightHeight,
      speed: craft.speed,
    });
    const anticipatedTargetElevation =
      anticipatedAttitude.waterlineHeight
      + .145 + .04 * anticipatedAttitude.planing;
    const contactPitch = hullState.initialized
      ? hullState.pitch
      : attitude.pitch;
    const contactRoll = hullState.initialized
      ? hullState.roll
      : attitude.roll;
    const contactBowRise = -Math.sin(contactPitch)
      * OPTIONAL_TOW_HULL_BOW_REACH;
    const contactSternRise = Math.sin(contactPitch)
      * OPTIONAL_TOW_HULL_STERN_REACH;
    const contactRightRise = Math.sin(contactRoll)
      * OPTIONAL_TOW_HULL_HALF_BEAM;
    const contactLeftRise = -Math.sin(contactRoll)
      * OPTIONAL_TOW_HULL_HALF_BEAM;
    const renderedPoseContactFloor = Math.max(
      centerHeight,
      bowHeight - contactBowRise,
      sternHeight - contactSternRise,
      leftHeight - contactLeftRise,
      rightHeight - contactRightRise,
    ) - .2;
    const minimumContactElevation = Math.max(
      targetElevation,
      renderedPoseContactFloor,
    );
    const anticipatedBowRise =
      -Math.sin(anticipatedAttitude.pitch)
        * OPTIONAL_TOW_HULL_BOW_REACH;
    const anticipatedSternRise =
      Math.sin(anticipatedAttitude.pitch)
        * OPTIONAL_TOW_HULL_STERN_REACH;
    const anticipatedRightRise =
      Math.sin(anticipatedAttitude.roll)
        * OPTIONAL_TOW_HULL_HALF_BEAM;
    const anticipatedLeftRise =
      -Math.sin(anticipatedAttitude.roll)
        * OPTIONAL_TOW_HULL_HALF_BEAM;
    const anticipatedContactFloor = Math.max(
      anticipatedCenterHeight,
      anticipatedBowHeight - anticipatedBowRise,
      anticipatedSternHeight - anticipatedSternRise,
      anticipatedLeftHeight - anticipatedLeftRise,
      anticipatedRightHeight - anticipatedRightRise,
    ) - .2;
    const anticipatedSupportElevation = Math.max(
      anticipatedTargetElevation,
      anticipatedContactFloor,
    );
    const predictedContactVelocity = (
      anticipatedSupportElevation - minimumContactElevation
    ) / hullAnticipationSeconds;
    const targetPitch = attitude.pitch + .6 * Math.atan2(
      Math.sin(anticipatedAttitude.pitch - attitude.pitch),
      Math.cos(anticipatedAttitude.pitch - attitude.pitch),
    );
    const targetRoll = attitude.roll + .6 * Math.atan2(
      Math.sin(anticipatedAttitude.roll - attitude.roll),
      Math.cos(anticipatedAttitude.roll - attitude.roll),
    );
    const previousElevation = hullState.elevation;
    const previousPitch = hullState.pitch;
    hullState = advanceOptionalTowHullFloat(hullState, {
      targetElevation,
      minimumContactElevation,
      predictedContactVelocity,
      targetPitch,
      targetRoll,
      planing: attitude.planing,
      deltaSeconds: rawDelta,
    });
    if (towStarted && progress >= .28) {
      const renderedBowRise = -Math.sin(hullState.pitch)
        * OPTIONAL_TOW_HULL_BOW_REACH;
      const renderedSternRise = Math.sin(hullState.pitch)
        * OPTIONAL_TOW_HULL_STERN_REACH;
      const renderedRightRise = Math.sin(hullState.roll)
        * OPTIONAL_TOW_HULL_HALF_BEAM;
      const renderedLeftRise = -Math.sin(hullState.roll)
        * OPTIONAL_TOW_HULL_HALF_BEAM;
      const highestLocalWaterline = Math.max(
        centerHeight - hullState.elevation,
        bowHeight - hullState.elevation - renderedBowRise,
        sternHeight - hullState.elevation - renderedSternRise,
        leftHeight - hullState.elevation - renderedLeftRise,
        rightHeight - hullState.elevation - renderedRightRise,
      );
      maximumFrameDisplacement = Math.max(
        maximumFrameDisplacement,
        Math.abs(hullState.elevation - previousElevation),
      );
      minimumElevation = Math.min(
        minimumElevation,
        hullState.elevation,
      );
      maximumElevation = Math.max(
        maximumElevation,
        hullState.elevation,
      );
      maximumPitch = Math.max(
        maximumPitch,
        Math.abs(hullState.pitch),
      );
      const pitchFrameStep = Math.abs(
        hullState.pitch - previousPitch,
      );
      maximumPitchFrameStep = Math.max(
        maximumPitchFrameStep,
        pitchFrameStep,
      );
      maximumPitchAngularVelocity = Math.max(
        maximumPitchAngularVelocity,
        pitchFrameStep / Math.max(1e-9, rawDelta),
      );
      const targetError = Math.abs(
        hullState.elevation - targetElevation,
      );
      if (targetError > maximumTargetError) {
        maximumTargetError = targetError;
        maximumTargetErrorSample = {
          elapsed,
          progress,
          craftX: craft.x,
          craftZ: craft.z,
          craftSpeed: craft.speed,
          visualHeading,
          elevation: hullState.elevation,
          targetElevation,
          anticipatedTargetElevation,
          previousTargetElevation,
          previousTargetVelocity,
          minimumContactElevation,
          previousMinimumContactElevation,
          previousMinimumContactVelocity,
          pitch: hullState.pitch,
          targetPitch: attitude.pitch,
          roll: hullState.roll,
          targetRoll: attitude.roll,
          centerHeight,
          bowHeight,
          sternHeight,
          leftHeight,
          rightHeight,
        };
      }
      const contactViolation = minimumContactElevation
        - hullState.elevation;
      if (contactViolation > maximumSupportLag) {
        maximumSupportLag = contactViolation;
        maximumSupportLagSample = {
          elapsed,
          progress,
          rawDelta,
          craftX: craft.x,
          craftZ: craft.z,
          craftSpeed: craft.speed,
          elevation: hullState.elevation,
          verticalVelocity: hullState.verticalVelocity,
          integrationVelocity: hullState.integrationVelocity,
          referenceVelocity: hullState.referenceVelocity,
          targetElevation,
          anticipatedTargetElevation,
          previousTargetElevation,
          minimumContactElevation,
          previousMinimumContactElevation,
          pitch: hullState.pitch,
          targetPitch: attitude.pitch,
          centerHeight,
          bowHeight,
          sternHeight,
          leftHeight,
          rightHeight,
        };
      }
      supportLagDuration = contactViolation > .04
        ? supportLagDuration + rawDelta
        : 0;
      maximumSupportLagDuration = Math.max(
        maximumSupportLagDuration,
        supportLagDuration,
      );
      maximumBelowTarget = Math.max(
        maximumBelowTarget,
        targetElevation - hullState.elevation,
      );
      maximumAboveTarget = Math.max(
        maximumAboveTarget,
        hullState.elevation - targetElevation,
      );
      maximumDraft = Math.max(
        maximumDraft,
        attitude.waterlineHeight - hullState.elevation + .33,
      );
      const freeboard = .17 - highestLocalWaterline;
      submergedDuration = freeboard < -.03
        ? submergedDuration + rawDelta
        : 0;
      maximumSubmergedDuration = Math.max(
        maximumSubmergedDuration,
        submergedDuration,
      );
      if (freeboard < minimumFreeboard) {
        minimumFreeboard = freeboard;
        minimumFreeboardSample = {
          elapsed,
          progress,
          craftX: craft.x,
          craftZ: craft.z,
          craftSpeed: craft.speed,
          visualHeading,
          elevation: hullState.elevation,
          targetElevation,
          displacementOriginY,
          pitch: hullState.pitch,
          targetPitch: attitude.pitch,
          roll: hullState.roll,
          targetRoll: attitude.roll,
          centerHeight,
          bowHeight,
          sternHeight,
          leftHeight,
          rightHeight,
          freeboard,
        };
      }
      maximumVerticalVelocity = Math.max(
        maximumVerticalVelocity,
        Math.abs(hullState.verticalVelocity),
      );
      maximumVelocityConsistencyError = Math.max(
        maximumVelocityConsistencyError,
        Math.abs(
          hullState.verticalVelocity
            - (
              (hullState.referenceVelocity ?? 0)
                + (hullState.integrationVelocity ?? 0)
            )
        ),
      );
      const worldAcceleration = Math.abs(
        hullState.verticalVelocity - previousVerticalVelocity,
      ) / Math.max(1e-9, rawDelta);
      if (worldAcceleration > maximumWorldAcceleration) {
        maximumWorldAcceleration = worldAcceleration;
        maximumWorldAccelerationSample = {
          elapsed,
          progress,
          rawDelta,
          elevation: hullState.elevation,
          previousElevation,
          verticalVelocity: hullState.verticalVelocity,
          previousVerticalVelocity,
          integrationVelocity: hullState.integrationVelocity,
          referenceVelocity: hullState.referenceVelocity,
          targetElevation,
          previousTargetElevation,
          previousTargetVelocity,
          minimumContactElevation,
          previousMinimumContactElevation,
          previousMinimumContactVelocity,
          pitch: hullState.pitch,
          targetPitch: attitude.pitch,
          centerHeight,
          bowHeight,
          sternHeight,
          leftHeight,
          rightHeight,
        };
      }
      if (previousTargetElevation !== null) {
        const targetVelocity = (
          targetElevation - previousTargetElevation
        ) / Math.max(1e-9, rawDelta);
        maximumTargetAcceleration = Math.max(
          maximumTargetAcceleration,
          Math.abs(
            targetVelocity - previousTargetVelocity,
          ) / Math.max(1e-9, rawDelta),
        );
        previousTargetVelocity = targetVelocity;
      }
      if (previousMinimumContactElevation !== null) {
        const minimumContactVelocity = (
          minimumContactElevation
            - previousMinimumContactElevation
        ) / Math.max(1e-9, rawDelta);
        maximumMinimumContactAcceleration = Math.max(
          maximumMinimumContactAcceleration,
          Math.abs(
            minimumContactVelocity
              - previousMinimumContactVelocity,
          ) / Math.max(1e-9, rawDelta),
        );
        previousMinimumContactVelocity =
          minimumContactVelocity;
      }
      previousTargetElevation = targetElevation;
      previousMinimumContactElevation =
        minimumContactElevation;
      if (
        previousSample
        && elapsed - previousSample.elapsed >= .24
      ) {
        maximumQuarterSecondDisplacement = Math.max(
          maximumQuarterSecondDisplacement,
          Math.abs(
            hullState.elevation - previousSample.elevation,
          ),
        );
        maximumQuarterSecondRelativeDisplacement = Math.max(
          maximumQuarterSecondRelativeDisplacement,
          Math.abs(
            (hullState.elevation - targetElevation)
              - previousSample.relativeElevation,
          ),
        );
        previousSample = {
          elapsed,
          elevation: hullState.elevation,
          relativeElevation:
            hullState.elevation - targetElevation,
        };
      } else if (!previousSample) {
        previousSample = {
          elapsed,
          elevation: hullState.elevation,
          relativeElevation:
            hullState.elevation - targetElevation,
        };
      }
    }
    previousVerticalVelocity = hullState.verticalVelocity;
    frame += 1;
  }
  return {
    label,
    progress,
    duration,
    elapsed,
    maximumRawDelta,
    maximumCraftSpeed,
    finalLiveTargetDistance,
    finalCraftTargetDistance,
    maximumFrameDisplacement,
    maximumQuarterSecondDisplacement,
    maximumQuarterSecondRelativeDisplacement,
    maximumTargetError,
    maximumTargetErrorSample,
    maximumSupportLag,
    maximumSupportLagSample,
    maximumSupportLagDuration,
    maximumSubmergedDuration,
    maximumBelowTarget,
    maximumAboveTarget,
    maximumDraft,
    minimumFreeboard,
    minimumFreeboardSample,
    minimumElevation,
    maximumElevation,
    maximumPitch,
    maximumPitchFrameStep,
    maximumPitchAngularVelocity,
    maximumVerticalVelocity,
    maximumWorldAcceleration,
    maximumVelocityConsistencyError,
    maximumWorldAccelerationSample,
    maximumTargetAcceleration,
    maximumMinimumContactAcceleration,
    state: hullState,
  };
};
const movingTowHullSteady = simulateMovingBreakingTowHull({
  label: "steady-60fps",
  rawDeltaAtFrame: () => 1 / 60,
});
const movingTowHullStalled = simulateMovingBreakingTowHull({
  label: "100-250ms-stalls",
  rawDeltaAtFrame: (frame) => {
    if (frame > 0 && frame % 180 === 120) return .25;
    if (frame > 0 && frame % 180 === 60) return .1;
    return 1 / 60;
  },
});
const towHullStepCadences = [
  { label: "30fps", deltas: [1 / 30] },
  { label: "60fps", deltas: [1 / 60] },
  { label: "120fps", deltas: [1 / 120] },
  {
    label: "irregular",
    deltas: [1 / 30, 1 / 120, 1 / 45, 1 / 90, 1 / 60, 1 / 72],
  },
];
const simulateTowHullTargetDiscontinuity = (
  targetStep,
  cadence,
) => {
  let state = advanceOptionalTowHullFloat(
    newTowHullFloatState(),
    {
      targetElevation: 0,
      targetPitch: 0,
      targetRoll: 0,
      planing: 1,
      deltaSeconds: 1 / 60,
    },
  );
  let elapsed = 0;
  let frame = 0;
  let previousFrameVelocity = 0;
  let previousDelta = cadence.deltas[0];
  let firstFrameDisplacement = 0;
  let maximumFrameDisplacement = 0;
  let maximumFrameVelocity = 0;
  let maximumFrameAcceleration = 0;
  let maximumIntegrationAcceleration = 0;
  let maximumVelocityMismatch = 0;
  let maximumOvershoot = 0;
  while (elapsed < 6 - 1e-9) {
    const requestedDelta = cadence.deltas[
      frame % cadence.deltas.length
    ];
    const deltaSeconds = Math.min(
      requestedDelta,
      6 - elapsed,
    );
    if (deltaSeconds < 1e-6) break;
    const previousElevation = state.elevation;
    const previousIntegrationVelocity =
      state.integrationVelocity ?? state.verticalVelocity;
    const next = advanceOptionalTowHullFloat(state, {
      targetElevation: targetStep,
      targetPitch: .12,
      targetRoll: -.1,
      planing: 1,
      deltaSeconds,
    });
    const displacement = next.elevation - previousElevation;
    const frameVelocity = displacement / deltaSeconds;
    const velocitySampleSpacing = (
      previousDelta + deltaSeconds
    ) * .5;
    const frameAcceleration = (
      frameVelocity - previousFrameVelocity
    ) / Math.max(1e-6, velocitySampleSpacing);
    const integrationAcceleration = (
      (next.integrationVelocity ?? next.verticalVelocity)
        - previousIntegrationVelocity
    ) / deltaSeconds;
    if (frame === 0) firstFrameDisplacement = displacement;
    maximumFrameDisplacement = Math.max(
      maximumFrameDisplacement,
      Math.abs(displacement),
    );
    maximumFrameVelocity = Math.max(
      maximumFrameVelocity,
      Math.abs(frameVelocity),
    );
    maximumFrameAcceleration = Math.max(
      maximumFrameAcceleration,
      Math.abs(frameAcceleration),
    );
    maximumIntegrationAcceleration = Math.max(
      maximumIntegrationAcceleration,
      Math.abs(integrationAcceleration),
    );
    maximumVelocityMismatch = Math.max(
      maximumVelocityMismatch,
      Math.abs(frameVelocity - next.verticalVelocity),
    );
    maximumOvershoot = Math.max(
      maximumOvershoot,
      Math.max(0, next.elevation - targetStep),
    );
    previousFrameVelocity = frameVelocity;
    previousDelta = deltaSeconds;
    state = next;
    elapsed += deltaSeconds;
    frame += 1;
  }
  return {
    label: cadence.label,
    targetStep,
    state,
    firstFrameDisplacement,
    maximumFrameDisplacement,
    maximumFrameVelocity,
    maximumFrameAcceleration,
    maximumIntegrationAcceleration,
    maximumVelocityMismatch,
    maximumOvershoot,
    finalError: Math.abs(state.elevation - targetStep),
  };
};
const towHullDiscontinuities = [0.25, 1, 3].flatMap(
  (targetStep) => towHullStepCadences.map(
    (cadence) => simulateTowHullTargetDiscontinuity(
      targetStep,
      cadence,
    ),
  ),
);
const simulateTowHullTargetReversal = (cadence) => {
  let state = advanceOptionalTowHullFloat(
    newTowHullFloatState(),
    {
      targetElevation: 0,
      targetPitch: 0,
      targetRoll: 0,
      planing: 1,
      deltaSeconds: 1 / 60,
    },
  );
  let elapsed = 0;
  let frame = 0;
  while (elapsed < .28 - 1e-9) {
    const deltaSeconds = Math.min(
      cadence.deltas[frame % cadence.deltas.length],
      .28 - elapsed,
    );
    state = advanceOptionalTowHullFloat(state, {
      targetElevation: 1,
      targetPitch: .08,
      targetRoll: -.06,
      planing: 1,
      deltaSeconds,
    });
    elapsed += deltaSeconds;
    frame += 1;
  }

  const reversalTarget = -1;
  const targetDistanceBefore = Math.abs(
    reversalTarget - state.elevation,
  );
  const velocityBefore = state.integrationVelocity ?? 0;
  let reversalElapsed = 0;
  let reversalFrame = 0;
  let firstFrameDisplacement = 0;
  let firstFrameDelta = 0;
  let maximumRelativeAcceleration = 0;
  let maximumSpeedBoundExcess = 0;
  while (reversalElapsed < 3 - 1e-9) {
    const deltaSeconds = Math.min(
      cadence.deltas[frame % cadence.deltas.length],
      3 - reversalElapsed,
    );
    const previousElevation = state.elevation;
    const previousVelocity = state.integrationVelocity ?? 0;
    const next = advanceOptionalTowHullFloat(state, {
      targetElevation: reversalTarget,
      targetPitch: -.08,
      targetRoll: .06,
      planing: 1,
      deltaSeconds,
    });
    const displacement = next.elevation - previousElevation;
    if (reversalFrame === 0) {
      firstFrameDisplacement = displacement;
      firstFrameDelta = deltaSeconds;
    }
    maximumRelativeAcceleration = Math.max(
      maximumRelativeAcceleration,
      Math.abs(
        ((next.integrationVelocity ?? 0) - previousVelocity)
          / deltaSeconds,
      ),
    );
    maximumSpeedBoundExcess = Math.max(
      maximumSpeedBoundExcess,
      Math.abs(displacement)
        - OPTIONAL_TOW_HULL_MAX_VERTICAL_SPEED * deltaSeconds,
    );
    state = next;
    reversalElapsed += deltaSeconds;
    frame += 1;
    reversalFrame += 1;
  }
  return {
    label: cadence.label,
    velocityBefore,
    targetDistanceBefore,
    firstFrameDisplacement,
    firstFrameDelta,
    maximumRelativeAcceleration,
    maximumSpeedBoundExcess,
    finalError: Math.abs(state.elevation - reversalTarget),
  };
};
const towHullReversals = towHullStepCadences.map(
  simulateTowHullTargetReversal,
);
const invalidTowHullFloat = advanceOptionalTowHullFloat(
  newTowHullFloatState(),
  {
    targetElevation: Number.NaN,
    targetPitch: Number.NaN,
    targetRoll: Number.NaN,
    planing: Number.NaN,
    deltaSeconds: Number.NaN,
  },
);
if (
  physicalTowContour.ratioError > .002
  || Math.abs((physicalTowContour.breakingRatio ?? 0) - .9) > .002
  || Math.abs(stagedTowCrest.normalOffset) > 3.500001
  || Math.abs(stagedTowCrest.tangentOffset) > 12.000001
  || Math.abs(stagedTowTangentOffset - 12) > 1e-9
  || Math.hypot(
    stagedTowTangentX - originalTowTangentX,
    stagedTowTangentZ - originalTowTangentZ,
  ) < 20
  || supportedTowFaceQuality < .65
  || flatTowFaceQuality !== 0
  || foamedTowFaceQuality !== 0
  || spentTowFaceQuality >= supportedTowFaceQuality * .2
  || idealTowInterceptQuality <= missedTowInterceptQuality * 2
  || scaledTowTargetScore <= lipTowTargetScore
  || towClampedFromSand !== 6
  || towAlreadyOffshore !== -20
  || towCustomClearance !== 4
  || towBerthClearance !== 11.5
  || OPTIONAL_TOW_BERTH_OFFSHORE !== .5
  || OPTIONAL_TOW_NAVIGABLE_OFFSHORE !== 6
  || OPTIONAL_TOW_LAUNCH_CLEARANCE_PROGRESS !== .16
  || OPTIONAL_TOW_RETURN_BERTH_PROGRESS !== .68
  || launchClearances[0] !== OPTIONAL_TOW_BERTH_OFFSHORE
  || launchClearances.at(-1) !== OPTIONAL_TOW_NAVIGABLE_OFFSHORE
  || returnClearances[0] !== OPTIONAL_TOW_NAVIGABLE_OFFSHORE
  || returnClearances.at(-1) !== OPTIONAL_TOW_BERTH_OFFSHORE
  || launchClearances.some((value, index) => (
    index > 0 && value < launchClearances[index - 1]
  ))
  || returnClearances.some((value, index) => (
    index > 0 && value > returnClearances[index - 1]
  ))
  || maximumClearanceFrameDelta(launchClearances) > .07
  || maximumClearanceFrameDelta(returnClearances) > .07
  || towBerthSurvey.length !== 41
  || towBerthSurvey.some((survey) => survey.centerDepth < .3)
  || towBerthSurvey.some((survey) => survey.shoreCollapse <= .99)
  || towBerthSurvey.some((survey) => (
    survey.interactionDistance >= 4.8
  ))
  || mavericksLegacyTowBerth.waterlineExcursion <= 3
  || mavericksTowBerth.waterlineExcursion >= .65
  || mavericksTowBerth.maximumProbeRange >= .65
  || mavericksTowBerth.maximumPitch >= .01
  || hossegorTowBerth.waterlineExcursion >= .65
  || hossegorTowBerth.maximumProbeRange >= .65
  || hossegorTowBerth.maximumPitch >= .01
  || uluwatuTowBerth.waterlineExcursion >= .65
  || uluwatuTowBerth.maximumProbeRange >= .65
  || uluwatuTowBerth.maximumPitch >= .01
  || OPTIONAL_TOW_HULL_BOW_REACH !== 2.08
  || OPTIONAL_TOW_HULL_STERN_REACH !== 1.76
  || OPTIONAL_TOW_HULL_HALF_LENGTH !== 1.92
  || OPTIONAL_TOW_HULL_HALF_BEAM !== .8
  || levelTowHull.waterlineHeight !== 1
  || levelTowHull.pitch !== 0
  || levelTowHull.roll !== 0
  || climbingTowHull.pitch >= -.2
  || climbingTowHull.pitch < -.500001
  || bankedTowHull.roll <= .16
  || bankedTowHull.roll > .180001
  || convexTowHull.waterlineHeight < 1.16
  || convexTowHull.waterlineHeight > 1.18
  || convexTowHull.planing !== 1
  || !Object.values(invalidTowHull).every(Number.isFinite)
  || towHullStep30.maximumStep > .13
  || towHullStep60.maximumStep > .065
  || towHullStep120.maximumStep > .033
  || towHullStep30.maximumElevation > 1.31
  || towHullStep60.maximumElevation > 1.31
  || towHullStep120.maximumElevation > 1.31
  || towHullStep30.state.elevation < 1.08
  || towHullStep60.state.elevation < 1.08
  || towHullStep120.state.elevation < 1.08
  || towHullStep30.maximumRelativeVelocity > 3.200001
  || towHullStep60.maximumRelativeVelocity > 3.200001
  || towHullStep120.maximumRelativeVelocity > 3.200001
  || towHullStep30.maximumTargetError > .49
  || towHullStep60.maximumTargetError > .49
  || towHullStep120.maximumTargetError > .49
  || towHullStep30.maximumWorldAcceleration > 11.51
  || towHullStep60.maximumWorldAcceleration > 11.51
  || towHullStep120.maximumWorldAcceleration > 11.51
  || Math.abs(
    towHullStep30.state.elevation
      - towHullStep120.state.elevation,
  ) > .012
  || towHullChop30.amplitude < .025
  || towHullChop60.amplitude < .025
  || towHullChop120.amplitude < .025
  || towHullChop30.amplitude > .05
  || towHullChop60.amplitude > .05
  || towHullChop120.amplitude > .05
  || towHullChop30.maximumWorldAcceleration > 11.51
  || towHullChop60.maximumWorldAcceleration > 11.51
  || towHullChop120.maximumWorldAcceleration > 11.51
  || towHullChop30.maximumReferenceAcceleration > 6.200001
  || towHullChop60.maximumReferenceAcceleration > 6.200001
  || towHullChop120.maximumReferenceAcceleration > 6.200001
  || Math.abs(
    towHullChop30.amplitude - towHullChop120.amplitude,
  ) > .005
  || towHullFastChop.amplitude > .015
  || towHullFastChop.maximumWorldAcceleration > 11.51
  || towHullSwell.amplitude < .49
  || towHullSwell.amplitude > .51
  || towHullSwell.maximumTargetError > .005
  || towHullSwell.maximumWorldAcceleration > .5
  || breakingTowHull.maximumFrameDisplacement > .054
  || breakingTowHull.maximumTargetError > .5
  || breakingTowHull.minimumFreeboard < -.07
  || breakingTowHull.maximumPitch > .51
  || movingTowHullSteady.maximumRawDelta !== 1 / 60
  || movingTowHullSteady.maximumFrameDisplacement > .065
  || movingTowHullSteady
    .maximumQuarterSecondRelativeDisplacement > .06
  || movingTowHullSteady.maximumTargetError > .08
  || movingTowHullSteady.maximumSupportLag > .04
  || movingTowHullSteady.maximumSupportLagDuration > .05
  || movingTowHullSteady.maximumSubmergedDuration > .05
  || movingTowHullSteady.maximumBelowTarget > .04
  || movingTowHullSteady.maximumAboveTarget > .08
  || movingTowHullSteady.maximumDraft > .2
  || movingTowHullSteady.minimumFreeboard < -.03
  || movingTowHullSteady.maximumVerticalVelocity > 4.5
  || movingTowHullSteady.maximumWorldAcceleration > 24.000001
  || movingTowHullSteady.maximumVelocityConsistencyError > 1e-9
  || movingTowHullSteady.maximumCraftSpeed > 13.3
  || movingTowHullSteady.finalLiveTargetDistance > 4
  || movingTowHullSteady.finalCraftTargetDistance > 4.1
  || movingTowHullSteady.maximumPitch > .51
  || movingTowHullSteady.maximumPitchFrameStep > .03
  || movingTowHullSteady.maximumPitchAngularVelocity > 1.6
  || movingTowHullStalled.maximumRawDelta !== .25
  || movingTowHullStalled.maximumFrameDisplacement > .140001
  || movingTowHullStalled
    .maximumQuarterSecondRelativeDisplacement > .06
  || movingTowHullStalled.maximumTargetError > .08
  || movingTowHullStalled.maximumSupportLag > .04
  || movingTowHullStalled.maximumSupportLagDuration > .05
  || movingTowHullStalled.maximumSubmergedDuration > .05
  || movingTowHullStalled.maximumBelowTarget > .04
  || movingTowHullStalled.maximumAboveTarget > .08
  || movingTowHullStalled.maximumDraft > .2
  || movingTowHullStalled.minimumFreeboard < -.03
  || movingTowHullStalled.maximumVerticalVelocity > 4.5
  || movingTowHullStalled.maximumWorldAcceleration > 24.000001
  || movingTowHullStalled.maximumVelocityConsistencyError > 1e-9
  || movingTowHullStalled.maximumCraftSpeed > 13.3
  || movingTowHullStalled.finalLiveTargetDistance > 4
  || movingTowHullStalled.finalCraftTargetDistance > 4.1
  || movingTowHullStalled.maximumPitch > .51
  || movingTowHullStalled.maximumPitchFrameStep > .06
  || movingTowHullStalled.maximumPitchAngularVelocity > 1.65
  || towHullDiscontinuities.some((response) => (
    Math.abs(response.firstFrameDisplacement) > .008
      || response.maximumFrameDisplacement > .107
      || response.maximumFrameVelocity
        > OPTIONAL_TOW_HULL_MAX_VERTICAL_SPEED + 1e-9
      || response.maximumFrameAcceleration
        > OPTIONAL_TOW_HULL_MAX_VERTICAL_ACCELERATION + .15
      || response.maximumIntegrationAcceleration
        > OPTIONAL_TOW_HULL_MAX_VERTICAL_ACCELERATION + 1e-6
      || response.maximumVelocityMismatch > 1e-10
      || response.maximumOvershoot > .025
      || response.finalError > .002
  ))
  || towHullReversals.some((response) => (
    response.velocityBefore < 1
      || Math.abs(response.firstFrameDisplacement)
        > OPTIONAL_TOW_HULL_MAX_VERTICAL_SPEED
          * response.firstFrameDelta + 1e-9
      || Math.abs(response.firstFrameDisplacement)
        >= response.targetDistanceBefore * .1
      || response.maximumRelativeAcceleration
        > OPTIONAL_TOW_HULL_MAX_VERTICAL_ACCELERATION + 1e-6
      || response.maximumSpeedBoundExcess > 1e-9
      || response.finalError > .002
  ))
  || !Object.values(invalidTowHullFloat).every((value) => (
    typeof value === "boolean" || Number.isFinite(value)
  ))
  || !optionalTowReleasePhysicallySupported(
    true,
    .64,
    idealTowInterceptQuality,
    .9,
    supportedTowFaceQuality,
  )
  || !optionalTowReleasePhysicallySupported(true, .64, .1, .9, 1)
  || optionalTowReleasePhysicallySupported(true, .64, .09, .9, 1)
  || optionalTowReleasePhysicallySupported(true, .5, .9, .9, 1)
  || optionalTowReleasePhysicallySupported(true, .64, .9, .9, 0)
  || optionalTowReleasePhysicallySupported(true, .64, .9, .4, 1)
  || optionalTowReleasePhysicallySupported(true, .64, .9, 2, 1)
  || optionalTowReleasePhysicallySupported(false, .64, .9, .9, 1)
) {
  throw new Error(
    `Tow targeting or flotation contract failed: ${JSON.stringify({
      climbingPitch: climbingTowHull.pitch,
      bankedRoll: bankedTowHull.roll,
      convexWaterline: convexTowHull.waterlineHeight,
      launchClearances: {
        first: launchClearances[0],
        last: launchClearances.at(-1),
        maximumStep: maximumClearanceFrameDelta(
          launchClearances,
        ),
      },
      returnClearances: {
        first: returnClearances[0],
        last: returnClearances.at(-1),
        maximumStep: maximumClearanceFrameDelta(
          returnClearances,
        ),
      },
      berthSurvey: {
        count: towBerthSurvey.length,
        minimumDepth: Math.min(
          ...towBerthSurvey.map((survey) => survey.centerDepth),
        ),
        minimumCollapse: Math.min(
          ...towBerthSurvey.map((survey) => survey.shoreCollapse),
        ),
        maximumInteractionDistance: Math.max(
          ...towBerthSurvey.map(
            (survey) => survey.interactionDistance,
          ),
        ),
      },
      mavericksLegacyTowBerth,
      mavericksTowBerth,
      hossegorTowBerth,
      uluwatuTowBerth,
      step30: towHullStep30,
      step60: towHullStep60,
      step120: towHullStep120,
      chop30: towHullChop30,
      chop60: towHullChop60,
      chop120: towHullChop120,
      fastChop: towHullFastChop,
      swell: towHullSwell,
      breakingTowHull,
      movingTowHullSteady,
      movingTowHullStalled,
      discontinuities: towHullDiscontinuities,
      reversals: towHullReversals,
      invalidTowHullFloat,
    })}`,
  );
}

const landwardForecastTransport = primaryWaveVelocityAt(
  -8,
  physicalTowContour.z,
  12,
  {
    ...settings,
    waveDirection: 70,
    swellDirection: 70,
    coastHeading: 322,
  },
  {
    ...character,
    kind: "reef",
    coastId: "pipeline",
    zoneName: "First Reef",
  },
);
if (
  landwardForecastTransport.z <= .05
  || landwardForecastTransport.propagationZ <= .05
) {
  throw new Error(
    "A forecast bearing behind the local coast regained offshore/backwards surf propagation",
  );
}

let towCraft = {
  x: 10,
  z: 4,
  velocityX: 0,
  velocityZ: 0,
  heading: Math.PI,
};
let towSurfer = {
  x: 10,
  z: 7,
  velocityX: 0,
  velocityZ: 0,
};
let maximumTowSpeed = 0;
let maximumTowAcceleration = 0;
let maximumRopeDistance = 0;
let maximumSurferVelocityStep = 0;
for (let frame = 0; frame < 16 * 60; frame += 1) {
  const progress = frame / (16 * 60 - 1);
  const desiredX = 10 + Math.sin(progress * Math.PI) * 24;
  const desiredZ = 4 - progress * 112;
  const nextCraft = advanceOptionalTowCraft(
    towCraft,
    desiredX,
    desiredZ,
    1 / 60,
    10.5 + progress * 4,
  );
  const priorSurferVelocityX = towSurfer.velocityX;
  const priorSurferVelocityZ = towSurfer.velocityZ;
  const nextSurfer = advanceOptionalTowRope(
    towSurfer,
    nextCraft,
    1 / 60,
    7,
  );
  maximumTowSpeed = Math.max(maximumTowSpeed, nextCraft.speed);
  maximumTowAcceleration = Math.max(
    maximumTowAcceleration,
    nextCraft.acceleration,
  );
  maximumRopeDistance = Math.max(
    maximumRopeDistance,
    nextSurfer.ropeDistance,
  );
  maximumSurferVelocityStep = Math.max(
    maximumSurferVelocityStep,
    Math.hypot(
      nextSurfer.velocityX - priorSurferVelocityX,
      nextSurfer.velocityZ - priorSurferVelocityZ,
    ),
  );
  towCraft = nextCraft;
  towSurfer = nextSurfer;
}
if (
  maximumTowSpeed > 14.51
  || maximumTowAcceleration > 6.21
  || maximumRopeDistance > 7.801
  || maximumSurferVelocityStep > .8
) {
  throw new Error(
    "Tow craft or rope motion regained a speed cap snap, stretch teleport, or frame impulse",
  );
}

let returningTowCraft = {
  x: 34,
  z: -82,
  velocityX: 8,
  velocityZ: 4,
  heading: Math.atan2(8, 4),
};
const returningTowStart = {
  x: returningTowCraft.x,
  z: returningTowCraft.z,
};
const returningTowHome = { x: 10, z: 6 };
let returningTowProgress = 0;
let maximumReturnSpeed = 0;
let maximumReturnAcceleration = 0;
let maximumReturnStep = 0;
for (let frame = 0; frame < 20 * 60; frame += 1) {
  returningTowProgress = Math.min(
    1,
    returningTowProgress + (1 / 60) / 8.5,
  );
  const progress = returningTowProgress * returningTowProgress
    * (3 - 2 * returningTowProgress);
  const inverse = 1 - progress;
  const controlX = (
    returningTowStart.x + returningTowHome.x
  ) * .5 - 18;
  const controlZ = Math.min(
    returningTowStart.z,
    returningTowHome.z,
  ) - 20;
  const desiredX = inverse * inverse * returningTowStart.x
    + 2 * inverse * progress * controlX
    + progress * progress * returningTowHome.x;
  const desiredZ = inverse * inverse * returningTowStart.z
    + 2 * inverse * progress * controlZ
    + progress * progress * returningTowHome.z;
  const homeDistanceBeforeStep = Math.hypot(
    returningTowCraft.x - returningTowHome.x,
    returningTowCraft.z - returningTowHome.z,
  );
  const returnSpeedLimit = Math.max(
    .35,
    Math.min(
      13.5,
      Math.sqrt(2 * 5.6 * homeDistanceBeforeStep) * .82,
    ),
  );
  const nextReturn = advanceOptionalTowCraft(
    returningTowCraft,
    desiredX,
    desiredZ,
    1 / 60,
    returnSpeedLimit,
    5.6,
  );
  maximumReturnSpeed = Math.max(
    maximumReturnSpeed,
    nextReturn.speed,
  );
  maximumReturnAcceleration = Math.max(
    maximumReturnAcceleration,
    nextReturn.acceleration,
  );
  maximumReturnStep = Math.max(
    maximumReturnStep,
    Math.hypot(
      nextReturn.x - returningTowCraft.x,
      nextReturn.z - returningTowCraft.z,
    ),
  );
  returningTowCraft = nextReturn;
}
const returningTowHomeError = Math.hypot(
  returningTowCraft.x - returningTowHome.x,
  returningTowCraft.z - returningTowHome.z,
);
if (
  maximumReturnSpeed > 13.51
  || maximumReturnAcceleration > 5.61
  || maximumReturnStep > .226
  || returningTowHomeError > .55
  || returningTowCraft.speed > .8
) {
  throw new Error(
    `Tow return no longer converges through the capped craft integrator: ${JSON.stringify({
      maximumReturnSpeed,
      maximumReturnAcceleration,
      maximumReturnStep,
      returningTowHomeError,
      finalSpeed: returningTowCraft.speed,
    })}`,
  );
}

let orbitalReversed = false;
let minimumPropagationAlignment = 1;
let minimumBoardHeadingAlignment = 1;
const referenceTowTransport = primaryWaveVelocityAt(
  8,
  physicalTowContour.z,
  0,
  settings,
  character,
);
const referenceTowNormalX = referenceTowTransport.x
  / referenceTowTransport.speed;
const referenceTowNormalZ = referenceTowTransport.z
  / referenceTowTransport.speed;
const referenceTowHeading = Math.atan2(
  referenceTowNormalX,
  referenceTowNormalZ,
);
for (let index = 0; index < 80; index += 1) {
  const elapsed = index * settings.wavePeriod / 80;
  const transport = primaryWaveVelocityAt(
    8,
    physicalTowContour.z,
    elapsed,
    settings,
    character,
  );
  const propagationAlignment = (
    transport.x * referenceTowNormalX
      + transport.z * referenceTowNormalZ
  ) / Math.max(.001, transport.speed);
  minimumPropagationAlignment = Math.min(
    minimumPropagationAlignment,
    propagationAlignment,
  );
  if (
    transport.waterX * referenceTowNormalX
      + transport.waterZ * referenceTowNormalZ < -.02
  ) {
    orbitalReversed = true;
  }
  const boardReading = evaluateBoardWaterInteraction({
    boardHeading: referenceTowHeading,
    velocityX: referenceTowNormalX * 2,
    velocityZ: referenceTowNormalZ * 2,
    waveVelocityX: transport.x,
    waveVelocityZ: transport.z,
    slopeX: -referenceTowNormalX * .16,
    slopeZ: -referenceTowNormalZ * .16,
    surfaceRise: .35,
    surfaceLift: .6,
    crestDistance: 3,
    crestEnergy: .8,
    crestSurfable: true,
    boardStability: 1,
    waveHeight: 2,
  });
  minimumBoardHeadingAlignment = Math.min(
    minimumBoardHeadingAlignment,
    boardReading.headingAlignment,
  );
}
if (
  !orbitalReversed
  || minimumPropagationAlignment < .995
  || minimumBoardHeadingAlignment < .995
) {
  throw new Error(
    "Crest propagation and reversing orbital flow became conflated, allowing a backward capture frame",
  );
}

const centerBreakCoordinate = waveBreakingCoordinateAt(
  0,
  -18,
  12,
  settings,
  character,
);
const nominalRideableFaceLength =
  RIDE_RESULT_LINE_Z
    - (-18 - BREAK_OFFSHORE_OFFSET);
if (
  BREAK_OFFSHORE_OFFSET < 20
  || nominalRideableFaceLength < 38
) {
  throw new Error(
    "Baseline break geometry no longer leaves a full offshore face for the ride",
  );
}
const peelingBreakCoordinate = waveBreakingCoordinateAt(
  80,
  -18,
  12,
  settings,
  character,
);
const peelingBreakGeometry = waveBreakingGeometryAt(
  80,
  -18,
  12,
  settings,
  character,
);
const peelingBreakCoordinateLeft = waveBreakingCoordinateAt(
  79.99,
  -18,
  12,
  settings,
  character,
);
const peelingBreakCoordinateRight = waveBreakingCoordinateAt(
  80.01,
  -18,
  12,
  settings,
  character,
);
const outsideProbeDistance = 5;
const outsideProbeCoordinate = waveBreakingCoordinateAt(
  80
    + peelingBreakGeometry.outsideDirectionX
      * outsideProbeDistance,
  -18
    + peelingBreakGeometry.outsideDirectionZ
      * outsideProbeDistance,
  12,
  settings,
  character,
);
const breakNormalMagnitude = Math.hypot(
  peelingBreakGeometry.outsideDirectionX,
  peelingBreakGeometry.outsideDirectionZ,
);
const geometricCurrentTarget = resolvePaddleHeadingTarget({
  boardHeading: Math.PI,
  desiredDirectionX:
    peelingBreakGeometry.outsideDirectionX,
  desiredDirectionZ:
    peelingBreakGeometry.outsideDirectionZ,
  desiredGroundSpeed: 2.35,
  currentVelocityX: .45,
  currentVelocityZ: .08,
});
const geometricGroundVelocityX =
  geometricCurrentTarget.targetDirectionX * 2.35
    + .45;
const geometricGroundVelocityZ =
  geometricCurrentTarget.targetDirectionZ * 2.35
    + .08;
const geometricGroundMagnitude = Math.hypot(
  geometricGroundVelocityX,
  geometricGroundVelocityZ,
);
const geometricGroundAlignment = (
  geometricGroundVelocityX
    * peelingBreakGeometry.outsideDirectionX
  + geometricGroundVelocityZ
    * peelingBreakGeometry.outsideDirectionZ
) / geometricGroundMagnitude;
const enteredLineup = resolveLineupFromBreakingGeometry(
  -20.1,
  false,
);
const heldLineup = resolveLineupFromBreakingGeometry(
  -16,
  true,
);
const exitedLineup = resolveLineupFromBreakingGeometry(
  -15.4,
  true,
);
const prematureLineup = resolveLineupFromBreakingGeometry(
  -19,
  false,
);
const shorebreakLoadSample = {
  crestEnergy: .8,
  waveHeight: 2,
  tidePower: 1,
  shorebreakScale: 1,
};
const outsideShorebreakLoad = resolveShorebreakBandLoad({
  ...shorebreakLoadSample,
  breakingCoordinate: -26,
});
const heldLineupShorebreakLoad = resolveShorebreakBandLoad({
  ...shorebreakLoadSample,
  breakingCoordinate: -20,
});
const outerBoundaryLoad = resolveShorebreakBandLoad({
  ...shorebreakLoadSample,
  breakingCoordinate: -18.01,
});
const innerBoundaryLoad = resolveShorebreakBandLoad({
  ...shorebreakLoadSample,
  breakingCoordinate: -17.99,
});
const peakShorebreakLoad = resolveShorebreakBandLoad({
  ...shorebreakLoadSample,
  breakingCoordinate: -12,
});
const shorewardShorebreakLoad = resolveShorebreakBandLoad({
  ...shorebreakLoadSample,
  breakingCoordinate: -3,
});
const lullOuterShorebreakLoad = resolveShorebreakBandLoad({
  ...shorebreakLoadSample,
  crestEnergy: .2,
  breakingCoordinate: -20,
});
const setOuterShorebreakLoad = resolveShorebreakBandLoad({
  ...shorebreakLoadSample,
  crestEnergy: .86,
  breakingCoordinate: -20,
});
if (
  // The old 1.5-unit threshold was satisfied by the now-removed 12 m wave
  // profile snap. Require a genuine alongshore peel while also proving that
  // centimeter-scale motion cannot jump between different wave fields.
  Math.abs(peelingBreakCoordinate - centerBreakCoordinate) < .25
  || Math.abs(
    peelingBreakCoordinateRight - peelingBreakCoordinateLeft,
  ) > .012
  || Math.abs(breakNormalMagnitude - 1) > .000001
  || outsideProbeCoordinate
    >= peelingBreakGeometry.breakingCoordinate - 3.6
  || geometricGroundAlignment < .995
  || !enteredLineup.outsideBreak
  || !heldLineup.outsideBreak
  || exitedLineup.outsideBreak
  || prematureLineup.outsideBreak
  || enteredLineup.outsideMargin <= 2
  || outsideShorebreakLoad.power !== 0
  || heldLineupShorebreakLoad.power <= .04
  || peakShorebreakLoad.power <= .65
  || shorewardShorebreakLoad.power !== 0
  || lullOuterShorebreakLoad.power !== 0
  || setOuterShorebreakLoad.power <= .08
  || waveBreakOffsetForEnergy(.86, 2)
    <= waveBreakOffsetForEnergy(.2, 2) + 3
  || Math.abs(
    outerBoundaryLoad.power - innerBoundaryLoad.power,
  ) > .004
) {
  throw new Error(
    "Animated breaking-band geometry no longer separates continuous wall load "
      + `from lineup coaching state: ${JSON.stringify({
        centerBreakCoordinate,
        peelingBreakCoordinate,
        peelingBreakCoordinateLeft,
        peelingBreakCoordinateRight,
        outsideProbeCoordinate,
        breakNormalMagnitude,
        geometricGroundAlignment,
        enteredLineup,
        heldLineup,
        exitedLineup,
        prematureLineup,
        outsideShorebreakLoad,
        heldLineupShorebreakLoad,
        outerBoundaryLoad,
        innerBoundaryLoad,
        peakShorebreakLoad,
        shorewardShorebreakLoad,
        lullOuterShorebreakLoad,
        setOuterShorebreakLoad,
      })}`,
  );
}
const setCycle = Array.from(
  { length: 96 },
  (_, index) => waveSetState(index * 9, 9),
);
let longestSurfableRun = 0;
let longestLull = 0;
let surfableRun = 0;
let lullRun = 0;
for (const crest of setCycle) {
  surfableRun = crest.crestSurfable
    ? surfableRun + 1
    : 0;
  lullRun = crest.crestSurfable
    ? 0
    : lullRun + 1;
  longestSurfableRun = Math.max(
    longestSurfableRun,
    surfableRun,
  );
  longestLull = Math.max(longestLull, lullRun);
}
const firstHalf = setCycle
  .slice(0, 48)
  .map((crest) => crest.crestEnergy.toFixed(4))
  .join(",");
const secondHalf = setCycle
  .slice(48)
  .map((crest) => crest.crestEnergy.toFixed(4))
  .join(",");
const surfableCount = setCycle.filter(
  (crest) => crest.crestSurfable,
).length;
if (
  setCycle[0].crestSequenceLength !== 0
  || surfableCount < 8
  || surfableCount > 60
  || longestSurfableRun < 3
  || longestSurfableRun > 8
  || longestLull < 3
  || longestLull > 8
  || firstHalf === secondHalf
  || Math.max(...setCycle.map((crest) => crest.crestEnergy)) < .5
) {
  throw new Error(
    "Spectral interference no longer produces non-repeating wave groups and natural lulls",
  );
}

const x = 0;
const z = -34;

if (
  SURF_ASSIST_PROFILES.guided.surfTurnAuthority
    <= SURF_ASSIST_PROFILES.natural.surfTurnAuthority
  || SURF_ASSIST_PROFILES.natural.surfTurnAuthority
    <= SURF_ASSIST_PROFILES.raw.surfTurnAuthority
  || SURF_ASSIST_PROFILES.guided.automaticCounterweight
    <= SURF_ASSIST_PROFILES.natural.automaticCounterweight
  || SURF_ASSIST_PROFILES.natural.automaticCounterweight
    <= SURF_ASSIST_PROFILES.raw.automaticCounterweight
  || SURF_ASSIST_PROFILES.guided.ridingStabilityScale
    <= SURF_ASSIST_PROFILES.natural.ridingStabilityScale
  || SURF_ASSIST_PROFILES.natural.ridingStabilityScale
    <= SURF_ASSIST_PROFILES.raw.ridingStabilityScale
  || SURF_ASSIST_PROFILES.raw.surfTurnAuthority !== 1
  || SURF_ASSIST_PROFILES.raw.automaticCounterweight !== 0
  || SURF_ASSIST_PROFILES.raw.ridingStabilityScale !== 1
) {
  throw new Error(
    "Surf assists no longer progress from forgiving Guided through Natural to unmodified Raw",
  );
}

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
  || SHALLOW_DISMOUNT_Z - RIDE_RESULT_LINE_Z > 1.5
  || RIDE_RESULT_LINE_Z < 6.8
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
    waveSupport: 1,
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
    waveSupport: 1,
  });
}
if (shoulderCapture.ahead < .86) {
  throw new Error(`A board beyond the power failed to lose the wave: ${shoulderCapture.ahead.toFixed(2)}`);
}

const popUpCrestState = {
  overtaken: .34,
  ahead: .08,
};
const preservedPopUpCrest = advanceRideCaptureState(
  popUpCrestState,
  {
    deltaSeconds: 1 / 60,
    crestPhaseError: -.38,
    normalSpeed: 4.2,
    waveSpeed: 6,
    facePhaseSpan: .9,
    gravityPlaning: .18,
    waveSupport: 1,
  },
);
const resetPopUpCrest = advanceRideCaptureState(
  { overtaken: 0, ahead: 0 },
  {
    deltaSeconds: 1 / 60,
    crestPhaseError: -.38,
    normalSpeed: 4.2,
    waveSpeed: 6,
    facePhaseSpan: .9,
    gravityPlaning: .18,
    waveSupport: 1,
  },
);
const trackedCrestCue = readCrestTimingMechanics(.05, .08);
const overtakenCrestCue =
  readCrestTimingMechanics(.46, .18);
const aheadCrestCue = readCrestTimingMechanics(.14, .57);
if (
  preservedPopUpCrest.overtaken
    - resetPopUpCrest.overtaken < .33
  || preservedPopUpCrest.overtaken
    <= popUpCrestState.overtaken
  || trackedCrestCue.state !== "tracking"
  || overtakenCrestCue.state !== "overtaken"
  || overtakenCrestCue.percent !== 46
  || aheadCrestCue.state !== "ahead"
  || aheadCrestCue.percent !== 57
) {
  throw new Error("Pop-up handoff or its physical crest-timing guide lost continuous state");
}

let unsupportedCrestRelation = { overtaken: .9, ahead: .8 };
for (let frame = 0; frame < 180; frame += 1) {
  unsupportedCrestRelation = advanceRideCaptureState(
    unsupportedCrestRelation,
    {
      deltaSeconds: 1 / 60,
      crestPhaseError: -.38,
      normalSpeed: 0,
      waveSpeed: 6,
      facePhaseSpan: .9,
      gravityPlaning: 0,
      waveSupport: 0,
    },
  );
}
if (
  unsupportedCrestRelation.lipOvertake !== 0
  || unsupportedCrestRelation.overtaken > .01
  || unsupportedCrestRelation.ahead > .01
) {
  throw new Error("Unsupported crest geometry created lip or shoulder forces in quiet water");
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
  const surfaceRise = frame.surfaceRise;
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

function supportedFaceSpans(alignment, paddleDrive, mode, sampleZ = z) {
  const step = .05;
  const windows = [];
  let start = null;
  let quality = [];
  for (let time = settings.wavePeriod; time <= settings.wavePeriod * 17; time += step) {
    const reading = readingAt(time, alignment, paddleDrive, mode, sampleZ);
    if (reading.surfable && reading.opportunity > .13) {
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

function verifyFaceSpans(label, spans, minimumMedian) {
  if (spans.length < 12) {
    throw new Error(`${label}: expected repeated surfable faces, found ${spans.length}`);
  }
  const medianDuration = median(spans.map((span) => span.duration));
  if (medianDuration < minimumMedian) {
    throw new Error(`${label}: median supported-face span ${medianDuration.toFixed(2)}s is too short`);
  }
  return {
    count: spans.length,
    medianDuration,
    averageQuality: spans.reduce((total, span) => total + span.quality, 0) / spans.length,
  };
}

const idealTraining = verifyFaceSpans(
  "ideal training takeoff",
  supportedFaceSpans(1, .85, "training"),
  1.55,
);
const marginalTraining = verifyFaceSpans(
  "marginal training takeoff",
  supportedFaceSpans(.35, .15, "training"),
  1.15,
);
const idealAdvanced = verifyFaceSpans(
  "ideal advanced takeoff",
  supportedFaceSpans(1, .85, "advanced"),
  1.55,
);
const marginalAdvanced = verifyFaceSpans(
  "marginal advanced takeoff",
  supportedFaceSpans(.35, .15, "advanced"),
  1.15,
);
const insideReform = verifyFaceSpans(
  "inside reform takeoff",
  supportedFaceSpans(.55, .35, "training", -20),
  1.1,
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
if (
  earlyFace.opportunity <= .13
  || pocketFace.opportunity <= .13
  || lateFace.opportunity <= .13
) {
  throw new Error("The rising face no longer carries continuous opportunity across early, pocket, and late positions");
}
if (pocketFace.quality <= earlyFace.quality || pocketFace.quality <= lateFace.quality) {
  throw new Error("Better face placement should improve takeoff quality without gating other entries");
}
const supportedTakeoffOpportunity =
  resolveBoardTakeoffOpportunity({
    waveOpportunity: pocketFace.opportunity,
    waterContact: 1,
    capsizeRisk: 0,
    pitchOverRisk: 0,
  });
const halfContactTakeoffOpportunity =
  resolveBoardTakeoffOpportunity({
    waveOpportunity: pocketFace.opportunity,
    waterContact: .5,
    capsizeRisk: 0,
    pitchOverRisk: 0,
  });
const unstableTakeoffOpportunity =
  resolveBoardTakeoffOpportunity({
    waveOpportunity: pocketFace.opportunity,
    waterContact: 1,
    capsizeRisk: .75,
    pitchOverRisk: .2,
  });
const dryTakeoffOpportunity =
  resolveBoardTakeoffOpportunity({
    waveOpportunity: pocketFace.opportunity,
    waterContact: 0,
    capsizeRisk: 0,
    pitchOverRisk: 0,
  });
if (
  Math.abs(
    supportedTakeoffOpportunity - pocketFace.opportunity,
  ) > .000001
  || Math.abs(
    halfContactTakeoffOpportunity
      - supportedTakeoffOpportunity * .5,
  ) > .000001
  || Math.abs(
    unstableTakeoffOpportunity
      - supportedTakeoffOpportunity * .25,
  ) > .000001
  || dryTakeoffOpportunity !== 0
) {
  throw new Error("Live takeoff opportunity no longer follows continuous hull support and attitude stability");
}
const idleTakeoffDrive = resolveTakeoffPaddleDrive({
  normalSpeed: 0,
  matchTargetSpeed: 2,
  strokeForce: 0,
  attitudeQuality: 1,
  waterContact: 1,
});
const plantedHandTakeoffDrive =
  resolveTakeoffPaddleDrive({
    normalSpeed: 0,
    matchTargetSpeed: 2,
    strokeForce: 6.9,
    attitudeQuality: 1,
    waterContact: 1,
  });
const coastingTakeoffDrive =
  resolveTakeoffPaddleDrive({
    normalSpeed: 2,
    matchTargetSpeed: 2,
    strokeForce: 0,
    attitudeQuality: 1,
    waterContact: 1,
  });
const halfContactTakeoffDrive =
  resolveTakeoffPaddleDrive({
    normalSpeed: 2,
    matchTargetSpeed: 2,
    strokeForce: 0,
    attitudeQuality: 1,
    waterContact: .5,
  });
const slowTakeoffSpeedMatch =
  resolveTakeoffSpeedMatch(.48, 2);
const halfwayTakeoffSpeedMatch =
  resolveTakeoffSpeedMatch(1.24, 2);
const matchedTakeoffSpeedMatch =
  resolveTakeoffSpeedMatch(2, 2);
if (
  idleTakeoffDrive !== 0
  || plantedHandTakeoffDrive <= idleTakeoffDrive
  || coastingTakeoffDrive
    <= plantedHandTakeoffDrive * 4
  || halfContactTakeoffDrive
    >= coastingTakeoffDrive * .72
  || slowTakeoffSpeedMatch !== 0
  || Math.abs(halfwayTakeoffSpeedMatch - .5) > .000001
  || matchedTakeoffSpeedMatch !== 1
) {
  throw new Error("Takeoff paddle drive no longer comes from carried board speed and resolved hand force");
}

const visiblyStandingWeakCrest = evaluateWaveTakeoff({
  ...sharedSample,
  crestDistance: 3,
  crestEnergy: .2,
  crestSurfable: false,
});
if (
  !visiblyStandingWeakCrest.surfable
  || visiblyStandingWeakCrest.opportunity <= .13
) {
  throw new Error("A visibly standing lower-energy crest should retain physical takeoff opportunity");
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
if (flatWater.surfable || flatWater.opportunity !== 0) {
  throw new Error("Flat water must not produce physical takeoff opportunity");
}

const strictPopUpSupport = resolvePopUpLandingSupport({
  lostCrest: false,
  boardStillEngaged: true,
  interactionOutcome: "capture",
  waterContact: .86,
  rollCapsizeRisk: .18,
  pitchOverRisk: .16,
  crestOvertaken: .22,
  surfableFace: true,
  faceEnvelope: .5,
  physicalLift: .62,
  waveContact: .74,
});
const readableFaceGrace = resolvePopUpLandingSupport({
  lostCrest: false,
  boardStillEngaged: false,
  interactionOutcome: "glide",
  waterContact: .58,
  rollCapsizeRisk: .34,
  pitchOverRisk: .32,
  crestOvertaken: .62,
  surfableFace: true,
  faceEnvelope: .2,
  physicalLift: .3,
  waveContact: .16,
});
const flatPopUpSupport = resolvePopUpLandingSupport({
  lostCrest: false,
  boardStillEngaged: false,
  interactionOutcome: "stand",
  waterContact: .9,
  rollCapsizeRisk: .05,
  pitchOverRisk: .05,
  crestOvertaken: 0,
  surfableFace: false,
  faceEnvelope: 0,
  physicalLift: 0,
  waveContact: 0,
});
const passedCrestSupport = resolvePopUpLandingSupport({
  lostCrest: true,
  boardStillEngaged: true,
  interactionOutcome: "capture",
  waterContact: .9,
  rollCapsizeRisk: .05,
  pitchOverRisk: .05,
  crestOvertaken: .95,
  surfableFace: true,
  faceEnvelope: .4,
  physicalLift: .7,
  waveContact: .8,
});
if (
  strictPopUpSupport !== 1
  || readableFaceGrace < .46
  || flatPopUpSupport !== 0
  || passedCrestSupport !== 0
) {
  throw new Error(
    "Pop-up landing no longer accepts a readable moving face while rejecting flat water and a lost crest",
  );
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
const diagonalCrossFlow = angleSweep.find(
  ({ degrees }) => degrees === 45,
).reading.crossFlowSpeed;
if (
  Math.abs(diagonalCrossFlow - (6 - 3.4) * Math.SQRT1_2) > .001
  || broadsideBoard.crossFlowSpeed < 5.99
) {
  throw new Error(
    "Cross-wave load no longer follows projected relative flow speed",
  );
}
if (angleSweep.find(({ degrees }) => degrees === 75).reading.capture >= .2) {
  throw new Error("A board 75 degrees across the wave still acquired capture");
}
if (angleSweep.find(({ degrees }) => degrees === 45).reading.capture <= .3) {
  throw new Error("A diagonal 45-degree takeoff cannot engage the open shoulder");
}

const unsupportedDiagonalTrim = evaluateBoardWaterInteraction({
  ...sharedBoardWater,
  boardHeading: 60 * Math.PI / 180,
  velocityZ: 3.4,
});
const supportedDiagonalTrim = evaluateBoardWaterInteraction({
  ...sharedBoardWater,
  boardHeading: 60 * Math.PI / 180,
  velocityZ: 3.4,
  faceTrimSupport: 1,
});
const unsupportedTangentTrim = evaluateBoardWaterInteraction({
  ...sharedBoardWater,
  boardHeading: Math.PI / 2,
  velocityZ: 3.4,
  faceTrimSupport: 1,
});
if (
  supportedDiagonalTrim.outcome !== "capture"
  || supportedDiagonalTrim.capture
    <= unsupportedDiagonalTrim.capture * 1.5
  || supportedDiagonalTrim.crossWaveLoad
    >= unsupportedDiagonalTrim.crossWaveLoad * .5
  || supportedDiagonalTrim.wipeoutRisk
    >= unsupportedDiagonalTrim.wipeoutRisk * .5
) {
  throw new Error(
    "An engaged rail no longer supports diagonal down-the-line trim",
  );
}
if (
  unsupportedTangentTrim.outcome !== "tumble"
  || unsupportedTangentTrim.capture > .02
  || unsupportedTangentTrim.crossWaveLoad
    < supportedDiagonalTrim.crossWaveLoad * 3
) {
  throw new Error(
    "Face trim incorrectly protected a fully broadside board",
  );
}

const stillWaterStand = evaluateBoardWaterInteraction({
  ...sharedBoardWater,
  boardHeading: Math.PI / 2,
  waveVelocityZ: 5,
  slopeZ: 0,
  surfaceRise: 0,
  surfaceLift: 0,
  crestDistance: 28,
  crestEnergy: .1,
  crestSurfable: false,
});
if (
  stillWaterStand.outcome !== "stand"
  || stillWaterStand.capture !== 0
  || stillWaterStand.crossWaveLoad !== 0
  || stillWaterStand.wipeoutRisk !== 0
) {
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
const trackedCrestPhase = Math.PI * .5 - Math.PI * 2 * 2;
const nextSurfacePhase = trackedCrestPhase - Math.PI * 2 + .2;
const detachedCrestPhase = resolveWaveCrestPhaseIdentity(
  nextSurfacePhase,
  trackedCrestPhase,
  .02,
);
const pressureLockedCrestPhase = resolveWaveCrestPhaseIdentity(
  nextSurfacePhase,
  trackedCrestPhase,
  .2,
);
const trackedCrestProperties = waveCrestPropertiesAtPhase(
  pressureLockedCrestPhase,
);
const neighboringCrestProperties = waveCrestPropertiesAtPhase(
  detachedCrestPhase,
);
const calmSurfStaminaDelta = surfingStaminaDelta(0, 0, .8, 1 / 60);
const loadedSurfStaminaDelta = surfingStaminaDelta(.9, .8, .8, 1 / 60);
const trackedCrestFoamDelta = surfingStaminaDelta(
  .2,
  .72,
  trackedCrestProperties.energy,
  1 / 60,
);
const neighboringCrestFoamDelta = surfingStaminaDelta(
  .2,
  .72,
  neighboringCrestProperties.energy,
  1 / 60,
);
if (
  Math.abs(
    detachedCrestPhase - (trackedCrestPhase - Math.PI * 2),
  ) > 1e-9
  || pressureLockedCrestPhase !== trackedCrestPhase
  || !Number.isFinite(trackedCrestProperties.energy)
  || trackedCrestProperties.energy === neighboringCrestProperties.energy
  || trackedCrestFoamDelta === neighboringCrestFoamDelta
  || calmSurfStaminaDelta <= 0
  || loadedSurfStaminaDelta >= 0
) {
  throw new Error("Hull engagement no longer preserves crest identity and water-load fatigue across ride classification");
}
const offshoreWallApproach = resolveWaveWallApproach({
  crestPhaseError: .3,
  previousCrestPhaseError: .34,
  wavelength: 80,
  wavePeriod: 8,
  boardNormalSpeed: -2,
});
const outrunningWallApproach = resolveWaveWallApproach({
  crestPhaseError: .3,
  previousCrestPhaseError: .28,
  wavelength: 80,
  wavePeriod: 8,
  boardNormalSpeed: 11,
});
const crossedWall = resolveWaveWallApproach({
  crestPhaseError: -.02,
  previousCrestPhaseError: .03,
  wavelength: 80,
  wavePeriod: 8,
  boardNormalSpeed: -1,
});
const wrappedWall = resolveWaveWallApproach({
  crestPhaseError: Math.PI - .01,
  previousCrestPhaseError: -Math.PI + .01,
  wavelength: 80,
  wavePeriod: 8,
  boardNormalSpeed: 0,
});
if (
  Math.abs(offshoreWallApproach.secondsToImpact - .318309886) > .001
  || Number.isFinite(outrunningWallApproach.secondsToImpact)
  || !crossedWall.crossedCrest
  || wrappedWall.crossedCrest
) {
  throw new Error("Shorebreak walls no longer follow polygon crest phase and relative board speed");
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
const diagonalStandingPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 2,
  heading: Math.PI / 3,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  waveContact: .8,
  waterContact: 1,
  waveHeight: 2,
  stance: -.12,
});
const diagonalTrimPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 2,
  heading: Math.PI / 3,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  waveContact: .8,
  waterContact: 1,
  waveHeight: 2,
  stance: -.12,
  faceTrimSupport: 1,
});
const broadsideTrimPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 2,
  heading: Math.PI / 2,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  waveContact: .8,
  waterContact: 1,
  waveHeight: 2,
  stance: -.12,
  faceTrimSupport: 1,
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
const symmetricFourPatchPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 2,
  heading: 0,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  waveContact: .8,
  waterContact: 1,
  waveHeight: 2,
  stance: 0,
  noseSurfaceOffset: .08,
  tailSurfaceOffset: .08,
  rightRailSurfaceOffset: .08,
  leftRailSurfaceOffset: .08,
  boardLength: 2.5,
  boardWidth: .34,
  boardTurn: 1,
});
const rightRailLoadedPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 2,
  heading: 0,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  waveContact: .8,
  waterContact: 1,
  waveHeight: 2,
  stance: 0,
  noseSurfaceOffset: .02,
  tailSurfaceOffset: .02,
  rightRailSurfaceOffset: .12,
  leftRailSurfaceOffset: -.08,
  boardLength: 2.5,
  boardWidth: .34,
  boardTurn: 1,
});
const leftRailLoadedPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 2,
  heading: 0,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  waveContact: .8,
  waterContact: 1,
  waveHeight: 2,
  stance: 0,
  noseSurfaceOffset: .02,
  tailSurfaceOffset: .02,
  rightRailSurfaceOffset: -.08,
  leftRailSurfaceOffset: .12,
  boardLength: 2.5,
  boardWidth: .34,
  boardTurn: 1,
});
const detachedFourPatchPressure = resolveSurfboardWavePressure({
  velocityX: 0,
  velocityZ: 2,
  heading: 0,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  waveContact: .8,
  waterContact: 0,
  waveHeight: 2,
  stance: 0,
  noseSurfaceOffset: .12,
  tailSurfaceOffset: -.08,
  rightRailSurfaceOffset: .12,
  leftRailSurfaceOffset: -.08,
  boardLength: 2.5,
  boardWidth: .34,
  boardTurn: 1,
});
const decomposedFourPatchContact = resolveSurfboardWavePatchContact({
  waveContact: .8,
  waterContact: 1,
  waveHeight: 2,
  noseSurfaceOffset: .08,
  tailSurfaceOffset: .08,
  rightRailSurfaceOffset: .08,
  leftRailSurfaceOffset: .08,
});
const stillWaterFaceSupport = resolveSurfboardWavePatchContact({
  waveContact: 0,
  waterContact: 1,
  waveHeight: 0,
  noseSurfaceOffset: .08,
  tailSurfaceOffset: .08,
  rightRailSurfaceOffset: .08,
  leftRailSurfaceOffset: .08,
});
const detachedFaceSupport = resolveSurfboardWavePatchContact({
  waveContact: .8,
  waterContact: 0,
  waveHeight: 2,
  noseSurfaceOffset: .08,
  tailSurfaceOffset: .08,
  rightRailSurfaceOffset: .08,
  leftRailSurfaceOffset: .08,
});
if (
  alignedWavePressure.forwardDrive < 3
  || Math.abs(alignedWavePressure.lateralLoad) > .001
  || Math.abs(broadsideWavePressure.forwardDrive) > .001
  || Math.abs(broadsideWavePressure.lateralLoad) < 1
  || diagonalTrimPressure.forwardDrive
    <= diagonalStandingPressure.forwardDrive * 1.35
  || Math.abs(diagonalTrimPressure.lateralLoad)
    >= Math.abs(diagonalStandingPressure.lateralLoad) * .72
  || Math.abs(broadsideTrimPressure.forwardDrive) > .001
  || Math.abs(broadsideTrimPressure.lateralLoad) < 1
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
if (
  Math.abs(symmetricFourPatchPressure.centerOfPressure) > .001
  || Math.abs(symmetricFourPatchPressure.lateralCenterOfPressure) > .001
  || Math.abs(symmetricFourPatchPressure.yawAcceleration) > .001
  || rightRailLoadedPressure.lateralCenterOfPressure <= .025
  || rightRailLoadedPressure.yawAcceleration >= -.08
  || leftRailLoadedPressure.lateralCenterOfPressure >= -.025
  || leftRailLoadedPressure.yawAcceleration <= .08
  || Math.abs(
    rightRailLoadedPressure.pressure - leftRailLoadedPressure.pressure
  ) > 1e-9
  || symmetricFourPatchPressure.patchContact < .95
  || decomposedFourPatchContact.patchContact
    !== symmetricFourPatchPressure.patchContact
  || stillWaterFaceSupport.patchContact !== 0
  || Object.values(detachedFaceSupport).some((value) => value !== 0)
  || rightRailLoadedPressure.patchContact
    >= symmetricFourPatchPressure.patchContact
  || detachedFourPatchPressure.pressure !== 0
  || detachedFourPatchPressure.patchContact !== 0
  || detachedFourPatchPressure.rightRailContact !== 0
  || detachedFourPatchPressure.leftRailContact !== 0
) {
  throw new Error("Four-patch polygon pressure is not resolving mirrored rail contact, yaw moment, and detachment");
}
function railPressureTurnAfterOneSecond(hz) {
  const deltaSeconds = 1 / hz;
  let state = {
    velocityX: 0,
    velocityZ: 2,
    heading: 0,
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
      noseSurfaceOffset: .02,
      tailSurfaceOffset: .02,
      rightRailSurfaceOffset: .12,
      leftRailSurfaceOffset: -.08,
      boardLength: 2.5,
      boardWidth: .34,
      boardTurn: 1,
    });
    state.velocityX += pressure.accelerationX * deltaSeconds;
    state.velocityZ += pressure.accelerationZ * deltaSeconds;
    state.yawRate += pressure.yawAcceleration * deltaSeconds;
    state.heading += state.yawRate * deltaSeconds;
  }
  return state;
}
const railPressureTurn60 = railPressureTurnAfterOneSecond(60);
const railPressureTurn120 = railPressureTurnAfterOneSecond(120);
if (
  railPressureTurn60.heading >= -.03
  || Math.abs(
    railPressureTurn60.heading - railPressureTurn120.heading
  ) > .002
) {
  throw new Error("Off-center rail pressure is not producing frame-stable yaw");
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
if (
  flatDynamics.velocityZ >= dynamicsState.velocityZ
  || flatDynamics.velocityZ < 1.9
  || flatDynamics.wavePatchContact !== 0
) {
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
  || airborneDynamics.wavePatchContact !== 0
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
const naturalPerformanceTurn = dynamicsAfterOneSecond({
  boardLength: 2.5,
  boardWidth: .32,
  boardTurn: 1,
  boardStability: 1,
  turningAuthority:
    SURF_ASSIST_PROFILES.natural.surfTurnAuthority,
  momentumRetention:
    SURF_ASSIST_PROFILES.natural.momentumRetention,
});
const guidedPerformanceTurn = dynamicsAfterOneSecond({
  boardLength: 2.5,
  boardWidth: .32,
  boardTurn: 1,
  boardStability: 1,
  turningAuthority:
    SURF_ASSIST_PROFILES.guided.surfTurnAuthority,
  momentumRetention:
    SURF_ASSIST_PROFILES.guided.momentumRetention,
});
function coastingAfterOneSecond(momentumRetention) {
  let state = {
    velocityX: 0,
    velocityZ: 5,
    heading: 0,
    yawRate: 0,
  };
  for (let frame = 0; frame < 60; frame += 1) {
    state = advanceSurfboardDynamics(state, {
      ...dynamicsSample,
      waveContact: 0,
      momentumRetention,
    });
  }
  return Math.hypot(state.velocityX, state.velocityZ);
}
const rawCoastingSpeed = coastingAfterOneSecond(
  SURF_ASSIST_PROFILES.raw.momentumRetention,
);
const naturalCoastingSpeed = coastingAfterOneSecond(
  SURF_ASSIST_PROFILES.natural.momentumRetention,
);
const guidedCoastingSpeed = coastingAfterOneSecond(
  SURF_ASSIST_PROFILES.guided.momentumRetention,
);
if (performanceTurn.heading < .3) {
  throw new Error(`A loaded performance rail failed to redirect momentum: ${performanceTurn.heading.toFixed(2)}rad`);
}
if (longboardTurn.heading >= performanceTurn.heading * .78) {
  throw new Error("Longboard yaw inertia no longer distinguishes it from a shortboard");
}
if (
  naturalPerformanceTurn.heading
    <= performanceTurn.heading * 1.06
  || guidedPerformanceTurn.heading
    <= naturalPerformanceTurn.heading * 1.08
  || naturalCoastingSpeed <= rawCoastingSpeed + .02
  || guidedCoastingSpeed <= naturalCoastingSpeed + .02
) {
  throw new Error(
    "Guided and Natural assists no longer add progressive turn authority and momentum retention",
  );
}
function simulateTakeoffBottomTurn(railInput) {
  let state = {
    velocityX: 0,
    velocityZ: 2.4,
    heading: 0,
    yawRate: 0,
  };
  let x = 0;
  let z = 0;
  for (let frame = 0; frame < 90; frame += 1) {
    state = advanceSurfboardDynamics(state, {
      ...dynamicsSample,
      railInput,
      stance: -.24,
      surfaceSlopeZ: -.18,
      waveContact: .82,
    });
    x += state.velocityX / 60;
    z += state.velocityZ / 60;
  }
  return { ...state, x, z };
}
const lowSpeedBottomTurn = simulateTakeoffBottomTurn(1);
const lowSpeedStraightDrop =
  simulateTakeoffBottomTurn(0);
if (
  lowSpeedBottomTurn.heading < .55
  || lowSpeedBottomTurn.x
    <= lowSpeedStraightDrop.x + .6
) {
  throw new Error(
    `A takeoff-speed rail cannot redirect the board down the line: ${JSON.stringify(lowSpeedBottomTurn)}`,
  );
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
let guidedInstability = 0;
for (let frame = 0; frame < 30; frame += 1) {
  guidedInstability = advanceSurfboardInstability(
    guidedInstability,
    {
      ...sharedInstabilitySample,
      deltaSeconds: 1 / 60,
      loadScale:
        SURF_ASSIST_PROFILES.guided.instabilityLoadScale,
      recoveryScale:
        SURF_ASSIST_PROFILES.guided.instabilityRecoveryScale,
    },
  ).instability;
}
let rawInstability = 0;
for (let frame = 0; frame < 30; frame += 1) {
  rawInstability = advanceSurfboardInstability(
    rawInstability,
    {
      ...sharedInstabilitySample,
      deltaSeconds: 1 / 60,
      loadScale:
        SURF_ASSIST_PROFILES.raw.instabilityLoadScale,
      recoveryScale:
        SURF_ASSIST_PROFILES.raw.instabilityRecoveryScale,
    },
  ).instability;
}
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
  || guidedInstability >= rawInstability * .55
  || !surfboardWipeoutTriggered(1.5, .2, .2)
  || surfboardWipeoutTriggered(
    1.5,
    .2,
    .2,
    SURF_ASSIST_PROFILES.guided.wipeoutThresholdScale,
    SURF_ASSIST_PROFILES.guided.failureMargin,
  )
  || !surfboardWipeoutTriggered(
    0,
    .99,
    0,
    SURF_ASSIST_PROFILES.guided.wipeoutThresholdScale,
    SURF_ASSIST_PROFILES.guided.failureMargin,
  )
) {
  throw new Error(
    "Instability or the progressive Guided/Natural/Raw wipeout thresholds changed across engagement",
  );
}
const sharedWipeoutSample = {
  waveHeight: 2.4,
  wavePeriod: 11,
  waveEnergy: .78,
  tidePower: .86,
  speed: 9.2,
  rollRate: 2.4,
  pitchRate: 1.3,
  yawRate: 1.1,
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
  speed: 1.8,
  rollRate: .2,
  pitchRate: .1,
  yawRate: .1,
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
  || standingWipeout.power <= lightWipeout.power
  || standingWipeout.duration <= lightWipeout.duration
  || standingWipeout.kineticImpact
    <= lightWipeout.kineticImpact * 8
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
const tumble30 = simulateTumble(30);
const tumble120 = simulateTumble(120);
if (
  tumble60.roll < 3.2
  || Math.abs(tumble60.roll - tumble30.roll) > .05
  || Math.abs(tumble60.roll - tumble120.roll) > .025
  || Math.abs(tumble60.pitch - tumble120.pitch) > .025
  || Math.abs(tumble60.yaw - tumble120.yaw) > .025
) {
  throw new Error("Separated board tumble is no longer physical or frame-rate stable");
}
const sharedFailureRelease = {
  velocityX: 1.4,
  velocityZ: 6.2,
  heading: 0,
  heaveVelocity: -.2,
  rollRate: broadsideTumble.rollRate,
  pitchRate: broadsideTumble.pitchRate,
  yawRate: broadsideTumble.yawRate,
  centerOfMassHeight: .86,
  lateralOffset: .04,
  longitudinalOffset: -.08,
  rollCapsizeRisk: .96,
  pitchOverRisk: .24,
  pearlingRisk: .18,
  boardLength: 2.1,
  boardWidth: .5,
};
const standingFailureRelease = resolveSurfboardFailureRelease(
  sharedFailureRelease,
);
const engagedFailureRelease = resolveSurfboardFailureRelease(
  sharedFailureRelease,
);
const alignedFailureRelease = resolveSurfboardFailureRelease({
  ...sharedFailureRelease,
  rollRate: alignedTumble.rollRate,
  pitchRate: alignedTumble.pitchRate,
  yawRate: alignedTumble.yawRate,
  rollCapsizeRisk: .12,
});
const oppositeFailureRelease = resolveSurfboardFailureRelease({
  ...sharedFailureRelease,
  rollRate: oppositeBroadsideTumble.rollRate,
  pitchRate: oppositeBroadsideTumble.pitchRate,
  yawRate: oppositeBroadsideTumble.yawRate,
  lateralOffset: -.04,
});
const pearlingFailureRelease = resolveSurfboardFailureRelease({
  ...sharedFailureRelease,
  rollRate: pearlingTumble.rollRate,
  pitchRate: pearlingTumble.pitchRate,
  yawRate: pearlingTumble.yawRate,
  rollCapsizeRisk: .1,
  pitchOverRisk: .98,
  pearlingRisk: .9,
});
const proneFailureRelease = resolveSurfboardFailureRelease({
  ...sharedFailureRelease,
  centerOfMassHeight: .2,
  lateralOffset: 0,
  longitudinalOffset: 0,
});
const unsupportedFailureRelease = resolveSurfboardFailureRelease({
  ...sharedFailureRelease,
  rollRate: 0,
  pitchRate: 0,
  yawRate: 0,
  heaveVelocity: 0,
  lateralOffset: 0,
  longitudinalOffset: 0,
  rollCapsizeRisk: 0,
  pitchOverRisk: 0,
  pearlingRisk: 0,
});
if (
  JSON.stringify(standingFailureRelease)
    !== JSON.stringify(engagedFailureRelease)
  || standingFailureRelease.lateralVelocity
    > alignedFailureRelease.lateralVelocity - 2
  || oppositeFailureRelease.lateralVelocity < 2
  || pearlingFailureRelease.longitudinalVelocity
    < alignedFailureRelease.longitudinalVelocity + 1.4
  || Math.abs(proneFailureRelease.lateralVelocity)
    >= Math.abs(standingFailureRelease.lateralVelocity) * .36
  || unsupportedFailureRelease.velocityX !== 1.4
  || unsupportedFailureRelease.velocityZ !== 6.2
  || Math.abs(
    standingFailureRelease.velocityX
      + standingFailureRelease.boardRelativeLateralVelocity
      - sharedFailureRelease.velocityX,
  ) > 1e-9
  || Math.abs(
    standingFailureRelease.velocityZ
      + standingFailureRelease.boardRelativeLongitudinalVelocity
      - sharedFailureRelease.velocityZ,
  ) > 1e-9
  || Math.abs(
    standingFailureRelease.verticalVelocity
      + standingFailureRelease.boardRelativeVerticalVelocity
      - sharedFailureRelease.heaveVelocity,
  ) > 1e-9
  || Math.abs(
    oppositeFailureRelease.boardRelativeLateralVelocity
      + standingFailureRelease.boardRelativeLateralVelocity,
  ) > .12
  || unsupportedFailureRelease.boardRelativeLateralVelocity !== 0
  || unsupportedFailureRelease.boardRelativeVerticalVelocity !== 0
  || unsupportedFailureRelease.boardRelativeLongitudinalVelocity !== 0
  || unsupportedFailureRelease.cause !== "loss of support"
  || standingFailureRelease.cause !== "rail edge"
  || pearlingFailureRelease.cause !== "buried nose"
) {
  throw new Error("Surfer release no longer inherits board COM and angular edge velocity");
}
function simulateSeparatedBody(
  hz,
  surfaceOffset,
  verticalVelocity,
  seconds = 3.2,
) {
  let body = { surfaceOffset, verticalVelocity };
  let entryAt = null;
  let minimumOffset = surfaceOffset;
  let minimumAt = 0;
  for (let frame = 0; frame < Math.round(seconds * hz); frame += 1) {
    const elapsed = frame / hz;
    const washEnvelope = elapsed < .18
      ? elapsed / .18
      : elapsed < 1.45
        ? 1
        : Math.max(0, 1 - (elapsed - 1.45) / .75);
    body = advanceSeparatedSurferVerticalDynamics(body, {
      deltaSeconds: 1 / hz,
      downwardWaterVelocity: -2.35 * washEnvelope,
    });
    if (entryAt === null && body.immersion > .18) {
      entryAt = elapsed + 1 / hz;
    }
    if (body.surfaceOffset < minimumOffset) {
      minimumOffset = body.surfaceOffset;
      minimumAt = elapsed + 1 / hz;
    }
  }
  return {
    ...body,
    entryAt,
    minimumOffset,
    minimumAt,
  };
}
const standingBodyFall60 = simulateSeparatedBody(
  60,
  .98,
  standingFailureRelease.verticalVelocity,
);
const standingBodyFall120 = simulateSeparatedBody(
  120,
  .98,
  standingFailureRelease.verticalVelocity,
);
const proneBodyFall = simulateSeparatedBody(
  60,
  .32,
  proneFailureRelease.verticalVelocity,
);
if (
  standingBodyFall60.entryAt === null
  || proneBodyFall.entryAt === null
  || standingBodyFall60.entryAt <= proneBodyFall.entryAt + .18
  || standingBodyFall60.minimumOffset > -.45
  || standingBodyFall60.minimumAt >= 2.65
  || standingBodyFall60.surfaceOffset
    <= standingBodyFall60.minimumOffset + .16
  || Math.abs(
    standingBodyFall60.surfaceOffset - standingBodyFall120.surfaceOffset,
  ) > .025
  || Math.abs(
    standingBodyFall60.verticalVelocity
      - standingBodyFall120.verticalVelocity,
  ) > .035
) {
  throw new Error("Separated body fall no longer follows gravity, moving water, buoyancy, or frame rate");
}
function simulateImmersionCoupledTumble(hz) {
  let body = {
    surfaceOffset: .98,
    verticalVelocity: standingFailureRelease.verticalVelocity,
  };
  let tumble = broadsideTumble;
  let entryRollRate = null;
  let preEntryRollRate = broadsideTumble.rollRate;
  for (let frame = 0; frame < Math.round(3.2 * hz); frame += 1) {
    const elapsed = frame / hz;
    const washEnvelope = elapsed < .18
      ? elapsed / .18
      : elapsed < 1.45
        ? 1
        : Math.max(0, 1 - (elapsed - 1.45) / .75);
    const residualWash = washEnvelope;
    body = advanceSeparatedSurferVerticalDynamics(body, {
      deltaSeconds: 1 / hz,
      downwardWaterVelocity: -2.35 * residualWash,
    });
    tumble = advanceSurfboardTumble(tumble, {
      deltaSeconds: 1 / hz,
      waterDrag: Math.min(
        1,
        .035 + body.immersion * (.24 + residualWash * .68),
      ),
      washTorque: residualWash * body.immersion * 1.7,
      washSide: 1,
    });
    if (body.immersion < .08) {
      preEntryRollRate = tumble.rollRate;
    } else if (entryRollRate === null) {
      entryRollRate = tumble.rollRate;
    }
  }
  return {
    ...tumble,
    entryRollRate,
    preEntryRollRate,
    immersion: body.immersion,
  };
}
const coupledTumble60 = simulateImmersionCoupledTumble(60);
const coupledTumble120 = simulateImmersionCoupledTumble(120);
if (
  coupledTumble60.entryRollRate === null
  || coupledTumble60.preEntryRollRate
    < broadsideTumble.rollRate * .94
  || coupledTumble60.rollRate
    >= coupledTumble60.entryRollRate * .72
  || Math.abs(coupledTumble60.roll - coupledTumble120.roll) > .035
  || Math.abs(coupledTumble60.rollRate - coupledTumble120.rollRate) > .035
) {
  throw new Error("Tumble no longer conserves airborne rotation or damps from measured immersion");
}
function simulateSeparatedHorizontal(hz) {
  let body = { velocityX: 8, velocityZ: 5 };
  let airborneVelocity = null;
  for (let frame = 0; frame < Math.round(2.5 * hz); frame += 1) {
    const elapsed = frame / hz;
    const immersion = elapsed < .5 ? 0 : 1;
    body = advanceSeparatedSurferHorizontalDynamics(body, {
      deltaSeconds: 1 / hz,
      immersion,
      waterVelocityX: 2,
      waterVelocityZ: -1,
      turbulence: immersion ? .8 : 0,
    });
    if (frame === Math.round(.5 * hz) - 1) {
      airborneVelocity = { ...body };
    }
  }
  return { ...body, airborneVelocity };
}
const separatedHorizontal60 = simulateSeparatedHorizontal(60);
const separatedHorizontal120 = simulateSeparatedHorizontal(120);
const uprightVerticalFlow =
  resolveSeparatedSurferProjectedArea({
    pitch: 0,
    yaw: 0,
    roll: 0,
    flowX: 0,
    flowY: 3,
    flowZ: 0,
  });
const uprightHorizontalFlow =
  resolveSeparatedSurferProjectedArea({
    pitch: 0,
    yaw: 0,
    roll: 0,
    flowX: 3,
    flowY: 0,
    flowZ: 0,
  });
const rolledHorizontalFlow =
  resolveSeparatedSurferProjectedArea({
    pitch: 0,
    yaw: 0,
    roll: Math.PI / 2,
    flowX: -3,
    flowY: 0,
    flowZ: 0,
  });
function simulateProjectedBodyDrag(
  hz,
  projectedArea,
) {
  let body = { velocityX: 8, velocityZ: 0 };
  for (let frame = 0; frame < hz; frame += 1) {
    body = advanceSeparatedSurferHorizontalDynamics(
      body,
      {
        deltaSeconds: 1 / hz,
        immersion: 1,
        waterVelocityX: 1,
        waterVelocityZ: 0,
        turbulence: .5,
        projectedArea,
      },
    );
  }
  return body;
}
const streamlinedBodyDrag60 =
  simulateProjectedBodyDrag(
    60,
    uprightVerticalFlow.projectedArea,
  );
const broadsideBodyDrag60 =
  simulateProjectedBodyDrag(
    60,
    uprightHorizontalFlow.projectedArea,
  );
const broadsideBodyDrag120 =
  simulateProjectedBodyDrag(
    120,
    uprightHorizontalFlow.projectedArea,
  );
const initialHorizontalSpeed = Math.hypot(8, 5);
if (
  separatedHorizontal60.airborneVelocity === null
  || Math.hypot(
    separatedHorizontal60.airborneVelocity.velocityX,
    separatedHorizontal60.airborneVelocity.velocityZ,
  ) < initialHorizontalSpeed * .99
  || Math.hypot(
    separatedHorizontal60.velocityX - 2,
    separatedHorizontal60.velocityZ + 1,
  ) > 1.9
  || Math.abs(
    separatedHorizontal60.velocityX
      - separatedHorizontal120.velocityX,
  ) > .025
  || Math.abs(
    separatedHorizontal60.velocityZ
      - separatedHorizontal120.velocityZ,
  ) > .025
  || uprightVerticalFlow.flowAlignment < .999
  || uprightVerticalFlow.projectedArea > .17
  || uprightHorizontalFlow.flowAlignment !== 0
  || uprightHorizontalFlow.projectedArea < .73
  || rolledHorizontalFlow.flowAlignment < .999
  || rolledHorizontalFlow.projectedArea > .17
  || broadsideBodyDrag60.velocityX
    >= streamlinedBodyDrag60.velocityX - .8
  || Math.abs(
    broadsideBodyDrag60.velocityX
      - broadsideBodyDrag120.velocityX,
  ) > .025
) {
  throw new Error("Separated body drag no longer retains air momentum or follows projected area in occupied water");
}
function simulateSettledRecovery(hz) {
  let readiness = 0;
  let readyAt = null;
  let reading = null;
  for (let frame = 0; frame < hz; frame += 1) {
    reading = advanceSeparatedSurferRecovery(readiness, {
      deltaSeconds: 1 / hz,
      elapsedSeconds: 2 + frame / hz,
      surfaceOffset: -.04,
      verticalVelocity: .24,
      waterRelativeSpeed: .55,
      angularSpeed: .72,
      washIntensity: .06,
      leashTension: .18,
      maximumHoldSeconds: 7.5,
    });
    readiness = reading.readiness;
    if (reading.ready && readyAt === null) {
      readyAt = (frame + 1) / hz;
    }
  }
  return { ...reading, readyAt };
}
const settledRecovery60 = simulateSettledRecovery(60);
const settledRecovery120 = simulateSettledRecovery(120);
let shallowBody = {
  surfaceOffset: .18,
  verticalVelocity: -3.2,
};
let shallowMinimumOffset = shallowBody.surfaceOffset;
for (let frame = 0; frame < 90; frame += 1) {
  shallowBody = advanceSeparatedSurferVerticalDynamics(
    shallowBody,
    {
      deltaSeconds: 1 / 60,
      downwardWaterVelocity: -3.4,
      maximumDepth: .38,
    },
  );
  shallowMinimumOffset = Math.min(
    shallowMinimumOffset,
    shallowBody.surfaceOffset,
  );
}
const shallowSafetyRecovery =
  advanceSeparatedSurferRecovery(0, {
    deltaSeconds: 1 / 60,
    elapsedSeconds: 1.55,
    surfaceOffset: -.38,
    verticalVelocity: 0,
    waterRelativeSpeed: 2,
    angularSpeed: 3,
    washIntensity: .8,
    leashTension: .8,
    maximumHoldSeconds: 1.55,
    minimumImpactSeconds: .45,
    settleSeconds: .3,
    washReleaseThreshold: .38,
  });
if (
  shallowMinimumOffset < -.381
  || !shallowSafetyRecovery.ready
  || !shallowSafetyRecovery.safetyRelease
) {
  throw new Error(
    "Nearshore wipeout recovery can still simulate deep-water hold-down depth or duration",
  );
}
const submergedRecovery = advanceSeparatedSurferRecovery(.9, {
  deltaSeconds: .05,
  elapsedSeconds: 4,
  surfaceOffset: -.7,
  verticalVelocity: .2,
  waterRelativeSpeed: .4,
  angularSpeed: .3,
  washIntensity: 0,
  leashTension: 0,
  maximumHoldSeconds: 7.5,
});
const violentSurfaceRecovery = advanceSeparatedSurferRecovery(.9, {
  deltaSeconds: .05,
  elapsedSeconds: 3,
  surfaceOffset: .02,
  verticalVelocity: .2,
  waterRelativeSpeed: .4,
  angularSpeed: 3.4,
  washIntensity: .62,
  leashTension: .8,
  maximumHoldSeconds: 7.5,
});
const safetyRecovery = advanceSeparatedSurferRecovery(0, {
  deltaSeconds: 1 / 60,
  elapsedSeconds: 7.5,
  surfaceOffset: -1.2,
  verticalVelocity: -2,
  waterRelativeSpeed: 5,
  angularSpeed: 4,
  washIntensity: 1,
  leashTension: 1,
  maximumHoldSeconds: 7.5,
});
const detachedBreakingWash =
  resolveSeparatedSurferBreakingWash({
    crestDistance: 15,
    crestEnergy: .86,
    faceSlope: .34,
    surfaceRise: .7,
    breakingActivation: 1,
  });
const unbrokenCrestWash =
  resolveSeparatedSurferBreakingWash({
    crestDistance: 0,
    crestEnergy: .86,
    faceSlope: .34,
    surfaceRise: .7,
    breakingActivation: 0,
  });
const strongLipWash = resolveSeparatedSurferBreakingWash({
  crestDistance: 0,
  crestEnergy: .86,
  faceSlope: .34,
  surfaceRise: .7,
  breakingActivation: 1,
});
const trailingFoamWash =
  resolveSeparatedSurferBreakingWash({
    crestDistance: -4,
    crestEnergy: .86,
    faceSlope: .03,
    surfaceRise: .06,
    breakingActivation: 1,
  });
const equalDistanceOpenFaceWash =
  resolveSeparatedSurferBreakingWash({
    crestDistance: 4,
    crestEnergy: .86,
    faceSlope: .03,
    surfaceRise: .06,
    breakingActivation: 1,
  });
const airborneLooseBoard =
  resolveSeparatedSurfboardWaterForces({
    surfaceOffset: 1.1,
    velocityX: 4,
    velocityY: 0,
    velocityZ: -2,
    waterVelocityX: 1,
    waterVelocityY: 0,
    waterVelocityZ: 1,
    pitchAngle: 0,
    rollAngle: 0,
    surfacePitch: 0,
    surfaceRoll: 0,
    washIntensity: 1,
    boardMass: 3.2,
    boardLength: 2.5,
    boardWidth: .32,
  });
const flowingLooseBoard =
  resolveSeparatedSurfboardWaterForces({
    surfaceOffset: -.06,
    velocityX: 4,
    velocityY: -.4,
    velocityZ: -2,
    waterVelocityX: 1,
    waterVelocityY: .2,
    waterVelocityZ: 1,
    pitchAngle: .35,
    rollAngle: -.28,
    surfacePitch: .08,
    surfaceRoll: .06,
    washIntensity: .7,
    boardMass: 3.2,
    boardLength: 2.5,
    boardWidth: .32,
  });
const oppositeLooseBoardAttitude =
  resolveSeparatedSurfboardWaterForces({
    surfaceOffset: -.06,
    velocityX: 1,
    velocityY: 0,
    velocityZ: 1,
    waterVelocityX: 1,
    waterVelocityY: 0,
    waterVelocityZ: 1,
    pitchAngle: -.35,
    rollAngle: .28,
    surfacePitch: 0,
    surfaceRoll: 0,
    washIntensity: .2,
    boardMass: 3.2,
    boardLength: 2.5,
    boardWidth: .32,
  });
function simulateLooseBoardSplash(hz) {
  let surfaceOffset = .8;
  let velocityY = 0;
  let minimumOffset = surfaceOffset;
  let peakContact = 0;
  for (let frame = 0; frame < hz * 3; frame += 1) {
    const force = resolveSeparatedSurfboardWaterForces({
      surfaceOffset,
      velocityX: 2.4,
      velocityY,
      velocityZ: -.8,
      waterVelocityX: .6,
      waterVelocityY: 0,
      waterVelocityZ: .2,
      pitchAngle: .18,
      rollAngle: -.12,
      surfacePitch: 0,
      surfaceRoll: 0,
      washIntensity: .25,
      boardMass: 3.2,
      boardLength: 2.5,
      boardWidth: .32,
    });
    velocityY += force.accelerationY / hz;
    surfaceOffset += velocityY / hz;
    minimumOffset = Math.min(minimumOffset, surfaceOffset);
    peakContact = Math.max(
      peakContact,
      force.waterContact,
    );
  }
  return {
    surfaceOffset,
    velocityY,
    minimumOffset,
    peakContact,
  };
}
const looseBoardSplash60 =
  simulateLooseBoardSplash(60);
const looseBoardSplash120 =
  simulateLooseBoardSplash(120);
function simulateSpatialWashPassage(hz) {
  let body = {
    surfaceOffset: .35,
    verticalVelocity: -.4,
  };
  let maximumIntensity = 0;
  let minimumOffset = body.surfaceOffset;
  for (let frame = 0; frame < hz * 4; frame += 1) {
    const passage = (frame + 1) / (hz * 4);
    const wash = resolveSeparatedSurferBreakingWash({
      crestDistance: 7 - passage * 18,
      crestEnergy: .82,
      faceSlope: .28 * (
        1 - Math.min(1, Math.abs(passage - .39) / .24)
      ),
      surfaceRise: .62 * (
        1 - Math.min(1, Math.abs(passage - .39) / .3)
      ),
      breakingActivation: 1,
    });
    body = advanceSeparatedSurferVerticalDynamics(body, {
      deltaSeconds: 1 / hz,
      downwardWaterVelocity: wash.downwardWaterVelocity,
    });
    maximumIntensity = Math.max(
      maximumIntensity,
      wash.intensity,
    );
    minimumOffset = Math.min(
      minimumOffset,
      body.surfaceOffset,
    );
  }
  return {
    ...body,
    maximumIntensity,
    minimumOffset,
  };
}
const spatialWashPassage60 =
  simulateSpatialWashPassage(60);
const spatialWashPassage120 =
  simulateSpatialWashPassage(120);
if (
  settledRecovery60.readyAt === null
  || settledRecovery120.readyAt === null
  || Math.abs(
    settledRecovery60.readyAt - settledRecovery120.readyAt,
  ) > .02
  || settledRecovery60.readyAt < .5
  || settledRecovery60.readyAt > .58
  || submergedRecovery.ready
  || submergedRecovery.limitingFactor !== "submerged"
  || submergedRecovery.readiness >= .9
  || violentSurfaceRecovery.ready
  || violentSurfaceRecovery.limitingFactor !== "wash"
  || !safetyRecovery.ready
  || !safetyRecovery.safetyRelease
  || safetyRecovery.limitingFactor !== "safety"
  || detachedBreakingWash.intensity !== 0
  || unbrokenCrestWash.intensity !== 0
  || strongLipWash.intensity < .7
  || strongLipWash.downwardWaterVelocity >= -1
  || strongLipWash.transportSpeed <= 1
  || trailingFoamWash.intensity
    <= equalDistanceOpenFaceWash.intensity * 2
  || airborneLooseBoard.waterContact !== 0
  || Math.abs(
    airborneLooseBoard.accelerationY + 9.81,
  ) > 1e-9
  || Math.abs(airborneLooseBoard.accelerationX) > .12
  || flowingLooseBoard.waterContact < .9
  || flowingLooseBoard.accelerationX >= 0
  || flowingLooseBoard.accelerationZ <= 0
  || flowingLooseBoard.pitchAcceleration >= 0
  || flowingLooseBoard.rollAcceleration <= 0
  || oppositeLooseBoardAttitude.pitchAcceleration <= 0
  || oppositeLooseBoardAttitude.rollAcceleration >= 0
  || looseBoardSplash60.peakContact < .9
  || looseBoardSplash60.minimumOffset <= 0
  || looseBoardSplash60.surfaceOffset < .15
  || looseBoardSplash60.surfaceOffset > .3
  || Math.abs(
    looseBoardSplash60.surfaceOffset
      - looseBoardSplash120.surfaceOffset,
  ) > .04
  || Math.abs(
    looseBoardSplash60.velocityY
      - looseBoardSplash120.velocityY,
  ) > .05
  || spatialWashPassage60.maximumIntensity < .6
  || spatialWashPassage60.minimumOffset > -.35
  || Math.abs(
    spatialWashPassage60.surfaceOffset
      - spatialWashPassage120.surfaceOffset,
  ) > .03
  || Math.abs(
    spatialWashPassage60.verticalVelocity
      - spatialWashPassage120.verticalVelocity,
  ) > .04
) {
  throw new Error("Wipeout wash or recovery no longer follows local wave geometry and stable physical resurfacing");
}
const stretchedLeash = resolveSurfboardLeashReaction({
  stretch: .62,
  separationRate: 2.4,
  surferMass: 76,
  boardMass: 3.2,
});
const slackLeash = resolveSurfboardLeashReaction({
  stretch: 0,
  separationRate: 5,
  surferMass: 76,
  boardMass: 3.2,
});
const closingLeash = resolveSurfboardLeashReaction({
  stretch: .62,
  separationRate: -2.4,
  surferMass: 76,
  boardMass: 3.2,
});
const longboardLeash = resolveSurfboardLeashReaction({
  stretch: .62,
  separationRate: 2.4,
  surferMass: 76,
  boardMass: 7.2,
});
const longLeashMaterial = resolveSurfboardLeashReaction({
  stretch: .62,
  separationRate: 2.4,
  surferMass: 76,
  boardMass: 7.2,
  restLength: 3.04,
});
if (
  stretchedLeash.force <= closingLeash.force
  || slackLeash.force !== 0
  || Math.abs(
    stretchedLeash.surferAcceleration * 76
      - stretchedLeash.boardAcceleration * 3.2,
  ) > 1e-9
  || Math.abs(
    stretchedLeash.relativeAcceleration
      - stretchedLeash.surferAcceleration
      - stretchedLeash.boardAcceleration,
  ) > 1e-9
  || longboardLeash.surferAcceleration
    !== stretchedLeash.surferAcceleration
  || longboardLeash.boardAcceleration
    >= stretchedLeash.boardAcceleration
  || longLeashMaterial.force >= longboardLeash.force
) {
  throw new Error("Leash reaction no longer applies equal force from stretch, damping, and mass");
}
const slackLeashTorque = resolveSurfboardLeashTorque({
  force: 0,
  directionX: 1,
  directionY: 0,
  directionZ: 0,
  surferMass: 76,
  boardMass: 3.2,
  boardLength: 2.5,
  boardWidth: .32,
});
const lateralLeashTorque = resolveSurfboardLeashTorque({
  force: 30,
  directionX: 1,
  directionY: 0,
  directionZ: 0,
  surferMass: 76,
  boardMass: 3.2,
  boardLength: 2.5,
  boardWidth: .32,
});
const oppositeLateralLeashTorque = resolveSurfboardLeashTorque({
  force: 30,
  directionX: -1,
  directionY: 0,
  directionZ: 0,
  surferMass: 76,
  boardMass: 3.2,
  boardLength: 2.5,
  boardWidth: .32,
});
const longitudinalLeashTorque = resolveSurfboardLeashTorque({
  force: 30,
  directionX: 0,
  directionY: 0,
  directionZ: 1,
  surferMass: 76,
  boardMass: 3.2,
  boardLength: 2.5,
  boardWidth: .32,
});
const verticalLeashTorque = resolveSurfboardLeashTorque({
  force: 30,
  directionX: 0,
  directionY: 1,
  directionZ: 0,
  surferMass: 76,
  boardMass: 3.2,
  boardLength: 2.5,
  boardWidth: .32,
});
const longboardLeashTorque = resolveSurfboardLeashTorque({
  force: 30,
  directionX: 1,
  directionY: 0,
  directionZ: 0,
  surferMass: 76,
  boardMass: 7.2,
  boardLength: 3.35,
  boardWidth: .58,
});
const longboardLongitudinalLeashTorque =
  resolveSurfboardLeashTorque({
    force: 30,
    directionX: 0,
    directionY: 0,
    directionZ: 1,
    surferMass: 76,
    boardMass: 7.2,
    boardLength: 3.35,
    boardWidth: .58,
  });
if (
  Object.values(slackLeashTorque).some((value) => value !== 0)
  || lateralLeashTorque.boardYawAcceleration === 0
  || lateralLeashTorque.boardRollAcceleration === 0
  || lateralLeashTorque.surferRollAcceleration === 0
  || lateralLeashTorque.surferPitchAcceleration !== 0
  || Math.abs(
    lateralLeashTorque.boardYawAcceleration
      + oppositeLateralLeashTorque.boardYawAcceleration,
  ) > 1e-9
  || Math.abs(
    lateralLeashTorque.boardRollAcceleration
      + oppositeLateralLeashTorque.boardRollAcceleration,
  ) > 1e-9
  || Math.abs(
    lateralLeashTorque.surferRollAcceleration
      + oppositeLateralLeashTorque.surferRollAcceleration,
  ) > 1e-9
  || longitudinalLeashTorque.boardPitchAcceleration === 0
  || longitudinalLeashTorque.surferPitchAcceleration === 0
  || longitudinalLeashTorque.boardRollAcceleration !== 0
  || longitudinalLeashTorque.surferRollAcceleration !== 0
  || verticalLeashTorque.boardPitchAcceleration === 0
  || verticalLeashTorque.surferPitchAcceleration !== 0
  || verticalLeashTorque.surferRollAcceleration !== 0
  || Math.abs(longboardLeashTorque.boardYawAcceleration)
    >= Math.abs(lateralLeashTorque.boardYawAcceleration)
  || Math.abs(
    longboardLongitudinalLeashTorque.boardPitchAcceleration,
  ) >= Math.abs(
    longitudinalLeashTorque.boardPitchAcceleration,
  )
) {
  throw new Error("Offset leash no longer rotates each body from attachment geometry and inertia");
}
function simulateLeashCoupling(hz) {
  const surferMass = 76;
  const boardMass = 3.2;
  const restLength = 2.2;
  let surferPosition = 0;
  let boardPosition = 3.1;
  let surferVelocity = 0;
  let boardVelocity = 3;
  let maximumDistance = boardPosition - surferPosition;
  const initialMomentum = surferVelocity * surferMass
    + boardVelocity * boardMass;
  for (let frame = 0; frame < hz * 2; frame += 1) {
    const distance = boardPosition - surferPosition;
    const direction = Math.sign(distance) || 1;
    const separationRate = (
      boardVelocity - surferVelocity
    ) * direction;
    const reaction = resolveSurfboardLeashReaction({
      stretch: Math.max(0, Math.abs(distance) - restLength),
      separationRate,
      surferMass,
      boardMass,
    });
    const step = 1 / hz;
    surferVelocity += direction
      * reaction.surferAcceleration
      * step;
    boardVelocity -= direction
      * reaction.boardAcceleration
      * step;
    surferPosition += surferVelocity * step;
    boardPosition += boardVelocity * step;
    maximumDistance = Math.max(
      maximumDistance,
      Math.abs(boardPosition - surferPosition),
    );
  }
  return {
    surferPosition,
    boardPosition,
    surferVelocity,
    boardVelocity,
    maximumDistance,
    momentum: surferVelocity * surferMass
      + boardVelocity * boardMass,
    initialMomentum,
  };
}
const leashCoupling60 = simulateLeashCoupling(60);
const leashCoupling120 = simulateLeashCoupling(120);
if (
  leashCoupling60.maximumDistance > 3.35
  || Math.abs(
    leashCoupling60.momentum - leashCoupling60.initialMomentum,
  ) > 1e-9
  || Math.abs(
    leashCoupling120.momentum - leashCoupling120.initialMomentum,
  ) > 1e-9
  || Math.abs(
    leashCoupling60.surferPosition
      - leashCoupling120.surferPosition,
  ) > .035
  || Math.abs(
    leashCoupling60.boardPosition
      - leashCoupling120.boardPosition,
  ) > .08
) {
  throw new Error("Coupled leash no longer conserves center-of-mass momentum or frame stability");
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
  boardMass: 3.2,
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
  boardMass: 7.2,
  boardStability: 1.28,
});
if (
  loadedPerformanceRail.effectiveRail < .32
  || loadedLongboardRail.rollAngle >= loadedPerformanceRail.rollAngle * .84
) {
  throw new Error("Board width, mass, and stability no longer produce distinct roll inertia");
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
const automaticallyBalancedCrossWave = rollForFrames(75, {
  ...rollSample,
  speed: 1.2,
  planing: .12,
  crossSlope: .12,
  crossWaveLoad: .72,
  whitewater: .3,
  automaticCounterweight:
    SURF_ASSIST_PROFILES.guided.automaticCounterweight,
  railTorqueScale:
    SURF_ASSIST_PROFILES.guided.railTorqueScale,
});
const guidedLoadedRail = rollForFrames(60, {
  ...rollSample,
  railInput: .8,
  automaticCounterweight:
    SURF_ASSIST_PROFILES.guided.automaticCounterweight,
  railTorqueScale:
    SURF_ASSIST_PROFILES.guided.railTorqueScale,
});
if (
  unbalancedCrossWave.edgeRisk < .35
  || Math.abs(counterweightedCrossWave.rollAngle) >= Math.abs(unbalancedCrossWave.rollAngle) * .55
  || Math.abs(automaticallyBalancedCrossWave.rollAngle)
    >= Math.abs(unbalancedCrossWave.rollAngle) * .72
  || Math.abs(
    automaticallyBalancedCrossWave.effectiveCounterweight,
  ) < .08
  || guidedLoadedRail.effectiveRail < .24
) {
  throw new Error(
    "Independent manual/automatic counterweight no longer opposes cross-wave torque while leaving a turnable rail",
  );
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
const unsupportedPlaningHeave = heaveForFrames(360, {
  ...heaveSample,
  planing: .86,
  speed: 6.2,
  waveContact: detachedFourPatchPressure.patchContact,
});
const polygonSupportedHeave = heaveForFrames(360, {
  ...heaveSample,
  planing: .86,
  speed: 6.2,
  waveContact: symmetricFourPatchPressure.patchContact,
});
if (
  planingHeave.elevation <= staticHeave.elevation + .018
  || polygonSupportedHeave.elevation
    <= unsupportedPlaningHeave.elevation + .008
) {
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
const matchedPoseContact = resolveSurfboardContactPatchOffsets({
  noseSurfaceOffset: .1,
  tailSurfaceOffset: -.1,
  rightRailSurfaceOffset: .1,
  leftRailSurfaceOffset: -.1,
  pitchAngle: -Math.asin(.1),
  rollAngle: Math.asin(.4),
  halfLength: 1,
  halfWidth: .25,
});
const leanedFlatContact = resolveSurfboardContactPatchOffsets({
  noseSurfaceOffset: 0,
  tailSurfaceOffset: 0,
  rightRailSurfaceOffset: 0,
  leftRailSurfaceOffset: 0,
  pitchAngle: 0,
  rollAngle: Math.asin(.4),
  halfLength: 1,
  halfWidth: .25,
});
if (
  Math.abs(tiltedRailContact.crossSlope - .4) > 1e-9
  || Math.abs(tiltedRailContact.railWarp) > 1e-9
  || Math.abs(crownedRailContact.crossSlope) > 1e-9
  || Math.abs(crownedRailContact.railWarp - .06) > 1e-9
  || Object.values(matchedPoseContact).some((offset) => (
    Math.abs(offset) > 1e-9
  ))
  || Math.abs(leanedFlatContact.rightRailSurfaceOffset + .1) > 1e-9
  || Math.abs(leanedFlatContact.leftRailSurfaceOffset - .1) > 1e-9
) {
  throw new Error("Hull patches no longer resolve polygon slope, warp, and current board pose independently");
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
function integratedPopUpEffort(hz, load = {}) {
  const duration = evaluatePopUpTransition(0, 100).duration;
  let elapsed = 0;
  let effort = 0;
  while (elapsed < duration - 1e-9) {
    const deltaSeconds = Math.min(1 / hz, duration - elapsed);
    const transition = evaluatePopUpTransition(
      elapsed + deltaSeconds * .5,
      100,
    );
    effort -= popUpStaminaDelta({
      deltaSeconds,
      handLoad: transition.handLoad,
      rearFootLoad: transition.rearFootLoad,
      frontFootLoad: transition.frontFootLoad,
      footImpact: transition.footImpact,
      centerOfMassHeight: transition.centerOfMassHeight,
      balanceError: load.balanceError ?? .08,
      crossWaveLoad: load.crossWaveLoad ?? 0,
      rollCapsizeRisk: load.rollCapsizeRisk ?? .02,
      pitchOverRisk: load.pitchOverRisk ?? .02,
    });
    elapsed += deltaSeconds;
  }
  return effort;
}
const quietPopUpEffort60 = integratedPopUpEffort(60);
const quietPopUpEffort120 = integratedPopUpEffort(120);
const loadedPopUpEffort = integratedPopUpEffort(60, {
  balanceError: .72,
  crossWaveLoad: 1.1,
  rollCapsizeRisk: .62,
  pitchOverRisk: .38,
});
function dynamicPopUp(hz, load = {}) {
  let state = {
    progress: 0,
    velocity: 0,
  };
  let reading = null;
  let elapsed = 0;
  while (state.progress < 1 && elapsed < 3) {
    reading = advancePopUpBodyTransition(state, {
      deltaSeconds: 1 / hz,
      stamina: load.stamina ?? 100,
      rollAngle: load.rollAngle ?? 0,
      rollRate: load.rollRate ?? 0,
      pitchAngle: load.pitchAngle ?? 0,
      pitchRate: load.pitchRate ?? 0,
      crossWaveLoad: load.crossWaveLoad ?? 0,
      balanceError: load.balanceError ?? 0,
      waterContact: load.waterContact ?? 1,
    });
    state = {
      progress: reading.progress,
      velocity: reading.velocity,
    };
    elapsed += 1 / hz;
  }
  return {
    ...reading,
    elapsed,
  };
}
const quietDynamicPopUp60 = dynamicPopUp(60);
const quietDynamicPopUp30 = dynamicPopUp(30);
const quietDynamicPopUp120 = dynamicPopUp(120);
const tiredDynamicPopUp = dynamicPopUp(60, {
  stamina: 8,
});
const loadedDynamicPopUp = dynamicPopUp(60, {
  rollAngle: .36,
  rollRate: 1.35,
  pitchAngle: -.25,
  pitchRate: -.9,
  crossWaveLoad: .92,
  balanceError: .62,
  waterContact: .88,
});
const dryDynamicPopUp = dynamicPopUp(60, {
  waterContact: 0,
});
if (
  popUpStart.progress !== 0
  || popUpHandPlant.handLoad < .45
  || popUpFootPlant.footImpact < .35
  || popUpStanding.progress < .99
  || popUpStanding.frontFootLoad < .95
  || popUpStanding.footSupport < .95
  || noseHeavyPopUp.trim < .5
  || tailHeavyPopUp.trim > -.45
  || popUpStanding.placementRisk !== 0
  || noseHeavyPopUp.placementRisk < .5
  || noseHeavyPopUp.stabilityScale
    >= popUpStanding.stabilityScale - .08
  || forwardPopUpPlacement60 < .08
  || Math.abs(
    forwardPopUpPlacement60 - forwardPopUpPlacement120,
  ) > .012
  || popUpStanding.stabilityScale >= popUpStart.stabilityScale
  || tiredPopUp.progress >= popUpStanding.progress
  || popUpStaminaDelta({
    deltaSeconds: 0,
    handLoad: 1,
    rearFootLoad: 1,
    frontFootLoad: 1,
    footImpact: 1,
    centerOfMassHeight: 1,
    balanceError: 2,
    crossWaveLoad: 1.5,
    rollCapsizeRisk: 1,
    pitchOverRisk: 1,
  }) !== 0
  || quietPopUpEffort60 < .45
  || Math.abs(quietPopUpEffort60 - quietPopUpEffort120) > .004
  || loadedPopUpEffort <= quietPopUpEffort60 * 1.2
  || quietDynamicPopUp60.progress < 1
  || quietDynamicPopUp60.elapsed < .68
  || quietDynamicPopUp60.elapsed > 1
  || Math.abs(
    quietDynamicPopUp60.elapsed - quietDynamicPopUp30.elapsed,
  ) > .04
  || Math.abs(
    quietDynamicPopUp60.elapsed - quietDynamicPopUp120.elapsed,
  ) > 1 / 60 + 1e-9
  || tiredDynamicPopUp.elapsed <= quietDynamicPopUp60.elapsed * 1.25
  || loadedDynamicPopUp.elapsed <= quietDynamicPopUp60.elapsed * 1.18
  || loadedDynamicPopUp.movementAuthority
    >= quietDynamicPopUp60.movementAuthority
  || dryDynamicPopUp.progress < 1
  || dryDynamicPopUp.elapsed > 1
) {
  throw new Error("Pop-up body loads no longer drive continuous, frame-rate-stable movement, placement, and muscular effort");
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
const proneSupportInitial = {
  roll: { rollAngle: .08, rollRate: .12 },
  pitch: { pitchAngle: -.04, pitchRate: .08 },
  heave: {
    elevation: staticHeave.elevation,
    verticalVelocity: staticHeave.verticalVelocity,
    previousSurfaceHeight: 0,
    waterContact: 1,
  },
};
const unsupportedProneFace = advanceProneBoardAttitude(
  proneSupportInitial,
  {
    ...proneSample,
    waveContact: .82,
    wavePatchContact: 0,
  },
);
const supportedProneFace = advanceProneBoardAttitude(
  proneSupportInitial,
  {
    ...proneSample,
    waveContact: .82,
    wavePatchContact: 1,
  },
);
if (
  supportedProneFace.heave.verticalAcceleration
    <= unsupportedProneFace.heave.verticalAcceleration + .05
  || supportedProneFace.roll.rollAngle
    !== unsupportedProneFace.roll.rollAngle
  || supportedProneFace.pitch.pitchAngle
    !== unsupportedProneFace.pitch.pitchAngle
) {
  throw new Error("Prone face-patch support no longer changes heave without rewriting roll or pitch contact");
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
  waterContact: 1,
});
const broadsideProneFailure = evaluateProneBoardFailure({
  capsizeRisk: broadsideProne.roll.capsizeRisk,
  pitchOverRisk: broadsideProne.pitch.pitchOverRisk,
  crossWaveLoad: 1.18,
  whitewater: .42,
  waveEnergy: .7,
  waterContact: 1,
});
const noseLoadedProneFailure = evaluateProneBoardFailure({
  capsizeRisk: noseLoadedProne.roll.capsizeRisk,
  pitchOverRisk: .94,
  crossWaveLoad: .28,
  whitewater: .08,
  waveEnergy: .68,
  waterContact: 1,
});
const detachedProneFailure = evaluateProneBoardFailure({
  capsizeRisk: .08,
  pitchOverRisk: .06,
  crossWaveLoad: 1.5,
  whitewater: 1,
  waveEnergy: .9,
  waterContact: 0,
});
const marginalRawProneFailure = evaluateProneBoardFailure({
  capsizeRisk: .93,
  pitchOverRisk: .12,
  crossWaveLoad: .25,
  whitewater: .08,
  waveEnergy: .5,
  waterContact: 1,
});
const marginalGuidedProneFailure = evaluateProneBoardFailure(
  {
    capsizeRisk: .93,
    pitchOverRisk: .12,
    crossWaveLoad: .25,
    whitewater: .08,
    waveEnergy: .5,
    waterContact: 1,
  },
  SURF_ASSIST_PROFILES.guided.failureMargin,
);
const severeGuidedProneFailure = evaluateProneBoardFailure(
  {
    capsizeRisk: .995,
    pitchOverRisk: .2,
    crossWaveLoad: 1.2,
    whitewater: .8,
    waveEnergy: .9,
    waterContact: 1,
  },
  SURF_ASSIST_PROFILES.guided.failureMargin,
);
if (
  settledProneFailure.failed
  || !broadsideProneFailure.failed
  || !noseLoadedProneFailure.failed
  || detachedProneFailure.failed
  || detachedProneFailure.load > .1
  || broadsideProneFailure.power <= settledProneFailure.power
  || !marginalRawProneFailure.failed
  || marginalGuidedProneFailure.failed
  || !severeGuidedProneFailure.failed
) {
  throw new Error("Prone separation no longer distinguishes stable, contacting, detached, rail, and nose states");
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
const sharedBodyReleaseSample = {
  compression: .92,
  extensionSpeed: 1.6,
  tailPressure: .62,
  lipSupport: liveLipSupport,
  speed: 12.4,
  planing: .88,
  waterContact: .94,
  boardLength: 2.1,
  railInput: .68,
  facePosition: .54,
  linePosition: .1,
  boardTurn: 1.15,
};
const standingBodyRelease = resolveSurfboardBodyRelease(
  sharedBodyReleaseSample,
);
const engagedBodyRelease = resolveSurfboardBodyRelease(
  sharedBodyReleaseSample,
);
const flatBodyRelease = resolveSurfboardBodyRelease({
  ...sharedBodyReleaseSample,
  lipSupport: flatLipSupport,
  facePosition: -.1,
});
const disconnectedBodyRelease = resolveSurfboardBodyRelease({
  ...sharedBodyReleaseSample,
  lipSupport: disconnectedLipSupport,
  waterContact: 0,
});
if (
  !standingBodyRelease
  || JSON.stringify(standingBodyRelease) !== JSON.stringify(engagedBodyRelease)
  || standingBodyRelease.family !== "air"
  || Math.abs(standingBodyRelease.verticalImpulse - lipReleaseImpulse) > 1e-9
  || Math.abs(standingBodyRelease.yawImpulse - performanceYawRelease) > 1e-9
  || flatBodyRelease !== null
  || disconnectedBodyRelease !== null
) {
  throw new Error("Physical board release is no longer identical across engagement classification or geometry-gated");
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
  noseIntoWallAlignment: 1,
});
const earlyDiveInitiation = resolveDuckDiveInitiation({
  secondsToImpact: 1.4,
  shorebreakPower: .82,
  stamina: 88,
  noseIntoWallAlignment: 1,
});
const flatWaterDiveInitiation = resolveDuckDiveInitiation({
  secondsToImpact: 0,
  shorebreakPower: 0,
  stamina: 88,
  noseIntoWallAlignment: 1,
});
const broadsideDiveInitiation = resolveDuckDiveInitiation({
  secondsToImpact: .3,
  shorebreakPower: .82,
  stamina: 88,
  noseIntoWallAlignment: 0,
});
const prepareDiveCue = readDuckDiveCue(.79, .82);
const actionableDiveCue = readDuckDiveCue(.78, .82);
const weakWallDiveCue = readDuckDiveCue(.6, .04);
const cueReactionDive = resolveDuckDiveInitiation({
  secondsToImpact: .58,
  shorebreakPower: .82,
  stamina: 88,
  noseIntoWallAlignment: 1,
});
const guidedEarlyDive = resolveDuckDiveInitiation({
  secondsToImpact: .9,
  shorebreakPower: .82,
  stamina: 88,
  noseIntoWallAlignment: 1,
  timingWindowScale:
    SURF_ASSIST_PROFILES.guided.duckDiveWindowScale,
});
const rawEarlyDive = resolveDuckDiveInitiation({
  secondsToImpact: .9,
  shorebreakPower: .82,
  stamina: 88,
  noseIntoWallAlignment: 1,
});
const cueReactionSubmersion = duckDiveSubmersionAt(.58);
const lateDiveSubmersion = duckDiveSubmersionAt(.02);
const timedDiveSubmersion = duckDiveSubmersionAt(.3);
function shorebreakPass(
  hz,
  submersion,
  diveQuality,
  exposureScale = 1,
) {
  let state = {
    velocityX: 0,
    velocityZ: -2,
  };
  let staminaCost = 0;
  let peakImpact = 0;
  const duration = 1.4;
  const frames = Math.round(duration * hz);
  for (let frame = 0; frame < frames; frame += 1) {
    const progress = (frame + .5) / frames;
    const reading = advanceProneShorebreakResponse(
      state,
      {
        deltaSeconds: 1 / hz,
        intensity: Math.sin(progress * Math.PI) * .82,
        power: .82,
        waveNormalX: 0,
        waveNormalZ: 1,
        currentVelocityX: .15,
        currentVelocityZ: 0,
        submersion,
        diveQuality,
        exposureScale,
      },
    );
    state = reading;
    staminaCost += reading.staminaCost;
    peakImpact = Math.max(peakImpact, reading.impactLoad);
  }
  return {
    ...state,
    staminaCost,
    peakImpact,
  };
}
const exposedShorebreak60 = shorebreakPass(60, 0, 0);
const exposedShorebreak120 = shorebreakPass(120, 0, 0);
const cleanDiveShorebreak60 = shorebreakPass(60, .82, .95);
const cleanDiveShorebreak120 = shorebreakPass(
  120,
  .82,
  .95,
);
const guidedExposedShorebreak60 = shorebreakPass(
  60,
  0,
  0,
  SURF_ASSIST_PROFILES.guided.shorebreakExposure,
);
const zeroShorebreakResponse =
  advanceProneShorebreakResponse(
    { velocityX: .4, velocityZ: -1.2 },
    {
      deltaSeconds: 1 / 60,
      intensity: 0,
      power: .82,
      waveNormalX: 0,
      waveNormalZ: 1,
      currentVelocityX: .15,
      currentVelocityZ: 0,
      submersion: 0,
      diveQuality: 0,
    },
  );
if (
  optimalDiveInitiation.timingQuality < .99
  || optimalDiveInitiation.quality < .99
  || broadsideDiveInitiation.timingQuality < .99
  || broadsideDiveInitiation.orientationQuality !== 0
  || broadsideDiveInitiation.quality !== 0
  || prepareDiveCue !== "prepare"
  || actionableDiveCue !== "dive"
  || weakWallDiveCue !== "clear"
  || cueReactionDive.quality < .6
  || guidedEarlyDive.quality <= rawEarlyDive.quality * 1.45
  || cueReactionSubmersion < .99
  || earlyDiveInitiation.timingQuality !== 0
  || flatWaterDiveInitiation.timingQuality !== 0
  || flatWaterDiveInitiation.effortCost <= 0
  || lateDiveSubmersion >= .1
  || timedDiveSubmersion < .7
  || exposedShorebreak60.velocityZ <= 1
  || cleanDiveShorebreak60.velocityZ >= .8
  || exposedShorebreak60.velocityZ
    - cleanDiveShorebreak60.velocityZ <= 1
  || exposedShorebreak60.staminaCost
    <= cleanDiveShorebreak60.staminaCost * 2
  || guidedExposedShorebreak60.staminaCost
    >= exposedShorebreak60.staminaCost * .82
  || guidedExposedShorebreak60.peakImpact <= .2
  || Math.abs(
    exposedShorebreak60.velocityZ
      - exposedShorebreak120.velocityZ,
  ) > .045
  || Math.abs(
    cleanDiveShorebreak60.velocityZ
      - cleanDiveShorebreak120.velocityZ,
  ) > .045
  || zeroShorebreakResponse.velocityX !== .4
  || zeroShorebreakResponse.velocityZ !== -1.2
  || zeroShorebreakResponse.staminaCost !== 0
) {
  throw new Error("Duck diving no longer reduces continuous, frame-rate-stable whitewater exposure");
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
      turningAuthority: sample.turningAuthority,
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
const performancePaddleTurn120Hz = paddleForFrames(240, {
  ...paddlingSample,
  deltaSeconds: 1 / 120,
  steer: 1,
});
const longboardPaddleTurn = paddleForFrames(120, {
  ...paddlingSample,
  steer: 1,
  boardLength: 3.45,
  boardWidth: .43,
  boardTurn: .82,
});
const guidedPaddleTurn = paddleForFrames(120, {
  ...paddlingSample,
  steer: 1,
  turningAuthority:
    SURF_ASSIST_PROFILES.guided.paddleTurnAuthority,
});
if (
  Math.abs(performancePaddleTurn.heading) < .5
  || Math.abs(longboardPaddleTurn.heading) >= Math.abs(performancePaddleTurn.heading) * .78
  || Math.abs(
    performancePaddleTurn.heading
      - performancePaddleTurn120Hz.heading,
  ) > .018
  || Math.abs(guidedPaddleTurn.heading)
    <= Math.abs(performancePaddleTurn.heading) * 1.18
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
function accumulatedPaddleWork(hz, seconds = 2.5) {
  let workCycle = { phase: 0 };
  let workState = {
    velocityX: 0,
    velocityZ: 0,
    heading: 0,
    yawRate: 0,
  };
  let leftWork = 0;
  let rightWork = 0;
  const frames = Math.round(seconds * hz);
  for (let frame = 0; frame < frames; frame += 1) {
    const cycle = advancePaddleStrokeCycle(workCycle, {
      deltaSeconds: 1 / hz,
      effort: 1,
      steer: 0,
      stamina: 82,
    });
    workCycle = cycle;
    const dynamics = advancePaddleboardDynamics(workState, {
      ...paddlingSample,
      deltaSeconds: 1 / hz,
      stroke: cycle.drive,
      strokeSide: cycle.strokeSide,
    });
    workState = dynamics;
    const work = paddleStrokeWorkDelta({
      strokeForce: dynamics.strokeForce,
      strokeSide: cycle.strokeSide,
      deltaSeconds: 1 / hz,
    });
    leftWork += work.leftWork;
    rightWork += work.rightWork;
  }
  return {
    leftWork,
    rightWork,
    totalWork: leftWork + rightWork,
  };
}
const paddleWork60 = accumulatedPaddleWork(60);
const paddleWork30 = accumulatedPaddleWork(30);
const paddleWork120 = accumulatedPaddleWork(120);
const airbornePaddleWork = paddleStrokeWorkDelta({
  strokeForce: dryProne.strokeForce,
  strokeSide: -1,
  deltaSeconds: 1 / 60,
});
const submergedPaddleWork = paddleStrokeWorkDelta({
  strokeForce: submergedStrokeAtSpeed.strokeForce,
  strokeSide: 1,
  deltaSeconds: 1 / 60,
});
const weakBoardStroke = advancePaddleboardDynamics(
  { velocityX: 0, velocityZ: 0, heading: 0, yawRate: 0 },
  {
    ...paddlingSample,
    stroke: .8,
    strokeSide: -1,
    paddleEfficiency: .55,
  },
);
const strongBoardStroke = advancePaddleboardDynamics(
  { velocityX: 0, velocityZ: 0, heading: 0, yawRate: 0 },
  {
    ...paddlingSample,
    stroke: .8,
    strokeSide: -1,
    paddleEfficiency: 1.3,
  },
);
const weakBoardPaddleWork = paddleStrokeWorkDelta({
  strokeForce: weakBoardStroke.strokeForce,
  strokeSide: -1,
  deltaSeconds: 1 / 60,
});
const strongBoardPaddleWork = paddleStrokeWorkDelta({
  strokeForce: strongBoardStroke.strokeForce,
  strokeSide: -1,
  deltaSeconds: 1 / 60,
});
if (
  paddleWork60.leftWork < .28
  || paddleWork60.rightWork < .28
  || Math.abs(paddleWork60.leftWork - paddleWork30.leftWork) > .03
  || Math.abs(paddleWork60.rightWork - paddleWork30.rightWork) > .03
  || Math.abs(paddleWork60.leftWork - paddleWork120.leftWork) > .015
  || Math.abs(paddleWork60.rightWork - paddleWork120.rightWork) > .015
  || airbornePaddleWork.totalWork !== 0
  || submergedPaddleWork.totalWork !== 0
  || strongBoardPaddleWork.totalWork
    <= weakBoardPaddleWork.totalWork * 1.2
) {
  throw new Error(
    `Tutorial paddle work no longer follows resolved, frame-rate-stable hydrodynamic pull force: ${JSON.stringify({
      paddleWork60,
      paddleWork120,
      airbornePaddleWork: airbornePaddleWork.totalWork,
      submergedPaddleWork: submergedPaddleWork.totalWork,
      weakBoardPaddleWork: weakBoardPaddleWork.totalWork,
      strongBoardPaddleWork: strongBoardPaddleWork.totalWork,
    })}`,
  );
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
const wideLeftTurningPull = advancePaddleboardDynamics(
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
    steer: 1,
  },
);
const coastingSteer = advancePaddleboardDynamics(
  {
    velocityX: 0,
    velocityZ: 1.4,
    heading: 0,
    yawRate: 0,
  },
  {
    ...paddlingSample,
    stroke: 0,
    strokeSide: -1,
    steer: 1,
  },
);
function stationaryScullAfter(
  hz,
  seconds = 1.2,
) {
  let state = {
    velocityX: 0,
    velocityZ: 0,
    heading: 0,
    yawRate: 0,
  };
  const frames = Math.round(hz * seconds);
  for (let frame = 0; frame < frames; frame += 1) {
    state = advancePaddleboardDynamics(state, {
      ...paddlingSample,
      deltaSeconds: 1 / hz,
      stroke: 0,
      steer: 1,
    });
  }
  return state;
}
const stationaryScull60 = stationaryScullAfter(60);
const stationaryScull120 = stationaryScullAfter(120);
if (
  leftHandPull.yawRate <= 0
  || rightHandPull.yawRate >= 0
  || leftHandPull.strokeYawAcceleration <= 0
  || rightHandPull.strokeYawAcceleration >= 0
  || Math.abs(wideLeftTurningPull.paddleHandLever)
    <= Math.abs(leftHandPull.paddleHandLever) * 3
  || Math.abs(wideLeftTurningPull.strokeYawAcceleration)
    <= Math.abs(leftHandPull.strokeYawAcceleration) * 3
  || coastingSteer.strokeYawAcceleration !== 0
  || coastingSteer.scullYawAcceleration >= -.1
  || coastingSteer.yawRate >= 0
  || Math.abs(stationaryScull60.heading) < .48
  || Math.hypot(
    stationaryScull60.velocityX,
    stationaryScull60.velocityZ,
  ) > .001
  || Math.abs(
    stationaryScull60.heading
      - stationaryScull120.heading,
  ) > .012
) {
  throw new Error(
    "Prone paddle yaw no longer combines planted-hand leverage with low-speed sculling",
  );
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
const stillWaterHeadingTarget = resolvePaddleHeadingTarget({
  boardHeading: .4,
  desiredDirectionX: Math.sin(.9),
  desiredDirectionZ: Math.cos(.9),
  desiredGroundSpeed: 2.4,
  currentVelocityX: 0,
  currentVelocityZ: 0,
});
const crossCurrentHeadingTarget =
  resolvePaddleHeadingTarget({
    boardHeading: Math.PI,
    desiredDirectionX: 0,
    desiredDirectionZ: -1,
    desiredGroundSpeed: 2.4,
    currentVelocityX: .8,
    currentVelocityZ: 0,
  });
const crossCurrentRequiredSpeed = Math.hypot(
  -.8,
  -2.4,
);
const compensatedGroundVelocityX =
  crossCurrentHeadingTarget.targetDirectionX
    * crossCurrentRequiredSpeed
    + .8;
const compensatedGroundVelocityZ =
  crossCurrentHeadingTarget.targetDirectionZ
    * crossCurrentRequiredSpeed;
const wrappedGuide = stabilizeHeadingGuideDegrees(
  179,
  -179,
);
const deadbandGuide =
  stabilizeHeadingGuideDegrees(
    12,
    13.1,
  );
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
  || Math.abs(
    stillWaterHeadingTarget.headingError - .5,
  ) > 1e-9
  || Math.abs(
    stillWaterHeadingTarget.currentCompensationDegrees,
  ) > 1e-9
  || crossCurrentHeadingTarget.targetDirectionX >= 0
  || crossCurrentHeadingTarget
    .currentCompensationDegrees < 10
  || Math.abs(compensatedGroundVelocityX) > 1e-9
  || Math.abs(compensatedGroundVelocityZ + 2.4) > 1e-9
  || wrappedGuide < 179
  || wrappedGuide > 181
  || deadbandGuide !== 12
) {
  throw new Error("Physical paddle training guidance no longer matches ground track, current, hand cycle, or hull load");
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
const passiveCompressionSample = {
  railLoad: .62,
  stance: -.4,
  longitudinalAcceleration: -.35,
  lateralAcceleration: .42,
  tubePressure: .5,
  whitewaterPressure: .3,
  balanceError: .2,
  crossWaveLoad: .55,
};
const standingPassiveCompression = resolveSurferPassiveCompression(
  passiveCompressionSample,
);
const engagedPassiveCompression = resolveSurferPassiveCompression(
  passiveCompressionSample,
);
const quietPassiveCompression = resolveSurferPassiveCompression({
  railLoad: 0,
  stance: 0,
  longitudinalAcceleration: 0,
  lateralAcceleration: 0,
  tubePressure: 0,
  whitewaterPressure: 0,
  balanceError: 0,
  crossWaveLoad: 0,
});
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
  || standingPassiveCompression !== engagedPassiveCompression
  || standingPassiveCompression < .45
  || quietPassiveCompression !== 0
) {
  throw new Error("Surfer compression no longer behaves consistently across frame rate, water load, and engagement classification");
}
function counterweightAfter({
  hz,
  seconds,
  intent,
  support = 1,
  stamina = 100,
  centerOfMassHeight = 1,
  bodyCompression = 0,
  boardRollAngle = 0,
  boardRollRate = 0,
}) {
  let state = { counterweight: 0, velocity: 0 };
  const frames = Math.round(seconds * hz);
  for (let frame = 0; frame < frames; frame += 1) {
    state = advanceSurferCounterweightDynamics(state, {
      deltaSeconds: 1 / hz,
      intent,
      support,
      stamina,
      centerOfMassHeight,
      bodyCompression,
      boardRollAngle,
      boardRollRate,
    });
  }
  return state;
}
const standingCounterweight60 = counterweightAfter({
  hz: 60,
  seconds: 1,
  intent: .8,
});
const standingCounterweight120 = counterweightAfter({
  hz: 120,
  seconds: 1,
  intent: .8,
});
const fatiguedCounterweight = counterweightAfter({
  hz: 60,
  seconds: .35,
  intent: .8,
  stamina: 5,
});
const freshCounterweight = counterweightAfter({
  hz: 60,
  seconds: .35,
  intent: .8,
});
const rolledCounterweight = counterweightAfter({
  hz: 60,
  seconds: .6,
  intent: 0,
  boardRollAngle: .3,
  boardRollRate: .5,
});
const mirroredRolledCounterweight = counterweightAfter({
  hz: 60,
  seconds: .6,
  intent: 0,
  boardRollAngle: -.3,
  boardRollRate: -.5,
});
const compressedRolledCounterweight = counterweightAfter({
  hz: 60,
  seconds: .6,
  intent: 0,
  bodyCompression: .8,
  boardRollAngle: .3,
  boardRollRate: .5,
});
if (
  standingCounterweight60.counterweight < .76
  || standingCounterweight60.counterweight > .84
  || Math.abs(
    standingCounterweight60.counterweight
      - standingCounterweight120.counterweight
  ) > .001
  || fatiguedCounterweight.counterweight
    >= freshCounterweight.counterweight - .12
  || rolledCounterweight.counterweight >= -.03
  || Math.abs(
    rolledCounterweight.counterweight
      + mirroredRolledCounterweight.counterweight
  ) > .001
  || Math.abs(compressedRolledCounterweight.counterweight)
    >= Math.abs(rolledCounterweight.counterweight) * .8
) {
  throw new Error("Surfer counterweight no longer has frame-stable body lag, fatigue, mirrored sway, and compression response");
}
function coupledStillWaterBalance(
  hz,
  followsTarget,
  riderHeight = .92,
) {
  let roll = { rollAngle: .12, rollRate: 0 };
  let body = { counterweight: 0, velocity: 0 };
  let balanceTarget = 0;
  let maximumRoll = Math.abs(roll.rollAngle);
  for (let frame = 0; frame < hz * 3; frame += 1) {
    body = advanceSurferCounterweightDynamics(body, {
      deltaSeconds: 1 / hz,
      intent: followsTarget ? balanceTarget : 0,
      support: 1,
      stamina: 100,
      centerOfMassHeight: 1,
      bodyCompression: 0,
      boardRollAngle: roll.rollAngle,
      boardRollRate: roll.rollRate,
    });
    roll = advanceBoardRollDynamics(roll, {
      deltaSeconds: 1 / hz,
      railInput: 0,
      counterweight: body.counterweight,
      crossSlope: .08,
      lateralAcceleration: 0,
      crossWaveLoad: 0,
      crossWaveSide: 1,
      turbulenceTorque: 0,
      speed: 0,
      planing: 0,
      boardWidth: .34,
      boardStability: 1,
      riderHeight,
      whitewater: 0,
      waterContact: 1,
    });
    balanceTarget = roll.balanceTarget;
    maximumRoll = Math.max(maximumRoll, Math.abs(roll.rollAngle));
  }
  return { roll, body, balanceTarget, maximumRoll };
}
const unattendedStillWaterBalance = coupledStillWaterBalance(60, false);
const crouchedStillWaterBalance = coupledStillWaterBalance(
  60,
  false,
  .4,
);
const correctedStillWaterBalance60 = coupledStillWaterBalance(60, true);
const correctedStillWaterBalance30 = coupledStillWaterBalance(30, true);
const correctedStillWaterBalance120 = coupledStillWaterBalance(120, true);
if (
  unattendedStillWaterBalance.maximumRoll < .45
  || crouchedStillWaterBalance.maximumRoll
    >= unattendedStillWaterBalance.maximumRoll * .9
  || correctedStillWaterBalance60.maximumRoll > .16
  || Math.abs(
    correctedStillWaterBalance60.roll.rollAngle
      - correctedStillWaterBalance30.roll.rollAngle
  ) > .005
  || Math.abs(correctedStillWaterBalance60.roll.rollAngle) > .08
  || Math.abs(
    correctedStillWaterBalance60.roll.rollAngle
      - correctedStillWaterBalance120.roll.rollAngle
  ) > .002
) {
  throw new Error("Still-water body inertia no longer requires and rewards frame-stable counterweight correction");
}
function simulateReturnProne(hz) {
  let progress = 0;
  let reading = null;
  let elapsed = 0;
  let peakHandSupport = 0;
  let minimumVerticalLoad = 0;
  let halfwayFootSupport = 1;
  for (let frame = 0; frame < hz * 2; frame += 1) {
    reading = advanceReturnProneTransition(progress, {
      deltaSeconds: 1 / hz,
      requested: frame === 0,
    });
    progress = reading.progress;
    elapsed += 1 / hz;
    peakHandSupport = Math.max(peakHandSupport, reading.handSupport);
    minimumVerticalLoad = Math.min(
      minimumVerticalLoad,
      reading.verticalLoadAcceleration,
    );
    if (progress >= .5 && halfwayFootSupport === 1) {
      halfwayFootSupport = reading.footSupport;
    }
    if (reading.completed) break;
  }
  return {
    reading,
    elapsed,
    peakHandSupport,
    minimumVerticalLoad,
    halfwayFootSupport,
  };
}
const returnProne60 = simulateReturnProne(60);
const returnProne120 = simulateReturnProne(120);
if (
  !returnProne60.reading?.completed
  || !returnProne120.reading?.completed
  || returnProne60.elapsed < .84
  || returnProne60.elapsed > .89
  || Math.abs(returnProne60.elapsed - returnProne120.elapsed) > .018
  || returnProne60.peakHandSupport < .9
  || returnProne60.halfwayFootSupport >= .8
  || returnProne60.halfwayFootSupport <= .2
  || returnProne60.minimumVerticalLoad > -1.7
  || returnProne60.reading.footSupport !== 0
  || returnProne60.reading.counterweightAuthority > .43
) {
  throw new Error("Return-prone body weight no longer transfers progressively and consistently across frame rates");
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
  trainingProgression: {
    aligned: reachedSurfTrainingStep(alignedTrainingState),
    speedWithoutFace:
      reachedSurfTrainingStep(matchedWithoutFace),
    matchedLiveFace:
      reachedSurfTrainingStep(matchedLiveFaceTraining),
    unsupportedStanding:
      reachedSurfTrainingStep(unsupportedStandingTraining),
    supportedStanding:
      reachedSurfTrainingStep(supportedStandingTraining),
  },
  waveCalibration: {
    fiveSecondWavelength,
    tenSecondWavelength,
    twentySecondWavelength,
    shortPeriodCrestSpeed: shortPeriodTransport.speed,
    longPeriodCrestSpeed: longPeriodTransport.speed,
  },
  towFlotation: {
    berthZones: towBerthSurvey.length,
    minimumBerthDepth: Math.min(
      ...towBerthSurvey.map((survey) => survey.centerDepth),
    ),
    minimumBerthCollapse: Math.min(
      ...towBerthSurvey.map((survey) => survey.shoreCollapse),
    ),
    maximumInteractionDistance: Math.max(
      ...towBerthSurvey.map(
        (survey) => survey.interactionDistance,
      ),
    ),
    mavericksLegacyTowBerth,
    mavericksTowBerth,
    hossegorTowBerth,
    uluwatuTowBerth,
    movingBreakingRoute: {
      steady: movingTowHullSteady,
      stalled: movingTowHullStalled,
    },
    reversals: towHullReversals,
  },
  breakGeometry: {
    centerBreakCoordinate,
    peelingBreakCoordinate,
    peelingBreakGeometry,
    outsideProbeCoordinate,
    geometricGroundAlignment,
    enteredLineup,
    heldLineup,
    exitedLineup,
    outsideShorebreakLoad,
    heldLineupShorebreakLoad,
    peakShorebreakLoad,
  },
  idealTraining,
  marginalTraining,
  idealAdvanced,
  marginalAdvanced,
  insideReform,
  faceQuality: {
    early: earlyFace.quality,
    pocket: pocketFace.quality,
    late: lateFace.quality,
    supportedOpportunity: supportedTakeoffOpportunity,
    halfContactOpportunity: halfContactTakeoffOpportunity,
    unstableOpportunity: unstableTakeoffOpportunity,
    dryOpportunity: dryTakeoffOpportunity,
    idleTakeoffDrive,
    plantedHandTakeoffDrive,
    coastingTakeoffDrive,
    halfContactTakeoffDrive,
    slowTakeoffSpeedMatch,
    halfwayTakeoffSpeedMatch,
    matchedTakeoffSpeedMatch,
  },
  alignedProneEngagement,
  independentPopUpSeconds: independentPopUp.duration,
  endurance: {
    fiveMinutePaddleReserve,
  },
  captureLoss: {
    overtaken: overtakenCapture.overtaken,
    ahead: shoulderCapture.ahead,
    preservedPopUpOvertake:
      preservedPopUpCrest.overtaken,
    resetPopUpOvertake: resetPopUpCrest.overtaken,
    trackedCrestCue,
    overtakenCrestCue,
    aheadCrestCue,
    unsupportedLipOvertake: unsupportedCrestRelation.lipOvertake,
    unsupportedOvertaken: unsupportedCrestRelation.overtaken,
    unsupportedAhead: unsupportedCrestRelation.ahead,
  },
  waveEngagement: {
    sustained: sustainedEngagement.engagement,
    sustained30Hz: sustainedEngagement30.engagement,
    sustained120Hz: sustainedEngagement120.engagement,
    briefPressurePulse: briefPressurePulse.engagement,
    misaligned: misalignedEngagement.engagement,
    released: releasedEngagement.engagement,
  },
  boardWater: {
    alignedCapture: alignedBoard.capture,
    broadsideLoad: broadsideBoard.crossWaveLoad,
    broadsideWipeoutRisk: broadsideBoard.wipeoutRisk,
    alignedWavePressure: alignedWavePressure.forwardDrive,
    broadsideWaveLoad: Math.abs(broadsideWavePressure.lateralLoad),
    symmetricHullPatchContact:
      symmetricFourPatchPressure.patchContact,
    asymmetricHullPatchContact:
      rightRailLoadedPressure.patchContact,
    detachedHullPatchContact:
      detachedFourPatchPressure.patchContact,
    stillWaterFaceSupport: stillWaterFaceSupport.patchContact,
    proneCatchSpeed60Hz: pressureCatch60.velocityZ,
    proneCatchSpeed120Hz: pressureCatch120.velocityZ,
    diagonalPressureTurn60Hz: diagonalTurn60.heading,
    diagonalPressureTurn120Hz: diagonalTurn120.heading,
    railPressureTurn60Hz: railPressureTurn60.heading,
    railPressureTurn120Hz: railPressureTurn120.heading,
    facePhaseSweep,
    longPeriodCrestDistance,
    detachedCrestPhase,
    pressureLockedCrestPhase,
    trackedCrestEnergy: trackedCrestProperties.energy,
    neighboringCrestEnergy: neighboringCrestProperties.energy,
    trackedCrestFoamDelta,
    neighboringCrestFoamDelta,
    calmSurfStaminaDelta,
    loadedSurfStaminaDelta,
    offshoreWallSeconds: offshoreWallApproach.secondsToImpact,
    offshoreWallClosingSpeed: offshoreWallApproach.relativeNormalSpeed,
    crossedWall: crossedWall.crossedCrest,
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
    diagonalTrim: {
      unsupportedLoad: unsupportedDiagonalTrim.crossWaveLoad,
      supportedLoad: supportedDiagonalTrim.crossWaveLoad,
      supportedCapture: supportedDiagonalTrim.capture,
      tangentOutcome: unsupportedTangentTrim.outcome,
    },
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
    standingWipeoutKineticImpact:
      standingWipeout.kineticImpact,
    engagedWipeoutPower: engagedWipeout.power,
    lightWipeoutPower: lightWipeout.power,
    lightWipeoutKineticImpact: lightWipeout.kineticImpact,
    broadsideTumbleRollRate: broadsideTumble.rollRate,
    alignedTumbleRollRate: alignedTumble.rollRate,
    pearlingTumblePitchRate: pearlingTumble.pitchRate,
    tumbleRoll60Hz: tumble60.roll,
    tumbleRoll30Hz: tumble30.roll,
    tumbleRoll120Hz: tumble120.roll,
    broadsideBodyRelease: standingFailureRelease,
    alignedBodyRelease: alignedFailureRelease,
    pearlingBodyRelease: pearlingFailureRelease,
    proneBodyRelease: proneFailureRelease,
    unsupportedBodyRelease: unsupportedFailureRelease,
    standingBodyFall60,
    standingBodyFall120,
    proneBodyFall,
    coupledTumble60,
    coupledTumble120,
    separatedHorizontal60,
    separatedHorizontal120,
    uprightVerticalFlow,
    uprightHorizontalFlow,
    rolledHorizontalFlow,
    streamlinedBodyDrag60,
    broadsideBodyDrag60,
    broadsideBodyDrag120,
    settledRecovery60,
    settledRecovery120,
    submergedRecovery,
    violentSurfaceRecovery,
    strongLipWash,
    trailingFoamWash,
    equalDistanceOpenFaceWash,
    airborneLooseBoard,
    flowingLooseBoard,
    looseBoardSplash60,
    looseBoardSplash120,
    spatialWashPassage60,
    spatialWashPassage120,
    stretchedLeash,
    longboardLeash,
    longLeashMaterial,
    lateralLeashTorque,
    longitudinalLeashTorque,
    verticalLeashTorque,
    longboardLeashTorque,
    longboardLongitudinalLeashTorque,
    leashCoupling60,
    leashCoupling120,
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
    preEngagementRelease: standingBodyRelease.family,
    engagedRelease: engagedBodyRelease.family,
    sharedReleaseImpulse: standingBodyRelease.verticalImpulse,
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
    performanceTurn120HzRadians:
      performancePaddleTurn120Hz.heading,
    longboardTurnRadians: longboardPaddleTurn.heading,
    neutralPullLever: leftHandPull.paddleHandLever,
    turningPullLever: wideLeftTurningPull.paddleHandLever,
    coastingScullYawAcceleration:
      coastingSteer.scullYawAcceleration,
    stationaryScullHeading:
      stationaryScull60.heading,
    averageStrokeDrive,
    paddleWork60,
    paddleWork30,
    paddleWork120,
    airbornePaddleWork: airbornePaddleWork.totalWork,
    submergedPaddleWork: submergedPaddleWork.totalWork,
    weakBoardPaddleWork: weakBoardPaddleWork.totalWork,
    strongBoardPaddleWork: strongBoardPaddleWork.totalWork,
    steeringImpulseDifference: steeringRightImpulse - steeringLeftImpulse,
    guideTurnDegrees: rightTurnLeftPullGuide.turnDegrees,
    guideActiveHand: rightTurnLeftPullGuide.activeHand,
    guideBroadsideMode: leftTurnBroadsideGuide.pressureMode,
    crossCurrentAim:
      crossCurrentHeadingTarget.currentCompensationDegrees,
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
    standingPassiveCompression,
    engagedPassiveCompression,
    quietPassiveCompression,
    standingCounterweight60Hz: standingCounterweight60.counterweight,
    standingCounterweight120Hz: standingCounterweight120.counterweight,
    freshCounterweightResponse: freshCounterweight.counterweight,
    fatiguedCounterweightResponse: fatiguedCounterweight.counterweight,
    rolledBodyLag: rolledCounterweight.counterweight,
    compressedBodyLag: compressedRolledCounterweight.counterweight,
    unattendedStillWaterRoll:
      unattendedStillWaterBalance.maximumRoll,
    crouchedStillWaterRoll:
      crouchedStillWaterBalance.maximumRoll,
    correctedStillWaterRoll60Hz:
      correctedStillWaterBalance60.maximumRoll,
    correctedStillWaterRoll30Hz:
      correctedStillWaterBalance30.maximumRoll,
    correctedStillWaterRoll120Hz:
      correctedStillWaterBalance120.maximumRoll,
    quietPopUpEffort60,
    quietPopUpEffort120,
    loadedPopUpEffort,
    quietDynamicPopUpSeconds60Hz: quietDynamicPopUp60.elapsed,
    quietDynamicPopUpSeconds30Hz: quietDynamicPopUp30.elapsed,
    quietDynamicPopUpSeconds120Hz: quietDynamicPopUp120.elapsed,
    tiredDynamicPopUpSeconds: tiredDynamicPopUp.elapsed,
    loadedDynamicPopUpSeconds: loadedDynamicPopUp.elapsed,
    loadedDynamicPopUpAuthority: loadedDynamicPopUp.movementAuthority,
    returnProneSeconds60Hz: returnProne60.elapsed,
    returnProneSeconds120Hz: returnProne120.elapsed,
    returnPronePeakHandSupport: returnProne60.peakHandSupport,
    returnProneHalfwayFootSupport: returnProne60.halfwayFootSupport,
    returnProneVerticalLoad: returnProne60.minimumVerticalLoad,
  },
  duckDiveDynamics: {
    optimalTiming: optimalDiveInitiation.timingQuality,
    optimalQuality: optimalDiveInitiation.quality,
    broadsideQuality: broadsideDiveInitiation.quality,
    earlyTiming: earlyDiveInitiation.timingQuality,
    idleEffortCost: flatWaterDiveInitiation.effortCost,
    lateSubmersion: lateDiveSubmersion,
    timedSubmersion: timedDiveSubmersion,
    exposedShorebreak60,
    exposedShorebreak120,
    cleanDiveShorebreak60,
    cleanDiveShorebreak120,
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
    unsupportedPlaningElevation: unsupportedPlaningHeave.elevation,
    polygonSupportedPlaningElevation: polygonSupportedHeave.elevation,
    unsupportedProneFaceAcceleration:
      unsupportedProneFace.heave.verticalAcceleration,
    supportedProneFaceAcceleration:
      supportedProneFace.heave.verticalAcceleration,
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
    detachedProneFailureLoad: detachedProneFailure.load,
    popUpDuration: popUpStanding.duration,
    popUpFootImpact: popUpFootPlant.footImpact,
    popUpNoseTrim: noseHeavyPopUp.trim,
    popUpTailTrim: tailHeavyPopUp.trim,
    popUpNosePlacementRisk: noseHeavyPopUp.placementRisk,
    popUpNosePlacementStability:
      noseHeavyPopUp.stabilityScale,
    popUpForwardPlacement60Hz: forwardPopUpPlacement60,
    popUpForwardPlacement120Hz: forwardPopUpPlacement120,
    tiltedRailSlope: tiltedRailContact.crossSlope,
    crownedRailWarp: crownedRailContact.railWarp,
  },
}, null, 2));
