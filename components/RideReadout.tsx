import { memo } from "react";
import type { GameStats } from "@/lib/game";

/** A line-reading aid. Detailed body/force telemetry stays in the surf computer. */
function RideReadout({ stats }: { stats: GameStats }) {
  const face = Math.max(0, Math.min(1, (stats.facePosition + 1) * .5));
  const pocket = Math.max(0, Math.min(1, (stats.linePosition + 1.5) / 3));
  const cue = stats.maneuverAirborne
    ? "Spot the landing. Bring the board around."
    : stats.trickCharge > .15
      ? stats.lipLaunchSupport > .35 ? "Release at the lip." : "Stay low. Aim up the face."
      : stats.barrelIntensity > .2 ? "Stay compact. Hold your line."
        : stats.linePosition > .55 ? "Cut back toward the breaking section."
          : stats.whitewaterPressure > .5 ? "Turn toward the open shoulder."
            : stats.facePosition < -.45 ? "Bank up the face to set your next turn."
              : "Climb, then drop. Let the wave build your speed.";
  return (
    <div className="ride-readout" aria-label="Surf line guide">
      <div className="ride-readout-heading"><span>YOUR LINE</span><strong>{stats.rideChain >= 2 ? `${stats.rideChain} MOVE CHAIN` : stats.pumpRhythm > .5 ? "IN RHYTHM" : "MAKE IT FLOW"}</strong></div>
      <div className="ride-readout-tracks">
        <div><span>FACE</span><i role="meter" aria-label="Position on wave face" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(face * 100)}><b style={{ left: `${face * 100}%` }} /></i><small>HIGH</small></div>
        <div><span>POCKET</span><i className="pocket-track" role="meter" aria-label="Position along wave" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pocket * 100)}><b style={{ left: `${pocket * 100}%` }} /></i><small>OPEN</small></div>
      </div>
      <p>{cue}</p>
    </div>
  );
}

export default memo(RideReadout);
