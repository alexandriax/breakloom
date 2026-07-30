import type { BreakCharacter } from "./beaches";
import {
  bathymetryContourCoordinateAt,
  bathymetryContourGradientAt,
  bathymetryDepthAt,
  bathymetryGradientAt,
  shorelineReferenceAt,
} from "./bathymetry.ts";
import {
  applyOceanShoreTransition,
  coastWaveModelAt,
  maximumVisibleHorizontalDisplacement,
  oceanLocationFor,
  worldToBathymetryZ,
  type OceanSessionLike,
} from "./ocean.ts";
import { forecastFaceHeightForBreak } from "./tide.ts";
import {
  depthAt,
  groupVelocity,
  significantSpectralSteepness,
  solveFiniteDepthWaveNumber,
  varianceToSignificantHeight,
  waveBreakerResponseAt,
  type WaveComponent,
  type WaveComponentBank,
  type WaveComponentKind,
  type WaveDepthProfile,
  type WaveSpectrumPartition,
} from "./waves.ts";

export const MAX_RENDER_WAVE_COMPONENTS = 28;
export const OCEAN_TRAVEL_CHANNELS = 4;
export const OCEAN_COMPONENT_PARAMETER_ROWS = 2;
export const OCEAN_BATHYMETRY_ROWS = 2;
/** Full ocean mesh width resolved by the render bathymetry window. */
export const OCEAN_BATHYMETRY_RENDER_WIDTH = 620;
/**
 * A globally anchored 4 m grid is fine enough to preserve reef/channel
 * signatures while making every overlapping recenter window byte-identical.
 */
export const OCEAN_BATHYMETRY_X_STEP = 4;
export const OCEAN_BATHYMETRY_X_HALF_SPAN = 360;
export const OCEAN_BATHYMETRY_X_COUNT =
  OCEAN_BATHYMETRY_X_HALF_SPAN * 2 / OCEAN_BATHYMETRY_X_STEP + 1;

const BREAKING_INDEX = .78;
const MAXIMUM_COMBINED_STEEPNESS = .44;
const MAX_BATHYMETRY_ROW_CACHE_ENTRIES = 4096;
const bathymetryRowCache = new Map<string, Float32Array>();

/**
 * Monotonic scene cross-shore samples. The offshore field stays sparse, while
 * reef/ledge depths use four-metre spacing, the surf zone uses two metres,
 * and the final shore approach uses one metre. The matching shader index is
 * piecewise analytic, so this added physical resolution does not add a long
 * per-vertex knot search.
 */
export const OCEAN_BATHYMETRY_COASTAL_Z = new Float32Array([
  -1260, -1050, -860, -700, -565, -450, -355, -310,
  -278, -244, -216, -190, -166, -145, -126,
  -120, -116, -112, -108, -104, -100, -96, -92,
  -88, -84, -80, -76, -72, -68, -64, -60,
  -58, -56, -54, -52, -50, -48, -46, -44,
  -42, -40, -38, -36, -34, -32, -30, -28,
  -26, -24, -22, -20, -18, -16, -14, -12,
  -11, -10, -9, -8, -7, -6, -5, -4,
  -3, -2, -1, 0, 1, 2, 3, 4,
  5, 6, 8, 10, 12,
]);

export type RenderWaveComponent = {
  id: number;
  sourceId: number;
  partitionId: number;
  kind: WaveComponentKind;
  amplitude: number;
  variance: number;
  period: number;
  angularFrequency: number;
  referenceWaveNumber: number;
  phaseOffset: number;
  directionX: number;
  directionZ: number;
  alongshoreWaveNumber: number;
  crossShoreSign: number;
};

export type FloatTextureTable = {
  width: number;
  height: number;
  channels: 4;
  /** Row-major RGBA32F data, ready for THREE.DataTexture. */
  data: Float32Array;
};

export type RenderComponentBank = {
  count: number;
  capacity: number;
  dominantIndex: number;
  dominantPartitionTag: number;
  significantHeight: number;
  totalVariance: number;
  components: RenderWaveComponent[];
  /**
   * Two RGBA rows:
   * 0 = amplitude, angular frequency, phase offset, alongshore k
   * 1 = direction x, direction z, reference k,
   *     signed partition tag (+swell / -wind sea)
   */
  parameters: FloatTextureTable;
};

export type RenderTravelTable = FloatTextureTable & {
  /** Strictly increasing bathymetric contour coordinates. */
  contourKnots: Float32Array;
  referenceContour: number;
  /**
   * Each component row stores:
   * R integrated cross-shore phase from reference
   * G local signed cross-shore wave number
   * B shoaling gain before breaking/steepness limits
   * A local amplitude before those aggregate limits
   */
  data: Float32Array;
};

