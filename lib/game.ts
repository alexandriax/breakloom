import type { MarineConditions } from "./marine";
import type { BreakCharacter } from "./beaches";

export type GameMode = "training" | "advanced" | "playground";
export type GamePhase = "shore" | "driving" | "wading" | "paddling" | "riding" | "wipeout";
export type SessionGrade = "C" | "B" | "A" | "S";
export type BoardType = "performance" | "fish" | "longboard";
export const SHORELINE_REFERENCE_Z = 8;
export const OUTER_PADDLE_LIMIT_Z = -900;
export const MAX_OFFSHORE_DISTANCE = SHORELINE_REFERENCE_Z - OUTER_PADDLE_LIMIT_Z;

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
  currentStrength: number;
  currentDirection: number;
  windSpeed: number;
  windDirection: number;
  coastHeading: number;
  tide: number;
  timeOfDay: number;
  weatherCode: number;
};

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
  speed: number;
  paddleEffort: number;
  balance: number;
  balanceTarget: number;
  waveQuality: number;
  linePosition: number;
  lineControl: number;
  lineSide: number;
  sectionPressure: number;
  railLoad: number;
  railGrip: number;
  stance: number;
  barrelTime: number;
  barrelIntensity: number;
  stamina: number;
  setEnergy: number;
  nextSetSeconds: number;
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
  leashTension: number;
  shorebreakId: number;
  shorebreakResult: "" | "clean" | "hit";
  takeoffAlignment: number;
  takeoffQuality: number;
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
  speed: 0,
  paddleEffort: 0,
  balance: 0,
  balanceTarget: 0,
  waveQuality: 0,
  linePosition: 0,
  lineControl: 1,
  lineSide: 1,
  sectionPressure: 0,
  railLoad: 0,
  railGrip: 1,
  stance: 0,
  barrelTime: 0,
  barrelIntensity: 0,
  stamina: 100,
  setEnergy: 0,
  nextSetSeconds: 0,
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
  leashTension: 0,
  shorebreakId: 0,
  shorebreakResult: "",
  takeoffAlignment: 0,
  takeoffQuality: 0,
  prompt: "Walk toward the water · or find the van",
};

export function waveSetState(elapsed: number, wavePeriod: number) {
  const cycle = Math.max(18, wavePeriod * 3.1);
  const phase = ((elapsed % cycle) + cycle) % cycle;
  const peakAt = cycle * 0.38;
  const angularDistance = ((phase - peakAt) / cycle) * Math.PI * 2;
  const pulse = Math.pow(Math.max(0, Math.cos(angularDistance) * 0.5 + 0.5), 3.2);
  const energy = Math.min(1, 0.12 + pulse * 0.88);
  const secondsToPeak = (peakAt - phase + cycle) % cycle;
  return {
    energy,
    secondsToPeak: secondsToPeak < 0.75 ? 0 : secondsToPeak,
    cycle,
  };
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
    currentStrength: conditions.currentVelocity,
    currentDirection: conditions.currentDirection,
    windSpeed: conditions.windSpeed,
    windDirection: conditions.windDirection,
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
  const power = character?.power ?? 1;
  const steepness = character?.steepness ?? .7;
  const peel = character?.peel ?? 0;
  const variability = character?.variability ?? .4;
  const amplitude = Math.max(0.12, settings.waveHeight * 0.62) * power;
  const period = Math.max(4, settings.wavePeriod);
  const speed = (Math.PI * 2) / period;
  const setEnergy = waveSetState(elapsed, period).energy;
  const setLift = 0.78 + setEnergy * 0.34;
  const coastalZ = z - shorelineShiftForTide(settings.tide);
  const section = Math.sin(x * .07 + elapsed * .05) * variability * 2.3;
  const breakZ = coastalZ + x * peel * .16 + section;
  const shoreBoost = 0.72 + Math.max(0, Math.min(1, (breakZ + 90) / 98)) * (.58 + steepness * .24);
  const p1 = primaryWavePhaseAt(x, z, elapsed, settings, character);
  const relativeWaveAngle = ((settings.waveDirection - settings.coastHeading) * Math.PI) / 180;
  const waveAlong = x * Math.sin(relativeWaveAngle) + coastalZ * Math.max(.35, Math.cos(relativeWaveAngle));
  const waveCross = x * Math.cos(relativeWaveAngle) - coastalZ * Math.sin(relativeWaveAngle);
  const p2 = waveAlong * 0.31 - waveCross * 0.05 - elapsed * speed * 7.1 + 1.7;
  const p3 = waveAlong * 0.09 + waveCross * 0.13 - elapsed * speed * 2.7;
  return (
    settings.tide * 0.3 +
    amplitude * setLift * shoreBoost * Math.sin(p1) * 0.64 +
    amplitude * Math.sin(p2) * 0.22 +
    amplitude * Math.sin(p3) * 0.11
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
  const steepness = character?.steepness ?? .7;
  const peel = character?.peel ?? 0;
  const variability = character?.variability ?? .4;
  const waveAngle = ((settings.waveDirection - settings.coastHeading) * Math.PI) / 180;
  const currentAngle = ((settings.currentDirection - settings.coastHeading) * Math.PI) / 180;
  const coastalZ = z - shorelineShiftForTide(settings.tide);
  const section = Math.sin(x * .07 + elapsed * .05) * variability * 2.3;
  const breakZ = coastalZ + x * peel * .16 + section;
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
  const steepness = character?.steepness ?? .7;
  const peel = character?.peel ?? 0;
  const variability = character?.variability ?? .4;
  const waveAngle = ((settings.waveDirection - settings.coastHeading) * Math.PI) / 180;
  const currentAngle = ((settings.currentDirection - settings.coastHeading) * Math.PI) / 180;
  const coastalZ = z - shorelineShiftForTide(settings.tide);
  const section = Math.sin(x * .07 + elapsed * .05) * variability * 2.3;
  const breakZ = coastalZ + x * peel * .16 + section;
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
