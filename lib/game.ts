import type { MarineConditions } from "./marine";
import type { BreakCharacter } from "./beaches";

export type GameMode = "training" | "advanced" | "playground";
export type GamePhase = "shore" | "driving" | "wading" | "paddling" | "riding" | "wipeout";
export type SessionGrade = "C" | "B" | "A" | "S";
export type BoardType = "performance" | "fish" | "longboard";
export const SHORELINE_REFERENCE_Z = 8;
export const RIDE_RESULT_LINE_Z = SHORELINE_REFERENCE_Z - 9.2;
export const SHALLOW_DISMOUNT_Z = SHORELINE_REFERENCE_Z - 1.2;
export const OUTER_PADDLE_LIMIT_Z = -900;
export const MAX_OFFSHORE_DISTANCE = SHORELINE_REFERENCE_Z - OUTER_PADDLE_LIMIT_Z;
const WAVE_ENERGY_SEQUENCE = [
  .18, .42, .29, .76, .58, .23, .34, .88, .67,
  .51, .2, .27, .46, .37, .92, .33, .62,
] as const;
const SURFABLE_CREST_ENERGY = .28;

/**
 * One physical calibration shared by every mode. Training changes what the
 * player can see and learn, not how the same board, body, and water respond.
 */
export const SURF_PHYSICS_TUNING = {
  paddleRecovery: 1.55,
  paddleStrokeDrain: .19,
  takeoffOpportunityThreshold: .13,
  takeoffHeadingMinimum: -.1,
  shorebreakLead: 2.55,
  duckDiveTimingWindow: .78,
  duckDiveThreshold: .34,
  takeoffWindPenalty: .055,
  catchGrace: .7,
  tubeFatigue: 1.2,
  foamFatigue: 1,
  lipOvertakeFailure: 1.08,
  maneuverBalanceWindow: .52,
  balanceFailureThreshold: 1,
  rollFailure: .82,
  whitewaterFailure: .46,
  shoulderFailure: .075,
  tubeFailure: .11,
  broadsideFailure: .86,
  pearlingFailure: 2.3,
  pitchOverFailure: 2.75,
  tailStallFailure: .2,
  maneuverTiming: 1,
  wipeoutInstability: 1.42,
  capsizeWipeout: .9,
  pitchWipeout: .9,
  wipeoutHold: .94,
  landingImpactFailure: .44,
} as const;

export function paddlingStaminaDelta(
  effort: number,
  deltaSeconds: number,
) {
  const safeDelta = Math.max(0, Math.min(.25, deltaSeconds));
  const normalizedEffort = Math.max(0, Math.min(1, Math.abs(effort)));
  if (normalizedEffort <= .08) {
    return safeDelta * SURF_PHYSICS_TUNING.paddleRecovery;
  }
  // A surfer can sustain a long, steady paddle for several minutes. Stamina is
  // reserved for explosive takeoff strokes, duck dives, and maneuvers instead
  // of functioning like a short sprint meter.
  return -safeDelta
    * SURF_PHYSICS_TUNING.paddleStrokeDrain
    * (.38 + normalizedEffort * .62);
}

export type DuckDiveInitiationSample = {
  secondsToImpact: number;
  shorebreakPower: number;
  stamina: number;
};

export type DuckDiveInitiationReading = {
  timingQuality: number;
  duration: number;
  effortCost: number;
};

/**
 * Starts a duck dive whenever the surfer asks. This reports timing relative to
 * the incoming wall but never gates the action; actual success also requires
 * the board to have reached useful submersion when the wall arrives.
 */
export function resolveDuckDiveInitiation(
  sample: DuckDiveInitiationSample,
): DuckDiveInitiationReading {
  const secondsToImpact = Math.max(0, sample.secondsToImpact);
  const shorebreakPower = clampValue(sample.shorebreakPower, 0, 1);
  const staminaRatio = clampValue(sample.stamina, 0, 100) / 100;
  const incomingWall = shorebreakPower > .06 && secondsToImpact > 0;
  const timingQuality = incomingWall
    ? clampValue(
        1
          - Math.abs(secondsToImpact - .3)
            / SURF_PHYSICS_TUNING.duckDiveTimingWindow,
        0,
        1,
      )
    : 0;
  return {
    timingQuality,
    duration: 1.12,
    effortCost: .65
      + shorebreakPower * .6
      + (1 - staminaRatio) * .18,
  };
}

export function duckDiveSubmersionAt(
  elapsedSeconds: number,
  duration = 1.12,
) {
  const progress = clampValue(
    Math.max(0, elapsedSeconds) / Math.max(.1, duration),
    0,
    1,
  );
  return Math.sin(progress * Math.PI);
}

export function rideRailInputFromPaddleSteer(paddleSteer: number) {
  // The paddle heading frame and wave-tangent frame have opposite handedness.
  // Converting once here keeps left/right screen intent consistent in both.
  return -Math.max(-1, Math.min(1, paddleSteer));
}

/**
 * Integrates the surfer's fore-aft center of pressure. Wave engagement and
 * game mode do not change how quickly the same body input moves over the board.
 */
export function advanceSurfboardStance(
  currentStance: number,
  input: number,
  deltaSeconds: number,
  forcedCenter = false,
) {
  const delta = Math.max(0, Math.min(.05, deltaSeconds));
  const current = clampValue(currentStance, -1, 1);
  const intent = clampValue(input, -1, 1);
  if (forcedCenter) {
    return current * Math.exp(-4.8 * delta);
  }
  if (intent > .08) {
    return Math.min(1, current + delta * .72 * intent);
  }
  if (intent < -.08) {
    return Math.max(-1, current + delta * .86 * intent);
  }
  return current * Math.exp(-1.05 * delta);
}

export type SurferCompressionState = {
  compression: number;
  velocity: number;
};

export type SurferCompressionSample = {
  deltaSeconds: number;
  crouchIntent: number;
  stamina: number;
};

export type SurferCompressionReading = SurferCompressionState & {
  extensionSpeed: number;
  extensionPotentialSpeed: number;
  muscularEffort: number;
};

/**
 * Integrates the surfer's leg compression as a damped biomechanical degree of
 * freedom. The control asks the body to crouch or extend; it does not fill a
 * move meter. The resulting extension velocity can redirect the board only
 * through whatever water and lip support the hull is actually carrying.
 */
export function advanceSurferCompression(
  state: SurferCompressionState,
  sample: SurferCompressionSample,
): SurferCompressionReading {
  const delta = Math.max(0, Math.min(.05, sample.deltaSeconds));
  const staminaAuthority = .58
    + clampValue(sample.stamina, 0, 100) / 100 * .42;
  const crouchIntent = clampValue(sample.crouchIntent, 0, 1);
  const target = crouchIntent * .94;
  let compression = clampValue(state.compression, 0, 1);
  let velocity = clampValue(state.velocity, -4.2, 3.2);
  const extensionPotentialSpeed = crouchIntent <= .02
    ? clampValue(
        Math.max(0, -velocity)
          + compression * 4.2 * staminaAuthority,
        0,
        4.2 * staminaAuthority,
      )
    : 0;
  let remaining = delta;

  // Small internal steps keep the spring response equivalent at common browser
  // frame rates while retaining velocity for a real extension on release.
  while (remaining > 1e-6) {
    const step = Math.min(1 / 240, remaining);
    const response = (crouchIntent > .02 ? 10.5 : 13.5)
      * staminaAuthority;
    const acceleration = (target - compression) * response * response
      - velocity * response * 2;
    velocity = clampValue(
      velocity + acceleration * step,
      -4.2 * staminaAuthority,
      3.2 * staminaAuthority,
    );
    compression = clampValue(compression + velocity * step, 0, 1);
    if (
      (compression <= 0 && velocity < 0)
      || (compression >= 1 && velocity > 0)
    ) {
      velocity = 0;
    }
    remaining -= step;
  }

  const extensionSpeed = Math.max(0, -velocity);
  const muscularEffort = clampValue(
    compression * (.18 + crouchIntent * .48)
      + Math.abs(velocity) * .2,
    0,
    1,
  );
  return {
    compression,
    velocity,
    extensionSpeed,
    extensionPotentialSpeed,
    muscularEffort,
  };
}

export type WaveEngagementSample = {
  deltaSeconds: number;
  capture: number;
  waveContact: number;
  waterContact: number;
  headingAlignment: number;
  planing: number;
  crossWaveLoad: number;
};

export type WaveEngagementReading = {
  engagement: number;
  pressure: number;
  gainRate: number;
  releaseRate: number;
};

/**
 * Accumulates hydrodynamic wave engagement from sustained pressure instead of
 * flipping a ride state at a single capture threshold. Misalignment, rail
 * loading, and lost hull contact bleed pressure back out continuously.
 */
export function advanceWaveEngagement(
  engagement: number,
  sample: WaveEngagementSample,
): WaveEngagementReading {
  const delta = Math.max(0, Math.min(.05, sample.deltaSeconds));
  const current = Math.max(0, Math.min(1, engagement));
  const capture = Math.max(0, Math.min(1, sample.capture));
  const waveContact = Math.max(0, Math.min(1, sample.waveContact));
  const waterContact = Math.max(0, Math.min(1, sample.waterContact));
  const planing = Math.max(0, Math.min(1, sample.planing));
  const crossWaveLoad = Math.max(0, Math.min(1.5, sample.crossWaveLoad));
  const headingSupport = smoothstep(-.12, .58, sample.headingAlignment);
  const pressure = Math.max(
    0,
    Math.min(
      1,
      capture
        * (.42 + waveContact * .58)
        * (.15 + waterContact * .85)
        * (.72 + planing * .28)
        * headingSupport,
    ),
  );
  const gainRate = pressure
    * (.88 + pressure * .82)
    * (1 - current);
  const releaseRate = (1 - pressure)
    * (
      .34
        + crossWaveLoad * .22
        + (1 - waterContact) * .72
    )
    * current;
  return {
    engagement: Math.max(
      0,
      Math.min(1, current + (gainRate - releaseRate) * delta),
    ),
    pressure,
    gainRate,
    releaseRate,
  };
}

export type RideCaptureState = {
  overtaken: number;
  ahead: number;
};

/**
 * Measures trough-to-lip position directly from the board's phase on the
 * current polygon wave. This contains no steering, stance, score, or display
 * state, so a HUD smoothing filter cannot move the board up or down the face.
 */
export function waveFacePositionAtPhase(
  crestPhaseError: number,
  facePhaseSpan: number,
) {
  const safeSpan = Math.max(.24, facePhaseSpan);
  return Math.max(
    -1,
    Math.min(
      1,
      (
        (safeSpan - crestPhaseError)
          / Math.max(.1, safeSpan - .14)
      ) * 2 - 1,
    ),
  );
}

export function waveCrestDistanceAtPhase(
  crestPhaseError: number,
  wavelength: number,
) {
  const waveNumber = Math.PI * 2 / Math.max(.1, wavelength);
  return crestPhaseError / waveNumber;
}

export type WaveWallApproachSample = {
  crestPhaseError: number;
  previousCrestPhaseError: number;
  wavelength: number;
  wavePeriod: number;
  boardNormalSpeed: number;
};

/**
 * Resolves an incoming wall from the same crest phase used by the polygon
 * surface. Paddling offshore increases closing speed, moving with the swell
 * reduces it, and a wall impact occurs only when that crest actually crosses
 * the board.
 */
export function resolveWaveWallApproach(
  sample: WaveWallApproachSample,
) {
  const phaseError = Math.atan2(
    Math.sin(sample.crestPhaseError),
    Math.cos(sample.crestPhaseError),
  );
  const previousPhaseError = sample.previousCrestPhaseError;
  const wavelength = Math.max(.1, sample.wavelength);
  const waveNumber = Math.PI * 2 / wavelength;
  const waveSpeed = wavelength / Math.max(4, sample.wavePeriod);
  const relativeNormalSpeed = waveSpeed - sample.boardNormalSpeed;
  const currentCrestIsUpcoming = phaseError > 0;
  const phaseToImpact = currentCrestIsUpcoming
    ? phaseError
    : phaseError + Math.PI * 2;
  const distanceToImpact = phaseToImpact / waveNumber;
  const secondsToImpact = relativeNormalSpeed > .05
    ? distanceToImpact / relativeNormalSpeed
    : Number.POSITIVE_INFINITY;
  const crossedCrest = Number.isFinite(previousPhaseError)
    && previousPhaseError > 0
    && phaseError <= 0
    && previousPhaseError - phaseError < Math.PI;
  return {
    phaseError,
    currentCrestIsUpcoming,
    relativeNormalSpeed,
    distanceToImpact,
    secondsToImpact,
    crossedCrest,
  };
}

export type WavePocketSample = {
  crestPhase: number;
  referencePhase: number;
  elapsed: number;
  wavePeriod: number;
  waveSpeed: number;
  peel: number;
  breakLength: number;
  lineSide: number;
  variability: number;
};

/**
 * Locates the breaking pocket in the crest-tangent frame without using the
 * surfer's position or the moment a ride was declared. Each crest carries its
 * own phase identifier; its pocket peels away from the A-frame origin as that
 * crest ages. Catching the wave therefore reveals the line the board already
 * occupies instead of placing a fresh pocket beneath it.
 */
export function resolveWavePocketFrame(
  sample: WavePocketSample,
) {
  const period = Math.max(4, sample.wavePeriod);
  const angularSpeed = Math.PI * 2 / period;
  const crestAge = (
    sample.crestPhase - sample.referencePhase
  ) / angularSpeed;
  const lineSide = sample.lineSide < 0 ? -1 : 1;
  const peelRate = lineSide
    * Math.max(0, sample.waveSpeed)
    * (
      .38
        + Math.min(1.4, Math.abs(sample.peel)) * .22
        + Math.max(0, sample.breakLength) * .018
    );
  const sectionOffset = lineSide
    * Math.sin(sample.crestPhase * .18 + sample.elapsed * .13)
    * Math.max(0, sample.variability)
    * 1.1;
  return {
    crestAge,
    peelRate,
    sectionOffset,
    pocketAlong: peelRate * crestAge + sectionOffset,
  };
}

export type WaveLineSideSample = {
  surferAlong: number;
  tangentSpeed: number;
  leftPocketAlong: number;
  rightPocketAlong: number;
  currentSide: number;
  switchHysteresis: number;
};

/**
 * Selects which side of an A-frame the board physically occupies. Near the
 * peak, tangential momentum breaks a geometric tie; once a side is occupied,
 * the opposite pocket must become meaningfully closer before the identity can
 * switch. One-way point and reef breaks bypass this resolver at the caller.
 */
export function resolveWaveLineSide(
  sample: WaveLineSideSample,
) {
  const currentSide = sample.currentSide < 0 ? -1 : 1;
  const leftDistance = Math.abs(
    sample.surferAlong - sample.leftPocketAlong,
  );
  const rightDistance = Math.abs(
    sample.surferAlong - sample.rightPocketAlong,
  );
  const hysteresis = Math.max(0, sample.switchHysteresis);
  const distanceDifference = Math.abs(leftDistance - rightDistance);
  const momentumSide = Math.abs(sample.tangentSpeed) > .32
    ? sample.tangentSpeed < 0 ? -1 : 1
    : 0;
  let lineSide = currentSide;
  if (distanceDifference <= hysteresis && momentumSide !== 0) {
    lineSide = momentumSide;
  } else {
    const candidateSide = leftDistance < rightDistance ? -1 : 1;
    const currentDistance = currentSide < 0
      ? leftDistance
      : rightDistance;
    const candidateDistance = candidateSide < 0
      ? leftDistance
      : rightDistance;
    if (
      candidateSide !== currentSide
      && candidateDistance + hysteresis < currentDistance
    ) {
      lineSide = candidateSide;
    }
  }
  return {
    lineSide,
    leftDistance,
    rightDistance,
    momentumSide,
  };
}

export type WaveSectionSample = {
  surferAlong: number;
  pocketAlong: number;
  pocketWidth: number;
  lineSide: number;
  facePosition: number;
  waveEnergy: number;
  tidePower: number;
  tideVariability: number;
  onshoreChop: number;
};

/**
 * Resolves the board's actual position relative to the moving pocket. This is
 * shared before and after ride capture so an engagement flag cannot move the
 * foam line, widen the shoulder, or grant a centered takeoff.
 */
export function resolveWaveSectionPressure(
  sample: WaveSectionSample,
) {
  const lineSide = sample.lineSide < 0 ? -1 : 1;
  const pocketWidth = Math.max(.5, sample.pocketWidth);
  const linePosition = clampValue(
    (
      (sample.surferAlong - sample.pocketAlong)
        * lineSide
    ) / pocketWidth,
    -1.5,
    1.5,
  );
  const lineTolerance = 1.06;
  const lineControl = 1 - smoothstep(
    .38 * lineTolerance,
    1.16 * lineTolerance,
    Math.abs(linePosition),
  );
  const deepRisk = smoothstep(
    .64 * lineTolerance,
    1.34 * lineTolerance,
    -linePosition,
  );
  const shoulderStall = smoothstep(
    .76 * lineTolerance,
    1.42 * lineTolerance,
    linePosition,
  );
  const whitewaterPressure = clampValue(
    deepRisk
      * (
        .55
          + clampValue(sample.waveEnergy, 0, 1) * .28
          + clampValue(sample.tidePower, 0, 1.5) * .1
          + clampValue(sample.onshoreChop, 0, 1.5) * .07
      )
      * (.94 + Math.max(0, sample.facePosition) * .12),
    0,
    1,
  );
  const sectionPressure = Math.max(
    whitewaterPressure,
    shoulderStall
      * .7
      * (
        .7
          + clampValue(sample.tideVariability, 0, 1.5) * .3
      ),
  );
  return {
    linePosition,
    lineControl,
    deepRisk,
    shoulderStall,
    whitewaterPressure,
    sectionPressure,
  };
}

export type WaveTubeSample = {
  linePosition: number;
  facePosition: number;
  tideHollow: number;
  tideSteepness: number;
  waveEnergy: number;
  offshoreGroom: number;
  onshoreChop: number;
  whitewater: number;
};

/**
 * Measures geometric enclosure by the pocket and upper face. Ride state,
 * scoring, and tutorial mode are absent so tube pressure can load the rail
 * before the game has declared a captured ride.
 */
