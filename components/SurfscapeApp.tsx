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
  Droplets,
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
import { CSSProperties, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { BEACHES, DEFAULT_BEACH, type Beach } from "@/lib/beaches";
import {
  fallbackConditions,
  fetchMarineConditions,
  type MarineConditions,
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

const EMPTY_CONTROLS: ControlState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  action: false,
  moveX: 0,
  moveY: 0,
  balance: 0,
  lookYaw: 0,
  lookPitch: 0,
};

function qualityLabel(conditions: MarineConditions) {
  const energy = conditions.waveHeight * Math.max(conditions.wavePeriod - 4, 1);
  if (energy > 28) return "Heavy water";
  if (conditions.wavePeriod >= 13 && conditions.windSpeed < 16) return "Glassy lines";
  if (conditions.waveHeight < 0.45) return "Small & clean";
  if (conditions.windSpeed > 25) return "Wind affected";
  return "Rideable peaks";
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
  const [settings, setSettings] = useState<SessionSettings>(() => settingsFromConditions(INITIAL_MODELED_CONDITIONS));
  const [stats, setStats] = useState<GameStats>(INITIAL_STATS);
  const [paused, setPaused] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [cameraMode, setCameraMode] = useState<CameraMode>("follow");
  const [showPlanner, setShowPlanner] = useState(true);
  const [showHowTo, setShowHowTo] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [personalBest, setPersonalBest] = useState<PersonalBest>({ score: 0, distance: 0, combo: 1 });
  const [recordsReady, setRecordsReady] = useState(false);
  const [maneuverToast, setManeuverToast] = useState<{ id: number; name: string; points: number } | null>(null);
  const [rideToast, setRideToast] = useState<RideToast | null>(null);
  const controls = useRef<ControlState>({ ...EMPTY_CONTROLS });
  const audio = useRef<SurfscapeAudio | null>(null);
  const previousPhase = useRef(stats.phase);
  const previousManeuverId = useRef(0);
  const previousRideResultId = useRef(0);
  const joystickKnob = useRef<HTMLSpanElement>(null);
  const joystickPointer = useRef<number | null>(null);
  const lookGesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  } | null>(null);
  const sessionWeatherCode = settings.weatherCode;
  const sessionCloudCover = settings.mode === "playground" ? playgroundCloudCover(sessionWeatherCode) : conditions.cloudCover;

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
      fetchMarineConditions(beach, latitude, longitude, controller.signal)
        .then((live) => {
          setConditions(live);
          setSettings((previous) => {
            if (previous.mode === "playground") return previous;
            return { ...settingsFromConditions(live), mode: previous.mode, board: previous.board };
          });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          const modeled = fallbackConditions(beach);
          setConditions(modeled);
          setSettings((previous) => ({ ...settingsFromConditions(modeled), mode: previous.mode, board: previous.board }));
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
      controls.current.action = false;
      controls.current.moveX = 0;
      controls.current.moveY = 0;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (screen !== "game") return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
        event.preventDefault();
      }
      if (key === "w" || key === "arrowup") controls.current.forward = true;
      if (key === "s" || key === "arrowdown") controls.current.back = true;
      if (key === "a" || key === "arrowleft") controls.current.left = true;
      if (key === "d" || key === "arrowright") controls.current.right = true;
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
      if (from === "riding" && stats.phase === "shore") {
        audio.current?.effect("finish");
        haptic([10, 22, 10]);
      }
      previousPhase.current = stats.phase;
    }
    audio.current?.setVehicle(paused ? 0 : stats.speed, !paused && stats.vehicleMode);
    audio.current?.setSurf(
      paused ? 0 : stats.speed,
      !paused && stats.phase === "riding",
      stats.setEnergy,
      stats.barrelIntensity,
    );
    audio.current?.setEnvironment(
      conditions.windSpeed,
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
  }, [conditions.windSpeed, paused, sessionCloudCover, sessionWeatherCode, settings.waveHeight, stats.barrelIntensity, stats.phase, stats.setEnergy, stats.speed, stats.vehicleMode]);

  useEffect(() => {
    if (stats.maneuverId > 0 && stats.maneuverId !== previousManeuverId.current) {
      previousManeuverId.current = stats.maneuverId;
      setManeuverToast({ id: stats.maneuverId, name: stats.maneuver, points: stats.maneuverScore });
      audio.current?.effect("turn");
      haptic(12);
      const timer = window.setTimeout(() => setManeuverToast(null), 1800);
      return () => window.clearTimeout(timer);
    }
  }, [stats.maneuver, stats.maneuverId, stats.maneuverScore]);

  useEffect(() => {
    if (stats.rideResultId > 0 && stats.rideResultId !== previousRideResultId.current && stats.rideResult) {
      previousRideResultId.current = stats.rideResultId;
      setManeuverToast(null);
      setRideToast({
        id: stats.rideResultId,
        result: stats.rideResult,
        score: stats.rideScore,
        distance: stats.rideDistance,
        maneuvers: stats.rideManeuvers,
        barrelTime: stats.barrelTime,
        grade: stats.rideGrade,
      });
      const timer = window.setTimeout(() => setRideToast(null), 3600);
      return () => window.clearTimeout(timer);
    }
  }, [stats.barrelTime, stats.rideDistance, stats.rideGrade, stats.rideManeuvers, stats.rideResult, stats.rideResultId, stats.rideScore]);

  const chooseBeach = (next: Beach) => {
    const startingZone = next.zones[Math.min(1, next.zones.length - 1)];
    setBeach(next);
    setLatitude(startingZone.lat);
    setLongitude(startingZone.lon);
    setZoneLabel(startingZone.name);
    setConditions(fallbackConditions(next));
  };

  const chooseMode = (mode: GameMode) => {
    if (mode === "playground") {
      setSettings((current) => ({ ...current, mode }));
    } else {
      setSettings((current) => ({ ...settingsFromConditions(conditions), mode, board: current.board }));
    }
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
    audio.current.setEnvironment(conditions.windSpeed, settings.waveHeight, sessionCloudCover, 1, sessionWeatherCode);
    audio.current.setMovement("shore", 0, true);
    controls.current = { ...EMPTY_CONTROLS };
    clearAnalogMovement();
    setStats(INITIAL_STATS);
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
    audio.current?.setMovement(stats.phase, 0, false);
    audio.current?.setEnvironment(conditions.windSpeed, settings.waveHeight, sessionCloudCover, 0.42, sessionWeatherCode);
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
      audio.current.setEnvironment(conditions.windSpeed, settings.waveHeight, sessionCloudCover, screen === "game" ? 1 : 0.42, sessionWeatherCode);
    }
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

  const localTime = formatClock(conditions.observedAt);
  const selectedMode = MODES.find((mode) => mode.id === settings.mode) ?? MODES[0];
  const conditionQuality = qualityLabel(conditions);
  const accentStyle = { "--spot-accent": beach.palette[0], "--sand-accent": beach.palette[1] } as CSSProperties;
  const handleSceneReady = useCallback(() => setSceneReady(true), []);
  const handleStats = useCallback((next: GameStats) => {
    setStats(next);
    setPersonalBest((current) => {
      const updated = {
        score: Math.max(current.score, next.score),
        distance: Math.max(current.distance, next.rideDistance),
        combo: Math.max(current.combo, next.maxCombo),
      };
      return updated.score === current.score && updated.distance === current.distance && updated.combo === current.combo ? current : updated;
    });
  }, []);
  const objectives = [
    { label: "Ride 40 m", done: stats.rideDistance >= 40 },
    { label: "Land 2 moves", done: stats.maneuverCount >= 2 },
    { label: "Barrel for 2s", done: stats.barrelTime >= 2 },
    { label: "Reach 3× flow", done: stats.maxCombo >= 3 },
  ];
  const stanceLabel = stats.stance > 0.42 ? "NOSE DRIVE" : stats.stance < -0.42 ? "TAIL PRESSURE" : "CENTERED";
  const mobileActionIsContextual = stats.vehicleMode || stats.nearVan || stats.phase === "riding" || stats.catchReady;
  const mobileActionLabel = stats.vehicleMode
    ? "EXIT"
    : stats.nearVan
      ? "DRIVE"
      : stats.phase === "riding"
        ? "TRICK"
        : stats.catchReady
          ? "CATCH"
          : stats.phase === "paddling"
            ? "PADDLE"
            : "MOVE";
  const lensIntensity = stats.phase === "wipeout" ? 0.82 : stats.barrelIntensity * 0.72;

  return (
    <main className={`surfscape ${screen === "game" ? "is-playing" : "is-launch"}`} style={accentStyle} onPointerMove={updateBalance}>
      <div className="scene-layer" aria-hidden={screen === "launch"}>
        <SurfScene
          key={`${beach.id}-${sessionKey}`}
          beach={beach}
          settings={settings}
          cloudCover={sessionCloudCover}
          windSpeed={conditions.windSpeed}
          windDirection={conditions.windDirection}
          weatherCode={sessionWeatherCode}
          sunrise={conditions.sunrise}
          sunset={conditions.sunset}
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
                <i /> {conditionsLoading ? "Reading buoy models" : conditions.source === "live" ? "Live ocean model" : "Modeled offline"}
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
                  <strong>{conditions.waveHeight.toFixed(1)}<small>m</small></strong>
                  <em>{degrees(conditions.waveDirection)}</em>
                </div>
                <div className="readout-metric">
                  <span>Period</span>
                  <strong>{conditions.wavePeriod.toFixed(1)}<small>s</small></strong>
                  <em>{conditionQuality}</em>
                </div>
                <div className="readout-metric tide-readout">
                  <span>Tide · {conditions.tideTrend}</span>
                  <strong>{conditions.seaLevel >= 0 ? "+" : ""}{conditions.seaLevel.toFixed(2)}<small>m</small></strong>
                  <TideSparkline points={conditions.tide} observedAt={conditions.observedAt} />
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
              <PlaygroundSlider label="Current" value={settings.currentStrength} min={0} max={4} step={0.1} unit="km/h" onChange={(currentStrength) => setSettings((value) => ({ ...value, currentStrength }))} />
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
              <strong>{localTime} {conditions.timezoneAbbreviation}</strong>
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
          <header className="game-topbar">
            <div className="game-brand">
              <Waves />
              <div><strong>SURFSCAPE</strong><span>{zoneLabel} · {beach.name} · {BOARD_SPECS[settings.board].name}</span></div>
            </div>
            <div className="game-objective"><span>{stats.phase}</span><strong>{stats.prompt}</strong></div>
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
            <div className="maneuver-toast" key={maneuverToast.id}>
              <Sparkles />
              <span>LANDED</span>
              <strong>{maneuverToast.name}</strong>
              <b>+{maneuverToast.points.toLocaleString()}</b>
            </div>
          )}

          {rideToast && (
            <div className={`ride-recap is-${rideToast.result}`} key={rideToast.id}>
              <div className="ride-grade"><span>{rideToast.result === "clean" ? "CLEAN LINE" : "LINE LOST"}</span><strong>{rideToast.grade}</strong></div>
              <div className="ride-recap-copy">
                <span>{rideToast.result === "clean" ? "WAVE COMPLETE" : "WIPEOUT / RESET"}</span>
                <strong>{rideToast.score.toLocaleString()} PTS</strong>
                <small>{rideToast.distance.toFixed(0)} m · {rideToast.maneuvers} moves · {rideToast.barrelTime.toFixed(1)}s barrel</small>
              </div>
            </div>
          )}

          <div className={`balance-instrument ${stats.phase === "riding" ? "is-active" : ""}`}>
            <div className="balance-label">
              <span>BALANCE <em className={stats.barrelIntensity > 0.2 ? "is-barrel" : ""}>{stats.barrelIntensity > 0.2 ? `IN THE BARREL · ${stats.barrelTime.toFixed(1)}s` : stanceLabel}</em></span>
              <strong>{Math.round((1 - Math.min(1, Math.abs(stats.balance - stats.balanceTarget))) * 100)}%</strong>
            </div>
            <div className="balance-track">
              <i className="balance-safe" style={{ left: `${(stats.balanceTarget + 1) * 50}%` }} />
              <b style={{ left: `${(stats.balance + 1) * 50}%` }} />
            </div>
            <div className="stance-track">
              <span>TAIL / CONTROL</span><i><b style={{ left: `${(stats.stance + 1) * 50}%` }} /></i><span>NOSE / SPEED</span>
            </div>
            <div className={`grip-track ${stats.railGrip < .5 ? "is-releasing" : ""}`}>
              <span>RAIL GRIP</span><i><b style={{ width: `${Math.round(stats.railGrip * 100)}%` }} /></i><strong>{Math.round(stats.railGrip * 100)}%</strong>
            </div>
            <small>Balance with mouse or thumb · shift tailward to recover rail grip</small>
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
            <div><Droplets /><span>CURRENT</span><strong>{settings.currentStrength.toFixed(1)} km/h</strong></div>
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
                <span><kbd>A</kbd><kbd>D</kbd> steer / rail</span>
                <span><kbd>W</kbd><kbd>S</kbd> {stats.phase === "riding" ? "nose / tail stance" : "move / paddle"}</span>
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
              aria-label="Analog movement stick. Drag to move and steer."
              onPointerDown={updateJoystick}
              onPointerMove={updateJoystick}
              onPointerUp={endJoystick}
              onPointerCancel={endJoystick}
              onLostPointerCapture={() => clearAnalogMovement()}
            >
              <span className="analog-ring" />
              <span ref={joystickKnob} className="analog-knob"><i /></span>
              <small>MOVE / STEER</small>
            </div>
            <div className="touch-balance" role="slider" aria-label="Balance" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(stats.balance * 100)} tabIndex={0} onPointerDown={updateTouchBalance} onPointerMove={updateTouchBalance}>
              <span>BALANCE</span><i style={{ left: `${(stats.balance + 1) * 50}%` }} />
            </div>
            <button
              type="button"
              className={`action-button ${mobileActionIsContextual ? "is-contextual" : "is-propulsion"}`}
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
                <button onClick={leaveSession}><MapPin /> Choose another break</button>
                <button onClick={() => { controls.current = { ...EMPTY_CONTROLS }; clearAnalogMovement(); setStats(INITIAL_STATS); setSessionKey((value) => value + 1); setPaused(false); }}><RotateCcw /> Restart session</button>
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
              <article><span>02</span><AudioLines /><strong>Read</strong><p>Paddle beyond the break. Watch the sets, then press Space or Catch as a wall approaches.</p></article>
              <article><span>03</span><Sparkles /><strong>Flow</strong><p>Steer with A/D or the analog stick, shift nose-to-tail with W/S, and watch rail grip. Ease off or load the tail when the fins begin to release.</p></article>
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
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="lab-slider">
      <span>{label}</span>
      <strong>{value.toFixed(step < 0.1 ? 2 : 1)} {unit}</strong>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function THREEClamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
