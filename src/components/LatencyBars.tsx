import React from 'react';
import { StepMetricStats } from '../types';

interface LatencyBarsProps {
  stt: StepMetricStats;
  llm: StepMetricStats;
  tts: StepMetricStats;
  v2v: StepMetricStats;
}

export const LatencyBars: React.FC<LatencyBarsProps> = ({ stt, llm, tts, v2v }) => {
  const maxMs = Math.max(v2v.p95_ms || 1000, 1000);

  const steps = [
    { label: 'Voice-to-Voice (E2E)', p50: v2v.p50_ms || 0, p95: v2v.p95_ms || 0, color: 'bg-emerald-600', text: 'text-emerald-700' },
    { label: 'Deepgram STT (Nova-3)', p50: stt.p50_ms || 0, p95: stt.p95_ms || 0, color: 'bg-sky-600', text: 'text-sky-700' },
    { label: 'Groq LLM TTFB (Llama 3.3)', p50: llm.p50_ms || 0, p95: llm.p95_ms || 0, color: 'bg-amber-600', text: 'text-amber-700' },
    { label: 'Cartesia TTS TTFB (Sonic)', p50: tts.p50_ms || 0, p95: tts.p95_ms || 0, color: 'bg-indigo-600', text: 'text-indigo-700' },
  ];

  return (
    <div className="space-y-4">
      {steps.map((step) => {
        const p50Width = Math.min(100, Math.max(4, (step.p50 / maxMs) * 100));
        const p95Width = Math.min(100, Math.max(4, (step.p95 / maxMs) * 100));

        return (
          <div key={step.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-neutral-800">{step.label}</span>
              <div className="font-mono tabular-nums text-neutral-500 space-x-3">
                <span>p50: <strong className="text-neutral-900">{step.p50}ms</strong></span>
                <span>·</span>
                <span>p95: <strong className="text-neutral-900">{step.p95}ms</strong></span>
              </div>
            </div>

            {/* Visual Bar Container */}
            <div className="relative h-5 w-full bg-neutral-100 rounded-md overflow-hidden">
              {/* p95 range bar */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-neutral-200/80 transition-all duration-300"
                style={{ width: `${p95Width}%` }}
                title={`p95: ${step.p95}ms`}
              />
              {/* p50 solid bar */}
              <div
                className={`absolute top-0 bottom-0 left-0 ${step.color} transition-all duration-300 rounded-sm`}
                style={{ width: `${p50Width}%` }}
                title={`p50: ${step.p50}ms`}
              />
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
