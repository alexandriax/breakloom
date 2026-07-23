"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Effects, Environment, Lightformer, Sky, Sparkles, useGLTF, useTexture } from "@react-three/drei";
import { createContext, MutableRefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ShaderPass } from "three-stdlib";
import type { Beach, BreakCharacter, CoastBiome } from "@/lib/beaches";
import { getBreakCharacter, getCoastBiome } from "@/lib/beaches";
import type { BoardType, GamePhase, GameStats, SessionSettings, ThermalKit } from "@/lib/game";
import { BOARD_SPECS, OUTER_PADDLE_LIMIT_Z, primaryWavePhaseAt, primaryWaveVelocityAt, sessionGrade, SHORELINE_REFERENCE_Z, shorelineShiftForTide, thermalKitForConditions, tideResponseForBreak, waveHeightAt, waveSetStateAt, waveSurfaceFrameAt } from "@/lib/game";
import { solarPositionAt } from "@/lib/solar";

export type ControlState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  action: boolean;
  moveX: number;
  moveY: number;
  balance: number;
  gamepadConnected: boolean;
  gamepadActive: boolean;
  gamepadMoveX: number;
  gamepadMoveY: number;
  gamepadBalance: number;
  gamepadAction: boolean;
  gamepadSprint: boolean;
  lookYaw: number;
  lookPitch: number;
};

export type CameraMode = "follow" | "pov" | "immersive" | "cinematic";
export type RideCaptureRequest = {
  id: number;
  rideId: number;
  quality: number;
  purpose: "ride" | "photo";
  view: "cinematic" | "player";
  caption?: string;
  focalLength?: number;
  exposure?: number;
};
export type RideFrameCapture = RideCaptureRequest & {
  blob: Blob;
};
export type ReplayMoment = {
  id: string;
  kind: "takeoff" | "power" | "maneuver" | "barrel" | "exit";
  label: string;
  progress: number;
  quality: number;
};
export type ReplayTelemetry = {
  speed: number;
  facePosition: number;
  lineControl: number;
  linePosition: number;
  railGrip: number;
  railLoad: number;
  stance: number;
  power: number;
  barrel: number;
  maneuver: number;
};
export type ReplayState = {
  active: boolean;
  progress: number;
  duration: number;
  cameraMode: CameraMode;
  telemetry: ReplayTelemetry;
  moments: ReplayMoment[];
};
export type ReplayControl = {
  paused: boolean;
  speed: number;
  seekProgress: number;
  seekRequest: number;
  autoDirector: boolean;
};
type RenderQuality = "reduced" | "balanced" | "high";

const RenderQualityContext = createContext<RenderQuality>("high");

const LINEUP_ENTRY_Z = -30;
const COAST_PLAYABLE_HALF_WIDTH = 560;
const COAST_GEOMETRY_WIDTH = 1600;
const COAST_CHUNK_SPAN = 240;
const COAST_CHUNK_SLOTS = [-1, 0, 1] as const;
const OCEAN_RENDER_WIDTH = 620;
const WATER_SIDE_LIMIT = COAST_PLAYABLE_HALF_WIDTH;
const OCEAN_PLANE_DEPTH = 1250;
const OCEAN_CENTER_Z = SHORELINE_REFERENCE_Z - OCEAN_PLANE_DEPTH * .5;
const CAMERA_WATER_SAMPLE_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [.7071, .7071],
  [-.7071, .7071],
  [.7071, -.7071],
  [-.7071, -.7071],
] as const;

function cameraWaterEnvelopeAt(
  x: number,
  z: number,
  elapsed: number,
  settings: SessionSettings,
  character: BreakCharacter,
) {
  // The rendered Gerstner surface displaces horizontally as well as vertically.
  // Sample a footprint larger than the camera body so a steep lip cannot move
  // over the lens between frames and expose the single mathematical surface.
  const radius = THREE.MathUtils.clamp(1.12 + settings.waveHeight * .34, 1.38, 3.25);
  let envelope = waveHeightAt(x, z, elapsed, settings, character);
  CAMERA_WATER_SAMPLE_DIRECTIONS.forEach(([directionX, directionZ]) => {
    envelope = Math.max(
      envelope,
      waveHeightAt(
        x + directionX * radius,
        z + directionZ * radius,
        elapsed,
        settings,
        character,
      ),
    );
  });
  return envelope;
}

function useRenderQuality() {
  return useContext(RenderQualityContext);
}

function rendererLimits(mobile: boolean) {
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  if (!mobile) return { minimum: 1, initial: Math.min(devicePixelRatio, 1.45), maximum: Math.min(devicePixelRatio, 1.7) };
  const navigatorProfile = navigator as Navigator & { deviceMemory?: number };
  const memory = navigatorProfile.deviceMemory ?? 6;
  const cores = navigator.hardwareConcurrency || 6;
  const maximum = memory <= 4 || cores <= 4
    ? Math.min(devicePixelRatio, 1.06)
    : memory <= 6 || cores <= 6
      ? Math.min(devicePixelRatio, 1.16)
      : Math.min(devicePixelRatio, 1.3);
  return {
    minimum: Math.min(.82, maximum),
    initial: Math.min(maximum, memory <= 4 || cores <= 4 ? .96 : 1.1),
    maximum,
  };
}

function AdaptiveRenderer({
  active,
  mobile,
  limits,
  onQualityChange,
}: {
  active: boolean;
  mobile: boolean;
  limits: ReturnType<typeof rendererLimits>;
  onQualityChange: (quality: RenderQuality) => void;
}) {
  const setDpr = useThree((state) => state.setDpr);
  const currentDpr = useRef(limits.initial);
  const currentQuality = useRef<RenderQuality>(mobile ? "balanced" : "high");
  const sample = useRef({ elapsed: 0, frames: 0, warmup: mobile ? 1.65 : 1.1 });

  useEffect(() => {
    currentDpr.current = limits.initial;
    currentQuality.current = mobile ? "balanced" : "high";
    sample.current = { elapsed: 0, frames: 0, warmup: mobile ? 1.65 : 1.1 };
    setDpr(limits.initial);
    onQualityChange(currentQuality.current);
  }, [limits.initial, mobile, onQualityChange, setDpr]);

  useFrame((_, delta) => {
    if (!active || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
    const meter = sample.current;
    if (meter.warmup > 0) {
      meter.warmup -= Math.min(delta, .05);
      return;
    }
    if (delta > .12) {
      meter.elapsed = 0;
      meter.frames = 0;
      meter.warmup = .7;
      return;
    }
    meter.elapsed += Math.min(delta, .05);
    meter.frames += 1;
    if (meter.elapsed < 2.2) return;

    const averageFrame = meter.elapsed / Math.max(1, meter.frames);
    let nextDpr = currentDpr.current;
    if (averageFrame > .024) nextDpr -= .12;
    else if (averageFrame > .0202) nextDpr -= .055;
    else if (averageFrame < .0177) nextDpr += .05;
    nextDpr = THREE.MathUtils.clamp(nextDpr, limits.minimum, limits.maximum);

    const changed = Math.abs(nextDpr - currentDpr.current) >= .025;
    if (changed) {
      currentDpr.current = nextDpr;
      setDpr(nextDpr);
      meter.warmup = .9;
    }
    let quality: RenderQuality = averageFrame > .025 || nextDpr <= limits.minimum + .055
      ? "reduced"
      : averageFrame < .0183 && nextDpr >= limits.maximum - .055
        ? "high"
        : "balanced";
    if (currentQuality.current === "high" && averageFrame < .0194 && nextDpr >= limits.maximum - .055) quality = "high";
    if (currentQuality.current === "reduced" && averageFrame > .0224 && nextDpr <= limits.minimum + .12) quality = "reduced";
    if (quality !== currentQuality.current) {
      currentQuality.current = quality;
      onQualityChange(quality);
    }
    meter.elapsed = 0;
    meter.frames = 0;
  });

  return null;
}

type SurfSceneProps = {
  beach: Beach;
  zoneName: string;
  latitude: number;
  longitude: number;
  settings: SessionSettings;
  cloudCover: number;
  weatherCode: number;
  observedAt: string;
  utcOffsetSeconds: number;
  sunrise: string;
  sunset: string;
  cameraMode: CameraMode;
  controls: MutableRefObject<ControlState>;
  active: boolean;
  renderActive: boolean;
  photoMode: boolean;
  photoFocalLength: number;
  photoExposure: number;
  replayMode: boolean;
  replayRequest: number;
  replayControl: ReplayControl;
  captureRequest: RideCaptureRequest | null;
  onCapture: (capture: RideFrameCapture) => void;
  onReplayReady: (ready: boolean) => void;
  onReplayState: (state: ReplayState) => void;
  onStats: (stats: GameStats) => void;
  onReady: () => void;
};

type MotionState = {
  phase: GamePhase;
  balance: number;
  steer: number;
  speed: number;
  acceleration: number;
  lateralForce: number;
  run: number;
  waterDepth: number;
  wetness: number;
  exertion: number;
  paddleEffort: number;
  waveQuality: number;
  facePosition: number;
  linePosition: number;
  lineControl: number;
  lineSide: number;
  sectionPressure: number;
  setEnergy: number;
  wipeout: number;
  wipeoutProgress: number;
  wipeoutPower: number;
  breath: number;
  maneuver: number;
  maneuverSide: number;
  maneuverLift: number;
  maneuverSpin: number;
  trickCharge: number;
  maneuverProgress: number;
  landingCue: number;
  landingTarget: number;
  landingWindow: number;
  stance: number;
  barrel: number;
  rail: number;
  compression: number;
  slip: number;
  impact: number;
  takeoff: number;
  finish: number;
  takeoffRead: number;
  catchReady: number;
  takeoffCommit: number;
  shorebreak: number;
  shorebreakPower: number;
  shorebreakSeconds: number;
  duckDive: number;
  submersion: number;
  leashTension: number;
  paddleHeading: number;
};

type ReplayFrame = {
  at: number;
  x: number;
  z: number;
  heading: number;
  lineSide: number;
  crestOffset: number;
  maneuverName: string;
  motion: MotionState;
};

type ReplayRestoreState = {
  frozenAt: number;
  position: THREE.Vector3;
  landVelocity: THREE.Vector2;
  paddleVelocity: THREE.Vector2;
  rideVelocity: THREE.Vector2;
  rideAcceleration: THREE.Vector2;
  wipeoutVelocity: THREE.Vector2;
  phase: GamePhase;
  playerHeading: number;
  paddleHeading: number;
  rideHeading: number;
  lineSide: number;
  crestOffset: number;
  facePosition: number;
  stance: number;
  stamina: number;
  breath: number;
  wipeoutPower: number;
  wipeoutDuration: number;
  railSlip: number;
  unstableFor: number;
  wipeoutAt: number;
  nextShorebreakAt: number;
  duckDiveUntil: number;
  missedWaveUntil: number;
  finishAt: number;
  takeoffCommitAt: number;
  motion: MotionState;
  waterElevation: number;
  waterVelocity: number;
  waterEngaged: boolean;
};

type ReplayPlayback = {
  active: boolean;
  handledRequest: number;
  handledSeekRequest: number;
  duration: number;
  progress: number;
  timeCycleOffset: number;
  cursor: number;
  lastReportAt: number;
  cameraCut: number;
  moments: ReplayMoment[];
  restore: ReplayRestoreState | null;
};

function dampAngle(current: number, target: number, responsiveness: number, delta: number) {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * (1 - Math.exp(-responsiveness * delta));
}

function lerpAngle(from: number, to: number, alpha: number) {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + difference * alpha;
}

function interpolateReplayMotion(from: MotionState, to: MotionState, alpha: number) {
  const next = { ...from, phase: "riding" as GamePhase };
  const numeric = next as unknown as Record<string, number | GamePhase>;
  for (const key of Object.keys(next) as Array<keyof MotionState>) {
    if (key === "phase") continue;
    const start = from[key];
    const end = to[key];
    if (typeof start === "number" && typeof end === "number") {
      numeric[key] = THREE.MathUtils.lerp(start, end, alpha);
    }
  }
  return next;
}

function replayTelemetryFromMotion(motion: MotionState): ReplayTelemetry {
  return {
    speed: Math.max(0, motion.speed),
    facePosition: THREE.MathUtils.clamp(motion.facePosition, -1, 1),
    lineControl: THREE.MathUtils.clamp(motion.lineControl, 0, 1),
    linePosition: THREE.MathUtils.clamp(motion.linePosition, -1, 1),
    railGrip: THREE.MathUtils.clamp(1 - motion.slip, 0, 1),
    railLoad: THREE.MathUtils.clamp(motion.rail, -1, 1),
    stance: THREE.MathUtils.clamp(motion.stance, -1, 1),
    power: THREE.MathUtils.clamp(
      motion.setEnergy * .2
        + motion.waveQuality * .3
        + Math.min(1, Math.max(0, motion.speed) / 18) * .24
        + Math.abs(motion.rail) * .13
        + motion.barrel * .13,
      0,
      1,
    ),
    barrel: THREE.MathUtils.clamp(motion.barrel, 0, 1),
    maneuver: THREE.MathUtils.clamp(Math.max(motion.maneuver, motion.maneuverProgress), 0, 1),
  };
}

function replayMomentsForFrames(frames: ReplayFrame[]): ReplayMoment[] {
  if (frames.length < 2) return [];
  const firstAt = frames[0].at;
  const duration = Math.max(.001, frames[frames.length - 1].at - firstAt);
  const progressAt = (index: number) => THREE.MathUtils.clamp((frames[index].at - firstAt) / duration, 0, 1);
  const candidates: Omit<ReplayMoment, "id">[] = [];
  const add = (
    kind: ReplayMoment["kind"],
    label: string,
    index: number,
    quality: number,
  ) => {
    candidates.push({
      kind,
      label,
      progress: progressAt(THREE.MathUtils.clamp(index, 0, frames.length - 1)),
      quality: THREE.MathUtils.clamp(quality, 0, 1),
    });
  };

  let takeoffIndex = 0;
  let takeoffQuality = 0;
  const takeoffLimit = Math.max(1, Math.floor(frames.length * .2));
  for (let index = 0; index <= takeoffLimit; index += 1) {
    const state = frames[index].motion;
    const quality = state.takeoff * .34
      + state.takeoffCommit * .27
      + state.takeoffRead * .2
      + state.waveQuality * .19;
    if (quality > takeoffQuality) {
      takeoffQuality = quality;
      takeoffIndex = index;
    }
  }
  add("takeoff", "TAKEOFF", takeoffIndex, Math.max(.3, takeoffQuality));

  let maneuverStart = -1;
  let maneuverPeakIndex = -1;
  let maneuverPeak = 0;
  let maneuverPeakLabel = "MANEUVER";
  const finishManeuver = () => {
    if (maneuverStart < 0 || maneuverPeakIndex < 0) return;
    add("maneuver", maneuverPeakLabel, maneuverPeakIndex, maneuverPeak);
    maneuverStart = -1;
    maneuverPeakIndex = -1;
    maneuverPeak = 0;
    maneuverPeakLabel = "MANEUVER";
  };
  frames.forEach((frame, index) => {
    const state = frame.motion;
    const active = state.maneuver > .12
      || (state.maneuverProgress > .035 && state.maneuverProgress < .985);
    if (!active) {
      finishManeuver();
      return;
    }
    if (maneuverStart < 0) maneuverStart = index;
    const quality = Math.max(
      state.maneuver,
      state.impact * .78,
      state.landingCue * .7,
      state.maneuverLift * .58,
    );
    if (quality > maneuverPeak) {
      maneuverPeak = quality;
      maneuverPeakIndex = index;
      maneuverPeakLabel = frame.maneuverName ? frame.maneuverName.toUpperCase() : "MANEUVER";
    }
  });
  finishManeuver();

  let powerIndex = 0;
  let powerQuality = 0;
  let barrelIndex = 0;
  let barrelQuality = 0;
  frames.forEach((frame, index) => {
    const progress = progressAt(index);
    if (progress > .12 && progress < .88) {
      const state = frame.motion;
      const power = state.lineControl * .46
        + state.sectionPressure * .25
        + state.waveQuality * .19
        + Math.min(1, state.speed / 18) * .1;
      if (power > powerQuality) {
        powerQuality = power;
        powerIndex = index;
      }
    }
    if (frame.motion.barrel > barrelQuality) {
      barrelQuality = frame.motion.barrel;
      barrelIndex = index;
    }
  });
  if (powerQuality >= .58) add("power", "POWER POCKET", powerIndex, powerQuality);
  if (barrelQuality >= .28) add("barrel", "BARREL", barrelIndex, barrelQuality);

  const exitIndex = frames.length - 1;
  const exitState = frames[exitIndex].motion;
  add(
    "exit",
    exitState.finish > .2 ? "CLEAN EXIT" : "LINE END",
    exitIndex,
    Math.max(exitState.finish, exitState.lineControl * .72),
  );

  const priority: Record<ReplayMoment["kind"], number> = {
    takeoff: 5,
    barrel: 4,
    maneuver: 3,
    power: 2,
    exit: 5,
  };
  const sorted = candidates.sort((a, b) => a.progress - b.progress);
  const moments: Omit<ReplayMoment, "id">[] = [];
  sorted.forEach((candidate) => {
    const previous = moments[moments.length - 1];
    const endpoint = candidate.kind === "takeoff" || candidate.kind === "exit";
    if (
      previous
      && !endpoint
      && previous.kind !== "takeoff"
      && previous.kind !== "exit"
      && candidate.progress - previous.progress < .045
    ) {
      if (
        priority[candidate.kind] > priority[previous.kind]
        || (priority[candidate.kind] === priority[previous.kind] && candidate.quality > previous.quality)
      ) {
        moments[moments.length - 1] = candidate;
      }
      return;
    }
    moments.push(candidate);
  });
  return moments.map((moment, index) => ({
    ...moment,
    id: `${moment.kind}-${Math.round(moment.progress * 1000)}-${index}`,
  }));
}

function replayCameraForProgress(progress: number): CameraMode {
  if (progress < .24) return "cinematic";
  if (progress < .5) return "immersive";
  if (progress < .76) return "follow";
  return "cinematic";
}

function namedModelObject(root: THREE.Object3D, authoredName: string) {
  return root.getObjectByName(authoredName)
    ?? root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(authoredName));
}

type ManeuverAttempt = {
  name: string;
  family: "trim" | "carve" | "lip" | "air";
  base: number;
  side: number;
  charge: number;
  lift: number;
  rotation: number;
  startedAt: number;
  duration: number;
};

type VehicleMotionState = {
  speed: number;
  steer: number;
  throttle: number;
  driving: boolean;
  brake: boolean;
  wetness: number;
  offRoad: number;
  traction: number;
  slip: number;
  longitudinalG: number;
  lateralG: number;
  suspension: number;
};

function isMobileRenderer() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0 || window.innerWidth <= 820;
}

type WeatherProfile = {
  kind: "none" | "rain" | "snow";
  intensity: number;
  fog: boolean;
  storm: boolean;
};

function weatherProfile(code: number): WeatherProfile {
  if (code === 45 || code === 48) return { kind: "none", intensity: 0, fog: true, storm: false };
  if ([51, 53, 55, 56, 57].includes(code)) {
    return { kind: "rain", intensity: code === 51 ? .34 : code === 53 || code === 56 ? .52 : .7, fog: false, storm: false };
  }
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    const heavy = code === 65 || code === 67 || code === 82;
    const moderate = code === 63 || code === 66 || code === 81;
    return { kind: "rain", intensity: heavy ? 1 : moderate ? .72 : .48, fog: false, storm: false };
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    const heavy = code === 75 || code === 86;
    const moderate = code === 73 || code === 85;
    return { kind: "snow", intensity: heavy ? 1 : moderate ? .72 : .48, fog: false, storm: false };
  }
  if ([95, 96, 99].includes(code)) return { kind: "rain", intensity: 1, fog: false, storm: true };
  return { kind: "none", intensity: 0, fog: false, storm: false };
}

function weatherWetness(code: number) {
  const profile = weatherProfile(code);
  if (profile.kind === "rain") return THREE.MathUtils.clamp(.28 + profile.intensity * .72, 0, 1);
  if (profile.kind === "snow") return .24 + profile.intensity * .2;
  if (profile.fog) return .12;
  return 0;
}

function seededRandom(index: number, salt = 0) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

const OCEAN_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uPeriod;
  uniform float uSwellHeight;
  uniform float uSwellPeriod;
  uniform float uSwellDirection;
  uniform float uCurrent;
  uniform float uWaveDirection;
  uniform float uCurrentDirection;
  uniform float uWindDirection;
  uniform float uCoastHeading;
  uniform float uTide;
  uniform float uTideFaceScale;
  uniform float uBreakShift;
  uniform float uWind;
  uniform float uPeel;
  uniform float uPower;
  uniform float uSteepness;
  uniform float uHollow;
  uniform float uVariability;
  uniform float uCenterX;
  varying float vHeight;
  varying float vCrest;
  varying float vBreaker;
  varying float vChop;
  varying vec2 vSurface;
  varying vec3 vWorldPosition;

  const float PI = 3.14159265359;

  vec2 coastalVector(float bearing) {
    float angle = radians(bearing - uCoastHeading);
    return vec2(sin(angle), cos(angle));
  }

  float crestEnergy(float crestIndex) {
    float ordinal = mod(-crestIndex, 9.0);
    if (ordinal < 0.0) ordinal += 9.0;
    if (ordinal < .5) return .10;
    if (ordinal < 1.5) return .12;
    if (ordinal < 2.5) return .16;
    if (ordinal < 3.5) return .24;
    if (ordinal < 4.5) return .72;
    if (ordinal < 5.5) return 1.0;
    if (ordinal < 6.5) return .86;
    if (ordinal < 7.5) return .36;
    return .17;
  }

  float travelingSetEnergy(float phase) {
    float crestCoordinate = (phase - PI * .5) / (PI * 2.0);
    float lowerCrest = floor(crestCoordinate);
    float blend = smoothstep(0.0, 1.0, fract(crestCoordinate));
    return mix(crestEnergy(lowerCrest), crestEnergy(lowerCrest + 1.0), blend);
  }

  float gerstner(
    inout vec3 point,
    vec2 origin,
    vec2 direction,
    float wavelength,
    float amplitude,
    float steepness,
    float phaseSpeed,
    float phaseOffset
  ) {
    float waveNumber = PI * 2.0 / wavelength;
    // Travel in the supplied swell direction. Positive coastal Y points toward
    // shore, so subtracting time makes the crest advance landward.
    float phase = dot(origin, direction) * waveNumber - uTime * phaseSpeed + phaseOffset;
    float sine = sin(phase);
    float cosine = cos(phase);
    float horizontal = steepness * amplitude;
    point.x += direction.x * horizontal * cosine;
    point.y += direction.y * horizontal * cosine;
    point.z += amplitude * sine;
    return sine;
  }

  void main() {
    vec2 origin = position.xy;
    vec2 surfaceOrigin = vec2(origin.x + uCenterX, -origin.y + ${OCEAN_CENTER_Z.toFixed(1)});
    vec3 p = position;
    float angularSpeed = PI * 2.0 / max(4.0, uPeriod);
    vec2 waveDir = coastalVector(uWaveDirection);
    vec2 swellDir = coastalVector(uSwellDirection);
    vec2 currentDir = coastalVector(uCurrentDirection);
    vec2 windDir = coastalVector(uWindDirection);
    float section = sin(surfaceOrigin.x * .07 + uTime * .05) * uVariability * 2.3;
    float breakCoord = surfaceOrigin.y + surfaceOrigin.x * uPeel * .16 + section - uBreakShift;
    float curve = waveDir.x * .0019 * surfaceOrigin.x * surfaceOrigin.x;
    vec2 curvedOrigin = vec2(surfaceOrigin.x, breakCoord + curve);
    float shore = .72 + smoothstep(-85.0, 8.0, breakCoord) * (.58 + uSteepness * .24);
    float shallowCompression = mix(1.0, mix(.82, .69, uSteepness), smoothstep(-32.0, 9.0, breakCoord));
    float primaryWavelength = clamp(1.56 * uPeriod * uPeriod, 48.0, 320.0) * shallowCompression;
    vec2 primaryDirection = normalize(vec2(.095 + uPeel * .075 + waveDir.x * .42 + currentDir.x * .035, max(.45, waveDir.y)));
    float primaryPhase = dot(curvedOrigin, primaryDirection) * (PI * 2.0 / primaryWavelength) - uTime * angularSpeed;
    float setEnergy = travelingSetEnergy(primaryPhase);
    float setLift = .78 + setEnergy * .34;
    float amplitude = max(.12, uHeight * .62) * uPower * uTideFaceScale;
    float swellPeriod = max(4.0, uSwellPeriod);
    float swellWavelength = clamp(1.56 * swellPeriod * swellPeriod, 64.0, 520.0);
    float swellAmplitude = max(0.0, min(uSwellHeight, uHeight * 1.35) * .16);
    float swellShoaling = .84 + smoothstep(-85.0, 8.0, breakCoord) * .24;
    float windChop = clamp(uWind / 24.0, .12, 1.45);
    float currentBend = clamp(uCurrent / 4.0, 0.0, 1.0);

    float primary = gerstner(
      p,
      curvedOrigin,
      primaryDirection,
      primaryWavelength,
      amplitude * .64 * shore * setLift,
      clamp(.46 + uSteepness * .32, .58, .88),
      angularSpeed,
      0.0
    );
    float liveSwell = gerstner(
      p,
      surfaceOrigin,
      normalize(vec2(swellDir.x, max(.28, swellDir.y))),
      swellWavelength,
      swellAmplitude * swellShoaling,
      clamp(.28 + uSteepness * .08, .3, .42),
      PI * 2.0 / swellPeriod,
      1.7
    );
    float crossSwell = gerstner(
      p,
      surfaceOrigin,
      normalize(vec2(waveDir.x + waveDir.y * .62, max(.28, waveDir.y - waveDir.x * .62)) + currentDir * (.12 + currentBend * .12)),
      47.5,
      amplitude * .11,
      .42,
      angularSpeed * 2.7,
      0.0
    );
    float windWave = gerstner(
      p,
      surfaceOrigin,
      normalize(windDir + vec2(0.0, .15)),
      mix(8.5, 5.4, windChop / 1.45),
      .035 + windChop * .065,
      .34,
      1.7 + windChop * 1.2,
      2.4
    );
    vec2 windTangent = vec2(-windDir.y, windDir.x);
    float capillary = sin(dot(surfaceOrigin, windDir) * 1.35 + dot(surfaceOrigin, windTangent) * .78 + uTime * (2.2 + windChop)) * (.018 + windChop * .018);
    p.z += uTide * .3 + capillary;

    vHeight = p.z;
    vCrest = primary * shore;
    float breakerThreshold = mix(.58, .4, uHollow);
    vBreaker = smoothstep(-18.0, 12.0, breakCoord) * smoothstep(breakerThreshold, .96, primary * .5 + .5) * setLift * (.72 + uHollow * .34);
    vChop = abs(liveSwell) * .38 + abs(crossSwell) * .24 + abs(windWave) * windChop;
    vSurface = surfaceOrigin;
    vWorldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const OCEAN_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uHeight;
  uniform float uLight;
  uniform float uCloud;
  uniform float uWind;
  uniform float uRain;
  uniform float uWaveDirection;
  uniform float uWindDirection;
  uniform float uCoastHeading;
  uniform float uVisibility;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uHazeColor;
  varying float vHeight;
  varying float vCrest;
  varying float vBreaker;
  varying float vChop;
  varying vec2 vSurface;
  varying vec3 vWorldPosition;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    float depth = smoothstep(14.0, -90.0, vSurface.y);
    vec3 abyss = vec3(.004, .032, .071);
    vec3 offshore = vec3(.012, .115, .155);
    vec3 lagoon = vec3(.045, .39, .38);
    vec3 deep = mix(offshore, abyss, depth);
    float crestLight = smoothstep(-.2, .95, vHeight) * (1.0 - depth);
    vec3 color = mix(deep, lagoon, crestLight * .48);
    vec3 surfaceNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    if (surfaceNormal.y < 0.0) surfaceNormal *= -1.0;
    bool underwaterSide = !gl_FrontFacing;
    if (underwaterSide) surfaceNormal *= -1.0;
    float wind = clamp(uWind / 24.0, .0, 1.45);
    float windAngle = radians(uWindDirection - uCoastHeading);
    vec2 windDir = vec2(sin(windAngle), cos(windAngle));
    vec2 windTangent = vec2(-windDir.y, windDir.x);
    vec2 windSurface = vec2(dot(vSurface, windDir), dot(vSurface, windTangent));
    vec2 cloudDrift = windDir * uTime * (.01 + wind * .018);
    float cloudField = noise(vSurface * .009 + cloudDrift);
    float cloudShadow = smoothstep(mix(.9, .44, uCloud), .93, cloudField) * uCloud;
    color *= 1.0 - cloudShadow * (.075 + uCloud * .13);

    float shallowWater = 1.0 - depth;
    float causticBands = sin(windSurface.x * 1.28 + uTime * 1.16) * cos(windSurface.y * .92 - uTime * .84);
    float causticLight = pow(max(0.0, causticBands), 5.0) * shallowWater * shallowWater;
    color += vec3(.16, .48, .39) * causticLight * uLight * .075;

    vec2 microFlow = vec2(
      sin(windSurface.x * 1.72 + windSurface.y * .63 + uTime * (1.7 + wind)),
      cos(windSurface.x * .91 - windSurface.y * 1.38 - uTime * (1.35 + wind * .7))
    );
    surfaceNormal = normalize(surfaceNormal + vec3(microFlow.x, 0.0, microFlow.y) * (.018 + wind * .024));
    if (uRain > .01) {
      vec2 rainUv = vSurface * 1.16;
      vec2 rainCell = floor(rainUv);
      vec2 rainPoint = fract(rainUv) - .5;
      float rainPhase = fract(uTime * 1.34 + hash(rainCell) * 1.73);
      float rainRing = 1.0 - smoothstep(.025, .075, abs(length(rainPoint) - rainPhase * .62));
      rainRing *= (1.0 - rainPhase) * uRain;
      surfaceNormal = normalize(surfaceNormal + vec3(rainPoint.x, 0.0, rainPoint.y) * rainRing * .16);
    }
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = .028 + .972 * pow(1.0 - clamp(dot(surfaceNormal, viewDirection), 0.0, 1.0), 5.0);
    vec3 horizonReflection = mix(vec3(.11, .31, .39), vec3(.42, .67, .69), uLight);
    horizonReflection = mix(horizonReflection, vec3(.09, .13, .17), uCloud * .55);
    color = mix(color, horizonReflection, fresnel * (.38 + uLight * .28));

    vec3 reflectedSun = reflect(-normalize(uSunDirection), surfaceNormal);
    float sunGlint = pow(max(0.0, dot(reflectedSun, viewDirection)), mix(62.0, 150.0, 1.0 - wind * .45));
    float brokenGlint = noise(vSurface * vec2(1.8, .72) + vec2(uTime * .3, -uTime * .11));
    sunGlint *= smoothstep(.18, .88, brokenGlint) * (1.0 + vChop * .6);
    color += uSunColor * sunGlint * (1.1 + uLight * 3.2);

    float broadGlint = pow(max(0.0, dot(reflectedSun, viewDirection)), mix(13.0, 27.0, 1.0 - wind * .35));
    float glintBreakup = brokenGlint * (.7 + sin(windSurface.x * 4.8 - windSurface.y * 2.2 + uTime * .72) * .3);
    float sparkleMask = smoothstep(.52, .86, glintBreakup);
    color += uSunColor * broadGlint * sparkleMask * (.08 + uLight * .46) * (1.0 - uCloud * .78);

    float forwardScatter = pow(max(0.0, dot(viewDirection, -normalize(uSunDirection))), 3.0);
    color += vec3(.05, .52, .43) * crestLight * forwardScatter * (.18 + uLight * .34);

    float crestGate = smoothstep(.66, 1.08, vCrest) * smoothstep(.35, 1.2, uHeight);
    float waveAngle = radians(uWaveDirection - uCoastHeading);
    vec2 waveDir = vec2(sin(waveAngle), cos(waveAngle));
    vec2 waveTangent = vec2(-waveDir.y, waveDir.x);
    vec2 waveSurface = vec2(dot(vSurface, waveTangent), dot(vSurface, waveDir));
    float foamBase = noise(waveSurface * vec2(.35, .12) + vec2(uTime * .48, -uTime * .08));
    float foamDetail = noise(waveSurface * vec2(1.18, .48) + vec2(-uTime * .74, uTime * .12));
    float breakerFoam = vBreaker * smoothstep(.26, .72, foamBase) * (.62 + foamDetail * .55);
    float foamLace = smoothstep(.48, .7, foamDetail) * (1.0 - smoothstep(.78, .96, foamDetail));
    breakerFoam += vBreaker * foamLace * (.16 + vChop * .22);
    float crestFoam = crestGate * smoothstep(.17, .76, foamDetail);
    float shorePulse = sin(vSurface.x * .2 + uTime * 1.7 + noise(vSurface * .08) * 4.0) * .5 + .5;
    float shoreFoam = smoothstep(4.2, 10.5, vSurface.y) * smoothstep(.27, .72, shorePulse) * .64;
    float foam = clamp(max(max(crestFoam, breakerFoam), shoreFoam), 0.0, .94);
    vec3 foamColor = mix(vec3(.63, .88, .84), vec3(.91, 1.0, .97), uLight);
    color = mix(color, foamColor, foam);
    color = mix(color, vec3(.018, .041, .065), uCloud * .2);
    color *= .91 + noise(vSurface * 3.1 + uTime * .08) * .09;

    if (underwaterSide) {
      float ceilingCells = noise(vSurface * vec2(.52, .21) + vec2(uTime * .18, -uTime * .11));
      float ceilingVeins = noise(vSurface * vec2(1.42, .62) + vec2(-uTime * .34, uTime * .19));
      float undersideFresnel = pow(1.0 - clamp(dot(surfaceNormal, viewDirection), 0.0, 1.0), 3.4);
      float surfaceFacing = max(.08, abs(dot(surfaceNormal, viewDirection)));
      float opticalThickness = (
        .16
        + abs(vHeight) * .34
        + vBreaker * .76
        + foam * .42
      ) / surfaceFacing;
      float volumeAbsorption = 1.0 - exp(-opticalThickness * .72);
      float sunThrough = pow(max(0.0, normalize(uSunDirection).y), 1.6) * (1.0 - uCloud * .72);
      float waveLens = pow(max(0.0, ceilingVeins * .72 + ceilingCells * .38 - .58), 3.2);
      vec3 undersideDeep = mix(vec3(.008, .11, .145), vec3(.018, .25, .235), uLight);
      vec3 undersideGlow = mix(vec3(.08, .34, .34), vec3(.38, .83, .68), uLight);
      vec3 bodyColor = mix(vec3(.003, .055, .082), vec3(.012, .18, .17), uLight * .72);
      vec3 underside = mix(undersideDeep, undersideGlow, (.14 + waveLens * .58) * sunThrough);
      underside += uSunColor * waveLens * sunThrough * (.08 + uLight * .38);
      underside = mix(underside, bodyColor, volumeAbsorption * (.24 + (1.0 - uLight) * .22));
      underside = mix(underside, vec3(.006, .052, .076), undersideFresnel * .68);
      underside = mix(underside, foamColor * (.52 + uLight * .22), foam * (.5 + ceilingCells * .28));
      underside *= .76 + ceilingCells * .14 + ceilingVeins * .08 + (1.0 - volumeAbsorption) * .05;
      color = underside;
    }

    float cameraDistance = length(cameraPosition - vWorldPosition);
    float hazeStart = max(24.0, uVisibility * .18);
    float aerialPerspective = smoothstep(hazeStart, max(hazeStart + 1.0, uVisibility), cameraDistance);
    aerialPerspective *= .56 + uCloud * .28;
    color = mix(color, uHazeColor, aerialPerspective);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const OCEAN_SUBSURFACE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uLight;
  uniform float uCloud;
  uniform float uWind;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uHazeColor;
  varying float vHeight;
  varying float vBreaker;
  varying float vChop;
  varying vec2 vSurface;
  varying vec3 vWorldPosition;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 surfaceNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    if (surfaceNormal.y > 0.0) surfaceNormal *= -1.0;
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float facing = max(.055, abs(dot(surfaceNormal, viewDirection)));
    float wind = clamp(uWind / 24.0, 0.0, 1.45);
    float bodyDepth = (.28 + abs(vHeight) * .16 + vBreaker * .64 + vChop * .14) / facing;
    float absorption = 1.0 - exp(-bodyDepth * .88);
    float cells = noise(vSurface * vec2(.38, .18) + vec2(uTime * .12, -uTime * .08));
    float veins = noise(vSurface * vec2(1.24, .57) + vec2(-uTime * (.22 + wind * .08), uTime * .13));
    float sunThrough = pow(max(0.0, normalize(uSunDirection).y), 1.5) * (1.0 - uCloud * .72);
    float lens = pow(max(0.0, cells * .56 + veins * .44 - .57), 2.8) * sunThrough;
    vec3 deepBody = mix(vec3(.002, .035, .062), vec3(.006, .11, .12), uLight);
    vec3 litBody = mix(vec3(.025, .18, .19), vec3(.12, .48, .4), uLight);
    vec3 color = mix(litBody, deepBody, absorption * .78);
    color += uSunColor * lens * (.035 + uLight * .2);
    color *= .72 + cells * .12 + veins * .08;
    color = mix(color, uHazeColor * .35, smoothstep(75.0, 260.0, length(cameraPosition - vWorldPosition)) * .45);
    gl_FragColor = vec4(color, .995);
  }
`;

function Ocean({
  settings,
  character,
  focusPosition,
  light,
  cloudCover,
  sunPosition,
  sunColor,
  hazeColor,
  visibility,
  rain,
}: {
  settings: SessionSettings;
  character: BreakCharacter;
  focusPosition: MutableRefObject<THREE.Vector3>;
  light: number;
  cloudCover: number;
  sunPosition: [number, number, number];
  sunColor: string;
  hazeColor: string;
  visibility: number;
  rain: number;
}) {
  const ocean = useRef<THREE.Mesh>(null);
  const subsurface = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const quality = useRenderQuality();
  const mobile = useMemo(() => isMobileRenderer(), []);
  const tideResponse = useMemo(
    () => tideResponseForBreak(settings.tide, character),
    [character, settings.tide],
  );
  const crossShoreSegments = mobile
    ? quality === "reduced" ? 80 : quality === "high" ? 140 : 108
    : quality === "reduced" ? 180 : quality === "balanced" ? 224 : 280;
  const offshoreSegments = mobile
    ? quality === "reduced" ? 96 : quality === "high" ? 150 : 120
    : quality === "reduced" ? 190 : quality === "balanced" ? 238 : 280;
  const subsurfaceCrossShoreSegments = Math.max(48, Math.round(crossShoreSegments * .62));
  const subsurfaceOffshoreSegments = Math.max(64, Math.round(offshoreSegments * .6));
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uHeight: { value: settings.waveHeight },
      uPeriod: { value: settings.wavePeriod },
      uSwellHeight: { value: settings.swellHeight },
      uSwellPeriod: { value: settings.swellPeriod },
      uSwellDirection: { value: settings.swellDirection },
      uCurrent: { value: settings.currentStrength },
      uWaveDirection: { value: settings.waveDirection },
      uCurrentDirection: { value: settings.currentDirection },
      uWindDirection: { value: settings.windDirection },
      uCoastHeading: { value: settings.coastHeading },
      uTide: { value: settings.tide },
      uTideFaceScale: { value: tideResponse.faceScale },
      uBreakShift: { value: tideResponse.breakShift },
      uLight: { value: 1 },
      uCloud: { value: 0 },
      uWind: { value: settings.windSpeed },
      uRain: { value: 0 },
      uVisibility: { value: 240 },
      uPeel: { value: character.peel },
      uPower: { value: character.power * tideResponse.powerScale },
      uSteepness: { value: character.steepness * tideResponse.steepnessScale },
      uHollow: { value: character.hollow * tideResponse.hollowScale },
      uVariability: { value: character.variability * tideResponse.variabilityScale },
      uCenterX: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(-.3, .8, -.45).normalize() },
      uSunColor: { value: new THREE.Color("#fff0ca") },
      uHazeColor: { value: new THREE.Color("#78979c") },
    }),
    [character, settings, tideResponse],
  );

  const tideShift = shorelineShiftForTide(settings.tide);

  useFrame(({ clock }, delta) => {
    if (!material.current) return;
    if (ocean.current) {
      ocean.current.position.x = THREE.MathUtils.damp(ocean.current.position.x, focusPosition.current.x, 12, delta);
      ocean.current.position.z = THREE.MathUtils.damp(ocean.current.position.z, OCEAN_CENTER_Z + tideShift, 2.8, delta);
    }
    if (subsurface.current) {
      subsurface.current.position.x = ocean.current?.position.x ?? focusPosition.current.x;
      subsurface.current.position.z = ocean.current?.position.z ?? OCEAN_CENTER_Z + tideShift;
    }
    const values = material.current.uniforms;
    values.uTime.value = clock.elapsedTime;
    values.uHeight.value = THREE.MathUtils.lerp(values.uHeight.value, settings.waveHeight, 0.02);
    values.uPeriod.value = settings.wavePeriod;
    values.uSwellHeight.value = THREE.MathUtils.lerp(values.uSwellHeight.value, settings.swellHeight, .025);
    values.uSwellPeriod.value = settings.swellPeriod;
    values.uSwellDirection.value = settings.swellDirection;
    values.uCurrent.value = settings.currentStrength;
    values.uWaveDirection.value = settings.waveDirection;
    values.uCurrentDirection.value = settings.currentDirection;
    values.uWindDirection.value = settings.windDirection;
    values.uCoastHeading.value = settings.coastHeading;
    values.uTide.value = settings.tide;
    values.uTideFaceScale.value = THREE.MathUtils.lerp(values.uTideFaceScale.value, tideResponse.faceScale, .035);
    values.uBreakShift.value = THREE.MathUtils.lerp(values.uBreakShift.value, tideResponse.breakShift, .035);
    values.uLight.value = light;
    values.uCloud.value = cloudCover / 100;
    values.uWind.value = settings.windSpeed;
    values.uRain.value = rain;
    values.uVisibility.value = visibility;
    values.uPeel.value = THREE.MathUtils.lerp(values.uPeel.value, character.peel, .035);
    values.uPower.value = THREE.MathUtils.lerp(values.uPower.value, character.power * tideResponse.powerScale, .035);
    values.uSteepness.value = THREE.MathUtils.lerp(values.uSteepness.value, character.steepness * tideResponse.steepnessScale, .035);
    values.uHollow.value = THREE.MathUtils.lerp(values.uHollow.value, character.hollow * tideResponse.hollowScale, .035);
    values.uVariability.value = THREE.MathUtils.lerp(values.uVariability.value, character.variability * tideResponse.variabilityScale, .035);
    values.uCenterX.value = ocean.current?.position.x ?? focusPosition.current.x;
    values.uSunDirection.value.set(...sunPosition).normalize();
    values.uSunColor.value.set(sunColor);
    values.uHazeColor.value.set(hazeColor);
  });

  return (
    <>
      <mesh ref={ocean} position={[0, -0.08, OCEAN_CENTER_Z + tideShift]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[OCEAN_RENDER_WIDTH, OCEAN_PLANE_DEPTH, crossShoreSegments, offshoreSegments]} />
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={OCEAN_VERTEX}
          fragmentShader={OCEAN_FRAGMENT}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        ref={subsurface}
        position={[0, -.34 - Math.min(.18, settings.waveHeight * .04), OCEAN_CENTER_Z + tideShift]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-1}
      >
        <planeGeometry args={[OCEAN_RENDER_WIDTH, OCEAN_PLANE_DEPTH, subsurfaceCrossShoreSegments, subsurfaceOffshoreSegments]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={OCEAN_VERTEX}
          fragmentShader={OCEAN_SUBSURFACE_FRAGMENT}
          side={THREE.BackSide}
          transparent
          opacity={.995}
        />
      </mesh>
    </>
  );
}

const LINEUP_CREST_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uFaceHeight;
  uniform float uSpan;
  uniform float uCurl;
  uniform float uEnergy;
  uniform float uSeed;
  uniform float uCenterX;
  uniform float uPeel;
  uniform float uVariability;
  uniform float uWaveAngle;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vSection;

  void main() {
    float across = position.x * uSpan;
    float heightFraction = pow(clamp(uv.y, 0.0, 1.0), 1.22);
    float lip = smoothstep(.68, 1.0, uv.y);
    float sectionPhase = (uCenterX + across) * .07 + uTime * .05;
    float centerPhase = uCenterX * .07 + uTime * .05;
    float section = (sin(sectionPhase) - sin(centerPhase)) * uVariability * 2.3;
    float worldAcross = uCenterX + across;
    float curvedSection = sin(uWaveAngle) * .0019
      * (worldAcross * worldAcross - uCenterX * uCenterX);
    float feather = sin(across * .18 + uSeed * 5.7 + uTime * .55)
      * sin(across * .061 - uSeed * 2.9 - uTime * .19);

    vec3 transformed = position;
    transformed.x = across;
    transformed.y = heightFraction * uFaceHeight;
    transformed.z = -(section + curvedSection + across * uPeel * .16);
    transformed.z -= heightFraction * (.06 + uFaceHeight * .055);
    transformed.z -= lip * lip * uCurl * (.18 + uFaceHeight * .22);
    transformed.z += feather * (.018 + uEnergy * .035) * heightFraction;

    float normalRipple = cos(across * .18 + uSeed * 5.7 + uTime * .55) * .05 * heightFraction;
    vec3 localNormal = normalize(vec3(normalRipple, .2 + (1.0 - heightFraction) * .18, .94));
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    vUv = uv;
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
    vSection = feather * .5 + .5;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const LINEUP_CREST_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uLight;
  uniform float uCloud;
  uniform float uEnergy;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vSection;

  float crestNoise(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 surfaceNormal = normalize(vWorldNormal);
    if (!gl_FrontFacing) surfaceNormal *= -1.0;
    float fresnel = pow(1.0 - clamp(abs(dot(surfaceNormal, viewDirection)), 0.0, 1.0), 2.2);
    float fineNoise = crestNoise(floor(vec2(vUv.x * 190.0, vUv.y * 42.0) + uTime * vec2(.7, -.26)));
    float feather = smoothstep(.38, .82, vSection * .68 + fineNoise * .32);
    float foam = smoothstep(.7, .95, vUv.y + feather * .16 + uEnergy * .055);
    foam *= .66 + fineNoise * .34;

    vec3 shadowWater = mix(vec3(.016, .19, .25), vec3(.015, .31, .34), uLight);
    vec3 bodyWater = mix(vec3(.035, .32, .39), vec3(.08, .54, .53), uLight);
    vec3 litWater = mix(bodyWater, vec3(.22, .7, .66), fresnel * (.28 + uEnergy * .24));
    vec3 foamColor = mix(vec3(.58, .75, .76), vec3(.91, .98, .91), uLight);
    vec3 color = mix(shadowWater, litWater, smoothstep(.05, .9, vUv.y));
    color = mix(color, foamColor, foam * (.58 + uLight * .3));
    color *= 1.0 - uCloud * .17;

    float sideFade = smoothstep(0.0, .07, vUv.x) * (1.0 - smoothstep(.93, 1.0, vUv.x));
    float lowerFade = smoothstep(.015, .24, vUv.y);
    float topFeather = 1.0 - smoothstep(.986, 1.0, vUv.y);
    float alpha = uOpacity * sideFade * lowerFade * topFeather;
    alpha *= .56 + fresnel * .34 + foam * .36;
    if (alpha < .004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

const LINEUP_WHITEWATER_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uFaceHeight;
  uniform float uSpan;
  uniform float uTrail;
  uniform float uEnergy;
  uniform float uSeed;
  uniform float uCenterX;
  uniform float uPeel;
  uniform float uVariability;
  uniform float uWaveAngle;

  varying vec2 vUv;
  varying float vWake;
  varying float vSection;
  varying vec3 vWorldPosition;

  void main() {
    float across = position.x * uSpan;
    float wake = clamp(uv.y, 0.0, 1.0);
    float sectionPhase = (uCenterX + across) * .07 + uTime * .05;
    float centerPhase = uCenterX * .07 + uTime * .05;
    float section = (sin(sectionPhase) - sin(centerPhase)) * uVariability * 2.3;
    float worldAcross = uCenterX + across;
    float curvedSection = sin(uWaveAngle) * .0019
      * (worldAcross * worldAcross - uCenterX * uCenterX);
    float scallop = sin(across * .17 + wake * 6.4 + uSeed * 5.1 + uTime * .18);
    float crossCurrent = sin(across * .051 - wake * 9.2 - uTime * .11 + uSeed * 2.7);
    float trail = pow(wake, .82) * uTrail;

    vec3 transformed;
    transformed.x = across + crossCurrent * wake * (.035 + uEnergy * .07);
    transformed.y = uFaceHeight * .7
      + .055
      - wake * .018
      + scallop * (.012 + wake * .022);
    transformed.z = -(section + curvedSection + across * uPeel * .16);
    transformed.z -= trail;
    transformed.z += scallop * wake * (.08 + uTrail * .018);

    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    vUv = uv;
    vWake = wake;
    vSection = scallop * .5 + .5;
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const LINEUP_WHITEWATER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uEnergy;
  uniform float uBreak;
  uniform float uLight;
  uniform float uCloud;
  uniform float uSeed;

  varying vec2 vUv;
  varying float vWake;
  varying float vSection;
  varying vec3 vWorldPosition;

  float foamHash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
  }

  float foamNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 fraction = fract(point);
    fraction = fraction * fraction * (3.0 - 2.0 * fraction);
    float a = foamHash(cell);
    float b = foamHash(cell + vec2(1.0, 0.0));
    float c = foamHash(cell + vec2(0.0, 1.0));
    float d = foamHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
  }

  void main() {
    vec2 flow = vec2(
      vUv.x * 92.0 + uSeed * 4.2 + vWake * 3.7,
      vUv.y * 24.0 - uTime * (.32 + uEnergy * .18)
    );
    float broad = foamNoise(flow);
    float cells = foamNoise(flow * vec2(2.3, 1.7) + vec2(-uTime * .17, uTime * .11));
    float detail = foamNoise(flow * 4.4 + vec2(uTime * .41, -uTime * .27));
    float rollingEdge = exp(-vWake * (7.5 + uEnergy * 4.0));
    float lace = smoothstep(.42, .68, broad)
      * (1.0 - smoothstep(.76, .94, cells));
    float perforation = 1.0 - smoothstep(.64, .88, detail);
    float veins = smoothstep(.7, .94, detail) * smoothstep(.2, .78, cells);
    float foam = rollingEdge * (.72 + cells * .28);
    foam += lace * perforation * (.48 + vSection * .34) * (1.0 - vWake * .38);
    foam += veins * .32 * (1.0 - smoothstep(.42, 1.0, vWake));
    foam = clamp(foam, 0.0, 1.0);

    float sideFade = smoothstep(0.0, .055, vUv.x)
      * (1.0 - smoothstep(.945, 1.0, vUv.x));
    float tailFade = 1.0 - smoothstep(.68, 1.0, vWake);
    float breakPresence = smoothstep(.2, .76, uEnergy) * smoothstep(.3, .84, uBreak);
    float distanceFade = 1.0 - smoothstep(190.0, 430.0, length(cameraPosition - vWorldPosition));
    float alpha = foam * sideFade * tailFade * breakPresence * distanceFade;
    alpha *= uOpacity * (2.25 + uEnergy * 1.35);
    if (alpha < .006) discard;

    vec3 shadowFoam = mix(vec3(.42, .69, .7), vec3(.69, .89, .84), uLight);
    vec3 highlightFoam = mix(vec3(.67, .83, .83), vec3(.95, 1.0, .96), uLight);
    vec3 color = mix(shadowFoam, highlightFoam, .46 + detail * .4 + rollingEdge * .14);
    color *= 1.0 - uCloud * .1;
    gl_FragColor = vec4(color, min(alpha, .82));
  }
`;

const LINEUP_SPINDRIFT_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uFaceHeight;
  uniform float uSpan;
  uniform float uCurl;
  uniform float uEnergy;
  uniform float uSeed;
  uniform float uCenterX;
  uniform float uPeel;
  uniform float uVariability;
  uniform float uWaveAngle;
  uniform float uWind;
  uniform float uWindCross;
  uniform float uWindNormal;
  uniform float uPixelRatio;

  varying float vLife;
  varying float vBreakup;
  varying float vDepthFade;

  void main() {
    float windRate = .032 + min(uWind, 36.0) * .0022;
    float life = fract(position.y + uTime * windRate + uSeed * .173);
    float across = position.x * uSpan;
    float sectionPhase = (uCenterX + across) * .07 + uTime * .05;
    float centerPhase = uCenterX * .07 + uTime * .05;
    float section = (sin(sectionPhase) - sin(centerPhase)) * uVariability * 2.3;
    float worldAcross = uCenterX + across;
    float curvedSection = sin(uWaveAngle) * .0019
      * (worldAcross * worldAcross - uCenterX * uCenterX);
    float windTravel = life * life * uWind * .046;
    float flutter = sin(life * 17.0 + across * .19 + uTime * 1.3 + uSeed * 4.1);
    float lift = life * (.17 + uEnergy * .46 + uWind * .012);
    float settle = life * life * (.12 + (1.0 - min(uWind / 24.0, 1.0)) * .2);

    vec3 transformed;
    transformed.x = across
      + uWindCross * windTravel
      + flutter * (.025 + life * .055);
    transformed.y = uFaceHeight * (.88 + position.z * .035)
      + lift
      - settle;
    transformed.z = -(section + curvedSection + across * uPeel * .16);
    transformed.z -= uCurl * (.14 + uFaceHeight * .17);
    transformed.z += uWindNormal * windTravel + position.z * (.045 + life * .08);

    vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
    float perspective = clamp(48.0 / max(1.0, -viewPosition.z), .52, 2.7);
    float particleScale = 1.1 + uEnergy * 1.25 + (1.0 - life) * .8;
    gl_PointSize = clamp(particleScale * perspective * uPixelRatio, 1.0, 7.2);
    gl_Position = projectionMatrix * viewPosition;
    vLife = life;
    vBreakup = .55 + .45 * sin(across * .37 + position.z * 13.0 + uSeed * 7.0);
    vDepthFade = 1.0 - smoothstep(18.0, 420.0, -viewPosition.z);
  }
`;

const LINEUP_SPINDRIFT_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  uniform float uEnergy;
  uniform float uBreak;
  uniform float uLight;
  uniform float uCloud;

  varying float vLife;
  varying float vBreakup;
  varying float vDepthFade;

  void main() {
    vec2 centered = gl_PointCoord - .5;
    float droplet = 1.0 - smoothstep(.08, .5, length(centered));
    float birth = smoothstep(0.0, .09, vLife);
    float decay = 1.0 - smoothstep(.58, 1.0, vLife);
    float breaking = smoothstep(.22, .78, uEnergy) * smoothstep(.32, .88, uBreak);
    float breakup = smoothstep(.12, .86, vBreakup + uEnergy * .24);
    float alpha = droplet * birth * decay * breaking * breakup * vDepthFade;
    alpha *= uOpacity * (1.7 + uEnergy * 1.35);
    if (alpha < .006) discard;
    vec3 shade = mix(vec3(.56, .78, .79), vec3(.94, 1.0, .96), uLight);
    shade *= 1.0 - uCloud * .12;
    gl_FragColor = vec4(shade, min(alpha, .7));
  }
`;

function LineupWaveSetVolume({
  motion,
  settings,
  character,
  focusPosition,
  light,
  cloudCover,
}: {
  motion: MutableRefObject<MotionState>;
  settings: SessionSettings;
  character: BreakCharacter;
  focusPosition: MutableRefObject<THREE.Vector3>;
  light: number;
  cloudCover: number;
}) {
  const quality = useRenderQuality();
  const mobile = useMemo(() => isMobileRenderer(), []);
  const { gl } = useThree();
  const crestCount = mobile
    ? quality === "reduced" ? 2 : 3
    : quality === "high" ? 4 : 3;
  const crestOffsets = useMemo(
    () => crestCount === 2 ? [0, -1] : crestCount === 3 ? [-1, 0, 1] : [-2, -1, 0, 1],
    [crestCount],
  );
  const groups = useRef<Array<THREE.Group | null>>([]);
  const materials = useRef<Array<THREE.ShaderMaterial | null>>([]);
  const tideResponse = useMemo(
    () => tideResponseForBreak(settings.tide, character),
    [character, settings.tide],
  );
  const uniforms = useMemo(
    () => crestOffsets.map((_, index) => ({
      uTime: { value: 0 },
      uFaceHeight: { value: .5 },
      uSpan: { value: mobile ? 86 : 124 },
      uTrail: { value: 3.2 },
      uCurl: { value: .2 },
      uEnergy: { value: .2 },
      uSeed: { value: index * 1.713 + .47 },
      uCenterX: { value: 0 },
      uPeel: { value: character.peel },
      uVariability: { value: character.variability * tideResponse.variabilityScale },
      uWaveAngle: { value: ((settings.waveDirection - settings.coastHeading) * Math.PI) / 180 },
      uOpacity: { value: 0 },
      uLight: { value: light },
      uCloud: { value: cloudCover / 100 },
      uBreak: { value: 0 },
      uWind: { value: settings.windSpeed },
      uWindCross: { value: 0 },
      uWindNormal: { value: 0 },
      uPixelRatio: { value: 1 },
    })),
    [character.peel, character.variability, cloudCover, crestOffsets, light, mobile, settings.coastHeading, settings.waveDirection, settings.windSpeed, tideResponse.variabilityScale],
  );
  const sprayCount = mobile
    ? quality === "reduced" ? 24 : 42
    : quality === "high" ? 88 : 62;
  const sprayPositions = useMemo(() => {
    const positions = new Float32Array(sprayCount * 3);
    for (let index = 0; index < sprayCount; index += 1) {
      const offset = index * 3;
      positions[offset] = seededRandom(index, 19.4) - .5;
      positions[offset + 1] = seededRandom(index, 31.7);
      positions[offset + 2] = seededRandom(index, 47.2) * 2 - 1;
    }
    return positions;
  }, [sprayCount]);

  useFrame(({ clock }, delta) => {
    const elapsed = clock.elapsedTime;
    const focus = focusPosition.current;
    const tideShift = shorelineShiftForTide(settings.tide);
    const anchorX = focus.x;
    const anchorZ = Math.min(focus.z, tideShift - 3);
    const anchorPhase = primaryWavePhaseAt(anchorX, anchorZ, elapsed, settings, character);
    const nearestCrest = Math.round((anchorPhase - Math.PI * .5) / (Math.PI * 2));

    crestOffsets.forEach((offset, index) => {
      const group = groups.current[index];
      const material = materials.current[index];
      if (!group || !material) return;

      const targetPhase = Math.PI * .5 + (nearestCrest + offset) * Math.PI * 2;
      let sampleX = anchorX;
      let sampleZ = anchorZ;
      let transport = primaryWaveVelocityAt(sampleX, sampleZ, elapsed, settings, character);
      let phaseError = primaryWavePhaseAt(sampleX, sampleZ, elapsed, settings, character) - targetPhase;
      let waveNumber = (Math.PI * 2) / transport.wavelength;
      sampleX -= transport.x / transport.speed * phaseError / waveNumber;
      sampleZ -= transport.z / transport.speed * phaseError / waveNumber;

      for (let iteration = 0; iteration < 2; iteration += 1) {
        transport = primaryWaveVelocityAt(sampleX, sampleZ, elapsed, settings, character);
        phaseError = primaryWavePhaseAt(sampleX, sampleZ, elapsed, settings, character) - targetPhase;
        waveNumber = (Math.PI * 2) / transport.wavelength;
        sampleX -= transport.x / transport.speed * phaseError / waveNumber;
        sampleZ -= transport.z / transport.speed * phaseError / waveNumber;
      }

      transport = primaryWaveVelocityAt(sampleX, sampleZ, elapsed, settings, character);
      const normalX = transport.x / transport.speed;
      const normalZ = transport.z / transport.speed;
      const setState = waveSetStateAt(sampleX, sampleZ, elapsed, settings, character);
      const coastalZ = sampleZ - tideShift;
      const shoaling = THREE.MathUtils.smoothstep(coastalZ, -112, -8);
      const shoreFade = 1 - THREE.MathUtils.smoothstep(coastalZ, 4, 15);
      const distanceToFocus = Math.hypot(sampleX - focus.x, sampleZ - focus.z);
      const distanceFade = 1 - THREE.MathUtils.smoothstep(distanceToFocus, 275, 430);
      const riderSuppression = motion.current.phase === "riding"
        ? THREE.MathUtils.smoothstep(distanceToFocus, 17, 38)
        : 1;
      const energy = setState.energy;
      const windAngle = ((settings.windDirection - settings.coastHeading) * Math.PI) / 180;
      const faceHeight = THREE.MathUtils.clamp(
        settings.waveHeight
          * tideResponse.faceScale
          * character.power
          * (.12 + shoaling * .36)
          * (.5 + energy * .72),
        .12,
        2.75,
      );
      const targetOpacity = (.045 + energy * .19)
        * (.3 + shoaling * .7)
        * shoreFade
        * distanceFade
        * riderSuppression;
      const surfaceY = waveHeightAt(sampleX, sampleZ, elapsed, settings, character);

      group.visible = targetOpacity > .004;
      group.position.set(sampleX, surfaceY - faceHeight * .7, sampleZ);
      group.rotation.y = Math.atan2(normalX, normalZ);

      const values = material.uniforms;
      values.uTime.value = elapsed;
      values.uFaceHeight.value = THREE.MathUtils.damp(values.uFaceHeight.value, faceHeight, 8, delta);
      values.uSpan.value = THREE.MathUtils.damp(
        values.uSpan.value,
        (mobile ? 86 : 124) * (1 + character.variability * .12),
        5,
        delta,
      );
      values.uTrail.value = THREE.MathUtils.damp(
        values.uTrail.value,
        THREE.MathUtils.clamp(
          (1.45 + settings.waveHeight * 1.65)
            * (.28 + shoaling * .72)
            * (.36 + energy * .86),
          1.15,
          13.5,
        ),
        5.5,
        delta,
      );
      values.uCurl.value = THREE.MathUtils.damp(
        values.uCurl.value,
        (.12 + shoaling * (.32 + character.hollow * .42)) * (.55 + energy * .45),
        6,
        delta,
      );
      values.uEnergy.value = THREE.MathUtils.damp(values.uEnergy.value, energy, 6, delta);
      values.uCenterX.value = sampleX;
      values.uPeel.value = character.peel;
      values.uVariability.value = character.variability * tideResponse.variabilityScale;
      values.uWaveAngle.value = ((settings.waveDirection - settings.coastHeading) * Math.PI) / 180;
      values.uOpacity.value = THREE.MathUtils.damp(values.uOpacity.value, targetOpacity, 7, delta);
      values.uLight.value = light;
      values.uCloud.value = cloudCover / 100;
      values.uBreak.value = THREE.MathUtils.damp(values.uBreak.value, shoaling, 6, delta);
      values.uWind.value = THREE.MathUtils.damp(values.uWind.value, settings.windSpeed, 5, delta);
      values.uWindCross.value = Math.sin(windAngle);
      values.uWindNormal.value = Math.cos(windAngle);
      values.uPixelRatio.value = Math.min(gl.getPixelRatio(), mobile ? 1.3 : 1.7);
    });
  });

  const horizontalSegments = mobile ? quality === "reduced" ? 24 : 34 : quality === "high" ? 58 : 44;
  const verticalSegments = mobile ? 7 : 10;
  const foamTrailSegments = mobile ? quality === "reduced" ? 3 : 5 : quality === "high" ? 10 : 7;

  return (
    <group>
      {crestOffsets.map((_, index) => (
        <group
          key={`${crestCount}-${index}`}
          ref={(node) => {
            groups.current[index] = node;
          }}
        >
          <mesh frustumCulled={false} renderOrder={2}>
            <planeGeometry args={[1, 1, horizontalSegments, verticalSegments]} />
            <shaderMaterial
              ref={(node) => {
                materials.current[index] = node;
              }}
              uniforms={uniforms[index]}
              vertexShader={LINEUP_CREST_VERTEX}
              fragmentShader={LINEUP_CREST_FRAGMENT}
              transparent
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh frustumCulled={false} renderOrder={2.1}>
            <planeGeometry args={[1, 1, horizontalSegments, foamTrailSegments]} />
            <shaderMaterial
              uniforms={uniforms[index]}
              vertexShader={LINEUP_WHITEWATER_VERTEX}
              fragmentShader={LINEUP_WHITEWATER_FRAGMENT}
              transparent
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <points frustumCulled={false} renderOrder={2.2}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[sprayPositions, 3]} />
            </bufferGeometry>
            <shaderMaterial
              uniforms={uniforms[index]}
              vertexShader={LINEUP_SPINDRIFT_VERTEX}
              fragmentShader={LINEUP_SPINDRIFT_FRAGMENT}
              transparent
              depthWrite={false}
            />
          </points>
        </group>
      ))}
    </group>
  );
}

function seabedKind(character: BreakCharacter) {
  if (character.kind === "canyon") return 3;
  if (character.kind === "slab") return 2;
  if (character.kind === "reef" || character.kind === "point") return 1;
  return 0;
}

function seabedDepthAt(x: number, coastalZ: number, kind: number) {
  const offshore = Math.max(0, SHORELINE_REFERENCE_Z - coastalZ);
  const baseDepth = .55
    + Math.min(6.2, offshore * .066)
    + Math.min(25, Math.max(0, -coastalZ - 74) * .033);
  const shallowMask = THREE.MathUtils.smoothstep(coastalZ, -115, 4);
  const sandbar = Math.sin(coastalZ * .46 + Math.sin(x * .12) * 1.8) * .14 * shallowMask;
  const reefMask = kind >= 1 && kind < 3 ? 1 : 0;
  const reefRelief = reefMask
    * Math.sin(x * .19 + coastalZ * .07)
    * Math.cos(x * .083 - coastalZ * .11)
    * .32
    * shallowMask;
  const slabShelf = kind === 2
    ? THREE.MathUtils.smoothstep(coastalZ, -68, -24) * 1.05
    : 0;
  const canyonCut = kind === 3
    ? Math.exp(-(x * x) / 230) * THREE.MathUtils.smoothstep(coastalZ, -150, -28) * 6.4
    : 0;
  return Math.max(.38, baseDepth - sandbar - reefRelief - slabShelf + canyonCut);
}

const SEABED_VERTEX = /* glsl */ `
  uniform float uKind;
  varying vec2 vSurface;
  varying float vDepth;
  varying float vRelief;
  varying vec3 vWorldPosition;

  void main() {
    vec2 origin = position.xy;
    vec2 surface = vec2(origin.x, -origin.y + ${OCEAN_CENTER_Z.toFixed(1)});
    float offshore = max(0.0, ${SHORELINE_REFERENCE_Z.toFixed(1)} - surface.y);
    float baseDepth = .55
      + min(6.2, offshore * .066)
      + min(25.0, max(0.0, -surface.y - 74.0) * .033);
    float shallowMask = smoothstep(-115.0, 4.0, surface.y);
    float sandbar = sin(surface.y * .46 + sin(surface.x * .12) * 1.8) * .14 * shallowMask;
    float reefMask = step(.5, uKind) * (1.0 - step(2.5, uKind));
    float reefRelief = reefMask
      * sin(surface.x * .19 + surface.y * .07)
      * cos(surface.x * .083 - surface.y * .11)
      * .32
      * shallowMask;
    float slabShelf = step(1.5, uKind) * (1.0 - step(2.5, uKind))
      * smoothstep(-68.0, -24.0, surface.y)
      * 1.05;
    float canyonCut = step(2.5, uKind)
      * exp(-(surface.x * surface.x) / 230.0)
      * smoothstep(-150.0, -28.0, surface.y)
      * 6.4;
    float depth = max(.38, baseDepth - sandbar - reefRelief - slabShelf + canyonCut);
    vec3 p = position;
    p.z = -depth;
    vSurface = surface;
    vDepth = depth;
    vRelief = reefRelief + slabShelf - canyonCut * .12;
    vWorldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const SEABED_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uLight;
  uniform float uCloud;
  uniform float uOpacity;
  uniform float uKind;
  uniform float uWaveDirection;
  uniform float uCurrentDirection;
  uniform float uCoastHeading;
  uniform float uCurrent;
  uniform vec3 uSandColor;
  uniform vec3 uFogColor;
  varying vec2 vSurface;
  varying float vDepth;
  varying float vRelief;
  varying vec3 vWorldPosition;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    if (normal.y < 0.0) normal *= -1.0;
    float waveAngle = radians(uWaveDirection - uCoastHeading);
    float currentAngle = radians(uCurrentDirection - uCoastHeading);
    vec2 waveDir = vec2(sin(waveAngle), cos(waveAngle));
    vec2 currentDir = vec2(sin(currentAngle), cos(currentAngle));
    vec2 tangent = vec2(-waveDir.y, waveDir.x);
    vec2 flowUv = vec2(dot(vSurface, tangent), dot(vSurface, waveDir));
    flowUv += currentDir * uTime * (.08 + uCurrent * .035);

    float cellA = 1.0 - abs(sin(flowUv.x * .72 + sin(flowUv.y * .31 - uTime * .72) * 1.35));
    float cellB = 1.0 - abs(sin(flowUv.y * .57 - cos(flowUv.x * .26 + uTime * .51) * 1.2));
    float caustic = pow(max(0.0, cellA * cellB), 4.2);
    caustic *= exp(-vDepth * .115) * (1.0 - uCloud * .68) * (.28 + uLight * .72);

    float grains = noise(vSurface * 3.7);
    float coarse = noise(vSurface * .46 + vec2(17.0, -9.0));
    float ripple = sin(dot(vSurface, normalize(waveDir + currentDir * .22)) * 3.2 + coarse * 1.8);
    float reefMask = step(.5, uKind);
    vec3 sand = mix(uSandColor * .34, uSandColor * .68 + vec3(.025, .045, .025), grains);
    vec3 reef = mix(vec3(.055, .105, .095), vec3(.18, .225, .17), coarse);
    vec3 color = mix(sand, reef, reefMask * (.42 + smoothstep(-.2, .45, vRelief) * .32));
    color *= .78 + ripple * .045 * (1.0 - reefMask * .65);
    color += vec3(.21, .64, .49) * caustic * (.45 + uLight * .8);

    float topLight = .32 + max(0.0, normal.y) * (.35 + uLight * .34);
    color *= topLight;
    float cameraDistance = length(cameraPosition - vWorldPosition);
    float waterHaze = 1.0 - exp(-cameraDistance * (.055 + vDepth * .0025));
    color = mix(color, uFogColor, clamp(waterHaze, 0.0, .94));
    gl_FragColor = vec4(color, uOpacity);
  }
`;

function UnderwaterWorld({
  motion,
  settings,
  character,
  sandColor,
  light,
  cloudCover,
  mobile,
}: {
  motion: MutableRefObject<MotionState>;
  settings: SessionSettings;
  character: BreakCharacter;
  sandColor: string;
  light: number;
  cloudCover: number;
  mobile: boolean;
}) {
  const quality = useRenderQuality();
  const floor = useRef<THREE.Mesh>(null);
  const floorMaterial = useRef<THREE.ShaderMaterial>(null);
  const rocks = useRef<THREE.InstancedMesh>(null);
  const rockMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const opacity = useRef(0);
  const kind = seabedKind(character);
  const crossSegments = mobile
    ? quality === "reduced" ? 48 : quality === "high" ? 80 : 64
    : quality === "reduced" ? 96 : quality === "balanced" ? 128 : 160;
  const offshoreSegments = mobile
    ? quality === "reduced" ? 72 : quality === "high" ? 116 : 92
    : quality === "reduced" ? 112 : quality === "balanced" ? 148 : 184;
  const rockCount = mobile
    ? quality === "reduced" ? 60 : quality === "high" ? 120 : 88
    : quality === "reduced" ? 120 : quality === "balanced" ? 180 : 240;
  const bedColor = useMemo(
    () => new THREE.Color(sandColor).lerp(new THREE.Color(kind >= 1 ? "#315750" : "#6a6952"), kind >= 1 ? .58 : .38),
    [kind, sandColor],
  );
  const fogColor = useMemo(
    () => new THREE.Color("#074c59").lerp(new THREE.Color("#168074"), light * .28),
    [light],
  );
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uLight: { value: light },
    uCloud: { value: cloudCover / 100 },
    uOpacity: { value: 0 },
    uKind: { value: kind },
    uWaveDirection: { value: settings.waveDirection },
    uCurrentDirection: { value: settings.currentDirection },
    uCoastHeading: { value: settings.coastHeading },
    uCurrent: { value: settings.currentStrength },
    uSandColor: { value: bedColor.clone() },
    uFogColor: { value: fogColor.clone() },
  }), [bedColor, cloudCover, fogColor, kind, light, settings.coastHeading, settings.currentDirection, settings.currentStrength, settings.waveDirection]);
  const rockMatrices = useMemo(() => {
    const dummy = new THREE.Object3D();
    const matrices: THREE.Matrix4[] = [];
    for (let index = 0; index < rockCount; index += 1) {
      const x = (seededRandom(index, 1111) - .5) * (COAST_GEOMETRY_WIDTH - 36);
      const z = -7 - seededRandom(index, 1112) * 116;
      const reefScale = kind >= 1 ? 1.45 : .72;
      const width = (.16 + seededRandom(index, 1113) * .52) * reefScale;
      const height = (.11 + seededRandom(index, 1114) * .42) * reefScale;
      const length = (.18 + seededRandom(index, 1115) * .62) * reefScale;
      dummy.position.set(x, -seabedDepthAt(x, z, kind) + height * .36, z);
      dummy.rotation.set(
        seededRandom(index, 1116) * .42,
        seededRandom(index, 1117) * Math.PI,
        (seededRandom(index, 1118) - .5) * .38,
      );
      dummy.scale.set(width, height, length);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    return matrices;
  }, [kind, rockCount]);

  useEffect(() => {
    if (!rocks.current) return;
    rockMatrices.forEach((matrix, index) => rocks.current?.setMatrixAt(index, matrix));
    rocks.current.instanceMatrix.needsUpdate = true;
    rocks.current.computeBoundingSphere();
  }, [rockMatrices]);

  useFrame(({ clock }, delta) => {
    const target = THREE.MathUtils.smoothstep(motion.current.submersion, .015, .24);
    opacity.current = THREE.MathUtils.damp(opacity.current, target, target > opacity.current ? 12 : 6, delta);
    const visible = opacity.current > .004 || target > .004;
    if (floor.current) floor.current.visible = visible;
    if (rocks.current) rocks.current.visible = visible;
    if (floorMaterial.current) {
      const values = floorMaterial.current.uniforms;
      values.uTime.value = clock.elapsedTime;
      values.uLight.value = light;
      values.uCloud.value = cloudCover / 100;
      values.uOpacity.value = opacity.current;
      values.uKind.value = kind;
      values.uWaveDirection.value = settings.waveDirection;
      values.uCurrentDirection.value = settings.currentDirection;
      values.uCoastHeading.value = settings.coastHeading;
      values.uCurrent.value = settings.currentStrength;
      values.uSandColor.value.copy(bedColor);
      values.uFogColor.value.copy(fogColor);
    }
    if (rockMaterial.current) {
      rockMaterial.current.opacity = opacity.current * .96;
      rockMaterial.current.emissiveIntensity = causticRockGlow(clock.elapsedTime, light, cloudCover);
    }
  });

  return (
    <>
      <mesh
        ref={floor}
        visible={false}
        position={[0, 0, OCEAN_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[COAST_GEOMETRY_WIDTH, OCEAN_PLANE_DEPTH, crossSegments, offshoreSegments]} />
        <shaderMaterial
          ref={floorMaterial}
          uniforms={uniforms}
          vertexShader={SEABED_VERTEX}
          fragmentShader={SEABED_FRAGMENT}
          transparent
          depthWrite
          side={THREE.DoubleSide}
        />
      </mesh>
      <instancedMesh ref={rocks} args={[undefined, undefined, rockCount]} visible={false} receiveShadow>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial
          ref={rockMaterial}
          color={bedColor}
          emissive="#1b675c"
          emissiveIntensity={0}
          roughness={.94}
          metalness={0}
          transparent
          opacity={0}
        />
      </instancedMesh>
    </>
  );
}

function causticRockGlow(elapsed: number, light: number, cloudCover: number) {
  const pulse = .5 + Math.sin(elapsed * 1.08) * .22 + Math.sin(elapsed * 1.71 + 1.4) * .14;
  return Math.max(0, pulse) * light * (1 - cloudCover / 135) * .12;
}

const UNDERWATER_SHAFT_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const UNDERWATER_SHAFT_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSeed;
  varying vec2 vUv;

  void main() {
    float edge = 1.0 - smoothstep(.08, .5, abs(vUv.x - .5));
    float vertical = smoothstep(.0, .16, vUv.y) * (1.0 - smoothstep(.76, 1.0, vUv.y));
    float drift = sin(vUv.y * 13.0 - uTime * .72 + uSeed * 9.0) * .5 + .5;
    float breakup = smoothstep(.16, .92, drift) * .34 + .66;
    vec3 color = mix(vec3(.05, .43, .39), vec3(.35, .91, .72), vUv.y);
    gl_FragColor = vec4(color, edge * vertical * breakup * uOpacity);
  }
`;

function UnderwaterLightShafts({
  motion,
  light,
  cloudCover,
  mobile,
}: {
  motion: MutableRefObject<MotionState>;
  light: number;
  cloudCover: number;
  mobile: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const quality = useRenderQuality();
  const rayCount = mobile
    ? quality === "reduced" ? 2 : 3
    : quality === "reduced" ? 3 : quality === "balanced" ? 4 : 5;
  const rays = useMemo(() => Array.from({ length: rayCount }, (_, index) => {
    const height = 5.2 + seededRandom(index, 1211) * 3.4;
    const x = (seededRandom(index, 1212) - .5) * 11;
    const z = (seededRandom(index, 1213) - .5) * 9;
    const width = .72 + seededRandom(index, 1214) * 1.3;
    const heading = seededRandom(index, 1215) * Math.PI;
    return { height, x, z, width, heading, seed: seededRandom(index, 1216) };
  }), [rayCount]);
  const uniforms = useMemo(
    () => rays.flatMap((ray) => [0, 1].map(() => ({
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uSeed: { value: ray.seed },
    }))),
    [rays],
  );

  useFrame(({ clock }, delta) => {
    const depth = THREE.MathUtils.smoothstep(motion.current.submersion, .06, .72);
    const target = depth * (.055 + light * .12) * (1 - cloudCover / 155);
    let visible = target > .002;
    uniforms.forEach((values) => {
      values.uTime.value = clock.elapsedTime;
      values.uOpacity.value = THREE.MathUtils.damp(values.uOpacity.value, target, target > values.uOpacity.value ? 9 : 4.5, delta);
      visible ||= values.uOpacity.value > .002;
    });
    if (group.current) group.current.visible = visible;
  });

  return (
    <group ref={group} visible={false} renderOrder={4.6}>
      {rays.flatMap((ray, index) => [0, 1].map((cross) => (
        <mesh
          key={`${index}-${cross}`}
          position={[ray.x, -ray.height * .5 + .3, ray.z]}
          rotation={[0, ray.heading + cross * Math.PI / 2, (seededRandom(index, 1217 + cross) - .5) * .16]}
          renderOrder={4.6}
        >
          <planeGeometry args={[ray.width, ray.height]} />
          <shaderMaterial
            uniforms={uniforms[index * 2 + cross]}
            vertexShader={UNDERWATER_SHAFT_VERTEX}
            fragmentShader={UNDERWATER_SHAFT_FRAGMENT}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )))}
    </group>
  );
}

const SHORELINE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vSurface;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vSurface = position.xy;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHORELINE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uTide;
  uniform float uWind;
  uniform float uLight;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  varying vec2 vUv;
  varying vec2 vSurface;
  varying vec3 vWorldPosition;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    float land = 1.0 - vUv.y;
    float along = vSurface.x;
    float wind = clamp(uWind / 24.0, 0.0, 1.4);
    float slowSet = sin(uTime * .31) * .5 + .5;
    float edgeNoise = noise(vec2(along * .055 + uTime * .024, uTime * .055));
    float runup = .36 + slowSet * .13 + sin(along * .038 + uTime * .16) * .035;
    runup += (edgeNoise - .5) * .075 + uTide * .025;

    float wet = 1.0 - smoothstep(runup - .02, runup + .27, land);
    float glass = 1.0 - smoothstep(.015, .24, abs(land - runup + .11));
    float edgeDistance = abs(land - runup + (noise(vec2(along * .19, land * 9.0 - uTime * .17)) - .5) * .028);
    float lace = 1.0 - smoothstep(.009, .038, edgeDistance);
    float bubbles = noise(vec2(along * .78 - uTime * .46, land * 45.0 + uTime * .24));
    float foam = lace * smoothstep(.27, .72, bubbles);

    float secondaryRunup = .19 + (1.0 - slowSet) * .09 + sin(along * .052 - uTime * .12) * .024 + uTide * .018;
    float secondaryDistance = abs(land - secondaryRunup + (edgeNoise - .5) * .045);
    float secondaryLace = 1.0 - smoothstep(.01, .046, secondaryDistance);
    foam += secondaryLace * smoothstep(.38, .82, 1.0 - bubbles) * .32;

    float backwashPhase = fract((land - runup) * 10.5 + uTime * .13);
    float backwash = (1.0 - smoothstep(.0, .09, abs(backwashPhase - .5))) * wet;
    backwash *= smoothstep(.61, .89, noise(vec2(along * .32, land * 23.0 + uTime * .08))) * .24;
    float rivulet = smoothstep(.72, .93, bubbles) * (1.0 - smoothstep(runup - .22, runup + .04, land));
    rivulet *= smoothstep(.03, .22, wet) * .16;

    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float grazing = pow(1.0 - abs(viewDirection.y), 3.0);
    vec3 wetColor = mix(vec3(.018, .105, .12), vec3(.075, .29, .27), uLight);
    wetColor += vec3(.18, .31, .3) * glass * grazing * (.24 + uLight * .28);
    vec3 reflectedSun = reflect(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0));
    float sunPath = pow(max(0.0, dot(reflectedSun, viewDirection)), 34.0);
    sunPath *= smoothstep(.18, .78, noise(vec2(along * .34 - uTime * .07, land * 13.0)));
    wetColor += uSunColor * sunPath * glass * (.15 + uLight * .82);
    vec3 foamColor = mix(vec3(.57, .79, .76), vec3(.94, 1.0, .96), uLight);
    float foamMask = clamp(foam + backwash + rivulet, 0.0, .95);
    vec3 color = mix(wetColor, foamColor, foamMask);
    color *= .9 + noise(vec2(along * 1.9, land * 28.0 - uTime * (.08 + wind * .06))) * .1;

    float sideFade = smoothstep(0.0, .025, vUv.x) * smoothstep(0.0, .025, 1.0 - vUv.x);
    float alpha = (wet * (.15 + glass * .13) + foamMask * .78) * sideFade;
    alpha *= smoothstep(.0, .045, land) * (1.0 - smoothstep(.9, 1.0, land));
    gl_FragColor = vec4(color, clamp(alpha, 0.0, .92));
  }
`;

function ShorelineWash({
  settings,
  light,
  sunPosition,
  sunColor,
}: {
  settings: SessionSettings;
  light: number;
  sunPosition: [number, number, number];
  sunColor: string;
}) {
  const wash = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uTide: { value: 0 },
    uWind: { value: 0 },
    uLight: { value: 1 },
    uSunDirection: { value: new THREE.Vector3(-.3, .8, -.45).normalize() },
    uSunColor: { value: new THREE.Color("#fff0ca") },
  }), []);

  const tideShift = shorelineShiftForTide(settings.tide);

  useFrame(({ clock }, delta) => {
    if (!material.current) return;
    if (wash.current) wash.current.position.z = THREE.MathUtils.damp(wash.current.position.z, 20 + tideShift, 2.8, delta);
    const values = material.current.uniforms;
    values.uTime.value = clock.elapsedTime;
    values.uTide.value = THREE.MathUtils.lerp(values.uTide.value, settings.tide, .025);
    values.uWind.value = settings.windSpeed;
    values.uLight.value = light;
    values.uSunDirection.value.set(...sunPosition).normalize();
    values.uSunColor.value.set(sunColor);
  });

  return (
    <mesh ref={wash} position={[0, -0.405, 20 + tideShift]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <planeGeometry args={[COAST_GEOMETRY_WIDTH, 32]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={SHORELINE_VERTEX}
        fragmentShader={SHORELINE_FRAGMENT}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function CoastalEnvironment({
  light,
  cloudFactor,
  sunHeight,
  sunPosition,
  sunColor,
  hazeColor,
  mobile,
}: {
  light: number;
  cloudFactor: number;
  sunHeight: number;
  sunPosition: [number, number, number];
  sunColor: string;
  hazeColor: string;
  mobile: boolean;
}) {
  const quality = useRenderQuality();
  const resolution = mobile ? 32 : quality === "high" ? 128 : quality === "balanced" ? 96 : 64;
  const [sunX, sunY, sunZ] = sunPosition;
  const rig = useMemo(() => {
    const daylight = THREE.MathUtils.smoothstep(sunHeight, -.05, .18);
    const sky = new THREE.Color(hazeColor)
      .lerp(new THREE.Color("#b8e6ea"), light * .54)
      .lerp(new THREE.Color("#65737b"), cloudFactor * .36);
    const horizon = new THREE.Color(sunColor)
      .lerp(new THREE.Color("#6ca8ad"), .48 + cloudFactor * .32)
      .multiplyScalar(.56 + light * .44);
    const oceanBounce = new THREE.Color("#176f78")
      .lerp(new THREE.Color("#6bc4bd"), light * .46)
      .lerp(new THREE.Color("#253e44"), cloudFactor * .4);
    const landBounce = new THREE.Color("#9b7250")
      .lerp(new THREE.Color("#d9b884"), light * .38)
      .multiplyScalar(.42 + daylight * .4);
    const sunDirection = new THREE.Vector3(sunX, sunY, sunZ).normalize().multiplyScalar(58);
    const moonDirection = sunDirection.clone().multiplyScalar(-1).add(new THREE.Vector3(4, 4, -2));
    const sunEnergy = daylight * (1 - cloudFactor * .68) * (2.2 + light * 5.4);
    const moonEnergy = (1 - daylight) * (1 - cloudFactor * .42) * 1.7;

    return (
      <>
        <color attach="background" args={[sky]} />
        <Lightformer form="rect" color={sky} intensity={1.05 + light * .95} position={[0, 34, 0]} scale={[95, 48]} target={[0, 0, 0]} />
        <Lightformer form="rect" color={horizon} intensity={.78 + light * 1.18} position={[0, 5, -54]} scale={[120, 16]} target={[0, 0, 0]} />
        <Lightformer form="rect" color={oceanBounce} intensity={.62 + light * .82} position={[0, -18, -24]} scale={[110, 38]} target={[0, 0, 0]} />
        <Lightformer form="rect" color={landBounce} intensity={.34 + daylight * .64} position={[0, -17, 38]} scale={[90, 34]} target={[0, 0, 0]} />
        {sunEnergy > .02 && <Lightformer form="circle" color={sunColor} intensity={sunEnergy} position={sunDirection.toArray()} scale={8 + light * 5} target={[0, 0, 0]} />}
        {moonEnergy > .02 && <Lightformer form="circle" color="#bfe8ff" intensity={moonEnergy} position={moonDirection.toArray()} scale={7} target={[0, 0, 0]} />}
      </>
    );
  }, [cloudFactor, hazeColor, light, sunColor, sunHeight, sunX, sunY, sunZ]);

  return (
    <Environment
      background={false}
      frames={1}
      resolution={resolution}
      environmentIntensity={mobile ? .68 : quality === "high" ? .9 : .78}
    >
      {rig}
    </Environment>
  );
}

const BREAKING_WAVE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uEnergy;
  uniform float uCurl;
  uniform float uSide;
  uniform float uLine;
  uniform float uSection;
  varying vec2 vUv;
  varying float vPocket;
  varying float vFoam;
  varying float vSection;
  varying float vEdge;
  varying vec3 vWorldPosition;

  void main() {
    float heightRatio = uv.y;
    float faceHeight = clamp(uWaveHeight * 1.55, 1.45, 5.8) * (.82 + uEnergy * .3);
    float pocketCenter = clamp(-uLine * 4.6 * uSide, -7.2, 7.2);
    float pocketDistance = (position.x - pocketCenter) / 5.0;
    float pocket = exp(-pocketDistance * pocketDistance);
    float lip = smoothstep(.34, 1.0, heightRatio);
    float sectionPulse = .5 + .5 * sin((position.x - pocketCenter) * .42 * uSide - uTime * .72);
    float section = uSection * smoothstep(.42, .94, sectionPulse) * (.48 + pocket * .52);
    float curl = uCurl * (.28 + pocket * .72);
    float edge = smoothstep(0.0, .09, uv.x) * smoothstep(0.0, .09, 1.0 - uv.x);
    vec3 p = position;
    float concave = pow(heightRatio, 1.42);
    p.x += uSide * (curl * lip * .58 + section * lip * .18);
    p.y = concave * faceHeight;
    p.y += sin(heightRatio * 3.14159) * pocket * faceHeight * .055;
    p.y += section * lip * faceHeight * .1;
    p.y += sin(position.x * .42 + uTime * 2.1) * .055 * (.35 + uEnergy);
    p.z = 2.82 - concave * (.62 + faceHeight * .035);
    p.z -= curl * lip * lip * (1.45 + faceHeight * .38);
    p.z -= section * lip * lip * (.3 + faceHeight * .14);
    p.z += sin(position.x * .24 + uTime * 1.35) * .12 * (1.0 - heightRatio);

    vUv = uv;
    vPocket = pocket;
    vFoam = smoothstep(.66, 1.0, heightRatio) * (.44 + curl * .46 + section * .42);
    vSection = section;
    vEdge = edge;
    vWorldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const BREAKING_WAVE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uLight;
  uniform float uCloud;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vPocket;
  varying float vFoam;
  varying float vSection;
  varying float vEdge;
  varying vec3 vWorldPosition;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    if (dot(normal, viewDirection) < 0.0) normal *= -1.0;
    float fresnel = .035 + .965 * pow(1.0 - clamp(dot(normal, viewDirection), 0.0, 1.0), 4.0);
    float faceNoise = noise(vUv * vec2(18.0, 8.0) + vec2(uTime * .24, -uTime * .42));
    float veinNoise = noise(vUv * vec2(42.0, 13.0) + vec2(-uTime * .65, uTime * .18));
    float verticalDepth = smoothstep(.05, .96, vUv.y);
    vec3 deep = mix(vec3(.004, .075, .105), vec3(.025, .23, .235), verticalDepth);
    vec3 transmitted = vec3(.04, .48, .39) * (vPocket * verticalDepth) * (.16 + uLight * .28);
    vec3 reflection = mix(vec3(.09, .28, .34), vec3(.35, .63, .65), uLight);
    reflection = mix(reflection, vec3(.08, .11, .15), uCloud * .48);
    vec3 color = deep + transmitted;
    color = mix(color, reflection, fresnel * .56);
    color *= .9 + faceNoise * .13;
    color = mix(color, vec3(.006, .07, .09), vSection * (.12 + verticalDepth * .16));

    float lipFoam = vFoam * smoothstep(.16, .72, faceNoise) * (.66 + veinNoise * .5 + vSection * .35);
    float streaks = smoothstep(.7, .96, veinNoise) * smoothstep(.42, .95, vUv.y) * (.18 + vPocket * .36);
    float foam = clamp(max(lipFoam, streaks), 0.0, .96);
    vec3 foamColor = mix(vec3(.62, .88, .84), vec3(.94, 1.0, .98), uLight);
    color = mix(color, foamColor, foam);

    float lowerFade = smoothstep(.0, .1, vUv.y);
    float alpha = uOpacity * vEdge * lowerFade * (.32 + fresnel * .38 + vPocket * .14 + vSection * .08);
    alpha = max(alpha, foam * uOpacity * .96);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, .96));
  }
`;

const WAVE_CURTAIN_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uEnergy;
  uniform float uCurl;
  uniform float uSide;
  uniform float uLine;
  uniform float uSection;
  varying vec2 vUv;
  varying float vPocket;
  varying float vEdge;
  varying float vDrop;
  varying float vSection;
  varying vec3 vWorldPosition;

  void main() {
    float drop = uv.y;
    float faceHeight = clamp(uWaveHeight * 1.55, 1.45, 5.8) * (.82 + uEnergy * .3);
    float pocketCenter = clamp(-uLine * 4.6 * uSide, -7.2, 7.2);
    float pocketDistance = (position.x - pocketCenter) / 4.9;
    float pocket = exp(-pocketDistance * pocketDistance);
    float sectionPulse = .5 + .5 * sin((position.x - pocketCenter) * .42 * uSide - uTime * .72);
    float section = uSection * smoothstep(.42, .94, sectionPulse) * (.48 + pocket * .52);
    float curl = uCurl * (.24 + pocket * .76);
    float crestHeight = faceHeight * (1.0 + section * .1);
    float lipZ = 2.2 - curl * (1.45 + faceHeight * .38) - section * (.3 + faceHeight * .14);
    float flutter = sin(position.x * 1.7 - uTime * 4.2 + drop * 9.0) * .055;
    flutter += sin(position.x * .38 + uTime * 2.1) * .08;
    vec3 p = vec3(position.x + uSide * (curl * .58 + section * .18), crestHeight, lipZ);
    p.x += flutter * (.35 + drop * .65);
    p.y -= drop * faceHeight * (.7 + curl * .18);
    p.z += drop * (.12 + curl * .52) + sin(drop * 12.0 + uTime * 2.8) * .045 * curl;

    vUv = uv;
    vPocket = pocket;
    vDrop = drop;
    vSection = section;
    vEdge = smoothstep(0.0, .08, uv.x) * smoothstep(0.0, .08, 1.0 - uv.x);
    vWorldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const WAVE_CURTAIN_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uLight;
  uniform float uCloud;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vPocket;
  varying float vEdge;
  varying float vDrop;
  varying float vSection;
  varying vec3 vWorldPosition;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    if (dot(normal, viewDirection) < 0.0) normal *= -1.0;
    float fresnel = pow(1.0 - clamp(dot(normal, viewDirection), 0.0, 1.0), 3.0);
    float longVeins = noise(vec2(vUv.x * 58.0 - uTime * 1.4, vUv.y * 4.0 + uTime * .72));
    float broadSheet = noise(vec2(vUv.x * 13.0 + uTime * .28, vUv.y * 7.0 - uTime * 1.2));
    float threads = smoothstep(.56, .94, longVeins) * (.42 + broadSheet * .58);
    float beading = smoothstep(.72, .96, noise(vec2(vUv.x * 91.0, vUv.y * 24.0 + uTime * 2.6)));
    float verticalFade = smoothstep(.0, .055, vDrop) * (1.0 - smoothstep(.78, 1.0, vDrop));
    float body = .07 + threads * .34 + broadSheet * .09 + beading * .18 + vSection * .08;
    float alpha = uOpacity * vPocket * vEdge * verticalFade * body;
    vec3 deep = mix(vec3(.015, .22, .24), vec3(.025, .4, .35), uLight);
    deep = mix(deep, vec3(.055, .105, .13), uCloud * .38);
    vec3 highlight = mix(vec3(.45, .86, .8), vec3(.91, 1.0, .97), clamp(threads + fresnel, 0.0, 1.0));
    vec3 color = mix(deep, highlight, .24 + fresnel * .36 + beading * .2 + vSection * .12);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, .7));
  }
`;

const BREAKING_FOAM_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uEnergy;
  uniform float uCurl;
  uniform float uSide;
  uniform float uLine;
  uniform float uSection;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    float seed = position.y;
    float faceHeight = clamp(uWaveHeight * 1.55, 1.45, 5.8) * (.82 + uEnergy * .3);
    float pocketCenter = clamp(-uLine * 4.6 * uSide, -7.2, 7.2);
    float pocketDistance = (position.x - pocketCenter) / 5.0;
    float pocket = exp(-pocketDistance * pocketDistance);
    float sectionPulse = .5 + .5 * sin((position.x - pocketCenter) * .42 * uSide - uTime * .72);
    float section = uSection * smoothstep(.42, .94, sectionPulse) * (.48 + pocket * .52);
    float curl = uCurl * (.28 + pocket * .72);
    float age = fract(seed + uTime * (.12 + uEnergy * .1));
    float faller = step(.56, fract(seed * 17.31 + .19));
    vec3 p = vec3(position.x, faceHeight * (1.0 + section * .1), 2.2 - curl * (1.45 + faceHeight * .38) - section * (.3 + faceHeight * .14));
    p.x += uSide * (curl * .58 + section * .18) + sin(seed * 41.0 + uTime * 2.7) * age * (.48 + faller * .32);
    p.y += sin(position.x * .42 + uTime * 2.1) * .055 * (.35 + uEnergy);
    p.y += mix(age * (.28 + uEnergy * .8), -age * (.4 + curl * 1.7), faller * curl);
    p.z += mix(-age * (.18 + curl * .32), age * (.12 + curl * .72), faller);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vAlpha = pow(1.0 - age, 1.7) * uOpacity * (.38 + pocket * .52 + section * .24);
    gl_PointSize = (2.8 + seed * 5.4) * clamp(68.0 / -viewPosition.z, 1.0, 7.0);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const BREAKING_FOAM_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  void main() {
    vec2 point = gl_PointCoord - .5;
    float falloff = smoothstep(.5, .08, length(point));
    gl_FragColor = vec4(.82, 1.0, .96, falloff * vAlpha);
  }
`;

function BreakingWave({
  motion,
  settings,
  character,
  light,
  cloudCover,
}: {
  motion: MutableRefObject<MotionState>;
  settings: SessionSettings;
  character: BreakCharacter;
  light: number;
  cloudCover: number;
}) {
  const group = useRef<THREE.Group>(null);
  const faceMaterial = useRef<THREE.ShaderMaterial>(null);
  const curtainMaterial = useRef<THREE.ShaderMaterial>(null);
  const foamMaterial = useRef<THREE.ShaderMaterial>(null);
  const lineSide = useRef(character.peel === 0 ? 1 : Math.sign(character.peel));
  const warmupFrames = useRef(1);
  const tideResponse = useMemo(
    () => tideResponseForBreak(settings.tide, character),
    [character, settings.tide],
  );
  const faceUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWaveHeight: { value: 1 },
    uEnergy: { value: 0 },
    uCurl: { value: 0 },
    uSide: { value: 1 },
    uLine: { value: 0 },
    uSection: { value: 0 },
    uLight: { value: 1 },
    uCloud: { value: 0 },
    uOpacity: { value: 0 },
  }), []);
  const foamUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWaveHeight: { value: 1 },
    uEnergy: { value: 0 },
    uCurl: { value: 0 },
    uSide: { value: 1 },
    uLine: { value: 0 },
    uSection: { value: 0 },
    uOpacity: { value: 0 },
  }), []);
  const curtainUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWaveHeight: { value: 1 },
    uEnergy: { value: 0 },
    uCurl: { value: 0 },
    uSide: { value: 1 },
    uLine: { value: 0 },
    uSection: { value: 0 },
    uLight: { value: 1 },
    uCloud: { value: 0 },
    uOpacity: { value: 0 },
  }), []);
  const foamPositions = useMemo(() => {
    const count = isMobileRenderer() ? 58 : 96;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = -12 + (index / (count - 1)) * 24;
      positions[index * 3 + 1] = ((index * 37) % (count + 1)) / (count + 1);
    }
    return positions;
  }, []);

  useEffect(() => {
    lineSide.current = character.peel === 0 ? 1 : Math.sign(character.peel);
  }, [character.peel]);

  useFrame(({ clock }, delta) => {
    if (!group.current || !faceMaterial.current || !curtainMaterial.current || !foamMaterial.current) return;
    const state = motion.current;
    const riding = state.phase === "riding";
    if (riding) lineSide.current = state.lineSide || lineSide.current;
    const effectiveHollow = character.hollow * tideResponse.hollowScale;
    const effectiveSteepness = character.steepness * tideResponse.steepnessScale;
    const effectivePower = character.power * tideResponse.powerScale;
    const targetCurl = riding
      ? THREE.MathUtils.clamp(
          (state.waveQuality * .24 + state.barrel * .92 + state.maneuver * .12) * (.72 + effectiveHollow * .3 + effectiveSteepness * .08),
          .08,
          1.28,
        )
      : 0;
    const targetOpacity = riding
      ? THREE.MathUtils.clamp(.28 + state.waveQuality * .25 + state.barrel * .3 + effectivePower * .045, .3, .92)
      : 0;
    const targetCurtain = riding
      ? THREE.MathUtils.clamp((state.waveQuality - .5 + effectiveHollow * .14) * .82 + state.barrel * .92 + state.maneuver * .08, 0, .96)
      : 0;
    const values = faceMaterial.current.uniforms;
    values.uTime.value = clock.elapsedTime;
    values.uWaveHeight.value = THREE.MathUtils.damp(
      values.uWaveHeight.value,
      settings.waveHeight * tideResponse.faceScale * (.9 + effectivePower * .1),
      3.5,
      delta,
    );
    values.uEnergy.value = THREE.MathUtils.damp(values.uEnergy.value, state.setEnergy, 4, delta);
    values.uCurl.value = THREE.MathUtils.damp(values.uCurl.value, targetCurl, 5.5, delta);
    values.uSide.value = THREE.MathUtils.damp(values.uSide.value, lineSide.current, 3.2, delta);
    values.uLine.value = THREE.MathUtils.damp(values.uLine.value, state.linePosition, 5.8, delta);
    values.uSection.value = THREE.MathUtils.damp(values.uSection.value, state.sectionPressure, 4.8, delta);
    values.uLight.value = light;
    values.uCloud.value = cloudCover / 100;
    values.uOpacity.value = THREE.MathUtils.damp(values.uOpacity.value, targetOpacity, riding ? 7 : 4, delta);
    const curtain = curtainMaterial.current.uniforms;
    curtain.uTime.value = clock.elapsedTime;
    curtain.uWaveHeight.value = values.uWaveHeight.value;
    curtain.uEnergy.value = values.uEnergy.value;
    curtain.uCurl.value = values.uCurl.value;
    curtain.uSide.value = values.uSide.value;
    curtain.uLine.value = values.uLine.value;
    curtain.uSection.value = values.uSection.value;
    curtain.uLight.value = light;
    curtain.uCloud.value = cloudCover / 100;
    curtain.uOpacity.value = THREE.MathUtils.damp(curtain.uOpacity.value, targetCurtain, riding ? 6 : 3.5, delta);
    const foam = foamMaterial.current.uniforms;
    foam.uTime.value = clock.elapsedTime;
    foam.uWaveHeight.value = values.uWaveHeight.value;
    foam.uEnergy.value = values.uEnergy.value;
    foam.uCurl.value = values.uCurl.value;
    foam.uSide.value = values.uSide.value;
    foam.uLine.value = values.uLine.value;
    foam.uSection.value = values.uSection.value;
    foam.uOpacity.value = values.uOpacity.value;
    if (warmupFrames.current > 0) {
      warmupFrames.current -= 1;
      group.current.visible = true;
    } else {
      group.current.visible = riding || values.uOpacity.value > .012;
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh renderOrder={3}>
        <planeGeometry args={[24, 1, isMobileRenderer() ? 42 : 64, isMobileRenderer() ? 14 : 22]} />
        <shaderMaterial
          ref={faceMaterial}
          uniforms={faceUniforms}
          vertexShader={BREAKING_WAVE_VERTEX}
          fragmentShader={BREAKING_WAVE_FRAGMENT}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh renderOrder={3.5}>
        <planeGeometry args={[24, 1, isMobileRenderer() ? 34 : 54, isMobileRenderer() ? 11 : 18]} />
        <shaderMaterial
          ref={curtainMaterial}
          uniforms={curtainUniforms}
          vertexShader={WAVE_CURTAIN_VERTEX}
          fragmentShader={WAVE_CURTAIN_FRAGMENT}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <points frustumCulled={false} renderOrder={4}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[foamPositions, 3]} />
        </bufferGeometry>
        <shaderMaterial
          ref={foamMaterial}
          uniforms={foamUniforms}
          vertexShader={BREAKING_FOAM_VERTEX}
          fragmentShader={BREAKING_FOAM_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

const PADDLE_WALL_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uPower;
  varying vec2 vUv;
  varying float vCrest;
  varying float vFold;
  varying vec3 vWorldPosition;

  void main() {
    float rise = pow(uv.y, 1.34);
    float crest = smoothstep(.66, 1.0, uv.y);
    float fold = crest * crest * uPower;
    vec3 p = position;
    p.x += sin(position.x * .38 + uTime * 2.1) * (.035 + uPower * .075) * uv.y;
    p.y = rise * uHeight + sin(position.x * .52 - uTime * 2.6) * .035 * uv.y;
    p.z = 1.15 - rise * (.34 + uHeight * .045) - fold * (.28 + uHeight * .22);
    vUv = uv;
    vCrest = crest;
    vFold = fold;
    vWorldPosition = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const PADDLE_WALL_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uLight;
  varying vec2 vUv;
  varying float vCrest;
  varying float vFold;
  varying vec3 vWorldPosition;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    if (dot(normal, viewDirection) < 0.0) normal *= -1.0;
    float fresnel = pow(1.0 - clamp(dot(normal, viewDirection), 0.0, 1.0), 3.2);
    float broad = noise(vUv * vec2(15.0, 7.0) + vec2(uTime * .24, -uTime * .54));
    float veins = noise(vUv * vec2(46.0, 11.0) + vec2(-uTime * .72, uTime * .17));
    vec3 deep = mix(vec3(.006, .08, .11), vec3(.025, .28, .27), vUv.y);
    vec3 reflected = mix(vec3(.08, .23, .28), vec3(.34, .68, .67), uLight);
    vec3 color = mix(deep, reflected, fresnel * .5);
    color *= .88 + broad * .18;
    float foamNoise = smoothstep(.34, .78, broad) * (.7 + veins * .48);
    float feather = vCrest * foamNoise + smoothstep(.76, .96, veins) * vFold * .62;
    color = mix(color, mix(vec3(.62, .9, .86), vec3(.97, 1.0, .98), uLight), clamp(feather, 0.0, .94));
    float edge = smoothstep(0.0, .08, vUv.x) * smoothstep(0.0, .08, 1.0 - vUv.x);
    float lower = smoothstep(0.0, .14, vUv.y);
    float alpha = uOpacity * edge * lower * (.24 + fresnel * .38 + vCrest * .34 + feather * .42);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, .92));
  }
`;

function PaddleOutShorebreak({ motion, settings, light, mobile }: { motion: MutableRefObject<MotionState>; settings: SessionSettings; light: number; mobile: boolean }) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uHeight: { value: .8 },
    uPower: { value: 0 },
    uOpacity: { value: 0 },
    uLight: { value: 1 },
  }), []);

  useFrame(({ clock }, delta) => {
    if (!group.current || !material.current) return;
    const state = motion.current;
    const paddling = state.phase === "paddling";
    const approaching = paddling && state.shorebreakPower > .04 && (state.shorebreakSeconds <= 2.8 || state.shorebreak > .015);
    const values = material.current.uniforms;
    const targetHeight = settings.waveHeight * (.32 + state.shorebreakPower * .58) + .22;
    const preRoll = state.shorebreakSeconds > 0 ? 1 - THREE.MathUtils.smoothstep(state.shorebreakSeconds, .2, 2.8) : state.shorebreak;
    const targetOpacity = approaching ? THREE.MathUtils.clamp(.04 + preRoll * .42 + state.shorebreak * .34, 0, .8) : 0;
    values.uTime.value = clock.elapsedTime;
    values.uHeight.value = THREE.MathUtils.damp(values.uHeight.value, targetHeight, 6, delta);
    values.uPower.value = THREE.MathUtils.damp(values.uPower.value, state.shorebreakPower, 6, delta);
    values.uOpacity.value = THREE.MathUtils.damp(values.uOpacity.value, targetOpacity, approaching ? 9 : 5, delta);
    values.uLight.value = light;
    const waveAngle = ((settings.waveDirection - settings.coastHeading) * Math.PI) / 180;
    const sourceHeading = waveAngle + Math.PI;
    const relativeHeading = sourceHeading - state.paddleHeading;
    const wallDistance = state.shorebreakSeconds > 0 ? Math.min(12, state.shorebreakSeconds * 4.35) : 0;
    group.current.position.x = THREE.MathUtils.damp(group.current.position.x, Math.sin(relativeHeading) * wallDistance, 11, delta);
    group.current.position.z = THREE.MathUtils.damp(group.current.position.z, Math.cos(relativeHeading) * wallDistance, 11, delta);
    group.current.position.y = -0.02 - state.duckDive * .18;
    group.current.rotation.y = dampAngle(group.current.rotation.y, relativeHeading, 7, delta);
    group.current.scale.x = THREE.MathUtils.damp(group.current.scale.x, .92 + state.shorebreakPower * .12, 5, delta);
    group.current.visible = values.uOpacity.value > .006;
  });

  return (
    <group ref={group} visible={false}>
      <mesh renderOrder={3.25}>
        <planeGeometry args={[mobile ? 22 : 28, 1, mobile ? 36 : 54, mobile ? 12 : 18]} />
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={PADDLE_WALL_VERTEX}
          fragmentShader={PADDLE_WALL_FRAGMENT}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

const SURFER_MODEL_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/models/surfer-premium.glb`;
const VAN_MODEL_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/models/surf-van-premium.glb`;
const VISITOR_MODEL_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/models/beach-visitor-premium.glb`;
const NEOPRENE_TEXTURE_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/textures/neoprene-premium.webp`;
const SURFER_JOINT_NAMES = [
  "Pelvis",
  "Torso",
  "Head",
  "UpperArm.L",
  "LowerArm.L",
  "Hand.L",
  "UpperArm.R",
  "LowerArm.R",
  "Hand.R",
  "UpperLeg.L",
  "LowerLeg.L",
  "Foot.L",
  "UpperLeg.R",
  "LowerLeg.R",
  "Foot.R",
] as const;

type SurferJointName = (typeof SURFER_JOINT_NAMES)[number];

function prepareSurferScene(
  source: THREE.Group,
  accent: string,
  neopreneBump: THREE.Texture,
  thermalKit: ThermalKit,
) {
  const model = cloneSkeleton(source) as THREE.Group;
  const accentColor = new THREE.Color(accent);
  const coldWaterKit = thermalKit.id === "hooded-5-4";
  const tropicalKit = thermalKit.bodyVariant === "tropical";
  const activeBodyName = coldWaterKit
    ? THREE.PropertyBinding.sanitizeNodeName("SurferBody.Cold.mesh")
    : {
        full: THREE.PropertyBinding.sanitizeNodeName("SurferBody.Full.mesh"),
        spring: THREE.PropertyBinding.sanitizeNodeName("SurferBody.Spring.mesh"),
        tropical: THREE.PropertyBinding.sanitizeNodeName("SurferBody.Tropical.mesh"),
      }[thermalKit.bodyVariant];
  model.updateMatrixWorld(true);
  const attachments = [
    ["Head.details", "Head"],
    ["Hair.details", "Head"],
    ["Collar.seam", "Torso"],
    ["Chest.logo", "Torso"],
    ["Wrist.seam.L", "Hand.L"],
    ["Wrist.seam.R", "Hand.R"],
    ["Shoulder.seam.L", "UpperArm.L"],
    ["Shoulder.seam.R", "UpperArm.R"],
    ["Ankle.seam.L", "LowerLeg.L"],
    ["Ankle.seam.R", "LowerLeg.R"],
    ["Torso.seam.L", "Torso"],
    ["Torso.seam.R", "Torso"],
    ["Knee.patch.L", "LowerLeg.L"],
    ["Knee.patch.R", "LowerLeg.R"],
    ["Leash.cuff", "LowerLeg.R"],
    ["Leash.cuff.tab", "LowerLeg.R"],
    ["Cold.Hood", "Head"],
    ["Cold.Glove.L", "Hand.L"],
    ["Cold.Glove.R", "Hand.R"],
    ["Cold.Bootie.L", "Foot.L"],
    ["Cold.Bootie.R", "Foot.R"],
  ] as const;
  attachments.forEach(([detailName, jointName]) => {
    const detail = namedModelObject(model, detailName);
    const joint = namedModelObject(model, jointName);
    if (detail && joint) joint.attach(detail);
  });
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const materialList = Array.isArray(object.material) ? object.material : [object.material];
      const materialNames = materialList.map((material) => material.name.toLowerCase());
      const bodyVariant = object.name.startsWith("SurferBody");
      const coldAccessory = object.name.startsWith("Cold");
      const hair = materialNames.some((name) => name.includes("wet dark hair"));
      const warmWaterSeam = object.name.startsWith("Wristseam") || object.name.startsWith("Ankleseam");
      const fullSuitDetail = object.name.startsWith("Shoulderseam")
        || object.name.startsWith("Torsoseam")
        || object.name.startsWith("Kneepatch")
        || object.name.startsWith("Collarseam");
      object.visible = bodyVariant
        ? object.name.startsWith(activeBodyName)
        : coldAccessory
          ? coldWaterKit
          : fullSuitDetail
            ? !tropicalKit
          : hair
            ? !coldWaterKit
            : warmWaterSeam
              ? !tropicalKit
              : object.visible;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = true;
      const sourceMaterials = materialList;
      const materials = sourceMaterials.map((sourceMaterial) => {
        const next = sourceMaterial.clone();
        if (next instanceof THREE.MeshStandardMaterial) {
          next.userData.surfscapeBaseRoughness = next.roughness;
          next.userData.surfscapeBaseEnv = next.envMapIntensity;
          if (next instanceof THREE.MeshPhysicalMaterial) {
            next.userData.surfscapeBaseClearcoat = next.clearcoat;
            next.userData.surfscapeBaseClearcoatRoughness = next.clearcoatRoughness;
          }
          const name = next.name.toLowerCase();
          const isNeoprene = name.includes("neoprene") || name.includes("stretch panels") || name.includes("knee panels");
          if (isNeoprene) {
            next.bumpMap = neopreneBump;
            next.bumpScale = name.includes("knee") ? .004 : .0065;
            const suitColor = thermalKit.id === "hooded-5-4"
              ? new THREE.Color("#0a1114")
              : thermalKit.id === "full-4-3"
                ? new THREE.Color("#111b1f")
                : new THREE.Color("#18272b");
            next.color.copy(suitColor).lerp(accentColor, name.includes("stretch") ? .12 : .035);
          }
          if (name.includes("thermal uv rashguard")) {
            next.color.copy(new THREE.Color("#113d44")).lerp(accentColor, .46);
            next.roughness = .55;
          }
          if (name.includes("hydrophobic performance boardshort")) {
            next.color.copy(new THREE.Color("#132429")).lerp(accentColor, .24);
            next.roughness = .42;
          }
          if (name.includes("thermal neoprene accessories")) {
            next.color.set("#070d10");
            next.bumpMap = neopreneBump;
            next.bumpScale = .007;
          }
          if (name.includes("liquid sealed") || name.includes("reflective")) {
            next.color.copy(accentColor).lerp(new THREE.Color("#8ef3df"), name.includes("reflective") ? .36 : .12);
          }
        }
        return next;
      });
      object.material = Array.isArray(object.material) ? materials : materials[0];
    }
  });
  return model;
}

function PremiumSurferBody({
  motion,
  accent,
  ankleJointRef,
  thermalKit,
  vehicleMotion,
}: {
  motion: MutableRefObject<MotionState>;
  accent: string;
  ankleJointRef: MutableRefObject<THREE.Object3D | null>;
  thermalKit: ThermalKit;
  vehicleMotion?: MutableRefObject<VehicleMotionState>;
}) {
  const { scene } = useGLTF(SURFER_MODEL_URL);
  const sourceNeoprene = useTexture(NEOPRENE_TEXTURE_URL);
  const neopreneBump = useMemo(() => {
    const texture = sourceNeoprene.clone();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(7, 10);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }, [sourceNeoprene]);
  const model = useMemo(
    () => prepareSurferScene(scene, accent, neopreneBump, thermalKit),
    [accent, neopreneBump, scene, thermalKit],
  );
  const responsiveMaterials = useMemo(() => {
    const materials = new Set<THREE.MeshStandardMaterial>();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const next = Array.isArray(object.material) ? object.material : [object.material];
      next.forEach((entry) => {
        if (entry instanceof THREE.MeshStandardMaterial) materials.add(entry);
      });
    });
    return [...materials];
  }, [model]);
  const locomotionRoot = useRef<THREE.Group>(null);
  const joints = useRef<Partial<Record<SurferJointName, THREE.Object3D>>>({});
  const jointRestPose = useRef<Partial<Record<SurferJointName, THREE.Euler>>>({});
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    const next: Partial<Record<SurferJointName, THREE.Object3D>> = {};
    const rest: Partial<Record<SurferJointName, THREE.Euler>> = {};
    SURFER_JOINT_NAMES.forEach((name) => {
      const joint = namedModelObject(model, name);
      if (joint) {
        next[name] = joint;
        rest[name] = joint.rotation.clone();
      }
    });
    joints.current = next;
    jointRestPose.current = rest;
    ankleJointRef.current = next["Foot.R"] ?? next["LowerLeg.R"] ?? null;
    return () => {
      ankleJointRef.current = null;
      jointRestPose.current = {};
    };
  }, [ankleJointRef, model]);

  useFrame(({ clock }, delta) => {
    const state = motion.current;
    const t = clock.elapsedTime;
    const paddle = state.phase === "paddling";
    const riding = state.phase === "riding";
    const wading = state.phase === "wading";
    const walking = state.phase === "shore" || wading;
    const wipeout = state.phase === "wipeout";
    const driving = state.phase === "driving";
    const vehicle = vehicleMotion?.current;
    const driveSteer = driving ? vehicle?.steer ?? 0 : 0;
    const driveThrottle = driving ? vehicle?.throttle ?? 0 : 0;
    const driveLongitudinalG = driving ? vehicle?.longitudinalG ?? 0 : 0;
    const driveLateralG = driving ? vehicle?.lateralG ?? 0 : 0;
    const driveBrake = driving && Boolean(vehicle?.brake);
    const rideSettle = riding ? state.finish : 0;
    const rideCompression = THREE.MathUtils.clamp(
      state.compression
        + Math.abs(state.lateralForce) * .09
        + Math.max(0, -state.acceleration) * .07,
      0,
      1,
    ) * (1 - rideSettle * .82);
    const takeoffPlant = paddle
      ? THREE.MathUtils.smootherstep(state.takeoffCommit, .34, .94)
      : 0;
    const waterDepth = THREE.MathUtils.clamp(state.waterDepth, 0, 1);
    const carryGrip = walking ? 1 - waterDepth * .9 : 0;
    const boardGuide = wading ? THREE.MathUtils.smoothstep(waterDepth, .16, .9) : 0;
    const surfaceWetness = state.wetness;
    responsiveMaterials.forEach((surface) => {
      const name = surface.name.toLowerCase();
      const baseRoughness = Number(surface.userData.surfscapeBaseRoughness ?? surface.roughness);
      const isSkin = name.includes("skin") || name.includes("sclera") || name.includes("lip") || name.includes("nail");
      const isHair = name.includes("hair") || name.includes("brow");
      const isNeoprene = name.includes("neoprene") || name.includes("stretch") || name.includes("knee") || name.includes("seam") || name.includes("cuff");
      const wetRoughness = isHair ? .16 : isSkin ? .27 : isNeoprene ? .24 : Math.max(.2, baseRoughness * .72);
      surface.roughness = THREE.MathUtils.damp(surface.roughness, THREE.MathUtils.lerp(baseRoughness, wetRoughness, surfaceWetness), 5, delta);
      surface.envMapIntensity = THREE.MathUtils.damp(surface.envMapIntensity, THREE.MathUtils.lerp(Number(surface.userData.surfscapeBaseEnv ?? 1), isSkin ? 1.3 : 1.55, surfaceWetness), 4, delta);
      if (surface instanceof THREE.MeshPhysicalMaterial) {
        const wetClearcoat = isHair ? .78 : isSkin ? .32 : isNeoprene ? .4 : .26;
        const baseClearcoat = Number(surface.userData.surfscapeBaseClearcoat ?? surface.clearcoat);
        const baseClearcoatRoughness = Number(surface.userData.surfscapeBaseClearcoatRoughness ?? surface.clearcoatRoughness);
        surface.clearcoat = THREE.MathUtils.damp(surface.clearcoat, THREE.MathUtils.lerp(baseClearcoat, Math.max(baseClearcoat, wetClearcoat), surfaceWetness), 4, delta);
        surface.clearcoatRoughness = THREE.MathUtils.damp(surface.clearcoatRoughness, THREE.MathUtils.lerp(baseClearcoatRoughness, isHair ? .12 : .2, surfaceWetness), 4, delta);
      }
    });
    const paddlePhase = t * (4.2 + state.paddleEffort * 2.4);
    const stroke = paddle ? Math.sin(paddlePhase) * state.paddleEffort * (1 - takeoffPlant) : 0;
    const leftPull = paddle ? Math.max(0, -Math.sin(paddlePhase)) * state.paddleEffort : 0;
    const rightPull = paddle ? Math.max(0, Math.sin(paddlePhase)) * state.paddleEffort : 0;
    const paddleRoll = paddle ? stroke * .085 * (1 - state.duckDive) : 0;
    const stride = walking ? THREE.MathUtils.smoothstep(state.speed, .12, 1.3) : 0;
    const cadence = 2.5 + state.speed * (1.48 + state.run * .26);
    const step = walking ? Math.sin(t * cadence) * stride * (1 - waterDepth * .28) : 0;
    const runLean = walking ? state.run * .065 : 0;
    const exertion = state.exertion;
    const motionScale = reducedMotion ? .28 : 1;
    const idleBlend = walking
      ? (.16 + (1 - THREE.MathUtils.smoothstep(state.speed, .08, .95)) * .84) * (1 - waterDepth * .42)
      : 0;
    const secondaryBlend = walking ? (.22 + idleBlend * .78) * motionScale : 0;
    const breathRate = 1.55 + exertion * 1.4;
    const breath = Math.sin(t * breathRate) * (.009 + exertion * .018) * secondaryBlend;
    const shoulderBreath = Math.sin(t * breathRate + .18) * (.011 + exertion * .016) * secondaryBlend;
    const idleScan = (
      Math.sin(t * .31 + .6) * .72
      + Math.sin(t * .13 + 2.1) * .28
    ) * idleBlend * motionScale;
    const idleSway = Math.sin(t * .47 + .9) * idleBlend * motionScale;
    const stepLift = 1 + waterDepth * .44;
    const bob = walking
      ? (Math.abs(Math.sin(t * cadence)) - .5) * (.028 + state.run * .026) * stride * (1 - waterDepth * .48)
        + (wading ? Math.sin(t * 2.1) * .014 * waterDepth : 0)
      : 0;
    const wipeoutWave = wipeout ? Math.sin(t * 6.4 + state.wipeout * 2.7) : 0;
    if (locomotionRoot.current) {
      locomotionRoot.current.position.y = THREE.MathUtils.damp(locomotionRoot.current.position.y, bob, 12, delta);
      locomotionRoot.current.rotation.x = THREE.MathUtils.damp(locomotionRoot.current.rotation.x, runLean, 9, delta);
      locomotionRoot.current.rotation.y = THREE.MathUtils.damp(locomotionRoot.current.rotation.y, idleScan * .012, 4.5, delta);
      locomotionRoot.current.rotation.z = THREE.MathUtils.damp(locomotionRoot.current.rotation.z, idleSway * .012, 4.5, delta);
    }

    const pose = (name: SurferJointName, x: number, y: number, z: number, responsiveness = 8) => {
      const joint = joints.current[name];
      if (!joint) return;
      const rest = jointRestPose.current[name];
      joint.rotation.x = dampAngle(joint.rotation.x, (rest?.x ?? 0) + x, responsiveness, delta);
      joint.rotation.y = dampAngle(joint.rotation.y, (rest?.y ?? 0) + y, responsiveness, delta);
      joint.rotation.z = dampAngle(joint.rotation.z, (rest?.z ?? 0) + z, responsiveness, delta);
    };

    const rideLean = (
      state.balance * 0.12
      + state.maneuverSide * state.maneuver * 0.12
      + state.rail * (.08 + state.trickCharge * .06)
      + state.lateralForce * .075
    ) * (1 - state.takeoff * .72) * (1 - rideSettle * .78);
    pose("Pelvis", driving ? -.14 - driveLongitudinalG * .05 : riding ? -0.08 - rideCompression * .12 + state.stance * 0.045 : walking ? step * 0.025 + idleSway * .012 : wipeout ? wipeoutWave * .16 : 0, driving ? driveSteer * .045 : riding ? state.rail * -0.1 * (1 - rideSettle) : paddle ? -paddleRoll * .34 : walking ? idleScan * .008 : 0, driving ? -driveLateralG * .1 : riding ? rideLean * 0.35 : paddle ? paddleRoll * .26 : walking ? idleSway * .018 : 0, 7);
    pose("Torso", driving ? .1 - driveLongitudinalG * .08 - (driveBrake ? .035 : 0) : paddle ? THREE.MathUtils.lerp(-0.1 - state.duckDive * .24, .16, takeoffPlant) : riding ? 0.18 + rideCompression * .22 - state.barrel * 0.13 - state.maneuverLift * .08 - rideSettle * .08 - state.acceleration * .045 : walking ? runLean - step * 0.018 - boardGuide * .025 + breath : wipeout ? -.18 + wipeoutWave * .22 : 0, driving ? driveSteer * .055 : riding ? (state.maneuverSide * state.maneuver * 0.16 + state.slip * state.rail * .08 + state.maneuverSpin * .12 - state.lineSide * .045 + state.lateralForce * .055) * (1 - rideSettle * .82) : paddle ? paddleRoll * (1 - takeoffPlant) : walking ? idleScan * .018 : 0, driving ? -driveLateralG * .14 : riding ? rideLean : paddle ? paddleRoll * .58 * (1 - takeoffPlant) : walking ? idleSway * .022 : wipeout ? -wipeoutWave * .24 : 0, 7);
    pose("Head", driving ? -.06 + driveLongitudinalG * .025 : paddle ? THREE.MathUtils.lerp(-0.24 + state.duckDive * .14, -.08, takeoffPlant) : riding ? -0.12 - rideCompression * .08 + state.barrel * 0.08 + rideSettle * .07 : walking ? (wading ? -.03 * boardGuide : 0) - breath * .42 : wipeout ? .1 - wipeoutWave * .12 : 0, driving ? driveSteer * .18 : riding ? (state.rail * 0.12 + state.lineSide * .11 + state.maneuverSide * state.maneuver * .08) * (1 - rideSettle * .7) : paddle ? -paddleRoll * .54 * (1 - takeoffPlant) : walking ? idleScan * .23 : 0, driving ? driveLateralG * .055 : riding ? -rideLean * 0.4 : paddle ? -paddleRoll * .42 * (1 - takeoffPlant) : walking ? -idleSway * .028 : wipeout ? wipeoutWave * .16 : 0, 8);

    const leftRideArmX = THREE.MathUtils.lerp(
      -0.48 - state.maneuver * 0.22 + state.trickCharge * .28 - state.maneuverLift * .22,
      -.24,
      rideSettle,
    );
    const rightRideArmX = THREE.MathUtils.lerp(
      0.48 + state.maneuver * 0.22 - state.trickCharge * .28 + state.maneuverLift * .22,
      .24,
      rideSettle,
    );
    const popPlant = riding ? state.takeoff : 0;
    const leftCarryArmX = THREE.MathUtils.lerp(step * .42, -.18, boardGuide) + shoulderBreath * .24;
    const rightCarryArmX = THREE.MathUtils.lerp(.16 + step * -.08, -.34, boardGuide) - shoulderBreath * .24;
    const leftCarryArmZ = THREE.MathUtils.lerp(.08, .22, boardGuide);
    const rightCarryArmZ = THREE.MathUtils.lerp(-.38, -.58, boardGuide);

    pose(
      "UpperArm.L",
      wipeout ? 1.04 + wipeoutWave * .48 : driving ? -.7 - driveSteer * .16 : paddle ? THREE.MathUtils.lerp(stroke * 1.18 * (1 - state.duckDive) - state.duckDive * .72, -.82, takeoffPlant) : riding ? THREE.MathUtils.lerp(leftRideArmX, -.82, popPlant) : walking ? THREE.MathUtils.lerp(step * .56 + shoulderBreath * .42, leftCarryArmX, carryGrip) : 0,
      driving ? -.035 + driveSteer * .025 : riding ? -0.12 + state.rail * 0.12 : 0,
      driving ? .69 + driveSteer * .11 : riding ? THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.03 + state.maneuver * 0.32 + state.slip * .16, .58, popPlant), .46, rideSettle) : paddle ? THREE.MathUtils.lerp(.14 + paddleRoll * .22, .58, takeoffPlant) : walking ? THREE.MathUtils.lerp(.08, leftCarryArmZ, carryGrip) : wipeout ? .34 : .08,
      9,
    );
    pose(
      "UpperArm.R",
      wipeout ? -1.02 + wipeoutWave * .42 : driving ? .7 - driveSteer * .16 : paddle ? THREE.MathUtils.lerp(-stroke * 1.18 * (1 - state.duckDive) + state.duckDive * .72, .82, takeoffPlant) : riding ? THREE.MathUtils.lerp(rightRideArmX, .82, popPlant) : walking ? THREE.MathUtils.lerp(-step * .56 - shoulderBreath * .42, rightCarryArmX, carryGrip) : 0,
      driving ? .035 + driveSteer * .025 : riding ? 0.12 + state.rail * 0.12 : 0,
      driving ? -.69 + driveSteer * .11 : riding ? THREE.MathUtils.lerp(THREE.MathUtils.lerp(-1.03 - state.maneuver * 0.32 - state.slip * .16, -.58, popPlant), -.46, rideSettle) : paddle ? THREE.MathUtils.lerp(-.14 + paddleRoll * .22, -.58, takeoffPlant) : walking ? THREE.MathUtils.lerp(-.08, rightCarryArmZ, carryGrip) : wipeout ? -.34 : -.08,
      9,
    );
    pose("LowerArm.L", driving ? -.9 + driveSteer * .24 : paddle ? THREE.MathUtils.lerp(-leftPull * .82 + Math.max(0, stroke) * .16 - state.duckDive * .42, -.72, takeoffPlant) : riding ? THREE.MathUtils.lerp(-.42, -.72, popPlant) : walking ? carryGrip * THREE.MathUtils.lerp(.08, .28, boardGuide) : wipeout ? .72 - wipeoutWave * .28 : 0, driving ? -.04 : paddle ? leftPull * .08 * (1 - takeoffPlant) : 0, driving ? .08 : riding ? .12 : walking ? carryGrip * .08 : 0, 10);
    pose("LowerArm.R", driving ? .9 + driveSteer * .24 : paddle ? THREE.MathUtils.lerp(rightPull * .82 - Math.max(0, -stroke) * .16 + state.duckDive * .42, .72, takeoffPlant) : riding ? THREE.MathUtils.lerp(.42, .72, popPlant) : walking ? carryGrip * THREE.MathUtils.lerp(.62, .44, boardGuide) : wipeout ? -.72 - wipeoutWave * .28 : 0, driving ? .04 : paddle ? -rightPull * .08 * (1 - takeoffPlant) : 0, driving ? -.08 : riding ? -.12 : walking ? carryGrip * -.1 : 0, 10);
    pose("Hand.L", driving ? -.08 - driveSteer * .08 : paddle ? leftPull * -.12 : 0, driving ? -.16 : riding ? -.16 : walking ? carryGrip * -.05 : 0, driving ? .08 : riding ? .08 : walking ? carryGrip * .06 : 0, 10);
    pose("Hand.R", driving ? .08 - driveSteer * .08 : paddle ? rightPull * .12 : walking ? .08 * carryGrip : 0, driving ? .16 : riding ? .16 : walking ? .08 * carryGrip : 0, driving ? -.08 : riding ? -.08 : walking ? -.12 * carryGrip : 0, 10);

    pose("UpperLeg.L", driving ? -1.08 + driveLongitudinalG * .04 : riding ? THREE.MathUtils.lerp(-0.74 - state.stance * .12 - rideCompression * .24, -.34, popPlant) : walking ? step * .62 * stepLift : paddle ? -.08 : wipeout ? .48 + wipeoutWave * .32 : 0, driving ? -.04 : 0, driving ? .1 : riding ? .17 + state.rail * .04 : wipeout ? .16 : 0, 8);
    pose("UpperLeg.R", driving ? 1.04 - driveThrottle * .045 : riding ? THREE.MathUtils.lerp(.6 - state.stance * .12 + rideCompression * .22, .3, popPlant) : walking ? -step * .62 * stepLift : paddle ? .08 : wipeout ? -.44 + wipeoutWave * .28 : 0, driving ? .04 : 0, driving ? -.1 : riding ? -.17 + state.rail * .04 : wipeout ? -.16 : 0, 8);
    pose("LowerLeg.L", driving ? 1.24 - (driveBrake ? .08 : 0) : riding ? THREE.MathUtils.lerp(1.02 + rideCompression * .24, 1.28, popPlant) : walking ? Math.max(0, -step) * .56 * stepLift : paddle ? .08 : wipeout ? .74 - wipeoutWave * .34 : 0, 0, wipeout ? -.08 : 0, 9);
    pose("LowerLeg.R", driving ? -1.16 + driveThrottle * .07 : riding ? THREE.MathUtils.lerp(-.92 - rideCompression * .24, -1.18, popPlant) : walking ? Math.max(0, step) * -.56 * stepLift : paddle ? -.08 : wipeout ? -.7 - wipeoutWave * .34 : 0, 0, wipeout ? .08 : 0, 9);
    pose("Foot.L", driving ? -.22 + (driveBrake ? .12 : 0) : riding ? -.18 : walking ? -step * .08 : wipeout ? -.24 + wipeoutWave * .12 : 0, driving ? .035 : riding ? .08 : 0, driving ? -.03 : riding ? -.08 : wipeout ? -.12 : 0, 9);
    pose("Foot.R", driving ? .18 - driveThrottle * .12 : riding ? .18 : walking ? step * .08 : wipeout ? .24 + wipeoutWave * .12 : 0, driving ? -.035 : riding ? -.08 : 0, driving ? .03 : riding ? .08 : wipeout ? .12 : 0, 9);
  });

  useEffect(() => () => {
    responsiveMaterials.forEach((surface) => surface.dispose());
  }, [responsiveMaterials]);

  useEffect(() => () => neopreneBump.dispose(), [neopreneBump]);

  return (
    <group ref={locomotionRoot}>
      <primitive object={model} scale={0.94} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}

useGLTF.preload(SURFER_MODEL_URL);
useGLTF.preload(VAN_MODEL_URL);
useGLTF.preload(VISITOR_MODEL_URL);
useTexture.preload(NEOPRENE_TEXTURE_URL);

function boardWidthAt(boardType: BoardType, normalizedLength: number) {
  const profile = Math.max(0, Math.sin(Math.PI * normalizedLength));
  if (boardType === "performance") return Math.pow(profile, .46) * (.9 + normalizedLength * .1);
  if (boardType === "fish") return Math.pow(profile, .31) * (1.06 - normalizedLength * .08);
  return Math.pow(profile, .36) * (.94 + Math.sin(normalizedLength * Math.PI) * .06);
}

function createBoardOutline(boardType: BoardType, length: number, halfWidth: number) {
  const nose = length * .5;
  const tail = -length * .5;
  const rightSide: THREE.Vector2[] = [];
  for (let index = 1; index < 32; index += 1) {
    const normalized = 1 - index / 32;
    rightSide.push(new THREE.Vector2(
      halfWidth * boardWidthAt(boardType, normalized),
      tail + normalized * length,
    ));
  }
  const points = [new THREE.Vector2(0, nose), ...rightSide];
  if (boardType === "fish") {
    points.push(
      new THREE.Vector2(halfWidth * .58, tail + .015),
      new THREE.Vector2(0, tail + length * .075),
      new THREE.Vector2(-halfWidth * .58, tail + .015),
    );
  } else if (boardType === "performance") {
    points.push(
      new THREE.Vector2(halfWidth * .29, tail + .018),
      new THREE.Vector2(-halfWidth * .29, tail + .018),
    );
  } else {
    points.push(new THREE.Vector2(0, tail));
  }
  rightSide.slice().reverse().forEach((point) => points.push(new THREE.Vector2(-point.x, point.y)));
  return points;
}

function createSurfboardGeometry(
  boardType: BoardType,
  length: number,
  halfWidth: number,
  thickness: number,
  inset = false,
) {
  const shape = new THREE.Shape(createBoardOutline(boardType, length, halfWidth));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    curveSegments: 12,
    bevelEnabled: true,
    bevelSegments: inset ? 2 : 3,
    bevelThickness: thickness * .26,
    bevelSize: Math.min(halfWidth * .07, thickness * .22),
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, thickness * .5, 0);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const z = positions.getZ(index);
    const normalized = THREE.MathUtils.clamp(Math.abs(z) / (length * .5), 0, 1.12);
    const rocker = Math.pow(normalized, 3.25) * (z > 0 ? length * .047 : length * .022);
    positions.setY(index, positions.getY(index) + rocker);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createFinGeometry() {
  const thickness = .026;
  const profile = [
    new THREE.Vector2(0, -.17),
    new THREE.Vector2(-.29, -.065),
    new THREE.Vector2(-.22, .105),
    new THREE.Vector2(0, .18),
  ];
  const vertices: number[] = [];
  [-thickness, thickness].forEach((x) => profile.forEach((point) => vertices.push(x, point.x, point.y)));
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function deformSurfboardGeometry({
  geometry,
  basePositions,
  length,
  halfWidth,
  flex,
  twist,
  loadCenter,
  refreshNormals,
}: {
  geometry: THREE.BufferGeometry;
  basePositions: Float32Array;
  length: number;
  halfWidth: number;
  flex: number;
  twist: number;
  loadCenter: number;
  refreshNormals: boolean;
}) {
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const values = positions.array as Float32Array;
  const halfLength = Math.max(.01, length * .5);
  const safeHalfWidth = Math.max(.01, halfWidth);

  for (let index = 0; index < values.length; index += 3) {
    const x = basePositions[index];
    const y = basePositions[index + 1];
    const z = basePositions[index + 2];
    const longitudinal = THREE.MathUtils.clamp(z / halfLength, -1, 1);
    const distanceFromLoad = THREE.MathUtils.clamp(
      Math.abs(z - loadCenter) / (length * .57),
      0,
      1,
    );
    const loadSpan = Math.pow(1 - THREE.MathUtils.smoothstep(distanceFromLoad, .08, 1), 1.34);
    const tipRecoil = Math.pow(Math.abs(longitudinal), 3.15) * .17;
    const rail = THREE.MathUtils.clamp(x / safeHalfWidth, -1, 1);
    const torsion = twist * rail * longitudinal * (.38 + Math.abs(longitudinal) * .62);
    values[index + 1] = y - flex * loadSpan + flex * tipRecoil + torsion;
  }

  positions.needsUpdate = true;
  if (refreshNormals) geometry.computeVertexNormals();
}

function PremiumSurfboard({
  boardType,
  motion,
}: {
  boardType: BoardType;
  motion: MutableRefObject<MotionState>;
}) {
  const spec = BOARD_SPECS[boardType];
  const thickness = boardType === "longboard" ? .105 : boardType === "fish" ? .115 : .098;
  const boardGeometry = useMemo(
    () => createSurfboardGeometry(boardType, spec.length, spec.width, thickness),
    [boardType, spec.length, spec.width, thickness],
  );
  const deckGeometry = useMemo(
    () => createSurfboardGeometry(boardType, spec.length * .84, spec.width * .76, .022, true),
    [boardType, spec.length, spec.width],
  );
  const boardBasePositions = useMemo(
    () => new Float32Array((boardGeometry.getAttribute("position") as THREE.BufferAttribute).array),
    [boardGeometry],
  );
  const deckBasePositions = useMemo(
    () => new Float32Array((deckGeometry.getAttribute("position") as THREE.BufferAttribute).array),
    [deckGeometry],
  );
  const finGeometry = useMemo(() => createFinGeometry(), []);
  const flexSpring = useRef({ value: 0, velocity: 0, twist: 0, twistVelocity: 0, frame: 0 });
  const mobileRenderer = useMemo(() => isMobileRenderer(), []);
  const finXs = boardType === "performance"
    ? [-spec.width * .46, 0, spec.width * .46]
    : boardType === "fish"
      ? [-spec.width * .5, spec.width * .5]
      : [0];
  const finScale = boardType === "longboard" ? 1.32 : boardType === "fish" ? 1.08 : .9;
  const tailPosition = -spec.length * .38;
  const waxPositions = boardType === "longboard" ? [-.55, -.08, .42, .88] : [-.35, .08, .48];

  useFrame((_, delta) => {
    const state = motion.current;
    const spring = flexSpring.current;
    const step = Math.min(delta, .04);
    const riding = state.phase === "riding";
    const paddling = state.phase === "paddling";
    const waterContact = riding ? 1 - THREE.MathUtils.smoothstep(state.maneuverLift, .08, .52) : 1;
    const speedLoad = THREE.MathUtils.smoothstep(state.speed, 4.5, 16);
    const compliance = boardType === "longboard" ? .72 : boardType === "fish" ? .9 : 1;
    const targetFlex = (
      riding
        ? (
          .007
          + speedLoad * .013
          + state.compression * .022
          + Math.abs(state.rail) * .008
          + Math.max(0, -state.acceleration) * .011
          + Math.abs(state.lateralForce) * .006
          + state.takeoff * .012
          + state.impact * .036
        ) * waterContact
        : paddling
          ? .004 + state.paddleEffort * .004 + state.duckDive * .009
          : 0
    ) * compliance;
    const targetTwist = riding
      ? (
        state.rail * (.005 + speedLoad * .008 + state.compression * .005)
        + state.lateralForce * .006
        + state.maneuverSide * state.maneuver * .004
      ) * waterContact * compliance
      : 0;

    spring.velocity += (targetFlex - spring.value) * 84 * step;
    spring.velocity *= Math.exp(-10.4 * step);
    spring.value = THREE.MathUtils.clamp(spring.value + spring.velocity * step, -.016, .074);
    spring.twistVelocity += (targetTwist - spring.twist) * 96 * step;
    spring.twistVelocity *= Math.exp(-12.2 * step);
    spring.twist = THREE.MathUtils.clamp(spring.twist + spring.twistVelocity * step, -.025, .025);
    spring.frame += 1;

    const refreshNormals = spring.frame % (mobileRenderer ? 3 : 2) === 0;
    const loadCenter = (riding ? state.stance : 0) * spec.length * .16;
    deformSurfboardGeometry({
      geometry: boardGeometry,
      basePositions: boardBasePositions,
      length: spec.length,
      halfWidth: spec.width,
      flex: spring.value,
      twist: spring.twist,
      loadCenter,
      refreshNormals,
    });
    deformSurfboardGeometry({
      geometry: deckGeometry,
      basePositions: deckBasePositions,
      length: spec.length * .84,
      halfWidth: spec.width * .76,
      flex: spring.value * .88,
      twist: spring.twist * .76,
      loadCenter: loadCenter * .84,
      refreshNormals,
    });
  });

  useEffect(() => {
    (boardGeometry.getAttribute("position") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (deckGeometry.getAttribute("position") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
  }, [boardGeometry, deckGeometry]);

  useEffect(() => () => {
    boardGeometry.dispose();
    deckGeometry.dispose();
    finGeometry.dispose();
  }, [boardGeometry, deckGeometry, finGeometry]);

  return (
    <group>
      <mesh geometry={boardGeometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={spec.color}
          roughness={.2}
          metalness={.015}
          clearcoat={1}
          clearcoatRoughness={.1}
          sheen={.18}
          sheenColor={spec.accent}
        />
      </mesh>
      <mesh geometry={deckGeometry} position={[0, thickness * .63, -.035]} scale={[1, 1, 1.03]}>
        <meshPhysicalMaterial color={spec.accent} roughness={.43} clearcoat={.48} clearcoatRoughness={.24} />
      </mesh>
      <mesh position={[0, thickness * .91, 0]}>
        <boxGeometry args={[.018, .013, spec.length * .9]} />
        <meshStandardMaterial color={boardType === "longboard" ? "#9b6a3d" : "#f1e1bd"} roughness={.52} />
      </mesh>
      {waxPositions.map((z, index) => (
        <mesh key={z} position={[(index % 2 ? 1 : -1) * spec.width * .11, thickness * 1.08, z]} rotation={[-Math.PI / 2, 0, index * .23]} scale={[1.15, .72, 1]}>
          <circleGeometry args={[spec.width * .42, 18]} />
          <meshStandardMaterial color="#f4efe2" roughness={.96} transparent opacity={.28} depthWrite={false} />
        </mesh>
      ))}
      {[0, 1, 2].map((index) => (
        <mesh key={index} position={[0, thickness * 1.13, -spec.length * .29 - index * .145]} rotation={[0, 0, index === 2 ? -.025 : .025]}>
          <boxGeometry args={[spec.width * (.9 - index * .08), .025 + index * .006, .105]} />
          <meshStandardMaterial color="#172428" roughness={.91} />
        </mesh>
      ))}
      <mesh position={[0, thickness * 1.18, spec.length * .18]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[spec.width * .19, spec.width * .255, 28]} />
        <meshBasicMaterial color="#fff9eb" transparent opacity={.82} />
      </mesh>
      <mesh position={[0, thickness * 1.08, -spec.length * .43]}>
        <cylinderGeometry args={[.045, .045, .022, 12]} />
        <meshStandardMaterial color="#111b1e" roughness={.56} />
      </mesh>
      {finXs.map((x) => (
        <mesh
          key={x}
          geometry={finGeometry}
          position={[x, -thickness * .62, tailPosition + (x === 0 ? -.015 : .08)]}
          rotation={[0, x === 0 ? 0 : Math.sign(x) * .09, -x * .16]}
          scale={[finScale, finScale * (x === 0 ? 1 : .88), finScale]}
          castShadow
        >
          <meshPhysicalMaterial color={x === 0 ? "#e9ede7" : spec.accent} roughness={.28} clearcoat={.72} transparent opacity={.94} />
        </mesh>
      ))}
    </group>
  );
}

function SurfLeashCord({
  motion,
  boardType,
  rigRef,
  boardRef,
  ankleJointRef,
}: {
  motion: MutableRefObject<MotionState>;
  boardType: BoardType;
  rigRef: MutableRefObject<THREE.Group | null>;
  boardRef: MutableRefObject<THREE.Group | null>;
  ankleJointRef: MutableRefObject<THREE.Object3D | null>;
}) {
  const quality = useRenderQuality();
  const mobile = useMemo(() => isMobileRenderer(), []);
  const segmentCount = mobile
    ? quality === "reduced" ? 11 : 14
    : quality === "reduced" ? 15 : 20;
  const cord = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((segmentCount + 1) * 3), 3));
    const material = new THREE.LineBasicMaterial({
      color: "#6b8a87",
      transparent: true,
      opacity: .42,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 4;
    return line;
  }, [segmentCount]);
  const cordRef = useRef<THREE.Line>(null);
  const tubeRef = useRef<THREE.InstancedMesh>(null);
  const connectorRef = useRef<THREE.InstancedMesh>(null);
  const scratchRef = useRef({
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    point: new THREE.Vector3(),
    previous: new THREE.Vector3(),
    segment: new THREE.Vector3(),
    midpoint: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    dummy: new THREE.Object3D(),
  });

  useFrame(({ clock }) => {
    const line = cordRef.current;
    const tube = tubeRef.current;
    const connectors = connectorRef.current;
    const rigObject = rigRef.current;
    const boardObject = boardRef.current;
    const ankle = ankleJointRef.current;
    const state = motion.current;
    const active = state.phase === "paddling" || state.phase === "riding" || state.phase === "wipeout" || (state.phase === "wading" && state.waterDepth > .42);
    if (!line) return;
    line.visible = Boolean(active && rigObject && boardObject && ankle);
    if (tube) tube.visible = line.visible;
    if (connectors) connectors.visible = line.visible;
    if (!line.visible || !rigObject || !boardObject || !ankle) return;

    const {
      start,
      end,
      point,
      previous,
      segment,
      midpoint,
      up,
      dummy,
    } = scratchRef.current;
    start.set(0, .13, -BOARD_SPECS[boardType].length * .43);
    boardObject.localToWorld(start);
    rigObject.worldToLocal(start);
    end.set(0, 0, 0);
    ankle.localToWorld(end);
    rigObject.worldToLocal(end);

    const positions = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const distance = start.distanceTo(end);
    const pulse = Math.sin(clock.elapsedTime * 5.4 + state.speed * .18);
    const tension = Math.max(
      state.leashTension,
      THREE.MathUtils.clamp(state.slip * .32 + state.impact * .22, 0, .48),
    );
    const cordRadius = THREE.MathUtils.lerp(.0115, .0155, tension);
    for (let index = 0; index <= segmentCount; index += 1) {
      const progress = index / segmentCount;
      const arc = Math.sin(progress * Math.PI);
      point.lerpVectors(start, end, progress);
      point.x += arc * (state.rail * .09 + pulse * .025 * (1 - tension * .72));
      point.y -= arc * (.1 + distance * .045 + state.speed * .004 + state.impact * .09) * (1 - tension * .58);
      point.z -= arc * (.08 + state.speed * .006 + state.maneuverLift * .12) * (1 - tension * .34);
      positions.setXYZ(index, point.x, point.y, point.z);
      if (tube && index > 0) {
        previous.fromBufferAttribute(positions, index - 1);
        segment.copy(point).sub(previous);
        const segmentLength = segment.length();
        midpoint.copy(previous).addScaledVector(segment, .5);
        dummy.position.copy(midpoint);
        dummy.quaternion.setFromUnitVectors(up, segment.normalize());
        dummy.scale.set(cordRadius, Math.max(.001, segmentLength), cordRadius);
        dummy.updateMatrix();
        tube.setMatrixAt(index - 1, dummy.matrix);
      }
    }
    positions.needsUpdate = true;
    if (tube) {
      tube.instanceMatrix.needsUpdate = true;
      const material = tube.material as THREE.MeshPhysicalMaterial;
      material.emissiveIntensity = THREE.MathUtils.lerp(.015, .12, tension);
    }
    if (connectors) {
      [start, end].forEach((connector, index) => {
        dummy.position.copy(connector);
        dummy.quaternion.identity();
        dummy.scale.setScalar(index === 0 ? .035 : .043);
        dummy.updateMatrix();
        connectors.setMatrixAt(index, dummy.matrix);
      });
      connectors.instanceMatrix.needsUpdate = true;
    }
  });

  useEffect(() => () => {
    cord.geometry.dispose();
    cord.material.dispose();
  }, [cord]);

  return (
    <>
      <primitive ref={cordRef} object={cord} />
      <instancedMesh ref={tubeRef} args={[undefined, undefined, segmentCount]} frustumCulled={false} renderOrder={4}>
        <cylinderGeometry args={[1, 1, 1, 7, 1, true]} />
        <meshPhysicalMaterial
          color="#102426"
          roughness={.42}
          metalness={.02}
          clearcoat={.56}
          clearcoatRoughness={.22}
          emissive="#245153"
          emissiveIntensity={.015}
        />
      </instancedMesh>
      <instancedMesh ref={connectorRef} args={[undefined, undefined, 2]} frustumCulled={false} renderOrder={4}>
        <sphereGeometry args={[1, 10, 7]} />
        <meshPhysicalMaterial color="#172d2e" roughness={.36} clearcoat={.62} clearcoatRoughness={.18} />
      </instancedMesh>
    </>
  );
}

function TetheredBoardWaterEffects({
  motion,
  boardRef,
  rootRef,
}: {
  motion: MutableRefObject<MotionState>;
  boardRef: MutableRefObject<THREE.Group | null>;
  rootRef: MutableRefObject<THREE.Group | null>;
}) {
  const quality = useRenderQuality();
  const mobile = useMemo(() => isMobileRenderer(), []);
  const particleCount = mobile
    ? quality === "reduced" ? 14 : quality === "high" ? 26 : 20
    : quality === "reduced" ? 24 : quality === "balanced" ? 34 : 44;
  const spray = useRef<THREE.Points>(null);
  const sprayMaterial = useRef<THREE.PointsMaterial>(null);
  const ripple = useRef<THREE.Mesh>(null);
  const rippleMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) values[index * 3 + 1] = -20;
    return values;
  }, [particleCount]);
  const velocities = useRef(new Float32Array(particleCount * 3));
  const life = useRef(new Float32Array(particleCount));
  const cursor = useRef(0);
  const previousWipeout = useRef(false);
  const previousTension = useRef(0);
  const rippleLife = useRef(0);
  const boardPosition = useRef(new THREE.Vector3());
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(19, 21, 1, 24, 31, 29);
      gradient.addColorStop(0, "rgba(255,255,255,.98)");
      gradient.addColorStop(.24, "rgba(211,255,250,.9)");
      gradient.addColorStop(.66, "rgba(118,224,219,.28)");
      gradient.addColorStop(1, "rgba(118,224,219,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 48, 64);
    }
    const value = new THREE.CanvasTexture(canvas);
    value.colorSpace = THREE.SRGBColorSpace;
    return value;
  }, []);

  useEffect(() => {
    velocities.current = new Float32Array(particleCount * 3);
    life.current = new Float32Array(particleCount);
    cursor.current = 0;
  }, [particleCount]);

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame((_, delta) => {
    const board = boardRef.current;
    const root = rootRef.current;
    const state = motion.current;
    const attribute = spray.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const activePositions = attribute?.array as Float32Array | undefined;
    if (!board || !root || !attribute || !activePositions) return;

    const contact = boardPosition.current.set(0, .06, 0);
    board.localToWorld(contact);
    root.worldToLocal(contact);
    const wipeout = state.phase === "wipeout";
    const tensionSnap = state.leashTension >= .64 && previousTension.current < .64;
    const firstImpact = wipeout && !previousWipeout.current;

    const emit = (count: number, strength: number) => {
      for (let particle = 0; particle < count; particle += 1) {
        const index = cursor.current++ % particleCount;
        const offset = index * 3;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * .34;
        activePositions[offset] = contact.x + Math.cos(angle) * radius;
        activePositions[offset + 1] = Math.max(.035, contact.y + Math.random() * .08);
        activePositions[offset + 2] = contact.z + Math.sin(angle) * radius;
        const burst = strength * (.65 + Math.random() * .75);
        velocities.current[offset] = Math.cos(angle) * burst;
        velocities.current[offset + 1] = .55 + Math.random() * 1.3 * strength;
        velocities.current[offset + 2] = Math.sin(angle) * burst - .24 * strength;
        life.current[index] = .44 + Math.random() * .42;
      }
      attribute.needsUpdate = true;
    };

    if (firstImpact) {
      emit(mobile ? 10 : 18, 1.4);
      rippleLife.current = 1;
    }
    if (tensionSnap) {
      emit(mobile ? 7 : 13, .82 + state.leashTension * .55);
      rippleLife.current = Math.max(rippleLife.current, .82);
    }

    for (let index = 0; index < particleCount; index += 1) {
      if (life.current[index] <= 0) continue;
      const offset = index * 3;
      life.current[index] -= delta;
      activePositions[offset] += velocities.current[offset] * delta;
      activePositions[offset + 1] += velocities.current[offset + 1] * delta;
      activePositions[offset + 2] += velocities.current[offset + 2] * delta;
      velocities.current[offset] *= 1 - delta * 1.8;
      velocities.current[offset + 1] -= delta * 3.4;
      velocities.current[offset + 2] *= 1 - delta * 1.55;
      if (life.current[index] <= 0 || activePositions[offset + 1] < -.08) {
        life.current[index] = 0;
        activePositions[offset + 1] = -20;
      }
    }
    attribute.needsUpdate = true;

    if (sprayMaterial.current) {
      sprayMaterial.current.opacity = THREE.MathUtils.damp(
        sprayMaterial.current.opacity,
        wipeout ? .82 : .42,
        7,
        delta,
      );
    }

    rippleLife.current = Math.max(0, rippleLife.current - delta * .92);
    if (ripple.current && rippleMaterial.current) {
      const progress = 1 - rippleLife.current;
      ripple.current.visible = rippleLife.current > .01;
      ripple.current.position.set(contact.x, .035, contact.z);
      ripple.current.scale.setScalar(.34 + progress * (1.35 + state.leashTension * .55));
      rippleMaterial.current.opacity = Math.sin(rippleLife.current * Math.PI) * .38;
    }

    previousWipeout.current = wipeout;
    previousTension.current = state.leashTension;
  });

  return (
    <>
      <points ref={spray} frustumCulled={false} renderOrder={7}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={sprayMaterial}
          map={texture}
          color="#c8fff8"
          size={mobile ? .09 : .075}
          sizeAttenuation
          transparent
          opacity={0}
          alphaTest={.025}
          depthWrite={false}
        />
      </points>
      <mesh ref={ripple} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={5}>
        <ringGeometry args={[.64, 1, 38]} />
        <meshBasicMaterial
          ref={rippleMaterial}
          color="#c6fff7"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </>
  );
}

function SurferRunoffEffects({ motion }: { motion: MutableRefObject<MotionState> }) {
  const quality = useRenderQuality();
  const mobile = useMemo(() => isMobileRenderer(), []);
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const particleCount = mobile
    ? quality === "reduced" ? 10 : quality === "high" ? 20 : 15
    : quality === "reduced" ? 18 : quality === "balanced" ? 26 : 34;
  const droplets = useRef<THREE.Points>(null);
  const material = useRef<THREE.PointsMaterial>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) values[index * 3 + 1] = -20;
    return values;
  }, [particleCount]);
  const velocities = useRef(new Float32Array(particleCount * 3));
  const life = useRef(new Float32Array(particleCount));
  const cursor = useRef(0);
  const emission = useRef(0);
  const soaked = useRef(false);
  const dropletTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 72;
    const context = canvas.getContext("2d");
    if (context) {
      context.save();
      context.translate(24, 36);
      context.scale(.68, 1);
      const gradient = context.createRadialGradient(-4, -10, 2, 0, 0, 31);
      gradient.addColorStop(0, "rgba(255,255,255,.98)");
      gradient.addColorStop(.22, "rgba(218,255,250,.92)");
      gradient.addColorStop(.62, "rgba(139,231,225,.38)");
      gradient.addColorStop(1, "rgba(139,231,225,0)");
      context.fillStyle = gradient;
      context.fillRect(-36, -36, 72, 72);
      context.restore();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  useEffect(() => {
    velocities.current = new Float32Array(particleCount * 3);
    life.current = new Float32Array(particleCount);
    cursor.current = 0;
    emission.current = 0;
  }, [particleCount]);

  useEffect(() => () => dropletTexture.dispose(), [dropletTexture]);

  useFrame((_, delta) => {
    const state = motion.current;
    const positionAttribute = droplets.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const activePositions = positionAttribute?.array as Float32Array | undefined;
    if (
      state.phase === "paddling"
      || state.phase === "riding"
      || state.phase === "wipeout"
      || state.waterDepth > .62
    ) soaked.current = true;
    if (state.wetness < .2) soaked.current = false;
    const shallowExit = state.phase === "wading" && state.waterDepth < .58;
    const draining = soaked.current && (state.phase === "shore" || shallowExit);
    const runoff = draining ? THREE.MathUtils.smoothstep(state.wetness, .24, .94) : 0;
    const motionRate = .72 + Math.min(state.speed, 5) * .16;

    if (activePositions && runoff > .02) {
      emission.current += delta * runoff * motionRate * (mobile ? 8 : 12) * (reducedMotion ? .62 : 1);
      if (emission.current >= 1) {
        const count = Math.min(mobile ? 2 : 3, Math.floor(emission.current));
        emission.current -= count;
        for (let particle = 0; particle < count; particle += 1) {
          const index = cursor.current++ % particleCount;
          const offset = index * 3;
          const boardDrop = Math.random() < .3;
          activePositions[offset] = boardDrop
            ? .5 + Math.random() * .34
            : (Math.random() - .5) * .58;
          activePositions[offset + 1] = boardDrop
            ? .24 + Math.random() * 1.78
            : .38 + Math.random() * 1.48;
          activePositions[offset + 2] = boardDrop
            ? (Math.random() - .5) * .18
            : (Math.random() - .5) * .34;
          velocities.current[offset] = (Math.random() - .5) * .14 + state.steer * .018;
          velocities.current[offset + 1] = -(.46 + Math.random() * .72);
          velocities.current[offset + 2] = (Math.random() - .5) * .12 - Math.min(state.speed, 5) * .018;
          life.current[index] = .5 + Math.random() * .54;
        }
      }
    } else {
      emission.current = 0;
    }

    if (activePositions && positionAttribute) {
      for (let index = 0; index < particleCount; index += 1) {
        if (life.current[index] <= 0) continue;
        const offset = index * 3;
        life.current[index] -= delta;
        activePositions[offset] += velocities.current[offset] * delta;
        activePositions[offset + 1] += velocities.current[offset + 1] * delta;
        activePositions[offset + 2] += velocities.current[offset + 2] * delta;
        velocities.current[offset + 1] -= delta * 1.55;
        velocities.current[offset] *= 1 - delta * .7;
        velocities.current[offset + 2] *= 1 - delta * .7;
        if (life.current[index] <= 0 || activePositions[offset + 1] < .025) {
          life.current[index] = 0;
          activePositions[offset + 1] = -20;
        }
      }
      positionAttribute.needsUpdate = true;
    }
    if (material.current) {
      material.current.opacity = THREE.MathUtils.damp(material.current.opacity, runoff * .82, runoff > material.current.opacity ? 9 : 3.8, delta);
      material.current.size = THREE.MathUtils.damp(material.current.size, mobile ? .052 : .044, 6, delta);
    }
  });

  return (
    <points ref={droplets} frustumCulled={false} renderOrder={7}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={material}
        map={dropletTexture}
        color="#c9fff8"
        size={.045}
        transparent
        opacity={0}
        alphaTest={.025}
        depthWrite={false}
        blending={THREE.NormalBlending}
        sizeAttenuation
      />
    </points>
  );
}

function SurferModel({
  motion,
  boardType,
  accent,
  onLeashTension,
  cameraMode,
  thermalKit,
}: {
  motion: MutableRefObject<MotionState>;
  boardType: BoardType;
  accent: string;
  onLeashTension: (tension: number) => void;
  cameraMode: CameraMode;
  thermalKit: ThermalKit;
}) {
  const root = useRef<THREE.Group>(null);
  const rig = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const board = useRef<THREE.Group>(null);
  const ankleJointRef = useRef<THREE.Object3D | null>(null);
  const contact = useRef<THREE.Mesh>(null);
  const boardDynamics = useRef({
    active: false,
    offset: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    rotation: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    anchor: new THREE.Vector3(),
    attachment: new THREE.Vector3(),
    pull: new THREE.Vector3(),
  });

  useFrame(({ clock }, delta) => {
    if (!root.current || !rig.current || !body.current || !board.current) return;
    const state = motion.current;
    const spec = BOARD_SPECS[boardType];
    const paddle = state.phase === "paddling";
    const riding = state.phase === "riding";
    const carrying = state.phase === "shore" || state.phase === "wading";
    const wading = state.phase === "wading";
    const wipeout = state.phase === "wipeout";
    const rideSettle = riding ? state.finish : 0;
    const rideCompression = THREE.MathUtils.clamp(
      state.compression
        + Math.abs(state.lateralForce) * .09
        + Math.max(0, -state.acceleration) * .07,
      0,
      1,
    ) * (1 - rideSettle * .82);
    const takeoffPlant = paddle
      ? THREE.MathUtils.smootherstep(state.takeoffCommit, .34, .94)
      : 0;
    const waterDepth = THREE.MathUtils.clamp(state.waterDepth, 0, 1);
    const carryBlend = carrying ? 1 - waterDepth : 0;
    const rebound = Math.sin((1 - state.impact) * Math.PI) * state.impact;
    const carryStride = carrying ? THREE.MathUtils.smoothstep(state.speed, .16, 1.35) * (1 - waterDepth * .42) : 0;
    const carryStep = Math.sin(clock.elapsedTime * (2.5 + state.speed * 1.55)) * carryStride;
    const bodyRigRoll = wipeout
      ? state.wipeoutProgress * (2.8 + state.wipeoutPower * 2.35)
        + Math.sin(clock.elapsedTime * 3.6) * state.wipeoutPower * .16
      : riding
        ? state.slip * state.rail * -.08 * (1 - rideSettle)
        : paddle
          ? Math.sin(clock.elapsedTime * 8) * state.shorebreak * .025
          : 0;
    const bodyRigYaw = riding
      ? state.slip * Math.sign(state.rail) * .13 + state.maneuverSpin
      : 0;
    const bodyRigLift = riding
      ? state.maneuverLift
      : paddle
        ? -state.duckDive * .42 + state.shorebreak * .055 + takeoffPlant * .08
        : wipeout
          ? -.18 - state.submersion * (.42 + state.wipeoutPower * .26)
            + Math.sin(clock.elapsedTime * (3.4 + state.wipeoutPower * 2.2)) * (.045 + state.wipeoutPower * .055)
          : 0;

    const bodyRotationX = paddle
      ? Math.PI / 2 - 0.1 + state.duckDive * .08 - takeoffPlant * .055
      : riding
        ? -0.18 + state.takeoff * 1.32 + rideSettle * .08 + state.facePosition * .045 - state.acceleration * .035
        : 0;
    body.current.rotation.x = THREE.MathUtils.damp(body.current.rotation.x, bodyRotationX, 8, delta);
    body.current.rotation.z = THREE.MathUtils.damp(
      body.current.rotation.z,
      wipeout ? 1.7 : riding ? (-state.balance * 0.3 + state.rail * .18 + state.maneuverSide * state.maneuver * 0.34) * (1 - rideSettle * .86) : 0,
      7,
      delta,
    );
    body.current.rotation.y = THREE.MathUtils.damp(
      body.current.rotation.y,
      riding ? state.maneuverSide * state.maneuver * 0.74 : 0,
      9,
      delta,
    );
    body.current.position.y = THREE.MathUtils.damp(body.current.position.y, paddle ? .44 - state.duckDive * .16 + takeoffPlant * .055 : riding ? .84 - state.takeoff * .34 - rideCompression * .15 + rebound * .08 + state.maneuverLift * .05 + rideSettle * .08 : wipeout ? .42 - state.submersion * (.28 + state.wipeoutPower * .18) + Math.sin(clock.elapsedTime * (4.1 + state.wipeoutPower * 1.8)) * (.035 + state.wipeoutPower * .035) : wading ? 1.02 - waterDepth * .045 + Math.sin(clock.elapsedTime * 2.1) * .012 * waterDepth : 1.02, 8, delta);
    body.current.position.z = THREE.MathUtils.damp(body.current.position.z, riding ? state.stance * 0.46 : 0, 7, delta);
    rig.current.rotation.z = THREE.MathUtils.damp(rig.current.rotation.z, bodyRigRoll, 9, delta);
    rig.current.rotation.y = THREE.MathUtils.damp(rig.current.rotation.y, bodyRigYaw, state.maneuverLift > .12 ? 13 : 8, delta);
    rig.current.position.y = THREE.MathUtils.damp(rig.current.position.y, bodyRigLift, state.maneuverLift > .08 || state.duckDive > .08 || wipeout ? 13 : 9, delta);

    const baseBoardX = carrying ? THREE.MathUtils.lerp(.68 + carryStep * .018, .04, waterDepth) : 0;
    const baseBoardY = carrying
      ? THREE.MathUtils.lerp(1.14 + Math.abs(carryStep) * .026, .16 + Math.sin(clock.elapsedTime * 2.1) * .012, waterDepth) + rig.current.position.y
      : paddle
        ? .16 - state.duckDive * .12 + takeoffPlant * .025 + rig.current.position.y
        : riding
          ? .16 - Math.abs(state.rail) * .035 * (1 - rideSettle) - rideCompression * .025 + rebound * .09 + rig.current.position.y
          : .13 + Math.sin(clock.elapsedTime * 3.5) * .025;
    const baseBoardRotationX = carrying
      ? THREE.MathUtils.lerp(Math.PI / 2 - .08, Math.sin(clock.elapsedTime * 2.1) * .012, waterDepth)
      : riding
        ? state.stance * -.05 + state.facePosition * -.085 + state.barrel * .025 + rebound * .06 + state.takeoff * .09 + state.maneuverLift * .2 + rideSettle * .025 - state.acceleration * .028
        : paddle
          ? state.duckDive * .3 - state.shorebreak * .035 + takeoffPlant * .065
          : 0;
    const baseBoardRotationY = riding
      ? state.maneuverSide * state.maneuver * .52
        + state.slip * Math.sign(state.rail) * .18
        - state.maneuverSpin * .22
        + rig.current.rotation.y
      : rig.current.rotation.y;
    const baseBoardRotationZ = (
      carrying
        ? (-.12 + carryStep * .026) * carryBlend
        : riding
          ? (state.rail * -.27 - state.maneuverSide * state.maneuver * .22 - state.lateralForce * .045) * (1 - rideSettle * .88)
          : 0
    ) + rig.current.rotation.z;
    const dynamics = boardDynamics.current;

    if (wipeout && !dynamics.active) {
      const throwSide = Math.sign(state.lineSide || state.rail || 1);
      const throwPower = 1 + state.impact * .78 + state.slip * .42 + state.wipeoutPower * .58;
      dynamics.active = true;
      dynamics.offset.set(
        board.current.position.x,
        board.current.position.y - baseBoardY,
        board.current.position.z,
      );
      dynamics.velocity.set(
        -throwSide * (1.28 + throwPower * .68),
        .52 + throwPower * .34,
        .42 + throwPower * .36,
      );
      dynamics.rotation.set(
        board.current.rotation.x,
        board.current.rotation.y,
        board.current.rotation.z,
      );
      dynamics.angularVelocity.set(
        .92 + throwPower * .44,
        -throwSide * (.72 + throwPower * .34),
        throwSide * (1.22 + throwPower * .52),
      );
    }

    if (wipeout) {
      const step = Math.min(delta, .034);
      const recovery = THREE.MathUtils.smoothstep(state.wipeout, 1.22, 1.8);
      const drag = Math.exp(-step * THREE.MathUtils.lerp(1.08, 4.6, recovery));
      const angularDrag = Math.exp(-step * THREE.MathUtils.lerp(1.28, 5.4, recovery));
      dynamics.velocity.x += (
        Math.sin(clock.elapsedTime * 2.7 + state.lineSide) * .18
        - dynamics.offset.x * (1.45 + recovery * 17)
      ) * step;
      dynamics.velocity.y += (
        -dynamics.offset.y * (7.8 + recovery * 18)
        - .28
      ) * step;
      dynamics.velocity.z += (
        Math.cos(clock.elapsedTime * 2.15 + .7) * .13
        - dynamics.offset.z * (1.18 + recovery * 16)
      ) * step;
      dynamics.velocity.multiplyScalar(drag);
      dynamics.offset.addScaledVector(dynamics.velocity, step);

      dynamics.angularVelocity.x += (-Math.sin(dynamics.rotation.x) * 1.35 - dynamics.rotation.x * recovery * 8.2) * step;
      dynamics.angularVelocity.y += (-dynamics.rotation.y * recovery * 7.4) * step;
      dynamics.angularVelocity.z += (-Math.sin(dynamics.rotation.z) * 1.52 - dynamics.rotation.z * recovery * 8.8) * step;
      dynamics.angularVelocity.multiplyScalar(angularDrag);
      dynamics.rotation.addScaledVector(dynamics.angularVelocity, step);

      board.current.position.set(
        baseBoardX + dynamics.offset.x,
        baseBoardY + dynamics.offset.y,
        dynamics.offset.z,
      );
      board.current.rotation.set(
        dynamics.rotation.x,
        dynamics.rotation.y,
        dynamics.rotation.z,
      );
      root.current.updateWorldMatrix(true, false);
      board.current.updateWorldMatrix(true, false);
      ankleJointRef.current?.updateWorldMatrix(true, false);

      if (ankleJointRef.current) {
        dynamics.anchor.set(0, 0, 0);
        ankleJointRef.current.localToWorld(dynamics.anchor);
        root.current.worldToLocal(dynamics.anchor);
        dynamics.attachment.set(0, .13, -spec.length * .43);
        board.current.localToWorld(dynamics.attachment);
        root.current.worldToLocal(dynamics.attachment);
        dynamics.pull.copy(dynamics.attachment).sub(dynamics.anchor);
        const leashDistance = dynamics.pull.length();
        const leashLength = spec.length * .88;
        const stretch = Math.max(0, leashDistance - leashLength);
        const nextTension = THREE.MathUtils.smootherstep(leashDistance, leashLength * .72, leashLength * 1.1);
        onLeashTension(THREE.MathUtils.damp(
          state.leashTension,
          nextTension,
          nextTension > state.leashTension ? 18 : 6.5,
          delta,
        ));
        if (stretch > 0.001) {
          dynamics.pull.multiplyScalar(1 / Math.max(.001, leashDistance));
          dynamics.offset.addScaledVector(dynamics.pull, -stretch * .28);
          dynamics.velocity.addScaledVector(dynamics.pull, -stretch * (10 + recovery * 9) * step);
        }
      }
    } else {
      dynamics.active = false;
      dynamics.offset.multiplyScalar(Math.exp(-delta * 9));
      dynamics.velocity.set(0, 0, 0);
      dynamics.angularVelocity.set(0, 0, 0);
      onLeashTension(THREE.MathUtils.damp(state.leashTension, 0, 8, delta));
      board.current.position.x = THREE.MathUtils.damp(board.current.position.x, baseBoardX, 8, delta);
      board.current.position.y = THREE.MathUtils.damp(board.current.position.y, baseBoardY, 8, delta);
      board.current.position.z = THREE.MathUtils.damp(board.current.position.z, 0, 8, delta);
      board.current.rotation.x = dampAngle(board.current.rotation.x, baseBoardRotationX, 8, delta);
      board.current.rotation.y = dampAngle(board.current.rotation.y, baseBoardRotationY, 9, delta);
      board.current.rotation.z = dampAngle(board.current.rotation.z, baseBoardRotationZ, 8, delta);
    }

    if (contact.current) {
      const material = contact.current.material as THREE.MeshBasicMaterial;
      const waterContact = 1 - THREE.MathUtils.smoothstep(state.maneuverLift, .08, .48);
      const targetOpacity = wading
        ? (.025 + waterDepth * .075) * THREE.MathUtils.smoothstep(waterDepth, .18, .72)
        : paddle
        ? (.09 + state.paddleEffort * .08) * (1 - state.duckDive * .75)
        : riding
          ? (.1 + Math.min(.16, state.speed * .007) + Math.abs(state.rail) * .07) * waterContact
          : wipeout ? .08 + state.leashTension * .08 : 0;
      material.opacity = THREE.MathUtils.damp(material.opacity, targetOpacity, 8, delta);
      contact.current.position.x = THREE.MathUtils.damp(contact.current.position.x, wipeout ? board.current.position.x : 0, 12, delta);
      contact.current.position.z = THREE.MathUtils.damp(contact.current.position.z, wipeout ? board.current.position.z : 0, 12, delta);
      contact.current.scale.x = THREE.MathUtils.damp(contact.current.scale.x, spec.width * (.7 + Math.abs(state.rail) * .12 + waterDepth * .08 + state.leashTension * .18), 8, delta);
      contact.current.scale.y = THREE.MathUtils.damp(contact.current.scale.y, spec.length * (.32 + Math.min(.12, state.speed * .004) + (wading ? waterDepth * .07 : 0) + state.leashTension * .08), 8, delta);
      contact.current.rotation.z = THREE.MathUtils.damp(contact.current.rotation.z, riding ? -state.rail * .12 : 0, 7, delta);
    }
  });

  return (
    <group ref={root}>
      <mesh ref={contact} position={[0, .025, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <circleGeometry args={[1, 30]} />
        <meshBasicMaterial color="#05252b" transparent opacity={0} depthWrite={false} blending={THREE.MultiplyBlending} />
      </mesh>
      <group ref={rig}>
        <SurfLeashCord motion={motion} boardType={boardType} rigRef={rig} boardRef={board} ankleJointRef={ankleJointRef} />
        <SurferRunoffEffects motion={motion} />
        <group ref={body} name="SurferVisualBody" position={[0, 1.02, 0]} visible={cameraMode !== "pov"}>
          <PremiumSurferBody motion={motion} accent={accent} ankleJointRef={ankleJointRef} thermalKit={thermalKit} />
        </group>
      </group>
      <group ref={board} position={[0, 0.16, 0]}>
        <PremiumSurfboard boardType={boardType} motion={motion} />
      </group>
      <TetheredBoardWaterEffects motion={motion} boardRef={board} rootRef={root} />
    </group>
  );
}

function WaveReadingGuide({
  motion,
  settings,
  character,
  mobile,
}: {
  motion: MutableRefObject<MotionState>;
  settings: SessionSettings;
  character: BreakCharacter;
  mobile: boolean;
}) {
  const crest = useRef<THREE.Mesh>(null);
  const crestMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const shoulder = useRef<THREE.Points>(null);
  const shoulderMaterial = useRef<THREE.PointsMaterial>(null);
  const pocketSeam = useRef<THREE.Mesh>(null);
  const pocketMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const landingMarker = useRef<THREE.Mesh>(null);
  const landingMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const lineSide = useRef(character.peel === 0 ? 1 : Math.sign(character.peel));
  const particleCount = mobile ? 18 : 34;
  const positions = useMemo(() => new Float32Array(particleCount * 3), [particleCount]);
  const coolColor = useMemo(() => new THREE.Color("#7fded5"), []);
  const readyColor = useMemo(() => new THREE.Color("#e7ffd5"), []);
  const pressureColor = useMemo(() => new THREE.Color("#ffd39a"), []);
  const crestTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.translate(64, 64);
      context.lineCap = "round";
      for (let arc = 0; arc < 18; arc += 1) {
        const angle = seededRandom(arc, 171) * Math.PI * 2;
        const length = .12 + seededRandom(arc, 172) * .28;
        const radius = 35 + seededRandom(arc, 173) * 15;
        context.beginPath();
        context.strokeStyle = `rgba(224,255,248,${.2 + seededRandom(arc, 174) * .55})`;
        context.lineWidth = 1.1 + seededRandom(arc, 175) * 2.4;
        context.arc(0, 0, radius, angle, angle + length);
        context.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const glintTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 28);
      gradient.addColorStop(0, "rgba(240,255,249,1)");
      gradient.addColorStop(.18, "rgba(179,249,237,.82)");
      gradient.addColorStop(1, "rgba(110,225,211,0)");
      context.fillStyle = gradient;
      context.save();
      context.translate(32, 32);
      context.rotate(-.28);
      context.scale(1, .24);
      context.fillRect(-30, -30, 60, 60);
      context.restore();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const pocketTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      const glow = context.createLinearGradient(0, 0, 96, 0);
      glow.addColorStop(0, "rgba(116,242,220,0)");
      glow.addColorStop(.38, "rgba(137,255,233,.14)");
      glow.addColorStop(.5, "rgba(226,255,247,.82)");
      glow.addColorStop(.62, "rgba(137,255,233,.14)");
      glow.addColorStop(1, "rgba(116,242,220,0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, 96, 256);
      context.globalCompositeOperation = "destination-out";
      for (let index = 0; index < 24; index += 1) {
        const y = seededRandom(index, 291) * 256;
        const radius = 3 + seededRandom(index, 292) * 8;
        context.beginPath();
        context.arc(48 + (seededRandom(index, 293) - .5) * 22, y, radius, 0, Math.PI * 2);
        context.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const landingTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.translate(64, 64);
      context.lineCap = "round";
      for (let ring = 0; ring < 3; ring += 1) {
        const radius = 22 + ring * 14;
        context.setLineDash([10 + ring * 2, 8]);
        context.lineDashOffset = ring * 5;
        context.strokeStyle = `rgba(255,224,174,${.82 - ring * .2})`;
        context.lineWidth = 3 - ring * .55;
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.stroke();
      }
      const core = context.createRadialGradient(0, 0, 1, 0, 0, 28);
      core.addColorStop(0, "rgba(255,239,204,.42)");
      core.addColorStop(1, "rgba(255,202,132,0)");
      context.setLineDash([]);
      context.fillStyle = core;
      context.fillRect(-32, -32, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  useEffect(() => {
    lineSide.current = character.peel === 0 ? 1 : Math.sign(character.peel);
  }, [character.peel]);

  useEffect(() => () => {
    crestTexture.dispose();
    glintTexture.dispose();
    pocketTexture.dispose();
    landingTexture.dispose();
  }, [crestTexture, glintTexture, landingTexture, pocketTexture]);

  useFrame(({ clock }, delta) => {
    const state = motion.current;
    const assist = settings.mode === "training" ? 1 : settings.mode === "advanced" ? .28 : .54;
    const mobileBoost = mobile ? 1.12 : 1;
    if (state.phase === "riding") lineSide.current = state.lineSide || lineSide.current;

    if (crest.current && crestMaterial.current) {
      const paddling = state.phase === "paddling";
      const read = THREE.MathUtils.smoothstep(state.takeoffRead, .18, .86);
      const targetOpacity = paddling ? read * (.12 + state.catchReady * .58) * assist * mobileBoost : 0;
      crestMaterial.current.opacity = THREE.MathUtils.damp(crestMaterial.current.opacity, targetOpacity, state.catchReady > .4 ? 12 : 5, delta);
      crestMaterial.current.color.lerp(state.catchReady > .42 ? readyColor : coolColor, 1 - Math.exp(-delta * 6));
      const pulse = 1 + Math.sin(clock.elapsedTime * (3.2 + state.catchReady * 2.8)) * (.025 + state.catchReady * .055);
      const crestScale = (.72 + read * .42) * pulse;
      crest.current.scale.setScalar(crestScale);
      crest.current.rotation.z = clock.elapsedTime * (.045 + state.catchReady * .04);
      crest.current.visible = crestMaterial.current.opacity > .006;
    }

    if (pocketSeam.current && pocketMaterial.current) {
      const riding = state.phase === "riding";
      const faceHeight = THREE.MathUtils.clamp(settings.waveHeight * 1.55, 1.45, 5.8) * (.82 + state.setEnergy * .3);
      const pocketOffset = THREE.MathUtils.clamp(-state.linePosition * 4.6 * lineSide.current, -7.2, 7.2);
      pocketSeam.current.position.x = THREE.MathUtils.damp(pocketSeam.current.position.x, pocketOffset, 7, delta);
      pocketSeam.current.position.y = THREE.MathUtils.damp(pocketSeam.current.position.y, faceHeight * .47, 6, delta);
      pocketSeam.current.position.z = THREE.MathUtils.damp(pocketSeam.current.position.z, 2.24 - state.barrel * .5 - state.sectionPressure * .14, 6, delta);
      pocketSeam.current.scale.x = THREE.MathUtils.damp(pocketSeam.current.scale.x, .72 + state.lineControl * .34, 6, delta);
      pocketSeam.current.scale.y = THREE.MathUtils.damp(pocketSeam.current.scale.y, faceHeight * (.58 + state.waveQuality * .08), 6, delta);
      pocketSeam.current.rotation.z = lineSide.current * (-.05 - state.sectionPressure * .045);
      const seamOpacity = riding
        ? assist * mobileBoost * (.055 + state.lineControl * .23 + state.sectionPressure * .18) * (1 - state.barrel * .58)
        : 0;
      pocketMaterial.current.opacity = THREE.MathUtils.damp(pocketMaterial.current.opacity, seamOpacity, riding ? 7 : 4, delta);
      pocketMaterial.current.color.lerp(state.sectionPressure > .5 ? pressureColor : coolColor, 1 - Math.exp(-delta * 5));
      pocketSeam.current.visible = pocketMaterial.current.opacity > .006;
    }

    if (landingMarker.current && landingMaterial.current) {
      const landingAssist = settings.mode === "training" ? .78 : settings.mode === "advanced" ? .3 : .54;
      const targetOpacity = state.phase === "riding" ? state.landingCue * landingAssist * mobileBoost : 0;
      landingMaterial.current.opacity = THREE.MathUtils.damp(landingMaterial.current.opacity, targetOpacity, targetOpacity > .02 ? 12 : 7, delta);
      landingMarker.current.position.x = THREE.MathUtils.damp(landingMarker.current.position.x, state.landingTarget * 1.35 + state.maneuverSide * .52, 11, delta);
      landingMarker.current.position.z = THREE.MathUtils.damp(landingMarker.current.position.z, 1.25 + state.maneuverProgress * 2.2, 10, delta);
      const markerScale = (.74 + state.landingWindow * 1.35) * (1 + Math.sin(clock.elapsedTime * 6.2) * .035);
      landingMarker.current.scale.setScalar(THREE.MathUtils.damp(landingMarker.current.scale.x, markerScale, 10, delta));
      landingMarker.current.rotation.z = clock.elapsedTime * .22 * lineSide.current;
      landingMarker.current.visible = landingMaterial.current.opacity > .006;
    }

    if (shoulder.current && shoulderMaterial.current) {
      const riding = state.phase === "riding";
      const targetOpacity = riding
        ? assist * mobileBoost * (.08 + state.waveQuality * .4 + Math.abs(state.rail) * .07 + state.sectionPressure * .22) * (1 - state.barrel * .42)
        : 0;
      shoulderMaterial.current.opacity = THREE.MathUtils.damp(shoulderMaterial.current.opacity, targetOpacity, riding ? 7 : 4, delta);
      shoulderMaterial.current.size = THREE.MathUtils.damp(shoulderMaterial.current.size, mobile ? .26 : .22 + state.waveQuality * .07, 5, delta);
      const attribute = shoulder.current.geometry.getAttribute("position") as THREE.BufferAttribute;
      const points = attribute.array as Float32Array;
      const faceHeight = THREE.MathUtils.clamp(settings.waveHeight * 1.55, 1.45, 5.8) * (.82 + state.setEnergy * .3);
      const guideSide = state.linePosition > .24 ? -lineSide.current : lineSide.current;
      for (let index = 0; index < particleCount; index += 1) {
        const progress = index / Math.max(1, particleCount - 1);
        const stream = (progress + clock.elapsedTime * (.055 + state.waveQuality * .045)) % 1;
        const offset = index * 3;
        points[offset] = guideSide * (1.45 + stream * 7.4) + Math.sin(index * 2.17 + clock.elapsedTime * 1.8) * .11;
        points[offset + 1] = faceHeight * (.31 + stream * .24) + Math.sin(index * 1.31 + clock.elapsedTime * 2.2) * .045;
        points[offset + 2] = 2.28 - stream * .4 - state.barrel * .22;
      }
      attribute.needsUpdate = true;
      shoulder.current.visible = shoulderMaterial.current.opacity > .006;
    }
  });

  return (
    <group>
      <mesh ref={crest} position={[0, .065, -.2]} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={4.4}>
        <planeGeometry args={[4.2, 4.2]} />
        <meshBasicMaterial
          ref={crestMaterial}
          map={crestTexture}
          color="#7fded5"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={pocketSeam} position={[0, 1.4, 2.2]} visible={false} renderOrder={4.35}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={pocketMaterial}
          map={pocketTexture}
          color="#7fded5"
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={landingMarker} position={[0, .08, 1.5]} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={4.45}>
        <planeGeometry args={[2.8, 2.8]} />
        <meshBasicMaterial
          ref={landingMaterial}
          map={landingTexture}
          color="#ffe0ae"
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <points ref={shoulder} visible={false} frustumCulled={false} renderOrder={4.5}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={shoulderMaterial}
          map={glintTexture}
          color="#baf8eb"
          size={.22}
          sizeAttenuation
          transparent
          opacity={0}
          alphaTest={.02}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

const FOOTPRINT_COUNT = 36;
const CARVE_TRACK_COUNT = 64;
const IMPACT_RING_COUNT = 10;
const BREAKING_FOAM_PATCH_LIMIT = 72;
const BREAKING_MIST_LIMIT = 112;

function WaterInteraction({ motion, settings, mobile }: { motion: MutableRefObject<MotionState>; settings: SessionSettings; mobile: boolean }) {
  const quality = useRenderQuality();
  const wake = useRef<THREE.Group>(null);
  const wakeMaterials = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const railSheets = useRef<Array<THREE.Mesh | null>>([]);
  const railSheetMaterials = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const paddleRipples = useRef<Array<THREE.Mesh | null>>([]);
  const paddleRippleMaterials = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const spray = useRef<THREE.Points>(null);
  const sprayMaterial = useRef<THREE.PointsMaterial>(null);
  const bubbles = useRef<THREE.Points>(null);
  const bubbleMaterial = useRef<THREE.PointsMaterial>(null);
  const particleCount = mobile
    ? quality === "reduced" ? 34 : quality === "high" ? 72 : 52
    : quality === "reduced" ? 72 : quality === "balanced" ? 112 : 152;
  const bubbleCount = mobile
    ? quality === "reduced" ? 20 : quality === "high" ? 42 : 30
    : quality === "reduced" ? 38 : quality === "balanced" ? 58 : 76;
  const positions = useMemo(() => {
    const values = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) values[index * 3 + 1] = -20;
    return values;
  }, [particleCount]);
  const velocities = useRef(new Float32Array(particleCount * 3));
  const life = useRef(new Float32Array(particleCount));
  const cursor = useRef(0);
  const emission = useRef(0);
  const previousManeuver = useRef(0);
  const previousLift = useRef(0);
  const previousTakeoff = useRef(0);
  const previousImpact = useRef(0);
  const previousWipeout = useRef(false);
  const previousPaddlePull = useRef([0, 0]);
  const paddleRippleState = useRef(Array.from({ length: 2 }, () => ({
    age: 10,
    duration: .8,
    intensity: 0,
    speed: 0,
  })));
  const bubblePositions = useMemo(() => {
    const values = new Float32Array(bubbleCount * 3);
    for (let index = 0; index < bubbleCount; index += 1) values[index * 3 + 1] = -20;
    return values;
  }, [bubbleCount]);
  const bubbleVelocities = useRef(new Float32Array(bubbleCount * 3));
  const bubbleLife = useRef(new Float32Array(bubbleCount));
  const bubbleCursor = useRef(0);
  const bubbleEmission = useRef(0);

  useEffect(() => {
    velocities.current = new Float32Array(particleCount * 3);
    life.current = new Float32Array(particleCount);
    cursor.current = 0;
    emission.current = 0;
  }, [particleCount]);

  useEffect(() => {
    bubbleVelocities.current = new Float32Array(bubbleCount * 3);
    bubbleLife.current = new Float32Array(bubbleCount);
    bubbleCursor.current = 0;
    bubbleEmission.current = 0;
  }, [bubbleCount]);

  const wakeTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      const fade = context.createLinearGradient(0, 0, 0, 256);
      fade.addColorStop(0, "rgba(255,255,255,0)");
      fade.addColorStop(.12, "rgba(230,255,250,.9)");
      fade.addColorStop(.62, "rgba(205,250,243,.42)");
      fade.addColorStop(1, "rgba(195,245,238,0)");
      context.fillStyle = fade;
      context.beginPath();
      context.moveTo(43, 0);
      context.bezierCurveTo(40, 64, 18, 167, 6, 256);
      context.lineTo(90, 256);
      context.bezierCurveTo(78, 167, 56, 64, 53, 0);
      context.closePath();
      context.fill();
      context.globalCompositeOperation = "destination-out";
      for (let index = 0; index < 34; index += 1) {
        const y = 28 + seededRandom(index, 41) * 215;
        const spread = 8 + (y / 256) * 31;
        const x = 48 + (seededRandom(index, 42) - .5) * spread * 1.6;
        context.beginPath();
        context.arc(x, y, 1.4 + seededRandom(index, 43) * 3.6, 0, Math.PI * 2);
        context.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const particleTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 30);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.34, "rgba(214,255,248,.95)");
      gradient.addColorStop(1, "rgba(214,255,248,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const railSheetTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      const body = context.createLinearGradient(64, 252, 64, 0);
      body.addColorStop(0, "rgba(232,255,251,.92)");
      body.addColorStop(.22, "rgba(198,251,243,.58)");
      body.addColorStop(.72, "rgba(160,239,230,.14)");
      body.addColorStop(1, "rgba(150,230,222,0)");
      context.fillStyle = body;
      context.beginPath();
      context.moveTo(57, 254);
      context.bezierCurveTo(42, 190, 20, 94, 2, 12);
      context.bezierCurveTo(34, 38, 74, 122, 70, 254);
      context.closePath();
      context.fill();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      for (let streak = 0; streak < 28; streak += 1) {
        const startX = 57 + (seededRandom(streak, 611) - .5) * 13;
        const endX = 4 + seededRandom(streak, 612) * 76;
        const endY = 4 + seededRandom(streak, 613) * 132;
        context.strokeStyle = `rgba(240,255,252,${(.12 + seededRandom(streak, 614) * .55).toFixed(2)})`;
        context.lineWidth = .7 + seededRandom(streak, 615) * 2.2;
        context.beginPath();
        context.moveTo(startX, 250 - seededRandom(streak, 616) * 18);
        context.quadraticCurveTo(44 + seededRandom(streak, 617) * 28, 156, endX, endY);
        context.stroke();
      }
      context.globalCompositeOperation = "destination-out";
      for (let gap = 0; gap < 22; gap += 1) {
        const x = 8 + seededRandom(gap, 621) * 70;
        const y = 18 + seededRandom(gap, 622) * 178;
        context.beginPath();
        context.ellipse(x, y, 1.5 + seededRandom(gap, 623) * 4.5, 5 + seededRandom(gap, 624) * 13, -.3, 0, Math.PI * 2);
        context.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const paddleRippleTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.translate(64, 64);
      context.scale(1, .62);
      context.lineCap = "round";
      context.shadowColor = "rgba(203,255,247,.42)";
      context.shadowBlur = 7;
      [
        { radius: 43, width: 3.8, alpha: .86, start: -.78, end: 3.72 },
        { radius: 34, width: 2.2, alpha: .48, start: -2.76, end: .9 },
        { radius: 50, width: 1.3, alpha: .28, start: .14, end: 2.98 },
      ].forEach(({ radius, width, alpha, start, end }) => {
        context.beginPath();
        context.arc(0, 0, radius, start, end);
        context.strokeStyle = `rgba(225,255,250,${alpha})`;
        context.lineWidth = width;
        context.stroke();
      });
      context.shadowBlur = 0;
      for (let drop = 0; drop < 17; drop += 1) {
        const angle = -.7 + seededRandom(drop, 641) * 4.35;
        const radius = 37 + seededRandom(drop, 642) * 19;
        const size = .8 + seededRandom(drop, 643) * 2.1;
        context.beginPath();
        context.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, size, 0, Math.PI * 2);
        context.fillStyle = `rgba(224,255,250,${(.16 + seededRandom(drop, 644) * .42).toFixed(2)})`;
        context.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const bubbleTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      const shell = context.createRadialGradient(27, 24, 2, 32, 32, 29);
      shell.addColorStop(0, "rgba(255,255,255,.92)");
      shell.addColorStop(.17, "rgba(225,255,251,.3)");
      shell.addColorStop(.58, "rgba(112,222,218,.08)");
      shell.addColorStop(.78, "rgba(205,255,250,.7)");
      shell.addColorStop(1, "rgba(205,255,250,0)");
      context.fillStyle = shell;
      context.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  useEffect(() => () => {
    bubbleTexture.dispose();
    paddleRippleTexture.dispose();
    particleTexture.dispose();
    railSheetTexture.dispose();
    wakeTexture.dispose();
  }, [bubbleTexture, paddleRippleTexture, particleTexture, railSheetTexture, wakeTexture]);

  useFrame(({ clock }, delta) => {
    const state = motion.current;
    const riding = state.phase === "riding";
    const paddling = state.phase === "paddling";
    const wipeout = state.phase === "wipeout";
    if (wake.current) {
      wake.current.visible = riding || paddling || wipeout;
      const speedScale = THREE.MathUtils.clamp(state.speed / 13, 0.2, 1.35);
      wake.current.scale.z = THREE.MathUtils.damp(wake.current.scale.z, paddling ? .28 + Math.min(.46, state.speed * .1) : speedScale, 6, delta);
      wake.current.scale.x = THREE.MathUtils.damp(wake.current.scale.x, riding ? 1 + Math.abs(state.rail) * .42 + state.slip * .3 : .72, 7, delta);
      wake.current.rotation.y = THREE.MathUtils.damp(wake.current.rotation.y, riding ? state.rail * -.11 - Math.sign(state.rail) * state.slip * .08 : 0, 7, delta);
      wake.current.position.y = Math.sin(clock.elapsedTime * 7.5) * 0.018 - state.duckDive * .22;
    }
    const waterContact = 1 - THREE.MathUtils.smoothstep(state.maneuverLift, .14, .5);
    const targetOpacity = riding
      ? (
        0.2
        + Math.min(0.38, state.speed * 0.018)
        + Math.abs(state.rail) * .12
        + state.slip * .16
        + Math.abs(state.lateralForce) * .065
        + Math.max(0, state.acceleration) * .045
      ) * waterContact
      : paddling
        ? (.045 + state.paddleEffort * .14 + Math.min(.08, state.speed * .018) + state.shorebreak * .16) * (1 - state.duckDive * .72)
        : 0;
    wakeMaterials.current.forEach((material, index) => {
      if (!material) return;
      const side = index === 0 ? -1 : 1;
      const loadedRail = index < 2 && Math.abs(state.rail) > .08 ? (Math.sign(state.rail) === side ? 1.22 : .54) : 1;
      const stagger = index > 1 ? 0.68 : loadedRail;
      material.opacity = THREE.MathUtils.damp(material.opacity, targetOpacity * stagger, 7, delta);
    });
    const railEnergy = riding
      ? THREE.MathUtils.smoothstep(state.speed, 6.5, 15.5)
        * (Math.abs(state.rail) * .72 + state.slip * .35 + state.compression * .12)
        * (1 + Math.abs(state.lateralForce) * .26 + Math.max(0, state.acceleration) * .14)
        * (1 + Math.max(0, state.facePosition) * .16)
        * waterContact
      : 0;
    const impactEnergy = riding ? Math.max(state.impact * .48, state.maneuver * .18) * waterContact : 0;
    const loadedSide = Math.abs(state.rail) > .06 ? -Math.sign(state.rail) : state.maneuverSide || 1;
    railSheets.current.forEach((sheet, index) => {
      const material = railSheetMaterials.current[index];
      if (!sheet || !material) return;
      const side = index === 0 ? -1 : 1;
      const sideLoad = side === loadedSide ? railEnergy : railEnergy * .08;
      const energy = THREE.MathUtils.clamp(sideLoad + impactEnergy * (state.impact > .55 ? 1 : side === loadedSide ? .72 : .28), 0, 1.15);
      const targetSheetOpacity = riding ? (.025 + energy * .46) * waterContact : 0;
      material.opacity = THREE.MathUtils.damp(material.opacity, targetSheetOpacity, targetSheetOpacity > material.opacity ? 13 : 6, delta);
      const widthScale = .34 + energy * .82;
      const heightScale = .18 + energy * 1.02;
      sheet.scale.x = THREE.MathUtils.damp(sheet.scale.x, widthScale, 10, delta);
      sheet.scale.y = THREE.MathUtils.damp(sheet.scale.y, heightScale, 10, delta);
      sheet.position.x = THREE.MathUtils.damp(sheet.position.x, side * (.27 + energy * .11), 11, delta);
      sheet.position.y = THREE.MathUtils.damp(sheet.position.y, .035 + 1.2 * heightScale, 11, delta);
      sheet.position.z = THREE.MathUtils.damp(sheet.position.z, -.42 - energy * .25, 10, delta);
      sheet.rotation.x = THREE.MathUtils.damp(sheet.rotation.x, -.44 - energy * .18, 9, delta);
      sheet.rotation.y = THREE.MathUtils.damp(sheet.rotation.y, side * (.16 + energy * .2), 9, delta);
      sheet.rotation.z = THREE.MathUtils.damp(sheet.rotation.z, side * (-.26 - energy * .28), 9, delta);
      sheet.visible = material.opacity > .004;
    });
    paddleRippleState.current.forEach((ripple, index) => {
      const mesh = paddleRipples.current[index];
      const material = paddleRippleMaterials.current[index];
      if (!mesh || !material) return;
      ripple.age += delta;
      const progress = THREE.MathUtils.clamp(ripple.age / Math.max(.01, ripple.duration), 0, 1);
      const active = progress < 1;
      const side = index === 0 ? -1 : 1;
      const bloom = THREE.MathUtils.smootherstep(progress, 0, .42);
      mesh.visible = active;
      mesh.position.x = side * (.57 + ripple.intensity * .07);
      mesh.position.y = .052 - state.duckDive * .2;
      mesh.position.z = .34 - progress * (.56 + ripple.speed * .26);
      mesh.scale.set(
        .48 + bloom * (1.18 + ripple.intensity * .3),
        .32 + bloom * (.74 + ripple.intensity * .18),
        1,
      );
      mesh.rotation.z = side * (.1 + progress * .05);
      material.opacity = active
        ? Math.pow(1 - progress, 1.45) * (.18 + ripple.intensity * .42) * (1 - state.duckDive * .82)
        : 0;
    });
    const positionAttribute = spray.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const particlePositions = positionAttribute?.array as Float32Array | undefined;
    const bubblePositionAttribute = bubbles.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const activeBubblePositions = bubblePositionAttribute?.array as Float32Array | undefined;

    const emitBubbles = (count: number, violent: boolean) => {
      if (!activeBubblePositions) return;
      for (let particle = 0; particle < count; particle += 1) {
        const index = bubbleCursor.current++ % bubbleCount;
        const offset = index * 3;
        const spread = violent ? 1.05 : .58;
        activeBubblePositions[offset] = (Math.random() - .5) * spread;
        activeBubblePositions[offset + 1] = -.72 + Math.random() * .58;
        activeBubblePositions[offset + 2] = (Math.random() - .5) * (violent ? 1.45 : .82);
        bubbleVelocities.current[offset] = (Math.random() - .5) * (violent ? .72 : .28);
        bubbleVelocities.current[offset + 1] = .38 + Math.random() * (violent ? .86 : .52);
        bubbleVelocities.current[offset + 2] = (Math.random() - .5) * (violent ? .58 : .22);
        bubbleLife.current[index] = .72 + Math.random() * (violent ? 1.05 : .68);
      }
    };

    const bubbleActive = state.duckDive > .025 || wipeout;
    if (bubbleActive) {
      bubbleEmission.current += delta * (wipeout ? 62 : 22 + state.duckDive * 42 + state.shorebreak * 18);
      if (bubbleEmission.current >= 1) {
        const count = Math.min(mobile ? 5 : 9, Math.floor(bubbleEmission.current));
        emitBubbles(count, wipeout);
        bubbleEmission.current -= count;
      }
    }
    if (wipeout && !previousWipeout.current) emitBubbles(mobile ? 10 : 20, true);
    if (activeBubblePositions) {
      for (let index = 0; index < bubbleCount; index += 1) {
        if (bubbleLife.current[index] <= 0) continue;
        const offset = index * 3;
        bubbleLife.current[index] -= delta;
        const shimmer = Math.sin(clock.elapsedTime * 5.8 + index * 1.73) * .055;
        activeBubblePositions[offset] += (bubbleVelocities.current[offset] + shimmer) * delta;
        activeBubblePositions[offset + 1] += bubbleVelocities.current[offset + 1] * delta;
        activeBubblePositions[offset + 2] += bubbleVelocities.current[offset + 2] * delta;
        bubbleVelocities.current[offset] *= 1 - delta * .42;
        bubbleVelocities.current[offset + 2] *= 1 - delta * .4;
        if (bubbleLife.current[index] <= 0 || activeBubblePositions[offset + 1] > .48) {
          bubbleLife.current[index] = 0;
          activeBubblePositions[offset + 1] = -20;
        }
      }
      if (bubblePositionAttribute) bubblePositionAttribute.needsUpdate = true;
    }
    if (bubbleMaterial.current) {
      bubbleMaterial.current.opacity = THREE.MathUtils.damp(bubbleMaterial.current.opacity, bubbleActive ? .78 : 0, bubbleActive ? 12 : 3.8, delta);
      bubbleMaterial.current.size = THREE.MathUtils.damp(bubbleMaterial.current.size, wipeout ? .16 : .11, 8, delta);
    }

    const emit = (count: number, impact: boolean) => {
      if (!particlePositions) return;
      for (let particle = 0; particle < count; particle += 1) {
        const index = cursor.current++ % particleCount;
        const offset = index * 3;
        const railSide = Math.abs(state.rail) > 0.1 ? -Math.sign(state.rail) : Math.random() > 0.5 ? 1 : -1;
        particlePositions[offset] = railSide * (0.22 + Math.random() * (impact ? 0.5 : 0.22));
        particlePositions[offset + 1] = state.maneuverLift + 0.08 + Math.random() * 0.18;
        particlePositions[offset + 2] = impact ? Math.random() * 0.7 - 0.15 : -0.32 - Math.random() * 0.8;
        velocities.current[offset] = railSide * (0.75 + state.slip * 1.4 + Math.abs(state.rail) * state.speed * .055 + Math.random() * (impact ? 2.7 : 1.25));
        velocities.current[offset + 1] = 0.65 + state.compression * .42 + state.slip * .5 + Math.random() * (impact ? 2.6 : 1.35) + state.barrel * 0.5;
        velocities.current[offset + 2] = -(1.4 + Math.random() * (impact ? 3.6 : 2.2));
        life.current[index] = impact ? 0.9 + Math.random() * 0.35 : 0.46 + Math.random() * 0.38;
      }
    };
    const emitPaddle = (count: number, side: number) => {
      if (!particlePositions) return;
      for (let particle = 0; particle < count; particle += 1) {
        const index = cursor.current++ % particleCount;
        const offset = index * 3;
        const spread = (Math.random() - .5) * .18;
        particlePositions[offset] = side * (.52 + Math.random() * .19) + spread;
        particlePositions[offset + 1] = .035 + Math.random() * .105;
        particlePositions[offset + 2] = .22 + (Math.random() - .5) * .3;
        velocities.current[offset] = side * (.32 + Math.random() * .72) + spread;
        velocities.current[offset + 1] = .28 + Math.random() * (.58 + state.paddleEffort * .34);
        velocities.current[offset + 2] = -(.32 + Math.random() * .9 + state.speed * .05);
        life.current[index] = .3 + Math.random() * .34;
      }
    };

    const paddlePhase = clock.elapsedTime * (4.2 + state.paddleEffort * 2.4);
    const paddleWave = Math.sin(paddlePhase);
    const paddlePulls = [
      paddling ? Math.max(0, -paddleWave) * state.paddleEffort * (1 - state.duckDive) : 0,
      paddling ? Math.max(0, paddleWave) * state.paddleEffort * (1 - state.duckDive) : 0,
    ];
    paddlePulls.forEach((pull, index) => {
      if (pull > .38 && previousPaddlePull.current[index] <= .38) {
        const ripple = paddleRippleState.current[index];
        ripple.age = 0;
        ripple.duration = .62 + state.paddleEffort * .26;
        ripple.intensity = .38 + state.paddleEffort * .62;
        ripple.speed = state.speed;
        emitPaddle(mobile ? 4 : 8, index === 0 ? -1 : 1);
      }
      previousPaddlePull.current[index] = pull;
    });

    if (riding) {
      emission.current += delta * (
        Math.abs(state.rail) * 22
        + state.slip * 26
        + state.compression * 5
        + state.barrel * 12
        + Math.abs(state.lateralForce) * 9
        + Math.max(0, state.acceleration) * 6
        + Math.max(0, state.speed - 9) * 0.8
      );
      if (emission.current >= 1) {
        const count = Math.min(5, Math.floor(emission.current));
        emit(count, false);
        emission.current -= count;
      }
      if (state.maneuver > 0.82 && previousManeuver.current <= 0.82) emit(mobile ? 12 : 24, true);
      if (state.maneuverLift > .2 && previousLift.current <= .2) emit(mobile ? 10 : 20, true);
      if (state.maneuverLift < .08 && previousLift.current >= .08) emit(mobile ? 16 : 30, true);
      if (state.takeoff > .82 && previousTakeoff.current <= .82) emit(mobile ? 8 : 15, true);
    } else if (paddling) {
      emission.current += delta * (state.shorebreak * 34 + state.duckDive * 12);
      if (emission.current >= 1) {
        const count = Math.min(4, Math.floor(emission.current));
        emit(count, false);
        emission.current -= count;
      }
      if (state.impact > .62 && previousImpact.current <= .62) emit(mobile ? 14 : 28, true);
    }
    previousManeuver.current = state.maneuver;
    previousLift.current = state.maneuverLift;
    previousTakeoff.current = state.takeoff;
    previousImpact.current = state.impact;
    previousWipeout.current = wipeout;

    if (!particlePositions) return;
    const relativeWind = THREE.MathUtils.degToRad(settings.windDirection - settings.coastHeading);
    const sprayWind = THREE.MathUtils.clamp(settings.windSpeed / 24, 0, 1.5);
    const sprayWindX = Math.sin(relativeWind) * sprayWind * .72;
    const sprayWindZ = Math.cos(relativeWind) * sprayWind * .34;
    for (let index = 0; index < particleCount; index += 1) {
      if (life.current[index] <= 0) continue;
      const offset = index * 3;
      life.current[index] -= delta;
      particlePositions[offset] += (velocities.current[offset] + sprayWindX) * delta;
      particlePositions[offset + 1] += velocities.current[offset + 1] * delta;
      particlePositions[offset + 2] += (velocities.current[offset + 2] + sprayWindZ) * delta;
      velocities.current[offset + 1] -= delta * 3.4;
      velocities.current[offset] *= 1 - delta * 0.55;
      if (life.current[index] <= 0 || particlePositions[offset + 1] < -0.08) particlePositions[offset + 1] = -20;
    }
    if (positionAttribute) positionAttribute.needsUpdate = true;
    if (sprayMaterial.current) {
      const sprayOpacity = riding
        ? Math.min(1, .78 + state.slip * .22)
        : paddling
          ? (.34 + state.paddleEffort * .38 + state.shorebreak * .18) * (1 - state.duckDive * .72)
          : 0;
      const spraySize = riding
        ? .24 + state.slip * .1 + state.impact * .08
        : paddling ? .115 + state.paddleEffort * .035 + state.shorebreak * .03 : .14;
      sprayMaterial.current.opacity = THREE.MathUtils.damp(sprayMaterial.current.opacity, sprayOpacity, 7, delta);
      sprayMaterial.current.size = THREE.MathUtils.damp(sprayMaterial.current.size, spraySize, 7, delta);
    }
  });

  return (
    <group ref={wake}>
      {[-0.24, 0.24].map((x, index) => (
        <mesh key={x} position={[x, 0.035, -2.9]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.2, 5.8]} />
          <meshBasicMaterial
            ref={(material) => { wakeMaterials.current[index] = material; }}
            map={wakeTexture}
            color={index ? "#d9fff7" : "#9eece2"}
            transparent
            opacity={0}
            depthWrite={false}
            alphaTest={.02}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
      {[0, 1].map((index) => (
        <mesh key={index} position={[0, 0.045, -1.3 - index * 1.85]} rotation={[-Math.PI / 2, 0, 0]} scale={[1 + index * 0.6, 1.45 + index * 0.85, 1]}>
          <ringGeometry args={[0.3, 0.78, 28]} />
          <meshBasicMaterial
            ref={(material) => { wakeMaterials.current[index + 2] = material; }}
            color="#cafff7"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {[-1, 1].map((side, index) => (
        <mesh
          key={`paddle-ripple-${side}`}
          ref={(mesh) => { paddleRipples.current[index] = mesh; }}
          position={[side * .57, .052, .34]}
          rotation={[-Math.PI / 2, 0, side * .1]}
          visible={false}
          frustumCulled={false}
          renderOrder={4.4}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={(material) => { paddleRippleMaterials.current[index] = material; }}
            map={paddleRippleTexture}
            color={index ? "#d8fff8" : "#a9f3e8"}
            transparent
            opacity={0}
            alphaTest={.018}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
      {[-1, 1].map((side, index) => (
        <mesh
          key={`rail-sheet-${side}`}
          ref={(mesh) => { railSheets.current[index] = mesh; }}
          position={[side * .27, .25, -.42]}
          rotation={[-.44, side * .16, side * -.26]}
          scale={[.34, .18, 1]}
          visible={false}
          frustumCulled={false}
          renderOrder={4.6}
        >
          <planeGeometry args={[1.5, 2.4]} />
          <meshBasicMaterial
            ref={(material) => { railSheetMaterials.current[index] = material; }}
            map={railSheetTexture}
            color={index ? "#d9fff8" : "#a9f4e9"}
            side={THREE.DoubleSide}
            transparent
            opacity={0}
            alphaTest={.018}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
      <points ref={spray} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={sprayMaterial}
          map={particleTexture}
          color="#d8fff8"
          size={0.24}
          sizeAttenuation
          transparent
          opacity={0}
          alphaTest={0.03}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
      <points ref={bubbles} frustumCulled={false} renderOrder={4.7}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[bubblePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={bubbleMaterial}
          map={bubbleTexture}
          color="#bffdf5"
          size={.11}
          sizeAttenuation
          transparent
          opacity={0}
          alphaTest={.025}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

function BreakingWhitewaterField({
  motion,
  settings,
  character,
  target,
  mobile,
}: {
  motion: MutableRefObject<MotionState>;
  settings: SessionSettings;
  character: BreakCharacter;
  target: MutableRefObject<THREE.Group | null>;
  mobile: boolean;
}) {
  const quality = useRenderQuality();
  const tideResponse = useMemo(
    () => tideResponseForBreak(settings.tide, character),
    [character, settings.tide],
  );
  const patchCount = mobile
    ? quality === "reduced" ? 24 : quality === "high" ? 40 : 32
    : quality === "reduced" ? 42 : quality === "balanced" ? 56 : BREAKING_FOAM_PATCH_LIMIT;
  const mistCount = mobile
    ? quality === "reduced" ? 30 : quality === "high" ? 54 : 42
    : quality === "reduced" ? 58 : quality === "balanced" ? 82 : BREAKING_MIST_LIMIT;
  const foamMesh = useRef<THREE.InstancedMesh>(null);
  const mist = useRef<THREE.Points>(null);
  const mistMaterial = useRef<THREE.PointsMaterial>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const foamColor = useMemo(() => new THREE.Color("#d8fff7"), []);
  const foamTint = useMemo(() => new THREE.Color(), []);
  const emission = useRef(0);
  const patchCursor = useRef(0);
  const mistCursor = useRef(0);
  const wasRiding = useRef(false);
  const previousImpact = useRef(0);
  const patches = useRef(Array.from({ length: BREAKING_FOAM_PATCH_LIMIT }, () => ({
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    heading: 0,
    width: 0,
    length: 0,
    age: 0,
    maxAge: 1,
    intensity: 0,
    seed: 0,
  })));
  const mistPositions = useMemo(() => {
    const values = new Float32Array(mistCount * 3);
    for (let index = 0; index < mistCount; index += 1) values[index * 3 + 1] = -100;
    return values;
  }, [mistCount]);
  const mistColors = useMemo(() => new Float32Array(mistCount * 3), [mistCount]);
  const mistVelocities = useRef(new Float32Array(mistCount * 3));
  const mistLife = useRef(new Float32Array(mistCount));
  const mistMaxLife = useRef(new Float32Array(mistCount));

  const foamTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      const body = context.createLinearGradient(0, 0, 0, 128);
      body.addColorStop(0, "rgba(224,255,249,0)");
      body.addColorStop(.12, "rgba(236,255,252,.76)");
      body.addColorStop(.44, "rgba(210,251,244,.9)");
      body.addColorStop(.82, "rgba(191,244,236,.38)");
      body.addColorStop(1, "rgba(184,237,230,0)");
      context.fillStyle = body;
      context.beginPath();
      context.moveTo(7, 20);
      for (let section = 0; section <= 16; section += 1) {
        const x = 7 + section * 15.1;
        const y = 15 + seededRandom(section, 711) * 24;
        context.lineTo(x, y);
      }
      for (let section = 16; section >= 0; section -= 1) {
        const x = 7 + section * 15.1;
        const y = 95 + seededRandom(section, 712) * 22;
        context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
      context.globalCompositeOperation = "destination-out";
      for (let hole = 0; hole < 74; hole += 1) {
        const x = 10 + seededRandom(hole, 713) * 236;
        const y = 18 + seededRandom(hole, 714) * 94;
        const radiusX = 1.4 + seededRandom(hole, 715) * 8.5;
        const radiusY = .8 + seededRandom(hole, 716) * 4.2;
        context.beginPath();
        context.ellipse(x, y, radiusX, radiusY, (seededRandom(hole, 717) - .5) * .7, 0, Math.PI * 2);
        context.fill();
      }
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      for (let vein = 0; vein < 27; vein += 1) {
        const x = 8 + seededRandom(vein, 718) * 240;
        const y = 18 + seededRandom(vein, 719) * 86;
        context.strokeStyle = `rgba(248,255,254,${(.18 + seededRandom(vein, 720) * .58).toFixed(2)})`;
        context.lineWidth = .6 + seededRandom(vein, 721) * 2.2;
        context.beginPath();
        context.moveTo(x - 8 - seededRandom(vein, 722) * 18, y - 5);
        context.quadraticCurveTo(x, y + (seededRandom(vein, 723) - .5) * 18, x + 10 + seededRandom(vein, 724) * 25, y + 7);
        context.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }, []);

  const mistTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      const glow = context.createRadialGradient(29, 27, 1, 32, 32, 29);
      glow.addColorStop(0, "rgba(255,255,255,.96)");
      glow.addColorStop(.2, "rgba(224,255,250,.7)");
      glow.addColorStop(.55, "rgba(183,244,237,.2)");
      glow.addColorStop(1, "rgba(175,236,231,0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  useEffect(() => {
    mistVelocities.current = new Float32Array(mistCount * 3);
    mistLife.current = new Float32Array(mistCount);
    mistMaxLife.current = new Float32Array(mistCount);
    mistCursor.current = 0;
    const mesh = foamMesh.current;
    if (mesh) {
      for (let index = 0; index < patchCount; index += 1) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(.001);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        mesh.setColorAt(index, foamTint.setRGB(0, 0, 0));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [dummy, foamTint, mistCount, patchCount]);

  useEffect(() => () => {
    foamTexture.dispose();
    mistTexture.dispose();
  }, [foamTexture, mistTexture]);

  useFrame(({ clock }, delta) => {
    const crest = target.current;
    const mesh = foamMesh.current;
    const mistPoints = mist.current;
    if (!crest || !mesh || !mistPoints) return;
    const state = motion.current;
    const riding = state.phase === "riding";
    const elapsed = clock.elapsedTime;
    const transport = primaryWaveVelocityAt(crest.position.x, crest.position.z, elapsed, settings, character);
    const normalX = transport.x / Math.max(.001, transport.speed);
    const normalZ = transport.z / Math.max(.001, transport.speed);
    const tangentX = normalZ;
    const tangentZ = -normalX;
    const faceHeight = THREE.MathUtils.clamp(settings.waveHeight * tideResponse.faceScale * 1.55, 1.35, 5.8) * (.78 + state.setEnergy * .32);
    const breakEnergy = THREE.MathUtils.clamp(
      (
        .24
        + state.waveQuality * .42
        + state.sectionPressure * .26
        + state.barrel * .18
        + Math.abs(state.rail) * .08
      ) * (.94 + (tideResponse.powerScale - 1) * .55),
      .18,
      1.15,
    );
    const mistPositionAttribute = mistPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    const mistColorAttribute = mistPoints.geometry.getAttribute("color") as THREE.BufferAttribute;
    const activeMistPositions = mistPositionAttribute.array as Float32Array;
    const activeMistColors = mistColorAttribute.array as Float32Array;

    const emitMist = (sourceX: number, sourceZ: number, spread: number, energy: number, count: number) => {
      for (let particle = 0; particle < count; particle += 1) {
        const index = mistCursor.current++ % mistCount;
        const offset = index * 3;
        const tangentScatter = (Math.random() - .5) * spread;
        activeMistPositions[offset] = sourceX + tangentX * tangentScatter - normalX * Math.random() * .55;
        activeMistPositions[offset + 1] = crest.position.y + faceHeight * (.42 + Math.random() * .5);
        activeMistPositions[offset + 2] = sourceZ + tangentZ * tangentScatter - normalZ * Math.random() * .55;
        mistVelocities.current[offset] = normalX * transport.speed * (.14 + Math.random() * .13) + tangentX * (Math.random() - .5) * 1.3;
        mistVelocities.current[offset + 1] = .8 + energy * 1.35 + Math.random() * 1.25;
        mistVelocities.current[offset + 2] = normalZ * transport.speed * (.14 + Math.random() * .13) + tangentZ * (Math.random() - .5) * 1.3;
        const lifespan = .58 + Math.random() * .78 + energy * .28;
        mistLife.current[index] = lifespan;
        mistMaxLife.current[index] = lifespan;
      }
    };

    const emitPatch = (impactBoost = 0) => {
      const patch = patches.current[patchCursor.current++ % patchCount];
      const tangentSpread = (Math.random() - .5) * (15 + settings.waveHeight * 3.4);
      const normalScatter = .25 + Math.random() * (1.4 + settings.waveHeight * .3);
      patch.x = crest.position.x + tangentX * tangentSpread - normalX * normalScatter;
      patch.z = crest.position.z + tangentZ * tangentSpread - normalZ * normalScatter;
      const advection = transport.speed * (.34 + Math.random() * .15 + impactBoost * .035);
      const sideDrift = state.lineSide * (.18 + state.sectionPressure * .4) + (Math.random() - .5) * .52;
      patch.vx = normalX * advection + tangentX * sideDrift;
      patch.vz = normalZ * advection + tangentZ * sideDrift;
      patch.heading = Math.atan2(normalX, normalZ);
      patch.width = 2.4 + Math.random() * 2.8 + settings.waveHeight * .34 + impactBoost * .6;
      patch.length = 1.5 + Math.random() * 2.2 + breakEnergy * 1.25 + impactBoost * .9;
      patch.maxAge = (mobile ? 3.5 : 4.5) + Math.random() * (mobile ? 1.7 : 2.5) + breakEnergy * .65;
      patch.age = patch.maxAge;
      patch.intensity = THREE.MathUtils.clamp(.46 + breakEnergy * .46 + impactBoost * .18 + Math.random() * .16, .48, 1.2);
      patch.seed = Math.random() * Math.PI * 2;
      emitMist(
        patch.x,
        patch.z,
        1.2 + settings.waveHeight * .34,
        breakEnergy + impactBoost,
        mobile ? 1 : 2 + Math.round(impactBoost),
      );
    };

    if (riding) {
      emission.current += delta * (5.2 + breakEnergy * 7.4 + state.sectionPressure * 2.8);
      const burstLimit = mobile ? 2 : 4;
      let emitted = 0;
      while (emission.current >= 1 && emitted < burstLimit) {
        emitPatch();
        emission.current -= 1;
        emitted += 1;
      }
      if (!wasRiding.current) {
        const takeoffBurst = mobile ? 3 : 6;
        for (let index = 0; index < takeoffBurst; index += 1) emitPatch(.34);
      }
      if (state.impact > .72 && previousImpact.current <= .72) {
        const impactBurst = mobile ? 2 : 4;
        for (let index = 0; index < impactBurst; index += 1) emitPatch(.72);
      }
    } else {
      emission.current = 0;
    }
    wasRiding.current = riding;
    previousImpact.current = state.impact;

    for (let index = 0; index < patchCount; index += 1) {
      const patch = patches.current[index];
      patch.age = Math.max(0, patch.age - delta);
      if (patch.age <= 0) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(.001);
        foamTint.setRGB(0, 0, 0);
      } else {
        const progress = 1 - patch.age / Math.max(.001, patch.maxAge);
        const rise = THREE.MathUtils.smootherstep(progress, 0, .08);
        const fall = THREE.MathUtils.smoothstep(patch.age / patch.maxAge, 0, .34);
        const fade = rise * fall;
        patch.x += patch.vx * delta;
        patch.z += patch.vz * delta;
        patch.vx *= 1 - delta * .055;
        patch.vz *= 1 - delta * .055;
        const surface = waveHeightAt(patch.x, patch.z, elapsed, settings, character);
        dummy.position.set(patch.x, surface + .06, patch.z);
        dummy.rotation.set(-Math.PI / 2, 0, -patch.heading + Math.sin(elapsed * .44 + patch.seed) * .026);
        dummy.scale.set(
          patch.width * (1 + progress * .72) * fade,
          patch.length * (1 + progress * 1.45) * fade,
          1,
        );
        foamTint.copy(foamColor).multiplyScalar(fade * patch.intensity);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, foamTint);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const relativeWind = THREE.MathUtils.degToRad(settings.windDirection - settings.coastHeading);
    const windForce = THREE.MathUtils.clamp(settings.windSpeed / 28, 0, 1.45);
    const windX = Math.sin(relativeWind) * windForce * .85;
    const windZ = Math.cos(relativeWind) * windForce * .42;
    let activeMist = 0;
    for (let index = 0; index < mistCount; index += 1) {
      const offset = index * 3;
      if (mistLife.current[index] <= 0) {
        activeMistPositions[offset + 1] = -100;
        activeMistColors[offset] = 0;
        activeMistColors[offset + 1] = 0;
        activeMistColors[offset + 2] = 0;
        continue;
      }
      mistLife.current[index] -= delta;
      activeMistPositions[offset] += (mistVelocities.current[offset] + windX) * delta;
      activeMistPositions[offset + 1] += mistVelocities.current[offset + 1] * delta;
      activeMistPositions[offset + 2] += (mistVelocities.current[offset + 2] + windZ) * delta;
      mistVelocities.current[offset] *= 1 - delta * .5;
      mistVelocities.current[offset + 1] -= delta * 2.45;
      mistVelocities.current[offset + 2] *= 1 - delta * .5;
      const lifeFade = THREE.MathUtils.smoothstep(
        mistLife.current[index] / Math.max(.001, mistMaxLife.current[index]),
        0,
        .72,
      );
      activeMistColors[offset] = .82 * lifeFade;
      activeMistColors[offset + 1] = 1 * lifeFade;
      activeMistColors[offset + 2] = .96 * lifeFade;
      const surface = waveHeightAt(activeMistPositions[offset], activeMistPositions[offset + 2], elapsed, settings, character);
      if (mistLife.current[index] <= 0 || activeMistPositions[offset + 1] <= surface + .02) {
        mistLife.current[index] = 0;
        activeMistPositions[offset + 1] = -100;
      } else {
        activeMist += 1;
      }
    }
    mistPositionAttribute.needsUpdate = true;
    mistColorAttribute.needsUpdate = true;
    if (mistMaterial.current) {
      mistMaterial.current.opacity = THREE.MathUtils.damp(mistMaterial.current.opacity, activeMist > 0 ? .72 : 0, activeMist > 0 ? 10 : 4, delta);
      mistMaterial.current.size = THREE.MathUtils.damp(mistMaterial.current.size, .18 + breakEnergy * .1, 6, delta);
    }
  });

  return (
    <group>
      <instancedMesh ref={foamMesh} args={[undefined, undefined, patchCount]} frustumCulled={false} renderOrder={3.85}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={foamTexture}
          transparent
          opacity={.72}
          alphaTest={.018}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <points ref={mist} frustumCulled={false} renderOrder={4.1}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[mistPositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[mistColors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={mistMaterial}
          map={mistTexture}
          size={.2}
          sizeAttenuation
          vertexColors
          transparent
          opacity={0}
          alphaTest={.02}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

function BoardTrack({
  motion,
  target,
  settings,
  character,
  mobile,
}: {
  motion: MutableRefObject<MotionState>;
  target: MutableRefObject<THREE.Group | null>;
  settings: SessionSettings;
  character: BreakCharacter;
  mobile: boolean;
}) {
  const quality = useRenderQuality();
  const markCount = mobile
    ? quality === "reduced" ? 20 : quality === "high" ? 40 : 30
    : quality === "reduced" ? 40 : quality === "balanced" ? 52 : CARVE_TRACK_COUNT;
  const trackMesh = useRef<THREE.InstancedMesh>(null);
  const rippleMesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const previousPosition = useRef(new THREE.Vector3());
  const traveled = useRef(0);
  const cursor = useRef(0);
  const rippleCursor = useRef(0);
  const wasRiding = useRef(false);
  const previousImpact = useRef(0);
  const marks = useRef(Array.from({ length: CARVE_TRACK_COUNT }, () => ({ x: 0, z: 0, heading: 0, width: 0, length: 0, age: 0, maxAge: 1, intensity: 0 })));
  const ripples = useRef(Array.from({ length: IMPACT_RING_COUNT }, () => ({ x: 0, z: 0, age: 0, maxAge: 1, offset: 0 })));
  const foamColor = useMemo(() => new THREE.Color("#bffcf1"), []);
  const fadedColor = useMemo(() => new THREE.Color(), []);
  const trackTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      const fade = context.createLinearGradient(0, 0, 0, 256);
      fade.addColorStop(0, "rgba(255,255,255,0)");
      fade.addColorStop(.14, "rgba(255,255,255,.94)");
      fade.addColorStop(.58, "rgba(225,255,249,.58)");
      fade.addColorStop(1, "rgba(212,255,247,0)");
      context.strokeStyle = fade;
      context.lineWidth = 16;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(64, 4);
      context.bezierCurveTo(55, 72, 80, 142, 62, 252);
      context.stroke();
      context.lineWidth = 5;
      context.globalAlpha = .7;
      context.beginPath();
      context.moveTo(42, 38);
      context.bezierCurveTo(60, 92, 34, 177, 49, 244);
      context.stroke();
      context.beginPath();
      context.moveTo(84, 32);
      context.bezierCurveTo(68, 102, 94, 170, 77, 239);
      context.stroke();
      context.globalAlpha = 1;
      for (let index = 0; index < 48; index += 1) {
        const y = 24 + seededRandom(index, 51) * 220;
        const x = 64 + (seededRandom(index, 52) - .5) * (28 + y * .15);
        context.fillStyle = `rgba(235,255,251,${(.18 + seededRandom(index, 53) * .48).toFixed(2)})`;
        context.beginPath();
        context.arc(x, y, 1 + seededRandom(index, 54) * 2.8, 0, Math.PI * 2);
        context.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  useEffect(() => {
    const current = target.current?.position;
    if (current) previousPosition.current.copy(current);
    [trackMesh.current, rippleMesh.current].forEach((mesh) => {
      if (!mesh) return;
      for (let index = 0; index < mesh.count; index += 1) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(.001);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        mesh.setColorAt(index, fadedColor.setRGB(0, 0, 0));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const material = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      material.forEach((item) => { item.needsUpdate = true; });
    });
    return () => trackTexture.dispose();
  }, [dummy, fadedColor, target, trackTexture]);

  useFrame(({ clock }, delta) => {
    const current = target.current?.position;
    if (!current || !trackMesh.current || !rippleMesh.current) return;
    const state = motion.current;
    const riding = state.phase === "riding";
    if (riding && !wasRiding.current) {
      previousPosition.current.copy(current);
      traveled.current = 0;
    }
    const deltaX = current.x - previousPosition.current.x;
    const deltaZ = current.z - previousPosition.current.z;
    const distance = Math.hypot(deltaX, deltaZ);
    if (riding && distance < 3) {
      traveled.current += distance;
      const spacing = mobile ? .82 : .58;
      if (traveled.current >= spacing) {
        traveled.current %= spacing;
        const mark = marks.current[cursor.current++ % markCount];
        mark.x = current.x;
        mark.z = current.z;
        mark.heading = Math.atan2(deltaX, deltaZ);
        mark.width = .52
          + Math.abs(state.rail) * .74
          + state.slip * .38
          + Math.abs(state.lateralForce) * .16;
        mark.length = 1.05 + state.speed * .075;
        mark.maxAge = mobile ? 3.5 : 5.1;
        mark.age = mark.maxAge;
        mark.intensity = THREE.MathUtils.clamp(
          .48
            + state.speed * .025
            + Math.abs(state.rail) * .3
            + state.slip * .18
            + Math.abs(state.lateralForce) * .12
            + Math.max(0, state.acceleration) * .08,
          .48,
          1.12,
        );
      }
    } else if (!riding) {
      traveled.current = 0;
    }

    if (riding && state.impact > .78 && previousImpact.current <= .78) {
      for (let ring = 0; ring < 2; ring += 1) {
        const ripple = ripples.current[rippleCursor.current++ % IMPACT_RING_COUNT];
        ripple.x = current.x;
        ripple.z = current.z;
        ripple.maxAge = 1.35 + ring * .28;
        ripple.age = ripple.maxAge;
        ripple.offset = ring * .42;
      }
    }
    previousImpact.current = state.impact;
    wasRiding.current = riding;
    previousPosition.current.copy(current);

    for (let index = 0; index < markCount; index += 1) {
      const mark = marks.current[index];
      mark.age = Math.max(0, mark.age - delta);
      if (mark.age <= 0) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(.001);
        fadedColor.setRGB(0, 0, 0);
      } else {
        const fade = THREE.MathUtils.smoothstep(mark.age, 0, .72);
        const surface = waveHeightAt(mark.x, mark.z, clock.elapsedTime, settings, character);
        dummy.position.set(mark.x, surface + .055, mark.z);
        dummy.rotation.set(-Math.PI / 2, 0, -mark.heading);
        dummy.scale.set(mark.width * fade, mark.length * fade, 1);
        fadedColor.copy(foamColor).multiplyScalar(fade * mark.intensity);
      }
      dummy.updateMatrix();
      trackMesh.current?.setMatrixAt(index, dummy.matrix);
      trackMesh.current?.setColorAt(index, fadedColor);
    }
    trackMesh.current.instanceMatrix.needsUpdate = true;
    if (trackMesh.current.instanceColor) trackMesh.current.instanceColor.needsUpdate = true;

    ripples.current.forEach((ripple, index) => {
      ripple.age = Math.max(0, ripple.age - delta);
      if (ripple.age <= 0) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(.001);
        fadedColor.setRGB(0, 0, 0);
      } else {
        const elapsed = ripple.maxAge - ripple.age + ripple.offset;
        const fade = THREE.MathUtils.smoothstep(ripple.age, 0, .48);
        const surface = waveHeightAt(ripple.x, ripple.z, clock.elapsedTime, settings, character);
        const scale = .74 + elapsed * 3.2;
        dummy.position.set(ripple.x, surface + .07, ripple.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.setScalar(scale);
        fadedColor.copy(foamColor).multiplyScalar(fade * .9);
      }
      dummy.updateMatrix();
      rippleMesh.current?.setMatrixAt(index, dummy.matrix);
      rippleMesh.current?.setColorAt(index, fadedColor);
    });
    rippleMesh.current.instanceMatrix.needsUpdate = true;
    if (rippleMesh.current.instanceColor) rippleMesh.current.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={trackMesh} args={[undefined, undefined, markCount]} frustumCulled={false} renderOrder={4}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={trackTexture} transparent opacity={.58} alphaTest={.025} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={rippleMesh} args={[undefined, undefined, IMPACT_RING_COUNT]} frustumCulled={false} renderOrder={4}>
        <ringGeometry args={[.68, 1, mobile ? 20 : 36]} />
        <meshBasicMaterial transparent opacity={.48} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  );
}

function FootprintTrail({
  motion,
  targetPosition,
  playerHeading,
  tide,
  sandColor,
}: {
  motion: MutableRefObject<MotionState>;
  targetPosition: MutableRefObject<THREE.Vector3>;
  playerHeading: MutableRefObject<number>;
  tide: number;
  sandColor: string;
}) {
  const quality = useRenderQuality();
  const mobile = useMemo(() => isMobileRenderer(), []);
  const footprintCount = mobile
    ? quality === "reduced" ? 14 : quality === "high" ? 24 : 19
    : quality === "reduced" ? 22 : quality === "balanced" ? 29 : FOOTPRINT_COUNT;
  const grainCount = mobile
    ? quality === "reduced" ? 10 : quality === "high" ? 22 : 16
    : quality === "reduced" ? 18 : quality === "balanced" ? 28 : 38;
  const depressionMesh = useRef<THREE.InstancedMesh>(null);
  const rimMesh = useRef<THREE.InstancedMesh>(null);
  const grains = useRef<THREE.Points>(null);
  const grainMaterial = useRef<THREE.PointsMaterial>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const rimDummy = useMemo(() => new THREE.Object3D(), []);
  const previousPosition = useRef(new THREE.Vector3());
  const traveled = useRef(0);
  const cursor = useRef(0);
  const footSide = useRef(-1);
  const prints = useRef(Array.from({ length: FOOTPRINT_COUNT }, () => ({
    x: 0,
    y: -100,
    z: 0,
    age: 0,
    maxAge: 1,
    side: 1,
    heading: 0,
    moisture: 0,
    strength: 0,
    widthScale: 1,
    lengthScale: 1,
  })));
  const footprintTextures = useMemo(() => {
    const createCanvas = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 192;
      return canvas;
    };
    const drawFoot = (context: CanvasRenderingContext2D, stroke: boolean) => {
      context.clearRect(0, 0, 96, 192);
      context.fillStyle = "rgba(255,255,255,.92)";
      context.strokeStyle = "rgba(255,255,255,.78)";
      context.lineWidth = 5;
      const shape = (x: number, y: number, rx: number, ry: number, rotation: number) => {
        context.beginPath();
        context.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
        if (stroke) context.stroke();
        else context.fill();
      };
      shape(48, 128, 20, 42, -.05);
      shape(49, 58, 26, 34, .04);
      [22, 35, 48, 61, 73].forEach((x, index) => {
        shape(x, 19 + Math.abs(index - 2) * 3, 6.3 - Math.abs(index - 2) * .42, 8.7 - Math.abs(index - 2) * .68, 0);
      });
    };
    const depressionCanvas = createCanvas();
    const depressionContext = depressionCanvas.getContext("2d");
    if (depressionContext) drawFoot(depressionContext, false);
    const rimCanvas = createCanvas();
    const rimContext = rimCanvas.getContext("2d");
    if (rimContext) drawFoot(rimContext, true);
    const depression = new THREE.CanvasTexture(depressionCanvas);
    const rim = new THREE.CanvasTexture(rimCanvas);
    depression.colorSpace = THREE.SRGBColorSpace;
    rim.colorSpace = THREE.SRGBColorSpace;
    return { depression, rim };
  }, []);
  const grainTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(24, 24, 2, 24, 24, 22);
      gradient.addColorStop(0, "rgba(255,255,255,.96)");
      gradient.addColorStop(.34, "rgba(255,255,255,.72)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 48, 48);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const grainPositions = useMemo(() => {
    const values = new Float32Array(grainCount * 3);
    for (let index = 0; index < grainCount; index += 1) values[index * 3 + 1] = -100;
    return values;
  }, [grainCount]);
  const grainVelocities = useRef(new Float32Array(grainCount * 3));
  const grainLife = useRef(new Float32Array(grainCount));
  const grainCursor = useRef(0);
  const sandBase = useMemo(() => new THREE.Color(sandColor), [sandColor]);
  const wetDepression = useMemo(() => new THREE.Color(sandColor).multiplyScalar(.34), [sandColor]);
  const dryDepression = useMemo(() => new THREE.Color(sandColor).multiplyScalar(.52), [sandColor]);
  const wetRim = useMemo(() => new THREE.Color(sandColor).lerp(new THREE.Color("#c6ece2"), .28), [sandColor]);
  const dryRim = useMemo(() => new THREE.Color(sandColor).lerp(new THREE.Color("#fff0ca"), .22), [sandColor]);
  const grainColor = useMemo(() => new THREE.Color(sandColor).lerp(new THREE.Color("#fff1cf"), .3), [sandColor]);
  const depressionColor = useMemo(() => new THREE.Color(), []);
  const rimColor = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const current = targetPosition.current;
    previousPosition.current.copy(current);
    [depressionMesh.current, rimMesh.current].forEach((mesh) => {
      if (!mesh) return;
      for (let index = 0; index < mesh.count; index += 1) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(.001);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        mesh.setColorAt(index, sandBase);
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    prints.current.forEach((print) => { print.age = 0; });
  }, [dummy, footprintCount, sandBase, targetPosition]);

  useEffect(() => {
    grainVelocities.current = new Float32Array(grainCount * 3);
    grainLife.current = new Float32Array(grainCount);
    grainCursor.current = 0;
  }, [grainCount]);

  useEffect(() => () => {
    footprintTextures.depression.dispose();
    footprintTextures.rim.dispose();
    grainTexture.dispose();
  }, [footprintTextures, grainTexture]);

  useFrame((_, delta) => {
    if (!depressionMesh.current || !rimMesh.current) return;
    const current = targetPosition.current;
    const state = motion.current;
    const stepDistance = current.distanceTo(previousPosition.current);
    const tideShift = shorelineShiftForTide(tide);
    const coastalZ = current.z - tideShift;
    const movementX = stepDistance > .001 ? (current.x - previousPosition.current.x) / stepDistance : 0;
    const movementZ = stepDistance > .001 ? (current.z - previousPosition.current.z) / stepDistance : 0;
    if (state.phase === "shore" && state.speed > .4 && stepDistance < 2.2 && coastalZ > 10 && coastalZ < 69) {
      traveled.current += stepDistance;
      const spacing = .54 + state.run * .2;
      if (traveled.current > spacing) {
        const side = footSide.current;
        footSide.current *= -1;
        traveled.current %= spacing;
        const movementHeading = stepDistance > .008
          ? Math.atan2(movementX, movementZ)
          : playerHeading.current;
        const gaitIndex = cursor.current;
        const gaitNoise = Math.sin(gaitIndex * 1.618 + current.x * .031 + current.z * .017);
        const toeOut = side * (.052 + state.run * .026) + gaitNoise * .018;
        const rightX = Math.cos(movementHeading);
        const rightZ = -Math.sin(movementHeading);
        const forwardX = Math.sin(movementHeading);
        const forwardZ = Math.cos(movementHeading);
        const print = prints.current[cursor.current++ % footprintCount];
        const lateralSpacing = .165 + state.run * .025 + Math.abs(gaitNoise) * .008;
        const strideLag = .04 + state.run * .025 + (side > 0 ? .006 : -.006);
        print.x = current.x + rightX * side * lateralSpacing - forwardX * strideLag;
        print.z = current.z + rightZ * side * lateralSpacing - forwardZ * strideLag;
        print.y = THREE.MathUtils.lerp(-.39, -.465, THREE.MathUtils.smoothstep(coastalZ, 24, 36));
        print.moisture = 1 - THREE.MathUtils.smoothstep(coastalZ, 20, 39);
        print.maxAge = 10 + print.moisture * 10;
        print.age = print.maxAge;
        print.side = side;
        print.heading = movementHeading + toeOut;
        print.strength = THREE.MathUtils.clamp(.62 + state.run * .22 + print.moisture * .18, .58, 1);
        print.widthScale = .94 + gaitNoise * .035 + state.run * .025;
        print.lengthScale = .96 - gaitNoise * .025 + state.run * .055;

        const particlePositions = grains.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
        const activeGrains = particlePositions?.array as Float32Array | undefined;
        if (activeGrains && particlePositions) {
          const emitCount = Math.max(1, Math.round((2 + state.run * 3) * (1 - print.moisture * .82)));
          for (let particle = 0; particle < emitCount; particle += 1) {
            const index = grainCursor.current++ % grainCount;
            const offset = index * 3;
            const lateral = (Math.random() - .5) * (.34 + state.run * .2);
            const kickBack = .08 + Math.random() * (.18 + state.run * .24);
            activeGrains[offset] = print.x + rightX * lateral;
            activeGrains[offset + 1] = print.y + .025 + Math.random() * .045;
            activeGrains[offset + 2] = print.z + rightZ * lateral;
            grainVelocities.current[offset] = -movementX * kickBack + rightX * (Math.random() - .5) * .16;
            grainVelocities.current[offset + 1] = .12 + Math.random() * (.2 + state.run * .18);
            grainVelocities.current[offset + 2] = -movementZ * kickBack + rightZ * (Math.random() - .5) * .16;
            grainLife.current[index] = .22 + Math.random() * (.2 + state.run * .12);
          }
          particlePositions.needsUpdate = true;
        }
      }
    } else if (state.phase !== "shore" || stepDistance >= 2.2) {
      traveled.current = 0;
    }
    previousPosition.current.copy(current);

    for (let index = 0; index < footprintCount; index += 1) {
      const print = prints.current[index];
      print.age = Math.max(0, print.age - delta);
      if (print.age <= 0 || print.z - tideShift <= 9.7) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(.001);
        depressionColor.setRGB(0, 0, 0);
        rimColor.setRGB(0, 0, 0);
        dummy.updateMatrix();
        depressionMesh.current.setMatrixAt(index, dummy.matrix);
        rimMesh.current.setMatrixAt(index, dummy.matrix);
      } else {
        const fade = THREE.MathUtils.smoothstep(print.age, 0, Math.min(3.2, print.maxAge * .28));
        const depressionTarget = print.moisture > .5 ? wetDepression : dryDepression;
        const rimTarget = print.moisture > .5 ? wetRim : dryRim;
        depressionColor.copy(sandBase).lerp(depressionTarget, fade * print.strength);
        rimColor.copy(sandBase).lerp(rimTarget, fade * (.44 + print.strength * .36));
        dummy.position.set(print.x, print.y, print.z);
        dummy.rotation.set(-Math.PI / 2, 0, -print.heading);
        dummy.scale.set(
          print.side * .31 * (.96 + print.strength * .05) * print.widthScale,
          .58 * (1 + print.strength * .035) * print.lengthScale,
          1,
        );
        dummy.updateMatrix();
        depressionMesh.current.setMatrixAt(index, dummy.matrix);
        rimDummy.position.set(print.x, print.y + .003, print.z);
        rimDummy.rotation.set(-Math.PI / 2, 0, -print.heading);
        rimDummy.scale.set(
          print.side * .31 * (.96 + print.strength * .05) * print.widthScale * 1.055,
          .58 * (1 + print.strength * .035) * print.lengthScale * 1.055,
          1,
        );
        rimDummy.updateMatrix();
        rimMesh.current.setMatrixAt(index, rimDummy.matrix);
      }
      depressionMesh.current.setColorAt(index, depressionColor);
      rimMesh.current.setColorAt(index, rimColor);
    }
    depressionMesh.current.instanceMatrix.needsUpdate = true;
    rimMesh.current.instanceMatrix.needsUpdate = true;
    if (depressionMesh.current.instanceColor) depressionMesh.current.instanceColor.needsUpdate = true;
    if (rimMesh.current.instanceColor) rimMesh.current.instanceColor.needsUpdate = true;

    const grainPositionAttribute = grains.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const activeGrainPositions = grainPositionAttribute?.array as Float32Array | undefined;
    let activeParticleStrength = 0;
    if (activeGrainPositions && grainPositionAttribute) {
      for (let index = 0; index < grainCount; index += 1) {
        if (grainLife.current[index] <= 0) continue;
        const offset = index * 3;
        grainLife.current[index] -= delta;
        activeParticleStrength = Math.max(activeParticleStrength, grainLife.current[index]);
        activeGrainPositions[offset] += grainVelocities.current[offset] * delta;
        activeGrainPositions[offset + 1] += grainVelocities.current[offset + 1] * delta;
        activeGrainPositions[offset + 2] += grainVelocities.current[offset + 2] * delta;
        grainVelocities.current[offset + 1] -= delta * .72;
        grainVelocities.current[offset] *= 1 - delta * 1.8;
        grainVelocities.current[offset + 2] *= 1 - delta * 1.8;
        if (grainLife.current[index] <= 0 || activeGrainPositions[offset + 1] < -.49) {
          grainLife.current[index] = 0;
          activeGrainPositions[offset + 1] = -100;
        }
      }
      grainPositionAttribute.needsUpdate = true;
    }
    if (grainMaterial.current) {
      grainMaterial.current.opacity = THREE.MathUtils.damp(grainMaterial.current.opacity, activeParticleStrength > 0 ? .58 : 0, activeParticleStrength > 0 ? 10 : 5, delta);
      grainMaterial.current.size = THREE.MathUtils.damp(grainMaterial.current.size, mobile ? .036 : .029, 6, delta);
    }
  });

  return (
    <group>
      <instancedMesh ref={depressionMesh} args={[undefined, undefined, footprintCount]} frustumCulled={false} renderOrder={3}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={footprintTextures.depression}
          color="#ffffff"
          transparent
          opacity={.58}
          alphaTest={.08}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-2}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh ref={rimMesh} args={[undefined, undefined, footprintCount]} frustumCulled={false} renderOrder={3.1}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={footprintTextures.rim}
          color="#ffffff"
          transparent
          opacity={.3}
          alphaTest={.045}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-3}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <points ref={grains} frustumCulled={false} renderOrder={4}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[grainPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={grainMaterial}
          map={grainTexture}
          color={grainColor}
          size={.03}
          sizeAttenuation
          transparent
          opacity={0}
          alphaTest={.04}
          depthWrite={false}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    vDirection = normalize(position);
    vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clipPosition.xyww;
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uCloud;
  uniform float uWind;
  uniform vec2 uWindVector;
  uniform float uLight;
  uniform float uSunHeight;
  uniform vec3 uSunDirection;
  uniform vec3 uHazeColor;
  varying vec3 vDirection;

  const float PI = 3.14159265359;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float cloudNoise(vec2 p) {
    float value = noise(p) * .56;
    value += noise(p * 2.03 + 7.4) * .28;
    value += noise(p * 4.11 - 3.7) * .16;
    return value;
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float height = direction.y;
    float longitude = atan(direction.z, direction.x) / (PI * 2.0);
    float latitude = asin(clamp(direction.y, -1.0, 1.0)) / PI;
    float windSpeed = clamp(uWind / 24.0, 0.0, 1.5);
    vec2 drift = uWindVector * uTime * (.006 + windSpeed * .012) + vec2(0.0, uTime * .0018);
    vec2 cloudUv = vec2(longitude * 8.4, latitude * 7.2) + drift;
    float body = cloudNoise(cloudUv);
    float billow = noise(cloudUv * vec2(1.52, 1.24) + vec2(-uTime * .002, 11.0));
    float field = body * .78 + billow * .22;

    float cloudBand = smoothstep(-.015, .12, height) * (1.0 - smoothstep(.76, .96, height));
    float highWisp = smoothstep(.42, .72, height) * (1.0 - smoothstep(.9, 1.0, height));
    float threshold = mix(.91, .37, uCloud);
    float density = smoothstep(threshold, threshold + .13, field) * cloudBand;
    float wisps = smoothstep(.66, .86, noise(cloudUv * 3.1 + vec2(uTime * .009, -4.0))) * highWisp * uCloud * .32;
    density = clamp(density * smoothstep(.025, .16, uCloud) + wisps, 0.0, 1.0);

    vec3 sunDirection = normalize(uSunDirection);
    float sunFacing = max(0.0, dot(direction, sunDirection));
    float warmFacing = pow(sunFacing, 9.0);
    float cloudEdge = smoothstep(.03, .28, density) * (1.0 - smoothstep(.48, .92, density));
    vec3 cloudShadow = mix(vec3(.105, .135, .16), vec3(.22, .27, .28), uLight);
    vec3 cloudLit = mix(vec3(.53, .58, .59), vec3(.94, .96, .92), uLight);
    vec3 cloudColor = mix(cloudShadow, cloudLit, smoothstep(.18, .86, field));
    cloudColor += vec3(1.0, .42, .2) * warmFacing * cloudEdge * (1.0 - smoothstep(.28, .72, uSunHeight)) * .68;
    cloudColor += vec3(.82, .94, 1.0) * cloudEdge * pow(sunFacing, 22.0) * (.2 + uLight * .5);
    float cloudAlpha = density * mix(.48, .9, uCloud);

    float upperHorizon = smoothstep(-.045, .035, height);
    float horizon = exp(-abs(height) * 19.0) * upperHorizon;
    float hazeAlpha = horizon * (.035 + uCloud * .13 + windSpeed * .035);
    vec3 color = uHazeColor;
    float alpha = hazeAlpha;

    float daylight = smoothstep(-.035, .085, uSunHeight);
    float sunDisc = smoothstep(.9987, .99955, dot(direction, sunDirection)) * daylight;
    float sunCorona = pow(sunFacing, 88.0) * daylight;
    vec3 sunColor = mix(vec3(1.0, .34, .13), vec3(1.0, .92, .63), smoothstep(.02, .34, uSunHeight));
    float sunLayer = max(sunDisc, sunCorona * .34) * (1.0 - cloudAlpha * .82);
    color = mix(color, sunColor, sunDisc + sunCorona * .44);
    alpha = max(alpha, sunLayer);

    float night = 1.0 - smoothstep(.015, .16, uSunHeight);
    vec3 moonDirection = normalize(-sunDirection + vec3(.07, .035, -.025));
    float moonFacing = max(0.0, dot(direction, moonDirection));
    float moonDisc = smoothstep(.99905, .99962, moonFacing) * night;
    float moonHalo = pow(moonFacing, 110.0) * night;
    float lunarDetail = noise(direction.xz * 170.0 + direction.yy * 48.0);
    vec3 moonColor = mix(vec3(.42, .53, .61), vec3(.82, .91, .94), .55 + lunarDetail * .45);
    float moonLayer = max(moonDisc, moonHalo * .19) * (1.0 - cloudAlpha * .7);
    color = mix(color, moonColor, moonDisc * (.64 + lunarDetail * .3) + moonHalo * .25);
    alpha = max(alpha, moonLayer);

    color = mix(color, cloudColor, cloudAlpha);
    alpha = max(alpha, cloudAlpha);
    alpha *= smoothstep(-.12, .025, height);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, .94));
  }
`;

function CoastalAtmosphere({
  cloudCover,
  windSpeed,
  windDirection,
  coastHeading,
  light,
  sunHeight,
  sunPosition,
  hazeColor,
}: {
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
  coastHeading: number;
  light: number;
  sunHeight: number;
  sunPosition: [number, number, number];
  hazeColor: string;
}) {
  const dome = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const quality = useRenderQuality();
  const mobile = useMemo(() => isMobileRenderer(), []);
  const segments = (mobile
    ? quality === "reduced" ? [22, 12] : quality === "high" ? [36, 18] : [30, 16]
    : quality === "reduced" ? [32, 16] : quality === "balanced" ? [40, 20] : [48, 24]) as [number, number];
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uCloud: { value: 0 },
    uWind: { value: 0 },
    uWindVector: { value: new THREE.Vector2(1, 0) },
    uLight: { value: 1 },
    uSunHeight: { value: 1 },
    uSunDirection: { value: new THREE.Vector3(0, 1, -1).normalize() },
    uHazeColor: { value: new THREE.Color("#8ba9ac") },
  }), []);

  useFrame(({ camera, clock }, delta) => {
    if (dome.current) dome.current.position.copy(camera.position);
    if (!material.current) return;
    const values = material.current.uniforms;
    values.uTime.value = clock.elapsedTime;
    values.uCloud.value = THREE.MathUtils.damp(values.uCloud.value, cloudCover / 100, 1.7, delta);
    values.uWind.value = windSpeed;
    const relativeWind = THREE.MathUtils.degToRad(windDirection - coastHeading);
    values.uWindVector.value.set(Math.sin(relativeWind), Math.cos(relativeWind));
    values.uLight.value = light;
    values.uSunHeight.value = sunHeight;
    values.uSunDirection.value.set(...sunPosition).normalize();
    values.uHazeColor.value.set(hazeColor);
  });

  return (
    <mesh ref={dome} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[310, segments[0], segments[1]]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={ATMOSPHERE_VERTEX}
        fragmentShader={ATMOSPHERE_FRAGMENT}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

const PRECIPITATION_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uWind;
  uniform vec2 uWindVector;
  uniform float uSnow;
  uniform float uOpacity;
  attribute float aSeed;
  varying float vSnow;
  varying float vAlpha;

  void main() {
    float fallSpeed = mix(.66, .085, uSnow) * (.72 + aSeed * .56);
    float cycle = fract(position.y * .5 + .5 - uTime * fallSpeed + aSeed);
    vec3 worldPosition;
    worldPosition.x = cameraPosition.x + position.x * 38.0;
    worldPosition.y = cameraPosition.y - 5.0 + cycle * 25.0;
    worldPosition.z = cameraPosition.z + position.z * 42.0;
    worldPosition.xz += (1.0 - cycle) * uWindVector * 8.5;
    worldPosition.x += sin(uTime * .8 + aSeed * 31.0 + cycle * 6.0) * uSnow * 1.45;
    worldPosition.z += cos(uTime * .52 + aSeed * 19.0) * uSnow * .72;
    vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
    float depthScale = clamp(24.0 / -viewPosition.z, .58, 1.7);
    gl_PointSize = mix(8.5, 5.8, uSnow) * depthScale * (.72 + aSeed * .5);
    gl_Position = projectionMatrix * viewPosition;
    vSnow = uSnow;
    vAlpha = uOpacity * smoothstep(0.0, .08, cycle) * (1.0 - smoothstep(.92, 1.0, cycle));
  }
`;

const PRECIPITATION_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uWind;
  uniform vec3 uColor;
  varying float vSnow;
  varying float vAlpha;

  void main() {
    vec2 point = gl_PointCoord - .5;
    vec2 rainPoint = point;
    rainPoint.x += rainPoint.y * uWind * .42;
    float rain = smoothstep(.115, .018, abs(rainPoint.x)) * smoothstep(.51, .07, abs(rainPoint.y));
    float snow = smoothstep(.5, .11, length(point));
    snow *= .72 + smoothstep(.42, .08, length(point + vec2(.12, -.1))) * .28;
    float alpha = mix(rain, snow, vSnow) * vAlpha;
    if (alpha < .012) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function WeatherEffects({ weatherCode, windSpeed, windDirection, coastHeading }: { weatherCode: number; windSpeed: number; windDirection: number; coastHeading: number }) {
  const precipitation = useRef<THREE.Points>(null);
  const precipitationMaterial = useRef<THREE.ShaderMaterial>(null);
  const lightning = useRef<THREE.DirectionalLight>(null);
  const bolt = useRef<THREE.LineSegments>(null);
  const boltMaterial = useRef<THREE.LineBasicMaterial>(null);
  const profile = useMemo(() => weatherProfile(weatherCode), [weatherCode]);
  const flash = useRef(0);
  const flashIndex = useRef(0);
  const nextFlash = useRef(5.2);
  const quality = useRenderQuality();
  const mobile = useMemo(() => isMobileRenderer(), []);
  const particleCount = mobile
    ? quality === "reduced" ? 92 : quality === "high" ? 210 : 150
    : quality === "reduced" ? 180 : quality === "balanced" ? 250 : 320;
  const particlePositions = useMemo(() => {
    const values = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      values[index * 3] = seededRandom(index, 1) * 2 - 1;
      values[index * 3 + 1] = seededRandom(index, 2) * 2 - 1;
      values[index * 3 + 2] = seededRandom(index, 3) * 2 - 1;
    }
    return values;
  }, [particleCount]);
  const seeds = useMemo(() => {
    const values = new Float32Array(particleCount);
    for (let index = 0; index < particleCount; index += 1) values[index] = seededRandom(index, 4);
    return values;
  }, [particleCount]);
  const boltPositions = useMemo(() => {
    const values: number[] = [];
    let x = 0;
    let y = 42;
    for (let segment = 0; segment < 12; segment += 1) {
      const nextX = x + (seededRandom(segment, 5) - .5) * (segment < 4 ? 2.2 : 4.5);
      const nextY = y - 3.2 - seededRandom(segment, 6) * 1.4;
      values.push(x, y, 0, nextX, Math.max(0, nextY), 0);
      x = nextX;
      y = nextY;
    }
    return new Float32Array(values);
  }, []);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWind: { value: 0 },
    uWindVector: { value: new THREE.Vector2() },
    uSnow: { value: 0 },
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color("#cceff1") },
  }), []);
  const windVectorTarget = useMemo(() => new THREE.Vector2(), []);

  useFrame(({ camera, clock }, delta) => {
    if (precipitation.current) precipitation.current.visible = profile.kind !== "none" && profile.intensity > .02;
    if (precipitationMaterial.current) {
      const values = precipitationMaterial.current.uniforms;
      values.uTime.value = clock.elapsedTime;
      const wind = THREE.MathUtils.clamp(windSpeed / 24, 0, 1.5);
      const windAngle = THREE.MathUtils.degToRad(windDirection - coastHeading);
      values.uWind.value = THREE.MathUtils.damp(values.uWind.value, wind, 3, delta);
      windVectorTarget.set(-Math.sin(windAngle) * wind, -Math.cos(windAngle) * wind);
      values.uWindVector.value.lerp(windVectorTarget, 1 - Math.exp(-delta * 3));
      values.uSnow.value = THREE.MathUtils.damp(values.uSnow.value, profile.kind === "snow" ? 1 : 0, 4, delta);
      values.uOpacity.value = THREE.MathUtils.damp(values.uOpacity.value, profile.intensity * (profile.kind === "snow" ? .72 : .82), 4, delta);
      values.uColor.value.set(profile.kind === "snow" ? "#f1f7f4" : "#c6e8eb");
    }

    if (profile.storm && clock.elapsedTime >= nextFlash.current) {
      const sequence = flashIndex.current;
      flashIndex.current += 1;
      flash.current = 1;
      nextFlash.current = clock.elapsedTime + 4.8 + seededRandom(sequence, weatherCode + 7) * 8.2;
      if (bolt.current) {
        bolt.current.position.set(
          camera.position.x + (seededRandom(sequence, weatherCode + 8) - .5) * 70,
          0,
          camera.position.z - 68 - seededRandom(sequence, weatherCode + 9) * 28,
        );
      }
    }
    flash.current = Math.max(0, flash.current - delta * 2.3);
    const flicker = flash.current > 0 ? Math.pow(flash.current, 2.4) * (.62 + Math.sin(clock.elapsedTime * 78) * .38) : 0;
    if (lightning.current) lightning.current.intensity = profile.storm ? Math.max(0, flicker) * 7.5 : 0;
    if (boltMaterial.current) boltMaterial.current.opacity = profile.storm ? Math.max(0, flicker) * .82 : 0;
  });

  return (
    <>
      <points ref={precipitation} frustumCulled={false} renderOrder={5}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particlePositions, 3]} />
          <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={precipitationMaterial}
          uniforms={uniforms}
          vertexShader={PRECIPITATION_VERTEX}
          fragmentShader={PRECIPITATION_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <directionalLight ref={lightning} position={[-24, 48, -35]} color="#dcecff" intensity={0} />
      <lineSegments ref={bolt} frustumCulled={false} renderOrder={6}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[boltPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial ref={boltMaterial} color="#e7f2ff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
    </>
  );
}

function gullWingGeometry(side: -1 | 1, tip = false) {
  const points = tip
    ? [
        [side * .82, .014, -.24],
        [side * 1.62, -.008, -.05],
        [side * 1.34, -.022, .3],
        [side * .88, -.012, .36],
      ]
    : [
        [0, 0, -.22],
        [side * .58, .036, -.34],
        [side * 1.62, -.008, -.05],
        [side * 1.34, -.022, .3],
        [side * .52, -.014, .48],
        [0, 0, .34],
      ];
  const indices = tip
    ? [0, 1, 3, 1, 2, 3]
    : [0, 1, 5, 1, 4, 5, 1, 2, 4, 2, 3, 4];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function Seabird({
  offset,
  speed,
  variant,
  wind,
  reducedMotion,
}: {
  offset: number;
  speed: number;
  variant: number;
  wind: number;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const leftWing = useRef<THREE.Group>(null);
  const rightWing = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const previousPosition = useRef(new THREE.Vector3());
  const leftWingGeometry = useMemo(() => gullWingGeometry(-1), []);
  const rightWingGeometry = useMemo(() => gullWingGeometry(1), []);
  const leftTipGeometry = useMemo(() => gullWingGeometry(-1, true), []);
  const rightTipGeometry = useMemo(() => gullWingGeometry(1, true), []);

  useEffect(() => () => {
    leftWingGeometry.dispose();
    rightWingGeometry.dispose();
    leftTipGeometry.dispose();
    rightTipGeometry.dispose();
  }, [leftTipGeometry, leftWingGeometry, rightTipGeometry, rightWingGeometry]);

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    const t = clock.elapsedTime * speed + offset;
    const orbit = t * (.168 + variant * .007);
    const radiusX = 48 + variant * 5.5;
    const radiusZ = 36 + variant * 4;
    const gust = Math.sin(t * .29 + variant * 1.7) * Math.min(1, wind / 18);
    const nextX = Math.sin(orbit) * radiusX + Math.sin(t * .071 + offset) * 7;
    const nextY = 9.4 + variant * 2.2 + Math.sin(t * .31 + variant) * 2.7 + gust * 1.1;
    const nextZ = -41 + Math.cos(orbit) * radiusZ + Math.sin(t * .097 + offset * .4) * 5;
    const previous = previousPosition.current;
    if (previous.lengthSq() < .001) previous.set(nextX - .1, nextY, nextZ - .1);
    const travelX = nextX - previous.x;
    const travelY = nextY - previous.y;
    const travelZ = nextZ - previous.z;
    const targetYaw = Math.atan2(-travelX, -travelZ);
    const targetPitch = THREE.MathUtils.clamp(Math.atan2(travelY, Math.hypot(travelX, travelZ)), -.22, .22);
    const turnBank = .13 + Math.sin(orbit) * .035 + gust * .045;
    group.current.position.set(nextX, nextY, nextZ);
    group.current.rotation.y = dampAngle(group.current.rotation.y, targetYaw, 4.2, delta);
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, targetPitch, 3.8, delta);
    group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, turnBank, 3.6, delta);
    previous.set(nextX, nextY, nextZ);

    const flightCycle = (t + variant * 1.31) % 7.2;
    const burst = reducedMotion ? 0 : 1 - THREE.MathUtils.smoothstep(flightCycle, 1.1, 2.2);
    const flap = reducedMotion
      ? .08
      : Math.sin(t * (7.8 + variant * .45)) * (.08 + burst * .54) - burst * .03;
    if (leftWing.current) leftWing.current.rotation.z = THREE.MathUtils.damp(leftWing.current.rotation.z, -.055 - flap, 13, delta);
    if (rightWing.current) rightWing.current.rotation.z = THREE.MathUtils.damp(rightWing.current.rotation.z, .055 + flap, 13, delta);
    if (tail.current) tail.current.rotation.y = THREE.MathUtils.damp(tail.current.rotation.y, -gust * .12 - Math.sin(orbit) * .045, 4, delta);
  });

  const birdScale = .62 + variant * .055;
  return (
    <group ref={group} scale={birdScale}>
      <mesh scale={[.3, .22, .76]} castShadow>
        <sphereGeometry args={[1, 14, 9]} />
        <meshStandardMaterial color="#e8ece7" roughness={.82} />
      </mesh>
      <mesh position={[0, -.13, .06]} scale={[.255, .115, .56]}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color="#f5f2e8" roughness={.9} />
      </mesh>
      <mesh position={[0, .08, -.67]} scale={[.25, .24, .29]}>
        <sphereGeometry args={[1, 12, 9]} />
        <meshStandardMaterial color="#f1f2ec" roughness={.78} />
      </mesh>
      <mesh position={[0, .065, -.95]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[.075, .28, 7]} />
        <meshStandardMaterial color="#e0a344" roughness={.7} />
      </mesh>
      <mesh position={[-.205, .135, -.76]} scale={[.028, .036, .025]}>
        <sphereGeometry args={[1, 7, 5]} />
        <meshStandardMaterial color="#101517" roughness={.36} />
      </mesh>
      <mesh position={[.205, .135, -.76]} scale={[.028, .036, .025]}>
        <sphereGeometry args={[1, 7, 5]} />
        <meshStandardMaterial color="#101517" roughness={.36} />
      </mesh>
      <group ref={leftWing} position={[-.04, .06, -.04]}>
        <mesh geometry={leftWingGeometry} castShadow>
          <meshStandardMaterial color="#dce2df" roughness={.86} side={THREE.DoubleSide} />
        </mesh>
        <mesh geometry={leftTipGeometry} position={[0, .012, 0]}>
          <meshStandardMaterial color="#49545a" roughness={.9} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <group ref={rightWing} position={[.04, .06, -.04]}>
        <mesh geometry={rightWingGeometry} castShadow>
          <meshStandardMaterial color="#dce2df" roughness={.86} side={THREE.DoubleSide} />
        </mesh>
        <mesh geometry={rightTipGeometry} position={[0, .012, 0]}>
          <meshStandardMaterial color="#49545a" roughness={.9} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <group ref={tail} position={[0, .01, .72]}>
        {[-1, 0, 1].map((side) => (
          <mesh key={side} position={[side * .095, 0, .13]} rotation={[0, side * .13, 0]}>
            <boxGeometry args={[.13, .025, .5]} />
            <meshStandardMaterial color={side === 0 ? "#e5e8e3" : "#ced6d3"} roughness={.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function PalmTree({
  position,
  scale = 1,
  wind,
  phase,
}: {
  position: [number, number, number];
  scale?: number;
  wind: number;
  phase: number;
}) {
  const crown = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!crown.current) return;
    const sway = Math.sin(clock.elapsedTime * (0.72 + wind * 0.34) + phase) * (0.035 + wind * 0.075);
    crown.current.rotation.z = sway;
    crown.current.rotation.x = sway * 0.4;
  });
  return (
    <group position={position} scale={scale} rotation={[0, phase * 0.3, -0.045]}>
      <mesh position={[0, 3.8, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.38, 7.6, 9]} />
        <meshStandardMaterial color="#745035" roughness={0.98} />
      </mesh>
      <group ref={crown} position={[0, 7.55, 0]}>
        {Array.from({ length: 8 }, (_, index) => (
          <mesh key={index} rotation={[0, (index / 8) * Math.PI * 2, 0.92]} position={[0, -0.05, 0]} castShadow>
            <coneGeometry args={[0.68, 4.9, 7]} />
            <meshStandardMaterial color={index % 2 ? "#2d674c" : "#39775a"} roughness={0.88} side={THREE.DoubleSide} />
          </mesh>
        ))}
        <mesh position={[0, -0.25, 0]}>
          <sphereGeometry args={[0.42, 10, 8]} />
          <meshStandardMaterial color="#5c4b2e" roughness={1} />
        </mesh>
      </group>
    </group>
  );
}

function PineTree({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 2.5, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.25, 5, 8]} />
        <meshStandardMaterial color="#4d3d32" roughness={1} />
      </mesh>
      {[2.7, 4.1, 5.35].map((height, index) => (
        <mesh key={height} position={[0, height, 0]} castShadow>
          <coneGeometry args={[1.8 - index * 0.36, 2.8, 10]} />
          <meshStandardMaterial color={index % 2 ? "#294c43" : "#34584b"} roughness={0.96} />
        </mesh>
      ))}
    </group>
  );
}

function createCoastalRidgeGeometry(
  seed: number,
  width: number,
  height: number,
  depth: number,
  segments: number,
  color: string,
) {
  const rows = 5;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const baseColor = new THREE.Color(color);
  const shadowColor = baseColor.clone().offsetHSL(-.01, .02, -.12);
  const crownColor = baseColor.clone().offsetHSL(.025, .035, .1);
  for (let segment = 0; segment <= segments; segment += 1) {
    const progress = segment / segments;
    const x = (progress - .5) * width;
    const broadNoise = seededRandom(segment, seed) * .28 + seededRandom(segment * 3, seed + 9) * .14;
    const taper = .2 + Math.pow(Math.sin(progress * Math.PI), .34) * .8;
    const ridgeHeight = height * taper * (.68 + broadNoise);
    const shift = (seededRandom(segment, seed + 3) - .5) * depth * .12;
    const crossSection = [
      { y: -.8, z: -depth * .5, shade: 0 },
      { y: ridgeHeight * .52, z: -depth * .42 + shift, shade: .46 },
      { y: ridgeHeight, z: -depth * .05 + shift, shade: 1 },
      { y: ridgeHeight * .68, z: depth * .4 + shift, shade: .62 },
      { y: -.8, z: depth * .5, shade: .08 },
    ];
    crossSection.forEach((point) => {
      positions.push(x, point.y, point.z);
      const tone = shadowColor.clone().lerp(crownColor, point.shade);
      colors.push(tone.r, tone.g, tone.b);
    });
  }
  for (let segment = 0; segment < segments; segment += 1) {
    for (let row = 0; row < rows - 1; row += 1) {
      const a = segment * rows + row;
      const b = (segment + 1) * rows + row;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function CoastalRidge({
  seed,
  position,
  rotation = [0, 0, 0],
  width,
  height,
  depth,
  color,
  mobile,
}: {
  seed: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  width: number;
  height: number;
  depth: number;
  color: string;
  mobile: boolean;
}) {
  const geometry = useMemo(
    () => createCoastalRidgeGeometry(seed, width, height, depth, mobile ? 9 : 20, color),
    [seed, width, height, depth, mobile, color],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={position} rotation={rotation} castShadow={!mobile} receiveShadow>
      <meshStandardMaterial vertexColors roughness={.96} metalness={.015} flatShading={mobile} />
    </mesh>
  );
}

function CoastBeacon({ position, light, scale = 1 }: { position: [number, number, number]; light: number; scale?: number }) {
  const glow = .08 + (1 - light) * 2.25;
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, .65, 0]} castShadow>
        <cylinderGeometry args={[.42, .64, 1.3, 10]} />
        <meshStandardMaterial color="#d7d0c2" roughness={.82} />
      </mesh>
      <mesh position={[0, 2.2, 0]} castShadow>
        <cylinderGeometry args={[.085, .12, 2.1, 8]} />
        <meshStandardMaterial color="#ac4f3e" roughness={.64} metalness={.16} />
      </mesh>
      <mesh position={[0, 3.3, 0]}>
        <sphereGeometry args={[.19, 10, 8]} />
        <meshStandardMaterial color="#fff0b6" emissive="#ffcf72" emissiveIntensity={glow} roughness={.22} />
      </mesh>
      <pointLight position={[0, 3.3, 0]} intensity={glow * .62} distance={22} color="#ffd991" />
    </group>
  );
}

function RockJetty({ x, z, length, light, mobile }: { x: number; z: number; length: number; light: number; mobile: boolean }) {
  const rocks = useRef<THREE.InstancedMesh>(null);
  const count = mobile ? 12 : 23;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (!rocks.current) return;
    for (let index = 0; index < count; index += 1) {
      const progress = index / Math.max(1, count - 1);
      const scale = 1.15 + seededRandom(index, x + 17) * 1.35;
      dummy.position.set(
        (seededRandom(index, x + 4) - .5) * 3.5,
        -.22 + seededRandom(index, z + 5) * .2,
        -progress * length,
      );
      dummy.rotation.set(index * .23, index * .79, index * .11);
      dummy.scale.set(scale * 1.08, scale * .64, scale);
      dummy.updateMatrix();
      rocks.current.setMatrixAt(index, dummy.matrix);
    }
    rocks.current.instanceMatrix.needsUpdate = true;
  }, [count, dummy, length, x, z]);
  return (
    <group position={[x, 0, z]}>
      <instancedMesh ref={rocks} args={[undefined, undefined, count]} castShadow={!mobile} receiveShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#3f4845" roughness={.94} />
      </instancedMesh>
      <CoastBeacon position={[0, .05, -length]} light={light} scale={.9} />
    </group>
  );
}

function RailTrestle({ mobile }: { mobile: boolean }) {
  const piers = mobile ? [-58, -28, 0, 28, 58] : [-72, -54, -36, -18, 0, 18, 36, 54, 72];
  return (
    <group position={[0, 0, 108]}>
      {piers.map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[-1.2, 2.25, 0]} rotation={[0, 0, -.08]} castShadow><boxGeometry args={[.38, 4.5, .5]} /><meshStandardMaterial color="#6a5946" roughness={.94} /></mesh>
          <mesh position={[1.2, 2.25, 0]} rotation={[0, 0, .08]} castShadow><boxGeometry args={[.38, 4.5, .5]} /><meshStandardMaterial color="#6a5946" roughness={.94} /></mesh>
          <mesh position={[0, 2.2, 0]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[.25, 3.25, .38]} /><meshStandardMaterial color="#594a3b" roughness={.96} /></mesh>
        </group>
      ))}
      <mesh position={[0, 4.35, 0]} castShadow receiveShadow><boxGeometry args={[170, .6, 1.8]} /><meshStandardMaterial color="#4f473d" roughness={.9} /></mesh>
      {[-.58, .58].map((z) => <mesh key={z} position={[0, 4.78, z]}><boxGeometry args={[170, .1, .08]} /><meshStandardMaterial color="#87918f" metalness={.72} roughness={.38} /></mesh>)}
    </group>
  );
}

function ClifftopTemple({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      {[0, 1.15, 2.05].map((height, index) => (
        <group key={height} position={[0, height, 0]}>
          <mesh position={[0, .45, 0]} castShadow><boxGeometry args={[2.6 - index * .42, .9, 2.3 - index * .36]} /><meshStandardMaterial color="#37332d" roughness={.92} /></mesh>
          <mesh position={[0, 1, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[2.05 - index * .3, .7, 4]} /><meshStandardMaterial color="#2a2926" roughness={.88} /></mesh>
        </group>
      ))}
      <mesh position={[0, 3.35, 0]}><cylinderGeometry args={[.08, .1, 1.25, 6]} /><meshStandardMaterial color="#292724" roughness={.86} /></mesh>
    </group>
  );
}

function HeadlandStation({ position, light }: { position: [number, number, number]; light: number }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.2, 0]} castShadow><cylinderGeometry args={[2.4, 2.8, 2.4, 14]} /><meshStandardMaterial color="#c8c3b6" roughness={.84} /></mesh>
      <mesh position={[0, 3.05, 0]} castShadow><sphereGeometry args={[2.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#e4e0d4" roughness={.72} /></mesh>
      <mesh position={[0, 4.1, 0]}><cylinderGeometry args={[.08, .1, 2.2, 7]} /><meshStandardMaterial color="#8b938f" metalness={.62} roughness={.42} /></mesh>
      <pointLight position={[0, 4.9, 0]} intensity={(1 - light) * .7} distance={18} color="#f25f4b" />
    </group>
  );
}

function DestinationLandmarks({
  beach,
  mobile,
  light,
}: {
  beach: Beach;
  mobile: boolean;
  light: number;
}) {
  switch (beach.id) {
    case "rockaway":
      return <group><RockJetty x={-52} z={31} length={47} light={light} mobile={mobile} /><RockJetty x={48} z={32} length={38} light={light} mobile={mobile} /></group>;
    case "pipeline":
      return <CoastalRidge seed={12} position={[0, 1, 132]} width={238} height={24} depth={32} color="#405c47" mobile={mobile} />;
    case "teahupoo":
      return <group><CoastalRidge seed={21} position={[0, 0, 134]} width={246} height={46} depth={38} color="#31533f" mobile={mobile} /><CoastalRidge seed={22} position={[-28, 1, 151]} width={210} height={31} depth={28} color="#263f34" mobile={mobile} /></group>;
    case "jeffreys-bay":
      return <CoastalRidge seed={31} position={[-89, -.2, 66]} rotation={[0, -.48, 0]} width={102} height={12} depth={34} color="#8a785c" mobile={mobile} />;
    case "snapper-rocks":
      return <group><CoastalRidge seed={41} position={[96, -.2, 48]} rotation={[0, .44, 0]} width={78} height={15} depth={39} color="#6c6a59" mobile={mobile} /><CoastBeacon position={[76, 8.7, 36]} light={light} scale={.82} /></group>;
    case "uluwatu":
      return <group><CoastalRidge seed={51} position={[-94, 0, 46]} rotation={[0, -.42, 0]} width={88} height={28} depth={47} color="#8b8068" mobile={mobile} /><ClifftopTemple position={[-87, 22, 54]} scale={1.08} /></group>;
    case "trestles":
      return <RailTrestle mobile={mobile} />;
    case "hossegor": {
      const trees = mobile ? [-72, -18, 36, 82] : [-92, -68, -42, -16, 12, 38, 64, 91];
      return <group><CoastalRidge seed={71} position={[0, -.4, 111]} width={244} height={8} depth={30} color="#9b815e" mobile={mobile} />{trees.map((x, index) => <PineTree key={x} position={[x, 5.5, 106 + (index % 2) * 7]} scale={.74 + (index % 3) * .12} />)}</group>;
    }
    case "nazare":
      return <CoastalRidge seed={81} position={[-92, 0, 47]} rotation={[0, -.52, 0]} width={92} height={31} depth={48} color="#807461" mobile={mobile} />;
    case "cloudbreak":
      return <group><CoastalRidge seed={91} position={[-94, -.5, -202]} rotation={[0, .18, 0]} width={92} height={12} depth={24} color="#365648" mobile={mobile} /><CoastalRidge seed={92} position={[108, -.5, -226]} rotation={[0, -.32, 0]} width={78} height={9} depth={20} color="#304b40" mobile={mobile} /></group>;
    case "mavericks":
      return <group><CoastalRidge seed={101} position={[-96, 0, 48]} rotation={[0, -.46, 0]} width={94} height={25} depth={44} color="#56605b" mobile={mobile} /><HeadlandStation position={[-92, 20, 53]} light={light} /></group>;
    case "raglan":
      return <group><CoastalRidge seed={111} position={[91, -.2, 45]} rotation={[0, .47, 0]} width={98} height={19} depth={42} color="#313d37" mobile={mobile} />{!mobile && [-91, -78, 72].map((x, index) => <PineTree key={x} position={[x, 0, 101 + index * 5]} scale={.7 + index * .12} />)}</group>;
    case "chicama":
      return <group><CoastalRidge seed={121} position={[-92, -.1, 42]} rotation={[0, -.48, 0]} width={118} height={22} depth={46} color="#9b6745" mobile={mobile} /><CoastalRidge seed={122} position={[66, 0, 123]} rotation={[0, .16, 0]} width={148} height={15} depth={34} color="#8a5d42" mobile={mobile} /></group>;
    default:
      return null;
  }
}

const DUNE_GRASS_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uWind;
  uniform vec2 uWindDirection;
  varying float vHeight;
  varying float vSeed;
  varying float vLight;
  #include <fog_pars_vertex>

  void main() {
    float height = clamp(position.y, 0.0, 1.0);
    float phase = uTime * (1.05 + uWind * 1.55) + aSeed * 19.7;
    float broadSway = sin(phase) * (.08 + uWind * .28);
    float bladeFlutter = sin(phase * 2.63 + aSeed * 31.0) * uWind * .055;
    float bend = (broadSway + bladeFlutter) * height * height;
    vec4 instancedPosition = instanceMatrix * vec4(position, 1.0);
    instancedPosition.xz += uWindDirection * bend;
    instancedPosition.xz += vec2(-uWindDirection.y, uWindDirection.x) * bladeFlutter * height * .32;
    vec4 mvPosition = modelViewMatrix * instancedPosition;
    gl_Position = projectionMatrix * mvPosition;
    vHeight = height;
    vSeed = aSeed;
    vLight = .86 + sin(aSeed * 43.1) * .12 + dot(normalize(uWindDirection), vec2(.58, .82)) * .045;
    #include <fog_vertex>
  }
`;

const DUNE_GRASS_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uLight;
  varying float vHeight;
  varying float vSeed;
  varying float vLight;
  #include <fog_pars_fragment>

  void main() {
    vec3 root = vec3(.22, .245, .14);
    vec3 marram = vec3(.44, .505, .29);
    vec3 sunDry = vec3(.61, .57, .34);
    float dryVariation = smoothstep(.54, .96, fract(vSeed * 7.13));
    vec3 blade = mix(marram, sunDry, dryVariation * .62);
    vec3 color = mix(root, blade, smoothstep(0.0, .48, vHeight));
    color = mix(color, color * vec3(.84, .9, .76), smoothstep(.72, 1.0, vHeight));
    color *= vLight * (.62 + uLight * .5);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function DuneGrassField({
  mobile,
  wind,
  windDirection,
  coastHeading,
  light,
}: {
  mobile: boolean;
  wind: number;
  windDirection: number;
  coastHeading: number;
  light: number;
}) {
  const quality = useRenderQuality();
  const reducedMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const grass = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const count = mobile
    ? quality === "reduced" ? 120 : quality === "high" ? 260 : 190
    : quality === "reduced" ? 240 : quality === "balanced" ? 360 : 520;
  const seeds = useMemo(() => {
    const values = new Float32Array(count);
    for (let index = 0; index < count; index += 1) values[index] = seededRandom(index, 741);
    return values;
  }, [count]);
  const geometry = useMemo(() => {
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.Float32BufferAttribute([
      -.07, 0, 0, .07, 0, 0,
      -.055, .36, 0, .055, .36, 0,
      -.032, .72, 0, .032, .72, 0,
      0, 1.05, 0,
    ], 3));
    next.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
    next.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    next.computeVertexNormals();
    return next;
  }, [seeds]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const windAngle = THREE.MathUtils.degToRad(windDirection - coastHeading);
  const windVector = useMemo(() => new THREE.Vector2(Math.sin(windAngle), Math.cos(windAngle)).normalize(), [windAngle]);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWind: { value: wind },
    uWindDirection: { value: windVector.clone() },
    uLight: { value: light },
  }), [light, wind, windVector]);

  useEffect(() => {
    if (!grass.current) return;
    for (let index = 0; index < count; index += 1) {
      const lane = seededRandom(index, 752);
      const cluster = seededRandom(Math.floor(index / 7), 753) - .5;
      const x = (seededRandom(index, 754) - .5) * 242 + cluster * 7.5;
      const z = 93 + lane * 29 + Math.sin(x * .073) * 1.4;
      const height = .7 + seededRandom(index, 755) * 1.18;
      const width = .72 + seededRandom(index, 756) * .72;
      dummy.position.set(x, -.46 + seededRandom(index, 757) * .09, z);
      dummy.rotation.set(0, seededRandom(index, 758) * Math.PI * 2, (seededRandom(index, 759) - .5) * .12);
      dummy.scale.set(width, height, width);
      dummy.updateMatrix();
      grass.current.setMatrixAt(index, dummy.matrix);
    }
    grass.current.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    grass.current.instanceMatrix.needsUpdate = true;
    grass.current.computeBoundingSphere();
  }, [count, dummy]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ clock }, delta) => {
    if (!material.current) return;
    const values = material.current.uniforms;
    values.uTime.value = reducedMotion ? 1.85 : clock.elapsedTime;
    values.uWind.value = THREE.MathUtils.damp(values.uWind.value, wind, 2.6, delta);
    values.uWindDirection.value.lerp(windVector, 1 - Math.exp(-delta * 2.4)).normalize();
    values.uLight.value = THREE.MathUtils.damp(values.uLight.value, light, 2.4, delta);
  });

  return (
    <instancedMesh ref={grass} args={[geometry, undefined, count]} castShadow={!mobile} frustumCulled>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={DUNE_GRASS_VERTEX}
        fragmentShader={DUNE_GRASS_FRAGMENT}
        side={THREE.DoubleSide}
        fog
      />
    </instancedMesh>
  );
}

function CoastBackdrop({
  biome,
  wind,
  windDirection,
  coastHeading,
  light,
  mobile,
}: {
  biome: CoastBiome;
  wind: number;
  windDirection: number;
  coastHeading: number;
  light: number;
  mobile: boolean;
}) {
  if (biome === "urban") {
    const buildings = Array.from({ length: 12 }, (_, index) => ({
      x: -112 + index * 20,
      height: 9 + ((index * 7) % 17),
      width: 10 + ((index * 5) % 8),
      depth: 8 + ((index * 3) % 6),
    }));
    return (
      <group>
        <mesh position={[0, -0.05, 101]} receiveShadow>
          <boxGeometry args={[250, 0.48, 10]} />
          <meshStandardMaterial color="#8a6c4d" roughness={0.92} />
        </mesh>
        {Array.from({ length: 28 }, (_, index) => (
          <mesh key={index} position={[-121 + index * 9, 0.22, 101]} receiveShadow>
            <boxGeometry args={[7.5, 0.08, 9.4]} />
            <meshStandardMaterial color={index % 2 ? "#9b7954" : "#856646"} roughness={0.95} />
          </mesh>
        ))}
        {buildings.map((building, index) => (
          <group key={building.x} position={[building.x, 0, 118 + (index % 3) * 3]}>
            <mesh position={[0, building.height / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[building.width, building.height, building.depth]} />
              <meshStandardMaterial color={["#6e7779", "#8c7968", "#59666b", "#94887b"][index % 4]} roughness={0.86} />
            </mesh>
            {Array.from({ length: Math.max(2, Math.floor(building.height / 3)) }, (_, floor) => (
              <mesh key={floor} position={[0, 2 + floor * 2.6, -building.depth / 2 - 0.01]}>
                <planeGeometry args={[building.width * 0.72, 0.58]} />
                <meshStandardMaterial color="#b4d5d0" emissive="#5d8f92" emissiveIntensity={0.18} roughness={0.32} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    );
  }
  if (biome === "tropical") {
    return (
      <group>
        {[[-54, 99, 0.92], [-39, 109, 1.12], [-18, 101, 0.82], [38, 106, 1.04], [62, 98, 0.9]].map(([x, z, scale], index) => (
          <PalmTree key={x} position={[x, 0, z]} scale={scale} wind={wind} phase={index * 1.7} />
        ))}
        {[-78, 78].map((x, index) => (
          <mesh key={x} position={[x, 2.5, 115]} scale={[11, 4.6 + index, 7]} rotation={[0.2, index * 0.7, 0.1]} castShadow receiveShadow>
            <dodecahedronGeometry args={[1, 1]} />
            <meshStandardMaterial color="#536550" roughness={0.96} />
          </mesh>
        ))}
        {Array.from({ length: 13 }, (_, index) => (
          <mesh key={index} position={[-93 + index * 15, 1.1, 113 + (index % 3) * 4]} scale={[3.2, 1.7, 2.5]}>
            <sphereGeometry args={[1, 10, 7]} />
            <meshStandardMaterial color={index % 2 ? "#315a48" : "#456b50"} roughness={1} />
          </mesh>
        ))}
      </group>
    );
  }
  if (biome === "dune") {
    return (
      <group>
        <DuneGrassField mobile={mobile} wind={wind} windDirection={windDirection} coastHeading={coastHeading} light={light} />
      </group>
    );
  }
  if (biome === "rugged") {
    return (
      <group>
        {Array.from({ length: 9 }, (_, index) => (
          <mesh key={index} position={[-112 + index * 28, 5 + (index % 3) * 2.4, 118 + (index % 2) * 8]} scale={[16, 8 + (index % 3) * 2, 11]} rotation={[0.1, index * 0.4, 0.08]} castShadow receiveShadow>
            <dodecahedronGeometry args={[1, 1]} />
            <meshStandardMaterial color={index % 2 ? "#7c715f" : "#95856e"} roughness={0.98} />
          </mesh>
        ))}
        <group position={[-68, 12, 107]}>
          <mesh position={[0, 5, 0]} castShadow>
            <cylinderGeometry args={[1.45, 2.1, 10, 14]} />
            <meshStandardMaterial color="#e8ddc8" roughness={0.75} />
          </mesh>
          <mesh position={[0, 10.3, 0]}>
            <cylinderGeometry args={[1.75, 1.55, 1.4, 14]} />
            <meshStandardMaterial color="#b64037" roughness={0.62} />
          </mesh>
          <pointLight position={[0, 10.3, -1.5]} intensity={1.3} distance={34} color="#fff0ba" />
        </group>
      </group>
    );
  }
  if (biome === "cold") {
    return (
      <group>
        {Array.from({ length: 7 }, (_, index) => (
          <PineTree key={index} position={[-92 + index * 31, 0, 106 + (index % 2) * 8]} scale={0.86 + (index % 3) * 0.16} />
        ))}
        {[-105, -84, 88, 109].map((x, index) => (
          <mesh key={x} position={[x, 3.2 + (index % 2) * 1.5, 111]} scale={[9, 5.2, 7]} rotation={[0.2, index, 0]} castShadow>
            <dodecahedronGeometry args={[1, 1]} />
            <meshStandardMaterial color="#586461" roughness={1} />
          </mesh>
        ))}
      </group>
    );
  }
  if (biome === "volcanic") {
    return (
      <group>
        {Array.from({ length: 18 }, (_, index) => (
          <mesh key={index} position={[-112 + ((index * 31) % 224), 0.8 + (index % 4) * 0.35, 95 + ((index * 11) % 26)]} scale={[1.8 + (index % 3), 1.2 + (index % 2), 1.5 + ((index + 1) % 4) * 0.5]} rotation={[index * 0.13, index * 0.8, 0.1]} castShadow>
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={index % 2 ? "#292c2a" : "#3b3d38"} roughness={0.96} />
          </mesh>
        ))}
      </group>
    );
  }
  return (
    <group>
      {Array.from({ length: 9 }, (_, index) => (
        <mesh key={index} position={[-115 + index * 29, 3.2 + (index % 3) * 1.8, 116 + (index % 2) * 7]} scale={[15, 5 + (index % 3) * 2, 9]} rotation={[0.04, index * 0.31, 0.08]} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={index % 2 ? "#a36f49" : "#bd8255"} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function createTiledSandTexture(source: THREE.Texture, repeatX: number, repeatY: number) {
  const texture = source.clone();
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

const ROAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ROAD_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uWetness;
  uniform float uLight;
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float value = noise(p) * .58;
    value += noise(p * 2.07 + 4.1) * .27;
    value += noise(p * 4.13 - 7.8) * .15;
    return value;
  }

  void main() {
    vec2 road = vec2(vWorldPosition.x * .368, vUv.y * 7.0);
    float aggregate = fbm(road * 2.2);
    float coarse = fbm(road * .24 + vec2(17.0, 3.0));
    float laneWear = exp(-pow((vUv.y - .28) * 17.0, 2.0)) + exp(-pow((vUv.y - .72) * 17.0, 2.0));
    float seam = (1.0 - smoothstep(0.0, .018, abs(fract(vWorldPosition.x / 50.0 + .17) - .5))) * .16;
    vec3 dryAsphalt = mix(vec3(.055, .061, .06), vec3(.105, .112, .108), aggregate * .72 + coarse * .28);
    dryAsphalt *= 1.0 - laneWear * .075 - seam;

    float puddleField = fbm(road * .11 + vec2(2.8, -1.4));
    float puddles = smoothstep(.55, .78, puddleField + laneWear * .09) * uWetness;
    float wetFilm = uWetness * (.58 + puddles * .42);
    vec3 color = mix(dryAsphalt, dryAsphalt * vec3(.38, .46, .48), wetFilm);

    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float grazing = pow(1.0 - abs(viewDirection.y), 2.7);
    float ripple = noise(road * 1.35 + vec2(uTime * .18, -uTime * .1));
    vec3 skyReflection = mix(vec3(.07, .105, .12), vec3(.3, .48, .51), uLight);
    skyReflection *= .78 + ripple * .22;
    color = mix(color, skyReflection, wetFilm * grazing * (.52 + puddles * .34));

    float mica = smoothstep(.91, .985, hash(floor(road * 5.5))) * (1.0 - uWetness * .65);
    color += vec3(.18, .2, .19) * mica * (.18 + uLight * .28);
    float edge = smoothstep(0.0, .018, vUv.y) * smoothstep(0.0, .018, 1.0 - vUv.y);
    gl_FragColor = vec4(color * (.97 + edge * .03), 1.0);
  }
`;

function RoadSurface({ weatherCode, light }: { weatherCode: number; light: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const wetness = weatherWetness(weatherCode);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWetness: { value: 0 },
    uLight: { value: 1 },
  }), []);

  useFrame(({ clock }, delta) => {
    if (!material.current) return;
    material.current.uniforms.uTime.value = clock.elapsedTime;
    material.current.uniforms.uWetness.value = THREE.MathUtils.damp(material.current.uniforms.uWetness.value, wetness, 2.6, delta);
    material.current.uniforms.uLight.value = THREE.MathUtils.damp(material.current.uniforms.uLight.value, light, 2.6, delta);
  });

  return (
    <mesh position={[0, -0.35, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[COAST_GEOMETRY_WIDTH, 14]} />
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={ROAD_VERTEX} fragmentShader={ROAD_FRAGMENT} />
    </mesh>
  );
}

type VisitorActivity = "walk" | "watch" | "photo" | "relax";

type VisitorPalette = {
  skin: string;
  shirt: string;
  shorts: string;
  hair: string;
};

type CoastChunkLayout = {
  worldIndex: number;
  dunes: Array<{ x: number; z: number; s: number; height: number }>;
  umbrella: { position: [number, number, number]; rotation: number; scale: number } | null;
  station: { position: [number, number, number]; rotation: number } | null;
  activitySeed: number;
  backdropOffset: number;
  backdropScale: number;
};

const VISITOR_PALETTES: VisitorPalette[] = [
  { skin: "#9a5c3b", shirt: "#d55c48", shorts: "#203842", hair: "#21150f" },
  { skin: "#c98d69", shirt: "#e2c15b", shorts: "#374b5d", hair: "#5b3828" },
  { skin: "#6e3e2e", shirt: "#244c5f", shorts: "#ddd4bf", hair: "#17110f" },
  { skin: "#d2a07a", shirt: "#e87861", shorts: "#36585d", hair: "#7a4d2d" },
  { skin: "#80513c", shirt: "#4ca195", shorts: "#e3c891", hair: "#2a1c17" },
  { skin: "#e1b18b", shirt: "#526d9b", shorts: "#b95f48", hair: "#9c724f" },
];

function stringSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createCoastChunkLayout(worldIndex: number, beachId: string): CoastChunkLayout {
  const beachSeed = stringSeed(beachId) % 10_000;
  const sample = (channel: number) => seededRandom(worldIndex * 47 + channel, beachSeed + channel * 19);
  const dunes = Array.from({ length: 22 }, (_, index) => ({
    x: -108 + seededRandom(index + worldIndex * 71, beachSeed + 101) * 216,
    z: 89 + seededRandom(index + worldIndex * 73, beachSeed + 102) * 34,
    s: 2.7 + seededRandom(index + worldIndex * 79, beachSeed + 103) * 4.4,
    height: .72 + seededRandom(index + worldIndex * 83, beachSeed + 104) * .72,
  }));
  const umbrellaPresent = worldIndex === 0 || sample(1) > .3;
  const stationPresent = worldIndex === 0 || sample(2) > .72;
  return {
    worldIndex,
    dunes,
    umbrella: umbrellaPresent ? {
      position: [-70 + sample(3) * 140, 0, 44 + sample(4) * 13],
      rotation: (sample(5) - .5) * .32,
      scale: .88 + sample(6) * .2,
    } : null,
    station: stationPresent ? {
      position: [-76 + sample(7) * 152, 0, 59 + sample(8) * 8],
      rotation: (sample(9) - .5) * .12,
    } : null,
    activitySeed: beachSeed + worldIndex * 137,
    backdropOffset: (sample(10) - .5) * 22,
    backdropScale: .94 + sample(11) * .12,
  };
}

function prepareVisitorScene(source: THREE.Group, palette: VisitorPalette, photographing: boolean) {
  const model = cloneSkeleton(source) as THREE.Group;
  const paletteColors = {
    skin: new THREE.Color(palette.skin),
    shirt: new THREE.Color(palette.shirt),
    shorts: new THREE.Color(palette.shorts),
    hair: new THREE.Color(palette.hair),
    shoes: new THREE.Color(palette.shirt).lerp(new THREE.Color("#f2eadb"), .78),
  };
  const attachments = [
    ["Head.details", "Head"],
    ["Foot.L.shoe", "Foot.L"],
    ["Foot.R.shoe", "Foot.R"],
    ["Camera.prop", "Torso"],
  ] as const;
  model.updateMatrixWorld(true);
  attachments.forEach(([detailName, jointName]) => {
    const detail = namedModelObject(model, detailName);
    const joint = namedModelObject(model, jointName);
    if (detail && joint) joint.attach(detail);
  });
  const camera = namedModelObject(model, "Camera.prop");
  if (camera) camera.visible = photographing;
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = false;
    object.frustumCulled = true;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const materials = sourceMaterials.map((sourceMaterial) => {
      const next = sourceMaterial.clone();
      if (next instanceof THREE.MeshStandardMaterial) {
        const name = next.name.toLowerCase();
        if (name.includes("visitor skin") || name.includes("visitor lip")) next.color.copy(paletteColors.skin);
        else if (name.includes("visitor shirt")) next.color.copy(paletteColors.shirt);
        else if (name.includes("visitor shorts")) next.color.copy(paletteColors.shorts);
        else if (name.includes("visitor hair") || name.includes("brow")) next.color.copy(paletteColors.hair);
        else if (name.includes("visitor shoes")) next.color.copy(paletteColors.shoes);
        next.envMapIntensity = name.includes("camera") ? 1.3 : name.includes("skin") ? .78 : .9;
      }
      return next;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0];
  });
  return model;
}

function BeachVisitor({
  position,
  rotation,
  activity,
  palette,
  phase,
  observerPosition,
  worldOffsetX,
  scale = 1,
}: {
  position: [number, number, number];
  rotation: number;
  activity: VisitorActivity;
  palette: VisitorPalette;
  phase: number;
  observerPosition: MutableRefObject<THREE.Vector3>;
  worldOffsetX: number;
  scale?: number;
}) {
  const { scene } = useGLTF(VISITOR_MODEL_URL);
  const model = useMemo(() => prepareVisitorScene(scene, palette, activity === "photo"), [activity, palette, scene]);
  const materials = useMemo(() => {
    const collected = new Set<THREE.Material>();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const next = Array.isArray(object.material) ? object.material : [object.material];
      next.forEach((material) => collected.add(material));
    });
    return [...collected];
  }, [model]);
  const root = useRef<THREE.Group>(null);
  const joints = useRef<Partial<Record<SurferJointName, THREE.Object3D>>>({});
  const restPose = useRef<Partial<Record<SurferJointName, THREE.Euler>>>({});
  const baseX = position[0];
  const baseY = position[1];

  useEffect(() => {
    const next: Partial<Record<SurferJointName, THREE.Object3D>> = {};
    const rest: Partial<Record<SurferJointName, THREE.Euler>> = {};
    SURFER_JOINT_NAMES.forEach((name) => {
      const joint = namedModelObject(model, name);
      if (!joint) return;
      next[name] = joint;
      rest[name] = joint.rotation.clone();
    });
    joints.current = next;
    restPose.current = rest;
    return () => {
      joints.current = {};
      restPose.current = {};
      materials.forEach((material) => material.dispose());
    };
  }, [materials, model]);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime + phase;
    const walking = activity === "walk";
    const photographing = activity === "photo";
    const relaxed = activity === "relax";
    const stride = walking ? Math.sin(t * 3.35) : 0;
    const breathing = Math.sin(t * .86) * .012;
    if (root.current) {
      root.current.position.x = walking ? baseX + Math.sin(t * .24) * 5.8 : baseX;
      root.current.position.y = baseY + (relaxed ? -.24 : Math.abs(stride) * .018);
      root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, rotation + (walking && Math.cos(t * .24) < 0 ? Math.PI : 0), 5, delta);
    }
    const pose = (name: SurferJointName, x: number, y: number, z: number, responsiveness = 7) => {
      const joint = joints.current[name];
      if (!joint) return;
      const rest = restPose.current[name];
      joint.rotation.x = dampAngle(joint.rotation.x, (rest?.x ?? 0) + x, responsiveness, delta);
      joint.rotation.y = dampAngle(joint.rotation.y, (rest?.y ?? 0) + y, responsiveness, delta);
      joint.rotation.z = dampAngle(joint.rotation.z, (rest?.z ?? 0) + z, responsiveness, delta);
    };

    const currentX = (root.current?.position.x ?? baseX) + worldOffsetX;
    const dx = observerPosition.current.x - currentX;
    const dz = observerPosition.current.z - position[2];
    const glanceDistance = Math.hypot(dx, dz);
    const worldAngle = Math.atan2(dx, dz);
    const rootRotation = root.current?.rotation.y ?? rotation;
    const relativeAngle = Math.atan2(Math.sin(worldAngle - rootRotation), Math.cos(worldAngle - rootRotation));
    const glance = glanceDistance < 14 && !photographing && !relaxed
      ? THREE.MathUtils.clamp(relativeAngle, -.72, .72)
      : activity === "watch" ? Math.sin(t * .34) * .28 : 0;

    pose("Pelvis", relaxed ? -.08 : walking ? stride * .018 : 0, 0, walking ? stride * .018 : 0, 6);
    pose("Torso", relaxed ? -.14 : walking ? stride * -.035 : breathing, photographing ? Math.sin(t * .24) * .018 : 0, walking ? stride * .025 : Math.sin(t * .43) * .018, 6);
    pose("Head", photographing ? -.08 : relaxed ? -.14 : 0, glance, walking ? -stride * .018 : 0, 6);
    pose("UpperArm.L", photographing ? -.94 : relaxed ? -.3 : walking ? stride * .68 : Math.sin(t * .72) * .045, 0, photographing ? .42 : relaxed ? .16 : .075, 7);
    pose("UpperArm.R", photographing ? .94 : relaxed ? .3 : walking ? -stride * .68 : -Math.sin(t * .72 + 1) * .045, 0, photographing ? -.42 : relaxed ? -.16 : -.075, 7);
    pose("LowerArm.L", photographing ? -.96 : relaxed ? -.42 : 0, 0, photographing ? .18 : 0, 8);
    pose("LowerArm.R", photographing ? .96 : relaxed ? .42 : 0, 0, photographing ? -.18 : 0, 8);
    pose("Hand.L", photographing ? -.08 : 0, photographing ? -.16 : 0, 0, 8);
    pose("Hand.R", photographing ? .08 : 0, photographing ? .16 : 0, 0, 8);
    pose("UpperLeg.L", relaxed ? -1.22 : walking ? stride * .64 : 0, 0, relaxed ? .12 : .025, 8);
    pose("UpperLeg.R", relaxed ? 1.22 : walking ? -stride * .64 : 0, 0, relaxed ? -.12 : -.025, 8);
    pose("LowerLeg.L", relaxed ? .96 : walking ? Math.max(0, -stride) * .78 : 0, 0, 0, 8);
    pose("LowerLeg.R", relaxed ? -.96 : walking ? Math.max(0, stride) * -.78 : 0, 0, 0, 8);
    pose("Foot.L", relaxed ? -.16 : walking ? -stride * .06 : 0, 0, 0, 8);
    pose("Foot.R", relaxed ? .16 : walking ? stride * .06 : 0, 0, 0, 8);
  });

  return (
    <group ref={root} position={position} rotation={[0, rotation, 0]} scale={scale * .91}>
      <primitive object={model} />
    </group>
  );
}

function LifeguardFlag({ wind }: { wind: number }) {
  const flag = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!flag.current) return;
    flag.current.rotation.y = Math.sin(clock.elapsedTime * (4.2 + wind * 1.8)) * (.08 + wind * .1);
    flag.current.rotation.z = -.04 - wind * .035;
  });
  return (
    <group position={[2.55, 6.25, 0]}>
      <mesh position={[0, -1.1, 0]}>
        <cylinderGeometry args={[.025, .035, 2.3, 8]} />
        <meshStandardMaterial color="#bfc7c4" metalness={.72} roughness={.34} />
      </mesh>
      <mesh ref={flag} position={[.62, -.08, 0]}>
        <planeGeometry args={[1.25, .58, 8, 2]} />
        <meshStandardMaterial color="#f35f45" emissive="#6d140d" emissiveIntensity={.12} roughness={.7} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function LifeguardStation({
  wind,
  light,
  position,
  rotation,
}: {
  wind: number;
  light: number;
  position: [number, number, number];
  rotation: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[[-2, -1.35], [2, -1.35], [-2, 1.35], [2, 1.35]].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 1.25, z]} castShadow>
          <cylinderGeometry args={[.105, .14, 2.5, 10]} />
          <meshStandardMaterial color="#d4c49f" roughness={.82} />
        </mesh>
      ))}
      <mesh position={[0, 2.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[5.35, .23, 3.7]} />
        <meshStandardMaterial color="#c8ad78" roughness={.78} />
      </mesh>
      <mesh position={[0, 3.25, .2]} castShadow receiveShadow>
        <boxGeometry args={[4.45, 2.05, 2.75]} />
        <meshStandardMaterial color="#173d46" roughness={.68} />
      </mesh>
      <mesh position={[0, 3.48, -1.39]}>
        <planeGeometry args={[3.25, 1.12]} />
        <meshStandardMaterial color="#75cbd0" emissive="#163c45" emissiveIntensity={.22 + light * .12} metalness={.18} roughness={.22} />
      </mesh>
      <mesh position={[-2.24, 3.34, .1]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[1.7, 1.1]} />
        <meshStandardMaterial color="#70bbc0" emissive="#163c45" emissiveIntensity={.18} metalness={.16} roughness={.26} />
      </mesh>
      <mesh position={[0, 4.52, .15]} castShadow>
        <boxGeometry args={[5.25, .22, 3.65]} />
        <meshStandardMaterial color="#f0d28f" roughness={.75} />
      </mesh>
      {[-2.45, 2.45].map((x) => (
        <group key={x} position={[x, 2.95, -1.65]}>
          <mesh position={[0, .35, 0]}><cylinderGeometry args={[.035, .045, 1.45, 7]} /><meshStandardMaterial color="#d9d3c4" metalness={.54} roughness={.42} /></mesh>
          <mesh position={[0, 1.05, .45]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.025, .035, .9, 7]} /><meshStandardMaterial color="#d9d3c4" metalness={.54} roughness={.42} /></mesh>
        </group>
      ))}
      {Array.from({ length: 6 }, (_, index) => (
        <mesh key={index} position={[-2.95 - index * .35, 1.88 - index * .3, .85]} castShadow receiveShadow>
          <boxGeometry args={[1.2, .13, .52]} />
          <meshStandardMaterial color="#b79d70" roughness={.86} />
        </mesh>
      ))}
      <mesh position={[-3.15, 1.25, .18]} rotation={[0, 0, -.5]}>
        <cylinderGeometry args={[.035, .045, 3.1, 7]} />
        <meshStandardMaterial color="#d5d0c3" metalness={.48} roughness={.45} />
      </mesh>
      <group position={[2.72, 1.5, .48]} rotation={[.12, 0, -.08]}>
        <mesh castShadow>
          <capsuleGeometry args={[.34, 2.25, 8, 16]} />
          <meshPhysicalMaterial color="#e86243" roughness={.48} clearcoat={.28} clearcoatRoughness={.28} />
        </mesh>
        <mesh position={[0, -.94, -.35]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[.12, .025, 8, 20]} />
          <meshStandardMaterial color="#152a30" roughness={.55} />
        </mesh>
      </group>
      <pointLight position={[0, 4.05, -1.7]} intensity={.08 + (1 - light) * 1.25} distance={20} color="#ffdca1" />
      <LifeguardFlag wind={wind} />
    </group>
  );
}

function BeachActivity({
  mobile,
  weatherCode,
  observerPosition,
  seed,
  worldOffsetX,
}: {
  mobile: boolean;
  weatherCode: number;
  observerPosition: MutableRefObject<THREE.Vector3>;
  seed: number;
  worldOffsetX: number;
}) {
  const quality = useRenderQuality();
  const weather = weatherProfile(weatherCode);
  const sheltered = weather.storm || weather.kind !== "none" || weather.fog;
  const visitors = useMemo(() => {
    const activities: VisitorActivity[] = ["walk", "photo", "watch", "relax"];
    return Array.from({ length: 4 }, (_, index) => {
      const random = (channel: number) => seededRandom(seed + index * 17 + channel, 341 + channel);
      return {
        position: [
          -82 + random(1) * 164,
          -.47,
          41 + random(2) * 18,
        ] as [number, number, number],
        rotation: Math.PI * (.8 + random(3) * .4),
        activity: activities[(index + Math.floor(random(4) * activities.length)) % activities.length],
        phase: random(5) * 8,
        palette: VISITOR_PALETTES[Math.floor(random(6) * VISITOR_PALETTES.length)],
      };
    });
  }, [seed]);
  const visitorCount = mobile
    ? quality === "reduced" ? 1 : quality === "high" ? 3 : 2
    : quality === "reduced" ? 2 : visitors.length;
  const visibleVisitors = sheltered ? [] : visitors.slice(0, visitorCount);
  const towelPosition = useMemo(() => [
    -66 + seededRandom(seed, 401) * 132,
    -.47,
    47 + seededRandom(seed, 402) * 10,
  ] as [number, number, number], [seed]);
  const coolerPosition = useMemo(() => [
    -76 + seededRandom(seed, 403) * 152,
    0,
    49 + seededRandom(seed, 404) * 12,
  ] as [number, number, number], [seed]);
  return (
    <group>
      {visibleVisitors.map((visitor, index) => (
        <BeachVisitor
          key={index}
          {...visitor}
          observerPosition={observerPosition}
          worldOffsetX={worldOffsetX}
          scale={index === 1 ? .94 : 1}
        />
      ))}
      {!sheltered && (
        <group position={towelPosition} rotation={[-Math.PI / 2, 0, (seededRandom(seed, 405) - .5) * .6]}>
          <mesh receiveShadow><planeGeometry args={[2.4, 1.15]} /><meshStandardMaterial color="#e8b852" roughness={.92} /></mesh>
          {[-.66, 0, .66].map((x) => <mesh key={x} position={[x, 0, .006]}><planeGeometry args={[.12, 1.15]} /><meshBasicMaterial color="#f4e3b5" /></mesh>)}
        </group>
      )}
      {!sheltered && (
        <group position={coolerPosition}>
          <mesh position={[0, .28, 0]} castShadow><boxGeometry args={[.65, .5, .48]} /><meshStandardMaterial color="#e8ded0" roughness={.62} /></mesh>
          <mesh position={[0, .56, 0]} castShadow><boxGeometry args={[.69, .1, .52]} /><meshStandardMaterial color="#da6249" roughness={.55} /></mesh>
          <mesh position={[0, .3, -.25]}><boxGeometry args={[.24, .16, .04]} /><meshStandardMaterial color="#a8d8d3" metalness={.18} roughness={.28} /></mesh>
        </group>
      )}
    </group>
  );
}

function createUmbrellaCanopyGeometry(segments = 24) {
  const positions: number[] = [];
  const colors: number[] = [];
  const coral = new THREE.Color("#dd654b");
  const coralShade = new THREE.Color("#b94738");
  const canvas = new THREE.Color("#f1d8a7");
  const canvasShade = new THREE.Color("#c9ad79");
  const addVertex = (x: number, y: number, z: number, color: THREE.Color) => {
    positions.push(x, y, z);
    colors.push(color.r, color.g, color.b);
  };
  for (let segment = 0; segment < segments; segment += 1) {
    const angleA = (segment / segments) * Math.PI * 2;
    const angleB = ((segment + 1) / segments) * Math.PI * 2;
    const edgeRadiusA = 2.86 + Math.sin(angleA * segments * .5) * .065;
    const edgeRadiusB = 2.86 + Math.sin(angleB * segments * .5) * .065;
    const middleRadius = 1.52;
    const panel = segment % 2 ? canvas : coral;
    const shade = segment % 2 ? canvasShade : coralShade;
    const center = [0, .57, 0] as const;
    const middleA = [Math.sin(angleA) * middleRadius, .31, Math.cos(angleA) * middleRadius] as const;
    const middleB = [Math.sin(angleB) * middleRadius, .31, Math.cos(angleB) * middleRadius] as const;
    const edgeA = [Math.sin(angleA) * edgeRadiusA, 0, Math.cos(angleA) * edgeRadiusA] as const;
    const edgeB = [Math.sin(angleB) * edgeRadiusB, 0, Math.cos(angleB) * edgeRadiusB] as const;
    [center, middleA, middleB, middleA, edgeA, edgeB, middleA, edgeB, middleB].forEach(([x, y, z], index) => {
      addVertex(x, y, z, index < 3 ? panel.clone().lerp(new THREE.Color("#fff4d4"), .08) : panel);
    });
    const valanceDropA = -.18 - (segment % 2) * .045;
    const valanceDropB = -.18 - ((segment + 1) % 2) * .045;
    const lowerA = [edgeA[0] * .988, valanceDropA, edgeA[2] * .988] as const;
    const lowerB = [edgeB[0] * .988, valanceDropB, edgeB[2] * .988] as const;
    [edgeA, lowerA, lowerB, edgeA, lowerB, edgeB].forEach(([x, y, z]) => addVertex(x, y, z, shade));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function BeachUmbrella({
  wind,
  windDirection,
  coastHeading,
  weatherCode,
  mobile,
  position,
  rotation,
  scale,
}: {
  wind: number;
  windDirection: number;
  coastHeading: number;
  weatherCode: number;
  mobile: boolean;
  position: [number, number, number];
  rotation: number;
  scale: number;
}) {
  const canopy = useRef<THREE.Group>(null);
  const fabric = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => createUmbrellaCanopyGeometry(mobile ? 16 : 24), [mobile]);
  const basePositions = useMemo(() => (geometry.getAttribute("position").array as Float32Array).slice(), [geometry]);
  const weather = weatherProfile(weatherCode);
  const reducedMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const windAngle = THREE.MathUtils.degToRad(windDirection - coastHeading);
  const windVector = useMemo(() => new THREE.Vector2(Math.sin(windAngle), Math.cos(windAngle)).normalize(), [windAngle]);
  const furled = weather.storm || weather.kind === "snow" || wind > 1.22;
  const ribPositions = useMemo(() => {
    const values: number[] = [];
    const ribCount = mobile ? 8 : 12;
    for (let index = 0; index < ribCount; index += 1) {
      const angle = (index / ribCount) * Math.PI * 2;
      values.push(0, .54, 0, Math.sin(angle) * 2.82, .015, Math.cos(angle) * 2.82);
    }
    return new Float32Array(values);
  }, [mobile]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ clock }, delta) => {
    if (!canopy.current || !fabric.current) return;
    const t = reducedMotion ? 1.4 : clock.elapsedTime;
    const gust = reducedMotion ? 0 : Math.sin(t * (1.34 + wind * .72) + 1.7) * .5 + Math.sin(t * 2.73) * .22;
    const tilt = furled ? .015 : .025 + wind * .085 + gust * wind * .018;
    canopy.current.rotation.x = THREE.MathUtils.damp(canopy.current.rotation.x, windVector.y * tilt, 4.2, delta);
    canopy.current.rotation.z = THREE.MathUtils.damp(canopy.current.rotation.z, -windVector.x * tilt, 4.2, delta);
    canopy.current.rotation.y = dampAngle(canopy.current.rotation.y, windAngle + gust * .018, 2.4, delta);
    const openScale = furled ? .17 : 1;
    canopy.current.scale.x = THREE.MathUtils.damp(canopy.current.scale.x, openScale, 3.8, delta);
    canopy.current.scale.z = THREE.MathUtils.damp(canopy.current.scale.z, openScale, 3.8, delta);
    canopy.current.scale.y = THREE.MathUtils.damp(canopy.current.scale.y, furled ? 1.34 : 1, 3.8, delta);

    const position = fabric.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    const values = position.array as Float32Array;
    const flutterStrength = reducedMotion || furled ? 0 : wind * .026;
    for (let index = 0; index < values.length; index += 3) {
      const x = basePositions[index];
      const y = basePositions[index + 1];
      const z = basePositions[index + 2];
      const radius = Math.hypot(x, z);
      const edge = THREE.MathUtils.smoothstep(radius, .82, 2.9);
      const phase = Math.atan2(x, z) * 3 + radius * 1.7;
      values[index + 1] = y + Math.sin(t * (3.4 + wind * 1.8) + phase) * flutterStrength * edge;
    }
    position.needsUpdate = true;
    fabric.current.geometry.computeVertexNormals();
  });

  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <mesh position={[0, 2.05, 0]} castShadow>
        <cylinderGeometry args={[.13, .19, 4.1, 12]} />
        <meshStandardMaterial color="#e6d9bd" roughness={.72} />
      </mesh>
      <mesh position={[0, .08, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <cylinderGeometry args={[.52, .34, .13, 18]} />
        <meshStandardMaterial color="#bba57d" roughness={.96} />
      </mesh>
      <group ref={canopy} position={[0, 4.08, 0]}>
        <mesh ref={fabric} geometry={geometry} castShadow={!mobile} receiveShadow>
          <meshStandardMaterial vertexColors roughness={.78} side={THREE.DoubleSide} />
        </mesh>
        <lineSegments renderOrder={2}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[ribPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#b9b7a9" transparent opacity={.72} depthWrite={false} />
        </lineSegments>
        <mesh position={[0, .54, 0]}>
          <sphereGeometry args={[.11, 10, 7]} />
          <meshStandardMaterial color="#d2c8ae" metalness={.38} roughness={.38} />
        </mesh>
        <mesh position={[0, .73, 0]}>
          <cylinderGeometry args={[.035, .055, .35, 8]} />
          <meshStandardMaterial color="#c9bea5" metalness={.28} roughness={.46} />
        </mesh>
      </group>
    </group>
  );
}

function alongshoreZoneOffsets(beach: Beach, currentZoneName: string) {
  const reference = beach.zones.find((zone) => zone.name === currentZoneName)
    ?? beach.zones.find((zone) => zone.name.includes(currentZoneName) || currentZoneName.includes(zone.name))
    ?? { lat: beach.lat, lon: beach.lon };
  const latitudeScale = 111_320;
  const longitudeScale = Math.cos(THREE.MathUtils.degToRad((reference.lat + beach.lat) * .5)) * latitudeScale;
  const alongshoreBearing = THREE.MathUtils.degToRad(beach.heading + 90);
  const alongshoreEast = Math.sin(alongshoreBearing);
  const alongshoreNorth = Math.cos(alongshoreBearing);
  return beach.zones.map((zone) => {
    const east = (zone.lon - reference.lon) * longitudeScale;
    const north = (zone.lat - reference.lat) * latitudeScale;
    return {
      zone,
      offset: east * alongshoreEast + north * alongshoreNorth,
      current: zone.name === currentZoneName,
    };
  });
}

function CoastZoneMarker({
  label,
  note,
  offset,
  current,
  light,
}: {
  label: string;
  note: string;
  offset: number;
  current: boolean;
  light: number;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 200;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = current ? "rgba(8,38,42,.96)" : "rgba(18,27,31,.94)";
      context.fillRect(0, 0, 640, 200);
      context.strokeStyle = current ? "#8ef4e5" : "#e8c574";
      context.lineWidth = 9;
      context.strokeRect(7, 7, 626, 186);
      context.fillStyle = current ? "#8ef4e5" : "#e8c574";
      context.font = "800 24px Arial";
      context.letterSpacing = "5px";
      context.fillText(current ? "CURRENT SURF PEAK" : "COASTAL SURF PEAK", 38, 47);
      const title = label.toUpperCase();
      let titleSize = 62;
      context.font = `900 ${titleSize}px Arial`;
      while (context.measureText(title).width > 566 && titleSize > 34) {
        titleSize -= 2;
        context.font = `900 ${titleSize}px Arial`;
      }
      context.fillStyle = "#f5f4eb";
      context.fillText(title, 36, 118);
      context.font = "700 22px Arial";
      context.fillStyle = "rgba(229,241,235,.72)";
      const detail = note.toUpperCase();
      context.fillText(detail.length > 48 ? `${detail.slice(0, 46)}…` : detail, 38, 164);
    }
    const value = new THREE.CanvasTexture(canvas);
    value.colorSpace = THREE.SRGBColorSpace;
    value.anisotropy = 4;
    return value;
  }, [current, label, note]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group position={[offset, 0, 68.8]}>
      {[-2.08, 2.08].map((x) => (
        <mesh key={x} position={[x, 1.15, .08]} castShadow>
          <cylinderGeometry args={[.055, .075, 2.3, 8]} />
          <meshStandardMaterial color="#9ca7a2" metalness={.62} roughness={.38} />
        </mesh>
      ))}
      <mesh position={[0, 2.15, 0]} castShadow>
        <planeGeometry args={[5.25, 1.64]} />
        <meshStandardMaterial
          map={texture}
          emissive={current ? "#195b55" : "#5f4b18"}
          emissiveIntensity={(1 - light) * .46 + .08}
          metalness={.08}
          roughness={.54}
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight position={[0, 2.25, -.45]} intensity={current ? (1 - light) * .42 : 0} distance={9} color="#8ef4e5" />
    </group>
  );
}

function CoastWayfinding({ beach, zoneName, light }: { beach: Beach; zoneName: string; light: number }) {
  const markers = useMemo(
    () => alongshoreZoneOffsets(beach, zoneName).filter(({ offset }) => Math.abs(offset) <= COAST_PLAYABLE_HALF_WIDTH - 24),
    [beach, zoneName],
  );
  return (
    <group>
      {markers.map(({ zone, offset, current }) => (
        <CoastZoneMarker
          key={zone.name}
          label={zone.name}
          note={zone.note}
          offset={offset}
          current={current}
          light={light}
        />
      ))}
    </group>
  );
}

function BeachLife({
  beach,
  zoneName,
  windSpeed,
  windDirection,
  coastHeading,
  weatherCode,
  light,
  tide,
  playerPosition,
}: {
  beach: Beach;
  zoneName: string;
  windSpeed: number;
  windDirection: number;
  coastHeading: number;
  weatherCode: number;
  light: number;
  tide: number;
  playerPosition: MutableRefObject<THREE.Vector3>;
}) {
  const biome = getCoastBiome(beach.id);
  const wind = THREE.MathUtils.clamp(windSpeed / 24, 0.08, 1.4);
  const mobileRenderer = useMemo(() => isMobileRenderer(), []);
  const quality = useRenderQuality();
  const wetSand = useRef<THREE.Mesh>(null);
  const initialChunkIndex = Math.round(playerPosition.current.x / COAST_CHUNK_SPAN);
  const [coastChunkIndex, setCoastChunkIndex] = useState(initialChunkIndex);
  const coastChunkIndexRef = useRef(initialChunkIndex);
  const sandTextureSource = useTexture(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/textures/sand-premium.webp`);
  const sandTexture = useMemo(
    () => createTiledSandTexture(sandTextureSource, Math.round(COAST_GEOMETRY_WIDTH / 250 * 22), 11),
    [sandTextureSource],
  );
  const wetSandTexture = useMemo(
    () => createTiledSandTexture(sandTextureSource, Math.round(COAST_GEOMETRY_WIDTH / 250 * 22), 2),
    [sandTextureSource],
  );
  const coastChunks = useMemo(
    () => COAST_CHUNK_SLOTS.map((slot) => createCoastChunkLayout(coastChunkIndex + slot, beach.id)),
    [beach.id, coastChunkIndex],
  );
  useEffect(() => () => {
    sandTexture.dispose();
    wetSandTexture.dispose();
  }, [sandTexture, wetSandTexture]);
  const surface = {
    urban: ["#c0aa91", "#756a60"],
    tropical: ["#e0c499", "#88735c"],
    dune: ["#c7ad86", "#776b5e"],
    rugged: ["#b49a7c", "#6f665e"],
    cold: ["#a6a39a", "#606965"],
    volcanic: ["#454744", "#252b2a"],
    desert: ["#c08c62", "#725a49"],
  }[biome];
  const tideShift = shorelineShiftForTide(tide);
  useFrame((_, delta) => {
    if (wetSand.current) wetSand.current.position.z = THREE.MathUtils.damp(wetSand.current.position.z, 21 + tideShift, 2.8, delta);
    const nextChunkIndex = Math.round(playerPosition.current.x / COAST_CHUNK_SPAN);
    if (nextChunkIndex !== coastChunkIndexRef.current) {
      coastChunkIndexRef.current = nextChunkIndex;
      setCoastChunkIndex(nextChunkIndex);
    }
  });
  return (
    <group>
      <mesh position={[0, -0.5, 64]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[COAST_GEOMETRY_WIDTH, 125, 64, 20]} />
        <meshStandardMaterial color={surface[0]} map={sandTexture} bumpMap={sandTexture} bumpScale={0.045} roughness={0.93} metalness={0} />
      </mesh>
      <mesh ref={wetSand} position={[0, -0.43, 21 + tideShift]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[COAST_GEOMETRY_WIDTH, 18]} />
        <meshStandardMaterial color={surface[1]} map={wetSandTexture} bumpMap={wetSandTexture} bumpScale={0.025} roughness={0.76} metalness={0.04} />
      </mesh>
      <group position={[0, 0, 78]}>
        <RoadSurface weatherCode={weatherCode} light={light} />
        <mesh position={[0, -0.31, -6.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[COAST_GEOMETRY_WIDTH, 0.18]} />
          <meshStandardMaterial color="#dfd6b5" roughness={0.78} />
        </mesh>
        <mesh position={[0, -0.31, 6.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[COAST_GEOMETRY_WIDTH, 0.18]} />
          <meshStandardMaterial color="#dfd6b5" roughness={0.78} />
        </mesh>
        {Array.from({ length: Math.floor((COAST_GEOMETRY_WIDTH - 50) / 10) }, (_, index) => (
          <mesh key={index} position={[-COAST_GEOMETRY_WIDTH / 2 + 25 + index * 10, -0.29, 0]} receiveShadow>
            <boxGeometry args={[5.5, 0.04, 0.16]} />
            <meshStandardMaterial color="#d8c86c" roughness={0.82} emissive="#5b4d13" emissiveIntensity={0.08} />
          </mesh>
        ))}
        {Array.from({ length: Math.floor((COAST_GEOMETRY_WIDTH - 50) / 13) }, (_, index) => (
          <group key={index} position={[-COAST_GEOMETRY_WIDTH / 2 + 25 + index * 13, 0, -8.3]}>
            <mesh position={[0, 0.35, 0]}>
              <cylinderGeometry args={[0.045, 0.06, 1.3, 6]} />
              <meshStandardMaterial color="#7c6a4d" roughness={1} />
            </mesh>
            <mesh position={[0, 0.7, 0]}>
              <boxGeometry args={[0.9, 0.035, 0.08]} />
              <meshStandardMaterial color="#ad9670" roughness={1} />
            </mesh>
          </group>
        ))}
        <group position={[-24, 0, -8.2]}>
          <mesh position={[0, 1.4, 0]}>
            <cylinderGeometry args={[0.06, 0.08, 2.8, 8]} />
            <meshStandardMaterial color="#a1a9a4" metalness={0.65} roughness={0.38} />
          </mesh>
          <mesh position={[0, 2.5, 0]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[1.25, 1.25, 0.08]} />
            <meshStandardMaterial color="#e8e0c8" roughness={0.7} />
          </mesh>
          <mesh position={[0, 2.5, -0.06]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.82, 0.82, 0.035]} />
            <meshStandardMaterial color="#e56b4f" roughness={0.66} />
          </mesh>
        </group>
      </group>
      {coastChunks.map((chunk) => (
        <group
          key={chunk.worldIndex}
          position={[chunk.worldIndex * COAST_CHUNK_SPAN, 0, 0]}
        >
          {biome !== "urban" && biome !== "rugged" && chunk.dunes
            .slice(0, mobileRenderer ? quality === "reduced" ? 8 : quality === "high" ? 17 : 13 : quality === "reduced" ? 13 : 22)
            .map((dune, index) => (
            <mesh key={index} position={[dune.x, -0.4, dune.z]} scale={[dune.s, dune.height, dune.s * (.62 + seededRandom(index, chunk.activitySeed) * .2)]} receiveShadow>
              <sphereGeometry args={[1, 12, 8]} />
              <meshStandardMaterial color={biome === "volcanic" ? index % 2 ? "#373a36" : "#484a43" : index % 2 ? "#a9875f" : "#c19d6b"} roughness={1} />
            </mesh>
          ))}
          {chunk.umbrella && (
            <BeachUmbrella
              wind={wind}
              windDirection={windDirection}
              coastHeading={coastHeading}
              weatherCode={weatherCode}
              mobile={mobileRenderer}
              position={chunk.umbrella.position}
              rotation={chunk.umbrella.rotation}
              scale={chunk.umbrella.scale}
            />
          )}
          {chunk.station && (
            <LifeguardStation
              wind={wind}
              light={light}
              position={chunk.station.position}
              rotation={chunk.station.rotation}
            />
          )}
          <BeachActivity
            mobile={mobileRenderer}
            weatherCode={weatherCode}
            observerPosition={playerPosition}
            seed={chunk.activitySeed}
            worldOffsetX={chunk.worldIndex * COAST_CHUNK_SPAN}
          />
          <group position={[chunk.backdropOffset, 0, 0]} scale={[chunk.backdropScale, 1, 1]}>
            <CoastBackdrop
              biome={biome}
              wind={wind}
              windDirection={windDirection}
              coastHeading={coastHeading}
              light={light}
              mobile={mobileRenderer}
            />
          </group>
        </group>
      ))}
      <CoastWayfinding beach={beach} zoneName={zoneName} light={light} />
      <DestinationLandmarks beach={beach} mobile={mobileRenderer} light={light} />
    </group>
  );
}

function prepareVanScene(source: THREE.Group) {
  const model = source.clone(true);
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = true;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
  });
  return model;
}

function VanDriver({
  playerMotion,
  vehicleMotion,
  accent,
  thermalKit,
}: {
  playerMotion: MutableRefObject<MotionState>;
  vehicleMotion: MutableRefObject<VehicleMotionState>;
  accent: string;
  thermalKit: ThermalKit;
}) {
  const root = useRef<THREE.Group>(null);
  const ankleJointRef = useRef<THREE.Object3D | null>(null);

  useFrame((_, delta) => {
    if (!root.current) return;
    const driving = playerMotion.current.phase === "driving";
    const vehicle = vehicleMotion.current;
    root.current.visible = driving;
    root.current.position.y = THREE.MathUtils.damp(
      root.current.position.y,
      .72 + vehicle.suspension * .018,
      11,
      delta,
    );
    root.current.position.z = THREE.MathUtils.damp(
      root.current.position.z,
      -1.45 + vehicle.longitudinalG * .018,
      9,
      delta,
    );
    root.current.rotation.x = dampAngle(
      root.current.rotation.x,
      vehicle.longitudinalG * -.035,
      8,
      delta,
    );
    root.current.rotation.y = dampAngle(root.current.rotation.y, -Math.PI / 2, 12, delta);
    root.current.rotation.z = dampAngle(
      root.current.rotation.z,
      vehicle.lateralG * -.075 - vehicle.slip * Math.sign(vehicle.steer || 1) * .025,
      vehicle.traction < .72 ? 5.5 : 8,
      delta,
    );
  });

  return (
    <group ref={root} position={[-.72, .72, -1.45]} rotation={[0, -Math.PI / 2, 0]} scale={.91} visible={false}>
      <PremiumSurferBody
        motion={playerMotion}
        vehicleMotion={vehicleMotion}
        accent={accent}
        ankleJointRef={ankleJointRef}
        thermalKit={thermalKit}
      />
    </group>
  );
}

function SurfVan({
  motion,
  playerMotion,
  darkness,
  accent,
  thermalKit,
}: {
  motion: MutableRefObject<VehicleMotionState>;
  playerMotion: MutableRefObject<MotionState>;
  darkness: number;
  accent: string;
  thermalKit: ThermalKit;
}) {
  const { scene } = useGLTF(VAN_MODEL_URL);
  const model = useMemo(() => prepareVanScene(scene), [scene]);
  const body = useRef<THREE.Object3D | null>(null);
  const bodyRest = useRef({ y: 0, rotationX: 0, rotationZ: 0 });
  const steeringWheel = useRef<THREE.Object3D | null>(null);
  const steeringWheelRest = useRef(0);
  const steerLeft = useRef<THREE.Object3D | null>(null);
  const steerRight = useRef<THREE.Object3D | null>(null);
  const wheels = useRef<THREE.Object3D[]>([]);
  const wheelRestY = useRef<number[]>([]);
  const brakeMaterials = useRef<THREE.MeshStandardMaterial[]>([]);
  const headLights = useRef<Array<THREE.PointLight | null>>([]);

  useEffect(() => {
    body.current = namedModelObject(model, "VanBody") ?? null;
    steeringWheel.current = namedModelObject(model, "SteeringWheel") ?? null;
    steerLeft.current = namedModelObject(model, "Steer.FL") ?? null;
    steerRight.current = namedModelObject(model, "Steer.FR") ?? null;
    wheels.current = ["Wheel.FL", "Wheel.FR", "Wheel.RL", "Wheel.RR"]
      .map((name) => namedModelObject(model, name))
      .filter((wheel): wheel is THREE.Object3D => Boolean(wheel));
    wheelRestY.current = wheels.current.map((wheel) => wheel.position.y);
    if (body.current) {
      bodyRest.current = {
        y: body.current.position.y,
        rotationX: body.current.rotation.x,
        rotationZ: body.current.rotation.z,
      };
    }
    steeringWheelRest.current = steeringWheel.current?.rotation.z ?? 0;

    const nextBrakeMaterials: THREE.MeshStandardMaterial[] = [];
    namedModelObject(model, "BrakeLights")?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) nextBrakeMaterials.push(material);
      });
    });
    brakeMaterials.current = nextBrakeMaterials;
  }, [model]);

  useFrame(({ clock }, delta) => {
    const state = motion.current;
    const rotationDelta = state.speed * delta / 0.55;
    const speed = Math.abs(state.speed);
    const speedRatio = THREE.MathUtils.clamp(speed / 18.5, 0, 1);
    const suspensionAmplitude = state.driving
      ? (.006 + speedRatio * .009) * (1 + state.offRoad * 4.2 + state.slip * .65)
      : 0;
    wheels.current.forEach((wheel, index) => {
      wheel.rotation.x -= rotationDelta;
      const axlePhase = index < 2 ? 0 : 1.55;
      const sidePhase = index % 2 ? 2.15 : 0;
      const primary = Math.sin(clock.elapsedTime * (4.4 + speed * .72) + axlePhase + sidePhase);
      const chatter = Math.sin(clock.elapsedTime * (9.2 + speed * 1.08) + index * 1.71) * .38;
      const wheelTravel = (primary + chatter) * suspensionAmplitude;
      wheel.position.y = THREE.MathUtils.damp(
        wheel.position.y,
        (wheelRestY.current[index] ?? 0) + wheelTravel,
        state.offRoad > .25 ? 11 : 16,
        delta,
      );
    });
    if (steerLeft.current) steerLeft.current.rotation.y = THREE.MathUtils.damp(steerLeft.current.rotation.y, state.steer * 0.42, 9, delta);
    if (steerRight.current) steerRight.current.rotation.y = THREE.MathUtils.damp(steerRight.current.rotation.y, state.steer * 0.42, 9, delta);
    if (steeringWheel.current) {
      steeringWheel.current.rotation.z = dampAngle(
        steeringWheel.current.rotation.z,
        steeringWheelRest.current - state.steer * 1.08,
        11,
        delta,
      );
    }
    if (body.current) {
      const roadPulse = state.driving
        ? state.suspension * (.012 + speedRatio * .018 + state.offRoad * .028)
        : 0;
      const loadPitch = THREE.MathUtils.clamp(state.longitudinalG * .14, -.115, .085);
      const cornerRoll = THREE.MathUtils.clamp(state.lateralG * .18, -.13, .13);
      const looseSurfaceWobble = state.slip * Math.sin(clock.elapsedTime * 7.4) * .018;
      body.current.position.y = THREE.MathUtils.damp(body.current.position.y, bodyRest.current.y + roadPulse, 9, delta);
      body.current.rotation.z = THREE.MathUtils.damp(
        body.current.rotation.z,
        bodyRest.current.rotationZ + cornerRoll + looseSurfaceWobble,
        state.traction < .72 ? 5.2 : 7.4,
        delta,
      );
      body.current.rotation.x = THREE.MathUtils.damp(
        body.current.rotation.x,
        bodyRest.current.rotationX + loadPitch,
        state.brake ? 10.5 : 7.2,
        delta,
      );
    }
    const targetBrakeIntensity = state.brake ? 3.8 : 0.42;
    brakeMaterials.current.forEach((material) => {
      material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, targetBrakeIntensity, 12, delta);
    });
    const headlightIntensity = .08 + darkness * (1.85 + state.wetness * .72 + state.offRoad * .16);
    headLights.current.forEach((headlight) => {
      if (!headlight) return;
      headlight.intensity = THREE.MathUtils.damp(headlight.intensity, headlightIntensity, 5.5, delta);
      headlight.distance = THREE.MathUtils.damp(headlight.distance, 11 + darkness * 13, 4, delta);
    });
  });

  return (
    <group>
      <primitive object={model} />
      <VanDriver
        playerMotion={playerMotion}
        vehicleMotion={motion}
        accent={accent}
        thermalKit={thermalKit}
      />
      <pointLight ref={(light) => { headLights.current[0] = light; }} position={[-1.05, 1.12, -3.28]} color="#ffe6ad" intensity={0.08} distance={11} decay={1.8} />
      <pointLight ref={(light) => { headLights.current[1] = light; }} position={[1.05, 1.12, -3.28]} color="#ffe6ad" intensity={0.08} distance={11} decay={1.8} />
    </group>
  );
}

const VAN_TRACK_COUNT = 44;

function VehicleSurfaceEffects({
  motion,
  targetPosition,
  heading,
  mobile,
}: {
  motion: MutableRefObject<VehicleMotionState>;
  targetPosition: MutableRefObject<THREE.Vector3>;
  heading: MutableRefObject<number>;
  mobile: boolean;
}) {
  const quality = useRenderQuality();
  const particleCount = mobile
    ? quality === "reduced" ? 18 : quality === "high" ? 38 : 28
    : quality === "reduced" ? 36 : quality === "balanced" ? 48 : 58;
  const particles = useRef<THREE.Points>(null);
  const particleMaterial = useRef<THREE.PointsMaterial>(null);
  const tracks = useRef<THREE.InstancedMesh>(null);
  const trackMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) values[index * 3 + 1] = -100;
    return values;
  }, [particleCount]);
  const velocities = useRef(new Float32Array(particleCount * 3));
  const life = useRef(new Float32Array(particleCount));
  const particleKind = useRef(new Float32Array(particleCount));
  const particleCursor = useRef(0);
  const emission = useRef(0);
  const trackCursor = useRef(0);
  const traveled = useRef(0);
  const previousPosition = useRef(new THREE.Vector3());
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const wetParticleColor = useMemo(() => new THREE.Color("#d7f2ee"), []);
  const dustParticleColor = useMemo(() => new THREE.Color("#b99a72"), []);
  const roadTrackColor = useMemo(() => new THREE.Color("#11191a"), []);
  const sandTrackColor = useMemo(() => new THREE.Color("#5a4734"), []);
  const trackData = useRef(Array.from({ length: VAN_TRACK_COUNT }, () => ({ x: 0, y: -100, z: 0, heading: 0, age: 0 })));
  const particleTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 30);
      gradient.addColorStop(0, "rgba(255,255,255,.98)");
      gradient.addColorStop(.32, "rgba(255,255,255,.72)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  useEffect(() => {
    previousPosition.current.copy(targetPosition.current);
    tracks.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return () => particleTexture.dispose();
  }, [particleTexture, targetPosition]);

  useFrame((_, delta) => {
    const state = motion.current;
    const current = targetPosition.current;
    const distance = current.distanceTo(previousPosition.current);
    const speed = Math.abs(state.speed);
    const driveStrength = state.driving ? THREE.MathUtils.smoothstep(speed, 1.1, 9.5) : 0;
    const wetSpray = state.wetness * (1 - state.offRoad * .72);
    const dust = state.offRoad * (1 - state.wetness * .78);
    const dominantDust = dust > wetSpray;
    const surfaceStrength = Math.max(wetSpray, dust);
    const forwardX = -Math.sin(heading.current);
    const forwardZ = -Math.cos(heading.current);
    const rightX = Math.cos(heading.current);
    const rightZ = -Math.sin(heading.current);
    const rearX = current.x - forwardX * 2.38;
    const rearZ = current.z - forwardZ * 2.38;
    const positionAttribute = particles.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const particlePositions = positionAttribute?.array as Float32Array | undefined;

    emission.current += delta * driveStrength * (wetSpray * 34 + dust * 24 + state.slip * 19);
    if (particlePositions && emission.current >= 1) {
      const count = Math.min(5, Math.floor(emission.current));
      emission.current -= count;
      for (let particle = 0; particle < count; particle += 1) {
        const index = particleCursor.current++ % particleCount;
        const offset = index * 3;
        const side = particle % 2 ? 1 : -1;
        const scatter = (Math.random() - .5) * .22;
        particlePositions[offset] = rearX + rightX * (side * 1.02 + scatter);
        particlePositions[offset + 1] = -.02 + Math.random() * .22;
        particlePositions[offset + 2] = rearZ + rightZ * (side * 1.02 + scatter);
        const backwash = 1.1 + Math.random() * (dominantDust ? 2.8 : 2.1) + state.slip * 1.4;
        const lateral = side * (.28 + Math.random() * .72) + state.steer * state.slip * 1.25;
        velocities.current[offset] = -forwardX * backwash + rightX * lateral;
        velocities.current[offset + 1] = (dominantDust ? .42 : .7) + Math.random() * (dominantDust ? .72 : 1.15);
        velocities.current[offset + 2] = -forwardZ * backwash + rightZ * lateral;
        life.current[index] = dominantDust ? .72 + Math.random() * .52 : .42 + Math.random() * .38;
        particleKind.current[index] = dominantDust ? 1 : 0;
      }
    }

    if (particlePositions && positionAttribute) {
      for (let index = 0; index < particleCount; index += 1) {
        if (life.current[index] <= 0) continue;
        const offset = index * 3;
        life.current[index] -= delta;
        particlePositions[offset] += velocities.current[offset] * delta;
        particlePositions[offset + 1] += velocities.current[offset + 1] * delta;
        particlePositions[offset + 2] += velocities.current[offset + 2] * delta;
        const isDust = particleKind.current[index] > .5;
        velocities.current[offset + 1] -= delta * (isDust ? .18 : 3.7);
        velocities.current[offset] *= 1 - delta * (isDust ? .52 : 1.2);
        velocities.current[offset + 2] *= 1 - delta * (isDust ? .52 : 1.2);
        if (life.current[index] <= 0 || (!isDust && particlePositions[offset + 1] < -.28)) particlePositions[offset + 1] = -100;
      }
      positionAttribute.needsUpdate = true;
    }

    if (particleMaterial.current) {
      particleMaterial.current.opacity = THREE.MathUtils.damp(particleMaterial.current.opacity, driveStrength * (.36 + surfaceStrength * .5), 5, delta);
      particleMaterial.current.size = THREE.MathUtils.damp(particleMaterial.current.size, dominantDust ? .42 : .24, 5, delta);
      particleMaterial.current.color.lerp(dominantDust ? dustParticleColor : wetParticleColor, 1 - Math.exp(-delta * 4));
    }

    const markStrength = Math.max(state.offRoad, state.wetness * .72, state.brake ? .9 : 0, state.slip * .92);
    if (state.driving && driveStrength > .08 && markStrength > .12) {
      traveled.current += distance;
      if (traveled.current > .78) {
        traveled.current %= .78;
        for (const side of [-1, 1]) {
          const mark = trackData.current[trackCursor.current++ % VAN_TRACK_COUNT];
          mark.x = rearX + rightX * side * 1.02;
          mark.z = rearZ + rightZ * side * 1.02;
          mark.y = THREE.MathUtils.lerp(-.285, -.455, state.offRoad);
          mark.heading = heading.current;
          mark.age = state.offRoad > .25 ? 11 : state.brake || state.slip > .2 ? 6.5 : 8;
        }
      }
    } else if (!state.driving) {
      traveled.current = 0;
    }
    previousPosition.current.copy(current);

    if (tracks.current) {
      trackData.current.forEach((mark, index) => {
        mark.age = Math.max(0, mark.age - delta);
        if (mark.age <= 0) {
          dummy.position.set(0, -100, 0);
          dummy.scale.setScalar(.001);
        } else {
          const fade = THREE.MathUtils.smoothstep(mark.age, 0, 1.8);
          dummy.position.set(mark.x, mark.y, mark.z);
          dummy.rotation.set(-Math.PI / 2, mark.heading, 0);
          dummy.scale.set(.88 * fade, 1, 1);
        }
        dummy.updateMatrix();
        tracks.current?.setMatrixAt(index, dummy.matrix);
      });
      tracks.current.instanceMatrix.needsUpdate = true;
    }
    if (trackMaterial.current) {
      trackMaterial.current.opacity = THREE.MathUtils.damp(trackMaterial.current.opacity, .12 + markStrength * .2, 4, delta);
      trackMaterial.current.color.lerp(state.offRoad > .35 ? sandTrackColor : roadTrackColor, 1 - Math.exp(-delta * 3));
    }
  });

  return (
    <group>
      <instancedMesh ref={tracks} args={[undefined, undefined, VAN_TRACK_COUNT]} frustumCulled={false} renderOrder={3}>
        <planeGeometry args={[.24, 1.38]} />
        <meshBasicMaterial ref={trackMaterial} color="#11191a" transparent opacity={0} depthWrite={false} polygonOffset polygonOffsetFactor={-3} />
      </instancedMesh>
      <points ref={particles} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={particleMaterial}
          map={particleTexture}
          color="#d7f2ee"
          size={.24}
          sizeAttenuation
          transparent
          opacity={0}
          alphaTest={.03}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

function UnderwaterAtmosphere({
  motion,
  backgroundRef,
  fogRef,
  backgroundColor,
  fogColor,
  fogNear,
  fogFar,
  light,
  mobile,
}: {
  motion: MutableRefObject<MotionState>;
  backgroundRef: MutableRefObject<THREE.Color | null>;
  fogRef: MutableRefObject<THREE.Fog | null>;
  backgroundColor: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  light: number;
  mobile: boolean;
}) {
  const baseBackground = useMemo(() => new THREE.Color(backgroundColor), [backgroundColor]);
  const baseFog = useMemo(() => new THREE.Color(fogColor), [fogColor]);
  const underwaterBackground = useMemo(
    () => new THREE.Color("#003f50").lerp(new THREE.Color("#0a6d70"), light * .24),
    [light],
  );
  const underwaterFog = useMemo(
    () => new THREE.Color("#074c59").lerp(new THREE.Color("#168074"), light * .28),
    [light],
  );

  useFrame((_, delta) => {
    const depth = THREE.MathUtils.clamp(motion.current.submersion, 0, 1);
    if (backgroundRef.current) {
      backgroundRef.current.lerpColors(baseBackground, underwaterBackground, depth);
    }
    if (fogRef.current) {
      fogRef.current.color.lerpColors(baseFog, underwaterFog, depth);
      fogRef.current.near = THREE.MathUtils.damp(fogRef.current.near, THREE.MathUtils.lerp(fogNear, .28, depth), 12, delta);
      fogRef.current.far = THREE.MathUtils.damp(
        fogRef.current.far,
        THREE.MathUtils.lerp(fogFar, (mobile ? 12 : 17) + light * 4, depth),
        depth > .04 ? 10 : 4.5,
        delta,
      );
    }
  });

  return null;
}

const CINEMATIC_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uWarmth: { value: 0 },
    uVignette: { value: .05 },
    uGrain: { value: .002 },
    uUnderwater: { value: 0 },
    uStorm: { value: 0 },
    uNight: { value: 0 },
    uSpray: { value: 0 },
    uOceanTime: { value: 0 },
    uWaterline: { value: -.16 },
    uRefraction: { value: 0 },
    uSurfacePulse: { value: 0 },
    uFlow: { value: new THREE.Vector2(0, 1) },
    uLensWetness: { value: 0 },
    uRain: { value: 0 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uWarmth;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uUnderwater;
    uniform float uStorm;
    uniform float uNight;
    uniform float uSpray;
    uniform float uOceanTime;
    uniform float uWaterline;
    uniform float uRefraction;
    uniform float uSurfacePulse;
    uniform vec2 uFlow;
    uniform float uLensWetness;
    uniform float uRain;
    uniform float uAspect;
    varying vec2 vUv;

    float luminance(vec3 color) {
      return dot(color, vec3(.2126, .7152, .0722));
    }

    float interleavedGradientNoise(vec2 pixel, float frame) {
      return fract(52.9829189 * fract(dot(pixel + frame * vec2(.067, .113), vec2(.06711056, .00583715))));
    }

    float dropletHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * .1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec3 lensDropletLayer(vec2 uv, float time, float scale, float seed) {
      vec2 aspect = vec2(max(.56, uAspect), 1.0);
      vec2 p = uv * aspect * scale;
      p.y += time * mix(.12, .31, uRain) + seed * 9.7;
      p.x += sin(time * .19 + seed * 5.3) * (.055 + uRain * .045);
      vec2 cell = floor(p);
      vec2 local = fract(p) - .5;
      float random = dropletHash(cell + seed * 13.7);
      vec2 center = vec2(
        (dropletHash(cell + vec2(7.1, 2.8) + seed) - .5) * .62,
        (dropletHash(cell + vec2(3.7, 9.2) - seed) - .5) * .54
      );
      center.y += sin(time * (.42 + random * .16) + random * 6.283) * .035;
      vec2 offset = local - center;
      vec2 shaped = offset * vec2(1.0, 1.18);
      float radius = mix(.075, .205, pow(random, 2.15));
      float bodyDistance = length(shaped);
      float body = smoothstep(radius, radius * .58, bodyDistance);

      float trailRandom = dropletHash(cell + vec2(13.2, 4.6) + seed);
      float trailLength = mix(.11, .46, trailRandom) * (.48 + uRain * .75);
      float trailWidth = radius * mix(.12, .26, trailRandom);
      float aboveDrop = max(0.0, offset.y - radius * .18);
      float trail = smoothstep(trailWidth, trailWidth * .18, abs(offset.x) + aboveDrop * .11);
      trail *= 1.0 - smoothstep(trailLength * .28, trailLength, aboveDrop);
      trail *= smoothstep(-radius * .18, radius * .12, offset.y);
      trail *= .38 + uRain * .42;

      float satellite = smoothstep(
        radius * .42,
        radius * .17,
        length((local - center - vec2(radius * 1.25, radius * .72)) * vec2(1.0, 1.28))
      ) * smoothstep(.31, .86, random);
      float mask = clamp(max(body, max(trail, satellite * .56)), 0.0, 1.0);
      vec2 normal = bodyDistance > .0001
        ? normalize(shaped) * body
        : vec2(0.0);
      normal += vec2(sign(offset.x), -.18) * trail * .3;
      normal += normalize(vec2(offset.x + .001, offset.y + .001)) * satellite * .34;
      return vec3(normal * mask, mask);
    }

    void main() {
      vec2 flow = normalize(uFlow + vec2(.0001));
      vec2 crossFlow = vec2(-flow.y, flow.x);
      float waterline = uWaterline
        + sin(vUv.x * 17.0 + uOceanTime * 1.35) * (.0025 + uSurfacePulse * .009)
        + sin(vUv.x * 43.0 - uOceanTime * 2.1) * (.0015 + uSurfacePulse * .004);
      float belowSurface = 1.0 - smoothstep(waterline - .022, waterline + .018, vUv.y);
      float surfaceBand = exp(-abs(vUv.y - waterline) * mix(44.0, 25.0, uSurfacePulse));
      float longWave = sin(dot(vUv, flow) * 31.0 - uOceanTime * 1.85);
      float crossWave = sin(dot(vUv, crossFlow) * 47.0 + uOceanTime * 2.35 + longWave * .42);
      vec2 refractionVector = flow * (longWave * .62 + crossWave * .18)
        + crossFlow * (crossWave * .46 - longWave * .12);
      float refractionMask = belowSurface * (.34 + uUnderwater * .42)
        + surfaceBand * (1.08 + uSurfacePulse * .72);
      float lensVisibility = uLensWetness * (1.0 - smoothstep(.035, .42, uUnderwater));
      float dropletMask = 0.0;
      vec2 dropletNormal = vec2(0.0);
      vec2 lensRefraction = vec2(0.0);
      if (lensVisibility > .002) {
        vec3 largeDrops = lensDropletLayer(vUv, uOceanTime, 5.4, 1.7);
        vec3 middleDrops = lensDropletLayer(vUv + vec2(.071, -.043), uOceanTime * 1.13, 8.6, 4.9);
        vec3 fineDrops = uRain > .035
          ? lensDropletLayer(vUv + vec2(-.039, .057), uOceanTime * 1.31, 13.2, 8.3)
          : vec3(0.0);
        dropletMask = clamp(
          max(largeDrops.z, max(middleDrops.z * .92, fineDrops.z * (.52 + uRain * .32))),
          0.0,
          1.0
        ) * lensVisibility;
        dropletNormal = (
          largeDrops.xy
          + middleDrops.xy * .72
          + fineDrops.xy * (.3 + uRain * .16)
        ) * lensVisibility;
        lensRefraction = dropletNormal * (.0021 + lensVisibility * .0044 + uRain * .0012);
      }
      vec2 refractedUv = clamp(
        vUv + refractionVector * uRefraction * refractionMask + lensRefraction,
        vec2(.002),
        vec2(.998)
      );
      float chromaticOffset = uRefraction * (
        belowSurface * .18
        + surfaceBand * (.48 + uSurfacePulse * .54)
      ) + dropletMask * lensVisibility * .00042;
      vec2 chromaticVector = normalize(refractionVector + vec2(.001)) * chromaticOffset;
      vec4 source;
      if (uRefraction > .00001) {
        source = texture2D(tDiffuse, refractedUv);
        source.r = texture2D(tDiffuse, clamp(refractedUv + chromaticVector, vec2(.002), vec2(.998))).r;
        source.b = texture2D(tDiffuse, clamp(refractedUv - chromaticVector * .72, vec2(.002), vec2(.998))).b;
      } else {
        source = texture2D(tDiffuse, vUv);
      }
      vec3 color = max(source.rgb, vec3(0.0));
      float initialLuma = luminance(color);

      // A restrained display curve keeps the ACES highlight roll-off while
      // restoring just enough separation in wet materials and distant haze.
      color = (color - vec3(.18)) * uContrast + vec3(.18);
      float gradedLuma = luminance(color);
      color = mix(vec3(gradedLuma), color, uSaturation);

      float highlightWeight = smoothstep(.16, .78, initialLuma);
      float shadowWeight = 1.0 - smoothstep(.04, .42, initialLuma);
      color += vec3(.020, .006, -.017) * uWarmth * highlightWeight;
      color += vec3(-.008, .003, .015) * uWarmth * -shadowWeight * .42;

      float stormMix = uStorm * (.18 + shadowWeight * .12);
      vec3 stormColor = mix(vec3(luminance(color)), color, .62) * vec3(.91, .995, 1.04);
      color = mix(color, stormColor, stormMix);

      vec3 nightColor = color * vec3(.84, .96, 1.08);
      nightColor += vec3(.002, .008, .018) * shadowWeight;
      color = mix(color, nightColor, uNight * .22);

      // Approximate the wavelength loss that occurs beneath the surface:
      // red falls away first, while suspended light lifts cyan-green mids.
      vec3 absorbed = color * vec3(.52, .86, .96);
      float underwaterLuma = luminance(absorbed);
      absorbed = mix(vec3(underwaterLuma) * vec3(.55, 1.04, 1.08), absorbed, .68);
      absorbed += vec3(0.0, .018, .024) * (1.0 - smoothstep(.2, .92, underwaterLuma));
      color = mix(color, absorbed, uUnderwater);
      color += vec3(.31, .78, .74) * surfaceBand * uSurfacePulse * (.018 + (1.0 - initialLuma) * .022);

      float sprayVeil = uSpray * (1.0 - initialLuma) * .032;
      color += vec3(.80, .94, .98) * sprayVeil;

      float dropletRim = smoothstep(.075, .34, dropletMask)
        * (1.0 - smoothstep(.58, .94, dropletMask));
      float dropletBody = smoothstep(.28, .9, dropletMask);
      float flowGlint = .5 + .5 * dot(normalize(dropletNormal + vec2(.001)), normalize(flow + vec2(.18, .34)));
      color *= 1.0 - dropletBody * (.018 + lensVisibility * .025);
      color += vec3(.73, .91, .96)
        * dropletRim
        * (.018 + initialLuma * .026 + flowGlint * (.014 + uSurfacePulse * .018));

      vec2 centered = vUv * 2.0 - 1.0;
      float edge = smoothstep(.2, 1.34, dot(centered, centered));
      color *= 1.0 - edge * uVignette;

      float noise = interleavedGradientNoise(gl_FragCoord.xy, uTime) - .5;
      float shadowGrain = mix(.72, 1.42, 1.0 - smoothstep(.04, .68, luminance(color)));
      color += noise * (uGrain * shadowGrain + 1.1 / 255.0);
      color = max(color, vec3(0.0));

      gl_FragColor = sRGBTransferOETF(vec4(color, source.a));
    }
  `,
};

function AdaptiveImagePipeline({
  motion,
  cloudFactor,
  weather,
  solarElevation,
  flowAngle,
  mobile,
  reducedMotion,
}: {
  motion: MutableRefObject<MotionState>;
  cloudFactor: number;
  weather: WeatherProfile;
  solarElevation: number;
  flowAngle: number;
  mobile: boolean;
  reducedMotion: boolean;
}) {
  const quality = useRenderQuality();
  const pass = useRef<ShaderPass>(null);
  const exposure = useRef(1.08);
  const previousDepth = useRef(0);
  const surfacePulse = useRef(0);
  const lensWetness = useRef(0);
  const targets = useRef({
    contrast: 1,
    saturation: 1,
    warmth: 0,
    vignette: .05,
    grain: .002,
    underwater: 0,
    storm: 0,
    night: 0,
    spray: 0,
    waterline: -.16,
    refraction: 0,
    surfacePulse: 0,
    lensWetness: 0,
    rain: 0,
  });
  const gradeEnabled = !(mobile && quality === "reduced");

  useFrame(({ clock, gl: renderer, size }, delta) => {
    const depth = THREE.MathUtils.clamp(motion.current.submersion, 0, 1);
    const depthStep = Math.max(.001, Math.min(delta, .05));
    const depthVelocity = (depth - previousDepth.current) / depthStep;
    const crossedSurface = (previousDepth.current <= .045 && depth > .045)
      || (previousDepth.current > .045 && depth <= .045);
    if (crossedSurface || (depth > .015 && depth < .52 && Math.abs(depthVelocity) > 2.2)) {
      surfacePulse.current = Math.max(
        surfacePulse.current,
        THREE.MathUtils.clamp(.52 + Math.abs(depthVelocity) * .085 + motion.current.impact * .28, .58, 1),
      );
    }
    surfacePulse.current = Math.max(0, surfacePulse.current - delta * (depth > .04 ? 1.45 : 2.2));
    previousDepth.current = depth;
    const night = 1 - THREE.MathUtils.smoothstep(solarElevation, -.05, .18);
    const goldenHour = 1 - THREE.MathUtils.smoothstep(Math.abs(solarElevation - .12), .04, .48);
    const storm = weather.storm
      ? 1
      : THREE.MathUtils.clamp(weather.intensity * .52 + (weather.fog ? .28 : 0), 0, .72);
    const spray = THREE.MathUtils.clamp(
      Math.max(
        motion.current.impact * .9,
        motion.current.shorebreak * .58,
        motion.current.wipeout * .78,
        motion.current.barrel * .32,
      ) * (1 - depth * .7),
      0,
      1,
    );
    const rain = weather.kind === "rain" ? weather.intensity : 0;
    const lensDeposit = THREE.MathUtils.clamp(
      Math.max(
        spray * .88,
        surfacePulse.current * .96,
        rain * .72,
        depth > .24 ? .92 : depth * 1.9,
      ),
      0,
      1,
    );
    if (lensDeposit > lensWetness.current) {
      lensWetness.current = THREE.MathUtils.damp(lensWetness.current, lensDeposit, 13, delta);
    } else {
      const evaporation = .038 + (1 - cloudFactor) * .02 + (weather.storm ? 0 : .012);
      lensWetness.current = Math.max(
        lensDeposit * .36,
        lensWetness.current - delta * evaporation,
      );
    }
    const targetExposure = 1.055
      + night * .19
      + goldenHour * .045
      - cloudFactor * .022
      - storm * .052
      - depth * .11;
    exposure.current = THREE.MathUtils.damp(exposure.current, targetExposure, depth > .04 ? 7.5 : 2.8, delta);
    renderer.toneMappingExposure = exposure.current;

    const values = targets.current;
    values.contrast = 1.025 + storm * .025 + depth * .018;
    values.saturation = 1.035 - cloudFactor * .035 - storm * .085 - night * .045 - depth * .035;
    values.warmth = goldenHour * .78 - storm * .34 - depth * .5;
    values.vignette = .045 + motion.current.barrel * .028 + depth * .04 + storm * .012;
    values.grain = reducedMotion ? .0012 : mobile ? .00165 : .00215;
    values.underwater = depth;
    values.storm = storm;
    values.night = night;
    values.spray = spray;
    const surfaceTransition = 1 - THREE.MathUtils.smoothstep(depth, .32, .78);
    values.waterline = THREE.MathUtils.lerp(
      -.16,
      1.16,
      THREE.MathUtils.smootherstep(depth, .004, .38),
    );
    values.surfacePulse = surfacePulse.current;
    values.refraction = (
      depth * .0032
      + surfaceTransition * THREE.MathUtils.smoothstep(depth, .004, .28) * .0035
      + surfacePulse.current * .008
      + motion.current.wipeoutPower * depth * .0015
    ) * (mobile ? .72 : 1);
    values.lensWetness = lensWetness.current;
    values.rain = rain;

    const uniforms = pass.current?.uniforms;
    if (!uniforms) return;
    uniforms.uTime.value = reducedMotion ? 0 : clock.elapsedTime * 37;
    uniforms.uOceanTime.value = reducedMotion ? 0 : clock.elapsedTime;
    uniforms.uContrast.value = THREE.MathUtils.damp(uniforms.uContrast.value, values.contrast, 3.5, delta);
    uniforms.uSaturation.value = THREE.MathUtils.damp(uniforms.uSaturation.value, values.saturation, 3.5, delta);
    uniforms.uWarmth.value = THREE.MathUtils.damp(uniforms.uWarmth.value, values.warmth, 3.2, delta);
    uniforms.uVignette.value = THREE.MathUtils.damp(uniforms.uVignette.value, values.vignette, 4, delta);
    uniforms.uGrain.value = values.grain;
    uniforms.uUnderwater.value = THREE.MathUtils.damp(uniforms.uUnderwater.value, values.underwater, 9, delta);
    uniforms.uStorm.value = THREE.MathUtils.damp(uniforms.uStorm.value, values.storm, 2.5, delta);
    uniforms.uNight.value = THREE.MathUtils.damp(uniforms.uNight.value, values.night, 2.5, delta);
    uniforms.uSpray.value = THREE.MathUtils.damp(
      uniforms.uSpray.value,
      values.spray,
      values.spray > uniforms.uSpray.value ? 10 : 3.5,
      delta,
    );
    uniforms.uWaterline.value = THREE.MathUtils.damp(uniforms.uWaterline.value, values.waterline, 13, delta);
    uniforms.uRefraction.value = THREE.MathUtils.damp(
      uniforms.uRefraction.value,
      values.refraction,
      values.refraction > uniforms.uRefraction.value ? 16 : 7,
      delta,
    );
    uniforms.uSurfacePulse.value = THREE.MathUtils.damp(
      uniforms.uSurfacePulse.value,
      values.surfacePulse,
      values.surfacePulse > uniforms.uSurfacePulse.value ? 18 : 5,
      delta,
    );
    uniforms.uLensWetness.value = THREE.MathUtils.damp(
      uniforms.uLensWetness.value,
      values.lensWetness,
      values.lensWetness > uniforms.uLensWetness.value ? 12 : 1.4,
      delta,
    );
    uniforms.uRain.value = THREE.MathUtils.damp(uniforms.uRain.value, values.rain, 3.5, delta);
    uniforms.uAspect.value = size.width / Math.max(1, size.height);
    uniforms.uFlow.value.set(Math.sin(flowAngle), Math.cos(flowAngle));
  });

  if (!gradeEnabled) return null;

  return (
    <Effects
      key={`cinematic-${mobile ? "mobile" : "desktop"}-${quality}`}
      multisamping={mobile ? 0 : quality === "high" ? 2 : 0}
      type={mobile ? THREE.UnsignedByteType : THREE.HalfFloatType}
      depthBuffer
      stencilBuffer={false}
      disableGamma
    >
      <shaderPass ref={pass} args={[CINEMATIC_GRADE_SHADER]} />
    </Effects>
  );
}

function UnderwaterSuspendedMatter({
  motion,
  settings,
  mobile,
}: {
  motion: MutableRefObject<MotionState>;
  settings: SessionSettings;
  mobile: boolean;
}) {
  const quality = useRenderQuality();
  const particleCount = mobile
    ? quality === "reduced" ? 24 : quality === "high" ? 50 : 36
    : quality === "reduced" ? 48 : quality === "balanced" ? 72 : 96;
  const particles = useRef<THREE.Points>(null);
  const material = useRef<THREE.PointsMaterial>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      values[index * 3] = (seededRandom(index, 901) - .5) * 17;
      values[index * 3 + 1] = -.12 - seededRandom(index, 902) * 2.25;
      values[index * 3 + 2] = (seededRandom(index, 903) - .5) * 17;
    }
    return values;
  }, [particleCount]);
  const particleSeeds = useMemo(() => {
    const values = new Float32Array(particleCount);
    for (let index = 0; index < particleCount; index += 1) values[index] = seededRandom(index, 904);
    return values;
  }, [particleCount]);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(21, 19, 1, 24, 24, 22);
      gradient.addColorStop(0, "rgba(255,255,255,.92)");
      gradient.addColorStop(.28, "rgba(196,255,242,.54)");
      gradient.addColorStop(1, "rgba(123,220,211,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 48, 48);
    }
    const value = new THREE.CanvasTexture(canvas);
    value.colorSpace = THREE.SRGBColorSpace;
    return value;
  }, []);

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(({ clock }, delta) => {
    const depth = THREE.MathUtils.clamp(motion.current.submersion, 0, 1);
    const positionAttribute = particles.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const activePositions = positionAttribute?.array as Float32Array | undefined;
    if (activePositions && positionAttribute && depth > .003) {
      const currentAngle = THREE.MathUtils.degToRad(settings.currentDirection - settings.coastHeading);
      const currentDrift = THREE.MathUtils.clamp(settings.currentStrength / 1.4, 0, 1.35);
      const currentX = Math.sin(currentAngle) * currentDrift * .13;
      const currentZ = Math.cos(currentAngle) * currentDrift * .13;
      for (let index = 0; index < particleCount; index += 1) {
        const offset = index * 3;
        const seed = particleSeeds[index];
        activePositions[offset] += (currentX + Math.sin(clock.elapsedTime * .42 + seed * 17) * .018) * delta;
        activePositions[offset + 1] += (.012 + seed * .022) * delta;
        activePositions[offset + 2] += (currentZ + Math.cos(clock.elapsedTime * .36 + seed * 19) * .016) * delta;
        if (activePositions[offset] > 8.5) activePositions[offset] = -8.5;
        else if (activePositions[offset] < -8.5) activePositions[offset] = 8.5;
        if (activePositions[offset + 1] > .16) activePositions[offset + 1] = -2.35;
        if (activePositions[offset + 2] > 8.5) activePositions[offset + 2] = -8.5;
        else if (activePositions[offset + 2] < -8.5) activePositions[offset + 2] = 8.5;
      }
      positionAttribute.needsUpdate = true;
    }
    if (material.current) {
      material.current.opacity = THREE.MathUtils.damp(material.current.opacity, depth * .34, depth > material.current.opacity ? 11 : 5, delta);
      material.current.size = THREE.MathUtils.damp(material.current.size, mobile ? .038 : .03, 5, delta);
    }
    if (particles.current) particles.current.visible = depth > .004 || (material.current?.opacity ?? 0) > .004;
  });

  return (
    <points ref={particles} frustumCulled={false} renderOrder={4.8}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={material}
        map={texture}
        color="#baf8ec"
        size={.03}
        sizeAttenuation
        transparent
        opacity={0}
        alphaTest={.02}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

function KinematicContactShadows({
  motion,
  playerPosition,
  playerHeading,
  vanMotion,
  vanPosition,
  vanHeading,
  mobile,
  daylight,
  tide,
}: {
  motion: MutableRefObject<MotionState>;
  playerPosition: MutableRefObject<THREE.Vector3>;
  playerHeading: MutableRefObject<number>;
  vanMotion: MutableRefObject<VehicleMotionState>;
  vanPosition: MutableRefObject<THREE.Vector3>;
  vanHeading: MutableRefObject<number>;
  mobile: boolean;
  daylight: number;
  tide: number;
}) {
  const playerShadow = useRef<THREE.Mesh>(null);
  const playerMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const vanShadow = useRef<THREE.Mesh>(null);
  const vanMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const shadowTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 62);
      gradient.addColorStop(0, "rgba(255,255,255,.92)");
      gradient.addColorStop(.36, "rgba(255,255,255,.56)");
      gradient.addColorStop(.72, "rgba(255,255,255,.15)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 128, 128);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }, []);

  useEffect(() => () => shadowTexture.dispose(), [shadowTexture]);

  useFrame((_, delta) => {
    const state = motion.current;
    const playerOnLand = state.phase === "shore" || state.phase === "wading";
    const depthFade = 1 - THREE.MathUtils.smoothstep(state.waterDepth, .08, .84);
    const playerOpacity = playerOnLand
      ? (mobile ? .27 : .13) * (.72 + daylight * .28) * depthFade
      : 0;
    if (playerShadow.current) {
      const target = playerPosition.current;
      const wetSand = target.z < 29 + shorelineShiftForTide(tide);
      playerShadow.current.position.set(target.x, wetSand ? -.392 : -.482, target.z + .08);
      playerShadow.current.rotation.set(-Math.PI / 2, 0, -playerHeading.current);
      playerShadow.current.scale.x = THREE.MathUtils.damp(playerShadow.current.scale.x, .92 + state.run * .18, 9, delta);
      playerShadow.current.scale.y = THREE.MathUtils.damp(playerShadow.current.scale.y, 1.52 - state.run * .12, 9, delta);
      playerShadow.current.visible = playerOpacity > .003;
    }
    if (playerMaterial.current) playerMaterial.current.opacity = THREE.MathUtils.damp(playerMaterial.current.opacity, playerOpacity, 8, delta);

    const vehicle = vanMotion.current;
    const vanOpacity = (mobile ? .31 : .17) * (.72 + daylight * .28) * (1 - vehicle.wetness * .12);
    if (vanShadow.current) {
      const target = vanPosition.current;
      const groundY = THREE.MathUtils.lerp(-.284, -.458, vehicle.offRoad);
      vanShadow.current.position.set(target.x, groundY, target.z);
      vanShadow.current.rotation.set(-Math.PI / 2, 0, -vanHeading.current);
      vanShadow.current.scale.x = THREE.MathUtils.damp(vanShadow.current.scale.x, 2.45 + vehicle.slip * .18, 7, delta);
      vanShadow.current.scale.y = THREE.MathUtils.damp(vanShadow.current.scale.y, 5.25 + Math.abs(vehicle.longitudinalG) * .14, 7, delta);
    }
    if (vanMaterial.current) vanMaterial.current.opacity = THREE.MathUtils.damp(vanMaterial.current.opacity, vanOpacity, 7, delta);
  });

  return (
    <group>
      <mesh ref={playerShadow} renderOrder={1} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={playerMaterial} color="#071013" alphaMap={shadowTexture} transparent opacity={0} depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      <mesh ref={vanShadow} renderOrder={1} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={vanMaterial} color="#060b0c" alphaMap={shadowTexture} transparent opacity={0} depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
    </group>
  );
}

function CinematicFrameCapture({
  request,
  onCapture,
  focusPosition,
  motion,
  settings,
  character,
}: {
  request: RideCaptureRequest | null;
  onCapture: (capture: RideFrameCapture) => void;
  focusPosition: MutableRefObject<THREE.Vector3>;
  motion: MutableRefObject<MotionState>;
  settings: SessionSettings;
  character: BreakCharacter;
}) {
  const { gl, scene, camera: activeCamera } = useThree();
  const quality = useRenderQuality();
  const handledRequest = useRef(0);
  const captureCallback = useRef(onCapture);
  const captureCamera = useRef(new THREE.PerspectiveCamera(52, 1200 / 630, .08, 650));
  const lookTarget = useRef(new THREE.Vector3());

  useEffect(() => {
    captureCallback.current = onCapture;
  }, [onCapture]);

  useFrame(({ clock }) => {
    if (!request || request.id <= handledRequest.current) return;
    handledRequest.current = request.id;
    const photoCapture = request.purpose === "photo";
    const width = photoCapture
      ? quality === "high" ? 1440 : quality === "balanced" ? 1200 : 960
      : quality === "high" ? 1200 : quality === "balanced" ? 1040 : 840;
    const height = photoCapture ? Math.round(width * 9 / 16) : Math.round(width * 630 / 1200);
    const focus = focusPosition.current;
    if (request.view === "player" && activeCamera instanceof THREE.PerspectiveCamera) {
      captureCamera.current.copy(activeCamera, false);
      activeCamera.getWorldPosition(captureCamera.current.position);
      activeCamera.getWorldQuaternion(captureCamera.current.quaternion);
      captureCamera.current.scale.set(1, 1, 1);
      captureCamera.current.aspect = width / height;
    } else {
      const transport = primaryWaveVelocityAt(focus.x, focus.z, clock.elapsedTime, settings, character);
      const normalX = transport.x / Math.max(.001, transport.speed);
      const normalZ = transport.z / Math.max(.001, transport.speed);
      const tangentX = normalZ;
      const tangentZ = -normalX;
      const lineSide = motion.current.lineSide || (character.peel === 0 ? 1 : Math.sign(character.peel));
      const surfaceY = waveHeightAt(focus.x, focus.z, clock.elapsedTime, settings, character);
      const shoulderOffset = 4.4 + settings.waveHeight * .42;
      const shorewardOffset = 6.2 + settings.waveHeight * .68;
      captureCamera.current.aspect = width / height;
      captureCamera.current.fov = THREE.MathUtils.clamp(54 - settings.waveHeight * 1.2, 47, 53);
      captureCamera.current.position.set(
        focus.x + normalX * shorewardOffset + tangentX * lineSide * shoulderOffset,
        surfaceY + 2.75 + settings.waveHeight * .24,
        focus.z + normalZ * shorewardOffset + tangentZ * lineSide * shoulderOffset,
      );
      lookTarget.current.set(
        focus.x - normalX * .6 + tangentX * lineSide * .7,
        surfaceY + .92 + motion.current.maneuverLift * .18,
        focus.z - normalZ * .6 + tangentZ * lineSide * .7,
      );
      captureCamera.current.lookAt(lookTarget.current);
    }
    captureCamera.current.updateProjectionMatrix();
    captureCamera.current.updateMatrixWorld(true);

    const target = new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const previousTarget = gl.getRenderTarget();
    const surferVisual = scene.getObjectByName("SurferVisualBody");
    const previousSurferVisibility = surferVisual?.visible;
    const pixels = new Uint8Array(width * height * 4);
    try {
      if (surferVisual && request.view === "cinematic") surferVisual.visible = true;
      gl.setRenderTarget(target);
      gl.clear(true, true, true);
      gl.render(scene, captureCamera.current);
      gl.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    } catch {
      target.dispose();
      gl.setRenderTarget(previousTarget);
      if (surferVisual && previousSurferVisibility !== undefined) surferVisual.visible = previousSurferVisibility;
      return;
    }
    gl.setRenderTarget(previousTarget);
    if (surferVisual && previousSurferVisibility !== undefined) surferVisual.visible = previousSurferVisibility;
    target.dispose();

    const flipped = new Uint8ClampedArray(pixels.length);
    const rowLength = width * 4;
    for (let row = 0; row < height; row += 1) {
      const sourceOffset = (height - row - 1) * rowLength;
      flipped.set(pixels.subarray(sourceOffset, sourceOffset + rowLength), row * rowLength);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(flipped, width, height), 0, 0);
    if (photoCapture) {
      const unit = width / 1200;
      const lowerShade = context.createLinearGradient(0, height * .68, 0, height);
      lowerShade.addColorStop(0, "rgba(1,8,12,0)");
      lowerShade.addColorStop(1, "rgba(1,8,12,.72)");
      context.fillStyle = lowerShade;
      context.fillRect(0, height * .64, width, height * .36);
      context.fillStyle = "rgba(207,255,248,.92)";
      context.font = `900 ${Math.round(17 * unit)}px Arial, sans-serif`;
      context.fillText("S U R F S C A P E", 34 * unit, height - 42 * unit);
      context.fillStyle = "rgba(222,248,243,.66)";
      context.font = `700 ${Math.round(10 * unit)}px Arial, sans-serif`;
      context.fillText(request.caption?.toUpperCase() ?? "LIVING OCEAN / PHOTO MODE", 34 * unit, height - 23 * unit);
      context.textAlign = "right";
      context.fillStyle = "rgba(222,248,243,.74)";
      context.font = `800 ${Math.round(11 * unit)}px Arial, sans-serif`;
      const opticalMetadata = request.focalLength
        ? `${request.focalLength} MM  ·  ${(request.exposure ?? 0) >= 0 ? "+" : ""}${(request.exposure ?? 0).toFixed(1)} EV  ·  `
        : "";
      context.fillText(`${opticalMetadata}${settings.waveHeight.toFixed(1)} M  ·  ${settings.wavePeriod.toFixed(0)} S`, width - 34 * unit, height - 27 * unit);
      context.textAlign = "left";
    }
    canvas.toBlob((blob) => {
      if (blob) captureCallback.current({ ...request, blob });
    }, "image/jpeg", photoCapture ? .95 : .92);
  });

  return null;
}

function Simulation({
  beach,
  zoneName,
  latitude,
  longitude,
  settings,
  cloudCover,
  weatherCode,
  observedAt,
  utcOffsetSeconds,
  sunrise,
  sunset,
  cameraMode,
  controls,
  active,
  photoMode,
  photoFocalLength,
  photoExposure,
  replayMode,
  replayRequest,
  replayControl,
  captureRequest,
  onCapture,
  onReplayReady,
  onReplayState,
  onStats,
  onReady,
}: SurfSceneProps) {
  const { camera } = useThree();
  const backgroundRef = useRef<THREE.Color>(null);
  const fogRef = useRef<THREE.Fog>(null);
  const boardSpec = BOARD_SPECS[settings.board];
  const character = useMemo(() => getBreakCharacter(beach.id, zoneName), [beach.id, zoneName]);
  const tideResponse = useMemo(
    () => tideResponseForBreak(settings.tide, character),
    [character, settings.tide],
  );
  const tidePower = character.power * tideResponse.powerScale;
  const tideSteepness = character.steepness * tideResponse.steepnessScale;
  const tideHollow = character.hollow * tideResponse.hollowScale;
  const tideVariability = character.variability * tideResponse.variabilityScale;
  const thermalKit = useMemo(
    () => thermalKitForConditions(settings.waterTemperature, settings.airTemperature, settings.windSpeed),
    [settings.airTemperature, settings.waterTemperature, settings.windSpeed],
  );
  const mobileRenderer = useMemo(() => isMobileRenderer(), []);
  const renderQuality = useRenderQuality();
  const reducedMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const birdCount = mobileRenderer
    ? renderQuality === "reduced" ? 1 : renderQuality === "high" ? 3 : 2
    : renderQuality === "reduced" ? 2 : 3;
  const player = useRef<THREE.Group>(null);
  const waveStage = useRef<THREE.Group>(null);
  const van = useRef<THREE.Group>(null);
  const position = useRef(new THREE.Vector3(0, 0, 35));
  const vanPosition = useRef(new THREE.Vector3(0, 0, 78));
  const worldFocus = useRef(new THREE.Vector3(0, 0, 35));
  const waterRide = useRef({ elevation: 0, velocity: 0, engaged: false });
  const vanHeading = useRef(-Math.PI / 2);
  const vanSpeed = useRef(0);
  const vanSteer = useRef(0);
  const vanThrottle = useRef(0);
  const vanYawVelocity = useRef(0);
  const vanPreviousSpeed = useRef(0);
  const vanLongitudinalG = useRef(0);
  const vanLateralG = useRef(0);
  const vanTraction = useRef(1);
  const vanSlip = useRef(0);
  const landVelocity = useRef(new THREE.Vector2());
  const playerHeading = useRef(0);
  const paddleHeading = useRef(0);
  const paddleVelocity = useRef(new THREE.Vector2());
  const rideVelocity = useRef(new THREE.Vector2());
  const rideAcceleration = useRef(new THREE.Vector2());
  const cameraForward = useRef(new THREE.Vector3(0, 0, -1));
  const cameraRight = useRef(new THREE.Vector3(1, 0, 0));
  const phase = useRef<GamePhase>("shore");
  const score = useRef(0);
  const combo = useRef(1);
  const rideDistance = useRef(0);
  const stance = useRef(0);
  const barrelTime = useRef(0);
  const rideStartScore = useRef(0);
  const rideOriginAlong = useRef(0);
  const rideWavePhase = useRef(0);
  const rideFacePosition = useRef(0);
  const ridePocketOffset = useRef(0);
  const waveCrestOffset = useRef(0);
  const rideLineSide = useRef(character.peel === 0 ? 1 : Math.sign(character.peel));
  const rideHeading = useRef(0);
  const pocketDistance = useRef(0);
  const rideScore = useRef(0);
  const rideManeuverStart = useRef(0);
  const rideGrade = useRef<GameStats["rideGrade"]>("C");
  const rideResult = useRef<"" | "clean" | "wipeout">("");
  const rideResultId = useRef(0);
  const rideTakeoffQuality = useRef(0);
  const rideAnalysisDuration = useRef(0);
  const rideLineIntegral = useRef(0);
  const rideControlIntegral = useRef(0);
  const ridePowerIntegral = useRef(0);
  const rideMaxSpeed = useRef(0);
  const rideMaxCombo = useRef(1);
  const stamina = useRef(100);
  const maxCombo = useRef(1);
  const maneuver = useRef("");
  const maneuverScore = useRef(0);
  const maneuverQuality = useRef(0);
  const maneuverId = useRef(0);
  const maneuverCount = useRef(0);
  const activeManeuver = useRef<ManeuverAttempt | null>(null);
  const trickCharge = useRef(0);
  const lastManeuverAt = useRef(-10);
  const catchQuality = useRef(0.5);
  const unstableFor = useRef(0);
  const railSlip = useRef(0);
  const missedWaveUntil = useRef(0);
  const nextShorebreakAt = useRef(0);
  const duckDiveUntil = useRef(0);
  const duckDiveQuality = useRef(0);
  const shorebreakId = useRef(0);
  const shorebreakResult = useRef<GameStats["shorebreakResult"]>("");
  const wipeoutAt = useRef(0);
  const wipeoutDuration = useRef(2.25);
  const wipeoutPower = useRef(0);
  const wipeoutVelocity = useRef(new THREE.Vector2());
  const breath = useRef(100);
  const finishAt = useRef(-1);
  const actionLatch = useRef(false);
  const takeoffCommitAt = useRef(-1);
  const takeoffCommitDuration = useRef(.78);
  const takeoffCommitQuality = useRef(.5);
  const lastStatsAt = useRef(0);
  const cleanFinish = useRef(false);
  const motion = useRef<MotionState>({
    phase: "shore",
    balance: 0,
    steer: 0,
    speed: 0,
    acceleration: 0,
    lateralForce: 0,
    run: 0,
    waterDepth: 0,
    wetness: 0,
    exertion: 0,
    paddleEffort: 0,
    waveQuality: 0,
    facePosition: 0,
    linePosition: 0,
    lineControl: 1,
    lineSide: character.peel === 0 ? 1 : Math.sign(character.peel),
    sectionPressure: 0,
    setEnergy: 0,
    wipeout: 0,
    wipeoutProgress: 0,
    wipeoutPower: 0,
    breath: 100,
    maneuver: 0,
    maneuverSide: 0,
    maneuverLift: 0,
    maneuverSpin: 0,
    trickCharge: 0,
    maneuverProgress: 0,
    landingCue: 0,
    landingTarget: 0,
    landingWindow: 0,
    stance: 0,
    barrel: 0,
    rail: 0,
    compression: 0,
    slip: 0,
    impact: 0,
    takeoff: 0,
    finish: 0,
    takeoffRead: 0,
    catchReady: 0,
    takeoffCommit: 0,
    shorebreak: 0,
    shorebreakPower: 0,
    shorebreakSeconds: 0,
    duckDive: 0,
    submersion: 0,
    leashTension: 0,
    paddleHeading: 0,
  });
  const replayFrames = useRef<ReplayFrame[]>([]);
  const replayRecording = useRef(false);
  const lastReplaySampleAt = useRef(-1);
  const replayReadyCallback = useRef(onReplayReady);
  const replayStateCallback = useRef(onReplayState);
  const replayPlayback = useRef<ReplayPlayback>({
    active: false,
    handledRequest: 0,
    handledSeekRequest: 0,
    duration: 0,
    progress: 0,
    timeCycleOffset: 0,
    cursor: 0,
    lastReportAt: -1,
    cameraCut: -1,
    moments: [],
    restore: null,
  });
  const setLeashTension = useCallback((tension: number) => {
    motion.current.leashTension = tension;
  }, []);
  const vanMotion = useRef<VehicleMotionState>({
    speed: 0,
    steer: 0,
    throttle: 0,
    driving: false,
    brake: false,
    wetness: 0,
    offRoad: 0,
    traction: 1,
    slip: 0,
    longitudinalG: 0,
    lateralG: 0,
    suspension: 0,
  });
  const cameraTarget = useRef(new THREE.Vector3());
  const cameraLookTarget = useRef(new THREE.Vector3(0, 1, 32));
  const cameraPosition = useRef(new THREE.Vector3(0, 4.8, 44));
  const cameraOffset = useRef(new THREE.Vector3());
  const cameraOrbit = useRef(new THREE.Spherical());
  const cameraSubjectPrevious = useRef(new THREE.Vector3());
  const cameraSubjectVelocity = useRef(new THREE.Vector3());
  const cameraSubjectVelocityPrevious = useRef(new THREE.Vector3());
  const cameraRawVelocity = useRef(new THREE.Vector3());
  const cameraRawAcceleration = useRef(new THREE.Vector3());
  const cameraAcceleration = useRef(new THREE.Vector3());
  const cameraSpringOffset = useRef(new THREE.Vector3());
  const cameraSpringVelocity = useRef(new THREE.Vector3());
  const cameraBank = useRef(0);
  const cameraMotionInitialized = useRef(false);
  const cameraTrackingDriving = useRef(false);
  const previousCameraImpact = useRef(0);
  const sunLight = useRef<THREE.DirectionalLight>(null);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const timeToHour = (value: string, fallback: number) => {
    if (!value) return fallback;
    const time = value.includes("T") ? value.split("T")[1] : value;
    const [hours, minutes] = time.split(":").map(Number);
    return Number.isFinite(hours) ? hours + (minutes || 0) / 60 : fallback;
  };
  const sunriseHour = timeToHour(sunrise, 6);
  const sunsetHour = timeToHour(sunset, 18);
  const fallbackHourAngle = ((settings.timeOfDay - sunriseHour) / Math.max(8, sunsetHour - sunriseHour)) * Math.PI;
  const solarPosition = solarPositionAt({
    latitude,
    longitude,
    localDateTime: observedAt,
    localHour: settings.timeOfDay,
    utcOffsetSeconds,
  });
  const solarElevation = solarPosition?.sinElevation ?? Math.sin(fallbackHourAngle);
  const solarAzimuth = solarPosition?.azimuth
    ?? settings.coastHeading + THREE.MathUtils.radToDeg(fallbackHourAngle - Math.PI / 2);
  const relativeSunAzimuth = THREE.MathUtils.degToRad(solarAzimuth - settings.coastHeading);
  const solarHorizontal = Math.sqrt(Math.max(0, 1 - solarElevation * solarElevation));
  const sunDirectionX = Math.sin(relativeSunAzimuth) * solarHorizontal;
  const sunDirectionY = solarElevation;
  const sunDirectionZ = Math.cos(relativeSunAzimuth) * solarHorizontal;
  const sunHeight = Math.max(-0.08, solarElevation);
  const lightingSunPosition: [number, number, number] = [
    sunDirectionX * 44,
    Math.max(1.8, sunHeight * 44),
    sunDirectionZ * 44,
  ];

  useEffect(() => {
    onReady();
  }, [onReady]);

  useEffect(() => {
    replayReadyCallback.current = onReplayReady;
    replayStateCallback.current = onReplayState;
  }, [onReplayReady, onReplayState]);

  useFrame(({ clock, gl }, delta) => {
    if (!player.current || !van.current) return;
    gl.toneMappingExposure = photoMode ? 1.08 * Math.pow(2, photoExposure) : 1.08;
    const t = clock.elapsedTime;
    const playback = replayPlayback.current;
    const restoreReplay = () => {
      const restore = playback.restore;
      if (restore) {
        const frozenDuration = Math.max(0, t - restore.frozenAt);
        position.current.copy(restore.position);
        landVelocity.current.copy(restore.landVelocity);
        paddleVelocity.current.copy(restore.paddleVelocity);
        rideVelocity.current.copy(restore.rideVelocity);
        rideAcceleration.current.copy(restore.rideAcceleration);
        wipeoutVelocity.current.copy(restore.wipeoutVelocity);
        phase.current = restore.phase;
        playerHeading.current = restore.playerHeading;
        paddleHeading.current = restore.paddleHeading;
        rideHeading.current = restore.rideHeading;
        rideLineSide.current = restore.lineSide;
        waveCrestOffset.current = restore.crestOffset;
        rideFacePosition.current = restore.facePosition;
        stance.current = restore.stance;
        stamina.current = restore.stamina;
        breath.current = restore.breath;
        wipeoutPower.current = restore.wipeoutPower;
        wipeoutDuration.current = restore.wipeoutDuration;
        railSlip.current = restore.railSlip;
        unstableFor.current = restore.unstableFor;
        wipeoutAt.current = restore.phase === "wipeout" ? restore.wipeoutAt + frozenDuration : restore.wipeoutAt;
        nextShorebreakAt.current = restore.nextShorebreakAt > 0 ? restore.nextShorebreakAt + frozenDuration : restore.nextShorebreakAt;
        duckDiveUntil.current = restore.duckDiveUntil > restore.frozenAt ? restore.duckDiveUntil + frozenDuration : restore.duckDiveUntil;
        missedWaveUntil.current = restore.missedWaveUntil > restore.frozenAt ? restore.missedWaveUntil + frozenDuration : restore.missedWaveUntil;
        finishAt.current = restore.finishAt >= 0 ? restore.finishAt + frozenDuration : restore.finishAt;
        takeoffCommitAt.current = restore.takeoffCommitAt >= 0 ? restore.takeoffCommitAt + frozenDuration : restore.takeoffCommitAt;
        motion.current = { ...restore.motion };
        waterRide.current.elevation = restore.waterElevation;
        waterRide.current.velocity = restore.waterVelocity;
        waterRide.current.engaged = restore.waterEngaged;
      }
      const completedDuration = playback.duration;
      playback.active = false;
      playback.cursor = 0;
      playback.progress = 0;
      playback.cameraCut = -1;
      playback.moments = [];
      playback.restore = null;
      replayStateCallback.current({
        active: false,
        progress: 1,
        duration: completedDuration,
        cameraMode: "cinematic",
        telemetry: replayTelemetryFromMotion(motion.current),
        moments: [],
      });
    };
    if (playback.active && !replayMode) restoreReplay();
    if (replayMode && replayRequest > playback.handledRequest) {
      playback.handledRequest = replayRequest;
      const frames = replayFrames.current;
      const trackDuration = frames.length > 1 ? frames[frames.length - 1].at - frames[0].at : 0;
      if (frames.length < 12 || trackDuration < .6) {
        replayStateCallback.current({
          active: false,
          progress: 0,
          duration: 0,
          cameraMode: "cinematic",
          telemetry: replayTelemetryFromMotion(motion.current),
          moments: [],
        });
      } else {
        const duration = THREE.MathUtils.clamp(trackDuration / .82, 4.8, 13);
        const moments = replayMomentsForFrames(frames);
        playback.active = true;
        playback.duration = duration;
        playback.progress = 0;
        playback.moments = moments;
        playback.timeCycleOffset = Math.round((t - frames[0].at) / Math.max(4, settings.wavePeriod)) * Math.max(4, settings.wavePeriod);
        playback.cursor = 0;
        playback.handledSeekRequest = replayControl.seekRequest;
        playback.lastReportAt = -1;
        playback.cameraCut = 0;
        playback.restore = {
          frozenAt: t,
          position: position.current.clone(),
          landVelocity: landVelocity.current.clone(),
          paddleVelocity: paddleVelocity.current.clone(),
          rideVelocity: rideVelocity.current.clone(),
          rideAcceleration: rideAcceleration.current.clone(),
          wipeoutVelocity: wipeoutVelocity.current.clone(),
          phase: phase.current,
          playerHeading: playerHeading.current,
          paddleHeading: paddleHeading.current,
          rideHeading: rideHeading.current,
          lineSide: rideLineSide.current,
          crestOffset: waveCrestOffset.current,
          facePosition: rideFacePosition.current,
          stance: stance.current,
          stamina: stamina.current,
          breath: breath.current,
          wipeoutPower: wipeoutPower.current,
          wipeoutDuration: wipeoutDuration.current,
          railSlip: railSlip.current,
          unstableFor: unstableFor.current,
          wipeoutAt: wipeoutAt.current,
          nextShorebreakAt: nextShorebreakAt.current,
          duckDiveUntil: duckDiveUntil.current,
          missedWaveUntil: missedWaveUntil.current,
          finishAt: finishAt.current,
          takeoffCommitAt: takeoffCommitAt.current,
          motion: { ...motion.current },
          waterElevation: waterRide.current.elevation,
          waterVelocity: waterRide.current.velocity,
          waterEngaged: waterRide.current.engaged,
        };
        replayStateCallback.current({
          active: true,
          progress: 0,
          duration,
          cameraMode: "cinematic",
          telemetry: replayTelemetryFromMotion(frames[0].motion),
          moments,
        });
      }
    }
    const sessionIntroProgress = reducedMotion
      ? THREE.MathUtils.smootherstep(t, .04, .58)
      : THREE.MathUtils.smootherstep(t, .12, 3.25);
    const state = controls.current;
    const currentPhase = phase.current;
    worldFocus.current.copy(currentPhase === "driving" ? vanPosition.current : position.current);
    if (sunLight.current) {
      sunLight.current.position.set(
        worldFocus.current.x + lightingSunPosition[0],
        lightingSunPosition[1],
        worldFocus.current.z + lightingSunPosition[2],
      );
      sunTarget.position.set(worldFocus.current.x, 0, worldFocus.current.z);
      sunTarget.updateMatrixWorld();
    }
    const tideShift = shorelineShiftForTide(settings.tide);
    let steer = THREE.MathUtils.clamp((state.right ? 1 : 0) - (state.left ? 1 : 0) + state.moveX + state.gamepadMoveX, -1, 1);
    const move = THREE.MathUtils.clamp((state.forward ? 1 : 0) - (state.back ? 1 : 0) + state.moveY + state.gamepadMoveY, -1, 1);
    let balanceInput = state.gamepadActive ? state.gamepadBalance : state.balance;
    const inputLength = Math.min(1, Math.hypot(steer, move));
    camera.getWorldDirection(cameraForward.current);
    cameraForward.current.y = 0;
    if (cameraForward.current.lengthSq() < .001) cameraForward.current.set(0, 0, -1);
    else cameraForward.current.normalize();
    cameraRight.current.copy(cameraForward.current).cross(camera.up).normalize();
    let movementX = 0;
    let movementZ = 0;
    if (inputLength > .001) {
      const inputScale = inputLength / Math.hypot(steer, move);
      movementX = (cameraRight.current.x * steer + cameraForward.current.x * move) * inputScale;
      movementZ = (cameraRight.current.z * steer + cameraForward.current.z * move) * inputScale;
    }
    const analogMagnitude = Math.min(1, Math.max(Math.hypot(state.moveX, state.moveY), Math.hypot(state.gamepadMoveX, state.gamepadMoveY)));
    const wantsRun = state.sprint || state.gamepadSprint || (analogMagnitude > .82 && inputLength > .72);
    const modeDifficulty = settings.mode === "advanced" ? 1.12 : settings.mode === "training" ? 0.62 : 0.86;
    const relativeWindAngle = ((settings.windDirection - settings.coastHeading) * Math.PI) / 180;
    const windExposure = THREE.MathUtils.clamp(settings.windSpeed / 32, 0, 1.4);
    const onshoreChop = Math.max(0, Math.cos(relativeWindAngle)) * windExposure;
    const offshoreGroom = Math.max(0, -Math.cos(relativeWindAngle)) * Math.min(1, windExposure);
    const setState = waveSetStateAt(
      position.current.x,
      position.current.z,
      t,
      settings,
      character,
    );
    let speed = 0;
    let rideDrive = 0;
    let rideLateralForce = 0;
    let balanceTarget = 0;
    let prompt = "Read the water";
    let waveQuality = 0;
    let linePosition = 0;
    let lineControl = 1;
    let sectionPressure = 0;
    let barrelIntensity = 0;
    let railLoad = 0;
    let compression = 0;
    let catchReady = false;
    let inLineup = false;
    let shorebreakIntensity = 0;
    let shorebreakPower = 0;
    let shorebreakSeconds = 0;
    let duckDiveReady = false;
    let duckDiveActive = false;
    let takeoffAlignment = 0;
    let takeoffQuality = 0;
    let maneuverProgress = 0;
    let maneuverPhase: GameStats["maneuverPhase"] = "line";
    let maneuverAirborne = false;
    let landingTarget = 0;
    let landingWindow = 0;
    let runBlend = 0;
    let paddleEffort = 0;
    let rideOutProgress = 0;
    let takeoffCommitProgress = 0;
    if (currentPhase !== "wipeout") {
      breath.current = Math.min(100, breath.current + delta * 28);
      wipeoutPower.current = THREE.MathUtils.damp(wipeoutPower.current, 0, 3.2, delta);
    }
    const distanceToVan = Math.hypot(position.current.x - vanPosition.current.x, position.current.z - vanPosition.current.z);
    const nearVan = currentPhase === "shore" && distanceToVan < 6.2;

    const actionDown = state.action || state.gamepadAction;
    const actionPressed = actionDown && !actionLatch.current;
    const actionReleased = !actionDown && actionLatch.current;
    actionLatch.current = actionDown;

    if (!active) {
      landVelocity.current.x = THREE.MathUtils.damp(landVelocity.current.x, 0, 12, delta);
      landVelocity.current.y = THREE.MathUtils.damp(landVelocity.current.y, 0, 12, delta);
    }

    if (active) {
      if (currentPhase === "shore") {
        stance.current = THREE.MathUtils.damp(stance.current, 0, 4, delta);
        stamina.current = Math.min(100, stamina.current + delta * 12);
        const coastalZ = position.current.z - tideShift;
        const drySand = THREE.MathUtils.smoothstep(coastalZ, 22, 46) * (1 - THREE.MathUtils.smoothstep(coastalZ, 65, 74));
        const surfacePace = 1 - drySand * .12;
        const targetSpeed = (wantsRun ? 6.45 : 3.75) * surfacePace;
        const acceleration = inputLength > .001 ? (wantsRun ? 6.4 : 8.8) : 11.5;
        landVelocity.current.x = THREE.MathUtils.damp(landVelocity.current.x, movementX * targetSpeed, acceleration, delta);
        landVelocity.current.y = THREE.MathUtils.damp(landVelocity.current.y, movementZ * targetSpeed, acceleration, delta);
        position.current.x += landVelocity.current.x * delta;
        position.current.z += landVelocity.current.y * delta;
        position.current.z = THREE.MathUtils.clamp(position.current.z, 7.6 + tideShift, 88);
        speed = landVelocity.current.length();
        runBlend = wantsRun ? THREE.MathUtils.smoothstep(speed, 3.6, 6) : 0;
        if (speed > .16) playerHeading.current = dampAngle(playerHeading.current, Math.atan2(landVelocity.current.x, landVelocity.current.y), wantsRun ? 10 : 13, delta);
        prompt = nearVan
          ? "DRIVE / SPACE to enter the Surfscape van"
          : position.current.z > 54
            ? "The van is parked beside the coast road"
            : cleanFinish.current
              ? "Clean finish — head back out"
              : "Walk toward the water · or head up-road to the van";
        if (actionPressed && nearVan) {
          phase.current = "driving";
          vanSpeed.current = 0;
          vanPreviousSpeed.current = 0;
          vanThrottle.current = 0;
          vanSteer.current = 0;
          vanYawVelocity.current = 0;
          landVelocity.current.set(0, 0);
        }
        if (position.current.z < 8 + tideShift) phase.current = "wading";
      } else if (currentPhase === "driving") {
        stance.current = THREE.MathUtils.damp(stance.current, 0, 4, delta);
        stamina.current = Math.min(100, stamina.current + delta * 15);
        const roadOffset = Math.abs(vanPosition.current.z - 78);
        const offRoad = THREE.MathUtils.smoothstep(roadOffset, 3.9, 6.1);
        const wetness = weatherWetness(weatherCode);
        const baseTraction = THREE.MathUtils.clamp(1 - offRoad * .31 - wetness * .09, .56, 1);
        const inputThrottle = move;
        vanThrottle.current = THREE.MathUtils.damp(vanThrottle.current, inputThrottle, 7.8, delta);
        vanSteer.current = THREE.MathUtils.damp(vanSteer.current, steer, 7.2, delta);

        const changingDirection = (vanSpeed.current > .35 && inputThrottle < -.04)
          || (vanSpeed.current < -.35 && inputThrottle > .04);
        const effectiveThrottle = changingDirection ? inputThrottle : vanThrottle.current;
        const acceleration = changingDirection ? 18.5 : effectiveThrottle < 0 ? 7.2 : 10.8;
        if (Math.abs(inputThrottle) > 0.01) {
          vanSpeed.current += effectiveThrottle * acceleration * (.69 + baseTraction * .31) * delta;
        } else {
          vanSpeed.current = THREE.MathUtils.damp(vanSpeed.current, 0, 1.08 + offRoad * 2.45, delta);
        }
        const aerodynamicDrag = Math.sign(vanSpeed.current) * vanSpeed.current * vanSpeed.current * .0036 * delta;
        vanSpeed.current -= aerodynamicDrag;
        vanSpeed.current = THREE.MathUtils.clamp(vanSpeed.current, -6.5, 18.5);

        const speedMagnitude = Math.abs(vanSpeed.current);
        const steeringLoad = speedMagnitude * Math.abs(vanSteer.current);
        const wetSlip = wetness * THREE.MathUtils.smoothstep(steeringLoad, 4.6, 13.5) * .24;
        const surfaceSlip = offRoad * THREE.MathUtils.smoothstep(steeringLoad, 3.1, 10.5) * .48;
        const targetSlip = THREE.MathUtils.clamp(wetSlip + surfaceSlip, 0, .72);
        vanSlip.current = THREE.MathUtils.damp(vanSlip.current, targetSlip, targetSlip > vanSlip.current ? 4.4 : 7.5, delta);
        vanTraction.current = THREE.MathUtils.damp(
          vanTraction.current,
          THREE.MathUtils.clamp(baseTraction - vanSlip.current * .2, .48, 1),
          5.4,
          delta,
        );

        const steeringAuthority = THREE.MathUtils.clamp(speedMagnitude / 3.2, 0.1, 1);
        const targetYawVelocity = -vanSteer.current
          * Math.sign(vanSpeed.current || 1)
          * steeringAuthority
          * (.49 + vanTraction.current * .29)
          * (1 + vanSlip.current * .22);
        vanYawVelocity.current = THREE.MathUtils.damp(
          vanYawVelocity.current,
          targetYawVelocity,
          vanTraction.current < .72 ? 3.4 : 5.8,
          delta,
        );
        vanHeading.current += vanYawVelocity.current * delta;
        const forwardX = -Math.sin(vanHeading.current);
        const forwardZ = -Math.cos(vanHeading.current);
        const rightX = Math.cos(vanHeading.current);
        const rightZ = -Math.sin(vanHeading.current);
        const lateralDrift = vanYawVelocity.current * vanSpeed.current * vanSlip.current * .2;
        vanPosition.current.x += (forwardX * vanSpeed.current + rightX * lateralDrift) * delta;
        vanPosition.current.z += (forwardZ * vanSpeed.current + rightZ * lateralDrift) * delta;

        const nextRoadEdge = Math.abs(vanPosition.current.z - 78);
        if (nextRoadEdge > 5.25) {
          vanSpeed.current = THREE.MathUtils.damp(vanSpeed.current, 0, 4.7, delta);
          vanPosition.current.z = THREE.MathUtils.clamp(vanPosition.current.z, 71.8, 84.2);
        }
        if (Math.abs(vanPosition.current.x) > COAST_PLAYABLE_HALF_WIDTH) {
          vanPosition.current.x = THREE.MathUtils.clamp(vanPosition.current.x, -COAST_PLAYABLE_HALF_WIDTH, COAST_PLAYABLE_HALF_WIDTH);
          vanSpeed.current = THREE.MathUtils.damp(vanSpeed.current, 0, 8, delta);
          prompt = "End of this modeled coastline — turn around for another run";
        } else if (nextRoadEdge > 4.3) {
          prompt = vanSlip.current > .25 ? "Loose shoulder — ease the wheel and find grip" : "Ease back onto the coast road";
        } else if (vanSlip.current > .22) {
          prompt = "Tires loading — unwind the steering to settle the van";
        } else if (Math.abs(vanSpeed.current) < 0.8) {
          prompt = mobileRenderer ? "Use the stick to drive · DRIVE to exit" : "W to drive · A/D to steer · SPACE to exit";
        } else {
          prompt = "Cruise the shoreline · stop before exiting";
        }
        const longitudinalAcceleration = (vanSpeed.current - vanPreviousSpeed.current) / Math.max(.001, delta) / 9.81;
        vanLongitudinalG.current = THREE.MathUtils.damp(
          vanLongitudinalG.current,
          THREE.MathUtils.clamp(longitudinalAcceleration, -.85, .6),
          6.6,
          delta,
        );
        vanLateralG.current = THREE.MathUtils.damp(
          vanLateralG.current,
          THREE.MathUtils.clamp(vanSpeed.current * vanYawVelocity.current / 9.81, -.75, .75),
          5.8,
          delta,
        );
        vanPreviousSpeed.current = vanSpeed.current;
        speed = Math.abs(vanSpeed.current);
        score.current += Math.abs(vanSpeed.current) * delta * 0.35;
        if (actionPressed) {
          if (Math.abs(vanSpeed.current) < 0.9) {
            phase.current = "shore";
            vanSpeed.current = 0;
            position.current.set(
              vanPosition.current.x - Math.cos(vanHeading.current) * 3.2,
              0,
              vanPosition.current.z + Math.sin(vanHeading.current) * 3.2,
            );
            landVelocity.current.set(0, 0);
            playerHeading.current = Math.atan2(-Math.sin(vanHeading.current), -Math.cos(vanHeading.current));
          } else {
            prompt = "Slow to a stop before you step out";
          }
        }
      } else if (currentPhase === "wading") {
        stance.current = THREE.MathUtils.damp(stance.current, 0, 3, delta);
        stamina.current = Math.min(100, stamina.current + delta * 7);
        const targetSpeed = 2.35;
        landVelocity.current.x = THREE.MathUtils.damp(landVelocity.current.x, movementX * targetSpeed, inputLength > .001 ? 5.8 : 8.5, delta);
        landVelocity.current.y = THREE.MathUtils.damp(landVelocity.current.y, movementZ * targetSpeed, inputLength > .001 ? 5.8 : 8.5, delta);
        position.current.x += landVelocity.current.x * delta;
        position.current.z += landVelocity.current.y * delta;
        speed = landVelocity.current.length();
        if (speed > .12) playerHeading.current = dampAngle(playerHeading.current, Math.atan2(landVelocity.current.x, landVelocity.current.y), 9, delta);
        prompt = "Keep moving — your board will float soon";
        if (position.current.z > 10 + tideShift) phase.current = "shore";
        if (position.current.z < 1 + tideShift) {
          phase.current = "paddling";
          paddleHeading.current = playerHeading.current;
          paddleVelocity.current.copy(landVelocity.current).multiplyScalar(.55);
          nextShorebreakAt.current = t + (settings.mode === "training" ? 3.2 : 2.55);
          shorebreakResult.current = "";
          landVelocity.current.set(0, 0);
        }
      } else if (currentPhase === "paddling") {
        landVelocity.current.set(0, 0);
        if (move > 0.08) stamina.current = Math.max(0, stamina.current - delta * 7.5 * move);
        else stamina.current = Math.min(100, stamina.current + delta * 10);
        paddleEffort = Math.max(0, move);
        const paddleEfficiency = 0.58 + stamina.current * 0.0042;
        const paddleThrust = Math.max(0, move) * 4.2 * paddleEfficiency * boardSpec.paddle + Math.min(0, move) * 1.2;
        const turnAuthority = (.82 + Math.min(4.6, paddleVelocity.current.length()) * .09) * (.82 + Math.abs(move) * .38) * boardSpec.turn;
        const nextPaddleHeading = paddleHeading.current - steer * turnAuthority * delta;
        paddleHeading.current = Math.atan2(Math.sin(nextPaddleHeading), Math.cos(nextPaddleHeading));
        const paddleForwardX = Math.sin(paddleHeading.current);
        const paddleForwardZ = Math.cos(paddleHeading.current);
        const relativeCurrentAngle = ((settings.currentDirection - settings.coastHeading) * Math.PI) / 180;
        const currentSpeed = settings.currentStrength / 3.6;
        const currentX = Math.sin(relativeCurrentAngle) * currentSpeed;
        const currentZ = -Math.cos(relativeCurrentAngle) * currentSpeed;
        const relativeWaveAngle = ((settings.waveDirection - settings.coastHeading) * Math.PI) / 180;
        const waveTravelX = Math.sin(relativeWaveAngle);
        const waveTravelZ = Math.max(.35, Math.cos(relativeWaveAngle));
        const targetPaddleX = paddleForwardX * paddleThrust + currentX;
        const targetPaddleZ = paddleForwardZ * paddleThrust + currentZ;
        const paddleResponse = Math.abs(move) > .04 ? 3.7 : 1.7;
        paddleVelocity.current.x = THREE.MathUtils.damp(paddleVelocity.current.x, targetPaddleX, paddleResponse, delta);
        paddleVelocity.current.y = THREE.MathUtils.damp(paddleVelocity.current.y, targetPaddleZ, paddleResponse, delta);
        position.current.x += paddleVelocity.current.x * delta;
        position.current.z += paddleVelocity.current.y * delta;
        position.current.z = Math.max(OUTER_PADDLE_LIMIT_Z + tideShift, position.current.z);
        speed = paddleVelocity.current.length();
        const coastalZ = position.current.z - tideShift;
        inLineup = coastalZ < LINEUP_ENTRY_Z;
        if (nextShorebreakAt.current <= 0) nextShorebreakAt.current = t + 2.55;
        const breakCoastalZ = coastalZ - tideResponse.breakShift;
        const breakZone = THREE.MathUtils.smoothstep(breakCoastalZ, -18, -8) * (1 - THREE.MathUtils.smoothstep(breakCoastalZ, -3, 1));
        shorebreakPower = !inLineup
          ? THREE.MathUtils.clamp(
              breakZone
                * (.34 + setState.energy * .66)
                * (.52 + settings.waveHeight * tideResponse.faceScale * .22)
                * (.86 + tidePower * .14)
                * tideResponse.shorebreakScale,
              0,
              1,
            )
          : 0;
        shorebreakSeconds = !inLineup ? Math.max(0, nextShorebreakAt.current - t) : 0;
        const shorebreakApproach = 1 - THREE.MathUtils.smoothstep(shorebreakSeconds, .06, 2.45);
        shorebreakIntensity = shorebreakPower * shorebreakApproach;
        duckDiveActive = t < duckDiveUntil.current;
        duckDiveReady = !inLineup && shorebreakPower > .18 && shorebreakSeconds > .035 && shorebreakSeconds < 1.08;
        if (actionPressed && duckDiveReady) {
          const diveTimingWindow = settings.mode === "training" ? 1 : settings.mode === "advanced" ? .64 : mobileRenderer ? .88 : .78;
          duckDiveQuality.current = THREE.MathUtils.clamp(1 - Math.abs(shorebreakSeconds - .3) / diveTimingWindow, 0, 1);
          duckDiveUntil.current = t + 1.12;
          duckDiveActive = true;
          stamina.current = Math.max(0, stamina.current - (2.4 + shorebreakPower * 1.8));
        }
        if (!inLineup && t >= nextShorebreakAt.current) {
          if (!duckDiveActive) duckDiveQuality.current = 0;
          const diveThreshold = settings.mode === "training" ? .24 : settings.mode === "advanced" ? .46 : .34;
          const cleanDive = duckDiveActive && duckDiveQuality.current >= diveThreshold;
          shorebreakResult.current = cleanDive ? "clean" : "hit";
          shorebreakId.current += 1;
          if (cleanDive) {
            paddleVelocity.current.multiplyScalar(.86 + duckDiveQuality.current * .08);
            position.current.x += waveTravelX * (.08 + shorebreakPower * .14);
            position.current.z += waveTravelZ * (.08 + shorebreakPower * .14);
            stamina.current = Math.max(0, stamina.current - (1.2 + shorebreakPower * 1.6));
            motion.current.impact = .22 + shorebreakPower * .24;
          } else {
            const wash = .72 + shorebreakPower * 1.38;
            position.current.x += waveTravelX * wash;
            position.current.z += waveTravelZ * wash;
            paddleVelocity.current.y += waveTravelZ * (.82 + shorebreakPower * 1.32);
            paddleVelocity.current.x += waveTravelX * (.82 + shorebreakPower * 1.32) + currentX * (.55 + shorebreakPower * .9);
            paddleVelocity.current.multiplyScalar(.54);
            stamina.current = Math.max(0, stamina.current - (5.5 + shorebreakPower * 9.5));
            motion.current.impact = .66 + shorebreakPower * .34;
          }
          const breakInterval = Math.max(4.4, settings.wavePeriod * .58);
          const variation = Math.sin(shorebreakId.current * 2.31 + position.current.x * .04) * tideVariability * .09;
          nextShorebreakAt.current = t + breakInterval * (.88 + setState.energy * .16 + variation);
        }
        takeoffAlignment = THREE.MathUtils.smoothstep(paddleForwardZ, .08, .94);
        const takeoffPhase = primaryWavePhaseAt(position.current.x, position.current.z, t, settings, character);
        const crestAlignment = THREE.MathUtils.smoothstep(Math.sin(takeoffPhase), -.08, .96);
        const takeoffCommitting = takeoffCommitAt.current >= 0;
        const staminaTiming = .82 + stamina.current * .0018;
        const deepWaterAssist = settings.mode === "training" && coastalZ < -34 ? .08 : 0;
        const touchTimingAssist = mobileRenderer ? .045 : 0;
        takeoffQuality = inLineup
          ? THREE.MathUtils.clamp(
              crestAlignment * (.38 + setState.energy * .62) * staminaTiming * (.34 + takeoffAlignment * .66) * (1 - onshoreChop * (settings.mode === "training" ? .035 : settings.mode === "advanced" ? .12 : .075)) + deepWaterAssist + touchTimingAssist,
              0,
              1,
            )
          : 0;
        const breakDemand = Math.max(0, tidePower + tideSteepness - 1.85) * .055;
        const takeoffThreshold = (settings.mode === "training" ? .22 : settings.mode === "advanced" ? .5 : .36) + breakDemand;
        const headingThreshold = settings.mode === "training" ? .18 : settings.mode === "advanced" ? .52 : .34;
        catchReady = !takeoffCommitting
          && inLineup
          && takeoffAlignment >= headingThreshold
          && t >= missedWaveUntil.current
          && takeoffQuality >= takeoffThreshold;
        const setCopy = setState.setActive && setState.setWaveIndex > 0
          ? `Wave ${setState.setWaveIndex} of ${setState.waveCount} building`
          : setState.secondsToPeak === 0
            ? "Set is here"
            : `Next set ${Math.ceil(setState.secondsToPeak)}s`;
        const enterRide = (
          committedQuality: number,
          catchTransport: ReturnType<typeof primaryWaveVelocityAt>,
        ) => {
          phase.current = "riding";
          rideDistance.current = 0;
          pocketDistance.current = 0;
          rideWavePhase.current = primaryWavePhaseAt(
            position.current.x,
            position.current.z,
            t,
            settings,
            character,
          );
          const catchNormalX = catchTransport.x / Math.max(.001, catchTransport.speed);
          const catchNormalZ = catchTransport.z / Math.max(.001, catchTransport.speed);
          const catchTangentX = catchNormalZ;
          const catchTangentZ = -catchNormalX;
          rideOriginAlong.current = position.current.x * catchTangentX + position.current.z * catchTangentZ;
          ridePocketOffset.current = 0;
          waveCrestOffset.current = 0;
          rideFacePosition.current = 0;
          rideLineSide.current = Math.abs(character.peel) >= .18
            ? Math.sign(character.peel)
            : Math.abs(steer) > .16
              ? Math.sign(steer)
              : position.current.x < 0 ? -1 : 1;
          const catchTrim = rideLineSide.current
            * catchTransport.speed
            * (.56 + character.length * .026 + Math.abs(character.peel) * .08);
          const catchNormalSpeed = catchTransport.speed * (.92 + committedQuality * .08);
          const catchTangentSpeed = catchTrim * (.62 + committedQuality * .38);
          rideVelocity.current.set(
            catchNormalX * catchNormalSpeed + catchTangentX * catchTangentSpeed,
            catchNormalZ * catchNormalSpeed + catchTangentZ * catchTangentSpeed,
          );
          rideAcceleration.current.set(0, 0);
          rideHeading.current = Math.atan2(
            rideVelocity.current.x,
            rideVelocity.current.y,
          );
          barrelTime.current = 0;
          stance.current = 0;
          unstableFor.current = (1 - committedQuality) * .14;
          railSlip.current = (1 - committedQuality) * .18;
          catchQuality.current = committedQuality;
          combo.current = .85 + committedQuality * .95;
          maxCombo.current = Math.max(maxCombo.current, combo.current);
          rideTakeoffQuality.current = committedQuality;
          rideAnalysisDuration.current = 0;
          rideLineIntegral.current = 0;
          rideControlIntegral.current = 0;
          ridePowerIntegral.current = 0;
          rideMaxSpeed.current = catchTransport.speed;
          rideMaxCombo.current = combo.current;
          rideStartScore.current = score.current;
          rideManeuverStart.current = maneuverCount.current;
          score.current += Math.round(70 + committedQuality * 420 + setState.energy * 80);
          rideResult.current = "";
          cleanFinish.current = false;
          finishAt.current = -1;
          activeManeuver.current = null;
          maneuverQuality.current = 0;
          takeoffCommitAt.current = -1;
          takeoffCommitProgress = 0;
          motion.current.takeoff = 1;
          motion.current.impact = .58 + committedQuality * .42;
          paddleVelocity.current.set(0, 0);
        };

        if (takeoffCommitting) {
          const commitElapsed = Math.max(0, t - takeoffCommitAt.current);
          takeoffCommitProgress = THREE.MathUtils.clamp(
            commitElapsed / Math.max(.55, takeoffCommitDuration.current),
            0,
            1,
          );
          const catchTransport = primaryWaveVelocityAt(
            position.current.x,
            position.current.z,
            t,
            settings,
            character,
          );
          const catchNormalX = catchTransport.x / Math.max(.001, catchTransport.speed);
          const catchNormalZ = catchTransport.z / Math.max(.001, catchTransport.speed);
          const catchTangentX = catchNormalZ;
          const catchTangentZ = -catchNormalX;
          const currentNormalSpeed = paddleVelocity.current.x * catchNormalX
            + paddleVelocity.current.y * catchNormalZ;
          const currentTangentSpeed = paddleVelocity.current.x * catchTangentX
            + paddleVelocity.current.y * catchTangentZ;
          const capture = THREE.MathUtils.smootherstep(takeoffCommitProgress, .04, .84);
          const targetNormalSpeed = catchTransport.speed
            * (.88 + takeoffCommitQuality.current * .13 + setState.energy * .035);
          const targetTangentSpeed = currentTangentSpeed * (1 - capture * .68);
          const captureResponse = 3.8 + capture * 5.2;
          paddleVelocity.current.x = THREE.MathUtils.damp(
            paddleVelocity.current.x,
            catchNormalX * targetNormalSpeed + catchTangentX * targetTangentSpeed,
            captureResponse,
            delta,
          );
          paddleVelocity.current.y = THREE.MathUtils.damp(
            paddleVelocity.current.y,
            catchNormalZ * targetNormalSpeed + catchTangentZ * targetTangentSpeed,
            captureResponse,
            delta,
          );
          paddleEffort = Math.max(
            paddleEffort,
            (1 - THREE.MathUtils.smoothstep(takeoffCommitProgress, .42, .82))
              * (.78 + takeoffCommitQuality.current * .22),
          );
          stamina.current = Math.max(0, stamina.current - delta * (8.5 + setState.energy * 3.2));
          takeoffQuality = takeoffCommitQuality.current;
          catchReady = false;
          prompt = takeoffCommitProgress < .48
            ? "Wave engaged — three hard strokes to match the crest"
            : takeoffCommitProgress < .82
              ? "Hands planted — chest forward"
              : "Pop up — carry the drop into your line";
          if (takeoffCommitProgress >= 1) {
            const speedMatch = THREE.MathUtils.clamp(
              currentNormalSpeed / Math.max(.1, targetNormalSpeed),
              0,
              1,
            );
            const committedQuality = THREE.MathUtils.clamp(
              takeoffCommitQuality.current * .82 + speedMatch * .18,
              .18,
              1,
            );
            enterRide(committedQuality, catchTransport);
          }
        } else {
          prompt = !inLineup
            ? duckDiveReady
              ? `Wall arriving ${shorebreakSeconds.toFixed(1)}s · DIVE / SPACE now`
              : shorebreakIntensity > .08
                ? `Set wall building · ${shorebreakSeconds.toFixed(1)}s to impact`
                : "Paddle beyond the break · read the incoming walls"
            : takeoffAlignment < headingThreshold
              ? "Turn the board toward shore · use A/D or the stick"
              : t < missedWaveUntil.current
                ? "Wave rolled under — reset and read the next crest"
                : catchReady
                  ? `${takeoffQuality > .76 ? "Clean shoulder" : "Takeoff window"} · COMMIT NOW`
                  : setState.energy < .3
                    ? `Hold the lineup · ${setCopy}`
                    : `Crest approaching · ${Math.round(takeoffQuality * 100)}%`;
          if (actionPressed && inLineup) {
            if (catchReady) {
              takeoffCommitAt.current = t;
              takeoffCommitDuration.current = (
                settings.mode === "training" ? .66 : settings.mode === "advanced" ? .92 : .78
              ) + (mobileRenderer ? .06 : 0);
              takeoffCommitQuality.current = takeoffQuality;
              rideWavePhase.current = takeoffPhase;
              stamina.current = Math.max(0, stamina.current - 2.5);
              motion.current.impact = Math.max(motion.current.impact, .22 + takeoffQuality * .18);
              catchReady = false;
            } else if (t >= missedWaveUntil.current) {
              stamina.current = Math.max(0, stamina.current - 6);
              missedWaveUntil.current = t + 1.2;
              catchReady = false;
            }
          }
        }
        if (position.current.z > 1 + tideShift) {
          phase.current = "wading";
          takeoffCommitAt.current = -1;
          takeoffCommitProgress = 0;
          playerHeading.current = paddleHeading.current;
          landVelocity.current.copy(paddleVelocity.current).multiplyScalar(.45);
          paddleVelocity.current.set(0, 0);
        }
      } else if (currentPhase === "riding") {
        takeoffQuality = catchQuality.current;
        const finishing = finishAt.current >= 0;
        const finishElapsed = finishing ? Math.max(0, t - finishAt.current) : 0;
        rideOutProgress = finishing
          ? THREE.MathUtils.smootherstep(finishElapsed, .04, .92)
          : 0;
        const rideSteer = steer * (1 - rideOutProgress);
        const waveTransport = primaryWaveVelocityAt(
          position.current.x,
          position.current.z,
          t,
          settings,
          character,
        );
        const currentWavePhase = primaryWavePhaseAt(
          position.current.x,
          position.current.z,
          t,
          settings,
          character,
        );
        const faceTarget = finishing
          ? 0
          : THREE.MathUtils.clamp(
              stance.current * .86 + (move > .08 ? .08 : move < -.08 ? -.05 : 0),
              -1,
              1,
            );
        rideFacePosition.current = THREE.MathUtils.damp(
          rideFacePosition.current,
          faceTarget,
          finishing ? 4.6 : 2.55,
          delta,
        );
        const facePhaseRange = THREE.MathUtils.clamp(
          .4 + settings.waveHeight * tideResponse.faceScale * .045,
          .42,
          .62,
        );
        const desiredWavePhase = rideWavePhase.current - rideFacePosition.current * facePhaseRange;
        const crestPhaseError = Math.atan2(
          Math.sin(currentWavePhase - rideWavePhase.current),
          Math.cos(currentWavePhase - rideWavePhase.current),
        );
        const phaseError = Math.atan2(
          Math.sin(currentWavePhase - desiredWavePhase),
          Math.cos(currentWavePhase - desiredWavePhase),
        );
        const waveNumber = Math.PI * 2 / waveTransport.wavelength;
        const phaseCorrection = THREE.MathUtils.clamp(
          -phaseError * 1.72 / Math.max(.08, waveNumber),
          -3.2,
          3.2,
        );
        const crestTravelLimit = THREE.MathUtils.clamp(waveTransport.wavelength * .075, 5.4, 15);
        waveCrestOffset.current = THREE.MathUtils.damp(
          waveCrestOffset.current,
          THREE.MathUtils.clamp(
            -crestPhaseError / Math.max(.08, waveNumber),
            -crestTravelLimit,
            crestTravelLimit,
          ),
          8.5,
          delta,
        );
        const waveNormalX = waveTransport.x / Math.max(.001, waveTransport.speed);
        const waveNormalZ = waveTransport.z / Math.max(.001, waveTransport.speed);
        // The crest normal and its perpendicular tangent are the shared frame for
        // wave transport, down-the-line trim, pocket tracking, and the visible face.
        const waveTangentX = waveNormalZ;
        const waveTangentZ = -waveNormalX;
        const peelVelocity = rideLineSide.current
          * waveTransport.speed
          * (.38 + Math.abs(character.peel) * .22 + character.length * .018);
        ridePocketOffset.current += peelVelocity * delta;
        const waveSpeed = waveTransport.speed * (.88 + tidePower * .12);
        const pumping = !finishing && move > 0.08 && stamina.current > 1;
        if (finishing) stance.current = THREE.MathUtils.damp(stance.current, 0, 4.8, delta);
        else if (move > 0.08) stance.current = Math.min(1, stance.current + delta * 0.72 * move);
        else if (move < -0.08) stance.current = Math.max(-1, stance.current + delta * 0.86 * move);
        else stance.current = THREE.MathUtils.damp(stance.current, 0, 1.05, delta);
        const nosePressure = Math.max(0, stance.current);
        const tailPressure = Math.max(0, -stance.current);
        const highFace = Math.max(0, rideFacePosition.current);
        const lowFace = Math.max(0, -rideFacePosition.current);
        stamina.current = THREE.MathUtils.clamp(stamina.current + delta * (pumping ? -14 : 6.5), 0, 100);
        const breakTravel = rideDistance.current;
        const pocketPulse = rideLineSide.current * Math.sin(breakTravel * .18 + t * .13 + rideOriginAlong.current * .07) * tideVariability * 1.1;
        const pocketAlong = rideOriginAlong.current + ridePocketOffset.current + pocketPulse;
        const pocketWidth = THREE.MathUtils.clamp(3.4 + settings.waveHeight * tideResponse.faceScale * .46 + (1 - tideSteepness) * .9, 3.6, 6.7);
        const surferAlong = position.current.x * waveTangentX + position.current.z * waveTangentZ;
        const signedPocketDistance = (surferAlong - pocketAlong) * rideLineSide.current;
        linePosition = THREE.MathUtils.clamp(signedPocketDistance / pocketWidth, -1.5, 1.5);
        const lineTolerance = settings.mode === "training" ? 1.3 : settings.mode === "advanced" ? .88 : 1.06;
        lineControl = 1 - THREE.MathUtils.smoothstep(Math.abs(linePosition), .38 * lineTolerance, 1.16 * lineTolerance);
        const deepRisk = THREE.MathUtils.smoothstep(-linePosition, .64 * lineTolerance, 1.34 * lineTolerance);
        const shoulderStall = THREE.MathUtils.smoothstep(linePosition, .76 * lineTolerance, 1.42 * lineTolerance);
        sectionPressure = Math.max(deepRisk, shoulderStall * .78) * (.66 + tideVariability * .34);
        const pumpBoost = pumping ? 1.4 + stamina.current * 0.017 : 0;
        speed = waveSpeed * boardSpec.speed * (0.88 + setState.energy * 0.16) + pumpBoost + nosePressure * 0.85 - tailPressure * 0.48;
        speed *= (
          .82
          + lineControl * .24
          - shoulderStall * .1
          + Math.max(0, -linePosition) * .025
          + highFace * .07
          + lowFace * .035
        );
        const priorWaveQuality = motion.current.waveQuality;
        const gripBase = settings.board === "performance" ? .96 : settings.board === "longboard" ? .9 : .82;
        const railDemand = Math.abs(rideSteer) * (.72 + speed * .035) * (1 + nosePressure * .16 - tailPressure * .12) * (.92 + tideSteepness * .1) * (1 + highFace * .08);
        const railGrip = gripBase + priorWaveQuality * .2 + tailPressure * .08 - nosePressure * .1 - highFace * .045;
        const rawSlip = THREE.MathUtils.smoothstep(railDemand, railGrip, railGrip + .3);
        const assistedSlip = settings.mode === "training" ? rawSlip * .52 : rawSlip;
        railSlip.current = THREE.MathUtils.damp(railSlip.current, assistedSlip, assistedSlip > railSlip.current ? 7.5 : 3.4, delta);
        railLoad = rideSteer * (1 - railSlip.current * .38) * (1 + tailPressure * .16);
        compression = THREE.MathUtils.clamp(
          Math.abs(railLoad) * .52
            + tailPressure * .3
            + (pumping ? .16 : 0)
            + motion.current.maneuver * .32
            + Math.abs(motion.current.lateralForce) * .12
            + Math.max(0, -motion.current.acceleration) * .08,
          0,
          1,
        );
        speed *= 1 - railSlip.current * .075;
        const turnGrip = 1 - railSlip.current * .46;
        const drift = Math.sign(rideSteer) * railSlip.current * (1.15 + speed * .045);
        const railTurn = railLoad * boardSpec.turn * (4.4 + speed * .18) * (1 + tailPressure * .38 - nosePressure * .12) * turnGrip + drift;
        const trimDrive = rideLineSide.current * speed * (.56 + character.length * .026 + Math.abs(character.peel) * .08);
        const tangentialVelocity = trimDrive + railTurn;
        const normalVelocity = Math.max(
          2.4 / Math.max(.45, waveNormalZ),
          waveTransport.speed + phaseCorrection,
        ) * (1 + nosePressure * .025 - tailPressure * .018 + Math.abs(railLoad) * .012);
        const rideCurrentAngle = THREE.MathUtils.degToRad(settings.currentDirection - settings.coastHeading);
        const rideCurrentSpeed = settings.currentStrength / 3.6;
        const currentInfluence = .12 + railSlip.current * .08 + lowFace * .035;
        const targetLateralVelocity = waveNormalX * normalVelocity
          + waveTangentX * tangentialVelocity
          + Math.sin(rideCurrentAngle) * rideCurrentSpeed * currentInfluence;
        const targetShorewardVelocity = waveNormalZ * normalVelocity
          + waveTangentZ * tangentialVelocity
          - Math.cos(rideCurrentAngle) * rideCurrentSpeed * currentInfluence;

        // A surfboard carries momentum across the wave instead of snapping to
        // a newly calculated path. The crest-normal component stays responsive
        // enough to remain captured by the physical swell, while down-the-line
        // velocity changes through rail force, board outline, and fin grip.
        if (rideVelocity.current.lengthSq() < .04) {
          rideVelocity.current.set(targetLateralVelocity, targetShorewardVelocity);
        }
        const previousRideVelocityX = rideVelocity.current.x;
        const previousRideVelocityZ = rideVelocity.current.y;
        let inertialNormalVelocity = rideVelocity.current.x * waveNormalX
          + rideVelocity.current.y * waveNormalZ;
        let inertialTangentialVelocity = rideVelocity.current.x * waveTangentX
          + rideVelocity.current.y * waveTangentZ;
        const normalResponse = finishing
          ? 6.8
          : 5.15 + highFace * .7 + Math.abs(phaseCorrection) * .22;
        const outlineResponse = settings.board === "performance"
          ? 1.12
          : settings.board === "fish"
            ? .96
            : .78;
        const tangentialResponse = finishing
          ? 4.8
          : (
            2.25
            + Math.abs(railLoad) * 2.65
            + tailPressure * .52
            + lineControl * .34
          ) * outlineResponse * (1 - railSlip.current * .34);
        inertialNormalVelocity = THREE.MathUtils.damp(
          inertialNormalVelocity,
          targetLateralVelocity * waveNormalX + targetShorewardVelocity * waveNormalZ,
          normalResponse,
          delta,
        );
        inertialTangentialVelocity = THREE.MathUtils.damp(
          inertialTangentialVelocity,
          targetLateralVelocity * waveTangentX + targetShorewardVelocity * waveTangentZ,
          tangentialResponse,
          delta,
        );
        rideVelocity.current.set(
          waveNormalX * inertialNormalVelocity + waveTangentX * inertialTangentialVelocity,
          waveNormalZ * inertialNormalVelocity + waveTangentZ * inertialTangentialVelocity,
        );
        const hydrodynamicSpeedLimit = Math.max(
          waveTransport.speed * 1.08,
          Math.hypot(targetLateralVelocity, targetShorewardVelocity) * (1.08 + railSlip.current * .035),
        );
        if (rideVelocity.current.length() > hydrodynamicSpeedLimit) {
          rideVelocity.current.setLength(hydrodynamicSpeedLimit);
        }
        const accelerationStep = Math.max(.001, Math.min(delta, .05));
        const rawAccelerationX = (rideVelocity.current.x - previousRideVelocityX) / accelerationStep;
        const rawAccelerationZ = (rideVelocity.current.y - previousRideVelocityZ) / accelerationStep;
        rideAcceleration.current.x = THREE.MathUtils.damp(
          rideAcceleration.current.x,
          rawAccelerationX,
          7.2,
          accelerationStep,
        );
        rideAcceleration.current.y = THREE.MathUtils.damp(
          rideAcceleration.current.y,
          rawAccelerationZ,
          7.2,
          accelerationStep,
        );
        const velocityHeading = Math.atan2(rideVelocity.current.x, rideVelocity.current.y);
        const velocityForwardX = Math.sin(velocityHeading);
        const velocityForwardZ = Math.cos(velocityHeading);
        const velocityRightX = Math.cos(velocityHeading);
        const velocityRightZ = -Math.sin(velocityHeading);
        rideDrive = THREE.MathUtils.clamp(
          (
            rideAcceleration.current.x * velocityForwardX
            + rideAcceleration.current.y * velocityForwardZ
          ) / 8.5,
          -1,
          1,
        );
        rideLateralForce = THREE.MathUtils.clamp(
          (
            rideAcceleration.current.x * velocityRightX
            + rideAcceleration.current.y * velocityRightZ
          ) / 9.5,
          -1,
          1,
        );
        const lateralVelocity = rideVelocity.current.x;
        const shorewardVelocity = rideVelocity.current.y;
        rideHeading.current = dampAngle(rideHeading.current, Math.atan2(lateralVelocity, shorewardVelocity), 4.8, delta);
        position.current.x += lateralVelocity * delta;
        position.current.z += shorewardVelocity * delta;
        const rideStep = Math.hypot(lateralVelocity, shorewardVelocity) * delta;
        speed = rideStep / Math.max(.001, delta);
        rideDistance.current += rideStep;
        if (lineControl > .5) pocketDistance.current += rideStep;
        balanceTarget =
          Math.sin(t * (1.25 + modeDifficulty * 0.7) + position.current.x * 0.13) * (0.33 + modeDifficulty * 0.28) * (1 + nosePressure * 0.12) * (.88 + tidePower * .08 + tideVariability * .1) / boardSpec.stability +
          Math.sin(t * 3.1) * settings.currentStrength * 0.045 -
          rideSteer * (0.22 + tailPressure * 0.08) +
          stance.current * 0.07 +
          Math.sin(t * 8.2) * railSlip.current * .16 +
          Math.sin(t * (5.8 + tideVariability) + position.current.x * .06) * highFace * .075 / boardSpec.stability +
          Math.sin(t * (4.7 + windExposure * 1.8) + position.current.z * .08) * onshoreChop * .13 / boardSpec.stability +
          Math.sign(rideSteer) * railSlip.current * .1 +
          rideLateralForce * .11 / boardSpec.stability -
          rideDrive * .035;
        const attempt = activeManeuver.current;
        const loadAvailable = !finishing && !attempt && t - lastManeuverAt.current > .72 && stamina.current > 5 && railSlip.current < .8;
        if (loadAvailable && state.action) {
          if (actionPressed) trickCharge.current = Math.max(trickCharge.current, .08);
          const loadRate = settings.mode === "training" ? 1.48 : settings.mode === "advanced" ? 1.08 : 1.24;
          trickCharge.current = Math.min(1, trickCharge.current + delta * loadRate);
          stamina.current = Math.max(0, stamina.current - delta * (2.2 + trickCharge.current * 3.2));
          compression = Math.max(compression, .28 + trickCharge.current * .72);
          maneuverPhase = "load";
        } else if (!attempt && !state.action && !actionReleased) {
          trickCharge.current = THREE.MathUtils.damp(trickCharge.current, 0, 8, delta);
        }
        if (attempt) {
          maneuverProgress = THREE.MathUtils.clamp((t - attempt.startedAt) / attempt.duration, 0, 1);
          const modeWindow = settings.mode === "training" ? .68 : settings.mode === "advanced" ? .38 : .52;
          const familyWindow = attempt.family === "air" ? .82 : attempt.family === "lip" ? .92 : 1;
          landingWindow = THREE.MathUtils.clamp((modeWindow * Math.sqrt(boardSpec.stability) + (mobileRenderer ? .08 : 0)) * familyWindow, .27, .82);
          const arc = Math.pow(Math.sin(maneuverProgress * Math.PI), .82);
          const lift = attempt.lift * arc;
          const spin = attempt.side * attempt.rotation * Math.sin(maneuverProgress * Math.PI);
          const landingDrift = attempt.side * (arc * (.14 + attempt.rotation * .035) + maneuverProgress * (.08 + attempt.charge * .05));
          landingTarget = THREE.MathUtils.clamp(balanceTarget + landingDrift, -1, 1);
          balanceTarget = landingTarget;
          motion.current.maneuver = Math.max(motion.current.maneuver, .12 + arc * .88);
          motion.current.maneuverSide = attempt.side;
          motion.current.maneuverLift = lift;
          motion.current.maneuverSpin = spin;
          maneuverAirborne = attempt.family === "air" && lift > .18;
          maneuverPhase = maneuverProgress < .2 ? "release" : maneuverAirborne && maneuverProgress < .72 ? "air" : "land";
        }
        const balanceError = Math.abs(balanceInput - balanceTarget);
        const failThreshold = (settings.mode === "training" ? 1.08 : settings.mode === "advanced" ? 0.64 : 0.82) * Math.sqrt(boardSpec.stability);
        unstableFor.current = balanceError > failThreshold ? unstableFor.current + delta : Math.max(0, unstableFor.current - delta * 1.8);
        unstableFor.current += sectionPressure * delta * (settings.mode === "training" ? .12 : settings.mode === "advanced" ? .5 : .3);
        const wavePhase = Math.sin(primaryWavePhaseAt(position.current.x, position.current.z, t, settings, character));
        const lineMatch = Math.abs(character.peel) < .18
          ? 1
          : THREE.MathUtils.clamp(.58 + rideSteer * character.peel * .42, .2, 1);
        const sectionQuality = 1 - tideVariability * (.12 + Math.abs(Math.sin(position.current.x * .11 + t * .17)) * .18);
        const windShape = (1 - onshoreChop * .17 + offshoreGroom * .055) * (.9 + tideResponse.quality * .1);
        waveQuality = THREE.MathUtils.clamp(
          ((wavePhase + 1) * .3 + setState.energy * .12 + catchQuality.current * .08 + lineMatch * .1 + sectionQuality * .07 + lineControl * .23) * windShape,
          0,
          1,
        );
        const controlQuality = Math.max(0, 1 - balanceError / 1.2) * (1 - railSlip.current * .36);
        const barrelThreshold = .8 - tideHollow * .18 + onshoreChop * .08 - offshoreGroom * .025;
        const pocketBarrel = 1 - THREE.MathUtils.smoothstep(Math.abs(linePosition + .18), .34, .92);
        const inBarrel = !finishing
          && waveQuality > barrelThreshold
          && controlQuality > .72
          && pocketBarrel > .42
          && rideFacePosition.current > -.18
          && Math.abs(rideSteer) < .68
          && stance.current > -.58;
        barrelIntensity = inBarrel
          ? THREE.MathUtils.clamp((waveQuality - barrelThreshold + .12) * (1.75 + tideHollow) + controlQuality * .16, 0, 1)
          : 0;
        if (!finishing) {
          const analysisStep = Math.min(delta, .05);
          const powerQuality = THREE.MathUtils.clamp(
            setState.energy * .2
              + waveQuality * .28
              + Math.min(1, speed / 18) * .24
              + Math.abs(railLoad) * .14
              + Math.abs(rideLateralForce) * .055
              + Math.max(0, rideDrive) * .045
              + highFace * .055
              + lowFace * .025
              + barrelIntensity * .14,
            0,
            1,
          );
          rideAnalysisDuration.current += analysisStep;
          rideLineIntegral.current += lineControl * analysisStep;
          rideControlIntegral.current += THREE.MathUtils.clamp(controlQuality * (1 - railSlip.current * .12), 0, 1) * analysisStep;
          ridePowerIntegral.current += powerQuality * analysisStep;
          rideMaxSpeed.current = Math.max(rideMaxSpeed.current, speed);
        }
        if (inBarrel && !finishing) {
          barrelTime.current += delta;
          combo.current = Math.min(8, combo.current + delta * 0.23);
          score.current += (26 + barrelTime.current * 4) * controlQuality * combo.current * delta;
        }
        const turnBonus = Math.abs(railLoad) * (
          12 + compression * 5 + Math.abs(rideFacePosition.current) * 3.5
        ) * (1 - railSlip.current * .42);
        if (!finishing) {
          combo.current = Math.min(8, combo.current + controlQuality * lineControl * delta * 0.12 + Math.abs(railLoad) * (1 - railSlip.current) * lineControl * delta * 0.15 + (pumping && lineControl > .48 ? delta * 0.04 : 0));
          maxCombo.current = Math.max(maxCombo.current, combo.current);
          score.current += (14 + turnBonus + waveQuality * 18) * controlQuality * combo.current * lineMatch * (.58 + lineControl * .52) * delta;
        }
        if (attempt && maneuverProgress >= 1) {
          const landingError = Math.abs(balanceInput - landingTarget);
          const recoveryAssist = settings.mode === "training" ? 1.35 : mobileRenderer ? 1.12 : 1;
          const landed = landingError <= landingWindow * recoveryAssist && railSlip.current < .88;
          if (landed) {
            const landingControl = THREE.MathUtils.clamp(1 - landingError / landingWindow, 0, 1);
            const setupQuality = .52 + attempt.charge * .48;
            const quality = THREE.MathUtils.clamp(.14 + landingControl * .66 + controlQuality * .1 + setupQuality * .1, 0, 1);
            const points = Math.round(attempt.base * boardSpec.score * (.54 + controlQuality * .3 + quality * .46 + attempt.charge * .22) * (0.88 + setState.energy * .28) * (.72 + lineControl * .38) * combo.current * (1 + barrelIntensity * .12));
            score.current += points;
            combo.current = Math.min(8, combo.current + .28 + quality * .48);
            maxCombo.current = Math.max(maxCombo.current, combo.current);
            maneuver.current = attempt.name;
            maneuverScore.current = points;
            maneuverQuality.current = quality;
            maneuverCount.current += 1;
            maneuverId.current += 1;
            railSlip.current = Math.min(railSlip.current, .22 - quality * .12);
            motion.current.impact = .72 + quality * .28;
            motion.current.maneuver = 1;
          } else {
            maneuverQuality.current = 0;
            unstableFor.current = 10;
            railSlip.current = 1;
            motion.current.impact = .62;
          }
          activeManeuver.current = null;
          trickCharge.current = 0;
        }
        if (!finishing) rideMaxCombo.current = Math.max(rideMaxCombo.current, combo.current);
        const wantsRelease = !attempt && actionReleased;
        if (!finishing && wantsRelease && t - lastManeuverAt.current > .72 && trickCharge.current >= .055 && stamina.current > 4 && balanceError < failThreshold * .94 && railSlip.current < .78) {
          const charge = THREE.MathUtils.clamp(trickCharge.current, .06, 1);
          const rail = Math.abs(steer);
          let name = rideFacePosition.current < -.42 ? "Bottom Turn" : "High Line";
          let family: ManeuverAttempt["family"] = rideFacePosition.current < -.42 ? "carve" : "trim";
          let base = rideFacePosition.current < -.42 ? 185 : 150;
          let lift = .04;
          let rotation = rideFacePosition.current < -.42 ? .34 : .08;
          if (nosePressure > (settings.board === "longboard" ? 0.42 : 0.62) && rail < 0.32 && waveQuality > 0.55 && rideFacePosition.current > .08) {
            name = "Nose Ride";
            base = settings.board === "longboard" ? 440 : 340;
          } else if (charge > .82 && tailPressure > .34 && rail > .38 && waveQuality > .7 && speed > 10.2 && linePosition < .5 && rideFacePosition.current > .38) {
            family = "air";
            name = charge > .95 && rail > .62 ? "Alley-Oop" : "Air Reverse";
            base = name === "Alley-Oop" ? 780 : 690;
            lift = .82 + charge * .62 + settings.waveHeight * .08;
            rotation = name === "Alley-Oop" ? 2.35 : 1.72;
          } else if (tailPressure > .56 && rail > .42 && waveQuality > .54 && rideFacePosition.current > .2) {
            family = "lip";
            name = charge > .68 ? "Layback Release" : "Tail Release";
            base = charge > .68 ? 470 : 390;
            lift = .22 + charge * .28;
            rotation = .64 + charge * .34;
          } else if (waveQuality > .72 && rail > .42 && rideFacePosition.current > .3) {
            family = "lip";
            name = "Lip Snap";
            base = 360;
            lift = .18 + charge * .3;
            rotation = .58 + charge * .42;
          } else if (waveQuality > 0.68 && rideFacePosition.current > .46) {
            family = "lip";
            name = "Foam Floater";
            base = 305;
            lift = .22 + charge * .24;
            rotation = .26;
          } else if (linePosition > .5 && rail > .38) {
            family = "carve";
            name = charge > .7 ? "Roundhouse Cutback" : "Pocket Cutback";
            base = charge > .7 ? 410 : 285;
            lift = .08;
            rotation = .72 + charge * .36;
          } else if (rail > 0.52) {
            family = "carve";
            name = charge > .72 ? "Power Carve" : "Rail Carve";
            base = charge > .72 ? 330 : 230;
            lift = .06;
            rotation = .5 + charge * .34;
          } else if (pumping) {
            name = "Power Pump";
            base = 175;
          }
          stamina.current = Math.max(0, stamina.current - (5 + charge * 8 + (family === "air" ? 5 : 0)));
          maneuver.current = name;
          maneuverScore.current = 0;
          maneuverQuality.current = 0;
          lastManeuverAt.current = t;
          const side = steer || (balanceInput >= 0 ? 1 : -1);
          const baseDuration = family === "air" ? 1.04 : name === "Nose Ride" ? .92 : name === "Foam Floater" ? .8 : family === "carve" ? .78 : .7;
          const timingScale = settings.mode === "training" ? 1.12 : settings.mode === "advanced" ? .94 : 1;
          activeManeuver.current = {
            name,
            family,
            base,
            side,
            charge,
            lift,
            rotation,
            startedAt: t,
            duration: (baseDuration + charge * .12) * timingScale + (mobileRenderer ? .08 : 0),
          };
          trickCharge.current = 0;
          motion.current.maneuver = .16;
          motion.current.maneuverSide = side;
          motion.current.impact = .35;
        } else if (wantsRelease) {
          trickCharge.current = 0;
        }
        prompt = finishing
          ? "Hold the exit — clean line"
          : activeManeuver.current
            ? `${activeManeuver.current.name} · ${maneuverPhase === "air" ? "spot the landing" : "reconnect with the landing marker"}`
          : trickCharge.current > .05
            ? `Board loaded ${Math.round(trickCharge.current * 100)}% · release to throw the move`
          : actionReleased && railSlip.current >= .78
          ? "Fins released — reconnect the rail before the next move"
          : balanceError > failThreshold * 0.76
          ? "Shift your weight toward the marker"
          : railSlip.current > .55
            ? "Rail releasing — soften the turn or load the tail"
          : inBarrel
            ? `Locked in the barrel · ${barrelTime.current.toFixed(1)}s`
          : linePosition < -.72
            ? `Pocket closing · drive ${rideLineSide.current > 0 ? "right" : "left"} toward the open face`
          : linePosition > .72
            ? `Shoulder fading · cut back ${rideLineSide.current > 0 ? "left" : "right"} toward the pocket`
          : lineControl > .76 && Math.abs(steer) < .18
            ? "Power pocket locked · build speed or release a move"
          : rideFacePosition.current > .58
            ? "Lip line — load the tail and release through the pitching section"
          : rideFacePosition.current < -.58
            ? "Bottom turn — set the rail and drive back toward the lip"
          : steer
            ? "Hold the rail · hold TRICK / SPACE to load, then release"
            : pumping
              ? "Move toward the nose · pumping for speed"
              : move < -0.08
                ? "Tail pressure · tighter turning response"
                : Math.abs(character.peel) > .18
                  ? `${character.peel > 0 ? "Right" : "Left"} shoulder opening · set the rail toward the caustic seam`
                  : "W nose / pump · S tail / control · hold SPACE, then release";
        if (!finishing && unstableFor.current > (settings.mode === "training" ? 1.15 : 0.58)) {
          phase.current = "wipeout";
          wipeoutAt.current = t;
          const waveEnergy = THREE.MathUtils.clamp(
            settings.waveHeight / 4.2 * .24
              + Math.max(0, settings.wavePeriod - 6) / 12 * .16
              + setState.energy * .18
              + tidePower * .09
              + Math.min(1, speed / 22) * .13
              + sectionPressure * .12
              + railSlip.current * .08,
            0,
            1,
          );
          const modeHoldScale = settings.mode === "training" ? .72 : settings.mode === "advanced" ? 1.12 : .94;
          wipeoutPower.current = waveEnergy;
          wipeoutDuration.current = THREE.MathUtils.clamp(
            THREE.MathUtils.lerp(1.55, 4.18, Math.pow(waveEnergy, .84)) * modeHoldScale,
            1.35,
            4.65,
          );
          const currentAngle = THREE.MathUtils.degToRad(settings.currentDirection - settings.coastHeading);
          const currentSpeed = settings.currentStrength / 3.6;
          const washSpeed = 1.25 + waveEnergy * 4.1 + setState.energy * .72;
          wipeoutVelocity.current.set(
            rideVelocity.current.x * (.34 + waveEnergy * .12)
              + waveNormalX * washSpeed
              + Math.sin(currentAngle) * currentSpeed * .72,
            rideVelocity.current.y * (.34 + waveEnergy * .12)
              + waveNormalZ * washSpeed
              - Math.cos(currentAngle) * currentSpeed * .72,
          );
          breath.current = 100;
          motion.current.wipeout = 0;
          motion.current.wipeoutProgress = 0;
          motion.current.wipeoutPower = waveEnergy;
          rideScore.current = Math.max(0, Math.round(score.current - rideStartScore.current));
          rideGrade.current = sessionGrade(rideScore.current, rideDistance.current, maneuverCount.current - rideManeuverStart.current);
          rideResult.current = "wipeout";
          rideResultId.current += 1;
          combo.current = 1;
          railSlip.current = 1;
          activeManeuver.current = null;
          motion.current.impact = .45;
        } else if (
          !finishing
          && !activeManeuver.current
          && (position.current.z - tideShift > 11 + (character.length - 1) * 11 || rideDistance.current > 82 + character.length * 24)
        ) {
          score.current += 750 + rideDistance.current * 11;
          rideScore.current = Math.max(0, Math.round(score.current - rideStartScore.current));
          rideGrade.current = sessionGrade(rideScore.current, rideDistance.current, maneuverCount.current - rideManeuverStart.current);
          rideResult.current = "clean";
          rideResultId.current += 1;
          cleanFinish.current = true;
          finishAt.current = t;
        }
        if (finishAt.current >= 0) {
          const activeFinishElapsed = Math.max(0, t - finishAt.current);
          rideOutProgress = THREE.MathUtils.smootherstep(activeFinishElapsed, .04, .92);
          unstableFor.current = 0;
          balanceTarget = balanceInput;
          railSlip.current = THREE.MathUtils.damp(railSlip.current, 0, 7, delta);
          prompt = activeFinishElapsed < .52
            ? "Hold the exit — let the whitewater carry you"
            : position.current.z > 1 + tideShift
              ? "Ride-out — step into the shallows"
              : "Ride-out — settle prone beyond the foam";
          const shallowExit = position.current.z > 6.8 + tideShift;
          const transitionAfter = shallowExit ? .78 : 1.48;
          if (activeFinishElapsed > transitionAfter) {
            if (position.current.z > 1 + tideShift) {
              phase.current = "wading";
              playerHeading.current = rideHeading.current;
              landVelocity.current.set(lateralVelocity, shorewardVelocity).multiplyScalar(.16);
              paddleVelocity.current.set(0, 0);
            } else {
              phase.current = "paddling";
              paddleHeading.current = Math.atan2(waveNormalX, waveNormalZ);
              paddleVelocity.current.set(lateralVelocity, shorewardVelocity).multiplyScalar(.14);
              landVelocity.current.set(0, 0);
            }
            stance.current = 0;
            activeManeuver.current = null;
            trickCharge.current = 0;
            finishAt.current = -1;
            rideOutProgress = 0;
          }
        }
      } else if (currentPhase === "wipeout") {
        const elapsed = Math.max(0, t - wipeoutAt.current);
        const duration = Math.max(1.2, wipeoutDuration.current);
        const progress = THREE.MathUtils.clamp(elapsed / duration, 0, 1);
        const turbulence = THREE.MathUtils.smootherstep(progress, 0, .13)
          * (1 - THREE.MathUtils.smoothstep(progress, .67, 1));
        const waveTransport = primaryWaveVelocityAt(
          position.current.x,
          position.current.z,
          t,
          settings,
          character,
        );
        const waveNormalX = waveTransport.x / Math.max(.001, waveTransport.speed);
        const waveNormalZ = waveTransport.z / Math.max(.001, waveTransport.speed);
        const currentAngle = THREE.MathUtils.degToRad(settings.currentDirection - settings.coastHeading);
        const currentSpeed = settings.currentStrength / 3.6;
        const residualWash = wipeoutPower.current * turbulence;
        wipeoutVelocity.current.x += (
          waveNormalX * residualWash * .42
            + Math.sin(currentAngle) * currentSpeed * .18
        ) * delta;
        wipeoutVelocity.current.y += (
          waveNormalZ * residualWash * .42
            - Math.cos(currentAngle) * currentSpeed * .18
        ) * delta;
        wipeoutVelocity.current.multiplyScalar(Math.exp(-delta * (.48 + progress * 1.7)));
        position.current.x += wipeoutVelocity.current.x * delta;
        position.current.z += wipeoutVelocity.current.y * delta;
        position.current.z = THREE.MathUtils.clamp(
          position.current.z,
          OUTER_PADDLE_LIMIT_Z + tideShift,
          7.5 + tideShift,
        );
        stamina.current = Math.min(100, stamina.current + delta * (5 + progress * 7));
        breath.current = Math.max(
          24,
          breath.current - delta * turbulence * (5.4 + wipeoutPower.current * 7.8),
        );
        speed = wipeoutVelocity.current.length();
        const remaining = Math.max(0, duration - elapsed);
        prompt = progress < .16
          ? "Impact zone — protect your head"
          : progress < .72
            ? `Hold-down · ${remaining.toFixed(1)}s to surface`
            : "Follow the leash — rising through the foam";
        motion.current.wipeout = Math.min(1.8, elapsed);
        motion.current.wipeoutProgress = progress;
        motion.current.wipeoutPower = wipeoutPower.current;
        motion.current.breath = breath.current;
        if (progress >= 1) {
          if (position.current.z > 1 + tideShift) {
            phase.current = "wading";
            playerHeading.current = Math.atan2(waveNormalX, waveNormalZ);
            landVelocity.current.copy(wipeoutVelocity.current).multiplyScalar(.16);
          } else {
            phase.current = "paddling";
            paddleHeading.current = Math.atan2(waveNormalX, waveNormalZ);
            paddleVelocity.current.copy(wipeoutVelocity.current).multiplyScalar(.18);
          }
          unstableFor.current = 0;
          motion.current.wipeout = 0;
          motion.current.wipeoutProgress = 0;
          motion.current.wipeoutPower = 0;
        }
      }
    }

    let replayMotion: MotionState | null = null;
    if (playback.active) {
      const frames = replayFrames.current;
      const first = frames[0];
      const last = frames[frames.length - 1];
      if (replayControl.seekRequest > playback.handledSeekRequest) {
        playback.handledSeekRequest = replayControl.seekRequest;
        playback.progress = THREE.MathUtils.clamp(replayControl.seekProgress, 0, .9995);
        playback.cursor = 0;
        playback.lastReportAt = -1;
      }
      if (!replayControl.paused) {
        playback.progress = THREE.MathUtils.clamp(
          playback.progress + delta * THREE.MathUtils.clamp(replayControl.speed, .25, 2) / Math.max(.001, playback.duration),
          0,
          1,
        );
      }
      const replayProgress = playback.progress;
      if (!replayMode || replayProgress >= 1 || !first || !last) {
        restoreReplay();
      } else {
        const replayAt = THREE.MathUtils.lerp(first.at, last.at, replayProgress);
        while (playback.cursor < frames.length - 2 && frames[playback.cursor + 1].at < replayAt) {
          playback.cursor += 1;
        }
        const from = frames[playback.cursor];
        const to = frames[Math.min(frames.length - 1, playback.cursor + 1)];
        const alpha = THREE.MathUtils.clamp((replayAt - from.at) / Math.max(.001, to.at - from.at), 0, 1);
        const baseX = THREE.MathUtils.lerp(from.x, to.x, alpha);
        const baseZ = THREE.MathUtils.lerp(from.z, to.z, alpha);
        const transport = primaryWaveVelocityAt(baseX, baseZ, replayAt, settings, character);
        const phaseDelta = t - replayAt - playback.timeCycleOffset;
        position.current.set(
          baseX + transport.x * phaseDelta,
          0,
          baseZ + transport.z * phaseDelta,
        );
        phase.current = "riding";
        rideHeading.current = lerpAngle(from.heading, to.heading, alpha);
        rideLineSide.current = alpha < .5 ? from.lineSide : to.lineSide;
        waveCrestOffset.current = THREE.MathUtils.lerp(from.crestOffset, to.crestOffset, alpha);
        replayMotion = interpolateReplayMotion(from.motion, to.motion, alpha);
        motion.current = replayMotion;
        rideFacePosition.current = replayMotion.facePosition;
        stance.current = replayMotion.stance;
        steer = replayMotion.steer;
        balanceInput = replayMotion.balance;
        speed = replayMotion.speed;
        waveQuality = replayMotion.waveQuality;
        linePosition = replayMotion.linePosition;
        lineControl = replayMotion.lineControl;
        sectionPressure = replayMotion.sectionPressure;
        barrelIntensity = replayMotion.barrel;
        railLoad = replayMotion.rail;
        compression = replayMotion.compression;
        rideDrive = replayMotion.acceleration;
        rideLateralForce = replayMotion.lateralForce;
        maneuverProgress = replayMotion.maneuverProgress;
        worldFocus.current.copy(position.current);

        const cameraCut = replayProgress < .24 ? 0 : replayProgress < .5 ? 1 : replayProgress < .76 ? 2 : 3;
        const cameraModeForCut = replayControl.autoDirector
          ? replayCameraForProgress(replayProgress)
          : cameraMode;
        if (cameraCut !== playback.cameraCut || t - playback.lastReportAt >= .1) {
          playback.cameraCut = cameraCut;
          playback.lastReportAt = t;
          replayStateCallback.current({
            active: true,
            progress: replayProgress,
            duration: playback.duration,
            cameraMode: cameraModeForCut,
            telemetry: replayTelemetryFromMotion(replayMotion),
            moments: playback.moments,
          });
        }
      }
    }

    const landRange = phase.current === "shore" || phase.current === "wading" || phase.current === "driving";
    position.current.x = THREE.MathUtils.clamp(
      position.current.x,
      landRange ? -COAST_PLAYABLE_HALF_WIDTH : -WATER_SIDE_LIMIT,
      landRange ? COAST_PLAYABLE_HALF_WIDTH : WATER_SIDE_LIMIT,
    );
    const isWater = phase.current === "wading"
      || phase.current === "paddling"
      || phase.current === "riding"
      || phase.current === "wipeout";
    const surfaceFrame = isWater
      ? waveSurfaceFrameAt(position.current.x, position.current.z, t, settings, character)
      : null;
    const waterY = surfaceFrame?.height ?? 0;
    if (phase.current !== "riding") {
      railSlip.current = THREE.MathUtils.damp(railSlip.current, 0, 4.2, delta);
      rideVelocity.current.x = THREE.MathUtils.damp(rideVelocity.current.x, 0, 5.5, delta);
      rideVelocity.current.y = THREE.MathUtils.damp(rideVelocity.current.y, 0, 5.5, delta);
      rideAcceleration.current.x = THREE.MathUtils.damp(rideAcceleration.current.x, 0, 7, delta);
      rideAcceleration.current.y = THREE.MathUtils.damp(rideAcceleration.current.y, 0, 7, delta);
      rideDrive = 0;
      rideLateralForce = 0;
      railLoad = 0;
      compression = 0;
    }
    const rebound = Math.sin((1 - motion.current.impact) * Math.PI) * motion.current.impact;
    const targetWaterElevation = waterY
      + (phase.current === "riding" ? 0.16 - compression * .032 + rebound * .075 : 0.04);
    const buoyancy = waterRide.current;
    let playerY = 0;
    if (isWater) {
      const suspensionStep = Math.min(delta, .04);
      const displacement = targetWaterElevation - buoyancy.elevation;
      if (!buoyancy.engaged || Math.abs(displacement) > 1.8 || delta > .12) {
        buoyancy.elevation = targetWaterElevation;
        buoyancy.velocity = 0;
        buoyancy.engaged = true;
      } else {
        const stiffness = phase.current === "riding"
          ? 92
          : phase.current === "paddling"
            ? 58
            : phase.current === "wipeout"
              ? 74
              : 82;
        const damping = Math.sqrt(stiffness) * (phase.current === "riding" ? 1.68 : 1.9);
        const acceleration = displacement * stiffness - buoyancy.velocity * damping;
        buoyancy.velocity = THREE.MathUtils.clamp(
          buoyancy.velocity + acceleration * suspensionStep,
          -7,
          7,
        );
        buoyancy.elevation += buoyancy.velocity * suspensionStep;
      }
      playerY = buoyancy.elevation;
    } else {
      buoyancy.engaged = false;
      buoyancy.elevation = 0;
      buoyancy.velocity = 0;
    }
    if (phase.current !== "riding") {
      waveCrestOffset.current = THREE.MathUtils.damp(waveCrestOffset.current, 0, 9, delta);
      rideFacePosition.current = THREE.MathUtils.damp(rideFacePosition.current, 0, 7, delta);
    }
    player.current.position.set(position.current.x, playerY, position.current.z);
    player.current.visible = phase.current !== "driving";
    const targetPlayerHeading = phase.current === "riding"
      ? rideHeading.current
      : phase.current === "shore" || phase.current === "wading"
        ? playerHeading.current
        : phase.current === "paddling"
          ? paddleHeading.current
          : steer * -.2;
    player.current.rotation.y = dampAngle(player.current.rotation.y, targetPlayerHeading, 7, delta);
    const surfaceContact = phase.current === "riding"
      ? (1 - THREE.MathUtils.smoothstep(motion.current.maneuverLift, .08, .56)) * .88
      : phase.current === "paddling"
        ? .62 * (1 - motion.current.duckDive * .52)
        : 0;
    const headingForwardX = Math.sin(targetPlayerHeading);
    const headingForwardZ = Math.cos(targetPlayerHeading);
    const headingRightX = Math.cos(targetPlayerHeading);
    const headingRightZ = -Math.sin(targetPlayerHeading);
    const forwardSlope = surfaceFrame
      ? surfaceFrame.slopeX * headingForwardX + surfaceFrame.slopeZ * headingForwardZ
      : 0;
    const lateralSlope = surfaceFrame
      ? surfaceFrame.slopeX * headingRightX + surfaceFrame.slopeZ * headingRightZ
      : 0;
    const surfacePitch = THREE.MathUtils.clamp(
      -Math.atan(forwardSlope) * surfaceContact,
      -.34,
      .34,
    );
    const surfaceRoll = THREE.MathUtils.clamp(
      Math.atan(lateralSlope) * surfaceContact,
      -.24,
      .24,
    );
    player.current.rotation.x = THREE.MathUtils.damp(
      player.current.rotation.x,
      surfacePitch,
      phase.current === "riding" ? 8 : 5.8,
      delta,
    );
    player.current.rotation.z = THREE.MathUtils.damp(
      player.current.rotation.z,
      surfaceRoll + (phase.current === "riding" ? -balanceInput * 0.17 : 0),
      phase.current === "riding" ? 8 : 5.8,
      delta,
    );
    if (waveStage.current) {
      const waveTransport = primaryWaveVelocityAt(
        position.current.x,
        position.current.z,
        t,
        settings,
        character,
      );
      const waveNormalX = waveTransport.x / Math.max(.001, waveTransport.speed);
      const waveNormalZ = waveTransport.z / Math.max(.001, waveTransport.speed);
      const crestOffset = phase.current === "riding" ? waveCrestOffset.current : 0;
      const waveStageX = position.current.x + waveNormalX * crestOffset;
      const waveStageZ = position.current.z + waveNormalZ * crestOffset;
      const waveStageY = isWater
        ? waveHeightAt(waveStageX, waveStageZ, t, settings, character) + .025
        : playerY;
      waveStage.current.position.set(waveStageX, waveStageY, waveStageZ);
      waveStage.current.rotation.y = dampAngle(
        waveStage.current.rotation.y,
        Math.atan2(waveNormalX, waveNormalZ),
        phase.current === "riding" ? 12 : 7,
        delta,
      );
      waveStage.current.rotation.z = THREE.MathUtils.damp(waveStage.current.rotation.z, 0, 14, delta);
    }

    motion.current.phase = phase.current;
    motion.current.balance = balanceInput;
    motion.current.steer = phase.current === "riding"
      ? steer * (1 - rideOutProgress)
      : steer;
    motion.current.speed = Math.abs(speed);
    motion.current.acceleration = THREE.MathUtils.damp(
      motion.current.acceleration,
      phase.current === "riding" ? rideDrive : 0,
      phase.current === "riding" ? 8.5 : 5.5,
      delta,
    );
    motion.current.lateralForce = THREE.MathUtils.damp(
      motion.current.lateralForce,
      phase.current === "riding" ? rideLateralForce : 0,
      phase.current === "riding" ? 9.5 : 5.5,
      delta,
    );
    if (phase.current !== "riding") trickCharge.current = 0;
    motion.current.run = THREE.MathUtils.damp(motion.current.run, runBlend, 8, delta);
    const waterDepthTarget = phase.current === "shore" || phase.current === "driving"
      ? 0
      : phase.current === "wading"
        ? 1 - THREE.MathUtils.smoothstep(position.current.z, .72 + tideShift, 8 + tideShift)
        : 1;
    motion.current.waterDepth = THREE.MathUtils.damp(
      motion.current.waterDepth,
      waterDepthTarget,
      waterDepthTarget > motion.current.waterDepth ? 5.5 : 8,
      delta,
    );
    const wetnessTarget = phase.current === "paddling" || phase.current === "riding" || phase.current === "wipeout"
      ? 1
      : phase.current === "wading"
        ? .34 + motion.current.waterDepth * .66
        : .06;
    motion.current.wetness = THREE.MathUtils.damp(
      motion.current.wetness,
      wetnessTarget,
      wetnessTarget > motion.current.wetness ? 4.8 : .28,
      delta,
    );
    motion.current.paddleEffort = THREE.MathUtils.damp(motion.current.paddleEffort, paddleEffort, 9, delta);
    const exertionTarget = THREE.MathUtils.clamp(
      runBlend * .48
        + Math.min(Math.abs(speed) / 13, 1) * .16
        + (phase.current === "paddling" ? paddleEffort * .82 : 0)
        + (phase.current === "riding" ? .3 + compression * .38 : 0)
        + (phase.current === "wipeout" ? .68 : 0),
      0,
      1,
    );
    motion.current.exertion = THREE.MathUtils.damp(
      motion.current.exertion,
      exertionTarget,
      exertionTarget > motion.current.exertion ? 4.6 : .18,
      delta,
    );
    motion.current.waveQuality = THREE.MathUtils.damp(motion.current.waveQuality, waveQuality, 5, delta);
    motion.current.facePosition = THREE.MathUtils.damp(
      motion.current.facePosition,
      phase.current === "riding" ? rideFacePosition.current : 0,
      phase.current === "riding" ? 7 : 5,
      delta,
    );
    motion.current.linePosition = THREE.MathUtils.damp(motion.current.linePosition, linePosition, 6.5, delta);
    motion.current.lineControl = THREE.MathUtils.damp(motion.current.lineControl, lineControl, 6.5, delta);
    motion.current.lineSide = rideLineSide.current;
    motion.current.sectionPressure = THREE.MathUtils.damp(motion.current.sectionPressure, sectionPressure, 6, delta);
    motion.current.setEnergy = setState.energy;
    motion.current.maneuver = Math.max(0, motion.current.maneuver - delta * 1.72);
    motion.current.trickCharge = THREE.MathUtils.damp(motion.current.trickCharge, trickCharge.current, trickCharge.current > motion.current.trickCharge ? 12 : 8, delta);
    motion.current.maneuverProgress = activeManeuver.current ? maneuverProgress : THREE.MathUtils.damp(motion.current.maneuverProgress, 0, 9, delta);
    motion.current.landingCue = THREE.MathUtils.damp(motion.current.landingCue, activeManeuver.current ? 1 : 0, activeManeuver.current ? 13 : 8, delta);
    motion.current.landingTarget = THREE.MathUtils.damp(motion.current.landingTarget, landingTarget, 10, delta);
    motion.current.landingWindow = THREE.MathUtils.damp(motion.current.landingWindow, landingWindow, 9, delta);
    if (!activeManeuver.current) {
      motion.current.maneuverLift = THREE.MathUtils.damp(motion.current.maneuverLift, 0, 11, delta);
      motion.current.maneuverSpin = THREE.MathUtils.damp(motion.current.maneuverSpin, 0, 12, delta);
    }
    motion.current.stance = stance.current;
    motion.current.barrel = THREE.MathUtils.damp(motion.current.barrel, barrelIntensity, 6, delta);
    motion.current.rail = THREE.MathUtils.damp(motion.current.rail, railLoad, 8, delta);
    motion.current.compression = THREE.MathUtils.damp(motion.current.compression, compression, 7, delta);
    motion.current.slip = THREE.MathUtils.damp(motion.current.slip, railSlip.current, 8, delta);
    motion.current.impact = Math.max(0, motion.current.impact - delta * 1.9);
    motion.current.takeoff = Math.max(0, motion.current.takeoff - delta * 1.55);
    const finishTarget = phase.current === "riding" && finishAt.current >= 0 ? 1 : 0;
    motion.current.finish = THREE.MathUtils.damp(
      motion.current.finish,
      finishTarget,
      finishTarget > motion.current.finish ? 5.8 : 3.6,
      delta,
    );
    motion.current.takeoffRead = THREE.MathUtils.damp(motion.current.takeoffRead, takeoffQuality, 8, delta);
    motion.current.catchReady = THREE.MathUtils.damp(motion.current.catchReady, catchReady ? 1 : 0, catchReady ? 12 : 5, delta);
    motion.current.takeoffCommit = THREE.MathUtils.damp(
      motion.current.takeoffCommit,
      takeoffCommitProgress,
      takeoffCommitProgress > motion.current.takeoffCommit ? 11 : 7,
      delta,
    );
    motion.current.shorebreak = THREE.MathUtils.damp(motion.current.shorebreak, shorebreakIntensity, shorebreakIntensity > motion.current.shorebreak ? 9 : 5, delta);
    motion.current.shorebreakPower = THREE.MathUtils.damp(motion.current.shorebreakPower, shorebreakPower, 5, delta);
    motion.current.shorebreakSeconds = shorebreakSeconds;
    const diveProgress = THREE.MathUtils.clamp(1 - (duckDiveUntil.current - t) / 1.12, 0, 1);
    const diveEnvelope = t < duckDiveUntil.current ? Math.sin(diveProgress * Math.PI) : 0;
    motion.current.duckDive = THREE.MathUtils.damp(motion.current.duckDive, diveEnvelope, diveEnvelope > motion.current.duckDive ? 14 : 9, delta);
    const wipeoutSubmersion = phase.current === "wipeout"
      ? THREE.MathUtils.smootherstep(motion.current.wipeoutProgress, .01, .14)
        * (1 - THREE.MathUtils.smoothstep(motion.current.wipeoutProgress, .67, 1))
        * THREE.MathUtils.clamp(
          .66
            + motion.current.wipeoutPower * .3
            + Math.sin(t * (5.2 + motion.current.wipeoutPower * 2.4)) * motion.current.wipeoutPower * .045,
          .58,
          1,
        )
      : 0;
    const submersionTarget = Math.max(motion.current.duckDive * .94, wipeoutSubmersion);
    motion.current.submersion = THREE.MathUtils.damp(
      motion.current.submersion,
      submersionTarget,
      submersionTarget > motion.current.submersion ? 14 : 6.5,
      delta,
    );
    motion.current.paddleHeading = paddleHeading.current;
    motion.current.breath = breath.current;
    if (!playback.active && currentPhase === "riding") {
      if (!replayRecording.current) {
        replayRecording.current = true;
        replayFrames.current = [];
        lastReplaySampleAt.current = -1;
        replayReadyCallback.current(false);
      }
      if (lastReplaySampleAt.current < 0 || t - lastReplaySampleAt.current >= 1 / 24) {
        lastReplaySampleAt.current = t;
        if (replayFrames.current.length < 720) {
          replayFrames.current.push({
            at: t,
            x: position.current.x,
            z: position.current.z,
            heading: rideHeading.current,
            lineSide: rideLineSide.current,
            crestOffset: waveCrestOffset.current,
            maneuverName: maneuver.current,
            motion: { ...motion.current },
          });
        }
      }
    } else if (!playback.active && replayRecording.current) {
      replayRecording.current = false;
      const frames = replayFrames.current;
      const duration = frames.length > 1 ? frames[frames.length - 1].at - frames[0].at : 0;
      replayReadyCallback.current(frames.length >= 12 && duration >= .6);
    }
    if (replayMotion) {
      motion.current = replayMotion;
      stance.current = replayMotion.stance;
      worldFocus.current.copy(position.current);
    }
    const vanDriving = phase.current === "driving";
    if (!vanDriving) {
      vanSteer.current = THREE.MathUtils.damp(vanSteer.current, 0, 8, delta);
      vanThrottle.current = THREE.MathUtils.damp(vanThrottle.current, 0, 8, delta);
      vanYawVelocity.current = THREE.MathUtils.damp(vanYawVelocity.current, 0, 7, delta);
      vanLongitudinalG.current = THREE.MathUtils.damp(vanLongitudinalG.current, 0, 7, delta);
      vanLateralG.current = THREE.MathUtils.damp(vanLateralG.current, 0, 7, delta);
      vanSlip.current = THREE.MathUtils.damp(vanSlip.current, 0, 7, delta);
      vanTraction.current = THREE.MathUtils.damp(vanTraction.current, 1, 5, delta);
      vanPreviousSpeed.current = vanSpeed.current;
    }
    const vanWetness = weatherWetness(weatherCode);
    const vanOffRoad = THREE.MathUtils.smoothstep(Math.abs(vanPosition.current.z - 78), 3.9, 6.1);
    const suspensionPrimary = Math.sin(t * (3.6 + Math.abs(vanSpeed.current) * .52) + vanPosition.current.x * .18);
    const suspensionChatter = Math.sin(t * (8.8 + Math.abs(vanSpeed.current) * .81) + vanPosition.current.z * .43) * .34;
    van.current.position.copy(vanPosition.current);
    van.current.rotation.y = vanHeading.current;
    vanMotion.current.speed = vanSpeed.current;
    vanMotion.current.steer = vanSteer.current;
    vanMotion.current.throttle = vanThrottle.current;
    vanMotion.current.driving = vanDriving;
    vanMotion.current.brake = vanDriving && ((state.back && vanSpeed.current > .3) || (state.forward && vanSpeed.current < -.3));
    vanMotion.current.wetness = vanWetness;
    vanMotion.current.offRoad = vanOffRoad;
    vanMotion.current.traction = vanTraction.current;
    vanMotion.current.slip = vanSlip.current;
    vanMotion.current.longitudinalG = vanLongitudinalG.current;
    vanMotion.current.lateralG = vanLateralG.current;
    vanMotion.current.suspension = (suspensionPrimary + suspensionChatter) * (vanDriving ? 1 : .15);

    const riding = phase.current === "riding";
    const paddling = phase.current === "paddling";
    const driving = phase.current === "driving";
    const submersion = motion.current.submersion;
    if (driving) {
      const forwardX = -Math.sin(vanHeading.current);
      const forwardZ = -Math.cos(vanHeading.current);
      const rightX = Math.cos(vanHeading.current);
      const rightZ = -Math.sin(vanHeading.current);
      if (cameraMode === "pov") {
        cameraPosition.current.set(
          vanPosition.current.x + forwardX * 2.18 + rightX * .18,
          2.42,
          vanPosition.current.z + forwardZ * 2.18 + rightZ * .18,
        );
        cameraTarget.current.set(
          vanPosition.current.x + forwardX * 12,
          2.15,
          vanPosition.current.z + forwardZ * 12,
        );
      } else if (cameraMode === "immersive") {
        cameraPosition.current.set(
          vanPosition.current.x + forwardX * 1.5 + rightX * .34,
          2.36,
          vanPosition.current.z + forwardZ * 1.5 + rightZ * .34,
        );
        cameraTarget.current.set(
          vanPosition.current.x + forwardX * 10,
          1.62,
          vanPosition.current.z + forwardZ * 10,
        );
      } else if (cameraMode === "cinematic") {
        cameraPosition.current.set(
          vanPosition.current.x - forwardX * 6.4 + rightX * 7.2,
          4.25,
          vanPosition.current.z - forwardZ * 6.4 + rightZ * 7.2,
        );
        cameraTarget.current.set(
          vanPosition.current.x + forwardX * 4.4,
          1.48,
          vanPosition.current.z + forwardZ * 4.4,
        );
      } else {
        cameraPosition.current.set(
          vanPosition.current.x - forwardX * 10.5,
          6.4,
          vanPosition.current.z - forwardZ * 10.5,
        );
        cameraTarget.current.set(
          vanPosition.current.x + forwardX * 6.2,
          1.55,
          vanPosition.current.z + forwardZ * 6.2,
        );
      }
    } else if (paddling) {
      const forwardX = Math.sin(paddleHeading.current);
      const forwardZ = Math.cos(paddleHeading.current);
      const rightX = Math.cos(paddleHeading.current);
      const rightZ = -Math.sin(paddleHeading.current);
      const wallBeat = motion.current.shorebreak;
      if (cameraMode === "pov") {
        cameraPosition.current.set(
          position.current.x + forwardX * .72 + rightX * .08,
          playerY + 1.12 - submersion * 1.72 + wallBeat * .045,
          position.current.z + forwardZ * .72 + rightZ * .08,
        );
        cameraTarget.current.set(
          position.current.x + forwardX * 8,
          playerY + .64 - submersion * 1.18,
          position.current.z + forwardZ * 8,
        );
      } else if (cameraMode === "immersive") {
        cameraPosition.current.set(
          position.current.x - forwardX * 4.6 + rightX * .68,
          playerY + 2.2 - submersion * 3.35 + wallBeat * .16,
          position.current.z - forwardZ * 4.6 + rightZ * .68,
        );
        cameraTarget.current.set(
          position.current.x + forwardX * 3.8,
          playerY + .42 - submersion * .86,
          position.current.z + forwardZ * 3.8,
        );
      } else if (cameraMode === "cinematic") {
        cameraPosition.current.set(
          position.current.x - forwardX * 3.1 + rightX * 6,
          playerY + 3.6 - submersion * 5 + wallBeat * .22,
          position.current.z - forwardZ * 3.1 + rightZ * 6,
        );
        cameraTarget.current.set(
          position.current.x + forwardX * 2.2,
          playerY + .52 - submersion * .92,
          position.current.z + forwardZ * 2.2,
        );
      } else {
        cameraPosition.current.set(
          position.current.x - forwardX * 9.5,
          playerY + 4.9 - submersion * 6.5 + wallBeat * .2,
          position.current.z - forwardZ * 9.5,
        );
        cameraTarget.current.set(
          position.current.x + forwardX * 3,
          playerY + .9 - submersion * 1.34,
          position.current.z + forwardZ * 3,
        );
      }
    } else {
      const barrelCamera = riding ? motion.current.barrel : 0;
      const takeoffBeat = riding ? motion.current.takeoff : 0;
      const maneuverBeat = riding ? motion.current.maneuver : 0;
      const maneuverAir = riding ? motion.current.maneuverLift : 0;
      const finishBeat = riding ? motion.current.finish : 0;
      const directorSide = motion.current.maneuverSide || (character.peel < 0 ? -1 : 1);
      const speedLead = riding ? THREE.MathUtils.smoothstep(speed, 9.5, 17.5) : 0;
      const rideForwardX = Math.sin(rideHeading.current);
      const rideForwardZ = Math.cos(rideHeading.current);
      const rideRightX = Math.cos(rideHeading.current);
      const rideRightZ = -Math.sin(rideHeading.current);
      const wipeout = phase.current === "wipeout";
      const wipeoutTurbulence = .72 + motion.current.wipeoutPower * .56;
      const underwaterDriftX = Math.sin(t * (4.4 + motion.current.wipeoutPower * 1.2)) * submersion * wipeoutTurbulence;
      const underwaterDriftZ = Math.cos(t * (3.7 + motion.current.wipeoutPower) + .8) * submersion * wipeoutTurbulence;
      if (cameraMode === "pov") {
        if (riding) {
          const eyeForward = .34 + takeoffBeat * .16 - barrelCamera * .08;
          const eyeSide = steer * -.045 + directorSide * maneuverBeat * .035;
          cameraPosition.current.set(
            position.current.x + rideForwardX * eyeForward + rideRightX * eyeSide,
            playerY + 1.46 - motion.current.compression * .16 - takeoffBeat * .12 + maneuverAir * .48,
            position.current.z + rideForwardZ * eyeForward + rideRightZ * eyeSide,
          );
          cameraTarget.current.set(
            position.current.x + rideForwardX * 10,
            playerY + .92 + maneuverAir * .58,
            position.current.z + rideForwardZ * 10,
          );
        } else if (wipeout) {
          cameraPosition.current.set(
            position.current.x + underwaterDriftX * .22,
            waterY + THREE.MathUtils.lerp(.92, -.54, submersion),
            position.current.z + underwaterDriftZ * .18,
          );
          cameraTarget.current.set(
            position.current.x + rideForwardX * 5,
            waterY + THREE.MathUtils.lerp(.42, -.4, submersion),
            position.current.z + rideForwardZ * 5,
          );
        } else {
          const walkForwardX = Math.sin(playerHeading.current);
          const walkForwardZ = Math.cos(playerHeading.current);
          cameraPosition.current.set(
            position.current.x + walkForwardX * .26,
            playerY + 1.64,
            position.current.z + walkForwardZ * .26,
          );
          cameraTarget.current.set(
            position.current.x + walkForwardX * 8,
            playerY + 1.56,
            position.current.z + walkForwardZ * 8,
          );
        }
      } else if (cameraMode === "immersive") {
        if (riding) {
          const cameraBack = 4.15 - barrelCamera * .82 - takeoffBeat * 1.12 + maneuverBeat * .42 + finishBeat * .75;
          const cameraSide = steer * -1.1 - barrelCamera * .8 + directorSide * maneuverBeat * .28;
          const targetLead = 4.65 + speedLead * 1.45 + finishBeat * 2.1;
          const targetSide = steer * .28 + directorSide * maneuverBeat * .16;
          cameraPosition.current.set(
            position.current.x - rideForwardX * cameraBack + rideRightX * cameraSide,
            playerY + 1.82 - barrelCamera * .26 - takeoffBeat * .28 + maneuverBeat * .2 + maneuverAir * .48 + finishBeat * .28,
            position.current.z - rideForwardZ * cameraBack + rideRightZ * cameraSide,
          );
          cameraTarget.current.set(
            position.current.x + rideForwardX * targetLead + rideRightX * targetSide,
            playerY + .72 + maneuverAir * .68,
            position.current.z + rideForwardZ * targetLead + rideRightZ * targetSide,
          );
        } else if (wipeout) {
          cameraPosition.current.set(
            position.current.x + .68 + underwaterDriftX * .72,
            waterY + THREE.MathUtils.lerp(2.05, -.72, submersion),
            position.current.z + THREE.MathUtils.lerp(5.2, 3.5, submersion) + underwaterDriftZ * .42,
          );
          cameraTarget.current.set(
            position.current.x + underwaterDriftX * .3,
            waterY + THREE.MathUtils.lerp(.5, -.38, submersion),
            position.current.z - THREE.MathUtils.lerp(2.4, .8, submersion),
          );
        } else {
          cameraPosition.current.set(position.current.x + .68, playerY + 3.05, position.current.z + 5.8);
          cameraTarget.current.set(position.current.x, playerY + 1.18, position.current.z - 3.2);
        }
      } else if (cameraMode === "cinematic") {
        if (riding) {
          const cameraBack = 1.6 + takeoffBeat * 2.9 - maneuverBeat * .62 + finishBeat * 3.2;
          const cameraSide = directorSide * (7.2 - maneuverBeat * 2.8 - takeoffBeat * 1.45);
          const targetLead = 2.6 + speedLead * 1.8 + finishBeat * 3.4;
          const targetSide = -directorSide * (.5 + maneuverBeat * .58);
          cameraPosition.current.set(
            position.current.x - rideForwardX * cameraBack + rideRightX * cameraSide,
            playerY + 2.45 - takeoffBeat * .48 + maneuverBeat * .68 + maneuverAir * .74 + finishBeat * 1.08,
            position.current.z - rideForwardZ * cameraBack + rideRightZ * cameraSide,
          );
          cameraTarget.current.set(
            position.current.x + rideForwardX * targetLead + rideRightX * targetSide,
            playerY + .82 + maneuverAir * .7,
            position.current.z + rideForwardZ * targetLead + rideRightZ * targetSide,
          );
        } else if (wipeout) {
          cameraPosition.current.set(
            position.current.x + directorSide * THREE.MathUtils.lerp(6.2, 4.1, submersion) + underwaterDriftX * .5,
            waterY + THREE.MathUtils.lerp(2.7, -.74, submersion),
            position.current.z + THREE.MathUtils.lerp(5.3, 3.1, submersion) + underwaterDriftZ * .35,
          );
          cameraTarget.current.set(
            position.current.x - directorSide * .12,
            waterY + THREE.MathUtils.lerp(.48, -.42, submersion),
            position.current.z - .6,
          );
        } else {
          cameraPosition.current.set(position.current.x + directorSide * 5.8, playerY + 3.1, position.current.z + 4.5);
          cameraTarget.current.set(position.current.x - directorSide * .16, playerY + 1.02, position.current.z - 1.8);
        }
      } else {
        if (riding) {
          const cameraBack = 8.4 - barrelCamera * 1.45 - takeoffBeat * 2.15 + maneuverBeat * .72 + finishBeat * 1.9;
          const cameraSide = steer * -1.7 - barrelCamera * 1.1 + directorSide * maneuverBeat * .7;
          const targetLead = 5.4 + speedLead * 1.9 + finishBeat * 3.7;
          const targetSide = directorSide * maneuverBeat * .18;
          cameraPosition.current.set(
            position.current.x - rideForwardX * cameraBack + rideRightX * cameraSide,
            playerY + 3.2 - barrelCamera * .72 - takeoffBeat * .38 + maneuverBeat * .38 + maneuverAir * .58 + finishBeat * .66,
            position.current.z - rideForwardZ * cameraBack + rideRightZ * cameraSide,
          );
          cameraTarget.current.set(
            position.current.x + rideForwardX * targetLead + rideRightX * targetSide,
            playerY + .9 - barrelCamera * .2 + maneuverAir * .72,
            position.current.z + rideForwardZ * targetLead + rideRightZ * targetSide,
          );
        } else if (wipeout) {
          cameraPosition.current.set(
            position.current.x + underwaterDriftX * .58,
            waterY + THREE.MathUtils.lerp(4.45, -.82, submersion),
            position.current.z + THREE.MathUtils.lerp(9.4, 5.2, submersion) + underwaterDriftZ * .42,
          );
          cameraTarget.current.set(
            position.current.x + underwaterDriftX * .22,
            waterY + THREE.MathUtils.lerp(.58, -.4, submersion),
            position.current.z - THREE.MathUtils.lerp(2.7, .9, submersion),
          );
        } else {
          cameraPosition.current.set(position.current.x, playerY + 4.9, position.current.z + 10.5);
          cameraTarget.current.set(position.current.x, playerY + .9, position.current.z - 3);
        }
      }
    }
    if (currentPhase === "shore" && sessionIntroProgress < 1) {
      const revealSide = character.peel < 0 ? 1 : -1;
      const normalCameraX = cameraPosition.current.x;
      const normalCameraY = cameraPosition.current.y;
      const normalCameraZ = cameraPosition.current.z;
      const normalTargetX = cameraTarget.current.x;
      const normalTargetY = cameraTarget.current.y;
      const normalTargetZ = cameraTarget.current.z;
      cameraPosition.current.set(
        THREE.MathUtils.lerp(position.current.x + revealSide * 23, normalCameraX, sessionIntroProgress),
        THREE.MathUtils.lerp(14.8, normalCameraY, sessionIntroProgress),
        THREE.MathUtils.lerp(position.current.z + 25, normalCameraZ, sessionIntroProgress),
      );
      cameraTarget.current.set(
        THREE.MathUtils.lerp(position.current.x + revealSide * 5.5, normalTargetX, sessionIntroProgress),
        THREE.MathUtils.lerp(.48, normalTargetY, sessionIntroProgress),
        THREE.MathUtils.lerp(-20, normalTargetZ, sessionIntroProgress),
      );
    }
    const cameraSubject = driving ? vanPosition.current : position.current;
    const cameraMotionStrength = reducedMotion ? 0 : mobileRenderer ? .72 : 1;
    let cameraLongitudinalAcceleration = 0;
    let cameraLateralAcceleration = 0;
    let cameraTrackedSpeed = 0;
    const subjectStep = Math.min(delta, .12);
    const subjectTravel = cameraSubject.distanceTo(cameraSubjectPrevious.current);
    const subjectChanged = cameraTrackingDriving.current !== driving;
    if (!cameraMotionInitialized.current || subjectChanged || delta > .12 || subjectTravel > 12) {
      cameraMotionInitialized.current = true;
      cameraTrackingDriving.current = driving;
      cameraSubjectPrevious.current.copy(cameraSubject);
      cameraSubjectVelocity.current.set(0, 0, 0);
      cameraSubjectVelocityPrevious.current.set(0, 0, 0);
      cameraAcceleration.current.set(0, 0, 0);
      cameraSpringOffset.current.set(0, 0, 0);
      cameraSpringVelocity.current.set(0, 0, 0);
    } else if (subjectStep > .0001) {
      cameraRawVelocity.current.copy(cameraSubject).sub(cameraSubjectPrevious.current).divideScalar(subjectStep);
      cameraSubjectVelocityPrevious.current.copy(cameraSubjectVelocity.current);
      cameraSubjectVelocity.current.lerp(
        cameraRawVelocity.current,
        1 - Math.exp(-subjectStep * (driving ? 7.2 : riding ? 9.5 : 7.8)),
      );
      cameraRawAcceleration.current
        .copy(cameraSubjectVelocity.current)
        .sub(cameraSubjectVelocityPrevious.current)
        .divideScalar(subjectStep);
      cameraAcceleration.current.lerp(
        cameraRawAcceleration.current,
        1 - Math.exp(-subjectStep * (driving ? 4.6 : riding ? 6.2 : 5.2)),
      );
      cameraSubjectPrevious.current.copy(cameraSubject);
    }
    cameraTrackedSpeed = Math.hypot(cameraSubjectVelocity.current.x, cameraSubjectVelocity.current.z);
    const subjectHeading = driving
      ? vanHeading.current + Math.PI
      : riding || phase.current === "wipeout"
        ? rideHeading.current
        : paddling
          ? paddleHeading.current
          : playerHeading.current;
    const subjectForwardX = Math.sin(subjectHeading);
    const subjectForwardZ = Math.cos(subjectHeading);
    const subjectRightX = Math.cos(subjectHeading);
    const subjectRightZ = -Math.sin(subjectHeading);
    cameraLongitudinalAcceleration = THREE.MathUtils.clamp(
      cameraAcceleration.current.x * subjectForwardX + cameraAcceleration.current.z * subjectForwardZ,
      -18,
      18,
    );
    cameraLateralAcceleration = THREE.MathUtils.clamp(
      cameraAcceleration.current.x * subjectRightX + cameraAcceleration.current.z * subjectRightZ,
      -18,
      18,
    );
    if (cameraMotionStrength > 0) {
      const velocityLookAhead = driving ? .095 : riding ? .075 : paddling ? .045 : .035;
      const accelerationLag = driving ? .032 : riding ? .026 : .016;
      cameraTarget.current.x += (
        cameraSubjectVelocity.current.x * velocityLookAhead
        + subjectRightX * cameraLateralAcceleration * .018
      ) * cameraMotionStrength;
      cameraTarget.current.z += (
        cameraSubjectVelocity.current.z * velocityLookAhead
        + subjectRightZ * cameraLateralAcceleration * .018
      ) * cameraMotionStrength;
      cameraPosition.current.x -= (
        subjectForwardX * cameraLongitudinalAcceleration * accelerationLag
        + subjectRightX * cameraLateralAcceleration * accelerationLag * 1.22
      ) * cameraMotionStrength;
      cameraPosition.current.z -= (
        subjectForwardZ * cameraLongitudinalAcceleration * accelerationLag
        + subjectRightZ * cameraLateralAcceleration * accelerationLag * 1.22
      ) * cameraMotionStrength;
      cameraPosition.current.y += (
        Math.abs(cameraLateralAcceleration) * .0055
        + Math.max(0, -cameraLongitudinalAcceleration) * .0065
      ) * cameraMotionStrength;
    }
    const impactRise = Math.max(0, motion.current.impact - previousCameraImpact.current);
    previousCameraImpact.current = motion.current.impact;
    if (impactRise > .025 && cameraMotionStrength > 0) {
      const impactDirection = motion.current.maneuverSide || Math.sign(motion.current.rail) || 1;
      cameraSpringVelocity.current.x += subjectRightX * impactDirection * impactRise * .52;
      cameraSpringVelocity.current.y += impactRise * (riding ? 1.05 : paddling ? .72 : .46);
      cameraSpringVelocity.current.z += subjectRightZ * impactDirection * impactRise * .52;
    }
    if (cameraMotionStrength > 0) {
      const springStep = Math.min(delta, 1 / 30);
      cameraSpringVelocity.current.addScaledVector(cameraSpringOffset.current, -48 * springStep);
      cameraSpringVelocity.current.multiplyScalar(Math.exp(-10.5 * springStep));
      cameraSpringOffset.current.addScaledVector(cameraSpringVelocity.current, springStep);
      cameraPosition.current.addScaledVector(cameraSpringOffset.current, cameraMotionStrength);
      cameraTarget.current.addScaledVector(cameraSpringOffset.current, cameraMotionStrength * .18);
    } else {
      cameraSpringOffset.current.set(0, 0, 0);
      cameraSpringVelocity.current.set(0, 0, 0);
    }
    if (cameraMode === "pov" && sessionIntroProgress >= 1) {
      const viewYaw = subjectHeading + state.lookYaw;
      const viewPitch = state.lookPitch;
      const horizontal = Math.cos(viewPitch);
      cameraTarget.current.set(
        cameraPosition.current.x + Math.sin(viewYaw) * horizontal * 12,
        cameraPosition.current.y + Math.sin(viewPitch) * 12,
        cameraPosition.current.z + Math.cos(viewYaw) * horizontal * 12,
      );
    } else {
      cameraOffset.current.copy(cameraPosition.current).sub(cameraTarget.current);
      cameraOrbit.current.setFromVector3(cameraOffset.current);
      // lookYaw is an unrestricted angle. Keeping it independent of camera mode
      // gives every phase a true 360-degree freelook instead of a narrow offset.
      cameraOrbit.current.theta += state.lookYaw * THREE.MathUtils.lerp(.24, 1, sessionIntroProgress);
      const maximumOrbitPhi = submersion < .08
        ? Math.PI * .5 - THREE.MathUtils.lerp(
          .035,
          .095,
          Math.max(motion.current.shorebreak, riding ? motion.current.setEnergy : 0),
        )
        : Math.PI - .18;
      cameraOrbit.current.phi = THREE.MathUtils.clamp(
        cameraOrbit.current.phi + state.lookPitch * .82 * THREE.MathUtils.lerp(.24, 1, sessionIntroProgress),
        .18,
        maximumOrbitPhi,
      );
      cameraOffset.current.setFromSpherical(cameraOrbit.current);
      cameraPosition.current.copy(cameraTarget.current).add(cameraOffset.current);
    }
    const cameraVibrationBase = riding
      ? motion.current.maneuver * .052 + motion.current.slip * .038 + motion.current.barrel * .024 + Math.max(0, cameraTrackedSpeed - 11) * .0017
      : paddling ? motion.current.shorebreak * .018
      : phase.current === "wipeout"
        ? (1 - THREE.MathUtils.smootherstep(motion.current.wipeoutProgress, .12, .92))
          * (.052 + motion.current.wipeoutPower * .08)
        : 0;
    const cameraVibration = cameraVibrationBase
      * (cameraMode === "cinematic" ? .28 : cameraMode === "pov" ? .9 : cameraMode === "immersive" ? 1.04 : .78)
      * cameraMotionStrength;
    const lateralVibration = (
      Math.sin(t * 23.7)
      + Math.sin(t * 41.3 + 1.8) * .34
    ) * cameraVibration;
    const verticalVibration = (
      Math.cos(t * 29.2 + .6)
      + Math.sin(t * 47.1) * .28
    ) * cameraVibration * .46;
    cameraPosition.current.x += subjectRightX * lateralVibration;
    cameraPosition.current.z += subjectRightZ * lateralVibration;
    cameraPosition.current.y += verticalVibration;
    if (submersion < .08) {
      const cameraCoastalZ = cameraPosition.current.z - tideShift;
      const waterClearance = cameraMode === "pov"
        ? .36
        : riding ? .62
        : paddling ? .56
        : .48;
      const cameraFloor = cameraCoastalZ < SHORELINE_REFERENCE_Z + 4.75
        ? cameraWaterEnvelopeAt(
          cameraPosition.current.x,
          cameraPosition.current.z,
          t,
          settings,
          character,
        ) + waterClearance + Math.min(.16, settings.waveHeight * .04)
        : .18;
      const cameraLift = Math.max(0, cameraFloor - cameraPosition.current.y);
      cameraPosition.current.y += cameraLift;
      cameraTarget.current.y += cameraLift * .72;
    } else {
      const bedKind = seabedKind(character);
      const cameraFloor = -seabedDepthAt(cameraPosition.current.x, cameraPosition.current.z, bedKind) + .18;
      const targetFloor = -seabedDepthAt(cameraTarget.current.x, cameraTarget.current.z, bedKind) + .1;
      cameraPosition.current.y = Math.max(cameraPosition.current.y, cameraFloor);
      cameraTarget.current.y = Math.max(cameraTarget.current.y, targetFloor);
    }
    const cameraResponse = sessionIntroProgress < 1
      ? 5.4
      : submersion > .03
        ? 10 + submersion * 5
      : cameraMode === "cinematic"
      ? 2.15 + motion.current.maneuver * 1.9 + motion.current.takeoff * .8
      : cameraMode === "pov"
        ? 11.2 + motion.current.maneuver * 1.8 + motion.current.takeoff * 1.2
      : cameraMode === "immersive"
        ? 4.35 + motion.current.maneuver * 1.35
        : driving ? 3.8 : riding ? 3.1 + motion.current.maneuver * 1.2 : 2.4;
    if (sessionIntroProgress < .035) {
      camera.position.copy(cameraPosition.current);
      cameraLookTarget.current.copy(cameraTarget.current);
    } else {
      camera.position.lerp(cameraPosition.current, 1 - Math.exp(-delta * cameraResponse));
      cameraLookTarget.current.lerp(cameraTarget.current, 1 - Math.exp(-delta * (
        sessionIntroProgress < 1
          ? 5
          : submersion > .03
            ? 12
            : cameraMode === "pov"
              ? 14
              : cameraMode === "cinematic"
                ? 2.45
                : 4.8
      )));
    }
    if (submersion < .08) {
      const cameraCoastalZ = camera.position.z - tideShift;
      const waterClearance = cameraMode === "pov"
        ? .34
        : riding ? .58
        : paddling ? .52
        : .44;
      const cameraFloor = cameraCoastalZ < SHORELINE_REFERENCE_Z + 4.75
        ? cameraWaterEnvelopeAt(
          camera.position.x,
          camera.position.z,
          t,
          settings,
          character,
        ) + waterClearance + Math.min(.14, settings.waveHeight * .035)
        : .16;
      const cameraLift = Math.max(0, cameraFloor - camera.position.y);
      camera.position.set(camera.position.x, camera.position.y + cameraLift, camera.position.z);
      cameraLookTarget.current.y += cameraLift * .72;
    } else {
      const bedKind = seabedKind(character);
      const cameraFloor = -seabedDepthAt(camera.position.x, camera.position.z, bedKind) + .16;
      const targetFloor = -seabedDepthAt(cameraLookTarget.current.x, cameraLookTarget.current.z, bedKind) + .08;
      camera.position.set(
        camera.position.x,
        Math.max(camera.position.y, cameraFloor),
        camera.position.z,
      );
      cameraLookTarget.current.set(
        cameraLookTarget.current.x,
        Math.max(cameraLookTarget.current.y, targetFloor),
        cameraLookTarget.current.z,
      );
    }
    camera.lookAt(cameraLookTarget.current);
    const rollScale = cameraMode === "cinematic" ? .48 : cameraMode === "pov" ? .7 : cameraMode === "immersive" ? 1.16 : 1;
    const cameraBankTarget = (riding
      ? -motion.current.rail * .022 - motion.current.maneuverSide * motion.current.maneuver * .025 - Math.sign(motion.current.rail) * motion.current.slip * .012
      : driving
        ? -vanMotion.current.lateralG * .034 - Math.sign(vanMotion.current.steer || 1) * vanMotion.current.slip * .012
        : phase.current === "wipeout"
          ? Math.sin(t * 3.2) * submersion * .052
          : paddling ? Math.sin(t * 2.6) * submersion * .014 : 0)
      - cameraLateralAcceleration * (driving ? .0016 : riding ? .0022 : .0007);
    cameraBank.current = THREE.MathUtils.damp(
      cameraBank.current,
      cameraBankTarget * rollScale * cameraMotionStrength,
      riding ? 6.8 : driving ? 5.6 : 7.5,
      delta,
    );
    camera.rotateZ(cameraBank.current);
    if (camera instanceof THREE.PerspectiveCamera) {
      const gameplayFov = cameraMode === "cinematic"
        ? riding ? 52 + motion.current.maneuver * 3.2 + motion.current.takeoff * 1.8 - motion.current.finish * 3.4 : driving ? 54 : phase.current === "wipeout" ? 53 - submersion * 4 : 51
        : cameraMode === "pov"
          ? driving
            ? 72 + Math.min(6, Math.abs(vanSpeed.current) * .24)
            : riding
              ? 70 + Math.min(8, Math.max(0, speed - 7) * .64) + motion.current.maneuver * 2.4 + motion.current.takeoff * 1.2 - motion.current.finish * 1.8
              : paddling ? 66 + motion.current.shorebreak * 2.4 - submersion * 4 : phase.current === "wipeout" ? 68 - submersion * 4.5 : 68
        : cameraMode === "immersive"
          ? driving
            ? 70 + Math.min(7, Math.abs(vanSpeed.current) * .28)
            : riding
              ? 68 + Math.min(10, Math.max(0, speed - 7) * .82) + motion.current.maneuver * 3.4 + motion.current.takeoff * 1.4 - motion.current.finish * 2.8
              : paddling ? 62 + motion.current.shorebreak * 3.2 - submersion * 4.2 : phase.current === "wipeout" ? 66 - submersion * 5 : 64
          : driving
            ? 59 + Math.min(5, Math.abs(vanSpeed.current) * .2)
            : riding
              ? 58 + Math.min(8, Math.max(0, speed - 7) * .72) + motion.current.maneuver * 3.1 + motion.current.takeoff * 1.2 - motion.current.finish * 2.5
              : paddling ? 56 + motion.current.shorebreak * 2.5 - submersion * 3.8 : phase.current === "wipeout" ? 59 - submersion * 4.5 : 58;
      const accelerationFov = cameraMotionStrength * (
        Math.max(0, cameraLongitudinalAcceleration) * (driving ? .07 : .11)
        + Math.abs(cameraLateralAcceleration) * (riding ? .035 : .018)
        + impactRise * (riding ? 1.8 : .9)
      );
      const opticalFov = THREE.MathUtils.radToDeg(
        2 * Math.atan(camera.getFilmHeight() / Math.max(1, photoFocalLength * 2)),
      );
      const targetFov = photoMode
        ? opticalFov
        : THREE.MathUtils.lerp(67, gameplayFov + accelerationFov, sessionIntroProgress);
      const nextFov = THREE.MathUtils.damp(camera.fov, targetFov, 4.5, delta);
      if (Math.abs(camera.fov - nextFov) > 0.005) {
        const focalLength = 0.5 * camera.getFilmHeight() / Math.tan(THREE.MathUtils.degToRad(nextFov * 0.5));
        camera.setFocalLength(focalLength);
      }
    }

    if (active && t - lastStatsAt.current > 0.11) {
      lastStatsAt.current = t;
      camera.getWorldDirection(cameraForward.current);
      cameraForward.current.y = 0;
      if (cameraForward.current.lengthSq() < .001) cameraForward.current.set(0, 0, -1);
      else cameraForward.current.normalize();
      const cameraHeading = Math.atan2(cameraForward.current.x, cameraForward.current.z);
      onStats({
        phase: phase.current,
        sessionIntro: sessionIntroProgress,
        score: Math.round(score.current),
        combo: Number(combo.current.toFixed(1)),
        rideDistance: Number(rideDistance.current.toFixed(1)),
        pocketDistance: Number(pocketDistance.current.toFixed(1)),
        offshoreDistance: Number(Math.max(
          0,
          SHORELINE_REFERENCE_Z - (position.current.z - tideShift),
        ).toFixed(1)),
        coastDistance: Number((phase.current === "driving" ? vanPosition.current.x : position.current.x).toFixed(1)),
        cameraHeading,
        speed: Math.max(0, speed),
        acceleration: motion.current.acceleration,
        lateralForce: motion.current.lateralForce,
        paddleEffort: motion.current.paddleEffort,
        balance: balanceInput,
        balanceTarget,
        waveQuality,
        facePosition: motion.current.facePosition,
        linePosition: motion.current.linePosition,
        lineControl: motion.current.lineControl,
        lineSide: motion.current.lineSide,
        sectionPressure: motion.current.sectionPressure,
        railLoad: motion.current.rail,
        railGrip: 1 - motion.current.slip,
        stance: stance.current,
        barrelTime: Number(barrelTime.current.toFixed(1)),
        barrelIntensity: motion.current.barrel,
        stamina: Math.round(stamina.current),
        setEnergy: setState.energy,
        nextSetSeconds: setState.secondsToPeak,
        setWaveIndex: setState.setWaveIndex,
        setWaveCount: setState.waveCount,
        setActive: setState.setActive,
        maneuver: maneuver.current,
        maneuverScore: maneuverScore.current,
        maneuverQuality: maneuverQuality.current,
        maneuverId: maneuverId.current,
        maneuverCount: maneuverCount.current,
        maneuverActive: activeManeuver.current !== null,
        maneuverProgress,
        maneuverPhase,
        trickCharge: motion.current.trickCharge,
        maneuverAirborne,
        landingTarget,
        landingWindow,
        maxCombo: Number(maxCombo.current.toFixed(1)),
        grade: sessionGrade(score.current, rideDistance.current, maneuverCount.current),
        rideScore: rideScore.current,
        rideManeuvers: Math.max(0, maneuverCount.current - rideManeuverStart.current),
        rideGrade: rideGrade.current,
        rideResult: rideResult.current,
        rideResultId: rideResultId.current,
        rideTakeoffQuality: rideTakeoffQuality.current,
        rideLineQuality: rideAnalysisDuration.current > .001
          ? rideLineIntegral.current / rideAnalysisDuration.current
          : 0,
        rideControlQuality: rideAnalysisDuration.current > .001
          ? rideControlIntegral.current / rideAnalysisDuration.current
          : 0,
        ridePowerQuality: rideAnalysisDuration.current > .001
          ? ridePowerIntegral.current / rideAnalysisDuration.current
          : 0,
        rideMaxSpeed: rideMaxSpeed.current,
        rideMaxCombo: rideMaxCombo.current,
        rideOutProgress,
        vehicleMode: phase.current === "driving",
        vehicleGear: phase.current !== "driving" || (Math.abs(vanSpeed.current) < .35 && Math.abs(vanThrottle.current) < .08)
          ? "P"
          : vanSpeed.current < 0 || (Math.abs(vanSpeed.current) < .35 && vanThrottle.current < 0) ? "R" : "D",
        vehicleThrottle: vanThrottle.current,
        vehicleTraction: vanTraction.current,
        vehicleSlip: vanSlip.current,
        vehicleOffRoad: vanOffRoad,
        nearVan,
        inLineup,
        catchReady,
        shorebreakIntensity: motion.current.shorebreak,
        shorebreakSeconds,
        duckDiveReady,
        duckDiveActive,
        duckDiveQuality: duckDiveQuality.current,
        submersion: motion.current.submersion,
        wipeoutPower: motion.current.wipeoutPower,
        holdDownSeconds: phase.current === "wipeout"
          ? Number(Math.max(0, wipeoutDuration.current - (t - wipeoutAt.current)).toFixed(1))
          : 0,
        breath: Math.round(breath.current),
        leashTension: motion.current.leashTension,
        shorebreakId: shorebreakId.current,
        shorebreakResult: shorebreakResult.current,
        takeoffAlignment,
        takeoffQuality,
        takeoffCommitProgress,
        prompt,
      });
    }
  });

  const light = THREE.MathUtils.clamp(sunHeight * 1.1 + 0.12, 0.08, 1);
  const weather = weatherProfile(weatherCode);
  const weatherCloudFloor = weather.storm ? .88 : weather.kind !== "none" ? .64 : weather.fog ? .8 : 0;
  const cloudFactor = THREE.MathUtils.clamp(Math.max(cloudCover / 100, weatherCloudFloor), 0, 1);
  const directLight = 1 - cloudFactor * .52;
  const daylightStrength = THREE.MathUtils.smoothstep(solarElevation, -.04, .14);
  const moonlightStrength = 1 - THREE.MathUtils.smoothstep(solarElevation, -.02, .16);
  const vanDarkness = THREE.MathUtils.clamp(1 - daylightStrength + (weather.storm ? .38 : weather.fog ? .22 : weather.intensity * .16), 0, 1);
  const coastBiome = getCoastBiome(beach.id);
  const daylightSky: Record<CoastBiome, string> = {
    urban: "#7897a0",
    tropical: "#65a7ae",
    dune: "#829da0",
    rugged: "#7f9398",
    cold: "#657f89",
    volcanic: "#688786",
    desert: "#a29a88",
  };
  const daylightFog: Record<CoastBiome, string> = {
    urban: "#80989d",
    tropical: "#82a9a4",
    dune: "#9a9e91",
    rugged: "#8d918d",
    cold: "#708188",
    volcanic: "#6f8580",
    desert: "#ad9b7e",
  };
  const atmosphereBoost = coastBiome === "desert" ? 2.2 : coastBiome === "urban" ? 0.9 : coastBiome === "cold" ? 1.4 : 0;
  const baseBackgroundColor = sunHeight < 0.08 ? "#07101e" : sunHeight < 0.3 ? "#c66f5d" : daylightSky[coastBiome];
  const baseFogColor = sunHeight < 0.08 ? "#07101e" : daylightFog[coastBiome];
  const overcastColor = sunHeight < 0.08 ? "#071017" : "#53676c";
  const backgroundColor = new THREE.Color(baseBackgroundColor).lerp(new THREE.Color(overcastColor), cloudFactor * .34).getStyle();
  const fogColor = new THREE.Color(baseFogColor).lerp(new THREE.Color(overcastColor), cloudFactor * .42).getStyle();
  const fogNear = weather.fog ? 18 : weather.storm ? 34 : weather.kind !== "none" ? 42 : 55;
  const fogFar = weather.fog ? 112 : weather.storm ? 148 : weather.intensity > .7 ? 172 : weather.kind !== "none" ? 205 : 240;
  const sunLightColor = sunHeight < 0.3 ? "#ff9f72" : "#fff0ca";
  const celestialSunPosition: [number, number, number] = [
    sunDirectionX * 180,
    sunDirectionY * 180,
    sunDirectionZ * 180,
  ];
  const oceanSunPosition: [number, number, number] = [
    sunDirectionX * 44,
    sunDirectionY * 44,
    sunDirectionZ * 44,
  ];

  return (
    <>
      <color ref={backgroundRef} attach="background" args={[backgroundColor]} />
      <fog ref={fogRef} attach="fog" args={[fogColor, fogNear, fogFar]} />
      <UnderwaterAtmosphere
        motion={motion}
        backgroundRef={backgroundRef}
        fogRef={fogRef}
        backgroundColor={backgroundColor}
        fogColor={fogColor}
        fogNear={fogNear}
        fogFar={fogFar}
        light={light}
        mobile={mobileRenderer}
      />
      <Sky
        distance={450000}
        sunPosition={celestialSunPosition}
        inclination={0.49}
        azimuth={0.24}
        turbidity={5.2 + cloudCover * 0.025 + atmosphereBoost}
        rayleigh={sunHeight < 0.2 ? 3.8 : 1.7}
        mieCoefficient={0.008}
        mieDirectionalG={0.85}
      />
      <CoastalAtmosphere
        cloudCover={cloudCover}
        windSpeed={settings.windSpeed}
        windDirection={settings.windDirection}
        coastHeading={settings.coastHeading}
        light={light}
        sunHeight={solarElevation}
        sunPosition={celestialSunPosition}
        hazeColor={fogColor}
      />
      <WeatherEffects weatherCode={weatherCode} windSpeed={settings.windSpeed} windDirection={settings.windDirection} coastHeading={settings.coastHeading} />
      <ambientLight intensity={(0.18 + light * 0.42) * (.94 + cloudFactor * .08)} color={sunHeight < 0.16 ? "#8eb4cf" : "#d8f0ee"} />
      <hemisphereLight args={["#a9d9dc", "#5c4431", (0.38 + light * 0.55) * (.93 + cloudFactor * .09)]} />
      <directionalLight
        ref={sunLight}
        target={sunTarget}
        position={lightingSunPosition}
        intensity={(0.45 + light * 2.2) * directLight * daylightStrength}
        color={sunLightColor}
        castShadow={!mobileRenderer}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={100}
        shadow-camera-left={-35}
        shadow-camera-right={35}
        shadow-camera-top={35}
        shadow-camera-bottom={-35}
      />
      <primitive object={sunTarget} />
      <directionalLight
        position={[-sunDirectionX * 34, 28, -sunDirectionZ * 34]}
        intensity={moonlightStrength * .34 * (1 - cloudFactor * .36)}
        color="#a9d7e8"
      />
      <CoastalEnvironment
        light={light}
        cloudFactor={cloudFactor}
        sunHeight={solarElevation}
        sunPosition={celestialSunPosition}
        sunColor={sunLightColor}
        hazeColor={fogColor}
        mobile={mobileRenderer}
      />
      <UnderwaterWorld
        motion={motion}
        settings={settings}
        character={character}
        sandColor={beach.palette[1]}
        light={light}
        cloudCover={cloudCover}
        mobile={mobileRenderer}
      />
      <Ocean
        settings={settings}
        character={character}
        focusPosition={worldFocus}
        light={light}
        cloudCover={cloudCover}
        sunPosition={oceanSunPosition}
        sunColor={sunLightColor}
        hazeColor={fogColor}
        visibility={fogFar}
        rain={weather.kind === "rain" ? weather.intensity : 0}
      />
      <LineupWaveSetVolume
        motion={motion}
        settings={settings}
        character={character}
        focusPosition={worldFocus}
        light={light}
        cloudCover={cloudCover}
      />
      <BeachLife
        beach={beach}
        zoneName={zoneName}
        windSpeed={settings.windSpeed}
        windDirection={settings.windDirection}
        coastHeading={settings.coastHeading}
        weatherCode={weatherCode}
        light={light}
        tide={settings.tide}
        playerPosition={worldFocus}
      />
      <ShorelineWash settings={settings} light={light} sunPosition={oceanSunPosition} sunColor={sunLightColor} />
      <FootprintTrail
        motion={motion}
        targetPosition={position}
        playerHeading={playerHeading}
        tide={settings.tide}
        sandColor={beach.palette[1]}
      />
      <BoardTrack motion={motion} target={player} settings={settings} character={character} mobile={mobileRenderer} />
      <BreakingWhitewaterField
        motion={motion}
        settings={settings}
        character={character}
        target={waveStage}
        mobile={mobileRenderer}
      />
      <VehicleSurfaceEffects motion={vanMotion} targetPosition={vanPosition} heading={vanHeading} mobile={mobileRenderer} />
      <KinematicContactShadows
        motion={motion}
        playerPosition={position}
        playerHeading={playerHeading}
        vanMotion={vanMotion}
        vanPosition={vanPosition}
        vanHeading={vanHeading}
        mobile={mobileRenderer}
        daylight={daylightStrength * directLight}
        tide={settings.tide}
      />
      <group ref={waveStage}>
        <BreakingWave motion={motion} settings={settings} character={character} light={light} cloudCover={cloudCover} />
        <WaveReadingGuide motion={motion} settings={settings} character={character} mobile={mobileRenderer} />
      </group>
      <group ref={player}>
        <PaddleOutShorebreak motion={motion} settings={settings} light={light} mobile={mobileRenderer} />
        <WaterInteraction motion={motion} settings={settings} mobile={mobileRenderer} />
        <UnderwaterLightShafts motion={motion} light={light} cloudCover={cloudCover} mobile={mobileRenderer} />
        <UnderwaterSuspendedMatter motion={motion} settings={settings} mobile={mobileRenderer} />
        <SurferModel
          motion={motion}
          boardType={settings.board}
          accent={beach.palette[0]}
          onLeashTension={setLeashTension}
          cameraMode={cameraMode}
          thermalKit={thermalKit}
        />
      </group>
      <group ref={van}>
        <SurfVan
          motion={vanMotion}
          playerMotion={motion}
          darkness={vanDarkness}
          accent={beach.palette[0]}
          thermalKit={thermalKit}
        />
      </group>
      {weather.kind === "none" && !weather.fog && !weather.storm && (
        <>
          {birdCount >= 1 && <Seabird offset={0} speed={1 + settings.windSpeed * .008} variant={0} wind={settings.windSpeed} reducedMotion={reducedMotion} />}
          {birdCount >= 2 && <Seabird offset={7} speed={.82 + settings.windSpeed * .006} variant={1} wind={settings.windSpeed} reducedMotion={reducedMotion} />}
          {birdCount >= 3 && <Seabird offset={15} speed={1.15 + settings.windSpeed * .007} variant={2} wind={settings.windSpeed} reducedMotion={reducedMotion} />}
        </>
      )}
      {sunHeight < 0.22 && (
        <Sparkles count={renderQuality === "reduced" ? 34 : renderQuality === "balanced" ? 52 : 70} scale={[180, 48, 140]} position={[0, 20, -50]} size={0.7} speed={0.05} opacity={Math.max(.06, .45 * (1 - cloudFactor * .86))} color="#dcefff" />
      )}
      <AdaptiveImagePipeline
        motion={motion}
        cloudFactor={cloudFactor}
        weather={weather}
        solarElevation={solarElevation}
        flowAngle={THREE.MathUtils.degToRad(settings.waveDirection - settings.coastHeading)}
        mobile={mobileRenderer}
        reducedMotion={reducedMotion}
      />
      <CinematicFrameCapture
        request={captureRequest}
        onCapture={onCapture}
        focusPosition={worldFocus}
        motion={motion}
        settings={settings}
        character={character}
      />
    </>
  );
}

export default function SurfScene(props: SurfSceneProps) {
  const mobileRenderer = useMemo(() => isMobileRenderer(), []);
  const limits = useMemo(() => rendererLimits(mobileRenderer), [mobileRenderer]);
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(mobileRenderer ? "balanced" : "high");
  return (
    <Canvas
      className="surf-canvas"
      shadows={mobileRenderer ? false : "percentage"}
      dpr={limits.initial}
      frameloop={props.renderActive ? "always" : "demand"}
      camera={{ position: [0, 4.8, 44], fov: 58, near: 0.08, far: 650 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMappingExposure = 1.08;
      }}
    >
      <RenderQualityContext.Provider value={renderQuality}>
        <AdaptiveRenderer active={props.renderActive} mobile={mobileRenderer} limits={limits} onQualityChange={setRenderQuality} />
        <Simulation {...props} />
      </RenderQualityContext.Provider>
    </Canvas>
  );
}
