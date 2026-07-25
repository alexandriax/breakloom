"use client";

import dynamic from "next/dynamic";
import {
  Aperture,
  ArrowRight,
  AudioLines,
  BatteryMedium,
  Camera,
  CarFront,
  ChevronDown,
  CircleCheck,
  Clapperboard,
  CloudSun,
  Crosshair,
  Download,
  Gauge,
  Gamepad2,
  Grid3X3,
  LoaderCircle,
  MapPin,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Share2,
  Smartphone,
  Sparkles,
  SunMedium,
  Target,
  Thermometer,
  Timer,
  Trophy,
  Volume2,
  VolumeX,
  Waves,
  Wind,
  X,
} from "lucide-react";
import { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BEACHES, DEFAULT_BEACH, getBreakCharacter, getCoastBiome, type Beach } from "@/lib/beaches";
import {
  fallbackConditions,
  fetchMarineConditions,
  type MarineConditions,
  type MarineForecastPoint,
} from "@/lib/marine";
import {
  BOARD_SPECS,
  compassDirection,
  formatClock,
  INITIAL_STATS,
  MAX_OFFSHORE_DISTANCE,
  readCrestTimingMechanics,
  readPaddleTrainingMechanics,
  readSurfTrainingForces,
  resolvePaddleHeadingTarget,
  settingsFromConditions,
  thermalKitForConditions,
  tideResponseForBreak,
  type BoardType,
  type GameMode,
  type GameStats,
  type SessionSettings,
} from "@/lib/game";
import { SurfscapeAudio } from "@/lib/audio";
import type { CameraMode, ControlState, ReplayMoment, ReplayState, ReplayTelemetry, RideCaptureRequest, RideFrameCapture } from "./SurfScene";
import TideSparkline from "./TideSparkline";

const SurfScene = dynamic(() => import("./SurfScene"), { ssr: false });
const WorldMap = dynamic(() => import("./WorldMap"), {
  ssr: false,
  loading: () => <div className="map-loading"><LoaderCircle className="spin" /> Loading shoreline…</div>,
});

type Screen = "launch" | "game";
type SessionFormat = "free" | "heat";
type LaunchPanel = "break" | "forecast" | "tour";
type HudPanel = "ocean" | "session" | "controls";
type MotionBalanceStatus = "checking" | "unavailable" | "idle" | "requesting" | "active" | "denied";
type PersonalBest = { score: number; distance: number; combo: number };
type CoastPassportRecord = {
  rides: number;
  cleanRides: number;
  bestScore: number;
  longestLine: number;
  longestPocket: number;
  mostManeuvers: number;
  longestBarrel: number;
  bestGrade: GameStats["grade"];
  mastery: number;
  bestHeat: number;
  heatWins: number;
  lastZone: string;
  lastSurfedAt: number;
};
type SurfPassport = Record<string, CoastPassportRecord>;
type RideToast = {
  id: number;
  result: "clean" | "wipeout";
  score: number;
  distance: number;
  pocketDistance: number;
  maneuvers: number;
  barrelTime: number;
  takeoffQuality: number;
  lineQuality: number;
  controlQuality: number;
  powerQuality: number;
  maxSpeed: number;
  maxCombo: number;
  grade: GameStats["grade"];
};
type HeatWave = RideToast & { judgeScore: number };
const EMPTY_REPLAY_TELEMETRY: ReplayTelemetry = {
  speed: 0,
  facePosition: 0,
  lineControl: 0,
  linePosition: 0,
  railGrip: 1,
  railLoad: 0,
  rollAngle: 0,
  pitchAngle: 0,
  airborneHeight: 0,
  verticalVelocity: 0,
  whitewater: 0,
  stance: 0,
  power: 0,
  barrel: 0,
  maneuver: 0,
};
type RideAnalysisKey = "entry" | "line" | "control" | "power" | "variety";
type RideAnalysisCategory = {
  key: RideAnalysisKey;
  label: string;
  value: number;
};
type RideAnalysis = {
  categories: RideAnalysisCategory[];
  strongest: RideAnalysisKey;
  focus: RideAnalysisKey;
  headline: string;
  detail: string;
};
type PassportAward = { level: number; label: string };
type WetLensEvent = {
  id: number;
  intensity: number;
  duration: number;
};
type HudEventToast = {
  key: string;
  kind: "shorebreak" | "takeoff" | "maneuver";
  tone: "clean" | "warning" | "accent";
  eyebrow: string;
  title: string;
  value: string;
};
type ShareStatus = "idle" | "working" | "shared" | "copied" | "error";
type PhotoStatus = "idle" | "capturing" | "ready" | "shared" | "saved" | "error";
type PhotoGuide = "thirds" | "center" | "clean";
type WakeLockSentinelLike = { released: boolean; release: () => Promise<void> };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
type HapticActuator = {
  playEffect?: (type: "dual-rumble", parameters: {
    duration: number;
    startDelay: number;
    strongMagnitude: number;
    weakMagnitude: number;
  }) => Promise<unknown>;
  pulse?: (value: number, duration: number) => Promise<unknown>;
};
type HapticGamepad = Gamepad & {
  vibrationActuator?: HapticActuator;
  hapticActuators?: HapticActuator[];
};
type DeviceOrientationPermissionApi = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const BOARD_OPTIONS = Object.keys(BOARD_SPECS) as BoardType[];
const INITIAL_MODELED_CONDITIONS = fallbackConditions(DEFAULT_BEACH, "2025-01-15T12:00:00.000Z");

const RECORD_KEY = "surfscape-personal-best-v1";
const PASSPORT_KEY = "surfscape-world-tour-v1";
const HEAT_DURATION_SECONDS = 5 * 60;
const GRADE_ORDER: GameStats["grade"][] = ["C", "B", "A", "S"];
const EMPTY_COAST_RECORD: CoastPassportRecord = {
  rides: 0,
  cleanRides: 0,
  bestScore: 0,
  longestLine: 0,
  longestPocket: 0,
  mostManeuvers: 0,
  longestBarrel: 0,
  bestGrade: "C",
  mastery: 0,
  bestHeat: 0,
  heatWins: 0,
  lastZone: "",
  lastSurfedAt: 0,
};
const WEATHER_PRESETS = [0, 3, 63, 73, 95] as const;
const CAMERA_MODES: CameraMode[] = ["follow", "pov", "immersive", "cinematic"];
const CAMERA_LABELS: Record<CameraMode, string> = {
  follow: "Follow",
  pov: "Surfer POV",
  immersive: "Immersive",
  cinematic: "Cinematic",
};
const REPLAY_SPEEDS = [.5, 1, 1.5] as const;
const PHOTO_FOCAL_LENGTHS = [24, 35, 50, 70] as const;
const PHOTO_GUIDES: PhotoGuide[] = ["thirds", "center", "clean"];
const PHOTO_GUIDE_LABELS: Record<PhotoGuide, string> = {
  thirds: "Rule of thirds",
  center: "Center cross",
  clean: "Clean frame",
};

function nextCameraMode(current: CameraMode) {
  return CAMERA_MODES[(CAMERA_MODES.indexOf(current) + 1) % CAMERA_MODES.length];
}

function steppedReplaySpeed(current: number, direction = 1) {
  const index = REPLAY_SPEEDS.reduce(
    (nearest, value, candidate) => Math.abs(value - current) < Math.abs(REPLAY_SPEEDS[nearest] - current) ? candidate : nearest,
    0,
  );
  return REPLAY_SPEEDS[(index + direction + REPLAY_SPEEDS.length) % REPLAY_SPEEDS.length];
}

function steppedPhotoFocalLength(current: number, direction: number) {
  const index = PHOTO_FOCAL_LENGTHS.reduce(
    (nearest, value, candidate) => Math.abs(value - current) < Math.abs(PHOTO_FOCAL_LENGTHS[nearest] - current) ? candidate : nearest,
    0,
  );
  return PHOTO_FOCAL_LENGTHS[THREEClamp(index + direction, 0, PHOTO_FOCAL_LENGTHS.length - 1)];
}

function formatExposure(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} EV`;
}

function normalizedMotionRoll(event: DeviceOrientationEvent) {
  const legacyOrientation = Number((window as Window & { orientation?: number }).orientation ?? 0);
  const screenAngle = Number(window.screen.orientation?.angle ?? legacyOrientation);
  const orientation = ((screenAngle % 360) + 360) % 360;
  const portrait = orientation === 0 || orientation === 180;
  const source = portrait ? event.gamma : event.beta;
  if (source === null || !Number.isFinite(source)) return null;
  const direction = orientation === 0 || orientation === 90 ? 1 : -1;
  return source * direction;
}

function shortestAngleDelta(value: number, origin: number) {
  return ((value - origin + 540) % 360) - 180;
}

function gradeRank(grade: GameStats["grade"]) {
  return Math.max(0, GRADE_ORDER.indexOf(grade));
}

function formatHeatClock(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function judgeHeatWave(ride: RideToast) {
  const execution = Math.min(2.8, Math.log1p(Math.max(0, ride.score)) / Math.log(12001) * 2.8);
  const entry = THREEClamp(ride.takeoffQuality, 0, 1) * .4;
  const control = THREEClamp(ride.controlQuality, 0, 1) * .9;
  const power = THREEClamp(ride.powerQuality, 0, 1) * .7;
  const line = Math.min(1.5, ride.distance / 70 * 1.5);
  const pocket = Math.min(1.1, ride.pocketDistance / 30 * 1.1);
  const variety = Math.min(1, ride.maneuvers * .36);
  const barrel = Math.min(1.1, ride.barrelTime * .36);
  const completion = ride.result === "clean" ? .4 : -.62;
  return Math.round(THREEClamp(execution + entry + control + power + line + pocket + variety + barrel + completion, .2, 10) * 100) / 100;
}

function rideAnalysisFor(ride: RideToast, board: BoardType): RideAnalysis {
  const percent = (value: number) => Math.round(THREEClamp(value, 0, 1) * 100);
  const variety = THREEClamp(
    Math.min(1, ride.maneuvers / 3) * .62
      + Math.min(1, ride.barrelTime / 3) * .23
      + Math.min(1, Math.max(0, ride.maxCombo - 1) / 3) * .15,
    0,
    1,
  );
  const categories: RideAnalysisCategory[] = [
    { key: "entry", label: "ENTRY", value: percent(ride.takeoffQuality) },
    { key: "line", label: "LINE", value: percent(ride.lineQuality) },
    { key: "control", label: "CONTROL", value: percent(ride.controlQuality) },
    { key: "power", label: "POWER", value: percent(ride.powerQuality) },
    { key: "variety", label: "VARIETY", value: percent(variety) },
  ];
  const strongest = categories.reduce((best, category) => category.value > best.value ? category : best);
  const focus = categories.reduce((weakest, category) => category.value < weakest.value ? category : weakest);
  const powerDetail = board === "longboard"
    ? "Trim forward through soft water, then step back before the turn so the long rail can redirect without stalling."
    : board === "fish"
      ? "Keep the twin-fin moving through the soft section, then load one clean arc instead of forcing a tight pivot."
      : "Build speed with nose pressure, shift to the tail, then release one committed rail turn through the steepest section.";
  const varietyDetail = board === "longboard"
    ? "Link high-line trim, nose time, and one clean cutback so the line changes rhythm without losing glide."
    : board === "fish"
      ? "Mix a high line with a roundhouse or tail release; use the fish's carry to connect the sections."
      : "Hold through compression and release at the lip; connect two different move families before the inside.";
  const coaching: Record<RideAnalysisKey, { headline: string; detail: string }> = {
    entry: {
      headline: "READ THE CREST LONGER",
      detail: "Finish turning shoreward and let the catch pulse tighten above 70%, then commit through the final strokes.",
    },
    line: {
      headline: "FOLLOW THE POWER SEAM",
      detail: "Use the caustic seam as your reference: too deep closes the section, while too wide drops the board off power.",
    },
    control: {
      headline: "QUIET THE CORRECTIONS",
      detail: "Make smaller balance inputs and unwind the rail when grip falls below 50% before loading another move.",
    },
    power: {
      headline: "CREATE SPEED BEFORE RISK",
      detail: powerDetail,
    },
    variety: {
      headline: "BUILD A SECOND IDEA",
      detail: varietyDetail,
    },
  };
  const average = categories.reduce((total, category) => total + category.value, 0) / categories.length;
  if (ride.result === "clean" && average >= 78) {
    return {
      categories,
      strongest: strongest.key,
      focus: focus.key,
      headline: "COMPLETE PERFORMANCE",
      detail: `${strongest.label.toLowerCase()} led the ride at ${strongest.value}%. Keep the same rhythm and add risk only where the wall steepens.`,
    };
  }
  if (ride.result === "wipeout") {
    return {
      categories,
      strongest: strongest.key,
      focus: focus.key,
      headline: "BANK THE FINISH",
      detail: `${coaching[focus.key].detail} When the section turns white, release the rail and settle the ride-out.`,
    };
  }
  return {
    categories,
    strongest: strongest.key,
    focus: focus.key,
    ...coaching[focus.key],
  };
}

function coastMasteryLabel(mastery: number) {
  if (mastery >= 3) return "COAST MASTERED";
  if (mastery >= 2) return "CLEAN LINE";
  if (mastery >= 1) return "COAST LOGGED";
  return "UNSURFED";
}

function masteryForRide(ride: RideToast) {
  let mastery = 1;
  if (ride.result === "clean") mastery = 2;
  if (
    ride.result === "clean"
    && gradeRank(ride.grade) >= gradeRank("A")
    && ride.pocketDistance >= 25
    && (ride.maneuvers >= 2 || ride.barrelTime >= 2)
  ) mastery = 3;
  return mastery;
}

function normalizePassport(value: unknown): SurfPassport {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const passport: SurfPassport = {};
  for (const coast of BEACHES) {
    const candidate = source[coast.id];
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Partial<CoastPassportRecord>;
    const numberValue = (next: unknown) => typeof next === "number" && Number.isFinite(next) ? Math.max(0, next) : 0;
    const rides = Math.floor(numberValue(record.rides));
    const cleanRides = Math.floor(numberValue(record.cleanRides));
    const bestGrade = GRADE_ORDER.includes(record.bestGrade ?? "C") ? record.bestGrade ?? "C" : "C";
    const inferredMastery = rides > 0
      ? cleanRides > 0
        ? gradeRank(bestGrade) >= gradeRank("A")
          && numberValue(record.longestPocket) >= 25
          && (numberValue(record.mostManeuvers) >= 2 || numberValue(record.longestBarrel) >= 2)
          ? 3
          : 2
        : 1
      : 0;
    passport[coast.id] = {
      rides,
      cleanRides,
      bestScore: Math.floor(numberValue(record.bestScore)),
      longestLine: numberValue(record.longestLine),
      longestPocket: numberValue(record.longestPocket),
      mostManeuvers: Math.floor(numberValue(record.mostManeuvers)),
      longestBarrel: numberValue(record.longestBarrel),
      bestGrade,
      mastery: Math.floor(THREEClamp(Math.max(inferredMastery, numberValue(record.mastery)), 0, 3)),
      bestHeat: Math.min(20, numberValue(record.bestHeat)),
      heatWins: Math.floor(numberValue(record.heatWins)),
      lastZone: typeof record.lastZone === "string" ? record.lastZone.slice(0, 80) : "",
      lastSurfedAt: numberValue(record.lastSurfedAt),
    };
  }
  return passport;
}

let lastDiscreteHapticAt = 0;
let lastSurfaceHapticAt = 0;
let lastPhoneTextureAt = 0;

function hapticClock() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function connectedRumbleActuator() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  const gamepad = Array.from(navigator.getGamepads()).find((candidate) => candidate?.connected) as HapticGamepad | undefined;
  return gamepad?.vibrationActuator ?? gamepad?.hapticActuators?.[0] ?? null;
}

function haptic(pattern: number | number[]) {
  if (typeof navigator === "undefined") return;
  lastDiscreteHapticAt = hapticClock();
  if (navigator.vibrate) navigator.vibrate(pattern);
  const beats = Array.isArray(pattern) ? pattern : [pattern];
  const duration = Math.min(260, Math.max(28, beats.reduce((total, beat) => total + beat, 0)));
  const intensity = Math.min(1, .22 + Math.max(...beats) / 64);
  const actuator = connectedRumbleActuator();
  if (actuator?.playEffect) {
    void actuator.playEffect("dual-rumble", {
      duration,
      startDelay: 0,
      strongMagnitude: intensity * .72,
      weakMagnitude: intensity,
    }).catch(() => undefined);
  } else if (actuator?.pulse) {
    void actuator.pulse(intensity, duration).catch(() => undefined);
  }
}

function surfaceHaptic(strongMagnitude: number, weakMagnitude: number, phoneTexture = 0) {
  if (typeof navigator === "undefined" || typeof document === "undefined" || document.visibilityState !== "visible") return;
  const now = hapticClock();
  if (now - lastDiscreteHapticAt < 230 || now - lastSurfaceHapticAt < 82) return;
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const comfortScale = reducedMotion ? .58 : 1;
  const strong = THREEClamp(strongMagnitude * comfortScale, 0, .62);
  const weak = THREEClamp(weakMagnitude * comfortScale, 0, .78);
  if (strong < .025 && weak < .025) return;
  lastSurfaceHapticAt = now;
  const actuator = connectedRumbleActuator();
  if (actuator?.playEffect) {
    void actuator.playEffect("dual-rumble", {
      duration: 96,
      startDelay: 0,
      strongMagnitude: strong,
      weakMagnitude: weak,
    }).catch(() => undefined);
    return;
  }
  if (actuator?.pulse) {
    void actuator.pulse(Math.max(strong, weak), 96).catch(() => undefined);
    return;
  }
  if (navigator.vibrate && phoneTexture > .68 && now - lastPhoneTextureAt > 420) {
    lastPhoneTextureAt = now;
    navigator.vibrate(phoneTexture > .88 ? 5 : 3);
  }
}

function gamepadAxis(value = 0, deadzone = .14) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * Math.min(1, (magnitude - deadzone) / (1 - deadzone));
}

const MODES: Array<{ id: GameMode; name: string; kicker: string; description: string }> = [
  {
    id: "training",
    name: "First Light",
    kicker: "Training",
    description: "The full ocean physics with live force arrows, paddle-hand timing, and causal prompts.",
  },
  {
    id: "advanced",
    name: "Raw Ocean",
    kicker: "Advanced",
    description: "The same board-and-water solver with sparse coaching and an unobstructed line.",
  },
  {
    id: "playground",
    name: "Wave Lab",
    kicker: "Playground",
    description: "Build the exact swell, tide, current, and light you want to ride.",
  },
];

const TRAINING_STEPS = [
  { title: "Enter the shallows", detail: "Move from the sand into the water." },
  { title: "Paddle with intent", detail: "Hold W until both hands complete real in-water pulls. A/D biases the outside hand to rotate the board; release W to coast." },
  { title: "Reach the lineup", detail: "Keep the nose aimed offshore and paddle beyond the breaking water." },
  { title: "Turn for shore", detail: "Rotate until the live wave arrow overlaps the fixed board-nose reference." },
  { title: "Choose when to stand", detail: "Space always stands. Flat water stalls; a matched face captures; a broadside wall tumbles you." },
  { title: "Track the pocket", detail: "Set a rail and shift nose/tail pressure; the resulting speed and turn carry the board across the face." },
  { title: "Set the rail", detail: "Turns are read from your actual board path. Compress and release only when a live lip can redirect momentum." },
  { title: "Finish clean", detail: "Stay composed through the inside section." },
] as const;

const PADDLE_WORK_LESSON_TARGET = .28;

function reachedTrainingStep(stats: GameStats) {
  const waterPhase = stats.phase === "wading" || stats.phase === "paddling" || stats.phase === "riding" || stats.phase === "wipeout";
  const hasStood = stats.phase === "riding" || stats.rideDistance > 0 || stats.rideResult !== "";
  const hasRidden = stats.waveEngaged || stats.rideDistance > 0 || stats.rideResult === "clean";
  const paddleLessonComplete =
    stats.paddleLeftWork >= PADDLE_WORK_LESSON_TARGET
    && stats.paddleRightWork >= PADDLE_WORK_LESSON_TARGET;
  let reached = 0;
  if (waterPhase) reached = 1;
  if (paddleLessonComplete) reached = 2;
  if (paddleLessonComplete && (stats.inLineup || hasRidden)) reached = 3;
  if (
    reached >= 3
    && (
      stats.takeoffAlignment > .72
      || hasRidden
    )
  ) reached = 4;
  if (reached >= 4 && hasStood) reached = 5;
  const hasTrackedPocket = stats.pocketDistance >= 15;
  if (reached >= 5 && hasTrackedPocket) reached = 6;
  if (reached >= 6 && stats.maneuverCount > 0) reached = 7;
  if (reached >= 7 && stats.rideResult === "clean") reached = 8;
  return reached;
}

const EMPTY_CONTROLS: ControlState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  sprint: false,
  action: false,
  moveX: 0,
  moveY: 0,
  balance: 0,
  gamepadConnected: false,
  gamepadActive: false,
  gamepadMoveX: 0,
  gamepadMoveY: 0,
  gamepadBalance: 0,
  gamepadAction: false,
  gamepadSprint: false,
  lookYaw: 0,
  lookPitch: 0,
};

function formatHourValue(value: number) {
  const wrapped = ((value % 24) + 24) % 24;
  const hour = Math.floor(wrapped);
  const minute = Math.round((wrapped - hour) * 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function degrees(value: number) {
  return `${Math.round(value)}° ${compassDirection(value)}`;
}

function weatherLabel(code: number) {
  if (code === 45 || code === 48) return "Sea fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Showers";
  if ([95, 96, 99].includes(code)) return "Thunder";
  if (code === 1 || code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  return "Clear sky";
}

function conditionsAtForecast(base: MarineConditions, point: MarineForecastPoint | null): MarineConditions {
  if (!point) return base;
  return {
    ...base,
    observedAt: point.time,
    waveHeight: point.waveHeight,
    waveDirection: point.waveDirection,
    wavePeriod: point.wavePeriod,
    swellHeight: point.swellHeight,
    swellDirection: point.swellDirection,
    swellPeriod: point.swellPeriod,
    waterTemperature: point.waterTemperature,
    currentVelocity: point.currentVelocity,
    currentDirection: point.currentDirection,
    seaLevel: point.seaLevel,
    tideTrend: point.tideTrend,
    airTemperature: point.airTemperature,
    cloudCover: point.cloudCover,
    windSpeed: point.windSpeed,
    windDirection: point.windDirection,
    weatherCode: point.weatherCode,
    isDay: point.isDay,
    sunrise: point.sunrise,
    sunset: point.sunset,
  };
}

function forecastWindows(conditions: MarineConditions) {
  const start = new Date(conditions.observedAt).getTime();
  const offsets = [3, 6, 9, 12, 18, 24];
  const seen = new Set<string>();
  return offsets.flatMap((offset) => {
    const target = start + offset * 3_600_000;
    const point = conditions.forecast.reduce<MarineForecastPoint | null>((nearest, candidate) => {
      if (!nearest) return candidate;
      return Math.abs(new Date(candidate.time).getTime() - target) < Math.abs(new Date(nearest.time).getTime() - target) ? candidate : nearest;
    }, null);
    if (!point || seen.has(point.time)) return [];
    seen.add(point.time);
    return [point];
  });
}

function forecastDayLabel(time: string, observedAt: string) {
  const day = time.slice(0, 10);
  const currentDay = observedAt.slice(0, 10);
  const delta = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${currentDay}T12:00:00Z`)) / 86_400_000);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  return day.slice(5).replace("-", "/");
}

function nextWeatherPreset(code: number) {
  const index = WEATHER_PRESETS.findIndex((preset) => preset === code);
  return WEATHER_PRESETS[(index + 1 + WEATHER_PRESETS.length) % WEATHER_PRESETS.length];
}

function playgroundCloudCover(code: number) {
  if (code === 0) return 8;
  if (code === 3) return 92;
  if ([95, 96, 99].includes(code)) return 98;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 88;
  return 82;
}

function roundedCardRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const edge = Math.min(radius, width * .5, height * .5);
  context.beginPath();
  context.moveTo(x + edge, y);
  context.lineTo(x + width - edge, y);
  context.quadraticCurveTo(x + width, y, x + width, y + edge);
  context.lineTo(x + width, y + height - edge);
  context.quadraticCurveTo(x + width, y + height, x + width - edge, y + height);
  context.lineTo(x + edge, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - edge);
  context.lineTo(x, y + edge);
  context.quadraticCurveTo(x, y, x + edge, y);
  context.closePath();
}

async function rideCardFile({
  ride,
  beach,
  zone,
  board,
  waveHeight,
  wavePeriod,
  tourMastery,
  sceneFrame,
}: {
  ride: RideToast;
  beach: Beach;
  zone: string;
  board: string;
  waveHeight: number;
  wavePeriod: number;
  tourMastery: number;
  sceneFrame?: Blob | null;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const accent = beach.palette[0];
  const sand = beach.palette[1];
  const background = context.createLinearGradient(0, 0, 1200, 630);
  background.addColorStop(0, "#020c12");
  background.addColorStop(.56, "#06242d");
  background.addColorStop(1, "#0a3f45");
  context.fillStyle = background;
  context.fillRect(0, 0, 1200, 630);

  let capturedImage: ImageBitmap | null = null;
  if (sceneFrame && typeof createImageBitmap === "function") {
    try {
      capturedImage = await createImageBitmap(sceneFrame);
      const sourceAspect = capturedImage.width / capturedImage.height;
      const targetAspect = 1200 / 630;
      const sourceWidth = sourceAspect > targetAspect ? capturedImage.height * targetAspect : capturedImage.width;
      const sourceHeight = sourceAspect > targetAspect ? capturedImage.height : capturedImage.width / targetAspect;
      const sourceX = (capturedImage.width - sourceWidth) * .5;
      const sourceY = (capturedImage.height - sourceHeight) * .5;
      context.drawImage(capturedImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, 1200, 630);
    } catch {
      capturedImage = null;
    }
  }

  if (capturedImage) {
    const leftShade = context.createLinearGradient(0, 0, 860, 0);
    leftShade.addColorStop(0, "rgba(1,9,14,.86)");
    leftShade.addColorStop(.48, "rgba(2,14,20,.48)");
    leftShade.addColorStop(1, "rgba(3,18,24,.08)");
    context.fillStyle = leftShade;
    context.fillRect(0, 0, 940, 630);
    const lowerShade = context.createLinearGradient(0, 270, 0, 630);
    lowerShade.addColorStop(0, "rgba(1,10,15,0)");
    lowerShade.addColorStop(.58, "rgba(1,10,15,.54)");
    lowerShade.addColorStop(1, "rgba(1,8,13,.93)");
    context.fillStyle = lowerShade;
    context.fillRect(0, 250, 1200, 380);
    context.fillStyle = "rgba(2,12,18,.25)";
    context.fillRect(820, 0, 380, 630);
  }

  const glow = context.createRadialGradient(900, 145, 12, 900, 145, 470);
  glow.addColorStop(0, `${accent}70`);
  glow.addColorStop(.42, `${accent}1c`);
  glow.addColorStop(1, "transparent");
  context.fillStyle = glow;
  context.fillRect(0, 0, 1200, 630);

  context.globalAlpha = capturedImage ? .075 : .18;
  context.strokeStyle = accent;
  context.lineWidth = 2;
  for (let index = 0; index < 7; index += 1) {
    const baseline = 330 + index * 35;
    context.beginPath();
    context.moveTo(-70, baseline);
    context.bezierCurveTo(210, baseline - 85 - index * 2, 410, baseline + 68, 690, baseline - 22);
    context.bezierCurveTo(880, baseline - 82, 1040, baseline + 42, 1270, baseline - 34);
    context.stroke();
  }
  context.globalAlpha = 1;

  context.fillStyle = "rgba(255,255,255,.09)";
  context.fillRect(64, 60, 5, 108);
  context.fillStyle = accent;
  context.fillRect(64, 60, 5, 42);
  context.font = "800 25px Arial, sans-serif";
  context.fillStyle = "#f2fffb";
  context.fillText("S U R F S C A P E", 94, 92);
  context.font = "700 14px Arial, sans-serif";
  context.fillStyle = "rgba(218,247,242,.58)";
  context.fillText(
    capturedImage
      ? ride.result === "clean" ? "CLEAN LINE  /  CINEMATIC RIDE FRAME" : "WIPEOUT  /  CINEMATIC RIDE FRAME"
      : ride.result === "clean" ? "CLEAN LINE  /  RIDE RECORD" : "WIPEOUT  /  RIDE RECORD",
    94,
    128,
  );

  let zoneSize = 68;
  do {
    context.font = `900 ${zoneSize}px Impact, Haettenschweiler, Arial Narrow, sans-serif`;
    zoneSize -= 2;
  } while (context.measureText(zone.toUpperCase()).width > 715 && zoneSize > 42);
  context.fillStyle = "#f7fffc";
  context.fillText(zone.toUpperCase(), 64, 248);
  context.font = "700 19px Arial, sans-serif";
  context.fillStyle = "rgba(222,248,243,.64)";
  context.fillText(`${beach.name.toUpperCase()}  ·  ${beach.country.toUpperCase()}`, 68, 286);

  roundedCardRect(context, 850, 54, 284, 246, 20);
  context.fillStyle = "rgba(1,12,18,.52)";
  context.fill();
  context.strokeStyle = `${accent}82`;
  context.lineWidth = 2;
  context.stroke();
  context.font = "800 14px Arial, sans-serif";
  context.fillStyle = accent;
  context.fillText("S E S S I O N   G R A D E", 900, 94);
  context.font = "800 10px Arial, sans-serif";
  context.fillStyle = "rgba(211,243,238,.56)";
  context.fillText(`W O R L D  T O U R   ${tourMastery} / 3`, 900, 113);
  context.font = "900 132px Impact, Haettenschweiler, Arial Narrow, sans-serif";
  context.fillStyle = ride.result === "clean" ? "#d9fff3" : "#ffb39f";
  context.fillText(ride.grade, 944, 230);
  context.font = "900 28px Impact, Haettenschweiler, Arial Narrow, sans-serif";
  context.fillStyle = "#ffffff";
  context.fillText(`${ride.score.toLocaleString("en-US")} PTS`, 914, 276);

  const metrics = [
    ["L I N E", `${ride.distance.toFixed(0)} M`],
    ["P O C K E T", `${ride.pocketDistance.toFixed(0)} M`],
    ["M O V E S", `${ride.maneuvers}`],
    ["B A R R E L", `${ride.barrelTime.toFixed(1)} S`],
  ];
  metrics.forEach(([label, value], index) => {
    const x = 64 + index * 208;
    roundedCardRect(context, x, 354, 188, 112, 13);
    context.fillStyle = "rgba(3,20,27,.67)";
    context.fill();
    context.strokeStyle = index === 0 ? `${accent}78` : "rgba(255,255,255,.14)";
    context.stroke();
    context.font = "800 12px Arial, sans-serif";
    context.fillStyle = "rgba(211,243,238,.5)";
    context.fillText(label, x + 18, 384);
    context.font = "900 34px Impact, Haettenschweiler, Arial Narrow, sans-serif";
    context.fillStyle = "#f2fffb";
    context.fillText(value, x + 18, 437);
  });

  roundedCardRect(context, 900, 354, 234, 112, 13);
  context.fillStyle = "rgba(3,20,27,.67)";
  context.fill();
  context.strokeStyle = `${sand}76`;
  context.stroke();
  context.font = "800 12px Arial, sans-serif";
  context.fillStyle = "rgba(211,243,238,.5)";
  context.fillText("O C E A N  /  B O A R D", 918, 384);
  context.font = "800 19px Arial, sans-serif";
  context.fillStyle = "#f2fffb";
  context.fillText(`${waveHeight.toFixed(1)}M  ·  ${wavePeriod.toFixed(0)}S`, 918, 417);
  context.font = "700 14px Arial, sans-serif";
  context.fillStyle = sand;
  context.fillText(board.toUpperCase(), 918, 443);

  context.fillStyle = "rgba(216,247,242,.52)";
  context.font = "700 13px Arial, sans-serif";
  context.fillText("SURF THE WORLD  ·  SURFSCAPE.ALEXANDRIA.CHATGPT.SITE", 64, 566);
  context.fillStyle = accent;
  context.fillRect(64, 588, 1070, 3);
  capturedImage?.close();

  return new Promise<File | null>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? new File([blob], "surfscape-ride.png", { type: "image/png" }) : null);
    }, "image/png");
  });
}