export type RenderAggregateTable = FloatTextureTable & {
  /**
   * One RGBA row:
   * R raw local Hs, G combined-steepness scale,
   * B depth, A depth-limited breaking scale.
   */
  data: Float32Array;
};

export type RenderBathymetryTable = FloatTextureTable & {
  coastalZKnots: Float32Array;
  /** Globally anchored world-x coordinate represented by the first row pair. */
  xMin: number;
  xStep: number;
  xCount: number;
  /**
   * For each x sample i:
   * row 2i = contour q, depth, shoreline z, ∂shoreline/∂x
   * row 2i+1 = ∂q/∂x, ∂q/∂z, ∂depth/∂x, ∂depth/∂z
   *
   * Hardware interpolation across coastal z and a manual mix between adjacent
   * x row pairs reconstruct the same continuous field without coast-specific
   * shader branches or a profile-centered Taylor approximation.
   */
  data: Float32Array;
};

export type OceanRenderState = {
  coastId: string;
  zoneName: string;
  profileX: number;
  tide: number;
  targetFaceHeight: number;
  maximumHorizontalDisplacement: number;
  componentBank: RenderComponentBank;
  travel: RenderTravelTable;
  aggregate: RenderAggregateTable;
  bathymetry: RenderBathymetryTable;
};

export type PackedTravelSample = {
  phaseIntegral: number;
  crossShoreWaveNumber: number;
  shoalingGain: number;
  amplitude: number;
};

export type PackedAggregateSample = {
  rawSignificantHeight: number;
  steepnessScale: number;
  depth: number;
  depthScale: number;
};

export type PackedBathymetrySample = {
  contourCoordinate: number;
  depth: number;
  shorelineZ: number;
  /** Positive on land and negative offshore: coastalZ - shorelineZ. */
  shoreDistance: number;
  offshore: number;
  shorelineGradientX: number;
  contourGradientX: number;
  contourGradientZ: number;
  depthGradientX: number;
  depthGradientZ: number;
};

