export type RenderQuality = "reduced" | "balanced" | "high";

const RENDER_QUALITY_ORDER: RenderQuality[] = [
  "reduced",
  "balanced",
  "high",
];

export function lowerRenderQuality(quality: RenderQuality): RenderQuality {
  const currentIndex = RENDER_QUALITY_ORDER.indexOf(quality);
  return RENDER_QUALITY_ORDER[Math.max(0, currentIndex - 1)];
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

export function shadowMapSizeForQuality(quality: RenderQuality) {
  if (quality === "high") return 2048;
  if (quality === "balanced") return 1024;
  return 512;
}
