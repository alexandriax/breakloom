/**
 * Deterministic, energy-conserving gravity-wave core.
 *
 * The component bank is deliberately plain data so it can be serialized,
 * replayed, and packed into GPU uniforms. Runtime sampling keeps the phase
 * coherent over changing depth by integrating the local cross-shore wave
 * number instead of multiplying position by a locally changing wave number.
 */

const GRAVITY = 9.81;
const TAU = Math.PI * 2;
const DEFAULT_REFERENCE_DEPTH = 180;
const MIN_DEPTH = .08;

export type WaveComponentKind = "swell" | "wind-sea";

export type WavePartitionInput = {
  kind?: WaveComponentKind;
  significantHeight: number;
  peakPeriod: number;
  directionDegrees: number;
  directionalSpreadDegrees?: number;
  frequencySpread?: number;
  label?: string;
};

export type WindSeaInput = {
  significantHeight?: number;
  peakPeriod?: number;
  directionDegrees?: number;
  directionalSpreadDegrees?: number;
};

export type WaveSpectrumInput = {
  /** Total significant height. This is the complete energy budget. */
  totalSignificantHeight: number;
  peakPeriod: number;
  /**
   * Local direction of travel: 0 degrees travels toward +z and 90 degrees
   * travels toward +x.
   */
  directionDegrees: number;
  swellPartitions?: readonly WavePartitionInput[];
  windSea?: WindSeaInput;
  windSpeed?: number;
  windDirectionDegrees?: number;
  componentCount?: number;
  referenceDepth?: number;
  seed?: number | string;
};

export type MarineWaveConditionsLike = {
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
};

export type WaveComponent = {
  id: number;
  partitionId: number;
  kind: WaveComponentKind;
  amplitude: number;
  variance: number;
  period: number;
  angularFrequency: number;
  referenceWaveNumber: number;
  phaseOffset: number;
  directionDegrees: number;
  directionX: number;
  directionZ: number;
};

export type WaveSpectrumPartition = {
  id: number;
  kind: WaveComponentKind;
  label: string;
  variance: number;
  significantHeight: number;
  peakPeriod: number;
  directionDegrees: number;
  directionalSpreadDegrees: number;
  componentCount: number;
};

export type WaveComponentBank = {
  version: 1;
  seed: number;
  referenceDepth: number;
  significantHeight: number;
  totalVariance: number;
  dominantComponentId: number;
  envelopeEnergyMin: number;
  envelopeEnergyMax: number;
  partitions: WaveSpectrumPartition[];
  components: WaveComponent[];
};

export type WaveDepthKnot = {
  z: number;
  depth: number;
};

export type WaveDepthProfile = {
  referenceZ: number;
  knots: WaveDepthKnot[];
};

export type WavePropagationFieldSample = {
  depth: number;
  /**
   * Optional bathymetric contour coordinate. If omitted, world z is used.
   * Supplying it lets bars, points, reefs, and canyons bend phase fronts while
   * retaining a single-valued, differentiable phase field.
   */
  contourCoordinate?: number;
};

export type WavePropagationField = {
  referenceZ: number;
  sample: (x: number, z: number) => WavePropagationFieldSample;
};

export type WaveDepthSource = WaveDepthProfile | WavePropagationField;

export type WaveSamplingOptions = {
  breakingIndex?: number;
  maximumCombinedSteepness?: number;
  maximumHorizontalSlope?: number;
  /**
   * Crest-to-trough face expected at the named break. The spectral sea remains
   * untouched offshore; this only supplies the coherent carrier energy that
   * shoaling set waves need as they stand up.
   */
  targetFaceHeight?: number;
  /** Break-specific nonlinear shape controls, centered around 1. */
  breakerPower?: number;
  breakerSteepness?: number;
  breakerHollow?: number;
  gradientStep?: number;
  includeComponents?: boolean;
};

export type WaveRegime = "deep" | "shoaling" | "breaking" | "broken";

export type WaveComponentState = {
  id: number;
  kind: WaveComponentKind;
  phase: number;
  amplitude: number;
  elevation: number;
  timeDerivative: number;
  waveNumber: number;
  wavelength: number;
  celerity: number;
  groupVelocity: number;
  directionX: number;
  directionZ: number;
  horizontalVelocityX: number;
  horizontalVelocityZ: number;
  verticalVelocity: number;
  steepness: number;
  shoalingGain: number;
};

export type DominantWaveState = {
  componentId: number;
  phase: number;
  /** Instantaneous amplitude of the complete dominant spectral partition. */
  amplitude: number;
  normalizedPhase: number;
  crestOrdinal: number;
  crestId: string;
  crestEnergy: number;
  envelope: number;
  angularFrequency: number;
  propagationAngularFrequency: number;
  /** Instantaneous analytic-phase gradient used by the breaker shape. */
  gradientX: number;
  gradientZ: number;
  /** Stable spectral carrier gradient used for travel direction/celerity. */
  propagationGradientX: number;
  propagationGradientZ: number;
  directionX: number;
  directionZ: number;
  celerityX: number;
  celerityZ: number;
  celerity: number;
  wavelength: number;
};

export type WaveSurfaceSample = {
  height: number;
  displacementX: number;
  displacementY: number;
  displacementZ: number;
  timeDerivative: number;
  gradientX: number;
  gradientZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  horizontalVelocityX: number;
  horizontalVelocityZ: number;
  verticalVelocity: number;
  depth: number;
  localSignificantHeight: number;
  breakingRatio: number;
  breakingProgress: number;
  brokenProgress: number;
  whitewater: number;
  breakerVelocityX: number;
  breakerVelocityZ: number;
  regime: WaveRegime;
  horizontalJacobianMargin: number;
  dominant: DominantWaveState | null;
  components?: WaveComponentState[];
};

type ResolvedPartition = {
  kind: WaveComponentKind;
  label: string;
  variance: number;
  peakPeriod: number;
  directionDegrees: number;
  directionalSpreadDegrees: number;
  frequencySpread: number;
  count: number;
};

type LocalGeometry = {
  waveNumber: number;
  referenceWaveNumber: number;
  crossShoreWaveNumber: number;
  alongshoreWaveNumber: number;
  directionX: number;
  directionZ: number;
  celerity: number;
  groupVelocity: number;
  referenceGroupVelocity: number;
  phase: number;
};

type LocalTerm = {
  component: WaveComponent;
  geometry: LocalGeometry;
  amplitude: number;
  shoalingGain: number;
};

type ProfileTravelTable = {
  z: number[];
  integral: number[];
  referenceIntegral: number;
  alongshoreWaveNumber: number;
  crossShoreSign: number;
};

const profileTravelCache = new WeakMap<
  WaveDepthProfile,
  WeakMap<WaveComponent, ProfileTravelTable>
>();

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: number | undefined, fallback: number) {
  return Math.max(0, finiteOr(value, fallback));
}

function wrapDegrees(value: number) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

/**
 * Folds a marine bearing into the seaward-to-shoreward half-plane used by the
 * coastal simulation. Forecast grids occasionally report energy from behind
 * the local coastline (or use a "from" bearing whose ambiguity puts a
 * component over land). Letting that sign pass through makes crests propagate
 * offshore and can pull a surfboard backwards. A real nearshore component is
 * refracted into the incoming hemisphere instead.
 */
export function coastalIncomingDirectionDegrees(value: number) {
  const wrapped = wrapDegrees(value);
  const folded = wrapped > 90
    ? 180 - wrapped
    : wrapped < -90
      ? -180 - wrapped
      : wrapped;
  // Preserve strongly oblique swell without allowing a numerically stationary
  // cross-shore component at exactly ninety degrees.
  return clamp(folded, -88, 88);
}

function wrapRadians(value: number) {
  return ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

function seedFrom(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return (Math.floor(value) >>> 0) || 0x6d2b79f5;
  }
  const text = String(value ?? "breakloom-wave-spectrum");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 0x6d2b79f5;
}

function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A bounded logistic quantile is sufficient for deterministic stratified
 * spectral sampling and avoids a dependency on a statistics package.
 */
