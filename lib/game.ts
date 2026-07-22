import type { MarineConditions } from "./marine";

export type GameMode = "training" | "advanced" | "playground";
export type GamePhase = "shore" | "wading" | "paddling" | "riding" | "wipeout";

export type SessionSettings = {
  mode: GameMode;
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
  prompt: "Walk toward the water",
};

export function settingsFromConditions(conditions: MarineConditions): SessionSettings {
  const localHour = Number(conditions.observedAt.slice(11, 13));
  return {
    mode: "training",
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
  const shoreBoost = 0.72 + Math.max(0, Math.min(1, (z + 90) / 98)) * 0.75;
  const currentCurve = Math.sin((settings.currentDirection * Math.PI) / 180) * 0.0022;
  const p1 = z * 0.19 + x * 0.018 + x * x * currentCurve + elapsed * speed * 5.4;
  const p2 = z * 0.31 - x * 0.05 + elapsed * speed * 7.1 + 1.7;
  const p3 = z * 0.09 + x * 0.13 - elapsed * speed * 2.7;
  return (
    settings.tide * 0.3 +
    amplitude * shoreBoost * Math.sin(p1) * 0.64 +
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

