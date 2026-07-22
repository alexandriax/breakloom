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
  LoaderCircle,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Settings2,
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
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern);
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
  { title: "Reach the lineup", detail: "Paddle beyond the breaking waves." },
  { title: "Read the crest", detail: "Wait for the takeoff window to open." },
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
  if (stats.inLineup || hasRidden) reached = 2;
  if (stats.catchReady || hasRidden) reached = 3;
  if (hasRidden) reached = 4;
  const hasTrackedPocket = stats.pocketDistance >= 15;
  if (hasTrackedPocket) reached = 5;
  if (hasTrackedPocket && stats.maneuverCount > 0) reached = 6;
  if (hasTrackedPocket && stats.maneuverCount > 0 && stats.rideResult === "clean") reached = 7;
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
  const controls = useRef<ControlState>({ ...EMPTY_CONTROLS });
  const audio = useRef<SurfscapeAudio | null>(null);
  const previousPhase = useRef(stats.phase);
  const previousManeuverId = useRef(0);
  const previousManeuverActive = useRef(false);
  const previousRideResultId = useRef(0);
  const previousCatchReady = useRef(false);
  const previousTakeoffPhase = useRef(stats.phase);
  const joystickKnob = useRef<HTMLSpanElement>(null);
  const joystickPointer = useRef<number | null>(null);
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
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (screen !== "game") return;
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
    const releaseAllControls = () => {
      controls.current.forward = false;
      controls.current.back = false;
      controls.current.left = false;
      controls.current.right = false;
      controls.current.sprint = false;
      controls.current.action = false;
      controls.current.moveX = 0;
      controls.current.moveY = 0;
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
    audio.current?.setVehicle(paused ? 0 : stats.speed, !paused && stats.vehicleMode);
    audio.current?.setSurf(
      paused ? 0 : stats.speed,
      !paused && stats.phase === "riding",
      stats.setEnergy,
      stats.barrelIntensity,
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
      paused ? 0.34 : 1,
      sessionWeatherCode,
    );
    audio.current?.setMovement(
      stats.phase,
      paused ? 0 : stats.speed,
      !paused && !stats.vehicleMode,
    );
  }, [paused, screen, sessionCloudCover, sessionWeatherCode, settings.timeOfDay, settings.waveHeight, settings.windSpeed, stats.barrelIntensity, stats.catchReady, stats.phase, stats.setEnergy, stats.speed, stats.vehicleMode]);

  useEffect(() => {
    if (stats.maneuverActive && !previousManeuverActive.current) haptic(8);
    previousManeuverActive.current = stats.maneuverActive;
  }, [stats.maneuverActive]);

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
      const timer = window.setTimeout(() => setRideToast(null), 3600);
      return () => window.clearTimeout(timer);
    }
  }, [stats.barrelTime, stats.pocketDistance, stats.rideDistance, stats.rideGrade, stats.rideManeuvers, stats.rideResult, stats.rideResultId, stats.rideScore]);

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
    if (joystickKnob.current) joystickKnob.current.style.transform = "translate3d(-50%, -50%, 0)";
  }

  const startSession = async () => {
    if (!audio.current) audio.current = new SurfscapeAudio();
    await audio.current.start();
    audio.current.setEnabled(soundEnabled);
    audio.current.setMusicEnabled(musicEnabled);
    audio.current.setEnvironment(settings.windSpeed, settings.waveHeight, sessionCloudCover, 1, sessionWeatherCode);
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
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      joystickPointer.current = event.pointerId;
      haptic(4);
    }
    if (joystickPointer.current !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
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
      controls.current.balance = THREEClamp((event.clientX / window.innerWidth - 0.5) * 2, -1, 1);
    }
  };

  const updateTouchBalance = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.type === "pointerdown" && !event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    controls.current.balance = THREEClamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2, -1, 1);
  };

  const beginCameraLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (paused) return;
    event.preventDefault();
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
  const mobileActionIsContextual = stats.vehicleMode || stats.nearVan || stats.phase === "riding" || stats.catchReady;
  const mobileActionLabel = stats.vehicleMode
    ? "EXIT"
    : stats.nearVan
      ? "DRIVE"
      : stats.phase === "riding"
        ? stats.maneuverActive ? "BALANCE" : "TRICK"
        : stats.catchReady
          ? "CATCH"
          : stats.phase === "paddling"
            ? "PADDLE"
            : "MOVE";
  const lensIntensity = stats.phase === "wipeout" ? 0.82 : stats.barrelIntensity * 0.72;
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
        <section className={`game-ui ${paused ? "is-paused" : ""}`}>
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
            <span>{stats.phase === "riding" ? "DRAG VIEW / MOUSE BALANCE" : "FREELOOK · DRAG VIEW"} · {CAMERA_LABELS[cameraMode].toUpperCase()}</span>
          </div>
          <div className={`barrel-lens ${stats.phase === "wipeout" ? "is-wipeout" : ""}`} style={{ opacity: lensIntensity }} aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
          </div>
          <div className={`velocity-veil ${stats.barrelIntensity > .2 ? "is-barrel" : ""}`} style={{ opacity: velocityIntensity }} aria-hidden="true" />
          {cinemaBeat && <div className={`cinema-impact is-${cinemaBeat}`} key={`${cinemaBeat}-${cinemaBeatKey}`} aria-hidden="true" />}
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
              <div className={`takeoff-window ${stats.catchReady ? "is-open" : ""}`}>
                <span>TAKEOFF</span>
                <i><b style={{ width: `${Math.round(stats.takeoffQuality * 100)}%` }} /></i>
                <strong>{stats.catchReady ? "GO" : `${Math.round(stats.takeoffQuality * 100)}%`}</strong>
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
            </div>
          )}

          <div className={`balance-instrument ${stats.phase === "riding" ? "is-active" : ""} ${stats.maneuverActive ? "is-landing" : ""}`}>
            <div className="balance-label">
              <span>{stats.maneuverActive ? "LANDING" : "BALANCE"} <em className={stats.maneuverActive ? "is-landing" : stats.barrelIntensity > 0.2 ? "is-barrel" : ""}>{stats.maneuverActive ? `${stats.maneuver} · ${Math.round(stats.maneuverProgress * 100)}%` : stats.barrelIntensity > 0.2 ? `IN THE BARREL · ${stats.barrelTime.toFixed(1)}s` : stanceLabel}</em></span>
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
            <small>{stats.maneuverActive ? "Reconnect inside the illuminated landing zone" : stats.sectionPressure > .42 ? "Steer back toward the illuminated power pocket" : "Track the pocket · balance with mouse or thumb · shift stance with W/S"}</small>
          </div>

          <div className={`vehicle-instrument ${stats.vehicleMode ? "is-active" : ""}`}>
            <div className="vehicle-dial">
              <span>{stats.speed < 0.4 ? "P" : "D"}</span>
              <strong>{Math.round(stats.speed * 3.6)}</strong>
              <small>KM/H</small>
            </div>
            <div className="vehicle-copy">
              <span>COAST RUNNER / SURF RACK 03</span>
              <strong>{stats.speed < 0.8 ? "Ready to roam" : "Cruising the shoreline"}</strong>
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
            {stats.vehicleMode ? (
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
                <span><kbd>SPACE</kbd> {stats.phase === "riding" ? "land maneuver" : stats.nearVan ? "drive van" : "catch wave"}</span>
                <span><kbd>C</kbd> {CAMERA_LABELS[cameraMode]} camera</span>
                <span><span className="mouse-icon" /> mouse to balance</span>
              </>
            )}
          </div>

          <div className="mobile-controls">
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
            <div className={`touch-balance ${stats.maneuverActive ? "is-landing" : ""}`} role="slider" aria-label="Balance" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(stats.balance * 100)} tabIndex={0} onPointerDown={updateTouchBalance} onPointerMove={updateTouchBalance}>
              <span>{stats.maneuverActive ? `LAND ${Math.round(stats.maneuverProgress * 100)}%` : "BALANCE"}</span><i style={{ left: `${(stats.balance + 1) * 50}%` }} />
            </div>
            <button
              type="button"
              className={`action-button ${mobileActionIsContextual ? "is-contextual" : "is-propulsion"} ${stats.maneuverActive ? "is-landing" : ""}`}
              aria-label={mobileActionLabel}
              onPointerDown={(event) => beginControl(event, mobileActionIsContextual ? "action" : "forward")}
              onPointerUp={endMobileAction}
              onPointerCancel={endMobileAction}
              onLostPointerCapture={() => { setControl("forward", false); setControl("action", false); }}
            >
              <span>{mobileActionLabel}</span>
              {stats.vehicleMode || stats.nearVan ? <CarFront /> : stats.phase === "riding" ? <Sparkles /> : <Waves />}
            </button>
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
              <article><span>02</span><AudioLines /><strong>Read</strong><p>Paddle beyond the break. The foam pulse tightens as a catchable crest arrives; after the drop, follow the moving caustic seam toward the open shoulder.</p></article>
              <article><span>03</span><Sparkles /><strong>Flow</strong><p>Steer with A/D or the stick, then press Trick to commit a move. Follow the shifting balance marker and reconnect inside the gold landing zone to bank the score.</p></article>
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
