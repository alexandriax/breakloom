"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoundedBox, Sky, Sparkles, useGLTF, useTexture } from "@react-three/drei";
import { MutableRefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Beach, CoastBiome } from "@/lib/beaches";
import { getCoastBiome } from "@/lib/beaches";
import type { BoardType, GamePhase, GameStats, SessionSettings } from "@/lib/game";
import { BOARD_SPECS, sessionGrade, waveHeightAt, waveSetState } from "@/lib/game";

export type ControlState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  action: boolean;
  balance: number;
};

type SurfSceneProps = {
  beach: Beach;
  settings: SessionSettings;
  cloudCover: number;
  windSpeed: number;
  sunrise: string;
  sunset: string;
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
};

type VehicleMotionState = {
  speed: number;
  steer: number;
  driving: boolean;
  brake: boolean;
};

function isMobileRenderer() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0 || window.innerWidth <= 820;
}

const OCEAN_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uPeriod;
  uniform float uCurrent;
  uniform float uDirection;
  uniform float uTide;
  uniform float uWind;
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
    vec3 p = position;
    float angularSpeed = PI * 2.0 / max(4.0, uPeriod);
    float angle = radians(uDirection);
    vec2 currentDir = vec2(cos(angle), sin(angle));
    float curve = sin(angle) * .0019 * origin.x * origin.x;
    vec2 curvedOrigin = vec2(origin.x, origin.y + curve);
    float shore = .72 + smoothstep(-85.0, 8.0, origin.y) * .78;
    float shallowCompression = mix(1.0, .76, smoothstep(-32.0, 9.0, origin.y));
    float setEnergy = setEnvelope();
    float setLift = .78 + setEnergy * .34;
    float amplitude = max(.12, uHeight * .62);
    float windChop = clamp(uWind / 24.0, .12, 1.45);
    float currentBend = clamp(uCurrent / 4.0, 0.0, 1.0);

    float primary = gerstner(
      p,
      curvedOrigin,
      normalize(vec2(.095 + currentDir.x * .035, 1.0)),
      33.0 * shallowCompression,
      amplitude * .64 * shore * setLift,
      .78,
      angularSpeed * 5.4,
      0.0
    );
    float secondary = gerstner(
      p,
      origin,
      normalize(vec2(-.16, 1.0)),
      20.3,
      amplitude * .22,
      .58,
      angularSpeed * 7.1,
      1.7
    );
    float crossSwell = gerstner(
      p,
      origin,
      normalize(vec2(1.0, .68) + currentDir * (.12 + currentBend * .12)),
      47.5,
      amplitude * .11,
      .42,
      -angularSpeed * 2.7,
      0.0
    );
    float windWave = gerstner(
      p,
      origin,
      normalize(vec2(-.72, .69)),
      mix(8.5, 5.4, windChop / 1.45),
      .035 + windChop * .065,
      .34,
      1.7 + windChop * 1.2,
      2.4
    );
    float capillary = sin(origin.x * 1.35 + origin.y * .78 + uTime * (2.2 + windChop)) * (.018 + windChop * .018);
    p.z += uTide * .3 + capillary;

    vHeight = p.z;
    vCrest = primary * shore;
    vBreaker = smoothstep(-18.0, 12.0, origin.y) * smoothstep(.48, .96, primary * .5 + .5) * setLift;
    vChop = abs(secondary) * .38 + abs(crossSwell) * .24 + abs(windWave) * windChop;
    vSurface = origin;
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
  light,
  cloudCover,
  windSpeed,
  sunPosition,
  sunColor,
}: {
  settings: SessionSettings;
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
      uSunDirection: { value: new THREE.Vector3(-.3, .8, -.45).normalize() },
      uSunColor: { value: new THREE.Color("#fff0ca") },
    }),
    [],
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
    vec3 p = vec3(position.x, faceHeight, 2.08 - curl * (1.45 + faceHeight * .38));
    p.x += uSide * curl * .58 + sin(seed * 41.0 + uTime * 2.7) * age * .48;
    p.y += sin(position.x * .42 + uTime * 2.1) * .055 * (.35 + uEnergy);
    p.y += age * (.28 + uEnergy * .8);
    p.z -= age * (.18 + curl * .32);
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
  light,
  cloudCover,
}: {
  motion: MutableRefObject<MotionState>;
  settings: SessionSettings;
  light: number;
  cloudCover: number;
}) {
  const group = useRef<THREE.Group>(null);
  const faceMaterial = useRef<THREE.ShaderMaterial>(null);
  const foamMaterial = useRef<THREE.ShaderMaterial>(null);
  const lineSide = useRef(1);
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
  const foamPositions = useMemo(() => {
    const positions = new Float32Array(58 * 3);
    for (let index = 0; index < 58; index += 1) {
      positions[index * 3] = -12 + (index / 57) * 24;
      positions[index * 3 + 1] = ((index * 37) % 59) / 59;
    }
    return positions;
  }, []);

  useFrame(({ clock }, delta) => {
    if (!group.current || !faceMaterial.current || !foamMaterial.current) return;
    const state = motion.current;
    const riding = state.phase === "riding";
    if (riding && Math.abs(state.steer) > .12) lineSide.current = Math.sign(state.steer);
    const targetCurl = riding
      ? THREE.MathUtils.clamp(state.waveQuality * .24 + state.barrel * .92 + state.maneuver * .12, .08, 1.16)
      : 0;
    const targetOpacity = riding
      ? THREE.MathUtils.clamp(.32 + state.waveQuality * .25 + state.barrel * .3, .32, .88)
      : 0;
    const values = faceMaterial.current.uniforms;
    values.uTime.value = clock.elapsedTime;
    values.uWaveHeight.value = THREE.MathUtils.damp(values.uWaveHeight.value, settings.waveHeight, 3.5, delta);
    values.uEnergy.value = THREE.MathUtils.damp(values.uEnergy.value, state.setEnergy, 4, delta);
    values.uCurl.value = THREE.MathUtils.damp(values.uCurl.value, targetCurl, 5.5, delta);
    values.uSide.value = THREE.MathUtils.damp(values.uSide.value, lineSide.current, 3.2, delta);
    values.uLight.value = light;
    values.uCloud.value = cloudCover / 100;
    values.uOpacity.value = THREE.MathUtils.damp(values.uOpacity.value, targetOpacity, riding ? 7 : 4, delta);
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

    const rideLean = state.balance * 0.12 + state.maneuverSide * state.maneuver * 0.12;
    pose("Pelvis", riding ? -0.08 + state.stance * 0.045 : walking ? step * 0.025 : 0, riding ? state.steer * -0.08 : 0, riding ? rideLean * 0.35 : 0, 7);
    pose("Torso", paddle ? -0.1 : riding ? 0.18 - state.barrel * 0.13 : walking ? -step * 0.018 : 0, riding ? state.maneuverSide * state.maneuver * 0.16 : 0, riding ? rideLean : 0, 7);
    pose("Head", paddle ? -0.24 : riding ? -0.12 + state.barrel * 0.08 : 0, riding ? state.steer * 0.12 : 0, riding ? -rideLean * 0.4 : 0, 8);

    pose(
      "UpperArm.L",
      wipeout ? 1.2 : paddle ? stroke * 1.18 : riding ? -0.48 - state.maneuver * 0.22 : step * 0.56,
      riding ? -0.12 + state.steer * 0.12 : 0,
      riding ? 1.03 + state.maneuver * 0.32 : paddle ? 0.14 : 0.08,
      9,
    );
    pose(
      "UpperArm.R",
      wipeout ? -1.1 : paddle ? -stroke * 1.18 : riding ? 0.48 + state.maneuver * 0.22 : -step * 0.56,
      riding ? 0.12 + state.steer * 0.12 : 0,
      riding ? -1.03 - state.maneuver * 0.32 : paddle ? -0.14 : -0.08,
      9,
    );
    pose("LowerArm.L", paddle ? Math.max(0, -stroke) * -0.72 : riding ? -0.42 : wipeout ? 0.8 : 0, 0, riding ? 0.12 : 0, 10);
    pose("LowerArm.R", paddle ? Math.max(0, stroke) * 0.72 : riding ? 0.42 : wipeout ? -0.8 : 0, 0, riding ? -0.12 : 0, 10);
    pose("Hand.L", 0, riding ? -0.16 : 0, riding ? 0.08 : 0, 10);
    pose("Hand.R", 0, riding ? 0.16 : 0, riding ? -0.08 : 0, 10);

    pose("UpperLeg.L", riding ? -0.74 - state.stance * 0.12 : walking ? step * 0.62 : paddle ? -0.08 : 0, 0, riding ? 0.17 : 0, 8);
    pose("UpperLeg.R", riding ? 0.6 - state.stance * 0.12 : walking ? -step * 0.62 : paddle ? 0.08 : 0, 0, riding ? -0.17 : 0, 8);
    pose("LowerLeg.L", riding ? 1.02 : walking ? Math.max(0, -step) * 0.56 : paddle ? 0.08 : 0, 0, 0, 9);
    pose("LowerLeg.R", riding ? -0.92 : walking ? Math.max(0, step) * -0.56 : paddle ? -0.08 : 0, 0, 0, 9);
    pose("Foot.L", riding ? -0.18 : 0, riding ? 0.08 : 0, riding ? -0.08 : 0, 9);
    pose("Foot.R", riding ? 0.18 : 0, riding ? -0.08 : 0, riding ? 0.08 : 0, 9);
  });

  return <primitive object={model} scale={0.78} />;
}

