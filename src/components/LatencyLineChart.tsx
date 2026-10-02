import React from 'react';
import { TurnMetric } from '../types';

interface LatencyLineChartProps {
  metrics: TurnMetric[];
}

export const LatencyLineChart: React.FC<LatencyLineChartProps> = ({ metrics }) => {
  const points = metrics
    .filter((m) => m.voice_to_voice_ms && m.voice_to_voice_ms > 0)
    .map((m) => ({ turn: m.turn_index, ms: m.voice_to_voice_ms! }));

  if (points.length === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-neutral-400 bg-neutral-50 rounded-lg border border-neutral-200">
        No per-turn voice-to-voice metrics recorded for this session.
      </div>
    );
  }

  const width = 600;
  const height = 180;
  const padX = 40;
  const padY = 25;

  const maxVal = Math.max(...points.map((p) => p.ms), 1000);
  const minVal = Math.min(...points.map((p) => p.ms), 400);
  const range = maxVal - minVal || 1;

  const coords = points.map((p, idx) => {
    const x = padX + (idx / Math.max(1, points.length - 1)) * (width - 2 * padX);
    const y = height - padY - ((p.ms - minVal) / range) * (height - 2 * padY);
    return { x, y, ...p };
  });

  const pathD = coords.reduce(
    (acc, pt, idx) => (idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`),
    ''
  );

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-44 text-neutral-600 select-none"
      >
        {/* Horizontal grid lines */}
        <line x1={padX} y1={padY} x2={width - padX} y2={padY} stroke="#e5e5e5" strokeDasharray="3 3" />
        <line x1={padX} y1={height / 2} x2={width - padX} y2={height / 2} stroke="#e5e5e5" strokeDasharray="3 3" />
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#d4d4d4" />

        {/* Y-axis labels */}
        <text x={padX - 8} y={padY + 4} textAnchor="end" className="text-[10px] font-mono fill-neutral-400">
          {maxVal}ms
        </text>
        <text x={padX - 8} y={height / 2 + 3} textAnchor="end" className="text-[10px] font-mono fill-neutral-400">
          {Math.round((maxVal + minVal) / 2)}ms
        </text>
        <text x={padX - 8} y={height - padY + 4} textAnchor="end" className="text-[10px] font-mono fill-neutral-400">
          {minVal}ms
        </text>

        {/* Path line */}
        <path d={pathD} fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Data points */}
        {coords.map((pt) => (
          <g key={pt.turn}>
            <circle cx={pt.x} cy={pt.y} r="4" fill="#059669" stroke="#ffffff" strokeWidth="2" />
            <text
              x={pt.x}
              y={pt.y - 8}
              textAnchor="middle"
              className="text-[10px] font-mono font-medium fill-neutral-700 tabular-nums"
            >
              {pt.ms}ms
            </text>
            <text
              x={pt.x}
              y={height - padY + 14}
              textAnchor="middle"
              className="text-[10px] font-mono fill-neutral-400"
            >
              Turn {pt.turn}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};
