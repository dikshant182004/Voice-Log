import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Award, AlertCircle, RefreshCw, Clock } from 'lucide-react';
import { CallDetailResponse } from '../types';
import { apiClient, HttpError, NetworkError, ConfigurationError } from '../api/client';
import { LatencyLineChart } from '../components/LatencyLineChart';

interface CallDetailPageProps {
  callId: string;
  onBack: () => void;
}

export const CallDetailPage: React.FC<CallDetailPageProps> = ({ callId, onBack }) => {
  const [data, setData] = useState<CallDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchDetail = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setIsLoading(true);
      setErrorMessage(null);

      // Retry loop: allows Cloudflare D1 write transaction & judge to commit
      let attempts = 0;
      let res: CallDetailResponse | null = null;
      while (attempts < 4) {
        try {
          res = await apiClient.getCall(callId, controller.signal);
          break;
        } catch (fetchErr: any) {
          if (fetchErr instanceof HttpError && fetchErr.status === 404 && attempts < 3) {
            attempts++;
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          throw fetchErr;
        }
      }
      setData(res);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'CanceledError') return;
      if (err instanceof ConfigurationError) {
        setErrorMessage(err.message);
      } else if (err instanceof HttpError) {
        setErrorMessage(`Server error ${err.status}: ${err.message}${err.requestId ? ` (Request ID: ${err.requestId})` : ''}`);
      } else if (err instanceof NetworkError) {
        setErrorMessage(`Failed to reach Cloudflare Worker: ${err.message}`);
      } else {
        setErrorMessage(err.message || 'Failed to retrieve call detail');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [callId]);

  if (isLoading) {
    return (
      <div className="p-12 text-center space-y-3 bg-white border border-neutral-200 rounded-xl">
        <RefreshCw className="w-6 h-6 animate-spin text-neutral-400 mx-auto" />
        <p className="text-xs text-neutral-500">Retrieving call record and transcript from Cloudflare D1...</p>
      </div>
    );
  }

  if (errorMessage || !data) {
    return (
      <div className="p-12 text-center space-y-3 bg-white border border-neutral-200 rounded-xl">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <h3 className="text-sm font-semibold text-neutral-900">Unable to load call record</h3>
        <p className="text-xs text-neutral-500 max-w-md mx-auto">{errorMessage || 'Call not found'}</p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => fetchDetail()}
            className="px-3.5 py-1.5 text-xs text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
          >
            Retry
          </button>
          <button
            onClick={onBack}
            className="px-3.5 py-1.5 text-xs text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg transition-colors"
          >
            Back to Calls
          </button>
        </div>
      </div>
    );
  }

  const { call, transcript, metrics, aggregate_metrics, eval: evaluation } = data;

  const formatMs = (val?: number | null) => (val !== null && val !== undefined ? `${val}ms` : '—');

  return (
    <div className="space-y-8">
      {/* Back button & Title header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-neutral-200">
        <div className="space-y-1">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to all calls</span>
          </button>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900 flex items-center gap-3">
            <span className="font-mono">{call.id}</span>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded ${
                call.status === 'completed'
                  ? 'bg-emerald-50 text-emerald-700'
                  : call.status === 'error'
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {call.status}
            </span>
          </h1>

          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 pt-1">
            <span>Started: {new Date(call.started_at).toLocaleTimeString()}</span>
            <span aria-hidden="true">·</span>
            <span>Duration: <strong className="font-mono text-neutral-800">{Math.round(call.duration_ms / 1000)}s</strong></span>
            <span aria-hidden="true">·</span>
            <span>Turns: <strong className="font-mono text-neutral-800">{call.turn_count}</strong></span>
            <span aria-hidden="true">·</span>
            <span>End Reason: {call.end_reason || 'user_hangup'}</span>
          </div>
        </div>

        {/* Model Pipeline Spec */}
        <div className="bg-neutral-50 p-3 rounded-lg border border-neutral-200 text-xs space-y-1 font-mono">
          <div className="text-neutral-500">Pipeline Configuration:</div>
          <div className="text-neutral-800">STT: <strong>{call.config.stt}</strong></div>
          <div className="text-neutral-800">LLM: <strong>{call.config.llm}</strong></div>
          <div className="text-neutral-800">TTS: <strong>{call.config.tts}</strong></div>
        </div>
      </div>

      {/* Latency KPI Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-neutral-200 p-4 rounded-xl shadow-xs">
          <span className="text-xs font-medium text-neutral-500">Voice-to-Voice (p50)</span>
          <div className="text-2xl font-bold font-mono tabular-nums text-neutral-900 mt-1">
            {formatMs(aggregate_metrics.voice_to_voice.p50_ms)}
          </div>
          <span className="text-[11px] text-neutral-400 font-mono">p95: {formatMs(aggregate_metrics.voice_to_voice.p95_ms)}</span>
        </div>

        <div className="bg-white border border-neutral-200 p-4 rounded-xl shadow-xs">
          <span className="text-xs font-medium text-neutral-500">STT (p50)</span>
          <div className="text-2xl font-bold font-mono tabular-nums text-neutral-900 mt-1">
            {formatMs(aggregate_metrics.stt.p50_ms)}
          </div>
          <span className="text-[11px] text-neutral-400 font-mono">p95: {formatMs(aggregate_metrics.stt.p95_ms)}</span>
        </div>

        <div className="bg-white border border-neutral-200 p-4 rounded-xl shadow-xs">
          <span className="text-xs font-medium text-neutral-500">LLM TTFB (p50)</span>
          <div className="text-2xl font-bold font-mono tabular-nums text-neutral-900 mt-1">
            {formatMs(aggregate_metrics.llm_ttfb.p50_ms)}
          </div>
          <span className="text-[11px] text-neutral-400 font-mono">p95: {formatMs(aggregate_metrics.llm_ttfb.p95_ms)}</span>
        </div>

        <div className="bg-white border border-neutral-200 p-4 rounded-xl shadow-xs">
          <span className="text-xs font-medium text-neutral-500">TTS TTFB (p50)</span>
          <div className="text-2xl font-bold font-mono tabular-nums text-neutral-900 mt-1">
            {formatMs(aggregate_metrics.tts_ttfb.p50_ms)}
          </div>
          <span className="text-[11px] text-neutral-400 font-mono">p95: {formatMs(aggregate_metrics.tts_ttfb.p95_ms)}</span>
        </div>
      </div>

      {/* Post-Call LLM Evaluation Card */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-neutral-700" />
            <h2 className="text-sm font-semibold text-neutral-900">Post-Call Evaluation (LLM Judge)</h2>
          </div>
          {evaluation ? (
            <span className="text-xs font-medium text-neutral-500">
              Evaluated by <strong className="font-mono text-neutral-700">{evaluation.judge_model}</strong>
            </span>
          ) : (
            <span className="text-xs text-neutral-400 font-medium">Evaluation pending</span>
          )}
        </div>

        {evaluation ? (
          <div className="space-y-4">
            <div>
              <span className="text-xs text-neutral-400 font-medium uppercase tracking-wider">Summary</span>
              <p className="text-sm text-neutral-800 mt-1 leading-relaxed">{evaluation.summary}</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="bg-neutral-50 p-2.5 rounded-lg border border-neutral-200">
                <span className="text-[11px] text-neutral-500">Task Completion</span>
                <div className="text-lg font-bold font-mono text-neutral-900">
                  {evaluation.scores.task_completion} / 5
                </div>
              </div>

              <div className="bg-neutral-50 p-2.5 rounded-lg border border-neutral-200">
                <span className="text-[11px] text-neutral-500">Tone</span>
                <div className="text-lg font-bold font-mono text-neutral-900">
                  {evaluation.scores.tone} / 5
                </div>
              </div>

              <div className="bg-neutral-50 p-2.5 rounded-lg border border-neutral-200">
                <span className="text-[11px] text-neutral-500">Relevance</span>
                <div className="text-lg font-bold font-mono text-neutral-900">
                  {evaluation.scores.relevance} / 5
                </div>
              </div>

              <div className="bg-neutral-50 p-2.5 rounded-lg border border-neutral-200">
                <span className="text-[11px] text-neutral-500">Hallucination Risk</span>
                <div className="text-lg font-bold font-mono text-neutral-900">
                  {evaluation.scores.hallucination_risk} / 5
                  <span className="text-[10px] text-neutral-400 font-normal ml-1">(1 = lowest)</span>
                </div>
              </div>
            </div>

            {evaluation.flags && evaluation.flags.length > 0 ? (
              <div className="flex items-center gap-2 pt-1 text-xs text-neutral-500">
                <span>Flags:</span>
                {evaluation.flags.map((f) => (
                  <span key={f} className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-[11px] font-mono">
                    {f}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-xs text-neutral-400 italic py-2">
            No evaluation recorded for this call (either pending async completion or call had fewer than 2 turns).
          </div>
        )}
      </div>

      {/* Transcript & Latency Table Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Chat-Style Transcript */}
        <div className="lg:col-span-6 bg-white border border-neutral-200 rounded-xl p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-semibold text-neutral-900 pb-2 border-b border-neutral-100">
            Transcript ({transcript.length} turns)
          </h2>

          {transcript.length === 0 ? (
            <p className="text-xs text-neutral-400 italic">No transcript recorded for this session.</p>
          ) : (
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
              {transcript.map((t) => {
                const isAssistant = t.role === 'assistant';

                return (
                  <div
                    key={t.turn_index}
                    className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}
                  >
                    <div className="flex items-center gap-2 text-[11px] text-neutral-400 mb-1">
                      <span className="font-semibold text-neutral-700">
                        {isAssistant ? 'Assistant' : 'User'}
                      </span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">{t.ts_ms}ms</span>
                      {t.interrupted ? (
                        <span className="text-amber-600 bg-amber-50 border border-amber-200 text-[10px] px-1.5 py-0.2 rounded font-medium">
                          Interrupted
                        </span>
                      ) : null}
                    </div>

                    <div
                      className={`max-w-[85%] rounded-lg p-3 text-sm leading-relaxed ${
                        isAssistant
                          ? 'bg-neutral-100 text-neutral-900 rounded-tl-none'
                          : 'bg-neutral-900 text-white rounded-tr-none'
                      }`}
                    >
                      {t.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Per-Turn Latency Table & Chart */}
        <div className="lg:col-span-6 bg-white border border-neutral-200 rounded-xl p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-semibold text-neutral-900 pb-2 border-b border-neutral-100">
            Per-Turn Latency Breakdown
          </h2>

          <div className="bg-neutral-50/50 p-2 rounded-lg border border-neutral-100">
            <span className="text-[11px] font-medium text-neutral-500 mb-2 block">Voice-to-Voice Latency Over Time (ms)</span>
            <LatencyLineChart metrics={metrics} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-500">
                  <th className="py-2 font-medium">Turn</th>
                  <th className="py-2 font-medium text-right">STT (ms)</th>
                  <th className="py-2 font-medium text-right">LLM TTFB</th>
                  <th className="py-2 font-medium text-right">TTS TTFB</th>
                  <th className="py-2 font-medium text-right">Voice-to-Voice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 font-mono tabular-nums">
                {metrics.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-neutral-400 italic">No per-turn metrics recorded.</td>
                  </tr>
                ) : (
                  metrics.map((m) => (
                    <tr key={m.turn_index} className="hover:bg-neutral-50">
                      <td className="py-2 font-sans font-medium text-neutral-700">Turn {m.turn_index}</td>
                      <td className="py-2 text-right text-neutral-600">{formatMs(m.stt_ms)}</td>
                      <td className="py-2 text-right text-neutral-600">{formatMs(m.llm_ttfb_ms)}</td>
                      <td className="py-2 text-right text-neutral-600">{formatMs(m.tts_ttfb_ms)}</td>
                      <td className="py-2 text-right font-semibold text-neutral-900">
                        {formatMs(m.voice_to_voice_ms)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