export type PackedBathymetryInterpolation = {
  low: number;
  high: number;
  blend: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function partitionQuotas(
  partitions: readonly WaveSpectrumPartition[],
  capacity: number,
) {
  if (partitions.length === 0) return new Map<number, number>();
  const positive = partitions.filter((partition) => partition.variance > 1e-12);
  const available = Math.max(positive.length, capacity);
  const quotas = new Map<number, number>(
    positive.map((partition) => [partition.id, 1]),
  );
  let remaining = available - positive.length;
  const totalVariance = positive.reduce(
    (sum, partition) => sum + partition.variance,
    0,
  );
  const shares = positive.map((partition) => {
    const exact = remaining * partition.variance / Math.max(1e-12, totalVariance);
    const whole = Math.floor(exact);
    quotas.set(partition.id, (quotas.get(partition.id) ?? 0) + whole);
    return { id: partition.id, remainder: exact - whole };
  });
  remaining = capacity - [...quotas.values()].reduce((sum, count) => sum + count, 0);
  shares
    .sort((a, b) => b.remainder - a.remainder || a.id - b.id)
    .slice(0, Math.max(0, remaining))
    .forEach(({ id }) => quotas.set(id, (quotas.get(id) ?? 0) + 1));
  return quotas;
}

function evenlySpacedComponents(
  components: readonly WaveComponent[],
  count: number,
  requiredId: number,
) {
  if (count >= components.length) return [...components];
  const sorted = [...components].sort(
    (a, b) => a.period - b.period || a.directionDegrees - b.directionDegrees || a.id - b.id,
  );
  const selected = Array.from({ length: count }, (_, index) => (
    sorted[Math.min(
      sorted.length - 1,
      Math.floor((index + .5) * sorted.length / count),
    )]
  ));
  const required = components.find((component) => component.id === requiredId);
  if (required && !selected.some((component) => component.id === required.id)) {
    const replaceIndex = selected.reduce((best, component, index) => (
      Math.abs(component.period - required.period)
        < Math.abs(selected[best].period - required.period)
        ? index
        : best
    ), 0);
    selected[replaceIndex] = required;
  }
  return selected.sort((a, b) => a.id - b.id);
}

function buildRenderComponentBank(
  bank: WaveComponentBank,
  referenceDepth: number,
): RenderComponentBank {
  const capacity = Math.min(MAX_RENDER_WAVE_COMPONENTS, bank.components.length);
  const selected: WaveComponent[] = bank.components.length <= capacity
    ? [...bank.components]
    : [];
  if (selected.length === 0) {
    const quotas = partitionQuotas(bank.partitions, capacity);
    for (const partition of bank.partitions) {
      const candidates = bank.components.filter(
        (component) => component.partitionId === partition.id,
      );
      const quota = Math.min(candidates.length, quotas.get(partition.id) ?? 0);
      selected.push(...evenlySpacedComponents(
        candidates,
        quota,
        bank.dominantComponentId,
      ));
    }
  }
  // Defensive cap for malformed imported banks.
  selected.splice(capacity);

  const components: RenderWaveComponent[] = selected.map((component, id) => {
    const downsampled = bank.components.length > capacity;
    const partition = bank.partitions.find(
      (candidate) => candidate.id === component.partitionId,
    );
    const selectedPartitionCount = selected.filter(
      (candidate) => candidate.partitionId === component.partitionId,
    ).length;
    const variance = downsampled
      ? (partition?.variance ?? component.variance)
        / Math.max(1, selectedPartitionCount)
      : component.variance;
    const amplitude = downsampled
      ? Math.sqrt(2 * variance)
      : component.amplitude;
    const referenceWaveNumber = solveFiniteDepthWaveNumber(
      component.angularFrequency,
      referenceDepth,
    );
    return {
      id,
      sourceId: component.id,
      partitionId: component.partitionId,
      kind: component.kind,
      amplitude,
      variance,
      period: component.period,
      angularFrequency: component.angularFrequency,
      referenceWaveNumber,
      phaseOffset: component.phaseOffset,
      directionX: component.directionX,
      directionZ: component.directionZ,
      alongshoreWaveNumber: referenceWaveNumber * component.directionX,
      crossShoreSign: component.directionZ < 0 ? -1 : 1,
    };
  });
  const totalVariance = components.reduce(
    (sum, component) => sum + component.variance,
    0,
  );
  const parameters = new Float32Array(MAX_RENDER_WAVE_COMPONENTS * 2 * 4);
  for (const component of components) {
    const first = component.id * 4;
    parameters[first] = component.amplitude;
    parameters[first + 1] = component.angularFrequency;
    parameters[first + 2] = component.phaseOffset;
    parameters[first + 3] = component.alongshoreWaveNumber;
    const second = (MAX_RENDER_WAVE_COMPONENTS + component.id) * 4;
    parameters[second] = component.directionX;
    parameters[second + 1] = component.directionZ;
    parameters[second + 2] = component.referenceWaveNumber;
    parameters[second + 3] = (
      component.kind === "swell" ? 1 : -1
    ) * (component.partitionId + 1);
  }
  const dominantComponent = components.find(
    (component) => component.sourceId === bank.dominantComponentId,
  );
  const dominantPartitionTag = dominantComponent
    ? (dominantComponent.kind === "swell" ? 1 : -1)
      * (dominantComponent.partitionId + 1)
    : 0;
  return {
    count: components.length,
    capacity: MAX_RENDER_WAVE_COMPONENTS,
    dominantIndex: dominantComponent?.id ?? -1,
    dominantPartitionTag,
    significantHeight: varianceToSignificantHeight(totalVariance),
    totalVariance,
    components,
    parameters: {
      width: MAX_RENDER_WAVE_COMPONENTS,
      height: OCEAN_COMPONENT_PARAMETER_ROWS,
      channels: 4,
      data: parameters,
    },
  };
}

function crossShoreWaveNumber(
  component: RenderWaveComponent,
  depth: number,
) {
  const waveNumber = solveFiniteDepthWaveNumber(
    component.angularFrequency,
    depth,
  );
  return component.crossShoreSign * Math.sqrt(Math.max(
    1e-12,
    waveNumber * waveNumber
      - component.alongshoreWaveNumber * component.alongshoreWaveNumber,
  ));
}

function shoalingGain(
  component: RenderWaveComponent,
  localDepth: number,
  referenceDepth: number,
) {
  const referenceK = solveFiniteDepthWaveNumber(
    component.angularFrequency,
    referenceDepth,
  );
  const localK = solveFiniteDepthWaveNumber(
    component.angularFrequency,
    localDepth,
  );
  const localCrossK = crossShoreWaveNumber(component, localDepth);
  const localDirectionZ = localCrossK / Math.max(1e-12, localK);
  const referenceNormalFlux = groupVelocity(
    component.angularFrequency,
    referenceK,
    referenceDepth,
  ) * Math.max(.08, Math.abs(component.directionZ));
  const localNormalFlux = groupVelocity(
    component.angularFrequency,
    localK,
    localDepth,
  ) * Math.max(.08, Math.abs(localDirectionZ));
  return clamp(
    Math.sqrt(referenceNormalFlux / Math.max(.05, localNormalFlux)),
    .55,
    2.6,
  );
}

function buildTravelTables(
  bank: RenderComponentBank,
  contourKnots: Float32Array,
  depths: Float32Array,
) {
  const knotCount = contourKnots.length;
  const travelData = new Float32Array(knotCount * bank.count * 4);
  const aggregateData = new Float32Array(knotCount * 4);
  const referenceDepth = depths[0];

  for (const component of bank.components) {
    let integral = 0;
    for (let knot = 0; knot < knotCount; knot += 1) {
      const depth = depths[knot];
      const crossK = crossShoreWaveNumber(component, depth);
      if (knot > 0) {
        const startZ = contourKnots[knot - 1];
        const endZ = contourKnots[knot];
        const startDepth = depths[knot - 1];
        const intervalCount = Math.max(
          1,
          Math.ceil(Math.abs(endZ - startZ) / 3),
        );
        for (let interval = 0; interval < intervalCount; interval += 1) {
          const startUnit = interval / intervalCount;
          const endUnit = (interval + 1) / intervalCount;
          const middleUnit = (startUnit + endUnit) * .5;
          const intervalStartZ = startZ + (endZ - startZ) * startUnit;
          const intervalEndZ = startZ + (endZ - startZ) * endUnit;
          const intervalStartDepth =
            startDepth + (depth - startDepth) * startUnit;
          const intervalMiddleDepth =
            startDepth + (depth - startDepth) * middleUnit;
          const intervalEndDepth =
            startDepth + (depth - startDepth) * endUnit;
          integral += (intervalEndZ - intervalStartZ) * (
            crossShoreWaveNumber(component, intervalStartDepth)
              + 4 * crossShoreWaveNumber(
                component,
                intervalMiddleDepth,
              )
              + crossShoreWaveNumber(component, intervalEndDepth)
          ) / 6;
        }
      }
      const gain = shoalingGain(component, depth, referenceDepth);
      const amplitude = component.amplitude * gain;
      const texel = (component.id * knotCount + knot) * 4;
      travelData[texel] = integral;
      travelData[texel + 1] = crossK;
      travelData[texel + 2] = gain;
      travelData[texel + 3] = amplitude;
    }
  }

  for (let knot = 0; knot < knotCount; knot += 1) {
    let variance = 0;
    const steepnessComponents: Array<{
      amplitude: number;
      waveNumber: number;
    }> = [];
    for (const component of bank.components) {
      const texel = (component.id * knotCount + knot) * 4;
      const amplitude = travelData[texel + 3];
      const crossK = travelData[texel + 1];
      const localK = Math.hypot(component.alongshoreWaveNumber, crossK);
      variance += amplitude * amplitude * .5;
      steepnessComponents.push({
        amplitude,
        waveNumber: localK,
      });
    }
    const rawSignificantHeight = varianceToSignificantHeight(variance);
    const combinedSteepness = significantSpectralSteepness(
      steepnessComponents,
    );
    const steepnessScale = combinedSteepness > 0
      ? Math.min(1, MAXIMUM_COMBINED_STEEPNESS / combinedSteepness)
      : 1;
    const depthScale = rawSignificantHeight > 0
      ? Math.min(1, BREAKING_INDEX * depths[knot] / rawSignificantHeight)
      : 1;
    const texel = knot * 4;
    aggregateData[texel] = rawSignificantHeight;
    aggregateData[texel + 1] = steepnessScale;
    aggregateData[texel + 2] = depths[knot];
    aggregateData[texel + 3] = depthScale;
  }

  return {
    travel: {
      width: knotCount,
      height: bank.count,
      channels: 4,
      data: travelData,
      contourKnots,
      referenceContour: contourKnots[0],
    } satisfies RenderTravelTable,
    aggregate: {
      width: knotCount,
      height: 1,
      channels: 4,
      data: aggregateData,
    } satisfies RenderAggregateTable,
  };
}

function buildBathymetryTable(
  coastId: string,
  zoneName: string,
  centerX: number,
) {
  const knotCount = OCEAN_BATHYMETRY_COASTAL_Z.length;
  const xCount = OCEAN_BATHYMETRY_X_COUNT;
  const xStep = OCEAN_BATHYMETRY_X_STEP;
  const xMin = Math.floor(
    (centerX - OCEAN_BATHYMETRY_X_HALF_SPAN) / xStep,
  ) * xStep;
  const data = new Float32Array(
    knotCount * xCount * OCEAN_BATHYMETRY_ROWS * 4,
  );
  const rowPairLength = knotCount * OCEAN_BATHYMETRY_ROWS * 4;
  const shorelineGradientRadius = .4;
  for (let xIndex = 0; xIndex < xCount; xIndex += 1) {
    const x = xMin + xIndex * xStep;
    const rowKey = `${coastId}:${zoneName}:${x}`;
    const cachedRowPair = bathymetryRowCache.get(rowKey);
    if (cachedRowPair) {
      data.set(cachedRowPair, xIndex * rowPairLength);
      continue;
    }
    const rowPair = new Float32Array(rowPairLength);
    const shorelineZ = shorelineReferenceAt(coastId, zoneName, x);
    const shorelineGradientX = (
      shorelineReferenceAt(
        coastId,
        zoneName,
        x + shorelineGradientRadius,
      )
        - shorelineReferenceAt(
          coastId,
          zoneName,
          x - shorelineGradientRadius,
        )
    ) / (shorelineGradientRadius * 2);
    for (let knot = 0; knot < knotCount; knot += 1) {
      const coastalZ = OCEAN_BATHYMETRY_COASTAL_Z[knot];
      const contour = bathymetryContourCoordinateAt(
        coastId,
        zoneName,
        x,
        coastalZ,
      );
      const depth = bathymetryDepthAt(
        coastId,
        zoneName,
        x,
        coastalZ,
      );
      const contourGradient = bathymetryContourGradientAt(
        coastId,
        zoneName,
        x,
        coastalZ,
      );
      const depthGradient = bathymetryGradientAt(
        coastId,
        zoneName,
        x,
        coastalZ,
      );
      const first = knot * 4;
      rowPair[first] = contour;
      rowPair[first + 1] = depth;
      rowPair[first + 2] = shorelineZ;
      rowPair[first + 3] = shorelineGradientX;
      const second = (knotCount + knot) * 4;
      rowPair[second] = contourGradient.x;
      rowPair[second + 1] = contourGradient.z;
      rowPair[second + 2] = depthGradient.x;
      rowPair[second + 3] = depthGradient.z;
    }
    if (bathymetryRowCache.size >= MAX_BATHYMETRY_ROW_CACHE_ENTRIES) {
      const oldest = bathymetryRowCache.keys().next().value;
      if (oldest !== undefined) bathymetryRowCache.delete(oldest);
    }
    bathymetryRowCache.set(rowKey, rowPair);
    data.set(rowPair, xIndex * rowPairLength);
  }
  return {
    width: knotCount,
    height: xCount * OCEAN_BATHYMETRY_ROWS,
    channels: 4,
    data,
    coastalZKnots: new Float32Array(OCEAN_BATHYMETRY_COASTAL_Z),
    xMin,
    xStep,
    xCount,
  } satisfies RenderBathymetryTable;
}

function adaptiveTravelProfile(profile: WaveDepthProfile) {
  const additions = profile.knots
    .slice(0, -1)
    .flatMap((start, index) => {
      const end = profile.knots[index + 1];
      const span = end.z - start.z;
      if (span <= 2) return [];
      const shallowPhaseChange = span * Math.abs(
        1 / Math.sqrt(Math.max(.08, end.depth))
          - 1 / Math.sqrt(Math.max(.08, start.depth)),
      );
      const relativeDepthChange = Math.abs(end.depth - start.depth)
        / Math.max(.12, Math.min(start.depth, end.depth));
      const score = shallowPhaseChange + relativeDepthChange;
      return [
        { fraction: .5, weight: 1 },
        { fraction: .25, weight: .82 },
        { fraction: .75, weight: .82 },
        { fraction: .125, weight: .68 },
        { fraction: .375, weight: .68 },
        { fraction: .625, weight: .68 },
        { fraction: .875, weight: .68 },
        { fraction: .0625, weight: .55 },
        { fraction: .1875, weight: .55 },
        { fraction: .3125, weight: .55 },
        { fraction: .4375, weight: .55 },
        { fraction: .5625, weight: .55 },
        { fraction: .6875, weight: .55 },
        { fraction: .8125, weight: .55 },
        { fraction: .9375, weight: .55 },
      ].map(({ fraction, weight }) => ({
        z: start.z + span * fraction,
        score: score * weight,
      }));
    })
    .sort((a, b) => b.score - a.score || a.z - b.z)
    .slice(0, Math.max(0, 80 - profile.knots.length))
    .filter((interval) => interval.score > .04)
    .map((interval) => interval.z);
  const contour = [
    ...profile.knots.map((knot) => knot.z),
    ...additions,
  ].sort((a, b) => a - b);
  return {
    contourKnots: new Float32Array(contour),
    depths: new Float32Array(contour.map((z) => depthAt(profile, z))),
  };
}

function interpolationBracket(knots: Float32Array, value: number) {
  if (value <= knots[0]) return { low: 0, high: 0, blend: 0 };
  const last = knots.length - 1;
  if (value >= knots[last]) return { low: last, high: last, blend: 0 };
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (knots[middle] <= value) low = middle;
    else high = middle;
  }
  return {
    low,
    high,
    blend: (value - knots[low]) / Math.max(1e-9, knots[high] - knots[low]),
  };
}

