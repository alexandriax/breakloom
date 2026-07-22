import type { MarineConditions } from "./marine";

export type GameMode = "training" | "advanced" | "playground";
export type GamePhase = "shore" | "driving" | "wading" | "paddling" | "riding" | "wipeout";
export type SessionGrade = "C" | "B" | "A" | "S";
export type BoardType = "performance" | "fish" | "longboard";

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
  currentStrength: number;
  currentDirection: number;
  tide: number;
  timeOfDay: number;
};

export type GameStats = {
  phase: GamePhase;
  score: number;
  combo: number;
  rideDistance: number;
  speed: number;
  balance: number;
  balanceTarget: number;
  waveQuality: number;
  stance: number;
  barrelTime: number;
  barrelIntensity: number;
  stamina: number;
  setEnergy: number;
  nextSetSeconds: number;
  maneuver: string;
  maneuverScore: number;
  maneuverId: number;
  maneuverCount: number;
  maxCombo: number;
  grade: SessionGrade;
  rideScore: number;
  rideManeuvers: number;
  rideGrade: SessionGrade;
  rideResult: "" | "clean" | "wipeout";
  rideResultId: number;
  vehicleMode: boolean;
  nearVan: boolean;
  catchReady: boolean;
  prompt: string;
};

export const INITIAL_STATS: GameStats = {
  phase: "shore",
  score: 0,
  combo: 1,
  rideDistance: 0,
  speed: 0,
  balance: 0,
  balanceTarget: 0,
  waveQuality: 0,
  stance: 0,
  barrelTime: 0,
  barrelIntensity: 0,
  stamina: 100,
  setEnergy: 0,
  nextSetSeconds: 0,
  maneuver: "",
  maneuverScore: 0,
  maneuverId: 0,
  maneuverCount: 0,
  maxCombo: 1,
  grade: "C",
  rideScore: 0,
  rideManeuvers: 0,
  rideGrade: "C",
  rideResult: "",
  rideResultId: 0,
  vehicleMode: false,
  nearVan: false,
  catchReady: false,
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

export function settingsFromConditions(conditions: MarineConditions): SessionSettings {
  const localHour = Number(conditions.observedAt.slice(11, 13));
  return {
    mode: "training",
    board: "performance",
    waveHeight: conditions.waveHeight,
    wavePeriod: conditions.wavePeriod,
    currentStrength: conditions.currentVelocity,
    currentDirection: conditions.currentDirection,
    tide: conditions.seaLevel,
    timeOfDay: Number.isFinite(localHour) ? localHour + 0.5 : 16,
  };
}

export function waveHeightAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
) {
  const amplitude = Math.max(0.12, settings.waveHeight * 0.62);
  const period = Math.max(4, settings.wavePeriod);
  const speed = (Math.PI * 2) / period;
  const setEnergy = waveSetState(elapsed, period).energy;
  const setLift = 0.78 + setEnergy * 0.34;
  const shoreBoost = 0.72 + Math.max(0, Math.min(1, (z + 90) / 98)) * 0.75;
  const currentCurve = Math.sin((settings.currentDirection * Math.PI) / 180) * 0.0022;
  const p1 = z * 0.19 + x * 0.018 + x * x * currentCurve + elapsed * speed * 5.4;
  const p2 = z * 0.31 - x * 0.05 + elapsed * speed * 7.1 + 1.7;
  const p3 = z * 0.09 + x * 0.13 - elapsed * speed * 2.7;
  return (
    settings.tide * 0.3 +
    amplitude * setLift * shoreBoost * Math.sin(p1) * 0.64 +
    amplitude * Math.sin(p2) * 0.22 +
    amplitude * Math.sin(p3) * 0.11
  );
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
