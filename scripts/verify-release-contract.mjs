import {
  advanceOptionalTowProgress,
  evaluateBoardWaterInteraction,
  evaluatePopUpTransition,
  evaluateWaveTakeoff,
  INITIAL_STATS,
  optionalTowReleaseQuality,
  optionalTowReleasePhysicallySupported,
  optionalTowReleaseRecommended,
  reachedSurfTrainingStep,
  BREAKLOOM_RELEASE,
} from "../lib/game.ts";
import { readFileSync } from "node:fs";

const launchSource = readFileSync(
  new URL("../components/BreakloomApp.tsx", import.meta.url),
  "utf8",
);
const launchStyles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const worldMapSource = readFileSync(
  new URL("../components/WorldMap.tsx", import.meta.url),
  "utf8",
);
const surfSceneSource = readFileSync(
  new URL("../components/SurfScene.tsx", import.meta.url),
  "utf8",
);

const liveFace = {
  boardHeading: 0,
  velocityX: 0,
  velocityZ: 3.4,
  waveVelocityX: 0,
  waveVelocityZ: 6,
  slopeX: 0,
  slopeZ: -.18,
  surfaceRise: .56,
  surfaceLift: .82,
  crestDistance: 3.2,
  crestEnergy: .72,
  crestSurfable: true,
  boardStability: 1,
  boardLength: 2.5,
  boardWidth: .34,
  waveHeight: 2,
};
const alignedCapture = evaluateBoardWaterInteraction(liveFace);
const broadsideImpact = evaluateBoardWaterInteraction({
  ...liveFace,
  boardHeading: Math.PI / 2,
  velocityZ: 0,
});
const stillWaterStand = evaluateBoardWaterInteraction({
  ...liveFace,
  velocityZ: 0,
  waveVelocityZ: 0,
  slopeZ: 0,
  surfaceRise: 0,
  surfaceLift: 0,
  crestEnergy: 0,
  crestSurfable: false,
});
const arbitraryPopUp = evaluatePopUpTransition(.7, 100);
const flatTakeoff = evaluateWaveTakeoff({
  crestDistance: 3,
  crestEnergy: .18,
  crestSurfable: false,
  faceSlope: 0,
  surfaceRise: 0,
  surfaceLift: 0,
  breakProgress: .9,
  alignment: 1,
  paddleDrive: 1,
  waveHeight: 2,
});
const unsupportedStanding = reachedSurfTrainingStep({
  ...INITIAL_STATS,
  phase: "riding",
  paddleLeftWork: .3,
  paddleRightWork: .3,
  inLineup: true,
  takeoffAlignment: .82,
  takeoffSpeedMatch: .72,
  takeoffOpportunity: .24,
  rideTakeoffQuality: .12,
});
const supportedStanding = reachedSurfTrainingStep({
  ...INITIAL_STATS,
  phase: "riding",
  paddleLeftWork: .3,
  paddleRightWork: .3,
  inLineup: true,
  takeoffAlignment: .82,
  takeoffSpeedMatch: .72,
  takeoffOpportunity: .24,
  rideTakeoffQuality: .72,
  wavePressure: .34,
  hullPatchContact: .48,
});
const towProgressAfterOneSecond = advanceOptionalTowProgress(0, 1);
const idealTowReleaseQuality = optionalTowReleaseQuality(.9);

if (
  arbitraryPopUp.progress < .99
  || flatTakeoff.opportunity !== 0
  || stillWaterStand.outcome !== "stand"
  || stillWaterStand.capture !== 0
  || alignedCapture.outcome !== "capture"
  || broadsideImpact.outcome !== "tumble"
  || unsupportedStanding !== 5
  || supportedStanding !== 6
  || towProgressAfterOneSecond <= .06
  || towProgressAfterOneSecond >= .065
  || idealTowReleaseQuality !== 1
  || optionalTowReleaseRecommended(.84)
  || !optionalTowReleaseRecommended(.88)
  || !optionalTowReleaseRecommended(.9)
  || !optionalTowReleaseRecommended(.92)
  || optionalTowReleaseRecommended(.82)
  || optionalTowReleaseRecommended(.93)
  || optionalTowReleaseRecommended(.5)
  || !optionalTowReleasePhysicallySupported(true, .88, 1, .9)
  || optionalTowReleasePhysicallySupported(true, .88, 1, 2)
  || BREAKLOOM_RELEASE.version !== 236
  || !launchSource.includes('id: "easy"')
  || !launchSource.includes('id: "medium"')
  || !launchSource.includes('id: "hard"')
  || !launchSource.includes('id: "open"')
  || !launchSource.includes('className="coast-rail"')
  || !launchSource.includes('className="spot-list"')
  || !launchSource.includes('className="board-grid"')
  || !launchSource.includes('className="setup-panel"')
  || !launchStyles.includes(".conditions-strip")
  || !worldMapSource.includes("Beach entries")
  || !worldMapSource.includes("Selected surf peak")
  || !worldMapSource.includes("[zone.access.lat, zone.access.lon]")
  || !worldMapSource.includes("Optional jetski tow available")
  || !worldMapSource.includes("map.fitBounds(mapBounds")
  || !worldMapSource.includes("const pairedMinimum")
  || !worldMapSource.includes("refreshMarkerLayout")
  || !launchSource.includes("tow-instrument")
  || !launchSource.includes("RELEASE disengages anytime")
  || !surfSceneSource.includes("resolvePopUpLandingSupport")
  || !surfSceneSource.includes("if (landingSupport > 0)")
  || !surfSceneSource.includes("No face under the board")
  || !surfSceneSource.includes("&& state.rideEngaged")
  || !surfSceneSource.includes("transport.whitewater > .04")
  || !surfSceneSource.includes("horizontalDisplacement")
  || !surfSceneSource.includes("geometricNormal")
  || surfSceneSource.includes("<LineupWaveSetVolume")
  || surfSceneSource.includes("<BreakingWave")
  || !surfSceneSource.includes("stageOptionalTowCrestAtBreaker")
  || !surfSceneSource.includes("optionalTowReleaseFaceQuality")
  || !surfSceneSource.includes("towMotion.current.targetWavePhase -= Math.PI * 2")
  || surfSceneSource.includes("actionPressed || towMotion.current.progress >= 1")
  || surfSceneSource.includes("targetZ -= waveBreakingGeometryAt")
  || surfSceneSource.includes("towMotion.current.position.x - forwardX * 4.1")
  // The coast atlas, the map, and the peak list are first-screen decisions:
  // none of them may retreat behind an optional disclosure.
  || launchSource.indexOf("<WorldMap") > launchSource.indexOf('className="setup-panel"')
  || launchSource.indexOf('className="coast-rail"') > launchSource.indexOf("<WorldMap")
) {
  throw new Error("Breakloom release physics contract failed");
}

console.log(JSON.stringify({
  release: BREAKLOOM_RELEASE,
  arbitraryPopUpProgress: arbitraryPopUp.progress,
  flatWaterOutcome: stillWaterStand.outcome,
  flatWaterCapture: stillWaterStand.capture,
  alignedOutcome: alignedCapture.outcome,
  alignedCapture: alignedCapture.capture,
  broadsideOutcome: broadsideImpact.outcome,
  broadsideLoad: broadsideImpact.crossWaveLoad,
  unsupportedStandingLesson: unsupportedStanding,
  supportedStandingLesson: supportedStanding,
  optionalTow: {
    progressAfterOneSecond: towProgressAfterOneSecond,
    idealReleaseQuality: idealTowReleaseQuality,
  },
}, null, 2));