export function resolveWaveTubePressure(
  sample: WaveTubeSample,
) {
  const tubePocket = 1 - smoothstep(
    .34,
    .92,
    Math.abs(sample.linePosition + .18),
  );
  const tubeFace = smoothstep(
    -.14,
    .58,
    clampValue(sample.facePosition, -1, 1),
  );
  const tubeShape = clampValue(
    clampValue(sample.tideHollow, 0, 1.5) * .58
      + clampValue(sample.tideSteepness, 0, 1.5) * .18
      + clampValue(sample.waveEnergy, 0, 1) * .22
      + clampValue(sample.offshoreGroom, 0, 1.5) * .06
      - clampValue(sample.onshoreChop, 0, 1.5) * .2,
    0,
    1,
  );
  const tubePressure = clampValue(
    tubePocket
      * tubeFace
      * smoothstep(.3, .88, tubeShape)
      * (1 - clampValue(sample.whitewater, 0, 1) * .88),
    0,
    1,
  );
  return {
    tubePocket,
    tubeFace,
    tubeShape,
    tubePressure,
  };
}

export type SurfboardTurbulenceSample = {
  elapsed: number;
  positionX: number;
  positionZ: number;
  windSpeed: number;
  onshoreChop: number;
  waveEnergy: number;
  waveSpeed: number;
  lineSide: number;
  whitewater: number;
};

/**
 * Samples one deterministic chop/foam field for every standing surf state.
 * Engagement is intentionally absent: the same patch of moving water applies
 * the same roll, pitch, and lateral disturbance before and after capture.
 */
export function resolveSurfboardTurbulence(
  sample: SurfboardTurbulenceSample,
) {
  const wind = clampValue(sample.windSpeed / 18, 0, 1.5);
  const onshore = clampValue(sample.onshoreChop, 0, 1.5);
  const energy = clampValue(sample.waveEnergy, 0, 1);
  const whitewater = clampValue(sample.whitewater, 0, 1);
  const lineSide = sample.lineSide < 0 ? -1 : 1;
  const surfaceRoll = (
    Math.sin(sample.elapsed * 1.73 + sample.positionX * .08) * .22
      + Math.sin(sample.elapsed * 2.41 - sample.positionZ * .06) * .14
  ) * (
    .42 + wind * .46 + onshore * .12
  );
  const surfacePitch = (
    Math.sin(sample.elapsed * 2.07 - sample.positionX * .045) * .14
      + Math.sin(sample.elapsed * 1.29 + sample.positionZ * .073) * .09
  ) * (
    .48 + wind * .36 + onshore * .16
  );
  const foamPulse = Math.sin(
    sample.elapsed * (8.8 + energy * 1.6)
      + sample.positionX * .19
      - sample.positionZ * .07,
  ) * (
    .28 + energy * .42 + onshore * .18
  );
  const foamTangent = foamPulse
    + lineSide
      * (
        .22
          + Math.max(0, sample.waveSpeed) * .035
          + energy * .24
      );
  return {
    tangentForce: foamTangent,
    rollTorque: surfaceRoll * (1 - whitewater * .55)
      + foamTangent * whitewater * .22,
    pitchTorque: surfacePitch * (1 - whitewater * .4)
      + foamTangent * whitewater * .12,
    surfaceRoll,
    surfacePitch,
    foamTangent,
  };
}

export function advanceRideCaptureState(
  current: RideCaptureState,
  sample: {
    deltaSeconds: number;
    crestPhaseError: number;
    normalSpeed: number;
    waveSpeed: number;
    facePhaseSpan: number;
    gravityPlaning: number;
  },
) {
  const delta = Math.max(0, Math.min(.25, sample.deltaSeconds));
  const speedDeficit = Math.max(0, sample.waveSpeed - sample.normalSpeed);
  const lipOvertake = smoothstep(-.02, .72, -sample.crestPhaseError)
    * smoothstep(.05, Math.max(.051, sample.waveSpeed * .3), speedDeficit);
  const flatShoulder = smoothstep(
    sample.facePhaseSpan * 1.35,
    sample.facePhaseSpan * 2.25,
    sample.crestPhaseError,
  ) * (1 - Math.max(0, Math.min(1, sample.gravityPlaning)));
  return {
    overtaken: Math.max(
      0,
      Math.min(
        1.4,
        current.overtaken
          + delta * (lipOvertake * (1.05 + speedDeficit * .16) - (1 - lipOvertake) * .9),
      ),
    ),
    ahead: Math.max(
      0,
      Math.min(
        1.25,
        current.ahead
          + delta * (flatShoulder * .82 - (1 - flatShoulder) * .74),
      ),
    ),
    lipOvertake,
    flatShoulder,
    speedDeficit,
  };
}

export const BOARD_SPECS: Record<BoardType, {
  name: string;
  profile: string;
  description: string;
  length: number;
  width: number;
  speed: number;
  turn: number;
  stability: number;
  paddle: number;
  score: number;
  color: string;
  accent: string;
}> = {
  performance: {
    name: "Apex 6'2",
    profile: "Performance",
    description: "Fast rail changes and the highest maneuver ceiling.",
    length: 2.5,
    width: 0.32,
    speed: 1,
    turn: 1.16,
    stability: 0.9,
    paddle: 0.94,
    score: 1.12,
    color: "#eee5d3",
    accent: "#f26b4d",
  },
  fish: {
    name: "Drift Twin 5'8",
    profile: "Flow / Speed",
    description: "Carries speed through soft sections with loose twin-fin flow.",
    length: 2.3,
    width: 0.39,
    speed: 1.08,
    turn: 1.02,
    stability: 1.02,
    paddle: 1.06,
    score: 1.04,
    color: "#45aeb5",
    accent: "#f2c568",
  },
  longboard: {
    name: "Horizon 9'1",
    profile: "Trim / Stability",
    description: "Effortless paddle power, steady trim, and true nose rides.",
    length: 3.45,
    width: 0.43,
    speed: 0.96,
    turn: 0.82,
    stability: 1.28,
    paddle: 1.2,
    score: 0.98,
    color: "#f1d9a7",
    accent: "#d75d48",
  },
};

export type SessionSettings = {
  mode: GameMode;
  board: BoardType;
  waveHeight: number;
  wavePeriod: number;
  waveDirection: number;
  swellHeight: number;
  swellPeriod: number;
  swellDirection: number;
  currentStrength: number;
  currentDirection: number;
  windSpeed: number;
  windDirection: number;
  waterTemperature: number;
  airTemperature: number;
  coastHeading: number;
  tide: number;
  timeOfDay: number;
  weatherCode: number;
};

export type WaveTakeoffSample = {
  crestDistance: number;
  crestEnergy: number;
  crestSurfable: boolean;
  faceSlope: number;
  surfaceRise: number;
  surfaceLift: number;
  breakProgress: number;
  alignment: number;
  paddleDrive: number;
  waveHeight: number;
};

export type WaveTakeoffReading = {
  catchable: boolean;
  surfable: boolean;
  opportunity: number;
  quality: number;
  faceEnvelope: number;
  physicalLift: number;
  riseStrength: number;
  liftStrength: number;
  slopeStrength: number;
  headingQuality: number;
  positionQuality: number;
};

export type BoardWaterSample = {
  boardHeading: number;
  velocityX: number;
  velocityZ: number;
  waveVelocityX: number;
  waveVelocityZ: number;
  slopeX: number;
  slopeZ: number;
  surfaceRise: number;
  surfaceLift: number;
  crestDistance: number;
  crestEnergy: number;
  crestSurfable: boolean;
  boardStability: number;
  waveHeight: number;
};

export type BoardWaterReading = {
  outcome: "stand" | "glide" | "capture" | "tumble";
  waveContact: number;
  capture: number;
  wipeoutRisk: number;
  headingAlignment: number;
  headingError: number;
  broadside: number;
  crossWaveLoad: number;
  crossWaveSide: number;
  relativeWaveSpeed: number;
  planing: number;
  faceSlope: number;
  balanceTarget: number;
};

export type SurfboardDynamicsState = {
  velocityX: number;
  velocityZ: number;
  heading: number;
  yawRate: number;
};

export type SurfboardDynamicsSample = {
  deltaSeconds: number;
  surfaceSlopeX: number;
  surfaceSlopeZ: number;
  waveVelocityX: number;
  waveVelocityZ: number;
  currentVelocityX: number;
  currentVelocityZ: number;
  waveContact: number;
  railInput: number;
  stance: number;
  railGrip: number;
  whitewater: number;
  waterContact?: number;
  noseImmersion?: number;
  tailImmersion?: number;
  noseSurfaceOffset?: number;
  tailSurfaceOffset?: number;
  turbulenceX?: number;
  turbulenceZ?: number;
  boardLength: number;
  boardWidth: number;
  boardTurn: number;
  boardStability: number;
  waveHeight: number;
};

export type SurfboardDynamicsReading = SurfboardDynamicsState & {
  accelerationX: number;
  accelerationZ: number;
  forwardSpeed: number;
  lateralSpeed: number;
  planing: number;
  railLoad: number;
  sideslip: number;
  gravityDrive: number;
  wavePressure: number;
  wavePressureCenter: number;
  waveYawAcceleration: number;
  waveForwardDrive: number;
  waveLateralLoad: number;
  pearlingRisk: number;
  tailStall: number;
};

export type SurfboardWavePressureSample = {
  velocityX: number;
  velocityZ: number;
  heading: number;
  waveVelocityX: number;
  waveVelocityZ: number;
  waveContact: number;
  waterContact?: number;
  waveHeight: number;
  stance: number;
  pearlingRisk?: number;
  noseSurfaceOffset?: number;
  tailSurfaceOffset?: number;
  boardLength?: number;
  boardTurn?: number;
};

export type SurfboardWavePressureReading = {
  accelerationX: number;
  accelerationZ: number;
  pressure: number;
  forwardDrive: number;
  lateralLoad: number;
  waveDeficit: number;
  headingAlignment: number;
  centerOfPressure: number;
  yawAcceleration: number;
  noseContact: number;
  tailContact: number;
};

export type SurfboardRailGripSample = {
  baseGrip: number;
  planing: number;
  waveContact: number;
  crossWaveLoad: number;
  railSlip: number;
  stance: number;
  facePosition: number;
  tubePressure: number;
  whitewater: number;
  onshoreChop: number;
};

export type SurfboardRailSlipSample = {
  railDemand: number;
  railGrip: number;
  sideslip: number;
  edgeRisk: number;
};

export type SurfboardRailSlipReading = {
  gripSlip: number;
  sideslip: number;
  edgeSlip: number;
  target: number;
};

export type SurfboardRailDemandSample = {
  railInput: number;
  speed: number;
  stance: number;
  tideSteepness: number;
  facePosition: number;
  tubePressure: number;
};

export type SurfboardInstabilitySample = {
  deltaSeconds: number;
  rollEdgeRisk: number;
  rollCapsizeRisk: number;
  rollRate: number;
  whitewater: number;
  shoulderStall: number;
  tubePressure: number;
  balanceError: number;
  balanceFailureThreshold: number;
  crossWaveLoad: number;
  sideslip: number;
  waveContact: number;
  pearlingRisk: number;
  pitchOverRisk: number;
  tailStall: number;
};

export type SurfboardPlaningSample = {
  forwardSpeed: number;
  waveContact: number;
  waterContact: number;
  stance: number;
  boardLength: number;
  boardWidth: number;
};

export type SurfboardPlaningReading = {
  planing: number;
  threshold: number;
};

export type BoardRollState = {
  rollAngle: number;
  rollRate: number;
};

export type BoardRollSample = {
  deltaSeconds: number;
  railInput: number;
  counterweight: number;
  crossSlope: number;
  lateralAcceleration: number;
  crossWaveLoad: number;
  crossWaveSide: number;
  turbulenceTorque?: number;
  speed: number;
  planing: number;
  boardWidth: number;
  boardStability: number;
  whitewater: number;
  waterContact?: number;
};

export type BoardRollReading = BoardRollState & {
  rollAcceleration: number;
  effectiveRail: number;
  balanceTarget: number;
  externalTorque: number;
  rightingMoment: number;
  edgeRisk: number;
  capsizeRisk: number;
};

/**
 * Integrates board roll around its longitudinal axis. Rider rail pressure and
 * impact torque must overcome buoyant/planing righting moments; counterweight
 * acts as an opposing body torque rather than a direct success-meter value.
 */
export function advanceBoardRollDynamics(
  state: BoardRollState,
  sample: BoardRollSample,
): BoardRollReading {
  const delta = Math.max(0, Math.min(.05, sample.deltaSeconds));
  const railInput = Math.max(-1, Math.min(1, sample.railInput));
  const counterweight = Math.max(-1, Math.min(1, sample.counterweight));
  const stability = Math.max(.55, sample.boardStability);
  const widthScale = Math.max(.7, sample.boardWidth / .34);
  const planing = Math.max(0, Math.min(1, sample.planing));
  const whitewater = Math.max(0, Math.min(1, sample.whitewater));
  const waterContact = Math.max(
    0,
    Math.min(1, sample.waterContact ?? 1),
  );
  const crossWaveLoad = Math.max(0, Math.min(1.5, sample.crossWaveLoad));
  const crossWaveSide = Math.sign(sample.crossWaveSide) || 1;
  const speedAuthority = smoothstep(.45, 5.2, Math.max(0, sample.speed));
  const inertia = Math.pow(widthScale, .86) * Math.sqrt(stability);

  const surfaceTorque = sample.crossSlope * 4.4 * waterContact;
  const accelerationTorque = -sample.lateralAcceleration * .21;
  const waveTorque = crossWaveSide
    * crossWaveLoad
    * (1.75 + whitewater * .85)
    * waterContact;
  const turbulenceTorque = (sample.turbulenceTorque ?? 0)
    * waterContact
    / Math.sqrt(stability);
  const externalTorque = surfaceTorque
    + accelerationTorque
    + waveTorque
    + turbulenceTorque;
  const counterweightAuthority = 2.25 / Math.pow(stability, .22);
  const balanceTarget = Math.max(
    -1,
    Math.min(1, externalTorque / counterweightAuthority),
  );

  const riderRailTorque = railInput
    * (1.12 + speedAuthority * 2.35)
    / inertia;
  const rightingStiffness = (
    .92 * waterContact
      + planing * (3.1 + speedAuthority * 2.15)
  ) * stability * Math.pow(widthScale, 1.18);
  const rightingMoment = -state.rollAngle * rightingStiffness;
  const angularDamping = (
    .14 + waterContact * .91
      + planing * 2.2
      + speedAuthority * .72 * waterContact
      + whitewater * .32 * waterContact
  ) * Math.sqrt(stability * widthScale);
  const counterweightTorque = -counterweight * counterweightAuthority;
  const rollAcceleration = clampValue(
    (
      riderRailTorque
        + externalTorque
        + counterweightTorque
        + rightingMoment
        - state.rollRate * angularDamping
    ) / inertia,
    -11,
    11,
  );
  const rollRate = clampValue(
    state.rollRate + rollAcceleration * delta,
    -4.6,
    4.6,
  );
  const rollAngle = clampValue(
    state.rollAngle + rollRate * delta,
    -1.22,
    1.22,
  );
  const effectiveRail = Math.max(
    -1,
    Math.min(1, Math.sin(rollAngle) / Math.sin(.43)),
  );
  const tipAngle = (
    .34
      + Math.min(.12, (stability - .55) * .085)
      + planing * .13
      + Math.min(.08, (widthScale - .7) * .08)
  );
  const edgeRisk = smoothstep(
    tipAngle * .62,
    tipAngle * 1.18,
    Math.abs(rollAngle),
  ) * waterContact * (
    .72
      + crossWaveLoad * .24
      + whitewater * .16
  );
  const capsizeRisk = Math.max(
    0,
    Math.min(
      1,
      smoothstep(tipAngle * .92, tipAngle * 1.65, Math.abs(rollAngle))
        * waterContact
        * (.72 + Math.abs(rollRate) * .16 + crossWaveLoad * .18),
    ),
  );
  return {
    rollAngle,
    rollRate,
    rollAcceleration,
    effectiveRail,
    balanceTarget,
    externalTorque,
    rightingMoment,
    edgeRisk: Math.max(0, Math.min(1, edgeRisk)),
    capsizeRisk,
  };
}

export type BoardPitchState = {
  pitchAngle: number;
  pitchRate: number;
};

export type BoardPitchSample = {
  deltaSeconds: number;
  stance: number;
  longitudinalAcceleration: number;
  noseSurfaceOffset: number;
  tailSurfaceOffset: number;
  turbulenceTorque?: number;
  speed: number;
  planing: number;
  boardLength: number;
  boardStability: number;
  waveContact: number;
  whitewater: number;
};

export type BoardPitchReading = BoardPitchState & {
  pitchAcceleration: number;
  noseImmersion: number;
  tailImmersion: number;
  pearlingRisk: number;
  tailStallRisk: number;
  pitchOverRisk: number;
  contactTorque: number;
  rightingMoment: number;
};

/**
 * Integrates board pitch relative to the local water tangent. Nose and tail
 * contact are sampled separately, so rider trim, acceleration, surface
 * curvature, and planing pressure rotate the board instead of toggling a
 * canned pearl/stall state.
 */
