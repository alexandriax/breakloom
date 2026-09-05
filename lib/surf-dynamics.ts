/** Small, engine-independent hydrodynamic operators. Units are metres/seconds. */
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export type RailTurnSample = {
  velocityX: number;
  velocityZ: number;
  currentX: number;
  currentZ: number;
  headingDelta: number;
  deltaSeconds: number;
  grip: number;
  planing: number;
  waterContact: number;
  whitewater: number;
};

/**
 * Rail/fin lift redirects momentum; drag dissipates it in the hull solver.
 * An exact rotation keeps lift perpendicular to water-relative velocity, so
 * carving cannot manufacture speed (as Euler-integrated centripetal force can).
 * Released fins and an airborne hull retain their trajectory while yawing.
 */
export function redirectRailMomentum(sample: RailTurnSample) {
  const relativeX = sample.velocityX - sample.currentX;
  const relativeZ = sample.velocityZ - sample.currentZ;
  const speed = Math.hypot(relativeX, relativeZ);
  const delta = Math.max(0, Math.min(.05, sample.deltaSeconds));
  const attachment = clamp01(sample.grip)
    * clamp01(sample.planing)
    * clamp01(sample.waterContact)
    * (1 - clamp01(sample.whitewater) * .65);
  // Finite lateral loading: even full rail cannot pivot a fast hull in place.
  const maximumAngle = 9.81 * 1.15 * delta / Math.max(1, speed);
  const angle = Math.max(-maximumAngle, Math.min(maximumAngle,
    sample.headingDelta * attachment));
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const velocityX = sample.currentX + relativeX * cosine + relativeZ * sine;
  const velocityZ = sample.currentZ + relativeZ * cosine - relativeX * sine;
  return {
    velocityX,
    velocityZ,
    accelerationX: delta > 0 ? (velocityX - sample.velocityX) / delta : 0,
    accelerationZ: delta > 0 ? (velocityZ - sample.velocityZ) / delta : 0,
  };
}
