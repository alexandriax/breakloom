"use client";

import dynamic from "next/dynamic";
import {
  ArrowRight,
  AudioLines,
  BatteryMedium,
  Camera,
  CarFront,
  ChevronDown,
  CircleCheck,
  CloudSun,
  Crosshair,
  Gauge,
  Gamepad2,
  LoaderCircle,
  MapPin,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Share2,
  Sparkles,
  Target,
  Volume2,
  VolumeX,
  Waves,
  Wind,
  X,
} from "lucide-react";
import { CSSProperties, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BEACHES, DEFAULT_BEACH, getBreakCharacter, type Beach } from "@/lib/beaches";
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
  settingsFromConditions,
  type BoardType,
  type GameMode,
  type GameStats,
  type SessionSettings,
} from "@/lib/game";
import { SurfscapeAudio } from "@/lib/audio";
import type { CameraMode, ControlState } from "./SurfScene";
import TideSparkline from "./TideSparkline";

const SurfScene = dynamic(() => import("./SurfScene"), { ssr: false });
const WorldMap = dynamic(() => import("./WorldMap"), {
  ssr: false,
  loading: () => <div className="map-loading"><LoaderCircle className="spin" /> Loading shoreline…</div>,
});

type Screen = "launch" | "game";
type PersonalBest = { score: number; distance: number; combo: number };
type RideToast = {
  id: number;
  result: "clean" | "wipeout";
  score: number;
  distance: number;
  pocketDistance: number;
  maneuvers: number;
  barrelTime: number;
  grade: GameStats["grade"];
};
type ShareStatus = "idle" | "working" | "shared" | "copied" | "error";
type WakeLockSentinelLike = { released: boolean; release: () => Promise<void> };
type DualRumbleActuator = {
  playEffect: (type: "dual-rumble", parameters: {
    duration: number;
    startDelay: number;
    strongMagnitude: number;
    weakMagnitude: number;
  }) => Promise<unknown>;
};

const BOARD_OPTIONS = Object.keys(BOARD_SPECS) as BoardType[];
const INITIAL_MODELED_CONDITIONS = fallbackConditions(DEFAULT_BEACH, "2025-01-15T12:00:00.000Z");

const RECORD_KEY = "surfscape-personal-best-v1";
const WEATHER_PRESETS = [0, 3, 63, 73, 95] as const;
const CAMERA_MODES: CameraMode[] = ["follow", "immersive", "cinematic"];
const CAMERA_LABELS: Record<CameraMode, string> = {
  follow: "Follow",
  immersive: "Immersive",
  cinematic: "Cinematic",
};

function nextCameraMode(current: CameraMode) {
  return CAMERA_MODES[(CAMERA_MODES.indexOf(current) + 1) % CAMERA_MODES.length];
}