useGLTF.preload(SURFER_MODEL_URL);

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

    const bodyRotationX = paddle ? Math.PI / 2 - 0.1 : riding ? -0.18 : 0;
    body.current.rotation.x = THREE.MathUtils.damp(body.current.rotation.x, bodyRotationX, 8, delta);
    body.current.rotation.z = THREE.MathUtils.damp(
      body.current.rotation.z,
      wipeout ? 1.7 : riding ? -state.balance * 0.34 + state.maneuverSide * state.maneuver * 0.34 : 0,
      7,
      delta,
    );
    body.current.rotation.y = THREE.MathUtils.damp(
      body.current.rotation.y,
      riding ? state.maneuverSide * state.maneuver * 0.74 : 0,
      9,
      delta,
    );
    body.current.position.y = THREE.MathUtils.damp(body.current.position.y, paddle ? 0.44 : riding ? 0.84 : 1.02, 8, delta);
    body.current.position.z = THREE.MathUtils.damp(body.current.position.z, riding ? state.stance * 0.46 : 0, 7, delta);
    rig.current.rotation.z = wipeout ? state.wipeout * 2.1 : 0;

    board.current.rotation.z = THREE.MathUtils.damp(
      board.current.rotation.z,
      shore ? -0.12 : riding ? state.steer * -0.13 - state.maneuverSide * state.maneuver * 0.22 : 0,
      7,
      delta,
    );
    board.current.rotation.y = THREE.MathUtils.damp(
      board.current.rotation.y,
      riding ? state.maneuverSide * state.maneuver * 0.52 : 0,
      9,
      delta,
    );
    board.current.position.x = THREE.MathUtils.damp(board.current.position.x, shore ? 0.68 : 0, 7, delta);
    board.current.position.y = THREE.MathUtils.damp(board.current.position.y, shore ? 1.14 : 0.16, 7, delta);
    board.current.rotation.x = THREE.MathUtils.damp(
      board.current.rotation.x,
      shore ? Math.PI / 2 - 0.08 : riding ? state.stance * -0.035 + state.barrel * 0.025 : 0,
      7,
      delta,
    );

  });

  const boardSpec = BOARD_SPECS[boardType];
  const finXs = boardType === "performance" ? [-0.16, 0, 0.16] : boardType === "fish" ? [-0.19, 0.19] : [0];
  return (
    <group ref={rig}>
      <group ref={board} position={[0, 0.16, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.13]} castShadow>
          <capsuleGeometry args={[boardSpec.width, boardSpec.length, 8, 24]} />
          <meshPhysicalMaterial color={boardSpec.color} roughness={0.26} clearcoat={0.86} clearcoatRoughness={0.13} />
        </mesh>
        <mesh position={[0, 0.06, -0.08]} rotation={[Math.PI / 2, 0, 0]} scale={[0.76, 0.72, 0.14]}>
          <capsuleGeometry args={[boardSpec.width * 0.86, boardSpec.length * 0.86, 5, 20]} />
          <meshStandardMaterial color={boardSpec.accent} roughness={0.58} />
        </mesh>
        <mesh position={[0, 0.1, -0.35]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[boardSpec.width * 0.34, boardSpec.width * 0.43, 28]} />
          <meshBasicMaterial color="#f7f2e8" transparent opacity={0.72} />
        </mesh>
        {finXs.map((x) => (
          <mesh key={x} position={[x, -0.02, boardSpec.length * 0.56]} rotation={[0.15, 0, 0]}>
            <boxGeometry args={[0.045, boardType === "longboard" ? 0.39 : 0.28, boardType === "longboard" ? 0.3 : 0.21]} />
            <meshStandardMaterial color="#f3efe6" roughness={0.46} />
          </mesh>
        ))}
      </group>

      <group ref={body} position={[0, 1.02, 0]}>
        <PremiumSurferBody motion={motion} />
      </group>
    </group>
  );
}

