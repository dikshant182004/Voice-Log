import React from 'react';
import { StepMetricStats } from '../types';

interface LatencyBarsProps {
  stt: StepMetricStats;
  llm: StepMetricStats;
  tts: StepMetricStats;
  v2v: StepMetricStats;
}

export const LatencyBars: React.FC<LatencyBarsProps> = ({ stt, llm, tts, v2v }) => {
  const steps = [
    { label: 'Voice-to-Voice (E2E)', stat: v2v, color: 'bg-emerald-600', text: 'text-emerald-700' },
    { label: 'Deepgram STT (Nova-3 General)', stat: stt, color: 'bg-sky-600', text: 'text-sky-700' },
    { label: 'Groq LLM TTFB (gpt-oss-20b)', stat: llm, color: 'bg-amber-600', text: 'text-amber-700' },
    { label: 'Cartesia TTS TTFB (Sonic 3.6)', stat: tts, color: 'bg-indigo-600', text: 'text-indigo-700' },
  ];

  const maxMs = Math.max(v2v.p95_ms || 1000, 1000);

  return (
    <div className="space-y-4">
      {steps.map((step) => {
        const sampleSize = step.stat.sample_size ?? 0;
        const hasEnoughData = sampleSize >= 3 && step.stat.p50_ms !== null;
        const p50 = hasEnoughData ? step.stat.p50_ms! : 0;
        const p95 = hasEnoughData ? (step.stat.p95_ms ?? p50) : 0;
        const p50Width = hasEnoughData ? Math.min(100, Math.max(4, (p50 / maxMs) * 100)) : 0;
        const p95Width = hasEnoughData ? Math.min(100, Math.max(4, (p95 / maxMs) * 100)) : 0;

        return (
          <div key={step.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium text-neutral-800">{step.label}</span>
                {sampleSize > 0 ? (
                  <span className="text-[10px] text-neutral-400 font-mono">
                    (based on {sampleSize} turn{sampleSize === 1 ? '' : 's'})
                  </span>
                ) : null}
              </div>
              <div className="font-mono tabular-nums text-neutral-500 space-x-3">
                {hasEnoughData ? (
                  <>
                    <span>p50: <strong className="text-neutral-900">{p50}ms</strong></span>
                    <span>·</span>
                    <span>p95: <strong className="text-neutral-900">{p95}ms</strong></span>
                  </>
                ) : (
                  <span className="text-[11px] text-neutral-400 italic">
                    {sampleSize > 0 ? `Insufficient sample (${sampleSize} turns, need ≥ 3)` : 'No turns'}
                  </span>
                )}
              </div>
            </div>

            {/* Visual Bar Container */}
            <div className="relative h-5 w-full bg-neutral-100 rounded-md overflow-hidden">
              {hasEnoughData ? (
                <>
                  {/* p95 range bar */}
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-neutral-200/80 transition-all duration-300"
                    style={{ width: `${p95Width}%` }}
                    title={`p95: ${p95}ms`}
                  />
                  {/* p50 solid bar */}
                  <div
                    className={`absolute top-0 bottom-0 left-0 ${step.color} transition-all duration-300 rounded-sm`}
                    style={{ width: `${p50Width}%` }}
                    title={`p50: ${p50}ms`}
                  />
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-[10px] text-neutral-400 italic">
                  Insufficient data to compute percentiles
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div className="pt-2 flex items-center justify-between text-[11px] text-neutral-400 font-mono">
        <span>0 ms</span>
        <span>{Math.round(maxMs / 2)} ms</span>
        <span>{maxMs} ms scale</span>
      </div>
    </div>
  );
};
