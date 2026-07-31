import type { Beach } from "./beaches";

/**
 * Deterministic bathymetry shared by wave propagation, breaking, gameplay and
 * rendering. Coordinates follow the scene convention: x is alongshore and
 * coastalZ becomes more negative offshore.
 *
 * The profiles intentionally contain only numbers (plus the descriptive
 * `class`). The same primitives can therefore be copied directly to GLSL or
 * packed into uniforms/textures without coast-specific shader branches.
 */

export type BathymetryClass = "beach-bars" | "reef-shelf" | "slab" | "point" | "canyon";
export type BreakerType = "spilling" | "plunging" | "collapsing" | "surging";

export const BATHYMETRY_CLASS_CODE: Record<BathymetryClass, number> = {
  "beach-bars": 0,
  "reef-shelf": 1,
  slab: 2,
  point: 3,
  canyon: 4,
};

export type BathymetryProfile = {
  class: BathymetryClass;
  shorelineZ: number;
  shoreDepth: number;
  nearSlope: number;
  deepSlope: number;
  slopeTransition: number;
  maxDepth: number;

  // Curves the shoreline and all depth contours for point-break refraction.
  contourCurve: number;
  contourScale: number;
  contourPhase: number;

  // Two continuous sand/cobble bars. Set lift to zero to disable.
  innerBarOffshore: number;
  innerBarWidth: number;
  innerBarLift: number;
  outerBarOffshore: number;
  outerBarWidth: number;
  outerBarLift: number;
  barAlongshoreWarp: number;
  barAlongshoreScale: number;

  // Repeating deeper channels through a bar or reef shelf.
  channelDepth: number;
  channelWidth: number;
  channelSpacing: number;
  channelPhase: number;
  channelOffshore: number;
  channelReach: number;

  // A shallow inshore shelf behind a smooth offshore ledge.
  ledgeOffshore: number;
  ledgeWidth: number;
  shelfLift: number;
  reefRelief: number;
  reefScaleX: number;
  reefScaleZ: number;

  // A deep, tapered submarine canyon.
  canyonDepth: number;
  canyonHalfWidth: number;
  canyonStart: number;
  canyonReach: number;
  canyonSkew: number;

  // Breaker priors consumed by breakerTypeHintAt.
  spillingBias: number;
  plungingBias: number;
  collapsingBias: number;
  surgingBias: number;
};

export type BathymetryZoneOverride = {
  shoreShift?: number;
  alongshoreShift?: number;
  slopeScale?: number;
  featureScale?: number;
  barShift?: number;
  channelShift?: number;
  ledgeShift?: number;
  curveScale?: number;
  canyonScale?: number;
};

export type BathymetryGradient = {
  /** ∂depth / ∂x */
  x: number;
  /** ∂depth / ∂coastalZ */
  z: number;
  magnitude: number;
};

export type BreakerTypeHint = {
  primary: BreakerType;
  spilling: number;
  plunging: number;
  collapsing: number;
  surging: number;
  /** 0..1 indication of how abruptly the bottom rises toward shore. */
  intensity: number;
};

export type BathymetrySample = {
  depth: number;
  offshore: number;
  shorelineZ: number;
  gradient: BathymetryGradient;
  class: BathymetryClass;
  classCode: number;
  breaker: BreakerTypeHint;
  contourCoordinate: number;
  contourGradient: BathymetryGradient;
};

const BEACH_BASE: BathymetryProfile = {
  class: "beach-bars",
  shorelineZ: 0,
  shoreDepth: .48,
  nearSlope: .052,
  deepSlope: .025,
  slopeTransition: 115,
  maxDepth: 42,
  contourCurve: 0,
  contourScale: 180,
  contourPhase: 0,
  innerBarOffshore: 35,
  innerBarWidth: 9,
  innerBarLift: 1.05,
  outerBarOffshore: 76,
  outerBarWidth: 15,
  outerBarLift: 1.35,
  barAlongshoreWarp: 8,
  barAlongshoreScale: 115,
  channelDepth: 1.25,
  channelWidth: 15,
  channelSpacing: 145,
  channelPhase: 0,
  channelOffshore: 51,
  channelReach: 54,
  ledgeOffshore: 0,
  ledgeWidth: 1,
  shelfLift: 0,
  reefRelief: 0,
  reefScaleX: 42,
  reefScaleZ: 28,
  canyonDepth: 0,
  canyonHalfWidth: 1,
  canyonStart: 0,
  canyonReach: 1,
  canyonSkew: 0,
  spillingBias: .72,
  plungingBias: .22,
  collapsingBias: .04,
  surgingBias: .02,
};