const SPRAY_PARTICLES = 48;

function WaterInteraction({ motion }: { motion: MutableRefObject<MotionState> }) {
  const wake = useRef<THREE.Group>(null);
  const wakeMaterials = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const spray = useRef<THREE.Points>(null);
  const sprayMaterial = useRef<THREE.PointsMaterial>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(SPRAY_PARTICLES * 3);
    for (let index = 0; index < SPRAY_PARTICLES; index += 1) values[index * 3 + 1] = -20;
    return values;
  }, []);
  const velocities = useRef(new Float32Array(SPRAY_PARTICLES * 3));
  const life = useRef(new Float32Array(SPRAY_PARTICLES));
  const cursor = useRef(0);
  const emission = useRef(0);
  const previousManeuver = useRef(0);
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

  useEffect(() => () => particleTexture.dispose(), [particleTexture]);

  useFrame(({ clock }, delta) => {
    const state = motion.current;
    const riding = state.phase === "riding";
    const paddling = state.phase === "paddling" || state.phase === "wading";
    if (wake.current) {
      wake.current.visible = riding || paddling;
      const speedScale = THREE.MathUtils.clamp(state.speed / 13, 0.2, 1.35);
      wake.current.scale.z = THREE.MathUtils.damp(wake.current.scale.z, paddling ? 0.56 : speedScale, 6, delta);
      wake.current.position.y = Math.sin(clock.elapsedTime * 7.5) * 0.018;
    }
    const targetOpacity = riding ? 0.2 + Math.min(0.38, state.speed * 0.018) : paddling ? 0.16 : 0;
    wakeMaterials.current.forEach((material, index) => {
      if (!material) return;
      const stagger = index > 1 ? 0.68 : 1;
      material.opacity = THREE.MathUtils.damp(material.opacity, targetOpacity * stagger, 7, delta);
    });
    const positionAttribute = spray.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const particlePositions = positionAttribute?.array as Float32Array | undefined;

    const emit = (count: number, impact: boolean) => {
      if (!particlePositions) return;
      for (let particle = 0; particle < count; particle += 1) {
        const index = cursor.current++ % SPRAY_PARTICLES;
        const offset = index * 3;
        const railSide = Math.abs(state.steer) > 0.12 ? -Math.sign(state.steer) : Math.random() > 0.5 ? 1 : -1;
        particlePositions[offset] = railSide * (0.22 + Math.random() * (impact ? 0.5 : 0.22));
        particlePositions[offset + 1] = 0.08 + Math.random() * 0.18;
        particlePositions[offset + 2] = impact ? Math.random() * 0.7 - 0.15 : -0.32 - Math.random() * 0.8;
        velocities.current[offset] = railSide * (0.75 + Math.random() * (impact ? 2.7 : 1.25));
        velocities.current[offset + 1] = 0.65 + Math.random() * (impact ? 2.6 : 1.35) + state.barrel * 0.5;
        velocities.current[offset + 2] = -(1.4 + Math.random() * (impact ? 3.6 : 2.2));
        life.current[index] = impact ? 0.9 + Math.random() * 0.35 : 0.46 + Math.random() * 0.38;
      }
    };

    if (riding) {
      emission.current += delta * (Math.abs(state.steer) * 18 + state.barrel * 12 + Math.max(0, state.speed - 9) * 0.8);
      if (emission.current >= 1) {
        const count = Math.min(5, Math.floor(emission.current));
        emit(count, false);
        emission.current -= count;
      }
      if (state.maneuver > 0.82 && previousManeuver.current <= 0.82) emit(18, true);
    }
    previousManeuver.current = state.maneuver;

    if (!particlePositions) return;
    for (let index = 0; index < SPRAY_PARTICLES; index += 1) {
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
    if (sprayMaterial.current) sprayMaterial.current.opacity = THREE.MathUtils.damp(sprayMaterial.current.opacity, riding ? 0.88 : 0, 7, delta);
  });

  return (
    <group ref={wake}>
      {[-0.24, 0.24].map((x, index) => (
        <mesh key={x} position={[x, 0.035, -2.9]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.2, 5.8]} />
          <meshBasicMaterial
            ref={(material) => { wakeMaterials.current[index] = material; }}
            color={index ? "#d9fff7" : "#9eece2"}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
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
        />
      </points>
    </group>
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

function BeachLife({ beach, windSpeed }: { beach: Beach; windSpeed: number }) {
  const biome = getCoastBiome(beach.id);
  const wind = THREE.MathUtils.clamp(windSpeed / 24, 0.08, 1.4);
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
        <mesh position={[0, -0.35, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[250, 14]} />
          <meshStandardMaterial color="#252a2b" roughness={0.94} metalness={0.02} />
        </mesh>
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
      <group position={[13, 0, 61]}>
        <mesh position={[0, 1.4, 0]} castShadow>
          <boxGeometry args={[5.2, 2.8, 3.8]} />
          <meshStandardMaterial color="#173d46" roughness={0.76} />
        </mesh>
        <mesh position={[0, 3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <cylinderGeometry args={[3.6, 3.6, 1.1, 4]} />
          <meshStandardMaterial color="#f2d190" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.45, -1.92]}>
          <planeGeometry args={[1.7, 1.7]} />
          <meshStandardMaterial color="#69d8d2" emissive="#123c48" emissiveIntensity={0.3} />
        </mesh>
      </group>
      {[[-5, 45], [20, 42], [31, 51], [-31, 57]].map(([x, z], index) => (
        <group key={index} position={[x, 0, z]} rotation={[0, index * 1.7, 0]}>
          <mesh position={[0, 1.18, 0]} castShadow>
            <capsuleGeometry args={[0.2, 1.05, 4, 8]} />
            <meshStandardMaterial color={["#1b3649", "#ef775d", "#dfc15e", "#425b64"][index]} />
          </mesh>
          <mesh position={[0, 2.05, 0]}>
            <sphereGeometry args={[0.22, 10, 8]} />
            <meshStandardMaterial color={["#8a5137", "#d19a76", "#70442f", "#b87651"][index]} />
          </mesh>
        </group>
      ))}
      <CoastBackdrop biome={biome} wind={wind} />
    </group>
  );
}

function SurfVan({ motion }: { motion: MutableRefObject<VehicleMotionState> }) {
  const body = useRef<THREE.Group>(null);
  const frontLeft = useRef<THREE.Group>(null);
  const frontRight = useRef<THREE.Group>(null);
  const rearLeft = useRef<THREE.Group>(null);
  const rearRight = useRef<THREE.Group>(null);

  useFrame(({ clock }, delta) => {
    const state = motion.current;
    const rotationDelta = state.speed * delta / 0.55;
    [frontLeft.current, frontRight.current, rearLeft.current, rearRight.current].forEach((wheel) => {
      if (wheel) wheel.rotation.x -= rotationDelta;
    });
    if (frontLeft.current) frontLeft.current.rotation.y = THREE.MathUtils.damp(frontLeft.current.rotation.y, state.steer * 0.42, 9, delta);
    if (frontRight.current) frontRight.current.rotation.y = THREE.MathUtils.damp(frontRight.current.rotation.y, state.steer * 0.42, 9, delta);
    if (body.current) {
      const roadPulse = state.driving ? Math.sin(clock.elapsedTime * (5 + Math.abs(state.speed))) * Math.min(0.035, Math.abs(state.speed) * 0.002) : 0;
      body.current.position.y = THREE.MathUtils.damp(body.current.position.y, 1.45 + roadPulse, 8, delta);
      body.current.rotation.z = THREE.MathUtils.damp(body.current.rotation.z, -state.steer * Math.min(0.07, Math.abs(state.speed) * 0.004), 7, delta);
      body.current.rotation.x = THREE.MathUtils.damp(body.current.rotation.x, state.brake ? -0.035 : Math.min(0.025, state.speed * 0.002), 7, delta);
    }
  });

  const wheels = [
    { ref: frontLeft, position: [-1.72, 0.62, -2.05] as [number, number, number] },
    { ref: frontRight, position: [1.72, 0.62, -2.05] as [number, number, number] },
    { ref: rearLeft, position: [-1.72, 0.62, 2.08] as [number, number, number] },
    { ref: rearRight, position: [1.72, 0.62, 2.08] as [number, number, number] },
  ];

  return (
    <group>
      {wheels.map((wheel, index) => (
        <group key={index} ref={wheel.ref} position={wheel.position}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.57, 0.57, 0.38, 22]} />
            <meshStandardMaterial color="#101416" roughness={0.86} metalness={0.06} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.26, 0.26, 0.41, 14]} />
            <meshStandardMaterial color="#c3b38b" roughness={0.38} metalness={0.62} />
          </mesh>
        </group>
      ))}

      <group ref={body} position={[0, 1.45, 0]}>
        <mesh position={[0, -0.67, 0]} castShadow>
          <boxGeometry args={[3.1, 0.38, 5.75]} />
          <meshStandardMaterial color="#171d20" roughness={0.68} metalness={0.38} />
        </mesh>
        <RoundedBox args={[3.22, 1.75, 5.8]} radius={0.32} smoothness={5} position={[0, 0, 0.12]} castShadow receiveShadow>
          <meshPhysicalMaterial color="#e86f50" roughness={0.34} metalness={0.18} clearcoat={0.72} clearcoatRoughness={0.2} />
        </RoundedBox>
        <RoundedBox args={[3.06, 1.65, 3.1]} radius={0.38} smoothness={5} position={[0, 1.45, 0.88]} castShadow>
          <meshPhysicalMaterial color="#f0dec0" roughness={0.43} clearcoat={0.52} clearcoatRoughness={0.28} />
        </RoundedBox>

        <mesh position={[0, 1.55, -0.72]} rotation={[-0.34, 0, 0]}>
          <planeGeometry args={[2.55, 1.08]} />
          <meshPhysicalMaterial color="#183846" roughness={0.16} metalness={0.12} transmission={0.18} transparent opacity={0.88} />
        </mesh>
        <mesh position={[-1.54, 1.5, 0.85]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[1.95, 0.93]} />
          <meshPhysicalMaterial color="#1f4652" roughness={0.2} metalness={0.18} transmission={0.14} transparent opacity={0.86} />
        </mesh>
        <mesh position={[1.54, 1.5, 0.85]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[1.95, 0.93]} />
          <meshPhysicalMaterial color="#1f4652" roughness={0.2} metalness={0.18} transmission={0.14} transparent opacity={0.86} />
        </mesh>

        <mesh position={[0, -0.12, -2.94]}>
          <boxGeometry args={[2.45, 0.68, 0.08]} />
          <meshStandardMaterial color="#183c43" roughness={0.38} metalness={0.42} />
        </mesh>
        <mesh position={[0, -0.48, -3.12]}>
          <boxGeometry args={[3.3, 0.26, 0.28]} />
          <meshStandardMaterial color="#d2c5a4" roughness={0.28} metalness={0.75} />
        </mesh>
        {[-1.05, 1.05].map((x) => (
          <group key={x} position={[x, 0.18, -3.02]}>
            <mesh>
              <cylinderGeometry args={[0.32, 0.32, 0.08, 20]} />
              <meshStandardMaterial color="#eef6de" emissive="#ffe7aa" emissiveIntensity={1.6} />
            </mesh>
            <pointLight position={[0, 0, -0.4]} color="#ffe8b5" intensity={0.75} distance={14} decay={1.7} />
          </group>
        ))}

        <mesh position={[-1.61, 1.18, -0.7]} rotation={[0, 0, -0.16]}>
          <boxGeometry args={[0.32, 0.2, 0.48]} />
          <meshStandardMaterial color="#142126" roughness={0.42} metalness={0.5} />
        </mesh>
        <mesh position={[1.61, 1.18, -0.7]} rotation={[0, 0, 0.16]}>
          <boxGeometry args={[0.32, 0.2, 0.48]} />
          <meshStandardMaterial color="#142126" roughness={0.42} metalness={0.5} />
        </mesh>

        <mesh position={[0, 2.43, -0.05]}>
          <boxGeometry args={[3.45, 0.1, 0.14]} />
          <meshStandardMaterial color="#1b2528" metalness={0.68} roughness={0.34} />
        </mesh>
        <mesh position={[0, 2.43, 1.72]}>
          <boxGeometry args={[3.45, 0.1, 0.14]} />
          <meshStandardMaterial color="#1b2528" metalness={0.68} roughness={0.34} />
        </mesh>
        {(["performance", "fish", "longboard"] as BoardType[]).map((boardType, index) => {
          const rackBoard = BOARD_SPECS[boardType];
          return (
            <group key={boardType} position={[-0.72 + index * 0.72, 2.66 + index * 0.055, 0.74 - index * 0.08]} rotation={[Math.PI / 2, 0, 0]} scale={[0.82, 0.92, 0.1]}>
              <mesh castShadow>
                <capsuleGeometry args={[rackBoard.width, rackBoard.length, 6, 20]} />
                <meshPhysicalMaterial color={rackBoard.color} roughness={0.29} clearcoat={0.76} clearcoatRoughness={0.16} />
              </mesh>
              <mesh position={[0, 0.06, -0.08]} scale={[0.7, 1, 0.72]}>
                <capsuleGeometry args={[rackBoard.width * 0.82, rackBoard.length * 0.82, 4, 16]} />
                <meshStandardMaterial color={rackBoard.accent} roughness={0.58} />
              </mesh>
            </group>
          );
        })}
        <mesh position={[0, 0.12, 3.04]}>
          <boxGeometry args={[1.4, 0.5, 0.06]} />
          <meshStandardMaterial color="#dcd2b5" roughness={0.64} />
        </mesh>
        {[-1.04, 1.04].map((x) => (
          <mesh key={x} position={[x, 0.24, 3.04]}>
            <boxGeometry args={[0.48, 0.28, 0.07]} />
            <meshStandardMaterial color="#be493e" emissive="#9b241e" emissiveIntensity={0.55} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Simulation({
  beach,
  settings,
  cloudCover,
  windSpeed,
  sunrise,
  sunset,
  controls,
  active,
  onStats,
  onReady,
}: SurfSceneProps) {
  const { camera } = useThree();
  const boardSpec = BOARD_SPECS[settings.board];
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
  });
  const vanMotion = useRef<VehicleMotionState>({ speed: 0, steer: 0, driving: false, brake: false });
  const cameraTarget = useRef(new THREE.Vector3());
  const cameraPosition = useRef(new THREE.Vector3(0, 4.8, 44));

  useEffect(() => {
    onReady();
  }, [onReady]);

  useFrame(({ clock }, delta) => {
    if (!player.current || !van.current) return;
    const t = clock.elapsedTime;
    const state = controls.current;
    const currentPhase = phase.current;
    const steer = (state.right ? 1 : 0) - (state.left ? 1 : 0);
    const move = (state.forward ? 1 : 0) - (state.back ? 1 : 0);
    const modeDifficulty = settings.mode === "advanced" ? 1.12 : settings.mode === "training" ? 0.62 : 0.86;
    const setState = waveSetState(t, settings.wavePeriod);
    let speed = 0;
    let balanceTarget = 0;
    let prompt = "Read the water";
    let waveQuality = 0;
    let barrelIntensity = 0;
    let catchReady = false;
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
          prompt = "W to drive · A/D to steer · SPACE to exit";
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
        if (state.forward) stamina.current = Math.max(0, stamina.current - delta * 7.5);
        else stamina.current = Math.min(100, stamina.current + delta * 10);
        const paddleEfficiency = 0.58 + stamina.current * 0.0042;
        speed = Math.max(0, move) * 4.2 * paddleEfficiency * boardSpec.paddle + (state.back ? -1.2 : 0);
        position.current.z -= speed * delta;
        position.current.x += (steer * 2.2 + Math.sin((settings.currentDirection * Math.PI) / 180) * settings.currentStrength * 0.35) * delta;
        const ready = position.current.z < -18;
        catchReady = ready;
        const setCopy = setState.secondsToPeak === 0 ? "Set is here" : `Next set ${Math.ceil(setState.secondsToPeak)}s`;
        prompt = ready ? `${setCopy} · CATCH / SPACE` : "Paddle beyond the break";
        if (settings.mode === "training" && position.current.z < -34) prompt = `${setCopy} · timing assist active`;
        if (actionPressed && ready) {
          phase.current = "riding";
          rideDistance.current = 0;
          barrelTime.current = 0;
          stance.current = 0;
          unstableFor.current = 0;
          catchQuality.current = setState.energy;
          combo.current = 0.9 + setState.energy * 0.8;
          maxCombo.current = Math.max(maxCombo.current, combo.current);
          rideStartScore.current = score.current;
          rideManeuverStart.current = maneuverCount.current;
          score.current += Math.round(90 + setState.energy * 360);
          rideResult.current = "";
          cleanFinish.current = false;
        }
      } else if (currentPhase === "riding") {
        const waveSpeed = 8.4 + settings.waveHeight * 2.2 + Math.min(settings.wavePeriod, 18) * 0.1;
        const pumping = state.forward && stamina.current > 1;
        if (state.forward) stance.current = Math.min(1, stance.current + delta * 0.72);
        else if (state.back) stance.current = Math.max(-1, stance.current - delta * 0.86);
        else stance.current = THREE.MathUtils.damp(stance.current, 0, 1.05, delta);
        const nosePressure = Math.max(0, stance.current);
        const tailPressure = Math.max(0, -stance.current);
        stamina.current = THREE.MathUtils.clamp(stamina.current + delta * (pumping ? -14 : 6.5), 0, 100);
        const pumpBoost = pumping ? 1.4 + stamina.current * 0.017 : 0;
        speed = waveSpeed * boardSpec.speed * (0.88 + setState.energy * 0.16) + pumpBoost + nosePressure * 0.85 - tailPressure * 0.48;
        position.current.z += speed * delta;
        position.current.x += steer * boardSpec.turn * (4.4 + speed * 0.18) * (1 + tailPressure * 0.38 - nosePressure * 0.12) * delta;
        rideDistance.current += speed * delta;
        balanceTarget =
          Math.sin(t * (1.25 + modeDifficulty * 0.7) + position.current.x * 0.13) * (0.33 + modeDifficulty * 0.28) * (1 + nosePressure * 0.12) / boardSpec.stability +
          Math.sin(t * 3.1) * settings.currentStrength * 0.045 -
          steer * (0.22 + tailPressure * 0.08) +
          stance.current * 0.07;
        const balanceError = Math.abs(state.balance - balanceTarget);
        const failThreshold = (settings.mode === "training" ? 1.08 : settings.mode === "advanced" ? 0.64 : 0.82) * Math.sqrt(boardSpec.stability);
        unstableFor.current = balanceError > failThreshold ? unstableFor.current + delta : Math.max(0, unstableFor.current - delta * 1.8);
        const wavePhase = Math.sin(position.current.z * 0.19 + position.current.x * 0.018 + t * 0.72);
        waveQuality = THREE.MathUtils.clamp((wavePhase + 1) * 0.42 + setState.energy * 0.16 + catchQuality.current * 0.08, 0, 1);
        const controlQuality = Math.max(0, 1 - balanceError / 1.2);
        const inBarrel = waveQuality > 0.72 && controlQuality > 0.72 && Math.abs(steer) < 0.68 && stance.current > -0.58;
        barrelIntensity = inBarrel ? THREE.MathUtils.clamp((waveQuality - 0.62) * 2.5 + controlQuality * 0.2, 0, 1) : 0;
        if (inBarrel) {
          barrelTime.current += delta;
          combo.current = Math.min(8, combo.current + delta * 0.23);
          score.current += (26 + barrelTime.current * 4) * controlQuality * combo.current * delta;
        }
        const turnBonus = Math.abs(steer) * 12;
        combo.current = Math.min(8, combo.current + controlQuality * delta * 0.11 + Math.abs(steer) * delta * 0.15 + (pumping ? delta * 0.04 : 0));
        maxCombo.current = Math.max(maxCombo.current, combo.current);
        score.current += (14 + turnBonus + waveQuality * 18) * controlQuality * combo.current * delta;
        if (actionPressed && t - lastManeuverAt.current > 0.85 && stamina.current > 7 && balanceError < failThreshold * 0.94) {
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
        }
        prompt = balanceError > failThreshold * 0.76
          ? "Shift your weight toward the marker"
          : inBarrel
            ? `Locked in the barrel · ${barrelTime.current.toFixed(1)}s`
          : steer
            ? "Hold the rail · TRICK / SPACE to release a turn"
            : pumping
              ? "Move toward the nose · pumping for speed"
              : state.back
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
        } else if (position.current.z > 11) {
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
    const waterY = waveHeightAt(position.current.x, position.current.z, t, settings);
    const isWater = phase.current !== "shore";
    const playerY = isWater ? waterY + (phase.current === "riding" ? 0.16 : 0.04) : 0;
    player.current.position.set(position.current.x, playerY, position.current.z);
    player.current.visible = phase.current !== "driving";
    player.current.rotation.y = THREE.MathUtils.damp(player.current.rotation.y, steer * -0.2, 7, delta);
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
    van.current.position.copy(vanPosition.current);
    van.current.rotation.y = vanHeading.current;
    vanMotion.current.speed = vanSpeed.current;
    vanMotion.current.steer = steer;
    vanMotion.current.driving = phase.current === "driving";
    vanMotion.current.brake = phase.current === "driving" && state.back && vanSpeed.current > 0.3;

    const riding = phase.current === "riding";
    const paddling = phase.current === "paddling" || phase.current === "wading";
    const driving = phase.current === "driving";
    if (driving) {
      const forwardX = -Math.sin(vanHeading.current);
      const forwardZ = -Math.cos(vanHeading.current);
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
    } else {
      const barrelCamera = riding ? motion.current.barrel : 0;
      cameraPosition.current.set(
        position.current.x + (riding ? steer * -1.7 - barrelCamera * 1.1 : 0),
        playerY + (riding ? 3.2 - barrelCamera * 0.72 : 4.9),
        position.current.z + (riding ? -8.4 + barrelCamera * 1.45 : paddling ? 9.5 : 10.5),
      );
      cameraTarget.current.set(position.current.x, playerY + 0.9 - barrelCamera * 0.2, position.current.z + (riding ? 5.4 : -3));
    }
    const cameraShake = riding
      ? motion.current.maneuver * 0.1 + motion.current.barrel * 0.035 + Math.max(0, speed - 11) * 0.003
      : phase.current === "wipeout" ? Math.max(0, 1 - motion.current.wipeout * 0.55) * 0.16 : 0;
    cameraPosition.current.x += Math.sin(t * 31) * cameraShake;
    cameraPosition.current.y += Math.cos(t * 37) * cameraShake * 0.55;
    camera.position.lerp(cameraPosition.current, 1 - Math.exp(-delta * (driving ? 3.8 : riding ? 3.1 : 2.4)));
    camera.lookAt(cameraTarget.current);
    camera.rotateZ(riding ? -steer * 0.018 - motion.current.maneuverSide * motion.current.maneuver * 0.025 : driving ? vanMotion.current.steer * -0.012 : 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = driving
        ? 59 + Math.min(5, Math.abs(vanSpeed.current) * 0.2)
        : riding
          ? 58 + Math.min(8, Math.max(0, speed - 7) * 0.72) + motion.current.maneuver * 2.4
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
        catchReady,
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
  const sunHeight = Math.max(-0.08, Math.sin(hourAngle));
  const sunX = Math.cos(hourAngle) * 160;
  const light = THREE.MathUtils.clamp(sunHeight * 1.1 + 0.12, 0.08, 1);
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
  const backgroundColor = sunHeight < 0.08 ? "#07101e" : sunHeight < 0.3 ? "#c66f5d" : daylightSky[coastBiome];
  const fogColor = sunHeight < 0.08 ? "#07101e" : daylightFog[coastBiome];
  const sunLightColor = sunHeight < 0.3 ? "#ff9f72" : "#fff0ca";

  return (
    <>
      <color attach="background" args={[backgroundColor]} />
      <fog attach="fog" args={[fogColor, 55, 240]} />
      <Sky
        distance={450000}
        sunPosition={[sunX, Math.max(-8, sunHeight * 150), -120]}
        inclination={0.49}
        azimuth={0.24}
        turbidity={5.2 + cloudCover * 0.025 + atmosphereBoost}
        rayleigh={sunHeight < 0.2 ? 3.8 : 1.7}
        mieCoefficient={0.008}
        mieDirectionalG={0.85}
      />
      <ambientLight intensity={0.18 + light * 0.42} color={sunHeight < 0.16 ? "#8eb4cf" : "#d8f0ee"} />
      <hemisphereLight args={["#a9d9dc", "#5c4431", 0.38 + light * 0.55]} />
      <directionalLight
        position={[sunX * 0.22, Math.max(6, sunHeight * 44), -30]}
        intensity={0.45 + light * 2.2}
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
      <Ocean
        settings={settings}
        light={light}
        cloudCover={cloudCover}
        windSpeed={windSpeed}
        sunPosition={[sunX * 0.22, Math.max(6, sunHeight * 44), -30]}
        sunColor={sunLightColor}
      />
      <BeachLife beach={beach} windSpeed={windSpeed} />
      <group ref={player}>
        <BreakingWave motion={motion} settings={settings} light={light} cloudCover={cloudCover} />
        <WaterInteraction motion={motion} />
        <SurferModel motion={motion} boardType={settings.board} />
      </group>
      <group ref={van}>
        <SurfVan motion={vanMotion} />
      </group>
      <Bird offset={0} speed={1 + windSpeed * 0.008} />
      <Bird offset={7} speed={0.82 + windSpeed * 0.006} />
      <Bird offset={15} speed={1.15 + windSpeed * 0.007} />
      {sunHeight < 0.22 && (
        <Sparkles count={70} scale={[180, 48, 140]} position={[0, 20, -50]} size={0.7} speed={0.05} opacity={0.45} color="#dcefff" />
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
