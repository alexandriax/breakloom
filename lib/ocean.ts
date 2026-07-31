import type { BreakCharacter } from "./beaches";
import {
  bathymetryContourCoordinateAt,
  bathymetryContourGradientAt,
  bathymetryDepthAt,
  bathymetryGradientAt,
  shorelineReferenceAt,
} from "./bathymetry.ts";
import {
  buildWaveComponentBank,
  createWaveDepthProfile,
  sampleDominantWave,
  sampleWaveSurface,
  waveSpectrumInputFromMarine,
  type DominantWaveState,
  type WaveComponentBank,
  type WaveDepthProfile,
  type WaveSurfaceSample,
} from "./waves.ts";
import { forecastFaceHeightForBreak } from "./tide.ts";

/**
 * The legacy scene places its dry-line at world z=8. Bathymetry is expressed
 * relative to a zero shoreline, so every water consumer uses this one
 * conversion instead of quietly inventing its own coast coordinate.
 */
export const OCEAN_SHORELINE_WORLD_Z = 8;
export const OCEAN_TIDE_SHORELINE_TRAVEL = 3;

export type OceanSessionLike = {
  waveHeight: number;
  wavePeriod: number;
  waveDirection: number;
  windWaveHeight?: number;
  windWavePeriod?: number;
  windWavePeakPeriod?: number;
  windWaveDirection?: number;
  swellHeight: number;
  swellPeriod: number;
  swellPeakPeriod?: number;
  swellDirection: number;
  secondarySwellHeight?: number;
  secondarySwellPeriod?: number;
  secondarySwellDirection?: number;
  tertiarySwellHeight?: number;
  tertiarySwellPeriod?: number;
  tertiarySwellDirection?: number;
  windSpeed: number;
  windDirection: number;
  coastHeading: number;
  tide: number;
};

export type CoastWaveModel = {
  bank: WaveComponentBank;
  profile: WaveDepthProfile;
  coastId: string;
  zoneName: string;
  profileX: number;
};

export type CoastWaveSurfaceSample = WaveSurfaceSample & {
  /** Zero-shore bathymetry coordinate after the visible tide translation. */
  coastalZ: number;
  contourCoordinate: number;
  contourGradientX: number;
  contourGradientZ: number;
  /** Physical signed distance from the local shoreline; positive on land. */
  shoreDistance: number;
  shorelineZ: number;
  shoreCollapse: number;
  shoreCoverage: number;
  shoreAnchorHeight: number;
  shoreBurial: number;
};

export type OceanShoreTransitionInput = {
  x: number;
  elapsed: number;
  shoreDistance: number;
  rawHeight: number;
  displacementX: number;
  displacementZ: number;
  tideSurface: number;
  targetFaceHeight: number;
};

export type OceanShoreTransition = {
  height: number;
  displacementX: number;
  displacementZ: number;
  anchorHeight: number;
  burial: number;
  burialDepth: number;
  collapse: number;
  coverage: number;
  horizontalScale: number;
  rawHeightScale: number;
  runupReach: number;
  runupPulse: number;
  /** Partial derivatives; callers add the scaled raw-surface derivative. */
  heightDerivativeShoreDistance: number;
  heightDerivativeX: number;
  heightDerivativeTime: number;
};

/**
 * A single-valued ocean mesh cannot reproduce a true overturning lip. Keep
 * enough orbital skew to read as a solid wave body while preventing the
 * rendered crest from moving meters away from the Eulerian point sampled by
 * the surfboard.
 */