function spectralQuantile(unitValue: number) {
  const value = clamp(unitValue, .0025, .9975);
  return clamp(Math.log(value / (1 - value)) * .38, -2.3, 2.3);
}

export function significantHeightToVariance(significantHeight: number) {
  const height = positiveOr(significantHeight, 0);
  return (height / 4) ** 2;
}

/**
 * Significant (roughly four-sigma) surface-slope steepness for a random sea.
 *
 * Spectral components do not all reach maximum slope at the same instant, so
 * summing |a k| treats a natural random spectrum as one impossible,
 * phase-aligned wall. Variances add, so the physical aggregate is the
 * root-sum-square slope spectrum.
 */
export function significantSpectralSteepness(
  components: readonly {
    amplitude: number;
    waveNumber: number;
  }[],
) {
  return 2 * Math.sqrt(components.reduce(
    (variance, component) => variance
      + .5 * (
        Math.max(0, component.amplitude)
          * Math.max(0, component.waveNumber)
      ) ** 2,
    0,
  ));
}

export function varianceToSignificantHeight(variance: number) {
  return 4 * Math.sqrt(positiveOr(variance, 0));
}

/**
 * Solves omega² = g k tanh(kh) with a guarded Newton iteration.
 */
export function solveFiniteDepthWaveNumber(
  angularFrequency: number,
  depth: number,
) {
  const omega = positiveOr(angularFrequency, 0);
  const safeDepth = Math.max(MIN_DEPTH, positiveOr(depth, MIN_DEPTH));
  if (omega === 0) return 0;
  const deepGuess = omega * omega / GRAVITY;
  const shallowGuess = omega / Math.sqrt(GRAVITY * safeDepth);
  let waveNumber = Math.max(1e-7, Math.max(deepGuess, shallowGuess));
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const kh = waveNumber * safeDepth;
    const tanh = Math.tanh(kh);
    const cosh = Math.cosh(Math.min(40, kh));
    const sechSquared = kh > 40 ? 0 : 1 / (cosh * cosh);
    const residual = GRAVITY * waveNumber * tanh - omega * omega;
    const derivative = GRAVITY * (tanh + kh * sechSquared);
    const next = waveNumber - residual / Math.max(1e-9, derivative);
    waveNumber = Math.max(1e-8, Number.isFinite(next) ? next : waveNumber);
    if (Math.abs(residual) < 1e-11 * Math.max(1, omega * omega)) break;
  }
  return waveNumber;
}

export function phaseCelerity(angularFrequency: number, waveNumber: number) {
  return positiveOr(angularFrequency, 0) / Math.max(1e-9, waveNumber);
}

export function groupVelocity(
  angularFrequency: number,
  waveNumber: number,
  depth: number,
) {
  const celerity = phaseCelerity(angularFrequency, waveNumber);
  const doubledKh = 2 * Math.max(0, waveNumber * Math.max(MIN_DEPTH, depth));
  const correction = doubledKh > 40
    ? 0
    : doubledKh / Math.max(1e-9, Math.sinh(doubledKh));
  return celerity * .5 * (1 + correction);
}

export function createWaveDepthProfile(
  knots: readonly WaveDepthKnot[],
  referenceZ?: number,
): WaveDepthProfile {
  if (knots.length === 0) {
    throw new Error("A wave depth profile requires at least one knot.");
  }
  const sorted = knots
    .map((knot) => ({
      z: finiteOr(knot.z, 0),
      depth: Math.max(MIN_DEPTH, positiveOr(knot.depth, MIN_DEPTH)),
    }))
    .sort((a, b) => a.z - b.z);
  const unique: WaveDepthKnot[] = [];
  for (const knot of sorted) {
    if (unique.length > 0 && Math.abs(unique[unique.length - 1].z - knot.z) < 1e-9) {
      unique[unique.length - 1] = knot;
    } else {
      unique.push(knot);
    }
  }
  return {
    referenceZ: finiteOr(referenceZ, unique[0].z),
    knots: unique,
  };
}

export function depthAt(profile: WaveDepthProfile, z: number) {
  const knots = profile.knots;
  if (knots.length === 1 || z <= knots[0].z) return knots[0].depth;
  const last = knots[knots.length - 1];
  if (z >= last.z) return last.depth;
  let low = 0;
  let high = knots.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (knots[middle].z <= z) low = middle;
    else high = middle;
  }
  const start = knots[low];
  const end = knots[high];
  const blend = (z - start.z) / Math.max(1e-9, end.z - start.z);
  return start.depth + (end.depth - start.depth) * blend;
}

function isDepthProfile(source: WaveDepthSource): source is WaveDepthProfile {
  return "knots" in source;
}

function sourceSampleAt(source: WaveDepthSource, x: number, z: number) {
  if (isDepthProfile(source)) {
    return { depth: depthAt(source, z), contourCoordinate: z };
  }
  const sample = source.sample(x, z);
  return {
    depth: Math.max(MIN_DEPTH, positiveOr(sample.depth, MIN_DEPTH)),
    contourCoordinate: finiteOr(sample.contourCoordinate, z),
  };
}

function profileCrossShoreWaveNumber(
  component: WaveComponent,
  profile: WaveDepthProfile,
  alongshoreWaveNumber: number,
  crossShoreSign: number,
  z: number,
) {
  const waveNumber = solveFiniteDepthWaveNumber(
    component.angularFrequency,
    depthAt(profile, z),
  );
  return crossShoreSign * Math.sqrt(Math.max(
    1e-12,
    waveNumber * waveNumber
      - alongshoreWaveNumber * alongshoreWaveNumber,
  ));
}

function buildProfileTravelTable(
  component: WaveComponent,
  profile: WaveDepthProfile,
) {
  const referenceDepth = depthAt(profile, profile.referenceZ);
  const referenceWaveNumber = solveFiniteDepthWaveNumber(
    component.angularFrequency,
    referenceDepth,
  );
  const alongshoreWaveNumber = referenceWaveNumber * component.directionX;
  const crossShoreSign = component.directionZ < 0 ? -1 : 1;
  const breakpoints = [
    ...profile.knots.map((knot) => knot.z),
    profile.referenceZ,
  ].sort((a, b) => a - b);
  const uniqueBreakpoints = breakpoints.filter(
    (value, index) => index === 0 || Math.abs(value - breakpoints[index - 1]) > 1e-9,
  );
  const z: number[] = [uniqueBreakpoints[0]];
  for (let index = 0; index < uniqueBreakpoints.length - 1; index += 1) {
    const start = uniqueBreakpoints[index];
    const end = uniqueBreakpoints[index + 1];
    const count = Math.max(1, Math.ceil(Math.abs(end - start) / 3));
    for (let step = 1; step <= count; step += 1) {
      z.push(start + (end - start) * step / count);
    }
  }
  const integral = new Array<number>(z.length).fill(0);
  for (let index = 1; index < z.length; index += 1) {
    const start = z[index - 1];
    const end = z[index];
    const middle = (start + end) * .5;
    const startValue = profileCrossShoreWaveNumber(
      component,
      profile,
      alongshoreWaveNumber,
      crossShoreSign,
      start,
    );
    const middleValue = profileCrossShoreWaveNumber(
      component,
      profile,
      alongshoreWaveNumber,
      crossShoreSign,
      middle,
    );
    const endValue = profileCrossShoreWaveNumber(
      component,
      profile,
      alongshoreWaveNumber,
      crossShoreSign,
      end,
    );
    integral[index] = integral[index - 1]
      + (end - start) * (startValue + 4 * middleValue + endValue) / 6;
  }
  const referenceIndex = z.findIndex(
    (value) => Math.abs(value - profile.referenceZ) < 1e-9,
  );
  return {
    z,
    integral,
    referenceIntegral: integral[Math.max(0, referenceIndex)],
    alongshoreWaveNumber,
    crossShoreSign,
  } satisfies ProfileTravelTable;
}