export function advanceBoardPitchDynamics(
  state: BoardPitchState,
  sample: BoardPitchSample,
): BoardPitchReading {
  const delta = Math.max(0, Math.min(.05, sample.deltaSeconds));
  const stance = Math.max(-1, Math.min(1, sample.stance));
  const stability = Math.max(.55, sample.boardStability);
  const safeLength = Math.max(1.6, sample.boardLength);
  const lengthScale = safeLength / 2.5;
  const halfContactLength = safeLength * .43;
  const planing = Math.max(0, Math.min(1, sample.planing));
  const contact = Math.max(0, Math.min(1, sample.waveContact));
  const whitewater = Math.max(0, Math.min(1, sample.whitewater));
  const speed = Math.max(0, sample.speed);
  const inertia = Math.pow(lengthScale, 1.42) * Math.sqrt(stability);

  // Positive pitch lowers the nose. Offsets measure the polygon surface
  // above its center tangent at each contact patch.
  const noseBoardOffset = -Math.sin(state.pitchAngle) * halfContactLength;
  const tailBoardOffset = Math.sin(state.pitchAngle) * halfContactLength;
  const noseImmersion = Math.max(
    0,
    sample.noseSurfaceOffset - noseBoardOffset,
  );
  const tailImmersion = Math.max(
    0,
    sample.tailSurfaceOffset - tailBoardOffset,
  );
  const noseLoad = smoothstep(.012, .19, noseImmersion)
    * contact
    * (.44 + planing * .56);
  const tailLoad = smoothstep(.012, .19, tailImmersion)
    * contact
    * (.44 + planing * .56);

  const speedAuthority = smoothstep(.55, 5.8, speed);
  const stanceTorque = stance
    * (1.08 + planing * 1.18 + speedAuthority * .42)
    / inertia;
  const accelerationTorque = -sample.longitudinalAcceleration * .105;
  const contactTorque = (tailLoad - noseLoad)
    * (1.35 + planing * 2.7 + speedAuthority * .65);
  const turbulenceTorque = (sample.turbulenceTorque ?? 0)
    * (.42 + whitewater * .58)
    * contact
    / Math.sqrt(stability);
  const rightingStiffness = (
    .08
      + contact * 1.72
      + planing * (2.35 + speedAuthority * 1.2)
  ) * stability * Math.pow(lengthScale, .72);
  const rightingMoment = -state.pitchAngle * rightingStiffness;
  const angularDamping = (
    .16
      + contact * 1.5
      + planing * 1.92
      + speedAuthority * .52 * contact
  ) * Math.sqrt(stability * lengthScale);
  const pitchAcceleration = clampValue(
    (
      stanceTorque
        + accelerationTorque
        + contactTorque
        + turbulenceTorque
        + rightingMoment
        - state.pitchRate * angularDamping
    ) / inertia,
    -9.5,
    9.5,
  );
  const pitchRate = clampValue(
    state.pitchRate + pitchAcceleration * delta,
    -3.8,
    3.8,
  );
  const pitchAngle = clampValue(
    state.pitchAngle + pitchRate * delta,
    -.82,
    .82,
  );
  const nosePressure = Math.max(0, stance);
  const tailPressure = Math.max(0, -stance);
  const pearlingRisk = Math.max(
    0,
    Math.min(
      1,
      smoothstep(.018, .17, noseImmersion)
        * contact
        * smoothstep(1.65, 6.4, speed)
        * (
          .52
            + nosePressure * .32
            + planing * .16
            + whitewater * .16
            + Math.max(0, state.pitchRate) * .07
        ),
    ),
  );
  const tailStallRisk = Math.max(
    0,
    Math.min(
      1,
      smoothstep(.016, .18, tailImmersion)
        * contact
        * (1 - planing * .72)
        * (1 - smoothstep(1.6, 4.6, speed))
        * (.48 + tailPressure * .52 + whitewater * .12),
    ),
  );
  const pitchOverRisk = Math.max(
    0,
    Math.min(
      1,
      pearlingRisk * (
        .54
          + smoothstep(.12, .48, pitchAngle) * .28
          + Math.max(0, -sample.longitudinalAcceleration) * .085
          + Math.max(0, pitchRate) * .08
      ),
    ),
  );

  return {
    pitchAngle,
    pitchRate,
    pitchAcceleration,
    noseImmersion,
    tailImmersion,
    pearlingRisk,
    tailStallRisk,
    pitchOverRisk,
    contactTorque,
    rightingMoment,
  };
}

export type BoardHeaveState = {
  elevation: number;
  verticalVelocity: number;
  previousSurfaceHeight: number;
  waterContact: number;
};

export type BoardHeaveSample = {
  deltaSeconds: number;
  surfaceHeight: number;
  flotationOffset: number;
  planing: number;
  speed: number;
  waveContact: number;
  boardLength: number;
  boardWidth: number;
  boardStability: number;
  whitewater: number;
  verticalWaterAcceleration?: number;
};

export type BoardHeaveReading = BoardHeaveState & {
  verticalAcceleration: number;
  surfaceVelocity: number;
  immersion: number;
  airborneHeight: number;
  landingImpact: number;
  buoyancyAcceleration: number;
};

export type SurfboardReleaseSample = {
  compression: number;
  extensionSpeed: number;
  tailPressure: number;
  lipSupport: number;
  speed: number;
  planing: number;
  waterContact: number;
  boardLength: number;
};

export type SurfboardLipSupportSample = {
  facePosition: number;
  faceSlope: number;
  surfaceRise: number;
  waveContact: number;
  planing: number;
  waterContact: number;
};

/**
 * Measures how much live upper-face geometry can redirect a loaded tail.
 * This is deliberately independent of score, catch quality, combo, and mode.
 */
export function surfboardLipLaunchSupport(
  sample: SurfboardLipSupportSample,
) {
  const upperFace = smoothstep(
    .05,
    .58,
    clampValue(sample.facePosition, -1, 1),
  );
  const slopeSupport = smoothstep(
    .025,
    .2,
    Math.max(0, sample.faceSlope),
  );
  const riseSupport = smoothstep(
    .08,
    1.6,
    Math.max(0, sample.surfaceRise),
  );
  const contact = clampValue(sample.waveContact, 0, 1)
    * clampValue(sample.waterContact, 0, 1);
  const planing = clampValue(sample.planing, 0, 1);
  return clampValue(
    upperFace
      * contact
      * (.5 + slopeSupport * .32 + riseSupport * .18)
      * (.62 + planing * .38),
    0,
    1,
  );
}

/**
 * Converts a compressed tail release against the upper wave face into an
 * instantaneous vertical velocity change. A flat or disconnected board has
 * little ramp authority; a fast, planing hull released from a live lip can
 * redirect substantially more of its momentum upward.
 */
export function surfboardReleaseVerticalImpulse(
  sample: SurfboardReleaseSample,
) {
  const compression = clampValue(sample.compression, 0, 1);
  const extensionAuthority = smoothstep(
    .18,
    2.35,
    Math.max(0, sample.extensionSpeed),
  );
  const tailPressure = clampValue(sample.tailPressure, 0, 1);
  const lipSupport = clampValue(sample.lipSupport, 0, 1);
  const speedAuthority = smoothstep(6.2, 14.5, Math.max(0, sample.speed));
  const planing = clampValue(sample.planing, 0, 1);
  const waterContact = clampValue(sample.waterContact, 0, 1);
  const safeLength = Math.max(1.6, sample.boardLength);
  const athleteRelease = (.12 + compression * .78)
    * (.16 + extensionAuthority * .84);
  const lipRedirect = lipSupport
    * (1.45 + lipSupport * 1.05)
    * (1 + speedAuthority * .8 + planing * .45);
  const tailCoupling = .72 + tailPressure * .38;
  const lengthResponse = Math.pow(2.5 / safeLength, .16);
  return clampValue(
    (athleteRelease + lipRedirect)
      * tailCoupling
      * waterContact
      * lengthResponse,
    0,
    4.8,
  );
}

export type SurfboardYawReleaseSample = {
  railInput: number;
  tailPressure: number;
  lipSupport: number;
  speed: number;
  verticalImpulse: number;
  charge: number;
  waterContact: number;
  boardLength: number;
  boardTurn: number;
};

/**
 * Converts a loaded rail and tail release into signed angular velocity. There
 * is no requested trick angle: rail load, lip support, retained speed, body
 * compression, board response, and yaw inertia determine the rotation that is
 * physically available at takeoff.
 */
export function surfboardReleaseYawImpulse(
  sample: SurfboardYawReleaseSample,
) {
  const railInput = clampValue(sample.railInput, -1, 1);
  const railLoad = Math.abs(railInput);
  const tailPressure = clampValue(sample.tailPressure, 0, 1);
  const lipSupport = clampValue(sample.lipSupport, 0, 1);
  const speedAuthority = smoothstep(
    6.2,
    14.5,
    Math.max(0, sample.speed),
  );
  const verticalImpulse = Math.max(0, sample.verticalImpulse);
  const charge = clampValue(sample.charge, 0, 1);
  const waterContact = clampValue(sample.waterContact, 0, 1);
  const safeLength = Math.max(1.6, sample.boardLength);
  const turnResponse = Math.sqrt(Math.max(.45, sample.boardTurn));
  const yawInertia = Math.pow(safeLength / 2.1, 1.38);
  const yawRate = railLoad
      * (
        2.2
          + speedAuthority * 3.4
          + verticalImpulse * .65
      )
      * (.62 + tailPressure * .48)
      * (.18 + lipSupport * .82)
      * (.72 + charge * .28)
      * turnResponse
      * waterContact
      / yawInertia;
  return clampValue(
    Math.sign(railInput) * yawRate,
    -8,
    8,
  );
}

/**
 * Integrates vertical board motion against a moving polygon surface. Buoyancy
 * and hydrodynamic damping exist only while the hull is immersed; otherwise
 * gravity carries the board until it reconnects with the water.
 */
export function advanceBoardHeaveDynamics(
  state: BoardHeaveState,
  sample: BoardHeaveSample,
): BoardHeaveReading {
  const delta = Math.max(0, Math.min(.05, sample.deltaSeconds));
  const stability = Math.max(.55, sample.boardStability);
  const safeLength = Math.max(1.6, sample.boardLength);
  const safeWidth = Math.max(.24, sample.boardWidth);
  const planing = Math.max(0, Math.min(1, sample.planing));
  const waveContact = Math.max(0, Math.min(1, sample.waveContact));
  const whitewater = Math.max(0, Math.min(1, sample.whitewater));
  const waterline = sample.surfaceHeight + sample.flotationOffset;
  const surfaceVelocity = delta > 0
    ? clampValue(
        (sample.surfaceHeight - state.previousSurfaceHeight) / delta,
        -5.5,
        5.5,
      )
    : 0;
  const immersionBefore = waterline - state.elevation;
  const contactBefore = smoothstep(-.045, .105, immersionBefore);
  const relativeVerticalVelocity = state.verticalVelocity - surfaceVelocity;
  const volumeScale = Math.pow(
    safeLength * safeWidth / (2.5 * .34),
    .72,
  );
  const buoyancyStiffness = 68
    * volumeScale
    * (.82 + stability * .18);
  const buoyancyAcceleration = Math.max(0, immersionBefore)
    * buoyancyStiffness
    * contactBefore;
  const hydrodynamicDamping = -relativeVerticalVelocity
    * (
      4.7
        + planing * 2.6
        + whitewater * 1.4
    )
    * contactBefore
    / Math.sqrt(stability);
  const speedAuthority = smoothstep(1.2, 7.4, Math.max(0, sample.speed));
  const planingLift = planing
    * speedAuthority
    * (1.15 + waveContact * 1.65)
    * contactBefore;
  const verticalWaterAcceleration = (sample.verticalWaterAcceleration ?? 0)
    * contactBefore
    * (.35 + waveContact * .65);
  const verticalAcceleration = clampValue(
    -9.81
      + buoyancyAcceleration
      + hydrodynamicDamping
      + planingLift
      + verticalWaterAcceleration,
    -19,
    29,
  );
  const verticalVelocity = clampValue(
    state.verticalVelocity + verticalAcceleration * delta,
    -8.5,
    8.5,
  );
  const elevation = state.elevation
    + (state.verticalVelocity + verticalVelocity) * .5 * delta;
  const immersion = waterline - elevation;
  const waterContact = smoothstep(-.045, .105, immersion);
  const airborneHeight = Math.max(0, elevation - waterline);
  const landingImpact = (
    state.waterContact < .5
    && waterContact > state.waterContact + .18
  )
    ? smoothstep(
        1.15,
        5.8,
        Math.max(0, surfaceVelocity - state.verticalVelocity),
      )
    : 0;

  return {
    elevation,
    verticalVelocity,
    previousSurfaceHeight: sample.surfaceHeight,
    waterContact,
    verticalAcceleration,
    surfaceVelocity,
    immersion,
    airborneHeight,
    landingImpact,
    buoyancyAcceleration,
  };
}

export type ProneBoardAttitudeState = {
  roll: BoardRollState;
  pitch: BoardPitchState;
  heave: BoardHeaveState;
};

export type BoardRailContactFrame = {
  crossSlope: number;
  railWarp: number;
  rightOffset: number;
  leftOffset: number;
};

/**
 * Resolves the lateral contact plane from explicit rail samples. Rail warp is
 * the shared rise or drop that a center tangent cannot represent, such as a
 * short polygon ridge lifting both rails beneath the middle of the board.
 */
export function boardRailContactFrame(
  centerHeight: number,
  rightRailHeight: number,
  leftRailHeight: number,
  halfWidth: number,
): BoardRailContactFrame {
  const safeHalfWidth = Math.max(.08, Math.abs(halfWidth));
  return {
    crossSlope: (rightRailHeight - leftRailHeight) / (safeHalfWidth * 2),
    railWarp: (rightRailHeight + leftRailHeight) * .5 - centerHeight,
    rightOffset: rightRailHeight - centerHeight,
    leftOffset: leftRailHeight - centerHeight,
  };
}

export type ProneBoardAttitudeSample = {
  deltaSeconds: number;
  balance: number;
  trim: number;
  stabilityScale?: number;
  counterweightScale?: number;
  crossSlope: number;
  lateralAcceleration: number;
  longitudinalAcceleration: number;
  crossWaveLoad: number;
  crossWaveSide: number;
  noseSurfaceOffset: number;
  tailSurfaceOffset: number;
  turbulenceTorque: number;
  speed: number;
  planing: number;
  waveContact: number;
  boardLength: number;
  boardWidth: number;
  boardStability: number;
  whitewater: number;
  surfaceHeight: number;
  flotationOffset: number;
  verticalWaterAcceleration?: number;
};

export type ProneBoardAttitudeReading = {
  roll: BoardRollReading;
  pitch: BoardPitchReading;
  heave: BoardHeaveReading;
};

export type ProneBoardFailureSample = {
  capsizeRisk: number;
  pitchOverRisk: number;
  crossWaveLoad: number;
  whitewater: number;
  waveEnergy: number;
};

export type ProneBoardFailureReading = {
  failed: boolean;
  load: number;
  power: number;
};

export type PopUpTransitionReading = {
  progress: number;
  duration: number;
  handLoad: number;
  rearFootLoad: number;
  frontFootLoad: number;
  footSupport: number;
  footImpact: number;
  centerOfMassHeight: number;
  trim: number;
  stabilityScale: number;
  counterweightScale: number;
  verticalLoadAcceleration: number;
};

/**
 * Advances the surfer's body transition independently from wave capture.
 * Hands load the forward half, the rear foot arrives first, then the front
 * foot raises the center of mass into a standing balance state.
 */
export function evaluatePopUpTransition(
  elapsedSeconds: number,
  stamina: number,
  foreAftFootPlacement = 0,
): PopUpTransitionReading {
  const staminaRatio = clampValue(stamina / 100, 0, 1);
  const footPlacement = clampValue(foreAftFootPlacement, -1, 1);
  const duration = .9 - staminaRatio * .24;
  const linearProgress = clampValue(
    Math.max(0, elapsedSeconds) / duration,
    0,
    1,
  );
  const progress = linearProgress * linearProgress * (3 - 2 * linearProgress);
  const handEntry = smoothstep(.16, .34, progress);
  const handRelease = smoothstep(.56, .76, progress);
  const handLoad = handEntry * (1 - handRelease);
  const rearFootLoad = smoothstep(.48, .7, progress);
  const frontFootLoad = smoothstep(.68, .9, progress);
  const footSupport = clampValue(
    rearFootLoad * .42 + frontFootLoad * .58,
    0,
    1,
  );
  const rearFootImpact = Math.sin(
    Math.PI * clampValue((progress - .45) / .34, 0, 1),
  );
  const frontFootImpact = Math.sin(
    Math.PI * clampValue((progress - .65) / .3, 0, 1),
  );
  const footImpact = Math.max(0, rearFootImpact) * .46
    + Math.max(0, frontFootImpact) * .54;
  const centerOfMassHeight = smoothstep(.28, .9, progress);
  const trim = -.06
    + handLoad * .17
    - rearFootImpact * .11
    + frontFootLoad * .08
    + footPlacement * footSupport * .72;
  const stabilityScale = 1.28 - centerOfMassHeight * .28;
  const counterweightScale = .46 + centerOfMassHeight * .46;
  const verticalLoadAcceleration = -(
    handLoad * 2.5
      + footImpact * 3.8
  );
  return {
    progress,
    duration,
    handLoad,
    rearFootLoad,
    frontFootLoad,
    footSupport,
    footImpact,
    centerOfMassHeight,
    trim,
    stabilityScale,
    counterweightScale,
    verticalLoadAcceleration,
  };
}

/**
 * Advances the prone board as one coupled contact state. A surfer lying low
 * adds roll stability and has reduced fore-aft leverage, but the hull still
 * reacts to cross-wave torque, separate nose/tail polygons, and vertical
 * contact loss. The resulting state can be carried directly through a pop-up.
 */
export function advanceProneBoardAttitude(
  state: ProneBoardAttitudeState,
  sample: ProneBoardAttitudeSample,
): ProneBoardAttitudeReading {
  const proneStability = Math.max(.55, sample.boardStability)
    * clampValue(sample.stabilityScale ?? 1.28, .82, 1.5);
  const contact = Math.max(0, Math.min(1, state.heave.waterContact));
  const waveContact = Math.max(0, Math.min(1, sample.waveContact)) * contact;
  const roll = advanceBoardRollDynamics(state.roll, {
    deltaSeconds: sample.deltaSeconds,
    railInput: 0,
    counterweight: sample.balance
      * clampValue(sample.counterweightScale ?? .46, .25, 1),
    crossSlope: sample.crossSlope,
    lateralAcceleration: sample.lateralAcceleration,
    crossWaveLoad: sample.crossWaveLoad,
    crossWaveSide: sample.crossWaveSide,
    turbulenceTorque: sample.turbulenceTorque,
    speed: sample.speed,
    planing: sample.planing,
    boardWidth: sample.boardWidth,
    boardStability: proneStability,
    whitewater: sample.whitewater,
    waterContact: contact,
  });
  const pitch = advanceBoardPitchDynamics(state.pitch, {
    deltaSeconds: sample.deltaSeconds,
    stance: sample.trim * .68,
    longitudinalAcceleration: sample.longitudinalAcceleration,
    noseSurfaceOffset: sample.noseSurfaceOffset,
    tailSurfaceOffset: sample.tailSurfaceOffset,
    turbulenceTorque: sample.turbulenceTorque * .72,
    speed: sample.speed,
    planing: sample.planing,
    boardLength: sample.boardLength,
    boardStability: proneStability,
    waveContact,
    whitewater: sample.whitewater,
  });
  const heave = advanceBoardHeaveDynamics(state.heave, {
    deltaSeconds: sample.deltaSeconds,
    surfaceHeight: sample.surfaceHeight,
    flotationOffset: sample.flotationOffset,
    planing: sample.planing,
    speed: sample.speed,
    waveContact: sample.waveContact,
    boardLength: sample.boardLength,
    boardWidth: sample.boardWidth,
    boardStability: sample.boardStability,
    whitewater: sample.whitewater,
    verticalWaterAcceleration: sample.verticalWaterAcceleration,
  });
  return { roll, pitch, heave };
}

