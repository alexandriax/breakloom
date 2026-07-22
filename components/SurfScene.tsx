"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky, Sparkles, useGLTF, useTexture } from "@react-three/drei";
import { MutableRefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Beach, BreakCharacter, CoastBiome } from "@/lib/beaches";
import { getBreakCharacter, getCoastBiome } from "@/lib/beaches";
import type { BoardType, GamePhase, GameStats, SessionSettings } from "@/lib/game";
import { BOARD_SPECS, primaryWavePhaseAt, sessionGrade, waveHeightAt, waveSetState } from "@/lib/game";

export type ControlState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  action: boolean;
  moveX: number;
  moveY: number;
  balance: number;
  lookYaw: number;
  lookPitch: number;
};

export type CameraMode = "follow" | "immersive" | "cinematic";

type SurfSceneProps = {
  beach: Beach;
  zoneName: string;
  settings: SessionSettings;
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
  weatherCode: number;
  sunrise: string;
  sunset: string;
  cameraMode: CameraMode;
  controls: MutableRefObject<ControlState>;
  active: boolean;
  onStats: (stats: GameStats) => void;
  onReady: () => void;
};

type MotionState = {
  phase: GamePhase;
  balance: number;
  steer: number;
  speed: number;
  waveQuality: number;
  setEnergy: number;
  wipeout: number;
  maneuver: number;
  maneuverSide: number;
  stance: number;
  barrel: number;
  rail: number;
  compression: number;
  slip: number;
  impact: number;
  takeoff: number;
};

