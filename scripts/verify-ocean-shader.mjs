import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../components/SurfScene.tsx", import.meta.url),
  "utf8",
);
const vertexStart = source.indexOf("const OCEAN_VERTEX");
const fragmentStart = source.indexOf("const OCEAN_FRAGMENT", vertexStart);
const lineupStart = source.indexOf(
  "function nearestWaveCrestPointAt",
  fragmentStart,
);

assert.ok(vertexStart >= 0, "ocean vertex shader is missing");
assert.ok(fragmentStart > vertexStart, "ocean fragment shader is missing");
assert.ok(
  lineupStart > fragmentStart,
  "ocean shader boundary is missing",
);

const vertex = source.slice(vertexStart, fragmentStart);
const fragment = source.slice(fragmentStart, lineupStart);
const wetSandFragmentStart = source.indexOf(
  "const WET_SAND_FRAGMENT",
  lineupStart,
);
const wetSandFragmentEnd = source.indexOf(
  "function WetSandSurface(",
  wetSandFragmentStart,
);
const wetSandFragment = source.slice(
  wetSandFragmentStart,
  wetSandFragmentEnd,
);
const wetSandSurface = source.slice(
  wetSandFragmentEnd,
  source.indexOf("type VisitorActivity", wetSandFragmentEnd),
);
const oceanComponent = source.slice(
  source.indexOf("function Ocean("),
  lineupStart,
);
const breakerHeightHelperStart = vertex.indexOf(
  "float breakerHeightAtDepth(",
);
const breakerHeightHelperEnd = vertex.indexOf(
  "void main()",
  breakerHeightHelperStart,
);
const breakerHeightHelper = vertex.slice(
  breakerHeightHelperStart,
  breakerHeightHelperEnd,
);