const REEF_BASE: BathymetryProfile = {
  ...BEACH_BASE,
  class: "reef-shelf",
  nearSlope: .062,
  deepSlope: .038,
  slopeTransition: 145,
  innerBarLift: 0,
  outerBarLift: 0,
  barAlongshoreWarp: 0,
  channelDepth: 1.55,
  channelWidth: 12,
  channelSpacing: 190,
  channelOffshore: 63,
  channelReach: 60,
  ledgeOffshore: 74,
  ledgeWidth: 10,
  shelfLift: 2.8,
  reefRelief: .34,
  reefScaleX: 38,
  reefScaleZ: 25,
  spillingBias: .12,
  plungingBias: .7,
  collapsingBias: .14,
  surgingBias: .04,
};

const POINT_BASE: BathymetryProfile = {
  ...REEF_BASE,
  class: "point",
  nearSlope: .044,
  deepSlope: .027,
  channelDepth: .45,
  channelWidth: 16,
  channelSpacing: 250,
  ledgeOffshore: 70,
  ledgeWidth: 19,
  shelfLift: 1.5,
  reefRelief: .18,
  contourCurve: 18,
  contourScale: 210,
  spillingBias: .48,
  plungingBias: .44,
  collapsingBias: .06,
  surgingBias: .02,
};

const SLAB_BASE: BathymetryProfile = {
  ...REEF_BASE,
  class: "slab",
  nearSlope: .074,
  deepSlope: .052,
  slopeTransition: 125,
  channelDepth: 1,
  ledgeOffshore: 62,
  ledgeWidth: 4.2,
  shelfLift: 3.8,
  reefRelief: .22,
  spillingBias: .02,
  plungingBias: .57,
  collapsingBias: .31,
  surgingBias: .1,
};

const CANYON_BASE: BathymetryProfile = {
  ...BEACH_BASE,
  class: "canyon",
  nearSlope: .057,
  deepSlope: .04,
  slopeTransition: 150,
  innerBarLift: .35,
  outerBarLift: .5,
  channelDepth: 0,
  canyonDepth: 15,
  canyonHalfWidth: 40,
  canyonStart: 28,
  canyonReach: 190,
  canyonSkew: .14,
  spillingBias: .08,
  plungingBias: .61,
  collapsingBias: .12,
  surgingBias: .19,
};

function profile(base: BathymetryProfile, patch: Partial<BathymetryProfile>): BathymetryProfile {
  return { ...base, ...patch };
}