export function packedBathymetryXInterpolation(
  table: RenderBathymetryTable,
  x: number,
): PackedBathymetryInterpolation {
  const coordinate = clamp(
    (x - table.xMin) / table.xStep,
    0,
    table.xCount - 1,
  );
  const low = Math.floor(coordinate);
  const high = Math.min(table.xCount - 1, low + 1);
  return {
    low,
    high,
    blend: coordinate - low,
  };
}

export function packedBathymetryZInterpolation(
  table: RenderBathymetryTable,
  coastalZ: number,
): PackedBathymetryInterpolation {
  return interpolationBracket(table.coastalZKnots, coastalZ);
}

function sampleRgbaRow(
  data: Float32Array,
  width: number,
  row: number,
  low: number,
  high: number,
  blend: number,
) {
  const start = (row * width + low) * 4;
  const end = (row * width + high) * 4;
  return [0, 1, 2, 3].map(
    (channel) => data[start + channel]
      + (data[end + channel] - data[start + channel]) * blend,
  );
}

export function samplePackedTravel(
  state: OceanRenderState,
  componentIndex: number,
  contourCoordinate: number,
): PackedTravelSample {
  if (state.componentBank.count === 0) {
    return {
      phaseIntegral: 0,
      crossShoreWaveNumber: 0,
      shoalingGain: 1,
      amplitude: 0,
    };
  }
  const row = clamp(Math.floor(componentIndex), 0, state.componentBank.count - 1);
  const bracket = interpolationBracket(state.travel.contourKnots, contourCoordinate);
  const sample = sampleRgbaRow(
    state.travel.data,
    state.travel.width,
    row,
    bracket.low,
    bracket.high,
    bracket.blend,
  );
  return {
    phaseIntegral: sample[0],
    crossShoreWaveNumber: sample[1],
    shoalingGain: sample[2],
    amplitude: sample[3],
  };
}