/**
 * Converts prone attitude and water load into a physical separation event.
 * A rail beyond its righting limit or a buried nose fails immediately, while
 * combined broadside wash can overwhelm the hull before either angle peaks.
 */
export function evaluateProneBoardFailure(
  sample: ProneBoardFailureSample,
): ProneBoardFailureReading {
  const capsizeRisk = clampValue(sample.capsizeRisk, 0, 1);
  const pitchOverRisk = clampValue(sample.pitchOverRisk, 0, 1);
  const crossWaveLoad = clampValue(sample.crossWaveLoad, 0, 1.5);
  const whitewater = clampValue(sample.whitewater, 0, 1);
  const waveEnergy = clampValue(sample.waveEnergy, 0, 1);
  const load = Math.max(capsizeRisk, pitchOverRisk)
    + Math.max(0, crossWaveLoad - .48) * .24
    + whitewater * .16;
  const failed = capsizeRisk > .9
    || pitchOverRisk > .9
    || load > .98;
  const power = clampValue(
    .12
      + capsizeRisk * .34
      + pitchOverRisk * .34
      + Math.min(1, crossWaveLoad) * .16
      + whitewater * .2
      + waveEnergy * .12,
    .18,
    1,
  );
  return { failed, load, power };
}

function clampValue(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export type PaddleboardDynamicsState = {
  velocityX: number;
  velocityZ: number;
  heading: number;
  yawRate: number;
};

export type PaddleStrokeCycleState = {
  phase: number;
};

export type PaddleStrokeCycleSample = {
  deltaSeconds: number;
  effort: number;
  steer: number;
  stamina: number;
};

export type PaddleStrokeCycleReading = PaddleStrokeCycleState & {
  drive: number;
  pull: number;
  strokeSide: number;
  cadence: number;
};

export type PaddleTrainingSample = {
  boardWaveAngle: number;
  paddleStroke: number;
  paddleEffort: number;
  waterContact: number;
  waveForwardDrive: number;
  waveLateralLoad: number;
};

export type PaddleTrainingReading = {
  targetRotationDegrees: number;
  turnDirection: "left" | "right" | "hold";
  turnDegrees: number;
  recommendedHand: "left" | "right" | null;
  activeHand: "left" | "right" | null;
  strokePhase: "idle" | "pull" | "recovery";
  strokeDrive: number;
  pressureMode: "airborne" | "broadside" | "drive" | "neutral";
};

export type SurfTrainingForceSample = {
  boardWaveAngle: number;
  waveLateralLoad: number;
  waterContact: number;
  balance: number;
  balanceTarget: number;
};

export type SurfTrainingForceReading = {
  noseDirection: "left" | "right" | "hold";
  noseDegrees: number;
  waterDirection: "left" | "right" | "hold";
  waterLoad: number;
  counterweightDirection: "left" | "right" | "hold";
  counterweightCorrection: number;
  counterweightPercent: number;
  airborne: boolean;
};

/**
 * Resolves alternating prone paddle strokes. Input expresses effort, while
 * force exists only through each hand's pull phase; recovery advances the arm
 * without propelling the board.
 */
export function advancePaddleStrokeCycle(
  state: PaddleStrokeCycleState,
  sample: PaddleStrokeCycleSample,
): PaddleStrokeCycleReading {
  const delta = Math.max(0, Math.min(.05, sample.deltaSeconds));
  const effort = Math.max(0, Math.min(1, sample.effort));
  const steer = Math.max(-1, Math.min(1, sample.steer));
  const stamina = Math.max(0, Math.min(100, sample.stamina));
  const cadence = 1.16
    + effort * .58
    + stamina * .0022;
  const phase = effort > .015
    ? (state.phase + cadence * delta) % 2
    : state.phase;
  const strokeSide = phase < 1 ? -1 : 1;
  const localPhase = phase % 1;
  const pullProgress = (localPhase - .1) / .74;
  const pull = pullProgress > 0 && pullProgress < 1
    ? Math.sin(pullProgress * Math.PI)
    : 0;
  const steeringBias = Math.max(
    .48,
    Math.min(1.52, 1 + strokeSide * steer * .42),
  );
  const fatigueScale = .72 + stamina * .0028;
  const drive = Math.max(
    0,
    Math.min(1, effort * pull * steeringBias * fatigueScale),
  );
  return {
    phase,
    drive,
    pull,
    strokeSide,
    cadence,
  };
}

/**
 * Translates live mechanics into an instructional reading without deciding
 * whether a wave is "ready." The target arrow comes from angular error, hand
 * feedback comes from the real alternating stroke oscillator, and pressure
 * feedback comes from resolved hull forces.
 */
export function readPaddleTrainingMechanics(
  sample: PaddleTrainingSample,
): PaddleTrainingReading {
  const angle = Math.atan2(
    Math.sin(sample.boardWaveAngle),
    Math.cos(sample.boardWaveAngle),
  );
  const targetRotationDegrees = angle * 180 / Math.PI;
  const turnDegrees = Math.round(Math.abs(targetRotationDegrees));
  const turnDirection = turnDegrees <= 6
    ? "hold"
    : targetRotationDegrees > 0
      ? "right"
      : "left";
  const recommendedHand = turnDirection === "hold"
    ? null
    : turnDirection === "right"
      ? "left"
      : "right";
  const strokeDrive = clampValue(Math.abs(sample.paddleStroke), 0, 1);
  const activeHand = strokeDrive <= .035
    ? null
    : sample.paddleStroke < 0
      ? "left"
      : "right";
  const effort = clampValue(sample.paddleEffort, 0, 1);
  const strokePhase = effort <= .04
    ? "idle"
    : activeHand
      ? "pull"
      : "recovery";
  const waterContact = clampValue(sample.waterContact, 0, 1);
  const forwardDrive = Math.max(0, sample.waveForwardDrive);
  const lateralLoad = Math.abs(sample.waveLateralLoad);
  const pressureMode = waterContact < .18
    ? "airborne"
    : lateralLoad > Math.max(.32, forwardDrive * 1.05)
      ? "broadside"
      : forwardDrive > .28
        ? "drive"
        : "neutral";
  return {
    targetRotationDegrees,
    turnDirection,
    turnDegrees,
    recommendedHand,
    activeHand,
    strokePhase,
    strokeDrive,
    pressureMode,
  };
}

/**
 * Turns the live hydrodynamic and roll-control state into a causal training
 * chain: nose alignment, water push, then the rider correction required to
 * cancel the board's unresolved external torque. This only observes solver
 * state; it never changes control input or physics.
 */
export function readSurfTrainingForces(
  sample: SurfTrainingForceSample,
): SurfTrainingForceReading {
  const boardWaveAngle = Math.atan2(
    Math.sin(sample.boardWaveAngle),
    Math.cos(sample.boardWaveAngle),
  );
  const noseDegrees = Math.round(Math.abs(boardWaveAngle) * 180 / Math.PI);
  const noseDirection = noseDegrees <= 6
    ? "hold"
    : boardWaveAngle > 0
      ? "right"
      : "left";
  const waterLoad = Math.abs(sample.waveLateralLoad);
  const waterDirection = waterLoad <= .08
    ? "hold"
    : sample.waveLateralLoad > 0
      ? "right"
      : "left";
  const counterweightCorrection = clampValue(
    sample.balanceTarget - sample.balance,
    -1,
    1,
  );
  const counterweightPercent = Math.round(
    Math.abs(counterweightCorrection) * 100,
  );
  const counterweightDirection = counterweightPercent <= 5
    ? "hold"
    : counterweightCorrection > 0
      ? "right"
      : "left";
  const airborne = clampValue(sample.waterContact, 0, 1) < .18;
  return {
    noseDirection,
    noseDegrees,
    waterDirection: airborne ? "hold" : waterDirection,
    waterLoad,
    counterweightDirection,
    counterweightCorrection,
    counterweightPercent,
    airborne,
  };
}

export type PaddleboardDynamicsSample = {
  deltaSeconds: number;
  stroke: number;
  strokeSide?: number;
  steer: number;
  waterContact?: number;
  submersion?: number;
  surfaceSlopeX: number;
  surfaceSlopeZ: number;
  waveVelocityX: number;
  waveVelocityZ: number;
  currentVelocityX: number;
  currentVelocityZ: number;
  boardLength: number;
  boardWidth: number;
  boardTurn: number;
  paddleEfficiency: number;
};

export type PaddleboardDynamicsReading = PaddleboardDynamicsState & {
  accelerationX: number;
  accelerationZ: number;
  forwardSpeed: number;
  lateralSpeed: number;
  strokeForce: number;
};

/**
 * Integrates prone paddling as repeated human thrust against quadratic hull
 * drag. Input applies force rather than selecting a target speed, so momentum
 * survives between strokes and current acts through the water-relative flow.
 */
export function advancePaddleboardDynamics(
  state: PaddleboardDynamicsState,
  sample: PaddleboardDynamicsSample,
): PaddleboardDynamicsReading {
  const delta = Math.max(0, Math.min(.05, sample.deltaSeconds));
  const stroke = Math.max(-1, Math.min(1, sample.stroke));
  const strokeSide = Math.max(
    -1,
    Math.min(1, sample.strokeSide ?? 0),
  );
  const steer = Math.max(-1, Math.min(1, sample.steer));
  const hullContact = clampValue(sample.waterContact ?? 1, 0, 1);
  const submersion = clampValue(sample.submersion ?? 0, 0, 1);
  const safeLength = Math.max(1.6, sample.boardLength);
  const safeWidth = Math.max(.24, sample.boardWidth);
  const turn = Math.max(.45, sample.boardTurn);
  const paddleEfficiency = Math.max(.4, Math.min(1.3, sample.paddleEfficiency));
  const speed = Math.hypot(state.velocityX, state.velocityZ);
  const yawInertia = Math.pow(safeLength / 2.5, 1.32);
  const yawAuthority = (
    .34
      + Math.min(1.2, speed * .16)
      + Math.abs(stroke) * .3
  ) * turn / yawInertia;
  const steeringTorque = -steer
    * (
      .24
        + Math.abs(stroke) * .54
        + Math.min(.34, speed * .055)
    );
  const alternatingStrokeTorque = -strokeSide
    * Math.max(0, stroke)
    * .16;
  const targetYawRate = (steeringTorque + alternatingStrokeTorque)
    * yawAuthority
    * hullContact;
  const yawResponse = (
    .18 + hullContact * (2.02 + Math.abs(stroke) * 1.4)
  ) / Math.sqrt(yawInertia);
  let yawRate = state.yawRate + (
    targetYawRate - state.yawRate
  ) * (1 - Math.exp(-yawResponse * delta));
  yawRate *= Math.exp(
    -delta * (
      .08 + hullContact * (
        .64
          + (Math.abs(steer) < .04 ? 1.2 : 0)
          + submersion * 2.2
      )
    ),
  );
  const heading = state.heading + yawRate * delta;
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);

  const orbitalCoupling = .026 * hullContact;
  const waterVelocityX = sample.currentVelocityX
    + sample.waveVelocityX * orbitalCoupling;
  const waterVelocityZ = sample.currentVelocityZ
    + sample.waveVelocityZ * orbitalCoupling;
  const relativeX = state.velocityX - waterVelocityX;
  const relativeZ = state.velocityZ - waterVelocityZ;
  const forwardSpeed = relativeX * forwardX + relativeZ * forwardZ;
  const lateralSpeed = relativeX * rightX + relativeZ * rightZ;
  const strokeForce = stroke >= 0
    ? stroke * (4.8 + paddleEfficiency * 2.1)
    : stroke * 1.45;
  const appliedStrokeForce = strokeForce
    * hullContact
    * (1 - submersion * .94);
  const lengthDragScale = Math.pow(2.5 / safeLength, .62);
  const widthDragScale = Math.pow(safeWidth / .34, .42);
  const forwardDrag = -forwardSpeed
    * Math.abs(forwardSpeed)
    * .31
    * lengthDragScale
    * widthDragScale
    * hullContact
    * (1 + submersion * 2.8);
  const lateralDrag = -lateralSpeed
    * Math.abs(lateralSpeed)
    * .82
    * widthDragScale
    * hullContact
    * (1 + submersion * 1.8);
  const slopeMagnitudeSquared = sample.surfaceSlopeX * sample.surfaceSlopeX
    + sample.surfaceSlopeZ * sample.surfaceSlopeZ;
  const slopeGravity = 9.81
    * .2
    * hullContact
    / Math.max(1, 1 + slopeMagnitudeSquared);
  let accelerationX = forwardX * (appliedStrokeForce + forwardDrag)
    + rightX * lateralDrag
    - sample.surfaceSlopeX * slopeGravity;
  let accelerationZ = forwardZ * (appliedStrokeForce + forwardDrag)
    + rightZ * lateralDrag
    - sample.surfaceSlopeZ * slopeGravity;
  const accelerationMagnitude = Math.hypot(accelerationX, accelerationZ);
  if (accelerationMagnitude > 7.2) {
    const scale = 7.2 / accelerationMagnitude;
    accelerationX *= scale;
    accelerationZ *= scale;
  }
  const velocityX = state.velocityX + accelerationX * delta;
  const velocityZ = state.velocityZ + accelerationZ * delta;
  return {
    velocityX,
    velocityZ,
    heading: Math.atan2(Math.sin(heading), Math.cos(heading)),
    yawRate,
    accelerationX,
    accelerationZ,
    forwardSpeed,
    lateralSpeed,
    strokeForce: appliedStrokeForce,
  };
}

/**
 * Resolves the breaking face's horizontal pressure on a contacting hull.
 * The force always follows the live wave normal: a board pointed with the
 * wave receives useful longitudinal drive, while a broadside board receives
 * the same event mostly as lateral load. This is shared by prone takeoff and
 * standing surf dynamics so changing body phase cannot grant crest speed.
 */
export function resolveSurfboardWavePressure(
  sample: SurfboardWavePressureSample,
): SurfboardWavePressureReading {
  const waveSpeed = Math.hypot(
    sample.waveVelocityX,
    sample.waveVelocityZ,
  );
  const contact = clampValue(sample.waveContact, 0, 1);
  const hullContact = clampValue(sample.waterContact ?? 1, 0, 1);
  if (waveSpeed < .001 || contact <= 0 || hullContact <= 0) {
    return {
      accelerationX: 0,
      accelerationZ: 0,
      pressure: 0,
      forwardDrive: 0,
      lateralLoad: 0,
      waveDeficit: Math.max(0, waveSpeed),
      headingAlignment: 0,
      centerOfPressure: 0,
      yawAcceleration: 0,
      noseContact: 0,
      tailContact: 0,
    };
  }

  const waveNormalX = sample.waveVelocityX / waveSpeed;
  const waveNormalZ = sample.waveVelocityZ / waveSpeed;
  const forwardX = Math.sin(sample.heading);
  const forwardZ = Math.cos(sample.heading);
  const rightX = Math.cos(sample.heading);
  const rightZ = -Math.sin(sample.heading);
  const headingAlignment = clampValue(
    forwardX * waveNormalX + forwardZ * waveNormalZ,
    -1,
    1,
  );
  const normalSpeed = sample.velocityX * waveNormalX
    + sample.velocityZ * waveNormalZ;
  const waveDeficit = Math.max(0, waveSpeed - normalSpeed);
  const stance = clampValue(sample.stance, -1, 1);
  const tailPressure = Math.max(0, -stance);
  const nosePressure = Math.max(0, stance);
  const pearlingRisk = clampValue(sample.pearlingRisk ?? 0, 0, 1);
  const safeLength = Math.max(1.6, sample.boardLength ?? 2.5);
  const turn = Math.max(.45, sample.boardTurn ?? 1);
  const contactRelief = .055 + Math.max(.25, sample.waveHeight) * .035;
  const noseContact = clampValue(
    contact * (
      1 + (sample.noseSurfaceOffset ?? 0) / contactRelief
    ),
    0,
    1,
  );
  const tailContact = clampValue(
    contact * (
      1 + (sample.tailSurfaceOffset ?? 0) / contactRelief
    ),
    0,
    1,
  );
  const distributedContact = clampValue(
    contact * .5 + noseContact * .25 + tailContact * .25,
    0,
    1,
  );
  const pressure = distributedContact
    * hullContact
    * waveDeficit
    * (.48 + Math.max(0, headingAlignment) * .72)
    * (.72 + Math.max(.25, sample.waveHeight) * .11)
    * (1 - tailPressure * .08 + nosePressure * .04 - pearlingRisk * .42);
  const accelerationX = waveNormalX * pressure;
  const accelerationZ = waveNormalZ * pressure;
  const forwardDrive = accelerationX * forwardX + accelerationZ * forwardZ;
  const lateralLoad = accelerationX * rightX + accelerationZ * rightZ;
  const centerOfPressure = (
    noseContact - tailContact
  ) / Math.max(.001, noseContact + tailContact + contact * 2)
    * safeLength
    * .5;
  const yawAcceleration = centerOfPressure
    * lateralLoad
    * 5.4
    * turn
    / (safeLength * safeLength);
  return {
    accelerationX,
    accelerationZ,
    pressure,
    forwardDrive,
    lateralLoad,
    waveDeficit,
    headingAlignment,
    centerOfPressure,
    yawAcceleration,
    noseContact,
    tailContact,
  };
}

/**
 * Resolves fin and rail grip from the actual hull/water state. Engagement,
 * catch quality, score, and tutorial mode are deliberately absent, so crossing
 * a bookkeeping boundary cannot grant the board extra turning authority.
 */
