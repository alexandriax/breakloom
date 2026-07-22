"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoundedBox, Sky, Sparkles } from "@react-three/drei";
import { MutableRefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Beach } from "@/lib/beaches";
import type { GamePhase, GameStats, SessionSettings } from "@/lib/game";
import { sessionGrade, waveHeightAt, waveSetState } from "@/lib/game";

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
  wipeout: number;
  maneuver: number;
  maneuverSide: number;
};

type VehicleMotionState = {
  speed: number;
  steer: number;
  driving: boolean;
  brake: boolean;
};

const OCEAN_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uPeriod;
  uniform float uCurrent;
  uniform float uDirection;
  uniform float uTide;
  varying float vHeight;
  varying float vCrest;
  varying vec2 vSurface;

  float wave(vec2 p, float frequency, float speed, vec2 direction, float phase) {
    return sin(dot(p, direction) * frequency + uTime * speed + phase);
  }

  void main() {
    vec3 p = position;
    float speed = 6.2831853 / max(4.0, uPeriod);
    float angle = radians(uDirection);
    vec2 currentDir = vec2(cos(angle), sin(angle));
    float curve = sin(angle) * 0.0019 * p.x * p.x;
    float shore = 0.76 + smoothstep(-85.0, 8.0, p.y) * 0.72;
    float primary = sin(p.y * 0.19 + p.x * 0.018 + curve + uTime * speed * 5.4);
    float secondary = wave(p.xy, 0.31, speed * 7.1, normalize(vec2(-0.16, 1.0)), 1.7);
    float cross = wave(p.xy, 0.13, -speed * 2.7, normalize(vec2(1.0, 0.68) + currentDir * .15), 0.0);
    float micro = sin(p.x * .75 + p.y * .32 + uTime * 2.4) * .035;
    float setCycle = max(18.0, uPeriod * 3.1);
    float setPhase = mod(uTime, setCycle);
    float setAngle = ((setPhase - setCycle * .38) / setCycle) * 6.2831853;
    float setEnergy = .12 + pow(max(0.0, cos(setAngle) * .5 + .5), 3.2) * .88;
    float setLift = .78 + setEnergy * .34;
    float elevation = uTide * .3 + max(.12, uHeight * .62) * (
      primary * .64 * shore * setLift + secondary * .22 + cross * .11
    ) + micro * (1.0 + uCurrent * .15);
    p.z += elevation;
    vHeight = elevation;
    vCrest = primary * shore;
    vSurface = p.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const OCEAN_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uHeight;
  uniform float uLight;
  uniform float uCloud;
  varying float vHeight;
  varying float vCrest;
  varying vec2 vSurface;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float depth = smoothstep(14.0, -90.0, vSurface.y);
    vec3 deep = mix(vec3(.018, .16, .20), vec3(.006, .055, .105), depth);
    vec3 shallow = vec3(.055, .46, .46);
    float translucence = smoothstep(-.5, .8, vHeight) * (1.0 - depth) * .45;
    vec3 color = mix(deep, shallow, translucence);
    float ripple = sin(vSurface.x * 1.7 + vSurface.y * .9 + uTime * 1.8) * .5 + .5;
    float glint = pow(max(0.0, ripple * (vHeight + .48)), 4.0) * (.2 + uLight * .45);
    color += vec3(.38, .82, .81) * glint;
    float crestGate = smoothstep(.69, .94, vCrest) * smoothstep(.35, 1.2, uHeight);
    float foamNoise = hash(floor(vSurface * vec2(.42, .16) + uTime * vec2(1.4, .1)));
    float shoreFoam = smoothstep(5.5, 10.5, vSurface.y) * (.45 + .55 * sin(vSurface.x * .2 + uTime * 1.7));
    float foam = max(crestGate * smoothstep(.18, .8, foamNoise), shoreFoam * .42);
    color = mix(color, vec3(.84, .98, .95), clamp(foam, 0.0, .86));
    color = mix(color, vec3(.025, .055, .09), uCloud * .22);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function Ocean({ settings, light, cloudCover }: { settings: SessionSettings; light: number; cloudCover: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const segments = useMemo(() => (window.innerWidth < 800 ? 76 : 132), []);
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
  });

  return (
    <mesh position={[0, -0.08, -105]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
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

function SurferModel({ motion }: { motion: MutableRefObject<MotionState> }) {
  const rig = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const board = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);

  useFrame(({ clock }, delta) => {
    if (!rig.current || !body.current || !board.current) return;
    const state = motion.current;
    const t = clock.elapsedTime;
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
    body.current.position.y = THREE.MathUtils.damp(body.current.position.y, paddle ? 0.42 : riding ? 0.54 : 0.95, 8, delta);
    rig.current.rotation.z = wipeout ? state.wipeout * 2.1 : 0;

    board.current.rotation.x = THREE.MathUtils.damp(board.current.rotation.x, shore ? 0.14 : 0, 7, delta);
    board.current.rotation.z = THREE.MathUtils.damp(
      board.current.rotation.z,
      shore ? -0.46 : riding ? state.steer * -0.13 - state.maneuverSide * state.maneuver * 0.22 : 0,
      7,
      delta,
    );
    board.current.rotation.y = THREE.MathUtils.damp(
      board.current.rotation.y,
      riding ? state.maneuverSide * state.maneuver * 0.52 : 0,
      9,
      delta,
    );
    board.current.position.x = THREE.MathUtils.damp(board.current.position.x, shore ? 0.55 : 0, 7, delta);
    board.current.position.y = THREE.MathUtils.damp(board.current.position.y, shore ? 0.72 : 0.16, 7, delta);

    if (leftArm.current && rightArm.current) {
      const stroke = paddle ? Math.sin(t * 5.6) : shore ? Math.sin(t * state.speed * 1.8) * 0.5 : 0;
      leftArm.current.rotation.x = paddle ? stroke * 1.05 : riding ? -0.55 : stroke;
      rightArm.current.rotation.x = paddle ? -stroke * 1.05 : riding ? 0.55 : -stroke;
      leftArm.current.rotation.z = riding ? 1.1 + state.maneuver * 0.34 : 0.22;
      rightArm.current.rotation.z = riding ? -1.1 - state.maneuver * 0.34 : -0.22;
    }
    if (leftLeg.current && rightLeg.current) {
      const step = shore ? Math.sin(t * state.speed * 2.2) * 0.5 : 0;
      leftLeg.current.rotation.x = riding ? -0.72 : step;
      rightLeg.current.rotation.x = riding ? 0.62 : -step;
    }
  });

  const skin = "#a96343";
  const suit = "#071c27";
  const suitPanel = "#123d49";
  return (
    <group ref={rig}>
      <group ref={board} position={[0, 0.16, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.13, 1]} castShadow>
          <capsuleGeometry args={[0.34, 2.65, 8, 22]} />
          <meshPhysicalMaterial color="#ece3d1" roughness={0.28} clearcoat={0.8} clearcoatRoughness={0.15} />
        </mesh>
        <mesh position={[0, 0.06, -0.1]} rotation={[Math.PI / 2, 0, 0]} scale={[0.78, 0.14, 0.75]}>
          <capsuleGeometry args={[0.29, 2.25, 5, 18]} />
          <meshStandardMaterial color="#f26b4d" roughness={0.62} />
        </mesh>
        <mesh position={[0, -0.02, 1.56]} rotation={[0.15, 0, 0]}>
          <boxGeometry args={[0.055, 0.3, 0.24]} />
          <meshStandardMaterial color="#f3efe6" />
        </mesh>
      </group>

      <group ref={body} position={[0, 0.95, 0]}>
        <mesh castShadow>
          <capsuleGeometry args={[0.26, 0.58, 6, 14]} />
          <meshStandardMaterial color={suit} roughness={0.72} />
        </mesh>
        <mesh position={[0, 0.1, 0.235]} scale={[0.72, 0.78, 0.12]}>
          <sphereGeometry args={[0.27, 16, 12]} />
          <meshStandardMaterial color={suitPanel} roughness={0.65} />
        </mesh>
        <mesh position={[0, 0.67, 0]} castShadow>
          <sphereGeometry args={[0.19, 18, 14]} />
          <meshStandardMaterial color={skin} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.72, -0.07]} rotation={[-0.35, 0, 0]}>
          <sphereGeometry args={[0.195, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
          <meshStandardMaterial color="#15110f" roughness={0.9} />
        </mesh>

        <group ref={leftArm} position={[-0.31, 0.3, 0]}>
          <mesh position={[0, -0.32, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.5, 5, 10]} />
            <meshStandardMaterial color={suit} />
          </mesh>
          <mesh position={[0, -0.66, 0]}>
            <sphereGeometry args={[0.09, 12, 10]} />
            <meshStandardMaterial color={skin} />
          </mesh>
        </group>
        <group ref={rightArm} position={[0.31, 0.3, 0]}>
          <mesh position={[0, -0.32, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.5, 5, 10]} />
            <meshStandardMaterial color={suit} />
          </mesh>
          <mesh position={[0, -0.66, 0]}>
            <sphereGeometry args={[0.09, 12, 10]} />
            <meshStandardMaterial color={skin} />
          </mesh>
        </group>
        <group ref={leftLeg} position={[-0.15, -0.43, 0]}>
          <mesh position={[0, -0.43, 0]} castShadow>
            <capsuleGeometry args={[0.105, 0.62, 5, 10]} />
            <meshStandardMaterial color={suit} />
          </mesh>
        </group>
        <group ref={rightLeg} position={[0.15, -0.43, 0]}>
          <mesh position={[0, -0.43, 0]} castShadow>
            <capsuleGeometry args={[0.105, 0.62, 5, 10]} />
            <meshStandardMaterial color={suit} />
          </mesh>
        </group>
      </group>
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

function BeachLife({ tropical }: { tropical: boolean }) {
  const dunes = useMemo(
    () =>
      Array.from({ length: 22 }, (_, index) => ({
        x: -75 + ((index * 29) % 150),
        z: 68 + ((index * 13) % 54),
        s: 3.2 + ((index * 7) % 8) * 0.42,
      })),
    [],
  );
  return (
    <group>
      <mesh position={[0, -0.5, 64]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[250, 125, 20, 20]} />
        <meshStandardMaterial color="#bc9464" roughness={1} metalness={0} />
      </mesh>
      <mesh position={[0, -0.43, 21]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[250, 18]} />
        <meshStandardMaterial color="#8f7659" roughness={1} />
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
      {dunes.filter((dune) => dune.z > 88).map((dune, index) => (
        <mesh key={index} position={[dune.x, -0.4, dune.z]} scale={[dune.s, 0.8 + (index % 3) * 0.28, dune.s * 0.72]} receiveShadow>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color={index % 2 ? "#a9875f" : "#c19d6b"} roughness={1} />
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
      {tropical && (
        <group position={[-38, 0, 101]} rotation={[0, 0, -0.08]}>
          <mesh position={[0, 4.5, 0]}>
            <cylinderGeometry args={[0.3, 0.55, 9, 9]} />
            <meshStandardMaterial color="#6d4c31" roughness={1} />
          </mesh>
          {Array.from({ length: 7 }, (_, index) => (
            <mesh key={index} position={[0, 9, 0]} rotation={[0, (index / 7) * Math.PI * 2, 0.78]}>
              <coneGeometry args={[0.75, 5.4, 6]} />
              <meshStandardMaterial color="#2e6250" roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      )}
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
        {[
          { x: -0.72, color: "#f0e5cf", z: 0.65 },
          { x: 0, color: "#3babb2", z: 0.8 },
          { x: 0.72, color: "#f3b85e", z: 0.58 },
        ].map((board, index) => (
          <mesh key={index} position={[board.x, 2.66 + index * 0.06, board.z]} rotation={[Math.PI / 2, 0, 0]} scale={[0.82, 0.1, 0.95]} castShadow>
            <capsuleGeometry args={[0.31, 3.05, 6, 18]} />
            <meshPhysicalMaterial color={board.color} roughness={0.31} clearcoat={0.7} clearcoatRoughness={0.19} />
          </mesh>
        ))}
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
  sunrise,
  sunset,
  controls,
  active,
  onStats,
  onReady,
}: SurfSceneProps) {
  const { camera } = useThree();
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
  const motion = useRef<MotionState>({ phase: "shore", balance: 0, steer: 0, speed: 0, wipeout: 0, maneuver: 0, maneuverSide: 0 });
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
    const distanceToVan = Math.hypot(position.current.x - vanPosition.current.x, position.current.z - vanPosition.current.z);
    const nearVan = currentPhase === "shore" && distanceToVan < 6.2;

    const actionPressed = state.action && !actionLatch.current;
    actionLatch.current = state.action;

    if (active) {
      if (currentPhase === "shore") {
        stamina.current = Math.min(100, stamina.current + delta * 12);
        speed = move * 4.4;
        position.current.z -= speed * delta;
        position.current.x += steer * 3.7 * delta;
        prompt = nearVan
          ? "Press SPACE to drive the Surfscape van"
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
        speed = Math.max(0, move) * 4.2 * paddleEfficiency + (state.back ? -1.2 : 0);
        position.current.z -= speed * delta;
        position.current.x += (steer * 2.2 + Math.sin((settings.currentDirection * Math.PI) / 180) * settings.currentStrength * 0.35) * delta;
        const ready = position.current.z < -18;
        const setCopy = setState.secondsToPeak === 0 ? "Set is here" : `Next set ${Math.ceil(setState.secondsToPeak)}s`;
        prompt = ready ? `${setCopy} · SPACE to catch` : "Paddle beyond the break";
        if (settings.mode === "training" && position.current.z < -34) prompt = `${setCopy} · timing assist active`;
        if (actionPressed && ready) {
          phase.current = "riding";
          rideDistance.current = 0;
          unstableFor.current = 0;
          catchQuality.current = setState.energy;
          combo.current = 0.9 + setState.energy * 0.8;
          maxCombo.current = Math.max(maxCombo.current, combo.current);
          score.current += Math.round(90 + setState.energy * 360);
          cleanFinish.current = false;
        }
      } else if (currentPhase === "riding") {
        const waveSpeed = 8.4 + settings.waveHeight * 2.2 + Math.min(settings.wavePeriod, 18) * 0.1;
        const pumping = state.forward && stamina.current > 1;
        stamina.current = THREE.MathUtils.clamp(stamina.current + delta * (pumping ? -14 : 6.5), 0, 100);
        const pumpBoost = pumping ? 1.4 + stamina.current * 0.017 : 0;
        speed = waveSpeed * (0.88 + setState.energy * 0.16) + pumpBoost - Math.max(0, -move) * 1.5;
        position.current.z += speed * delta;
        position.current.x += steer * (4.4 + speed * 0.18) * delta;
        rideDistance.current += speed * delta;
        balanceTarget =
          Math.sin(t * (1.25 + modeDifficulty * 0.7) + position.current.x * 0.13) * (0.33 + modeDifficulty * 0.28) +
          Math.sin(t * 3.1) * settings.currentStrength * 0.045 -
          steer * 0.22;
        const balanceError = Math.abs(state.balance - balanceTarget);
        const failThreshold = settings.mode === "training" ? 1.08 : settings.mode === "advanced" ? 0.64 : 0.82;
        unstableFor.current = balanceError > failThreshold ? unstableFor.current + delta : Math.max(0, unstableFor.current - delta * 1.8);
        const wavePhase = Math.sin(position.current.z * 0.19 + position.current.x * 0.018 + t * 0.72);
        waveQuality = THREE.MathUtils.clamp((wavePhase + 1) * 0.42 + setState.energy * 0.16 + catchQuality.current * 0.08, 0, 1);
        const controlQuality = Math.max(0, 1 - balanceError / 1.2);
        const turnBonus = Math.abs(steer) * 12;
        combo.current = Math.min(8, combo.current + controlQuality * delta * 0.11 + Math.abs(steer) * delta * 0.15 + (pumping ? delta * 0.04 : 0));
        maxCombo.current = Math.max(maxCombo.current, combo.current);
        score.current += (14 + turnBonus + waveQuality * 18) * controlQuality * combo.current * delta;
        if (actionPressed && t - lastManeuverAt.current > 0.85 && stamina.current > 7 && balanceError < failThreshold * 0.94) {
          const rail = Math.abs(steer);
          let name = "High Line";
          let base = 150;
          if (waveQuality > 0.72 && rail > 0.42) {
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
          const points = Math.round(base * (0.62 + controlQuality * 0.48) * (0.88 + setState.energy * 0.28) * combo.current);
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
          : steer
            ? "Hold the rail · SPACE to release a turn"
            : pumping
              ? "Pump for speed · watch your stamina"
              : "Stay in the pocket · SPACE for a maneuver";
        if (unstableFor.current > (settings.mode === "training" ? 1.15 : 0.58)) {
          phase.current = "wipeout";
          wipeoutAt.current = t;
          combo.current = 1;
        } else if (position.current.z > 11) {
          score.current += 750 + rideDistance.current * 11;
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
    motion.current.maneuver = Math.max(0, motion.current.maneuver - delta * 1.72);
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
      cameraPosition.current.set(
        position.current.x + (riding ? steer * -1.7 : 0),
        playerY + (riding ? 3.2 : 4.9),
        position.current.z + (riding ? -8.4 : paddling ? 9.5 : 10.5),
      );
      cameraTarget.current.set(position.current.x, playerY + 0.9, position.current.z + (riding ? 5.4 : -3));
    }
    camera.position.lerp(cameraPosition.current, 1 - Math.exp(-delta * (driving ? 3.8 : riding ? 3.1 : 2.4)));
    camera.lookAt(cameraTarget.current);

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
        stamina: Math.round(stamina.current),
        setEnergy: setState.energy,
        nextSetSeconds: setState.secondsToPeak,
        maneuver: maneuver.current,
        maneuverScore: maneuverScore.current,
        maneuverId: maneuverId.current,
        maneuverCount: maneuverCount.current,
        maxCombo: Number(maxCombo.current.toFixed(1)),
        grade: sessionGrade(score.current, rideDistance.current, maneuverCount.current),
        vehicleMode: phase.current === "driving",
        nearVan,
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
  const tropical = ["pipeline", "teahupoo", "snapper-rocks", "uluwatu", "cloudbreak"].includes(beach.id);

  return (
    <>
      <color attach="background" args={[sunHeight < 0.08 ? "#07101e" : sunHeight < 0.3 ? "#c66f5d" : "#6a9bae"]} />
      <fog attach="fog" args={[sunHeight < 0.08 ? "#07101e" : "#7e9fa6", 55, 240]} />
      <Sky
        distance={450000}
        sunPosition={[sunX, Math.max(-8, sunHeight * 150), -120]}
        inclination={0.49}
        azimuth={0.24}
        turbidity={5.2 + cloudCover * 0.025}
        rayleigh={sunHeight < 0.2 ? 3.8 : 1.7}
        mieCoefficient={0.008}
        mieDirectionalG={0.85}
      />
      <ambientLight intensity={0.18 + light * 0.42} color={sunHeight < 0.16 ? "#8eb4cf" : "#d8f0ee"} />
      <hemisphereLight args={["#a9d9dc", "#5c4431", 0.38 + light * 0.55]} />
      <directionalLight
        position={[sunX * 0.22, Math.max(6, sunHeight * 44), -30]}
        intensity={0.45 + light * 2.2}
        color={sunHeight < 0.3 ? "#ff9f72" : "#fff0ca"}
        castShadow={window.innerWidth > 800}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={100}
        shadow-camera-left={-35}
        shadow-camera-right={35}
        shadow-camera-top={35}
        shadow-camera-bottom={-35}
      />
      <Ocean settings={settings} light={light} cloudCover={cloudCover} />
      <BeachLife tropical={tropical} />
      <group ref={player}>
        <SurferModel motion={motion} />
      </group>
      <group ref={van}>
        <SurfVan motion={vanMotion} />
      </group>
      <Bird offset={0} speed={1} />
      <Bird offset={7} speed={0.82} />
      <Bird offset={15} speed={1.15} />
      {sunHeight < 0.22 && (
        <Sparkles count={70} scale={[180, 48, 140]} position={[0, 20, -50]} size={0.7} speed={0.05} opacity={0.45} color="#dcefff" />
      )}
    </>
  );
}

export default function SurfScene(props: SurfSceneProps) {
  return (
    <Canvas
      className="surf-canvas"
      shadows
      dpr={[1, 1.65]}
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
