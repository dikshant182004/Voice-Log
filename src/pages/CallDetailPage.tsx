import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Award, AlertCircle, RefreshCw, Clock, Cloud, CheckCircle2, AlertTriangle } from 'lucide-react';
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
        setErrorMessage(`Could not reach Cloudflare Worker: ${err.message}`);
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
      <div className="p-8 sm:p-12 bg-white border border-neutral-200 rounded-2xl space-y-6 text-center max-w-xl mx-auto">
        <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto text-rose-600">
          <AlertCircle className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold text-neutral-900">Call Record Not Found in Cloudflare D1</h3>
          <p className="text-xs font-mono text-neutral-500 break-all">{callId}</p>
          <p className="text-xs text-rose-600 font-medium">{errorMessage || 'Status 404 (Not Found)'}</p>
        </div>

        {/* Diagnosis checklist for developer */}
        <div className="text-left bg-neutral-50 p-4 rounded-xl border border-neutral-200 text-xs space-y-2.5 text-neutral-600">
          <div className="font-semibold text-neutral-800 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>Why did this happen?</span>
          </div>
          <ul className="list-disc list-inside space-y-1.5 text-neutral-600">
            <li>
              <strong>Worker Not Running:</strong> Verify your Cloudflare Worker is started locally via <code className="font-mono text-neutral-800">npx wrangler dev --port 8787</code> in the <code className="font-mono">worker/</code> directory.
            </li>
            <li>
              <strong>Database Migrations:</strong> Ensure local D1 migrations are applied: <code className="font-mono text-neutral-800">npx wrangler d1 migrations apply mini-call-log-db --local</code>.
            </li>
            <li>
              <strong>Bot Spooling:</strong> If network or D1 dropped when the bot ended the call, the bot spooled the call to <code className="font-mono text-neutral-800">bot/spool/{callId}.json</code>.
            </li>
          </ul>
        </div>

        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => fetchDetail()}
            className="px-4 py-2 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-colors"
          >
            Retry Fetch
          </button>
          <button
            onClick={onBack}
            className="px-4 py-2 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-xl transition-colors"
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
      <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-200/80 rounded-xl inline-flex items-center gap-1.5 text-xs text-emerald-800 font-medium">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        <span>Verified & Persisted in Cloudflare D1</span>
      </div>

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

      {/* Advanced Feature 2: Post-Call LLM Evaluation & Sentiment Card */}
      {evaluation ? (
        <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-200">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-indigo-600" />
              <h2 className="text-sm font-bold text-neutral-900">Post-Call Evaluation (LLM Judge)</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 bg-neutral-200/60 rounded text-neutral-600">
                {evaluation.judge_model}
              </span>
            </div>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                evaluation.sentiment === 'positive'
                  ? 'bg-emerald-100 text-emerald-800'
                  : evaluation.sentiment === 'negative'
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-neutral-200 text-neutral-700'
              }`}
            >
              {evaluation.sentiment}
            </span>
          </div>

          <p className="text-xs text-neutral-700 italic leading-relaxed">
            "{evaluation.summary}"
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3 bg-white rounded-xl border border-neutral-200">
              <span className="text-[11px] text-neutral-500 block">Task Completion</span>
              <span className="text-lg font-bold font-mono text-neutral-900">{evaluation.scores.task_completion}/5</span>
            </div>
            <div className="p-3 bg-white rounded-xl border border-neutral-200">
              <span className="text-[11px] text-neutral-500 block">Tone & Empathy</span>
              <span className="text-lg font-bold font-mono text-neutral-900">{evaluation.scores.tone}/5</span>
            </div>
            <div className="p-3 bg-white rounded-xl border border-neutral-200">
              <span className="text-[11px] text-neutral-500 block">Relevance</span>
              <span className="text-lg font-bold font-mono text-neutral-900">{evaluation.scores.relevance}/5</span>
            </div>
            <div className="p-3 bg-white rounded-xl border border-neutral-200">
              <span className="text-[11px] text-neutral-500 block">Hallucination Risk</span>
              <span className="text-lg font-bold font-mono text-neutral-900">{evaluation.scores.hallucination_risk}/5</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Latency Progression Line Chart */}
      {metrics && metrics.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Turn-by-Turn Voice-to-Voice Latency</h2>
            <span className="text-xs font-mono text-neutral-500">Target Budget &lt; 800ms</span>
          </div>
          <LatencyLineChart metrics={metrics} />
        </div>
      )}

      {/* Turn Transcript & Metrics Table */}
      <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-neutral-200 bg-neutral-50/50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Conversation Transcript & Latency Telemetry</h2>
          <span className="text-xs text-neutral-500">{transcript.length} turns recorded</span>
        </div>

        <div className="divide-y divide-neutral-100">
          {transcript.length === 0 ? (
            <div className="p-8 text-center text-xs text-neutral-400">No conversation turns recorded for this session.</div>
          ) : (
            transcript.map((t) => {
              const m = metrics.find((metric) => metric.turn_index === t.turn_index);
              return (
                <div key={t.turn_index} className="p-6 space-y-3 hover:bg-neutral-50/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          t.role === 'user' ? 'bg-neutral-200 text-neutral-800' : 'bg-indigo-100 text-indigo-800'
                        }`}
                      >
                        {t.role}
                      </span>
                      <span className="text-xs font-mono text-neutral-400">Turn #{t.turn_index}</span>
                      {t.interrupted && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-rose-50 text-rose-700 rounded border border-rose-200">
                          Barge-in Cutoff
                        </span>
                      )}
                    </div>
                    {t.ts_ms ? (
                      <span className="text-xs font-mono text-neutral-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        +{Math.round(t.ts_ms / 1000)}s
                      </span>
                    ) : null}
                  </div>

                  <p className="text-sm text-neutral-800 leading-relaxed font-sans">{t.text}</p>

                  {/* Latency Breakdown Bar for Assistant Turn */}
                  {m && (m.voice_to_voice_ms || m.stt_ms || m.llm_ttfb_ms || m.tts_ttfb_ms) ? (
                    <div className="pt-2">
                      <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-neutral-500 bg-neutral-50 p-2.5 rounded-lg border border-neutral-100">
                        {m.stt_ms ? (
                          <div>
                            STT: <strong className="text-neutral-800">{m.stt_ms}ms</strong>
                          </div>
                        ) : null}
                        {m.llm_ttfb_ms ? (
                          <div>
                            LLM TTFB: <strong className="text-neutral-800">{m.llm_ttfb_ms}ms</strong>
                          </div>
                        ) : null}
                        {m.tts_ttfb_ms ? (
                          <div>
                            TTS TTFB: <strong className="text-neutral-800">{m.tts_ttfb_ms}ms</strong>
                          </div>
                        ) : null}
                        {m.voice_to_voice_ms ? (
                          <div className="text-indigo-600 font-semibold">
                            Total V2V: {m.voice_to_voice_ms}ms
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