export function maximumVisibleHorizontalDisplacement(faceHeight: number) {
  return Math.max(.24, Math.min(.72, .18 + Math.max(0, faceHeight) * .1));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function quinticTransition(
  edge0: number,
  edge1: number,
  value: number,
) {
  const span = Math.max(1e-6, edge1 - edge0);
  const unit = clamp((value - edge0) / span, 0, 1);
  const valueUnit = unit * unit * unit
    * (unit * (unit * 6 - 15) + 10);
  const derivative = unit > 0 && unit < 1
    ? 30 * unit * unit * (unit - 1) * (unit - 1) / span
    : 0;
  return { value: valueUnit, derivative };
}

/**
 * One shader-mirrorable shoreline contract for rendering and gameplay.
 *
 * Full wave geometry survives through the surf/tow band. Only the final few
 * physical metres before the local shoreline collapse into a gently pulsing
 * swash anchor, then bury smoothly past a forecast-scaled runup limit.
 */
export function applyOceanShoreTransition(
  input: OceanShoreTransitionInput,
): OceanShoreTransition {
  const targetFaceHeight = Math.max(0, finite(input.targetFaceHeight));
  const collapseStart = -clamp(
    3.3 + targetFaceHeight * .36,
    4,
    6.5,
  );
  const collapseEnd = -.12;
  const collapse = quinticTransition(
    collapseStart,
    collapseEnd,
    input.shoreDistance,
  );
  const rawHeightScale = 1 - collapse.value;

  // A broad, slow pulse avoids phase-sized shoreline scallops. Its wavelength
  // and period are deliberately much larger than an individual breaking crest.
  const pulseWaveNumber = Math.PI * 2 / 260;
  const pulseAngularFrequency = Math.PI * 2 / 32;
  const pulsePhase = input.x * pulseWaveNumber
    - input.elapsed * pulseAngularFrequency;
  const runupPulse = .5 + .5 * Math.sin(pulsePhase);
  const pulseDerivativeX = .5 * Math.cos(pulsePhase) * pulseWaveNumber;
  const pulseDerivativeTime =
    -.5 * Math.cos(pulsePhase) * pulseAngularFrequency;
  // Swash still needs a visibly moving bore at the waterline after the
  // surfable carrier has collapsed. Forecast scaling keeps ankle-deep beach
  // wash around 0.35 m and lets genuinely large surf approach 0.5 m without
  // reintroducing a full-height wave or horizontal orbital throw on land.
  const pulseAmplitude = .32 + Math.min(.18, targetFaceHeight * .025);
  const anchorHeight = input.tideSurface - .12
    + pulseAmplitude * runupPulse;
  const anchorDerivativeX = pulseAmplitude * pulseDerivativeX;
  const anchorDerivativeTime = pulseAmplitude * pulseDerivativeTime;

  const runupReach = clamp(
    1.8 + targetFaceHeight * .52,
    2.2,
    5.6,
  );
  const burialTransition = quinticTransition(
    runupReach * .48,
    runupReach + 1.2,
    input.shoreDistance,
  );
  // Fully dry vertices must end below wet sand even at the highest tide/pulse;
  // coverage fading is a visual soft edge, not a substitute for geometry.
  const maximumBurial = .48
    + Math.max(0, input.tideSurface)
    + pulseAmplitude;
  const burialDepth = burialTransition.value * maximumBurial;
  const burialDerivative =
    burialTransition.derivative * maximumBurial;
  const coverageTransition = quinticTransition(
    runupReach - .45,
    runupReach + 1.1,
    input.shoreDistance,
  );

  const height = input.rawHeight * rawHeightScale
    + anchorHeight * collapse.value
    - burialDepth;
  const heightDerivativeShoreDistance =
    (anchorHeight - input.rawHeight) * collapse.derivative
    - burialDerivative;
  const heightDerivativeX = collapse.value * anchorDerivativeX;
  const heightDerivativeTime = collapse.value * anchorDerivativeTime;
  const horizontalScale = rawHeightScale;
  return {
    height,
    displacementX: input.displacementX * horizontalScale,
    displacementZ: input.displacementZ * horizontalScale,
    anchorHeight,
    burial: burialTransition.value,
    burialDepth,
    collapse: collapse.value,
    coverage: 1 - coverageTransition.value,
    horizontalScale,
    rawHeightScale,
    runupReach,
    runupPulse,
    heightDerivativeShoreDistance,
    heightDerivativeX,
    heightDerivativeTime,
  };
}

const PROFILE_WORLD_Z = [
  -1260, -1100, -940, -790, -650, -530, -430, -345, -275, -215,
  -165, -126, -96, -73, -55, -40, -28, -19, -12, -7, -3, 0, 4,
] as const;
/**
 * Wave travel is integrated through one stable depth profile per named break.
 * Alongshore variation still comes from the exact 2D contour field at every
 * query; keeping the 1D integration profile fixed prevents crests from
 * changing phase whenever a caller crosses an arbitrary recenter boundary.
 */
export const OCEAN_WAVE_PROFILE_X = 0;
const MAX_BANK_CACHE_ENTRIES = 48;
const MAX_PROFILE_CACHE_ENTRIES = 48;
const bankCache = new Map<string, WaveComponentBank>();
const profileCache = new Map<string, WaveDepthProfile>();

function finite(value: number | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function rounded(value: number | undefined, precision = 1000) {
  return Math.round(finite(value) * precision) / precision;
}

function limitedCacheSet<Value>(
  cache: Map<string, Value>,
  key: string,
  value: Value,
  maximum: number,
) {
  cache.set(key, value);
  if (cache.size <= maximum) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

function fallbackCoastId(character?: BreakCharacter) {
  if (character?.coastId) return character.coastId;
  if (character?.kind === "slab") return "teahupoo";
  if (character?.kind === "canyon") return "nazare";
  if (character?.kind === "point") return "jeffreys-bay";
  if (character?.kind === "reef") return "pipeline";
  return "rockaway";
}

export function oceanLocationFor(character?: BreakCharacter) {
  return {
    coastId: fallbackCoastId(character),
    zoneName: character?.zoneName ?? "",
  };
}

export function oceanTideShorelineShift(tide: number) {
  return Math.max(-1.5, Math.min(1.8, finite(tide)))
    * OCEAN_TIDE_SHORELINE_TRAVEL;
}

export function worldToBathymetryZ(worldZ: number, tide: number) {
  return worldZ
    - OCEAN_SHORELINE_WORLD_Z
    - oceanTideShorelineShift(tide);
}

function profileFor(coastId: string, zoneName: string) {
  const profileX = OCEAN_WAVE_PROFILE_X;
  const key = `${coastId}:${zoneName}`;
  const cached = profileCache.get(key);
  if (cached) return { profile: cached, profileX };
  const knots = PROFILE_WORLD_Z.map((coastalZ) => ({
    z: bathymetryContourCoordinateAt(
      coastId,
      zoneName,
      profileX,
      coastalZ,
    ),
    depth: bathymetryDepthAt(
      coastId,
      zoneName,
      profileX,
      coastalZ,
    ),
  }));
  const referenceZ = bathymetryContourCoordinateAt(
    coastId,
    zoneName,
    profileX,
    PROFILE_WORLD_Z[0],
  );
  const profile = createWaveDepthProfile(knots, referenceZ);
  limitedCacheSet(
    profileCache,
    key,
    profile,
    MAX_PROFILE_CACHE_ENTRIES,
  );
  return { profile, profileX };
}

function bankKey(
  settings: OceanSessionLike,
  coastId: string,
  zoneName: string,
) {
  return [
    coastId,
    zoneName,
    rounded(settings.waveHeight),
    rounded(settings.wavePeriod),
    rounded(settings.waveDirection),
    rounded(settings.swellHeight),
    rounded(settings.swellPeriod),
    rounded(settings.swellPeakPeriod),
    rounded(settings.swellDirection),
    rounded(settings.secondarySwellHeight),
    rounded(settings.secondarySwellPeriod),
    rounded(settings.secondarySwellDirection),
    rounded(settings.tertiarySwellHeight),
    rounded(settings.tertiarySwellPeriod),
    rounded(settings.tertiarySwellDirection),
    rounded(settings.windWaveHeight),
    rounded(settings.windWavePeriod),
    rounded(settings.windWavePeakPeriod),
    rounded(settings.windWaveDirection),
    rounded(settings.windSpeed),
    rounded(settings.windDirection),
    rounded(settings.coastHeading),
  ].join(":");
}

function bankFor(
  settings: OceanSessionLike,
  coastId: string,
  zoneName: string,
  referenceDepth: number,
) {
  const key = bankKey(settings, coastId, zoneName);
  const cached = bankCache.get(key);
  if (cached) return cached;
  const input = waveSpectrumInputFromMarine(
    settings,
    `${coastId}:${zoneName}:living-sea`,
  );
  const bank = buildWaveComponentBank({
    ...input,
    componentCount: 28,
    referenceDepth,
  });
  limitedCacheSet(bankCache, key, bank, MAX_BANK_CACHE_ENTRIES);
  return bank;
}

export function coastWaveModelAt(
  _x: number,
  settings: OceanSessionLike,
  character?: BreakCharacter,
): CoastWaveModel {
  const { coastId, zoneName } = oceanLocationFor(character);
  const { profile, profileX } = profileFor(coastId, zoneName);
  const referenceDepth = profile.knots[0]?.depth ?? 40;
  return {
    bank: bankFor(
      settings,
      coastId,
      zoneName,
      referenceDepth,
    ),
    profile,
    coastId,
    zoneName,
    profileX,
  };
}

function transformDominant(
  dominant: DominantWaveState | null,
  _bank: WaveComponentBank,
  contourGradientX: number,
  contourGradientZ: number,
) {
  if (!dominant) return null;
  const gradientX = dominant.gradientX
    + dominant.gradientZ * contourGradientX;
  const gradientZ = dominant.gradientZ * contourGradientZ;
  const propagationGradientX =
    dominant.propagationGradientX
      + dominant.propagationGradientZ * contourGradientX;
  const propagationGradientZ =
    dominant.propagationGradientZ * contourGradientZ;
  const propagationMagnitude = Math.max(
    1e-9,
    Math.hypot(
      propagationGradientX,
      propagationGradientZ,
    ),
  );
  const celerity = dominant.propagationAngularFrequency
    / propagationMagnitude;
  return {
    ...dominant,
    gradientX,
    gradientZ,
    propagationGradientX,
    propagationGradientZ,
    directionX: propagationGradientX / propagationMagnitude,
    directionZ: propagationGradientZ / propagationMagnitude,
    celerityX: celerity
      * propagationGradientX / propagationMagnitude,
    celerityZ: celerity
      * propagationGradientZ / propagationMagnitude,
    celerity,
    wavelength: Math.PI * 2 / propagationMagnitude,
  } satisfies DominantWaveState;
}

export function sampleCoastWaveSurface(
  x: number,
  worldZ: number,
  elapsed: number,
  settings: OceanSessionLike,
  character?: BreakCharacter,
  resolveBreakingDepthGradient = true,
): CoastWaveSurfaceSample {
  const model = coastWaveModelAt(x, settings, character);
  const targetFaceHeight = character
    ? forecastFaceHeightForBreak(
        settings.waveHeight,
        settings.tide,
        character,
      )
    : Math.max(0, settings.waveHeight);
  const coastalZ = worldToBathymetryZ(worldZ, settings.tide);
  const shorelineZ = shorelineReferenceAt(
    model.coastId,
    model.zoneName,
    x,
  );
  const shorelineGradientRadius = .4;
  const shorelineGradientX = (
    shorelineReferenceAt(
      model.coastId,
      model.zoneName,
      x + shorelineGradientRadius,
    )
      - shorelineReferenceAt(
        model.coastId,
        model.zoneName,
        x - shorelineGradientRadius,
      )
  ) / (shorelineGradientRadius * 2);
  const shoreDistance = coastalZ - shorelineZ;
  const contourCoordinate = bathymetryContourCoordinateAt(
    model.coastId,
    model.zoneName,
    x,
    coastalZ,
  );
  const contourGradient = bathymetryContourGradientAt(
    model.coastId,
    model.zoneName,
    x,
    coastalZ,
  );
  const breakingDepth = bathymetryDepthAt(
    model.coastId,
    model.zoneName,
    x,
    coastalZ,
  );
  const safeContourZ = Math.abs(contourGradient.z) < .08
    ? Math.sign(contourGradient.z || 1) * .08
    : contourGradient.z;
  const depthGradient = resolveBreakingDepthGradient
    ? bathymetryGradientAt(
        model.coastId,
        model.zoneName,
        x,
        coastalZ,
      )
    : { x: 0, z: 0 };
  const breakingDepthGradientX = depthGradient.x
    - depthGradient.z * contourGradient.x / safeContourZ;
  const breakingDepthGradientZ = depthGradient.z
    / safeContourZ;
  const core = sampleWaveSurface(
    model.bank,
    model.profile,
    x,
    contourCoordinate,
    elapsed,
    {
      breakingIndex: .78,
      breakingDepth,
      breakingDepthGradientX,
      breakingDepthGradientZ,
      maximumCombinedSteepness: .42,
      maximumHorizontalSlope: .64,
      targetFaceHeight,
      breakerPower: character?.power ?? 1,
      breakerSteepness: character?.steepness ?? .78,
      breakerHollow: character?.hollow ?? .45,
    },
  );
  let gradientX = core.gradientX
    + core.gradientZ * contourGradient.x;
  let gradientZ = core.gradientZ * contourGradient.z;
  let horizontalVelocityX = core.horizontalVelocityX;
  let horizontalVelocityZ = (
    core.horizontalVelocityZ
      - contourGradient.x * horizontalVelocityX
  ) / safeContourZ;
  let displacementX = core.displacementX;
  let displacementZ = (
    core.displacementZ
      - contourGradient.x * displacementX
  ) / safeContourZ;
  const maximumDisplacement = maximumVisibleHorizontalDisplacement(
    targetFaceHeight,
  );
  const displacementMagnitude = Math.hypot(
    displacementX,
    displacementZ,
  );
  const displacementScale = displacementMagnitude > maximumDisplacement
    ? maximumDisplacement / displacementMagnitude
    : 1;
  displacementX *= displacementScale;
  displacementZ *= displacementScale;
  const tideSurface = settings.tide * .3;
  const transition = applyOceanShoreTransition({
    x,
    elapsed,
    shoreDistance,
    rawHeight: core.height + tideSurface,
    displacementX,
    displacementZ,
    tideSurface,
    targetFaceHeight,
  });
  gradientX = gradientX * transition.rawHeightScale
    + transition.heightDerivativeX
    - transition.heightDerivativeShoreDistance * shorelineGradientX;
  gradientZ = gradientZ * transition.rawHeightScale
    + transition.heightDerivativeShoreDistance;
  const timeDerivative = core.timeDerivative * transition.rawHeightScale
    + transition.heightDerivativeTime;
  horizontalVelocityX *= transition.horizontalScale;
  horizontalVelocityZ *= transition.horizontalScale;
  const normalLength = Math.hypot(gradientX, 1, gradientZ);
  return {
    ...core,
    height: transition.height,
    displacementY: transition.height,
    timeDerivative,
    gradientX,
    gradientZ,
    normalX: -gradientX / normalLength,
    normalY: 1 / normalLength,
    normalZ: -gradientZ / normalLength,
    horizontalVelocityX,
    horizontalVelocityZ,
    verticalVelocity: timeDerivative,
    displacementX: transition.displacementX,
    displacementZ: transition.displacementZ,
    breakerVelocityX:
      core.breakerVelocityX * transition.horizontalScale,
    breakerVelocityZ:
      core.breakerVelocityZ * transition.horizontalScale,
    horizontalJacobianMargin:
      1 - (1 - core.horizontalJacobianMargin)
        * displacementScale
        * transition.horizontalScale,
    dominant: transformDominant(
      core.dominant,
      model.bank,
      contourGradient.x,
      contourGradient.z,
    ),
    coastalZ,
    contourCoordinate,
    contourGradientX: contourGradient.x,
    contourGradientZ: contourGradient.z,
    shoreDistance,
    shorelineZ,
    shoreCollapse: transition.collapse,
    shoreCoverage: transition.coverage,
    shoreAnchorHeight: transition.anchorHeight,
    shoreBurial: transition.burial,
  };
}

export function sampleCoastDominantWave(
  x: number,
  worldZ: number,
  elapsed: number,
  settings: OceanSessionLike,
  character?: BreakCharacter,
) {
  const model = coastWaveModelAt(x, settings, character);
  const coastalZ = worldToBathymetryZ(worldZ, settings.tide);
  const contourCoordinate = bathymetryContourCoordinateAt(
    model.coastId,
    model.zoneName,
    x,
    coastalZ,
  );
  const contourGradient = bathymetryContourGradientAt(
    model.coastId,
    model.zoneName,
    x,
    coastalZ,
  );
  return transformDominant(
    sampleDominantWave(
      model.bank,
      model.profile,
      x,
      contourCoordinate,
      elapsed,
    ),
    model.bank,
    contourGradient.x,
    contourGradient.z,
  );
}