function profileTravelTable(
  component: WaveComponent,
  profile: WaveDepthProfile,
) {
  let componentTables = profileTravelCache.get(profile);
  if (!componentTables) {
    componentTables = new WeakMap();
    profileTravelCache.set(profile, componentTables);
  }
  let table = componentTables.get(component);
  if (!table) {
    table = buildProfileTravelTable(component, profile);
    componentTables.set(component, table);
  }
  return table;
}

function profilePhaseIntegralAt(
  component: WaveComponent,
  profile: WaveDepthProfile,
  table: ProfileTravelTable,
  z: number,
) {
  const points = table.z;
  let baseZ: number;
  let baseIntegral: number;
  if (z <= points[0]) {
    baseZ = points[0];
    baseIntegral = table.integral[0];
  } else if (z >= points[points.length - 1]) {
    baseZ = points[points.length - 1];
    baseIntegral = table.integral[table.integral.length - 1];
  } else {
    let low = 0;
    let high = points.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (points[middle] <= z) low = middle;
      else high = middle;
    }
    baseZ = points[low];
    baseIntegral = table.integral[low];
  }
  const middle = (baseZ + z) * .5;
  const startValue = profileCrossShoreWaveNumber(
    component,
    profile,
    table.alongshoreWaveNumber,
    table.crossShoreSign,
    baseZ,
  );
  const middleValue = profileCrossShoreWaveNumber(
    component,
    profile,
    table.alongshoreWaveNumber,
    table.crossShoreSign,
    middle,
  );
  const endValue = profileCrossShoreWaveNumber(
    component,
    profile,
    table.alongshoreWaveNumber,
    table.crossShoreSign,
    z,
  );
  const localIntegral = (z - baseZ)
    * (startValue + 4 * middleValue + endValue)
    / 6;
  return baseIntegral + localIntegral - table.referenceIntegral;
}

function derivedWindPeriod(windSpeed: number, fallbackPeriod: number) {
  return clamp(
    positiveOr(windSpeed, 0) * .52,
    3.2,
    Math.min(11, Math.max(4, fallbackPeriod)),
  );
}

function allocateComponentCounts(
  partitions: readonly Omit<ResolvedPartition, "count">[],
  requestedTotal: number,
) {
  if (partitions.length === 0) return [];
  const total = Math.max(partitions.length * 2, Math.round(requestedTotal));
  const variance = partitions.reduce((sum, partition) => sum + partition.variance, 0);
  const counts = partitions.map(() => 2);
  let remaining = total - counts.reduce((sum, count) => sum + count, 0);
  const shares = partitions.map((partition, index) => ({
    index,
    exact: remaining * partition.variance / Math.max(1e-12, variance),
  }));
  for (const share of shares) {
    const whole = Math.floor(share.exact);
    counts[share.index] += whole;
    remaining -= whole;
  }
  shares
    .sort((a, b) => (b.exact % 1) - (a.exact % 1) || a.index - b.index)
    .slice(0, remaining)
    .forEach((share) => {
      counts[share.index] += 1;
    });
  return counts;
}

function resolvePartitions(input: WaveSpectrumInput) {
  const totalVariance = significantHeightToVariance(input.totalSignificantHeight);
  if (totalVariance === 0) return [] as ResolvedPartition[];
  const peakPeriod = clamp(positiveOr(input.peakPeriod, 8), 2.5, 25);
  const baseDirection = wrapDegrees(finiteOr(input.directionDegrees, 0));
  const requested: Array<Omit<ResolvedPartition, "count">> = [];
  for (const [index, source] of (input.swellPartitions ?? []).entries()) {
    const variance = significantHeightToVariance(source.significantHeight);
    if (variance <= 1e-12) continue;
    requested.push({
      kind: source.kind ?? "swell",
      label: source.label ?? `swell-${index + 1}`,
      variance,
      peakPeriod: clamp(positiveOr(source.peakPeriod, peakPeriod), 3.5, 25),
      directionDegrees: wrapDegrees(finiteOr(source.directionDegrees, baseDirection)),
      directionalSpreadDegrees: clamp(
        positiveOr(source.directionalSpreadDegrees, 8),
        .5,
        55,
      ),
      frequencySpread: clamp(
        positiveOr(source.frequencySpread, .09),
        .025,
        .5,
      ),
    });
  }
  const wind = input.windSea;
  const explicitWindVariance = significantHeightToVariance(
    positiveOr(wind?.significantHeight, 0),
  );
  if (explicitWindVariance > 1e-12) {
    requested.push({
      kind: "wind-sea",
      label: "wind-sea",
      variance: explicitWindVariance,
      peakPeriod: clamp(
        positiveOr(
          wind?.peakPeriod,
          derivedWindPeriod(positiveOr(input.windSpeed, 0), peakPeriod),
        ),
        2.5,
        14,
      ),
      directionDegrees: wrapDegrees(finiteOr(
        wind?.directionDegrees,
        finiteOr(input.windDirectionDegrees, baseDirection),
      )),
      directionalSpreadDegrees: clamp(
        positiveOr(wind?.directionalSpreadDegrees, 24),
        2,
        70,
      ),
      frequencySpread: .28,
    });
  }
  let requestedVariance = requested.reduce(
    (sum, partition) => sum + partition.variance,
    0,
  );
  if (requestedVariance > totalVariance) {
    const scale = totalVariance / requestedVariance;
    for (const partition of requested) partition.variance *= scale;
    requestedVariance = totalVariance;
  }
  const residual = Math.max(0, totalVariance - requestedVariance);
  if (residual > 1e-12) {
    const windPartition = requested.find((partition) => partition.kind === "wind-sea");
    if (windPartition) {
      windPartition.variance += residual;
    } else {
      requested.push({
        kind: "wind-sea",
        label: "wind-sea",
        variance: residual,
        peakPeriod: derivedWindPeriod(positiveOr(input.windSpeed, 0), peakPeriod),
        directionDegrees: wrapDegrees(finiteOr(
          input.windDirectionDegrees,
          baseDirection,
        )),
        directionalSpreadDegrees: 26,
        frequencySpread: .3,
      });
    }
  }
  if (requested.length === 0) {
    requested.push({
      kind: "wind-sea",
      label: "combined-sea",
      variance: totalVariance,
      peakPeriod,
      directionDegrees: baseDirection,
      directionalSpreadDegrees: 18,
      frequencySpread: .2,
    });
  }
  const counts = allocateComponentCounts(
    requested,
    clamp(Math.round(positiveOr(input.componentCount, 28)), 8, 64),
  );
  return requested.map((partition, index) => ({
    ...partition,
    count: counts[index],
  }));
}

function envelopeRawAtCarrierPhase(
  bank: Pick<WaveComponentBank, "components" | "dominantComponentId">,
  carrierPhase: number,
) {
  const dominant = bank.components[bank.dominantComponentId];
  if (!dominant) return 0;
  let real = 0;
  let imaginary = 0;
  let amplitudeSum = 0;
  for (const component of bank.components) {
    if (
      component.kind !== dominant.kind
      || component.period < dominant.period * .55
      || component.period > dominant.period * 1.65
    ) {
      continue;
    }
    const projection = (
      component.directionX * dominant.directionX
      + component.directionZ * dominant.directionZ
    );
    const carrierRatio = component.referenceWaveNumber
      * projection
      / Math.max(1e-9, dominant.referenceWaveNumber);
    const phase = component.phaseOffset
      + carrierRatio * (carrierPhase - dominant.phaseOffset);
    const relativePhase = phase - carrierPhase;
    real += component.amplitude * Math.cos(relativePhase);
    imaginary += component.amplitude * Math.sin(relativePhase);
    amplitudeSum += component.amplitude;
  }
  if (amplitudeSum <= 1e-12) return 0;
  const normalizedEnvelope = Math.hypot(real, imaginary) / amplitudeSum;
  return normalizedEnvelope * normalizedEnvelope;
}

