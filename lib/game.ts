import type { MarineConditions } from "./marine";
import type { BreakCharacter } from "./beaches";
import {
  coastWaveModelAt,
  oceanTideShorelineShift,
  sampleCoastDominantWave,
  sampleCoastWaveSurface,
} from "./ocean.ts";
import {
  dominantCrestPropertiesAtPhase,
  spectralCrestAtOrdinal,
  type WaveComponentBank,
} from "./waves.ts";
import { DEFAULT_TIDE_BREAK } from "./tide.ts";
export {
  forecastFaceHeightForBreak,
  tideResponseForBreak,
  type TideResponse,
} from "./tide.ts";

export type GameMode = "training" | "advanced" | "playground";
export type GamePhase = "shore" | "driving" | "wading" | "paddling" | "riding" | "wipeout";
export type SurfAssistLevel = "guided" | "natural" | "raw";
export type SessionGrade = "C" | "B" | "A" | "S";
export type BoardType = "performance" | "fish" | "longboard";
export const SHORELINE_REFERENCE_Z = 8;
// A completed ride is scored in the swash, not while the surfer is still on
// an open face. The final board-to-feet transition happens just landward of
// the nominal wet line so a broken wave can visibly carry the board to shore.
export const RIDE_RESULT_LINE_Z = SHORELINE_REFERENCE_Z - 1;
export const SHALLOW_DISMOUNT_Z = SHORELINE_REFERENCE_Z + .35;
export const OUTER_PADDLE_LIMIT_Z = -900;
// Baseline shoaling starts offshore so the takeoff zone leaves a usable face
// between the crest and the inside. Set energy can move it farther outside.
export const BREAK_OFFSHORE_OFFSET = 24;
export const MAX_OFFSHORE_DISTANCE = SHORELINE_REFERENCE_Z - OUTER_PADDLE_LIMIT_Z;
const SURFABLE_CREST_ENERGY = .45;

/**
 * Assistance changes how forgiving the surfer's technique is, not the wave
 * surface. Every profile reads the same polygons, set sequence, current, and
 * board dimensions; Guided adds leverage and recovery margin so learning the
 * physical controls does not require surviving raw-ocean punishment first.
 */
export const SURF_ASSIST_PROFILES = {
  guided: {
    label: "Guided",
    description: "Forgiving basic lines, strong turns, and automatic recovery.",
    paddleTurnAuthority: 1.38,
    proneLateralLoad: .56,
    shorebreakExposure: .68,
    failureMargin: .08,
    duckDiveWindowScale: 1.32,
    surfTurnAuthority: 1.42,
    automaticCounterweight: .72,
    railTorqueScale: .78,
    ridingStabilityScale: 1.28,
    railGripBonus: .14,
    railDemandScale: .72,
    instabilityLoadScale: .42,
    instabilityRecoveryScale: 1.35,
    wipeoutThresholdScale: 1.42,
    trimSupportBonus: .22,
    momentumRetention: 1.24,
    pocketDriveScale: 1.08,
    pocketWindowScale: 1.3,
  },
  natural: {
    label: "Natural",
    description: "Real board response with enough recovery to explore the face.",
    paddleTurnAuthority: 1.16,
    proneLateralLoad: .78,
    shorebreakExposure: .84,
    failureMargin: .035,
    duckDiveWindowScale: 1.14,
    surfTurnAuthority: 1.18,
    automaticCounterweight: .36,
    railTorqueScale: .9,
    ridingStabilityScale: 1.12,
    railGripBonus: .06,
    railDemandScale: .86,
    instabilityLoadScale: .7,
    instabilityRecoveryScale: 1.16,
    wipeoutThresholdScale: 1.2,
    trimSupportBonus: .1,
    momentumRetention: 1.12,
    pocketDriveScale: 1,
    pocketWindowScale: 1.12,
  },
  raw: {
    label: "Raw",
    description: "Full lateral load, timing, and separation thresholds.",
    paddleTurnAuthority: 1,
    proneLateralLoad: 1,
    shorebreakExposure: 1,
    failureMargin: 0,
    duckDiveWindowScale: 1,
    surfTurnAuthority: 1,
    automaticCounterweight: 0,
    railTorqueScale: 1,
    ridingStabilityScale: 1,
    railGripBonus: 0,
    railDemandScale: 1,
    instabilityLoadScale: 1,
    instabilityRecoveryScale: 1,
    wipeoutThresholdScale: 1,
    trimSupportBonus: 0,
    momentumRetention: 1,
    pocketDriveScale: 1,
    pocketWindowScale: 1,
  },
} as const satisfies Record<
  SurfAssistLevel,
  {
    label: string;
    description: string;
    paddleTurnAuthority: number;
    proneLateralLoad: number;
    shorebreakExposure: number;
    failureMargin: number;
    duckDiveWindowScale: number;
    surfTurnAuthority: number;
    automaticCounterweight: number;
    railTorqueScale: number;
    ridingStabilityScale: number;
    railGripBonus: number;
    railDemandScale: number;
    instabilityLoadScale: number;
    instabilityRecoveryScale: number;
    wipeoutThresholdScale: number;
    trimSupportBonus: number;
    momentumRetention: number;
    pocketDriveScale: number;
    pocketWindowScale: number;
  }
>;

/**
 * One physical calibration shared by every mode. Training changes what the
 * player can see and learn, not how the same board, body, and water respond.
 */