export function samplePackedAggregate(
  state: OceanRenderState,
  contourCoordinate: number,
): PackedAggregateSample {
  const bracket = interpolationBracket(state.travel.contourKnots, contourCoordinate);
  const sample = sampleRgbaRow(
    state.aggregate.data,
    state.aggregate.width,
    0,
    bracket.low,
    bracket.high,
    bracket.blend,
  );
  return {
    rawSignificantHeight: sample[0],
    steepnessScale: sample[1],
    depth: sample[2],
    depthScale: sample[3],
  };
}

export function samplePackedBathymetry(
  state: OceanRenderState,
  x: number,
  coastalZ: number,
): PackedBathymetrySample {
  const xBracket = packedBathymetryXInterpolation(state.bathymetry, x);
  const zBracket = packedBathymetryZInterpolation(
    state.bathymetry,
    coastalZ,
  );
  const valuesAtLowX = sampleRgbaRow(
    state.bathymetry.data,
    state.bathymetry.width,
    xBracket.low * OCEAN_BATHYMETRY_ROWS,
    zBracket.low,
    zBracket.high,
    zBracket.blend,
  );
  const valuesAtHighX = sampleRgbaRow(
    state.bathymetry.data,
    state.bathymetry.width,
    xBracket.high * OCEAN_BATHYMETRY_ROWS,
    zBracket.low,
    zBracket.high,
    zBracket.blend,
  );
  const derivativesAtLowX = sampleRgbaRow(
    state.bathymetry.data,
    state.bathymetry.width,
    xBracket.low * OCEAN_BATHYMETRY_ROWS + 1,
    zBracket.low,
    zBracket.high,
    zBracket.blend,
  );
  const derivativesAtHighX = sampleRgbaRow(
    state.bathymetry.data,
    state.bathymetry.width,
    xBracket.high * OCEAN_BATHYMETRY_ROWS + 1,
    zBracket.low,
    zBracket.high,
    zBracket.blend,
  );
  const values = valuesAtLowX.map((value, channel) => (
    value + (valuesAtHighX[channel] - value) * xBracket.blend
  ));
  const derivatives = derivativesAtLowX.map((value, channel) => (
    value + (derivativesAtHighX[channel] - value) * xBracket.blend
  ));
  const shoreDistance = coastalZ - values[2];
  return {
    contourCoordinate: values[0],
    depth: values[1],
    shorelineZ: values[2],
    shoreDistance,
    offshore: Math.max(0, -shoreDistance),
    shorelineGradientX: values[3],
    contourGradientX: derivatives[0],
    contourGradientZ: derivatives[1],
    depthGradientX: derivatives[2],
    depthGradientZ: derivatives[3],
  };
}

