export type RenderQuality = "reduced" | "balanced" | "high";
export type RenderFrameSignal = "normal" | "pressure" | "stale";

/** Preserve headroom for input and HUD work instead of upscaling at 55 fps. */
export function renderFrameBudget(averageSeconds: number, jankRatio: number) {
  return {
    severe: averageSeconds > .025 || jankRatio > .2,
    slow: averageSeconds > .0178 || jankRatio > .085,
    headroom: averageSeconds < .0172 && jankRatio < .025,
  };
}

const RENDER_QUALITY_ORDER: RenderQuality[] = [
  "reduced",
  "balanced",
  "high",
];
const FRAME_PRESSURE_SECONDS = 0.12;
const STALE_FRAME_SECONDS = 0.5;
const MAX_SIMULATION_DELTA = 0.05;

export function lowerRenderQuality(quality: RenderQuality): RenderQuality {
  const currentIndex = RENDER_QUALITY_ORDER.indexOf(quality);
  return RENDER_QUALITY_ORDER[Math.max(0, currentIndex - 1)];
}

/**
 * Resolution can react to the first expensive frame, but rebuilding scene
 * geometry on a one-off spike creates more pressure. Require a second strike
 * before changing the structural quality tier.
 */
export function renderQualityAfterPressure(
  quality: RenderQuality,
  pressureStrikes: number,
) {
  return pressureStrikes >= 2 ? lowerRenderQuality(quality) : quality;
}

/**
 * A long main-thread or GPU stall needs a decisive resolution reduction.
 * Small fixed steps take too many sampling windows to recover control latency,
 * so an emergency cut sheds half of the remaining DPR headroom at once.
 */
export function emergencyRenderDpr(current: number, minimum: number) {
  const safeMinimum = Math.max(0.5, minimum);
  const headroom = Math.max(0, current - safeMinimum);
  return Math.max(
    safeMinimum,
    current - Math.max(0.1, headroom * 0.55),
  );
}

/**
 * Distinguishes a rendered stall from time that passed while the tab or
 * renderer was suspended. A stale resume frame is not evidence that the GPU
 * cannot sustain its current quality tier.
 */
export function renderFrameSignal(delta: number): RenderFrameSignal {
  if (!Number.isFinite(delta) || delta <= 0 || delta > STALE_FRAME_SECONDS) {
    return "stale";
  }
  return delta > FRAME_PRESSURE_SECONDS ? "pressure" : "normal";
}

/**
 * Prevents one delayed frame from injecting a large impulse into surfing,
 * camera, vehicle, particle, and stamina dynamics. The renderer may drop
 * detail in response to the original delta while gameplay advances safely.
 */
export function boundedSimulationDelta(delta: number) {
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return Math.min(delta, MAX_SIMULATION_DELTA);
}

/** A suspended tab contributes no ocean time on its first returning frame. */
export function advanceOceanClock(elapsed: number, delta: number, active: boolean) {
  if (!active || renderFrameSignal(delta) === "stale") return elapsed;
  return elapsed + boundedSimulationDelta(delta);
}

export function shadowMapSizeForQuality(quality: RenderQuality) {
  if (quality === "high") return 2048;
  if (quality === "balanced") return 1024;
  return 512;
}
