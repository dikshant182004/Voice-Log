import React, { useState, useEffect, useRef } from 'react';
import { BarChart3, Clock, Zap, AlertTriangle, Activity, RefreshCw, AlertCircle } from 'lucide-react';
import { CallStatsResponse } from '../types';
import { apiClient, HttpError, NetworkError, ConfigurationError } from '../api/client';
import { LatencyBars } from '../components/LatencyBars';

export const StatsPage: React.FC = () => {
  const [days, setDays] = useState<number>(7);
  const [stats, setStats] = useState<CallStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isConfigured = apiClient.isConfigured();

  const fetchStats = async (windowDays: number) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setIsLoading(true);
      setErrorMessage(null);
      const res = await apiClient.getStats(windowDays, controller.signal);
      setStats(res);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'CanceledError') return;
      if (err instanceof ConfigurationError) {
        setErrorMessage(err.message);
      } else if (err instanceof HttpError) {
        setErrorMessage(`Server error ${err.status}: ${err.message}${err.requestId ? ` (Request ID: ${err.requestId})` : ''}`);
      } else if (err instanceof NetworkError) {
        setErrorMessage(`Could not connect to Cloudflare Worker: ${err.message}`);
      } else {
        setErrorMessage(err.message || 'Failed to fetch aggregate metrics');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats(days);
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [days]);

  return (
    <div className="space-y-8">
      {/* Banner if VITE_API_BASE_URL is missing */}
      {!isConfigured ? (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block">Cloudflare Worker API URL Not Configured</span>
            <p>
              Set <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-amber-900">VITE_API_BASE_URL</code> to view live aggregated percentiles from Cloudflare D1.
            </p>
          </div>
        </div>
      ) : null}

      {/* Title & Time Window Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Latency Analytics</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Observed percentiles computed from D1 records across Deepgram, Groq, and Cartesia pipelines.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-lg">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  days === d ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {d} Days
              </button>
            ))}
          </div>
          <button
            onClick={() => fetchStats(days)}
            className="p-2 text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors"
            title="Refresh analytics"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {isLoading && !stats ? (
        <div className="p-12 text-center space-y-3 bg-white border border-neutral-200 rounded-xl">
          <RefreshCw className="w-6 h-6 animate-spin text-neutral-400 mx-auto" />
          <p className="text-xs text-neutral-500">Querying Cloudflare D1 latency percentiles...</p>
        </div>
      ) : errorMessage ? (
        <div className="p-12 text-center space-y-3 bg-white border border-neutral-200 rounded-xl">
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
          <h3 className="text-sm font-semibold text-neutral-900">Failed to load analytics</h3>
          <p className="text-xs text-neutral-500 max-w-md mx-auto">{errorMessage}</p>
          <button
            onClick={() => fetchStats(days)}
            className="mt-2 px-3.5 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      ) : stats ? (
        stats.total_calls === 0 ? (
          <div className="p-12 text-center space-y-3 bg-white border border-neutral-200 rounded-xl">
            <Activity className="w-8 h-8 text-neutral-300 mx-auto" />
            <h3 className="text-sm font-semibold text-neutral-900">No calls in the selected {days}-day window</h3>
            <p className="text-xs text-neutral-500 max-w-sm mx-auto">
              Once calls are ingested into Cloudflare D1, latency percentiles and daily volume will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* KPI Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-neutral-200 p-5 rounded-xl shadow-xs space-y-1">
                <span className="text-xs font-medium text-neutral-500 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-neutral-700" />
                  Voice-to-Voice (p50)
                </span>
                <div className="text-3xl font-bold font-mono tabular-nums text-neutral-900">
                  {stats.latency_percentiles.voice_to_voice.p50_ms !== null
                    ? `${stats.latency_percentiles.voice_to_voice.p50_ms}ms`
                    : '—'}
                </div>
                <span className="text-[11px] text-neutral-400 font-mono">
                  p95: {stats.latency_percentiles.voice_to_voice.p95_ms !== null
                    ? `${stats.latency_percentiles.voice_to_voice.p95_ms}ms`
                    : '—'}
                </span>
              </div>

              <div className="bg-white border border-neutral-200 p-5 rounded-xl shadow-xs space-y-1">
                <span className="text-xs font-medium text-neutral-500 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-neutral-700" />
                  Total Volume
                </span>
                <div className="text-3xl font-bold font-mono tabular-nums text-neutral-900">
                  {stats.total_calls}
                </div>
                <span className="text-[11px] text-neutral-400">
                  {stats.completed_calls} completed
                </span>
              </div>

              <div className="bg-white border border-neutral-200 p-5 rounded-xl shadow-xs space-y-1">
                <span className="text-xs font-medium text-neutral-500 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  Interruption Rate
                </span>
                <div className="text-3xl font-bold font-mono tabular-nums text-neutral-900">
                  {stats.interruption_rate_pct}%
                </div>
                <span className="text-[11px] text-neutral-400">
                  Barge-in VAD cutoffs
                </span>
              </div>

              <div className="bg-white border border-neutral-200 p-5 rounded-xl shadow-xs space-y-1">
                <span className="text-xs font-medium text-neutral-500 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-neutral-600" />
                  Avg Duration
                </span>
                <div className="text-3xl font-bold font-mono tabular-nums text-neutral-900">
                  {Math.round(stats.avg_duration_ms / 1000)}s
                </div>
                <span className="text-[11px] text-neutral-400 font-mono">
                  Error rate: {stats.error_rate_pct}%
                </span>
              </div>
            </div>

            {/* Breakdown Section: Pipeline Bar Comparison & Daily Volume */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Step Latencies */}
              <div className="lg:col-span-6 bg-white border border-neutral-200 rounded-xl p-5 shadow-xs space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">Pipeline Latency Breakdown</h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Measured p50 and p95 distributions across pipeline steps.
                  </p>
                </div>

                <LatencyBars
                  v2v={stats.latency_percentiles.voice_to_voice}
                  stt={stats.latency_percentiles.stt}
                  llm={stats.latency_percentiles.llm_ttfb}
                  tts={stats.latency_percentiles.tts_ttfb}
                />
              </div>

              {/* Daily Volume Bar Chart */}
              <div className="lg:col-span-6 bg-white border border-neutral-200 rounded-xl p-5 shadow-xs space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">Daily Ingestion Volume</h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Sessions logged over the last {days} days.
                  </p>
                </div>

                {stats.daily_volume.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-xs text-neutral-400 italic">
                    No daily volume entries recorded.
                  </div>
                ) : (
                  <div className="h-56 flex items-end justify-between gap-2 pt-6 pb-2 px-2 border-b border-neutral-200">
                    {stats.daily_volume.map((dv) => {
                      const maxCount = Math.max(...stats.daily_volume.map((d) => d.call_count), 1);
                      const barHeight = Math.max(8, (dv.call_count / maxCount) * 160);

                      return (
                        <div key={dv.date} className="flex-1 flex flex-col items-center gap-2 group">
                          <div className="text-[11px] font-mono text-neutral-600 tabular-nums">
                            {dv.call_count}
                          </div>
                          <div
                            className="w-full max-w-[36px] bg-neutral-800 hover:bg-neutral-950 transition-all rounded-t-sm"
                            style={{ height: `${barHeight}px` }}
                            title={`${dv.date}: ${dv.call_count} calls, avg ${Math.round(dv.avg_duration_ms / 1000)}s`}
                          />
                          <span className="text-[10px] text-neutral-400 font-mono">
                            {dv.date.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
};