function envelopeBounds(
  bank: Pick<WaveComponentBank, "components" | "dominantComponentId">,
) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let ordinal = 0; ordinal < 2048; ordinal += 1) {
    const energy = envelopeRawAtCarrierPhase(bank, ordinal * TAU);
    minimum = Math.min(minimum, energy);
    maximum = Math.max(maximum, energy);
  }
  return {
    minimum: Number.isFinite(minimum) ? minimum : 0,
    maximum: Number.isFinite(maximum) ? maximum : 1,
  };
}

export function buildWaveComponentBank(input: WaveSpectrumInput): WaveComponentBank {
  const seed = seedFrom(input.seed);
  const random = createRandom(seed);
  const referenceDepth = clamp(
    positiveOr(input.referenceDepth, DEFAULT_REFERENCE_DEPTH),
    5,
    2000,
  );
  const resolved = resolvePartitions(input);
  const components: WaveComponent[] = [];
  const partitions: WaveSpectrumPartition[] = [];
  for (const [partitionId, partition] of resolved.entries()) {
    partitions.push({
      id: partitionId,
      kind: partition.kind,
      label: partition.label,
      variance: partition.variance,
      significantHeight: varianceToSignificantHeight(partition.variance),
      peakPeriod: partition.peakPeriod,
      directionDegrees: partition.directionDegrees,
      directionalSpreadDegrees: partition.directionalSpreadDegrees,
      componentCount: partition.count,
    });
    const componentVariance = partition.variance / partition.count;
    const componentAmplitude = Math.sqrt(2 * componentVariance);
    const frequencyOrder = Array.from(
      { length: partition.count },
      (_, index) => index,
    );
    for (let localIndex = frequencyOrder.length - 1; localIndex > 0; localIndex -= 1) {
      const swapIndex = Math.floor(random() * (localIndex + 1));
      [frequencyOrder[localIndex], frequencyOrder[swapIndex]] = [
        frequencyOrder[swapIndex],
        frequencyOrder[localIndex],
      ];
    }
    for (let localIndex = 0; localIndex < partition.count; localIndex += 1) {
      const frequencyUnit = (
        frequencyOrder[localIndex] + .16 + random() * .68
      ) / partition.count;
      const frequencyOffset = spectralQuantile(frequencyUnit);
      const peakFrequency = 1 / partition.peakPeriod;
      const frequency = clamp(
        peakFrequency * (1 + frequencyOffset * partition.frequencySpread),
        1 / 25,
        1 / 2.5,
      );
      const period = 1 / frequency;
      const angularFrequency = TAU * frequency;
      const directionUnit = (localIndex + .12 + random() * .76) / partition.count;
      const directionOffset = spectralQuantile(directionUnit)
        * partition.directionalSpreadDegrees;
      const directionDegrees = coastalIncomingDirectionDegrees(
        partition.directionDegrees + directionOffset,
      );
      const directionRadians = directionDegrees * Math.PI / 180;
      components.push({
        id: components.length,
        partitionId,
        kind: partition.kind,
        amplitude: componentAmplitude,
        variance: componentVariance,
        period,
        angularFrequency,
        referenceWaveNumber: solveFiniteDepthWaveNumber(
          angularFrequency,
          referenceDepth,
        ),
        phaseOffset: random() * TAU,
        directionDegrees,
        directionX: Math.sin(directionRadians),
        directionZ: Math.cos(directionRadians),
      });
    }
  }
  let dominantComponentId = -1;
  if (components.length > 0) {
    const dominantPartition = partitions.reduce((best, partition) => (
      partition.variance > best.variance ? partition : best
    ), partitions[0]);
    const candidates = components.filter(
      (component) => component.partitionId === dominantPartition.id,
    );
    dominantComponentId = candidates.reduce((best, component) => (
      Math.abs(component.period - dominantPartition.peakPeriod)
        < Math.abs(best.period - dominantPartition.peakPeriod)
        ? component
        : best
    ), candidates[0]).id;
  }
  const totalVariance = components.reduce(
    (sum, component) => sum + component.variance,
    0,
  );
  const partialBank = {
    components,
    dominantComponentId,
  };
  const bounds = envelopeBounds(partialBank);
  return {
    version: 1,
    seed,
    referenceDepth,
    significantHeight: varianceToSignificantHeight(totalVariance),
    totalVariance,
    dominantComponentId,
    envelopeEnergyMin: bounds.minimum,
    envelopeEnergyMax: bounds.maximum,
    partitions,
    components,
  };
}

/**
 * Converts the app's marine values without adding swell on top of total wave
 * height. The swell is a partition and the wind sea receives only residual
 * variance.
 */
export function waveSpectrumInputFromMarine(
  conditions: MarineWaveConditionsLike,
  seed?: number | string,
): WaveSpectrumInput {
  const localDirection = (direction: number | undefined, fallback: number) =>
    coastalIncomingDirectionDegrees(
      finiteOr(direction, fallback) - conditions.coastHeading,
    );
  const swellPartitions: WavePartitionInput[] = [];
  const addSwell = (
    label: string,
    height: number | undefined,
    period: number | undefined,
    direction: number | undefined,
    spread: number,
  ) => {
    if (positiveOr(height, 0) <= 0) return;
    swellPartitions.push({
      kind: "swell",
      significantHeight: positiveOr(height, 0),
      peakPeriod: positiveOr(period, conditions.swellPeriod),
      directionDegrees: localDirection(direction, conditions.swellDirection),
      directionalSpreadDegrees: spread,
      // A realistic but not monochromatic swell: enough bandwidth for
      // naturally spaced 3–8 wave groups instead of twenty-wave walls.
      frequencySpread: label === "primary-swell" ? .16 : .19,
      label,
    });
  };
  addSwell(
    "primary-swell",
    conditions.swellHeight,
    conditions.swellPeakPeriod ?? conditions.swellPeriod,
    conditions.swellDirection,
    7,
  );
  addSwell(
    "secondary-swell",
    conditions.secondarySwellHeight,
    conditions.secondarySwellPeriod,
    conditions.secondarySwellDirection,
    10,
  );
  addSwell(
    "tertiary-swell",
    conditions.tertiarySwellHeight,
    conditions.tertiarySwellPeriod,
    conditions.tertiarySwellDirection,
    13,
  );
  const windWaveHeight = positiveOr(conditions.windWaveHeight, 0);
  return {
    totalSignificantHeight: conditions.waveHeight,
    peakPeriod: conditions.wavePeriod,
    directionDegrees: localDirection(
      conditions.waveDirection,
      conditions.coastHeading,
    ),
    swellPartitions,
    ...(windWaveHeight > 0
      ? {
          windSea: {
            significantHeight: windWaveHeight,
            peakPeriod: positiveOr(
              conditions.windWavePeakPeriod,
              positiveOr(conditions.windWavePeriod, conditions.wavePeriod),
            ),
            directionDegrees: localDirection(
              conditions.windWaveDirection,
              conditions.windDirection,
            ),
            directionalSpreadDegrees: 24,
          },
        }
      : {}),
    windSpeed: conditions.windSpeed,
    windDirectionDegrees: localDirection(
      conditions.windDirection,
      conditions.waveDirection,
    ),
    seed,
  };
}

function profileGeometryAt(
  component: WaveComponent,
  profile: WaveDepthProfile,
  x: number,
  z: number,
  elapsed: number,
) {
  const localDepth = depthAt(profile, z);
  const referenceDepth = depthAt(profile, profile.referenceZ);
  const travel = profileTravelTable(component, profile);
  const referenceWaveNumber = solveFiniteDepthWaveNumber(
    component.angularFrequency,
    referenceDepth,
  );
  const localWaveNumber = solveFiniteDepthWaveNumber(
    component.angularFrequency,
    localDepth,
  );
  const alongshoreWaveNumber = travel.alongshoreWaveNumber;
  const crossShoreWaveNumber = profileCrossShoreWaveNumber(
    component,
    profile,
    alongshoreWaveNumber,
    travel.crossShoreSign,
    z,
  );
  const integral = profilePhaseIntegralAt(component, profile, travel, z);
  const gradientMagnitude = Math.hypot(
    alongshoreWaveNumber,
    crossShoreWaveNumber,
  );
  const directionX = alongshoreWaveNumber / Math.max(1e-12, gradientMagnitude);
  const directionZ = crossShoreWaveNumber / Math.max(1e-12, gradientMagnitude);
  const celerity = phaseCelerity(
    component.angularFrequency,
    gradientMagnitude,
  );
  return {
    waveNumber: gradientMagnitude,
    referenceWaveNumber,
    crossShoreWaveNumber,
    alongshoreWaveNumber,
    directionX,
    directionZ,
    celerity,
    groupVelocity: groupVelocity(
      component.angularFrequency,
      localWaveNumber,
      localDepth,
    ),
    referenceGroupVelocity: groupVelocity(
      component.angularFrequency,
      referenceWaveNumber,
      referenceDepth,
    ),
    phase: alongshoreWaveNumber * x
      + integral
      - component.angularFrequency * elapsed
      + component.phaseOffset,
  } satisfies LocalGeometry;
}

