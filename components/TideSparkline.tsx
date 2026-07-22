"use client";

import type { TidePoint } from "@/lib/marine";

type TideSparklineProps = {
  points: TidePoint[];
  observedAt: string;
};

export default function TideSparkline({ points, observedAt }: TideSparklineProps) {
  const target = new Date(observedAt).getTime();
  const local = points
    .filter((point) => Math.abs(new Date(point.time).getTime() - target) < 9 * 3_600_000)
    .slice(0, 18);
  const values = local.length > 1 ? local.map((point) => point.value) : [0, 0.1, 0.4, 0.2, -0.1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.01, max - min);
  const coordinates = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * 100;
      const y = 28 - ((value - min) / range) * 23;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const currentIndex = Math.max(
    0,
    local.findIndex((point) => new Date(point.time).getTime() >= target),
  );
  const currentX = (currentIndex / Math.max(1, values.length - 1)) * 100;

  return (
    <svg className="tide-sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" aria-label="Tide curve">
      <defs>
        <linearGradient id="tide-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#73e6e1" stopOpacity=".42" />
          <stop offset="1" stopColor="#73e6e1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,32 ${coordinates} 100,32`} fill="url(#tide-fill)" />
      <polyline points={coordinates} fill="none" stroke="#95fff4" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      <line x1={currentX} x2={currentX} y1="3" y2="31" stroke="#fff" strokeOpacity=".65" strokeWidth=".7" />
      <circle cx={currentX} cy="11" r="1.9" fill="#fff" />
    </svg>
  );
}

