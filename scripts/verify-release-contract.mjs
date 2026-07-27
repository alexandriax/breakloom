import {
  evaluateBoardWaterInteraction,
  evaluatePopUpTransition,
  evaluateWaveTakeoff,
  INITIAL_STATS,
  reachedSurfTrainingStep,
  SURFSCAPE_RELEASE,
} from "../lib/game.ts";
import { readFileSync } from "node:fs";

const launchSource = readFileSync(
  new URL("../components/SurfscapeApp.tsx", import.meta.url),
  "utf8",
);
const launchStyles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
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

if (
  arbitraryPopUp.progress < .99
  || flatTakeoff.opportunity !== 0
  || stillWaterStand.outcome !== "stand"
  || stillWaterStand.capture !== 0
  || alignedCapture.outcome !== "capture"
  || broadsideImpact.outcome !== "tumble"
  || unsupportedStanding !== 5
  || supportedStanding !== 6
  || SURFSCAPE_RELEASE.version !== 236
  || !launchSource.includes('id: "easy"')
  || !launchSource.includes('id: "medium"')
  || !launchSource.includes('id: "hard"')
  || !launchSource.includes('id: "open"')
  || !launchSource.includes('className="coast-rail"')
  || !launchSource.includes('className="spot-list"')
  || !launchSource.includes('className="board-grid"')
  || !launchSource.includes('className="setup-panel"')
  || !launchStyles.includes(".conditions-strip")
  // The coast atlas, the map, and the peak list are first-screen decisions:
  // none of them may retreat behind an optional disclosure.
  || launchSource.indexOf("<WorldMap") > launchSource.indexOf('className="setup-panel"')
  || launchSource.indexOf('className="coast-rail"') > launchSource.indexOf("<WorldMap")
) {
  throw new Error("Surfscape release physics contract failed");
}

console.log(JSON.stringify({
  release: SURFSCAPE_RELEASE,
  arbitraryPopUpProgress: arbitraryPopUp.progress,
  flatWaterOutcome: stillWaterStand.outcome,
  flatWaterCapture: stillWaterStand.capture,
  alignedOutcome: alignedCapture.outcome,
  alignedCapture: alignedCapture.capture,
  broadsideOutcome: broadsideImpact.outcome,
  broadsideLoad: broadsideImpact.crossWaveLoad,
  unsupportedStandingLesson: unsupportedStanding,
  supportedStandingLesson: supportedStanding,
}, null, 2));