function fieldPhaseAt(
  component: WaveComponent,
  field: WavePropagationField,
  x: number,
  z: number,
  elapsed: number,
) {
  const reference = sourceSampleAt(field, x, field.referenceZ);
  const referenceWaveNumber = solveFiniteDepthWaveNumber(
    component.angularFrequency,
    reference.depth,
  );
  const alongshoreWaveNumber = referenceWaveNumber * component.directionX;
  const crossShoreSign = component.directionZ < 0 ? -1 : 1;
  const crossShoreWaveNumberAtDepth = (depth: number) => {
    const waveNumber = solveFiniteDepthWaveNumber(
      component.angularFrequency,
      depth,
    );
    return crossShoreSign * Math.sqrt(Math.max(
      1e-12,
      waveNumber * waveNumber
        - alongshoreWaveNumber * alongshoreWaveNumber,
    ));
  };
  const distance = z - field.referenceZ;
  // Fixed Gauss-Legendre quadrature makes arbitrary 2D fields predictable:
  // cost is independent of offshore distance. Hot rendering paths should use
  // a WaveDepthProfile or a pre-sampled field adapter.
  const nodes = [
    -.9602898564975363,
    -.7966664774136267,
    -.525532409916329,
    -.1834346424956498,
    .1834346424956498,
    .525532409916329,
    .7966664774136267,
    .9602898564975363,
  ];
  const weights = [
    .1012285362903763,
    .2223810344533745,
    .3137066458778873,
    .362683783378362,
    .362683783378362,
    .3137066458778873,
    .2223810344533745,
    .1012285362903763,
  ];
  const midpoint = (field.referenceZ + z) * .5;
  const halfDistance = distance * .5;
  const derivativeRadius = Math.max(.04, Math.abs(distance) * 2e-5);
  let integral = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const sampleZ = midpoint + halfDistance * nodes[index];
    const sample = sourceSampleAt(field, x, sampleZ);
    const before = sourceSampleAt(field, x, sampleZ - derivativeRadius);
    const after = sourceSampleAt(field, x, sampleZ + derivativeRadius);
    const contourDerivative = (
      after.contourCoordinate - before.contourCoordinate
    ) / (derivativeRadius * 2);
    integral += weights[index]
      * crossShoreWaveNumberAtDepth(sample.depth)
      * contourDerivative;
  }
  integral *= halfDistance;
  return alongshoreWaveNumber * x
    + integral
    - component.angularFrequency * elapsed
    + component.phaseOffset;
}

function fieldGeometryAt(
  component: WaveComponent,
  field: WavePropagationField,
  x: number,
  z: number,
  elapsed: number,
) {
  const local = sourceSampleAt(field, x, z);
  const reference = sourceSampleAt(field, x, field.referenceZ);
  const localWaveNumber = solveFiniteDepthWaveNumber(
    component.angularFrequency,
    local.depth,
  );
  const referenceWaveNumber = solveFiniteDepthWaveNumber(
    component.angularFrequency,
    reference.depth,
  );
  const radius = .18;
  const phase = fieldPhaseAt(component, field, x, z, elapsed);
  const gradientX = (
    fieldPhaseAt(component, field, x + radius, z, elapsed)
      - fieldPhaseAt(component, field, x - radius, z, elapsed)
  ) / (radius * 2);
  const gradientZ = (
    fieldPhaseAt(component, field, x, z + radius, elapsed)
      - fieldPhaseAt(component, field, x, z - radius, elapsed)
  ) / (radius * 2);
  const gradientMagnitude = Math.max(1e-9, Math.hypot(gradientX, gradientZ));
  const celerity = phaseCelerity(
    component.angularFrequency,
    gradientMagnitude,
  );
  return {
    waveNumber: gradientMagnitude,
    referenceWaveNumber,
    crossShoreWaveNumber: gradientZ,
    alongshoreWaveNumber: gradientX,
    directionX: gradientX / gradientMagnitude,
    directionZ: gradientZ / gradientMagnitude,
    celerity,
    groupVelocity: groupVelocity(
      component.angularFrequency,
      localWaveNumber,
      local.depth,
    ),
    referenceGroupVelocity: groupVelocity(
      component.angularFrequency,
      referenceWaveNumber,
      reference.depth,
    ),
    phase,
  } satisfies LocalGeometry;
}

function localGeometryAt(
  component: WaveComponent,
  source: WaveDepthSource,
  x: number,
  z: number,
  elapsed: number,
) {
  return isDepthProfile(source)
    ? profileGeometryAt(component, source, x, z, elapsed)
    : fieldGeometryAt(component, source, x, z, elapsed);
}

function localTermsAt(
  bank: WaveComponentBank,
  source: WaveDepthSource,
  x: number,
  z: number,
  elapsed: number,
  options: WaveSamplingOptions,
) {
  const depth = sourceSampleAt(source, x, z).depth;
  const rawTerms = bank.components.map((component) => {
    const geometry = localGeometryAt(component, source, x, z, elapsed);
    const referenceNormalFlux = geometry.referenceGroupVelocity
      * Math.max(.08, Math.abs(component.directionZ));
    const localNormalFlux = geometry.groupVelocity
      * Math.max(.08, Math.abs(geometry.directionZ));
    const shoalingGain = clamp(
      Math.sqrt(
        referenceNormalFlux / Math.max(.05, localNormalFlux),
      ),
      .55,
      2.6,
    );
    return {
      component,
      geometry,
      amplitude: component.amplitude * shoalingGain,
      shoalingGain,
    };
  });
  const rawVariance = rawTerms.reduce(
    (sum, term) => sum + term.amplitude * term.amplitude * .5,
    0,
  );
  const rawSignificantHeight = varianceToSignificantHeight(rawVariance);
  const breakingIndex = clamp(
    positiveOr(options.breakingIndex, .78),
    .45,
    1.2,
  );
  const depthScale = rawSignificantHeight > 0
    ? Math.min(1, breakingIndex * depth / rawSignificantHeight)
    : 1;
  const combinedSteepness = significantSpectralSteepness(
    rawTerms.map((term) => ({
      amplitude: term.amplitude,
      waveNumber: term.geometry.waveNumber,
    })),
  );
  const steepnessScale = combinedSteepness > 0
    ? Math.min(
        1,
        clamp(
          positiveOr(options.maximumCombinedSteepness, .44),
          .12,
          .72,
        ) / combinedSteepness,
      )
    : 1;
  const scale = Math.min(depthScale, steepnessScale);
  const terms: LocalTerm[] = rawTerms.map((term) => ({
    ...term,
    amplitude: term.amplitude * scale,
  }));
  return {
    terms,
    depth,
    rawSignificantHeight,
    localSignificantHeight: rawSignificantHeight * scale,
    breakingRatio: rawSignificantHeight / Math.max(.05, breakingIndex * depth),
  };
}

function heightFromTerms(terms: readonly LocalTerm[]) {
  return terms.reduce(
    (height, term) => height + term.amplitude * Math.cos(term.geometry.phase),
    0,
  );
}