/** Coast defaults. Every ID in BEACHES has an explicit entry. */
export const BATHYMETRY_PROFILES: Record<string, BathymetryProfile> = {
  pipeline: profile(REEF_BASE, {
    ledgeOffshore: 59, ledgeWidth: 7, shelfLift: 3.1, reefRelief: .42,
    channelSpacing: 170, channelPhase: 28, plungingBias: .78, spillingBias: .06,
  }),
  mavericks: profile(REEF_BASE, {
    shoreDepth: .7, nearSlope: .077, deepSlope: .052, ledgeOffshore: 103,
    ledgeWidth: 13, shelfLift: 4.2, channelDepth: 2.2, channelSpacing: 230,
    reefRelief: .5, maxDepth: 55, plungingBias: .67, surgingBias: .14,
  }),
  teahupoo: profile(SLAB_BASE, {
    ledgeOffshore: 57, ledgeWidth: 3.5, shelfLift: 4.2, channelPhase: -32,
    reefRelief: .27, collapsingBias: .35, plungingBias: .57,
  }),
  rockaway: profile(BEACH_BASE, {
    nearSlope: .044, innerBarOffshore: 31, outerBarOffshore: 70,
    channelSpacing: 128, barAlongshoreWarp: 10, barAlongshoreScale: 96,
  }),
  "jeffreys-bay": profile(POINT_BASE, {
    contourCurve: 25, contourScale: 250, contourPhase: -45, ledgeOffshore: 77,
    ledgeWidth: 22, shelfLift: 1.7, channelDepth: .28, reefRelief: .16,
  }),
  "snapper-rocks": profile(POINT_BASE, {
    nearSlope: .038, contourCurve: 21, contourScale: 225, contourPhase: 18,
    innerBarOffshore: 38, innerBarWidth: 13, innerBarLift: .42,
    ledgeOffshore: 68, shelfLift: 1.2, reefRelief: .1,
  }),
  uluwatu: profile(REEF_BASE, {
    contourCurve: -9, contourScale: 170, ledgeOffshore: 72, ledgeWidth: 9,
    shelfLift: 3.2, channelSpacing: 160, reefRelief: .45,
  }),
  trestles: profile(REEF_BASE, {
    nearSlope: .045, deepSlope: .027, ledgeOffshore: 61, ledgeWidth: 18,
    shelfLift: 1.55, channelDepth: .55, channelSpacing: 210, reefRelief: .2,
    innerBarOffshore: 39, innerBarWidth: 15, innerBarLift: .35,
    spillingBias: .38, plungingBias: .53,
  }),
  hossegor: profile(BEACH_BASE, {
    nearSlope: .061, deepSlope: .031, innerBarOffshore: 27,
    innerBarWidth: 7, innerBarLift: 1.25, outerBarOffshore: 65,
    outerBarWidth: 12, outerBarLift: 1.7, channelDepth: 1.5,
    channelSpacing: 118, barAlongshoreWarp: 12,
    spillingBias: .34, plungingBias: .58,
  }),
  nazare: profile(CANYON_BASE, {
    canyonDepth: 19, canyonHalfWidth: 43, canyonStart: 24,
    canyonReach: 235, canyonSkew: .18, maxDepth: 64,
  }),
  cloudbreak: profile(REEF_BASE, {
    contourCurve: -11, contourScale: 205, ledgeOffshore: 82,
    ledgeWidth: 8, shelfLift: 3.45, channelSpacing: 220,
    channelDepth: 1.8, reefRelief: .4, plungingBias: .76,
  }),
  raglan: profile(POINT_BASE, {
    contourCurve: -27, contourScale: 255, contourPhase: 36,
    nearSlope: .04, ledgeOffshore: 73, ledgeWidth: 24, shelfLift: 1.25,
    reefRelief: .21, spillingBias: .58, plungingBias: .35,
  }),
  chicama: profile(POINT_BASE, {
    contourCurve: -32, contourScale: 310, contourPhase: -25,
    nearSlope: .031, deepSlope: .021, ledgeOffshore: 66, ledgeWidth: 29,
    shelfLift: .92, reefRelief: .08, channelDepth: .12,
    spillingBias: .72, plungingBias: .23,
  }),
};

/**
 * Zone adjustments preserve a coast's primitive layout while shifting the
 * focal feature and changing its strength. Every playable zone resolves
 * through this table, including intentionally neutral entries.
 */