export function resolveSurfboardRailGrip(
  sample: SurfboardRailGripSample,
) {
  const stance = clampValue(sample.stance, -1, 1);
  const tailPressure = Math.max(0, -stance);
  const nosePressure = Math.max(0, stance);
  const highFace = Math.max(0, clampValue(sample.facePosition, -1, 1));
  const planing = clampValue(sample.planing, 0, 1);
  const waveContact = clampValue(sample.waveContact, 0, 1);
  const crossWaveLoad = clampValue(sample.crossWaveLoad, 0, 1.5);
  const railSlip = clampValue(sample.railSlip, 0, 1);
  const tubePressure = clampValue(sample.tubePressure, 0, 1);
  const whitewater = clampValue(sample.whitewater, 0, 1);
  const onshoreChop = clampValue(sample.onshoreChop, 0, 1);
  return clampValue(
    sample.baseGrip
      + planing * .08
      + waveContact * .04
      + tailPressure * .08
      - nosePressure * .1
      - highFace * .045
      - tubePressure * .035
      - whitewater * (.12 + onshoreChop * .045)
      - crossWaveLoad * .09
      - railSlip * .78,
    .08,
    1,
  );
}

export function resolveSurfboardRailDemand(
  sample: SurfboardRailDemandSample,
) {
  const stance = clampValue(sample.stance, -1, 1);
  const nosePressure = Math.max(0, stance);
  const tailPressure = Math.max(0, -stance);
  const highFace = Math.max(
    0,
    clampValue(sample.facePosition, -1, 1),
  );
  return Math.abs(clampValue(sample.railInput, -1, 1))
    * (.72 + Math.max(0, sample.speed) * .035)
    * (1 + nosePressure * .16 - tailPressure * .12)
    * (
      .92
        + clampValue(sample.tideSteepness, 0, 1.5) * .1
    )
    * (
      1
        + highFace * .08
        + clampValue(sample.tubePressure, 0, 1) * .1
    );
}

/**
 * Resolves loss of rail authority from physical demand alone. Game mode is
 * intentionally absent: coaching may differ, but identical hull loads must
 * produce identical slip.
 */
export function resolveSurfboardRailSlip(
  sample: SurfboardRailSlipSample,
): SurfboardRailSlipReading {
  const railGrip = clampValue(sample.railGrip, .08, 1);
  const gripSlip = smoothstep(
    railGrip,
    railGrip + .3,
    Math.max(0, sample.railDemand),
  );
  const sideslip = clampValue(sample.sideslip, 0, 1);
  const edgeSlip = clampValue(sample.edgeRisk, 0, 1) * .56;
  return {
    gripSlip,
    sideslip,
    edgeSlip,
    target: Math.max(gripSlip, sideslip, edgeSlip),
  };
}

export function advanceSurfboardRailSlip(
  currentSlip: number,
  sample: SurfboardRailSlipSample,
  deltaSeconds: number,
) {
  const reading = resolveSurfboardRailSlip(sample);
  const current = clampValue(currentSlip, 0, 1);
  const delta = clampValue(deltaSeconds, 0, .05);
  const response = reading.target > current ? 8.2 : 3.2;
  const railSlip = reading.target
    + (current - reading.target) * Math.exp(-response * delta);
  return {
    ...reading,
    railSlip: clampValue(railSlip, 0, 1),
  };
}

/**
 * Accumulates loss of control from physical board and water loads. Capture,
 * score, tutorial mode, and maneuver bookkeeping are deliberately absent.
 */
export function advanceSurfboardInstability(
  currentInstability: number,
  sample: SurfboardInstabilitySample,
) {
  const delta = clampValue(sample.deltaSeconds, 0, .05);
  const edgeRisk = clampValue(sample.rollEdgeRisk, 0, 1);
  const capsizeRisk = clampValue(sample.rollCapsizeRisk, 0, 1);
  const whitewater = clampValue(sample.whitewater, 0, 1);
  const shoulderStall = clampValue(sample.shoulderStall, 0, 1);
  const tubePressure = clampValue(sample.tubePressure, 0, 1);
  const crossWaveLoad = clampValue(sample.crossWaveLoad, 0, 1.5);
  const sideslip = clampValue(sample.sideslip, 0, 1);
  const waveContact = clampValue(sample.waveContact, 0, 1);
  const rollFailureLoad = edgeRisk * SURF_PHYSICS_TUNING.rollFailure
    + capsizeRisk * 2.65
    + Math.max(0, Math.abs(sample.rollRate) - 1.35) * .14;
  const broadsideFailure = Math.max(0, crossWaveLoad - .24)
    * (1 + sideslip * .72)
    * waveContact;
  const balanceThreshold = Math.max(
    .1,
    sample.balanceFailureThreshold,
  );
  const loadRate = rollFailureLoad
    + whitewater * SURF_PHYSICS_TUNING.whitewaterFailure
    + shoulderStall * SURF_PHYSICS_TUNING.shoulderFailure
    + tubePressure
      * Math.max(
        0,
        sample.balanceError - balanceThreshold * .58,
      )
      * SURF_PHYSICS_TUNING.tubeFailure
    + broadsideFailure * SURF_PHYSICS_TUNING.broadsideFailure
    + clampValue(sample.pearlingRisk, 0, 1)
      * SURF_PHYSICS_TUNING.pearlingFailure
    + clampValue(sample.pitchOverRisk, 0, 1)
      * SURF_PHYSICS_TUNING.pitchOverFailure
    + clampValue(sample.tailStall, 0, 1)
      * SURF_PHYSICS_TUNING.tailStallFailure
    - (edgeRisk < .08 ? 1.8 : 0);
  return {
    instability: Math.max(
      0,
      currentInstability + loadRate * delta,
    ),
    loadRate,
    rollFailureLoad,
    broadsideFailure,
  };
}

export function surfboardWipeoutTriggered(
  instability: number,
  rollCapsizeRisk: number,
  pitchOverRisk: number,
) {
  return rollCapsizeRisk > SURF_PHYSICS_TUNING.capsizeWipeout
    || pitchOverRisk > SURF_PHYSICS_TUNING.pitchWipeout
    || instability > SURF_PHYSICS_TUNING.wipeoutInstability;
}

export type SurfboardWipeoutSample = {
  waveHeight: number;
  wavePeriod: number;
  waveEnergy: number;
  tidePower: number;
  speed: number;
  tubePressure: number;
  whitewater: number;
  shoulderStall: number;
  railSlip: number;
  crossWaveLoad: number;
  sideslip: number;
  pearlingRisk: number;
  pitchOverRisk: number;
  rollCapsizeRisk: number;
  rollEdgeRisk: number;
};

export function resolveSurfboardWipeout(
  sample: SurfboardWipeoutSample,
) {
  const waveEnergy = clampValue(
    Math.max(.25, sample.waveHeight) / 4.2 * .24
      + Math.max(0, sample.wavePeriod - 6) / 12 * .16
      + clampValue(sample.waveEnergy, 0, 1) * .18
      + clampValue(sample.tidePower, 0, 1.5) * .09
      + Math.min(1, Math.max(0, sample.speed) / 22) * .13
      + clampValue(sample.tubePressure, 0, 1) * .08
      + clampValue(sample.whitewater, 0, 1) * .18
      + clampValue(sample.shoulderStall, 0, 1) * .035
      + clampValue(sample.railSlip, 0, 1) * .08
      + Math.min(1, clampValue(sample.crossWaveLoad, 0, 1.5)) * .13
      + clampValue(sample.sideslip, 0, 1) * .08
      + clampValue(sample.pearlingRisk, 0, 1) * .16
      + clampValue(sample.pitchOverRisk, 0, 1) * .2
      + clampValue(sample.rollCapsizeRisk, 0, 1) * .18
      + clampValue(sample.rollEdgeRisk, 0, 1) * .08,
    0,
    1,
  );
  return {
    power: waveEnergy,
    duration: clampValue(
      (
        1.55 + (4.18 - 1.55) * Math.pow(waveEnergy, .84)
      ) * SURF_PHYSICS_TUNING.wipeoutHold,
      1.35,
      4.65,
    ),
    momentumRetention: .62 + waveEnergy * .14,
    washSpeed: 1.25
      + waveEnergy * 4.1
      + clampValue(sample.waveEnergy, 0, 1) * .72,
    railThrow: clampValue(sample.crossWaveLoad, 0, 1.5)
      * (1.2 + waveEnergy * 2.1),
  };
}

export type SurfboardTumbleState = {
  roll: number;
  pitch: number;
  yaw: number;
  rollRate: number;
  pitchRate: number;
  yawRate: number;
};

export type SurfboardTumbleReleaseSample = {
  rollAngle: number;
  rollRate: number;
  pitchAngle: number;
  pitchRate: number;
  yawRate: number;
  crossWaveLoad: number;
  crossWaveSide: number;
  railSlip: number;
  rollCapsizeRisk: number;
  pitchOverRisk: number;
  pearlingRisk: number;
  impactPower: number;
  boardLength: number;
  boardWidth: number;
};

/**
 * Carries the board's live attitude and angular momentum through separation.
 * A broadside wall adds a rail-over-rail impulse, while a buried nose adds a
 * forward pitch impulse. The board dimensions change the response through
 * rotational inertia; no requested trick angle or animation target is used.
 */
export function resolveSurfboardTumbleRelease(
  sample: SurfboardTumbleReleaseSample,
): SurfboardTumbleState {
  const crossWaveLoad = clampValue(sample.crossWaveLoad, 0, 1.5);
  const railSlip = clampValue(sample.railSlip, 0, 1);
  const capsizeRisk = clampValue(sample.rollCapsizeRisk, 0, 1);
  const pitchFailure = Math.max(
    clampValue(sample.pitchOverRisk, 0, 1),
    clampValue(sample.pearlingRisk, 0, 1),
  );
  const impactPower = clampValue(sample.impactPower, 0, 1);
  const rollSide = Math.sign(sample.crossWaveSide)
    || Math.sign(sample.rollRate)
    || Math.sign(sample.rollAngle)
    || 1;
  const widthInertia = clampValue(
    Math.pow(.5 / Math.max(.38, sample.boardWidth), 1.35),
    .62,
    1.5,
  );
  const lengthInertia = clampValue(
    Math.pow(2.1 / Math.max(1.6, sample.boardLength), 1.45),
    .52,
    1.45,
  );
  const broadsideImpulse = (
    crossWaveLoad * (1.08 + impactPower * 1.72)
      + capsizeRisk * (1.02 + impactPower * .74)
      + railSlip * crossWaveLoad * .46
  ) * widthInertia;
  const pitchImpulse = pitchFailure
    * (1.18 + impactPower * 1.62)
    * lengthInertia;
  const retainedYaw = sample.yawRate
    * (.72 + (1 - impactPower) * .16);

  return {
    roll: sample.rollAngle,
    pitch: sample.pitchAngle,
    yaw: 0,
    rollRate: clampValue(
      sample.rollRate * .88 + rollSide * broadsideImpulse,
      -7.4,
      7.4,
    ),
    pitchRate: clampValue(
      sample.pitchRate * .9 + pitchImpulse,
      -5.8,
      5.8,
    ),
    yawRate: clampValue(
      retainedYaw
        + rollSide * crossWaveLoad * railSlip * .22 * lengthInertia,
      -4.8,
      4.8,
    ),
  };
}

export type SurfboardTumbleSample = {
  deltaSeconds: number;
  waterDrag: number;
  washTorque: number;
  washSide: number;
};

/**
 * Integrates a separated surfer/board tumble with angular drag from the
 * surrounding water. Midpoint angle steps keep the visible fall consistent
 * at common browser frame rates.
 */
export function advanceSurfboardTumble(
  state: SurfboardTumbleState,
  sample: SurfboardTumbleSample,
): SurfboardTumbleState {
  const delta = clampValue(sample.deltaSeconds, 0, .05);
  const waterDrag = clampValue(sample.waterDrag, 0, 1);
  const washTorque = clampValue(sample.washTorque, 0, 2.5);
  const washSide = Math.sign(sample.washSide)
    || Math.sign(state.rollRate)
    || 1;
  const nextRollRate = clampValue(
    (
      state.rollRate
        + washSide * washTorque * (1.12 + waterDrag * .58) * delta
    ) * Math.exp(-delta * (.38 + waterDrag * 1.42)),
    -7.4,
    7.4,
  );
  const nextPitchRate = clampValue(
    (
      state.pitchRate
        + Math.sign(state.pitchRate || state.pitch || 1)
          * washTorque
          * .16
          * delta
    ) * Math.exp(-delta * (.46 + waterDrag * 1.62)),
    -5.8,
    5.8,
  );
  const nextYawRate = clampValue(
    (
      state.yawRate + washSide * washTorque * .08 * delta
    ) * Math.exp(-delta * (.32 + waterDrag * 1.24)),
    -4.8,
    4.8,
  );

  return {
    roll: state.roll + (state.rollRate + nextRollRate) * .5 * delta,
    pitch: state.pitch + (state.pitchRate + nextPitchRate) * .5 * delta,
    yaw: state.yaw + (state.yawRate + nextYawRate) * .5 * delta,
    rollRate: nextRollRate,
    pitchRate: nextPitchRate,
    yawRate: nextYawRate,
  };
}

export type SurfboardSeparationReleaseSample = {
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  boardLength: number;
  boardWidth: number;
};

/**
 * Resolves the board's velocity relative to the surfer at separation from the
 * measured angular motion of its rails, nose, and tail. This replaces a fixed
 * wipeout throw with the edge speeds already produced by the capsize.
 */
export function resolveSurfboardSeparationRelease(
  sample: SurfboardSeparationReleaseSample,
) {
  const boardWidth = clampValue(sample.boardWidth, .38, .72);
  const boardLength = clampValue(sample.boardLength, 1.6, 3.6);
  const rollRate = clampValue(sample.rollRate, -7.4, 7.4);
  const pitchRate = clampValue(sample.pitchRate, -5.8, 5.8);
  const yawRate = clampValue(sample.yawRate, -4.8, 4.8);
  const rollSide = Math.sign(rollRate) || 1;
  const pitchSide = Math.sign(pitchRate);
  const railEdgeSpeed = Math.abs(rollRate) * boardWidth * .5;
  const noseTailSpeed = Math.abs(pitchRate) * boardLength * .43;
  const yawEdgeSpeed = Math.abs(yawRate) * boardWidth * .5;

  return {
    lateralVelocity: -rollSide
      * (.12 + railEdgeSpeed * 1.24 + yawEdgeSpeed * .18),
    verticalVelocity: .08
      + railEdgeSpeed * .52
      + noseTailSpeed * .22,
    longitudinalVelocity: pitchSide * noseTailSpeed * .3
      - rollSide * yawEdgeSpeed * .16,
    railEdgeSpeed,
    noseTailSpeed,
  };
}

export type SurfboardSurfaceManeuverSample = {
  durationSeconds: number;
  startFacePosition: number;
  endFacePosition: number;
  startLinePosition: number;
  endLinePosition: number;
  accumulatedYaw: number;
  peakYawRate: number;
  peakRailLoad: number;
  nosePressureSeconds: number;
  minimumWaterContact: number;
  endPlaning: number;
  endWaveContact: number;
  boardLength: number;
};

export type SurfboardSurfaceManeuverReading = {
  name: "Nose Ride" | "Bottom Turn" | "Pocket Cutback" | "Roundhouse Cutback" | "Rail Carve" | "Power Carve";
  family: "trim" | "carve";
  base: number;
  strength: number;
};

/**
 * Names a surface maneuver only after the board has physically traced it.
 * Button state, charge meters, timers, and score state are deliberately absent.
 * The recognizer sees measured rail/yaw history and the path across the
 * polygon face and pocket.
 */
export function recognizeSurfboardSurfaceManeuver(
  sample: SurfboardSurfaceManeuverSample,
): SurfboardSurfaceManeuverReading | null {
  const duration = Math.max(0, sample.durationSeconds);
  const accumulatedYaw = Math.abs(sample.accumulatedYaw);
  const peakYawRate = Math.abs(sample.peakYawRate);
  const peakRailLoad = Math.abs(sample.peakRailLoad);
  const contactSound = clampValue(sample.minimumWaterContact, 0, 1) > .46
    && clampValue(sample.endPlaning, 0, 1) > .28
    && clampValue(sample.endWaveContact, 0, 1) > .22;
  if (!contactSound || duration < .34) return null;

  const noseThreshold = sample.boardLength >= 2.72 ? .4 : .6;
  const noseHoldRatio = clampValue(
    sample.nosePressureSeconds / Math.max(.001, duration),
    0,
    1,
  );
  const faceAverage = (
    sample.startFacePosition + sample.endFacePosition
  ) * .5;
  if (
    duration >= .72
    && noseHoldRatio > noseThreshold
    && peakRailLoad < .34
    && accumulatedYaw < .28
    && faceAverage > .02
  ) {
    return {
      name: "Nose Ride",
      family: "trim",
      base: sample.boardLength >= 2.72 ? 440 : 340,
      strength: clampValue(
        .45 + noseHoldRatio * .35 + faceAverage * .2,
        0,
        1,
      ),
    };
  }

  const turnSound = peakRailLoad > .28
    && peakYawRate > .16
    && accumulatedYaw > .15;
  if (!turnSound) return null;
  const faceGain = sample.endFacePosition - sample.startFacePosition;
  const pocketReturn = sample.startLinePosition - sample.endLinePosition;
  const strength = clampValue(
    accumulatedYaw / 1.05 * .48
      + peakRailLoad * .32
      + peakYawRate / 1.8 * .12
      + Math.max(0, faceGain, pocketReturn) * .08,
    0,
    1,
  );
  if (sample.startFacePosition < -.24 && faceGain > .2) {
    return {
      name: "Bottom Turn",
      family: "carve",
      base: 185,
      strength,
    };
  }
  if (sample.startLinePosition > .3 && pocketReturn > .16) {
    const roundhouse = accumulatedYaw > .72 && pocketReturn > .34;
    return {
      name: roundhouse ? "Roundhouse Cutback" : "Pocket Cutback",
      family: "carve",
      base: roundhouse ? 410 : 285,
      strength,
    };
  }
  const powerCarve = accumulatedYaw > .52 && peakRailLoad > .5;
  return {
    name: powerCarve ? "Power Carve" : "Rail Carve",
    family: "carve",
    base: powerCarve ? 330 : 230,
    strength,
  };
}