function haptic(pattern: number | number[]) {
  if (typeof navigator === "undefined") return;
  if (navigator.vibrate) navigator.vibrate(pattern);
  const beats = Array.isArray(pattern) ? pattern : [pattern];
  const duration = Math.min(260, Math.max(28, beats.reduce((total, beat) => total + beat, 0)));
  const intensity = Math.min(1, .22 + Math.max(...beats) / 64);
  const gamepad = Array.from(navigator.getGamepads?.() ?? []).find((candidate) => candidate?.connected);
  const actuator = (gamepad as (Gamepad & { vibrationActuator?: DualRumbleActuator }) | null)?.vibrationActuator;
  if (actuator) {
    void actuator.playEffect("dual-rumble", {
      duration,
      startDelay: 0,
      strongMagnitude: intensity * .72,
      weakMagnitude: intensity,
    }).catch(() => undefined);
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
    description: "Assisted timing, forgiving balance, and prompts through every phase.",
  },
  {
    id: "advanced",
    name: "Raw Ocean",
    kicker: "Advanced",
    description: "Manual catches, reactive rails, narrower balance windows, bigger multipliers.",
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
  { title: "Punch through", detail: "Tap Dive just before the shorebreak reaches you." },
  { title: "Reach the lineup", detail: "Paddle beyond the breaking waves." },
  { title: "Read the crest", detail: "Turn toward shore and wait for the takeoff window." },
  { title: "Commit to the drop", detail: "Catch the wave when the shoulder appears." },
  { title: "Track the pocket", detail: "Steer into the power zone and hold it for 15 metres." },
  { title: "Set the rail", detail: "Load a turn and land your first maneuver." },
  { title: "Finish clean", detail: "Stay composed through the inside section." },
] as const;

function reachedTrainingStep(stats: GameStats) {
  const waterPhase = stats.phase === "wading" || stats.phase === "paddling" || stats.phase === "riding" || stats.phase === "wipeout";
  const hasRidden = stats.phase === "riding" || stats.rideDistance > 0 || stats.rideResult !== "";
  let reached = 0;
  if (waterPhase) reached = 1;
  if (stats.shorebreakId > 0 || stats.inLineup || hasRidden) reached = 2;
  if (stats.inLineup || hasRidden) reached = 3;
  if (stats.catchReady || hasRidden) reached = 4;
  if (hasRidden) reached = 5;
  const hasTrackedPocket = stats.pocketDistance >= 15;
  if (hasTrackedPocket) reached = 6;
  if (hasTrackedPocket && stats.maneuverCount > 0) reached = 7;
  if (hasTrackedPocket && stats.maneuverCount > 0 && stats.rideResult === "clean") reached = 8;
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

function qualityLabel(conditions: Pick<SessionSettings, "waveHeight" | "wavePeriod" | "windSpeed" | "windDirection" | "coastHeading">) {
  const energy = conditions.waveHeight * Math.max(conditions.wavePeriod - 4, 1);
  const windAlignment = Math.cos(((conditions.windDirection - conditions.coastHeading) * Math.PI) / 180);
  if (energy > 28) return "Heavy water";
  if (windAlignment < -.35 && conditions.windSpeed < 24) return "Offshore groomed";
  if (conditions.wavePeriod >= 13 && conditions.windSpeed < 16) return "Glassy lines";
  if (conditions.waveHeight < 0.45) return "Small & clean";
  if (conditions.windSpeed > 25 && windAlignment > -.15) return "Onshore chop";
  if (conditions.windSpeed > 25) return "Wind affected";
  return "Rideable peaks";
}

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

function rideCardFile({
  ride,
  beach,
  zone,
  board,
  waveHeight,
  wavePeriod,
}: {
  ride: RideToast;
  beach: Beach;
  zone: string;
  board: string;
  waveHeight: number;
  wavePeriod: number;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve<File | null>(null);

  const accent = beach.palette[0];
  const sand = beach.palette[1];
  const background = context.createLinearGradient(0, 0, 1200, 630);
  background.addColorStop(0, "#020c12");
  background.addColorStop(.56, "#06242d");
  background.addColorStop(1, "#0a3f45");
  context.fillStyle = background;
  context.fillRect(0, 0, 1200, 630);

  const glow = context.createRadialGradient(900, 145, 12, 900, 145, 470);
  glow.addColorStop(0, `${accent}70`);
  glow.addColorStop(.42, `${accent}1c`);
  glow.addColorStop(1, "transparent");
  context.fillStyle = glow;
  context.fillRect(0, 0, 1200, 630);

  context.globalAlpha = .18;
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
  context.fillText(ride.result === "clean" ? "CLEAN LINE  /  RIDE RECORD" : "WIPEOUT  /  RIDE RECORD", 94, 128);

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
  const [paused, setPaused] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [trainingStep, setTrainingStep] = useState(0);
  const trainingStepValue = useRef(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("follow");
  const [showPlanner, setShowPlanner] = useState(true);
  const [showHowTo, setShowHowTo] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [personalBest, setPersonalBest] = useState<PersonalBest>({ score: 0, distance: 0, combo: 1 });
  const [recordsReady, setRecordsReady] = useState(false);
  const [maneuverToast, setManeuverToast] = useState<{ id: number; name: string; points: number; quality: number } | null>(null);
  const [takeoffToast, setTakeoffToast] = useState<{ label: string; quality: number } | null>(null);
  const [rideToast, setRideToast] = useState<RideToast | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [shorebreakToast, setShorebreakToast] = useState<{ id: number; result: "clean" | "hit"; quality: number } | null>(null);
  const controls = useRef<ControlState>({ ...EMPTY_CONTROLS });
  const audio = useRef<SurfscapeAudio | null>(null);
  const rideCard = useRef<File | null>(null);
  const wakeLock = useRef<WakeLockSentinelLike | null>(null);
  const previousPhase = useRef(stats.phase);
  const previousManeuverId = useRef(0);
  const previousManeuverActive = useRef(false);
  const previousChargeBand = useRef(0);
  const previousRideResultId = useRef(0);
  const previousCatchReady = useRef(false);
  const previousDuckDiveReady = useRef(false);
  const previousShorebreakId = useRef(0);
  const shorebreakToastTimer = useRef<number | null>(null);
  const previousBalanceLock = useRef(false);
  const lastBalanceHapticAt = useRef(0);
  const previousGripWarning = useRef(false);
  const previousVehicleSlipWarning = useRef(false);
  const previousPocketLock = useRef(false);
  const previousTakeoffPhase = useRef(stats.phase);
  const joystickKnob = useRef<HTMLSpanElement>(null);
  const joystickPointer = useRef<number | null>(null);
  const joystickBounds = useRef<DOMRect | null>(null);
  const balancePointer = useRef<number | null>(null);
  const balanceBounds = useRef<DOMRect | null>(null);
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
  const sessionConditions = useMemo(() => conditionsAtForecast(conditions, selectedForecast), [conditions, selectedForecast]);
  const availableForecastWindows = useMemo(() => forecastWindows(conditions), [conditions]);
  const sessionWeatherCode = settings.weatherCode;
  const sessionCloudCover = settings.mode === "playground" ? playgroundCloudCover(sessionWeatherCode) : sessionConditions.cloudCover;

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
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", " "].includes(key)) {
        event.preventDefault();
      }
      if (key === "w" || key === "arrowup") controls.current.forward = true;
      if (key === "s" || key === "arrowdown") controls.current.back = true;
      if (key === "a" || key === "arrowleft") controls.current.left = true;
      if (key === "d" || key === "arrowright") controls.current.right = true;
      if (key === "shift") controls.current.sprint = true;
      if (key === " ") controls.current.action = true;
      if (key === "c" && !event.repeat) {
        controls.current.lookYaw = 0;
        controls.current.lookPitch = 0;
        setCameraMode((current) => nextCameraMode(current));
        haptic(7);
      }
      if (key === "escape") setPaused((value) => !value);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "w" || key === "arrowup") controls.current.forward = false;
      if (key === "s" || key === "arrowdown") controls.current.back = false;
      if (key === "a" || key === "arrowleft") controls.current.left = false;
      if (key === "d" || key === "arrowright") controls.current.right = false;
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
  }, [screen]);

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
        controls.current.lookYaw = THREEClamp(controls.current.lookYaw - lookX * delta * 1.32, -1, 1);
        controls.current.lookPitch = THREEClamp(controls.current.lookPitch + lookY * delta * 1.08, -1, 1);
      }

      const nextCameraButton = Boolean(gamepad.buttons[5]?.pressed);
      if (nextCameraButton && !cameraButton) {
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
        setPaused((current) => !current);
        haptic(6);
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
  }, [screen]);

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
      if (stats.phase === "riding") {
        audio.current?.effect("catch");
        haptic([14, 24, 28]);
      }
      if (stats.phase === "driving") haptic(18);
      if (stats.phase === "wipeout") {
        audio.current?.effect("wipeout");
        haptic([34, 36, 58]);
      }
      previousPhase.current = stats.phase;
    }
    if (stats.catchReady && !previousCatchReady.current) haptic([7, 24, 13]);
    previousCatchReady.current = stats.catchReady;
    audio.current?.setVehicle(
      paused ? 0 : stats.speed,
      !paused && stats.vehicleMode,
      stats.vehicleThrottle,
      stats.vehicleOffRoad,
      stats.vehicleSlip,
      stats.vehicleMode && stats.vehicleThrottle < -.08 && stats.vehicleGear === "D",
    );
    audio.current?.setSurf(
      paused ? 0 : stats.speed,
      !paused && stats.phase === "riding",
      stats.setEnergy,
      stats.barrelIntensity,
      stats.railLoad,
      stats.railGrip,
      stats.trickCharge,
    );
    audio.current?.setScore(
      stats.phase,
      stats.setEnergy,
      stats.barrelIntensity,
      settings.timeOfDay,
      sessionWeatherCode,
      screen === "game" && !paused,
    );
    audio.current?.setEnvironment(
      settings.windSpeed,
      settings.waveHeight,
      sessionCloudCover,
      paused ? 0.34 : screen === "game" ? .4 + stats.sessionIntro * .6 : .42,
      sessionWeatherCode,
    );
    audio.current?.setSubmersion(
      paused
        ? 0
        : stats.phase === "wipeout"
          ? 1
          : stats.duckDiveActive
            ? .72 + stats.duckDiveQuality * .24
            : 0,
    );
    const movementSpeed = stats.phase === "paddling" ? stats.speed * stats.paddleEffort : stats.speed;
    audio.current?.setMovement(
      stats.phase,
      paused ? 0 : movementSpeed,
      !paused && !stats.vehicleMode,
    );
  }, [paused, screen, sessionCloudCover, sessionWeatherCode, settings.timeOfDay, settings.waveHeight, settings.windSpeed, stats.barrelIntensity, stats.catchReady, stats.duckDiveActive, stats.duckDiveQuality, stats.paddleEffort, stats.phase, stats.railGrip, stats.railLoad, stats.sessionIntro, stats.setEnergy, stats.speed, stats.trickCharge, stats.vehicleGear, stats.vehicleMode, stats.vehicleOffRoad, stats.vehicleSlip, stats.vehicleThrottle]);

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
    if (stats.shorebreakId <= 0 || stats.shorebreakId === previousShorebreakId.current) return;
    previousShorebreakId.current = stats.shorebreakId;
    const clean = stats.shorebreakResult === "clean";
    setShorebreakToast({ id: stats.shorebreakId, result: clean ? "clean" : "hit", quality: stats.duckDiveQuality });
    audio.current?.effect(clean ? "duck" : "shorebreak");
    haptic(clean ? [7, 16, 10] : [18, 20, 28]);
    if (shorebreakToastTimer.current !== null) window.clearTimeout(shorebreakToastTimer.current);
    shorebreakToastTimer.current = window.setTimeout(() => {
      setShorebreakToast(null);
      shorebreakToastTimer.current = null;
    }, 1550);
  }, [stats.duckDiveQuality, stats.shorebreakId, stats.shorebreakResult]);

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
      audio.current?.effect("turn");
      haptic(stats.maneuverQuality >= .82 ? [9, 16, 24] : 12);
      const timer = window.setTimeout(() => setManeuverToast(null), 1800);
      return () => window.clearTimeout(timer);
    }
  }, [stats.maneuver, stats.maneuverId, stats.maneuverQuality, stats.maneuverScore]);

  useEffect(() => {
    const from = previousTakeoffPhase.current;
    previousTakeoffPhase.current = stats.phase;
    if (from === stats.phase || stats.phase !== "riding") return;
    const label = stats.takeoffQuality >= .8 ? "Clean entry" : stats.takeoffQuality >= .55 ? "Committed drop" : "Late takeoff";
    setTakeoffToast({ label, quality: stats.takeoffQuality });
    const timer = window.setTimeout(() => setTakeoffToast(null), 1700);
    return () => window.clearTimeout(timer);
  }, [stats.phase, stats.takeoffQuality]);

  useEffect(() => {
    if (stats.rideResultId > 0 && stats.rideResultId !== previousRideResultId.current && stats.rideResult) {
      previousRideResultId.current = stats.rideResultId;
      setManeuverToast(null);
      if (stats.rideResult === "clean") {
        audio.current?.effect("finish");
        haptic([10, 22, 10, 28, 16]);
      }
      setRideToast({
        id: stats.rideResultId,
        result: stats.rideResult,
        score: stats.rideScore,
        distance: stats.rideDistance,
        pocketDistance: stats.pocketDistance,
        maneuvers: stats.rideManeuvers,
        barrelTime: stats.barrelTime,
        grade: stats.rideGrade,
      });
      setShareStatus("idle");
      const timer = window.setTimeout(() => setRideToast(null), 8200);
      return () => window.clearTimeout(timer);
    }
  }, [stats.barrelTime, stats.pocketDistance, stats.rideDistance, stats.rideGrade, stats.rideManeuvers, stats.rideResult, stats.rideResultId, stats.rideScore]);

  useEffect(() => {
    let disposed = false;
    rideCard.current = null;
    if (!rideToast) return () => { disposed = true; };
    void rideCardFile({
      ride: rideToast,
      beach,
      zone: zoneLabel,
      board: BOARD_SPECS[settings.board].name,
      waveHeight: settings.waveHeight,
      wavePeriod: settings.wavePeriod,
    }).then((file) => {
      if (!disposed) rideCard.current = file;
    });
    return () => { disposed = true; };
  }, [beach, rideToast, settings.board, settings.waveHeight, settings.wavePeriod, zoneLabel]);

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
  };

  const chooseMode = (mode: GameMode) => {
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

  const startSession = async () => {
    if (!audio.current) audio.current = new SurfscapeAudio();
    await audio.current.start();
    audio.current.setEnabled(soundEnabled);
    audio.current.setMusicEnabled(musicEnabled);
    audio.current.setEnvironment(settings.windSpeed, settings.waveHeight, sessionCloudCover, .34, sessionWeatherCode);
    audio.current.setScore("shore", 0, 0, settings.timeOfDay, sessionWeatherCode, true);
    audio.current.setMovement("shore", 0, true);
    controls.current = { ...EMPTY_CONTROLS };
    clearAnalogMovement();
    setStats(INITIAL_STATS);
    trainingStepValue.current = 0;
    setTrainingStep(0);
    previousManeuverId.current = 0;
    previousRideResultId.current = 0;
    setManeuverToast(null);
    setRideToast(null);
    setShareStatus("idle");
    setSessionKey((value) => value + 1);
    setPaused(false);
    setScreen("game");
  };

  const leaveSession = () => {
    audio.current?.setVehicle(0, false);
    audio.current?.setSurf(0, false, 0, 0);
    audio.current?.setScore("shore", 0, 0, settings.timeOfDay, sessionWeatherCode, false);
    audio.current?.setMovement(stats.phase, 0, false);
    audio.current?.setEnvironment(settings.windSpeed, settings.waveHeight, sessionCloudCover, 0.42, sessionWeatherCode);
    controls.current = { ...EMPTY_CONTROLS };
    clearAnalogMovement();
    setScreen("launch");
    setPaused(false);
  };

  const toggleSound = async () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (!audio.current) audio.current = new SurfscapeAudio();
    await audio.current.start();
    audio.current.setEnabled(next);
    if (next) {
      audio.current.setEnvironment(settings.windSpeed, settings.waveHeight, sessionCloudCover, screen === "game" ? 1 : 0.42, sessionWeatherCode);
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

  const setControl = (name: keyof Pick<ControlState, "forward" | "back" | "left" | "right" | "action">, value: boolean) => {
    controls.current[name] = value;
  };

  const beginControl = (
    event: ReactPointerEvent<HTMLButtonElement>,
    name: keyof Pick<ControlState, "forward" | "back" | "left" | "right" | "action">,
  ) => {
    event.preventDefault();
    controls.current.gamepadActive = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    setControl(name, true);
    if (name === "action") haptic(9);
  };

  const endMobileAction = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setControl("forward", false);
    setControl("action", false);
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

  const updateBalance = (event: ReactPointerEvent<HTMLElement>) => {
    if (screen !== "game" || paused) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      controls.current.gamepadActive = false;
      controls.current.balance = THREEClamp((event.clientX / window.innerWidth - 0.5) * 2, -1, 1);
    }
  };

  const updateTouchBalance = (event: ReactPointerEvent<HTMLDivElement>) => {
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
    controls.current.lookYaw = THREEClamp(gesture.yaw - ((event.clientX - gesture.x) / span) * 2.45, -1, 1);
    controls.current.lookPitch = THREEClamp(gesture.pitch + ((event.clientY - gesture.y) / verticalSpan) * 2.1, -1, 1);
  };

  const endCameraLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lookGesture.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    lookGesture.current = null;
    event.currentTarget.classList.remove("is-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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
  const selectedMode = MODES.find((mode) => mode.id === settings.mode) ?? MODES[0];
  const conditionQuality = qualityLabel(settings);
  const breakCharacter = getBreakCharacter(beach.id, zoneLabel);
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
  const objectives = [
    { label: "Ride 40 m", done: stats.rideDistance >= 40 },
    { label: "Land 2 moves", done: stats.maneuverCount >= 2 },
    { label: "Barrel for 2s", done: stats.barrelTime >= 2 },
    { label: "Hold pocket 20 m", done: stats.pocketDistance >= 20 },
  ];
  const stanceLabel = stats.stance > 0.42 ? "NOSE DRIVE" : stats.stance < -0.42 ? "TAIL PRESSURE" : "CENTERED";
  const lineLabel = stats.linePosition < -.72
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
  const vehicleGrip = Math.round(stats.vehicleTraction * 100);
  const mobileActionIsContextual = stats.vehicleMode || stats.nearVan || stats.phase === "riding" || stats.catchReady || stats.duckDiveReady;
  const mobileActionLabel = stats.vehicleMode
    ? "EXIT"
    : stats.nearVan
      ? "DRIVE"
      : stats.phase === "riding"
        ? stats.maneuverActive
          ? stats.maneuverPhase === "air" ? "SPOT IT" : "LAND"
          : stats.trickCharge > .04 ? `RELEASE ${Math.round(stats.trickCharge * 100)}` : "HOLD TRICK"
        : stats.duckDiveReady
          ? "DIVE"
        : stats.catchReady
          ? "CATCH"
          : stats.phase === "paddling"
            ? "PADDLE"
            : "MOVE";
  const mobileContext = stats.vehicleMode
    ? {
        title: stats.vehicleSlip > .24 ? "SETTLE THE VAN" : vehicleSurfaceLabel,
        detail: `${vehicleGrip}% grip · ${stats.vehicleSlip > .24 ? "unwind the stick" : "stop before exit"}`,
      }
    : stats.phase === "shore"
      ? { title: "BEACH TRAVERSE", detail: "Full stick runs · drag scene to look" }
      : stats.phase === "wading"
        ? { title: "SHOREBREAK", detail: "Push through until the board floats" }
        : stats.phase === "paddling"
          ? stats.duckDiveActive
            ? { title: "UNDER THE LIP", detail: `Drive through · ${Math.round(stats.duckDiveQuality * 100)}% timing` }
            : stats.duckDiveReady
              ? { title: "DIVE NOW", detail: `${stats.shorebreakSeconds.toFixed(1)}s · tap DIVE and punch through` }
            : stats.catchReady
            ? { title: "TAKEOFF OPEN", detail: "Release paddle · tap CATCH now" }
            : stats.inLineup && stats.takeoffAlignment < .3
              ? { title: "TURN FOR SHORE", detail: "Left stick pivots the board into the wave" }
              : stats.inLineup
                ? { title: "HOLD THE LINEUP", detail: "Board is set · wait for the crest pulse" }
                : stats.shorebreakSeconds > 0 && stats.shorebreakSeconds < 2.8
                  ? { title: "WALL APPROACHING", detail: `${stats.shorebreakSeconds.toFixed(1)}s · keep paddling and prepare to dive` }
                  : { title: "READ THE CREST", detail: "Hold PADDLE · left stick turns" }
          : stats.phase === "wipeout"
            ? { title: "UNDERWATER", detail: "Breathe · the board is resetting" }
            : { title: "LINE RESET", detail: "Read the next wall of water" };
  const balanceAccuracy = Math.round((1 - Math.min(1, Math.abs(stats.balance - stats.balanceTarget))) * 100);
  const mobileControlStyle = {
    "--rail-grip": `${Math.round(stats.railGrip * 100)}%`,
  } as CSSProperties;
  const shorebreakTiming = Math.round((1 - THREEClamp(stats.shorebreakSeconds / 2.8, 0, 1)) * 100);
  const touchBalancePosition = (THREEClamp(stats.balance, -.94, .94) + 1) * 50;
  const touchTargetPosition = (THREEClamp(stats.balanceTarget, -.94, .94) + 1) * 50;
  const lensIntensity = stats.phase === "wipeout" ? 0.82 : stats.barrelIntensity * 0.72;
  const submersionIntensity = paused
    ? 0
    : stats.phase === "wipeout"
      ? .92
      : stats.duckDiveActive
        ? .68 + stats.duckDiveQuality * .24
        : 0;
  const submersionStyle = {
    "--submersion": submersionIntensity,
  } as CSSProperties;
  const velocityIntensity = stats.phase === "riding"
    ? Math.min(.34, Math.max(0, stats.speed - 8.5) * .026 + stats.barrelIntensity * .11)
    : 0;
  const cinemaBeat = rideToast?.result ?? (maneuverToast ? "maneuver" : takeoffToast ? "takeoff" : null);
  const cinemaBeatKey = rideToast?.id ?? maneuverToast?.id ?? (takeoffToast ? Math.round(takeoffToast.quality * 100) : 0);
  const landingMin = Math.max(-1, stats.landingTarget - stats.landingWindow);
  const landingMax = Math.min(1, stats.landingTarget + stats.landingWindow);
  const landingLabel = maneuverToast
    ? maneuverToast.quality >= .82 ? "STOMPED" : maneuverToast.quality >= .48 ? "LANDED" : "RECOVERED"
    : "LANDED";
  const sessionIntroActive = stats.sessionIntro < .999;
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
    <main className={`surfscape ${screen === "game" ? "is-playing" : "is-launch"}`} style={accentStyle} onPointerMove={updateBalance}>
      <div className="scene-layer" aria-hidden={screen === "launch"}>
        <SurfScene
          key={`${beach.id}-${sessionKey}`}
          beach={beach}
          zoneName={zoneLabel}
          settings={settings}
          cloudCover={sessionCloudCover}
          weatherCode={sessionWeatherCode}
          sunrise={sessionConditions.sunrise}
          sunset={sessionConditions.sunset}
          cameraMode={cameraMode}
          controls={controls}
          active={screen === "game" && !paused}
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
            <div className="launch-nav">
              <span className={`live-chip ${conditions.source === "live" ? "is-live" : ""}`}>
                <i /> {conditionsLoading ? "Reading buoy models" : selectedForecast ? "Forecast session" : conditions.source === "live" ? "Live ocean model" : "Modeled offline"}
              </span>
              <button className="icon-button" onClick={toggleSound} aria-label={soundEnabled ? "Mute sound" : "Enable sound"}>
                {soundEnabled ? <Volume2 /> : <VolumeX />}
              </button>
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
                  <em>{degrees(settings.waveDirection)}</em>
                </div>
                <div className="readout-metric">
                  <span>Period</span>
                  <strong>{settings.wavePeriod.toFixed(1)}<small>s</small></strong>
                  <em>{conditionQuality}</em>
                </div>
                <div className="readout-metric tide-readout">
                  <span>Tide · {settings.mode === "playground" ? "custom" : sessionConditions.tideTrend}</span>
                  <strong>{settings.tide >= 0 ? "+" : ""}{settings.tide.toFixed(2)}<small>m</small></strong>
                  {settings.mode !== "playground" && <TideSparkline points={conditions.tide} observedAt={sessionConditions.observedAt} />}
                </div>
              </div>

              <div className="mode-section">
                <div className="section-label"><span>01</span><p>Choose your relationship with the water</p></div>
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

            <aside className={`planner ${showPlanner ? "is-open" : ""}`}>
              <button className="planner-mobile-toggle" onClick={() => setShowPlanner((value) => !value)}>
                <MapPin /> {beach.name} <ChevronDown />
              </button>
              <div className="planner-inner">
                <div className="planner-head">
                  <div>
                    <span className="overline">02 / CHOOSE A LINE</span>
                    <h2>{beach.name}</h2>
                    <p>{beach.region} · {beach.country}</p>
                  </div>
                  <label className="break-select">
                    <span className="sr-only">Select surf destination</span>
                    <select value={beach.id} onChange={(event) => chooseBeach(BEACHES.find((item) => item.id === event.target.value) ?? DEFAULT_BEACH)}>
                      {BEACHES.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.country}</option>)}
                    </select>
                    <ChevronDown />
                  </label>
                </div>
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
                      <small>{weatherLabel(conditions.weatherCode)} · wind {conditions.windSpeed.toFixed(0)} km/h</small>
                      <i><b style={{ width: `${Math.min(100, conditions.waveHeight * Math.max(5, conditions.wavePeriod) * 3)}%` }} /></i>
                    </button>
                    {availableForecastWindows.map((point) => (
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
                        <small>{weatherLabel(point.weatherCode)} · wind {point.windSpeed.toFixed(0)} km/h</small>
                        <i><b style={{ width: `${Math.min(100, point.waveHeight * Math.max(5, point.wavePeriod) * 3)}%` }} /></i>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="break-description">{beach.description}</p>
                <div className="break-meta">
                  <span><Waves /> {beach.breakType}</span>
                  <span><ArrowRight /> {breakCharacter.line} · {breakCharacter.kind.toUpperCase()}</span>
                  <span><Gauge /> Difficulty {beach.difficulty}/5</span>
                  <span><Crosshair /> {latitude.toFixed(3)}, {longitude.toFixed(3)}</span>
                  <span className="data-credit">Model: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · DWD · Not for navigation</span>
                </div>
              </div>
            </aside>
          </div>

          {settings.mode === "playground" && (
            <section className="wave-lab-panel">
              <div className="lab-title"><Settings2 /><div><span>WAVE LAB</span><strong>Shape the session</strong></div></div>
              <PlaygroundSlider label="Face height" value={settings.waveHeight} min={0.3} max={6} step={0.1} unit="m" onChange={(waveHeight) => setSettings((value) => ({ ...value, waveHeight }))} />
              <PlaygroundSlider label="Period" value={settings.wavePeriod} min={5} max={22} step={0.5} unit="s" onChange={(wavePeriod) => setSettings((value) => ({ ...value, wavePeriod }))} />
              <PlaygroundSlider label="Wave bearing" value={settings.waveDirection} min={0} max={355} step={5} unit="" formatter={degrees} onChange={(waveDirection) => setSettings((value) => ({ ...value, waveDirection }))} />
              <PlaygroundSlider label="Current" value={settings.currentStrength} min={0} max={4} step={0.1} unit="km/h" onChange={(currentStrength) => setSettings((value) => ({ ...value, currentStrength }))} />
              <PlaygroundSlider label="Current bearing" value={settings.currentDirection} min={0} max={355} step={5} unit="" formatter={degrees} onChange={(currentDirection) => setSettings((value) => ({ ...value, currentDirection }))} />
              <PlaygroundSlider label="Wind" value={settings.windSpeed} min={0} max={45} step={1} unit="km/h" onChange={(windSpeed) => setSettings((value) => ({ ...value, windSpeed }))} />
              <PlaygroundSlider label="Wind bearing" value={settings.windDirection} min={0} max={355} step={5} unit="" formatter={degrees} onChange={(windDirection) => setSettings((value) => ({ ...value, windDirection }))} />
              <PlaygroundSlider label="Tide" value={settings.tide} min={-1.5} max={1.8} step={0.05} unit="m" onChange={(tide) => setSettings((value) => ({ ...value, tide }))} />
              <PlaygroundSlider label="Local hour" value={settings.timeOfDay} min={0} max={23.5} step={0.5} unit=":00" onChange={(timeOfDay) => setSettings((value) => ({ ...value, timeOfDay }))} />
              <button className="lab-weather" type="button" onClick={() => setSettings((value) => ({ ...value, weatherCode: nextWeatherPreset(value.weatherCode) }))} aria-label={`Weather preset: ${weatherLabel(settings.weatherCode)}. Tap to change.`}>
                <CloudSun /><span>Weather</span><strong>{weatherLabel(settings.weatherCode)}</strong><small>Tap to cycle</small>
              </button>
            </section>
          )}

          <footer className="launch-footer">
            <div className="session-summary">
              <span>{selectedMode.kicker}</span>
              <strong>{selectedMode.name}</strong>
              <i />
              <span>{zoneLabel}</span>
              <strong>{localTime} {sessionConditions.timezoneAbbreviation}</strong>
              <i />
              <span>Personal best</span>
              <strong>{personalBest.score.toLocaleString()}</strong>
              <i />
              <span>Board</span>
              <strong>{BOARD_SPECS[settings.board].name}</strong>
            </div>
            <button className="launch-button" onClick={startSession}>
              <span>ENTER THE WATER</span>
              <i><Play fill="currentColor" /></i>
            </button>
          </footer>
        </section>
      )}

      {screen === "game" && (
        <section className={`game-ui phase-${stats.phase} ${paused ? "is-paused" : ""} ${sessionIntroActive ? "is-intro" : ""}`} style={gameUiStyle}>
          <div
            className="camera-look-surface"
            aria-label="Drag to look around"
            onPointerDown={beginCameraLook}
            onPointerMove={updateCameraLook}
            onPointerUp={endCameraLook}
            onPointerCancel={endCameraLook}
            onLostPointerCapture={(event) => {
              lookGesture.current = null;
              event.currentTarget.classList.remove("is-dragging");
            }}
            onDoubleClick={centerCameraLook}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span>{gamepadConnected ? "RIGHT STICK VIEW · LT/RT BALANCE" : stats.phase === "riding" ? "DRAG VIEW / MOUSE BALANCE" : "FREELOOK · DRAG VIEW"} · {CAMERA_LABELS[cameraMode].toUpperCase()}</span>
          </div>
          <div className={`barrel-lens ${stats.phase === "wipeout" ? "is-wipeout" : ""}`} style={{ opacity: lensIntensity }} aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
          </div>
          <div
            className={`submersion-lens ${submersionIntensity > .01 ? "is-active" : ""} ${stats.phase === "wipeout" ? "is-wipeout" : "is-duck-dive"}`}
            style={submersionStyle}
            aria-hidden="true"
          >
            {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
          </div>
          <div className={`velocity-veil ${stats.barrelIntensity > .2 ? "is-barrel" : ""}`} style={{ opacity: velocityIntensity }} aria-hidden="true" />
          {cinemaBeat && <div className={`cinema-impact is-${cinemaBeat}`} key={`${cinemaBeat}-${cinemaBeatKey}`} aria-hidden="true" />}
          {sessionIntroActive && (
            <div className="session-intro" style={sessionIntroStyle} aria-live="polite">
              <div className="session-intro-title">
                <span>{selectedForecast ? "FORECAST SESSION" : conditions.source === "live" ? "LIVE OCEAN MODEL" : "MODELED SESSION"} · {settings.mode.toUpperCase()}</span>
                <h2>{zoneLabel}</h2>
                <p>{beach.name} · {beach.region}</p>
                <div>
                  <strong><Waves /> {settings.waveHeight.toFixed(1)} m</strong>
                  <strong><Wind /> {settings.wavePeriod.toFixed(1)} s</strong>
                  <strong><ArrowRight /> {breakCharacter.line}</strong>
                </div>
              </div>
              <small><i /> OCEAN MODEL LOCKED · CONTROLS LIVE</small>
            </div>
          )}
          <header className="game-topbar">
            <div className="game-brand">
              <Waves />
              <div><strong>SURFSCAPE</strong><span>{zoneLabel} · {beach.name} · {BOARD_SPECS[settings.board].name}</span></div>
            </div>
            <div className={`game-objective ${settings.mode === "training" ? "is-training" : ""} ${settings.mode === "training" && trainingComplete ? "is-complete" : ""}`}>
              <span>
                {settings.mode === "training"
                  ? trainingComplete
                    ? "TRAINING COMPLETE"
                    : `LESSON ${String(trainingStep + 1).padStart(2, "0")} / ${String(TRAINING_STEPS.length).padStart(2, "0")} · ${trainingLesson.title}`
                  : stats.phase}
              </span>
              <strong>{settings.mode === "training" && trainingComplete ? "First clean line complete — the ocean is open" : stats.prompt}</strong>
              {settings.mode === "training" && (
                <div className="coach-progress" role="progressbar" aria-label="Training progress" aria-valuemin={0} aria-valuemax={TRAINING_STEPS.length} aria-valuenow={trainingStep}>
                  {TRAINING_STEPS.map((step, index) => <i key={step.title} className={index < trainingStep ? "is-done" : index === trainingStep ? "is-current" : ""} />)}
                  <small>{trainingComplete ? "You are ready for Raw Ocean mode." : trainingLesson.detail}</small>
                </div>
              )}
            </div>
            <div className="game-actions">
              <button onClick={toggleSound} aria-label={soundEnabled ? "Mute" : "Unmute"}>{soundEnabled ? <Volume2 /> : <VolumeX />}</button>
              {gamepadConnected && <div className="controller-chip" role="status" aria-label="Game controller connected"><Gamepad2 /><span>PAD</span></div>}
              {fullscreenAvailable && (
                <button onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
                  {isFullscreen ? <Minimize2 /> : <Maximize2 />}
                </button>
              )}
              <button className="camera-button" onClick={cycleCamera} aria-label={`Camera: ${CAMERA_LABELS[cameraMode]}. Switch camera.`} title={`Camera: ${CAMERA_LABELS[cameraMode]}`}><Camera /></button>
              <button onClick={() => { clearAnalogMovement(); setPaused(true); }} aria-label="Pause"><Pause /></button>
            </div>
          </header>

          <div className="score-panel">
            <span>SESSION SCORE <b>{stats.grade}</b></span>
            <strong>{stats.score.toLocaleString()}</strong>
            <div><i style={{ width: `${Math.min(100, stats.combo * 12.5)}%` }} /></div>
            <small>{stats.combo.toFixed(1)}× flow · best {personalBest.score.toLocaleString()}</small>
          </div>

          <div className="set-panel">
            <div className="set-heading">
              <div><Waves /><span>SWELL RADAR</span></div>
              <strong>{stats.nextSetSeconds === 0 ? "SET HERE" : `${Math.ceil(stats.nextSetSeconds)}s`}</strong>
            </div>
            <div className="set-meter"><i style={{ width: `${Math.round(stats.setEnergy * 100)}%` }} /></div>
            {stats.phase === "paddling" && (
              <div className={`takeoff-window ${stats.catchReady ? "is-open" : ""} ${stats.duckDiveReady ? "is-dive" : ""}`}>
                <span>{stats.inLineup ? "TAKEOFF" : "SHOREBREAK"}</span>
                <i><b style={{ width: `${stats.inLineup ? Math.round(stats.takeoffQuality * 100) : shorebreakTiming}%` }} /></i>
                <strong>{stats.duckDiveReady ? "DIVE" : stats.catchReady ? "GO" : stats.inLineup ? `${Math.round(stats.takeoffQuality * 100)}%` : stats.shorebreakSeconds > 0 && stats.shorebreakSeconds < 3 ? `${stats.shorebreakSeconds.toFixed(1)}s` : "READ"}</strong>
              </div>
            )}
            <div className="stamina-row">
              <span><BatteryMedium /> STAMINA</span>
              <div><i style={{ width: `${stats.stamina}%` }} /></div>
              <strong>{stats.stamina}</strong>
            </div>
            <div className="session-goals">
              <span><Target /> SESSION LINES</span>
              {objectives.map((objective) => (
                <small key={objective.label} className={objective.done ? "is-done" : ""}>
                  {objective.done ? <CircleCheck /> : <i />} {objective.label}
                </small>
              ))}
            </div>
          </div>

          {shorebreakToast && !takeoffToast && !maneuverToast && !rideToast && (
            <div className={`shorebreak-toast is-${shorebreakToast.result}`} key={shorebreakToast.id}>
              <Waves />
              <span>{shorebreakToast.result === "clean" ? "CLEAN DIVE" : "WHITEWATER HIT"}</span>
              <strong>{shorebreakToast.result === "clean" ? "PUNCHED THROUGH" : "WASHED SHOREWARD"}</strong>
              <b>{Math.round(shorebreakToast.quality * 100)}%</b>
            </div>
          )}

          {maneuverToast && !rideToast && (
            <div className={`maneuver-toast quality-${maneuverToast.quality >= .82 ? "stomped" : maneuverToast.quality >= .48 ? "clean" : "recovered"}`} key={maneuverToast.id}>
              <Sparkles />
              <span>{landingLabel} · {Math.round(maneuverToast.quality * 100)}%</span>
              <strong>{maneuverToast.name}</strong>
              <b>+{maneuverToast.points.toLocaleString()}</b>
            </div>
          )}

          {takeoffToast && !maneuverToast && !rideToast && (
            <div className={`takeoff-toast ${takeoffToast.quality >= .8 ? "is-clean" : ""}`}>
              <Waves />
              <span>TAKEOFF</span>
              <strong>{takeoffToast.label}</strong>
              <b>{Math.round(takeoffToast.quality * 100)}%</b>
            </div>
          )}

          {rideToast && (
            <div className={`ride-recap is-${rideToast.result}`} key={rideToast.id}>
              <div className="ride-grade"><span>{rideToast.result === "clean" ? "CLEAN LINE" : "LINE LOST"}</span><strong>{rideToast.grade}</strong></div>
              <div className="ride-recap-copy">
                <span>{rideToast.result === "clean" ? "WAVE COMPLETE" : "WIPEOUT / RESET"}</span>
                <strong>{rideToast.score.toLocaleString()} PTS</strong>
                <small>{rideToast.distance.toFixed(0)} m line · {rideToast.pocketDistance.toFixed(0)} m pocket · {rideToast.maneuvers} moves · {rideToast.barrelTime.toFixed(1)}s barrel</small>
              </div>
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
          )}

          <div className={`balance-instrument ${stats.phase === "riding" ? "is-active" : ""} ${stats.maneuverActive ? "is-landing" : ""} ${!stats.maneuverActive && stats.trickCharge > .04 ? "is-charging" : ""}`}>
            <div className="balance-label">
              <span>{stats.maneuverActive ? stats.maneuverPhase.toUpperCase() : stats.trickCharge > .04 ? "TRICK LOAD" : "BALANCE"} <em className={stats.maneuverActive ? "is-landing" : stats.trickCharge > .04 ? "is-charging" : stats.barrelIntensity > 0.2 ? "is-barrel" : ""}>{stats.maneuverActive ? `${stats.maneuver} · ${Math.round(stats.maneuverProgress * 100)}%` : stats.trickCharge > .04 ? `${Math.round(stats.trickCharge * 100)}% · RELEASE TO COMMIT` : stats.barrelIntensity > 0.2 ? `IN THE BARREL · ${stats.barrelTime.toFixed(1)}s` : stanceLabel}</em></span>
              <strong>{Math.round((1 - Math.min(1, Math.abs(stats.balance - stats.balanceTarget))) * 100)}%</strong>
            </div>
            <div className="balance-track">
              {stats.maneuverActive && <i className="landing-zone" style={{ left: `${(landingMin + 1) * 50}%`, width: `${(landingMax - landingMin) * 50}%` }} />}
              <i className="balance-safe" style={{ left: `${(stats.balanceTarget + 1) * 50}%` }} />
              <b style={{ left: `${(stats.balance + 1) * 50}%` }} />
            </div>
            <div className="stance-track">
              <span>TAIL / CONTROL</span><i><b style={{ left: `${(stats.stance + 1) * 50}%` }} /></i><span>NOSE / SPEED</span>
            </div>
            <div className={`line-track ${stats.sectionPressure > .42 ? "is-risk" : stats.lineControl > .76 ? "is-locked" : ""}`}>
              <span>DEEP</span><i><em /><b style={{ left: `${lineIndicator}%` }} /></i><span>SHOULDER</span><strong>{lineLabel}</strong>
            </div>
            <div className={`grip-track ${stats.railGrip < .5 ? "is-releasing" : ""}`}>
              <span>RAIL GRIP</span><i><b style={{ width: `${Math.round(stats.railGrip * 100)}%` }} /></i><strong>{Math.round(stats.railGrip * 100)}%</strong>
            </div>
            <small>{stats.maneuverActive ? stats.maneuverAirborne ? "Spot the landing, then reconnect inside the illuminated zone" : "Reconnect inside the illuminated landing zone" : stats.trickCharge > .04 ? "Keep the rail set while the board loads · release Space / Trick to launch" : stats.sectionPressure > .42 ? "Steer back toward the illuminated power pocket" : "Track the pocket · balance with mouse or thumb · shift stance with W/S"}</small>
          </div>

          <div className={`vehicle-instrument ${stats.vehicleMode ? "is-active" : ""} ${stats.vehicleSlip > .24 ? "is-slipping" : ""}`}>
            <div className="vehicle-dial">
              <span>{stats.vehicleGear}</span>
              <strong>{Math.round(stats.speed * 3.6)}</strong>
              <small>KM/H</small>
            </div>
            <div className="vehicle-copy">
              <span>COAST RUNNER / SURF RACK 03</span>
              <strong>{stats.vehicleSlip > .24 ? "Tires sliding — unwind the steering" : vehicleSurfaceLabel}</strong>
              <div className="vehicle-grip">
                <i><b style={{ width: `${vehicleGrip}%` }} /></i>
                <em>{vehicleGrip}% GRIP</em>
              </div>
              <small>W/S throttle · A/D steer · SPACE exits when stopped</small>
            </div>
          </div>

          <div className="game-conditions">
            <div><Waves /><span>FACE</span><strong>{settings.waveHeight.toFixed(1)} m</strong></div>
            <div><Wind /><span>PERIOD</span><strong>{settings.wavePeriod.toFixed(1)} s</strong></div>
            <div><ArrowRight /><span>BREAK LINE</span><strong>{activeLine}</strong></div>
            <div><Gauge /><span>SPEED</span><strong>{(stats.speed * 3.6).toFixed(0)} km/h</strong></div>
            <div><Crosshair /><span>DISTANCE</span><strong>{stats.rideDistance.toFixed(0)} m</strong></div>
            <div><CloudSun /><span>SKY</span><strong>{weatherLabel(sessionWeatherCode)}</strong></div>
          </div>

          <div className="desktop-controls">
            {gamepadConnected ? (
              <>
                <span><kbd>LS</kbd> {stats.vehicleMode ? "steer / throttle" : stats.phase === "riding" ? "rail / stance" : "move"}</span>
                <span><kbd>LT</kbd><kbd>RT</kbd> balance</span>
                <span><kbd>A</kbd> {stats.phase === "riding" ? "hold / release trick" : stats.vehicleMode ? "exit when stopped" : stats.nearVan ? "drive van" : "context action"}</span>
                <span><kbd>RS</kbd> freelook</span>
                <span><kbd>RB</kbd> camera · <kbd>START</kbd> pause</span>
              </>
            ) : stats.vehicleMode ? (
              <>
                <span><kbd>W</kbd><kbd>S</kbd> throttle / brake</span>
                <span><kbd>A</kbd><kbd>D</kbd> steer</span>
                <span><kbd>SPACE</kbd> exit when stopped</span>
                <span><kbd>C</kbd> {CAMERA_LABELS[cameraMode]} camera</span>
                <span><span className="mouse-icon" /> drag view to look</span>
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
                    <span><kbd>A</kbd><kbd>D</kbd> steer / rail</span>
                    <span><kbd>W</kbd><kbd>S</kbd> {stats.phase === "riding" ? "nose / tail stance" : "paddle"}</span>
                  </>
                )}
                <span><kbd>SPACE</kbd> {stats.phase === "riding" ? "hold to load · release trick" : stats.nearVan ? "drive van" : stats.phase === "paddling" && !stats.inLineup ? "duck-dive the shorebreak" : "catch wave"}</span>
                <span><kbd>C</kbd> {CAMERA_LABELS[cameraMode]} camera</span>
                <span><span className="mouse-icon" /> mouse to balance</span>
              </>
            )}
          </div>

          <div
            className={`mobile-controls phase-${stats.phase} ${stats.catchReady ? "is-catch-ready" : ""} ${stats.duckDiveReady ? "is-dive-ready" : ""} ${stats.phase === "riding" && stats.railGrip < .48 ? "is-grip-warning" : ""} ${stats.phase === "riding" && balanceAccuracy < 58 ? "is-balance-warning" : ""} ${stats.phase === "riding" && stats.lineControl > .82 && stats.sectionPressure < .38 ? "is-pocket-locked" : ""}`}
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
            {stats.phase === "riding" ? (
              <div
                className={`touch-balance ${stats.maneuverActive ? "is-landing" : ""} ${balanceAccuracy >= 88 ? "is-locked" : ""}`}
                role="slider"
                aria-label="Surf balance. Match your white thumb marker to the glowing target."
                aria-valuemin={-100}
                aria-valuemax={100}
                aria-valuenow={Math.round(stats.balance * 100)}
                tabIndex={0}
                onPointerDown={updateTouchBalance}
                onPointerMove={updateTouchBalance}
                onPointerUp={endTouchBalance}
                onPointerCancel={endTouchBalance}
                onLostPointerCapture={endTouchBalance}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  controls.current.balance = THREEClamp(controls.current.balance + (event.key === "ArrowRight" ? .08 : -.08), -1, 1);
                }}
              >
                <span><em>{stats.maneuverActive ? `${stats.maneuverPhase.toUpperCase()} ${Math.round(stats.maneuverProgress * 100)}%` : stats.trickCharge > .04 ? `LOADED ${Math.round(stats.trickCharge * 100)}%` : "MATCH TARGET"}</em><strong>{balanceAccuracy}%</strong></span>
                {stats.maneuverActive && <i className="touch-landing-zone" style={{ left: `${(landingMin + 1) * 50}%`, width: `${(landingMax - landingMin) * 50}%` }} />}
                <i
                  className={`touch-rail-pressure ${stats.railLoad < 0 ? "is-left" : "is-right"}`}
                  style={{ width: `${Math.min(48, Math.abs(stats.railLoad) * 48)}%` }}
                />
                <i className="touch-balance-target" style={{ left: `${touchTargetPosition}%` }} />
                <b className="touch-balance-thumb" style={{ left: `${touchBalancePosition}%` }} />
                <small><em>LEAN LEFT</em><em>LEAN RIGHT</em></small>
              </div>
            ) : (
              <div className={`touch-context ${stats.catchReady ? "is-ready" : ""}`} aria-live="polite">
                <strong>{mobileContext.title}</strong>
                <small>{mobileContext.detail}</small>
              </div>
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
              {stats.vehicleMode || stats.nearVan ? <CarFront /> : stats.phase === "riding" ? <Sparkles /> : <Waves />}
            </button>
            {stats.phase === "riding" && (
              <div className={`touch-ride-telemetry ${stats.sectionPressure > .48 ? "is-risk" : stats.lineControl > .82 ? "is-locked" : ""}`} aria-label={`Stance ${stanceLabel}. Line ${lineLabel}. Rail grip ${Math.round(stats.railGrip * 100)} percent.`}>
                <span><small>STANCE</small><strong>{stanceLabel}</strong></span>
                <span><small>LINE</small><strong>{lineLabel}</strong></span>
                <span className="touch-grip"><small>RAIL</small><strong>{Math.round(stats.railGrip * 100)}%</strong><i><b /></i></span>
              </div>
            )}
          </div>

          {paused && (
            <div className="pause-overlay">
              <div className="pause-card">
                <span className="overline">SESSION PAUSED</span>
                <h2>Listen to the break.</h2>
                <p>{zoneLabel} is running {settings.waveHeight.toFixed(1)} m at {settings.wavePeriod.toFixed(1)} seconds. Session grade {stats.grade} · personal best {personalBest.score.toLocaleString()}.</p>
                <button className="primary-pause" onClick={() => { clearAnalogMovement(); setPaused(false); }}><Play /> Return to water</button>
                <button className={`music-toggle ${musicEnabled ? "" : "is-off"}`} onClick={toggleMusic}><AudioLines /> Original score · {musicEnabled ? "On" : "Off"}</button>
                <button onClick={leaveSession}><MapPin /> Choose another break</button>
                <button onClick={() => { controls.current = { ...EMPTY_CONTROLS }; clearAnalogMovement(); setStats(INITIAL_STATS); trainingStepValue.current = 0; setTrainingStep(0); setSessionKey((value) => value + 1); setPaused(false); }}><RotateCcw /> Restart session</button>
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
              <article><span>01</span><Waves /><strong>Enter</strong><p>Choose a board, walk through the shallows, drag to look around, and use C or the camera button to frame your line.</p></article>
              <article><span>02</span><AudioLines /><strong>Read</strong><p>Paddle toward the lineup and watch each wall approach. Tap Dive or Space just before impact to punch through, then turn shoreward and read the tightening catch pulse.</p></article>
              <article><span>03</span><Sparkles /><strong>Flow</strong><p>Set a rail, hold Trick or Space to compress, then release into a move. Stance, speed, wave position, and load decide what you throw; reconnect inside the gold zone to bank it.</p></article>
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