export const BATHYMETRY_ZONE_OVERRIDES: Record<string, BathymetryZoneOverride> = {
  "pipeline:Ehukai": { alongshoreShift: -54, slopeScale: .82, featureScale: .7, barShift: 8 },
  "pipeline:First Reef": { alongshoreShift: 0, featureScale: 1.08, ledgeShift: -3 },
  "pipeline:Backdoor": { alongshoreShift: 42, featureScale: 1.12, channelShift: 18 },
  "mavericks:Mushrooms": { alongshoreShift: -62, featureScale: 1.12, ledgeShift: 12 },
  "mavericks:The Bowl": { alongshoreShift: 0, featureScale: 1.08, ledgeShift: -5 },
  "mavericks:Pillar Point": { alongshoreShift: 66, slopeScale: .76, featureScale: .62 },
  "teahupoo:The Bowl": { alongshoreShift: 0, featureScale: 1.08 },
  "teahupoo:West Bowl": { alongshoreShift: -48, featureScale: 1.16, ledgeShift: 3 },
  "teahupoo:Inside": { alongshoreShift: 52, slopeScale: .67, featureScale: .52, ledgeShift: -12 },
  "rockaway:Beach 67th": { alongshoreShift: -85, channelShift: -18, barShift: 6 },
  "rockaway:Beach 90th": { alongshoreShift: -24, channelShift: 4 },
  "rockaway:Beach 92nd": { alongshoreShift: 0, featureScale: 1.08, channelShift: 14 },
  "rockaway:Beach 98th": { alongshoreShift: 52, featureScale: 1.14, barShift: -5 },
  "rockaway:Beach 108th": { alongshoreShift: 108, slopeScale: .9, barShift: 10 },
  "jeffreys-bay:Boneyards": { alongshoreShift: -66, curveScale: .82, featureScale: 1.08 },
  "jeffreys-bay:Supertubes": { alongshoreShift: 0, curveScale: 1.08 },
  "jeffreys-bay:Impossibles": { alongshoreShift: 76, slopeScale: .82, curveScale: 1.22 },
  "snapper-rocks:Snapper": { alongshoreShift: -58, featureScale: 1.08, curveScale: .9 },
  "snapper-rocks:Rainbow Bay": { alongshoreShift: 4, slopeScale: .86, curveScale: 1.12 },
  "snapper-rocks:Greenmount": { alongshoreShift: 72, slopeScale: .76, curveScale: 1.28 },
  "uluwatu:Temples": { alongshoreShift: -68, slopeScale: .84, curveScale: 1.18 },
  "uluwatu:The Peak": { alongshoreShift: 0, featureScale: 1.08 },
  "uluwatu:Racetracks": { alongshoreShift: 71, featureScale: 1.16, ledgeShift: -6 },
  "trestles:Uppers": { alongshoreShift: -64, featureScale: 1.08, curveScale: .8 },
  "trestles:Lowers": { alongshoreShift: 0, featureScale: 1.02 },
  "trestles:Church": { alongshoreShift: 73, slopeScale: .8, featureScale: .72 },
  "hossegor:La Gravière": { alongshoreShift: -54, featureScale: 1.12, barShift: -5 },
  "hossegor:La Nord": { alongshoreShift: 0, slopeScale: 1.13, featureScale: 1.16, barShift: 12 },
  "hossegor:Les Culs Nus": { alongshoreShift: 64, featureScale: .94, channelShift: 22 },
  "nazare:Praia do Norte": { alongshoreShift: 0, canyonScale: 1.15, slopeScale: 1.06 },
  "nazare:The Lighthouse": { alongshoreShift: 47, canyonScale: .9, channelShift: 16 },
  "nazare:South Beach": { alongshoreShift: 126, canyonScale: .3, slopeScale: .7, featureScale: .55 },
  "cloudbreak:The Point": { alongshoreShift: -68, slopeScale: .88, curveScale: 1.2 },
  "cloudbreak:Cloudbreak": { alongshoreShift: 0, featureScale: 1.08 },
  "cloudbreak:Shish Kabobs": { alongshoreShift: 68, featureScale: 1.18, ledgeShift: -7 },
  "raglan:Indicators": { alongshoreShift: -70, featureScale: 1.08, curveScale: .86 },
  "raglan:Whale Bay": { alongshoreShift: 0, curveScale: 1.05 },
  "raglan:Manu Bay": { alongshoreShift: 77, slopeScale: .78, curveScale: 1.28 },
  "chicama:Malpaso": { alongshoreShift: -82, featureScale: 1.08, curveScale: .84 },
  "chicama:El Point": { alongshoreShift: 0, curveScale: 1.08 },
  "chicama:El Hombre": { alongshoreShift: 96, slopeScale: .72, curveScale: 1.34 },
};

const DEFAULT_PROFILE = BATHYMETRY_PROFILES.rockaway;
const TAU = Math.PI * 2;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function gaussian(value: number, center: number, width: number) {
  const q = (value - center) / Math.max(.001, width);
  return Math.exp(-.5 * q * q);
}