export const SURF_PHYSICS_TUNING = {
  paddleRecovery: 1.55,
  paddleStrokeDrain: .19,
  shorebreakLead: 2.55,
  duckDiveWarningLead: 2.35,
  duckDiveCueLead: .78,
  duckDiveTimingWindow: .78,
  duckDiveThreshold: .34,
  takeoffWindPenalty: .055,
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

export function surfingStaminaDelta(
  tubePressure: number,
  whitewaterPressure: number,
  waveEnergy: number,
  deltaSeconds: number,
) {
  const delta = Math.max(0, Math.min(.05, deltaSeconds));
  const tube = clampValue(tubePressure, 0, 1);
  const whitewater = clampValue(whitewaterPressure, 0, 1);
  const energy = clampValue(waveEnergy, 0, 1);
  const tubeCost = tube * SURF_PHYSICS_TUNING.tubeFatigue;
  const foamCost = whitewater > .12
    ? whitewater
      * (5.8 + energy * 4.5)
      * SURF_PHYSICS_TUNING.foamFatigue
    : 0;
  return delta * (6.5 - tubeCost - foamCost);
}

export type DuckDiveInitiationSample = {
  secondsToImpact: number;
  shorebreakPower: number;
  stamina: number;
  noseIntoWallAlignment: number;
  timingWindowScale?: number;
};

export type DuckDiveInitiationReading = {
  timingQuality: number;
  orientationQuality: number;
  quality: number;
  duration: number;
  effortCost: number;
};

export type DuckDiveCuePhase =
  | "clear"
  | "prepare"
  | "dive";

/**
 * Separates the time needed to spot and square up to a wall from the shorter
 * interval in which beginning the dive can put the board under the lip.
 */
export function readDuckDiveCue(
  secondsToImpact: number,
  shorebreakPower: number,
): DuckDiveCuePhase {
  const seconds = Math.max(0, secondsToImpact);
  const power = clampValue(shorebreakPower, 0, 1);
  if (
    power < .08
    || seconds <= .02
    || seconds > SURF_PHYSICS_TUNING.duckDiveWarningLead
  ) return "clear";
  return seconds <= SURF_PHYSICS_TUNING.duckDiveCueLead
    ? "dive"
    : "prepare";
}

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
  const orientationQuality = smoothstep(
    .18,
    .92,
    clampValue(sample.noseIntoWallAlignment, -1, 1),
  );
  const incomingWall = shorebreakPower > .06 && secondsToImpact > 0;
  const timingWindow = SURF_PHYSICS_TUNING.duckDiveTimingWindow
    * clampValue(sample.timingWindowScale ?? 1, 1, 1.5);
  const timingQuality = incomingWall
    ? clampValue(
        1
          - Math.abs(secondsToImpact - .3)
            / timingWindow,
        0,
        1,
      )
    : 0;
  return {
    timingQuality,
    orientationQuality,
    quality: timingQuality * orientationQuality,
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

export type SurferCounterweightState = {
  counterweight: number;
  velocity: number;
};

export type SurferCounterweightSample = {
  deltaSeconds: number;
  intent: number;
  support: number;
  stamina: number;
  centerOfMassHeight: number;
  bodyCompression: number;
  boardRollAngle: number;
  boardRollRate: number;
};

export type SurferCounterweightReading = SurferCounterweightState & {
  trackingError: number;
  swayAcceleration: number;
};

/**
 * Integrates the surfer's lateral center of mass relative to the stringer.
 * Controls request a weight shift, but the body takes time to move and lags a
 * rolling board. Low support during prone transitions, fatigue, and a tall
 * stance slow the correction; compression lowers the center of mass. This
 * state is intentionally independent of ride classification and score.
 */
export function advanceSurferCounterweightDynamics(
  state: SurferCounterweightState,
  sample: SurferCounterweightSample,
): SurferCounterweightReading {
  const delta = clampValue(sample.deltaSeconds, 0, .05);
  const intent = clampValue(sample.intent, -1, 1);
  const support = clampValue(sample.support, .2, 1);
  const stamina = clampValue(sample.stamina, 0, 100) / 100;
  const centerOfMassHeight = clampValue(
    sample.centerOfMassHeight,
    0,
    1,
  );
  const compression = clampValue(sample.bodyCompression, 0, 1);
  const rollAngle = clampValue(sample.boardRollAngle, -1.3, 1.3);
  const rollRate = clampValue(sample.boardRollRate, -4.8, 4.8);
  const response = (
    3.45
      + support * 2.35
      + compression * 1.05
  ) * (.66 + stamina * .34);
  const dampingRatio = .82 + compression * .12;
  const heightCoupling = (
    1.08 + centerOfMassHeight * 1.62
  ) * (1 - compression * .42);
  const swayAcceleration = -(
    Math.sin(rollAngle) * heightCoupling
      + rollRate * (.72 + centerOfMassHeight * .68)
  );
  let counterweight = clampValue(state.counterweight, -1, 1);
  let velocity = clampValue(state.velocity, -5.2, 5.2);
  let remaining = delta;

  // Fixed internal steps keep the body response equivalent across browser
  // frame rates while preserving momentum through phase transitions.
  while (remaining > 1e-6) {
    const step = Math.min(1 / 240, remaining);
    const acceleration = clampValue(
      (intent - counterweight) * response * response
        - velocity * response * 2 * dampingRatio
        + swayAcceleration,
      -24,
      24,
    );
    velocity = clampValue(velocity + acceleration * step, -5.2, 5.2);
    counterweight = clampValue(
      counterweight + velocity * step,
      -1,
      1,
    );
    if (
      (counterweight <= -1 && velocity < 0)
      || (counterweight >= 1 && velocity > 0)
    ) {
      velocity = 0;
    }
    remaining -= step;
  }

  return {
    counterweight,
    velocity,
    trackingError: intent - counterweight,
    swayAcceleration,
  };
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

export type SurferPassiveCompressionSample = {
  railLoad: number;
  stance: number;
  longitudinalAcceleration: number;
  lateralAcceleration: number;
  tubePressure: number;
  whitewaterPressure: number;
  balanceError: number;
  crossWaveLoad: number;
};

/**
 * Resolves the body compression forced by measured board and water loads.
 * Ride classification is intentionally absent: the same rail, acceleration,
 * stance, foam, and balance state must lower the same center of mass.
 */
export function resolveSurferPassiveCompression(
  sample: SurferPassiveCompressionSample,
) {
  const tailPressure = Math.max(0, -clampValue(sample.stance, -1, 1));
  return clampValue(
    Math.abs(sample.railLoad) * .38
      + tailPressure * .2
      + Math.abs(sample.lateralAcceleration) * .16
      + Math.max(0, -sample.longitudinalAcceleration) * .12
      + clampValue(sample.tubePressure, 0, 1) * .12
      + clampValue(sample.whitewaterPressure, 0, 1) * .18
      + clampValue(sample.balanceError, 0, 2) * .12
      + clampValue(sample.crossWaveLoad, 0, 1.5) * .12,
    0,
    1,
  );
}

export type ReturnProneTransitionSample = {
  deltaSeconds: number;
  requested: boolean;
};

export type ReturnProneTransitionReading = {
  progress: number;
  active: boolean;
  completed: boolean;
  footSupport: number;
  handSupport: number;
  bodyLowering: number;
  counterweightAuthority: number;
  verticalLoadAcceleration: number;
};

/**
 * Integrates the surfer's move from standing to prone as a body-weight
 * transfer. Feet release progressively, the hands carry a transient load, and
 * the center of mass lowers before the hull changes control posture.
 */
export function advanceReturnProneTransition(
  currentProgress: number,
  sample: ReturnProneTransitionSample,
): ReturnProneTransitionReading {
  const delta = clampValue(sample.deltaSeconds, 0, .05);
  const duration = .86;
  const current = clampValue(currentProgress, 0, 1);
  const active = current > 0 || sample.requested;
  const progress = active
    ? clampValue(current + delta / duration, 0, 1)
    : 0;
  const bodyLowering = smoothstep(.06, .94, progress);
  const footSupport = 1 - smoothstep(.24, .9, progress);
  const handSupport = Math.sin(progress * Math.PI)
    * smoothstep(.04, .28, progress);
  return {
    progress,
    active,
    completed: active && progress >= 1,
    footSupport,
    handSupport,
    bodyLowering,
    counterweightAuthority: 1 - bodyLowering * .58,
    verticalLoadAcceleration: -2.35
      * Math.sin(progress * Math.PI)
      * (1 - footSupport * .24),
  };
}

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

export type CrestTimingReading = {
  state: "tracking" | "overtaken" | "ahead";
  severity: number;
  percent: number;
};

/**
 * Converts the continuous crest-relation state into tutorial language without
 * changing it. The stronger physical loss wins when lip overtake and shoulder
 * runout overlap.
 */
export function readCrestTimingMechanics(
  overtaken: number,
  ahead: number,
): CrestTimingReading {
  const safeOvertaken = clampValue(overtaken, 0, 1.4);
  const safeAhead = clampValue(ahead, 0, 1.4);
  const severity = Math.max(safeOvertaken, safeAhead);
  const state = severity < .12
    ? "tracking"
    : safeOvertaken >= safeAhead
      ? "overtaken"
      : "ahead";
  return {
    state,
    severity,
    percent: Math.round(clampValue(severity, 0, 1) * 100),
  };
}

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

/**
 * Follows the nearest polygon crest while the hull is detached, then preserves
 * that crest's identity as soon as hydrodynamic pressure begins to build.
 * A scoring or ride-state flag is deliberately absent.
 */
export function resolveWaveCrestPhaseIdentity(
  surfacePhase: number,
  trackedCrestPhase: number,
  hullEngagement: number,
) {
  const nearestCrestPhase = Math.PI * .5
    + Math.round(
      (surfacePhase - Math.PI * .5) / (Math.PI * 2),
    ) * Math.PI * 2;
  return !Number.isFinite(trackedCrestPhase)
    || clampValue(hullEngagement, 0, 1) < .06
    ? nearestCrestPhase
    : trackedCrestPhase;
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

/**
 * One calibration for how much propulsion the breaking face itself supplies.
 * The pocket window is measured in resolveWaveSectionPressure line units, the
 * accelerations in m/s^2, and the headroom ratio against wave phase speed.
 */
export const WAVE_DRIVE_TUNING = {
  maxDriveAcceleration: 4.2,
  pocketCore: .38,
  shoulderFalloff: 1.14,
  deepFalloff: 1.42,
  lipTaper: .35,
  downTheLineThrow: .34,
  speedHeadroomRatio: 2.1,
  tubeHeadroomBonus: .35,
  flatsGlideDrag: .024,
  glideFadeStart: .12,
  glideFadeEnd: .45,
  whitewaterDriveLoss: .55,
} as const;

export type WavePocketDriveSample = {
  linePosition: number;
  facePosition: number;
  waveEnergy: number;
  waveSpeed: number;
  waveNormalX: number;
  waveNormalZ: number;
  lineSide: number;
  boardHeading: number;
  forwardSpeed: number;
  waveContact: number;
  whitewater: number;
  tubePressure: number;
  driveScale?: number;
  pocketWindowScale?: number;
};

export type WavePocketDriveReading = {
  pocketFactor: number;
  faceFactor: number;
  trimFactor: number;
  headroom: number;
  envelope: number;
  driveMagnitude: number;
  driveX: number;
  driveZ: number;
  glideDragBonus: number;
};

/**
 * Resolves the propulsion the breaking face itself delivers at the board's
 * live pocket-relative position. The steep face just ahead of the curl keeps
 * rising under the hull, so the same downslope force is continuously restored
 * there; the shoulder is fat and delivers little; unbroken water ahead of the
 * wave delivers none and instead bleeds glide. Ride state, scoring, and
 * tutorial mode are deliberately absent, matching the other pocket resolvers.
 */
export function resolveWavePocketDrive(
  sample: WavePocketDriveSample,
): WavePocketDriveReading {
  // A single NaN here would integrate straight into board velocity, so the
  // resolver refuses non-finite localization outright.
  if (
    !Number.isFinite(sample.linePosition)
    || !Number.isFinite(sample.facePosition)
    || !Number.isFinite(sample.boardHeading)
    || !Number.isFinite(sample.waveSpeed)
    || !Number.isFinite(sample.forwardSpeed)
  ) {
    return {
      pocketFactor: 0,
      faceFactor: 0,
      trimFactor: 0,
      headroom: 0,
      envelope: 0,
      driveMagnitude: 0,
      driveX: 0,
      driveZ: 0,
      glideDragBonus: 0,
    };
  }
  // Hull/water contact is deliberately absent: advanceSurfboardDynamics gates
  // the applied drive through hullContact once, so an airborne board receives
  // nothing without the gate compounding here.
  const contact = clampValue(sample.waveContact, 0, 1);
  const energy = clampValue(sample.waveEnergy, 0, 1);
  const whitewater = clampValue(sample.whitewater, 0, 1);
  const tube = clampValue(sample.tubePressure, 0, 1);
  const waveSpeed = Math.max(0, sample.waveSpeed);
  const windowScale = clampValue(sample.pocketWindowScale ?? 1, .6, 1.6);
  const lineSide = sample.lineSide < 0 ? -1 : 1;
  // Assist forgiveness widens only the shoulder side of the window; the deep
  // side keeps raw units so drive still dies out behind the peel within the
  // measurable linePosition range.
  const linePosition = sample.linePosition >= 0
    ? sample.linePosition / windowScale
    : sample.linePosition;
  // Asymmetric bell around the curl: the shoulder side goes slack quickly as
  // the face fattens, while the deep side fades more slowly into foam push.
  const shoulderFade = 1 - smoothstep(
    WAVE_DRIVE_TUNING.pocketCore,
    WAVE_DRIVE_TUNING.shoulderFalloff,
    linePosition,
  );
  const deepFade = 1 - smoothstep(
    WAVE_DRIVE_TUNING.pocketCore,
    WAVE_DRIVE_TUNING.deepFalloff,
    -linePosition,
  );
  const pocketFactor = clampValue(Math.min(shoulderFade, deepFade), 0, 1);
  const facePosition = clampValue(sample.facePosition, -1, 1);
  const faceFactor = smoothstep(-.55, .05, facePosition)
    * (1 - smoothstep(.78, 1.08, facePosition) * WAVE_DRIVE_TUNING.lipTaper);
  const forwardX = Math.sin(sample.boardHeading);
  const forwardZ = Math.cos(sample.boardHeading);
  const headingAlignment = clampValue(
    forwardX * sample.waveNormalX + forwardZ * sample.waveNormalZ,
    -1,
    1,
  );
  const broadside = Math.sqrt(Math.max(
    0,
    1 - headingAlignment * headingAlignment,
  ));
  // Trim across the face outruns a straight-to-shore line; a nose pointed
  // back offshore earns nothing.
  const trimFactor = (.55 + .45 * smoothstep(.08, .52, broadside))
    * smoothstep(-.28, .02, headingAlignment);
  const headroomRatio = WAVE_DRIVE_TUNING.speedHeadroomRatio
    + tube * WAVE_DRIVE_TUNING.tubeHeadroomBonus;
  const speedRatio = waveSpeed < .001
    ? 1
    : Math.max(0, sample.forwardSpeed) / (waveSpeed * headroomRatio);
  const headroom = 1 - smoothstep(.55, 1, speedRatio);
  const envelope = pocketFactor * faceFactor * (.3 + energy * .7);
  const driveMagnitude = WAVE_DRIVE_TUNING.maxDriveAcceleration
    * envelope
    * trimFactor
    * headroom
    * contact
    * (1 - whitewater * WAVE_DRIVE_TUNING.whitewaterDriveLoss)
    * clampValue(sample.driveScale ?? 1, 0, 1.6);
  // The curl's throw carries an alongshore component toward the peel, so part
  // of the drive is steered down the line instead of along the hull.
  const downLineX = sample.waveNormalZ * lineSide;
  const downLineZ = -sample.waveNormalX * lineSide;
  const throwBlend = pocketFactor
    * WAVE_DRIVE_TUNING.downTheLineThrow
    * (.45 + tube * .55);
  const rawDirectionX = forwardX * (1 - throwBlend) + downLineX * throwBlend;
  const rawDirectionZ = forwardZ * (1 - throwBlend) + downLineZ * throwBlend;
  const directionMagnitude = Math.hypot(rawDirectionX, rawDirectionZ);
  const directionX = directionMagnitude < .05
    ? forwardX
    : rawDirectionX / directionMagnitude;
  const directionZ = directionMagnitude < .05
    ? forwardZ
    : rawDirectionZ / directionMagnitude;
  // Glide decay keys on face support, not the pocket envelope, so a bottom
  // turn through the trough of a live face keeps its momentum while unbroken
  // water ahead of the wave bleeds it. The fade band zeroes the penalty once
  // contact is solid — a live face never leaks drag into the pocket.
  const glideDragBonus = WAVE_DRIVE_TUNING.flatsGlideDrag
    * (1 - smoothstep(
      WAVE_DRIVE_TUNING.glideFadeStart,
      WAVE_DRIVE_TUNING.glideFadeEnd,
      contact,
    ))
    * (1 - whitewater);
  return {
    pocketFactor,
    faceFactor,
    trimFactor,
    headroom,
    envelope,
    driveMagnitude,
    driveX: directionX * driveMagnitude,
    driveZ: directionZ * driveMagnitude,
    glideDragBonus,
  };
}

export const WAVE_PUMP_TUNING = {
  maxDriveAcceleration: 2.9,
  minSwingRate: .16,
  minSwingTravel: .12,
  cadenceFloor: .34,
  cadenceIdeal: .95,
  cadenceCeiling: 2.4,
  rhythmGain: .42,
  rhythmDecay: .38,
  staminaWorkScale: .34,
} as const;

export type WavePumpState = {
  previousFacePosition: number;
  faceRate: number;
  swingDirection: number;
  swingTravel: number;
  lastSwingAt: number;
  rhythm: number;
};

export const createWavePumpState = (): WavePumpState => ({
  previousFacePosition: 0,
  faceRate: 0,
  swingDirection: 0,
  swingTravel: 0,
  lastSwingAt: -10,
  rhythm: 0,
});

export type WavePumpSample = {
  elapsed: number;
  deltaSeconds: number;
  facePosition: number;
  pocketEnvelope: number;
  waveContact: number;
  waterContact: number;
  planing: number;
  compression: number;
  forwardSpeed: number;
  waveSpeed: number;
  tubePressure: number;
  whitewater: number;
};

export type WavePumpReading = {
  rhythm: number;
  driveMagnitude: number;
  swinging: boolean;
};

/**
 * Tracks the rider's own climb-and-drop line across the face and converts a
 * sustained rhythm into bounded extra drive. The physical basis is standard
 * pumping: high on the face the rising water does work on the weighted hull,
 * and driving down converts that stored height back into board speed, so
 * repeated swings at wave-matched cadence extract net propulsion the way a
 * straight trim line cannot. The swing detector reads the measured face
 * position only — there is no pump button — and the drive obeys the same
 * speed-headroom law as the pocket drive, so pumping cannot push the hull
 * past the crest's transport budget. Score, combo, and mode are absent.
 */
export function advanceWavePumpDrive(
  state: WavePumpState,
  sample: WavePumpSample,
): WavePumpReading {
  const delta = Math.max(.0001, sample.deltaSeconds);
  const face = clampValue(sample.facePosition, -1.2, 1.2);
  const instantRate = (face - state.previousFacePosition) / delta;
  state.previousFacePosition = face;
  // Low-pass the measured rate so crest-phase jitter cannot register as a
  // pump swing.
  const rateBlend = 1 - Math.exp(-delta * 9);
  state.faceRate += (clampValue(instantRate, -6, 6) - state.faceRate)
    * rateBlend;
  const support = clampValue(sample.waveContact, 0, 1)
    * clampValue(sample.waterContact, 0, 1);
  const direction = state.faceRate > WAVE_PUMP_TUNING.minSwingRate
    ? 1
    : state.faceRate < -WAVE_PUMP_TUNING.minSwingRate
      ? -1
      : 0;
  if (direction !== 0 && direction === state.swingDirection) {
    state.swingTravel += Math.abs(state.faceRate) * delta;
  }
  if (direction !== 0 && direction !== state.swingDirection) {
    if (
      state.swingDirection !== 0
      && state.swingTravel >= WAVE_PUMP_TUNING.minSwingTravel
      && support > .22
    ) {
      const cadence = sample.elapsed - state.lastSwingAt;
      const cadenceQuality = smoothstep(
        WAVE_PUMP_TUNING.cadenceFloor,
        WAVE_PUMP_TUNING.cadenceIdeal,
        cadence,
      ) * (1 - smoothstep(
        WAVE_PUMP_TUNING.cadenceIdeal,
        WAVE_PUMP_TUNING.cadenceCeiling,
        cadence,
      ));
      // Bearing down through the swing (a compressed body) loads the hull
      // while the face is doing work on it; an upright rider extracts less.
      const weightTiming = .62 + clampValue(sample.compression, 0, 1) * .38;
      state.rhythm = clampValue(
        state.rhythm
          + cadenceQuality
            * weightTiming
            * WAVE_PUMP_TUNING.rhythmGain
            * support,
        0,
        1,
      );
    }
    state.lastSwingAt = sample.elapsed;
    state.swingDirection = direction;
    state.swingTravel = 0;
  }
  // Rhythm dies once the line goes still: a stalled swing decays much faster
  // than an active one, so gliding straight bleeds the pump within a couple
  // of seconds.
  const idleSeconds = sample.elapsed - state.lastSwingAt;
  const decayScale = 1 + smoothstep(
    WAVE_PUMP_TUNING.cadenceIdeal,
    WAVE_PUMP_TUNING.cadenceCeiling * 1.4,
    idleSeconds,
  ) * 2.6;
  state.rhythm = Math.max(
    0,
    state.rhythm
      - state.rhythm * WAVE_PUMP_TUNING.rhythmDecay * decayScale * delta,
  );
  const headroomRatio = WAVE_DRIVE_TUNING.speedHeadroomRatio
    + clampValue(sample.tubePressure, 0, 1)
      * WAVE_DRIVE_TUNING.tubeHeadroomBonus;
  const speedRatio = sample.waveSpeed < .001
    ? 1
    : Math.max(0, sample.forwardSpeed) / (sample.waveSpeed * headroomRatio);
  const headroom = 1 - smoothstep(.5, .98, speedRatio);
  const driveMagnitude = WAVE_PUMP_TUNING.maxDriveAcceleration
    * state.rhythm
    * (.3 + clampValue(sample.pocketEnvelope, 0, 1) * .7)
    * support
    * (.45 + clampValue(sample.planing, 0, 1) * .55)
    * (1 - clampValue(sample.whitewater, 0, 1) * .55)
    * headroom;
  return {
    rhythm: state.rhythm,
    driveMagnitude,
    swinging: direction !== 0,
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

/**
 * Integrates the board's continuous relation to a tracked crest. Wave support
 * comes from measured hull contact and crest energy, never ride classification,
 * so an overtaking lip exists before capture and decays away in quiet water.
 */
export function advanceRideCaptureState(
  current: RideCaptureState,
  sample: {
    deltaSeconds: number;
    crestPhaseError: number;
    normalSpeed: number;
    waveSpeed: number;
    facePhaseSpan: number;
    gravityPlaning: number;
    waveSupport: number;
  },
) {
  const delta = Math.max(0, Math.min(.25, sample.deltaSeconds));
  const speedDeficit = Math.max(0, sample.waveSpeed - sample.normalSpeed);
  const waveSupport = clampValue(sample.waveSupport, 0, 1);
  const lipOvertake = smoothstep(-.02, .72, -sample.crestPhaseError)
    * smoothstep(.05, Math.max(.051, sample.waveSpeed * .3), speedDeficit)
    * waveSupport;
  const flatShoulder = smoothstep(
    sample.facePhaseSpan * 1.35,
    sample.facePhaseSpan * 2.25,
    sample.crestPhaseError,
  ) * (1 - Math.max(0, Math.min(1, sample.gravityPlaning)))
    * waveSupport;
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
  construction: string;
  length: number;
  width: number;
  mass: number;
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
    construction: "Hard shell · PU foam core · fiberglass · polyester resin",
    length: 2.5,
    width: 0.32,
    mass: 3.2,
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
    construction: "Hard shell · EPS foam core · fiberglass · epoxy resin",
    length: 2.3,
    width: 0.39,
    mass: 3.6,
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
    construction: "Hard shell · PU foam core · wood stringer · fiberglass · polyester resin",
    length: 3.45,
    width: 0.43,
    mass: 7.2,
    speed: 0.96,
    turn: 0.82,
    stability: 1.28,
    paddle: 1.2,
    score: 0.98,
    color: "#f1d9a7",
    accent: "#d75d48",
  },
};

export const BREAKLOOM_RELEASE = {
  version: 236,
  channel: "STABLE RC",
} as const;

export type SessionSettings = {
  mode: GameMode;
  assist: SurfAssistLevel;
  board: BoardType;
  waveHeight: number;
  wavePeriod: number;
  waveDirection: number;
  windWaveHeight?: number;
  windWavePeriod?: number;
  windWavePeakPeriod?: number;
  windWaveDirection?: number;
  swellHeight: number;
  swellPeriod: number;
  swellDirection: number;
  swellPeakPeriod?: number;
  secondarySwellHeight?: number;
  secondarySwellPeriod?: number;
  secondarySwellDirection?: number;
  tertiarySwellHeight?: number;
  tertiarySwellPeriod?: number;
  tertiarySwellDirection?: number;
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

export type PopUpLandingSupportSample = {
  lostCrest: boolean;
  boardStillEngaged: boolean;
  interactionOutcome: "stand" | "glide" | "capture" | "tumble";
  waterContact: number;
  rollCapsizeRisk: number;
  pitchOverRisk: number;
  crestOvertaken: number;
  surfableFace: boolean;
  faceEnvelope: number;
  physicalLift: number;
  waveContact: number;
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
  boardLength?: number;
  boardWidth?: number;
  waveHeight: number;
  /**
   * Existing rail engagement on a planing wave face. This is zero during
   * takeoff, but lets a captured board hold a diagonal trim line without
   * treating every angle away from shore as an unresisted broadside impact.
   */
  faceTrimSupport?: number;
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
  crossFlowSpeed: number;
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
  /** Surface-particle flow, kept separate from crest propagation. */
  waterVelocityX?: number;
  waterVelocityZ?: number;
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
  rightRailSurfaceOffset?: number;
  leftRailSurfaceOffset?: number;
  turbulenceX?: number;
  turbulenceZ?: number;
  boardLength: number;
  boardWidth: number;
  boardTurn: number;
  boardStability: number;
  waveHeight: number;
  turningAuthority?: number;
  momentumRetention?: number;
  /**
   * Existing planing/rail support on a captured face. A loaded rail and fins
   * can turn part of cross-face pressure into down-line drive; this remains
   * zero during prone capture and unsupported broadside impacts.
   */
  faceTrimSupport?: number;
  /**
   * Pocket propulsion resolved by resolveWavePocketDrive (m/s^2, world XZ).
   * Applied through hull contact so an airborne board receives nothing.
   */
  waveDriveX?: number;
  waveDriveZ?: number;
  /** Extra quadratic glide drag on unbroken water away from the pocket. */
  glideDragBonus?: number;
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
  wavePatchContact: number;
  waveDriveForward: number;
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
  rightRailSurfaceOffset?: number;
  leftRailSurfaceOffset?: number;
  boardLength?: number;
  boardWidth?: number;
  boardTurn?: number;
  faceTrimSupport?: number;
};

export type SurfboardWavePatchContactSample = {
  waveContact: number;
  waterContact?: number;
  waveHeight: number;
  noseSurfaceOffset?: number;
  tailSurfaceOffset?: number;
  rightRailSurfaceOffset?: number;
  leftRailSurfaceOffset?: number;
};

export type SurfboardWavePatchContactReading = {
  noseContact: number;
  tailContact: number;
  rightRailContact: number;
  leftRailContact: number;
  patchContact: number;
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
  lateralCenterOfPressure: number;
  yawAcceleration: number;
  noseContact: number;
  tailContact: number;
  rightRailContact: number;
  leftRailContact: number;
  patchContact: number;
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
  loadScale?: number;
  recoveryScale?: number;
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
  boardMass?: number;
  boardStability: number;
  riderHeight?: number;
  whitewater: number;
  waterContact?: number;
  automaticCounterweight?: number;
  railTorqueScale?: number;
};

export type BoardRollReading = BoardRollState & {
  rollAcceleration: number;
  effectiveRail: number;
  effectiveCounterweight: number;
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
  const riderHeight = clampValue(sample.riderHeight ?? 0, 0, 1);
  const whitewater = Math.max(0, Math.min(1, sample.whitewater));
  const boardMass = clampValue(sample.boardMass ?? 3.2, 2.4, 10);
  const waterContact = Math.max(
    0,
    Math.min(1, sample.waterContact ?? 1),
  );
  const crossWaveLoad = Math.max(0, Math.min(1.5, sample.crossWaveLoad));
  const crossWaveSide = Math.sign(sample.crossWaveSide) || 1;
  const speedAuthority = smoothstep(.45, 5.2, Math.max(0, sample.speed));
  const inertia = Math.pow(widthScale, .86)
    * Math.sqrt(stability)
    * Math.pow(boardMass / 3.2, .55);

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
  const automaticCounterweight = clampValue(
    sample.automaticCounterweight ?? 0,
    0,
    .85,
  );
  // Assistance represents the small, continuous corrections an experienced
  // surfer makes without thinking. Manual Q/E or the mobile balance slider is
  // still independent and always adds on top for harder turns and maneuvers.
  const effectiveCounterweight = clampValue(
    counterweight
      + balanceTarget
        * automaticCounterweight
        * (1 - Math.abs(counterweight) * .28),
    -1,
    1,
  );

  const riderRailTorque = railInput
    * (1.12 + speedAuthority * 2.35)
    * clampValue(sample.railTorqueScale ?? 1, .65, 1.15);
  // A standing surfer raises the combined center of mass and reduces the
  // static metacentric margin. Crouching restores part of that margin; once
  // planing, rail lift supplies more of the righting force.
  const riderHeightPenalty = 1 - riderHeight
    * (.28 - planing * .12)
    * waterContact;
  const rightingStiffness = (
    .92 * waterContact
      + planing * (3.1 + speedAuthority * 2.15)
  ) * stability * Math.pow(widthScale, 1.18)
    * riderHeightPenalty;
  const rightingMoment = -state.rollAngle * rightingStiffness;
  const angularDamping = (
    .14 + waterContact * .91
      + planing * 2.2
      + speedAuthority * .72 * waterContact
      + whitewater * .32 * waterContact
  ) * Math.sqrt(stability * widthScale);
  const counterweightTorque = -effectiveCounterweight
    * counterweightAuthority;
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
  ) - riderHeight * .035 * (1 - planing * .5);
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
    effectiveCounterweight,
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

export type SurfboardAerialControlSample = {
  deltaSeconds: number;
  steerInput: number;
  grabInput: number;
  airborneHeight: number;
  waterContact: number;
  boardLength: number;
};

export type SurfboardAerialControlReading = {
  yawTorque: number;
  grabActive: boolean;
  grabSide: number;
  attitudeDamping: number;
};

/**
 * Resolves the small mid-air authority a surfer's body actually has. Airborne
 * rotation control comes from trading angular momentum against the arms and
 * torso, so the torque budget is a fraction of the launch impulse and scales
 * inversely with the board's yaw inertia. Grabbing a rail couples the board
 * to the body: the combined system absorbs the board's independent roll and
 * pitch flutter, which is why grabbed airs reconnect more predictably. The
 * water keeps full authority — any hull contact removes the aerial budget.
 */
export function resolveSurfboardAerialControl(
  sample: SurfboardAerialControlSample,
): SurfboardAerialControlReading {
  const airborne = smoothstep(.05, .28, Math.max(0, sample.airborneHeight))
    * (1 - clampValue(sample.waterContact, 0, 1));
  if (airborne <= .01) {
    return {
      yawTorque: 0,
      grabActive: false,
      grabSide: 0,
      attitudeDamping: 0,
    };
  }
  const steer = clampValue(sample.steerInput, -1, 1);
  const yawInertia = Math.pow(
    Math.max(1.6, sample.boardLength) / 2.1,
    1.38,
  );
  const yawTorque = steer * 2.6 * airborne / yawInertia;
  const grab = clampValue(sample.grabInput, -1, 1);
  const grabActive = Math.abs(grab) > .35;
  return {
    yawTorque,
    grabActive,
    grabSide: grabActive ? Math.sign(grab) : 0,
    attitudeDamping: grabActive ? 3.1 * airborne : 0,
  };
}

export type SurfboardBodyReleaseSample = SurfboardReleaseSample & {
  railInput: number;
  facePosition: number;
  linePosition: number;
  boardTurn: number;
};

export type SurfboardBodyReleaseReading = {
  family: "lip" | "air";
  name: "Lip Release" | "Aerial Release";
  base: number;
  charge: number;
  verticalImpulse: number;
  yawImpulse: number;
  rotation: number;
};

/**
 * Resolves a surfer's leg extension against the board and live wave geometry.
 * Engagement, scoring, game mode, and requested trick names do not participate:
 * the same measured hull/body state produces the same release before and after
 * the ride classifier considers the board fully captured.
 */
export function resolveSurfboardBodyRelease(
  sample: SurfboardBodyReleaseSample,
): SurfboardBodyReleaseReading | null {
  const charge = clampValue(sample.compression, 0, 1);
  const extensionSpeed = Math.max(0, sample.extensionSpeed);
  const tailPressure = clampValue(sample.tailPressure, 0, 1);
  const rail = Math.abs(clampValue(sample.railInput, -1, 1));
  const lipSupport = clampValue(sample.lipSupport, 0, 1);
  const speed = Math.max(0, sample.speed);
  const facePosition = clampValue(sample.facePosition, -1, 1);
  const linePosition = clampValue(sample.linePosition, -1, 1);
  if (charge < .055 || extensionSpeed <= .15) return null;

  let family: SurfboardBodyReleaseReading["family"] | null = null;
  if (
    charge > .56
    && extensionSpeed > .65
    && tailPressure > .34
    && rail > .38
    && lipSupport > .64
    && speed > 10.2
    && linePosition < .5
    && facePosition > .38
  ) {
    family = "air";
  } else if (
    lipSupport > .42
    && facePosition > .2
    && (tailPressure > .28 || rail > .28)
  ) {
    family = "lip";
  }
  if (!family) return null;

  const verticalImpulse = surfboardReleaseVerticalImpulse({
    compression: charge,
    extensionSpeed,
    tailPressure,
    lipSupport,
    speed,
    planing: sample.planing,
    waterContact: sample.waterContact,
    boardLength: sample.boardLength,
  }) * (family === "air" ? 1 : .48);
  const yawImpulse = family === "air"
    ? surfboardReleaseYawImpulse({
        railInput: sample.railInput,
        tailPressure,
        lipSupport,
        speed,
        verticalImpulse,
        charge,
        waterContact: sample.waterContact,
        boardLength: sample.boardLength,
        boardTurn: sample.boardTurn,
      })
    : 0;
  const ballisticFlightSeconds = family === "air"
    ? clampValue(verticalImpulse * 2 / 9.81, .28, 1.18)
    : 0;
  return {
    family,
    name: family === "air" ? "Aerial Release" : "Lip Release",
    base: family === "air" ? 520 : 0,
    charge,
    verticalImpulse,
    yawImpulse,
    rotation: Math.abs(yawImpulse) * ballisticFlightSeconds,
  };
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

export type SurfboardContactPatchSample = {
  noseSurfaceOffset: number;
  tailSurfaceOffset: number;
  rightRailSurfaceOffset: number;
  leftRailSurfaceOffset: number;
  pitchAngle: number;
  rollAngle: number;
  halfLength: number;
  halfWidth: number;
};

export type SurfboardContactPatchReading = {
  noseSurfaceOffset: number;
  tailSurfaceOffset: number;
  rightRailSurfaceOffset: number;
  leftRailSurfaceOffset: number;
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

/**
 * Measures the four sampled water patches relative to the board's current
 * underside rather than a motionless center tangent. A board that has rolled
 * and pitched to match a planar surface settles toward even contact; a late
 * rail or nose remains exposed to extra pressure until the hull rotates.
 */
export function resolveSurfboardContactPatchOffsets(
  sample: SurfboardContactPatchSample,
): SurfboardContactPatchReading {
  const halfLength = Math.max(.8, Math.abs(sample.halfLength));
  const halfWidth = Math.max(.08, Math.abs(sample.halfWidth));
  const pitchRise = Math.sin(clampValue(
    sample.pitchAngle,
    -Math.PI * .49,
    Math.PI * .49,
  )) * halfLength;
  const rollRise = Math.sin(clampValue(
    sample.rollAngle,
    -Math.PI * .49,
    Math.PI * .49,
  )) * halfWidth;
  return {
    noseSurfaceOffset: sample.noseSurfaceOffset + pitchRise,
    tailSurfaceOffset: sample.tailSurfaceOffset - pitchRise,
    rightRailSurfaceOffset: sample.rightRailSurfaceOffset - rollRise,
    leftRailSurfaceOffset: sample.leftRailSurfaceOffset + rollRise,
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
  wavePatchContact?: number;
  boardLength: number;
  boardWidth: number;
  boardMass?: number;
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
  waterContact?: number;
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
  placementRisk: number;
  centerOfMassHeight: number;
  trim: number;
  stabilityScale: number;
  counterweightScale: number;
  verticalLoadAcceleration: number;
};

export type PopUpBodyState = {
  progress: number;
  velocity: number;
};

export type PopUpBodySample = {
  deltaSeconds: number;
  stamina: number;
  rollAngle: number;
  rollRate: number;
  pitchAngle: number;
  pitchRate: number;
  crossWaveLoad: number;
  balanceError: number;
  waterContact: number;
};

export type PopUpBodyReading = PopUpBodyState & {
  movementAuthority: number;
  correctiveLoad: number;
};

export type PopUpEffortSample = {
  deltaSeconds: number;
  handLoad: number;
  rearFootLoad: number;
  frontFootLoad: number;
  footImpact: number;
  centerOfMassHeight: number;
  balanceError: number;
  crossWaveLoad: number;
  rollCapsizeRisk: number;
  pitchOverRisk: number;
};

/**
 * Converts the continuous body transition and measured board loads into
 * muscular fatigue. Wave capture is deliberately absent: popping up costs the
 * same in identical body and water states, whether or not a ride is scored.
 */
export function popUpStaminaDelta(sample: PopUpEffortSample) {
  const delta = clampValue(sample.deltaSeconds, 0, .25);
  const supportWork = clampValue(sample.handLoad, 0, 1) * .78
    + clampValue(sample.rearFootLoad, 0, 1) * .22
    + clampValue(sample.frontFootLoad, 0, 1) * .34
    + clampValue(sample.footImpact, 0, 1) * .38
    + clampValue(sample.centerOfMassHeight, 0, 1) * .24;
  const correctiveWork = clampValue(sample.balanceError, 0, 2) * .18
    + clampValue(sample.crossWaveLoad, 0, 1.5) * .22
    + Math.max(
      clampValue(sample.rollCapsizeRisk, 0, 1),
      clampValue(sample.pitchOverRisk, 0, 1),
    ) * .28;
  return -delta * (.35 + supportWork + correctiveWork);
}

/**
 * Maps physical body progress to the hand, foot, and center-of-mass loads
 * applied to the board. This pose mapping contains no clock and no wave state.
 */
export function evaluatePopUpTransitionAtProgress(
  bodyProgress: number,
  stamina: number,
  foreAftFootPlacement = 0,
): PopUpTransitionReading {
  const staminaRatio = clampValue(stamina / 100, 0, 1);
  const footPlacement = clampValue(foreAftFootPlacement, -1, 1);
  const duration = .9 - staminaRatio * .24;
  const progress = clampValue(bodyProgress, 0, 1);
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
  const placementRisk = smoothstep(
    .38,
    .9,
    Math.abs(footPlacement),
  ) * footSupport;
  const trim = -.06
    + handLoad * .17
    - rearFootImpact * .11
    + frontFootLoad * .08
    + footPlacement * footSupport * .72;
  const stabilityScale = 1.28
    - centerOfMassHeight * .28
    - placementRisk * .16;
  const counterweightScale = (
    .46 + centerOfMassHeight * .46
  ) * (1 - placementRisk * .18);
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
    placementRisk,
    centerOfMassHeight,
    trim,
    stabilityScale,
    counterweightScale,
    verticalLoadAcceleration,
  };
}

/**
 * Advances the actual body movement from muscular authority and the board
 * loads the surfer must correct. Wave capture is deliberately absent. Flat
 * water therefore still permits a pop-up, while roll, pitch, angular motion,
 * cross-wave pressure, poor counterweight, and fatigue slow the movement.
 */
export function advancePopUpBodyTransition(
  state: PopUpBodyState,
  sample: PopUpBodySample,
): PopUpBodyReading {
  const delta = clampValue(sample.deltaSeconds, 0, .25);
  let progress = clampValue(state.progress, 0, 1);
  let velocity = progress >= 1
    ? 0
    : clampValue(state.velocity, 0, 3);
  let movementAuthority = progress >= 1 ? 0 : 1;
  let correctiveLoad = 0;
  let remaining = delta;
  const maxStep = 1 / 240;

  while (remaining > 1e-9 && progress < 1) {
    const step = Math.min(maxStep, remaining);
    const pose = evaluatePopUpTransitionAtProgress(
      progress,
      sample.stamina,
    );
    const waterContact = clampValue(sample.waterContact, 0, 1);
    const rollTilt = clampValue(Math.abs(sample.rollAngle) / .72, 0, 1);
    const pitchTilt = clampValue(Math.abs(sample.pitchAngle) / .58, 0, 1);
    const rollMotion = clampValue(Math.abs(sample.rollRate) / 3.2, 0, 1);
    const pitchMotion = clampValue(Math.abs(sample.pitchRate) / 2.7, 0, 1);
    const crossWaterLoad = clampValue(
      Math.abs(sample.crossWaveLoad) * waterContact / 1.35,
      0,
      1,
    );
    const balanceCorrection = clampValue(
      Math.abs(sample.balanceError) / 1.15,
      0,
      1,
    );
    const uprightExposure = .42 + pose.centerOfMassHeight * .58;
    correctiveLoad = clampValue(
      rollTilt * .2
        + pitchTilt * .16
        + rollMotion * .16
        + pitchMotion * .13
        + crossWaterLoad * .22
        + balanceCorrection * .18,
      0,
      .88,
    ) * uprightExposure;
    const staminaRatio = clampValue(sample.stamina / 100, 0, 1);
    const muscularAuthority = .56 + staminaRatio * .44;
    movementAuthority = clampValue(
      muscularAuthority * (1 - correctiveLoad * .76),
      .2,
      1,
    );
    const supportResistance = pose.handLoad * .055
      + pose.footImpact * .09
      + pose.centerOfMassHeight * (1 - staminaRatio) * .07;
    const targetVelocity = 1.38
      * movementAuthority
      * (1 - supportResistance);
    const response = 11.5 - correctiveLoad * 2.5;
    velocity += (targetVelocity - velocity)
      * (1 - Math.exp(-response * step));
    progress = Math.min(1, progress + velocity * step);
    remaining -= step;
  }

  if (progress >= 1) velocity = 0;
  return {
    progress,
    velocity,
    movementAuthority,
    correctiveLoad,
  };
}

/**
 * Legacy elapsed-time adapter retained for deterministic pose sampling. Live
 * gameplay advances `PopUpBodyState` with `advancePopUpBodyTransition`.
 */
export function evaluatePopUpTransition(
  elapsedSeconds: number,
  stamina: number,
  foreAftFootPlacement = 0,
): PopUpTransitionReading {
  const staminaRatio = clampValue(stamina / 100, 0, 1);
  const duration = .9 - staminaRatio * .24;
  const linearProgress = clampValue(
    Math.max(0, elapsedSeconds) / duration,
    0,
    1,
  );
  const progress = linearProgress * linearProgress * (3 - 2 * linearProgress);
  return evaluatePopUpTransitionAtProgress(
    progress,
    stamina,
    foreAftFootPlacement,
  );
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
    boardMass: sample.boardMass,
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
    waveContact: sample.wavePatchContact ?? sample.waveContact,
    boardLength: sample.boardLength,
    boardWidth: sample.boardWidth,
    boardStability: sample.boardStability,
    whitewater: sample.whitewater,
    verticalWaterAcceleration: sample.verticalWaterAcceleration,
  });
  return { roll, pitch, heave };
}

/**
 * Converts prone attitude and contacting water load into a physical separation
 * event. A rail beyond its righting limit or a buried nose fails immediately,
 * while combined broadside wash can overwhelm a contacting hull before either
 * angle peaks; detached polygon pressure cannot throw the board.
 */
export function evaluateProneBoardFailure(
  sample: ProneBoardFailureSample,
  failureMargin = 0,
): ProneBoardFailureReading {
  const capsizeRisk = clampValue(sample.capsizeRisk, 0, 1);
  const pitchOverRisk = clampValue(sample.pitchOverRisk, 0, 1);
  const waterContact = clampValue(sample.waterContact ?? 1, 0, 1);
  const crossWaveLoad = clampValue(sample.crossWaveLoad, 0, 1.5)
    * waterContact;
  const whitewater = clampValue(sample.whitewater, 0, 1)
    * waterContact;
  const waveEnergy = clampValue(sample.waveEnergy, 0, 1);
  const load = Math.max(capsizeRisk, pitchOverRisk)
    + Math.max(0, crossWaveLoad - .48) * .24
    + whitewater * .16;
  const margin = clampValue(failureMargin, 0, .12);
  const failed = capsizeRisk > .9 + margin
    || pitchOverRisk > .9 + margin
    || load > .98 + margin;
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

function lerpValue(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
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
  turningAuthority?: number;
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

export type PaddleHeadingTargetSample = {
  boardHeading: number;
  desiredDirectionX: number;
  desiredDirectionZ: number;
  desiredGroundSpeed: number;
  currentVelocityX: number;
  currentVelocityZ: number;
};

export type PaddleHeadingTargetReading = {
  targetHeading: number;
  headingError: number;
  targetDirectionX: number;
  targetDirectionZ: number;
  currentCompensationDegrees: number;
};

/**
 * Stabilizes a relative HUD bearing without losing the shortest path through
 * the ±180° seam. Small polygon-normal changes stay inside a deadband while
 * legitimate direction changes remain responsive and step-limited.
 */
export function stabilizeHeadingGuideDegrees(
  currentDegrees: number,
  targetDegrees: number,
  response = .42,
  maximumStepDegrees = 28,
  deadbandDegrees = 1.5,
) {
  const radians = Math.PI / 180;
  const deltaDegrees = Math.atan2(
    Math.sin(
      (targetDegrees - currentDegrees) * radians,
    ),
    Math.cos(
      (targetDegrees - currentDegrees) * radians,
    ),
  ) / radians;
  if (Math.abs(deltaDegrees) <= deadbandDegrees) {
    return currentDegrees;
  }
  return currentDegrees + clampValue(
    deltaDegrees * clampValue(response, .05, 1),
    -Math.max(1, maximumStepDegrees),
    Math.max(1, maximumStepDegrees),
  );
}

/**
 * Converts a desired ground track into the board heading required through
 * moving water. The HUD arrow therefore teaches current compensation instead
 * of pointing at a geometric bearing the paddler would drift away from.
 */
export function resolvePaddleHeadingTarget(
  sample: PaddleHeadingTargetSample,
): PaddleHeadingTargetReading {
  const desiredMagnitude = Math.hypot(
    sample.desiredDirectionX,
    sample.desiredDirectionZ,
  );
  const desiredDirectionX = desiredMagnitude > 1e-6
    ? sample.desiredDirectionX / desiredMagnitude
    : Math.sin(sample.boardHeading);
  const desiredDirectionZ = desiredMagnitude > 1e-6
    ? sample.desiredDirectionZ / desiredMagnitude
    : Math.cos(sample.boardHeading);
  const desiredGroundSpeed = clampValue(
    sample.desiredGroundSpeed,
    .6,
    4,
  );
  const requiredVelocityX =
    desiredDirectionX * desiredGroundSpeed
      - clampValue(sample.currentVelocityX, -3, 3);
  const requiredVelocityZ =
    desiredDirectionZ * desiredGroundSpeed
      - clampValue(sample.currentVelocityZ, -3, 3);
  const requiredMagnitude = Math.hypot(
    requiredVelocityX,
    requiredVelocityZ,
  );
  const targetDirectionX = requiredMagnitude > .08
    ? requiredVelocityX / requiredMagnitude
    : desiredDirectionX;
  const targetDirectionZ = requiredMagnitude > .08
    ? requiredVelocityZ / requiredMagnitude
    : desiredDirectionZ;
  const targetHeading = Math.atan2(
    targetDirectionX,
    targetDirectionZ,
  );
  const desiredHeading = Math.atan2(
    desiredDirectionX,
    desiredDirectionZ,
  );
  const headingError = Math.atan2(
    Math.sin(targetHeading - sample.boardHeading),
    Math.cos(targetHeading - sample.boardHeading),
  );
  const currentCompensation = Math.atan2(
    Math.sin(targetHeading - desiredHeading),
    Math.cos(targetHeading - desiredHeading),
  );

  return {
    targetHeading,
    headingError,
    targetDirectionX,
    targetDirectionZ,
    currentCompensationDegrees:
      currentCompensation * 180 / Math.PI,
  };
}

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
  const turningAuthority = clampValue(
    sample.turningAuthority ?? 1,
    1,
    1.5,
  );
  const steeringBias = Math.max(
    .4,
    Math.min(
      1.6,
      1 + strokeSide * steer * .42 * turningAuthority,
    ),
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

export type PaddleStrokeWorkSample = {
  strokeForce: number;
  strokeSide: number;
  deltaSeconds: number;
};

export type PaddleStrokeWorkReading = {
  leftWork: number;
  rightWork: number;
  totalWork: number;
};

/**
 * Converts resolved hydrodynamic pull force into normalized per-hand impulse.
 * Contact, submersion, board efficiency, stamina, and pull phase have already
 * affected strokeForce, so tutorial progress cannot outrun the physics solve.
 */
export function paddleStrokeWorkDelta(
  sample: PaddleStrokeWorkSample,
): PaddleStrokeWorkReading {
  const strokeSide = clampValue(sample.strokeSide, -1, 1);
  const effectiveWork = clampValue(
    Math.max(0, sample.strokeForce) / 6.9,
    0,
    1.5,
  )
    * clampValue(sample.deltaSeconds, 0, .05);
  const leftWork = strokeSide < 0 ? effectiveWork : 0;
  const rightWork = strokeSide > 0 ? effectiveWork : 0;
  return {
    leftWork,
    rightWork,
    totalWork: leftWork + rightWork,
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
  turningAuthority?: number;
};

export type PaddleboardDynamicsReading = PaddleboardDynamicsState & {
  accelerationX: number;
  accelerationZ: number;
  forwardSpeed: number;
  lateralSpeed: number;
  strokeForce: number;
  strokeYawAcceleration: number;
  scullYawAcceleration: number;
  paddleHandLever: number;
};

/**
 * Integrates prone paddling as repeated human thrust against quadratic hull
 * drag. Each planted hand applies its reaction force outside the rail, so
 * turning comes from a real yaw moment rather than directly steering toward an
 * input-selected angular rate. Momentum survives between strokes and current
 * acts through the water-relative flow.
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
  const turningAuthority = clampValue(
    sample.turningAuthority ?? 1,
    1,
    1.5,
  );
  const paddleEfficiency = Math.max(.4, Math.min(1.3, sample.paddleEfficiency));
  const speed = Math.hypot(state.velocityX, state.velocityZ);
  // Mass-normalized polar inertia (I / m) for the prone surfer-board system.
  // A longer board places more wetted mass away from the center of rotation.
  const yawRadiusSquared = .36
    * Math.pow(safeLength / 2.5, 1.72)
    * Math.pow(safeWidth / .34, .12);
  const strokeForce = stroke >= 0
    ? stroke * (4.8 + paddleEfficiency * 2.1)
    : stroke * 1.45;
  const appliedStrokeForce = strokeForce
    * hullContact
    * (1 - submersion);
  // A normal prone pull tracks back toward the hip, so its line of action
  // passes much closer to the system center than the hand itself. A deliberate
  // turning stroke reaches/sweeps wider, increasing its effective moment arm.
  const neutralStrokeLever = .055 + safeWidth * .12;
  const turningStrokeReach = Math.abs(steer)
    * (.24 + safeWidth * .18)
    * turningAuthority;
  const paddleHandLever = strokeSide
    * (neutralStrokeLever + turningStrokeReach);
  const strokeYawAcceleration = -paddleHandLever
    * appliedStrokeForce
    * turn
    / yawRadiusSquared;
  // A surfer can sweep one hand beside the rail while nearly stationary.
  // That produces a mostly rotational reaction without inventing forward
  // thrust, and fades as ordinary alternating strokes gain authority.
  const lowSpeedScull = 1 - smoothstep(
    .35,
    2.25,
    speed,
  );
  const scullForce = Math.abs(steer)
    * (1.25 + paddleEfficiency * .55)
    * (.32 + lowSpeedScull * .68)
    * hullContact
    * (1 - submersion);
  const scullLever = .24 + safeWidth * .2;
  const scullYawAcceleration = -steer
    * scullForce
    * scullLever
    * turn
    * turningAuthority
    / yawRadiusSquared;
  let yawRate = state.yawRate
    + (
      strokeYawAcceleration
        + scullYawAcceleration
    ) * delta;
  yawRate *= Math.exp(
    -delta * (
      .08 + hullContact * (
        .72
          + Math.min(.46, speed * .12)
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
    strokeYawAcceleration,
    scullYawAcceleration,
    paddleHandLever,
  };
}

/**
 * Measures how much of the nose, tail, and both rails is supported by the
 * breaking-face polygons beneath the current board pose. Ordinary buoyancy is
 * separate: a board can float in still water while receiving zero face support.
 */
export function resolveSurfboardWavePatchContact(
  sample: SurfboardWavePatchContactSample,
): SurfboardWavePatchContactReading {
  const contact = clampValue(sample.waveContact, 0, 1);
  const hullContact = clampValue(sample.waterContact ?? 1, 0, 1);
  const contactRelief = .055 + Math.max(.25, sample.waveHeight) * .035;
  const noseContact = clampValue(
    contact * (
      1 + (sample.noseSurfaceOffset ?? 0) / contactRelief
    ),
    0,
    1,
  ) * hullContact;
  const tailContact = clampValue(
    contact * (
      1 + (sample.tailSurfaceOffset ?? 0) / contactRelief
    ),
    0,
    1,
  ) * hullContact;
  const rightRailContact = clampValue(
    contact * (
      1 + (sample.rightRailSurfaceOffset ?? 0) / contactRelief
    ),
    0,
    1,
  ) * hullContact;
  const leftRailContact = clampValue(
    contact * (
      1 + (sample.leftRailSurfaceOffset ?? 0) / contactRelief
    ),
    0,
    1,
  ) * hullContact;
  const patchContact = clampValue(
    (
      noseContact
        + tailContact
        + rightRailContact
        + leftRailContact
    ) * .25,
    0,
    1,
  );
  return {
    noseContact,
    tailContact,
    rightRailContact,
    leftRailContact,
    patchContact,
  };
}

/**
 * Resolves the breaking face's horizontal pressure across the nose, tail, and
 * both rail contact patches. Raw pressure follows the live wave normal. Once
 * a captured, planing board loads a rail, its fins and rail reaction can
 * redirect part of that lateral pressure into longitudinal trim—the physical
 * mechanism that lets a surfer run along a wall instead of only toward shore.
 * Unsupported takeoff and broadside impacts receive no such conversion.
 * Off-center patches apply their remaining force through measured centers of
 * pressure.
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
      lateralCenterOfPressure: 0,
      yawAcceleration: 0,
      noseContact: 0,
      tailContact: 0,
      rightRailContact: 0,
      leftRailContact: 0,
      patchContact: 0,
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
  const safeWidth = Math.max(.24, sample.boardWidth ?? .34);
  const turn = Math.max(.45, sample.boardTurn ?? 1);
  const {
    noseContact,
    tailContact,
    rightRailContact,
    leftRailContact,
    patchContact,
  } = resolveSurfboardWavePatchContact(sample);
  const pressure = patchContact
    * waveDeficit
    * (.48 + Math.max(0, headingAlignment) * .72)
    * (.72 + Math.max(.25, sample.waveHeight) * .11)
    * (1 - tailPressure * .08 + nosePressure * .04 - pearlingRisk * .42);
  const rawForwardDrive = pressure * headingAlignment;
  const rawLateralLoad = pressure
    * (waveNormalX * rightX + waveNormalZ * rightZ);
  const broadside = Math.sqrt(Math.max(
    0,
    1 - headingAlignment * headingAlignment,
  ));
  const trimConversion = clampValue(
    sample.faceTrimSupport ?? 0,
    0,
    1,
  ) * smoothstep(.1, .68, headingAlignment)
    * smoothstep(.12, .78, broadside);
  const forwardDrive = rawForwardDrive
    + Math.abs(rawLateralLoad) * trimConversion * .55;
  const lateralLoad = rawLateralLoad * (1 - trimConversion * .62);
  const accelerationX = forwardX * forwardDrive + rightX * lateralLoad;
  const accelerationZ = forwardZ * forwardDrive + rightZ * lateralLoad;
  const contactSum = Math.max(
    .001,
    noseContact + tailContact + rightRailContact + leftRailContact,
  );
  const centerOfPressure = (
    noseContact - tailContact
  ) / contactSum
    * safeLength
    * .5;
  const lateralCenterOfPressure = (
    rightRailContact - leftRailContact
  ) / contactSum
    * safeWidth
    * .5;
  const pressureYawMoment = centerOfPressure * lateralLoad
    - lateralCenterOfPressure * forwardDrive;
  const yawAcceleration = pressureYawMoment
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
    lateralCenterOfPressure,
    yawAcceleration,
    noseContact,
    tailContact,
    rightRailContact,
    leftRailContact,
    patchContact,
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
  const rawLoadRate = rollFailureLoad
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
  const loadRate = rawLoadRate >= 0
    ? rawLoadRate * clampValue(sample.loadScale ?? 1, .35, 1)
    : rawLoadRate * clampValue(
        sample.recoveryScale ?? 1,
        1,
        1.5,
      );
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
  thresholdScale = 1,
  catastrophicMargin = 0,
) {
  const margin = clampValue(catastrophicMargin, 0, .09);
  return rollCapsizeRisk
      > SURF_PHYSICS_TUNING.capsizeWipeout + margin
    || pitchOverRisk
      > SURF_PHYSICS_TUNING.pitchWipeout + margin
    || instability
      > SURF_PHYSICS_TUNING.wipeoutInstability
        * clampValue(thresholdScale, 1, 1.5);
}

export type SurfboardWipeoutSample = {
  waveHeight: number;
  wavePeriod: number;
  waveEnergy: number;
  tidePower: number;
  speed: number;
  rollRate?: number;
  pitchRate?: number;
  yawRate?: number;
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
  const linearKineticImpact = Math.pow(
    clampValue(Math.max(0, sample.speed) / 14, 0, 1),
    2,
  );
  const rotationalKineticImpact = clampValue(
    Math.pow(Math.abs(sample.rollRate ?? 0) / 4.6, 2) * .48
      + Math.pow(Math.abs(sample.pitchRate ?? 0) / 3.8, 2) * .34
      + Math.pow(Math.abs(sample.yawRate ?? 0) / 3.4, 2) * .18,
    0,
    1,
  );
  const kineticImpact = clampValue(
    linearKineticImpact * .72
      + rotationalKineticImpact * .28,
    0,
    1,
  );
  const waveEnergy = clampValue(
    Math.max(.25, sample.waveHeight) / 4.2 * .24
      + Math.max(0, sample.wavePeriod - 6) / 12 * .16
      + clampValue(sample.waveEnergy, 0, 1) * .18
      + clampValue(sample.tidePower, 0, 1.5) * .09
      + kineticImpact * .18
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
    kineticImpact,
    duration: clampValue(
      (
        1.55 + (4.18 - 1.55) * Math.pow(waveEnergy, .84)
      ) * SURF_PHYSICS_TUNING.wipeoutHold,
      1.35,
      4.65,
    ),
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
    ) * Math.exp(-delta * (.055 + waterDrag * 1.72)),
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
    ) * Math.exp(-delta * (.07 + waterDrag * 1.9)),
    -5.8,
    5.8,
  );
  const nextYawRate = clampValue(
    (
      state.yawRate + washSide * washTorque * .08 * delta
    ) * Math.exp(-delta * (.045 + waterDrag * 1.52)),
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

export type SurfboardFailureReleaseSample = {
  velocityX: number;
  velocityZ: number;
  heading: number;
  heaveVelocity: number;
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  centerOfMassHeight: number;
  lateralOffset: number;
  longitudinalOffset: number;
  rollCapsizeRisk: number;
  pitchOverRisk: number;
  pearlingRisk: number;
  boardLength: number;
  boardWidth: number;
};

export type SurfboardFailureReleaseReading = {
  velocityX: number;
  velocityZ: number;
  verticalVelocity: number;
  lateralVelocity: number;
  longitudinalVelocity: number;
  boardRelativeLateralVelocity: number;
  boardRelativeVerticalVelocity: number;
  boardRelativeLongitudinalVelocity: number;
  railTangentialSpeed: number;
  noseTangentialSpeed: number;
  cause: "rail edge" | "buried nose" | "rotation" | "loss of support";
  direction:
    | "left"
    | "right"
    | "forward"
    | "back"
    | "up"
    | "down"
    | "still";
};

/**
 * Releases the surfer from the board with the instantaneous velocity of the
 * rider's real center of mass. The hull's integrated translation is retained,
 * while omega × radius supplies the velocity created by roll, pitch, and yaw.
 * There is deliberately no wipeout-strength launch or wave-speed assignment:
 * polygon pressure has already changed the board's linear and angular state.
 */
export function resolveSurfboardFailureRelease(
  sample: SurfboardFailureReleaseSample,
): SurfboardFailureReleaseReading {
  const boardLength = clampValue(sample.boardLength, 1.6, 3.6);
  const boardWidth = clampValue(sample.boardWidth, .38, .72);
  const height = clampValue(sample.centerOfMassHeight, .12, 1.05);
  const lateralOffset = clampValue(
    sample.lateralOffset,
    -boardWidth * .42,
    boardWidth * .42,
  );
  const longitudinalOffset = clampValue(
    sample.longitudinalOffset,
    -boardLength * .32,
    boardLength * .32,
  );
  const rollRate = clampValue(sample.rollRate, -7.4, 7.4);
  const pitchRate = clampValue(sample.pitchRate, -5.8, 5.8);
  const yawRate = clampValue(sample.yawRate, -4.8, 4.8);

  // Local board axes are right, up, and nose-forward. For angular velocity
  // (pitch, yaw, roll), omega × rider-offset is the body's tangential velocity.
  const lateralVelocity = yawRate * longitudinalOffset
    - rollRate * height;
  const verticalVelocity = sample.heaveVelocity
    + rollRate * lateralOffset
    - pitchRate * longitudinalOffset;
  const longitudinalVelocity = pitchRate * height
    - yawRate * lateralOffset;
  const forwardX = Math.sin(sample.heading);
  const forwardZ = Math.cos(sample.heading);
  const rightX = Math.cos(sample.heading);
  const rightZ = -Math.sin(sample.heading);
  const velocityX = sample.velocityX
    + rightX * lateralVelocity
    + forwardX * longitudinalVelocity;
  const velocityZ = sample.velocityZ
    + rightZ * lateralVelocity
    + forwardZ * longitudinalVelocity;
  const railTangentialSpeed = Math.abs(rollRate) * height;
  const noseTangentialSpeed = Math.abs(pitchRate) * height;
  const noseFailure = Math.max(
    clampValue(sample.pitchOverRisk, 0, 1),
    clampValue(sample.pearlingRisk, 0, 1),
  );
  const railFailure = clampValue(sample.rollCapsizeRisk, 0, 1);
  const cause = noseFailure > railFailure + .08
    ? "buried nose"
    : railFailure > .42 || railTangentialSpeed > .28
      ? "rail edge"
      : Math.max(railTangentialSpeed, noseTangentialSpeed) > .12
        ? "rotation"
        : "loss of support";
  const direction = cause === "buried nose"
    ? longitudinalVelocity >= 0
      ? "forward"
      : "back"
    : cause === "rail edge"
      ? lateralVelocity >= 0
        ? "right"
        : "left"
      : Math.abs(lateralVelocity) > Math.abs(longitudinalVelocity)
        && Math.abs(lateralVelocity) > .04
        ? lateralVelocity >= 0
          ? "right"
          : "left"
        : Math.abs(longitudinalVelocity) > .04
          ? longitudinalVelocity >= 0
            ? "forward"
            : "back"
          : Math.abs(verticalVelocity) > .04
            ? verticalVelocity >= 0
              ? "up"
              : "down"
            : "still";

  return {
    velocityX,
    velocityZ,
    verticalVelocity,
    lateralVelocity,
    longitudinalVelocity,
    boardRelativeLateralVelocity: -lateralVelocity,
    boardRelativeVerticalVelocity:
      sample.heaveVelocity - verticalVelocity,
    boardRelativeLongitudinalVelocity: -longitudinalVelocity,
    railTangentialSpeed,
    noseTangentialSpeed,
    cause,
    direction,
  };
}

export type SeparatedSurferVerticalState = {
  surfaceOffset: number;
  verticalVelocity: number;
};

export type SeparatedSurferBreakingWashSample = {
  crestDistance: number;
  crestEnergy: number;
  faceSlope: number;
  surfaceRise: number;
  breakingActivation: number;
};

export type SeparatedSurferBreakingWashReading = {
  intensity: number;
  crestOccupancy: number;
  foamOccupancy: number;
  downwardWaterVelocity: number;
  transportSpeed: number;
  turbulence: number;
};

/**
 * Resolves breaking-water load from the surfer's measured location on the
 * polygon wave. The crest ridge and its shoreward foam trail are spatial
 * regions, so the wash arrives and leaves as those regions pass the body
 * rather than following a wipeout animation clock.
 */
export function resolveSeparatedSurferBreakingWash(
  sample: SeparatedSurferBreakingWashSample,
): SeparatedSurferBreakingWashReading {
  const crestDistance = clampValue(sample.crestDistance, -30, 30);
  const crestEnergy = clampValue(sample.crestEnergy, 0, 1);
  const faceSlope = Math.max(0, sample.faceSlope);
  const surfaceRise = Math.abs(sample.surfaceRise);
  const breakingActivation = clampValue(
    sample.breakingActivation,
    0,
    1,
  );
  const crestOccupancy = 1 - smoothstep(
    1.1,
    5.8,
    Math.abs(crestDistance),
  );
  const distanceBehindCrest = -crestDistance;
  const foamOccupancy = smoothstep(
    .15,
    1.1,
    distanceBehindCrest,
  ) * (
    1 - smoothstep(
      5.5,
      12,
      distanceBehindCrest,
    )
  );
  const steepFace = smoothstep(.035, .28, faceSlope);
  const movingSurface = smoothstep(.04, .72, surfaceRise);
  const crestLoad = crestOccupancy
    * (
      .38
        + steepFace * .35
        + movingSurface * .27
    );
  const foamLoad = foamOccupancy
    * (
      .46 + crestEnergy * .32
    );
  const intensity = clampValue(
    Math.max(crestLoad, foamLoad)
      * crestEnergy
      * breakingActivation
      * 1.35,
    0,
    1.25,
  );
  const turbulence = clampValue(
    intensity * (.75 + foamOccupancy * .55),
    0,
    1,
  );

  return {
    intensity,
    crestOccupancy,
    foamOccupancy,
    downwardWaterVelocity:
      -intensity * (1.15 + crestEnergy * 1.7),
    transportSpeed:
      intensity * (.9 + crestEnergy * 1.8),
    turbulence,
  };
}

export type SeparatedSurfboardWaterForceSample = {
  surfaceOffset: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  waterVelocityX: number;
  waterVelocityY: number;
  waterVelocityZ: number;
  pitchAngle: number;
  rollAngle: number;
  surfacePitch: number;
  surfaceRoll: number;
  washIntensity: number;
  boardMass: number;
  boardLength: number;
  boardWidth: number;
};

export type SeparatedSurfboardWaterForceReading = {
  waterContact: number;
  accelerationX: number;
  accelerationY: number;
  accelerationZ: number;
  pitchAcceleration: number;
  rollAcceleration: number;
  angularDamping: number;
};

/**
 * Resolves forces on a loose board at its own water sample. An airborne board
 * keeps horizontal momentum under gravity; an edge can enter before the center;
 * immersed area then produces buoyancy, flow-relative drag, and a righting
 * moment toward the local polygon normal.
 */
export function resolveSeparatedSurfboardWaterForces(
  sample: SeparatedSurfboardWaterForceSample,
): SeparatedSurfboardWaterForceReading {
  const boardMass = clampValue(sample.boardMass, 2.4, 10);
  const boardLength = clampValue(sample.boardLength, 1.6, 3.6);
  const boardWidth = clampValue(sample.boardWidth, .28, .72);
  const pitchAngle = clampValue(sample.pitchAngle, -Math.PI, Math.PI);
  const rollAngle = clampValue(sample.rollAngle, -Math.PI, Math.PI);
  const edgeReach = Math.abs(Math.sin(pitchAngle))
      * boardLength
      * .48
    + Math.abs(Math.sin(rollAngle))
      * boardWidth
      * .46;
  const effectiveSurfaceOffset = clampValue(
    sample.surfaceOffset - edgeReach,
    -2,
    2,
  );
  const waterContact = 1 - smoothstep(
    -.1,
    .22,
    effectiveSurfaceOffset,
  );
  const immersedDepth = Math.max(
    0,
    -effectiveSurfaceOffset,
  );
  const areaMassScale = clampValue(
    (
      boardLength * boardWidth / boardMass
    ) / .25,
    .55,
    1.4,
  );
  const relativeX = sample.velocityX
    - sample.waterVelocityX;
  const relativeY = sample.velocityY
    - sample.waterVelocityY;
  const relativeZ = sample.velocityZ
    - sample.waterVelocityZ;
  const washIntensity = clampValue(
    sample.washIntensity,
    0,
    1.25,
  );
  const horizontalDrag =
    .012 + waterContact
      * (.32 + washIntensity * .5)
      * areaMassScale;
  const accelerationX = clampValue(
    -relativeX * Math.abs(relativeX)
      * horizontalDrag,
    -24,
    24,
  );
  const accelerationZ = clampValue(
    -relativeZ * Math.abs(relativeZ)
      * horizontalDrag,
    -24,
    24,
  );
  const buoyancyAcceleration = waterContact
    * (
      10.9 + immersedDepth * 18
    )
    * Math.sqrt(areaMassScale);
  const verticalDragAcceleration =
    -relativeY * Math.abs(relativeY)
      * waterContact
      * (2.4 + waterContact * 3.8)
      * areaMassScale;
  const accelerationY = clampValue(
    -9.81
      + buoyancyAcceleration
      + verticalDragAcceleration,
    -28,
    28,
  );
  const pitchError = Math.atan2(
    Math.sin(sample.surfacePitch - pitchAngle),
    Math.cos(sample.surfacePitch - pitchAngle),
  );
  const rollError = Math.atan2(
    Math.sin(sample.surfaceRoll - rollAngle),
    Math.cos(sample.surfaceRoll - rollAngle),
  );
  const pitchAcceleration = Math.sin(pitchError * 2)
    * waterContact
    * (2.8 + waterContact * 4.4);
  const rollAcceleration = Math.sin(rollError * 2)
    * waterContact
    * (3.4 + waterContact * 5.2);

  return {
    waterContact,
    accelerationX,
    accelerationY,
    accelerationZ,
    pitchAcceleration,
    rollAcceleration,
    angularDamping:
      .04 + waterContact * (
        .85 + washIntensity * 1.2
      ),
  };
}

export type SeparatedSurferProjectedAreaSample = {
  pitch: number;
  yaw: number;
  roll: number;
  flowX: number;
  flowY: number;
  flowZ: number;
};

export type SeparatedSurferProjectedAreaReading = {
  flowAlignment: number;
  crossFlow: number;
  projectedArea: number;
  dragScale: number;
  rotationalDragScale: number;
};

/**
 * Approximates a separated surfer as a long capsule. Flow parallel to the
 * head-to-foot axis sees little area; broadside flow sees the torso and limbs.
 * The result is geometry-only and can be shared by linear and angular drag.
 */
export function resolveSeparatedSurferProjectedArea(
  sample: SeparatedSurferProjectedAreaSample,
): SeparatedSurferProjectedAreaReading {
  const pitch = clampValue(sample.pitch, -Math.PI, Math.PI);
  const yaw = clampValue(sample.yaw, -Math.PI, Math.PI);
  const roll = clampValue(sample.roll, -Math.PI, Math.PI);
  const flowMagnitude = Math.hypot(
    sample.flowX,
    sample.flowY,
    sample.flowZ,
  );
  if (flowMagnitude <= 1e-6) {
    return {
      flowAlignment: 0,
      crossFlow: 0,
      projectedArea: .52,
      dragScale: 1,
      rotationalDragScale: 1,
    };
  }
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const sinRoll = Math.sin(roll);
  const cosRoll = Math.cos(roll);
  const axisX =
    cosRoll * sinYaw * sinPitch
      - sinRoll * cosPitch;
  const axisY =
    sinRoll * sinYaw * sinPitch
      + cosRoll * cosPitch;
  const axisZ = cosYaw * sinPitch;
  const flowX = sample.flowX / flowMagnitude;
  const flowY = sample.flowY / flowMagnitude;
  const flowZ = sample.flowZ / flowMagnitude;
  const flowAlignment = clampValue(
    Math.abs(
      axisX * flowX
        + axisY * flowY
        + axisZ * flowZ
    ),
    0,
    1,
  );
  const crossFlow = Math.sqrt(
    Math.max(0, 1 - flowAlignment * flowAlignment),
  );
  const projectedArea = .16 + crossFlow * .58;
  const dragScale = projectedArea / .52;

  return {
    flowAlignment,
    crossFlow,
    projectedArea,
    dragScale,
    rotationalDragScale:
      .62 + crossFlow * .78,
  };
}

export type SeparatedSurferVerticalSample = {
  deltaSeconds: number;
  downwardWaterVelocity: number;
  projectedArea?: number;
  maximumDepth?: number;
};

export type SeparatedSurferVerticalReading =
  SeparatedSurferVerticalState & {
    immersion: number;
    depth: number;
  };

/**
 * Integrates the separated body relative to the local water surface. Gravity
 * acts while airborne; once the body crosses the surface, quadratic drag
 * couples it to the measured downward wash velocity and modest human buoyancy
 * brings it back up as that wash releases. Fixed wipeout animation timing is
 * absent from this solver.
 */
export function advanceSeparatedSurferVerticalDynamics(
  state: SeparatedSurferVerticalState,
  sample: SeparatedSurferVerticalSample,
): SeparatedSurferVerticalReading {
  const maximumDepth = clampValue(
    sample.maximumDepth ?? 1.8,
    .3,
    1.8,
  );
  let surfaceOffset = clampValue(
    state.surfaceOffset,
    -maximumDepth,
    1.35,
  );
  let verticalVelocity = clampValue(state.verticalVelocity, -9, 7);
  const downwardWaterVelocity = clampValue(
    sample.downwardWaterVelocity,
    -4.5,
    .5,
  );
  const dragAreaScale = clampValue(
    (sample.projectedArea ?? .52) / .52,
    .3,
    1.5,
  );
  let remaining = clampValue(sample.deltaSeconds, 0, .05);
  const maxStep = 1 / 240;

  while (remaining > 1e-9) {
    const step = Math.min(maxStep, remaining);
    const immersion = smoothstep(-.08, .5, -surfaceOffset);
    const waterRelativeVelocity =
      verticalVelocity - downwardWaterVelocity;
    const waterDragAcceleration = -waterRelativeVelocity
      * Math.abs(waterRelativeVelocity)
      * (1.05 + immersion * 1.85)
      * immersion
      * dragAreaScale;
    const gravityAcceleration = -9.81 * (1 - immersion);
    const buoyancyAcceleration = immersion
      * (1.15 + Math.max(0, -surfaceOffset) * .48);
    const acceleration = gravityAcceleration
      + buoyancyAcceleration
      + waterDragAcceleration;
    verticalVelocity = clampValue(
      verticalVelocity + acceleration * step,
      -9,
      7,
    );
    surfaceOffset = clampValue(
      surfaceOffset + verticalVelocity * step,
      -maximumDepth,
      1.35,
    );
    if (
      surfaceOffset <= -maximumDepth
      && verticalVelocity < 0
    ) {
      verticalVelocity = 0;
    }
    remaining -= step;
  }

  const immersion = smoothstep(-.08, .5, -surfaceOffset);
  return {
    surfaceOffset,
    verticalVelocity,
    immersion,
    depth: Math.max(0, -surfaceOffset),
  };
}

export type SeparatedSurferRecoverySample = {
  deltaSeconds: number;
  elapsedSeconds: number;
  surfaceOffset: number;
  verticalVelocity: number;
  waterRelativeSpeed: number;
  angularSpeed: number;
  washIntensity: number;
  leashTension: number;
  maximumHoldSeconds: number;
  minimumImpactSeconds?: number;
  settleSeconds?: number;
  washReleaseThreshold?: number;
};

export type SeparatedSurferRecoveryReading = {
  readiness: number;
  physicallySettled: boolean;
  safetyRelease: boolean;
  ready: boolean;
  limitingFactor:
    | "impact"
    | "submerged"
    | "rising"
    | "wash"
    | "tumble"
    | "drift"
    | "leash"
    | "settled"
    | "safety";
};

/**
 * Requires a separated surfer to resurface and remain dynamically settled
 * before control returns. The short readiness dwell filters one-frame surface
 * crossings; the long safety ceiling is only a failsafe for pathological
 * geometry or numerical states, not the normal recovery trigger.
 */
export function advanceSeparatedSurferRecovery(
  currentReadiness: number,
  sample: SeparatedSurferRecoverySample,
): SeparatedSurferRecoveryReading {
  const delta = clampValue(sample.deltaSeconds, 0, .05);
  const elapsed = Math.max(0, sample.elapsedSeconds);
  const surfaceOffset = clampValue(sample.surfaceOffset, -2, 1.5);
  const verticalSpeed = Math.abs(sample.verticalVelocity);
  const waterRelativeSpeed = Math.max(0, sample.waterRelativeSpeed);
  const angularSpeed = Math.max(0, sample.angularSpeed);
  const washIntensity = clampValue(sample.washIntensity, 0, 1.5);
  const leashTension = clampValue(sample.leashTension, 0, 1.5);
  const maximumHoldSeconds = clampValue(
    sample.maximumHoldSeconds,
    1.35,
    12,
  );
  const minimumImpactSeconds = clampValue(
    sample.minimumImpactSeconds ?? .9,
    .35,
    .9,
  );
  const settleSeconds = clampValue(
    sample.settleSeconds ?? .55,
    .25,
    .55,
  );
  const washReleaseThreshold = clampValue(
    sample.washReleaseThreshold ?? .18,
    .18,
    .45,
  );
  const safetyRelease = elapsed >= maximumHoldSeconds;
  let limitingFactor:
    SeparatedSurferRecoveryReading["limitingFactor"] = "settled";

  if (elapsed < minimumImpactSeconds) {
    limitingFactor = "impact";
  } else if (surfaceOffset < -.1) {
    limitingFactor = "submerged";
  } else if (verticalSpeed > 1.05) {
    limitingFactor = "rising";
  } else if (washIntensity > washReleaseThreshold) {
    limitingFactor = "wash";
  } else if (angularSpeed > 2.2) {
    limitingFactor = "tumble";
  } else if (waterRelativeSpeed > 1.85) {
    limitingFactor = "drift";
  } else if (leashTension > .62) {
    limitingFactor = "leash";
  }

  const physicallySettled = limitingFactor === "settled";
  const readiness = clampValue(
    currentReadiness
      + delta * (
        physicallySettled
          ? 1 / settleSeconds
          : -1 / .2
      ),
    0,
    1,
  );

  return {
    readiness,
    physicallySettled,
    safetyRelease,
    ready: readiness >= 1 || safetyRelease,
    limitingFactor: safetyRelease
      ? "safety"
      : limitingFactor,
  };
}

export type SeparatedSurferHorizontalState = {
  velocityX: number;
  velocityZ: number;
};

export type SeparatedSurferHorizontalSample = {
  deltaSeconds: number;
  immersion: number;
  waterVelocityX: number;
  waterVelocityZ: number;
  turbulence: number;
  projectedArea?: number;
};

/**
 * Integrates a separated surfer horizontally against the water actually
 * occupied by the body. Airborne momentum sees only weak air drag; immersion
 * progressively couples the body to current and breaking-water velocity via
 * quadratic drag. Wipeout progress and hold-down duration are absent.
 */
export function advanceSeparatedSurferHorizontalDynamics(
  state: SeparatedSurferHorizontalState,
  sample: SeparatedSurferHorizontalSample,
): SeparatedSurferHorizontalState {
  let velocityX = clampValue(state.velocityX, -24, 24);
  let velocityZ = clampValue(state.velocityZ, -24, 24);
  const immersion = clampValue(sample.immersion, 0, 1);
  const turbulence = clampValue(sample.turbulence, 0, 1);
  const waterVelocityX = clampValue(sample.waterVelocityX, -12, 12);
  const waterVelocityZ = clampValue(sample.waterVelocityZ, -12, 12);
  const dragAreaScale = clampValue(
    (sample.projectedArea ?? .52) / .52,
    .3,
    1.5,
  );
  let remaining = clampValue(sample.deltaSeconds, 0, .05);
  const maxStep = 1 / 240;

  while (remaining > 1e-9) {
    const step = Math.min(maxStep, remaining);
    const relativeX = velocityX - waterVelocityX;
    const relativeZ = velocityZ - waterVelocityZ;
    const dragCoefficient = immersion
      * (.12 + turbulence * .22)
      * dragAreaScale;
    let accelerationX = -relativeX
      * Math.abs(relativeX)
      * dragCoefficient
      - velocityX * .018 * (1 - immersion);
    let accelerationZ = -relativeZ
      * Math.abs(relativeZ)
      * dragCoefficient
      - velocityZ * .018 * (1 - immersion);
    const accelerationMagnitude = Math.hypot(
      accelerationX,
      accelerationZ,
    );
    if (accelerationMagnitude > 18) {
      const scale = 18 / accelerationMagnitude;
      accelerationX *= scale;
      accelerationZ *= scale;
    }
    velocityX = clampValue(
      velocityX + accelerationX * step,
      -24,
      24,
    );
    velocityZ = clampValue(
      velocityZ + accelerationZ * step,
      -24,
      24,
    );
    remaining -= step;
  }

  return { velocityX, velocityZ };
}

export type SurfboardLeashReactionSample = {
  stretch: number;
  separationRate: number;
  surferMass: number;
  boardMass: number;
  restLength?: number;
  springStiffness?: number;
  damping?: number;
  maximumForce?: number;
};

export type SurfboardLeashReactionReading = {
  force: number;
  tension: number;
  surferAcceleration: number;
  boardAcceleration: number;
  relativeAcceleration: number;
};

/**
 * Resolves a stretched urethane leash as a one-dimensional spring-damper along
 * the measured cord direction. Force on the surfer and board is equal and
 * opposite; their different masses determine acceleration. A slack or closing
 * cord cannot push either body apart.
 */
export function resolveSurfboardLeashReaction(
  sample: SurfboardLeashReactionSample,
): SurfboardLeashReactionReading {
  const stretch = Math.max(0, sample.stretch);
  const separationRate = Math.max(0, sample.separationRate);
  const surferMass = clampValue(sample.surferMass, 45, 130);
  const boardMass = clampValue(sample.boardMass, 2.4, 10);
  const restLength = clampValue(sample.restLength ?? 2.2, 1.6, 3.6);
  const springStiffness = clampValue(
    sample.springStiffness ?? 82 * 2.2 / restLength,
    30,
    140,
  );
  const damping = clampValue(
    sample.damping ?? 12 * Math.sqrt(2.2 / restLength),
    4,
    24,
  );
  const maximumForce = clampValue(
    sample.maximumForce ?? 220,
    90,
    320,
  );
  const force = stretch > 0
    ? Math.min(
        maximumForce,
        springStiffness * stretch + damping * separationRate,
      )
    : 0;
  const surferAcceleration = force / surferMass;
  const boardAcceleration = force / boardMass;

  return {
    force,
    tension: force / maximumForce,
    surferAcceleration,
    boardAcceleration,
    relativeAcceleration:
      surferAcceleration + boardAcceleration,
  };
}

export type SurfboardLeashTorqueSample = {
  force: number;
  directionX: number;
  directionY: number;
  directionZ: number;
  surferMass: number;
  boardMass: number;
  boardLength: number;
  boardWidth: number;
};

export type SurfboardLeashTorqueReading = {
  boardPitchAcceleration: number;
  boardYawAcceleration: number;
  boardRollAcceleration: number;
  surferPitchAcceleration: number;
  surferRollAcceleration: number;
};

/**
 * Converts leash force into angular acceleration at its real attachment
 * points: the tail plug below the board's center and the ankle below the
 * surfer's center of mass. The board and surfer therefore rotate from the same
 * cord pull instead of receiving an animation-only twist.
 */
export function resolveSurfboardLeashTorque(
  sample: SurfboardLeashTorqueSample,
): SurfboardLeashTorqueReading {
  const force = clampValue(sample.force, 0, 320);
  const directionMagnitude = Math.hypot(
    sample.directionX,
    sample.directionY,
    sample.directionZ,
  );
  if (force <= 0 || directionMagnitude <= 1e-6) {
    return {
      boardPitchAcceleration: 0,
      boardYawAcceleration: 0,
      boardRollAcceleration: 0,
      surferPitchAcceleration: 0,
      surferRollAcceleration: 0,
    };
  }
  const directionX = sample.directionX / directionMagnitude;
  const directionY = sample.directionY / directionMagnitude;
  const directionZ = sample.directionZ / directionMagnitude;
  const boardMass = clampValue(sample.boardMass, 2.4, 10);
  const surferMass = clampValue(sample.surferMass, 45, 130);
  const boardLength = clampValue(sample.boardLength, 1.6, 3.6);
  const boardWidth = clampValue(sample.boardWidth, .28, .72);
  const tailOffset = boardLength * .43;
  const plugHeight = .13;
  const boardForceX = -force * directionX;
  const boardForceY = -force * directionY;
  const boardForceZ = -force * directionZ;
  const boardPitchTorque = plugHeight * boardForceZ
    + tailOffset * boardForceY;
  const boardYawTorque = -tailOffset * boardForceX;
  const boardRollTorque = -plugHeight * boardForceX;
  const boardPitchInertia = boardMass
    * (boardLength * boardLength + .018)
    / 12;
  const boardYawInertia = boardMass
    * (
      boardLength * boardLength
        + boardWidth * boardWidth
    )
    / 12;
  const boardRollInertia = boardMass
    * (boardWidth * boardWidth + .018)
    / 12;
  const ankleLever = .52;
  const surferPitchTorque = -ankleLever * force * directionZ;
  const surferRollTorque = ankleLever * force * directionX;
  const surferAngularInertia = surferMass * .18;

  return {
    boardPitchAcceleration: clampValue(
      boardPitchTorque / boardPitchInertia,
      -28,
      28,
    ),
    boardYawAcceleration: clampValue(
      boardYawTorque / boardYawInertia,
      -22,
      22,
    ),
    boardRollAcceleration: clampValue(
      boardRollTorque / boardRollInertia,
      -34,
      34,
    ),
    surferPitchAcceleration: clampValue(
      surferPitchTorque / surferAngularInertia,
      -12,
      12,
    ),
    surferRollAcceleration: clampValue(
      surferRollTorque / surferAngularInertia,
      -12,
      12,
    ),
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
  const turningAuthority = clampValue(
    sample.turningAuthority ?? 1,
    1,
    1.5,
  );
  const momentumRetention = clampValue(
    sample.momentumRetention ?? 1,
    1,
    1.3,
  );
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
    .28,
    Math.max(.72, 3 / Math.sqrt(turn)),
    Math.abs(initialForwardSpeed),
  );
  const faceSlope = clampValue(
    Math.hypot(
      sample.surfaceSlopeX,
      sample.surfaceSlopeZ,
    ) / .32,
    0,
    1,
  );
  const lengthYawInertia = Math.pow(safeLength / 2.5, 1.28);
  const targetYawRate = railInput
    * turn
    * turningAuthority
    * speedAuthority
    * (.46 + Math.abs(initialForwardSpeed) * .07)
    * (.34 + grip * .66)
    * (1 + faceSlope * .45)
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

  // Surface particles move far slower than the crest itself. Keep their
  // oscillating orbital flow out of the propagation vector so a half-cycle can
  // never reverse the wave normal or the board's capture frame.
  const orbitalCoupling = hullContact * (.035 + contact * (
    .09 + Math.max(0, sample.waveHeight) * .018
  ));
  const waterVelocityX = sample.currentVelocityX
    + (sample.waterVelocityX ?? 0) * orbitalCoupling;
  const waterVelocityZ = sample.currentVelocityZ
    + (sample.waterVelocityZ ?? 0) * orbitalCoupling;
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
    rightRailSurfaceOffset: sample.rightRailSurfaceOffset,
    leftRailSurfaceOffset: sample.leftRailSurfaceOffset,
    boardLength: safeLength,
    boardWidth: safeWidth,
    boardTurn: turn,
    faceTrimSupport: sample.faceTrimSupport,
  });
  const activeRailPressureResistance =
    1 - Math.abs(railInput)
      * grip
      * (.28 + planing * .42);
  yawRate = clampValue(
    yawRate
      + wavePressure.yawAcceleration
        * activeRailPressureResistance
        * delta,
    -4.8,
    4.8,
  );

  const lengthDragScale = Math.pow(2.5 / safeLength, .58);
  const widthDragScale = Math.pow(safeWidth / .34, .46);
  const glideDragBonus = Math.max(0, sample.glideDragBonus ?? 0);
  const longitudinalDrag = (.033 + whitewater * .035 + glideDragBonus)
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
    )
    / momentumRetention;
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
  const waveDriveX = (sample.waveDriveX ?? 0) * hullContact;
  const waveDriveZ = (sample.waveDriveZ ?? 0) * hullContact;
  const waveDriveForward = waveDriveX * forwardX + waveDriveZ * forwardZ;
  let accelerationX = gravityAccelerationX
    + wavePressure.accelerationX
    + waveDriveX
    + forwardX * dragForward
    + rightX * dragLateral
    + turbulenceX;
  let accelerationZ = gravityAccelerationZ
    + wavePressure.accelerationZ
    + waveDriveZ
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
    wavePatchContact: wavePressure.patchContact,
    waveDriveForward,
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
  // Project the wave-relative flow onto the board's lateral axis. Using the
  // sine of the heading error preserves the useful flow seen on a diagonal
  // takeoff; a linear 1 - |cos(theta)| model badly under-counts load until the
  // board is nearly perpendicular to the wall.
  const broadside = Math.sqrt(Math.max(
    0,
    1 - headingAlignment * headingAlignment,
  ));
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
  const faceTrimSupport = clampValue(
    sample.faceTrimSupport ?? 0,
    0,
    1,
  );
  const diagonalTrim = faceTrimSupport
    * smoothstep(.08, .72, headingAlignment);
  // A surfboard can angle into a shoulder, but it cannot acquire planing trim
  // while presenting most of its rail to the wave. Preserve useful diagonal
  // entries while making the final quarter-turn toward broadside lose capture
  // sharply rather than behaving like an arcade pickup radius.
  const directionalEntry = smoothstep(
    .25 - diagonalTrim * .28,
    .94 - diagonalTrim * .2,
    headingAlignment,
  );
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
  const crossFlowSpeed = Math.max(0, relativeWaveSpeed)
    * broadside
    * (1 - diagonalTrim * .58);
  const planformScale = clampValue(
    Math.sqrt(
      (
        Math.max(1.6, sample.boardLength ?? 2.5)
          * Math.max(.24, sample.boardWidth ?? .34)
      ) / (2.5 * .34),
    ),
    .82,
    1.18,
  );
  // Hydrodynamic impact grows with dynamic pressure, so cross-flow speed is
  // squared. Board planform changes the intercepted water area, while the
  // board's stability remains the opposing righting term.
  const crossWaveLoad = Math.max(
    0,
    Math.min(
      1.5,
      waveContact
        * Math.pow(
          crossFlowSpeed / Math.max(1.2, waveSpeed * .54),
          2,
        )
        * (.78 + sample.crestEnergy * .42)
        * planformScale
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
        + waveContact
          * Math.max(0, broadside - .52)
          * .28
          * (1 - diagonalTrim * .72)
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
    crossFlowSpeed,
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

export function shorelineShiftForTide(tide: number) {
  return oceanTideShorelineShift(tide);
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

export const OPTIONAL_TOW_DURATION_SECONDS = 16;
export const OPTIONAL_TOW_NAVIGABLE_OFFSHORE = 6;
export const OPTIONAL_TOW_BERTH_OFFSHORE = .5;
export const OPTIONAL_TOW_LAUNCH_CLEARANCE_PROGRESS = .16;
export const OPTIONAL_TOW_RETURN_BERTH_PROGRESS = .68;
// These dimensions follow the actual bevelled white-hull geometry rather than
// the smaller visual planform used by the original five-point approximation.
// Keep HALF_LENGTH as the mean reach for callers that only need a characteristic
// span; flotation samplers should use the asymmetric bow/stern constants.
export const OPTIONAL_TOW_HULL_BOW_REACH = 2.08;
export const OPTIONAL_TOW_HULL_STERN_REACH = 1.76;
export const OPTIONAL_TOW_HULL_HALF_LENGTH = (
  OPTIONAL_TOW_HULL_BOW_REACH + OPTIONAL_TOW_HULL_STERN_REACH
) * .5;
export const OPTIONAL_TOW_HULL_HALF_BEAM = .8;
export const OPTIONAL_TOW_HULL_MAX_VERTICAL_SPEED = 3.2;
export const OPTIONAL_TOW_HULL_MAX_VERTICAL_ACCELERATION = 11.5;

export type OptionalTowHullSurfaceSample = {
  centerHeight: number;
  bowHeight: number;
  sternHeight: number;
  leftHeight: number;
  rightHeight: number;
  speed: number;
};

export type OptionalTowHullAttitude = {
  waterlineHeight: number;
  pitch: number;
  roll: number;
  planing: number;
};

/**
 * Fits the jetski's waterline to five points under its actual hull footprint.
 * The weighted waterline represents displaced water across the footprint.
 * Pitch and roll intentionally under-follow short chop. A single high sample
 * must not lift the entire craft: actual penetration protection belongs to the
 * rate-limited rigid-body solver, not to a discontinuous maximum waterline.
 */
export function resolveOptionalTowHullAttitude(
  sample: OptionalTowHullSurfaceSample,
): OptionalTowHullAttitude {
  const centerHeight = Number.isFinite(sample.centerHeight)
    ? sample.centerHeight
    : 0;
  const bowHeight = Number.isFinite(sample.bowHeight)
    ? sample.bowHeight
    : centerHeight;
  const sternHeight = Number.isFinite(sample.sternHeight)
    ? sample.sternHeight
    : centerHeight;
  const leftHeight = Number.isFinite(sample.leftHeight)
    ? sample.leftHeight
    : centerHeight;
  const rightHeight = Number.isFinite(sample.rightHeight)
    ? sample.rightHeight
    : centerHeight;
  const forwardSlope = (
    bowHeight - sternHeight
  ) / (
    OPTIONAL_TOW_HULL_BOW_REACH
      + OPTIONAL_TOW_HULL_STERN_REACH
  );
  const lateralSlope = (
    rightHeight - leftHeight
  ) / (OPTIONAL_TOW_HULL_HALF_BEAM * 2);
  const speed = Number.isFinite(sample.speed)
    ? sample.speed
    : 0;
  const planing = clampValue(speed / 14.5, 0, 1);
  // A planing hull has enough longitudinal stability to follow a coherent
  // face. Reducing pitch authority at speed left the bow driving straight
  // through steep crests even though all five probes described the slope.
  // A coherent breaker face is not chop: rotating the hull with its
  // longitudinal waterline is what keeps the bow clear without translating
  // the whole craft above its displacement plane. The former .72-.78 gain
  // under-followed a real ~28 degree face until the old .38 rad clamp, so the
  // non-penetration constraint could only respond by lifting the entire ski.
  const pitchAuthority = lerpValue(.86, .98, planing);
  const rollAuthority = lerpValue(.52, .34, planing);
  const pitch = clampValue(
    -Math.atan(forwardSlope) * pitchAuthority - planing * .028,
    -.5,
    .5,
  );
  const roll = clampValue(
    Math.atan(lateralSlope) * rollAuthority,
    -.18,
    .18,
  );
  const displacedWaterline = (
    centerHeight * 2
      + bowHeight
      + sternHeight
      + leftHeight
      + rightHeight
  ) / 6;
  return {
    waterlineHeight: displacedWaterline,
    pitch,
    roll,
    planing,
  };
}

export type OptionalTowHullFloatState = {
  elevation: number;
  /**
   * Frame-average rendered velocity. It always equals the finite difference
   * of consecutive elevations, so telemetry cannot hide a position jump.
   */
  verticalVelocity: number;
  /**
   * Hull velocity relative to the moving water plane. World-space surface
   * motion is carried by the filtered reference fields below.
   */
  integrationVelocity?: number;
  /**
   * Low-frequency water-reference velocity. Acceleration limiting separates
   * coherent swell heave from short chop before relative buoyancy is solved.
   */
  referenceVelocity?: number;
  /** Frame-average acceleration of the filtered water reference. */
  referenceAcceleration?: number;
  pitch: number;
  pitchVelocity: number;
  roll: number;
  rollVelocity: number;
  targetElevation: number;
  targetVerticalVelocity: number;
  /** Last raw sampled target, used to identify a continuous water reference. */
  sampledTargetElevation?: number;
  /** Last plausible raw water-reference velocity. */
  sampledVerticalVelocity?: number;
  targetPitch: number;
  targetRoll: number;
  initialized: boolean;
};

export type OptionalTowHullFloatSample = {
  targetElevation: number;
  /** Lower edge of the compliant, rendered-pose support envelope. */
  minimumContactElevation?: number;
  /** Forward-sampled velocity of the support envelope. */
  predictedContactVelocity?: number;
  targetPitch: number;
  targetRoll: number;
  planing: number;
  deltaSeconds: number;
};

/**
 * Advances the jetski in the moving frame of the sampled water plane.
 *
 * A floating hull follows coherent long-wave elevation in world space; its
 * inertia governs displacement relative to that plane. Rate-limiting absolute
 * world height makes the craft hover above a falling face and submerge under
 * the next crest. Plausible water motion therefore drives an
 * acceleration-limited reference frame, while short chop and sample seams
 * remain for the bounded relative solver to attenuate.
 */
export function advanceOptionalTowHullFloat(
  state: OptionalTowHullFloatState,
  sample: OptionalTowHullFloatSample,
): OptionalTowHullFloatState {
  const targetElevation = Number.isFinite(sample.targetElevation)
    ? sample.targetElevation
    : Number.isFinite(state.targetElevation)
      ? state.targetElevation
      : 0;
  const targetPitch = clampValue(
    Number.isFinite(sample.targetPitch)
      ? sample.targetPitch
      : 0,
    -.5,
    .5,
  );
  const targetRoll = clampValue(
    Number.isFinite(sample.targetRoll)
      ? sample.targetRoll
      : 0,
    -.22,
    .22,
  );
  const planing = clampValue(
    Number.isFinite(sample.planing) ? sample.planing : 0,
    0,
    1,
  );
  const frameDelta = Math.max(
    0,
    Number.isFinite(sample.deltaSeconds) ? sample.deltaSeconds : 0,
  );
  const delta = Math.min(frameDelta, .05);
  const hasMinimumContact = Number.isFinite(
    sample.minimumContactElevation,
  );
  const minimumContactElevation = hasMinimumContact
    ? sample.minimumContactElevation as number
    : Number.NEGATIVE_INFINITY;
  const predictedContactVelocity = hasMinimumContact
    && Number.isFinite(sample.predictedContactVelocity)
    ? clampValue(
        sample.predictedContactVelocity as number,
        -12,
        12,
      )
    : 0;
  if (!state.initialized) {
    return {
      elevation: Math.max(targetElevation, minimumContactElevation),
      verticalVelocity: 0,
      integrationVelocity: 0,
      referenceVelocity: 0,
      referenceAcceleration: 0,
      pitch: targetPitch,
      pitchVelocity: 0,
      roll: targetRoll,
      rollVelocity: 0,
      targetElevation,
      targetVerticalVelocity: 0,
      sampledTargetElevation: targetElevation,
      sampledVerticalVelocity: 0,
      targetPitch,
      targetRoll,
      initialized: true,
    };
  }

  const initialElevation = Number.isFinite(state.elevation)
    ? state.elevation
    : targetElevation;
  const previousSampledTarget = Number.isFinite(
    state.sampledTargetElevation,
  )
    ? state.sampledTargetElevation as number
    : targetElevation;
  const sampledTargetDelta = targetElevation - previousSampledTarget;
  const rawSurfaceVelocity = frameDelta > 1e-9
    ? sampledTargetDelta / frameDelta
    : 0;
  // The rendered face can legitimately move several metres per second. A
  // profile seam instead presents a large one-frame displacement. Reject
  // impossible geometry, then acceleration-limit the remaining reference:
  // coherent swell passes, while short chop cannot bypass hull inertia.
  const maximumContinuousDelta = Math.max(
    .18,
    Math.min(.4, frameDelta * 8),
  );
  const continuousSurfaceSample = frameDelta > 1e-9
    && Math.abs(sampledTargetDelta) <= maximumContinuousDelta
    && Math.abs(rawSurfaceVelocity) <= 12;
  const previousReferenceVelocity = clampValue(
    Number.isFinite(state.referenceVelocity)
      ? state.referenceVelocity as number
      : 0,
    -12,
    12,
  );
  const targetReferenceVelocity = continuousSurfaceSample
    ? rawSurfaceVelocity
    : 0;
  // The rigid-body step is capped at 50 ms; carrying the reference for twice
  // that horizon allowed a stalled render frame to translate the hull by up
  // to 1.2 m while buoyancy integrated only half as long.
  const referenceDelta = delta;
  const maximumReferenceAcceleration = lerpValue(
    hasMinimumContact ? 10 : 4.8,
    hasMinimumContact ? 16 : 6.2,
    planing,
  );
  const referenceVelocity = clampValue(
    previousReferenceVelocity + clampValue(
      targetReferenceVelocity - previousReferenceVelocity,
      -maximumReferenceAcceleration * referenceDelta,
      maximumReferenceAcceleration * referenceDelta,
    ),
    -12,
    12,
  );
  const referenceAcceleration = referenceDelta > 1e-9
    ? (
        referenceVelocity - previousReferenceVelocity
      ) / referenceDelta
    : 0;
  const referenceTranslation = (
    previousReferenceVelocity + referenceVelocity
  ) * .5 * referenceDelta;
  let elevation = initialElevation + referenceTranslation;
  const storedIntegrationVelocity = state.integrationVelocity;
  let integrationVelocity = clampValue(
    typeof storedIntegrationVelocity === "number"
      && Number.isFinite(storedIntegrationVelocity)
      ? storedIntegrationVelocity
      : 0,
    -OPTIONAL_TOW_HULL_MAX_VERTICAL_SPEED,
    OPTIONAL_TOW_HULL_MAX_VERTICAL_SPEED,
  );
  const previousPitchTarget = Number.isFinite(state.targetPitch)
    ? state.targetPitch
    : targetPitch;
  const previousRollTarget = Number.isFinite(state.targetRoll)
    ? state.targetRoll
    : targetRoll;
  let pitch = clampValue(
    Number.isFinite(state.pitch) ? state.pitch : targetPitch,
    -.54,
    .54,
  );
  let pitchVelocity = clampValue(
    Number.isFinite(state.pitchVelocity)
      ? state.pitchVelocity
      : 0,
    -2,
    2,
  );
  let roll = clampValue(
    Number.isFinite(state.roll) ? state.roll : targetRoll,
    -.28,
    .28,
  );
  let rollVelocity = clampValue(
    Number.isFinite(state.rollVelocity)
      ? state.rollVelocity
      : 0,
    -2,
    2,
  );
  let remaining = delta;
  let elapsed = 0;

  while (remaining > 1e-9) {
    const step = Math.min(1 / 240, remaining);
    elapsed += step;
    const targetProgress = delta > 1e-9
      ? clampValue(elapsed / delta, 0, 1)
      : 1;
    const framePitchTarget = lerpValue(
      previousPitchTarget,
      targetPitch,
      targetProgress,
    );
    const frameRollTarget = lerpValue(
      previousRollTarget,
      targetRoll,
      targetProgress,
    );
    const elevationError = targetElevation - elevation;
    const separationResponse = smoothstep(
      .08,
      .48,
      Math.abs(elevationError),
    );
    const heaveFrequency = lerpValue(
      lerpValue(6.2, 7.4, planing),
      lerpValue(9.5, 11.5, planing),
      separationResponse,
    );
    const heaveAccelerationLimit = lerpValue(
      hasMinimumContact ? 20 : 10,
      hasMinimumContact
        ? 22
        : OPTIONAL_TOW_HULL_MAX_VERTICAL_ACCELERATION,
      planing,
    );
    const desiredRelativeAcceleration = clampValue(
      heaveFrequency * heaveFrequency * elevationError
        - 2.4 * heaveFrequency * integrationVelocity,
      -heaveAccelerationLimit,
      heaveAccelerationLimit,
    );
    // Keep the rendered hull's total vertical acceleration bounded even when
    // filtered water-reference acceleration and relative buoyancy reinforce
    // one another.
    const integratedWorldAccelerationLimit = hasMinimumContact
      ? 22
      : 9;
    const heaveAcceleration = clampValue(
      referenceAcceleration + desiredRelativeAcceleration,
      -integratedWorldAccelerationLimit,
      integratedWorldAccelerationLimit,
    ) - referenceAcceleration;
    integrationVelocity = clampValue(
      integrationVelocity + heaveAcceleration * step,
      -lerpValue(2.9, OPTIONAL_TOW_HULL_MAX_VERTICAL_SPEED, planing),
      lerpValue(2.9, OPTIONAL_TOW_HULL_MAX_VERTICAL_SPEED, planing),
    );
    // Integrate through target crossings instead of snapping position or
    // velocity. The over-damped buoyancy response removes the residual
    // naturally and keeps reversals acceleration-continuous.
    elevation += integrationVelocity * step;

    const previousPitch = pitch;
    const pitchError = framePitchTarget - pitch;
    // Longitudinal probe separation is almost four metres, so a steep face
    // can rotate beneath a 10 m/s craft much faster than ordinary chop. Track
    // large, coherent pitch changes promptly; leaving a tenth-radian lag made
    // the bow penetrate first and forced the contact solver to levitate the
    // entire hull instead.
    const pitchResponse = lerpValue(7.5, 10.5, planing)
      + smoothstep(.025, .12, Math.abs(pitchError)) * 7;
    pitch += pitchError
      * (1 - Math.exp(-pitchResponse * step));
    pitchVelocity = lerpValue(
      pitchVelocity,
      (pitch - previousPitch) / Math.max(1e-6, step),
      1 - Math.exp(-16 * step),
    );
    pitch = clampValue(
      pitch,
      -.54,
      .54,
    );

    const previousRoll = roll;
    const rollError = frameRollTarget - roll;
    const rollResponse = lerpValue(5.8, 7.2, planing)
      + smoothstep(.035, .14, Math.abs(rollError)) * 3.4;
    roll += rollError
      * (1 - Math.exp(-rollResponse * step));
    rollVelocity = lerpValue(
      rollVelocity,
      (roll - previousRoll) / Math.max(1e-6, step),
      1 - Math.exp(-16 * step),
    );
    roll = clampValue(
      roll,
      -.28,
      .28,
    );
    remaining -= step;
  }

  let verticalVelocity = frameDelta > 1e-9
    ? (elevation - initialElevation) / frameDelta
    : 0;
  if (hasMinimumContact && frameDelta > 1e-9) {
    // A five-probe maximum can change identity much faster than a real hull
    // can accelerate. Follow its forward-predicted velocity with a compliant
    // inelastic contact law, then clamp the rendered velocity—not position—
    // to a 24 m/s² physical envelope. Position, telemetry velocity, and the
    // stored relative velocity therefore remain exactly consistent.
    const previousWorldVelocity = Number.isFinite(
      state.verticalVelocity,
    )
      ? state.verticalVelocity
      : 0;
    const maximumRenderedAcceleration = 24;
    const contactAcceleration = clampValue(
      64 * (minimumContactElevation - initialElevation)
        + 12 * (
          predictedContactVelocity - previousWorldVelocity
        ),
      -maximumRenderedAcceleration,
      maximumRenderedAcceleration,
    );
    const freeWorldVelocity = previousWorldVelocity
      + contactAcceleration * frameDelta;
    const contactWorldVelocity = Math.min(
      predictedContactVelocity + .35,
      (
        minimumContactElevation - initialElevation
      ) / frameDelta,
    );
    const desiredWorldVelocity = Math.max(
      freeWorldVelocity,
      contactWorldVelocity,
    );
    const stallSpeedLimit = frameDelta > .05
      ? .14 / frameDelta
      : 4.8;
    verticalVelocity = clampValue(
      clampValue(
        desiredWorldVelocity,
        previousWorldVelocity
          - maximumRenderedAcceleration * frameDelta,
        previousWorldVelocity
          + maximumRenderedAcceleration * frameDelta,
      ),
      -stallSpeedLimit,
      stallSpeedLimit,
    );
    elevation = initialElevation
      + verticalVelocity * frameDelta;
    integrationVelocity = verticalVelocity
      - referenceVelocity;
  }
  return {
    elevation,
    verticalVelocity,
    integrationVelocity,
    referenceVelocity,
    referenceAcceleration,
    pitch,
    pitchVelocity,
    roll,
    rollVelocity,
    targetElevation,
    targetVerticalVelocity: continuousSurfaceSample
      ? rawSurfaceVelocity
      : 0,
    sampledTargetElevation: targetElevation,
    sampledVerticalVelocity: continuousSurfaceSample
      ? rawSurfaceVelocity
      : 0,
    targetPitch,
    targetRoll,
    initialized: true,
  };
}

/**
 * Keeps the tow craft seaward of the local, curved shoreline. The caller
 * supplies the shoreline in world-z coordinates so the same constraint works
 * at points, reefs, tide-shifted beaches, and the return route.
 */
export function optionalTowNavigableZ(
  targetZ: number,
  shorelineWorldZ: number,
  minimumOffshore = OPTIONAL_TOW_NAVIGABLE_OFFSHORE,
) {
  return Math.min(
    targetZ,
    shorelineWorldZ - Math.max(
      OPTIONAL_TOW_BERTH_OFFSHORE,
      minimumOffshore,
    ),
  );
}

/**
 * The parked craft belongs in collapsed harbor swash, not the active breaking
 * band. Launch and return vary only the safety clearance; the craft controller
 * still integrates the actual route, so neither transition teleports it.
 */
export function optionalTowRouteClearance(
  progress: number,
  returning = false,
) {
  const safeProgress = clampValue(
    Number.isFinite(progress) ? progress : 0,
    0,
    1,
  );
  const transitionStart = returning
    ? OPTIONAL_TOW_RETURN_BERTH_PROGRESS
    : 0;
  const transitionEnd = returning
    ? 1
    : OPTIONAL_TOW_LAUNCH_CLEARANCE_PROGRESS;
  const transitionUnit = clampValue(
    (safeProgress - transitionStart)
      / Math.max(1e-6, transitionEnd - transitionStart),
    0,
    1,
  );
  const blend = transitionUnit * transitionUnit
    * transitionUnit
    * (
      transitionUnit * (
        transitionUnit * 6 - 15
      ) + 10
    );
  return returning
    ? lerpValue(
        OPTIONAL_TOW_NAVIGABLE_OFFSHORE,
        OPTIONAL_TOW_BERTH_OFFSHORE,
        blend,
      )
    : lerpValue(
        OPTIONAL_TOW_BERTH_OFFSHORE,
        OPTIONAL_TOW_NAVIGABLE_OFFSHORE,
        blend,
      );
}

export function stageOptionalTowCrestAtBreaker(
  anchorX: number,
  anchorZ: number,
  crestX: number,
  crestZ: number,
  normalX: number,
  normalZ: number,
  maximumNormalOffset = 3.5,
  maximumTangentOffset = 12,
) {
  const normalLength = Math.max(.001, Math.hypot(normalX, normalZ));
  const unitNormalX = normalX / normalLength;
  const unitNormalZ = normalZ / normalLength;
  const normalOffset = (crestX - anchorX) * unitNormalX
    + (crestZ - anchorZ) * unitNormalZ;
  const tangentX = unitNormalZ;
  const tangentZ = -unitNormalX;
  const tangentOffset = (crestX - anchorX) * tangentX
    + (crestZ - anchorZ) * tangentZ;
  const stagedNormalOffset = clampValue(
    normalOffset,
    -Math.abs(maximumNormalOffset),
    Math.abs(maximumNormalOffset),
  );
  const stagedTangentOffset = clampValue(
    tangentOffset,
    -Math.abs(maximumTangentOffset),
    Math.abs(maximumTangentOffset),
  );
  return {
    x: anchorX
      + stagedNormalOffset * unitNormalX
      + stagedTangentOffset * tangentX,
    z: anchorZ
      + stagedNormalOffset * unitNormalZ
      + stagedTangentOffset * tangentZ,
    normalOffset: stagedNormalOffset,
    tangentOffset: stagedTangentOffset,
  };
}

export function advanceOptionalTowProgress(
  progress: number,
  deltaSeconds: number,
  durationSeconds = OPTIONAL_TOW_DURATION_SECONDS,
) {
  if (!Number.isFinite(progress) || !Number.isFinite(deltaSeconds)) return 0;
  return Math.max(0, Math.min(1, progress + Math.max(0, deltaSeconds) / Math.max(.1, durationSeconds)));
}

export type OptionalTowInterceptSample = {
  routeProgress: number;
  faceQuality: number;
  distanceToTarget: number;
  headingAlignment: number;
  speedMatch: number;
};

/**
 * Scores the live tow interception rather than a clock window. Route progress
 * only proves that the craft has completed its outbound turn; proximity to the
 * moving takeoff point, board/face alignment, speed match, and the face itself
 * decide whether releasing is useful.
 */
export function optionalTowReleaseQuality(
  sample: OptionalTowInterceptSample,
) {
  const routeReady = smoothstep(.54, .7, sample.routeProgress);
  const targetLock = 1 - smoothstep(
    1.4,
    7.5,
    Math.max(0, sample.distanceToTarget),
  );
  const alignment = smoothstep(
    .32,
    .88,
    sample.headingAlignment,
  );
  const speedMatch = smoothstep(.32, .86, sample.speedMatch);
  return clampValue(
    clampValue(sample.faceQuality, 0, 1)
      * (.22 + targetLock * .78)
      * (.38 + alignment * .62)
      * (.42 + speedMatch * .58)
      * (.32 + routeReady * .68),
    0,
    1,
  );
}

export function optionalTowReleaseRecommended(quality: number) {
  return clampValue(quality, 0, 1) >= .58;
}

export type OptionalTowReleaseFaceSample = {
  breakingRatio: number;
  crestPhaseError: number;
  faceSlope: number;
  surfaceRise: number;
  whitewater: number;
};

/**
 * Scores the face that is physically under the tow surfer. Progress alone
 * cannot prove that the craft caught its intended crest: frame pressure,
 * oblique swell, and route lag can all move the nominal window away from the
 * rendered wave. The score therefore requires a depth-limited front face and
 * measured slope, lift, or crest-localized whitewater.
 */
export function optionalTowReleaseFaceQuality(
  sample: OptionalTowReleaseFaceSample,
) {
  const phaseError = Math.atan2(
    Math.sin(sample.crestPhaseError),
    Math.cos(sample.crestPhaseError),
  );
  const frontFace = smoothstep(-.08, .18, phaseError)
    * (1 - smoothstep(1.25, 1.9, phaseError));
  const depthLimited = smoothstep(.6, .82, sample.breakingRatio)
    * (1 - smoothstep(1.08, 1.55, sample.breakingRatio));
  const physicalFace = Math.max(
    smoothstep(.006, .06, sample.faceSlope),
    smoothstep(.01, .3, sample.surfaceRise),
    smoothstep(.04, .28, sample.whitewater),
  );
  const openFace = 1 - smoothstep(
    .38,
    .78,
    sample.whitewater,
  );
  return clampValue(
    frontFace
      * depthLimited
      * (.35 + physicalFace * .65),
      0,
      1,
    ) * clampValue(
      openFace,
    0,
    1,
  );
}

/**
 * Chooses a point down the physical front face. The ideal stand-up distance
 * grows with wave scale, while the measured live-face score remains the main
 * criterion so the tow follows an arriving shoulder instead of a fixed spot.
 */
export function optionalTowTakeoffTargetScore(
  faceQuality: number,
  distanceFromCrest: number,
  targetFaceHeight: number,
) {
  const idealDistance = clampValue(
    2.8 + Math.max(0, targetFaceHeight) * .48,
    3.1,
    6.2,
  );
  const distanceQuality = 1 - smoothstep(
    Math.max(1.4, idealDistance * .48),
    Math.max(2.8, idealDistance * 1.08),
    Math.abs(distanceFromCrest - idealDistance),
  );
  return clampValue(faceQuality, 0, 1)
    * (.64 + distanceQuality * .36);
}

export function optionalTowReleasePhysicallySupported(
  requested: boolean,
  progress: number,
  quality: number,
  breakingRatio: number,
  faceQuality = 1,
) {
  return requested
    && progress >= .56
    && quality > .095
    && breakingRatio >= .6
    && breakingRatio <= 1.9
    && faceQuality >= .08;
}

export type OptionalTowCraftState = {
  x: number;
  z: number;
  velocityX: number;
  velocityZ: number;
  heading: number;
};

export function advanceOptionalTowCraft(
  state: OptionalTowCraftState,
  desiredX: number,
  desiredZ: number,
  deltaSeconds: number,
  maximumSpeed: number,
  maximumAcceleration = 6.2,
): OptionalTowCraftState & { speed: number; acceleration: number } {
  const delta = clampValue(deltaSeconds, .001, .05);
  let requestedVelocityX = (desiredX - state.x) / delta;
  let requestedVelocityZ = (desiredZ - state.z) / delta;
  const requestedSpeed = Math.hypot(
    requestedVelocityX,
    requestedVelocityZ,
  );
  const speedLimit = Math.max(.1, maximumSpeed);
  if (requestedSpeed > speedLimit) {
    const scale = speedLimit / requestedSpeed;
    requestedVelocityX *= scale;
    requestedVelocityZ *= scale;
  }
  let changeX = requestedVelocityX - state.velocityX;
  let changeZ = requestedVelocityZ - state.velocityZ;
  const requestedChange = Math.hypot(changeX, changeZ);
  const maximumChange = Math.max(.1, maximumAcceleration) * delta;
  if (requestedChange > maximumChange) {
    const scale = maximumChange / requestedChange;
    changeX *= scale;
    changeZ *= scale;
  }
  const velocityX = state.velocityX + changeX;
  const velocityZ = state.velocityZ + changeZ;
  const speed = Math.hypot(velocityX, velocityZ);
  return {
    x: state.x + velocityX * delta,
    z: state.z + velocityZ * delta,
    velocityX,
    velocityZ,
    heading: speed > .05
      ? Math.atan2(velocityX, velocityZ)
      : state.heading,
    speed,
    acceleration: Math.hypot(changeX, changeZ) / delta,
  };
}

export type OptionalTowRopeState = {
  x: number;
  z: number;
  velocityX: number;
  velocityZ: number;
};

export function advanceOptionalTowRope(
  state: OptionalTowRopeState,
  craft: OptionalTowCraftState,
  deltaSeconds: number,
  ropeLength = 7,
): OptionalTowRopeState & { ropeDistance: number } {
  const delta = clampValue(deltaSeconds, .001, .05);
  const forwardX = Math.sin(craft.heading);
  const forwardZ = Math.cos(craft.heading);
  const desiredX = craft.x - forwardX * ropeLength;
  const desiredZ = craft.z - forwardZ * ropeLength;
  const damping = 1 - Math.exp(-4.8 * delta);
  let velocityX = state.velocityX + (
    craft.velocityX + (desiredX - state.x) * 2.15
      - state.velocityX
  ) * damping;
  let velocityZ = state.velocityZ + (
    craft.velocityZ + (desiredZ - state.z) * 2.15
      - state.velocityZ
  ) * damping;
  let x = state.x + velocityX * delta;
  let z = state.z + velocityZ * delta;
  let ropeX = x - craft.x;
  let ropeZ = z - craft.z;
  let ropeDistance = Math.hypot(ropeX, ropeZ);
  const maximumStretch = ropeLength + .8;
  if (ropeDistance > maximumStretch) {
    const normalX = ropeX / ropeDistance;
    const normalZ = ropeZ / ropeDistance;
    x = craft.x + normalX * maximumStretch;
    z = craft.z + normalZ * maximumStretch;
    const separatingSpeed = (
      velocityX - craft.velocityX
    ) * normalX + (
      velocityZ - craft.velocityZ
    ) * normalZ;
    if (separatingSpeed > 0) {
      velocityX -= normalX * separatingSpeed;
      velocityZ -= normalZ * separatingSpeed;
    }
    ropeX = x - craft.x;
    ropeZ = z - craft.z;
    ropeDistance = Math.hypot(ropeX, ropeZ);
  }
  return {
    x,
    z,
    velocityX,
    velocityZ,
    ropeDistance,
  };
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
  takeoffNormalSpeed: number;
  takeoffMatchSpeed: number;
  takeoffSpeedMatch: number;
  acceleration: number;
  lateralForce: number;
  paddleEffort: number;
  paddleStroke: number;
  paddleLeftWork: number;
  paddleRightWork: number;
  wavePressureDrive: number;
  wavePressureSideLoad: number;
  hullPatchContact: number;
  balance: number;
  balanceIntent: number;
  balanceTarget: number;
  waveEngaged: boolean;
  waveEngagement: number;
  wavePressure: number;
  proneTransition: number;
  lipLaunchSupport: number;
  boardAlignment: number;
  boardWaveAngle: number;
  crossWaveLoad: number;
  crossWaveSpeed: number;
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
  pumpRhythm: number;
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
  crestOvertake: number;
  crestAhead: number;
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
  rideChain: number;
  rideOutProgress: number;
  vehicleMode: boolean;
  vehicleGear: "P" | "D" | "R";
  vehicleThrottle: number;
  vehicleTraction: number;
  vehicleSlip: number;
  vehicleOffRoad: number;
  nearVan: boolean;
  towAvailable: boolean;
  towMode: boolean;
  towReturning: boolean;
  nearJetSki: boolean;
  towProgress: number;
  towReleaseQuality: number;
  towFaceQuality: number;
  towTargetDistance: number;
  towBreakingRatio: number;
  towHeadingAlignment: number;
  towSpeedMatch: number;
  towHullElevation: number;
  towHullTargetElevation: number;
  towHullVerticalVelocity: number;
  towHullPitch: number;
  towHullRoll: number;
  towHullDraft: number;
  towHullMinimumFreeboard: number;
  towBestRelease: boolean;
  inLineup: boolean;
  lineupOutsideMargin: number;
  lineupDirectionX: number;
  lineupDirectionZ: number;
  takeoffOpportunity: number;
  shorebreakIntensity: number;
  shorebreakPower: number;
  shorebreakSeconds: number;
  duckDiveReady: boolean;
  duckDiveActive: boolean;
  duckDiveQuality: number;
  duckDiveAlignment: number;
  duckDiveHeadingError: number;
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
  popUpMovementAuthority: number;
  popUpFootPlacementRisk: number;
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
  takeoffNormalSpeed: 0,
  takeoffMatchSpeed: 0,
  takeoffSpeedMatch: 0,
  acceleration: 0,
  lateralForce: 0,
  paddleEffort: 0,
  paddleStroke: 0,
  paddleLeftWork: 0,
  paddleRightWork: 0,
  wavePressureDrive: 0,
  wavePressureSideLoad: 0,
  hullPatchContact: 0,
  balance: 0,
  balanceIntent: 0,
  balanceTarget: 0,
  waveEngaged: false,
  waveEngagement: 0,
  wavePressure: 0,
  proneTransition: 0,
  lipLaunchSupport: 0,
  boardAlignment: 1,
  boardWaveAngle: 0,
  crossWaveLoad: 0,
  crossWaveSpeed: 0,
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
  pumpRhythm: 0,
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
  crestOvertake: 0,
  crestAhead: 0,
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
  rideChain: 0,
  rideOutProgress: 0,
  vehicleMode: false,
  vehicleGear: "P",
  vehicleThrottle: 0,
  vehicleTraction: 1,
  vehicleSlip: 0,
  vehicleOffRoad: 0,
  nearVan: false,
  towAvailable: false,
  towMode: false,
  towReturning: false,
  nearJetSki: false,
  towProgress: 0,
  towReleaseQuality: 0,
  towFaceQuality: 0,
  towTargetDistance: 0,
  towBreakingRatio: 0,
  towHeadingAlignment: 0,
  towSpeedMatch: 0,
  towHullElevation: 0,
  towHullTargetElevation: 0,
  towHullVerticalVelocity: 0,
  towHullPitch: 0,
  towHullRoll: 0,
  towHullDraft: 0,
  towHullMinimumFreeboard: 0,
  towBestRelease: false,
  inLineup: false,
  lineupOutsideMargin: 0,
  lineupDirectionX: 0,
  lineupDirectionZ: -1,
  takeoffOpportunity: 0,
  shorebreakIntensity: 0,
  shorebreakPower: 0,
  shorebreakSeconds: 0,
  duckDiveReady: false,
  duckDiveActive: false,
  duckDiveQuality: 0,
  duckDiveAlignment: 1,
  duckDiveHeadingError: 0,
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
  popUpMovementAuthority: 0,
  popUpFootPlacementRisk: 0,
  prompt: "Walk toward the water · or find the van",
};

/**
 * Advances training from demonstrated physical states rather than zones or
 * button presses. The same thresholds are used by the HUD and deterministic
 * verification so tutorial progress cannot drift away from the live solver.
 */
export function reachedSurfTrainingStep(
  stats: GameStats,
  paddleWorkTarget = .28,
) {
  const waterPhase = stats.phase === "wading"
    || stats.phase === "paddling"
    || stats.phase === "riding"
    || stats.phase === "wipeout";
  const paddleLessonComplete =
    stats.paddleLeftWork >= paddleWorkTarget
    && stats.paddleRightWork >= paddleWorkTarget;
  const hasRidden = stats.waveEngaged
    || stats.rideDistance > 0
    || stats.rideResult !== "";
  const supportedStand = (
    stats.phase === "riding"
      && stats.rideTakeoffQuality > .18
      && Math.max(
        stats.waveEngagement,
        stats.wavePressure,
        stats.hullPatchContact,
      ) > .12
  ) || hasRidden;
  const matchedLiveFace = (
    stats.takeoffSpeedMatch >= .66
      && stats.takeoffOpportunity >= .1
  ) || supportedStand;
  let reached = 0;
  if (waterPhase) reached = 1;
  if (paddleLessonComplete) reached = 2;
  if (paddleLessonComplete && (stats.inLineup || hasRidden)) {
    reached = 3;
  }
  if (
    reached >= 3
    && (stats.takeoffAlignment > .72 || supportedStand)
  ) {
    reached = 4;
  }
  if (reached >= 4 && matchedLiveFace) reached = 5;
  if (reached >= 5 && supportedStand) reached = 6;
  if (reached >= 6 && stats.pocketDistance >= 15) reached = 7;
  if (reached >= 7 && stats.maneuverCount > 0) reached = 8;
  if (reached >= 8 && stats.rideResult === "clean") reached = 9;
  return reached;
}

const DEFAULT_SPECTRAL_SETTINGS: SessionSettings = {
  mode: "training",
  assist: "guided",
  board: "performance",
  waveHeight: 1.8,
  wavePeriod: 10,
  waveDirection: 156,
  swellHeight: 1.45,
  swellPeriod: 10,
  swellDirection: 156,
  currentStrength: .35,
  currentDirection: 156,
  windSpeed: 10,
  windDirection: 156,
  waterTemperature: 20,
  airTemperature: 23,
  coastHeading: 156,
  tide: 0,
  timeOfDay: 16,
  weatherCode: 1,
};

function crestBank(
  settings = DEFAULT_SPECTRAL_SETTINGS,
  character?: BreakCharacter,
) {
  return coastWaveModelAt(0, settings, character).bank;
}

function crestEnergyAtOrdinal(
  bank: WaveComponentBank,
  crestOrdinal: number,
) {
  return spectralCrestAtOrdinal(bank, crestOrdinal).crestEnergy;
}

export function waveEnergyForPhase(
  phase: number,
  settings = DEFAULT_SPECTRAL_SETTINGS,
  character?: BreakCharacter,
) {
  const bank = crestBank(settings, character);
  const crestCoordinate = (phase - Math.PI * .5) / (Math.PI * 2);
  const lowerCrest = Math.floor(crestCoordinate);
  const blend = crestCoordinate - lowerCrest;
  const easedBlend = blend * blend * (3 - 2 * blend);
  const lowerEnergy = crestEnergyAtOrdinal(bank, lowerCrest);
  const upperEnergy = crestEnergyAtOrdinal(bank, lowerCrest + 1);
  return lowerEnergy + (upperEnergy - lowerEnergy) * easedBlend;
}

export function waveCrestPropertiesAtPhase(
  crestPhase: number,
  settings = DEFAULT_SPECTRAL_SETTINGS,
  character?: BreakCharacter,
) {
  const bank = crestBank(settings, character);
  const crest = dominantCrestPropertiesAtPhase(
    bank,
    crestPhase - Math.PI * .5,
  );
  const energy = crest.crestEnergy;
  return {
    energy,
    surfable: energy >= SURFABLE_CREST_ENERGY,
    crestId: crest.crestId,
  };
}

function waveReadStateForPhase(
  phase: number,
  wavePeriod: number,
  bank: WaveComponentBank,
  realizedCrestEnergy?: number,
) {
  const period = Math.max(4, wavePeriod);
  const angularSpeed = Math.PI * 2 / period;
  const crestCoordinate = (phase - Math.PI * .5) / (Math.PI * 2);
  const closestCrest = Math.round(crestCoordinate);
  const lowerCrest = Math.floor(crestCoordinate);
  const blend = crestCoordinate - lowerCrest;
  const easedBlend = blend * blend * (3 - 2 * blend);
  const lowerEnergy = crestEnergyAtOrdinal(bank, lowerCrest);
  const upperEnergy = crestEnergyAtOrdinal(bank, lowerCrest + 1);
  const modeledEnergy = lowerEnergy
    + (upperEnergy - lowerEnergy) * easedBlend;
  const currentCrestEnergy = Number.isFinite(realizedCrestEnergy)
    ? clampValue(realizedCrestEnergy ?? 0, 0, 1)
    : crestEnergyAtOrdinal(bank, closestCrest);
  const energy = Number.isFinite(realizedCrestEnergy)
    ? currentCrestEnergy
    : modeledEnergy;
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
  for (let offset = 0; offset <= 48; offset += 1) {
    const candidate = upcomingCrest - offset;
    const candidateEnergy = crestEnergyAtOrdinal(bank, candidate);
    if (candidateEnergy < SURFABLE_CREST_ENERGY) continue;
    const candidatePhase = Math.PI * .5 + candidate * Math.PI * 2;
    secondsToPeak = Math.max(0, phase - candidatePhase) / angularSpeed;
    nextSurfableEnergy = candidateEnergy;
    break;
  }
  return {
    energy,
    secondsToPeak: secondsToPeak < .45 ? 0 : secondsToPeak,
    cycle: 0,
    waveCount: 0,
    setWaveIndex: 0,
    setActive: crestSurfable && crestProximity > .08,
    crestEnergy: currentCrestEnergy,
    crestPhase,
    crestPhaseError,
    crestProximity,
    crestIndex: closestCrest,
    crestSequenceLength: 0,
    crestSurfable,
    nextSurfableEnergy,
  };
}

export function waveSetState(elapsed: number, wavePeriod: number) {
  const period = Math.max(4, wavePeriod);
  const settings = {
    ...DEFAULT_SPECTRAL_SETTINGS,
    wavePeriod: period,
    swellPeriod: period,
  };
  return waveReadStateForPhase(
    -elapsed * (Math.PI * 2 / period),
    period,
    crestBank(settings),
  );
}

export function waveSetStateAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  const surface = sampleCoastWaveSurface(
    x,
    z,
    elapsed,
    settings,
    character,
  );
  const phase = (surface.dominant?.phase ?? 0) + Math.PI * .5;
  return waveReadStateForPhase(
    phase,
    settings.wavePeriod,
    coastWaveModelAt(x, settings, character).bank,
    surface.dominant?.crestEnergy,
  );
}

export type VisibleWaveForecast = {
  secondsToPeak: number;
  crestEnergy: number;
};

const VISIBLE_WAVE_FORECAST_CACHE = new WeakMap<
  WaveComponentBank,
  Map<string, VisibleWaveForecast>
>();

/**
 * Forecasts the next crest from the same coherent dominant-partition signal
 * that the ocean and board sample now.
 *
 * The older HUD forecast advanced a single component's deterministic ordinal
 * pattern. Once rendering moved to the full partition, that could announce a
 * high-energy wave while destructive interference left the visible surface
 * calm. A bounded Newton search follows successive zero-phase crossings of
 * the realized group instead. Results are cached in half-second/spatial
 * buckets because the instruments do not need a frame-rate forecast.
 */
export function nextVisibleSurfableWaveAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
): VisibleWaveForecast {
  const bank = coastWaveModelAt(x, settings, character).bank;
  let bankCache = VISIBLE_WAVE_FORECAST_CACHE.get(bank);
  if (!bankCache) {
    bankCache = new Map();
    VISIBLE_WAVE_FORECAST_CACHE.set(bank, bankCache);
  }
  const cacheKey = [
    Math.round(x / 6),
    Math.round(z / 6),
    Math.floor(elapsed * 2),
    Math.round(settings.tide * 20),
  ].join(":");
  const cached = bankCache.get(cacheKey);
  if (cached) return cached;

  const initial = sampleCoastDominantWave(
    x,
    z,
    elapsed,
    settings,
    character,
  );
  if (!initial) {
    return {
      secondsToPeak: Number.POSITIVE_INFINITY,
      crestEnergy: 0,
    };
  }
  const tau = Math.PI * 2;
  const currentPhaseError = Math.atan2(
    Math.sin(initial.phase),
    Math.cos(initial.phase),
  );
  if (
    initial.crestEnergy >= SURFABLE_CREST_ENERGY
    && Math.abs(currentPhaseError) <= .12
  ) {
    return {
      secondsToPeak: 0,
      crestEnergy: initial.crestEnergy,
    };
  }

  const positivePhase = ((initial.phase % tau) + tau) % tau;
  let targetOrdinal = Math.floor(initial.phase / tau);
  let candidateTime = elapsed
    + positivePhase / Math.max(.1, initial.angularFrequency);
  let result: VisibleWaveForecast = {
    secondsToPeak: Number.POSITIVE_INFINITY,
    crestEnergy: initial.crestEnergy,
  };
  for (let offset = 0; offset < 48; offset += 1) {
    const targetPhase = targetOrdinal * tau;
    let candidate = sampleCoastDominantWave(
      x,
      z,
      candidateTime,
      settings,
      character,
    );
    for (
      let iteration = 0;
      candidate && iteration < 3;
      iteration += 1
    ) {
      candidateTime += (candidate.phase - targetPhase)
        / Math.max(.1, candidate.angularFrequency);
      candidate = sampleCoastDominantWave(
        x,
        z,
        candidateTime,
        settings,
        character,
      );
    }
    if (!candidate) break;
    if (candidate.crestEnergy >= SURFABLE_CREST_ENERGY) {
      result = {
        secondsToPeak: Math.max(0, candidateTime - elapsed),
        crestEnergy: candidate.crestEnergy,
      };
      break;
    }
    targetOrdinal -= 1;
    candidateTime += tau / Math.max(
      .1,
      candidate.propagationAngularFrequency,
    );
  }
  if (bankCache.size >= 512) bankCache.clear();
  bankCache.set(cacheKey, result);
  return result;
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
    assist: "guided",
    board: "performance",
    waveHeight: conditions.waveHeight,
    wavePeriod: conditions.wavePeriod,
    waveDirection: conditions.waveDirection,
    windWaveHeight: conditions.windWaveHeight,
    windWavePeriod: conditions.windWavePeriod,
    windWavePeakPeriod: conditions.windWavePeakPeriod,
    windWaveDirection: conditions.windWaveDirection,
    swellHeight: conditions.swellHeight,
    swellPeriod: conditions.swellPeriod,
    swellDirection: conditions.swellDirection,
    swellPeakPeriod: conditions.swellPeakPeriod,
    secondarySwellHeight: conditions.secondarySwellHeight,
    secondarySwellPeriod: conditions.secondarySwellPeriod,
    secondarySwellDirection: conditions.secondarySwellDirection,
    tertiarySwellHeight: conditions.tertiarySwellHeight,
    tertiarySwellPeriod: conditions.tertiarySwellPeriod,
    tertiarySwellDirection: conditions.tertiarySwellDirection,
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

function breakingGeometryWithTide(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character: BreakCharacter,
) {
  const surface = sampleCoastWaveSurface(
    x,
    z,
    elapsed,
    settings,
    character,
  );
  const breakingCoordinate = Math.log(
    Math.max(.018, surface.breakingRatio),
  ) * 20 - 12;
  const directionX = surface.dominant?.directionX ?? 0;
  const directionZ = surface.dominant?.directionZ ?? 1;
  return {
    breakingCoordinate,
    outsideDirectionX: -directionX,
    outsideDirectionZ: -directionZ,
    breakingRatio: surface.breakingRatio,
    regime: surface.regime,
  };
}

export type WaveBreakingGeometryReading = {
  breakingCoordinate: number;
  outsideDirectionX: number;
  outsideDirectionZ: number;
  breakingRatio?: number;
  regime?: "deep" | "shoaling" | "breaking" | "broken";
};

/**
 * Returns the animated cross-shore coordinate used to shoal and bend the
 * polygon waves plus its local outward normal. Gameplay can locate and point
 * through the real break contour instead of relying on a fixed world-space z.
 */
export function waveBreakingGeometryAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  const safeCharacter = character ?? DEFAULT_TIDE_BREAK;
  return breakingGeometryWithTide(
    x,
    z,
    elapsed,
    settings,
    safeCharacter,
  );
}

export function waveBreakingCoordinateAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  return waveBreakingGeometryAt(
    x,
    z,
    elapsed,
    settings,
    character,
  ).breakingCoordinate;
}

export type WaveBreakingContour = WaveBreakingGeometryReading & {
  z: number;
  targetRatio: number;
  ratioError: number;
};

/**
 * Finds the offshore-most physical depth-limited break contour. This solves in
 * world space against Hs/(gamma*d); the dimensionless coaching coordinate is
 * deliberately not treated as a distance.
 */
export function findWaveBreakingContourAt(
  x: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
  targetRatio = .9,
): WaveBreakingContour {
  const target = clampValue(targetRatio, .7, 1.6);
  const offshoreZ = -360;
  const shorewardZ = SHORELINE_REFERENCE_Z
    + shorelineShiftForTide(settings.tide)
    - 2;
  const samples = 120;
  let previousZ = offshoreZ;
  let previous = waveBreakingGeometryAt(
    x,
    previousZ,
    elapsed,
    settings,
    character,
  );
  let bestZ = previousZ;
  let best = previous;
  let bestError = Math.abs((previous.breakingRatio ?? 0) - target);
  for (let index = 1; index <= samples; index += 1) {
    const z = offshoreZ
      + (shorewardZ - offshoreZ) * index / samples;
    const reading = waveBreakingGeometryAt(
      x,
      z,
      elapsed,
      settings,
      character,
    );
    const ratio = reading.breakingRatio ?? 0;
    const error = Math.abs(ratio - target);
    if (error < bestError) {
      bestZ = z;
      best = reading;
      bestError = error;
    }
    const previousRatio = previous.breakingRatio ?? 0;
    if (previousRatio <= target && ratio >= target) {
      let lowZ = previousZ;
      let highZ = z;
      let low = previous;
      let high = reading;
      for (let iteration = 0; iteration < 14; iteration += 1) {
        const middleZ = (lowZ + highZ) * .5;
        const middle = waveBreakingGeometryAt(
          x,
          middleZ,
          elapsed,
          settings,
          character,
        );
        if ((middle.breakingRatio ?? 0) < target) {
          lowZ = middleZ;
          low = middle;
        } else {
          highZ = middleZ;
          high = middle;
        }
      }
      const lowError = Math.abs((low.breakingRatio ?? 0) - target);
      const highError = Math.abs((high.breakingRatio ?? 0) - target);
      const resolved = lowError <= highError
        ? { z: lowZ, reading: low, error: lowError }
        : { z: highZ, reading: high, error: highError };
      return {
        ...resolved.reading,
        z: resolved.z,
        targetRatio: target,
        ratioError: resolved.error,
      };
    }
    previousZ = z;
    previous = reading;
  }
  return {
    ...best,
    z: bestZ,
    targetRatio: target,
    ratioError: bestError,
  };
}

export type LineupGeometryReading = {
  outsideBreak: boolean;
  breakingCoordinate: number;
  boundary: number;
  outsideMargin: number;
};

/**
 * Tracks whether the surfer is beyond the polygon breaking band. Separate
 * enter/exit boundaries add physical hysteresis so a moving section does not
 * rapidly flip the tutorial target or disable shorebreak from frame to frame.
 */
export function resolveLineupFromBreakingGeometry(
  breakingCoordinate: number,
  wasOutsideBreak: boolean,
): LineupGeometryReading {
  const boundary = -18;
  const threshold = wasOutsideBreak ? -15.5 : -20;
  const outsideBreak = breakingCoordinate < threshold;
  return {
    outsideBreak,
    breakingCoordinate,
    boundary,
    outsideMargin: boundary - breakingCoordinate,
  };
}

export type ShorebreakBandSample = {
  breakingCoordinate: number;
  crestEnergy: number;
  waveHeight: number;
  tidePower: number;
  shorebreakScale: number;
};

export type ShorebreakBandReading = {
  bandOccupancy: number;
  power: number;
};

/**
 * Larger members of a swell set feel bottom sooner and begin standing up
 * farther offshore. The offset feeds both surface shoaling and breaking-water
 * load, so the outside set line is geometry rather than a scripted zone.
 */
export function waveBreakOffsetForEnergy(
  crestEnergy: number,
  waveHeight: number,
) {
  return smoothstep(.38, .9, clampValue(crestEnergy, 0, 1))
    * (2.2 + Math.min(3.8, Math.max(0, waveHeight) * 1.15));
}

export function maximumSetBreakOffset(waveHeight: number) {
  return waveBreakOffsetForEnergy(1, waveHeight);
}

export type ProneShorebreakState = {
  velocityX: number;
  velocityZ: number;
};

export type ProneShorebreakSample = {
  deltaSeconds: number;
  intensity: number;
  power: number;
  waveNormalX: number;
  waveNormalZ: number;
  currentVelocityX: number;
  currentVelocityZ: number;
  submersion: number;
  diveQuality: number;
  exposureScale?: number;
};

export type ProneShorebreakReading =
  ProneShorebreakState & {
    accelerationX: number;
    accelerationZ: number;
    exposure: number;
    impactLoad: number;
    staminaCost: number;
  };

/**
 * Resolves breaking-water power continuously from the animated polygon band.
 * The tutorial's lineup state is intentionally absent: crossing a coaching
 * boundary cannot switch a physical wall on or off.
 */
export function resolveShorebreakBandLoad(
  sample: ShorebreakBandSample,
): ShorebreakBandReading {
  const effectiveBreakingCoordinate = sample.breakingCoordinate
    + waveBreakOffsetForEnergy(
      sample.crestEnergy,
      sample.waveHeight,
    );
  const bandOccupancy = smoothstep(
    -18,
    -8,
    effectiveBreakingCoordinate,
  ) * (
    1 - smoothstep(
      -7,
      .5,
      effectiveBreakingCoordinate,
    )
  );
  const power = clampValue(
    bandOccupancy
      * (.34 + clampValue(sample.crestEnergy, 0, 1) * .66)
      * (
        .52
          + Math.max(0, sample.waveHeight) * .22
      )
      * (
        .86
          + Math.max(0, sample.tidePower) * .14
      )
      * Math.max(0, sample.shorebreakScale),
    0,
    1,
  );
  return { bandOccupancy, power };
}

/**
 * Couples a prone surfer-board system to moving whitewater with continuous
 * drag. A deep, well-timed dive reduces projected area; it never changes the
 * solver branch or receives a one-frame velocity bonus.
 */
export function advanceProneShorebreakResponse(
  state: ProneShorebreakState,
  sample: ProneShorebreakSample,
): ProneShorebreakReading {
  const delta = clampValue(sample.deltaSeconds, 0, .05);
  const intensity = clampValue(sample.intensity, 0, 1.4);
  const power = clampValue(sample.power, 0, 1);
  const submersion = clampValue(sample.submersion, 0, 1);
  const diveQuality = clampValue(sample.diveQuality, 0, 1);
  const normalMagnitude = Math.hypot(
    sample.waveNormalX,
    sample.waveNormalZ,
  );
  const waveNormalX = normalMagnitude > .001
    ? sample.waveNormalX / normalMagnitude
    : 0;
  const waveNormalZ = normalMagnitude > .001
    ? sample.waveNormalZ / normalMagnitude
    : 1;
  const protectedSubmersion = submersion
    * (.35 + diveQuality * .65);
  const exposureScale = clampValue(
    sample.exposureScale ?? 1,
    .55,
    1,
  );
  const exposure = clampValue(
    (1 - protectedSubmersion) * exposureScale,
    .06,
    1,
  );
  const transportSpeed = .65 + power * 2.15;
  const waterVelocityX = sample.currentVelocityX
    + waveNormalX * transportSpeed;
  const waterVelocityZ = sample.currentVelocityZ
    + waveNormalZ * transportSpeed;
  const couplingRate = intensity
    * exposure
    * (1.4 + power * 2.4);
  let accelerationX = (
    waterVelocityX - state.velocityX
  ) * couplingRate;
  let accelerationZ = (
    waterVelocityZ - state.velocityZ
  ) * couplingRate;
  const accelerationMagnitude = Math.hypot(
    accelerationX,
    accelerationZ,
  );
  const accelerationLimit = 8.5
    * Math.min(1, intensity + .08);
  if (
    accelerationMagnitude > accelerationLimit
    && accelerationMagnitude > .001
  ) {
    const scale = accelerationLimit / accelerationMagnitude;
    accelerationX *= scale;
    accelerationZ *= scale;
  }
  const velocityX = state.velocityX
    + accelerationX * delta;
  const velocityZ = state.velocityZ
    + accelerationZ * delta;
  const impactLoad = clampValue(
    intensity * exposure,
    0,
    1,
  );
  const staminaCost = intensity
    * exposure
    * (2.2 + power * 4.6)
    * delta;
  return {
    velocityX,
    velocityZ,
    accelerationX,
    accelerationZ,
    exposure,
    impactLoad,
    staminaCost,
  };
}

export function waveHeightAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  return sampleCoastWaveSurface(
    x,
    z,
    elapsed,
    settings,
    character,
    false,
  ).height;
}

export function waveSurfaceFrameAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  const surface = sampleCoastWaveSurface(
    x,
    z,
    elapsed,
    settings,
    character,
  );
  return {
    height: surface.height,
    slopeX: surface.gradientX,
    slopeZ: surface.gradientZ,
    normalX: surface.normalX,
    normalY: surface.normalY,
    normalZ: surface.normalZ,
    surfaceRise: surface.timeDerivative,
    waterVelocityX: surface.horizontalVelocityX,
    waterVelocityZ: surface.horizontalVelocityZ,
    verticalVelocity: surface.verticalVelocity,
    depth: surface.depth,
    breakingRatio: surface.breakingRatio,
    breakingProgress: surface.breakingProgress,
    brokenProgress: surface.brokenProgress,
    whitewater: surface.whitewater,
    breakerVelocityX: surface.breakerVelocityX,
    breakerVelocityZ: surface.breakerVelocityZ,
    regime: surface.regime,
    dominant: surface.dominant,
  };
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}

export type BoardTakeoffOpportunitySample = {
  waveOpportunity: number;
  waterContact: number;
  capsizeRisk: number;
  pitchOverRisk: number;
};

/**
 * Carries the wave solver's continuous opportunity through the board's actual
 * water support and attitude stability. It deliberately returns a continuum:
 * no action window opens, lingers, or improves the underlying takeoff.
 */
export function resolveBoardTakeoffOpportunity(
  sample: BoardTakeoffOpportunitySample,
) {
  const waveOpportunity = clampValue(
    sample.waveOpportunity,
    0,
    1,
  );
  const waterSupport = clampValue(
    sample.waterContact,
    0,
    1,
  );
  const stability = 1 - clampValue(
    Math.max(sample.capsizeRisk, sample.pitchOverRisk),
    0,
    1,
  );
  return waveOpportunity * waterSupport * stability;
}

export type TakeoffPaddleDriveSample = {
  normalSpeed: number;
  matchTargetSpeed: number;
  strokeForce: number;
  attitudeQuality: number;
  waterContact: number;
};

export function resolveTakeoffSpeedMatch(
  normalSpeed: number,
  matchTargetSpeed: number,
) {
  return smoothstep(
    .48,
    Math.max(.49, matchTargetSpeed),
    normalSpeed,
  );
}

/**
 * Measures the propulsive state carried into a takeoff. Most credit comes from
 * board speed already earned through the water; only the currently resolved
 * hand force adds stroke credit. Holding an input during arm recovery cannot
 * improve this reading.
 */
export function resolveTakeoffPaddleDrive(
  sample: TakeoffPaddleDriveSample,
) {
  const speedMatch = resolveTakeoffSpeedMatch(
    sample.normalSpeed,
    sample.matchTargetSpeed,
  );
  const resolvedPull = clampValue(
    Math.max(0, sample.strokeForce) / 6.9,
    0,
    1,
  );
  return clampValue(
    speedMatch * .82 + resolvedPull * .18,
    0,
    1,
  ) * (
    .72 + clampValue(sample.attitudeQuality, 0, 1) * .28
  ) * (
    .38 + clampValue(sample.waterContact, 0, 1) * .62
  );
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
    ? Math.min(1, faceEnvelope
      * (.2 + physicalLift * .8)
      * breakSupport
      * (.7 + headingQuality * .3)
      * (.72 + paddleQuality * .28)
      * 1.08)
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
  return {
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

/**
 * Resolves the body-to-board handoff at the end of a pop-up.
 *
 * The strict capture path remains fully physical. A second, narrow grace path
 * accepts a visibly rising surfable face when the animation finishes a few
 * frames after the peak contact sample. It prevents a valid SPACE press from
 * being discarded because the crest moved during the body animation, while
 * still rejecting flat water, a lost crest, or a tumbling hull.
 */
export function resolvePopUpLandingSupport(
  sample: PopUpLandingSupportSample,
) {
  const waterContact = clampValue(sample.waterContact, 0, 1);
  const rollRisk = clampValue(sample.rollCapsizeRisk, 0, 1);
  const pitchRisk = clampValue(sample.pitchOverRisk, 0, 1);
  const overtaken = clampValue(sample.crestOvertaken, 0, 1.4);
  if (
    sample.lostCrest
    || sample.interactionOutcome === "tumble"
    || waterContact <= .16
    || rollRisk >= .9
    || pitchRisk >= .91
    || overtaken >= .9
  ) {
    return 0;
  }
  if (
    sample.boardStillEngaged
    && waterContact > .24
    && rollRisk < .84
    && pitchRisk < .86
    && overtaken < .76
  ) {
    return 1;
  }
  const readableFace = sample.surfableFace
    && sample.faceEnvelope > .035
    && sample.physicalLift > .06
    && sample.waveContact > .025;
  return readableFace ? .48 : 0;
}

/**
 * Deep-water gravity-wave dispersion: L = gT² / 2π. Keeping this relation
 * intact makes long-period groundswell travel faster and farther apart than
 * short-period wind swell before the shared shoaling compression is applied.
 */
export function deepWaterWavelengthForPeriod(period: number) {
  const safePeriod = clampValue(period, 4, 24);
  return 9.81 * safePeriod * safePeriod / (Math.PI * 2);
}

export function primaryWavePhaseAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  const dominant = sampleCoastDominantWave(
    x,
    z,
    elapsed,
    settings,
    character,
  );
  // Public gameplay phases historically place a crest at π/2. The spectral
  // core uses cosine with a crest at zero, so preserve the gameplay contract
  // without changing the underlying phase or its derivatives.
  return (dominant?.phase ?? 0) + Math.PI * .5;
}

export function primaryWaveVelocityAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  const surface = sampleCoastWaveSurface(
    x,
    z,
    elapsed,
    settings,
    character,
  );
  const dominant = surface.dominant;
  const phaseSpeed = dominant?.celerity ?? 0;
  return {
    x: dominant?.celerityX ?? 0,
    z: dominant?.celerityZ ?? 0,
    propagationX: dominant?.celerityX ?? 0,
    propagationZ: dominant?.celerityZ ?? 0,
    speed: phaseSpeed,
    wavelength: dominant?.wavelength
      ?? deepWaterWavelengthForPeriod(settings.wavePeriod),
    waterX: surface.horizontalVelocityX,
    waterZ: surface.horizontalVelocityZ,
    breakerX: surface.breakerVelocityX,
    breakerZ: surface.breakerVelocityZ,
    verticalVelocity: surface.verticalVelocity,
    breakingRatio: surface.breakingRatio,
    breakingProgress: surface.breakingProgress,
    brokenProgress: surface.brokenProgress,
    whitewater: surface.whitewater,
    regime: surface.regime,
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
