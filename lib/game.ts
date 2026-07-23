import type { MarineConditions } from "./marine";
import type { BreakCharacter } from "./beaches";

export type GameMode = "training" | "advanced" | "playground";
export type GamePhase = "shore" | "driving" | "wading" | "paddling" | "riding" | "wipeout";
export type SessionGrade = "C" | "B" | "A" | "S";
export type BoardType = "performance" | "fish" | "longboard";
export const SHORELINE_REFERENCE_Z = 8;
export const OUTER_PADDLE_LIMIT_Z = -900;
export const MAX_OFFSHORE_DISTANCE = SHORELINE_REFERENCE_Z - OUTER_PADDLE_LIMIT_Z;
const WAVE_GROUP_ENERGY = [.1, .12, .16, .24, .72, 1, .86, .36, .17] as const;
const SET_WAVE_START = 4;
const SET_WAVE_COUNT = 3;

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
  speed: number;
  acceleration: number;
  lateralForce: number;
  paddleEffort: number;
  balance: number;
  balanceTarget: number;
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
  maneuver: string;
  maneuverScore: number;
  maneuverQuality: number;
  maneuverId: number;
  maneuverCount: number;
  maneuverActive: boolean;
  maneuverProgress: number;
  maneuverPhase: "line" | "load" | "release" | "air" | "land";
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
  speed: 0,
  acceleration: 0,
  lateralForce: 0,
  paddleEffort: 0,
  balance: 0,
  balanceTarget: 0,
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
  setWaveCount: 3,
  setActive: false,
  maneuver: "",
  maneuverScore: 0,
  maneuverQuality: 0,
  maneuverId: 0,
  maneuverCount: 0,
  maneuverActive: false,
  maneuverProgress: 0,
  maneuverPhase: "line",
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
  prompt: "Walk toward the water · or find the van",
};

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function waveGroupOrdinal(crestIndex: number) {
  // A fixed observer sees crest indices decrease as the train travels shoreward.
  // Negating the index makes the group order read lull → build → 1/2/3 → tail.
  return positiveModulo(-crestIndex, WAVE_GROUP_ENERGY.length);
}

function crestEnergy(crestIndex: number) {
  return WAVE_GROUP_ENERGY[waveGroupOrdinal(crestIndex)];
}

export function waveEnergyForPhase(phase: number) {
  const crestCoordinate = (phase - Math.PI * .5) / (Math.PI * 2);
  const lowerCrest = Math.floor(crestCoordinate);
  const blend = crestCoordinate - lowerCrest;
  const easedBlend = blend * blend * (3 - 2 * blend);
  const lowerEnergy = crestEnergy(lowerCrest);
  return lowerEnergy + (crestEnergy(lowerCrest + 1) - lowerEnergy) * easedBlend;
}

function waveSetStateForPhase(phase: number, wavePeriod: number) {
  const period = Math.max(4, wavePeriod);
  const angularSpeed = Math.PI * 2 / period;
  const crestCoordinate = (phase - Math.PI * .5) / (Math.PI * 2);
  const closestCrest = Math.round(crestCoordinate);
  const closestOrdinal = waveGroupOrdinal(closestCrest);
  const energy = waveEnergyForPhase(phase);
  const setWaveIndex = closestOrdinal >= SET_WAVE_START
    && closestOrdinal < SET_WAVE_START + SET_WAVE_COUNT
    ? closestOrdinal - SET_WAVE_START + 1
    : 0;
  const setActive = setWaveIndex > 0 && energy >= .38;
  const upcomingCrest = Math.floor(crestCoordinate + .000001);
  const phaseToUpcoming = Math.max(
    0,
    phase - (Math.PI * .5 + upcomingCrest * Math.PI * 2),
  );
  let secondsToPeak = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset <= WAVE_GROUP_ENERGY.length; offset += 1) {
    const candidate = upcomingCrest - offset;
    const ordinal = waveGroupOrdinal(candidate);
    if (ordinal < SET_WAVE_START || ordinal >= SET_WAVE_START + SET_WAVE_COUNT) continue;
    secondsToPeak = (phaseToUpcoming + offset * Math.PI * 2) / angularSpeed;
    break;
  }
  return {
    energy,
    secondsToPeak: secondsToPeak < .72 ? 0 : secondsToPeak,
    cycle: period * WAVE_GROUP_ENERGY.length,
    waveCount: SET_WAVE_COUNT,
    setWaveIndex,
    setActive,
  };
}

export function waveSetState(elapsed: number, wavePeriod: number) {
  const period = Math.max(4, wavePeriod);
  return waveSetStateForPhase(-elapsed * (Math.PI * 2 / period), period);
}

export function waveSetStateAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character?: BreakCharacter,
) {
  return waveSetStateForPhase(
    primaryWavePhaseAt(x, z, elapsed, settings, character),
    settings.wavePeriod,
  );
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
  const amplitude = Math.max(0.12, settings.waveHeight * 0.62) * power * tideResponse.faceScale;
  const period = Math.max(4, settings.wavePeriod);
  const speed = (Math.PI * 2) / period;
  const coastalZ = z - shorelineShiftForTide(settings.tide);
  const section = Math.sin(x * .07 + elapsed * .05) * variability * 2.3;
  const breakZ = coastalZ + x * peel * .16 + section - tideResponse.breakShift;
  const shoreBoost = .72 + smoothstep(-85, 8, breakZ) * (.58 + steepness * .24);
  const p1 = primaryWavePhaseAt(x, z, elapsed, settings, character);
  const setEnergy = waveEnergyForPhase(p1);
  const setLift = 0.78 + setEnergy * 0.34;
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
  const swellAmplitude = Math.max(
    0,
    Math.min(settings.swellHeight, settings.waveHeight * 1.35) * .16,
  );

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
  return (
    settings.tide * 0.3 +
    amplitude * setLift * shoreBoost * Math.sin(p1) * 0.64 +
    swellAmplitude * swellShoaling * Math.sin(swellPhase) +
    amplitude * Math.sin(crossPhase) * 0.11 +
    (.035 + windChop * .065) * Math.sin(windPhase)
  );
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
  const shoaling = smoothstep(-32, 9, breakZ);
  const shallowScale = .82 + (.69 - .82) * steepness;
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
  const shoaling = smoothstep(-32, 9, breakZ);
  const shallowScale = .82 + (.69 - .82) * steepness;
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
