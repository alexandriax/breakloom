import assert from "node:assert/strict";
import { BEACHES } from "../lib/beaches.ts";
import {
  BATHYMETRY_PROFILES,
  BATHYMETRY_ZONE_OVERRIDES,
  bathymetryClassFor,
  bathymetryContourCoordinateAt,
  bathymetryContourGradientAt,
  bathymetryCoverage,
  bathymetryDepthAt,
  bathymetryGradientAt,
  breakerTypeHintAt,
  shorelineReferenceAt,
} from "../lib/bathymetry.ts";

const nearlyEqual = (a, b, tolerance, label) => {
  assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} != ${b} (±${tolerance})`);
};

const allZoneKeys = new Set;
for (const beach of BEACHES) {
  assert.ok(BATHYMETRY_PROFILES[beach.id], `${beach.id} has no bathymetry profile`);
  assert.equal(bathymetryClassFor(beach.id), BATHYMETRY_PROFILES[beach.id].class);

  for (const zone of beach.zones) {
    const key = `${beach.id}:${zone.name}`;
    allZoneKeys.add(key);
    assert.ok(BATHYMETRY_ZONE_OVERRIDES[key], `${key} has no zone override`);

    for (let x = -320; x <= 320; x += 32) {
      const shoreline = shorelineReferenceAt(beach.id, zone.name, x);
      assert.ok(Number.isFinite(shoreline), `${key} shoreline is not finite at x=${x}`);

      let previous = bathymetryDepthAt(beach.id, zone.name, x, shoreline);
      assert.ok(previous >= .32, `${key} is not positive at the shoreline`);
      for (let offshore = 2; offshore <= 520; offshore += 2) {
        const z = shoreline - offshore;
        const depth = bathymetryDepthAt(beach.id, zone.name, x, z);
        assert.ok(Number.isFinite(depth), `${key} depth is not finite at ${x},${z}`);
        assert.ok(depth >= .32, `${key} depth is not positive at ${x},${z}`);
        // Features can shoal locally, but never form an implausible vertical
        // step between neighboring 2 m samples (even the slab is smoothed).
        assert.ok(Math.abs(depth - previous) < 3, `${key} discontinuity at ${x},${z}`);
        previous = depth;
      }
    }

    // Compare the exported gradient against an independent, finer numerical
    // derivative rather than merely repeating its own sample radius.
    for (const [x, offshore] of [[-123, 23], [-51, 61], [0, 88], [77, 137], [181, 231]]) {
      const shoreline = shorelineReferenceAt(beach.id, zone.name, x);
      const z = shoreline - offshore;
      const gradient = bathymetryGradientAt(beach.id, zone.name, x, z);
      const epsilon = .05;
      const dx = (
        bathymetryDepthAt(beach.id, zone.name, x + epsilon, z)
        - bathymetryDepthAt(beach.id, zone.name, x - epsilon, z)
      ) / (epsilon * 2);
      const dz = (
        bathymetryDepthAt(beach.id, zone.name, x, z + epsilon)
        - bathymetryDepthAt(beach.id, zone.name, x, z - epsilon)
      ) / (epsilon * 2);
      nearlyEqual(gradient.x, dx, .008, `${key} gradient x at ${x},${z}`);
      nearlyEqual(gradient.z, dz, .008, `${key} gradient z at ${x},${z}`);
      nearlyEqual(gradient.magnitude, Math.hypot(gradient.x, gradient.z), 1e-10, `${key} magnitude`);

      const contourGradient = bathymetryContourGradientAt(beach.id, zone.name, x, z);
      const contourDx = (
        bathymetryContourCoordinateAt(beach.id, zone.name, x + epsilon, z)
        - bathymetryContourCoordinateAt(beach.id, zone.name, x - epsilon, z)
      ) / (epsilon * 2);
      const contourDz = (
        bathymetryContourCoordinateAt(beach.id, zone.name, x, z + epsilon)
        - bathymetryContourCoordinateAt(beach.id, zone.name, x, z - epsilon)
      ) / (epsilon * 2);
      nearlyEqual(contourGradient.x, contourDx, .008, `${key} contour gradient x`);
      nearlyEqual(contourGradient.z, contourDz, .008, `${key} contour gradient z`);
    }

    const hint = breakerTypeHintAt(beach.id, zone.name, 0, -65);
    nearlyEqual(
      hint.spilling + hint.plunging + hint.collapsing + hint.surging,
      1,
      1e-10,
      `${key} normalized breaker weights`,
    );
  }
}

assert.equal(BEACHES.length, 13, "expected all 13 playable coasts");
assert.equal(allZoneKeys.size, 41, "expected all 41 playable zones");
assert.deepEqual(
  new Set(Object.keys(BATHYMETRY_ZONE_OVERRIDES)),
  allZoneKeys,
  "zone override table has missing or stale entries",
);
assert.ok(bathymetryCoverage(BEACHES).every((coast) => coast.zones.every((zone) => zone.hasOverride)));

// Beach-break bars and channels: bars are shallower than their surroundings,
// while a channel is deeper than the adjacent bank at the same offshore range.
for (const coastId of ["rockaway", "hossegor"]) {
  const profile = BATHYMETRY_PROFILES[coastId];
  const zone = BEACHES.find((beach) => beach.id === coastId).zones[0].name;
  const barDepth = bathymetryDepthAt(coastId, zone, profile.channelSpacing * .5, -profile.outerBarOffshore);
  const outsideDepth = bathymetryDepthAt(coastId, zone, profile.channelSpacing * .5, -profile.outerBarOffshore - 28);
  assert.ok(barDepth < outsideDepth, `${coastId} outer bank does not shoal`);
  const channelTransect = Array.from({ length: 49 }, (_, index) => {
    const x = -profile.channelSpacing + index * profile.channelSpacing / 24;
    return bathymetryDepthAt(coastId, zone, x, -profile.channelOffshore);
  });
  const channel = Math.max(...channelTransect);
  const bank = Math.min(...channelTransect);
  assert.ok(channel > bank + .35, `${coastId} channel is not distinct from bank`);
}

// Reef shelves must contain a measurable ledge; the slab must be substantially
// more abrupt than a performance reef.
for (const coastId of ["pipeline", "uluwatu", "trestles", "cloudbreak", "mavericks"]) {
  const p = BATHYMETRY_PROFILES[coastId];
  const zone = BEACHES.find((beach) => beach.id === coastId).zones[0].name;
  const inside = bathymetryDepthAt(coastId, zone, 0, -(p.ledgeOffshore - p.ledgeWidth * 1.4));
  const outside = bathymetryDepthAt(coastId, zone, 0, -(p.ledgeOffshore + p.ledgeWidth * 1.4));
  assert.ok(outside > inside + .75, `${coastId} reef shelf lacks a distinct offshore ledge`);
}
const slab = BATHYMETRY_PROFILES.teahupoo;
const teahupooGradient = bathymetryGradientAt("teahupoo", "The Bowl", 0, -slab.ledgeOffshore).magnitude;
const trestles = BATHYMETRY_PROFILES.trestles;
const trestlesGradient = bathymetryGradientAt("trestles", "Lowers", 0, -trestles.ledgeOffshore).magnitude;
assert.ok(teahupooGradient > trestlesGradient * 1.7, "Teahupoo slab is not distinctly abrupt");
assert.equal(breakerTypeHintAt("teahupoo", "The Bowl", 0, -slab.ledgeOffshore).primary, "plunging");

// Point breaks expose curved contour/shoreline geometry, with opposite-handed
// profiles still producing a meaningful alongshore displacement.
for (const coastId of ["jeffreys-bay", "snapper-rocks", "raglan", "chicama"]) {
  const zone = BEACHES.find((beach) => beach.id === coastId).zones[1].name;
  const shorelineTransect = Array.from(
    { length: 33 },
    (_, index) => shorelineReferenceAt(coastId, zone, -240 + index * 15),
  );
  assert.ok(
    Math.max(...shorelineTransect) - Math.min(...shorelineTransect) > 3,
    `${coastId} point contours are effectively straight`,
  );
  const phaseTransect = [-130, -65, 0, 65, 130]
    .map((x) => bathymetryContourCoordinateAt(coastId, zone, x, -90));
  assert.ok(
    Math.max(...phaseTransect) - Math.min(...phaseTransect) > 3,
    `${coastId} curved bathymetry is absent from its phase coordinate`,
  );
}

// Nazaré's canyon is deeper on axis than its flanks at equal offshore distance,
// while the sheltered South Beach override strongly reduces that focusing cut.
const nazareOffshore = 105;
const nazareCenter = bathymetryDepthAt("nazare", "Praia do Norte", 0, -nazareOffshore);
const nazareFlank = bathymetryDepthAt("nazare", "Praia do Norte", 130, -nazareOffshore);
assert.ok(nazareCenter > nazareFlank + 7, "Nazaré canyon does not form a deep focusing axis");
const southCenter = bathymetryDepthAt("nazare", "South Beach", 0, -nazareOffshore);
assert.ok(nazareCenter > southCenter + 8, "South Beach is not sheltered from the main canyon cut");
const nazarePhaseCenter = bathymetryContourCoordinateAt("nazare", "Praia do Norte", 0, -nazareOffshore);
const nazarePhaseFlank = bathymetryContourCoordinateAt("nazare", "Praia do Norte", 130, -nazareOffshore);
assert.ok(
  Math.abs(nazarePhaseCenter - nazarePhaseFlank) > 9,
  "Nazaré canyon focusing is absent from its phase coordinate",
);

// Reef relief/channels also bend the compact phase coordinate at the ledge.
const pipelinePhase = [-130, -65, 0, 65, 130]
  .map((x) => bathymetryContourCoordinateAt("pipeline", "First Reef", x, -59));
assert.ok(
  Math.max(...pipelinePhase) - Math.min(...pipelinePhase) > 3,
  "Pipeline reef detail is absent from its phase coordinate",
);

console.log(
  `Bathymetry verified: ${BEACHES.length} coasts, ${allZoneKeys.size} zones, `
  + `${Object.keys(BATHYMETRY_PROFILES).length} deterministic profiles.`,
);