function resolvedInputs(coastId: string, zoneName: string) {
  const base = BATHYMETRY_PROFILES[coastId] ?? DEFAULT_PROFILE;
  const zone = BATHYMETRY_ZONE_OVERRIDES[`${coastId}:${zoneName}`] ?? {};
  return {
    base,
    zone,
    alongshoreShift: zone.alongshoreShift ?? 0,
    slopeScale: zone.slopeScale ?? 1,
    featureScale: zone.featureScale ?? 1,
    barShift: zone.barShift ?? 0,
    channelShift: zone.channelShift ?? 0,
    ledgeShift: zone.ledgeShift ?? 0,
    curveScale: zone.curveScale ?? 1,
    canyonScale: zone.canyonScale ?? 1,
    shoreShift: zone.shoreShift ?? 0,
  };
}

export function getBathymetryProfile(coastId: string): BathymetryProfile {
  return BATHYMETRY_PROFILES[coastId] ?? DEFAULT_PROFILE;
}

export function getBathymetryZoneOverride(coastId: string, zoneName = ""): BathymetryZoneOverride {
  return BATHYMETRY_ZONE_OVERRIDES[`${coastId}:${zoneName}`] ?? {};
}

/** Curved local shoreline reference, in scene coastalZ coordinates. */
export function shorelineReferenceAt(coastId: string, zoneName: string, x: number) {
  const r = resolvedInputs(coastId, zoneName);
  const localX = x - r.alongshoreShift;
  const curve = r.base.contourCurve * r.curveScale;
  const argument = (localX + r.base.contourPhase) / Math.max(1, r.base.contourScale);
  // cos()-1 anchors x=-phase at the profile shoreline instead of shifting it.
  return r.base.shorelineZ + r.shoreShift + curve * (Math.cos(argument) - 1);
}

export function distanceOffshoreAt(coastId: string, zoneName: string, x: number, coastalZ: number) {
  return Math.max(0, shorelineReferenceAt(coastId, zoneName, x) - coastalZ);
}

/**
 * Effective signed cross-shore coordinate for wave phase integration.
 *
 * It is zero on the local shoreline and negative offshore, like coastalZ.
 * The offsets bend phase contours around bars, reef relief/channels and the
 * canyon. A wave solver can integrate k over this scalar coordinate instead of
 * ray-marching through the full depth map per vertex.
 */
export function bathymetryContourCoordinateAt(
  coastId: string,
  zoneName: string,
  x: number,
  coastalZ: number,
) {
  const r = resolvedInputs(coastId, zoneName);
  const p = r.base;
  const localX = x - r.alongshoreShift;
  const shoreline = shorelineReferenceAt(coastId, zoneName, x);
  const offshore = Math.max(0, shoreline - coastalZ);
  let offset = 0;

  // Bar crests meander alongshore and gently bend incoming phase lines.
  if (p.innerBarLift + p.outerBarLift > 0) {
    const barWarp = p.barAlongshoreWarp
      * Math.sin(localX * TAU / Math.max(1, p.barAlongshoreScale));
    const barWindow = Math.max(
      gaussian(offshore, p.innerBarOffshore + r.barShift, p.innerBarWidth * 1.5),
      gaussian(offshore, p.outerBarOffshore + r.barShift, p.outerBarWidth * 1.5),
    );
    offset += barWarp * r.featureScale * barWindow * .34;
  }

  // Reef relief and channels stagger the ledge without changing the shoreline.
  if (p.shelfLift > 0) {
    const ledge = p.ledgeOffshore + r.ledgeShift;
    const ledgeWindow = gaussian(offshore, ledge, Math.max(8, p.ledgeWidth * 2.2));
    const reliefContour = Math.sin(localX * TAU / Math.max(1, p.reefScaleX));
    const channelAngle = (localX - p.channelPhase - r.channelShift)
      * TAU / Math.max(1, p.channelSpacing);
    const channelContour = Math.pow(Math.max(0, Math.cos(channelAngle)), 4);
    offset += (
      reliefContour * p.reefRelief * 5
      - channelContour * p.channelDepth * 1.4
    ) * r.featureScale * ledgeWindow;
  }

  // Deep canyon water advances phase relative to the shelf, visibly converging
  // contours toward its axis. Taper it to zero at both ends and the shoreline.
  if (p.canyonDepth > 0) {
    const canyonCenter = p.canyonSkew * (offshore - p.canyonStart);
    const crossCanyon = gaussian(localX, canyonCenter, p.canyonHalfWidth);
    const entry = smoothstep(p.canyonStart, p.canyonStart + 28, offshore);
    const exit = 1 - smoothstep(p.canyonReach, p.canyonReach + 70, offshore);
    offset += p.canyonDepth * .72 * r.canyonScale * crossCanyon * entry * exit;
  }

  return coastalZ - shoreline + offset;
}

