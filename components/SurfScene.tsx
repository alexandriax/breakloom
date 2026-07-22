"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky, Sparkles } from "@react-three/drei";
import { MutableRefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Beach } from "@/lib/beaches";
import type { GamePhase, GameStats, SessionSettings } from "@/lib/game";
import { waveHeightAt } from "@/lib/game";

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
    float elevation = uTide * .3 + max(.12, uHeight * .62) * (
      primary * .64 * shore + secondary * .22 + cross * .11
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
      wipeout ? 1.7 : riding ? -state.balance * 0.34 : 0,
      7,
      delta,
    );
    body.current.position.y = THREE.MathUtils.damp(body.current.position.y, paddle ? 0.42 : riding ? 0.54 : 0.95, 8, delta);
    rig.current.rotation.z = wipeout ? state.wipeout * 2.1 : 0;

    board.current.rotation.x = THREE.MathUtils.damp(board.current.rotation.x, shore ? 0.14 : 0, 7, delta);
    board.current.rotation.z = THREE.MathUtils.damp(board.current.rotation.z, shore ? -0.46 : riding ? state.steer * -0.13 : 0, 7, delta);
    board.current.position.x = THREE.MathUtils.damp(board.current.position.x, shore ? 0.55 : 0, 7, delta);
    board.current.position.y = THREE.MathUtils.damp(board.current.position.y, shore ? 0.72 : 0.16, 7, delta);

    if (leftArm.current && rightArm.current) {
      const stroke = paddle ? Math.sin(t * 5.6) : shore ? Math.sin(t * state.speed * 1.8) * 0.5 : 0;
      leftArm.current.rotation.x = paddle ? stroke * 1.05 : riding ? -0.55 : stroke;
      rightArm.current.rotation.x = paddle ? -stroke * 1.05 : riding ? 0.55 : -stroke;
      leftArm.current.rotation.z = riding ? 1.1 : 0.22;
      rightArm.current.rotation.z = riding ? -1.1 : -0.22;
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
      {dunes.map((dune, index) => (
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
        <group position={[-38, 0, 76]} rotation={[0, 0, -0.08]}>
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
  const position = useRef(new THREE.Vector3(0, 0, 35));
  const phase = useRef<GamePhase>("shore");
  const score = useRef(0);
  const combo = useRef(1);
  const rideDistance = useRef(0);
  const unstableFor = useRef(0);
  const wipeoutAt = useRef(0);
  const actionLatch = useRef(false);
  const lastStatsAt = useRef(0);
  const cleanFinish = useRef(false);
  const motion = useRef<MotionState>({ phase: "shore", balance: 0, steer: 0, speed: 0, wipeout: 0 });
  const cameraTarget = useRef(new THREE.Vector3());
  const cameraPosition = useRef(new THREE.Vector3(0, 4.8, 44));

  useEffect(() => {
    onReady();
  }, [onReady]);

  useFrame(({ clock }, delta) => {
    if (!player.current) return;
    const t = clock.elapsedTime;
    const state = controls.current;
    const currentPhase = phase.current;
    const steer = (state.right ? 1 : 0) - (state.left ? 1 : 0);
    const move = (state.forward ? 1 : 0) - (state.back ? 1 : 0);
    const modeDifficulty = settings.mode === "advanced" ? 1.12 : settings.mode === "training" ? 0.62 : 0.86;
    let speed = 0;
    let balanceTarget = 0;
    let prompt = "Read the water";
    let waveQuality = 0;

    const actionPressed = state.action && !actionLatch.current;
    actionLatch.current = state.action;

    if (active) {
      if (currentPhase === "shore") {
        speed = move * 4.4;
        position.current.z -= speed * delta;
        position.current.x += steer * 3.7 * delta;
        prompt = cleanFinish.current ? "Clean finish — head back out" : "Walk toward the water";
        if (position.current.z < 8) phase.current = "wading";
      } else if (currentPhase === "wading") {
        speed = move * 2.5;
        position.current.z -= speed * delta;
        position.current.x += steer * 2 * delta;
        prompt = "Keep moving — your board will float soon";
        if (position.current.z > 10) phase.current = "shore";
        if (position.current.z < 1) phase.current = "paddling";
      } else if (currentPhase === "paddling") {
        speed = Math.max(0, move) * 4.2 + (state.back ? -1.2 : 0);
        position.current.z -= speed * delta;
        position.current.x += (steer * 2.2 + Math.sin((settings.currentDirection * Math.PI) / 180) * settings.currentStrength * 0.35) * delta;
        const ready = position.current.z < -18;
        prompt = ready ? "Wave approaching — press SPACE to catch it" : "Paddle beyond the break";
        if (settings.mode === "training" && position.current.z < -34) prompt = "Press SPACE — timing window assisted";
        if (actionPressed && ready) {
          phase.current = "riding";
          rideDistance.current = 0;
          unstableFor.current = 0;
          combo.current = 1;
          cleanFinish.current = false;
        }
      } else if (currentPhase === "riding") {
        const waveSpeed = 8.4 + settings.waveHeight * 2.2 + Math.min(settings.wavePeriod, 18) * 0.1;
        speed = waveSpeed + Math.max(0, move) * 2.4;
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
        waveQuality = (wavePhase + 1) * 0.5;
        const controlQuality = Math.max(0, 1 - balanceError / 1.2);
        const turnBonus = Math.abs(steer) * 12;
        combo.current = Math.min(8, combo.current + controlQuality * delta * 0.11 + Math.abs(steer) * delta * 0.15);
        score.current += (14 + turnBonus + waveQuality * 18) * controlQuality * combo.current * delta;
        prompt = balanceError > failThreshold * 0.76 ? "Shift your weight toward the marker" : steer ? "Hold the rail — finish the turn" : "Stay in the pocket";
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

    position.current.x = THREE.MathUtils.clamp(position.current.x, -52, 52);
    const waterY = waveHeightAt(position.current.x, position.current.z, t, settings);
    const isWater = phase.current !== "shore";
    const playerY = isWater ? waterY + (phase.current === "riding" ? 0.16 : 0.04) : 0;
    player.current.position.set(position.current.x, playerY, position.current.z);
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

    const riding = phase.current === "riding";
    const paddling = phase.current === "paddling" || phase.current === "wading";
    cameraPosition.current.set(
      position.current.x + (riding ? steer * -1.7 : 0),
      playerY + (riding ? 3.2 : 4.9),
      position.current.z + (riding ? -8.4 : paddling ? 9.5 : 10.5),
    );
    camera.position.lerp(cameraPosition.current, 1 - Math.exp(-delta * (riding ? 3.1 : 2.4)));
    cameraTarget.current.set(position.current.x, playerY + 0.9, position.current.z + (riding ? 5.4 : -3));
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
