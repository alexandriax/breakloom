import {
  advanceWavePumpDrive,
  createWavePumpState,
  recognizeSurfboardSurfaceManeuver,
  resolveSurfboardAerialControl,
  INITIAL_STATS,
  WAVE_PUMP_TUNING,
} from "../lib/game.ts";
import { readFileSync } from "node:fs";

const sceneSource = readFileSync(
  new URL("../components/SurfScene.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../components/BreakloomApp.tsx", import.meta.url),
  "utf8",
);
const gameSource = readFileSync(
  new URL("../lib/game.ts", import.meta.url),
  "utf8",
);

function invariant(condition, message) {
  if (!condition) {
    throw new Error(`Flow mechanics contract failed: ${message}`);
  }
}

const dt = 1 / 60;
const pumpSample = (elapsed, facePosition, overrides = {}) => ({
  elapsed,
  deltaSeconds: dt,
  facePosition,
  pocketEnvelope: .7,
  waveContact: .9,
  waterContact: 1,
  planing: .85,
  compression: .5,
  forwardSpeed: 7,
  waveSpeed: 8,
  tubePressure: 0,
  whitewater: 0,
  ...overrides,
});

// A wave-matched climb-and-drop line builds rhythm and bounded drive.
let state = createWavePumpState();
let reading = { rhythm: 0, driveMagnitude: 0, swinging: false };
for (let t = 0; t < 10; t += dt) {
  reading = advanceWavePumpDrive(
    state,
    pumpSample(t, Math.sin((t / 1.8) * Math.PI * 2) * .55),
  );
}
const pumpedRhythm = reading.rhythm;
const pumpedDrive = reading.driveMagnitude;
invariant(pumpedRhythm > .55, "sustained swings no longer build pump rhythm");
invariant(
  pumpedDrive > .6
    && pumpedDrive <= WAVE_PUMP_TUNING.maxDriveAcceleration,
  "pump drive left its bounded acceleration budget",
);

// A line that goes still bleeds the rhythm away within a few seconds.
for (let t = 10; t < 14; t += dt) {
  reading = advanceWavePumpDrive(state, pumpSample(t, .1));
}
const idleRhythm = reading.rhythm;
invariant(idleRhythm < .1, "an idle line no longer bleeds pump rhythm");

// Frantic wiggling below the cadence floor earns nothing.
state = createWavePumpState();
for (let t = 0; t < 6; t += dt) {
  reading = advanceWavePumpDrive(
    state,
    pumpSample(t, Math.sin((t / .3) * Math.PI * 2) * .5),
  );
}
invariant(
  reading.rhythm < .05,
  "sub-cadence wiggling now counts as pumping",
);

// The same speed-headroom law as the pocket drive caps the pump.
state = createWavePumpState();
state.rhythm = 1;
const capped = advanceWavePumpDrive(
  state,
  pumpSample(dt, .01, { forwardSpeed: 8 * 2.1 }),
);
invariant(
  capped.driveMagnitude < .01,
  "pumping can push the hull past the crest's transport budget",
);

// Whitewater contact halves what a clean face would deliver.
state = createWavePumpState();
state.rhythm = 1;
state.previousFacePosition = .01;
const clean = advanceWavePumpDrive(state, pumpSample(dt, .012));
state = createWavePumpState();
state.rhythm = 1;
state.previousFacePosition = .01;
const foamy = advanceWavePumpDrive(
  state,
  pumpSample(dt, .012, { whitewater: 1 }),
);
invariant(
  foamy.driveMagnitude < clean.driveMagnitude * .6,
  "whitewater no longer degrades pump drive",
);

// Aerial authority exists only in flight and stays bounded.
const grounded = resolveSurfboardAerialControl({
  deltaSeconds: dt,
  steerInput: 1,
  grabInput: 1,
  airborneHeight: 0,
  waterContact: 1,
  boardLength: 2.5,
});
invariant(
  grounded.yawTorque === 0 && !grounded.grabActive,
  "a grounded board received aerial authority",
);
const flying = resolveSurfboardAerialControl({
  deltaSeconds: dt,
  steerInput: 1,
  grabInput: -1,
  airborneHeight: .6,
  waterContact: 0,
  boardLength: 2.5,
});
invariant(
  flying.yawTorque > .5 && flying.yawTorque <= 2.6,
  "shortboard aerial steering left its torque budget",
);
invariant(
  flying.grabActive
    && flying.grabSide === -1
    && flying.attitudeDamping > 0
    && flying.attitudeDamping <= 3.1,
  "a held rail grab no longer settles the airborne board",
);
const longboardFlying = resolveSurfboardAerialControl({
  deltaSeconds: dt,
  steerInput: 1,
  grabInput: 0,
  airborneHeight: .6,
  waterContact: 0,
  boardLength: 3.45,
});
invariant(
  longboardFlying.yawTorque < flying.yawTorque,
  "yaw inertia no longer scales aerial steering by board length",
);
invariant(!longboardFlying.grabActive, "a neutral hand registered as a grab");