function smoothUnit(edge0: number, edge1: number, value: number) {
  const unit = clamp((value - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return unit * unit * (3 - 2 * unit);
}

export type WaveBreakerResponse = {
  breakingProgress: number;
  brokenProgress: number;
  shapeActivation: number;
  faceActivation: number;
  heightOffset: number;
  phaseDerivative: number;
  whitewater: number;
};

/**
 * A bounded Stokes-like breaker correction shared by surface sampling and the
 * GPU shader. The second and third bound harmonics sharpen the crest while the
 * quadrature term makes the shoreward face steeper than the back. Unlike the
 * old depth-only attenuation, this creates a pitched face before dissipation
 * turns it into a bore.
 */
export function waveBreakerResponseAt(
  breakingRatio: number,
  localSignificantHeight: number,
  dominantPhase: number,
  crestEnergy: number,
  dominantEnvelopeAmplitude: number,
  options: Pick<
    WaveSamplingOptions,
    | "breakerPower"
    | "breakerSteepness"
    | "breakerHollow"
    | "targetFaceHeight"
  > = {},
): WaveBreakerResponse {
  const power = clamp(positiveOr(options.breakerPower, 1), .62, 1.55);
  const steepness = clamp(positiveOr(options.breakerSteepness, .78), .38, 1.3);
  const hollow = clamp(positiveOr(options.breakerHollow, .45), .08, 1.1);
  const breakingProgress = smoothUnit(.68, 1.06, breakingRatio);
  const brokenProgress = smoothUnit(1.02, 1.82, breakingRatio);
  const shoreFade = 1 - smoothUnit(4.8, 9.5, breakingRatio);
  const shapeActivation = breakingProgress * shoreFade;
  const faceActivation = smoothUnit(.55, .82, breakingRatio)
    * (1 - smoothUnit(2.4, 5.2, breakingRatio));
  const realizedCrestEnergy = clamp(crestEnergy, 0, 1);
  // The coherent spectrum supplies natural sets, spacing, and along-crest
  // variation. At the actual break, however, even a locally cancelled part of
  // an energetic line must retain enough wall to peel rather than collapsing
  // into flat water beneath the surfer.
  const readableCrestEnergy = .24 + realizedCrestEnergy * .76;
  // A large forecast must produce a wall that reads against a 1.72 m surfer
  // within takeoff distance, not only a broad height change over a wavelength.
  const humanScaleFaceBoost = 1 + smoothUnit(
    1.9,
    2.5,
    options.targetFaceHeight ?? 0,
  ) * .32;
  const shapeAmplitude = Math.max(0, localSignificantHeight)
    // Preserve the readable height and drive of the earlier mesh while the
    // underlying spectrum supplies spacing and travel. This remains a broad,
    // bounded Stokes correction—not the old fifth-power needle—and is applied
    // to the same surface sampled by rendering and gameplay.
    * .5
    * power
    * shapeActivation
    * (.42 + readableCrestEnergy * .7)
    * humanScaleFaceBoost;
  const second = .28 + steepness * .17 + hollow * .1;
  const asymmetry = .08 + hollow * .2 + steepness * .045;
  const third = .045 + hollow * .07 + steepness * .035;
  const fourth = .035 + hollow * .05;
  const fifth = .018 + hollow * .03;
  const twice = dominantPhase * 2;
  const thrice = dominantPhase * 3;
  const fourthPhase = dominantPhase * 4;
  const fifthPhase = dominantPhase * 5;
  const shape = second * Math.cos(twice)
    + asymmetry * Math.sin(twice)
    + third * Math.cos(thrice)
    + fourth * Math.cos(fourthPhase)
    + fifth * Math.cos(fifthPhase);
  const shapeDerivative = -2 * second * Math.sin(twice)
    + 2 * asymmetry * Math.cos(twice)
    - 3 * third * Math.sin(thrice)
    - 4 * fourth * Math.sin(fourthPhase)
    - 5 * fifth * Math.sin(fifthPhase);
  // A grouped sea can have the right statistical Hs yet cancel its dominant
  // carrier exactly where the bathymetry says it should become surfable. Main
  // avoided that with one oversized synthetic wave. Preserve the spectrum and
  // its spacing, but restore only the missing first-harmonic face as the set
  // shoals. Weak group crests stay smaller; strong set waves approach the face
  // height shown in the forecast.
  const targetCarrierAmplitude = Math.max(
    0,
    options.targetFaceHeight ?? 0,
  ) * (.35 + readableCrestEnergy * .26);
  const carrierCorrection = Math.max(
    0,
    targetCarrierAmplitude - Math.max(0, dominantEnvelopeAmplitude),
  ) * faceActivation;
  const carrierShape = Math.cos(dominantPhase);
  const carrierDerivative = -Math.sin(dominantPhase);
  const crestSignal = .5 + .5 * Math.cos(dominantPhase);
  const whitewater = shapeActivation
    * smoothUnit(.3, .76, crestSignal)
    * (.52 + brokenProgress * .48)
    * (.46 + realizedCrestEnergy * .54);
  return {
    breakingProgress,
    brokenProgress,
    shapeActivation,
    faceActivation,
    heightOffset:
      shapeAmplitude * shape
      + carrierCorrection * carrierShape,
    phaseDerivative:
      shapeAmplitude * shapeDerivative
      + carrierCorrection * carrierDerivative,
    whitewater,
  };
}

function heightFromLocal(
  bank: WaveComponentBank,
  local: ReturnType<typeof localTermsAt>,
  options: WaveSamplingOptions,
) {
  const dominant = dominantStateAt(bank, local.terms);
  const response = waveBreakerResponseAt(
    local.breakingRatio,
    local.localSignificantHeight,
    dominant?.phase ?? 0,
    dominant?.crestEnergy ?? 0,
    dominant?.amplitude ?? 0,
    options,
  );
  return heightFromTerms(local.terms) + response.heightOffset;
}

export function normalizedSpectralEnvelopeAtPhase(
  bank: WaveComponentBank,
  carrierPhase: number,
) {
  const rawEnergy = envelopeRawAtCarrierPhase(bank, carrierPhase);
  const dominant = bank.components[bank.dominantComponentId];
  const groupComponents = dominant
    ? bank.components
        .filter(
          (component) => component.partitionId === dominant.partitionId
            && component.id !== dominant.id,
        )
        .map((component) => {
          const projection = component.directionX * dominant.directionX
            + component.directionZ * dominant.directionZ;
          const carrierRatio = component.referenceWaveNumber
            * projection
            / Math.max(1e-9, dominant.referenceWaveNumber);
          return {
            component,
            carrierRatio,
            beatPeriod: 1 / Math.max(1e-6, Math.abs(carrierRatio - 1)),
          };
        })
    : [];
  // Pick a real neighboring spectral line whose interference produces a
  // roughly 10–12-wave group. This keeps sets broad enough to read and surf,
  // while their phase remains seeded by the actual realized spectrum.
  const groupComponent = groupComponents.reduce<
    (typeof groupComponents)[number] | null
  >((best, candidate) => (
    !best
      || Math.abs(candidate.beatPeriod - 11)
        < Math.abs(best.beatPeriod - 11)
      ? candidate
      : best
  ), null);
  const groupRelativePhase = dominant && groupComponent
    ? groupComponent.component.phaseOffset
      + groupComponent.carrierRatio
        * (carrierPhase - dominant.phaseOffset)
      - carrierPhase
    : 0;
  const energy = groupComponent
    ? .5 + .5 * Math.cos(groupRelativePhase)
    : .5;
  return {
    envelope: Math.sqrt(Math.max(0, rawEnergy)),
    rawEnergy,
    energy,
  };
}

export function spectralCrestAtOrdinal(
  bank: WaveComponentBank,
  crestOrdinal: number,
) {
  const ordinal = Math.trunc(crestOrdinal);
  const carrierPhase = ordinal * TAU;
  const envelope = normalizedSpectralEnvelopeAtPhase(bank, carrierPhase);
  return {
    crestOrdinal: ordinal,
    crestId: `spectral:${bank.seed}:${bank.dominantComponentId}:${ordinal}`,
    crestEnergy: envelope.energy,
    envelope: envelope.envelope,
  };
}

export function dominantCrestPropertiesAtPhase(
  bank: WaveComponentBank,
  carrierPhase: number,
) {
  const crestOrdinal = Math.round(carrierPhase / TAU);
  return spectralCrestAtOrdinal(bank, crestOrdinal);
}

function dominantStateFromGeometry(
  bank: WaveComponentBank,
  component: WaveComponent,
  geometry: LocalGeometry,
  amplitude = component.amplitude,
) {
  const phase = geometry.phase;
  const crest = dominantCrestPropertiesAtPhase(bank, phase);
  return {
    componentId: component.id,
    phase,
    amplitude: Math.max(0, amplitude),
    normalizedPhase: wrapRadians(phase),
    crestOrdinal: crest.crestOrdinal,
    crestId: crest.crestId,
    crestEnergy: crest.crestEnergy,
    envelope: crest.envelope,
    angularFrequency: component.angularFrequency,
    propagationAngularFrequency: component.angularFrequency,
    gradientX: geometry.alongshoreWaveNumber,
    gradientZ: geometry.crossShoreWaveNumber,
    propagationGradientX: geometry.alongshoreWaveNumber,
    propagationGradientZ: geometry.crossShoreWaveNumber,
    directionX: geometry.directionX,
    directionZ: geometry.directionZ,
    celerityX: geometry.directionX * geometry.celerity,
    celerityZ: geometry.directionZ * geometry.celerity,
    celerity: geometry.celerity,
    wavelength: TAU / Math.max(1e-12, geometry.waveNumber),
  } satisfies DominantWaveState;
}

/**
 * Resolves the carrier phase from the complete dominant spectral partition.
 *
 * A single component can be at its mathematical crest while the rest of its
 * partition cancels it, which previously let gameplay label a trough as a
 * surfable set wave. The analytic partition signal keeps crest identity,
 * envelope energy, direction, and celerity attached to the combined wave that
 * is actually visible.
 */
function dominantStateAt(
  bank: WaveComponentBank,
  terms: readonly LocalTerm[],
) {
  const dominantTerm = terms.find(
    (candidate) => candidate.component.id === bank.dominantComponentId,
  );
  if (!dominantTerm) return null;
  const partitionTerms = terms.filter(
    (term) =>
      term.component.partitionId === dominantTerm.component.partitionId,
  );
  if (partitionTerms.length < 2) {
    return dominantStateFromGeometry(
      bank,
      dominantTerm.component,
      dominantTerm.geometry,
      dominantTerm.amplitude,
    );
  }

  let real = 0;
  let imaginary = 0;
  let derivativeRealX = 0;
  let derivativeImaginaryX = 0;
  let derivativeRealZ = 0;
  let derivativeImaginaryZ = 0;
  let derivativeRealTime = 0;
  let derivativeImaginaryTime = 0;
  let partitionVariance = 0;
  let carrierGradientX = 0;
  let carrierGradientZ = 0;
  let carrierAngularFrequency = 0;
  for (const term of partitionTerms) {
    const cosine = Math.cos(term.geometry.phase);
    const sine = Math.sin(term.geometry.phase);
    const amplitude = term.amplitude;
    real += amplitude * cosine;
    imaginary += amplitude * sine;
    derivativeRealX -= amplitude
      * sine
      * term.geometry.alongshoreWaveNumber;
    derivativeImaginaryX += amplitude
      * cosine
      * term.geometry.alongshoreWaveNumber;
    derivativeRealZ -= amplitude
      * sine
      * term.geometry.crossShoreWaveNumber;
    derivativeImaginaryZ += amplitude
      * cosine
      * term.geometry.crossShoreWaveNumber;
    derivativeRealTime += amplitude
      * term.component.angularFrequency
      * sine;
    derivativeImaginaryTime -= amplitude
      * term.component.angularFrequency
      * cosine;
    const varianceWeight = amplitude * amplitude * .5;
    partitionVariance += varianceWeight;
    carrierGradientX += varianceWeight
      * term.geometry.alongshoreWaveNumber;
    carrierGradientZ += varianceWeight
      * term.geometry.crossShoreWaveNumber;
    carrierAngularFrequency += varianceWeight
      * term.component.angularFrequency;
  }
  const envelopeSquared = real * real + imaginary * imaginary;
  if (envelopeSquared < 1e-8) {
    return dominantStateFromGeometry(
      bank,
      dominantTerm.component,
      dominantTerm.geometry,
      dominantTerm.amplitude,
    );
  }

  const wrappedPhase = Math.atan2(imaginary, real);
  const phase = wrappedPhase + Math.round(
    (dominantTerm.geometry.phase - wrappedPhase) / TAU,
  ) * TAU;
  const gradientX = (
    real * derivativeImaginaryX
      - imaginary * derivativeRealX
  ) / envelopeSquared;
  const gradientZ = (
    real * derivativeImaginaryZ
      - imaginary * derivativeRealZ
  ) / envelopeSquared;
  const timeDerivative = (
    real * derivativeImaginaryTime
      - imaginary * derivativeRealTime
  ) / envelopeSquared;
  const analyticAngularFrequency = clamp(
    -timeDerivative,
    dominantTerm.component.angularFrequency * .55,
    dominantTerm.component.angularFrequency * 1.65,
  );
  const carrierWeight = Math.max(1e-9, partitionVariance);
  carrierGradientX /= carrierWeight;
  carrierGradientZ /= carrierWeight;
  carrierAngularFrequency /= carrierWeight;
  const propagationMagnitude = Math.max(
    1e-6,
    Math.hypot(carrierGradientX, carrierGradientZ),
  );
  const celerity = carrierAngularFrequency
    / propagationMagnitude;
  const envelopeAmplitude = Math.sqrt(envelopeSquared);
  const localPartitionHeight = varianceToSignificantHeight(
    partitionVariance,
  );
  const normalizedEnvelope = envelopeAmplitude
    / Math.max(.05, localPartitionHeight * .5);
  const crestEnergy = smoothUnit(.28, 1.05, normalizedEnvelope);
  const crestOrdinal = Math.round(phase / TAU);

  return {
    componentId: dominantTerm.component.id,
    phase,
    amplitude: envelopeAmplitude,
    normalizedPhase: wrapRadians(phase),
    crestOrdinal,
    crestId:
      `spectral:${bank.seed}:${bank.dominantComponentId}:${crestOrdinal}`,
    crestEnergy,
    envelope: normalizedEnvelope,
    angularFrequency: analyticAngularFrequency,
    propagationAngularFrequency: carrierAngularFrequency,
    gradientX,
    gradientZ,
    propagationGradientX: carrierGradientX,
    propagationGradientZ: carrierGradientZ,
    directionX: carrierGradientX / propagationMagnitude,
    directionZ: carrierGradientZ / propagationMagnitude,
    celerityX: celerity * carrierGradientX / propagationMagnitude,
    celerityZ: celerity * carrierGradientZ / propagationMagnitude,
    celerity,
    wavelength: TAU / propagationMagnitude,
  } satisfies DominantWaveState;
}

export function sampleDominantWave(
  bank: WaveComponentBank,
  source: WaveDepthSource,
  x: number,
  z: number,
  elapsed: number,
) {
  const local = localTermsAt(bank, source, x, z, elapsed, {});
  return dominantStateAt(
    bank,
    local.terms,
  );
}

export function sampleWaveSurface(
  bank: WaveComponentBank,
  source: WaveDepthSource,
  x: number,
  z: number,
  elapsed: number,
  options: WaveSamplingOptions = {},
): WaveSurfaceSample {
  const local = localTermsAt(bank, source, x, z, elapsed, options);
  const dominant = dominantStateAt(bank, local.terms);
  const breaker = waveBreakerResponseAt(
    local.breakingRatio,
    local.localSignificantHeight,
    dominant?.phase ?? 0,
    dominant?.crestEnergy ?? 0,
    dominant?.amplitude ?? 0,
    options,
  );
  const height = heightFromTerms(local.terms) + breaker.heightOffset;
  let timeDerivative = 0;
  let gradientX = 0;
  let horizontalVelocityX = 0;
  let horizontalVelocityZ = 0;
  let displacementX = 0;
  let displacementZ = 0;
  let horizontalSlopeBudget = 0;
  const componentStates: WaveComponentState[] = [];
  const maximumHorizontalSlope = clamp(
    positiveOr(options.maximumHorizontalSlope, .68),
    .1,
    .85,
  );
  const rawHorizontalSlope = local.terms.reduce((sum, term) => {
    const kh = term.geometry.waveNumber * local.depth;
    const coth = 1 / Math.max(.08, Math.tanh(kh));
    const rawAmplitude = term.amplitude * Math.min(2.5, coth);
    return sum + rawAmplitude * term.geometry.waveNumber;
  }, 0);
  const horizontalScale = rawHorizontalSlope > 0
    ? Math.min(1, maximumHorizontalSlope / rawHorizontalSlope)
    : 1;
  for (const term of local.terms) {
    const phase = term.geometry.phase;
    const sine = Math.sin(phase);
    const cosine = Math.cos(phase);
    const componentTimeDerivative = term.amplitude
      * term.component.angularFrequency
      * sine;
    timeDerivative += componentTimeDerivative;
    gradientX -= term.amplitude
      * sine
      * term.geometry.alongshoreWaveNumber;
    const kh = term.geometry.waveNumber * local.depth;
    const coth = 1 / Math.max(.08, Math.tanh(kh));
    const orbitalSpeed = term.amplitude
      * term.component.angularFrequency
      * coth
      * cosine;
    const componentHorizontalVelocityX = orbitalSpeed * term.geometry.directionX;
    const componentHorizontalVelocityZ = orbitalSpeed * term.geometry.directionZ;
    horizontalVelocityX += componentHorizontalVelocityX;
    horizontalVelocityZ += componentHorizontalVelocityZ;
    const horizontalAmplitude = term.amplitude
      * Math.min(2.5, coth)
      * horizontalScale;
    displacementX -= horizontalAmplitude * sine * term.geometry.directionX;
    displacementZ -= horizontalAmplitude * sine * term.geometry.directionZ;
    horizontalSlopeBudget += horizontalAmplitude * term.geometry.waveNumber;
    if (options.includeComponents) {
      componentStates.push({
        id: term.component.id,
        kind: term.component.kind,
        phase,
        amplitude: term.amplitude,
        elevation: term.amplitude * cosine,
        timeDerivative: componentTimeDerivative,
        waveNumber: term.geometry.waveNumber,
        wavelength: TAU / Math.max(1e-12, term.geometry.waveNumber),
        celerity: term.geometry.celerity,
        groupVelocity: term.geometry.groupVelocity,
        directionX: term.geometry.directionX,
        directionZ: term.geometry.directionZ,
        horizontalVelocityX: componentHorizontalVelocityX,
        horizontalVelocityZ: componentHorizontalVelocityZ,
        verticalVelocity: componentTimeDerivative,
        steepness: term.amplitude * term.geometry.waveNumber,
        shoalingGain: term.shoalingGain,
      });
    }
  }
  if (dominant) {
    timeDerivative -= breaker.phaseDerivative
      * dominant.angularFrequency;
    gradientX += breaker.phaseDerivative
      * dominant.gradientX;
  }
  const gradientStep = clamp(
    positiveOr(options.gradientStep, .18),
    .025,
    1,
  );
  const before = localTermsAt(
    bank,
    source,
    x,
    z - gradientStep,
    elapsed,
    options,
  );
  const after = localTermsAt(
    bank,
    source,
    x,
    z + gradientStep,
    elapsed,
    options,
  );
  const gradientZ = (
    heightFromLocal(bank, after, options) - heightFromLocal(bank, before, options)
  ) / (2 * gradientStep);
  if (!isDepthProfile(source)) {
    const left = localTermsAt(
      bank,
      source,
      x - gradientStep,
      z,
      elapsed,
      options,
    );
    const right = localTermsAt(
      bank,
      source,
      x + gradientStep,
      z,
      elapsed,
      options,
    );
    gradientX = (
      heightFromLocal(bank, right, options) - heightFromLocal(bank, left, options)
    ) / (2 * gradientStep);
  }
  const normalLength = Math.hypot(gradientX, 1, gradientZ);
  const dominantDepthRatio = dominant
    ? local.depth / Math.max(1e-9, dominant.wavelength)
    : 1;
  const regime: WaveRegime = local.breakingRatio >= 1.05
    ? "broken"
    : local.breakingRatio >= .78
      ? "breaking"
      : dominantDepthRatio < .5
        ? "shoaling"
        : "deep";
  const dominantCelerity = dominant?.celerity ?? Infinity;
  const horizontalSpeed = Math.hypot(
    horizontalVelocityX,
    horizontalVelocityZ,
  );
  const orbitalLimit = Math.min(18, dominantCelerity * .92);
  if (horizontalSpeed > orbitalLimit) {
    const velocityScale = orbitalLimit / horizontalSpeed;
    horizontalVelocityX *= velocityScale;
    horizontalVelocityZ *= velocityScale;
  }
  const breakerVelocityScale = breaker.whitewater
    * (.48 + breaker.brokenProgress * .28);
  const breakerVelocityX = (dominant?.celerityX ?? 0)
    * breakerVelocityScale;
  const breakerVelocityZ = (dominant?.celerityZ ?? 0)
    * breakerVelocityScale;
  return {
    height,
    displacementX,
    displacementY: height,
    displacementZ,
    timeDerivative,
    gradientX,
    gradientZ,
    normalX: -gradientX / normalLength,
    normalY: 1 / normalLength,
    normalZ: -gradientZ / normalLength,
    horizontalVelocityX,
    horizontalVelocityZ,
    verticalVelocity: timeDerivative,
    depth: local.depth,
    localSignificantHeight: local.localSignificantHeight,
    breakingRatio: local.breakingRatio,
    breakingProgress: breaker.breakingProgress,
    brokenProgress: breaker.brokenProgress,
    whitewater: breaker.whitewater,
    breakerVelocityX,
    breakerVelocityZ,
    regime,
    horizontalJacobianMargin: 1 - horizontalSlopeBudget,
    dominant,
    ...(options.includeComponents ? { components: componentStates } : {}),
  };
}

export function serializeWaveComponentBank(bank: WaveComponentBank) {
  return JSON.stringify(bank);
}

export function deserializeWaveComponentBank(serialized: string) {
  const parsed = JSON.parse(serialized) as WaveComponentBank;
  if (
    parsed.version !== 1
    || !Array.isArray(parsed.components)
    || !Array.isArray(parsed.partitions)
  ) {
    throw new Error("Unsupported wave component bank.");
  }
  return parsed;
}

export function packWaveComponentsForGpu(bank: WaveComponentBank) {
  const count = bank.components.length;
  const amplitudes = new Float32Array(count);
  const angularFrequencies = new Float32Array(count);
  const referenceWaveNumbers = new Float32Array(count);
  const phaseOffsets = new Float32Array(count);
  const directions = new Float32Array(count * 2);
  const kinds = new Int32Array(count);
  const partitionIds = new Int32Array(count);
  for (const component of bank.components) {
    const index = component.id;
    amplitudes[index] = component.amplitude;
    angularFrequencies[index] = component.angularFrequency;
    referenceWaveNumbers[index] = component.referenceWaveNumber;
    phaseOffsets[index] = component.phaseOffset;
    directions[index * 2] = component.directionX;
    directions[index * 2 + 1] = component.directionZ;
    kinds[index] = component.kind === "swell" ? 0 : 1;
    partitionIds[index] = component.partitionId;
  }
  return {
    count,
    amplitudes,
    angularFrequencies,
    referenceWaveNumbers,
    phaseOffsets,
    directions,
    kinds,
    partitionIds,
  };
}
