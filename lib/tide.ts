import type { BreakCharacter } from "./beaches";

export type TideResponse = {
  level: number;
  label: string;
  shortName: string;
  note: string;
  quality: number;
  faceScale: number;
  powerScale: number;
  steepnessScale: number;
  hollowScale: number;
  variabilityScale: number;
  breakShift: number;
  shorebreakScale: number;
};

export const DEFAULT_TIDE_BREAK: BreakCharacter = {
  kind: "beach",
  line: "A-FRAME",
  peel: 0,
  power: 1,
  steepness: .7,
  hollow: .4,
  variability: .4,
  length: 1,
};

const TIDE_RESPONSE_CACHE = new WeakMap<
  BreakCharacter,
  Map<number, TideResponse>
>();

export function tideResponseForBreak(
  tide: number,
  character: BreakCharacter,
): TideResponse {
  const safeTide = Number.isFinite(tide) ? tide : 0;
  const cacheKey = Math.round(safeTide * 1000) / 1000;
  const characterCache = TIDE_RESPONSE_CACHE.get(character);
  const cached = characterCache?.get(cacheKey);
  if (cached) return cached;
  const level = Math.max(
    -1,
    Math.min(1, safeTide / (safeTide < 0 ? 1.5 : 1.8)),
  );
  const low = Math.max(0, -level);
  const high = Math.max(0, level);
  const drained = level < -.38;
  const full = level > .42;
  const response = {
    ideal: 0,
    tolerance: .82,
    faceScale: 1,
    powerScale: 1,
    steepnessScale: 1,
    hollowScale: 1,
    variabilityScale: 1,
    breakShift: 0,
    shorebreakScale: 1,
    lowLabel: "Low-water draw",
    midLabel: "Tide in tune",
    highLabel: "Full-tide push",
    lowNote: "The break is drawing off the bottom",
    midNote: "Water depth and seabed are balanced",
    highNote: "More water is softening the break",
  };

  if (character.kind === "beach") {
    Object.assign(response, {
      ideal: -.08,
      tolerance: .7,
      faceScale: 1 + low * .08 - high * .05,
      powerScale: 1 + low * .06 - high * .04,
      steepnessScale: 1 + low * .15 - high * .16,
      hollowScale: 1 + low * .2 - high * .25,
      variabilityScale: 1 + low * .16 + high * .12,
      breakShift: level * 8,
      shorebreakScale: 1 + high * .32 - low * .08,
      lowLabel: "Exposed sandbars",
      midLabel: "Sandbar pulse",
      highLabel: "High-tide shorebreak",
      lowNote: "Shallow banks make punchier, less predictable peaks",
      midNote: "The sandbar is carrying a balanced breaking depth",
      highNote: "Deep banks soften outside while shorebreak gains weight",
    });
  } else if (character.kind === "reef") {
    Object.assign(response, {
      ideal: .06,
      tolerance: .82,
      faceScale: 1 + low * .06 - high * .035,
      powerScale: 1 + low * .08 - high * .04,
      steepnessScale: 1 + low * .16 - high * .12,
      hollowScale: 1 + low * .21 - high * .16,
      variabilityScale: 1 + low * .06 + high * .03,
      breakShift: level * 4.2,
      shorebreakScale: .9 + high * .08,
      lowLabel: "Drawn reef",
      midLabel: "Reef in tune",
      highLabel: "Deep-water wrap",
      lowNote: "Less water makes the reef faster, steeper, and hollower",
      midNote: "The reef has enough water without losing its shape",
      highNote: "Extra depth rounds the lip and moves energy down the line",
    });
  } else if (character.kind === "slab") {
    Object.assign(response, {
      ideal: .16,
      tolerance: .72,
      faceScale: 1 + low * .08 - high * .045,
      powerScale: 1 + low * .11 - high * .035,
      steepnessScale: 1 + low * .2 - high * .11,
      hollowScale: 1 + low * .24 - high * .13,
      variabilityScale: 1 + low * .08,
      breakShift: level * 3.2,
      shorebreakScale: .86 + high * .06,
      lowLabel: "Dry-ledge slab",
      midLabel: "Ledge engaged",
      highLabel: "Slab softened",
      lowNote: "The ledge is drawing hard with a violent pitching lip",
      midNote: "Water depth keeps the ledge powerful and makeable",
      highNote: "More water cushions the ledge without removing its power",
    });
  } else if (character.kind === "point") {
    Object.assign(response, {
      ideal: .18,
      tolerance: .78,
      faceScale: 1 - low * .025 + high * .03,
      powerScale: 1 - low * .03 + high * .025,
      steepnessScale: 1 + low * .12 - high * .055,
      hollowScale: 1 + low * .12 - high * .06,
      variabilityScale: 1 + low * .18 - high * .06,
      breakShift: level * 5.2,
      shorebreakScale: .82 + high * .07,
      lowLabel: "Sectioned point",
      midLabel: "Point running",
      highLabel: "Full-tide wrap",
      lowNote: "The line is fast and segmented over shallow sections",
      midNote: "The point is linking speed, wall, and pocket",
      highNote: "Extra depth opens a rounder, longer wrapping wall",
    });
  } else if (character.kind === "canyon") {
    Object.assign(response, {
      ideal: 0,
      tolerance: .95,
      faceScale: 1 + low * .025 + high * .018,
      powerScale: 1 + low * .025 + high * .02,
      steepnessScale: 1 + low * .04 - high * .025,
      hollowScale: 1 + low * .035 - high * .025,
      variabilityScale: 1 + Math.abs(level) * .05,
      breakShift: level * 2,
      shorebreakScale: .94 + high * .08,
      lowLabel: "Canyon draw",
      midLabel: "Canyon focus",
      highLabel: "Canyon surge",
      lowNote: "Deep-water focusing dominates the low-water draw",
      midNote: "The canyon is focusing swell directly into the peak",
      highNote: "Rising water adds surge more than it changes the peak",
    });
  }

  const tideFit = Math.exp(
    -Math.pow((level - response.ideal) / response.tolerance, 2),
  );
  const quality = Math.max(.42, Math.min(1, .45 + tideFit * .55));
  const result = {
    level,
    label: drained
      ? response.lowLabel
      : full
        ? response.highLabel
        : response.midLabel,
    shortName: drained
      ? "LOW DRAW"
      : full
        ? "FULL TIDE"
        : "MID TIDE",
    note: drained
      ? response.lowNote
      : full
        ? response.highNote
        : response.midNote,
    quality,
    faceScale: response.faceScale,
    powerScale: response.powerScale,
    steepnessScale: response.steepnessScale,
    hollowScale: response.hollowScale,
    variabilityScale: response.variabilityScale,
    breakShift: response.breakShift,
    shorebreakScale: response.shorebreakScale,
  };
  const nextCache = characterCache ?? new Map<number, TideResponse>();
  nextCache.set(cacheKey, result);
  if (!characterCache) TIDE_RESPONSE_CACHE.set(character, nextCache);
  return result;
}

/**
 * The face-height forecast shown to the player and the target used by the
 * physical breaker are intentionally the same value.
 */
export function forecastFaceHeightForBreak(
  significantHeight: number,
  tide: number,
  character: BreakCharacter,
) {
  const response = tideResponseForBreak(tide, character);
  const adjustedSignificantHeight = Math.max(0, significantHeight)
    * response.faceScale;
  // Offshore Hs is the average of the highest third of waves. Once that
  // energy shoals into a surf break, a softer character can spread the wall
  // out, but it must not make the vertical face shorter than the tide-adjusted
  // incoming Hs. More powerful reefs and ledges can amplify it above that.
  return adjustedSignificantHeight * Math.max(
    1,
    character.power * response.powerScale,
  );
}