// The surface recognizer names the deeper trick signatures without losing
// its existing vocabulary.
const carveBase = {
  durationSeconds: .9,
  startFacePosition: .3,
  endFacePosition: .1,
  startLinePosition: .1,
  endLinePosition: -.05,
  accumulatedYaw: .6,
  peakYawRate: .9,
  peakRailLoad: .6,
  nosePressureSeconds: 0,
  minimumWaterContact: .8,
  endPlaning: .7,
  endWaveContact: .6,
  boardLength: 2.5,
};
const tailslide = recognizeSurfboardSurfaceManeuver({
  ...carveBase,
  peakRailSlip: .78,
  endRailSlip: .3,
});
invariant(
  tailslide?.name === "Tailslide",
  "a released-and-recovered rail no longer names a Tailslide",
);
const layback = recognizeSurfboardSurfaceManeuver({
  ...carveBase,
  peakCounterweight: .8,
});
invariant(
  layback?.name === "Layback Snap",
  "a thrown counterweight through a hard top turn no longer names a Layback Snap",
);
const plainCarve = recognizeSurfboardSurfaceManeuver(carveBase);
invariant(
  plainCarve?.name === "Power Carve",
  "the existing carve vocabulary regressed",
);
const spunOut = recognizeSurfboardSurfaceManeuver({
  ...carveBase,
  peakRailSlip: .78,
  endRailSlip: .6,
});
invariant(
  spunOut?.name !== "Tailslide",
  "a slide without re-grip counts as a Tailslide",
);

// The scene wiring, scoring layer, stats contract, and HUD all carry the
// flow mechanics.
invariant(
  sceneSource.includes("advanceWavePumpDrive(pumpState.current"),
  "the ride solver no longer advances the pump state",
);
invariant(
  sceneSource.includes("+ planingForwardX * pumpReading.driveMagnitude")
    && sceneSource.includes("+ planingForwardZ * pumpReading.driveMagnitude"),
  "pump drive no longer feeds the hull force integration",
);
invariant(
  sceneSource.includes("WAVE_PUMP_TUNING.staminaWorkScale"),
  "pumping no longer costs stamina",
);
invariant(
  sceneSource.includes("resolveSurfboardAerialControl({")
    && sceneSource.includes("attempt.grabSeconds += delta"),
  "airborne maneuvers no longer read the aerial control solver",
);
invariant(
  sceneSource.includes('? "540 Air"')
    && sceneSource.includes("? 980"),
  "the 540 rotation tier is gone",
);
invariant(
  sceneSource.includes('attempt.grabSide < 0 ? "Melon" : "Indy"'),
  "grabbed airs are no longer named",
);
invariant(
  sceneSource.includes("const repetitionScale = Math.max(.4, 1 - repeatCount * .22)"),
  "repeated tricks no longer pay a repetition discount",
);
invariant(
  sceneSource.includes("const flowScale = combo.current >= 5 ? 1.2 : 1"),
  "the flow state no longer lifts maneuver scores",
);
invariant(
  sceneSource.includes("rideChainHeat.current > 0")
    && sceneSource.includes("const chainScale = 1 + Math.min("),
  "linked maneuvers no longer pay a chain premium",
);
invariant(
  sceneSource.includes("rideChainBest.current - 1) * 140"),
  "clean exits no longer bank the chain bonus",
);
invariant(
  sceneSource.includes("pumpRhythm: phase.current === \"riding\"")
    && sceneSource.includes("rideChain: phase.current === \"riding\""),
  "the HUD telemetry lost the pump or chain channel",
);
invariant(
  Object.hasOwn(INITIAL_STATS, "pumpRhythm")
    && Object.hasOwn(INITIAL_STATS, "rideChain"),
  "the stats contract lost the flow fields",
);
invariant(
  gameSource.includes("export const WAVE_PUMP_TUNING"),
  "the pump tuning table is no longer part of the physics contract",
);
invariant(
  appSource.includes('className="pump-meter"')
    && appSource.includes("data-flow="),
  "the score panel lost the pump meter or flow state",
);
invariant(
  appSource.includes("-MOVE CHAIN"),
  "the maneuver toast no longer announces the chain",
);
invariant(
  sceneSource.includes('rideManeuverRepeats.current.get("Barrel Escape")')
    && sceneSource.includes("barrelRun >= .9"),
  "a made barrel is no longer a scored chain event",
);
invariant(
  sceneSource.includes('closeoutLaunch ? "Closeout" : ""')
    && sceneSource.includes("closeoutLaunch ? 160 : 0"),
  "punting a closing section no longer pays its reading bonus",
);
invariant(
  sceneSource.includes("maneuverGrabSide:"),
  "the live grab channel left the stats contract",
);
invariant(
  appSource.includes('className={`air-ticker'),
  "the airborne spin ticker left the HUD",
);
invariant(
  appSource.includes('maneuverToast.name.startsWith("Barrel")'),
  "the barrel toast lost its MADE IT framing",
);

console.log(JSON.stringify({
  pumpedRhythm: Number(pumpedRhythm.toFixed(3)),
  pumpedDrive: Number(pumpedDrive.toFixed(2)),
  idleRhythm: Number(idleRhythm.toFixed(3)),
  headroomCappedDrive: Number(capped.driveMagnitude.toFixed(3)),
  aerialTorque: Number(flying.yawTorque.toFixed(2)),
  grabDamping: Number(flying.attitudeDamping.toFixed(2)),
}, null, 2));