type VehicleMotionState = {
  speed: number;
  steer: number;
  driving: boolean;
  brake: boolean;
  wetness: number;
  offRoad: number;
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
  uniform float uCurrent;
  uniform float uDirection;
  uniform float uTide;
  uniform float uWind;
  uniform float uPeel;
  uniform float uPower;
  uniform float uSteepness;
  uniform float uHollow;
  uniform float uVariability;
  varying float vHeight;
  varying float vCrest;
  varying float vBreaker;
  varying float vChop;
  varying vec2 vSurface;
  varying vec3 vWorldPosition;

  const float PI = 3.14159265359;

  float setEnvelope() {
    float cycle = max(18.0, uPeriod * 3.1);
    float phase = mod(uTime, cycle);
    float angle = ((phase - cycle * .38) / cycle) * PI * 2.0;
    return .12 + pow(max(0.0, cos(angle) * .5 + .5), 3.2) * .88;
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
    float phase = dot(origin, direction) * waveNumber + uTime * phaseSpeed + phaseOffset;
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
    vec2 surfaceOrigin = vec2(origin.x, -origin.y - 157.0);
    vec3 p = position;
    float angularSpeed = PI * 2.0 / max(4.0, uPeriod);
    float angle = radians(uDirection);
    vec2 currentDir = vec2(cos(angle), sin(angle));
    float section = sin(surfaceOrigin.x * .07 + uTime * .05) * uVariability * 2.3;
    float breakCoord = surfaceOrigin.y + surfaceOrigin.x * uPeel * .16 + section;
    float curve = sin(angle) * .0019 * origin.x * origin.x;
    vec2 curvedOrigin = vec2(surfaceOrigin.x, breakCoord + curve);
    float shore = .72 + smoothstep(-85.0, 8.0, breakCoord) * (.58 + uSteepness * .24);
    float shallowCompression = mix(1.0, mix(.82, .69, uSteepness), smoothstep(-32.0, 9.0, breakCoord));
    float setEnergy = setEnvelope();
    float setLift = .78 + setEnergy * .34;
    float amplitude = max(.12, uHeight * .62) * uPower;
    float windChop = clamp(uWind / 24.0, .12, 1.45);
    float currentBend = clamp(uCurrent / 4.0, 0.0, 1.0);

    float primary = gerstner(
      p,
      curvedOrigin,
      normalize(vec2(.095 + uPeel * .075 + currentDir.x * .035, 1.0)),
      33.0 * shallowCompression,
      amplitude * .64 * shore * setLift,
      clamp(.46 + uSteepness * .32, .58, .88),
      angularSpeed * 5.4,
      0.0
    );
    float secondary = gerstner(
      p,
      surfaceOrigin,
      normalize(vec2(-.16, 1.0)),
      20.3,
      amplitude * .22,
      .58,
      angularSpeed * 7.1,
      1.7
    );
    float crossSwell = gerstner(
      p,
      surfaceOrigin,
      normalize(vec2(1.0, .68) + currentDir * (.12 + currentBend * .12)),
      47.5,
      amplitude * .11,
      .42,
      -angularSpeed * 2.7,
      0.0
    );
    float windWave = gerstner(
      p,
      surfaceOrigin,
      normalize(vec2(-.72, .69)),
      mix(8.5, 5.4, windChop / 1.45),
      .035 + windChop * .065,
      .34,
      1.7 + windChop * 1.2,
      2.4
    );
    float capillary = sin(surfaceOrigin.x * 1.35 + surfaceOrigin.y * .78 + uTime * (2.2 + windChop)) * (.018 + windChop * .018);
    p.z += uTide * .3 + capillary;

    vHeight = p.z;
    vCrest = primary * shore;
    float breakerThreshold = mix(.58, .4, uHollow);
    vBreaker = smoothstep(-18.0, 12.0, breakCoord) * smoothstep(breakerThreshold, .96, primary * .5 + .5) * setLift * (.72 + uHollow * .34);
    vChop = abs(secondary) * .38 + abs(crossSwell) * .24 + abs(windWave) * windChop;
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
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
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
    float wind = clamp(uWind / 24.0, .0, 1.45);
    vec2 microFlow = vec2(
      sin(vSurface.x * 1.72 + vSurface.y * .63 + uTime * (1.7 + wind)),
      cos(vSurface.x * .91 - vSurface.y * 1.38 - uTime * (1.35 + wind * .7))
    );
    surfaceNormal = normalize(surfaceNormal + vec3(microFlow.x, 0.0, microFlow.y) * (.018 + wind * .024));
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

    float forwardScatter = pow(max(0.0, dot(viewDirection, -normalize(uSunDirection))), 3.0);
    color += vec3(.05, .52, .43) * crestLight * forwardScatter * (.18 + uLight * .34);

    float crestGate = smoothstep(.66, 1.08, vCrest) * smoothstep(.35, 1.2, uHeight);
    float foamBase = noise(vSurface * vec2(.35, .12) + vec2(uTime * .48, -uTime * .08));
    float foamDetail = noise(vSurface * vec2(1.18, .48) + vec2(-uTime * .74, uTime * .12));
    float breakerFoam = vBreaker * smoothstep(.26, .72, foamBase) * (.62 + foamDetail * .55);
    float crestFoam = crestGate * smoothstep(.17, .76, foamDetail);
    float shorePulse = sin(vSurface.x * .2 + uTime * 1.7 + noise(vSurface * .08) * 4.0) * .5 + .5;
    float shoreFoam = smoothstep(4.2, 10.5, vSurface.y) * smoothstep(.27, .72, shorePulse) * .64;
    float foam = clamp(max(max(crestFoam, breakerFoam), shoreFoam), 0.0, .94);
    vec3 foamColor = mix(vec3(.63, .88, .84), vec3(.91, 1.0, .97), uLight);
    color = mix(color, foamColor, foam);
    color = mix(color, vec3(.018, .041, .065), uCloud * .2);
    color *= .91 + noise(vSurface * 3.1 + uTime * .08) * .09;
    gl_FragColor = vec4(color, 1.0);
  }
`;

function Ocean({
  settings,
  character,
  light,
  cloudCover,
  windSpeed,
  sunPosition,
  sunColor,
}: {
  settings: SessionSettings;
  character: BreakCharacter;
  light: number;
  cloudCover: number;
  windSpeed: number;
  sunPosition: [number, number, number];
  sunColor: string;
}) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const segments = useMemo(() => (isMobileRenderer() ? 54 : 132), []);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uHeight: { value: 1 },
      uPeriod: { value: 8 },
      uCurrent: { value: 0 },
      uDirection: { value: 0 },
      uTide: { value: 0 },
      uLight: { value: 1 },
      uCloud: { value: 0 },
      uWind: { value: 0 },
      uPeel: { value: character.peel },
      uPower: { value: character.power },
      uSteepness: { value: character.steepness },
      uHollow: { value: character.hollow },
      uVariability: { value: character.variability },
      uSunDirection: { value: new THREE.Vector3(-.3, .8, -.45).normalize() },
      uSunColor: { value: new THREE.Color("#fff0ca") },
    }),
    [character],
  );

  useFrame(({ clock }) => {
    if (!material.current) return;
    const values = material.current.uniforms;
    values.uTime.value = clock.elapsedTime;
    values.uHeight.value = THREE.MathUtils.lerp(values.uHeight.value, settings.waveHeight, 0.02);
    values.uPeriod.value = settings.wavePeriod;
    values.uCurrent.value = settings.currentStrength;
    values.uDirection.value = settings.currentDirection;
    values.uTide.value = settings.tide;
    values.uLight.value = light;
    values.uCloud.value = cloudCover / 100;
    values.uWind.value = windSpeed;
    values.uPeel.value = THREE.MathUtils.lerp(values.uPeel.value, character.peel, .035);
    values.uPower.value = THREE.MathUtils.lerp(values.uPower.value, character.power, .035);
    values.uSteepness.value = THREE.MathUtils.lerp(values.uSteepness.value, character.steepness, .035);
    values.uHollow.value = THREE.MathUtils.lerp(values.uHollow.value, character.hollow, .035);
    values.uVariability.value = THREE.MathUtils.lerp(values.uVariability.value, character.variability, .035);
    values.uSunDirection.value.set(...sunPosition).normalize();
    values.uSunColor.value.set(sunColor);
  });

  return (
    <mesh position={[0, -0.08, -157]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[250, 330, segments, segments]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={OCEAN_VERTEX}
        fragmentShader={OCEAN_FRAGMENT}
        side={THREE.DoubleSide}
      />
    </mesh>
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

    float backwashPhase = fract((land - runup) * 10.5 + uTime * .13);
    float backwash = (1.0 - smoothstep(.0, .09, abs(backwashPhase - .5))) * wet;
    backwash *= smoothstep(.61, .89, noise(vec2(along * .32, land * 23.0 + uTime * .08))) * .24;

    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float grazing = pow(1.0 - abs(viewDirection.y), 3.0);
    vec3 wetColor = mix(vec3(.018, .105, .12), vec3(.075, .29, .27), uLight);
    wetColor += vec3(.18, .31, .3) * glass * grazing * (.24 + uLight * .28);
    vec3 foamColor = mix(vec3(.57, .79, .76), vec3(.94, 1.0, .96), uLight);
    float foamMask = clamp(foam + backwash, 0.0, .95);
    vec3 color = mix(wetColor, foamColor, foamMask);
    color *= .9 + noise(vec2(along * 1.9, land * 28.0 - uTime * (.08 + wind * .06))) * .1;

    float sideFade = smoothstep(0.0, .025, vUv.x) * smoothstep(0.0, .025, 1.0 - vUv.x);
    float alpha = (wet * (.15 + glass * .13) + foamMask * .78) * sideFade;
    alpha *= smoothstep(.0, .045, land) * (1.0 - smoothstep(.9, 1.0, land));
    gl_FragColor = vec4(color, clamp(alpha, 0.0, .92));
  }
`;

function ShorelineWash({ settings, light, windSpeed }: { settings: SessionSettings; light: number; windSpeed: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uTide: { value: 0 },
    uWind: { value: 0 },
    uLight: { value: 1 },
  }), []);

  useFrame(({ clock }) => {
    if (!material.current) return;
    const values = material.current.uniforms;
    values.uTime.value = clock.elapsedTime;
    values.uTide.value = THREE.MathUtils.lerp(values.uTide.value, settings.tide, .025);
    values.uWind.value = windSpeed;
    values.uLight.value = light;
  });

  return (
    <mesh position={[0, -0.405, 20]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <planeGeometry args={[250, 32]} />
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

const BREAKING_WAVE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uEnergy;
  uniform float uCurl;
  uniform float uSide;
  varying vec2 vUv;
  varying float vPocket;
  varying float vFoam;
  varying float vEdge;
  varying vec3 vWorldPosition;

  void main() {
    float heightRatio = uv.y;
    float faceHeight = clamp(uWaveHeight * 1.55, 1.45, 5.8) * (.82 + uEnergy * .3);
    float pocketCenter = uSide * 2.6;
    float pocketDistance = (position.x - pocketCenter) / 5.2;
    float pocket = exp(-pocketDistance * pocketDistance);
    float lip = smoothstep(.34, 1.0, heightRatio);
    float curl = uCurl * (.28 + pocket * .72);
    float edge = smoothstep(0.0, .09, uv.x) * smoothstep(0.0, .09, 1.0 - uv.x);
    vec3 p = position;
    p.x += uSide * curl * lip * .58;
    p.y = heightRatio * faceHeight;
    p.y += sin(position.x * .42 + uTime * 2.1) * .055 * (.35 + uEnergy);
    p.z = 2.7 - heightRatio * .62;
    p.z -= curl * lip * lip * (1.45 + faceHeight * .38);
    p.z += sin(position.x * .24 + uTime * 1.35) * .12 * (1.0 - heightRatio);

    vUv = uv;
    vPocket = pocket;
    vFoam = smoothstep(.68, 1.0, heightRatio) * (.5 + curl * .5);
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

    float lipFoam = vFoam * smoothstep(.2, .76, faceNoise) * (.68 + veinNoise * .5);
    float streaks = smoothstep(.7, .96, veinNoise) * smoothstep(.42, .95, vUv.y) * (.18 + vPocket * .36);
    float foam = clamp(max(lipFoam, streaks), 0.0, .96);
    vec3 foamColor = mix(vec3(.62, .88, .84), vec3(.94, 1.0, .98), uLight);
    color = mix(color, foamColor, foam);

    float lowerFade = smoothstep(.0, .1, vUv.y);
    float alpha = uOpacity * vEdge * lowerFade * (.32 + fresnel * .38 + vPocket * .14);
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
  varying vec2 vUv;
  varying float vPocket;
  varying float vEdge;
  varying float vDrop;
  varying vec3 vWorldPosition;

  void main() {
    float drop = uv.y;
    float faceHeight = clamp(uWaveHeight * 1.55, 1.45, 5.8) * (.82 + uEnergy * .3);
    float pocketCenter = uSide * 2.6;
    float pocketDistance = (position.x - pocketCenter) / 4.9;
    float pocket = exp(-pocketDistance * pocketDistance);
    float curl = uCurl * (.24 + pocket * .76);
    float lipZ = 2.08 - curl * (1.45 + faceHeight * .38);
    float flutter = sin(position.x * 1.7 - uTime * 4.2 + drop * 9.0) * .055;
    flutter += sin(position.x * .38 + uTime * 2.1) * .08;
    vec3 p = vec3(position.x + uSide * curl * .58, faceHeight, lipZ);
    p.x += flutter * (.35 + drop * .65);
    p.y -= drop * faceHeight * (.7 + curl * .18);
    p.z += drop * (.12 + curl * .52) + sin(drop * 12.0 + uTime * 2.8) * .045 * curl;

    vUv = uv;
    vPocket = pocket;
    vDrop = drop;
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
    float body = .07 + threads * .34 + broadSheet * .09 + beading * .18;
    float alpha = uOpacity * vPocket * vEdge * verticalFade * body;
    vec3 deep = mix(vec3(.015, .22, .24), vec3(.025, .4, .35), uLight);
    deep = mix(deep, vec3(.055, .105, .13), uCloud * .38);
    vec3 highlight = mix(vec3(.45, .86, .8), vec3(.91, 1.0, .97), clamp(threads + fresnel, 0.0, 1.0));
    vec3 color = mix(deep, highlight, .24 + fresnel * .36 + beading * .2);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, .7));
  }
`;

const BREAKING_FOAM_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uEnergy;
  uniform float uCurl;
  uniform float uSide;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    float seed = position.y;
    float faceHeight = clamp(uWaveHeight * 1.55, 1.45, 5.8) * (.82 + uEnergy * .3);
    float pocketCenter = uSide * 2.6;
    float pocketDistance = (position.x - pocketCenter) / 5.2;
    float pocket = exp(-pocketDistance * pocketDistance);
    float curl = uCurl * (.28 + pocket * .72);
    float age = fract(seed + uTime * (.12 + uEnergy * .1));
    float faller = step(.56, fract(seed * 17.31 + .19));
    vec3 p = vec3(position.x, faceHeight, 2.08 - curl * (1.45 + faceHeight * .38));
    p.x += uSide * curl * .58 + sin(seed * 41.0 + uTime * 2.7) * age * (.48 + faller * .32);
    p.y += sin(position.x * .42 + uTime * 2.1) * .055 * (.35 + uEnergy);
    p.y += mix(age * (.28 + uEnergy * .8), -age * (.4 + curl * 1.7), faller * curl);
    p.z += mix(-age * (.18 + curl * .32), age * (.12 + curl * .72), faller);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vAlpha = pow(1.0 - age, 1.7) * uOpacity * (.42 + pocket * .58);
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
  const faceUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWaveHeight: { value: 1 },
    uEnergy: { value: 0 },
    uCurl: { value: 0 },
    uSide: { value: 1 },
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
    uOpacity: { value: 0 },
  }), []);
  const curtainUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWaveHeight: { value: 1 },
    uEnergy: { value: 0 },
    uCurl: { value: 0 },
    uSide: { value: 1 },
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
    if (riding && Math.abs(state.steer) > .12) lineSide.current = Math.sign(state.steer);
    const targetCurl = riding
      ? THREE.MathUtils.clamp(
          (state.waveQuality * .24 + state.barrel * .92 + state.maneuver * .12) * (.72 + character.hollow * .3 + character.steepness * .08),
          .08,
          1.28,
        )
      : 0;
    const targetOpacity = riding
      ? THREE.MathUtils.clamp(.28 + state.waveQuality * .25 + state.barrel * .3 + character.power * .045, .3, .92)
      : 0;
    const targetCurtain = riding
      ? THREE.MathUtils.clamp((state.waveQuality - .5 + character.hollow * .14) * .82 + state.barrel * .92 + state.maneuver * .08, 0, .96)
      : 0;
    const values = faceMaterial.current.uniforms;
    values.uTime.value = clock.elapsedTime;
    values.uWaveHeight.value = THREE.MathUtils.damp(values.uWaveHeight.value, settings.waveHeight * (.9 + character.power * .1), 3.5, delta);
    values.uEnergy.value = THREE.MathUtils.damp(values.uEnergy.value, state.setEnergy, 4, delta);
    values.uCurl.value = THREE.MathUtils.damp(values.uCurl.value, targetCurl, 5.5, delta);
    values.uSide.value = THREE.MathUtils.damp(values.uSide.value, lineSide.current, 3.2, delta);
    values.uLight.value = light;
    values.uCloud.value = cloudCover / 100;
    values.uOpacity.value = THREE.MathUtils.damp(values.uOpacity.value, targetOpacity, riding ? 7 : 4, delta);
    const curtain = curtainMaterial.current.uniforms;
    curtain.uTime.value = clock.elapsedTime;
    curtain.uWaveHeight.value = values.uWaveHeight.value;
    curtain.uEnergy.value = values.uEnergy.value;
    curtain.uCurl.value = values.uCurl.value;
    curtain.uSide.value = values.uSide.value;
    curtain.uLight.value = light;
    curtain.uCloud.value = cloudCover / 100;
    curtain.uOpacity.value = THREE.MathUtils.damp(curtain.uOpacity.value, targetCurtain, riding ? 6 : 3.5, delta);
    const foam = foamMaterial.current.uniforms;
    foam.uTime.value = clock.elapsedTime;
    foam.uWaveHeight.value = values.uWaveHeight.value;
    foam.uEnergy.value = values.uEnergy.value;
    foam.uCurl.value = values.uCurl.value;
    foam.uSide.value = values.uSide.value;
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

const SURFER_MODEL_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/models/surfer-premium.glb`;
const VAN_MODEL_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/models/surf-van-premium.glb`;
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

function prepareSurferScene(source: THREE.Group) {
  const model = source.clone(true);
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = true;
    }
  });
  return model;
}

function PremiumSurferBody({ motion }: { motion: MutableRefObject<MotionState> }) {
  const { scene } = useGLTF(SURFER_MODEL_URL);
  const model = useMemo(() => prepareSurferScene(scene), [scene]);
  const joints = useRef<Partial<Record<SurferJointName, THREE.Object3D>>>({});

  useEffect(() => {
    const next: Partial<Record<SurferJointName, THREE.Object3D>> = {};
    SURFER_JOINT_NAMES.forEach((name) => {
      const joint = model.getObjectByName(name);
      if (joint) next[name] = joint;
    });
    joints.current = next;
  }, [model]);

  useFrame(({ clock }, delta) => {
    const state = motion.current;
    const t = clock.elapsedTime;
    const paddle = state.phase === "paddling" || state.phase === "wading";
    const riding = state.phase === "riding";
    const walking = state.phase === "shore";
    const wipeout = state.phase === "wipeout";
    const stroke = paddle ? Math.sin(t * 5.8) : 0;
    const step = walking ? Math.sin(t * Math.max(2.4, state.speed * 2.15)) : 0;

    const pose = (name: SurferJointName, x: number, y: number, z: number, responsiveness = 8) => {
      const joint = joints.current[name];
      if (!joint) return;
      joint.rotation.x = THREE.MathUtils.damp(joint.rotation.x, x, responsiveness, delta);
      joint.rotation.y = THREE.MathUtils.damp(joint.rotation.y, y, responsiveness, delta);
      joint.rotation.z = THREE.MathUtils.damp(joint.rotation.z, z, responsiveness, delta);
    };

    const rideLean = (state.balance * 0.12 + state.maneuverSide * state.maneuver * 0.12 + state.rail * .08) * (1 - state.takeoff * .72);
    pose("Pelvis", riding ? -0.08 - state.compression * .12 + state.stance * 0.045 : walking ? step * 0.025 : 0, riding ? state.rail * -0.1 : 0, riding ? rideLean * 0.35 : 0, 7);
    pose("Torso", paddle ? -0.1 : riding ? 0.18 + state.compression * .22 - state.barrel * 0.13 : walking ? -step * 0.018 : 0, riding ? state.maneuverSide * state.maneuver * 0.16 + state.slip * state.rail * .08 : 0, riding ? rideLean : 0, 7);
    pose("Head", paddle ? -0.24 : riding ? -0.12 - state.compression * .08 + state.barrel * 0.08 : 0, riding ? state.rail * 0.14 : 0, riding ? -rideLean * 0.4 : 0, 8);

    pose(
      "UpperArm.L",
      wipeout ? 1.2 : paddle ? stroke * 1.18 : riding ? -0.48 - state.maneuver * 0.22 : step * 0.56,
      riding ? -0.12 + state.rail * 0.12 : 0,
      riding ? 1.03 + state.maneuver * 0.32 + state.slip * .16 : paddle ? 0.14 : 0.08,
      9,
    );
    pose(
      "UpperArm.R",
      wipeout ? -1.1 : paddle ? -stroke * 1.18 : riding ? 0.48 + state.maneuver * 0.22 : -step * 0.56,
      riding ? 0.12 + state.rail * 0.12 : 0,
      riding ? -1.03 - state.maneuver * 0.32 - state.slip * .16 : paddle ? -0.14 : -0.08,
      9,
    );
    pose("LowerArm.L", paddle ? Math.max(0, -stroke) * -0.72 : riding ? -0.42 : wipeout ? 0.8 : 0, 0, riding ? 0.12 : 0, 10);
    pose("LowerArm.R", paddle ? Math.max(0, stroke) * 0.72 : riding ? 0.42 : wipeout ? -0.8 : 0, 0, riding ? -0.12 : 0, 10);
    pose("Hand.L", 0, riding ? -0.16 : 0, riding ? 0.08 : 0, 10);
    pose("Hand.R", 0, riding ? 0.16 : 0, riding ? -0.08 : 0, 10);

    pose("UpperLeg.L", riding ? -0.74 - state.stance * 0.12 - state.compression * .24 : walking ? step * 0.62 : paddle ? -0.08 : 0, 0, riding ? 0.17 + state.rail * .04 : 0, 8);
    pose("UpperLeg.R", riding ? 0.6 - state.stance * 0.12 + state.compression * .22 : walking ? -step * 0.62 : paddle ? 0.08 : 0, 0, riding ? -0.17 + state.rail * .04 : 0, 8);
    pose("LowerLeg.L", riding ? 1.02 + state.compression * .24 : walking ? Math.max(0, -step) * 0.56 : paddle ? 0.08 : 0, 0, 0, 9);
    pose("LowerLeg.R", riding ? -0.92 - state.compression * .24 : walking ? Math.max(0, step) * -0.56 : paddle ? -0.08 : 0, 0, 0, 9);
    pose("Foot.L", riding ? -0.18 : 0, riding ? 0.08 : 0, riding ? -0.08 : 0, 9);
    pose("Foot.R", riding ? 0.18 : 0, riding ? -0.08 : 0, riding ? 0.08 : 0, 9);
  });

  return <primitive object={model} scale={0.74} />;
}

useGLTF.preload(SURFER_MODEL_URL);
useGLTF.preload(VAN_MODEL_URL);

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

function PremiumSurfboard({ boardType }: { boardType: BoardType }) {
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
  const finGeometry = useMemo(() => createFinGeometry(), []);
  const leashGeometry = useMemo(() => {
    const tail = -spec.length * .5;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, .1, tail + .09),
      new THREE.Vector3(spec.width * .58, .035, tail - .2),
      new THREE.Vector3(spec.width * .24, -.015, tail - .52),
      new THREE.Vector3(-spec.width * .54, .01, tail - .82),
    ]);
    return new THREE.TubeGeometry(curve, 14, .012, 5, false);
  }, [spec.length, spec.width]);
  const finXs = boardType === "performance"
    ? [-spec.width * .46, 0, spec.width * .46]
    : boardType === "fish"
      ? [-spec.width * .5, spec.width * .5]
      : [0];
  const finScale = boardType === "longboard" ? 1.32 : boardType === "fish" ? 1.08 : .9;
  const tailPosition = -spec.length * .38;
  const waxPositions = boardType === "longboard" ? [-.55, -.08, .42, .88] : [-.35, .08, .48];

  useEffect(() => () => {
    boardGeometry.dispose();
    deckGeometry.dispose();
    finGeometry.dispose();
    leashGeometry.dispose();
  }, [boardGeometry, deckGeometry, finGeometry, leashGeometry]);

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
      <mesh geometry={leashGeometry}>
        <meshStandardMaterial color="#101a1d" roughness={.72} />
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

function SurferModel({ motion, boardType }: { motion: MutableRefObject<MotionState>; boardType: BoardType }) {
  const rig = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const board = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!rig.current || !body.current || !board.current) return;
    const state = motion.current;
    const paddle = state.phase === "paddling" || state.phase === "wading";
    const riding = state.phase === "riding";
    const shore = state.phase === "shore";
    const wipeout = state.phase === "wipeout";
    const rebound = Math.sin((1 - state.impact) * Math.PI) * state.impact;

    const bodyRotationX = paddle ? Math.PI / 2 - 0.1 : riding ? -0.18 + state.takeoff * 1.32 : 0;
    body.current.rotation.x = THREE.MathUtils.damp(body.current.rotation.x, bodyRotationX, 8, delta);
    body.current.rotation.z = THREE.MathUtils.damp(
      body.current.rotation.z,
      wipeout ? 1.7 : riding ? -state.balance * 0.3 + state.rail * .18 + state.maneuverSide * state.maneuver * 0.34 : 0,
      7,
      delta,
    );
    body.current.rotation.y = THREE.MathUtils.damp(
      body.current.rotation.y,
      riding ? state.maneuverSide * state.maneuver * 0.74 : 0,
      9,
      delta,
    );
    body.current.position.y = THREE.MathUtils.damp(body.current.position.y, paddle ? 0.44 : riding ? 0.84 - state.takeoff * .34 - state.compression * .15 + rebound * .08 : 1.02, 8, delta);
    body.current.position.z = THREE.MathUtils.damp(body.current.position.z, riding ? state.stance * 0.46 : 0, 7, delta);
    rig.current.rotation.z = THREE.MathUtils.damp(rig.current.rotation.z, wipeout ? state.wipeout * 2.1 : riding ? state.slip * state.rail * -.08 : 0, 9, delta);
    rig.current.rotation.y = THREE.MathUtils.damp(rig.current.rotation.y, riding ? state.slip * Math.sign(state.rail) * .13 : 0, 8, delta);

    board.current.rotation.z = THREE.MathUtils.damp(
      board.current.rotation.z,
      shore ? -0.12 : riding ? state.rail * -.27 - state.maneuverSide * state.maneuver * 0.22 : 0,
      7,
      delta,
    );
    board.current.rotation.y = THREE.MathUtils.damp(
      board.current.rotation.y,
      riding ? state.maneuverSide * state.maneuver * 0.52 + state.slip * Math.sign(state.rail) * .18 : 0,
      9,
      delta,
    );
    board.current.position.x = THREE.MathUtils.damp(board.current.position.x, shore ? 0.68 : 0, 7, delta);
    board.current.position.y = THREE.MathUtils.damp(
      board.current.position.y,
      shore ? 1.14 : 0.16 - Math.abs(state.rail) * .035 - state.compression * .025 + rebound * .09,
      7,
      delta,
    );
    board.current.rotation.x = THREE.MathUtils.damp(
      board.current.rotation.x,
      shore ? Math.PI / 2 - 0.08 : riding ? state.stance * -0.05 + state.barrel * 0.025 + rebound * .06 + state.takeoff * .09 : 0,
      7,
      delta,
    );

  });

  return (
    <group ref={rig}>
      <group ref={board} position={[0, 0.16, 0]}>
        <PremiumSurfboard boardType={boardType} />
      </group>

      <group ref={body} position={[0, 1.02, 0]}>
        <PremiumSurferBody motion={motion} />
      </group>
    </group>
  );
}

const FOOTPRINT_COUNT = 28;
const CARVE_TRACK_COUNT = 64;
const IMPACT_RING_COUNT = 10;

function WaterInteraction({ motion, mobile }: { motion: MutableRefObject<MotionState>; mobile: boolean }) {
  const wake = useRef<THREE.Group>(null);
  const wakeMaterials = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const spray = useRef<THREE.Points>(null);
  const sprayMaterial = useRef<THREE.PointsMaterial>(null);
  const particleCount = mobile ? 44 : 88;
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
  const previousTakeoff = useRef(0);
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

  useEffect(() => () => {
    particleTexture.dispose();
    wakeTexture.dispose();
  }, [particleTexture, wakeTexture]);

  useFrame(({ clock }, delta) => {
    const state = motion.current;
    const riding = state.phase === "riding";
    const paddling = state.phase === "paddling" || state.phase === "wading";
    if (wake.current) {
      wake.current.visible = riding || paddling;
      const speedScale = THREE.MathUtils.clamp(state.speed / 13, 0.2, 1.35);
      wake.current.scale.z = THREE.MathUtils.damp(wake.current.scale.z, paddling ? 0.56 : speedScale, 6, delta);
      wake.current.scale.x = THREE.MathUtils.damp(wake.current.scale.x, riding ? 1 + Math.abs(state.rail) * .42 + state.slip * .3 : .72, 7, delta);
      wake.current.rotation.y = THREE.MathUtils.damp(wake.current.rotation.y, riding ? state.rail * -.11 - Math.sign(state.rail) * state.slip * .08 : 0, 7, delta);
      wake.current.position.y = Math.sin(clock.elapsedTime * 7.5) * 0.018;
    }
    const targetOpacity = riding ? 0.2 + Math.min(0.38, state.speed * 0.018) + Math.abs(state.rail) * .12 + state.slip * .16 : paddling ? 0.16 : 0;
    wakeMaterials.current.forEach((material, index) => {
      if (!material) return;
      const side = index === 0 ? -1 : 1;
      const loadedRail = index < 2 && Math.abs(state.rail) > .08 ? (Math.sign(state.rail) === side ? 1.22 : .54) : 1;
      const stagger = index > 1 ? 0.68 : loadedRail;
      material.opacity = THREE.MathUtils.damp(material.opacity, targetOpacity * stagger, 7, delta);
    });
    const positionAttribute = spray.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const particlePositions = positionAttribute?.array as Float32Array | undefined;

    const emit = (count: number, impact: boolean) => {
      if (!particlePositions) return;
      for (let particle = 0; particle < count; particle += 1) {
        const index = cursor.current++ % particleCount;
        const offset = index * 3;
        const railSide = Math.abs(state.rail) > 0.1 ? -Math.sign(state.rail) : Math.random() > 0.5 ? 1 : -1;
        particlePositions[offset] = railSide * (0.22 + Math.random() * (impact ? 0.5 : 0.22));
        particlePositions[offset + 1] = 0.08 + Math.random() * 0.18;
        particlePositions[offset + 2] = impact ? Math.random() * 0.7 - 0.15 : -0.32 - Math.random() * 0.8;
        velocities.current[offset] = railSide * (0.75 + state.slip * 1.4 + Math.abs(state.rail) * state.speed * .055 + Math.random() * (impact ? 2.7 : 1.25));
        velocities.current[offset + 1] = 0.65 + state.compression * .42 + state.slip * .5 + Math.random() * (impact ? 2.6 : 1.35) + state.barrel * 0.5;
        velocities.current[offset + 2] = -(1.4 + Math.random() * (impact ? 3.6 : 2.2));
        life.current[index] = impact ? 0.9 + Math.random() * 0.35 : 0.46 + Math.random() * 0.38;
      }
    };

    if (riding) {
      emission.current += delta * (Math.abs(state.rail) * 22 + state.slip * 26 + state.compression * 5 + state.barrel * 12 + Math.max(0, state.speed - 9) * 0.8);
      if (emission.current >= 1) {
        const count = Math.min(5, Math.floor(emission.current));
        emit(count, false);
        emission.current -= count;
      }
      if (state.maneuver > 0.82 && previousManeuver.current <= 0.82) emit(mobile ? 12 : 24, true);
      if (state.takeoff > .82 && previousTakeoff.current <= .82) emit(mobile ? 8 : 15, true);
    }
    previousManeuver.current = state.maneuver;
    previousTakeoff.current = state.takeoff;

    if (!particlePositions) return;
    for (let index = 0; index < particleCount; index += 1) {
      if (life.current[index] <= 0) continue;
      const offset = index * 3;
      life.current[index] -= delta;
      particlePositions[offset] += velocities.current[offset] * delta;
      particlePositions[offset + 1] += velocities.current[offset + 1] * delta;
      particlePositions[offset + 2] += velocities.current[offset + 2] * delta;
      velocities.current[offset + 1] -= delta * 3.4;
      velocities.current[offset] *= 1 - delta * 0.55;
      if (life.current[index] <= 0 || particlePositions[offset + 1] < -0.08) particlePositions[offset + 1] = -20;
    }
    if (positionAttribute) positionAttribute.needsUpdate = true;
    if (sprayMaterial.current) {
      sprayMaterial.current.opacity = THREE.MathUtils.damp(sprayMaterial.current.opacity, riding ? Math.min(1, .78 + state.slip * .22) : 0, 7, delta);
      sprayMaterial.current.size = THREE.MathUtils.damp(sprayMaterial.current.size, .24 + state.slip * .1 + state.impact * .08, 7, delta);
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
  const markCount = mobile ? 30 : CARVE_TRACK_COUNT;
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
        mark.width = .52 + Math.abs(state.rail) * .74 + state.slip * .38;
        mark.length = 1.05 + state.speed * .075;
        mark.maxAge = mobile ? 3.5 : 5.1;
        mark.age = mark.maxAge;
        mark.intensity = THREE.MathUtils.clamp(.48 + state.speed * .025 + Math.abs(state.rail) * .3 + state.slip * .18, .48, 1.08);
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
}: {
  motion: MutableRefObject<MotionState>;
  targetPosition: MutableRefObject<THREE.Vector3>;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const previousPosition = useRef(new THREE.Vector3());
  const traveled = useRef(0);
  const cursor = useRef(0);
  const footSide = useRef(-1);
  const prints = useRef(Array.from({ length: FOOTPRINT_COUNT }, () => ({ x: 0, y: -100, z: 0, age: 0, side: 1 })));
  const footprintTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 192;
    const context = canvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "rgba(255,255,255,.9)";
      context.beginPath();
      context.ellipse(48, 128, 21, 43, -.05, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.ellipse(49, 56, 27, 36, .04, 0, Math.PI * 2);
      context.fill();
      [22, 35, 48, 61, 73].forEach((x, index) => {
        context.beginPath();
        context.ellipse(x, 19 + Math.abs(index - 2) * 3, 6.5 - Math.abs(index - 2) * .45, 9 - Math.abs(index - 2) * .7, 0, 0, Math.PI * 2);
        context.fill();
      });
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  useEffect(() => {
    const current = targetPosition.current;
    previousPosition.current.copy(current);
    if (mesh.current) {
      prints.current.forEach((print, index) => {
        dummy.position.set(0, -100, 0);
        dummy.updateMatrix();
        mesh.current?.setMatrixAt(index, dummy.matrix);
        print.age = 0;
      });
      mesh.current.instanceMatrix.needsUpdate = true;
    }
    return () => footprintTexture.dispose();
  }, [dummy, footprintTexture, targetPosition]);

  useFrame((_, delta) => {
    if (!mesh.current) return;
    const current = targetPosition.current;
    const state = motion.current;
    const stepDistance = current.distanceTo(previousPosition.current);
    if (state.phase === "shore" && state.speed > .4 && current.z > 10 && current.z < 69) {
      traveled.current += stepDistance;
      if (traveled.current > .58) {
        const side = footSide.current;
        footSide.current *= -1;
        traveled.current %= .58;
        const print = prints.current[cursor.current++ % FOOTPRINT_COUNT];
        print.x = current.x + side * .17;
        print.z = current.z + (side > 0 ? .08 : -.08);
        print.y = THREE.MathUtils.lerp(-.39, -.465, THREE.MathUtils.smoothstep(current.z, 24, 36));
        print.age = 13;
        print.side = side;
      }
    } else if (state.phase !== "shore") {
      traveled.current = 0;
    }
    previousPosition.current.copy(current);

    prints.current.forEach((print, index) => {
      print.age = Math.max(0, print.age - delta);
      if (print.age <= 0) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(.001);
      } else {
        const fade = THREE.MathUtils.smoothstep(print.age, 0, 2.4);
        dummy.position.set(print.x, print.y, print.z);
        dummy.rotation.set(-Math.PI / 2, 0, print.side * .055);
        dummy.scale.set(.31 * fade, .58 * fade, 1);
      }
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, FOOTPRINT_COUNT]} frustumCulled={false} renderOrder={3}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={footprintTexture}
        color="#2a211b"
        transparent
        opacity={.34}
        alphaTest={.08}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </instancedMesh>
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
    vec2 drift = vec2(uTime * (.006 + windSpeed * .012), uTime * .0018);
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
  light,
  sunHeight,
  sunPosition,
  hazeColor,
}: {
  cloudCover: number;
  windSpeed: number;
  light: number;
  sunHeight: number;
  sunPosition: [number, number, number];
  hazeColor: string;
}) {
  const dome = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const segments = useMemo(() => (isMobileRenderer() ? [30, 16] : [48, 24]) as [number, number], []);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uCloud: { value: 0 },
    uWind: { value: 0 },
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

function WeatherEffects({ weatherCode, windSpeed, windDirection }: { weatherCode: number; windSpeed: number; windDirection: number }) {
  const precipitation = useRef<THREE.Points>(null);
  const precipitationMaterial = useRef<THREE.ShaderMaterial>(null);
  const lightning = useRef<THREE.DirectionalLight>(null);
  const bolt = useRef<THREE.LineSegments>(null);
  const boltMaterial = useRef<THREE.LineBasicMaterial>(null);
  const profile = useMemo(() => weatherProfile(weatherCode), [weatherCode]);
  const flash = useRef(0);
  const flashIndex = useRef(0);
  const nextFlash = useRef(5.2);
  const particleCount = useMemo(() => (isMobileRenderer() ? 150 : 320), []);
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
      const windAngle = THREE.MathUtils.degToRad(windDirection);
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

function Bird({ offset, speed }: { offset: number; speed: number }) {
  const group = useRef<THREE.Group>(null);
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime * speed + offset;
    group.current.position.set(Math.sin(t * 0.21) * 58, 14 + Math.sin(t * 0.37) * 4, -38 + Math.cos(t * 0.21) * 44);
    group.current.rotation.y = -t * 0.21;
    const flap = Math.sin(t * 5) * 0.48;
    if (left.current) left.current.rotation.z = 0.2 + flap;
    if (right.current) right.current.rotation.z = -0.2 - flap;
  });
  return (
    <group ref={group} scale={0.6}>
      <mesh>
        <sphereGeometry args={[0.17, 8, 6]} />
        <meshStandardMaterial color="#d8e1dc" />
      </mesh>
      <mesh ref={left} position={[-0.34, 0, 0]} rotation={[0, 0, 0.2]}>
        <boxGeometry args={[0.72, 0.035, 0.2]} />
        <meshStandardMaterial color="#c3d0cc" />
      </mesh>
      <mesh ref={right} position={[0.34, 0, 0]} rotation={[0, 0, -0.2]}>
        <boxGeometry args={[0.72, 0.035, 0.2]} />
        <meshStandardMaterial color="#c3d0cc" />
      </mesh>
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

function CoastBackdrop({ biome, wind }: { biome: CoastBiome; wind: number }) {
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
        {Array.from({ length: 52 }, (_, index) => {
          const x = -120 + ((index * 37) % 240);
          const z = 94 + ((index * 17) % 24);
          return (
            <group key={index} position={[x, 0, z]} rotation={[0, index * 0.62, 0]}>
              {[-0.24, 0, 0.24].map((blade, bladeIndex) => (
                <mesh key={blade} position={[blade, 0.65 + bladeIndex * 0.09, 0]} rotation={[0, 0, blade * 0.55]}>
                  <coneGeometry args={[0.035, 1.35 + bladeIndex * 0.18, 5]} />
                  <meshStandardMaterial color={bladeIndex % 2 ? "#71815c" : "#87916a"} roughness={1} />
                </mesh>
              ))}
            </group>
          );
        })}
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
    vec2 road = vec2(vUv.x * 92.0, vUv.y * 7.0);
    float aggregate = fbm(road * 2.2);
    float coarse = fbm(road * .24 + vec2(17.0, 3.0));
    float laneWear = exp(-pow((vUv.y - .28) * 17.0, 2.0)) + exp(-pow((vUv.y - .72) * 17.0, 2.0));
    float seam = (1.0 - smoothstep(0.0, .018, abs(fract(vUv.x * 5.0 + .17) - .5))) * .16;
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
      <planeGeometry args={[250, 14]} />
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

function BeachVisitor({
  position,
  rotation,
  activity,
  palette,
  phase,
  observerPosition,
  scale = 1,
}: {
  position: [number, number, number];
  rotation: number;
  activity: VisitorActivity;
  palette: VisitorPalette;
  phase: number;
  observerPosition: MutableRefObject<THREE.Vector3>;
  scale?: number;
}) {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const upperArms = useRef<Array<THREE.Group | null>>([]);
  const lowerArms = useRef<Array<THREE.Group | null>>([]);
  const upperLegs = useRef<Array<THREE.Group | null>>([]);
  const lowerLegs = useRef<Array<THREE.Group | null>>([]);
  const baseX = position[0];

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime + phase;
    const walking = activity === "walk";
    const photographing = activity === "photo";
    const relaxed = activity === "relax";
    const stride = walking ? Math.sin(t * 3.35) : 0;
    const breathing = Math.sin(t * .86) * .012;
    if (root.current) {
      root.current.position.x = walking ? baseX + Math.sin(t * .24) * 5.8 : baseX;
      root.current.position.y = relaxed ? -.26 : Math.abs(stride) * .018;
      root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, rotation + (walking && Math.cos(t * .24) < 0 ? Math.PI : 0), 5, delta);
    }
    if (torso.current) {
      torso.current.rotation.x = THREE.MathUtils.damp(torso.current.rotation.x, relaxed ? -.08 : walking ? stride * -.035 : breathing, 6, delta);
      torso.current.rotation.z = THREE.MathUtils.damp(torso.current.rotation.z, walking ? stride * .025 : Math.sin(t * .43) * .018, 5, delta);
    }
    if (head.current) {
      const currentX = root.current?.position.x ?? baseX;
      const dx = observerPosition.current.x - currentX;
      const dz = observerPosition.current.z - position[2];
      const glanceDistance = Math.hypot(dx, dz);
      const worldAngle = Math.atan2(dx, dz);
      const rootRotation = root.current?.rotation.y ?? rotation;
      const relativeAngle = Math.atan2(Math.sin(worldAngle - rootRotation), Math.cos(worldAngle - rootRotation));
      const glance = glanceDistance < 14 && !photographing && !relaxed
        ? THREE.MathUtils.clamp(relativeAngle, -.72, .72)
        : activity === "watch" ? Math.sin(t * .34) * .28 : 0;
      head.current.rotation.x = THREE.MathUtils.damp(head.current.rotation.x, photographing ? -.08 : relaxed ? -.14 : 0, 6, delta);
      head.current.rotation.y = THREE.MathUtils.damp(head.current.rotation.y, glance, 4, delta);
    }
    upperArms.current.forEach((arm, index) => {
      if (!arm) return;
      const side = index ? -1 : 1;
      const targetX = photographing ? -1.02 + side * .05 : relaxed ? -.3 : walking ? stride * side * .68 : Math.sin(t * .72 + index) * .045;
      const targetZ = photographing ? side * -.44 : side * -.075;
      arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, targetX, 7, delta);
      arm.rotation.z = THREE.MathUtils.damp(arm.rotation.z, targetZ, 7, delta);
    });
    lowerArms.current.forEach((arm, index) => {
      if (!arm) return;
      const side = index ? -1 : 1;
      arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, photographing ? -1.12 : relaxed ? -.42 : 0, 7, delta);
      arm.rotation.z = THREE.MathUtils.damp(arm.rotation.z, photographing ? side * .34 : 0, 7, delta);
    });
    upperLegs.current.forEach((leg, index) => {
      if (!leg) return;
      const side = index ? -1 : 1;
      leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, relaxed ? -1.38 : walking ? stride * side * .64 : 0, 8, delta);
      leg.rotation.z = THREE.MathUtils.damp(leg.rotation.z, relaxed ? side * .12 : side * .025, 7, delta);
    });
    lowerLegs.current.forEach((leg, index) => {
      if (!leg) return;
      const side = index ? -1 : 1;
      const bend = relaxed ? 1.08 : walking ? Math.max(0, -stride * side) * .78 : 0;
      leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, bend, 8, delta);
    });
  });

  return (
    <group ref={root} position={position} rotation={[0, rotation, 0]} scale={scale}>
      <group ref={torso} position={[0, 1.17, 0]}>
        <mesh castShadow>
          <capsuleGeometry args={[.18, .52, 5, 10]} />
          <meshStandardMaterial color={palette.shirt} roughness={.72} />
        </mesh>
        <mesh position={[0, -.31, 0]} castShadow>
          <capsuleGeometry args={[.185, .18, 4, 9]} />
          <meshStandardMaterial color={palette.shorts} roughness={.78} />
        </mesh>
        <group ref={head} position={[0, .57, 0]}>
          <mesh position={[0, -.075, 0]} castShadow>
            <cylinderGeometry args={[.07, .08, .16, 10]} />
            <meshStandardMaterial color={palette.skin} roughness={.66} />
          </mesh>
          <mesh position={[0, .13, 0]} castShadow>
            <sphereGeometry args={[.16, 14, 10]} />
            <meshStandardMaterial color={palette.skin} roughness={.62} />
          </mesh>
          <mesh position={[0, .205, .015]} scale={[1.02, .48, 1.02]} castShadow>
            <sphereGeometry args={[.158, 12, 8, 0, Math.PI * 2, 0, Math.PI * .62]} />
            <meshStandardMaterial color={palette.hair} roughness={.88} />
          </mesh>
        </group>
        {[-1, 1].map((side, index) => (
          <group key={`arm-${side}`} ref={(joint) => { upperArms.current[index] = joint; }} position={[side * .235, .2, 0]}>
            <mesh position={[0, -.2, 0]} castShadow>
              <capsuleGeometry args={[.065, .27, 4, 8]} />
              <meshStandardMaterial color={palette.shirt} roughness={.74} />
            </mesh>
            <group ref={(joint) => { lowerArms.current[index] = joint; }} position={[0, -.4, 0]}>
              <mesh position={[0, -.18, 0]} castShadow>
                <capsuleGeometry args={[.052, .25, 4, 8]} />
                <meshStandardMaterial color={palette.skin} roughness={.66} />
              </mesh>
              <mesh position={[0, -.35, 0]} scale={[.8, 1.1, .7]} castShadow>
                <sphereGeometry args={[.068, 10, 8]} />
                <meshStandardMaterial color={palette.skin} roughness={.64} />
              </mesh>
            </group>
          </group>
        ))}
        {activity === "photo" && (
          <mesh position={[0, .13, -.46]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <boxGeometry args={[.17, .025, .1]} />
            <meshStandardMaterial color="#10171a" metalness={.58} roughness={.28} />
          </mesh>
        )}
      </group>
      {[-1, 1].map((side, index) => (
        <group key={`leg-${side}`} ref={(joint) => { upperLegs.current[index] = joint; }} position={[side * .105, .84, 0]}>
          <mesh position={[0, -.25, 0]} castShadow>
            <capsuleGeometry args={[.082, .38, 4, 8]} />
            <meshStandardMaterial color={palette.skin} roughness={.68} />
          </mesh>
          <group ref={(joint) => { lowerLegs.current[index] = joint; }} position={[0, -.51, 0]}>
            <mesh position={[0, -.22, 0]} castShadow>
              <capsuleGeometry args={[.066, .33, 4, 8]} />
              <meshStandardMaterial color={palette.skin} roughness={.68} />
            </mesh>
            <mesh position={[0, -.46, -.055]} scale={[.08, .055, .16]} castShadow>
              <sphereGeometry args={[1, 10, 7]} />
              <meshStandardMaterial color={activity === "walk" ? "#e8e1d2" : palette.skin} roughness={.72} />
            </mesh>
          </group>
        </group>
      ))}
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

function LifeguardStation({ wind, light }: { wind: number; light: number }) {
  return (
    <group position={[13, 0, 61]}>
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

function BeachActivity({ mobile, weatherCode, observerPosition }: { mobile: boolean; weatherCode: number; observerPosition: MutableRefObject<THREE.Vector3> }) {
  const weather = weatherProfile(weatherCode);
  const sheltered = weather.storm || weather.kind !== "none" || weather.fog;
  const visitors = useMemo(() => [
    { position: [-18, 0, 43] as [number, number, number], rotation: Math.PI, activity: "walk" as const, phase: .3, palette: { skin: "#9a5c3b", shirt: "#d55c48", shorts: "#203842", hair: "#21150f" } },
    { position: [27, 0, 46] as [number, number, number], rotation: Math.PI, activity: "photo" as const, phase: 2.1, palette: { skin: "#c98d69", shirt: "#e2c15b", shorts: "#374b5d", hair: "#5b3828" } },
    { position: [-34, 0, 56] as [number, number, number], rotation: Math.PI * .84, activity: "watch" as const, phase: 4.2, palette: { skin: "#6e3e2e", shirt: "#244c5f", shorts: "#ddd4bf", hair: "#17110f" } },
    { position: [7, 0, 51] as [number, number, number], rotation: Math.PI * 1.08, activity: "relax" as const, phase: 6.4, palette: { skin: "#d2a07a", shirt: "#e87861", shorts: "#36585d", hair: "#7a4d2d" } },
  ], []);
  const visibleVisitors = sheltered ? [] : mobile ? visitors.slice(0, 2) : visitors;
  return (
    <group>
      {visibleVisitors.map((visitor, index) => <BeachVisitor key={index} {...visitor} observerPosition={observerPosition} scale={index === 1 ? .94 : 1} />)}
      {!sheltered && (
        <group position={[7, -.47, 51]} rotation={[-Math.PI / 2, 0, -.18]}>
          <mesh receiveShadow><planeGeometry args={[2.4, 1.15]} /><meshStandardMaterial color="#e8b852" roughness={.92} /></mesh>
          {[-.66, 0, .66].map((x) => <mesh key={x} position={[x, 0, .006]}><planeGeometry args={[.12, 1.15]} /><meshBasicMaterial color="#f4e3b5" /></mesh>)}
        </group>
      )}
      <group position={[-29, 0, 53]}>
        <mesh position={[0, .28, 0]} castShadow><boxGeometry args={[.65, .5, .48]} /><meshStandardMaterial color="#e8ded0" roughness={.62} /></mesh>
        <mesh position={[0, .56, 0]} castShadow><boxGeometry args={[.69, .1, .52]} /><meshStandardMaterial color="#da6249" roughness={.55} /></mesh>
        <mesh position={[0, .3, -.25]}><boxGeometry args={[.24, .16, .04]} /><meshStandardMaterial color="#a8d8d3" metalness={.18} roughness={.28} /></mesh>
      </group>
    </group>
  );
}

function BeachLife({ beach, windSpeed, weatherCode, light, playerPosition }: { beach: Beach; windSpeed: number; weatherCode: number; light: number; playerPosition: MutableRefObject<THREE.Vector3> }) {
  const biome = getCoastBiome(beach.id);
  const wind = THREE.MathUtils.clamp(windSpeed / 24, 0.08, 1.4);
  const mobileRenderer = useMemo(() => isMobileRenderer(), []);
  const sandTextureSource = useTexture(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/textures/sand-premium.webp`);
  const sandTexture = useMemo(() => createTiledSandTexture(sandTextureSource, 22, 11), [sandTextureSource]);
  const wetSandTexture = useMemo(() => createTiledSandTexture(sandTextureSource, 22, 2), [sandTextureSource]);
  const dunes = useMemo(
    () =>
      Array.from({ length: 22 }, (_, index) => ({
        x: -75 + ((index * 29) % 150),
        z: 68 + ((index * 13) % 54),
        s: 3.2 + ((index * 7) % 8) * 0.42,
      })),
    [],
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
  return (
    <group>
      <mesh position={[0, -0.5, 64]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[250, 125, 20, 20]} />
        <meshStandardMaterial color={surface[0]} map={sandTexture} bumpMap={sandTexture} bumpScale={0.045} roughness={0.93} metalness={0} />
      </mesh>
      <mesh position={[0, -0.43, 21]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[250, 18]} />
        <meshStandardMaterial color={surface[1]} map={wetSandTexture} bumpMap={wetSandTexture} bumpScale={0.025} roughness={0.76} metalness={0.04} />
      </mesh>
      <group position={[0, 0, 78]}>
        <RoadSurface weatherCode={weatherCode} light={light} />
        <mesh position={[0, -0.31, -6.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[250, 0.18]} />
          <meshStandardMaterial color="#dfd6b5" roughness={0.78} />
        </mesh>
        <mesh position={[0, -0.31, 6.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[250, 0.18]} />
          <meshStandardMaterial color="#dfd6b5" roughness={0.78} />
        </mesh>
        {Array.from({ length: 24 }, (_, index) => (
          <mesh key={index} position={[-115 + index * 10, -0.29, 0]} receiveShadow>
            <boxGeometry args={[5.5, 0.04, 0.16]} />
            <meshStandardMaterial color="#d8c86c" roughness={0.82} emissive="#5b4d13" emissiveIntensity={0.08} />
          </mesh>
        ))}
        {Array.from({ length: 18 }, (_, index) => (
          <group key={index} position={[-110 + index * 13, 0, -8.3]}>
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
      {biome !== "urban" && biome !== "rugged" && dunes.filter((dune) => dune.z > 88).map((dune, index) => (
        <mesh key={index} position={[dune.x, -0.4, dune.z]} scale={[dune.s, 0.8 + (index % 3) * 0.28, dune.s * 0.72]} receiveShadow>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color={biome === "volcanic" ? index % 2 ? "#373a36" : "#484a43" : index % 2 ? "#a9875f" : "#c19d6b"} roughness={1} />
        </mesh>
      ))}
      <group position={[-10, 0, 50]}>
        <mesh position={[0, 2.1, 0]} castShadow>
          <cylinderGeometry args={[0.18, 0.25, 4.2, 10]} />
          <meshStandardMaterial color="#e2d3b6" roughness={0.9} />
        </mesh>
        <mesh position={[0, 4.15, 0]} rotation={[0, 0, 0.04]} castShadow>
          <coneGeometry args={[3.4, 1.25, 28, 2, false, 0, Math.PI * 2]} />
          <meshStandardMaterial color="#e75e43" roughness={0.72} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <LifeguardStation wind={wind} light={light} />
      <BeachActivity mobile={mobileRenderer} weatherCode={weatherCode} observerPosition={playerPosition} />
      <CoastBackdrop biome={biome} wind={wind} />
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

function SurfVan({ motion, darkness }: { motion: MutableRefObject<VehicleMotionState>; darkness: number }) {
  const { scene } = useGLTF(VAN_MODEL_URL);
  const model = useMemo(() => prepareVanScene(scene), [scene]);
  const body = useRef<THREE.Object3D | null>(null);
  const steerLeft = useRef<THREE.Object3D | null>(null);
  const steerRight = useRef<THREE.Object3D | null>(null);
  const wheels = useRef<THREE.Object3D[]>([]);
  const brakeMaterials = useRef<THREE.MeshStandardMaterial[]>([]);
  const headLights = useRef<Array<THREE.PointLight | null>>([]);

  useEffect(() => {
    body.current = model.getObjectByName("VanBody") ?? null;
    steerLeft.current = model.getObjectByName("Steer.FL") ?? null;
    steerRight.current = model.getObjectByName("Steer.FR") ?? null;
    wheels.current = ["Wheel.FL", "Wheel.FR", "Wheel.RL", "Wheel.RR"]
      .map((name) => model.getObjectByName(name))
      .filter((wheel): wheel is THREE.Object3D => Boolean(wheel));

    const nextBrakeMaterials: THREE.MeshStandardMaterial[] = [];
    model.getObjectByName("BrakeLights")?.traverse((object) => {
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
    wheels.current.forEach((wheel) => {
      wheel.rotation.x -= rotationDelta;
    });
    if (steerLeft.current) steerLeft.current.rotation.y = THREE.MathUtils.damp(steerLeft.current.rotation.y, state.steer * 0.42, 9, delta);
    if (steerRight.current) steerRight.current.rotation.y = THREE.MathUtils.damp(steerRight.current.rotation.y, state.steer * 0.42, 9, delta);
    if (body.current) {
      const roadPulse = state.driving ? Math.sin(clock.elapsedTime * (5 + Math.abs(state.speed))) * Math.min(0.035, Math.abs(state.speed) * 0.002) : 0;
      body.current.position.y = THREE.MathUtils.damp(body.current.position.y, roadPulse, 8, delta);
      body.current.rotation.z = THREE.MathUtils.damp(body.current.rotation.z, -state.steer * Math.min(0.07, Math.abs(state.speed) * 0.004), 7, delta);
      body.current.rotation.x = THREE.MathUtils.damp(body.current.rotation.x, state.brake ? -0.035 : Math.min(0.025, state.speed * 0.002), 7, delta);
    }
    const targetBrakeIntensity = state.brake ? 3.8 : 0.42;
    brakeMaterials.current.forEach((material) => {
      material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, targetBrakeIntensity, 12, delta);
    });
    const headlightIntensity = .08 + darkness * (1.85 + state.wetness * .72);
    headLights.current.forEach((headlight) => {
      if (!headlight) return;
      headlight.intensity = THREE.MathUtils.damp(headlight.intensity, headlightIntensity, 5.5, delta);
      headlight.distance = THREE.MathUtils.damp(headlight.distance, 11 + darkness * 13, 4, delta);
    });
  });

  return (
    <group>
      <primitive object={model} />
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
  const particleCount = mobile ? 28 : 58;
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

    emission.current += delta * driveStrength * (wetSpray * 34 + dust * 24);
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
        const backwash = 1.1 + Math.random() * (dominantDust ? 2.8 : 2.1);
        const lateral = side * (.28 + Math.random() * .72);
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

    const markStrength = Math.max(state.offRoad, state.wetness * .72, state.brake ? .9 : 0);
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
          mark.age = state.offRoad > .25 ? 11 : state.brake ? 6.5 : 8;
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

function Simulation({
  beach,
  zoneName,
  settings,
  cloudCover,
  windSpeed,
  windDirection,
  weatherCode,
  sunrise,
  sunset,
  cameraMode,
  controls,
  active,
  onStats,
  onReady,
}: SurfSceneProps) {
  const { camera } = useThree();
  const boardSpec = BOARD_SPECS[settings.board];
  const character = useMemo(() => getBreakCharacter(beach.id, zoneName), [beach.id, zoneName]);
  const mobileRenderer = useMemo(() => isMobileRenderer(), []);
  const player = useRef<THREE.Group>(null);
  const van = useRef<THREE.Group>(null);
  const position = useRef(new THREE.Vector3(0, 0, 35));
  const vanPosition = useRef(new THREE.Vector3(0, 0, 78));
  const vanHeading = useRef(-Math.PI / 2);
  const vanSpeed = useRef(0);
  const phase = useRef<GamePhase>("shore");
  const score = useRef(0);
  const combo = useRef(1);
  const rideDistance = useRef(0);
  const stance = useRef(0);
  const barrelTime = useRef(0);
  const rideStartScore = useRef(0);
  const rideScore = useRef(0);
  const rideManeuverStart = useRef(0);
  const rideGrade = useRef<GameStats["rideGrade"]>("C");
  const rideResult = useRef<"" | "clean" | "wipeout">("");
  const rideResultId = useRef(0);
  const stamina = useRef(100);
  const maxCombo = useRef(1);
  const maneuver = useRef("");
  const maneuverScore = useRef(0);
  const maneuverId = useRef(0);
  const maneuverCount = useRef(0);
  const lastManeuverAt = useRef(-10);
  const catchQuality = useRef(0.5);
  const unstableFor = useRef(0);
  const railSlip = useRef(0);
  const missedWaveUntil = useRef(0);
  const wipeoutAt = useRef(0);
  const actionLatch = useRef(false);
  const lastStatsAt = useRef(0);
  const cleanFinish = useRef(false);
  const motion = useRef<MotionState>({
    phase: "shore",
    balance: 0,
    steer: 0,
    speed: 0,
    waveQuality: 0,
    setEnergy: 0,
    wipeout: 0,
    maneuver: 0,
    maneuverSide: 0,
    stance: 0,
    barrel: 0,
    rail: 0,
    compression: 0,
    slip: 0,
    impact: 0,
    takeoff: 0,
  });
  const vanMotion = useRef<VehicleMotionState>({ speed: 0, steer: 0, driving: false, brake: false, wetness: 0, offRoad: 0 });
  const cameraTarget = useRef(new THREE.Vector3());
  const cameraLookTarget = useRef(new THREE.Vector3(0, 1, 32));
  const cameraPosition = useRef(new THREE.Vector3(0, 4.8, 44));
  const cameraOffset = useRef(new THREE.Vector3());
  const cameraOrbit = useRef(new THREE.Spherical());

  useEffect(() => {
    onReady();
  }, [onReady]);

  useFrame(({ clock }, delta) => {
    if (!player.current || !van.current) return;
    const t = clock.elapsedTime;
    const state = controls.current;
    const currentPhase = phase.current;
    const steer = THREE.MathUtils.clamp((state.right ? 1 : 0) - (state.left ? 1 : 0) + state.moveX, -1, 1);
    const move = THREE.MathUtils.clamp((state.forward ? 1 : 0) - (state.back ? 1 : 0) + state.moveY, -1, 1);
    const modeDifficulty = settings.mode === "advanced" ? 1.12 : settings.mode === "training" ? 0.62 : 0.86;
    const setState = waveSetState(t, settings.wavePeriod);
    let speed = 0;
    let balanceTarget = 0;
    let prompt = "Read the water";
    let waveQuality = 0;
    let barrelIntensity = 0;
    let railLoad = 0;
    let compression = 0;
    let catchReady = false;
    let inLineup = false;
    let takeoffQuality = 0;
    const distanceToVan = Math.hypot(position.current.x - vanPosition.current.x, position.current.z - vanPosition.current.z);
    const nearVan = currentPhase === "shore" && distanceToVan < 6.2;

    const actionPressed = state.action && !actionLatch.current;
    actionLatch.current = state.action;

    if (active) {
      if (currentPhase === "shore") {
        stance.current = THREE.MathUtils.damp(stance.current, 0, 4, delta);
        stamina.current = Math.min(100, stamina.current + delta * 12);
        speed = move * 4.4;
        position.current.z -= speed * delta;
        position.current.x += steer * 3.7 * delta;
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
        }
        if (position.current.z < 8) phase.current = "wading";
      } else if (currentPhase === "driving") {
        stance.current = THREE.MathUtils.damp(stance.current, 0, 4, delta);
        stamina.current = Math.min(100, stamina.current + delta * 15);
        const throttle = move;
        const movingForward = vanSpeed.current > 0.4;
        const braking = throttle < 0 && movingForward;
        const acceleration = braking ? 17 : throttle < 0 ? 7 : 10.5;
        if (Math.abs(throttle) > 0.01) {
          vanSpeed.current += throttle * acceleration * delta;
        } else {
          vanSpeed.current = THREE.MathUtils.damp(vanSpeed.current, 0, 1.25, delta);
        }
        vanSpeed.current = THREE.MathUtils.clamp(vanSpeed.current, -6.5, 18.5);
        const steeringAuthority = THREE.MathUtils.clamp(Math.abs(vanSpeed.current) / 3.2, 0.15, 1);
        vanHeading.current -= steer * Math.sign(vanSpeed.current || 1) * steeringAuthority * 0.72 * delta;
        vanPosition.current.x -= Math.sin(vanHeading.current) * vanSpeed.current * delta;
        vanPosition.current.z -= Math.cos(vanHeading.current) * vanSpeed.current * delta;
        const roadEdge = Math.abs(vanPosition.current.z - 78);
        if (roadEdge > 5.25) {
          vanSpeed.current = THREE.MathUtils.damp(vanSpeed.current, 0, 5.5, delta);
          vanPosition.current.z = THREE.MathUtils.clamp(vanPosition.current.z, 71.8, 84.2);
        }
        if (Math.abs(vanPosition.current.x) > 116) {
          vanPosition.current.x = THREE.MathUtils.clamp(vanPosition.current.x, -116, 116);
          vanSpeed.current = THREE.MathUtils.damp(vanSpeed.current, 0, 8, delta);
          prompt = "Road end — steer around for another pass";
        } else if (roadEdge > 4.3) {
          prompt = "Ease back onto the coast road";
        } else if (Math.abs(vanSpeed.current) < 0.8) {
          prompt = mobileRenderer ? "Use the stick to drive · DRIVE to exit" : "W to drive · A/D to steer · SPACE to exit";
        } else {
          prompt = "Cruise the shoreline · stop before exiting";
        }
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
          } else {
            prompt = "Slow to a stop before you step out";
          }
        }
      } else if (currentPhase === "wading") {
        stance.current = THREE.MathUtils.damp(stance.current, 0, 3, delta);
        stamina.current = Math.min(100, stamina.current + delta * 7);
        speed = move * 2.5;
        position.current.z -= speed * delta;
        position.current.x += steer * 2 * delta;
        prompt = "Keep moving — your board will float soon";
        if (position.current.z > 10) phase.current = "shore";
        if (position.current.z < 1) phase.current = "paddling";
      } else if (currentPhase === "paddling") {
        if (move > 0.08) stamina.current = Math.max(0, stamina.current - delta * 7.5 * move);
        else stamina.current = Math.min(100, stamina.current + delta * 10);
        const paddleEfficiency = 0.58 + stamina.current * 0.0042;
        speed = Math.max(0, move) * 4.2 * paddleEfficiency * boardSpec.paddle + Math.min(0, move) * 1.2;
        position.current.z -= speed * delta;
        position.current.z = Math.max(-52, position.current.z);
        position.current.x += (steer * 2.2 + Math.sin((settings.currentDirection * Math.PI) / 180) * settings.currentStrength * 0.35) * delta;
        inLineup = position.current.z < -18;
        const takeoffPhase = primaryWavePhaseAt(position.current.x, position.current.z, t, settings, character);
        const crestAlignment = THREE.MathUtils.smoothstep(Math.sin(takeoffPhase), -.08, .96);
        const staminaTiming = .82 + stamina.current * .0018;
        const deepWaterAssist = settings.mode === "training" && position.current.z < -34 ? .08 : 0;
        const touchTimingAssist = mobileRenderer ? .045 : 0;
        takeoffQuality = inLineup
          ? THREE.MathUtils.clamp(crestAlignment * (.38 + setState.energy * .62) * staminaTiming + deepWaterAssist + touchTimingAssist, 0, 1)
          : 0;
        const breakDemand = Math.max(0, character.power + character.steepness - 1.85) * .055;
        const takeoffThreshold = (settings.mode === "training" ? .22 : settings.mode === "advanced" ? .5 : .36) + breakDemand;
        catchReady = inLineup && t >= missedWaveUntil.current && takeoffQuality >= takeoffThreshold;
        const setCopy = setState.secondsToPeak === 0 ? "Set is here" : `Next set ${Math.ceil(setState.secondsToPeak)}s`;
        prompt = !inLineup
          ? "Paddle beyond the break"
          : t < missedWaveUntil.current
            ? "Wave rolled under — reset and read the next crest"
            : catchReady
              ? `${takeoffQuality > .76 ? "Clean shoulder" : "Takeoff window"} · CATCH NOW`
              : setState.energy < .3
                ? `Hold the lineup · ${setCopy}`
                : `Crest approaching · ${Math.round(takeoffQuality * 100)}%`;
        if (actionPressed && inLineup) {
          if (catchReady) {
            phase.current = "riding";
            rideDistance.current = 0;
            barrelTime.current = 0;
            stance.current = 0;
            unstableFor.current = (1 - takeoffQuality) * .14;
            railSlip.current = (1 - takeoffQuality) * .18;
            catchQuality.current = takeoffQuality;
            combo.current = .85 + takeoffQuality * .95;
            maxCombo.current = Math.max(maxCombo.current, combo.current);
            rideStartScore.current = score.current;
            rideManeuverStart.current = maneuverCount.current;
            score.current += Math.round(70 + takeoffQuality * 420 + setState.energy * 80);
            rideResult.current = "";
            cleanFinish.current = false;
            motion.current.takeoff = 1;
            motion.current.impact = .58 + takeoffQuality * .42;
          } else if (t >= missedWaveUntil.current) {
            stamina.current = Math.max(0, stamina.current - 6);
            missedWaveUntil.current = t + 1.2;
            catchReady = false;
          }
        }
        if (position.current.z > 1) phase.current = "wading";
      } else if (currentPhase === "riding") {
        takeoffQuality = catchQuality.current;
        const waveSpeed = (8.4 + settings.waveHeight * 2.2 + Math.min(settings.wavePeriod, 18) * 0.1) * (.88 + character.power * .12);
        const pumping = move > 0.08 && stamina.current > 1;
        if (move > 0.08) stance.current = Math.min(1, stance.current + delta * 0.72 * move);
        else if (move < -0.08) stance.current = Math.max(-1, stance.current + delta * 0.86 * move);
        else stance.current = THREE.MathUtils.damp(stance.current, 0, 1.05, delta);
        const nosePressure = Math.max(0, stance.current);
        const tailPressure = Math.max(0, -stance.current);
        stamina.current = THREE.MathUtils.clamp(stamina.current + delta * (pumping ? -14 : 6.5), 0, 100);
        const pumpBoost = pumping ? 1.4 + stamina.current * 0.017 : 0;
        speed = waveSpeed * boardSpec.speed * (0.88 + setState.energy * 0.16) + pumpBoost + nosePressure * 0.85 - tailPressure * 0.48;
        const priorWaveQuality = motion.current.waveQuality;
        const gripBase = settings.board === "performance" ? .96 : settings.board === "longboard" ? .9 : .82;
        const railDemand = Math.abs(steer) * (.72 + speed * .035) * (1 + nosePressure * .16 - tailPressure * .12) * (.92 + character.steepness * .1);
        const railGrip = gripBase + priorWaveQuality * .2 + tailPressure * .08 - nosePressure * .1;
        const rawSlip = THREE.MathUtils.smoothstep(railDemand, railGrip, railGrip + .3);
        const assistedSlip = settings.mode === "training" ? rawSlip * .52 : rawSlip;
        railSlip.current = THREE.MathUtils.damp(railSlip.current, assistedSlip, assistedSlip > railSlip.current ? 7.5 : 3.4, delta);
        railLoad = steer * (1 - railSlip.current * .38) * (1 + tailPressure * .16);
        compression = THREE.MathUtils.clamp(
          Math.abs(railLoad) * .52 + tailPressure * .3 + (pumping ? .16 : 0) + motion.current.maneuver * .32,
          0,
          1,
        );
        speed *= 1 - railSlip.current * .075;
        position.current.z += speed * delta;
        const turnGrip = 1 - railSlip.current * .46;
        const drift = Math.sign(steer) * railSlip.current * (1.15 + speed * .045);
        position.current.x += (railLoad * boardSpec.turn * (4.4 + speed * 0.18) * (1 + tailPressure * 0.38 - nosePressure * 0.12) * turnGrip + drift) * delta;
        rideDistance.current += speed * delta;
        balanceTarget =
          Math.sin(t * (1.25 + modeDifficulty * 0.7) + position.current.x * 0.13) * (0.33 + modeDifficulty * 0.28) * (1 + nosePressure * 0.12) * (.88 + character.power * .08 + character.variability * .1) / boardSpec.stability +
          Math.sin(t * 3.1) * settings.currentStrength * 0.045 -
          steer * (0.22 + tailPressure * 0.08) +
          stance.current * 0.07 +
          Math.sin(t * 8.2) * railSlip.current * .16 +
          Math.sign(steer) * railSlip.current * .1;
        const balanceError = Math.abs(state.balance - balanceTarget);
        const failThreshold = (settings.mode === "training" ? 1.08 : settings.mode === "advanced" ? 0.64 : 0.82) * Math.sqrt(boardSpec.stability);
        unstableFor.current = balanceError > failThreshold ? unstableFor.current + delta : Math.max(0, unstableFor.current - delta * 1.8);
        const wavePhase = Math.sin(primaryWavePhaseAt(position.current.x, position.current.z, t, settings, character));
        const lineMatch = Math.abs(character.peel) < .18
          ? 1 - Math.abs(steer) * .08
          : THREE.MathUtils.clamp(.58 + steer * character.peel * .42, .2, 1);
        const sectionQuality = 1 - character.variability * (.12 + Math.abs(Math.sin(position.current.x * .11 + t * .17)) * .18);
        waveQuality = THREE.MathUtils.clamp(
          (wavePhase + 1) * .36 + setState.energy * .14 + catchQuality.current * .08 + lineMatch * .16 + sectionQuality * .08,
          0,
          1,
        );
        const controlQuality = Math.max(0, 1 - balanceError / 1.2) * (1 - railSlip.current * .36);
        const barrelThreshold = .8 - character.hollow * .18;
        const inBarrel = waveQuality > barrelThreshold && controlQuality > .72 && Math.abs(steer) < .68 && stance.current > -.58;
        barrelIntensity = inBarrel
          ? THREE.MathUtils.clamp((waveQuality - barrelThreshold + .12) * (1.75 + character.hollow) + controlQuality * .16, 0, 1)
          : 0;
        if (inBarrel) {
          barrelTime.current += delta;
          combo.current = Math.min(8, combo.current + delta * 0.23);
          score.current += (26 + barrelTime.current * 4) * controlQuality * combo.current * delta;
        }
        const turnBonus = Math.abs(railLoad) * (12 + compression * 5) * (1 - railSlip.current * .42);
        combo.current = Math.min(8, combo.current + controlQuality * delta * 0.11 + Math.abs(railLoad) * (1 - railSlip.current) * delta * 0.15 + (pumping ? delta * 0.04 : 0));
        maxCombo.current = Math.max(maxCombo.current, combo.current);
        score.current += (14 + turnBonus + waveQuality * 18) * controlQuality * combo.current * lineMatch * delta;
        if (actionPressed && t - lastManeuverAt.current > 0.85 && stamina.current > 7 && balanceError < failThreshold * 0.94 && railSlip.current < .78) {
          const rail = Math.abs(steer);
          let name = "High Line";
          let base = 150;
          if (nosePressure > (settings.board === "longboard" ? 0.42 : 0.62) && rail < 0.32 && waveQuality > 0.55) {
            name = "Nose Ride";
            base = settings.board === "longboard" ? 440 : 340;
          } else if (tailPressure > 0.58 && rail > 0.42 && waveQuality > 0.54) {
            name = "Tail Release";
            base = 390;
          } else if (waveQuality > 0.72 && rail > 0.42) {
            name = "Lip Snap";
            base = 360;
          } else if (waveQuality > 0.68) {
            name = "Foam Floater";
            base = 305;
          } else if (waveQuality < 0.32 && rail > 0.38) {
            name = "Pocket Cutback";
            base = 285;
          } else if (rail > 0.52) {
            name = "Rail Carve";
            base = 230;
          } else if (pumping) {
            name = "Power Pump";
            base = 175;
          }
          const points = Math.round(base * boardSpec.score * (0.62 + controlQuality * 0.48) * (0.88 + setState.energy * 0.28) * combo.current * (1 + barrelIntensity * 0.12));
          score.current += points;
          combo.current = Math.min(8, combo.current + 0.42 + controlQuality * 0.22);
          maxCombo.current = Math.max(maxCombo.current, combo.current);
          stamina.current = Math.max(0, stamina.current - 8);
          maneuver.current = name;
          maneuverScore.current = points;
          maneuverCount.current += 1;
          maneuverId.current += 1;
          lastManeuverAt.current = t;
          motion.current.maneuver = 1;
          motion.current.maneuverSide = steer || (state.balance >= 0 ? 1 : -1);
          motion.current.impact = 1;
        }
        prompt = actionPressed && railSlip.current >= .78
          ? "Fins released — reconnect the rail before the next move"
          : balanceError > failThreshold * 0.76
          ? "Shift your weight toward the marker"
          : railSlip.current > .55
            ? "Rail releasing — soften the turn or load the tail"
          : inBarrel
            ? `Locked in the barrel · ${barrelTime.current.toFixed(1)}s`
          : steer
            ? "Hold the rail · TRICK / SPACE to release a turn"
            : pumping
              ? "Move toward the nose · pumping for speed"
              : move < -0.08
                ? "Tail pressure · tighter turning response"
                : "W nose / pump · S tail / control · SPACE maneuver";
        if (unstableFor.current > (settings.mode === "training" ? 1.15 : 0.58)) {
          phase.current = "wipeout";
          wipeoutAt.current = t;
          rideScore.current = Math.max(0, Math.round(score.current - rideStartScore.current));
          rideGrade.current = sessionGrade(rideScore.current, rideDistance.current, maneuverCount.current - rideManeuverStart.current);
          rideResult.current = "wipeout";
          rideResultId.current += 1;
          combo.current = 1;
          railSlip.current = 1;
          motion.current.impact = .45;
        } else if (position.current.z > 11 + (character.length - 1) * 11) {
          score.current += 750 + rideDistance.current * 11;
          rideScore.current = Math.max(0, Math.round(score.current - rideStartScore.current));
          rideGrade.current = sessionGrade(rideScore.current, rideDistance.current, maneuverCount.current - rideManeuverStart.current);
          rideResult.current = "clean";
          rideResultId.current += 1;
          cleanFinish.current = true;
          phase.current = "shore";
          position.current.z = 17;
        }
      } else if (currentPhase === "wipeout") {
        stamina.current = Math.min(100, stamina.current + delta * 14);
        speed = 0;
        prompt = "Wipeout — reset in the foam";
        motion.current.wipeout = Math.min(1.8, t - wipeoutAt.current);
        if (t - wipeoutAt.current > 2.25) {
          phase.current = "paddling";
          position.current.z = -22;
          unstableFor.current = 0;
          motion.current.wipeout = 0;
        }
      }
    }

    const landRange = phase.current === "shore" || phase.current === "driving";
    position.current.x = THREE.MathUtils.clamp(position.current.x, landRange ? -118 : -52, landRange ? 118 : 52);
    const waterY = waveHeightAt(position.current.x, position.current.z, t, settings, character);
    const isWater = phase.current !== "shore";
    if (phase.current !== "riding") {
      railSlip.current = THREE.MathUtils.damp(railSlip.current, 0, 4.2, delta);
      railLoad = 0;
      compression = 0;
    }
    const rebound = Math.sin((1 - motion.current.impact) * Math.PI) * motion.current.impact;
    const playerY = isWater
      ? waterY + (phase.current === "riding" ? 0.16 - compression * .032 + rebound * .075 : 0.04)
      : 0;
    player.current.position.set(position.current.x, playerY, position.current.z);
    player.current.visible = phase.current !== "driving";
    player.current.rotation.y = THREE.MathUtils.damp(
      player.current.rotation.y,
      phase.current === "riding" ? railLoad * -.32 - Math.sign(railLoad) * railSlip.current * .12 : steer * -.2,
      7,
      delta,
    );
    player.current.rotation.z = THREE.MathUtils.damp(
      player.current.rotation.z,
      phase.current === "riding" ? -state.balance * 0.17 : 0,
      7,
      delta,
    );

    motion.current.phase = phase.current;
    motion.current.balance = state.balance;
    motion.current.steer = steer;
    motion.current.speed = Math.abs(speed);
    motion.current.waveQuality = THREE.MathUtils.damp(motion.current.waveQuality, waveQuality, 5, delta);
    motion.current.setEnergy = setState.energy;
    motion.current.maneuver = Math.max(0, motion.current.maneuver - delta * 1.72);
    motion.current.stance = stance.current;
    motion.current.barrel = THREE.MathUtils.damp(motion.current.barrel, barrelIntensity, 6, delta);
    motion.current.rail = THREE.MathUtils.damp(motion.current.rail, railLoad, 8, delta);
    motion.current.compression = THREE.MathUtils.damp(motion.current.compression, compression, 7, delta);
    motion.current.slip = THREE.MathUtils.damp(motion.current.slip, railSlip.current, 8, delta);
    motion.current.impact = Math.max(0, motion.current.impact - delta * 1.9);
    motion.current.takeoff = Math.max(0, motion.current.takeoff - delta * 1.55);
    van.current.position.copy(vanPosition.current);
    van.current.rotation.y = vanHeading.current;
    vanMotion.current.speed = vanSpeed.current;
    vanMotion.current.steer = steer;
    vanMotion.current.driving = phase.current === "driving";
    vanMotion.current.brake = phase.current === "driving" && state.back && vanSpeed.current > 0.3;
    vanMotion.current.wetness = weatherWetness(weatherCode);
    vanMotion.current.offRoad = THREE.MathUtils.smoothstep(Math.abs(vanPosition.current.z - 78), 3.9, 6.1);

    const riding = phase.current === "riding";
    const paddling = phase.current === "paddling" || phase.current === "wading";
    const driving = phase.current === "driving";
    if (driving) {
      const forwardX = -Math.sin(vanHeading.current);
      const forwardZ = -Math.cos(vanHeading.current);
      const rightX = Math.cos(vanHeading.current);
      const rightZ = -Math.sin(vanHeading.current);
      if (cameraMode === "immersive") {
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
    } else {
      const barrelCamera = riding ? motion.current.barrel : 0;
      if (cameraMode === "immersive") {
        cameraPosition.current.set(
          position.current.x + (riding ? steer * -1.1 - barrelCamera * .8 : .68),
          playerY + (riding ? 1.82 - barrelCamera * .26 : paddling ? 2.2 : 3.05),
          position.current.z + (riding ? -4.15 + barrelCamera * .82 : paddling ? 4.8 : 5.8),
        );
        cameraTarget.current.set(
          position.current.x + (riding ? steer * .28 : 0),
          playerY + (riding ? .72 : paddling ? .42 : 1.18),
          position.current.z + (riding ? 4.65 : paddling ? -3.8 : -3.2),
        );
      } else if (cameraMode === "cinematic") {
        const side = motion.current.maneuverSide || 1;
        cameraPosition.current.set(
          position.current.x + side * (riding ? 7.2 : paddling ? 6 : 5.8),
          playerY + (riding ? 2.45 : paddling ? 3.6 : 3.1),
          position.current.z + (riding ? -1.6 : paddling ? 3.4 : 4.5),
        );
        cameraTarget.current.set(
          position.current.x - side * (riding ? .5 : .16),
          playerY + (riding ? .82 : paddling ? .52 : 1.02),
          position.current.z + (riding ? 2.6 : paddling ? -2.2 : -1.8),
        );
      } else {
        cameraPosition.current.set(
          position.current.x + (riding ? steer * -1.7 - barrelCamera * 1.1 : 0),
          playerY + (riding ? 3.2 - barrelCamera * .72 : 4.9),
          position.current.z + (riding ? -8.4 + barrelCamera * 1.45 : paddling ? 9.5 : 10.5),
        );
        cameraTarget.current.set(position.current.x, playerY + .9 - barrelCamera * .2, position.current.z + (riding ? 5.4 : -3));
      }
    }
    const lookScale = cameraMode === "cinematic" ? .18 : cameraMode === "immersive" ? (riding ? .24 : .58) : riding ? .34 : driving ? .76 : 1;
    cameraOffset.current.copy(cameraPosition.current).sub(cameraTarget.current);
    cameraOrbit.current.setFromVector3(cameraOffset.current);
    cameraOrbit.current.theta += state.lookYaw * 1.68 * lookScale;
    cameraOrbit.current.phi = THREE.MathUtils.clamp(
      cameraOrbit.current.phi + state.lookPitch * .62 * lookScale,
      .38,
      Math.PI * .49,
    );
    cameraOffset.current.setFromSpherical(cameraOrbit.current);
    cameraPosition.current.copy(cameraTarget.current).add(cameraOffset.current);
    const cameraShakeBase = riding
      ? motion.current.maneuver * 0.1 + motion.current.takeoff * .04 + motion.current.impact * .075 + motion.current.slip * .045 + motion.current.barrel * 0.035 + Math.max(0, speed - 11) * 0.003
      : phase.current === "wipeout" ? Math.max(0, 1 - motion.current.wipeout * 0.55) * 0.16 : 0;
    const cameraShake = cameraShakeBase * (cameraMode === "cinematic" ? .32 : cameraMode === "immersive" ? 1.08 : 1);
    cameraPosition.current.x += Math.sin(t * 31) * cameraShake;
    cameraPosition.current.y += Math.cos(t * 37) * cameraShake * 0.55;
    const cameraResponse = cameraMode === "cinematic" ? 2.15 : cameraMode === "immersive" ? 4.35 : driving ? 3.8 : riding ? 3.1 : 2.4;
    camera.position.lerp(cameraPosition.current, 1 - Math.exp(-delta * cameraResponse));
    cameraLookTarget.current.lerp(cameraTarget.current, 1 - Math.exp(-delta * (cameraMode === "cinematic" ? 2.45 : 4.8)));
    camera.lookAt(cameraLookTarget.current);
    const rollScale = cameraMode === "cinematic" ? .48 : cameraMode === "immersive" ? 1.16 : 1;
    camera.rotateZ((riding ? -motion.current.rail * .022 - motion.current.maneuverSide * motion.current.maneuver * .025 - Math.sign(motion.current.rail) * motion.current.slip * .012 : driving ? vanMotion.current.steer * -.012 : 0) * rollScale);
    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = cameraMode === "cinematic"
        ? riding ? 52 + motion.current.maneuver * 1.4 : driving ? 54 : 51
        : cameraMode === "immersive"
          ? driving
            ? 70 + Math.min(7, Math.abs(vanSpeed.current) * .28)
            : riding
              ? 68 + Math.min(10, Math.max(0, speed - 7) * .82) + motion.current.maneuver * 2.8
              : paddling ? 62 : 64
          : driving
            ? 59 + Math.min(5, Math.abs(vanSpeed.current) * .2)
            : riding
              ? 58 + Math.min(8, Math.max(0, speed - 7) * .72) + motion.current.maneuver * 2.4
              : paddling ? 56 : 58;
      const nextFov = THREE.MathUtils.damp(camera.fov, targetFov, 4.5, delta);
      if (Math.abs(camera.fov - nextFov) > 0.005) {
        const focalLength = 0.5 * camera.getFilmHeight() / Math.tan(THREE.MathUtils.degToRad(nextFov * 0.5));
        camera.setFocalLength(focalLength);
      }
    }

    if (active && t - lastStatsAt.current > 0.11) {
      lastStatsAt.current = t;
      onStats({
        phase: phase.current,
        score: Math.round(score.current),
        combo: Number(combo.current.toFixed(1)),
        rideDistance: Number(rideDistance.current.toFixed(1)),
        speed: Math.max(0, speed),
        balance: state.balance,
        balanceTarget,
        waveQuality,
        railLoad: motion.current.rail,
        railGrip: 1 - motion.current.slip,
        stance: stance.current,
        barrelTime: Number(barrelTime.current.toFixed(1)),
        barrelIntensity: motion.current.barrel,
        stamina: Math.round(stamina.current),
        setEnergy: setState.energy,
        nextSetSeconds: setState.secondsToPeak,
        maneuver: maneuver.current,
        maneuverScore: maneuverScore.current,
        maneuverId: maneuverId.current,
        maneuverCount: maneuverCount.current,
        maxCombo: Number(maxCombo.current.toFixed(1)),
        grade: sessionGrade(score.current, rideDistance.current, maneuverCount.current),
        rideScore: rideScore.current,
        rideManeuvers: Math.max(0, maneuverCount.current - rideManeuverStart.current),
        rideGrade: rideGrade.current,
        rideResult: rideResult.current,
        rideResultId: rideResultId.current,
        vehicleMode: phase.current === "driving",
        nearVan,
        inLineup,
        catchReady,
        takeoffQuality,
        prompt,
      });
    }
  });

  const timeToHour = (value: string, fallback: number) => {
    if (!value) return fallback;
    const clock = value.includes("T") ? value.split("T")[1] : value;
    const [hours, minutes] = clock.split(":").map(Number);
    return Number.isFinite(hours) ? hours + (minutes || 0) / 60 : fallback;
  };
  const sunriseHour = timeToHour(sunrise, 6);
  const sunsetHour = timeToHour(sunset, 18);
  const hourAngle = ((settings.timeOfDay - sunriseHour) / Math.max(8, sunsetHour - sunriseHour)) * Math.PI;
  const solarElevation = Math.sin(hourAngle);
  const sunHeight = Math.max(-0.08, solarElevation);
  const sunX = Math.cos(hourAngle) * 160;
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
  const celestialSunPosition: [number, number, number] = [sunX, solarElevation * 150, -120];
  const lightingSunPosition: [number, number, number] = [sunX * .22, Math.max(6, sunHeight * 44), -30];
  const oceanSunPosition: [number, number, number] = [sunX * .22, solarElevation * 44, -30];

  return (
    <>
      <color attach="background" args={[backgroundColor]} />
      <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
      <Sky
        distance={450000}
        sunPosition={[sunX, Math.max(-8, solarElevation * 150), -120]}
        inclination={0.49}
        azimuth={0.24}
        turbidity={5.2 + cloudCover * 0.025 + atmosphereBoost}
        rayleigh={sunHeight < 0.2 ? 3.8 : 1.7}
        mieCoefficient={0.008}
        mieDirectionalG={0.85}
      />
      <CoastalAtmosphere
        cloudCover={cloudCover}
        windSpeed={windSpeed}
        light={light}
        sunHeight={solarElevation}
        sunPosition={celestialSunPosition}
        hazeColor={fogColor}
      />
      <WeatherEffects weatherCode={weatherCode} windSpeed={windSpeed} windDirection={windDirection} />
      <ambientLight intensity={(0.18 + light * 0.42) * (.94 + cloudFactor * .08)} color={sunHeight < 0.16 ? "#8eb4cf" : "#d8f0ee"} />
      <hemisphereLight args={["#a9d9dc", "#5c4431", (0.38 + light * 0.55) * (.93 + cloudFactor * .09)]} />
      <directionalLight
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
      <directionalLight
        position={[-sunX * .18, 28, 34]}
        intensity={moonlightStrength * .34 * (1 - cloudFactor * .36)}
        color="#a9d7e8"
      />
      <Ocean
        settings={settings}
        character={character}
        light={light}
        cloudCover={cloudCover}
        windSpeed={windSpeed}
        sunPosition={oceanSunPosition}
        sunColor={sunLightColor}
      />
      <BeachLife beach={beach} windSpeed={windSpeed} weatherCode={weatherCode} light={light} playerPosition={position} />
      <ShorelineWash settings={settings} light={light} windSpeed={windSpeed} />
      <FootprintTrail motion={motion} targetPosition={position} />
      <BoardTrack motion={motion} target={player} settings={settings} character={character} mobile={mobileRenderer} />
      <VehicleSurfaceEffects motion={vanMotion} targetPosition={vanPosition} heading={vanHeading} mobile={mobileRenderer} />
      <group ref={player}>
        <BreakingWave motion={motion} settings={settings} character={character} light={light} cloudCover={cloudCover} />
        <WaterInteraction motion={motion} mobile={mobileRenderer} />
        <SurferModel motion={motion} boardType={settings.board} />
      </group>
      <group ref={van}>
        <SurfVan motion={vanMotion} darkness={vanDarkness} />
      </group>
      {weather.kind === "none" && !weather.fog && !weather.storm && (
        <>
          <Bird offset={0} speed={1 + windSpeed * 0.008} />
          <Bird offset={7} speed={0.82 + windSpeed * 0.006} />
          <Bird offset={15} speed={1.15 + windSpeed * 0.007} />
        </>
      )}
      {sunHeight < 0.22 && (
        <Sparkles count={70} scale={[180, 48, 140]} position={[0, 20, -50]} size={0.7} speed={0.05} opacity={Math.max(.06, .45 * (1 - cloudFactor * .86))} color="#dcefff" />
      )}
    </>
  );
}

export default function SurfScene(props: SurfSceneProps) {
  const mobileRenderer = isMobileRenderer();
  return (
    <Canvas
      className="surf-canvas"
      shadows={mobileRenderer ? false : "percentage"}
      dpr={[1, mobileRenderer ? 1.2 : 1.65]}
      camera={{ position: [0, 4.8, 44], fov: 58, near: 0.08, far: 650 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMappingExposure = 1.08;
      }}
    >
      <Simulation {...props} />
    </Canvas>
  );
}
