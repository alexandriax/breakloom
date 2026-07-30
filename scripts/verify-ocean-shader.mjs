import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../components/SurfScene.tsx", import.meta.url),
  "utf8",
);
const vertexStart = source.indexOf("const OCEAN_VERTEX");
const fragmentStart = source.indexOf("const OCEAN_FRAGMENT", vertexStart);
const subsurfaceStart = source.indexOf(
  "const OCEAN_SUBSURFACE_FRAGMENT",
  fragmentStart,
);

assert.ok(vertexStart >= 0, "ocean vertex shader is missing");
assert.ok(fragmentStart > vertexStart, "ocean fragment shader is missing");
assert.ok(
  subsurfaceStart > fragmentStart,
  "ocean subsurface shader is missing",
);

const vertex = source.slice(vertexStart, fragmentStart);
const fragment = source.slice(fragmentStart, subsurfaceStart);
const oceanComponent = source.slice(
  source.indexOf("function Ocean("),
  source.indexOf("const LINEUP_CREST_VERTEX"),
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
  "horizontalShoreAnchor",
  "runupReach",
  "swashFilmHeight",
  "vShoreMask",
  "washActivation",
  "washWhitewater",
  "for (int index = 0; index < 28; index++)",
]) {
  assert.ok(
    vertex.includes(token),
    `physical ocean vertex contract lost ${token}`,
  );
}

for (const token of [
  "createOceanRenderState",
  "createOceanFloatTexture",
  "updateOceanFloatTexture",
  "createAdaptiveOceanGeometry",
  "oceanGeometry",
  "subsurfaceGeometry",
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
  fragment.includes("normalize(vWorldNormal)")
    && fragment.includes("cross(dFdx(vWorldPosition), dFdy(vWorldPosition))")
    && fragment.includes("mix(analyticNormal, geometricNormal, .34)"),
  "fragment shading no longer combines analytic water normals with the displaced mesh silhouette",
);
assert.ok(
  source.includes("const OCEAN_RUNUP_DEPTH = 12")
    && fragment.includes("if (vShoreMask < .035) discard")
    && source.slice(subsurfaceStart).includes(
      "if (vShoreMask < .08) discard",
    ),
  "shore swash no longer extends over wet sand and clips as a thin moving film",
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