export type SurfboardLipManeuverSample = {
  durationSeconds: number;
  startFacePosition: number;
  endFacePosition: number;
  launchVelocity: number;
  accumulatedYaw: number;
  peakAirborne: number;
  peakRailLoad: number;
  peakTailPressure: number;
  minimumWaterContact: number;
  endWaterContact: number;
  endPlaning: number;
  endWaveContact: number;
};

export type SurfboardLipManeuverReading = {
  name: "Foam Floater" | "Lip Snap" | "Tail Release" | "Lip Re-entry";
  base: number;
  strength: number;
};

/**
 * Classifies a lip maneuver from the path the hull actually took after a
 * physical ramp release. A live lip, separation or lip traversal, and a
 * controlled reconnection are required; the input gesture does not choose the
 * result in advance.
 */
export function recognizeSurfboardLipManeuver(
  sample: SurfboardLipManeuverSample,
): SurfboardLipManeuverReading | null {
  const duration = Math.max(0, sample.durationSeconds);
  const peakAirborne = Math.max(0, sample.peakAirborne);
  const minimumWaterContact = clampValue(
    sample.minimumWaterContact,
    0,
    1,
  );
  const reconnected = clampValue(sample.endWaterContact, 0, 1) > .58
    && clampValue(sample.endPlaning, 0, 1) > .24
    && clampValue(sample.endWaveContact, 0, 1) > .2;
  if (
    duration < .28
    || sample.startFacePosition < .18
    || sample.launchVelocity < .08
    || !reconnected
  ) {
    return null;
  }

  const yaw = Math.abs(sample.accumulatedYaw);
  const rail = Math.abs(sample.peakRailLoad);
  const tail = clampValue(sample.peakTailPressure, 0, 1);
  const separated = peakAirborne > .055 || minimumWaterContact < .5;
  const stayedOnLip = !separated
    && sample.startFacePosition > .42
    && sample.endFacePosition > .12;
  const strength = clampValue(
    peakAirborne / .32 * .32
      + yaw / .9 * .28
      + rail * .18
      + tail * .12
      + Math.max(0, sample.startFacePosition) * .1,
    0,
    1,
  );
  if (stayedOnLip) {
    return {
      name: "Foam Floater",
      base: 305,
      strength,
    };
  }
  if (separated && yaw > .32 && rail > .36) {
    return {
      name: "Lip Snap",
      base: 360,
      strength,
    };
  }
  if (separated && tail > .46) {
    return {
      name: "Tail Release",
      base: 390,
      strength,
    };
  }
  if (separated) {
    return {
      name: "Lip Re-entry",
      base: 330,
      strength,
    };
  }
  return null;
}

export type SurfboardLandingSample = {
  airborneManeuver: boolean;
  physicalAirLanding: boolean;
  peakAirborne: number;
  physicalLandingControl: number;
  rotationCompletion: number;
  railSlip: number;
  rollCapsizeRisk: number;
  pitchOverRisk: number;
};

/**
 * Judges a maneuver from the board's physical reconnection state. HUD targets,
 * score state, input device, and scripted trick progress are intentionally
 * absent: a sound attitude can land, while missed water contact or an
 * over-rotated, slipping, capsizing board cannot.
 */
export function surfboardLandingSucceeded(
  sample: SurfboardLandingSample,
) {
  const stableContact = clampValue(sample.railSlip, 0, 1) < .88
    && clampValue(sample.rollCapsizeRisk, 0, 1) < .9
    && clampValue(sample.pitchOverRisk, 0, 1) < .9;
  if (!stableContact) return false;
  if (!sample.airborneManeuver) return true;
  const rotationCompletion = Math.max(
    0,
    sample.rotationCompletion,
  );
  return sample.physicalAirLanding
    && Math.max(0, sample.peakAirborne) > .08
    && clampValue(sample.physicalLandingControl, 0, 1) > .12
    && rotationCompletion > .7
    && rotationCompletion < 1.16;
}

/**
 * Resolves planing support once for every surf phase from water-relative hull
 * speed, contact, stance, and board geometry.
 */
export function resolveSurfboardPlaning(
  sample: SurfboardPlaningSample,
): SurfboardPlaningReading {
  const safeLength = Math.max(1.6, sample.boardLength);
  const safeWidth = Math.max(.24, sample.boardWidth);
  const contact = clampValue(sample.waveContact, 0, 1);
  const hullContact = clampValue(sample.waterContact, 0, 1);
  const stance = clampValue(sample.stance, -1, 1);
  const tailPressure = Math.max(0, -stance);
  const nosePressure = Math.max(0, stance);
  const lengthPlaningScale = Math.sqrt(safeLength / 2.5);
  const widthPlaningScale = Math.pow(safeWidth / .34, .16);
  const threshold = 2.45
    * (1 + tailPressure * .16 - nosePressure * .08)
    / Math.max(.72, lengthPlaningScale * widthPlaningScale);
  const planing = smoothstep(
    .48,
    Math.max(.5, threshold * 1.55),
    Math.abs(sample.forwardSpeed),
  ) * (.82 + contact * .18) * hullContact;
  return { planing, threshold };
}

/**
 * Integrates one horizontal surfboard step from forces at the sampled water
 * polygon. Phase velocity is never assigned to the board. The board can only
 * acquire it through breaking-wave pressure, projected gravity, and its own
 * retained momentum; fins and the loaded rail then turn that momentum.
 */
export function advanceSurfboardDynamics(
  state: SurfboardDynamicsState,
  sample: SurfboardDynamicsSample,
): SurfboardDynamicsReading {
  const delta = Math.max(0, Math.min(.05, sample.deltaSeconds));
  const safeLength = Math.max(1.6, sample.boardLength);
  const safeWidth = Math.max(.24, sample.boardWidth);
  const stability = Math.max(.55, sample.boardStability);
  const turn = Math.max(.45, sample.boardTurn);
  const contact = Math.max(0, Math.min(1, sample.waveContact));
  const grip = Math.max(0, Math.min(1, sample.railGrip));
  const whitewater = Math.max(0, Math.min(1, sample.whitewater));
  const hullContact = Math.max(
    0,
    Math.min(1, sample.waterContact ?? 1),
  );
  const stance = Math.max(-1, Math.min(1, sample.stance));
  const railInput = Math.max(-1, Math.min(1, sample.railInput));
  const waveSpeed = Math.max(
    .001,
    Math.hypot(sample.waveVelocityX, sample.waveVelocityZ),
  );

  const initialForwardX = Math.sin(state.heading);
  const initialForwardZ = Math.cos(state.heading);
  const currentRelativeX = state.velocityX - sample.currentVelocityX;
  const currentRelativeZ = state.velocityZ - sample.currentVelocityZ;
  const initialForwardSpeed = currentRelativeX * initialForwardX
    + currentRelativeZ * initialForwardZ;
  const tailPressure = Math.max(0, -stance);
  const nosePressure = Math.max(0, stance);
  const planing = resolveSurfboardPlaning({
    forwardSpeed: initialForwardSpeed,
    waveContact: contact,
    waterContact: hullContact,
    stance,
    boardLength: safeLength,
    boardWidth: safeWidth,
  }).planing;

  const speedAuthority = smoothstep(
    .42,
    Math.max(.43, 4.7 / Math.sqrt(turn)),
    Math.abs(initialForwardSpeed),
  );
  const lengthYawInertia = Math.pow(safeLength / 2.5, 1.28);
  const targetYawRate = railInput
    * turn
    * speedAuthority
    * (.32 + Math.abs(initialForwardSpeed) * .055)
    * (.34 + grip * .66)
    * (1 + tailPressure * .34 - nosePressure * .12)
    * hullContact
    / lengthYawInertia;
  const yawResponse = (
    .32
      + hullContact * (
        1.83
          + Math.abs(initialForwardSpeed) * .23
          + grip * 1.15
      )
  ) / Math.sqrt(lengthYawInertia);
  let yawRate = state.yawRate + (
    targetYawRate - state.yawRate
  ) * (1 - Math.exp(-yawResponse * delta));
  yawRate *= Math.exp(
    -delta * (.08 + hullContact * (.34 + (1 - speedAuthority) * 1.8)),
  );
  const heading = state.heading + yawRate * delta;
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);

  // Surface particles move far slower than the crest itself. A small orbital
  // component gives the board moving water to react against without making the
  // phase speed a conveyor belt.
  const orbitalCoupling = hullContact * (.035 + contact * (
    .09 + Math.max(0, sample.waveHeight) * .018
  ));
  const waterVelocityX = sample.currentVelocityX
    + sample.waveVelocityX * orbitalCoupling;
  const waterVelocityZ = sample.currentVelocityZ
    + sample.waveVelocityZ * orbitalCoupling;
  const relativeX = state.velocityX - waterVelocityX;
  const relativeZ = state.velocityZ - waterVelocityZ;
  const forwardSpeed = relativeX * forwardX + relativeZ * forwardZ;
  const lateralSpeed = relativeX * rightX + relativeZ * rightZ;

  const slopeMagnitudeSquared = sample.surfaceSlopeX * sample.surfaceSlopeX
    + sample.surfaceSlopeZ * sample.surfaceSlopeZ;
  const gravityScale = 9.81 / Math.max(1, 1 + slopeMagnitudeSquared);
  const gravityAccelerationX = -sample.surfaceSlopeX
    * gravityScale
    * (.74 + planing * .26)
    * hullContact;
  const gravityAccelerationZ = -sample.surfaceSlopeZ
    * gravityScale
    * (.74 + planing * .26)
    * hullContact;
  const gravityDrive = gravityAccelerationX * forwardX
    + gravityAccelerationZ * forwardZ;
  const slopeAlongBoard = sample.surfaceSlopeX * forwardX
    + sample.surfaceSlopeZ * forwardZ;
  const slopePearlingRisk = contact
    * hullContact
    * smoothstep(.44, .92, nosePressure)
    * smoothstep(.075, .3, -slopeAlongBoard)
    * smoothstep(2.35, 6.8, Math.abs(forwardSpeed))
    * (.72 + whitewater * .28);
  const immersionPearlingRisk = contact
    * hullContact
    * smoothstep(.018, .17, Math.max(0, sample.noseImmersion ?? 0))
    * smoothstep(1.65, 6.4, Math.abs(forwardSpeed))
    * (.55 + nosePressure * .28 + whitewater * .17);
  const pearlingRisk = Math.min(
    1,
    Math.max(slopePearlingRisk, immersionPearlingRisk),
  );
  const pressureTailStall = contact
    * hullContact
    * smoothstep(.42, .94, tailPressure)
    * (1 - planing)
    * (1 - smoothstep(1.5, 4.2, Math.abs(forwardSpeed)));
  const immersionTailStall = contact
    * hullContact
    * smoothstep(.016, .18, Math.max(0, sample.tailImmersion ?? 0))
    * (1 - planing * .72)
    * (1 - smoothstep(1.6, 4.6, Math.abs(forwardSpeed)))
    * (.48 + tailPressure * .52 + whitewater * .12);
  const tailStall = Math.min(
    1,
    Math.max(pressureTailStall, immersionTailStall),
  );

  const wavePressure = resolveSurfboardWavePressure({
    velocityX: state.velocityX,
    velocityZ: state.velocityZ,
    heading,
    waveVelocityX: sample.waveVelocityX,
    waveVelocityZ: sample.waveVelocityZ,
    waveContact: contact,
    waterContact: hullContact,
    waveHeight: sample.waveHeight,
    stance,
    pearlingRisk,
    noseSurfaceOffset: sample.noseSurfaceOffset,
    tailSurfaceOffset: sample.tailSurfaceOffset,
    boardLength: safeLength,
    boardTurn: turn,
  });
  yawRate = clampValue(
    yawRate + wavePressure.yawAcceleration * delta,
    -4.8,
    4.8,
  );

  const lengthDragScale = Math.pow(2.5 / safeLength, .58);
  const widthDragScale = Math.pow(safeWidth / .34, .46);
  const longitudinalDrag = (.033 + whitewater * .035)
    * lengthDragScale
    * widthDragScale
    * (.05 + hullContact * .95)
    * (1 - planing * .52)
    * (
      1
        + tailPressure * .22
        - nosePressure * .06
        + pearlingRisk * 2.2
        + tailStall * .48
    );
  const lateralDrag = (
    .2
      + grip * (.29 + planing * .24)
      + Math.abs(railInput) * grip * .12
  ) * widthDragScale
    * (.04 + hullContact * .96)
    / Math.sqrt(stability);
  const dragForward = -forwardSpeed
    * Math.abs(forwardSpeed)
    * longitudinalDrag;
  const dragLateral = -lateralSpeed
    * Math.abs(lateralSpeed)
    * lateralDrag;
  const turbulenceX = (sample.turbulenceX ?? 0)
    * whitewater
    * hullContact
    / Math.sqrt(stability);
  const turbulenceZ = (sample.turbulenceZ ?? 0)
    * whitewater
    * hullContact
    / Math.sqrt(stability);
  let accelerationX = gravityAccelerationX
    + wavePressure.accelerationX
    + forwardX * dragForward
    + rightX * dragLateral
    + turbulenceX;
  let accelerationZ = gravityAccelerationZ
    + wavePressure.accelerationZ
    + forwardZ * dragForward
    + rightZ * dragLateral
    + turbulenceZ;
  const accelerationMagnitude = Math.hypot(accelerationX, accelerationZ);
  const accelerationLimit = 13.5 + whitewater * 4;
  if (accelerationMagnitude > accelerationLimit) {
    const scale = accelerationLimit / accelerationMagnitude;
    accelerationX *= scale;
    accelerationZ *= scale;
  }

  let velocityX = state.velocityX + accelerationX * delta;
  let velocityZ = state.velocityZ + accelerationZ * delta;
  const speed = Math.hypot(velocityX, velocityZ);
  const speedLimit = Math.max(18, waveSpeed * 1.62 + sample.waveHeight * .8);
  if (speed > speedLimit) {
    const scale = speedLimit / speed;
    velocityX *= scale;
    velocityZ *= scale;
  }
  const sideslip = Math.max(
    0,
    Math.min(
      1,
      Math.abs(lateralSpeed) / Math.max(1.2, Math.abs(forwardSpeed) + .4),
    ),
  );
  const railLoad = railInput
    * speedAuthority
    * grip
    * hullContact
    * (1 + tailPressure * .18)
    * (1 - sideslip * .28);
  return {
    velocityX,
    velocityZ,
    heading: Math.atan2(Math.sin(heading), Math.cos(heading)),
    yawRate,
    accelerationX,
    accelerationZ,
    forwardSpeed,
    lateralSpeed,
    planing,
    railLoad,
    sideslip,
    gravityDrive,
    wavePressure: wavePressure.pressure,
    wavePressureCenter: wavePressure.centerOfPressure,
    waveYawAcceleration: wavePressure.yawAcceleration,
    waveForwardDrive: wavePressure.forwardDrive,
    waveLateralLoad: wavePressure.lateralLoad,
    pearlingRisk,
    tailStall,
  };
}

/**
 * Resolves what the water is physically doing to the board at its current
 * position. This deliberately has no lineup, tutorial, or action-button input:
 * standing is always legal, while capture and wipeout are consequences of the
 * live surface, board heading, and relative velocity.
 */
export function evaluateBoardWaterInteraction(
  sample: BoardWaterSample,
): BoardWaterReading {
  const waveSpeed = Math.max(.001, Math.hypot(
    sample.waveVelocityX,
    sample.waveVelocityZ,
  ));
  const waveNormalX = sample.waveVelocityX / waveSpeed;
  const waveNormalZ = sample.waveVelocityZ / waveSpeed;
  const boardForwardX = Math.sin(sample.boardHeading);
  const boardForwardZ = Math.cos(sample.boardHeading);
  const headingAlignment = Math.max(
    -1,
    Math.min(1, boardForwardX * waveNormalX + boardForwardZ * waveNormalZ),
  );
  const headingError = Math.atan2(
    waveNormalX * boardForwardZ - waveNormalZ * boardForwardX,
    headingAlignment,
  );
  const broadside = 1 - Math.abs(headingAlignment);
  const crossWaveSide = Math.sign(
    waveNormalX * boardForwardZ - waveNormalZ * boardForwardX,
  ) || 1;
  const normalSpeed = sample.velocityX * waveNormalX
    + sample.velocityZ * waveNormalZ;
  const relativeWaveSpeed = waveSpeed - normalSpeed;
  const faceSlope = Math.max(
    0,
    -(sample.slopeX * waveNormalX + sample.slopeZ * waveNormalZ),
  );
  const faceStrength = smoothstep(
    .008,
    .105 + Math.max(.25, sample.waveHeight) * .032,
    faceSlope,
  );
  const riseStrength = smoothstep(
    .015,
    .24 + Math.max(.25, sample.waveHeight) * .14,
    sample.surfaceRise,
  );
  const liftStrength = smoothstep(
    .025,
    .24 + Math.max(.25, sample.waveHeight) * .19,
    sample.surfaceLift,
  );
  const crestEnvelope = smoothstep(-3.4, .25, sample.crestDistance)
    * (1 - smoothstep(
      7.4,
      13.8 + Math.max(.25, sample.waveHeight) * 1.5,
      sample.crestDistance,
    ));
  const physicalFace = Math.max(
    faceStrength * .76 + liftStrength * .24,
    riseStrength * .58 + faceStrength * .42,
    liftStrength * .54 + riseStrength * .46,
  );
  const surfaceCanCarry = sample.crestSurfable
    || (sample.crestEnergy >= .14 && physicalFace >= .24);
  const waveContact = Math.max(
    0,
    Math.min(
      1,
      crestEnvelope
        * physicalFace
        * (surfaceCanCarry ? 1 : .28)
        * (.72 + Math.max(0, Math.min(1, sample.crestEnergy)) * .28),
    ),
  );
  const planing = Math.max(
    0,
    Math.min(
      1,
      normalSpeed / Math.max(1.1, waveSpeed * .66),
    ),
  );
  // A surfboard can angle into a shoulder, but it cannot acquire planing trim
  // while presenting most of its rail to the wave. Preserve useful diagonal
  // entries while making the final quarter-turn toward broadside lose capture
  // sharply rather than behaving like an arcade pickup radius.
  const directionalEntry = smoothstep(.25, .94, headingAlignment);
  const speedMatch = smoothstep(
    .18,
    Math.max(.19, waveSpeed * .48),
    Math.max(0, normalSpeed),
  );
  const capture = Math.max(
    0,
    Math.min(
      1,
      waveContact
        * directionalEntry
        * (.34 + speedMatch * .42 + planing * .24),
    ),
  );
  const stability = Math.max(.62, Math.sqrt(Math.max(.35, sample.boardStability)));
  const crossWaveLoad = Math.max(
    0,
    Math.min(
      1.5,
      waveContact
        * broadside
        * Math.max(0, relativeWaveSpeed)
        / Math.max(1.2, waveSpeed * .54)
        * (.78 + sample.crestEnergy * .42)
        / stability,
    ),
  );
  const backwardLoad = Math.max(0, -headingAlignment)
    * waveContact
    * Math.max(0, relativeWaveSpeed)
    / Math.max(1.2, waveSpeed);
  const wipeoutRisk = Math.max(
    0,
    Math.min(
      1,
      (
        crossWaveLoad * .82
        + backwardLoad * .42
        + waveContact * Math.max(0, broadside - .52) * .28
      ) / stability,
    ),
  );
  const crossSlope = sample.slopeX * Math.cos(sample.boardHeading)
    - sample.slopeZ * Math.sin(sample.boardHeading);
  const balanceTarget = Math.max(
    -.92,
    Math.min(
      .92,
      (
        crossSlope * .48
        + crossWaveSide * crossWaveLoad * .46
      ) / stability,
    ),
  );
  const totalSpeed = Math.hypot(sample.velocityX, sample.velocityZ);
  const outcome = wipeoutRisk >= .62
    ? "tumble"
    : capture >= .2
      ? "capture"
      : totalSpeed >= .55 || waveContact >= .1
        ? "glide"
        : "stand";
  return {
    outcome,
    waveContact,
    capture,
    wipeoutRisk,
    headingAlignment,
    headingError,
    broadside,
    crossWaveLoad,
    crossWaveSide,
    relativeWaveSpeed,
    planing,
    faceSlope,
    balanceTarget,
  };
}