export default function SurfscapeApp() {
  const [screen, setScreen] = useState<Screen>("launch");
  const [beach, setBeach] = useState<Beach>(DEFAULT_BEACH);
  const [latitude, setLatitude] = useState(DEFAULT_BEACH.zones[1].lat);
  const [longitude, setLongitude] = useState(DEFAULT_BEACH.zones[1].lon);
  const [zoneLabel, setZoneLabel] = useState(DEFAULT_BEACH.zones[1].name);
  const [conditions, setConditions] = useState<MarineConditions>(() => INITIAL_MODELED_CONDITIONS);
  const [conditionsLoading, setConditionsLoading] = useState(true);
  const [selectedForecastTime, setSelectedForecastTime] = useState<string | null>(null);
  const [settings, setSettings] = useState<SessionSettings>(() => settingsFromConditions(INITIAL_MODELED_CONDITIONS, DEFAULT_BEACH.heading));
  const [stats, setStats] = useState<GameStats>(INITIAL_STATS);
  const [sessionFormat, setSessionFormat] = useState<SessionFormat>("free");
  const [heatRemaining, setHeatRemaining] = useState(HEAT_DURATION_SECONDS);
  const [heatWaves, setHeatWaves] = useState<HeatWave[]>([]);
  const [heatExpired, setHeatExpired] = useState(false);
  const [heatComplete, setHeatComplete] = useState(false);
  const [paused, setPaused] = useState(false);
  const [photoMode, setPhotoMode] = useState(false);
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>("idle");
  const [photoFocalLength, setPhotoFocalLength] = useState<number>(35);
  const [photoExposure, setPhotoExposure] = useState(0);
  const [photoGuide, setPhotoGuide] = useState<PhotoGuide>("thirds");
  const [replayReady, setReplayReady] = useState(false);
  const [replayActive, setReplayActive] = useState(false);
  const [replayRequest, setReplayRequest] = useState(0);
  const [replayProgress, setReplayProgress] = useState(0);
  const [replayDuration, setReplayDuration] = useState(0);
  const [replayRide, setReplayRide] = useState<RideToast | null>(null);
  const [replayPaused, setReplayPaused] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<number>(1);
  const [replaySeekProgress, setReplaySeekProgress] = useState(0);
  const [replaySeekRequest, setReplaySeekRequest] = useState(0);
  const [replayAutoDirector, setReplayAutoDirector] = useState(true);
  const [replayTelemetry, setReplayTelemetry] = useState<ReplayTelemetry>(EMPTY_REPLAY_TELEMETRY);
  const [replayMoments, setReplayMoments] = useState<ReplayMoment[]>([]);
  const [sceneReady, setSceneReady] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [trainingStep, setTrainingStep] = useState(0);
  const trainingStepValue = useRef(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("follow");
  const [pointerLocked, setPointerLocked] = useState(false);
  const [motionBalanceStatus, setMotionBalanceStatus] = useState<MotionBalanceStatus>("checking");
  const [showPlanner, setShowPlanner] = useState(true);
  const [destinationPickerOpen, setDestinationPickerOpen] = useState(false);
  const [launchPanel, setLaunchPanel] = useState<LaunchPanel>("break");
  const [hudMenuOpen, setHudMenuOpen] = useState(false);
  const [hudPanel, setHudPanel] = useState<HudPanel>("ocean");
  const [showHowTo, setShowHowTo] = useState(false);
  const [qaScenario, setQaScenario] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [personalBest, setPersonalBest] = useState<PersonalBest>({ score: 0, distance: 0, combo: 1 });
  const [recordsReady, setRecordsReady] = useState(false);
  const [passport, setPassport] = useState<SurfPassport>({});
  const [passportReady, setPassportReady] = useState(false);
  const [passportAward, setPassportAward] = useState<PassportAward | null>(null);
  const [maneuverToast, setManeuverToast] = useState<{ id: number; name: string; points: number; quality: number } | null>(null);
  const [rideToast, setRideToast] = useState<RideToast | null>(null);
  const [hudEventToast, setHudEventToast] = useState<HudEventToast | null>(null);
  const [hudEventVisible, setHudEventVisible] = useState(false);
  const [captureRequest, setCaptureRequest] = useState<RideCaptureRequest | null>(null);
  const [rideFrameVersion, setRideFrameVersion] = useState(0);
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [shorebreakToast, setShorebreakToast] = useState<{ id: number; result: "clean" | "hit"; quality: number } | null>(null);
  const [wetLens, setWetLens] = useState<WetLensEvent | null>(null);
  useEffect(() => {
    if (!destinationPickerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDestinationPickerOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [destinationPickerOpen]);
  const controls = useRef<ControlState>({ ...EMPTY_CONTROLS });
  const audio = useRef<SurfscapeAudio | null>(null);
  const rideCard = useRef<File | null>(null);
  const photoFile = useRef<File | null>(null);
  const rideFrame = useRef<RideFrameCapture | null>(null);
  const captureSequence = useRef(0);
  const activeRideCaptureId = useRef(0);
  const requestedCaptureQuality = useRef(0);
  const maneuverCaptureCount = useRef(0);
  const previousBarrelCaptureBand = useRef(0);
  const wakeLock = useRef<WakeLockSentinelLike | null>(null);
  const previousPhase = useRef(stats.phase);
  const previousManeuverId = useRef(0);
  const previousManeuverActive = useRef(false);
  const previousChargeBand = useRef(0);
  const previousRideResultId = useRef(0);
  const previousPassportRideResultId = useRef(0);
  const previousTakeoffCommit = useRef(false);
  const previousDuckDiveReady = useRef(false);
  const leashTaut = useRef(false);
  const previousShorebreakId = useRef(0);
  const wetLensSequence = useRef(0);
  const previousSprayHit = useRef(false);
  const shorebreakToastTimer = useRef<number | null>(null);
  const hudEventToastRef = useRef<HudEventToast | null>(null);
  const hudEventTransitionTimer = useRef<number | null>(null);
  const previousBalanceLock = useRef(false);
  const lastBalanceHapticAt = useRef(0);
  const previousGripWarning = useRef(false);
  const previousVehicleSlipWarning = useRef(false);
  const previousWhitewaterImpact = useRef(false);
  const previousPocketLock = useRef(false);
  const previousFaceZone = useRef(0);
  const previousHydrodynamicLoad = useRef(false);
  const previousResurface = useRef(false);
  const previousWaveEngaged = useRef(stats.waveEngaged);
  const heatRemainingValue = useRef(HEAT_DURATION_SECONDS);
  const heatStarted = useRef(false);
  const heatLastSecond = useRef(HEAT_DURATION_SECONDS);
  const heatRecordCommitted = useRef(false);
  const preReplayCameraMode = useRef<CameraMode>("follow");
  const replayCameraCut = useRef<CameraMode | null>(null);
  const replayProgressValue = useRef(0);
  const replayResumeAfterScrub = useRef(false);
  const joystickKnob = useRef<HTMLSpanElement>(null);
  const joystickPointer = useRef<number | null>(null);
  const joystickBounds = useRef<DOMRect | null>(null);
  const balancePointer = useRef<number | null>(null);
  const balanceBounds = useRef<DOMRect | null>(null);
  const motionBalanceOrigin = useRef<number | null>(null);
  const motionBalanceValue = useRef(0);
  const cameraLookSurface = useRef<HTMLDivElement>(null);
  const lookGesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  } | null>(null);
  const selectedForecast = useMemo(
    () => conditions.forecast.find((point) => point.time === selectedForecastTime) ?? null,
    [conditions.forecast, selectedForecastTime],
  );

  useEffect(() => {
    const enabled = new URLSearchParams(window.location.search).get("qa") === "surf";
    if (!enabled) return;
    let startTimer: number | null = null;
    const configureTimer = window.setTimeout(() => {
      setQaScenario(true);
      setSettings((current) => ({
        ...current,
        mode: "playground",
        waveHeight: 2,
        wavePeriod: 8,
        swellHeight: 2,
        swellPeriod: 10,
        windSpeed: 5,
        tide: .1,
        timeOfDay: 16,
      }));
      setCameraMode("cinematic");
      setStats(INITIAL_STATS);
      setPaused(false);
      setPhotoMode(false);
      setReplayActive(false);
      startTimer = window.setTimeout(() => {
        setSessionKey((value) => value + 1);
        setScreen("game");
      }, 1200);
    }, 0);
    return () => {
      window.clearTimeout(configureTimer);
      if (startTimer !== null) window.clearTimeout(startTimer);
    };
  }, []);
  const sessionConditions = useMemo(() => conditionsAtForecast(conditions, selectedForecast), [conditions, selectedForecast]);
  const availableForecastWindows = useMemo(() => forecastWindows(conditions), [conditions]);
  const sessionWeatherCode = settings.weatherCode;
  const sessionCloudCover = settings.mode === "playground" ? playgroundCloudCover(sessionWeatherCode) : sessionConditions.cloudCover;
  const breakCharacter = useMemo(
    () => getBreakCharacter(beach.id, zoneLabel),
    [beach.id, zoneLabel],
  );
  const coastBiome = useMemo(() => getCoastBiome(beach.id), [beach.id]);
  const tideResponse = useMemo(
    () => tideResponseForBreak(settings.tide, breakCharacter),
    [breakCharacter, settings.tide],
  );
  const currentTideResponse = useMemo(
    () => tideResponseForBreak(conditions.seaLevel, breakCharacter),
    [breakCharacter, conditions.seaLevel],
  );
  const effectiveFaceHeight = settings.waveHeight * tideResponse.faceScale;
  const thermalKit = useMemo(
    () => thermalKitForConditions(settings.waterTemperature, settings.airTemperature, settings.windSpeed),
    [settings.airTemperature, settings.waterTemperature, settings.windSpeed],
  );
  const currentCoastRecord = passport[beach.id] ?? EMPTY_COAST_RECORD;
  const heatTarget = Math.round((12.5 + beach.difficulty * .45) * 100) / 100;
  const rankedHeatWaves = useMemo(
    () => [...heatWaves].sort((left, right) => right.judgeScore - left.judgeScore || left.id - right.id),
    [heatWaves],
  );
  const countedHeatWaves = rankedHeatWaves.slice(0, 2);
  const countedHeatWaveIds = new Set(countedHeatWaves.map((wave) => wave.id));
  const heatTotal = Math.round(countedHeatWaves.reduce((total, wave) => total + wave.judgeScore, 0) * 100) / 100;
  const heatWon = heatTotal >= heatTarget;
  const passportSummary = useMemo(() => BEACHES.reduce(
    (summary, coast) => {
      const record = passport[coast.id];
      if (record?.rides) summary.explored += 1;
      summary.stamps += record?.mastery ?? 0;
      return summary;
    },
    { explored: 0, stamps: 0 },
  ), [passport]);

  const splashLens = useCallback((intensity: number, duration: number) => {
    wetLensSequence.current += 1;
    setWetLens({
      id: wetLensSequence.current,
      intensity: THREEClamp(intensity, .12, 1),
      duration: THREEClamp(duration, 2.2, 7.2),
    });
  }, []);

  const requestRideFrame = useCallback((quality: number) => {
    const nextQuality = THREEClamp(quality, 0, 1);
    if (activeRideCaptureId.current <= 0 || nextQuality <= requestedCaptureQuality.current + .045) return;
    requestedCaptureQuality.current = nextQuality;
    captureSequence.current += 1;
    setCaptureRequest({
      id: captureSequence.current,
      rideId: activeRideCaptureId.current,
      quality: nextQuality,
      purpose: "ride",
      view: "cinematic",
    });
  }, []);

  const handleRideFrameCapture = useCallback((capture: RideFrameCapture) => {
    if (capture.purpose === "photo") {
      photoFile.current = new File([capture.blob], `surfscape-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      setPhotoStatus("ready");
      haptic([7, 18, 11]);
      return;
    }
    if (capture.rideId !== activeRideCaptureId.current) return;
    if (rideFrame.current && capture.quality < rideFrame.current.quality) return;
    rideFrame.current = capture;
    setRideFrameVersion((version) => version + 1);
  }, []);

  const handleReplayReady = useCallback((ready: boolean) => {
    setReplayReady(ready);
  }, []);

  const handleReplayState = useCallback((state: ReplayState) => {
    replayProgressValue.current = state.progress;
    setReplayProgress(state.progress);
    setReplayDuration(state.duration);
    setReplayTelemetry(state.telemetry);
    setReplayMoments(state.moments);
    if (state.active) {
      setReplayActive(true);
      if (replayCameraCut.current !== state.cameraMode) {
        replayCameraCut.current = state.cameraMode;
        setCameraMode(state.cameraMode);
        audio.current?.effect("turn");
        haptic(4);
      }
      return;
    }
    setReplayActive(false);
    setReplayRide(null);
    setReplayPaused(false);
    setReplaySpeed(1);
    setReplaySeekProgress(0);
    setReplayAutoDirector(true);
    setReplayTelemetry(EMPTY_REPLAY_TELEMETRY);
    setReplayMoments([]);
    replayResumeAfterScrub.current = false;
    replayCameraCut.current = null;
    controls.current.lookYaw = 0;
    controls.current.lookPitch = 0;
    setCameraMode(preReplayCameraMode.current);
  }, []);

  const stopReplay = useCallback(() => {
    setReplayActive(false);
    setReplayPaused(false);
    setReplaySpeed(1);
    setReplaySeekProgress(0);
    setReplayAutoDirector(true);
    setReplayTelemetry(EMPTY_REPLAY_TELEMETRY);
    setReplayMoments([]);
    replayResumeAfterScrub.current = false;
    replayCameraCut.current = null;
    controls.current.lookYaw = 0;
    controls.current.lookPitch = 0;
    setCameraMode(preReplayCameraMode.current);
    haptic(4);
  }, []);

  const toggleReplayPaused = useCallback(() => {
    setReplayPaused((pausedState) => !pausedState);
    haptic(5);
  }, []);

  const seekReplay = useCallback((progress: number) => {
    const next = THREEClamp(progress, 0, .9995);
    replayProgressValue.current = next;
    setReplaySeekProgress(next);
    setReplayProgress(next);
    setReplaySeekRequest((request) => request + 1);
  }, []);

  const cycleReplaySpeed = useCallback((direction = 1) => {
    setReplaySpeed((current) => steppedReplaySpeed(current, direction));
    haptic(4);
  }, []);

  const beginReplayScrub = useCallback(() => {
    replayResumeAfterScrub.current = !replayPaused;
    setReplayPaused(true);
  }, [replayPaused]);

  const endReplayScrub = useCallback(() => {
    if (replayResumeAfterScrub.current) setReplayPaused(false);
    replayResumeAfterScrub.current = false;
    haptic(4);
  }, []);

  const cycleReplayCamera = useCallback(() => {
    setReplayAutoDirector(false);
    controls.current.lookYaw = 0;
    controls.current.lookPitch = 0;
    setCameraMode((current) => {
      const next = nextCameraMode(current);
      replayCameraCut.current = next;
      return next;
    });
    haptic(6);
  }, []);

  const toggleReplayDirector = useCallback(() => {
    setReplayAutoDirector((enabled) => {
      if (!enabled) replayCameraCut.current = null;
      return !enabled;
    });
    haptic(5);
  }, []);

  const selectPhotoFocalLength = useCallback((focalLength: number) => {
    photoFile.current = null;
    setPhotoStatus("idle");
    setPhotoFocalLength(focalLength);
    haptic(3);
  }, []);

  const nudgePhotoFocalLength = useCallback((direction: number) => {
    photoFile.current = null;
    setPhotoStatus("idle");
    setPhotoFocalLength((current) => steppedPhotoFocalLength(current, direction));
    haptic(3);
  }, []);

  const selectPhotoExposure = useCallback((exposure: number) => {
    photoFile.current = null;
    setPhotoStatus("idle");
    setPhotoExposure(THREEClamp(exposure, -1.5, 1.5));
  }, []);

  const cyclePhotoGuide = useCallback(() => {
    setPhotoGuide((current) => PHOTO_GUIDES[(PHOTO_GUIDES.indexOf(current) + 1) % PHOTO_GUIDES.length]);
    haptic(3);
  }, []);

  useEffect(() => {
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === cameraLookSurface.current;
      setPointerLocked(locked);
      if (!locked) lookGesture.current = null;
    };
    const onLockedMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== cameraLookSurface.current || screen !== "game" || paused) return;
      controls.current.gamepadActive = false;
      const yaw = controls.current.lookYaw - event.movementX * .00235;
      controls.current.lookYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      controls.current.lookPitch = THREEClamp(controls.current.lookPitch - event.movementY * .00205, -1.35, 1.35);
    };
    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("mousemove", onLockedMouseMove);
    return () => {
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("mousemove", onLockedMouseMove);
    };
  }, [paused, screen]);

  useEffect(() => {
    if ((screen !== "game" || paused) && document.pointerLockElement === cameraLookSurface.current) {
      document.exitPointerLock();
    }
  }, [paused, screen]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const touchDevice = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
      const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? touchDevice;
      setMotionBalanceStatus("DeviceOrientationEvent" in window && touchDevice && coarsePointer ? "idle" : "unavailable");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (motionBalanceStatus !== "active") return;
    if (stats.phase === "riding" || stats.phase === "paddling") {
      motionBalanceOrigin.current = null;
      motionBalanceValue.current = 0;
      controls.current.balance = 0;
    } else {
      controls.current.balance = 0;
    }
  }, [motionBalanceStatus, stats.phase]);

  useEffect(() => {
    if (motionBalanceStatus !== "active") return;
    const resetMotionCenter = () => {
      motionBalanceOrigin.current = null;
      motionBalanceValue.current = 0;
      controls.current.balance = 0;
    };
    const onOrientation = (event: DeviceOrientationEvent) => {
      const roll = normalizedMotionRoll(event);
      if (roll === null) return;
      if (motionBalanceOrigin.current === null) {
        motionBalanceOrigin.current = roll;
        motionBalanceValue.current = 0;
        controls.current.balance = 0;
        return;
      }
      const target = THREEClamp(shortestAngleDelta(roll, motionBalanceOrigin.current) / 17.5, -1, 1);
      motionBalanceValue.current += (target - motionBalanceValue.current) * .24;
      if (
        screen === "game"
        && !paused
        && !photoMode
        && !replayActive
        && (stats.phase === "riding" || stats.phase === "paddling")
      ) {
        controls.current.gamepadActive = false;
        controls.current.balance = motionBalanceValue.current;
      }
    };
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
    window.addEventListener("orientationchange", resetMotionCenter);
    window.screen.orientation?.addEventListener("change", resetMotionCenter);
    return () => {
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("orientationchange", resetMotionCenter);
      window.screen.orientation?.removeEventListener("change", resetMotionCenter);
    };
  }, [motionBalanceStatus, paused, photoMode, replayActive, screen, stats.phase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(RECORD_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<PersonalBest>;
          setPersonalBest({
            score: Number(parsed.score) || 0,
            distance: Number(parsed.distance) || 0,
            combo: Number(parsed.combo) || 1,
          });
        }
      } catch {
        // A private browsing policy may disable local storage; the session still works.
      } finally {
        setRecordsReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!recordsReady) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(RECORD_KEY, JSON.stringify(personalBest));
      } catch {
        // Bests remain available for the current tab when storage is unavailable.
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [personalBest, recordsReady]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(PASSPORT_KEY);
        if (saved) setPassport(normalizePassport(JSON.parse(saved)));
      } catch {
        // Tour progress remains available for the current tab when storage is unavailable.
      } finally {
        setPassportReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!passportReady) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(PASSPORT_KEY, JSON.stringify(passport));
      } catch {
        // Tour progress remains available for the current tab when storage is unavailable.
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [passport, passportReady]);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    const frame = window.requestAnimationFrame(() => {
      setFullscreenAvailable(Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen));
      syncFullscreen();
    });
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("fullscreenchange", syncFullscreen);
    };
  }, []);

  useEffect(() => {
    if (screen !== "game" || sessionFormat !== "heat" || heatComplete || heatExpired) return;
    let frame = 0;
    let previousAt = performance.now();
    let lastReported = heatRemainingValue.current;
    const tick = (now: number) => {
      const delta = Math.min(.12, Math.max(0, (now - previousAt) / 1000));
      previousAt = now;
      const running = !paused
        && !photoMode
        && !replayActive
        && stats.sessionIntro >= .999;
      if (running) {
        if (!heatStarted.current) {
          heatStarted.current = true;
          audio.current?.effect("coach");
          haptic([10, 18, 10, 28, 14]);
        }
        const previous = heatRemainingValue.current;
        const next = Math.max(0, previous - delta);
        heatRemainingValue.current = next;
        const second = Math.ceil(next);
        if (second !== heatLastSecond.current) {
          heatLastSecond.current = second;
          if (second === 60) {
            audio.current?.effect("coach");
            haptic([8, 18, 8]);
          } else if (second > 0 && second <= 10) {
            haptic(second <= 3 ? 8 : 4);
          }
        }
        if (next <= 0 && previous > 0) {
          setHeatRemaining(0);
          setHeatExpired(true);
          audio.current?.effect("coach");
          haptic([14, 22, 14, 34, 22]);
        } else if (lastReported - next >= .1) {
          lastReported = next;
          setHeatRemaining(next);
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [heatComplete, heatExpired, paused, photoMode, replayActive, screen, sessionFormat, stats.sessionIntro]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const registerServiceWorker = () => {
      if (!("serviceWorker" in navigator)) return;
      void navigator.serviceWorker
        .register(`${basePath}/sw.js`, { scope: `${basePath || ""}/` })
        .catch(() => undefined);
    };
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("load", registerServiceWorker, { once: true });
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    if (document.readyState === "complete") registerServiceWorker();
    return () => {
      window.removeEventListener("load", registerServiceWorker);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const release = async () => {
      const current = wakeLock.current;
      wakeLock.current = null;
      if (current && !current.released) await current.release().catch(() => undefined);
    };
    const request = async () => {
      if (cancelled || screen !== "game" || paused || document.visibilityState !== "visible" || wakeLock.current) return;
      const manager = (navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
      }).wakeLock;
      if (!manager) return;
      try {
        const sentinel = await manager.request("screen");
        if (cancelled) await sentinel.release().catch(() => undefined);
        else wakeLock.current = sentinel;
      } catch {
        // Unsupported power policies should never interrupt the session.
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void request();
      else void release();
    };
    void request();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void release();
    };
  }, [paused, screen]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setConditionsLoading(true);
      setSelectedForecastTime(null);
      fetchMarineConditions(beach, latitude, longitude, controller.signal)
        .then((live) => {
          setConditions(live);
          setSettings((previous) => {
            if (previous.mode === "playground") return { ...previous, coastHeading: beach.heading };
            return { ...settingsFromConditions(live, beach.heading), mode: previous.mode, board: previous.board };
          });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          const modeled = fallbackConditions(beach);
          setConditions(modeled);
          setSettings((previous) => previous.mode === "playground"
            ? { ...previous, coastHeading: beach.heading }
            : { ...settingsFromConditions(modeled, beach.heading), mode: previous.mode, board: previous.board });
        })
        .finally(() => setConditionsLoading(false));
    }, 260);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [beach, latitude, longitude]);

  useEffect(() => {
    const releaseAllControls = () => {
      controls.current.forward = false;
      controls.current.back = false;
      controls.current.left = false;
      controls.current.right = false;
      controls.current.sprint = false;
      controls.current.action = false;
      controls.current.balance = 0;
      controls.current.moveX = 0;
      controls.current.moveY = 0;
      joystickPointer.current = null;
      joystickBounds.current = null;
      balancePointer.current = null;
      balanceBounds.current = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (screen !== "game") return;
      controls.current.gamepadActive = false;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "q", "e", "g", "p", "r", "c", "[", "]", "-", "=", "+", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", " "].includes(key)) {
        event.preventDefault();
      }
      if (replayActive) {
        if (key === "escape" && !event.repeat) {
          releaseAllControls();
          stopReplay();
        }
        if (key === " " && !event.repeat) toggleReplayPaused();
        if (key === "arrowleft" && !event.repeat) seekReplay(replayProgressValue.current - .06);
        if (key === "arrowright" && !event.repeat) seekReplay(replayProgressValue.current + .06);
        if (key === "c" && !event.repeat) cycleReplayCamera();
        if (key === "r" && !event.repeat) toggleReplayDirector();
        if (key === "[" && !event.repeat) cycleReplaySpeed(-1);
        if (key === "]" && !event.repeat) cycleReplaySpeed(1);
        return;
      }
      if (key === "p" && !event.repeat) {
        if (paused) return;
        releaseAllControls();
        setPhotoMode(!photoMode);
        if (!photoMode) setPhotoStatus(photoFile.current ? "ready" : "idle");
        haptic(5);
        return;
      }
      if (photoMode) {
        if (key === "escape") {
          releaseAllControls();
          setPhotoMode(false);
        }
        if (key === "c" && !event.repeat) {
          controls.current.lookYaw = 0;
          controls.current.lookPitch = 0;
          setCameraMode((current) => nextCameraMode(current));
          haptic(5);
        }
        if (key === "r" && !event.repeat) {
          controls.current.lookYaw = 0;
          controls.current.lookPitch = 0;
          haptic(4);
        }
        if (key === "[") nudgePhotoFocalLength(-1);
        if (key === "]") nudgePhotoFocalLength(1);
        if (key === "-") selectPhotoExposure(photoExposure - .2);
        if (key === "=" || key === "+") selectPhotoExposure(photoExposure + .2);
        if (key === "g" && !event.repeat) cyclePhotoGuide();
        return;
      }
      if (key === "w" || key === "arrowup") controls.current.forward = true;
      if (key === "s" || key === "arrowdown") controls.current.back = true;
      if (key === "a" || key === "arrowleft") controls.current.left = true;
      if (key === "d" || key === "arrowright") controls.current.right = true;
      if (key === "q") controls.current.balance = -1;
      if (key === "e") controls.current.balance = 1;
      if (key === "shift") controls.current.sprint = true;
      if (key === " ") controls.current.action = true;
      if (key === "c" && !event.repeat) {
        controls.current.lookYaw = 0;
        controls.current.lookPitch = 0;
        setCameraMode((current) => nextCameraMode(current));
        haptic(7);
      }
      if (key === "r" && !event.repeat) {
        controls.current.lookYaw = 0;
        controls.current.lookPitch = 0;
        haptic(4);
      }
      if (key === "escape") setPaused((value) => !value);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "w" || key === "arrowup") controls.current.forward = false;
      if (key === "s" || key === "arrowdown") controls.current.back = false;
      if (key === "a" || key === "arrowleft") controls.current.left = false;
      if (key === "d" || key === "arrowright") controls.current.right = false;
      if (key === "q" && controls.current.balance < 0) controls.current.balance = 0;
      if (key === "e" && controls.current.balance > 0) controls.current.balance = 0;
      if (key === "shift") controls.current.sprint = false;
      if (key === " ") controls.current.action = false;
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    return () => {
      releaseAllControls();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [cyclePhotoGuide, cycleReplayCamera, cycleReplaySpeed, nudgePhotoFocalLength, paused, photoExposure, photoMode, replayActive, screen, seekReplay, selectPhotoExposure, stopReplay, toggleReplayDirector, toggleReplayPaused]);

  useEffect(() => {
    if (screen !== "game" || !navigator.getGamepads) {
      return;
    }
    let frame = 0;
    let lastFrame = performance.now();
    let connected = false;
    let cameraButton = false;
    let pauseButton = false;
    let centerButton = false;
    let replayActionButton = false;
    let replayLeftSeekButton = false;
    let replayRightSeekButton = false;
    let replayDirectorButton = false;

    const clearGamepad = () => {
      controls.current.gamepadConnected = false;
      controls.current.gamepadActive = false;
      controls.current.gamepadMoveX = 0;
      controls.current.gamepadMoveY = 0;
      controls.current.gamepadBalance = 0;
      controls.current.gamepadAction = false;
      controls.current.gamepadSprint = false;
    };

    const poll = (now: number) => {
      const delta = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      const gamepads = Array.from(navigator.getGamepads());
      const gamepad = gamepads.find((candidate) => candidate?.connected && candidate.mapping === "standard")
        ?? gamepads.find((candidate) => candidate?.connected)
        ?? null;
      const nextConnected = Boolean(gamepad);
      if (nextConnected !== connected) {
        connected = nextConnected;
        setGamepadConnected(nextConnected);
        if (nextConnected) haptic([6, 14, 9]);
      }
      if (!gamepad) {
        clearGamepad();
        frame = window.requestAnimationFrame(poll);
        return;
      }

      const axisX = gamepadAxis(gamepad.axes[0]);
      const axisY = -gamepadAxis(gamepad.axes[1]);
      const dpadX = (gamepad.buttons[15]?.pressed ? 1 : 0) - (gamepad.buttons[14]?.pressed ? 1 : 0);
      const dpadY = (gamepad.buttons[12]?.pressed ? 1 : 0) - (gamepad.buttons[13]?.pressed ? 1 : 0);
      const moveX = Math.abs(axisX) > .01 ? axisX : dpadX;
      const moveY = Math.abs(axisY) > .01 ? axisY : dpadY;
      const lookX = gamepadAxis(gamepad.axes[2], .18);
      const lookY = gamepadAxis(gamepad.axes[3], .18);
      const leftTrigger = gamepad.buttons[6]?.value ?? 0;
      const rightTrigger = gamepad.buttons[7]?.value ?? 0;
      const balance = THREEClamp(rightTrigger - leftTrigger, -1, 1);
      const action = Boolean(gamepad.buttons[0]?.pressed || gamepad.buttons[2]?.pressed);
      const sprint = Boolean(gamepad.buttons[4]?.pressed || gamepad.buttons[10]?.pressed);
      const hasActivity = Math.max(
        Math.abs(moveX),
        Math.abs(moveY),
        Math.abs(lookX),
        Math.abs(lookY),
        Math.abs(balance),
        action ? 1 : 0,
        sprint ? 1 : 0,
      ) > .025;

      controls.current.gamepadConnected = true;
      controls.current.gamepadMoveX = moveX;
      controls.current.gamepadMoveY = moveY;
      controls.current.gamepadBalance = balance;
      controls.current.gamepadAction = action;
      controls.current.gamepadSprint = sprint;
      if (hasActivity) controls.current.gamepadActive = true;
      if (Math.abs(lookX) > .01 || Math.abs(lookY) > .01) {
        const yaw = controls.current.lookYaw - lookX * delta * 2.42;
        controls.current.lookYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        controls.current.lookPitch = THREEClamp(controls.current.lookPitch - lookY * delta * 1.62, -1.35, 1.35);
      }

      const nextReplayActionButton = replayActive && Boolean(gamepad.buttons[0]?.pressed);
      if (nextReplayActionButton && !replayActionButton) toggleReplayPaused();
      replayActionButton = nextReplayActionButton;
      const nextReplayLeftSeekButton = replayActive && Boolean(gamepad.buttons[4]?.pressed);
      if (nextReplayLeftSeekButton && !replayLeftSeekButton) seekReplay(replayProgressValue.current - .06);
      replayLeftSeekButton = nextReplayLeftSeekButton;
      const nextReplayRightSeekButton = replayActive && Boolean(gamepad.buttons[5]?.pressed);
      if (nextReplayRightSeekButton && !replayRightSeekButton) seekReplay(replayProgressValue.current + .06);
      replayRightSeekButton = nextReplayRightSeekButton;
      const nextReplayDirectorButton = replayActive && Boolean(gamepad.buttons[3]?.pressed);
      if (nextReplayDirectorButton && !replayDirectorButton) cycleReplayCamera();
      replayDirectorButton = nextReplayDirectorButton;

      const nextCameraButton = Boolean(gamepad.buttons[5]?.pressed);
      if (!replayActive && nextCameraButton && !cameraButton) {
        controls.current.lookYaw = 0;
        controls.current.lookPitch = 0;
        setCameraMode((current) => nextCameraMode(current));
        haptic(7);
      }
      cameraButton = nextCameraButton;
      const nextCenterButton = Boolean(gamepad.buttons[11]?.pressed);
      if (nextCenterButton && !centerButton) {
        controls.current.lookYaw = 0;
        controls.current.lookPitch = 0;
        haptic(4);
      }
      centerButton = nextCenterButton;
      const nextPauseButton = Boolean(gamepad.buttons[9]?.pressed);
      if (nextPauseButton && !pauseButton) {
        if (replayActive) {
          stopReplay();
        } else {
          if (photoMode) setPhotoMode(false);
          else setPaused((current) => !current);
          haptic(6);
        }
      }
      pauseButton = nextPauseButton;
      frame = window.requestAnimationFrame(poll);
    };

    frame = window.requestAnimationFrame(poll);
    return () => {
      window.cancelAnimationFrame(frame);
      clearGamepad();
      setGamepadConnected(false);
    };
  }, [cycleReplayCamera, photoMode, replayActive, screen, seekReplay, stopReplay, toggleReplayPaused]);

  useEffect(() => {
    const releaseAllControls = () => {
      controls.current.forward = false;
      controls.current.back = false;
      controls.current.left = false;
      controls.current.right = false;
      controls.current.sprint = false;
      controls.current.action = false;
      controls.current.moveX = 0;
      controls.current.moveY = 0;
      controls.current.gamepadActive = false;
      controls.current.gamepadMoveX = 0;
      controls.current.gamepadMoveY = 0;
      controls.current.gamepadBalance = 0;
      controls.current.gamepadAction = false;
      controls.current.gamepadSprint = false;
      joystickPointer.current = null;
      joystickBounds.current = null;
      balancePointer.current = null;
      balanceBounds.current = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") releaseAllControls();
    };
    window.addEventListener("blur", releaseAllControls);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseAllControls);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const from = previousPhase.current;
    if (from !== stats.phase) {
      if (stats.phase === "riding" && !stats.waveEngaged) {
        audio.current?.effect("release");
        haptic([7, 18, 9]);
      }
      if (stats.phase === "driving" || from === "driving") {
        audio.current?.effect("door");
        haptic([12, 26, 18]);
      }
      if (stats.phase === "wipeout") {
        audio.current?.effect("wipeout");
        haptic([34, 36, 58]);
        splashLens(1, 6.4);
      }
      previousPhase.current = stats.phase;
    }
    const takeoffCommitted = stats.phase === "paddling" && stats.takeoffCommitProgress > .02;
    if (takeoffCommitted && !previousTakeoffCommit.current) {
      audio.current?.effect("release");
      haptic([8, 18, 8, 24, 12]);
    }
    previousTakeoffCommit.current = takeoffCommitted;
    if (stats.phase === "wipeout" && stats.leashTension >= .64 && !leashTaut.current) {
      audio.current?.effect("leash");
      haptic([9, 24, 15]);
      leashTaut.current = true;
    } else if (stats.phase !== "wipeout" || stats.leashTension < .28) {
      leashTaut.current = false;
    }
    const resurfacing = stats.phase === "wipeout" && stats.holdDownSeconds <= .7;
    if (resurfacing && !previousResurface.current) haptic([6, 18, 10]);
    previousResurface.current = resurfacing;
    audio.current?.setPerspective(
      stats.cameraHeading,
      settings.windDirection,
      settings.coastHeading,
      stats.phase,
    );
    audio.current?.setVehicle(
      paused ? 0 : stats.speed,
      !paused && stats.vehicleMode,
      stats.vehicleThrottle,
      stats.vehicleOffRoad,
      stats.vehicleSlip,
      stats.vehicleMode && stats.vehicleThrottle < -.08 && stats.vehicleGear === "D",
    );
    audio.current?.setWaveField(
      stats.phase,
      stats.setEnergy,
      stats.shorebreakIntensity,
      stats.takeoffOpportunity,
      stats.lineSide,
      stats.sectionPressure,
      effectiveFaceHeight,
      settings.wavePeriod,
      settings.waveDirection,
      settings.swellHeight,
      settings.swellPeriod,
      settings.swellDirection,
      screen === "game" && !paused,
      stats.cameraHeading,
    );
    audio.current?.setEnvironment(
      settings.windSpeed,
      effectiveFaceHeight,
      sessionCloudCover,
      paused ? 0.34 : screen === "game" ? .4 + stats.sessionIntro * .6 : .42,
      sessionWeatherCode,
    );
    audio.current?.setCoastSoundscape(
      coastBiome,
      stats.phase,
      stats.offshoreDistance,
      settings.windSpeed,
      settings.timeOfDay,
      sessionWeatherCode,
      screen === "game" && !paused,
    );
    audio.current?.setSubmersion(
      paused
        ? 0
        : stats.submersion,
      stats.wipeoutPower,
      stats.breath,
    );
    audio.current?.setAthlete(
      stats.phase,
      paused ? 0 : stats.paddleEffort,
      stats.stamina,
      paused ? 0 : stats.submersion,
      stats.breath,
      paused ? 0 : stats.speed,
      screen === "game" && !paused && !photoMode && !replayActive,
    );
    const movementSpeed = stats.phase === "paddling" ? stats.speed * stats.paddleEffort : stats.speed;
    audio.current?.setMovement(
      stats.phase,
      paused ? 0 : movementSpeed,
      !paused && !stats.vehicleMode,
    );
  }, [coastBiome, effectiveFaceHeight, paused, photoMode, replayActive, requestRideFrame, screen, sessionCloudCover, sessionWeatherCode, settings.coastHeading, settings.swellDirection, settings.swellHeight, settings.swellPeriod, settings.timeOfDay, settings.waveDirection, settings.wavePeriod, settings.windDirection, settings.windSpeed, splashLens, stats.acceleration, stats.barrelIntensity, stats.breath, stats.cameraHeading, stats.duckDiveActive, stats.duckDiveQuality, stats.facePosition, stats.holdDownSeconds, stats.lateralForce, stats.leashTension, stats.lineSide, stats.offshoreDistance, stats.paddleEffort, stats.phase, stats.railGrip, stats.railLoad, stats.sectionPressure, stats.sessionIntro, stats.setEnergy, stats.shorebreakIntensity, stats.speed, stats.stamina, stats.submersion, stats.takeoffCommitProgress, stats.takeoffOpportunity, stats.takeoffQuality, stats.trickCharge, stats.vehicleGear, stats.vehicleMode, stats.vehicleOffRoad, stats.vehicleSlip, stats.vehicleThrottle, stats.waveEngaged, stats.wipeoutPower]);

  useEffect(() => {
    const phase = replayActive ? "riding" : stats.phase;
    const speed = replayActive ? replayTelemetry.speed : stats.speed;
    const barrel = replayActive ? replayTelemetry.barrel : stats.barrelIntensity;
    const railLoad = replayActive ? replayTelemetry.railLoad : stats.railLoad;
    const railGrip = replayActive ? replayTelemetry.railGrip : stats.railGrip;
    const whitewater = replayActive ? replayTelemetry.whitewater : stats.whitewaterPressure;
    const facePosition = replayActive ? replayTelemetry.facePosition : stats.facePosition;
    const active = screen === "game" && !paused;
    audio.current?.setSurf(
      active ? speed : 0,
      active && phase === "riding",
      stats.setEnergy,
      barrel,
      railLoad,
      railGrip,
      replayActive ? 0 : stats.trickCharge,
      facePosition,
      replayActive ? 0 : stats.acceleration,
      replayActive ? 0 : stats.lateralForce,
      whitewater,
    );
    audio.current?.setScore(
      phase,
      stats.setEnergy,
      barrel,
      settings.timeOfDay,
      sessionWeatherCode,
      active,
    );
    audio.current?.setAcousticSpace(phase, barrel, active);
  }, [paused, replayActive, replayTelemetry.barrel, replayTelemetry.facePosition, replayTelemetry.railGrip, replayTelemetry.railLoad, replayTelemetry.speed, replayTelemetry.whitewater, screen, sessionWeatherCode, settings.timeOfDay, stats.acceleration, stats.barrelIntensity, stats.facePosition, stats.lateralForce, stats.phase, stats.railGrip, stats.railLoad, stats.setEnergy, stats.speed, stats.trickCharge, stats.whitewaterPressure]);

  useEffect(() => {
    if (
      screen !== "game"
      || paused
      || photoMode
      || replayActive
      || stats.sessionIntro < .78
    ) return;
    if (stats.phase === "riding") {
      const speed = THREEClamp((stats.speed - 5.5) / 12, 0, 1);
      const rail = THREEClamp(Math.abs(stats.railLoad), 0, 1);
      const slip = THREEClamp(1 - stats.railGrip, 0, 1);
      const cornering = THREEClamp(Math.abs(stats.lateralForce), 0, 1);
      const drive = THREEClamp(stats.acceleration, 0, 1);
      const braking = THREEClamp(-stats.acceleration, 0, 1);
      const foam = THREEClamp(stats.whitewaterPressure, 0, 1);
      const faceTexture = stats.setEnergy * (.2 + stats.sectionPressure * .3);
      surfaceHaptic(
        speed * (rail * .27 + cornering * .23 + braking * .12 + stats.barrelIntensity * .18 + foam * .34),
        speed * (.035 + rail * .18 + slip * .5 + faceTexture * .12 + drive * .08 + stats.barrelIntensity * .12 + foam * .46),
        Math.max(slip, rail * speed, cornering * .72, stats.barrelIntensity * .52, foam * .96) * speed,
      );
      return;
    }
    if (stats.vehicleMode) {
      const speed = THREEClamp(stats.speed / 18.5, 0, 1);
      const looseSurface = Math.max(stats.vehicleOffRoad, stats.vehicleSlip);
      const engineLoad = Math.abs(stats.vehicleThrottle);
      surfaceHaptic(
        speed * (stats.vehicleOffRoad * .34 + stats.vehicleSlip * .44) + engineLoad * .075,
        speed * (.045 + stats.vehicleOffRoad * .28 + stats.vehicleSlip * .46) + engineLoad * .055,
        looseSurface * speed,
      );
    }
  }, [paused, photoMode, replayActive, screen, stats.acceleration, stats.barrelIntensity, stats.lateralForce, stats.phase, stats.railGrip, stats.railLoad, stats.sectionPressure, stats.sessionIntro, stats.setEnergy, stats.speed, stats.vehicleMode, stats.vehicleOffRoad, stats.vehicleSlip, stats.vehicleThrottle, stats.whitewaterPressure]);

  useEffect(() => {
    if (stats.duckDiveReady && !previousDuckDiveReady.current) haptic([5, 18, 8]);
    previousDuckDiveReady.current = stats.duckDiveReady;
  }, [stats.duckDiveReady]);

  useEffect(() => {
    const warning = stats.vehicleMode && stats.vehicleSlip > .24;
    if (warning && !previousVehicleSlipWarning.current) haptic([8, 18, 8]);
    previousVehicleSlipWarning.current = warning;
  }, [stats.vehicleMode, stats.vehicleSlip]);

  useEffect(() => {
    if (stats.phase !== "riding" || stats.whitewaterPressure < .24) {
      previousWhitewaterImpact.current = false;
      return;
    }
    if (stats.whitewaterPressure > .56 && !previousWhitewaterImpact.current) {
      haptic([9, 12, 16]);
      previousWhitewaterImpact.current = true;
    }
  }, [stats.phase, stats.whitewaterPressure]);

  useEffect(() => {
    const faceZone = stats.phase === "riding"
      ? stats.facePosition > .62
        ? 1
        : stats.facePosition < -.62
          ? -1
          : 0
      : 0;
    if (faceZone !== 0 && faceZone !== previousFaceZone.current) {
      haptic(faceZone > 0 ? [5, 12, 7] : [8, 16, 8]);
    }
    previousFaceZone.current = faceZone;
  }, [stats.facePosition, stats.phase]);

  useEffect(() => {
    const loaded = stats.phase === "riding"
      && Math.abs(stats.lateralForce) > .68
      && stats.railGrip > .42;
    if (loaded && !previousHydrodynamicLoad.current) haptic([5, 10, 7]);
    previousHydrodynamicLoad.current = loaded;
  }, [stats.lateralForce, stats.phase, stats.railGrip]);

  useEffect(() => {
    if (stats.shorebreakId <= 0 || stats.shorebreakId === previousShorebreakId.current) return;
    previousShorebreakId.current = stats.shorebreakId;
    const clean = stats.shorebreakResult === "clean";
    setShorebreakToast({ id: stats.shorebreakId, result: clean ? "clean" : "hit", quality: stats.duckDiveQuality });
    audio.current?.effect(clean ? "duck" : "shorebreak");
    haptic(clean ? [7, 16, 10] : [18, 20, 28]);
    splashLens(clean ? .42 + stats.duckDiveQuality * .22 : .88, clean ? 4.2 : 5.5);
    if (shorebreakToastTimer.current !== null) window.clearTimeout(shorebreakToastTimer.current);
    shorebreakToastTimer.current = window.setTimeout(() => {
      setShorebreakToast(null);
      shorebreakToastTimer.current = null;
    }, 1550);
  }, [splashLens, stats.duckDiveQuality, stats.shorebreakId, stats.shorebreakResult]);

  useEffect(() => {
    const railSpray = stats.phase === "riding"
      && stats.speed > 10.5
      && Math.abs(stats.railLoad) > .68
      && stats.railGrip > .45;
    const curtainWash = stats.phase === "riding" && stats.barrelIntensity > .62;
    const sprayHit = railSpray || curtainWash;
    if (sprayHit && !previousSprayHit.current) {
      const pressure = Math.max(Math.abs(stats.railLoad), stats.barrelIntensity);
      splashLens(.24 + pressure * .22, 3.25 + pressure * .8);
    }
    previousSprayHit.current = sprayHit;
  }, [splashLens, stats.barrelIntensity, stats.phase, stats.railGrip, stats.railLoad, stats.speed]);

  useEffect(() => () => {
    if (shorebreakToastTimer.current !== null) window.clearTimeout(shorebreakToastTimer.current);
  }, []);

  useEffect(() => {
    if (stats.maneuverActive && !previousManeuverActive.current) {
      audio.current?.effect("release");
      haptic(8);
    }
    previousManeuverActive.current = stats.maneuverActive;
  }, [stats.maneuverActive]);

  useEffect(() => {
    if (stats.phase !== "riding" || stats.maneuverActive) {
      previousChargeBand.current = 0;
      return;
    }
    const band = Math.floor(stats.trickCharge * 4.01);
    if (band > previousChargeBand.current) haptic(band >= 4 ? [6, 18, 9] : 4);
    previousChargeBand.current = band;
  }, [stats.maneuverActive, stats.phase, stats.trickCharge]);

  useEffect(() => {
    if (stats.phase !== "riding") {
      previousBalanceLock.current = false;
      return;
    }
    const tolerance = stats.maneuverActive ? Math.max(.09, stats.landingWindow * .58) : .13;
    const locked = Math.abs(stats.balance - stats.balanceTarget) <= tolerance;
    const now = performance.now();
    if (locked && !previousBalanceLock.current && now - lastBalanceHapticAt.current > 360) {
      haptic(stats.maneuverActive ? 8 : 4);
      lastBalanceHapticAt.current = now;
    }
    previousBalanceLock.current = locked;
  }, [stats.balance, stats.balanceTarget, stats.landingWindow, stats.maneuverActive, stats.phase]);

  useEffect(() => {
    if (stats.phase !== "riding") {
      previousGripWarning.current = false;
      previousPocketLock.current = false;
      return;
    }
    const gripWarning = stats.railGrip < .48;
    const pocketLock = stats.lineControl > .82 && stats.sectionPressure < .38;
    if (gripWarning && !previousGripWarning.current) haptic([10, 16, 10]);
    if (pocketLock && !previousPocketLock.current) haptic(5);
    previousGripWarning.current = gripWarning;
    previousPocketLock.current = pocketLock;
  }, [stats.lineControl, stats.phase, stats.railGrip, stats.sectionPressure]);

  useEffect(() => {
    if (stats.maneuverId > 0 && stats.maneuverId !== previousManeuverId.current) {
      previousManeuverId.current = stats.maneuverId;
      setManeuverToast({ id: stats.maneuverId, name: stats.maneuver, points: stats.maneuverScore, quality: stats.maneuverQuality });
      const captureQuality = .62 + stats.maneuverQuality * .23 + Math.min(.08, stats.maneuverScore / 12000);
      if (maneuverCaptureCount.current < 2 && captureQuality > requestedCaptureQuality.current + .045) {
        maneuverCaptureCount.current += 1;
        requestRideFrame(captureQuality);
      }
      audio.current?.effect("turn");
      haptic(stats.maneuverQuality >= .82 ? [9, 16, 24] : 12);
      const timer = window.setTimeout(() => setManeuverToast(null), 1800);
      return () => window.clearTimeout(timer);
    }
  }, [requestRideFrame, stats.maneuver, stats.maneuverId, stats.maneuverQuality, stats.maneuverScore]);

  useEffect(() => {
    if (stats.phase !== "riding") {
      previousBarrelCaptureBand.current = 0;
      return;
    }
    const band = stats.barrelIntensity >= .78 ? 2 : stats.barrelIntensity >= .48 ? 1 : 0;
    if (band > previousBarrelCaptureBand.current) {
      previousBarrelCaptureBand.current = band;
      requestRideFrame(.72 + stats.barrelIntensity * .24);
    }
  }, [requestRideFrame, stats.barrelIntensity, stats.phase]);

  useEffect(() => {
    const newlyEngaged = stats.waveEngaged && !previousWaveEngaged.current;
    previousWaveEngaged.current = stats.waveEngaged;
    if (!newlyEngaged) return;
    activeRideCaptureId.current += 1;
    requestedCaptureQuality.current = 0;
    maneuverCaptureCount.current = 0;
    previousBarrelCaptureBand.current = 0;
    rideFrame.current = null;
    rideCard.current = null;
    requestRideFrame(.38 + stats.takeoffQuality * .18);
  }, [requestRideFrame, stats.takeoffQuality, stats.waveEngaged]);

  useEffect(() => {
    if (stats.rideResultId > 0 && stats.rideResultId !== previousRideResultId.current && stats.rideResult) {
      previousRideResultId.current = stats.rideResultId;
      setManeuverToast(null);
      setPassportAward(null);
      if (stats.rideResult === "clean") {
        audio.current?.effect("finish");
        haptic([10, 22, 10, 28, 16]);
      }
      const completedRide: RideToast = {
        id: stats.rideResultId,
        result: stats.rideResult,
        score: stats.rideScore,
        distance: stats.rideDistance,
        pocketDistance: stats.pocketDistance,
        maneuvers: stats.rideManeuvers,
        barrelTime: stats.barrelTime,
        takeoffQuality: stats.rideTakeoffQuality,
        lineQuality: stats.rideLineQuality,
        controlQuality: stats.rideControlQuality,
        powerQuality: stats.ridePowerQuality,
        maxSpeed: stats.rideMaxSpeed,
        maxCombo: stats.rideMaxCombo,
        grade: stats.rideGrade,
      };
      setRideToast(completedRide);
      const heatScoreTimer = sessionFormat === "heat" && !heatComplete
        ? window.setTimeout(() => {
            setHeatWaves((current) => current.some((wave) => wave.id === completedRide.id)
              ? current
              : [...current, { ...completedRide, judgeScore: judgeHeatWave(completedRide) }]);
          }, 0)
        : null;
      setShareStatus("idle");
      const timer = window.setTimeout(() => setRideToast(null), 10800);
      return () => {
        if (heatScoreTimer !== null) window.clearTimeout(heatScoreTimer);
        window.clearTimeout(timer);
      };
    }
  }, [heatComplete, sessionFormat, stats.barrelTime, stats.pocketDistance, stats.rideControlQuality, stats.rideDistance, stats.rideGrade, stats.rideLineQuality, stats.rideManeuvers, stats.rideMaxCombo, stats.rideMaxSpeed, stats.ridePowerQuality, stats.rideResult, stats.rideResultId, stats.rideScore, stats.rideTakeoffQuality]);

  useEffect(() => {
    if (sessionFormat !== "heat" || !heatExpired || heatComplete) return;
    if (stats.phase === "riding" && !stats.rideResult) return;
    if (stats.rideResult && !heatWaves.some((wave) => wave.id === stats.rideResultId)) return;
    const timer = window.setTimeout(() => {
      clearAnalogMovement();
      if (document.pointerLockElement === cameraLookSurface.current) document.exitPointerLock();
      setHeatComplete(true);
      audio.current?.effect("coach");
      haptic(heatWon ? [12, 22, 12, 28, 18, 38] : [8, 20, 10]);
    }, stats.rideResult ? 900 : 180);
    return () => window.clearTimeout(timer);
  }, [heatComplete, heatExpired, heatTotal, heatWaves, heatWon, sessionFormat, stats.phase, stats.rideResult, stats.rideResultId]);

  useEffect(() => {
    if (!heatComplete || heatRecordCommitted.current) return;
    heatRecordCommitted.current = true;
    setPassport((current) => {
      const previous = current[beach.id] ?? EMPTY_COAST_RECORD;
      return {
        ...current,
        [beach.id]: {
          ...previous,
          bestHeat: Math.max(previous.bestHeat, heatTotal),
          heatWins: previous.heatWins + (heatWon ? 1 : 0),
          lastZone: zoneLabel,
          lastSurfedAt: Date.now(),
        },
      };
    });
  }, [beach.id, heatComplete, heatTotal, heatWon, zoneLabel]);

  useEffect(() => {
    if (
      settings.mode === "playground"
      || !stats.rideResult
      || stats.rideResultId <= 0
      || stats.rideResultId === previousPassportRideResultId.current
    ) return;
    previousPassportRideResultId.current = stats.rideResultId;
    const completedRide: RideToast = {
      id: stats.rideResultId,
      result: stats.rideResult,
      score: stats.rideScore,
      distance: stats.rideDistance,
      pocketDistance: stats.pocketDistance,
      maneuvers: stats.rideManeuvers,
      barrelTime: stats.barrelTime,
      takeoffQuality: stats.rideTakeoffQuality,
      lineQuality: stats.rideLineQuality,
      controlQuality: stats.rideControlQuality,
      powerQuality: stats.ridePowerQuality,
      maxSpeed: stats.rideMaxSpeed,
      maxCombo: stats.rideMaxCombo,
      grade: stats.rideGrade,
    };
    const previousRecord = passport[beach.id] ?? EMPTY_COAST_RECORD;
    const earnedMastery = masteryForRide(completedRide);
    const nextMastery = Math.max(previousRecord.mastery, earnedMastery);
    const bestGrade = gradeRank(completedRide.grade) > gradeRank(previousRecord.bestGrade)
      ? completedRide.grade
      : previousRecord.bestGrade;
    setPassport((current) => ({
      ...current,
      [beach.id]: {
        rides: previousRecord.rides + 1,
        cleanRides: previousRecord.cleanRides + (completedRide.result === "clean" ? 1 : 0),
        bestScore: Math.max(previousRecord.bestScore, completedRide.score),
        longestLine: Math.max(previousRecord.longestLine, completedRide.distance),
        longestPocket: Math.max(previousRecord.longestPocket, completedRide.pocketDistance),
        mostManeuvers: Math.max(previousRecord.mostManeuvers, completedRide.maneuvers),
        longestBarrel: Math.max(previousRecord.longestBarrel, completedRide.barrelTime),
        bestGrade,
        mastery: nextMastery,
        bestHeat: previousRecord.bestHeat,
        heatWins: previousRecord.heatWins,
        lastZone: zoneLabel,
        lastSurfedAt: Date.now(),
      },
    }));
    if (nextMastery > previousRecord.mastery) {
      window.setTimeout(() => {
        setPassportAward({ level: nextMastery, label: coastMasteryLabel(nextMastery) });
        audio.current?.effect("coach");
        haptic(nextMastery >= 3 ? [14, 24, 14, 32, 24, 42] : [10, 20, 14, 26]);
      }, 0);
    }
  }, [beach.id, passport, settings.mode, stats.barrelTime, stats.pocketDistance, stats.rideControlQuality, stats.rideDistance, stats.rideGrade, stats.rideLineQuality, stats.rideManeuvers, stats.rideMaxCombo, stats.rideMaxSpeed, stats.ridePowerQuality, stats.rideResult, stats.rideResultId, stats.rideScore, stats.rideTakeoffQuality, zoneLabel]);

  useEffect(() => {
    let disposed = false;
    rideCard.current = null;
    if (!rideToast) return () => { disposed = true; };
    void rideCardFile({
      ride: rideToast,
      beach,
      zone: zoneLabel,
      board: BOARD_SPECS[settings.board].name,
      waveHeight: effectiveFaceHeight,
      wavePeriod: settings.wavePeriod,
      tourMastery: settings.mode === "playground"
        ? currentCoastRecord.mastery
        : Math.max(currentCoastRecord.mastery, masteryForRide(rideToast)),
      sceneFrame: rideFrame.current?.rideId === activeRideCaptureId.current
        ? rideFrame.current.blob
        : null,
    }).then((file) => {
      if (!disposed) rideCard.current = file;
    });
    return () => { disposed = true; };
  }, [beach, currentCoastRecord.mastery, effectiveFaceHeight, rideFrameVersion, rideToast, settings.board, settings.mode, settings.wavePeriod, zoneLabel]);

  const chooseBeach = (next: Beach) => {
    const startingZone = next.zones[Math.min(1, next.zones.length - 1)];
    setBeach(next);
    setLatitude(startingZone.lat);
    setLongitude(startingZone.lon);
    setZoneLabel(startingZone.name);
    const modeled = fallbackConditions(next);
    setConditions(modeled);
    setSettings((current) => current.mode === "playground"
      ? { ...current, coastHeading: next.heading }
      : { ...settingsFromConditions(modeled, next.heading), mode: current.mode, board: current.board });
    setSelectedForecastTime(null);
    setDestinationPickerOpen(false);
  };

  const chooseMode = (mode: GameMode) => {
    if (mode !== "advanced") setSessionFormat("free");
    if (mode === "playground") {
      setSettings((current) => ({ ...current, mode }));
    } else {
      setSettings((current) => ({ ...settingsFromConditions(sessionConditions, beach.heading), mode, board: current.board }));
    }
  };

  const selectSessionWindow = (point: MarineForecastPoint | null) => {
    const nextConditions = conditionsAtForecast(conditions, point);
    const nextSettings = settingsFromConditions(nextConditions, beach.heading);
    setSelectedForecastTime(point?.time ?? null);
    setSettings((current) => current.mode === "playground"
      ? { ...current, timeOfDay: nextSettings.timeOfDay, weatherCode: nextConditions.weatherCode }
      : { ...nextSettings, mode: current.mode, board: current.board });
    haptic(7);
  };

  function clearAnalogMovement() {
    controls.current.moveX = 0;
    controls.current.moveY = 0;
    joystickPointer.current = null;
    joystickBounds.current = null;
    if (joystickKnob.current) joystickKnob.current.style.transform = "translate3d(-50%, -50%, 0)";
  }

  function resetRideCapture() {
    activeRideCaptureId.current += 1;
    requestedCaptureQuality.current = 0;
    maneuverCaptureCount.current = 0;
    previousBarrelCaptureBand.current = 0;
    rideFrame.current = null;
    rideCard.current = null;
    setCaptureRequest(null);
  }

  function resetReplayStudio() {
    replayProgressValue.current = 0;
    setReplayReady(false);
    setReplayActive(false);
    setReplayProgress(0);
    setReplayDuration(0);
    setReplayRide(null);
    setReplayPaused(false);
    setReplaySpeed(1);
    setReplaySeekProgress(0);
    setReplaySeekRequest((request) => request + 1);
    setReplayAutoDirector(true);
    setReplayTelemetry(EMPTY_REPLAY_TELEMETRY);
    setReplayMoments([]);
    replayResumeAfterScrub.current = false;
    replayCameraCut.current = null;
  }

  function resetHeatSession() {
    heatRemainingValue.current = HEAT_DURATION_SECONDS;
    heatStarted.current = false;
    heatLastSecond.current = HEAT_DURATION_SECONDS;
    heatRecordCommitted.current = false;
    setHeatRemaining(HEAT_DURATION_SECONDS);
    setHeatWaves([]);
    setHeatExpired(false);
    setHeatComplete(false);
  }

  const startSession = async () => {
    if (!audio.current) audio.current = new SurfscapeAudio();
    await audio.current.start();
    audio.current.setEnabled(soundEnabled);
    audio.current.setMusicEnabled(musicEnabled);
    audio.current.setPerspective(0, settings.windDirection, settings.coastHeading, "shore");
    audio.current.setEnvironment(settings.windSpeed, effectiveFaceHeight, sessionCloudCover, .34, sessionWeatherCode);
    audio.current.setCoastSoundscape(coastBiome, "shore", 0, settings.windSpeed, settings.timeOfDay, sessionWeatherCode, true);
    audio.current.setWaveField("shore", 0, 0, 0, 1, 0, effectiveFaceHeight, settings.wavePeriod, settings.waveDirection, settings.swellHeight, settings.swellPeriod, settings.swellDirection, true, 0);
    audio.current.setScore("shore", 0, 0, settings.timeOfDay, sessionWeatherCode, true);
    audio.current.setMovement("shore", 0, true);
    controls.current = { ...EMPTY_CONTROLS };
    clearAnalogMovement();
    resetRideCapture();
    photoFile.current = null;
    setPhotoMode(false);
    setPhotoStatus("idle");
    resetReplayStudio();
    resetHeatSession();
    setStats(INITIAL_STATS);
    trainingStepValue.current = 0;
    setTrainingStep(0);
    previousManeuverId.current = 0;
    previousRideResultId.current = 0;
    previousPassportRideResultId.current = 0;
    setManeuverToast(null);
    setRideToast(null);
    setPassportAward(null);
    setWetLens(null);
    setShareStatus("idle");
    setSessionKey((value) => value + 1);
    setHudMenuOpen(false);
    setHudPanel("ocean");
    setPaused(false);
    setScreen("game");
  };

  const leaveSession = () => {
    audio.current?.setVehicle(0, false);
    audio.current?.setSurf(0, false, 0, 0);
    audio.current?.setWaveField("shore", 0, 0, 0, 1, 0, effectiveFaceHeight, settings.wavePeriod, settings.waveDirection, settings.swellHeight, settings.swellPeriod, settings.swellDirection, false, 0);
    audio.current?.setScore("shore", 0, 0, settings.timeOfDay, sessionWeatherCode, false);
    audio.current?.setMovement(stats.phase, 0, false);
    audio.current?.setEnvironment(settings.windSpeed, effectiveFaceHeight, sessionCloudCover, 0.42, sessionWeatherCode);
    audio.current?.setCoastSoundscape(coastBiome, stats.phase, stats.offshoreDistance, settings.windSpeed, settings.timeOfDay, sessionWeatherCode, false);
    controls.current = { ...EMPTY_CONTROLS };
    clearAnalogMovement();
    resetRideCapture();
    photoFile.current = null;
    setPhotoMode(false);
    setPhotoStatus("idle");
    resetReplayStudio();
    resetHeatSession();
    setWetLens(null);
    setHudMenuOpen(false);
    setScreen("launch");
    setPaused(false);
  };

  const restartSession = () => {
    controls.current = { ...EMPTY_CONTROLS };
    clearAnalogMovement();
    resetRideCapture();
    resetReplayStudio();
    resetHeatSession();
    photoFile.current = null;
    setPhotoMode(false);
    setPhotoStatus("idle");
    previousPhase.current = "shore";
    previousWaveEngaged.current = false;
    previousManeuverId.current = 0;
    previousRideResultId.current = 0;
    previousPassportRideResultId.current = 0;
    setManeuverToast(null);
    setRideToast(null);
    setPassportAward(null);
    setStats(INITIAL_STATS);
    setWetLens(null);
    setShareStatus("idle");
    trainingStepValue.current = 0;
    setTrainingStep(0);
    setSessionKey((value) => value + 1);
    setPaused(false);
  };

  const toggleSound = async () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (!audio.current) audio.current = new SurfscapeAudio();
    await audio.current.start();
    audio.current.setEnabled(next);
    if (next) {
      audio.current.setPerspective(stats.cameraHeading, settings.windDirection, settings.coastHeading, stats.phase);
      audio.current.setEnvironment(settings.windSpeed, effectiveFaceHeight, sessionCloudCover, screen === "game" ? 1 : 0.42, sessionWeatherCode);
      audio.current.setCoastSoundscape(
        coastBiome,
        stats.phase,
        stats.offshoreDistance,
        settings.windSpeed,
        settings.timeOfDay,
        sessionWeatherCode,
        screen === "game" && !paused,
      );
      audio.current.setWaveField(
        stats.phase,
        stats.setEnergy,
        stats.shorebreakIntensity,
        stats.takeoffOpportunity,
        stats.lineSide,
        stats.sectionPressure,
        effectiveFaceHeight,
        settings.wavePeriod,
        settings.waveDirection,
        settings.swellHeight,
        settings.swellPeriod,
        settings.swellDirection,
        screen === "game" && !paused,
        stats.cameraHeading,
      );
    }
  };

  const toggleMusic = async () => {
    const next = !musicEnabled;
    setMusicEnabled(next);
    if (!audio.current) audio.current = new SurfscapeAudio();
    await audio.current.start();
    audio.current.setMusicEnabled(next);
    audio.current.setScore(stats.phase, stats.setEnergy, stats.barrelIntensity, settings.timeOfDay, sessionWeatherCode, screen === "game" && !paused);
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  };

  const toggleMotionBalance = async () => {
    if (motionBalanceStatus === "requesting" || motionBalanceStatus === "checking") return;
    if (motionBalanceStatus === "active") {
      motionBalanceOrigin.current = null;
      motionBalanceValue.current = 0;
      controls.current.balance = 0;
      setMotionBalanceStatus("idle");
      haptic(5);
      return;
    }
    if (motionBalanceStatus === "unavailable") return;
    setMotionBalanceStatus("requesting");
    try {
      const orientationApi = (window as Window & {
        DeviceOrientationEvent?: DeviceOrientationPermissionApi;
      }).DeviceOrientationEvent;
      const permission = orientationApi?.requestPermission
        ? await orientationApi.requestPermission()
        : "granted";
      if (permission !== "granted") {
        setMotionBalanceStatus("denied");
        haptic([6, 20, 6]);
        return;
      }
      motionBalanceOrigin.current = null;
      motionBalanceValue.current = 0;
      controls.current.balance = 0;
      setMotionBalanceStatus("active");
      haptic([7, 16, 11]);
    } catch {
      setMotionBalanceStatus("denied");
      haptic([6, 20, 6]);
    }
  };

  const setControl = (name: keyof Pick<ControlState, "forward" | "back" | "left" | "right" | "action" | "sprint">, value: boolean) => {
    controls.current[name] = value;
  };

  const beginControl = (
    event: ReactPointerEvent<HTMLButtonElement>,
    name: keyof Pick<ControlState, "forward" | "back" | "left" | "right" | "action" | "sprint">,
  ) => {
    event.preventDefault();
    controls.current.gamepadActive = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    setControl(name, true);
    if (name === "action" || name === "sprint") haptic(9);
  };

  const endMobileAction = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setControl("forward", false);
    setControl("action", false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const endMobileDive = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setControl("sprint", false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const updateJoystick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (paused) return;
    event.preventDefault();
    if (event.type === "pointerdown") {
      controls.current.gamepadActive = false;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      joystickPointer.current = event.pointerId;
      joystickBounds.current = event.currentTarget.getBoundingClientRect();
      haptic(4);
    }
    if (joystickPointer.current !== event.pointerId) return;
    const bounds = joystickBounds.current ?? event.currentTarget.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) * 0.31;
    let x = event.clientX - (bounds.left + bounds.width / 2);
    let y = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(x, y);
    if (distance > radius) {
      x *= radius / distance;
      y *= radius / distance;
    }
    const normalizedX = x / radius;
    const normalizedY = -y / radius;
    controls.current.moveX = Math.abs(normalizedX) < 0.08 ? 0 : normalizedX;
    controls.current.moveY = Math.abs(normalizedY) < 0.08 ? 0 : normalizedY;
    if (joystickKnob.current) {
      joystickKnob.current.style.transform = `translate3d(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px), 0)`;
    }
  };

  const endJoystick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (joystickPointer.current !== event.pointerId) return;
    event.preventDefault();
    clearAnalogMovement();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const updateTouchBalance = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (motionBalanceStatus === "active") return;
    event.preventDefault();
    if (event.type === "pointerdown") {
      controls.current.gamepadActive = false;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      balancePointer.current = event.pointerId;
      balanceBounds.current = event.currentTarget.getBoundingClientRect();
      haptic(3);
    }
    if (balancePointer.current !== event.pointerId) return;
    const bounds = balanceBounds.current ?? event.currentTarget.getBoundingClientRect();
    controls.current.balance = THREEClamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2, -1, 1);
  };

  const endTouchBalance = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (balancePointer.current !== event.pointerId) return;
    event.preventDefault();
    balancePointer.current = null;
    balanceBounds.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const beginCameraLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (paused) return;
    event.preventDefault();
    controls.current.gamepadActive = false;
    if (event.pointerType === "mouse" && document.pointerLockElement !== event.currentTarget) {
      const lookSurface = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      void lookSurface.requestPointerLock().catch(() => {
        // Embedded and automated browsers may deny pointer lock. Preserve the
        // same gesture as drag-look instead of surfacing an unhandled rejection.
        if (!lookSurface.isConnected || document.pointerLockElement === lookSurface) return;
        try {
          lookSurface.setPointerCapture(pointerId);
        } catch {
          return;
        }
        lookSurface.classList.add("is-dragging");
        lookGesture.current = {
          pointerId,
          x: startX,
          y: startY,
          yaw: controls.current.lookYaw,
          pitch: controls.current.lookPitch,
        };
      });
      return;
    }
    if (document.pointerLockElement === event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
    lookGesture.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: controls.current.lookYaw,
      pitch: controls.current.lookPitch,
    };
  };

  const updateCameraLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = lookGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId || paused) return;
    event.preventDefault();
    const span = Math.max(320, Math.min(window.innerWidth, 900));
    const verticalSpan = Math.max(260, Math.min(window.innerHeight, 700));
    const yaw = gesture.yaw - ((event.clientX - gesture.x) / span) * Math.PI * 2.2;
    controls.current.lookYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    controls.current.lookPitch = THREEClamp(gesture.pitch - ((event.clientY - gesture.y) / verticalSpan) * 2.7, -1.35, 1.35);
  };

  const endCameraLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lookGesture.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    lookGesture.current = null;
    event.currentTarget.classList.remove("is-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const adjustPhotoLensFromWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!photoMode || Math.abs(event.deltaY) < 2) return;
    event.preventDefault();
    nudgePhotoFocalLength(event.deltaY > 0 ? -1 : 1);
  };

  const centerCameraLook = () => {
    controls.current.lookYaw = 0;
    controls.current.lookPitch = 0;
  };

  const cycleCamera = () => {
    centerCameraLook();
    setCameraMode((current) => nextCameraMode(current));
    haptic(7);
  };

  const startReplay = (ride: RideToast) => {
    if (!replayReady || replayActive) return;
    clearAnalogMovement();
    controls.current = {
      ...controls.current,
      forward: false,
      back: false,
      left: false,
      right: false,
      sprint: false,
      action: false,
      gamepadMoveX: 0,
      gamepadMoveY: 0,
      gamepadAction: false,
      gamepadSprint: false,
      lookYaw: 0,
      lookPitch: 0,
    };
    if (document.pointerLockElement === cameraLookSurface.current) document.exitPointerLock();
    preReplayCameraMode.current = cameraMode;
    replayCameraCut.current = "cinematic";
    setPhotoMode(false);
    setReplayRide(ride);
    replayProgressValue.current = 0;
    setReplayProgress(0);
    setReplayPaused(false);
    setReplaySpeed(1);
    setReplaySeekProgress(0);
    setReplaySeekRequest((request) => request + 1);
    setReplayAutoDirector(true);
    replayResumeAfterScrub.current = false;
    setReplayActive(true);
    setReplayRequest((request) => request + 1);
    setCameraMode("cinematic");
    audio.current?.effect("coach");
    audio.current?.setSurf(Math.max(10, stats.speed), true, stats.setEnergy, Math.max(.28, stats.barrelIntensity), stats.railLoad, stats.railGrip, 0, stats.facePosition, stats.acceleration, stats.lateralForce, stats.whitewaterPressure);
    audio.current?.setScore("riding", stats.setEnergy, Math.max(.28, stats.barrelIntensity), settings.timeOfDay, sessionWeatherCode, true);
    haptic([8, 18, 12]);
  };

  const openPhotoMode = () => {
    clearAnalogMovement();
    controls.current = { ...controls.current, forward: false, back: false, left: false, right: false, sprint: false, action: false };
    setPhotoStatus(photoFile.current ? "ready" : "idle");
    setPhotoMode(true);
    haptic(5);
  };

  const closePhotoMode = () => {
    clearAnalogMovement();
    setPhotoMode(false);
    haptic(4);
  };

  const capturePhoto = () => {
    captureSequence.current += 1;
    photoFile.current = null;
    setPhotoStatus("capturing");
    setCaptureRequest({
      id: captureSequence.current,
      rideId: activeRideCaptureId.current,
      quality: 1,
      purpose: "photo",
      view: "player",
      caption: `${zoneLabel} · ${beach.name} · ${localTime}`,
      focalLength: photoFocalLength,
      exposure: photoExposure,
    });
    window.setTimeout(() => {
      setPhotoStatus((current) => current === "capturing" ? "error" : current);
    }, 4200);
  };

  const savePhoto = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    setPhotoStatus("saved");
    haptic(6);
  };

  const sharePhoto = async () => {
    const file = photoFile.current;
    if (!file) {
      setPhotoStatus("error");
      return;
    }
    const shareData: ShareData = {
      title: `Surfscape · ${zoneLabel}`,
      text: `${zoneLabel}, ${beach.name} · ${effectiveFaceHeight.toFixed(1)}m at ${settings.wavePeriod.toFixed(0)}s. Captured in Surfscape.`,
      url: window.location.origin,
      files: [file],
    };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share(shareData);
        setPhotoStatus("shared");
        haptic([7, 18, 12]);
        return;
      }
      savePhoto(file);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setPhotoStatus("ready");
        return;
      }
      savePhoto(file);
    }
  };

  const shareRide = async (ride: RideToast) => {
    if (shareStatus === "working") return;
    setShareStatus("working");
    const url = window.location.origin;
    const text = `I scored ${ride.score.toLocaleString()} points on a ${ride.distance.toFixed(0)}m line at ${zoneLabel}, ${beach.name}. Grade ${ride.grade} in Surfscape. #Surfscape`;
    const copyLink = async () => {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setShareStatus("copied");
      haptic(7);
    };
    try {
      if (!rideCard.current) {
        rideCard.current = await rideCardFile({
          ride,
          beach,
          zone: zoneLabel,
          board: BOARD_SPECS[settings.board].name,
          waveHeight: effectiveFaceHeight,
          wavePeriod: settings.wavePeriod,
          tourMastery: settings.mode === "playground"
            ? currentCoastRecord.mastery
            : Math.max(currentCoastRecord.mastery, masteryForRide(ride)),
          sceneFrame: rideFrame.current?.rideId === activeRideCaptureId.current
            ? rideFrame.current.blob
            : null,
        });
      }
      if (navigator.share) {
        const shareData: ShareData = { title: `Surfscape · ${zoneLabel} · ${ride.grade}`, text, url };
        if (rideCard.current && navigator.canShare?.({ files: [rideCard.current] })) shareData.files = [rideCard.current];
        await navigator.share(shareData);
        setShareStatus("shared");
        haptic([7, 18, 12]);
        return;
      }
      await copyLink();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setShareStatus("idle");
        return;
      }
      try {
        await copyLink();
      } catch {
        setShareStatus("error");
      }
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      haptic(7);
    } catch {
      setFullscreenAvailable(false);
    }
  };

  const localTime = settings.mode === "playground" ? formatHourValue(settings.timeOfDay) : formatClock(sessionConditions.observedAt);
  const hasPhoto = photoStatus === "ready" || photoStatus === "shared" || photoStatus === "saved";
  const selectedMode = MODES.find((mode) => mode.id === settings.mode) ?? MODES[0];
  const motionBalanceActive = motionBalanceStatus === "active";
  const motionBalanceLabel = motionBalanceStatus === "requesting"
    ? "REQUESTING MOTION"
    : motionBalanceStatus === "denied"
      ? "MOTION BLOCKED"
      : motionBalanceActive
        ? "MOTION BALANCE ON"
        : "ENABLE MOTION";
  const heatNeed = Math.max(0, Math.round((heatTarget - heatTotal) * 100) / 100);
  const heatWaveForToast = rideToast
    ? heatWaves.find((wave) => wave.id === rideToast.id) ?? { ...rideToast, judgeScore: judgeHeatWave(rideToast) }
    : null;
  const rideAnalysis = rideToast ? rideAnalysisFor(rideToast, settings.board) : null;
  const replayLineLabel = replayTelemetry.whitewater > .48
    ? "IN THE FOAM"
    : replayTelemetry.linePosition < -.34
    ? "DEEP"
    : replayTelemetry.linePosition > .38
      ? "SHOULDER"
      : replayTelemetry.lineControl >= .8
        ? "POCKET LOCK"
        : "POWER LINE";
  const replayStanceLabel = replayTelemetry.stance > .42
    ? "NOSE DRIVE"
    : replayTelemetry.stance < -.42
      ? "TAIL LOAD"
      : "CENTERED";
  const replayFaceLabel = replayTelemetry.facePosition > .56
    ? "LIP LINE"
    : replayTelemetry.facePosition < -.56
      ? "BOTTOM TURN"
      : replayTelemetry.facePosition > .22
        ? "HIGH FACE"
        : replayTelemetry.facePosition < -.22
          ? "LOW FACE"
          : "MID FACE";
  const replayActiveMoment = replayMoments.reduce<ReplayMoment | null>((nearest, moment) => {
    const window = moment.kind === "takeoff" || moment.kind === "exit" ? .052 : .038;
    const distance = Math.abs(moment.progress - replayProgress);
    if (distance > window) return nearest;
    return !nearest || distance < Math.abs(nearest.progress - replayProgress) ? moment : nearest;
  }, null);
  const heatWaveNumber = rideToast
    ? Math.max(1, heatWaves.findIndex((wave) => wave.id === rideToast.id) + 1 || heatWaves.length + 1)
    : heatWaves.length;
  const finalHeatWaveRunning = sessionFormat === "heat" && heatExpired && stats.phase === "riding" && !heatComplete;
  const heatAllowsGameplay = sessionFormat !== "heat"
    || (!heatComplete && (!heatExpired || finalHeatWaveRunning));
  const trainingComplete = trainingStep >= TRAINING_STEPS.length;
  const trainingLesson = TRAINING_STEPS[Math.min(trainingStep, TRAINING_STEPS.length - 1)];
  const accentStyle = { "--spot-accent": beach.palette[0], "--sand-accent": beach.palette[1] } as CSSProperties;
  const handleSceneReady = useCallback(() => setSceneReady(true), []);
  const handleStats = useCallback((next: GameStats) => {
    if (settings.mode === "training") {
      const reached = reachedTrainingStep(next);
      if (reached > trainingStepValue.current) {
        trainingStepValue.current = reached;
        setTrainingStep(reached);
        audio.current?.effect("coach");
        haptic(reached === TRAINING_STEPS.length ? [12, 28, 12, 36, 24] : [8, 20, 12]);
      }
    }
    setStats(next);
    setPersonalBest((current) => {
      const updated = {
        score: Math.max(current.score, next.score),
        distance: Math.max(current.distance, next.rideDistance),
        combo: Math.max(current.combo, next.maxCombo),
      };
      return updated.score === current.score && updated.distance === current.distance && updated.combo === current.combo ? current : updated;
    });
  }, [settings.mode]);
  const liveMasteryThree = stats.rideResult === "clean"
    && gradeRank(stats.rideGrade) >= gradeRank("A")
    && stats.pocketDistance >= 25
    && (stats.rideManeuvers >= 2 || stats.barrelTime >= 2);
  const objectives = sessionFormat === "heat"
    ? [
        { label: "Post two scoring rides", done: heatWaves.length >= 2 },
        { label: `Clear the ${heatTarget.toFixed(2)} qualification line`, done: heatWon },
        { label: "Earn one 7.00+ excellent score", done: rankedHeatWaves.some((wave) => wave.judgeScore >= 7) },
      ]
    : settings.mode === "playground"
    ? [
        { label: "Ride 40 m", done: stats.rideDistance >= 40 },
        { label: "Land 2 moves", done: stats.maneuverCount >= 2 },
        { label: "Barrel for 2s", done: stats.barrelTime >= 2 },
        { label: "Hold pocket 20 m", done: stats.pocketDistance >= 20 },
      ]
    : [
        { label: "Log a wave at this coast", done: currentCoastRecord.mastery >= 1 || stats.rideDistance >= 8 || stats.rideResult !== "" },
        { label: "Finish a clean line", done: currentCoastRecord.mastery >= 2 || stats.rideResult === "clean" },
        { label: "Earn A · 25 m pocket · 2 moves or 2s tube", done: currentCoastRecord.mastery >= 3 || liveMasteryThree },
      ];
  const rollDegrees = Math.round(Math.abs(stats.rollAngle) * 180 / Math.PI);
  const rollSide = stats.rollAngle >= 0 ? "RIGHT" : "LEFT";
  const pitchDegrees = Math.round(Math.abs(stats.pitchAngle) * 180 / Math.PI);
  const pitchDirection = stats.pitchAngle >= 0 ? "NOSE DOWN" : "NOSE UP";
  const noseImmersionCentimeters = Math.round(stats.noseImmersion * 100);
  const tailImmersionCentimeters = Math.round(stats.tailImmersion * 100);
  const airborneCentimeters = Math.round(stats.airborneHeight * 100);
  const hullContactPercent = Math.round(stats.boardWaterContact * 100);
  const hullPatchContact = Math.round(stats.hullPatchContact * 100);
  const takeoffOpportunityPercent = Math.round(
    stats.takeoffOpportunity * 100,
  );
  const takeoffSpeedMatchPercent = Math.round(
    stats.takeoffSpeedMatch * 100,
  );
  const wavePressurePercent = Math.round(stats.wavePressure * 100);
  const waveEngagementPercent = Math.round(
    stats.waveEngagement * 100,
  );
  const pitchHazardActive = stats.pitchOverRisk > .28 || stats.tailStall > .38;
  const attitudeDegrees = pitchHazardActive ? pitchDegrees : rollDegrees;
  const stanceLabel = stats.stance > 0.42 ? "NOSE PRESSURE" : stats.stance < -0.42 ? "TAIL PRESSURE" : "CENTERED";
  const hydrodynamicLoadLabel = stats.airborneHeight > .055
    ? `AIRBORNE ${airborneCentimeters} CM`
    : stats.landingImpact > .18
      ? `RECONNECT LOAD ${Math.round(stats.landingImpact * 100)}%`
    : stats.pitchOverRisk > .42
      ? `NOSE IMMERSED ${noseImmersionCentimeters} CM`
    : stats.capsizeRisk > .48
      ? `CAPSIZE RISK ${Math.round(stats.capsizeRisk * 100)}%`
    : stats.rollEdgeRisk > .34
      ? `${rollSide} RAIL ${rollDegrees}°`
    : stats.pearlingRisk > .32
    ? `NOSE BURIAL ${Math.round(stats.pearlingRisk * 100)}%`
    : stats.tailStall > .38
      ? `TAIL STALL ${Math.round(stats.tailStall * 100)}%`
    : stats.whitewaterPressure > .35
      ? `WHITEWATER ${Math.round(stats.whitewaterPressure * 100)}%`
    : stats.barrelIntensity > .25
      ? `TUBE PRESSURE ${Math.round(stats.barrelIntensity * 100)}%`
    : stats.hullPatchContact > .08
      ? `FACE PATCH SUPPORT ${hullPatchContact}%`
    : Math.abs(stats.lateralForce) > .52
      ? `${stats.lateralForce > 0 ? "RIGHT" : "LEFT"} RAIL LOADED`
      : Math.max(0, stats.acceleration) > .48
        ? "BOARD DRIVING"
        : stanceLabel;
  const rollInstrumentTitle = stats.airborneHeight > .055
    ? "HULL AIRBORNE"
    : stats.landingImpact > .18
      ? "WATER RECONNECT"
    : stats.pitchOverRisk > .42
      ? "PITCH OVER"
    : stats.capsizeRisk > .48
      ? "EDGE CATCH"
    : stats.rollEdgeRisk > .28
      ? "RAIL LIMIT"
      : "BODY COM / ROLL";
  const standingLoadLabel = stats.airborneHeight > .055
    ? `AIRBORNE ${airborneCentimeters} CM · NO RAIL`
    : stats.landingImpact > .18
      ? `RECONNECT LOAD ${Math.round(stats.landingImpact * 100)}%`
    : stats.pitchOverRisk > .42
      ? `NOSE IMMERSED ${noseImmersionCentimeters} CM`
    : stats.capsizeRisk > .48
      ? `CAPSIZE RISK ${Math.round(stats.capsizeRisk * 100)}%`
    : stats.rollEdgeRisk > .28
      ? `${rollSide} RAIL ${rollDegrees}°`
      : stats.crossWaveLoad > .28
        ? `CROSS-WAVE LOAD ${Math.round(stats.crossWaveLoad * 100)}%`
        : stats.hullPatchContact > .08
          ? `FACE PATCH SUPPORT ${hullPatchContact}%`
        : stats.speed > .6
          ? "SURFACE GLIDE · NO CAPTURE"
          : "NO WAVE POWER";
  const faceLabel = stats.facePosition > .56
    ? "LIP LINE"
    : stats.facePosition < -.56
      ? "BOTTOM TURN"
      : stats.facePosition > .22
        ? "HIGH FACE"
        : stats.facePosition < -.22
          ? "LOW FACE"
          : "MID FACE";
  const faceIndicator = (Math.max(-1, Math.min(1, stats.facePosition)) + 1) * 50;
  const lineLabel = stats.whitewaterPressure > .48
    ? "IN THE FOAM"
    : stats.linePosition < -.72
    ? "TOO DEEP"
    : stats.linePosition > .72
      ? "OPEN SHOULDER"
      : stats.lineControl > .76
        ? "POWER POCKET"
        : "TRIM LINE";
  const lineIndicator = ((Math.max(-1.4, Math.min(1.4, stats.linePosition)) + 1.4) / 2.8) * 100;
  const activeLine = stats.phase === "riding" && breakCharacter.line === "A-FRAME"
    ? stats.lineSide > 0 ? "RIGHT" : "LEFT"
    : breakCharacter.line;
  const vehicleSurfaceLabel = stats.vehicleOffRoad > .56
    ? "LOOSE SAND"
    : stats.vehicleOffRoad > .16
      ? "ROAD SHOULDER"
      : "COAST ROAD";
  const coastBearing = compassDirection(settings.coastHeading + (stats.coastDistance < 0 ? -90 : 90));
  const coastPosition = `${Math.abs(stats.coastDistance).toFixed(0)} m ${coastBearing}`;
  const vehicleGrip = Math.round(stats.vehicleTraction * 100);
  const ridingOut = stats.phase === "riding" && stats.rideOutProgress > .02;
  const standingOnBoard = stats.phase === "riding" && !stats.waveEngaged;
  const takeoffCommitted = stats.phase === "paddling" && stats.takeoffCommitProgress > .02;
  const popUpBodyRate = Math.round(stats.popUpMovementAuthority * 100);
  const popUpPlacementRisk = Math.round(
    stats.popUpFootPlacementRisk * 100,
  );
  const popUpPressure = stats.stance > .14
    ? `NOSE ${Math.round(stats.stance * 100)}%`
    : stats.stance < -.14
      ? `TAIL ${Math.round(Math.abs(stats.stance) * 100)}%`
      : "CENTERED";
  const boardWaveAngleDegrees = Math.round(stats.boardWaveAngle * 180 / Math.PI);
  const headingTurn = boardWaveAngleDegrees >= 0 ? "RIGHT" : "LEFT";
  const crestTiming = readCrestTimingMechanics(
    stats.crestOvertake,
    stats.crestAhead,
  );
  const desiredPaddleDirectionX = stats.inLineup
    ? Math.sin(
        stats.paddleHeading + stats.boardWaveAngle,
      )
    : stats.lineupDirectionX;
  const desiredPaddleDirectionZ = stats.inLineup
    ? Math.cos(
        stats.paddleHeading + stats.boardWaveAngle,
      )
    : stats.lineupDirectionZ;
  const paddleCurrentAngle = (
    settings.currentDirection
      - settings.coastHeading
  ) * Math.PI / 180;
  const paddleCurrentSpeed =
    settings.currentStrength / 3.6;
  const paddleHeadingTarget =
    resolvePaddleHeadingTarget({
      boardHeading: stats.paddleHeading,
      desiredDirectionX: desiredPaddleDirectionX,
      desiredDirectionZ: desiredPaddleDirectionZ,
      desiredGroundSpeed:
        2.35 * BOARD_SPECS[settings.board].paddle,
      currentVelocityX:
        Math.sin(paddleCurrentAngle)
          * paddleCurrentSpeed,
      currentVelocityZ:
        -Math.cos(paddleCurrentAngle)
          * paddleCurrentSpeed,
    });
  const currentCompensationDegrees = Math.round(
    Math.abs(
      paddleHeadingTarget.currentCompensationDegrees,
    ),
  );
  const paddleTargetKind = stats.inLineup ? "WAVE" : "BREAK EXIT";
  const paddleTraining = readPaddleTrainingMechanics({
    boardWaveAngle: paddleHeadingTarget.headingError,
    paddleStroke: stats.paddleStroke,
    paddleEffort: stats.paddleEffort,
    waterContact: stats.boardWaterContact,
    waveForwardDrive: stats.wavePressureDrive,
    waveLateralLoad: stats.wavePressureSideLoad,
  });
  const surfTrainingForces = readSurfTrainingForces({
    boardWaveAngle: stats.phase === "paddling" && !stats.inLineup
      ? paddleHeadingTarget.headingError
      : stats.boardWaveAngle,
    waveLateralLoad: stats.wavePressureSideLoad,
    waterContact: stats.boardWaterContact,
    balance: stats.balance,
    balanceTarget: stats.balanceTarget,
  });
  const counterweightCue = surfTrainingForces.counterweightDirection === "hold"
    ? "HOLD WEIGHT"
    : `MOVE ${surfTrainingForces.counterweightDirection.toUpperCase()} ${surfTrainingForces.counterweightPercent}%`;
  const trainingForceVectors = [
    {
      label: "NOSE",
      value: surfTrainingForces.noseDirection === "hold"
        ? "ALIGNED"
        : `${surfTrainingForces.noseDirection.toUpperCase()} ${surfTrainingForces.noseDegrees}°`,
      direction: surfTrainingForces.noseDirection,
    },
    {
      label: "WATER PUSH",
      value: surfTrainingForces.airborne
        ? "AIRBORNE"
        : surfTrainingForces.waterDirection === "hold"
          ? "CENTERED"
          : `${surfTrainingForces.waterDirection.toUpperCase()} ${surfTrainingForces.waterLoad.toFixed(1)}`,
      direction: surfTrainingForces.waterDirection,
    },
    {
      label: "COUNTERWEIGHT",
      value: counterweightCue,
      direction: surfTrainingForces.counterweightDirection,
    },
  ] as const;
  const paddleTrainerActive = settings.mode === "training"
    && stats.phase === "paddling"
    && trainingStep <= 4
    && !takeoffCommitted
    && !stats.duckDiveReady
    && !stats.duckDiveActive;
  const currentCompensationCue =
    currentCompensationDegrees >= 3
      ? ` · CRAB ${paddleHeadingTarget.currentCompensationDegrees > 0 ? "RIGHT" : "LEFT"} ${currentCompensationDegrees}° FOR CURRENT`
      : "";
  const paddleAimCue = !stats.inLineup
    ? paddleTraining.turnDirection === "hold"
      ? `NOSE AIMED OUTSIDE BREAK${currentCompensationCue}`
      : `TURN ${paddleTraining.turnDirection.toUpperCase()} ${paddleTraining.turnDegrees}° TO EXIT BREAK${currentCompensationCue}`
    : paddleTraining.turnDirection === "hold"
      ? `NOSE ALIGNED${currentCompensationCue}`
      : `TURN ${paddleTraining.turnDirection.toUpperCase()} ${paddleTraining.turnDegrees}°${currentCompensationCue}`;
  const paddleForceCue = paddleTraining.pressureMode === "airborne"
    ? "HANDS OUT OF WATER"
    : paddleTraining.pressureMode === "broadside"
      ? `SIDE LOAD ${Math.abs(stats.wavePressureSideLoad).toFixed(1)} M/S²`
      : paddleTraining.pressureMode === "drive"
        ? `FACE DRIVE ${Math.max(0, stats.wavePressureDrive).toFixed(1)} M/S²`
        : paddleTraining.recommendedHand
          ? `BIAS ${paddleTraining.recommendedHand.toUpperCase()} HAND PULL`
        : paddleTraining.strokePhase === "pull"
          ? `${paddleTraining.activeHand?.toUpperCase()} HAND PULLING`
          : paddleTraining.strokePhase === "recovery"
            ? "ARMS RECOVERING"
            : "HOLD W TO STROKE";
  const paddleSpeedCue = stats.inLineup
    ? ` · BOARD ${stats.takeoffNormalSpeed.toFixed(1)} / FACE ${stats.takeoffMatchSpeed.toFixed(1)} M/S · MATCH ${takeoffSpeedMatchPercent}%`
    : "";
  const paddlePhysicsCue =
    `${paddleForceCue}${paddleSpeedCue}`;
  const paddleLeftWorkPercent = Math.round(
    Math.min(1, stats.paddleLeftWork / PADDLE_WORK_LESSON_TARGET)
      * 100,
  );
  const paddleRightWorkPercent = Math.round(
    Math.min(1, stats.paddleRightWork / PADDLE_WORK_LESSON_TARGET)
      * 100,
  );
  const paddleWorkCue = trainingStep === 1
    ? ` · L ${paddleLeftWorkPercent}% / R ${paddleRightWorkPercent}% WATER WORK`
    : "";
  const lineupMarginMeters =
    Math.abs(stats.lineupOutsideMargin).toFixed(1);
  const lineupPositionCue = stats.lineupOutsideMargin >= 0
    ? `${lineupMarginMeters} M OUTSIDE LIVE BREAK`
    : `${lineupMarginMeters} M INSIDE LIVE BREAK`;
  const mechanicsGuide = settings.mode !== "training"
    ? null
    : stats.phase === "wading"
      ? {
          cue: "BOARD FLOATS AHEAD",
          detail: "Keep moving offshore; once prone, hold W for full paddle strokes.",
          rotation: -90,
          tone: "paddle",
        }
      : stats.phase === "paddling"
        ? stats.duckDiveActive
          ? {
              cue: `BOARD SUBMERGED ${Math.round(stats.submersion * 100)}%`,
              detail: "Paddle thrust is gone underwater; keep the hull deep until the wall passes overhead.",
              rotation: 90,
              tone: "ready",
            }
          : stats.duckDiveReady
          ? {
              cue: "DIVE UNDER THE LIP",
              detail: `${gamepadConnected ? "LB" : "SHIFT"} now · impact in ${stats.shorebreakSeconds.toFixed(1)}s · the same control also works before or after the cue`,
              rotation: 90,
              tone: "danger",
            }
          : stats.airborneHeight > .055
            ? {
                cue: `PRONE HULL AIRBORNE ${airborneCentimeters} CM`,
                detail: "Stop steering and level the board; paddle force and rail control return only after water contact.",
                rotation: 90,
                tone: "danger",
              }
          : stats.pitchOverRisk > .36
            ? {
                cue: `PRONE NOSE ${noseImmersionCentimeters} CM UNDER`,
                detail: `${pitchDirection} ${pitchDegrees}° · ease the stroke and let the chest rise before standing.`,
                rotation: 90,
                tone: "danger",
              }
          : stats.capsizeRisk > .34
            ? {
                cue: `PRONE ROLL ${rollSide} ${rollDegrees}°`,
                detail: `Q/E: ${counterweightCue} toward the torque target · turn the nose out of the broadside load before popping up.`,
                rotation: rollSide === "RIGHT" ? 180 : 0,
                tone: "danger",
              }
          : takeoffCommitted
            ? crestTiming.state === "overtaken"
                && crestTiming.severity > .28
              ? {
                  cue: `LIP OVERTAKING ${crestTiming.percent}%`,
                  detail: `${popUpBodyRate}% body drive · the tracked crest kept moving during the pop-up; finish low and keep the board aligned.`,
                  rotation: -90,
                  tone: "danger",
                }
              : crestTiming.state === "ahead"
                  && crestTiming.severity > .28
                ? {
                    cue: `POWER FALLING BEHIND ${crestTiming.percent}%`,
                    detail: `${popUpBodyRate}% body drive · retained board speed has outrun the powered face; finish the landing and expect low support.`,
                    rotation: 90,
                    tone: "danger",
                  }
                : stats.popUpFootPlacementRisk > .42
                  ? {
                      cue: stats.stance > 0
                        ? "FEET TOO FAR FORWARD"
                        : "FEET TOO FAR BACK",
                      detail: `${popUpPlacementRisk}% placement risk is reducing righting leverage · ${gamepadConnected ? "move the stick" : stats.stance > 0 ? "press S" : "press W"} to recenter before standing tall.`,
                      rotation: stats.stance > 0 ? 90 : -90,
                      tone: "danger",
                    }
                : stats.takeoffCommitProgress < .2
              ? {
                  cue: "LAST STROKE · HANDS IN",
                  detail: `${popUpBodyRate}% body drive · ${hullPatchContact}% four-patch water support · crest tracking ${crestTiming.percent}%.`,
                  rotation: -90,
                  tone: "ready",
                }
              : stats.takeoffCommitProgress < .5
                ? {
                    cue: "HANDS UNDER RIBS",
                    detail: `${popUpBodyRate}% body drive · ${hullPatchContact}% nose/tail/rail support · keep the shoulders square.`,
                    rotation: 90,
                    tone: "balance",
                  }
                : stats.takeoffCommitProgress < .74
                  ? {
                      cue: "REAR FOOT UNDER HIPS",
                      detail: `${popUpBodyRate}% body drive · ${gamepadConnected ? "stick fore/aft" : "W/S"} sets ${popUpPressure} pressure · ${popUpPlacementRisk}% placement risk · ${counterweightCue} toward the roll target.`,
                      rotation: rollSide === "RIGHT" ? 180 : 0,
                      tone: "balance",
                    }
                  : {
                      cue: "FRONT FOOT LANDING",
                      detail: hullPatchContact > 10
                        ? `${popUpBodyRate}% body drive · ${hullPatchContact}% polygon support, ${popUpPressure} pressure, and ${popUpPlacementRisk}% placement risk carry into standing.`
                        : `${popUpBodyRate}% body drive · no face-patch support; ${popUpPressure} pressure and ${popUpPlacementRisk}% placement risk carry into still-water balance.`,
                      rotation: -90,
                      tone: "ready",
                    }
          : !stats.inLineup
            ? paddleTraining.turnDirection === "hold"
              ? {
                  cue: "NOSE TO BREAK EXIT · PADDLE",
                  detail: trainingStep === 1
                    ? `Hold W for alternating pulls · left ${paddleLeftWorkPercent}% / right ${paddleRightWorkPercent}% real water work. ${lineupPositionCue}; the exit arrow follows the local polygon contour and crabs against current.`
                    : `Hold W for alternating pulls. ${lineupPositionCue}; the exit arrow follows the local polygon contour and crabs against measured current. Release W to coast.`,
                  rotation: -90,
                  tone: "paddle",
                }
              : {
                  cue: `TURN ${paddleTraining.turnDirection.toUpperCase()} ${paddleTraining.turnDegrees}° TO PADDLE OUT`,
                  detail: `A/D biases the ${paddleTraining.recommendedHand?.toUpperCase()} pull, whose off-center force rotates the nose toward the current-compensated polygon break exit.`,
                  rotation: paddleTraining.turnDirection === "right" ? 0 : 180,
                  tone: "align",
                }
            : Math.abs(boardWaveAngleDegrees) > 24
              ? {
                  cue: `TURN ${headingTurn} ${Math.abs(boardWaveAngleDegrees)}°`,
                  detail: "A/D rotates the board · align the nose with the wave before standing.",
                  rotation: headingTurn === "RIGHT" ? 0 : 180,
                  tone: Math.abs(stats.wavePressureSideLoad) > .32 ? "danger" : "align",
                }
              : paddleTraining.pressureMode === "broadside"
                ? {
                    cue: `SIDE LOAD · TURN ${headingTurn}`,
                    detail: `${stats.crossWaveSpeed.toFixed(1)} m/s cross-flow is producing ${Math.abs(stats.wavePressureSideLoad).toFixed(1)} m/s² across the rail. Point the nose before the face rolls the hull.`,
                    rotation: headingTurn === "RIGHT" ? 0 : 180,
                    tone: "danger",
                  }
              : paddleTraining.pressureMode === "drive"
                ? {
                    cue: `FACE DRIVE ${Math.max(0, stats.wavePressureDrive).toFixed(1)} M/S²`,
                    detail: `${hullPatchContact}% of the sampled nose/tail/rail face patches are supporting the hull. SPACE only moves the body.`,
                    rotation: -90,
                    tone: "ready",
                  }
                : stats.crestDistance > -.8 && stats.crestDistance < 11 && stats.speed < 1.6
                  ? {
                      cue: "BUILD BOARD SPEED",
                      detail: `Board ${stats.takeoffNormalSpeed.toFixed(1)} m/s along the wave / face target ${stats.takeoffMatchSpeed.toFixed(1)} m/s · ${takeoffSpeedMatchPercent}% speed match. Each hand only adds force during its pull.`,
                      rotation: -90,
                      tone: "paddle",
                    }
                : {
                    cue: "READ THE SURFACE",
                    detail: `${hullContactPercent}% flotation · ${hullPatchContact}% breaking-face support. SPACE can stand with either value.`,
                    rotation: -90,
                    tone: "align",
                  }
        : standingOnBoard
          ? stats.airborneHeight > .055
            ? {
                cue: `HULL AIRBORNE ${airborneCentimeters} CM · LEVEL`,
                detail: "The rail has no water authority. Release A/D, center W/S, and prepare to reconnect.",
                rotation: 90,
                tone: "danger",
              }
            : stats.proneTransition > .01
              ? {
                  cue: `LOWERING TO PRONE ${Math.round(stats.proneTransition * 100)}%`,
                  detail: stats.proneTransition < .48
                    ? "Feet still carry the rail; keep the board level while the center of mass drops."
                    : "Hands are taking load and foot steering is fading; the hull keeps every water force and unit of momentum.",
                  rotation: 90,
                  tone: "balance",
                }
            : stats.pitchOverRisk > .42
            ? {
                cue: `NOSE ${noseImmersionCentimeters} CM UNDER · SHIFT BACK`,
                detail: `${pitchDirection} ${pitchDegrees}° · release W and move pressure toward the tail.`,
                rotation: 90,
                tone: "danger",
              }
            : stats.capsizeRisk > .48
            ? {
                cue: `BOARD ROLLING ${rollSide} · COUNTERWEIGHT`,
                detail: `${rollDegrees}° roll · Q/E: ${counterweightCue} before the rail trips.`,
                rotation: rollSide === "RIGHT" ? 180 : 0,
                tone: "danger",
              }
            : stats.rollEdgeRisk > .3
              ? {
                  cue: `${rollSide} RAIL NEAR LIMIT`,
                  detail: `Ease A/D and counterweight the ${rollDegrees}° bank.`,
                  rotation: rollSide === "RIGHT" ? 180 : 0,
                  tone: "align",
                }
          : stats.trickCharge > .04
            ? {
                cue: `BODY COMPRESSED ${Math.round(stats.trickCharge * 100)}%`,
                detail: stats.lipLaunchSupport > .42
                  ? `Live lip support ${Math.round(stats.lipLaunchSupport * 100)}%; extend now and let the measured face redirect the tail.`
                  : "No wave power is supporting the tail; extension changes body load but cannot create speed or lift.",
                rotation: 90,
                tone: "balance",
              }
          : stats.hullPatchContact > .08
            ? {
                cue: `FACE PATCH SUPPORT ${hullPatchContact}%`,
                detail: "Nose, tail, and rail contact now set vertical lift directly. Keep the arrow aligned to turn that support into drive.",
                rotation: -90,
                tone: "ready",
              }
          : stats.pearlingRisk > .32
            ? {
                cue: "NOSE BURYING · SHIFT BACK",
                detail: `${Math.round(stats.pearlingRisk * 100)}% pearl risk · move pressure toward the tail.`,
                rotation: 90,
                tone: "danger",
              }
            : stats.tailStall > .38
              ? {
                  cue: "TAIL SINKING · RECENTER",
                  detail: "The board is below planing speed; center your stance before turning.",
                  rotation: -90,
                  tone: "align",
                }
          : stats.crossWaveLoad > .28
            ? {
                cue: `RAIL HIT · TURN ${headingTurn}`,
                detail: `Cross-wave load ${Math.round(stats.crossWaveLoad * 100)}% · Q/E: ${counterweightCue}.`,
                rotation: headingTurn === "RIGHT" ? 0 : 180,
                tone: "danger",
              }
            : {
                cue: stats.speed > .6 ? "BOARD GLIDING" : "STANDING · NO WAVE POWER",
                detail: "Q/E requests a weight shift; the white body-COM marker moves with inertia toward the torque target. SPACE compresses without adding speed · SHIFT returns prone.",
                rotation: 90,
                tone: "balance",
              }
          : stats.phase === "riding" && stats.waveEngaged
            ? stats.airborneHeight > .055
              ? {
                  cue: `HULL AIRBORNE ${airborneCentimeters} CM · LEVEL`,
                  detail: stats.maneuverActive && stats.maneuverRotationTarget > .1
                    ? `${Math.round(Math.abs(stats.maneuverRotation) * 180 / Math.PI)}° measured yaw · ${Math.round(Math.abs(stats.maneuverRotationTarget) * 180 / Math.PI)}° projected from release momentum · neutralize roll and pitch before contact.`
                    : `${hullContactPercent}% water contact · neutralize roll and pitch before the polygon catches up.`,
                  rotation: 90,
                  tone: "danger",
                }
              : stats.proneTransition > .01
                ? {
                    cue: `LOWERING TO PRONE ${Math.round(stats.proneTransition * 100)}%`,
                    detail: stats.proneTransition < .48
                      ? "Feet still carry the rail; counter the live face while your center of mass drops."
                      : "Hands are taking load and foot steering is fading; prone control begins only after the hull is settled.",
                    rotation: 90,
                    tone: "balance",
                  }
              : stats.landingImpact > .2
                ? {
                    cue: `RECONNECT LOAD ${Math.round(stats.landingImpact * 100)}%`,
                    detail: "Absorb with centered trim; rail authority returns only as the hull settles.",
                    rotation: -90,
                    tone: "align",
                  }
              : stats.maneuverActive && stats.maneuverPhase === "release"
                ? {
                    cue: `RAMP RELEASE ${stats.maneuverLaunchVelocity.toFixed(1)} M/S`,
                    detail: `${stats.maneuverLaunchYawRate.toFixed(1)} rad/s measured yaw impulse · separation, face path, and reconnection will name the result.`,
                    rotation: -90,
                    tone: "ready",
                  }
              : stats.pitchOverRisk > .42
              ? {
                  cue: `NOSE ${noseImmersionCentimeters} CM UNDER · SHIFT BACK`,
                  detail: `${pitchDirection} ${pitchDegrees}° · the front contact patch is decelerating into the polygon face.`,
                  rotation: 90,
                  tone: "danger",
                }
              : stats.capsizeRisk > .48
              ? {
                  cue: `BOARD ROLLING ${rollSide} · COUNTERWEIGHT`,
                  detail: `${rollDegrees}° bank exceeds the righting range · Q/E: ${counterweightCue}.`,
                  rotation: rollSide === "RIGHT" ? 180 : 0,
                  tone: "danger",
                }
              : stats.rollEdgeRisk > .34
                ? {
                    cue: `${rollSide} RAIL ${rollDegrees}° · EASE`,
                    detail: "Release some A/D pressure; the water is no longer righting the board cleanly.",
                    rotation: rollSide === "RIGHT" ? 180 : 0,
                    tone: "align",
                  }
            : stats.pearlingRisk > .32
              ? {
                  cue: "NOSE BURYING · SHIFT BACK",
                  detail: `${noseImmersionCentimeters} cm nose contact · ease off the nose before the board decelerates.`,
                  rotation: 90,
                  tone: "danger",
                }
                : stats.tailStall > .38
                  ? {
                      cue: "TAIL STALL · RECENTER",
                      detail: `${tailImmersionCentimeters} cm tail immersion at low speed is killing the plane.`,
                    rotation: -90,
                    tone: "align",
                  }
            : stats.crossWaveLoad > .48
              ? {
                  cue: `BOARD BROADSIDE · TURN ${headingTurn}`,
                  detail: `${stats.crossWaveSpeed.toFixed(1)} m/s cross-flow · ${Math.round(stats.crossWaveLoad * 100)}% dynamic wall load · point the nose before the rail trips.`,
                  rotation: headingTurn === "RIGHT" ? 0 : 180,
                  tone: "danger",
                }
              : stats.planing < .3
                ? {
                    cue: "POINT DOWN THE SLOPE",
                    detail: "The board is losing plane. Reduce rail angle and let gravity rebuild speed.",
                    rotation: -90,
                    tone: "align",
                  }
                : {
                    cue: `${stats.lineSide > 0 ? "RIGHT" : "LEFT"} SHOULDER OPEN`,
                    detail: "A/D rolls the board onto a rail · W/S shifts pressure · face position follows your actual path.",
                    rotation: stats.lineSide > 0 ? 0 : 180,
                    tone: "ready",
                  }
            : null;
  const currentCrestInRange = stats.waveSurfable
    && stats.crestDistance > -.8
    && stats.crestDistance < 9;
  const crestAtBoard = currentCrestInRange && stats.crestDistance <= .45;
  const surfRadarValue = currentCrestInRange
    ? crestAtBoard
      ? "HERE"
      : `${stats.crestDistance.toFixed(1)}m`
    : `${Math.max(1, Math.ceil(stats.nextSetSeconds))}s`;
  const surfRadarLabel = stats.takeoffOpportunity > .02
    ? "LIVE TAKEOFF SUPPORT"
    : crestAtBoard
      ? "CREST UNDER BOARD"
      : currentCrestInRange
        ? "SURFABLE CREST"
        : "NEXT SURFABLE WAVE";
  const surfRadarDetail = stats.takeoffOpportunity > .02
    ? `${takeoffOpportunityPercent}% physical opportunity · ${takeoffSpeedMatchPercent}% speed match · ${wavePressurePercent}% live pressure / ${waveEngagementPercent}% sustained`
    : crestAtBoard
      ? "Match the wall's speed and keep driving"
      : currentCrestInRange
        ? `${Math.max(0, stats.crestDistance).toFixed(1)} m behind · ${Math.round(stats.crestEnergy * 100)}% energy`
        : `${Math.max(1, Math.ceil(stats.nextSetSeconds))} s · ${Math.round(stats.nextWaveEnergy * 100)}% energy`;
  const surfRadarFill = Math.round(
    THREEClamp(
      currentCrestInRange ? Math.max(stats.crestApproach, stats.crestEnergy * .34) : stats.nextWaveEnergy,
      0,
      1,
    ) * 100,
  );
  const mobileActionIsContextual = stats.vehicleMode || stats.nearVan || stats.phase === "riding" || stats.phase === "paddling";
  const mobileActionLabel = stats.vehicleMode
    ? "EXIT"
    : stats.nearVan
      ? "DRIVE"
      : stats.phase === "riding"
        ? stats.maneuverActive
          ? stats.maneuverPhase === "air" ? "LEVEL" : "SETTLE"
          : stats.trickCharge > .04 ? `EXTEND ${Math.round(stats.trickCharge * 100)}` : "CROUCH"
        : stats.phase === "paddling"
            ? takeoffCommitted ? "FEET" : "POP"
            : "MOVE";
  const mobileContext = stats.vehicleMode
    ? {
        title: stats.vehicleSlip > .24 ? "SETTLE THE VAN" : vehicleSurfaceLabel,
        detail: `${coastPosition} · ${vehicleGrip}% grip · ${stats.vehicleSlip > .24 ? "unwind the stick" : "stop before exit"}`,
      }
    : stats.phase === "shore"
      ? { title: "BEACH TRAVERSE", detail: "Full stick runs · swipe scene to look" }
      : stats.phase === "wading"
        ? { title: "SHOREBREAK", detail: "Push through until the board floats" }
        : ridingOut
          ? {
              title: "SHALLOW EXIT",
              detail: "Full board physics and controls remain active to the sand line",
            }
        : standingOnBoard
          ? stats.hullPatchContact > .08
            ? { title: "LIVE HULL LOAD", detail: `${hullPatchContact}% face support · ${wavePressurePercent}% live pressure / ${waveEngagementPercent}% sustained · stay aligned` }
          : stats.crossWaveLoad > .28
            ? { title: `TURN ${headingTurn}`, detail: `${stats.crossWaveSpeed.toFixed(1)} m/s cross-flow · ${Math.round(stats.crossWaveLoad * 100)}% load · balance against the roll` }
            : { title: stats.speed > .6 ? "SURFACE GLIDE" : "STANDING STILL", detail: `${hullContactPercent}% flotation · ${hullPatchContact}% face support · balance or tap PRONE` }
        : stats.phase === "paddling"
          ? stats.airborneHeight > .055
            ? { title: "HULL AIRBORNE", detail: `${airborneCentimeters} cm · center the balance control before contact` }
          : stats.pitchOverRisk > .36
            ? { title: "LIFT THE NOSE", detail: `${noseImmersionCentimeters} cm immersed · ease the stroke before standing` }
          : stats.capsizeRisk > .34
            ? { title: `COUNTER ${rollSide}`, detail: `${rollDegrees}° prone roll · move the balance control toward the target` }
          : takeoffCommitted
            ? {
                title: stats.takeoffCommitProgress < .2
                  ? "LAST STROKE"
                  : stats.takeoffCommitProgress < .5
                    ? "HANDS UNDER RIBS"
                    : stats.takeoffCommitProgress < .74
                      ? "REAR FOOT IN"
                      : "FRONT FOOT DOWN",
                detail: `${Math.round(stats.takeoffCommitProgress * 100)}% body position · ${popUpBodyRate}% movement · ${hullPatchContact}% polygon contact · ${popUpPressure} pressure`,
              }
          : stats.duckDiveActive
            ? { title: "UNDER THE LIP", detail: `Drive through · ${Math.round(stats.duckDiveQuality * 100)}% timing` }
            : stats.duckDiveReady
              ? { title: "DIVE NOW", detail: `${stats.shorebreakSeconds.toFixed(1)}s · use the separate DIVE control and punch through` }
            : stats.takeoffOpportunity > .02
            ? { title: `TAKEOFF SUPPORT ${takeoffOpportunityPercent}%`, detail: `${stats.takeoffNormalSpeed.toFixed(1)} / ${stats.takeoffMatchSpeed.toFixed(1)} m/s · ${takeoffSpeedMatchPercent}% speed match · paddle or POP` }
            : stats.inLineup && stats.takeoffAlignment < .3
              ? { title: "TURN FOR SHORE", detail: "Left stick pivots the board into the wave" }
              : stats.inLineup
                ? { title: "READ THE LINEUP", detail: `${surfRadarValue} · turn shoreward as a surfable wall approaches` }
                : { title: "PADDLE OUT", detail: "Push forward for strokes · DIVE submerges anytime · POP starts the body transition anytime" }
          : stats.phase === "wipeout"
            ? {
                title: stats.holdDownSeconds > .7 ? "HOLD-DOWN" : "RESURFACING",
                detail: `~${stats.holdDownSeconds.toFixed(1)}s physical estimate · ${stats.breath}% breath · follow the leash`,
              }
            : { title: "LINE RESET", detail: "Read the next wall of water" };
  const balanceAccuracy = Math.round((1 - Math.min(1, Math.abs(stats.balance - stats.balanceTarget))) * 100);
  const mobileControlStyle = {
    "--rail-grip": `${Math.round(stats.railGrip * 100)}%`,
  } as CSSProperties;
  const shorebreakTiming = Math.round((1 - THREEClamp(stats.shorebreakSeconds / 2.8, 0, 1)) * 100);
  const touchBalancePosition = (THREEClamp(stats.balance, -.94, .94) + 1) * 50;
  const touchBalanceIntentPosition = (
    THREEClamp(stats.balanceIntent, -.94, .94) + 1
  ) * 50;
  const touchTargetPosition = (THREEClamp(stats.balanceTarget, -.94, .94) + 1) * 50;
  const lensIntensity = stats.phase === "wipeout" ? 0.82 : stats.barrelIntensity * 0.72;
  const submersionIntensity = paused
    ? 0
    : stats.submersion;
  const submersionStyle = {
    "--submersion": submersionIntensity,
  } as CSSProperties;
  const wetLensStyle = wetLens
    ? {
        "--wetness": wetLens.intensity,
        "--wet-duration": `${wetLens.duration}s`,
      } as CSSProperties
    : undefined;
  const velocityIntensity = stats.phase === "riding"
    ? Math.min(
      .4,
      Math.max(0, stats.speed - 8.5) * .026
        + stats.barrelIntensity * .11
        + Math.max(0, stats.acceleration) * .065
        + Math.abs(stats.lateralForce) * .045,
    )
    : 0;
  const cinemaBeat = rideToast?.result ?? (maneuverToast ? "maneuver" : null);
  const cinemaBeatKey = rideToast?.id ?? maneuverToast?.id ?? 0;
  const landingMin = Math.max(-1, stats.landingTarget - stats.landingWindow);
  const landingMax = Math.min(1, stats.landingTarget + stats.landingWindow);
  const showPhysicalLandingGuide = stats.maneuverActive
    && (
      stats.maneuverAirborne
      || stats.airborneHeight > .055
      || stats.landingImpact > .08
    );
  const landingLabel = maneuverToast
    ? maneuverToast.quality >= .82 ? "STOMPED" : maneuverToast.quality >= .48 ? "LANDED" : "RECOVERED"
    : "LANDED";
  const hudEventCandidate = useMemo<HudEventToast | null>(() => {
    if (rideToast) return null;
    if (maneuverToast) {
      return {
        key: `maneuver-${maneuverToast.id}`,
        kind: "maneuver",
        tone: maneuverToast.quality >= .82 ? "clean" : maneuverToast.quality >= .48 ? "accent" : "warning",
        eyebrow: `${landingLabel} · ${Math.round(maneuverToast.quality * 100)}%`,
        title: maneuverToast.name,
        value: `+${maneuverToast.points.toLocaleString()}`,
      };
    }
    if (shorebreakToast) {
      const clean = shorebreakToast.result === "clean";
      return {
        key: `shorebreak-${shorebreakToast.id}`,
        kind: "shorebreak",
        tone: clean ? "clean" : "warning",
        eyebrow: clean ? "CLEAN DIVE" : "WHITEWATER HIT",
        title: clean ? "PUNCHED THROUGH" : "WASHED SHOREWARD",
        value: `${Math.round(shorebreakToast.quality * 100)}%`,
      };
    }
    return null;
  }, [landingLabel, maneuverToast, rideToast, shorebreakToast]);

  useEffect(() => {
    if (hudEventTransitionTimer.current !== null) {
      window.clearTimeout(hudEventTransitionTimer.current);
      hudEventTransitionTimer.current = null;
    }
    const reveal = (toast: HudEventToast) => {
      hudEventToastRef.current = toast;
      setHudEventToast(toast);
      setHudEventVisible(false);
      hudEventTransitionTimer.current = window.setTimeout(() => {
        setHudEventVisible(true);
        hudEventTransitionTimer.current = null;
      }, 34);
    };
    const current = hudEventToastRef.current;
    if (!hudEventCandidate) {
      if (!current) return;
      setHudEventVisible(false);
      hudEventTransitionTimer.current = window.setTimeout(() => {
        hudEventToastRef.current = null;
        setHudEventToast(null);
        hudEventTransitionTimer.current = null;
      }, 360);
      return;
    }
    if (!current || current.key === hudEventCandidate.key) {
      if (!current) reveal(hudEventCandidate);
      else {
        hudEventToastRef.current = hudEventCandidate;
        setHudEventToast(hudEventCandidate);
        setHudEventVisible(true);
      }
      return;
    }
    setHudEventVisible(false);
    hudEventTransitionTimer.current = window.setTimeout(() => {
      reveal(hudEventCandidate);
    }, 220);
  }, [hudEventCandidate]);

  useEffect(() => () => {
    if (hudEventTransitionTimer.current !== null) window.clearTimeout(hudEventTransitionTimer.current);
  }, []);
  const sessionIntroActive = !qaScenario && stats.sessionIntro < .999;
  const sessionIntroOpacity = stats.sessionIntro < .09
    ? stats.sessionIntro / .09
    : stats.sessionIntro > .72
      ? (1 - stats.sessionIntro) / .28
      : 1;
  const sessionIntroHud = THREEClamp((stats.sessionIntro - .38) / .5, 0, 1);
  const gameUiStyle = {
    "--intro-hud": sessionIntroActive ? sessionIntroHud : 1,
  } as CSSProperties;
  const sessionIntroStyle = {
    "--intro-bar": `${Math.max(0, (1 - stats.sessionIntro) * 9).toFixed(2)}dvh`,
    opacity: THREEClamp(sessionIntroOpacity, 0, 1),
  } as CSSProperties;

  return (
    <main className={`surfscape ${screen === "game" ? "is-playing" : "is-launch"}`} style={accentStyle}>
      <div className="scene-layer" aria-hidden={screen === "launch"}>
        <SurfScene
          key={`${beach.id}-${sessionKey}`}
          beach={beach}
          zoneName={zoneLabel}
          latitude={latitude}
          longitude={longitude}
          settings={settings}
          cloudCover={sessionCloudCover}
          weatherCode={sessionWeatherCode}
          observedAt={sessionConditions.observedAt}
          utcOffsetSeconds={sessionConditions.utcOffsetSeconds}
          sunrise={sessionConditions.sunrise}
          sunset={sessionConditions.sunset}
          cameraMode={cameraMode}
          controls={controls}
          qaScenario={qaScenario}
          active={screen === "game" && !paused && !photoMode && !replayActive && heatAllowsGameplay}
          renderActive={screen === "game" && !paused}
          qualityLocked={photoMode || replayActive || stats.phase === "paddling" || stats.phase === "riding" || stats.phase === "wipeout"}
          photoMode={photoMode}
          photoFocalLength={photoFocalLength}
          photoExposure={photoExposure}
          replayMode={replayActive}
          replayRequest={replayRequest}
          replayControl={{
            paused: replayPaused,
            speed: replaySpeed,
            seekProgress: replaySeekProgress,
            seekRequest: replaySeekRequest,
            autoDirector: replayAutoDirector,
          }}
          captureRequest={captureRequest}
          onCapture={handleRideFrameCapture}
          onReplayReady={handleReplayReady}
          onReplayState={handleReplayState}
          onStats={handleStats}
          onReady={handleSceneReady}
        />
      </div>

      {!sceneReady && (
        <div className="scene-loader">
          <div className="wave-loader"><span /><span /><span /></div>
          <strong>Shaping the ocean</strong>
          <small>Loading water simulation</small>
        </div>
      )}

      {screen === "launch" && (
        <section className="launch-screen">
          <header className="launch-header">
            <button className="wordmark" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Surfscape home">
              <span className="wordmark-mark"><Waves /></span>
              <span>SURFSCAPE</span>
              <small>01</small>
            </button>
            <button
              type="button"
              className="header-beach-select"
              onClick={() => setDestinationPickerOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={destinationPickerOpen}
            >
              <MapPin />
              <span><small>SURF DESTINATION</small><strong>{beach.name}</strong></span>
              <ChevronDown />
            </button>
            <div className="launch-nav">
              <span className={`live-chip ${conditions.source === "live" ? "is-live" : ""}`}>
                <i /> {conditionsLoading ? "Reading buoy models" : selectedForecast ? "Forecast session" : conditions.source === "live" ? "Live ocean model" : "Modeled offline"}
              </span>
              <button className="icon-button" onClick={toggleSound} aria-label={soundEnabled ? "Mute sound" : "Enable sound"}>
                {soundEnabled ? <Volume2 /> : <VolumeX />}
              </button>
              {installPrompt && (
                <button className="install-button" onClick={() => void installApp()}>
                  <Download /><span>Install game</span>
                </button>
              )}
              <button className="text-button" onClick={() => setShowHowTo(true)}>How to ride</button>
            </div>
          </header>

          <div className="launch-content">
            <div className="launch-hero">
              <div className="hero-index"><span>13</span> ICONIC COASTLINES / LIVE CONDITIONS</div>
              <h1>
                READ<br />
                THE <em>OCEAN.</em>
              </h1>
              <p className="hero-copy">
                Choose a real break. Drive the coast. Walk the sand. Read a living swell. Find the line that only exists right now.
              </p>

              <div className="current-readout">
                <div className="readout-location">
                  <span className="overline"><MapPin /> CURRENT PADDLE-OUT</span>
                  <strong>{zoneLabel}</strong>
                  <small>{beach.name} · {beach.region}</small>
                </div>
                <div className="readout-metric primary">
                  <span>Wave</span>
                  <strong>{settings.waveHeight.toFixed(1)}<small>m</small></strong>
                  <em>{settings.wavePeriod.toFixed(1)}s · {degrees(settings.waveDirection)}</em>
                </div>
                <div className="readout-metric">
                  <span>Dominant swell</span>
                  <strong>{settings.swellHeight.toFixed(1)}<small>m</small></strong>
                  <em>{settings.swellPeriod.toFixed(1)}s · {degrees(settings.swellDirection)}</em>
                </div>
                <div className="readout-metric tide-readout">
                  <span>Tide · {settings.mode === "playground" ? "custom" : sessionConditions.tideTrend}</span>
                  <strong>{settings.tide >= 0 ? "+" : ""}{settings.tide.toFixed(2)}<small>m</small></strong>
                  <em>{tideResponse.label} · {Math.round(tideResponse.quality * 100)}% fit</em>
                  {settings.mode !== "playground" && <TideSparkline points={conditions.tide} observedAt={sessionConditions.observedAt} />}
                </div>
              </div>
            </div>

            <div className="launch-config">
              <div className="launch-config-head">
                <div>
                  <span>01 / SESSION SETUP</span>
                  <strong>{beach.name}</strong>
                  <small>{zoneLabel} · {beach.country}</small>
                </div>
                <button
                  type="button"
                  className="config-beach-select"
                  onClick={() => setDestinationPickerOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={destinationPickerOpen}
                >
                  <MapPin />
                  <span><small>CHANGE COAST</small><strong>{beach.name}</strong></span>
                  <ChevronDown />
                </button>
              </div>
              <div className="mode-section">
                <div className="section-label"><span>MODE</span><p>Choose your relationship with the water</p></div>
                <div className="mode-grid">
                  {MODES.map((mode) => (
                    <button
                      key={mode.id}
                      className={`mode-card ${settings.mode === mode.id ? "is-selected" : ""}`}
                      onClick={() => chooseMode(mode.id)}
                    >
                      <span>{mode.kicker}</span>
                      <strong>{mode.name}</strong>
                      <p>{mode.description}</p>
                      <i>{settings.mode === mode.id ? "Selected" : "Choose"} <ArrowRight /></i>
                    </button>
                  ))}
                </div>
                {settings.mode === "advanced" && (
                  <div className="session-format-picker">
                    <div>
                      <span>SESSION FORMAT</span>
                      <strong>Choose how this ocean scores you</strong>
                    </div>
                    <button
                      type="button"
                      className={sessionFormat === "free" ? "is-selected" : ""}
                      onClick={() => setSessionFormat("free")}
                      aria-pressed={sessionFormat === "free"}
                    >
                      <Waves />
                      <span><small>OPEN SESSION</small><strong>Free Surf</strong><em>Ride without a clock</em></span>
                    </button>
                    <button
                      type="button"
                      className={sessionFormat === "heat" ? "is-selected" : ""}
                      onClick={() => setSessionFormat("heat")}
                      aria-pressed={sessionFormat === "heat"}
                    >
                      <Timer />
                      <span><small>5:00 · BEST TWO</small><strong>World Tour Heat</strong><em>Beat {heatTarget.toFixed(2)} to qualify</em></span>
                    </button>
                  </div>
                )}
                <div className="quiver-picker">
                  <div className="quiver-head"><span>QUIVER / 03</span><strong>Choose the board under your feet</strong></div>
                  <div className="quiver-grid">
                    {BOARD_OPTIONS.map((boardId) => {
                      const board = BOARD_SPECS[boardId];
                      return (
                        <button
                          key={boardId}
                          className={settings.board === boardId ? "is-selected" : ""}
                          onClick={() => setSettings((current) => ({ ...current, board: boardId }))}
                          style={{ "--board-color": board.color, "--board-accent": board.accent } as CSSProperties}
                          aria-pressed={settings.board === boardId}
                          title={board.description}
                        >
                          <i className={`board-shape is-${boardId}`} />
                          <span><small>{board.profile}</small><strong>{board.name}</strong></span>
                          <em>SPD {Math.round(board.speed * 10)} · TURN {Math.round(board.turn * 10)} · STAB {Math.round(board.stability * 10)}</em>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <aside className={`planner panel-${launchPanel} ${showPlanner ? "is-open" : ""}`}>
              <button className="planner-mobile-toggle" onClick={() => setShowPlanner((value) => !value)}>
                <span><MapPin /> <strong>{beach.name}</strong><small>{zoneLabel}</small></span>
                <ChevronDown />
              </button>
              <div className="planner-inner">
                <div className="planner-head">
                  <div>
                    <span className="overline">02 / EXPLORE THE BREAK</span>
                    <h2>{zoneLabel}</h2>
                    <p>{beach.name} · {beach.region}</p>
                  </div>
                </div>
                <nav className="planner-tabs" aria-label="Session planning">
                  <button type="button" className={launchPanel === "break" ? "is-active" : ""} onClick={() => setLaunchPanel("break")} aria-pressed={launchPanel === "break"}>
                    <MapPin /><span>Break</span><small>Choose a line</small>
                  </button>
                  <button type="button" className={launchPanel === "forecast" ? "is-active" : ""} onClick={() => setLaunchPanel("forecast")} aria-pressed={launchPanel === "forecast"}>
                    <CloudSun /><span>Forecast</span><small>Pick a window</small>
                  </button>
                  <button type="button" className={launchPanel === "tour" ? "is-active" : ""} onClick={() => setLaunchPanel("tour")} aria-pressed={launchPanel === "tour"}>
                    <Trophy /><span>Tour</span><small>{passportSummary.stamps} stamps</small>
                  </button>
                </nav>
                {launchPanel === "tour" && <div className={`tour-passport mastery-${currentCoastRecord.mastery}`}>
                  <div className="passport-heading">
                    <Trophy />
                    <span>WORLD TOUR PASSPORT</span>
                    <strong>{passportSummary.explored} / {BEACHES.length} COASTS · {passportSummary.stamps} / {BEACHES.length * 3} STAMPS</strong>
                  </div>
                  <div className="passport-route" aria-label="World Tour coastline progress">
                    {BEACHES.map((destination, index) => {
                      const destinationMastery = passport[destination.id]?.mastery ?? 0;
                      return (
                        <button
                          type="button"
                          key={destination.id}
                          className={`${destinationMastery ? "is-stamped" : ""} ${destination.id === beach.id ? "is-current" : ""}`}
                          onClick={() => chooseBeach(destination)}
                          aria-label={`${destination.name}. ${coastMasteryLabel(destinationMastery)}. Select destination.`}
                          title={`${destination.name} · ${coastMasteryLabel(destinationMastery)}`}
                        >
                          <i>{String(index + 1).padStart(2, "0")}</i>
                          <span>{Array.from({ length: 3 }, (_, stamp) => <b key={stamp} className={stamp < destinationMastery ? "is-earned" : ""} />)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="passport-coast">
                    <div>
                      <span>{zoneLabel} · {beach.country}</span>
                      <strong>{coastMasteryLabel(currentCoastRecord.mastery)}</strong>
                      <small>
                        {currentCoastRecord.rides > 0
                          ? `${currentCoastRecord.bestGrade} BEST · ${currentCoastRecord.bestScore.toLocaleString()} PTS · ${currentCoastRecord.cleanRides} CLEAN${currentCoastRecord.bestHeat > 0 ? ` · HEAT ${currentCoastRecord.bestHeat.toFixed(2)}` : ""}`
                          : "LOG A WAVE · FINISH CLEAN · MASTER THE COAST"}
                      </small>
                    </div>
                    <span className="passport-stamps" aria-label={`${currentCoastRecord.mastery} of 3 stamps earned`}>
                      {Array.from({ length: 3 }, (_, stamp) => <i key={stamp} className={stamp < currentCoastRecord.mastery ? "is-earned" : ""}>{stamp + 1}</i>)}
                    </span>
                  </div>
                </div>}
                {launchPanel === "break" && <div className="planner-panel planner-break-panel">
                  <WorldMap
                  beach={beach}
                  latitude={latitude}
                  longitude={longitude}
                  onSelect={(lat, lon, label) => {
                    setLatitude(lat);
                    setLongitude(lon);
                    setZoneLabel(label);
                    setSelectedForecastTime(null);
                  }}
                />
                <div className="zone-strip" role="list" aria-label={`${beach.name} surf zones`}>
                  {beach.zones.map((zone) => (
                    <button
                      key={zone.name}
                      className={zoneLabel === zone.name ? "is-active" : ""}
                      onClick={() => {
                        setLatitude(zone.lat);
                        setLongitude(zone.lon);
                        setZoneLabel(zone.name);
                        setSelectedForecastTime(null);
                      }}
                    >
                      <span />
                      <strong>{zone.name}</strong>
                      <small>{zone.note}</small>
                    </button>
                  ))}
                </div>
                  <p className="break-description">{beach.description}</p>
                  <div className="break-meta">
                    <span><Waves /> {beach.breakType}</span>
                    <span><ArrowRight /> {breakCharacter.line} · {breakCharacter.kind.toUpperCase()}</span>
                    <span><Gauge /> Difficulty {beach.difficulty}/5</span>
                    <span><Thermometer /> {settings.waterTemperature.toFixed(0)}°C · {thermalKit.name}</span>
                    <span><Crosshair /> {latitude.toFixed(3)}, {longitude.toFixed(3)}</span>
                    <span className="data-credit">Model: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · DWD · Not for navigation</span>
                  </div>
                </div>}
                {launchPanel === "forecast" && <div className="planner-panel planner-forecast-panel">
                  <div className="forecast-summary">
                    <div><Waves /><span>Face</span><strong>{(settings.waveHeight * tideResponse.faceScale).toFixed(1)} m</strong></div>
                    <div><Wind /><span>Period</span><strong>{settings.swellPeriod.toFixed(1)} s</strong></div>
                    <div><ArrowRight /><span>Tide</span><strong>{tideResponse.shortName}</strong></div>
                    <div><SunMedium /><span>Local</span><strong>{localTime}</strong></div>
                  </div>
                  <div className="forecast-planner">
                  <div className="forecast-head">
                    <span>03 / SESSION WINDOW</span>
                    <strong>{selectedForecast ? `${forecastDayLabel(selectedForecast.time, conditions.observedAt)} · ${formatClock(selectedForecast.time)}` : "Now · live model"}</strong>
                  </div>
                  <div className="forecast-strip" role="list" aria-label="Choose a forecast session time">
                    <button
                      type="button"
                      className={selectedForecastTime === null ? "is-active" : ""}
                      onClick={() => selectSessionWindow(null)}
                      aria-pressed={selectedForecastTime === null}
                      disabled={conditionsLoading}
                    >
                      <span><b>NOW</b><em>{formatClock(conditions.observedAt)}</em></span>
                      <strong>{conditions.waveHeight.toFixed(1)} m · {conditions.wavePeriod.toFixed(0)} s</strong>
                      <small>{currentTideResponse.label} · wind {conditions.windSpeed.toFixed(0)} km/h</small>
                      <i><b style={{ width: `${Math.min(100, conditions.waveHeight * Math.max(5, conditions.wavePeriod) * 3 * (.68 + currentTideResponse.quality * .32))}%` }} /></i>
                    </button>
                    {availableForecastWindows.map((point) => {
                      const windowTide = tideResponseForBreak(point.seaLevel, breakCharacter);
                      return (
                        <button
                          type="button"
                          key={point.time}
                          className={selectedForecastTime === point.time ? "is-active" : ""}
                          onClick={() => selectSessionWindow(point)}
                          aria-pressed={selectedForecastTime === point.time}
                          disabled={conditionsLoading}
                        >
                          <span><b>{forecastDayLabel(point.time, conditions.observedAt).toUpperCase()}</b><em>{formatClock(point.time)}</em></span>
                          <strong>{point.waveHeight.toFixed(1)} m · {point.wavePeriod.toFixed(0)} s</strong>
                          <small>{windowTide.label} · wind {point.windSpeed.toFixed(0)} km/h</small>
                          <i><b style={{ width: `${Math.min(100, point.waveHeight * Math.max(5, point.wavePeriod) * 3 * (.68 + windowTide.quality * .32))}%` }} /></i>
                        </button>
                      );
                    })}
                  </div>
                </div>
                  <div className="break-meta forecast-meta">
                  <span title={tideResponse.note} aria-label={`${tideResponse.label}. ${tideResponse.note}. ${Math.round(tideResponse.quality * 100)} percent bathymetry fit.`}><Waves /> {tideResponse.label} · {Math.round(tideResponse.quality * 100)}% bathymetry fit</span>
                    <span><Wind /> Wind {settings.windSpeed.toFixed(0)} km/h · {degrees(settings.windDirection)}</span>
                    <span><Thermometer /> Water {settings.waterTemperature.toFixed(0)}°C · {thermalKit.name}</span>
                  </div>
                </div>}
              </div>
            </aside>
          </div>

          {destinationPickerOpen && (
            <div
              className="destination-picker-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) setDestinationPickerOpen(false);
              }}
            >
              <section
                className="destination-picker"
                role="dialog"
                aria-modal="true"
                aria-labelledby="destination-picker-title"
              >
                <header>
                  <div>
                    <span>WORLD SURF ATLAS · 13 COASTLINES</span>
                    <h2 id="destination-picker-title">Choose your ocean</h2>
                    <p>Live marine conditions are loaded for the line you select.</p>
                  </div>
                  <button type="button" onClick={() => setDestinationPickerOpen(false)} aria-label="Close destination picker">
                    <X />
                  </button>
                </header>
                <div className="destination-picker-grid">
                  {BEACHES.map((destination, index) => (
                    <button
                      type="button"
                      key={destination.id}
                      className={destination.id === beach.id ? "is-current" : ""}
                      onClick={() => chooseBeach(destination)}
                      aria-pressed={destination.id === beach.id}
                    >
                      <i>{String(index + 1).padStart(2, "0")}</i>
                      <span>
                        <small>{destination.country}</small>
                        <strong>{destination.name}</strong>
                        <em>{destination.region}</em>
                      </span>
                      <b>
                        <small>{destination.breakType}</small>
                        <em>{destination.difficulty}/5</em>
                      </b>
                      <ArrowRight />
                    </button>
                  ))}
                </div>
                <footer>
                  <span><i /> {conditions.source === "live" ? "Live marine model connected" : "Modeled conditions available offline"}</span>
                  <small>Wave, swell, wind, current and tide update after selection.</small>
                </footer>
              </section>
            </div>
          )}

          {settings.mode === "playground" && (
            <section className="wave-lab-panel">
              <div className="lab-title"><Settings2 /><div><span>WAVE LAB · {tideResponse.shortName}</span><strong>{tideResponse.label}</strong></div></div>
              <PlaygroundSlider label="Face height" value={settings.waveHeight} min={0.3} max={6} step={0.1} unit="m" onChange={(waveHeight) => setSettings((value) => ({ ...value, waveHeight }))} />
              <PlaygroundSlider label="Period" value={settings.wavePeriod} min={5} max={22} step={0.5} unit="s" onChange={(wavePeriod) => setSettings((value) => ({ ...value, wavePeriod }))} />
              <PlaygroundSlider label="Wave bearing" value={settings.waveDirection} min={0} max={355} step={5} unit="" formatter={degrees} onChange={(waveDirection) => setSettings((value) => ({ ...value, waveDirection }))} />
              <PlaygroundSlider label="Swell height" value={settings.swellHeight} min={0} max={6} step={0.1} unit="m" onChange={(swellHeight) => setSettings((value) => ({ ...value, swellHeight }))} />
              <PlaygroundSlider label="Swell period" value={settings.swellPeriod} min={5} max={24} step={0.5} unit="s" onChange={(swellPeriod) => setSettings((value) => ({ ...value, swellPeriod }))} />
              <PlaygroundSlider label="Swell bearing" value={settings.swellDirection} min={0} max={355} step={5} unit="" formatter={degrees} onChange={(swellDirection) => setSettings((value) => ({ ...value, swellDirection }))} />
              <PlaygroundSlider label="Current" value={settings.currentStrength} min={0} max={4} step={0.1} unit="km/h" onChange={(currentStrength) => setSettings((value) => ({ ...value, currentStrength }))} />
              <PlaygroundSlider label="Current bearing" value={settings.currentDirection} min={0} max={355} step={5} unit="" formatter={degrees} onChange={(currentDirection) => setSettings((value) => ({ ...value, currentDirection }))} />
              <PlaygroundSlider label="Wind" value={settings.windSpeed} min={0} max={45} step={1} unit="km/h" onChange={(windSpeed) => setSettings((value) => ({ ...value, windSpeed }))} />
              <PlaygroundSlider label="Wind bearing" value={settings.windDirection} min={0} max={355} step={5} unit="" formatter={degrees} onChange={(windDirection) => setSettings((value) => ({ ...value, windDirection }))} />
              <PlaygroundSlider label="Tide" value={settings.tide} min={-1.5} max={1.8} step={0.05} unit="m" onChange={(tide) => setSettings((value) => ({ ...value, tide }))} />
              <PlaygroundSlider label="Water temperature" value={settings.waterTemperature} min={8} max={31} step={1} unit="°C" onChange={(waterTemperature) => setSettings((value) => ({ ...value, waterTemperature }))} />
              <PlaygroundSlider label="Air temperature" value={settings.airTemperature} min={5} max={38} step={1} unit="°C" onChange={(airTemperature) => setSettings((value) => ({ ...value, airTemperature }))} />
              <PlaygroundSlider label="Local hour" value={settings.timeOfDay} min={0} max={23.5} step={0.5} unit=":00" onChange={(timeOfDay) => setSettings((value) => ({ ...value, timeOfDay }))} />
              <button className="lab-weather" type="button" onClick={() => setSettings((value) => ({ ...value, weatherCode: nextWeatherPreset(value.weatherCode) }))} aria-label={`Weather preset: ${weatherLabel(settings.weatherCode)}. Tap to change.`}>
                <CloudSun /><span>Weather</span><strong>{weatherLabel(settings.weatherCode)}</strong><small>Tap to cycle</small>
              </button>
            </section>
          )}

          <footer className="launch-footer" aria-label="Ready session">
            <div className="session-summary">
              <div><span>Session</span><strong>{sessionFormat === "heat" ? "World Tour Heat" : selectedMode.name}</strong></div>
              <i />
              <div><span>Line</span><strong>{zoneLabel}</strong></div>
              <i />
              <div><span>Window</span><strong>{localTime} · {settings.waveHeight.toFixed(1)} m</strong></div>
              <i />
              <div><span>Board</span><strong>{BOARD_SPECS[settings.board].name}</strong></div>
            </div>
            <button className="launch-button" onClick={startSession}>
              <span>{sessionFormat === "heat" ? "START WORLD TOUR HEAT" : "ENTER THE WATER"}</span>
              <i><Play fill="currentColor" /></i>
            </button>
          </footer>
        </section>
      )}

      {screen === "game" && (
        <section
          className={`game-ui phase-${stats.phase} hud-panel-${hudPanel} ${hudMenuOpen ? "is-hud-open" : ""} ${paused ? "is-paused" : ""} ${photoMode ? "is-photo" : ""} ${replayActive ? "is-replay" : ""} ${sessionFormat === "heat" ? "is-heat" : ""} ${heatComplete ? "is-heat-complete" : ""} ${sessionIntroActive ? "is-intro" : ""}`}
          style={gameUiStyle}
          data-qa-scenario={qaScenario ? "surf" : undefined}
          data-qa-phase={stats.phase}
          data-qa-crest-distance={stats.crestDistance.toFixed(1)}
          data-qa-wave-surfable={stats.waveSurfable ? "true" : "false"}
          data-qa-takeoff-opportunity={stats.takeoffOpportunity.toFixed(3)}
        >
          <div
            ref={cameraLookSurface}
            className={`camera-look-surface ${pointerLocked ? "is-locked" : ""}`}
            aria-label={photoMode ? "Photo mode camera. Click to lock the mouse or drag to frame the shot." : pointerLocked ? "Mouse locked for 360 degree view. Press Escape to release." : "Click to lock the mouse or drag to look around"}
            onPointerDown={beginCameraLook}
            onPointerMove={updateCameraLook}
            onPointerUp={endCameraLook}
            onPointerCancel={endCameraLook}
            onWheel={adjustPhotoLensFromWheel}
            onLostPointerCapture={(event) => {
              lookGesture.current = null;
              event.currentTarget.classList.remove("is-dragging");
            }}
            onDoubleClick={centerCameraLook}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span>{gamepadConnected ? "RIGHT STICK · 360° VIEW" : pointerLocked ? "360° VIEW LOCKED · ESC RELEASES" : "CLICK / TOUCH · 360° VIEW"} · {CAMERA_LABELS[cameraMode].toUpperCase()}</span>
          </div>
          {replayActive && replayRide && (
            <div className="replay-mode-ui" aria-label="Surfscape instant replay">
              <div className="replay-letterbox" aria-hidden="true" />
              <div className="replay-mode-top">
                <div>
                  <Clapperboard />
                  <span>REPLAY STUDIO</span>
                  <strong>{replayPaused ? "FRAME HELD · LIVE OCEAN" : `${replaySpeed}× PLAYBACK`} · {replayAutoDirector ? "AUTO DIRECTOR" : CAMERA_LABELS[cameraMode].toUpperCase()}</strong>
                </div>
                <small>SPACE / A PAUSES · ← → / LB RB SCRUB · C / Y CHANGES CAMERA · ESC / START EXITS</small>
                <button type="button" onClick={stopReplay} aria-label="Exit instant replay"><X /></button>
              </div>
              {replayActiveMoment && (
                <div
                  className={`replay-moment-callout is-${replayActiveMoment.kind}`}
                  key={replayActiveMoment.id}
                  role="status"
                  aria-live="polite"
                >
                  <span>RIDE MOMENT</span>
                  <strong>{replayActiveMoment.label}</strong>
                  <small>{Math.round(replayActiveMoment.quality * 100)}% SIGNAL</small>
                </div>
              )}
              <div className="replay-mode-bottom">
                <div className="replay-score">
                  <span>{replayRide.result === "clean" ? "CLEAN LINE" : "WIPEOUT LINE"} · GRADE {replayRide.grade}</span>
                  <strong>{replayRide.score.toLocaleString()} PTS</strong>
                </div>
                <div className="replay-timeline">
                  <div className="replay-transport" aria-label="Replay controls">
                    <button type="button" className="is-primary" onClick={toggleReplayPaused} aria-label={replayPaused ? "Play replay" : "Pause replay"}>
                      {replayPaused ? <Play fill="currentColor" /> : <Pause fill="currentColor" />}
                      <span>{replayPaused ? "PLAY" : "PAUSE"}</span>
                    </button>
                    <button type="button" onClick={() => cycleReplaySpeed(1)} aria-label={`Replay speed ${replaySpeed} times. Change speed.`}>
                      <Gauge />
                      <span>{replaySpeed}×</span>
                    </button>
                    <button type="button" className={replayAutoDirector ? "is-active" : ""} onClick={toggleReplayDirector} aria-pressed={replayAutoDirector}>
                      <Clapperboard />
                      <span>{replayAutoDirector ? "AUTO" : "MANUAL"}</span>
                    </button>
                    <button type="button" onClick={cycleReplayCamera} aria-label={`Replay camera ${CAMERA_LABELS[cameraMode]}. Switch to manual camera.`}>
                      <Camera />
                      <span>{CAMERA_LABELS[cameraMode]}</span>
                    </button>
                  </div>
                  <span>
                    <b>FULL LINE PLAYBACK</b>
                    <em>{Math.max(0, replayDuration * (1 - replayProgress) / replaySpeed).toFixed(1)} S</em>
                  </span>
                  <label className="replay-scrubber">
                    <i aria-hidden="true">
                      <b style={{ width: `${Math.round(replayProgress * 100)}%` }} />
                      <span>
                        {replayMoments.map((moment) => (
                          <em
                            key={moment.id}
                            className={`is-${moment.kind} ${replayActiveMoment?.id === moment.id ? "is-active" : ""}`}
                            style={{ left: `${moment.progress * 100}%`, opacity: .46 + moment.quality * .54 }}
                          />
                        ))}
                      </span>
                    </i>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={.001}
                      value={replayProgress}
                      onPointerDown={beginReplayScrub}
                      onChange={(event) => seekReplay(Number(event.currentTarget.value))}
                      onPointerUp={endReplayScrub}
                      onPointerCancel={endReplayScrub}
                      aria-label="Replay playhead"
                      aria-valuetext={`${Math.round(replayProgress * 100)} percent`}
                    />
                  </label>
                  <small>{replayActiveMoment ? `${replayActiveMoment.label} · ${Math.round(replayActiveMoment.quality * 100)}% PHYSICS SIGNAL` : `${replayMoments.length} PHYSICS-DETECTED MOMENTS · ${replayLineLabel}`}</small>
                  <div className="replay-mobile-telemetry" aria-label={`Replay speed ${replayTelemetry.speed.toFixed(1)} metres per second. Board roll ${Math.round(Math.abs(replayTelemetry.rollAngle) * 180 / Math.PI)} degrees. Board pitch ${Math.round(Math.abs(replayTelemetry.pitchAngle) * 180 / Math.PI)} degrees. Airborne height ${Math.round(replayTelemetry.airborneHeight * 100)} centimetres. Vertical velocity ${replayTelemetry.verticalVelocity.toFixed(1)} metres per second. Face position ${replayFaceLabel}. Line control ${Math.round(replayTelemetry.lineControl * 100)} percent. Whitewater pressure ${Math.round(replayTelemetry.whitewater * 100)} percent.`}>
                    <span><small>SPEED</small><strong>{replayTelemetry.speed.toFixed(1)}<i>M/S</i></strong></span>
                    <span><small>FACE</small><strong>{replayFaceLabel}</strong></span>
                    <span><small>LINE</small><strong>{replayTelemetry.whitewater > .48 ? "FOAM" : Math.round(replayTelemetry.lineControl * 100)}{replayTelemetry.whitewater <= .48 && <i>%</i>}</strong></span>
                    <span><small>ROLL</small><strong>{Math.round(Math.abs(replayTelemetry.rollAngle) * 180 / Math.PI)}<i>°</i></strong></span>
                  </div>
                </div>
                <div className="replay-metrics" aria-label="Live replay telemetry">
                  <span><small>SPEED</small><strong>{replayTelemetry.speed.toFixed(1)}<i>M/S</i></strong></span>
                  <span><small>LINE</small><strong>{Math.round(replayTelemetry.lineControl * 100)}<i>%</i></strong></span>
                  <span><small>RAIL GRIP</small><strong>{Math.round(replayTelemetry.railGrip * 100)}<i>%</i></strong></span>
                  <span><small>BOARD ROLL</small><strong>{Math.round(Math.abs(replayTelemetry.rollAngle) * 180 / Math.PI)}<i>°</i></strong></span>
                  <span><small>BOARD PITCH</small><strong>{Math.round(Math.abs(replayTelemetry.pitchAngle) * 180 / Math.PI)}<i>°</i></strong></span>
                  <span><small>AIRBORNE</small><strong>{Math.round(replayTelemetry.airborneHeight * 100)}<i>CM</i></strong></span>
                  <span><small>VERTICAL</small><strong>{replayTelemetry.verticalVelocity.toFixed(1)}<i>M/S</i></strong></span>
                  <span><small>STANCE</small><strong className="is-text">{replayStanceLabel}</strong></span>
                  <span><small>POWER</small><strong>{Math.round(replayTelemetry.power * 100)}<i>%</i></strong></span>
                  <span><small>{replayTelemetry.whitewater > .2 ? "WHITEWATER" : replayTelemetry.barrel > .2 ? "BARREL" : replayTelemetry.maneuver > .18 ? "MANEUVER" : "FACE POSITION"}</small><strong className="is-text">{replayTelemetry.whitewater > .2 ? `${Math.round(replayTelemetry.whitewater * 100)}%` : replayTelemetry.barrel > .2 ? `${Math.round(replayTelemetry.barrel * 100)}%` : replayTelemetry.maneuver > .18 ? `${Math.round(replayTelemetry.maneuver * 100)}%` : replayFaceLabel}</strong></span>
                </div>
              </div>
            </div>
          )}
          {photoMode && (
            <>
              <div className="photo-mode-ui" aria-label="Surfscape photo mode">
                <div className="photo-mode-top">
                  <div>
                    <Aperture />
                    <span>PHOTO MODE</span>
                    <strong>{CAMERA_LABELS[cameraMode].toUpperCase()} RIG · {photoFocalLength} MM</strong>
                  </div>
                  <small>{pointerLocked ? "MOUSE LOOK LOCKED · WHEEL ZOOMS · P / ESC EXITS" : "DRAG / CLICK TO FRAME · WHEEL ZOOMS · P / ESC EXITS"}</small>
                  <button type="button" onClick={closePhotoMode} aria-label="Exit photo mode"><X /></button>
                </div>
                <div className="photo-director-panel">
                  <div className="photo-optics">
                    <span><Camera /> OPTICS</span>
                    <div role="group" aria-label="Photo focal length">
                      {PHOTO_FOCAL_LENGTHS.map((focalLength) => (
                        <button
                          type="button"
                          key={focalLength}
                          className={photoFocalLength === focalLength ? "is-active" : ""}
                          onClick={() => selectPhotoFocalLength(focalLength)}
                          aria-pressed={photoFocalLength === focalLength}
                        >
                          {focalLength}<small>MM</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="photo-exposure-control">
                    <span><SunMedium /> EXPOSURE</span>
                    <input
                      type="range"
                      min={-1.5}
                      max={1.5}
                      step={.1}
                      value={photoExposure}
                      onChange={(event) => selectPhotoExposure(Number(event.target.value))}
                      aria-label="Photo exposure compensation"
                    />
                    <output>{formatExposure(photoExposure)}</output>
                  </label>
                  <button type="button" className="photo-guide-button" onClick={cyclePhotoGuide}>
                    <Grid3X3 />
                    <span>GUIDE</span>
                    <strong>{PHOTO_GUIDE_LABELS[photoGuide].toUpperCase()}</strong>
                  </button>
                </div>
                <div className={`photo-reticle guide-${photoGuide}`} aria-hidden="true"><i /><i /><i /><i /><span /></div>
                <div className="photo-mode-bottom">
                  <div className="photo-meta">
                    <span>{zoneLabel.toUpperCase()} · {beach.name.toUpperCase()}</span>
                    <strong>{photoFocalLength} MM · {formatExposure(photoExposure)} · {effectiveFaceHeight.toFixed(1)} M · {settings.wavePeriod.toFixed(0)} S · {localTime}</strong>
                    <small aria-live="polite">{photoStatus === "error" ? "CAPTURE FAILED · TRY A DIFFERENT RIG" : photoStatus === "capturing" ? "RENDERING HIGH-RES FRAME…" : photoStatus === "ready" ? "HIGH-RES FRAME READY" : photoStatus === "shared" ? "PHOTO SHARED" : photoStatus === "saved" ? "PHOTO SAVED" : "PLAYER HELD · LIVING OCEAN / WEATHER ACTIVE"}</small>
                  </div>
                  <div className="photo-actions">
                    <button type="button" className="photo-lens-button" onClick={cycleCamera}><Camera /><span>CYCLE RIG</span></button>
                    <button type="button" className="photo-capture-button" onClick={capturePhoto} disabled={photoStatus === "capturing"}>
                      {photoStatus === "capturing" ? <LoaderCircle className="spin" /> : <Aperture />}
                      <span>{photoStatus === "capturing" ? "CAPTURING" : hasPhoto ? "RECAPTURE" : "CAPTURE"}</span>
                    </button>
                    {hasPhoto && (
                      <button type="button" className="photo-share-button" onClick={() => void sharePhoto()}>
                        {photoStatus === "shared" || photoStatus === "saved" ? <CircleCheck /> : <Share2 />}
                        <span>{photoStatus === "shared" ? "SHARED" : photoStatus === "saved" ? "SAVED" : "SHARE / SAVE"}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {photoStatus === "ready" && <div className="photo-capture-flash" aria-hidden="true" />}
            </>
          )}
          <div className={`barrel-lens ${stats.phase === "wipeout" ? "is-wipeout" : ""}`} style={{ opacity: lensIntensity }} aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
          </div>
          {wetLens && (
            <div
              className={`wet-lens ${wetLens.intensity >= .72 ? "is-heavy" : ""}`}
              key={wetLens.id}
              style={wetLensStyle}
              aria-hidden="true"
            >
              {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
            </div>
          )}
          <div
            className={`submersion-lens ${submersionIntensity > .01 ? "is-active" : ""} ${stats.phase === "wipeout" ? "is-wipeout" : "is-duck-dive"}`}
            style={submersionStyle}
            aria-hidden="true"
          >
            {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
          </div>
          <div className={`velocity-veil ${stats.barrelIntensity > .2 ? "is-barrel" : ""}`} style={{ opacity: velocityIntensity }} aria-hidden="true" />
          {cinemaBeat && <div className={`cinema-impact is-${cinemaBeat}`} key={`${cinemaBeat}-${cinemaBeatKey}`} aria-hidden="true" />}
          {stats.phase === "wipeout" && (
            <div
              className={`hold-down-instrument ${stats.holdDownSeconds <= .7 ? "is-rising" : ""}`}
              aria-label={`Wipeout. Estimated ${stats.holdDownSeconds.toFixed(1)} seconds until the body settles at the surface. Breath ${stats.breath} percent.`}
            >
              <div className="hold-down-heading">
                <Waves />
                <span>{stats.holdDownSeconds > .7 ? "HOLD-DOWN" : "RESURFACING"}</span>
                <strong>~{stats.holdDownSeconds.toFixed(1)}<small>s</small></strong>
              </div>
              <div className="breath-meter">
                <span>BREATH</span>
                <i><b style={{ width: `${stats.breath}%` }} /></i>
                <strong>{stats.breath}%</strong>
              </div>
              <div className="wipeout-power">
                <span>
                  {stats.wipeoutPower >= .72
                    ? "HEAVY WATER"
                    : stats.wipeoutPower >= .42
                      ? "POWERFUL WASH"
                      : "LIGHT WASH"}
                </span>
                <i>{Array.from({ length: 5 }, (_, index) => <b key={index} className={index < Math.ceil(stats.wipeoutPower * 5) ? "is-active" : ""} />)}</i>
                <small>FOLLOW THE LEASH</small>
              </div>
            </div>
          )}
          {sessionIntroActive && (
            <div className="session-intro" style={sessionIntroStyle} aria-live="polite">
              <div className="session-intro-title">
                <span>{selectedForecast ? "FORECAST SESSION" : conditions.source === "live" ? "LIVE OCEAN MODEL" : "MODELED SESSION"} · {settings.mode.toUpperCase()}{sessionFormat === "heat" ? " · WORLD TOUR HEAT" : ""}</span>
                <h2>{zoneLabel}</h2>
                <p>{beach.name} · {beach.region}</p>
                <div>
                  <strong><Waves /> {settings.waveHeight.toFixed(1)} m</strong>
                  <strong><Waves /> {settings.swellHeight.toFixed(1)} m @ {settings.swellPeriod.toFixed(1)} s</strong>
                  <strong><ArrowRight /> {breakCharacter.line} · {tideResponse.shortName}</strong>
                  <strong><Thermometer /> {settings.waterTemperature.toFixed(0)}° · {thermalKit.shortName}</strong>
                </div>
              </div>
              <small><i /> {sessionFormat === "heat" ? "HEAT HORN ARMED · BEST TWO WAVES COUNT" : "OCEAN MODEL LOCKED · CONTROLS LIVE"}</small>
            </div>
          )}
          <div className="hud-persistent-layer">
          <header className="game-topbar">
            <div className="game-brand">
              <Waves />
              <div><strong>SURFSCAPE</strong><span>{zoneLabel} · {beach.name} · {BOARD_SPECS[settings.board].name}</span></div>
            </div>
            <div className={`game-objective ${sessionFormat === "heat" ? "is-heat" : settings.mode === "training" ? "is-training" : ""} ${settings.mode === "training" && trainingComplete ? "is-complete" : ""}`}>
              <span>
                {sessionFormat === "heat"
                  ? `WORLD TOUR HEAT · ${heatExpired ? finalHeatWaveRunning ? "FINAL WAVE" : "HORN SOUNDED" : formatHeatClock(heatRemaining)}`
                  : settings.mode === "training"
                  ? trainingComplete
                    ? "TRAINING COMPLETE"
                    : `LESSON ${String(trainingStep + 1).padStart(2, "0")} / ${String(TRAINING_STEPS.length).padStart(2, "0")} · ${trainingLesson.title}`
                  : stats.phase}
              </span>
              <strong>
                {sessionFormat === "heat"
                  ? heatWaves.length === 0
                    ? `Best two waves count · qualification target ${heatTarget.toFixed(2)}`
                    : heatWon
                      ? `${heatTotal.toFixed(2)} total · qualification line cleared`
                      : `${heatTotal.toFixed(2)} total · need ${heatNeed.toFixed(2)} to qualify`
                  : settings.mode === "training" && trainingComplete
                    ? "First clean line complete — the ocean is open"
                    : stats.prompt}
              </strong>
              {sessionFormat === "heat" && (
                <div className="heat-score-strip" aria-label={`Heat total ${heatTotal.toFixed(2)} out of 20. Qualification target ${heatTarget.toFixed(2)}.`}>
                  {[0, 1].map((slot) => (
                    <i key={slot} className={countedHeatWaves[slot] ? "is-filled" : ""}>
                      <b style={{ width: `${(countedHeatWaves[slot]?.judgeScore ?? 0) * 10}%` }} />
                      <em>{countedHeatWaves[slot]?.judgeScore.toFixed(2) ?? "—"}</em>
                    </i>
                  ))}
                  <small>{heatTotal.toFixed(2)} / 20</small>
                </div>
              )}
              {sessionFormat !== "heat" && settings.mode === "training" && (
                <div className="coach-progress" role="progressbar" aria-label="Training progress" aria-valuemin={0} aria-valuemax={TRAINING_STEPS.length} aria-valuenow={trainingStep}>
                  {TRAINING_STEPS.map((step, index) => <i key={step.title} className={index < trainingStep ? "is-done" : index === trainingStep ? "is-current" : ""} />)}
                  <small>{trainingComplete ? "You are ready for Raw Ocean mode." : trainingLesson.detail}</small>
                </div>
              )}
            </div>
            <div className="game-actions">
              <div className="hud-score-chip" aria-label={`${sessionFormat === "heat" ? "Heat total" : "Session score"} ${sessionFormat === "heat" ? heatTotal.toFixed(2) : stats.score.toLocaleString()}`}>
                <span>{sessionFormat === "heat" ? "HEAT" : stats.grade}</span>
                <strong>{sessionFormat === "heat" ? heatTotal.toFixed(2) : stats.score.toLocaleString()}</strong>
              </div>
              <button className="sound-button" onClick={toggleSound} aria-label={soundEnabled ? "Mute" : "Unmute"}>{soundEnabled ? <Volume2 /> : <VolumeX />}</button>
              {gamepadConnected && <div className="controller-chip" role="status" aria-label="Game controller connected"><Gamepad2 /><span>PAD</span></div>}
              {fullscreenAvailable && (
                <button className="fullscreen-button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
                  {isFullscreen ? <Minimize2 /> : <Maximize2 />}
                </button>
              )}
              <button className="photo-button" onClick={openPhotoMode} aria-label="Open photo mode" title="Photo mode (P)"><Aperture /></button>
              <button className="camera-button" onClick={cycleCamera} aria-label={`Camera: ${CAMERA_LABELS[cameraMode]}. Switch camera.`} title={`Camera: ${CAMERA_LABELS[cameraMode]}`}><Camera /></button>
              <button
                className={`hud-menu-button ${hudMenuOpen ? "is-active" : ""}`}
                onClick={() => setHudMenuOpen((value) => !value)}
                aria-label={hudMenuOpen ? "Close surf computer" : "Open surf computer"}
                aria-expanded={hudMenuOpen}
                aria-controls="surf-computer"
                title="Surf computer"
              >
                {hudMenuOpen ? <X /> : <Grid3X3 />}
              </button>
              <button onClick={() => { clearAnalogMovement(); setPaused(true); }} aria-label="Pause"><Pause /></button>
            </div>
          </header>

          <div className="hud-vitals" aria-label="Live session essentials">
            <div>
              <Crosshair />
              <span>{stats.phase === "paddling" ? "Offshore" : stats.phase === "driving" ? "Coast" : standingOnBoard ? "Board" : stats.phase === "riding" ? "Line" : "Break"}</span>
              <strong>
                {stats.phase === "paddling"
                  ? `${stats.offshoreDistance.toFixed(0)} m`
                  : stats.phase === "driving"
                    ? `${Math.abs(stats.coastDistance).toFixed(0)} m`
                    : standingOnBoard
                      ? "STANDING"
                    : stats.phase === "riding"
                      ? `${stats.rideDistance.toFixed(0)} m`
                      : activeLine}
              </strong>
            </div>
            <div><Gauge /><span>Speed</span><strong>{(stats.speed * 3.6).toFixed(0)} km/h</strong></div>
            <div>
              {stats.phase === "riding" ? <Target /> : <BatteryMedium />}
              <span>{standingOnBoard ? stats.airborneHeight > .055 ? "Air" : pitchHazardActive ? "Pitch" : "Roll" : stats.phase === "riding" ? "Rail" : "Stamina"}</span>
              <strong>{standingOnBoard ? stats.airborneHeight > .055 ? `${airborneCentimeters} cm` : `${attitudeDegrees}°` : stats.phase === "riding" ? `${Math.round(stats.railGrip * 100)}%` : `${stats.stamina}%`}</strong>
            </div>
            <div><Waves /><span>Crest</span><strong>{surfRadarValue}</strong></div>
          </div>
          {mechanicsGuide && (
            <div className={`mechanics-guide is-${mechanicsGuide.tone}`} role="status" aria-live="polite">
              <i style={{ transform: `rotate(${mechanicsGuide.rotation}deg)` }}><ArrowRight /></i>
              <div>
                <span>LIVE BOARD COACH</span>
                <strong>{mechanicsGuide.cue}</strong>
                <small>{mechanicsGuide.detail}</small>
                {(stats.phase === "paddling" || stats.phase === "riding") && (
                  <div
                    className="training-force-vectors"
                    role="img"
                    aria-label={`Board nose ${trainingForceVectors[0].value}. Water push ${trainingForceVectors[1].value}. Counterweight ${trainingForceVectors[2].value}.`}
                  >
                    {trainingForceVectors.map((vector) => (
                      <span key={vector.label} className={`is-${vector.direction}`}>
                        <i aria-hidden="true"><ArrowRight /></i>
                        <em>{vector.label}</em>
                        <b>{vector.value}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {paddleTrainerActive && (
            <div
              className={`paddle-training-instrument is-${paddleTraining.pressureMode} has-direction-aim`}
              role="img"
              aria-label={`${paddleTargetKind} target. ${paddleAimCue}. ${paddlePhysicsCue}${paddleWorkCue}. ${paddleTraining.activeHand ? `${paddleTraining.activeHand} hand pulling.` : paddleTraining.strokePhase === "idle" ? "Paddling idle." : "Paddle stroke recovery."}`}
            >
              <div className="paddle-heading-dial" aria-hidden="true">
                <span className="paddle-board-nose"><ArrowRight /></span>
                <i
                  className="paddle-wave-target"
                  style={{ transform: `rotate(${paddleTraining.targetRotationDegrees - 90}deg)` }}
                >
                  <ArrowRight />
                </i>
                <small>{paddleTargetKind}<br />TARGET</small>
              </div>
              <div className="paddle-training-readout">
                <span>PHYSICAL TAKEOFF GUIDE</span>
                <strong>{paddleAimCue}</strong>
                <small>{paddlePhysicsCue}{paddleWorkCue}</small>
                <div className="paddle-hand-cycle" aria-hidden="true">
                  <i className={paddleTraining.activeHand === "left" ? "is-pulling" : ""}>
                    <b>L</b>
                    <em>{paddleTraining.activeHand === "left" ? "PULL" : "RECOVER"}</em>
                  </i>
                  <span style={{ "--stroke-drive": paddleTraining.strokeDrive } as CSSProperties}><b /></span>
                  <i className={paddleTraining.activeHand === "right" ? "is-pulling" : ""}>
                    <b>R</b>
                    <em>{paddleTraining.activeHand === "right" ? "PULL" : "RECOVER"}</em>
                  </i>
                </div>
              </div>
            </div>
          )}
          </div>

          <aside id="surf-computer" className="hud-drawer" aria-hidden={!hudMenuOpen}>
            <header>
              <div><Grid3X3 /><span>SURF COMPUTER</span><strong>{zoneLabel}</strong></div>
              <button type="button" onClick={() => setHudMenuOpen(false)} aria-label="Close surf computer"><X /></button>
            </header>
            <nav aria-label="Surf computer panels">
              <button type="button" className={hudPanel === "ocean" ? "is-active" : ""} onClick={() => setHudPanel("ocean")} aria-pressed={hudPanel === "ocean"}><Waves /><span>Ocean</span></button>
              <button type="button" className={hudPanel === "session" ? "is-active" : ""} onClick={() => setHudPanel("session")} aria-pressed={hudPanel === "session"}><Trophy /><span>Session</span></button>
              <button type="button" className={hudPanel === "controls" ? "is-active" : ""} onClick={() => setHudPanel("controls")} aria-pressed={hudPanel === "controls"}><Gamepad2 /><span>Controls</span></button>
            </nav>
            <div className="hud-drawer-body">
              {hudPanel === "ocean" && (
                <div className="hud-ocean-grid">
                  <article className="hud-set-card">
                    <div><Waves /><span>SURF RADAR</span><strong>{surfRadarValue}</strong></div>
                    <i><b style={{ width: `${surfRadarFill}%` }} /></i>
                    <small>{surfRadarDetail}</small>
                  </article>
                  <article><span>FACE</span><strong>{(settings.waveHeight * tideResponse.faceScale).toFixed(1)} m</strong><small>{settings.wavePeriod.toFixed(1)} s period</small></article>
                  <article><span>SWELL</span><strong>{settings.swellHeight.toFixed(1)} m</strong><small>{settings.swellPeriod.toFixed(1)} s · {degrees(settings.swellDirection)}</small></article>
                  <article><span>BREAK / TIDE</span><strong>{activeLine}</strong><small>{tideResponse.label}</small></article>
                  <article><span>WIND</span><strong>{settings.windSpeed.toFixed(0)} km/h</strong><small>{degrees(settings.windDirection)}</small></article>
                  <article><span>WATER / KIT</span><strong>{settings.waterTemperature.toFixed(0)}°C</strong><small>{thermalKit.name}</small></article>
                  {stats.phase === "paddling" && (
                    <article className="hud-offshore-card">
                      <span>OFFSHORE DISTANCE</span><strong>{Math.round(stats.offshoreDistance)} m</strong>
                      <i><b style={{ width: `${Math.min(100, stats.offshoreDistance / MAX_OFFSHORE_DISTANCE * 100)}%` }} /></i>
                      <small>{lineupPositionCue.toLowerCase()}</small>
                    </article>
                  )}
                </div>
              )}
              {hudPanel === "session" && (
                <div className="hud-session-panel">
                  <div className="hud-session-score">
                    <span>{sessionFormat === "heat" ? "HEAT TOTAL" : "SESSION SCORE"}</span>
                    <strong>{sessionFormat === "heat" ? heatTotal.toFixed(2) : stats.score.toLocaleString()}</strong>
                    <small>{sessionFormat === "heat" ? `${heatNeed.toFixed(2)} to qualify` : `${stats.combo.toFixed(1)}× flow · grade ${stats.grade}`}</small>
                  </div>
                  <div className="hud-session-goals">
                    <span>{sessionFormat === "heat" ? "HEAT SHEET" : settings.mode === "training" ? "LESSON PROGRESS" : "SESSION LINES"}</span>
                    {objectives.map((objective) => (
                      <small key={objective.label} className={objective.done ? "is-done" : ""}>
                        {objective.done ? <CircleCheck /> : <i />} {objective.label}
                      </small>
                    ))}
                  </div>
                  <div className="hud-session-meta">
                    <span><MapPin /> {zoneLabel}</span>
                    <span><Waves /> {BOARD_SPECS[settings.board].name}</span>
                    <span><Trophy /> Best {personalBest.score.toLocaleString()}</span>
                  </div>
                </div>
              )}
              {hudPanel === "controls" && (
                <div className="hud-controls-panel">
                  <span>{gamepadConnected ? "GAMEPAD" : "KEYBOARD + MOUSE"} · {stats.phase.toUpperCase()}</span>
                  <div>
                    <p><kbd>{gamepadConnected ? "LS" : "WASD"}</kbd><strong>{stats.vehicleMode ? "Drive and steer" : standingOnBoard ? "A/D rolls the board · W/S shifts stance" : stats.phase === "riding" ? "A/D rolls onto the rail · W/S shifts board pressure" : takeoffCommitted ? "W/S places fore-aft foot pressure during the pop-up" : "W paddles · A/D sets board heading"}</strong></p>
                    <p><kbd>{gamepadConnected ? "RS" : "MOUSE"}</kbd><strong>Look freely in every direction</strong></p>
                    {(stats.phase === "riding" || takeoffCommitted) && <p><kbd>{gamepadConnected ? "LT/RT" : "Q/E"}</kbd><strong>Counterweight and recover from impact</strong></p>}
                    <p><kbd>{gamepadConnected ? "A" : "SPACE"}</kbd><strong>{stats.phase === "riding" ? "Compress and extend; only live lip support can release the board" : stats.nearVan ? "Enter the van" : stats.phase === "paddling" ? "Stand anytime" : "Context action"}</strong></p>
                    {stats.phase === "paddling" && <p><kbd>{gamepadConnected ? "LB" : "SHIFT"}</kbd><strong>Duck dive anytime · the lip cue marks useful timing</strong></p>}
                    {stats.phase === "riding" && <p><kbd>{gamepadConnected ? "LB" : "SHIFT"}</kbd><strong>Return prone anytime without changing the board&apos;s momentum</strong></p>}
                    <p><kbd>{gamepadConnected ? "RB" : "C"}</kbd><strong>Change camera</strong></p>
                    {!gamepadConnected && <p><kbd>R</kbd><strong>Center view</strong></p>}
                  </div>
                  <button type="button" onClick={() => setShowHowTo(true)}><Gamepad2 /> OPEN FULL RIDE GUIDE</button>
                </div>
              )}
            </div>
          </aside>

          <div className="score-panel">
            <span>{sessionFormat === "heat" ? "HEAT TOTAL" : "SESSION SCORE"} <b>{sessionFormat === "heat" ? heatWaves.length : stats.grade}</b></span>
            <strong>{sessionFormat === "heat" ? heatTotal.toFixed(2) : stats.score.toLocaleString()}</strong>
            <div><i style={{ width: `${sessionFormat === "heat" ? Math.min(100, heatTotal / 20 * 100) : Math.min(100, stats.combo * 12.5)}%` }} /></div>
            <small>
              {sessionFormat === "heat"
                ? heatWon
                  ? `qualified · coast best ${Math.max(currentCoastRecord.bestHeat, heatTotal).toFixed(2)}`
                  : `${heatNeed.toFixed(2)} needed · best ${currentCoastRecord.bestHeat.toFixed(2)}`
                : `${stats.combo.toFixed(1)}× flow · best ${personalBest.score.toLocaleString()}`}
            </small>
          </div>

          <div className="set-panel">
            <div className="set-heading">
              <div><Waves /><span>SURF RADAR</span></div>
              <strong>{surfRadarValue}</strong>
            </div>
            <div className={`set-meter ${currentCrestInRange ? "is-set" : "is-lull"}`}>
              <i style={{ width: `${surfRadarFill}%` }} />
            </div>
            <div className={`set-readout ${currentCrestInRange ? "is-set" : "is-lull"}`}>
              <span>{surfRadarLabel}</span>
              <small>{surfRadarDetail}</small>
            </div>
            {stats.phase === "paddling" && (
              <>
                <div className={`takeoff-window ${stats.duckDiveReady ? "is-dive" : ""}`}>
                  <span>{stats.duckDiveReady ? "LIP IMPACT" : "TAKEOFF SUPPORT"}</span>
                  <i><b style={{ width: `${stats.duckDiveReady ? shorebreakTiming : takeoffOpportunityPercent}%` }} /></i>
                  <strong>{stats.duckDiveReady ? "DIVE" : "POP ANYTIME"}</strong>
                </div>
                <div className={`offshore-readout ${stats.inLineup ? "is-lineup" : ""}`}>
                  <div><MapPin /><span>OFFSHORE</span><strong>{Math.round(stats.offshoreDistance)} m</strong></div>
                  <i><b style={{ width: `${Math.min(100, stats.offshoreDistance / MAX_OFFSHORE_DISTANCE * 100)}%` }} /></i>
                  <small>{lineupPositionCue}</small>
                </div>
              </>
            )}
            <div className="stamina-row">
              <span><BatteryMedium /> STAMINA</span>
              <div><i style={{ width: `${stats.stamina}%` }} /></div>
              <strong>{stats.stamina}</strong>
            </div>
            <div className="session-goals">
              <span><Target /> {sessionFormat === "heat" ? `HEAT SHEET · ${heatWaves.length} WAVES` : settings.mode === "playground" ? "SESSION LINES" : `WORLD TOUR · ${currentCoastRecord.mastery}/3 STAMPS`}</span>
              {objectives.map((objective) => (
                <small key={objective.label} className={objective.done ? "is-done" : ""}>
                  {objective.done ? <CircleCheck /> : <i />} {objective.label}
                </small>
              ))}
            </div>
          </div>

          <div className="hud-event-slot" aria-live="polite" aria-atomic="true">
            <div
              className={`hud-event-toast is-${hudEventToast?.tone ?? "accent"} ${hudEventVisible ? "is-visible" : ""}`}
              data-event-key={hudEventToast?.key}
            >
              {hudEventToast?.kind === "maneuver" ? <Sparkles /> : <Waves />}
              <span>{hudEventToast?.eyebrow ?? ""}</span>
              <strong>{hudEventToast?.title ?? ""}</strong>
              <b>{hudEventToast?.value ?? ""}</b>
            </div>
          </div>

          {rideToast && (
            <div className={`ride-recap is-${rideToast.result}`} key={rideToast.id}>
              <div className="ride-grade">
                <span>{sessionFormat === "heat" ? "JUDGES" : rideToast.result === "clean" ? "CLEAN LINE" : "LINE LOST"}</span>
                <strong>{sessionFormat === "heat" ? heatWaveForToast?.judgeScore.toFixed(2) : rideToast.grade}</strong>
              </div>
              <div className="ride-recap-copy">
                <span>{sessionFormat === "heat" ? `HEAT WAVE ${String(heatWaveNumber).padStart(2, "0")} · ${rideToast.result === "clean" ? "MADE" : "INCOMPLETE"}` : rideToast.result === "clean" ? "WAVE COMPLETE" : "WIPEOUT / RESET"}</span>
                <strong>{sessionFormat === "heat" ? `${heatWaveForToast?.judgeScore.toFixed(2)} / 10` : `${rideToast.score.toLocaleString()} PTS`}</strong>
                <small>{rideToast.distance.toFixed(0)} m line · {rideToast.pocketDistance.toFixed(0)} m pocket · {rideToast.maneuvers} moves · {rideToast.barrelTime.toFixed(1)}s barrel · {rideToast.maxSpeed.toFixed(1)} m/s peak · {rideToast.maxCombo.toFixed(1)}× flow{sessionFormat === "heat" ? ` · ${rideToast.score.toLocaleString()} raw` : ""}</small>
                {rideAnalysis && (
                  <div className="ride-analysis">
                    <div className="ride-analysis-bars" aria-label="Physics-based ride analysis">
                      {rideAnalysis.categories.map((category, index) => (
                        <article
                          key={category.key}
                          className={`${category.key === rideAnalysis.strongest ? "is-strength" : ""} ${category.key === rideAnalysis.focus ? "is-focus" : ""}`}
                          aria-label={`${category.label} ${category.value} percent`}
                        >
                          <span>{category.label}</span>
                          <strong>{category.value}</strong>
                          <i><b style={{ width: `${category.value}%`, animationDelay: `${.16 + index * .08}s` }} /></i>
                        </article>
                      ))}
                    </div>
                    <p>
                      <span>COACH CALL</span>
                      <strong>{rideAnalysis.headline}</strong>
                      <small>{rideAnalysis.detail}</small>
                    </p>
                  </div>
                )}
                {passportAward && (
                  <em className={`passport-award level-${passportAward.level}`}>
                    <Trophy />
                    <span>WORLD TOUR STAMP</span>
                    <strong>{passportAward.label}</strong>
                    <b>{passportAward.level}/3</b>
                  </em>
                )}
              </div>
              <div className="ride-actions">
                {replayReady && (
                  <button
                    type="button"
                    className="ride-replay"
                    onClick={() => startReplay(rideToast)}
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label="Watch an in-engine replay of this ride"
                  >
                    <Clapperboard />
                    <span>WATCH REPLAY</span>
                  </button>
                )}
                <button
                  type="button"
                  className={`ride-share is-${shareStatus}`}
                  onClick={() => void shareRide(rideToast)}
                  onPointerDown={(event) => event.stopPropagation()}
                  disabled={shareStatus === "working"}
                  aria-label="Share this Surfscape ride"
                >
                  {shareStatus === "shared" || shareStatus === "copied" ? <CircleCheck /> : <Share2 />}
                  <span>{shareStatus === "working" ? "OPENING SHARE" : shareStatus === "shared" ? "SHARED" : shareStatus === "copied" ? "LINK COPIED" : shareStatus === "error" ? "TRY AGAIN" : "SHARE RIDE"}</span>
                </button>
              </div>
            </div>
          )}

          <div className={`balance-instrument ${stats.phase === "riding" || stats.phase === "paddling" ? "is-active" : ""} ${stats.phase === "paddling" ? "is-prone" : ""} ${standingOnBoard ? "is-standing" : ""} ${ridingOut ? "is-exit" : ""} ${showPhysicalLandingGuide ? "is-landing" : ""} ${!stats.maneuverActive && stats.trickCharge > .04 ? "is-charging" : ""}`}>
            <div className="balance-label">
              <span>{stats.phase === "paddling" ? "PRONE HULL" : standingOnBoard && stats.trickCharge <= .04 ? rollInstrumentTitle : ridingOut ? "SHALLOW EXIT" : stats.maneuverActive ? stats.maneuverPhase.toUpperCase() : stats.trickCharge > .04 ? "BODY COMPRESSION" : rollInstrumentTitle} <em className={showPhysicalLandingGuide ? "is-landing" : stats.trickCharge > .04 ? "is-charging" : stats.barrelIntensity > 0.2 ? "is-barrel" : ""}>{stats.phase === "paddling" ? `${Math.round(stats.boardWaterContact * 100)}% CONTACT · ${pitchDirection} ${pitchDegrees}°` : standingOnBoard && stats.trickCharge <= .04 ? standingLoadLabel : ridingOut ? "CLEAN LINE · FULL WATER LOAD" : stats.maneuverActive ? `${stats.maneuverPhase === "air" ? "AIRBORNE" : "HULL RELEASED"} · ${Math.round(stats.maneuverProgress * 100)}% OBSERVED` : stats.trickCharge > .04 ? `${Math.round(stats.trickCharge * 100)}% CROUCH · ${stats.lipLaunchSupport > .42 ? `LIP SUPPORT ${Math.round(stats.lipLaunchSupport * 100)}%` : "NO LIP SUPPORT"}` : stats.barrelIntensity > 0.2 ? `IN THE BARREL · ${stats.barrelTime.toFixed(1)}s · ${Math.round(stats.barrelIntensity * 100)}% PRESSURE` : hydrodynamicLoadLabel}</em></span>
              <strong>{stats.maneuverActive ? `${Math.round((1 - Math.min(1, Math.abs(stats.balance - stats.balanceTarget))) * 100)}%` : `${attitudeDegrees}°`}</strong>
            </div>
            <div
              className="balance-track"
              role="meter"
              aria-label={`Requested lean ${Math.round(stats.balanceIntent * 100)} percent; lateral body center of mass ${Math.round(stats.balance * 100)} percent; counter-torque target ${Math.round(stats.balanceTarget * 100)} percent`}
              aria-valuemin={-100}
              aria-valuemax={100}
              aria-valuenow={Math.round(stats.balance * 100)}
            >
              {showPhysicalLandingGuide && <i className="landing-zone" style={{ left: `${(landingMin + 1) * 50}%`, width: `${(landingMax - landingMin) * 50}%` }} />}
              <i className="balance-safe" style={{ left: `${(stats.balanceTarget + 1) * 50}%` }} />
              <i className="balance-intent" style={{ left: `${(stats.balanceIntent + 1) * 50}%` }} />
              <b style={{ left: `${(stats.balance + 1) * 50}%` }} />
            </div>
            <div className="stance-track">
              <span>TAIL / TURN</span><i><b style={{ left: `${(stats.stance + 1) * 50}%` }} /></i><span>NOSE / TRIM</span>
            </div>
            <div className={`face-track ${Math.abs(stats.facePosition) > .56 ? "is-committed" : ""}`}>
              <span>TROUGH</span><i><em /><b style={{ left: `${faceIndicator}%` }} /></i><span>LIP</span><strong>{faceLabel}</strong>
            </div>
            <div className={`line-track ${stats.whitewaterPressure > .28 ? "is-risk is-foam" : stats.sectionPressure > .48 ? "is-risk" : stats.lineControl > .76 ? "is-locked" : ""}`}>
              <span>DEEP</span><i><em /><span className="whitewater-load" style={{ width: `${Math.min(36, stats.whitewaterPressure * 36)}%` }} aria-hidden="true" /><b style={{ left: `${lineIndicator}%` }} /></i><span>SHOULDER</span><strong>{lineLabel}</strong>
            </div>
            <div className={`grip-track ${stats.railGrip < .5 ? "is-releasing" : ""}`}>
              <span>RAIL GRIP</span><i><b style={{ width: `${Math.round(stats.railGrip * 100)}%` }} /></i><strong>{Math.round(stats.railGrip * 100)}%</strong>
            </div>
            <small>{stats.phase === "paddling" ? "The nose, tail, and both rails sample the live polygon surface · Q/E shifts prone body weight toward the marker" : standingOnBoard && stats.trickCharge <= .04 ? "A/D applies roll torque · Q/E counterweights · SPACE compresses the body · SHIFT returns prone" : ridingOut ? "Keep steering and counterweighting · wave pressure and wipeout risk remain live until the shallow dismount" : stats.maneuverActive ? stats.maneuverAirborne ? "Counter unwanted roll and pitch; rail authority returns only when the hull reconnects with water" : "The board is tracing its own lip path; separation and reconnection will name the result" : stats.trickCharge > .04 ? "Your legs are storing compression; extension redirects the board only when its loaded tail still has live lip support" : stats.whitewaterPressure > .28 ? `Broken water is loading the board · drive ${stats.lineSide > 0 ? "right" : "left"} toward the open face` : stats.barrelIntensity > .28 ? "Stay compact, hold the high line, and make small counterweight corrections through the tube" : stats.sectionPressure > .48 ? "Steer back toward the illuminated power pocket" : "A/D creates board roll · W/S shifts nose-to-tail pressure · Q/E arrests unwanted roll"}</small>
          </div>

          <div className={`vehicle-instrument ${stats.vehicleMode ? "is-active" : ""} ${stats.vehicleSlip > .24 ? "is-slipping" : ""}`}>
            <div className="vehicle-dial">
              <span>{stats.vehicleGear}</span>
              <strong>{Math.round(stats.speed * 3.6)}</strong>
              <small>KM/H</small>
            </div>
            <div className="vehicle-copy">
              <span>COAST RUNNER / SURF RACK 03</span>
              <strong>{stats.vehicleSlip > .24 ? "Tires sliding — unwind the steering" : `${vehicleSurfaceLabel} · ${coastPosition}`}</strong>
              <div className="vehicle-grip">
                <i><b style={{ width: `${vehicleGrip}%` }} /></i>
                <em>{vehicleGrip}% GRIP</em>
              </div>
              <small>W/S throttle · A/D steer · SPACE exits when stopped</small>
            </div>
          </div>

          <div className="game-conditions">
            <div><Waves /><span>FACE</span><strong>{(settings.waveHeight * tideResponse.faceScale).toFixed(1)} m</strong></div>
            <div><Wind /><span>SWELL</span><strong>{settings.swellHeight.toFixed(1)}m · {settings.swellPeriod.toFixed(0)}s</strong></div>
            <div><ArrowRight /><span>BREAK / TIDE</span><strong>{activeLine} · {tideResponse.shortName}</strong></div>
            <div><Gauge /><span>SPEED</span><strong>{(stats.speed * 3.6).toFixed(0)} km/h</strong></div>
            <div>
              <Crosshair />
              <span>{stats.phase === "paddling" ? "OFFSHORE" : stats.phase === "driving" ? "COAST" : "DISTANCE"}</span>
              <strong>
                {stats.phase === "paddling"
                  ? stats.offshoreDistance.toFixed(0)
                  : stats.phase === "driving"
                    ? Math.abs(stats.coastDistance).toFixed(0)
                    : stats.rideDistance.toFixed(0)} m
              </strong>
            </div>
            <div><Thermometer /><span>WATER / KIT</span><strong>{settings.waterTemperature.toFixed(0)}° · {thermalKit.shortName}</strong></div>
          </div>

          <div className="desktop-controls">
            {gamepadConnected ? (
              <>
                <span><kbd>LS</kbd> {stats.vehicleMode ? "steer / throttle" : standingOnBoard ? "roll / shift stance" : stats.phase === "riding" ? "roll / stance pressure" : takeoffCommitted ? "fore-aft foot pressure" : "paddle / steer"}</span>
                <span><kbd>LT</kbd><kbd>RT</kbd> counterweight / recover</span>
                <span><kbd>A</kbd> {stats.phase === "riding" ? "crouch / extend" : stats.vehicleMode ? "exit when stopped" : stats.nearVan ? "drive van" : stats.phase === "paddling" ? "stand anytime" : "context action"}</span>
                {(stats.phase === "paddling" || stats.phase === "riding") && <span><kbd>LB</kbd> {stats.phase === "riding" ? "return prone anytime" : "duck dive anytime · cue marks timing"}</span>}
                <span><kbd>RS</kbd> freelook</span>
                <span><kbd>RB</kbd> camera · <kbd>START</kbd> pause</span>
              </>
            ) : stats.vehicleMode ? (
              <>
                <span><kbd>W</kbd><kbd>S</kbd> throttle / brake</span>
                <span><kbd>A</kbd><kbd>D</kbd> steer</span>
                <span><kbd>SPACE</kbd> exit when stopped</span>
                <span><kbd>C</kbd> camera · <kbd>R</kbd> center view</span>
                <span><span className="mouse-icon" /> click to lock 360° view</span>
              </>
            ) : (
              <>
                {stats.phase === "shore" || stats.phase === "wading" ? (
                  <>
                    <span><kbd>WASD</kbd> camera-relative move</span>
                    <span><kbd>SHIFT</kbd> run across the beach</span>
                  </>
                ) : (
                  <>
                    <span><kbd>A</kbd><kbd>D</kbd> {standingOnBoard ? "apply roll torque" : stats.phase === "paddling" ? takeoffCommitted ? "steady the last stroke / heading" : "bias paddle side / pivot" : "roll onto rail"}</span>
                    <span><kbd>W</kbd><kbd>S</kbd> {standingOnBoard || stats.phase === "riding" ? "shift nose / tail pressure" : takeoffCommitted ? "place pop-up foot pressure" : "paddle / brake"}</span>
                  </>
                )}
                <span><kbd>SPACE</kbd> {stats.phase === "riding" ? "compress · release only with lip support" : stats.nearVan ? "drive van" : stats.phase === "paddling" ? "stand anytime" : "context action"}</span>
                {(stats.phase === "paddling" || stats.phase === "riding") && <span><kbd>SHIFT</kbd> {stats.phase === "riding" ? "return prone anytime" : "duck dive anytime · cue marks timing"}</span>}
                <span><kbd>C</kbd> camera · <kbd>R</kbd> center view</span>
                <span>{stats.phase === "riding" || stats.phase === "paddling" ? <><kbd>Q</kbd><kbd>E</kbd> counterweight / recover</> : <><span className="mouse-icon" /> click to lock 360° view</>}</span>
              </>
            )}
          </div>

          <div
            className={`mobile-controls phase-${stats.phase} ${stats.duckDiveReady ? "is-dive-ready" : ""} ${stats.phase === "riding" && stats.railGrip < .48 ? "is-grip-warning" : ""} ${(stats.phase === "riding" || stats.phase === "paddling") && (stats.maneuverActive ? balanceAccuracy < 58 : stats.rollEdgeRisk > .34 || stats.pitchOverRisk > .38 || stats.airborneHeight > .055) ? "is-balance-warning" : ""} ${stats.phase === "riding" && stats.lineControl > .82 && stats.sectionPressure < .38 ? "is-pocket-locked" : ""}`}
            style={mobileControlStyle}
          >
            <div
              className="analog-stick"
              role="group"
              aria-label="Analog movement stick. Drag partway to walk or fully to run."
              onPointerDown={updateJoystick}
              onPointerMove={updateJoystick}
              onPointerUp={endJoystick}
              onPointerCancel={endJoystick}
              onLostPointerCapture={() => clearAnalogMovement()}
            >
              <span className="analog-ring" />
              <span ref={joystickKnob} className="analog-knob"><i /></span>
              <small>{stats.phase === "shore" || stats.phase === "wading" ? "MOVE / RUN" : "MOVE / STEER"}</small>
            </div>
            <div className={`mobile-balance-stack ${motionBalanceActive ? "is-motion" : ""}`}>
              {motionBalanceStatus !== "unavailable" && motionBalanceStatus !== "checking" && (
                <button
                  type="button"
                  className={`motion-balance-toggle status-${motionBalanceStatus}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => void toggleMotionBalance()}
                  aria-pressed={motionBalanceActive}
                  disabled={motionBalanceStatus === "requesting"}
                >
                  <Smartphone />
                  <span>{motionBalanceLabel}</span>
                  <small>{motionBalanceActive ? "TILT · TAP OFF" : motionBalanceStatus === "denied" ? "CHECK BROWSER ACCESS" : "FREE YOUR THUMB"}</small>
                </button>
              )}
              {(stats.phase === "riding" || stats.phase === "paddling") ? (
                <div
                  className={`touch-balance ${motionBalanceActive ? "is-motion" : ""} ${showPhysicalLandingGuide ? "is-landing" : ""} ${balanceAccuracy >= 88 ? "is-locked" : ""}`}
                  role={motionBalanceActive ? "meter" : "slider"}
                  aria-label={motionBalanceActive ? "Motion counterweight intent. Tilt toward the glowing counter-torque target; the white body center-of-mass marker follows with inertia." : "Surf counterweight intent. Request a lean toward the glowing counter-torque target; the white body center-of-mass marker follows with inertia."}
                  aria-valuemin={-100}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(stats.balance * 100)}
                  aria-valuetext={`Body center of mass ${Math.round(stats.balance * 100)} percent; target ${Math.round(stats.balanceTarget * 100)} percent`}
                  tabIndex={motionBalanceActive ? -1 : 0}
                  onPointerDown={updateTouchBalance}
                  onPointerMove={updateTouchBalance}
                  onPointerUp={endTouchBalance}
                  onPointerCancel={endTouchBalance}
                  onLostPointerCapture={endTouchBalance}
                  onKeyDown={(event) => {
                    if (motionBalanceActive || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                    event.preventDefault();
                    controls.current.balance = THREEClamp(controls.current.balance + (event.key === "ArrowRight" ? .08 : -.08), -1, 1);
                  }}
                >
                  <span>
                    <em>{stats.maneuverActive ? `${stats.maneuverPhase.toUpperCase()} ${Math.round(stats.maneuverProgress * 100)}%` : stats.trickCharge > .04 ? `CROUCHED ${Math.round(stats.trickCharge * 100)}%` : motionBalanceActive ? "TILT TO COUNTER ROLL" : "COUNTER BOARD ROLL"}</em>
                    <strong>{stats.maneuverActive ? `${balanceAccuracy}%` : `${rollDegrees}°`}</strong>
                  </span>
                  {showPhysicalLandingGuide && <i className="touch-landing-zone" style={{ left: `${(landingMin + 1) * 50}%`, width: `${(landingMax - landingMin) * 50}%` }} />}
                  <i
                    className={`touch-rail-pressure ${stats.railLoad < 0 ? "is-left" : "is-right"}`}
                    style={{ width: `${Math.min(48, Math.abs(stats.railLoad) * 48)}%` }}
                  />
                  <i className="touch-balance-target" style={{ left: `${touchTargetPosition}%` }} />
                  <i className="touch-balance-intent" style={{ left: `${touchBalanceIntentPosition}%` }} />
                  <b className="touch-balance-thumb" style={{ left: `${touchBalancePosition}%` }} />
                  <small><em>{motionBalanceActive ? "TILT LEFT" : "LEAN LEFT"}</em><em>{motionBalanceActive ? "TILT RIGHT" : "LEAN RIGHT"}</em></small>
                </div>
              ) : (
                <div className="touch-context" aria-live="polite">
                  <strong>{mobileContext.title}</strong>
                  <small>{mobileContext.detail}</small>
                </div>
              )}
            </div>
            {(
              (stats.phase === "paddling" && !takeoffCommitted)
              || stats.phase === "riding"
            ) && (
              <button
                type="button"
                className={`dive-button ${stats.phase === "riding" ? "is-prone" : ""} ${stats.duckDiveReady ? "is-ready" : ""} ${stats.duckDiveActive || stats.proneTransition > .01 ? "is-active" : ""}`}
                aria-label={stats.phase === "riding"
                  ? stats.proneTransition > .01
                    ? `Returning prone. ${Math.round(stats.proneTransition * 100)} percent complete.`
                    : "Return prone now while preserving the board's momentum and water state."
                  : stats.duckDiveReady
                    ? `Duck dive. Shorebreak arrives in ${stats.shorebreakSeconds.toFixed(1)} seconds.`
                    : "Duck dive now. Timing and board depth determine whether an incoming wall passes overhead."}
                onPointerDown={(event) => beginControl(event, "sprint")}
                onPointerUp={endMobileDive}
                onPointerCancel={endMobileDive}
                onLostPointerCapture={() => setControl("sprint", false)}
                aria-disabled={stats.phase === "paddling" && stats.duckDiveActive}
              >
                <Waves />
                <span>{stats.phase === "riding"
                  ? stats.proneTransition > .01 ? "LOWER" : "PRONE"
                  : stats.duckDiveActive ? "UNDER" : "DIVE"}</span>
                <small>{stats.phase === "riding"
                  ? stats.proneTransition > .01
                    ? `${Math.round(stats.proneTransition * 100)}%`
                    : "ANYTIME"
                  : stats.duckDiveActive
                    ? `${Math.round(stats.submersion * 100)}%`
                    : stats.duckDiveReady
                      ? `${stats.shorebreakSeconds.toFixed(1)}s`
                      : "ANYTIME"}</small>
              </button>
            )}
            <button
              type="button"
              className={`action-button ${mobileActionIsContextual ? "is-contextual" : "is-propulsion"} ${stats.maneuverActive ? "is-landing" : ""} ${!stats.maneuverActive && stats.trickCharge > .04 ? "is-charging" : ""}`}
              style={{ "--trick-charge": `${Math.round(stats.trickCharge * 360)}deg` } as CSSProperties}
              aria-label={mobileActionLabel}
              onPointerDown={(event) => beginControl(event, mobileActionIsContextual ? "action" : "forward")}
              onPointerUp={endMobileAction}
              onPointerCancel={endMobileAction}
              onLostPointerCapture={() => { setControl("forward", false); setControl("action", false); }}
            >
              {stats.phase === "riding" && !stats.maneuverActive && stats.trickCharge > .02 && <i className="action-charge" aria-hidden="true" />}
              <span>{mobileActionLabel}</span>
              {stats.vehicleMode || stats.nearVan ? <CarFront /> : stats.phase === "riding" || takeoffCommitted ? <Sparkles /> : <Waves />}
            </button>
            {stats.phase === "riding" && (
              <div className={`touch-ride-telemetry ${stats.whitewaterPressure > .28 || stats.sectionPressure > .52 ? "is-risk" : stats.lineControl > .82 ? "is-locked" : ""}`} aria-label={`Stance ${stanceLabel}. Face ${faceLabel}. Line ${lineLabel}. Whitewater pressure ${Math.round(stats.whitewaterPressure * 100)} percent. Rail grip ${Math.round(stats.railGrip * 100)} percent.`}>
                <span><small>STANCE</small><strong>{stanceLabel}</strong></span>
                <span><small>FACE</small><strong>{faceLabel}</strong></span>
                <span><small>LINE</small><strong>{lineLabel}</strong></span>
                <span className="touch-grip"><small>RAIL</small><strong>{Math.round(stats.railGrip * 100)}%</strong><i><b /></i></span>
              </div>
            )}
          </div>

          {heatComplete && (
            <div className={`heat-results ${heatWon ? "is-qualified" : ""}`} role="dialog" aria-modal="true" aria-labelledby="heat-result-title">
              <div className="heat-results-card">
                <header>
                  <div>
                    <Trophy />
                    <span>WORLD TOUR HEAT · {beach.name.toUpperCase()}</span>
                  </div>
                  <small>{zoneLabel.toUpperCase()} · BEST TWO WAVES COUNT</small>
                </header>
                <div className="heat-results-hero">
                  <div>
                    <span>{heatWon ? "QUALIFICATION LINE CLEARED" : "HEAT COMPLETE"}</span>
                    <h2 id="heat-result-title">{heatWon ? "YOU ADVANCE." : "FIND THE NEXT WAVE."}</h2>
                    <p>
                      {heatWon
                        ? `${heatTotal.toFixed(2)} beats the ${heatTarget.toFixed(2)} coast target. That line is now part of your Surf Passport.`
                        : `${heatNeed.toFixed(2)} points separated this heat from the ${heatTarget.toFixed(2)} qualification line.`}
                    </p>
                  </div>
                  <div className="heat-total-lockup">
                    <span>HEAT TOTAL</span>
                    <strong>{heatTotal.toFixed(2)}</strong>
                    <small>/ 20.00</small>
                  </div>
                </div>
                <div className="heat-counting-waves">
                  {[0, 1].map((slot) => {
                    const wave = countedHeatWaves[slot];
                    return (
                      <article key={slot} className={wave ? "is-scored" : ""}>
                        <span>COUNTING WAVE {slot + 1}</span>
                        <strong>{wave?.judgeScore.toFixed(2) ?? "—"}</strong>
                        <small>{wave ? `${wave.distance.toFixed(0)} m · ${wave.maneuvers} moves · ${wave.grade} grade` : "No score posted"}</small>
                        <i><b style={{ width: `${(wave?.judgeScore ?? 0) * 10}%` }} /></i>
                      </article>
                    );
                  })}
                </div>
                <div className="heat-scorecard">
                  <div className="heat-scorecard-heading">
                    <span>JUDGES&apos; SCORECARD</span>
                    <strong>{heatWaves.length} WAVES · COAST BEST {Math.max(currentCoastRecord.bestHeat, heatTotal).toFixed(2)}</strong>
                  </div>
                  {rankedHeatWaves.length > 0 ? (
                    <div>
                      {rankedHeatWaves.slice(0, 6).map((wave, index) => (
                        <span key={wave.id} className={countedHeatWaveIds.has(wave.id) ? "is-counting" : ""}>
                          <i>{String(index + 1).padStart(2, "0")}</i>
                          <b>{wave.judgeScore.toFixed(2)}</b>
                          <small>{wave.result === "clean" ? "MADE" : "FELL"} · {wave.distance.toFixed(0)} M · {wave.maneuvers} MOVES</small>
                          {countedHeatWaveIds.has(wave.id) ? <CircleCheck /> : <em>DROP</em>}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p>No scoring rides were completed before the horn.</p>
                  )}
                </div>
                <footer>
                  <button type="button" className="heat-restart" onClick={restartSession}><RotateCcw /> SURF ANOTHER HEAT</button>
                  <button type="button" onClick={() => { setSessionFormat("free"); setHeatComplete(false); setHeatExpired(false); }}><Waves /> CONTINUE FREE SURF</button>
                  <button type="button" onClick={leaveSession}><MapPin /> CHOOSE ANOTHER BREAK</button>
                </footer>
              </div>
            </div>
          )}

          {paused && (
            <div className="pause-overlay">
              <div className="pause-card">
                <span className="overline">SESSION PAUSED</span>
                <h2>Listen to the break.</h2>
                <p>{zoneLabel} is running {settings.waveHeight.toFixed(1)} m at {settings.wavePeriod.toFixed(1)} seconds. Session grade {stats.grade} · personal best {personalBest.score.toLocaleString()}.</p>
                <button className="primary-pause" onClick={() => { clearAnalogMovement(); setPaused(false); }}><Play /> Return to water</button>
                <button className={`music-toggle ${musicEnabled ? "" : "is-off"}`} onClick={toggleMusic}><AudioLines /> Original score · {musicEnabled ? "On" : "Off"}</button>
                {motionBalanceStatus !== "unavailable" && motionBalanceStatus !== "checking" && (
                  <button
                    className={`motion-toggle ${motionBalanceActive ? "" : "is-off"} ${motionBalanceStatus === "denied" ? "is-denied" : ""}`}
                    onClick={() => void toggleMotionBalance()}
                    disabled={motionBalanceStatus === "requesting"}
                  >
                    <Smartphone /> Motion balance · {motionBalanceStatus === "requesting" ? "Requesting access" : motionBalanceStatus === "denied" ? "Browser access needed" : motionBalanceActive ? "On" : "Off"}
                  </button>
                )}
                {installPrompt && <button onClick={() => void installApp()}><Download /> Install Surfscape</button>}
                <button onClick={leaveSession}><MapPin /> Choose another break</button>
                <button onClick={restartSession}><RotateCcw /> Restart session</button>
              </div>
            </div>
          )}
        </section>
      )}

      {showHowTo && (
        <div className="howto-overlay" role="dialog" aria-modal="true" aria-labelledby="howto-title">
          <div className="howto-card">
            <button className="close-howto" onClick={() => setShowHowTo(false)} aria-label="Close"><X /></button>
            <span className="overline">FIELD GUIDE 01</span>
            <h2 id="howto-title">From sand to clean line.</h2>
            <div className="howto-steps">
              <article><span>01</span><Waves /><strong>Enter</strong><p>Choose a board and walk through the shallows. Click the scene to lock a 360° mouse view, or swipe on touch; use C or the camera button to frame your line.</p></article>
              <article><span>02</span><AudioLines /><strong>Read</strong><p>Paddle toward the lineup and read the surf radar in metres. Any strong crest can be caught: turn shoreward, match its speed, drive through the lift, then commit as the face takes the board.</p></article>
              <article><span>03</span><Sparkles /><strong>Flow</strong><p>A/D applies roll torque; the resulting bank angle loads the rail and turns the board. W/S shifts pressure between nose and tail. Your momentum and the polygon face decide where the board travels. Use Q/E to counter unwanted roll.</p></article>
              <article><span>04</span><CarFront /><strong>Roam</strong><p>Walk up to the coast road and press Space beside the van. Cruise between peaks, then stop to step out.</p></article>
            </div>
            <button className="launch-button compact" onClick={() => setShowHowTo(false)}><span>GOT IT — FIND A LINE</span><i><ArrowRight /></i></button>
          </div>
        </div>
      )}
    </main>
  );
}

function PlaygroundSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  formatter,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  formatter?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="lab-slider">
      <span>{label}</span>
      <strong>{formatter ? formatter(value) : `${value.toFixed(step < 0.1 ? 2 : 1)} ${unit}`}</strong>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function THREEClamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
