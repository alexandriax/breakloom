import type { BreakCharacter } from "./beaches";
import {
  bathymetryContourCoordinateAt,
  bathymetryContourGradientAt,
  bathymetryDepthAt,
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
};

const PROFILE_WORLD_Z = [
  -1260, -1100, -940, -790, -650, -530, -430, -345, -275, -215,
  -165, -126, -96, -73, -55, -40, -28, -19, -12, -7, -3, 0, 4,
] as const;
const PROFILE_X_STEP = 12;
const MAX_BANK_CACHE_ENTRIES = 48;
const MAX_PROFILE_CACHE_ENTRIES = 192;
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

function profileFor(coastId: string, zoneName: string, x: number) {
  const profileX = Math.round(x / PROFILE_X_STEP) * PROFILE_X_STEP;
  const key = `${coastId}:${zoneName}:${profileX}`;
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
  x: number,
  settings: OceanSessionLike,
  character?: BreakCharacter,
): CoastWaveModel {
  const { coastId, zoneName } = oceanLocationFor(character);
  const { profile, profileX } = profileFor(coastId, zoneName, x);
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
): CoastWaveSurfaceSample {
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
  const core = sampleWaveSurface(
    model.bank,
    model.profile,
    x,
    contourCoordinate,
    elapsed,
    {
      breakingIndex: .78,
      maximumCombinedSteepness: .42,
      maximumHorizontalSlope: .64,
      breakerPower: character?.power ?? 1,
      breakerSteepness: character?.steepness ?? .78,
      breakerHollow: character?.hollow ?? .45,
    },
  );
  const gradientX = core.gradientX
    + core.gradientZ * contourGradient.x;
  const gradientZ = core.gradientZ * contourGradient.z;
  const normalLength = Math.hypot(gradientX, 1, gradientZ);
  const safeContourZ = Math.abs(contourGradient.z) < .08
    ? Math.sign(contourGradient.z || 1) * .08
    : contourGradient.z;
  const horizontalVelocityX = core.horizontalVelocityX;
  const horizontalVelocityZ = (
    core.horizontalVelocityZ
      - contourGradient.x * horizontalVelocityX
  ) / safeContourZ;
  const displacementX = core.displacementX;
  const displacementZ = (
    core.displacementZ
      - contourGradient.x * displacementX
  ) / safeContourZ;
  const tideSurface = settings.tide * .3;
  return {
    ...core,
    height: core.height + tideSurface,
    displacementY: core.height + tideSurface,
    gradientX,
    gradientZ,
    normalX: -gradientX / normalLength,
    normalY: 1 / normalLength,
    normalZ: -gradientZ / normalLength,
    horizontalVelocityX,
    horizontalVelocityZ,
    displacementX,
    displacementZ,
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