export type ThermalKitId = "hooded-5-4" | "full-4-3" | "full-3-2" | "spring-2-2" | "tropical";

export type ThermalKit = {
  id: ThermalKitId;
  name: string;
  shortName: string;
  bodyVariant: "full" | "spring" | "tropical";
  insulation: number;
  effectiveTemperature: number;
};

export type TideResponse = {
  level: number;
  label: string;
  shortName: string;
  note: string;
  quality: number;
  faceScale: number;
  powerScale: number;
  steepnessScale: number;
  hollowScale: number;
  variabilityScale: number;
  breakShift: number;
  shorebreakScale: number;
};

const DEFAULT_TIDE_BREAK: BreakCharacter = {
  kind: "beach",
  line: "A-FRAME",
  peel: 0,
  power: 1,
  steepness: .7,
  hollow: .4,
  variability: .4,
  length: 1,
};

const TIDE_RESPONSE_CACHE = new WeakMap<BreakCharacter, Map<number, TideResponse>>();

export function tideResponseForBreak(tide: number, character: BreakCharacter): TideResponse {
  const safeTide = Number.isFinite(tide) ? tide : 0;
  const cacheKey = Math.round(safeTide * 1000) / 1000;
  const characterCache = TIDE_RESPONSE_CACHE.get(character);
  const cached = characterCache?.get(cacheKey);
  if (cached) return cached;
  const level = Math.max(-1, Math.min(1, safeTide / (safeTide < 0 ? 1.5 : 1.8)));
  const low = Math.max(0, -level);
  const high = Math.max(0, level);
  const drained = level < -.38;
  const full = level > .42;
  const response = {
    ideal: 0,
    tolerance: .82,
    faceScale: 1,
    powerScale: 1,
    steepnessScale: 1,
    hollowScale: 1,
    variabilityScale: 1,
    breakShift: 0,
    shorebreakScale: 1,
    lowLabel: "Low-water draw",
    midLabel: "Tide in tune",
    highLabel: "Full-tide push",
    lowNote: "The break is drawing off the bottom",
    midNote: "Water depth and seabed are balanced",
    highNote: "More water is softening the break",
  };

  if (character.kind === "beach") {
    Object.assign(response, {
      ideal: -.08,
      tolerance: .7,
      faceScale: 1 + low * .08 - high * .05,
      powerScale: 1 + low * .06 - high * .04,
      steepnessScale: 1 + low * .15 - high * .16,
      hollowScale: 1 + low * .2 - high * .25,
      variabilityScale: 1 + low * .16 + high * .12,
      breakShift: level * 8,
      shorebreakScale: 1 + high * .32 - low * .08,
      lowLabel: "Exposed sandbars",
      midLabel: "Sandbar pulse",
      highLabel: "High-tide shorebreak",
      lowNote: "Shallow banks make punchier, less predictable peaks",
      midNote: "The sandbar is carrying a balanced breaking depth",
      highNote: "Deep banks soften outside while shorebreak gains weight",
    });
  } else if (character.kind === "reef") {
    Object.assign(response, {
      ideal: .06,
      tolerance: .82,
      faceScale: 1 + low * .06 - high * .035,
      powerScale: 1 + low * .08 - high * .04,
      steepnessScale: 1 + low * .16 - high * .12,
      hollowScale: 1 + low * .21 - high * .16,
      variabilityScale: 1 + low * .06 + high * .03,
      breakShift: level * 4.2,
      shorebreakScale: .9 + high * .08,
      lowLabel: "Drawn reef",
      midLabel: "Reef in tune",
      highLabel: "Deep-water wrap",
      lowNote: "Less water makes the reef faster, steeper, and hollower",
      midNote: "The reef has enough water without losing its shape",
      highNote: "Extra depth rounds the lip and moves energy down the line",
    });
  } else if (character.kind === "slab") {
    Object.assign(response, {
      ideal: .16,
      tolerance: .72,
      faceScale: 1 + low * .08 - high * .045,
      powerScale: 1 + low * .11 - high * .035,
      steepnessScale: 1 + low * .2 - high * .11,
      hollowScale: 1 + low * .24 - high * .13,
      variabilityScale: 1 + low * .08,
      breakShift: level * 3.2,
      shorebreakScale: .86 + high * .06,
      lowLabel: "Dry-ledge slab",
      midLabel: "Ledge engaged",
      highLabel: "Slab softened",
      lowNote: "The ledge is drawing hard with a violent pitching lip",
      midNote: "Water depth keeps the ledge powerful and makeable",
      highNote: "More water cushions the ledge without removing its power",
    });
  } else if (character.kind === "point") {
    Object.assign(response, {
      ideal: .18,
      tolerance: .78,
      faceScale: 1 - low * .025 + high * .03,
      powerScale: 1 - low * .03 + high * .025,
      steepnessScale: 1 + low * .12 - high * .055,
      hollowScale: 1 + low * .12 - high * .06,
      variabilityScale: 1 + low * .18 - high * .06,
      breakShift: level * 5.2,
      shorebreakScale: .82 + high * .07,
      lowLabel: "Sectioned point",
      midLabel: "Point running",
      highLabel: "Full-tide wrap",
      lowNote: "The line is fast and segmented over shallow sections",
      midNote: "The point is linking speed, wall, and pocket",
      highNote: "Extra depth opens a rounder, longer wrapping wall",
    });
  } else if (character.kind === "canyon") {
    Object.assign(response, {
      ideal: 0,
      tolerance: .95,
      faceScale: 1 + low * .025 + high * .018,
      powerScale: 1 + low * .025 + high * .02,
      steepnessScale: 1 + low * .04 - high * .025,
      hollowScale: 1 + low * .035 - high * .025,
      variabilityScale: 1 + Math.abs(level) * .05,
      breakShift: level * 2,
      shorebreakScale: .94 + high * .08,
      lowLabel: "Canyon draw",
      midLabel: "Canyon focus",
      highLabel: "Canyon surge",
      lowNote: "Deep-water focusing dominates the low-water draw",
      midNote: "The canyon is focusing swell directly into the peak",
      highNote: "Rising water adds surge more than it changes the peak",
    });
  }

  const tideFit = Math.exp(-Math.pow((level - response.ideal) / response.tolerance, 2));
  const quality = Math.max(.42, Math.min(1, .45 + tideFit * .55));
  const result = {
    level,
    label: drained ? response.lowLabel : full ? response.highLabel : response.midLabel,
    shortName: drained ? "LOW DRAW" : full ? "FULL TIDE" : "MID TIDE",
    note: drained ? response.lowNote : full ? response.highNote : response.midNote,
    quality,
    faceScale: response.faceScale,
    powerScale: response.powerScale,
    steepnessScale: response.steepnessScale,
    hollowScale: response.hollowScale,
    variabilityScale: response.variabilityScale,
    breakShift: response.breakShift,
    shorebreakScale: response.shorebreakScale,
  };
  const nextCache = characterCache ?? new Map<number, TideResponse>();
  nextCache.set(cacheKey, result);
  if (!characterCache) TIDE_RESPONSE_CACHE.set(character, nextCache);
  return result;
}

export function thermalKitForConditions(
  waterTemperature: number,
  airTemperature: number,
  windSpeed: number,
): ThermalKit {
  const water = Number.isFinite(waterTemperature) ? waterTemperature : 20;
  const air = Number.isFinite(airTemperature) ? airTemperature : water;
  const wind = Number.isFinite(windSpeed) ? Math.max(0, windSpeed) : 0;
  const airAdjustment = Math.max(-1.35, Math.min(1.05, (air - water) * .09));
  const windChill = Math.max(0, wind - 7) * .024;
  const effectiveTemperature = water + airAdjustment - windChill;
  if (effectiveTemperature < 14.5) {
    return {
      id: "hooded-5-4",
      name: "Hooded 5/4 · gloves + boots",
      shortName: "5/4 HOOD",
      bodyVariant: "full",
      insulation: .97,
      effectiveTemperature,
    };
  }
  if (effectiveTemperature < 17.5) {
    return {
      id: "full-4-3",
      name: "Sealed 4/3 full suit",
      shortName: "4/3 FULL",
      bodyVariant: "full",
      insulation: .91,
      effectiveTemperature,
    };
  }
  if (effectiveTemperature < 21.5) {
    return {
      id: "full-3-2",
      name: "Flexible 3/2 full suit",
      shortName: "3/2 FULL",
      bodyVariant: "full",
      insulation: .82,
      effectiveTemperature,
    };
  }
  if (effectiveTemperature < 24.5) {
    return {
      id: "spring-2-2",
      name: "Short-arm 2/2 spring suit",
      shortName: "2/2 SPRING",
      bodyVariant: "spring",
      insulation: .58,
      effectiveTemperature,
    };
  }
  return {
    id: "tropical",
    name: "UV rashguard · performance boardshort",
    shortName: "TROPICAL",
    bodyVariant: "tropical",
    insulation: .22,
    effectiveTemperature,
  };
}

const TIDE_SHORELINE_TRAVEL = 3;

export function shorelineShiftForTide(tide: number) {
  return Math.max(-1.5, Math.min(1.8, tide)) * TIDE_SHORELINE_TRAVEL;
}

/**
 * Reports actual travel through the shallow exit corridor. The value depends
 * only on coastal position, never on how long a score/result overlay has been
 * visible.
 */
export function shorelineRideOutProgress(coastalZ: number) {
  return smoothstep(
    RIDE_RESULT_LINE_Z,
    SHALLOW_DISMOUNT_Z,
    coastalZ,
  );
}

export type GameStats = {
  phase: GamePhase;
  sessionIntro: number;
  score: number;
  combo: number;
  rideDistance: number;
  pocketDistance: number;
  offshoreDistance: number;
  coastDistance: number;
  cameraHeading: number;
  paddleHeading: number;
  speed: number;
  acceleration: number;
  lateralForce: number;
  paddleEffort: number;
  paddleStroke: number;
  wavePressureDrive: number;
  wavePressureSideLoad: number;
  balance: number;
  balanceTarget: number;
  waveEngaged: boolean;
  waveEngagement: number;
  boardAlignment: number;
  boardWaveAngle: number;
  crossWaveLoad: number;
  planing: number;
  rollAngle: number;
  rollRate: number;
  rollEdgeRisk: number;
  capsizeRisk: number;
  pitchAngle: number;
  pitchRate: number;
  noseImmersion: number;
  tailImmersion: number;
  pitchOverRisk: number;
  verticalVelocity: number;
  boardWaterContact: number;
  airborneHeight: number;
  landingImpact: number;
  pearlingRisk: number;
  tailStall: number;
  waveQuality: number;
  facePosition: number;
  linePosition: number;
  lineControl: number;
  lineSide: number;
  sectionPressure: number;
  whitewaterPressure: number;
  railLoad: number;
  railGrip: number;
  stance: number;
  barrelTime: number;
  barrelIntensity: number;
  stamina: number;
  setEnergy: number;
  nextSetSeconds: number;
  setWaveIndex: number;
  setWaveCount: number;
  setActive: boolean;
  crestEnergy: number;
  crestApproach: number;
  crestDistance: number;
  nextWaveEnergy: number;
  waveSurfable: boolean;
  maneuver: string;
  maneuverScore: number;
  maneuverQuality: number;
  maneuverId: number;
  maneuverCount: number;
  maneuverActive: boolean;
  maneuverProgress: number;
  maneuverPhase: "line" | "load" | "release" | "air" | "land";
  maneuverLaunchVelocity: number;
  maneuverLaunchYawRate: number;
  maneuverRotation: number;
  maneuverRotationTarget: number;
  maneuverPeakAirborne: number;
  trickCharge: number;
  maneuverAirborne: boolean;
  landingTarget: number;
  landingWindow: number;
  maxCombo: number;
  grade: SessionGrade;
  rideScore: number;
  rideManeuvers: number;
  rideGrade: SessionGrade;
  rideResult: "" | "clean" | "wipeout";
  rideResultId: number;
  rideTakeoffQuality: number;
  rideLineQuality: number;
  rideControlQuality: number;
  ridePowerQuality: number;
  rideMaxSpeed: number;
  rideMaxCombo: number;
  rideOutProgress: number;
  vehicleMode: boolean;
  vehicleGear: "P" | "D" | "R";
  vehicleThrottle: number;
  vehicleTraction: number;
  vehicleSlip: number;
  vehicleOffRoad: number;
  nearVan: boolean;
  inLineup: boolean;
  catchReady: boolean;
  shorebreakIntensity: number;
  shorebreakSeconds: number;
  duckDiveReady: boolean;
  duckDiveActive: boolean;
  duckDiveQuality: number;
  submersion: number;
  wipeoutPower: number;
  holdDownSeconds: number;
  breath: number;
  leashTension: number;
  shorebreakId: number;
  shorebreakResult: "" | "clean" | "hit";
  takeoffAlignment: number;
  takeoffQuality: number;
  takeoffCommitProgress: number;
  waveCapture: number;
  prompt: string;
};

export const INITIAL_STATS: GameStats = {
  phase: "shore",
  sessionIntro: 0,
  score: 0,
  combo: 1,
  rideDistance: 0,
  pocketDistance: 0,
  offshoreDistance: 0,
  coastDistance: 0,
  cameraHeading: 0,
  paddleHeading: 0,
  speed: 0,
  acceleration: 0,
  lateralForce: 0,
  paddleEffort: 0,
  paddleStroke: 0,
  wavePressureDrive: 0,
  wavePressureSideLoad: 0,
  balance: 0,
  balanceTarget: 0,
  waveEngaged: false,
  waveEngagement: 0,
  boardAlignment: 1,
  boardWaveAngle: 0,
  crossWaveLoad: 0,
  planing: 0,
  rollAngle: 0,
  rollRate: 0,
  rollEdgeRisk: 0,
  capsizeRisk: 0,
  pitchAngle: 0,
  pitchRate: 0,
  noseImmersion: 0,
  tailImmersion: 0,
  pitchOverRisk: 0,
  verticalVelocity: 0,
  boardWaterContact: 1,
  airborneHeight: 0,
  landingImpact: 0,
  pearlingRisk: 0,
  tailStall: 0,
  waveQuality: 0,
  facePosition: 0,
  linePosition: 0,
  lineControl: 1,
  lineSide: 1,
  sectionPressure: 0,
  whitewaterPressure: 0,
  railLoad: 0,
  railGrip: 1,
  stance: 0,
  barrelTime: 0,
  barrelIntensity: 0,
  stamina: 100,
  setEnergy: 0,
  nextSetSeconds: 0,
  setWaveIndex: 0,
  setWaveCount: 0,
  setActive: false,
  crestEnergy: 0,
  crestApproach: 0,
  crestDistance: 0,
  nextWaveEnergy: 0,
  waveSurfable: false,
  maneuver: "",
  maneuverScore: 0,
  maneuverQuality: 0,
  maneuverId: 0,
  maneuverCount: 0,
  maneuverActive: false,
  maneuverProgress: 0,
  maneuverPhase: "line",
  maneuverLaunchVelocity: 0,
  maneuverLaunchYawRate: 0,
  maneuverRotation: 0,
  maneuverRotationTarget: 0,
  maneuverPeakAirborne: 0,
  trickCharge: 0,
  maneuverAirborne: false,
  landingTarget: 0,
  landingWindow: 0,
  maxCombo: 1,
  grade: "C",
  rideScore: 0,
  rideManeuvers: 0,
  rideGrade: "C",
  rideResult: "",
  rideResultId: 0,
  rideTakeoffQuality: 0,
  rideLineQuality: 0,
  rideControlQuality: 0,
  ridePowerQuality: 0,
  rideMaxSpeed: 0,
  rideMaxCombo: 1,
  rideOutProgress: 0,
  vehicleMode: false,
  vehicleGear: "P",
  vehicleThrottle: 0,
  vehicleTraction: 1,
  vehicleSlip: 0,
  vehicleOffRoad: 0,
  nearVan: false,
  inLineup: false,
  catchReady: false,
  shorebreakIntensity: 0,
  shorebreakSeconds: 0,
  duckDiveReady: false,
  duckDiveActive: false,
  duckDiveQuality: 0,
  submersion: 0,
  wipeoutPower: 0,
  holdDownSeconds: 0,
  breath: 100,
  leashTension: 0,
  shorebreakId: 0,
  shorebreakResult: "",
  takeoffAlignment: 0,
  takeoffQuality: 0,
  takeoffCommitProgress: 0,
  waveCapture: 0,
  prompt: "Walk toward the water · or find the van",
};

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function waveGroupOrdinal(crestIndex: number) {
  // A fixed observer sees crest indices decrease as the train travels shoreward.
  // The longer irregular spectrum avoids a repeating "three-wave set" cadence
  // while remaining deterministic on CPU and GPU.
  return positiveModulo(-crestIndex, WAVE_ENERGY_SEQUENCE.length);
}