export function bathymetryContourGradientAt(
  coastId: string,
  zoneName: string,
  x: number,
  coastalZ: number,
  sampleRadius = .4,
): BathymetryGradient {
  const radius = Math.max(.05, sampleRadius);
  const dx = (
    bathymetryContourCoordinateAt(coastId, zoneName, x + radius, coastalZ)
    - bathymetryContourCoordinateAt(coastId, zoneName, x - radius, coastalZ)
  ) / (radius * 2);
  const dz = (
    bathymetryContourCoordinateAt(coastId, zoneName, x, coastalZ + radius)
    - bathymetryContourCoordinateAt(coastId, zoneName, x, coastalZ - radius)
  ) / (radius * 2);
  return { x: dx, z: dz, magnitude: Math.hypot(dx, dz) };
}

/**
 * Positive water depth. All terms are continuous; the .32 m floor only
 * activates on land or on extremely shallow exposed features.
 */
export function bathymetryDepthAt(coastId: string, zoneName: string, x: number, coastalZ: number) {
  const r = resolvedInputs(coastId, zoneName);
  const p = r.base;
  const localX = x - r.alongshoreShift;
  const offshore = distanceOffshoreAt(coastId, zoneName, x, coastalZ);

  const transition = Math.max(1, p.slopeTransition);
  const farDistance = Math.max(0, offshore - transition);
  let depth = p.shoreDepth
    + p.nearSlope * r.slopeScale * Math.min(offshore, transition)
    + p.deepSlope * r.slopeScale * farDistance;

  const warpedBarOffset = r.barShift
    + p.barAlongshoreWarp * Math.sin(localX * TAU / Math.max(1, p.barAlongshoreScale));
  depth -= p.innerBarLift * r.featureScale
    * gaussian(offshore, p.innerBarOffshore + warpedBarOffset, p.innerBarWidth);
  depth -= p.outerBarLift * r.featureScale
    * gaussian(offshore, p.outerBarOffshore + warpedBarOffset * .65, p.outerBarWidth);

  if (p.channelDepth > 0) {
    const channelAngle = (localX - p.channelPhase - r.channelShift)
      * TAU / Math.max(1, p.channelSpacing);
    const channelCore = Math.pow(Math.max(0, Math.cos(channelAngle)), 6);
    const channelWindow = gaussian(offshore, p.channelOffshore, p.channelReach);
    depth += p.channelDepth * r.featureScale * channelCore * channelWindow;
  }

  if (p.shelfLift > 0) {
    const ledge = p.ledgeOffshore + r.ledgeShift;
    const inshoreShelf = 1 - smoothstep(ledge - p.ledgeWidth, ledge + p.ledgeWidth, offshore);
    const shorelineFade = smoothstep(3, 15, offshore);
    depth -= p.shelfLift * r.featureScale * inshoreShelf * shorelineFade;

    const reliefWindow = gaussian(offshore, ledge * .72, Math.max(18, ledge * .72));
    const relief = Math.sin(localX * TAU / Math.max(1, p.reefScaleX))
      * Math.cos(offshore * TAU / Math.max(1, p.reefScaleZ));
    depth -= p.reefRelief * r.featureScale * relief * reliefWindow;
  }

  if (p.canyonDepth > 0) {
    const canyonCenter = p.canyonSkew * (offshore - p.canyonStart);
    const crossCanyon = gaussian(localX, canyonCenter, p.canyonHalfWidth);
    const entry = smoothstep(p.canyonStart, p.canyonStart + 28, offshore);
    const exit = 1 - smoothstep(p.canyonReach, p.canyonReach + 70, offshore);
    depth += p.canyonDepth * r.canyonScale * crossCanyon * entry * exit;
  }

  // Differentiable positive floor avoids unstable normals/refraction where a
  // shallow shelf approaches exposure. GLSL equivalent:
  // floor + .5 * (d-floor + sqrt((d-floor)^2 + epsilon)).
  const aboveFloor = depth - .32;
  const positiveDepth = .32 + .5 * (aboveFloor + Math.sqrt(aboveFloor * aboveFloor + .0004));
  return Math.min(positiveDepth, p.maxDepth);
}

