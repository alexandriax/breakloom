import {
  boundedSimulationDelta,
  emergencyRenderDpr,
  lowerRenderQuality,
  renderFrameSignal,
  renderQualityAfterPressure,
  shadowMapSizeForQuality,
} from "../lib/performance.ts";
import { readBufferedControlEdge } from "../lib/input.ts";

function invariant(condition, message) {
  if (!condition) throw new Error(`Runtime quality contract failed: ${message}`);
}

const desktopEmergencyDpr = emergencyRenderDpr(1.7, 1);
const mobileEmergencyDpr = emergencyRenderDpr(1.1, 0.82);

invariant(
  desktopEmergencyDpr <= 1.32 && desktopEmergencyDpr >= 1,
  "desktop stall response no longer sheds meaningful DPR",
);
invariant(
  mobileEmergencyDpr < 1 && mobileEmergencyDpr >= 0.82,
  "mobile stall response no longer protects its resolution floor",
);
invariant(lowerRenderQuality("high") === "balanced", "high quality cannot downgrade");
invariant(lowerRenderQuality("balanced") === "reduced", "balanced quality cannot downgrade");
invariant(lowerRenderQuality("reduced") === "reduced", "reduced quality is not a stable floor");
invariant(
  renderQualityAfterPressure("high", 1) === "high",
  "a transient stall rebuilds scene geometry",
);
invariant(
  renderQualityAfterPressure("high", 2) === "balanced",
  "repeated stalls do not lower scene complexity",
);
invariant(shadowMapSizeForQuality("high") === 2048, "high-tier shadows lost detail");
invariant(shadowMapSizeForQuality("balanced") === 1024, "balanced shadows exceed their budget");
invariant(shadowMapSizeForQuality("reduced") === 512, "reduced shadows exceed their budget");
invariant(renderFrameSignal(1 / 60) === "normal", "healthy frames report pressure");
invariant(renderFrameSignal(.18) === "pressure", "a real stall no longer sheds detail");
invariant(renderFrameSignal(.9) === "stale", "tab resumes incorrectly downgrade graphics");
invariant(
  Math.abs(boundedSimulationDelta(1 / 60) - 1 / 60) < 1e-9,
  "healthy simulation time is altered",
);
invariant(
  boundedSimulationDelta(.24) === .05,
  "a delayed frame can inject an unsafe gameplay impulse",
);
invariant(
  boundedSimulationDelta(Number.NaN) === 0,
  "invalid frame time reaches gameplay physics",
);

const quickTap = readBufferedControlEdge(false, false, 1, 0);
const consumedQuickTap = readBufferedControlEdge(false, false, 1, quickTap.nextConsumedPresses);
const heldPress = readBufferedControlEdge(true, false, 0, 0);
const resetSequence = readBufferedControlEdge(false, false, 0, 3);
const firstPressAfterReset = readBufferedControlEdge(true, false, 1, resetSequence.nextConsumedPresses);
invariant(quickTap.pressed, "a press released between frames is dropped");
invariant(!consumedQuickTap.pressed, "a buffered press fires more than once");
invariant(heldPress.pressed, "a normal held-button edge is dropped");
invariant(!resetSequence.pressed, "resetting a control sequence creates a phantom press");
invariant(firstPressAfterReset.pressed, "input does not recover after a sequence reset");

console.log(JSON.stringify({
  emergencyDpr: {
    desktop: Number(desktopEmergencyDpr.toFixed(3)),
    mobile: Number(mobileEmergencyDpr.toFixed(3)),
  },
  qualityStep: {
    high: lowerRenderQuality("high"),
    balanced: lowerRenderQuality("balanced"),
    reduced: lowerRenderQuality("reduced"),
    transientStall: renderQualityAfterPressure("high", 1),
    repeatedStalls: renderQualityAfterPressure("high", 2),
  },
  shadowMaps: {
    high: shadowMapSizeForQuality("high"),
    balanced: shadowMapSizeForQuality("balanced"),
    reduced: shadowMapSizeForQuality("reduced"),
  },
  framePacing: {
    healthy: renderFrameSignal(1 / 60),
    overloaded: renderFrameSignal(.18),
    resumed: renderFrameSignal(.9),
    maximumSimulationStep: boundedSimulationDelta(.24),
  },
  inputBuffer: {
    quickTap: quickTap.pressed,
    duplicate: consumedQuickTap.pressed,
    recoveredAfterReset: firstPressAfterReset.pressed,
  },
}, null, 2));