function crestEnergy(crestIndex: number) {
  return WAVE_ENERGY_SEQUENCE[waveGroupOrdinal(crestIndex)];
}

export function waveEnergyForPhase(phase: number) {
  const crestCoordinate = (phase - Math.PI * .5) / (Math.PI * 2);
  const lowerCrest = Math.floor(crestCoordinate);
  const blend = crestCoordinate - lowerCrest;
  const easedBlend = blend * blend * (3 - 2 * blend);
  const lowerEnergy = crestEnergy(lowerCrest);
  return lowerEnergy + (crestEnergy(lowerCrest + 1) - lowerEnergy) * easedBlend;
}

function waveReadStateForPhase(phase: number, wavePeriod: number) {
  const period = Math.max(4, wavePeriod);
  const angularSpeed = Math.PI * 2 / period;
  const crestCoordinate = (phase - Math.PI * .5) / (Math.PI * 2);
  const closestCrest = Math.round(crestCoordinate);
  const energy = waveEnergyForPhase(phase);
  const currentCrestEnergy = crestEnergy(closestCrest);
  const crestPhase = Math.PI * .5 + closestCrest * Math.PI * 2;
  const crestPhaseError = Math.atan2(
    Math.sin(phase - crestPhase),
    Math.cos(phase - crestPhase),
  );
  const crestProximity = 1 - smoothstep(.12, 1.5, Math.abs(crestPhaseError));
  const crestSurfable = currentCrestEnergy >= SURFABLE_CREST_ENERGY;
  const upcomingCrest = Math.floor(crestCoordinate + .000001);
  let secondsToPeak = Number.POSITIVE_INFINITY;
  let nextSurfableEnergy = currentCrestEnergy;
  for (let offset = 0; offset <= WAVE_ENERGY_SEQUENCE.length; offset += 1) {
    const candidate = upcomingCrest - offset;
    const candidateEnergy = crestEnergy(candidate);
    if (candidateEnergy < SURFABLE_CREST_ENERGY) continue;
    const candidatePhase = Math.PI * .5 + candidate * Math.PI * 2;
    secondsToPeak = Math.max(0, phase - candidatePhase) / angularSpeed;
    nextSurfableEnergy = candidateEnergy;
    break;
  }
  return {
    energy,
    secondsToPeak: secondsToPeak < .45 ? 0 : secondsToPeak,
    cycle: period * WAVE_ENERGY_SEQUENCE.length,
    waveCount: 0,
    setWaveIndex: 0,
    setActive: crestSurfable && crestProximity > .08,
    crestEnergy: currentCrestEnergy,
    crestPhase,
    crestPhaseError,
    crestProximity,
    crestIndex: waveGroupOrdinal(closestCrest) + 1,
    crestSequenceLength: WAVE_ENERGY_SEQUENCE.length,
    crestSurfable,
    nextSurfableEnergy,
  };
}

export function waveSetState(elapsed: number, wavePeriod: number) {
  const period = Math.max(4, wavePeriod);
  return waveReadStateForPhase(-elapsed * (Math.PI * 2 / period), period);
}

export function waveSetStateAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  return waveReadStateForPhase(
    primaryWavePhaseAt(x, z, elapsed, settings, character),
    settings.wavePeriod,
  );
}

function breakingWaveProfile(phase: number, nonlinearity: number) {
  // A continuous, crest-focused profile. The harmonics sharpen the forward
  // wall while the powered positive half-wave gives the crest a real ridge
  // instead of leaving the ocean as a gently tinted sine plane.
  const shape = Math.max(0, Math.min(.9, nonlinearity));
  const fundamental = Math.sin(phase);
  const crestRidge = Math.pow(Math.max(0, fundamental), 5);
  const troughDraw = Math.pow(Math.max(0, -fundamental), 2);
  return fundamental
    - shape * .48 * Math.cos(phase * 2)
    - shape * .22 * Math.sin(phase * 3)
    + shape * .72 * crestRidge
    - shape * .12 * troughDraw;
}

export function sessionGrade(score: number, rideDistance: number, maneuverCount: number): SessionGrade {
  const performance = score + rideDistance * 18 + maneuverCount * 420;
  if (performance >= 11500) return "S";
  if (performance >= 6500) return "A";
  if (performance >= 2600) return "B";
  return "C";
}

export function settingsFromConditions(conditions: MarineConditions, coastHeading: number): SessionSettings {
  const localHour = Number(conditions.observedAt.slice(11, 13));
  return {
    mode: "training",
    board: "performance",
    waveHeight: conditions.waveHeight,
    wavePeriod: conditions.wavePeriod,
    waveDirection: conditions.waveDirection,
    swellHeight: conditions.swellHeight,
    swellPeriod: conditions.swellPeriod,
    swellDirection: conditions.swellDirection,
    currentStrength: conditions.currentVelocity,
    currentDirection: conditions.currentDirection,
    windSpeed: conditions.windSpeed,
    windDirection: conditions.windDirection,
    waterTemperature: conditions.waterTemperature,
    airTemperature: conditions.airTemperature,
    coastHeading,
    tide: conditions.seaLevel,
    timeOfDay: Number.isFinite(localHour) ? localHour + 0.5 : 16,
    weatherCode: conditions.weatherCode,
  };
}

export function waveHeightAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  const tideResponse = tideResponseForBreak(settings.tide, character ?? DEFAULT_TIDE_BREAK);
  const power = (character?.power ?? 1) * tideResponse.powerScale;
  const steepness = (character?.steepness ?? .7) * tideResponse.steepnessScale;
  const peel = character?.peel ?? 0;
  const variability = (character?.variability ?? .4) * tideResponse.variabilityScale;
  const amplitude = Math.max(0.12, settings.waveHeight * 0.78) * power * tideResponse.faceScale;
  const period = Math.max(4, settings.wavePeriod);
  const speed = (Math.PI * 2) / period;
  const coastalZ = z - shorelineShiftForTide(settings.tide);
  const section = Math.sin(x * .07 + elapsed * .05) * variability * 2.3;
  const breakZ = coastalZ + x * peel * .16 + section - tideResponse.breakShift;
  const shoreBoost = .72 + smoothstep(-85, 8, breakZ) * (.58 + steepness * .24);
  const p1 = primaryWavePhaseAt(x, z, elapsed, settings, character);
  const setEnergy = waveEnergyForPhase(p1);
  const setLift = 0.78 + setEnergy * 0.34;
  const shoaling = smoothstep(-96, 9, breakZ);
  const primaryNonlinearity = shoaling
    * (.18 + steepness * .32 + (character?.hollow ?? .35) * tideResponse.hollowScale * .18)
    * (.7 + setEnergy * .3);
  const primaryProfile = breakingWaveProfile(p1, primaryNonlinearity);
  const relativeWaveAngle = ((settings.waveDirection - settings.coastHeading) * Math.PI) / 180;
  const relativeSwellAngle = ((settings.swellDirection - settings.coastHeading) * Math.PI) / 180;
  const relativeCurrentAngle = ((settings.currentDirection - settings.coastHeading) * Math.PI) / 180;
  const relativeWindAngle = ((settings.windDirection - settings.coastHeading) * Math.PI) / 180;
  const waveDirectionX = Math.sin(relativeWaveAngle);
  const waveDirectionZ = Math.cos(relativeWaveAngle);
  const currentDirectionX = Math.sin(relativeCurrentAngle);
  const currentDirectionZ = Math.cos(relativeCurrentAngle);
  const swellDirectionX = Math.sin(relativeSwellAngle);
  const swellDirectionZ = Math.max(.28, Math.cos(relativeSwellAngle));
  const swellDirectionLength = Math.hypot(swellDirectionX, swellDirectionZ);
  const normalizedSwellX = swellDirectionX / swellDirectionLength;
  const normalizedSwellZ = swellDirectionZ / swellDirectionLength;
  const swellPeriod = Math.max(4, settings.swellPeriod);
  const swellWavelength = Math.max(64, Math.min(520, 1.56 * swellPeriod * swellPeriod));
  const swellPhase = (
    x * normalizedSwellX + coastalZ * normalizedSwellZ
  ) * (Math.PI * 2 / swellWavelength) - elapsed * (Math.PI * 2 / swellPeriod) + 1.7;
  const swellShoaling = .84 + smoothstep(-85, 8, breakZ) * .24;
  // Marine swell height is crest-to-trough height, so its physical mesh
  // amplitude is half that value. It is independent of the local breaking
  // face control in Wave Lab.
  const swellAmplitude = Math.max(0, settings.swellHeight * .5);

  const currentBend = Math.max(0, Math.min(1, settings.currentStrength / 4));
  const crossCurrentWeight = .12 + currentBend * .12;
  const crossDirectionX = waveDirectionX
    + waveDirectionZ * .62
    + currentDirectionX * crossCurrentWeight;
  const crossDirectionZ = Math.max(.28, waveDirectionZ - waveDirectionX * .62)
    + currentDirectionZ * crossCurrentWeight;
  const crossDirectionLength = Math.hypot(crossDirectionX, crossDirectionZ);
  const crossPhase = (
    x * crossDirectionX / crossDirectionLength
    + coastalZ * crossDirectionZ / crossDirectionLength
  ) * (Math.PI * 2 / 47.5) - elapsed * speed * 2.7;

  const windChop = Math.max(.12, Math.min(1.45, settings.windSpeed / 24));
  const windDirectionX = Math.sin(relativeWindAngle);
  const windDirectionZ = Math.cos(relativeWindAngle) + .15;
  const windDirectionLength = Math.hypot(windDirectionX, windDirectionZ);
  const windWavelength = 8.5 + (5.4 - 8.5) * (windChop / 1.45);
  const windPhase = (
    x * windDirectionX / windDirectionLength
    + coastalZ * windDirectionZ / windDirectionLength
  ) * (Math.PI * 2 / windWavelength) - elapsed * (1.7 + windChop * 1.2) + 2.4;
  const rawHeight = (
    settings.tide * 0.3 +
    amplitude * setLift * shoreBoost * primaryProfile * 0.64 +
    swellAmplitude * swellShoaling * Math.sin(swellPhase) +
    amplitude * Math.sin(crossPhase) * 0.11 +
    (.035 + windChop * .065) * Math.sin(windPhase)
  );
  const shoreEdgeAnchor = smoothstep(-18, 8, coastalZ);
  return rawHeight + (settings.tide * .3 - rawHeight) * shoreEdgeAnchor;
}

export function waveSurfaceFrameAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  const sampleRadius = Math.max(.42, Math.min(.9, .42 + settings.waveHeight * .13));
  const height = waveHeightAt(x, z, elapsed, settings, character);
  const slopeX = (
    waveHeightAt(x + sampleRadius, z, elapsed, settings, character)
    - waveHeightAt(x - sampleRadius, z, elapsed, settings, character)
  ) / (sampleRadius * 2);
  const slopeZ = (
    waveHeightAt(x, z + sampleRadius, elapsed, settings, character)
    - waveHeightAt(x, z - sampleRadius, elapsed, settings, character)
  ) / (sampleRadius * 2);
  const normalLength = Math.hypot(slopeX, 1, slopeZ);
  return {
    height,
    slopeX,
    slopeZ,
    normalX: -slopeX / normalLength,
    normalY: 1 / normalLength,
    normalZ: -slopeZ / normalLength,
  };
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}

export function evaluateWaveTakeoff(sample: WaveTakeoffSample): WaveTakeoffReading {
  const waveHeight = Math.max(.25, sample.waveHeight);
  // A real takeoff develops across the rising wall, not at one mathematical
  // crest coordinate. Allow late entries just behind the lip and early entries
  // well down the open face; exact placement becomes a quality input.
  const faceEnvelope = smoothstep(-3.2, .35, sample.crestDistance)
    * (1 - smoothstep(
      7.2,
      Math.max(12, 13.5 + waveHeight * 1.8),
      sample.crestDistance,
    ));
  const riseStrength = smoothstep(
    -.06,
    .18 + waveHeight * .16,
    sample.surfaceRise,
  );
  const liftStrength = smoothstep(
    .01,
    .15 + waveHeight * .22,
    sample.surfaceLift,
  );
  const slopeStrength = smoothstep(
    .002,
    .065 + waveHeight * .026,
    sample.faceSlope,
  );
  const physicalLift = Math.max(
    liftStrength * .92,
    riseStrength * .72 + slopeStrength * .28,
    slopeStrength * .58 + liftStrength * .42,
  );
  // The deterministic crest spectrum still describes wave power, but the
  // rendered surface can prove that a lower-energy crest has stood up enough
  // to surf. This keeps visuals and mechanics connected.
  const surfable = sample.crestSurfable || (
    sample.crestEnergy >= .16
    && physicalLift >= .34
    && (riseStrength >= .1 || slopeStrength >= .18)
  );
  const headingQuality = smoothstep(-.25, .88, sample.alignment);
  const paddleQuality = Math.max(0, Math.min(1, sample.paddleDrive));
  const breakSupport = .52 + Math.max(0, Math.min(1, sample.breakProgress)) * .48;
  const opportunity = surfable
    ? faceEnvelope
      * (.18 + physicalLift * .82)
      * breakSupport
      * (.7 + headingQuality * .3)
      * (.72 + paddleQuality * .28)
    : 0;
  const idealFaceDistance = 2.7 + Math.min(1.8, waveHeight * .45);
  const positionQuality = 1 - smoothstep(
    2.4,
    8.6,
    Math.abs(sample.crestDistance - idealFaceDistance),
  );
  const energyQuality = .3 + smoothstep(.16, .86, sample.crestEnergy) * .7;
  const quality = surfable
    ? Math.max(.12, Math.min(
        1,
        .05
          + opportunity * .22
          + positionQuality * .12
          + headingQuality * .15
          + paddleQuality * .28
          + energyQuality * .08
          + physicalLift * .1,
      ))
    : 0;
  const threshold = SURF_PHYSICS_TUNING.takeoffOpportunityThreshold;
  const headingMinimum = SURF_PHYSICS_TUNING.takeoffHeadingMinimum;
  return {
    catchable: surfable
      && faceEnvelope > .045
      && physicalLift > .075
      && sample.alignment >= headingMinimum
      && opportunity >= threshold,
    surfable,
    opportunity,
    quality,
    faceEnvelope,
    physicalLift,
    riseStrength,
    liftStrength,
    slopeStrength,
    headingQuality,
    positionQuality,
  };
}

function primaryWaveWavelength(period: number, compression: number) {
  return Math.max(48, Math.min(320, 1.56 * period * period)) * compression;
}

export function primaryWavePhaseAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  const tideResponse = tideResponseForBreak(settings.tide, character ?? DEFAULT_TIDE_BREAK);
  const steepness = (character?.steepness ?? .7) * tideResponse.steepnessScale;
  const peel = character?.peel ?? 0;
  const variability = (character?.variability ?? .4) * tideResponse.variabilityScale;
  const waveAngle = ((settings.waveDirection - settings.coastHeading) * Math.PI) / 180;
  const currentAngle = ((settings.currentDirection - settings.coastHeading) * Math.PI) / 180;
  const coastalZ = z - shorelineShiftForTide(settings.tide);
  const section = Math.sin(x * .07 + elapsed * .05) * variability * 2.3;
  const breakZ = coastalZ + x * peel * .16 + section - tideResponse.breakShift;
  const shoaling = smoothstep(-108, 9, breakZ);
  const shallowScale = .34 + (.18 - .34) * Math.max(0, Math.min(1, steepness));
  const compression = 1 + (shallowScale - 1) * shoaling;
  const directionX = .095 + peel * .075 + Math.sin(waveAngle) * .42 + Math.sin(currentAngle) * .035;
  const directionZ = Math.max(.45, Math.cos(waveAngle));
  const directionLength = Math.hypot(directionX, directionZ);
  const curvedZ = breakZ + Math.sin(waveAngle) * .0019 * x * x;
  const waveNumber = (Math.PI * 2) / primaryWaveWavelength(settings.wavePeriod, compression);
  const angularSpeed = (Math.PI * 2) / Math.max(4, settings.wavePeriod);
  return (x * directionX / directionLength + curvedZ * directionZ / directionLength) * waveNumber - elapsed * angularSpeed;
}

export function primaryWaveVelocityAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  const tideResponse = tideResponseForBreak(settings.tide, character ?? DEFAULT_TIDE_BREAK);
  const steepness = (character?.steepness ?? .7) * tideResponse.steepnessScale;
  const peel = character?.peel ?? 0;
  const variability = (character?.variability ?? .4) * tideResponse.variabilityScale;
  const waveAngle = ((settings.waveDirection - settings.coastHeading) * Math.PI) / 180;
  const currentAngle = ((settings.currentDirection - settings.coastHeading) * Math.PI) / 180;
  const coastalZ = z - shorelineShiftForTide(settings.tide);
  const section = Math.sin(x * .07 + elapsed * .05) * variability * 2.3;
  const breakZ = coastalZ + x * peel * .16 + section - tideResponse.breakShift;
  const shoaling = smoothstep(-108, 9, breakZ);
  const shallowScale = .34 + (.18 - .34) * Math.max(0, Math.min(1, steepness));
  const compression = 1 + (shallowScale - 1) * shoaling;
  const directionX = .095 + peel * .075 + Math.sin(waveAngle) * .42 + Math.sin(currentAngle) * .035;
  const directionZ = Math.max(.45, Math.cos(waveAngle));
  const directionLength = Math.hypot(directionX, directionZ);
  const wavelength = primaryWaveWavelength(settings.wavePeriod, compression);
  const phaseSpeed = wavelength / Math.max(4, settings.wavePeriod);
  return {
    x: directionX / directionLength * phaseSpeed,
    z: directionZ / directionLength * phaseSpeed,
    speed: phaseSpeed,
    wavelength,
  };
}

export function compassDirection(degrees: number) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

export function formatClock(iso: string) {
  if (!iso.includes("T")) return iso;
  const [hourString, minute] = iso.split("T")[1].split(":");
  const hour = Number(hourString);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}