for (const token of [
  "uComponentParameters",
  "uTravel",
  "uAggregate",
  "uBathymetry",
  "uDominantPartitionTag",
  "travel.r",
  "first.g * uTime",
  "vWorldNormal",
  "uBreakerPower",
  "uBreakerSteepness",
  "uBreakerHollow",
  "uTargetFaceHeight",
  "uMaximumHorizontalDisplacement",
  "breakerShapeDerivative",
  "targetCarrierAmplitude",
  "groupCarrierGradient",
  "compressedFacePhase",
  "wallSupportAmplitude",
  "humanScaleSupportBoost",
  "rideableWaveSupportBoost",
  "boundedHorizontalDisplacement",
  "groupReal",
  "normalizedGroupEnvelope",
  "horizontalDisplacement",
  "horizontalSlopeBudget",
  "shoreCollapseStart",
  "shoreCollapseEnd",
  "shoreCollapseUnit",
  "shoreCollapseDerivative",
  "rawHeightScale",
  "runupReach",
  "runupPulse",
  "shoreAnchorHeight",
  "shoreBurial",
  "shoreBurialDepth",
  "shoreBurialDerivative",
  "shoreCoverage",
  "washActivation",
  "washWhitewater",
  "shoreDistance = coastalZ - shorelineZ",
  "uBathymetryHeight",
  "uBathymetryXMin",
  "uBathymetryXStep",
  "uBathymetryXCount",
  "uTravelKnots[80]",
  "uBathymetryKnots[80]",
  "bathymetryLowValueV",
  "bathymetryHighDerivativeV",
  "15.0 + (coastalZ + 120.0) / 4.0",
  "30.0 + (coastalZ + 60.0) / 2.0",
  "54.0 + coastalZ + 12.0",
  "for (int index = 0; index < 28; index++)",
]) {
  assert.ok(
    vertex.includes(token),
    `physical ocean vertex contract lost ${token}`,
  );
}
assert.ok(
  vertex.includes(
    "groupCarrierGradient += varianceWeight\n          * vec2(first.a, travel.g)",
  )
    && vertex.includes(
      "groupDerivativeReal -= amplitude\n          * sine\n          * vec2(phaseGradientX, phaseGradientZ)",
    )
    && vertex.includes(
      "groupDerivativeImaginary += amplitude\n          * cosine\n          * vec2(phaseGradientX, phaseGradientZ)",
    ),
  "breaker carrier wavelength no longer matches the packed fixed-profile gameplay sampler",
);
assert.ok(
  vertex.includes(
    "float propagationDepth = max(.08, aggregate.z)",
  )
    && vertex.includes(
      "float breakingDepth = max(.08, bathymetryValue.y)",
    )
    && vertex.includes(
      "/ max(.04, .78 * breakingDepth)",
    )
    && vertex.includes(
      ".78 * breakingDepth / rawSignificantHeight",
    )
    && vertex.includes(
      "tanh(localWaveNumber * propagationDepth)",
    )
    && !vertex.includes(
      "tanh(localWaveNumber * depth)",
    ),
  "propagation and breaking depth responsibilities were recombined",
);
assert.ok(
  breakerHeightHelperStart >= 0
    && breakerHeightHelperEnd > breakerHeightHelperStart
    && !breakerHeightHelper.includes("for (")
    && !breakerHeightHelper.includes("texture2D(")
    && vertex.match(/breakerHeightAtDepth\(/g)?.length === 3
    && vertex.includes(
      "float rawLinearHeight = surfaceHeight",
    )
    && vertex.includes(
      "float rawGroupVariance = groupVariance",
    )
    && vertex.includes(
      "float lowerBreakingHeight = breakerHeightAtDepth(",
    )
    && vertex.includes(
      "float upperBreakingHeight = breakerHeightAtDepth(",
    )
    && vertex.includes(
      "gradientX += heightDerivativeBreakingDepth\n      * bathymetryDerivative.z",
    )
    && vertex.includes(
      "gradientZ += heightDerivativeBreakingDepth\n      * bathymetryDerivative.w",
    ),
  "breaking-depth normal correction no longer uses one O(1) D±epsilon response",
);

for (const token of [
  "createOceanRenderState",
  "createOceanFloatTexture",
  "updateOceanFloatTexture",
  "createAdaptiveOceanGeometry",
  "oceanGeometry",
]) {
  assert.ok(
    source.includes(token)
      && (
        token === "createAdaptiveOceanGeometry"
          || oceanComponent.includes(token)
      ),
    `GPU ocean state contract lost ${token}`,
  );
}

assert.ok(
  fragment.includes(
    "float analyticNormalLengthSquared = dot(",
  )
    && fragment.includes("normalize(vWorldNormal)")
    && fragment.includes("vec3 geometricCross = cross(")
    && fragment.includes("dFdx(vWorldPosition)")
    && fragment.includes("dFdy(vWorldPosition)")
    && fragment.includes(
      "dot(geometricCross, geometricCross) > .00000001",
    )
    && fragment.includes(
      "dot(geometricNormal, analyticNormal) < 0.0",
    )
    && fragment.includes("vec3 surfaceNormal = analyticNormal")
    && fragment.includes(
      "if (analyticNormalLengthSquared <= .00000001)",
    )
    && fragment.includes("surfaceNormal = geometricNormal")
    && !fragment.includes(
      "vec3 surfaceNormal = geometricNormal",
    )
    && !fragment.includes(
      "mix(analyticNormal, geometricNormal",
    ),
  "fragment shading no longer uses the smooth analytic normal with a guarded geometric fallback",
);
assert.ok(
  source.includes("const OCEAN_RUNUP_DEPTH = 100")
    && oceanComponent.includes(
      "position={[0, 0, OCEAN_CENTER_Z + tideShift]}",
    )
    && oceanComponent.includes("side={THREE.DoubleSide}"),
  "the primary ocean mesh no longer covers the curved coast and its buried run-up skirt",
);
assert.ok(
  vertex.includes("3.3 + targetFaceHeight * .36")
    && vertex.includes("float shoreCollapseEnd = -.12")
    && vertex.includes(
      "surfaceOrigin.x * PI * 2.0 / 260.0",
    )
    && vertex.includes("uTime * PI * 2.0 / 32.0")
    && vertex.includes(
      ".32\n      + min(.18, targetFaceHeight * .025)",
    )
    && vertex.includes("1.8 + targetFaceHeight * .52")
    && vertex.includes(
      "float shoreBurialStart = runupReach * .48",
    )
    && vertex.includes(
      "float shoreBurialEnd = runupReach + 1.2",
    )
    && vertex.includes(
      ".48\n      + max(0.0, uTide * .3)\n      + runupPulseAmplitude",
    )
    && vertex.includes(
      "p.xy = position.xy\n      + (p.xy - position.xy) * rawHeightScale",
    )
    && vertex.includes(
      "p.z = rawShoreHeight * rawHeightScale",
    ),
  "GPU shore transition no longer mirrors applyOceanShoreTransition",
);
assert.ok(
  !vertex.includes("profileDeltaX")
    && !vertex.includes(
      "profileDeltaX * profileDeltaX",
    )
    && !vertex.includes("slowRunupPhase")
    && !vertex.includes("swashTravelPhase"),
  "the shader reintroduced a profile-center Taylor approximation or independent run-up phase",
);
for (const [opening, closing] of [
  ["(", ")"],
  ["{", "}"],
  ["[", "]"],
]) {
  assert.equal(
    [...vertex].filter((character) => character === opening).length,
    [...vertex].filter((character) => character === closing).length,
    `ocean vertex shader has unbalanced ${opening}${closing} delimiters`,
  );
}
assert.ok(
  !vertex.includes("discard")
    && !fragment.includes("discard")
    && !wetSandFragment.includes("discard")
    && !source.includes("OCEAN_SUBSURFACE_FRAGMENT")
    && !oceanComponent.includes("subsurface"),
  "the ocean regained a hard shoreline cutout or duplicate underside mesh",
);
assert.ok(
  source.includes("function createWetSandGeometry(")
    && source.includes(
      "shorelineReferenceAt(coastId, zoneName, worldX)",
    )
    && source.includes('"aShoreDistance"')
    && source.includes(
      "const seawardWorldZ = shorelineWorldZ + .12",
    )
    && source.includes(
      "position={[0, -.34, tideShift]}",
    ),
  "wet sand no longer follows the same curved shoreline as the ocean",
);
for (const token of [
  "vShoreDistance",
  "vShoreCollapse",
  "vShoreCoverage",
  "vShoreBurial",
  "vRunupPulse",
  "vRunupReach",
  "softSwashFront",
  "movingSwashCoverage",
  "swashFoamCenter",
  "swashFrontLace",
  "swashFoam",
  "uShoreColor",
  "wetSandMatch",
]) {
  assert.ok(
    fragment.includes(token),
    `soft shoreline shading lost ${token}`,
  );
}
for (const token of [
  "softSwashFront",
  "movingSwashCoverage",
  "wetSandSwashLace",
  "wetSandSwashFoam",
  "world.x * .018 + uTime * .006",
  "runupReach\n      * mix(.48, 1.0, swashAdvance)",
]) {
  assert.ok(
    wetSandFragment.includes(token),
    `wet-sand swash response lost ${token}`,
  );
}
assert.ok(
  fragment.includes(
    "max(max(crestFoam, breakerFoam), swashFoam)",
  )
    && fragment.includes(
      "abs(vShoreDistance - swashFoamCenter)",
    )
    && wetSandFragment.includes(
      "color,\n      wetSandFoamColor,\n      wetSandSwashFoam * .86",
    )
    && wetSandSurface.includes(
      "fragmentShader={WET_SAND_FRAGMENT}",
    )
    && !wetSandSurface.includes("<meshStandardMaterial")
    && !fragment.includes("* 0.0")
    && !fragment.includes("shoreFoam = smoothstep")
    && !fragment.includes("gl_FragColor = vec4(color, 0."),
  "shoreline intersection regained a fixed comb, hard alpha edge, or lost moving wash",
);
assert.ok(
  !vertex.includes("crestEnergy("),
  "fixed repeating crest sequence returned to the ocean shader",
);
assert.ok(
  !vertex.includes("travelingSetEnergy("),
  "fixed repeating set envelope returned to the ocean shader",
);
assert.ok(
  !vertex.includes("pow(max(0.0, primary), 5.0)"),
  "mountain-shaped crest spike returned to the ocean shader",
);
assert.ok(
  !vertex.includes("smoothstep(-5.0, 1.0, contourCoordinate)")
    && !vertex.includes("smoothstep(-18.0")
    && !vertex.includes("smoothstep(.15, 1.8, contourCoordinate)"),
  "the ocean mesh is being flattened before broken waves reach the shoreline",
);
assert.ok(
  !vertex.includes("gerstner("),
  "the visual ocean diverged into a separate Gerstner model",
);
assert.ok(
  !source.includes("<LineupWaveSetVolume"),
  "the detached lineup ribbon was layered back over the ocean mesh",
);
assert.ok(
  !source.includes("<BreakingWave"),
  "the detached board-level ribbon was layered back over the ocean mesh",
);
assert.ok(
  !source.includes("<PaddleOutShorebreak"),
  "the player-local paddle-out ribbon was layered back over the ocean mesh",
);

console.log("ocean shader contract verified");