/**
 * Central-difference gradient. Keeping this derivative in terms of depthAt
 * guarantees CPU/GPU agreement even as profiles evolve; GLSL can use the same
 * four taps for wave refraction and bottom-normal construction.
 */
export function bathymetryGradientAt(
  coastId: string,
  zoneName: string,
  x: number,
  coastalZ: number,
  sampleRadius = .4,
): BathymetryGradient {
  const radius = Math.max(.05, sampleRadius);
  const dx = (
    bathymetryDepthAt(coastId, zoneName, x + radius, coastalZ)
    - bathymetryDepthAt(coastId, zoneName, x - radius, coastalZ)
  ) / (radius * 2);
  const dz = (
    bathymetryDepthAt(coastId, zoneName, x, coastalZ + radius)
    - bathymetryDepthAt(coastId, zoneName, x, coastalZ - radius)
  ) / (radius * 2);
  return { x: dx, z: dz, magnitude: Math.hypot(dx, dz) };
}

function normalizedBreakerWeights(profile: BathymetryProfile, gradient: BathymetryGradient) {
  // Stronger bottom gradients favor abrupt breaker types. Priors retain each
  // coast's identity where the local contour is gentle.
  const abruptness = clamp((gradient.magnitude - .025) / .14, 0, 1);
  const raw = {
    spilling: profile.spillingBias * (1 - abruptness * .68),
    plunging: profile.plungingBias * (1 + abruptness * .38),
    collapsing: profile.collapsingBias * (1 + abruptness * .9),
    surging: profile.surgingBias * (1 + abruptness * 1.1),
  };
  const total = raw.spilling + raw.plunging + raw.collapsing + raw.surging || 1;
  return {
    spilling: raw.spilling / total,
    plunging: raw.plunging / total,
    collapsing: raw.collapsing / total,
    surging: raw.surging / total,
    intensity: abruptness,
  };
}

export function breakerTypeHintAt(
  coastId: string,
  zoneName: string,
  x: number,
  coastalZ: number,
): BreakerTypeHint {
  const profile = getBathymetryProfile(coastId);
  const gradient = bathymetryGradientAt(coastId, zoneName, x, coastalZ);
  const weights = normalizedBreakerWeights(profile, gradient);
  const entries = (["spilling", "plunging", "collapsing", "surging"] as const)
    .map((type) => [type, weights[type]] as const)
    .sort((a, b) => b[1] - a[1]);
  return { primary: entries[0][0], ...weights };
}

export function bathymetryClassFor(coastId: string): BathymetryClass {
  return getBathymetryProfile(coastId).class;
}

export function sampleBathymetry(
  coastId: string,
  zoneName: string,
  x: number,
  coastalZ: number,
): BathymetrySample {
  const shorelineZ = shorelineReferenceAt(coastId, zoneName, x);
  const className = bathymetryClassFor(coastId);
  return {
    depth: bathymetryDepthAt(coastId, zoneName, x, coastalZ),
    offshore: Math.max(0, shorelineZ - coastalZ),
    shorelineZ,
    gradient: bathymetryGradientAt(coastId, zoneName, x, coastalZ),
    class: className,
    classCode: BATHYMETRY_CLASS_CODE[className],
    breaker: breakerTypeHintAt(coastId, zoneName, x, coastalZ),
    contourCoordinate: bathymetryContourCoordinateAt(coastId, zoneName, x, coastalZ),
    contourGradient: bathymetryContourGradientAt(coastId, zoneName, x, coastalZ),
  };
}

/** Runtime guard used by release verification and integration diagnostics. */
export function bathymetryCoverage(beaches: readonly Pick<Beach, "id" | "zones">[]) {
  return beaches.map((beach) => ({
    coastId: beach.id,
    class: bathymetryClassFor(beach.id),
    zones: beach.zones.map((zone) => ({
      name: zone.name,
      hasOverride: `${beach.id}:${zone.name}` in BATHYMETRY_ZONE_OVERRIDES,
    })),
  }));
}
