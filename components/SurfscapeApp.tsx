"use client";

import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BatteryMedium,
  CarFront,
  ChevronDown,
  CircleCheck,
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
  compassDirection,
  formatClock,
  INITIAL_STATS,
  settingsFromConditions,
  type GameMode,
  type GameStats,
  type SessionSettings,
} from "@/lib/game";
import { SurfscapeAudio } from "@/lib/audio";
import type { ControlState } from "./SurfScene";
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

const RECORD_KEY = "surfscape-personal-best-v1";

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
  balance: 0,
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

export default function SurfscapeApp() {
  const [screen, setScreen] = useState<Screen>("launch");
  const [beach, setBeach] = useState<Beach>(DEFAULT_BEACH);
  const [latitude, setLatitude] = useState(DEFAULT_BEACH.zones[1].lat);
  const [longitude, setLongitude] = useState(DEFAULT_BEACH.zones[1].lon);
  const [zoneLabel, setZoneLabel] = useState(DEFAULT_BEACH.zones[1].name);
  const [conditions, setConditions] = useState<MarineConditions>(() => fallbackConditions(DEFAULT_BEACH));
  const [conditionsLoading, setConditionsLoading] = useState(true);
  const [settings, setSettings] = useState<SessionSettings>(() => settingsFromConditions(fallbackConditions(DEFAULT_BEACH)));
  const [stats, setStats] = useState<GameStats>(INITIAL_STATS);
  const [paused, setPaused] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
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
            return { ...settingsFromConditions(live), mode: previous.mode };
          });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          const modeled = fallbackConditions(beach);
          setConditions(modeled);
          setSettings((previous) => ({ ...settingsFromConditions(modeled), mode: previous.mode }));
        })
        .finally(() => setConditionsLoading(false));
    }, 260);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [beach, latitude, longitude]);

  useEffect(() => {
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
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [screen]);

  useEffect(() => {
    const from = previousPhase.current;
    if (from !== stats.phase) {
      if (stats.phase === "riding") audio.current?.effect("catch");
      if (stats.phase === "wipeout") audio.current?.effect("wipeout");
      if (from === "riding" && stats.phase === "shore") audio.current?.effect("finish");
      previousPhase.current = stats.phase;
    }
    audio.current?.setVehicle(paused ? 0 : stats.speed, !paused && stats.vehicleMode);
    audio.current?.setSurf(
      paused ? 0 : stats.speed,
      !paused && stats.phase === "riding",
      stats.setEnergy,
      stats.barrelIntensity,
    );
  }, [paused, stats.barrelIntensity, stats.phase, stats.setEnergy, stats.speed, stats.vehicleMode]);

  useEffect(() => {
    if (stats.maneuverId > 0 && stats.maneuverId !== previousManeuverId.current) {
      previousManeuverId.current = stats.maneuverId;
      setManeuverToast({ id: stats.maneuverId, name: stats.maneuver, points: stats.maneuverScore });
      audio.current?.effect("turn");
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
      setSettings({ ...settingsFromConditions(conditions), mode });
    }
  };

  const startSession = async () => {
    if (!audio.current) audio.current = new SurfscapeAudio();
    await audio.current.start();
    audio.current.setEnabled(soundEnabled);
    controls.current = { ...EMPTY_CONTROLS };
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
    controls.current = { ...EMPTY_CONTROLS };
    setScreen("launch");
    setPaused(false);
  };

  const toggleSound = async () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (!audio.current) audio.current = new SurfscapeAudio();
    await audio.current.start();
    audio.current.setEnabled(next);
  };

  const setControl = (name: keyof Pick<ControlState, "forward" | "back" | "left" | "right" | "action">, value: boolean) => {
    controls.current[name] = value;
  };

  const updateBalance = (event: ReactPointerEvent<HTMLElement>) => {
    if (screen !== "game" || paused) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      controls.current.balance = THREEClamp((event.clientX / window.innerWidth - 0.5) * 2, -1, 1);
    }
  };

  const updateTouchBalance = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    controls.current.balance = THREEClamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2, -1, 1);
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

  return (
    <main className={`surfscape ${screen === "game" ? "is-playing" : "is-launch"}`} style={accentStyle} onPointerMove={updateBalance}>
      <div className="scene-layer" aria-hidden={screen === "launch"}>
        <SurfScene
          key={`${beach.id}-${sessionKey}`}
          beach={beach}
          settings={settings}
          cloudCover={conditions.cloudCover}
          sunrise={conditions.sunrise}
          sunset={conditions.sunset}
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
          <header className="game-topbar">
            <div className="game-brand">
              <Waves />
              <div><strong>SURFSCAPE</strong><span>{zoneLabel} · {beach.name}</span></div>
            </div>
            <div className="game-objective"><span>{stats.phase}</span><strong>{stats.prompt}</strong></div>
            <div className="game-actions">
              <button onClick={toggleSound} aria-label={soundEnabled ? "Mute" : "Unmute"}>{soundEnabled ? <Volume2 /> : <VolumeX />}</button>
              <button onClick={() => setPaused(true)} aria-label="Pause"><Pause /></button>
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
            <small>Balance with mouse or thumb · W/S shifts your stance along the board</small>
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
          </div>

          <div className="desktop-controls">
            {stats.vehicleMode ? (
              <>
                <span><kbd>W</kbd><kbd>S</kbd> throttle / brake</span>
                <span><kbd>A</kbd><kbd>D</kbd> steer</span>
                <span><kbd>SPACE</kbd> exit when stopped</span>
              </>
            ) : (
              <>
                <span><kbd>A</kbd><kbd>D</kbd> steer / rail</span>
                <span><kbd>W</kbd><kbd>S</kbd> {stats.phase === "riding" ? "nose / tail stance" : "move / paddle"}</span>
                <span><kbd>SPACE</kbd> {stats.phase === "riding" ? "land maneuver" : stats.nearVan ? "drive van" : "catch wave"}</span>
                <span><span className="mouse-icon" /> mouse to balance</span>
              </>
            )}
          </div>

          <div className="mobile-controls">
            <div className="dpad" aria-label="Movement controls">
              <button className="up" aria-label="Forward" onPointerDown={() => setControl("forward", true)} onPointerUp={() => setControl("forward", false)} onPointerCancel={() => setControl("forward", false)}><ArrowRight /></button>
              <button className="left" aria-label="Left" onPointerDown={() => setControl("left", true)} onPointerUp={() => setControl("left", false)} onPointerCancel={() => setControl("left", false)}><ArrowLeft /></button>
              <button className="right" aria-label="Right" onPointerDown={() => setControl("right", true)} onPointerUp={() => setControl("right", false)} onPointerCancel={() => setControl("right", false)}><ArrowRight /></button>
              <button className="down" aria-label="Back" onPointerDown={() => setControl("back", true)} onPointerUp={() => setControl("back", false)} onPointerCancel={() => setControl("back", false)}><ArrowRight /></button>
            </div>
            <div className="touch-balance" onPointerDown={updateTouchBalance} onPointerMove={updateTouchBalance}>
              <span>BALANCE</span><i style={{ left: `${(stats.balance + 1) * 50}%` }} />
            </div>
            <button className="action-button" onPointerDown={() => setControl("action", true)} onPointerUp={() => setControl("action", false)} onPointerCancel={() => setControl("action", false)}>
              <span>{stats.vehicleMode ? "EXIT" : stats.nearVan ? "DRIVE" : stats.phase === "riding" ? "TRICK" : "CATCH"}</span>
              {stats.vehicleMode || stats.nearVan ? <CarFront /> : stats.phase === "riding" ? <Sparkles /> : <Waves />}
            </button>
          </div>

          {paused && (
            <div className="pause-overlay">
              <div className="pause-card">
                <span className="overline">SESSION PAUSED</span>
                <h2>Listen to the break.</h2>
                <p>{zoneLabel} is running {settings.waveHeight.toFixed(1)} m at {settings.wavePeriod.toFixed(1)} seconds. Session grade {stats.grade} · personal best {personalBest.score.toLocaleString()}.</p>
                <button className="primary-pause" onClick={() => setPaused(false)}><Play /> Return to water</button>
                <button onClick={leaveSession}><MapPin /> Choose another break</button>
                <button onClick={() => { setStats(INITIAL_STATS); setSessionKey((value) => value + 1); setPaused(false); }}><RotateCcw /> Restart session</button>
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
              <article><span>01</span><Waves /><strong>Enter</strong><p>Use W or the D-pad to walk through the shallows until your board begins to float.</p></article>
              <article><span>02</span><AudioLines /><strong>Read</strong><p>Paddle beyond the break. Watch the sets, then press Space or Catch as a wall approaches.</p></article>
              <article><span>03</span><Sparkles /><strong>Flow</strong><p>Steer with A/D, shift nose-to-tail with W/S, balance with mouse or thumb, then press Space to land a context-aware maneuver.</p></article>
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
