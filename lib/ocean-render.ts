import type { BreakCharacter } from "./beaches";
import {
  bathymetryContourCoordinateAt,
  bathymetryContourGradientAt,
  bathymetryDepthAt,
  bathymetryGradientAt,
  shorelineReferenceAt,
} from "./bathymetry.ts";
import {
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

const BREAKING_INDEX = .78;
const MAXIMUM_COMBINED_STEEPNESS = .44;

/**
 * Monotonic scene cross-shore samples. Their nearshore density resolves bars
 * and ledges while four wide offshore intervals keep the WebGL table compact.
 */
export const OCEAN_BATHYMETRY_COASTAL_Z = new Float32Array([
  -1260, -1050, -860, -700, -565, -450, -355, -310,
  -278, -244, -216, -190, -166, -145, -126, -111,
  -103, -96, -90, -84, -78, -73, -68, -64,
  -60, -57, -55, -51, -49, -47, -44, -40,
  -37, -34, -28, -25, -23, -19, -17, -15,
  -12, -9, -7, -3, 0, 2, 4, 6,
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
  /**
   * Row 0 = contour q, depth, shoreline z, ∂²q/∂x²
   * Row 1 = ∂q/∂x, ∂q/∂z, ∂depth/∂x, ∂depth/∂z
   *
   * Linear interpolation in coastal z plus the x derivatives gives a compact
   * local q/depth sampler without any coast-specific shader branches.
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
  offshore: number;
  contourCurvatureX: number;
  contourGradientX: number;
  contourGradientZ: number;
  depthGradientX: number;
  depthGradientZ: number;
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
    let previousCrossK = crossShoreWaveNumber(component, depths[0]);
    for (let knot = 0; knot < knotCount; knot += 1) {
      const depth = depths[knot];
      const crossK = crossShoreWaveNumber(component, depth);
      if (knot > 0) {
        const middleDepth = (depths[knot - 1] + depth) * .5;
        const middleCrossK = crossShoreWaveNumber(component, middleDepth);
        integral += (contourKnots[knot] - contourKnots[knot - 1])
          * (previousCrossK + 4 * middleCrossK + crossK)
          / 6;
      }
      const gain = shoalingGain(component, depth, referenceDepth);
      const amplitude = component.amplitude * gain;
      const texel = (component.id * knotCount + knot) * 4;
      travelData[texel] = integral;
      travelData[texel + 1] = crossK;
      travelData[texel + 2] = gain;
      travelData[texel + 3] = amplitude;
      previousCrossK = crossK;
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
  profileX: number,
) {
  const knotCount = OCEAN_BATHYMETRY_COASTAL_Z.length;
  const data = new Float32Array(knotCount * OCEAN_BATHYMETRY_ROWS * 4);
  for (let knot = 0; knot < knotCount; knot += 1) {
    const coastalZ = OCEAN_BATHYMETRY_COASTAL_Z[knot];
    const contour = bathymetryContourCoordinateAt(
      coastId,
      zoneName,
      profileX,
      coastalZ,
    );
    const depth = bathymetryDepthAt(
      coastId,
      zoneName,
      profileX,
      coastalZ,
    );
    const shorelineZ = shorelineReferenceAt(coastId, zoneName, profileX);
    const contourGradient = bathymetryContourGradientAt(
      coastId,
      zoneName,
      profileX,
      coastalZ,
    );
    const depthGradient = bathymetryGradientAt(
      coastId,
      zoneName,
      profileX,
      coastalZ,
    );
    const curvatureStep = 4;
    const contourCurvatureX = (
      bathymetryContourCoordinateAt(
        coastId,
        zoneName,
        profileX + curvatureStep,
        coastalZ,
      )
        - 2 * contour
        + bathymetryContourCoordinateAt(
          coastId,
          zoneName,
          profileX - curvatureStep,
          coastalZ,
        )
    ) / (curvatureStep * curvatureStep);
    const first = knot * 4;
    data[first] = contour;
    data[first + 1] = depth;
    data[first + 2] = shorelineZ;
    data[first + 3] = contourCurvatureX;
    const second = (knotCount + knot) * 4;
    data[second] = contourGradient.x;
    data[second + 1] = contourGradient.z;
    data[second + 2] = depthGradient.x;
    data[second + 3] = depthGradient.z;
  }
  return {
    width: knotCount,
    height: OCEAN_BATHYMETRY_ROWS,
    channels: 4,
    data,
    coastalZKnots: new Float32Array(OCEAN_BATHYMETRY_COASTAL_Z),
  } satisfies RenderBathymetryTable;
}

function adaptiveTravelProfile(profile: WaveDepthProfile) {
  const additions = profile.knots
    .slice(0, -1)
    .map((start, index) => {
      const end = profile.knots[index + 1];
      const span = end.z - start.z;
      return {
        z: (start.z + end.z) * .5,
        score: span > 3
          ? Math.abs(end.depth - start.depth)
            + Math.min(24, span) * .012
          : 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.z - b.z)
    .slice(0, Math.max(0, 40 - profile.knots.length))
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
  coastalZ: number,
): PackedBathymetrySample {
  const bracket = interpolationBracket(state.bathymetry.coastalZKnots, coastalZ);
  const values = sampleRgbaRow(
    state.bathymetry.data,
    state.bathymetry.width,
    0,
    bracket.low,
    bracket.high,
    bracket.blend,
  );
  const derivatives = sampleRgbaRow(
    state.bathymetry.data,
    state.bathymetry.width,
    1,
    bracket.low,
    bracket.high,
    bracket.blend,
  );
  return {
    contourCoordinate: values[0],
    depth: values[1],
    shorelineZ: values[2],
    offshore: Math.max(0, values[2] - coastalZ),
    contourCurvatureX: values[3],
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
  const bathymetry = samplePackedBathymetry(state, coastalZ);
  const profileDeltaX = x - state.profileX;
  const contourCoordinate = bathymetry.contourCoordinate
    + bathymetry.contourGradientX * profileDeltaX
    + bathymetry.contourCurvatureX
      * profileDeltaX * profileDeltaX * .5;
  const aggregate = samplePackedAggregate(state, contourCoordinate);
  const depth = Math.max(.08, aggregate.depth);
  const breakingRatio = aggregate.rawSignificantHeight
    / Math.max(.04, BREAKING_INDEX * depth);
  const depthScale = Math.min(
    1,
    BREAKING_INDEX * depth
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
    const coth = 1 / Math.max(.08, Math.tanh(localWaveNumber * depth));
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
      groupCarrierGradientX += varianceWeight * phaseGradientX;
      groupCarrierGradientZ += varianceWeight * phaseGradientZ;
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
  return {
    height: height + breaker.heightOffset + settings.tide * .3,
    displacementX: horizontalDisplacementX,
    displacementZ: horizontalDisplacementZ,
    depth,
    breakingRatio,
    breakingProgress: breaker.breakingProgress,
    brokenProgress: breaker.brokenProgress,
    whitewater: breaker.whitewater,
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
    profileX: model.profileX,
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
      model.profileX,
    ),
  };
}
