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
  "travel.r",
  "first.g * uTime",
  "vWorldNormal",
  "uBreakerPower",
  "uBreakerSteepness",
  "uBreakerHollow",
  "breakerShapeDerivative",
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
]) {
  assert.ok(
    oceanComponent.includes(token),
    `GPU ocean state contract lost ${token}`,
  );
}

assert.ok(
  fragment.includes("normalize(vWorldNormal)"),
  "fragment shading no longer uses the displaced surface normal",
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
  !vertex.includes("gerstner("),
  "the visual ocean diverged into a separate Gerstner model",
);

console.log("ocean shader contract verified");