/**
 * CPU reconstruction of the vertex shader's vertical surface. It is used by
 * contract tests to ensure gameplay and rendering carry the same realized
 * components, phases, shoaling limit, and nonlinear breaker shape.
 */
export function samplePackedOceanHeight(
  state: OceanRenderState,
  x: number,
  worldZ: number,
  elapsed: number,
  settings: OceanSessionLike,
  character: BreakCharacter,
) {
  const coastalZ = worldToBathymetryZ(worldZ, settings.tide);
  const bathymetry = samplePackedBathymetry(state, x, coastalZ);
  const contourCoordinate = bathymetry.contourCoordinate;
  const aggregate = samplePackedAggregate(state, contourCoordinate);
  const propagationDepth = Math.max(.08, aggregate.depth);
  const breakingDepth = Math.max(.08, bathymetry.depth);
  const breakingRatio = aggregate.rawSignificantHeight
    / Math.max(.04, BREAKING_INDEX * breakingDepth);
  const depthScale = Math.min(
    1,
    BREAKING_INDEX * breakingDepth
      / Math.max(.0001, aggregate.rawSignificantHeight),
  );
  const amplitudeScale = Math.min(
    depthScale,
    aggregate.steepnessScale,
  );
  let height = 0;
  let horizontalDisplacementX = 0;
  let horizontalDisplacementZ = 0;
  let horizontalSlopeBudget = 0;
  let groupReal = 0;
  let groupImaginary = 0;
  let groupVariance = 0;
  let groupCarrierGradientX = 0;
  let groupCarrierGradientZ = 0;
  for (const component of state.componentBank.components) {
    const travel = samplePackedTravel(
      state,
      component.id,
      contourCoordinate,
    );
    const phase = component.alongshoreWaveNumber * x
      + travel.phaseIntegral
      - component.angularFrequency * elapsed
      + component.phaseOffset;
    const amplitude = travel.amplitude * amplitudeScale;
    height += amplitude * Math.cos(phase);
    const phaseGradientX = component.alongshoreWaveNumber
      + travel.crossShoreWaveNumber
        * bathymetry.contourGradientX;
    const phaseGradientZ = travel.crossShoreWaveNumber
      * bathymetry.contourGradientZ;
    const localWaveNumber = Math.max(
      .0001,
      Math.hypot(phaseGradientX, phaseGradientZ),
    );
    const coth = 1 / Math.max(
      .08,
      Math.tanh(localWaveNumber * propagationDepth),
    );
    const horizontalAmplitude = amplitude * Math.min(2.5, coth);
    horizontalDisplacementX -= horizontalAmplitude
      * Math.sin(phase)
      * phaseGradientX
      / localWaveNumber;
    horizontalDisplacementZ -= horizontalAmplitude
      * Math.sin(phase)
      * phaseGradientZ
      / localWaveNumber;
    horizontalSlopeBudget += horizontalAmplitude * localWaveNumber;
    const partitionTag = (
      component.kind === "swell" ? 1 : -1
    ) * (component.partitionId + 1);
    if (partitionTag === state.componentBank.dominantPartitionTag) {
      const varianceWeight = amplitude * amplitude * .5;
      groupReal += amplitude * Math.cos(phase);
      groupImaginary += amplitude * Math.sin(phase);
      groupVariance += varianceWeight;
      // Breaker face compression is parameterized in the fixed travel
      // profile's contour space, exactly like sampleWaveSurface. Physical
      // contour gradients belong in displacement/normal conversion above,
      // but folding them into this wavelength changes the nonlinear wall
      // support between rendering and gameplay.
      groupCarrierGradientX += varianceWeight
        * component.alongshoreWaveNumber;
      groupCarrierGradientZ += varianceWeight
        * travel.crossShoreWaveNumber;
    }
  }
  const dominantPhase = Math.atan2(groupImaginary, groupReal);
  const groupSignificantHeight = varianceToSignificantHeight(
    groupVariance,
  );
  const normalizedEnvelope = Math.hypot(
    groupReal,
    groupImaginary,
  ) / Math.max(.05, groupSignificantHeight * .5);
  const energyUnit = clamp(
    (normalizedEnvelope - .28) / (1.05 - .28),
    0,
    1,
  );
  const crestEnergy = energyUnit
    * energyUnit
    * (3 - 2 * energyUnit);
  const localSignificantHeight = aggregate.rawSignificantHeight
    * amplitudeScale;
  const stableCarrierGradientX = groupVariance > 1e-8
    ? groupCarrierGradientX / groupVariance
    : 0;
  const stableCarrierGradientZ = groupVariance > 1e-8
    ? groupCarrierGradientZ / groupVariance
    : 0;
  const dominantWavelength = Math.PI * 2 / Math.max(
    .0001,
    Math.hypot(
      stableCarrierGradientX,
      stableCarrierGradientZ,
    ),
  );
  const breaker = waveBreakerResponseAt(
    breakingRatio,
    localSignificantHeight,
    dominantPhase,
    crestEnergy,
    Math.hypot(groupReal, groupImaginary),
    {
      breakerPower: character.power,
      breakerSteepness: character.steepness,
      breakerHollow: character.hollow,
      targetFaceHeight: state.targetFaceHeight,
    },
    -contourCoordinate,
    dominantWavelength,
  );
  const horizontalSlopeScale = Math.min(
    1,
    .64 / Math.max(.0001, horizontalSlopeBudget),
  );
  horizontalDisplacementX *= horizontalSlopeScale;
  horizontalDisplacementZ *= horizontalSlopeScale;
  const horizontalMagnitude = Math.hypot(
    horizontalDisplacementX,
    horizontalDisplacementZ,
  );
  const horizontalMagnitudeScale =
    horizontalMagnitude > state.maximumHorizontalDisplacement
      ? state.maximumHorizontalDisplacement / horizontalMagnitude
      : 1;
  horizontalDisplacementX *= horizontalMagnitudeScale;
  horizontalDisplacementZ *= horizontalMagnitudeScale;
  const tideSurface = settings.tide * .3;
  const transition = applyOceanShoreTransition({
    x,
    elapsed,
    shoreDistance: bathymetry.shoreDistance,
    rawHeight: height + breaker.heightOffset + tideSurface,
    displacementX: horizontalDisplacementX,
    displacementZ: horizontalDisplacementZ,
    tideSurface,
    targetFaceHeight: state.targetFaceHeight,
  });
  return {
    height: transition.height,
    displacementX: transition.displacementX,
    displacementZ: transition.displacementZ,
    depth: breakingDepth,
    breakingRatio,
    breakingProgress: breaker.breakingProgress,
    brokenProgress: breaker.brokenProgress,
    whitewater: breaker.whitewater,
    shoreDistance: bathymetry.shoreDistance,
    shorelineZ: bathymetry.shorelineZ,
    shoreCollapse: transition.collapse,
    shoreCoverage: transition.coverage,
    shoreAnchorHeight: transition.anchorHeight,
    shoreBurial: transition.burial,
  };
}

export function createOceanRenderState(
  settings: OceanSessionLike,
  character: BreakCharacter,
  x: number,
): OceanRenderState {
  const model = coastWaveModelAt(x, settings, character);
  const location = oceanLocationFor(character);
  const componentBank = buildRenderComponentBank(
    model.bank,
    model.profile.knots[0]?.depth ?? model.bank.referenceDepth,
  );
  const { contourKnots, depths } = adaptiveTravelProfile(model.profile);
  const tables = buildTravelTables(componentBank, contourKnots, depths);
  const targetFaceHeight = forecastFaceHeightForBreak(
    settings.waveHeight,
    settings.tide,
    character,
  );
  return {
    coastId: location.coastId,
    zoneName: location.zoneName,
    // Render refreshes track the exact requested center. The wave travel
    // profile itself is fixed per coast/zone inside coastWaveModelAt.
    profileX: x,
    tide: settings.tide,
    targetFaceHeight,
    maximumHorizontalDisplacement:
      maximumVisibleHorizontalDisplacement(targetFaceHeight),
    componentBank,
    travel: tables.travel,
    aggregate: tables.aggregate,
    bathymetry: buildBathymetryTable(
      model.coastId,
      model.zoneName,
      x,
    ),
  };
}
