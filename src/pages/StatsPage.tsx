import React, { useState, useEffect } from 'react';
import { BarChart3, Clock, Zap, AlertTriangle, ShieldCheck, Activity, RefreshCw } from 'lucide-react';
import { CallStatsResponse } from '../types';
import { apiClient } from '../api/client';
import { LatencyBars } from '../components/LatencyBars';

export const StatsPage: React.FC = () => {
  const [days, setDays] = useState<number>(7);
  const [stats, setStats] = useState<CallStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async (windowDays: number) => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await apiClient.getStats(windowDays);
      setStats(res);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch aggregate metrics');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats(days);
  }, [days]);

  return (
    <div className="space-y-8">
      {/* Title & Time Window Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Latency & Reliability Analytics</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Aggregated percentiles (p50 / p95) across Deepgram STT, Groq LLM TTFB, and Cartesia TTS streaming pipelines.
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
            className="p-2 text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-lg hover:bg-neutral-50"
            title="Refresh analytics"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {isLoading && !stats ? (
        <div className="p-12 text-center space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-neutral-400 mx-auto" />
          <p className="text-xs text-neutral-500">Computing D1 percentile distributions...</p>
        </div>
      ) : stats ? (
        <div className="space-y-8">
          {/* KPI Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-neutral-200 p-5 rounded-xl shadow-xs space-y-1">
              <span className="text-xs font-medium text-neutral-500 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-600" />
                Voice-to-Voice (p50)
              </span>
              <div className="text-3xl font-bold font-mono tabular-nums text-neutral-900">
                {stats.latency_percentiles.voice_to_voice.p50_ms ?? '—'}ms
              </div>
              <span className="text-[11px] text-neutral-400 font-mono">
                p95: {stats.latency_percentiles.voice_to_voice.p95_ms ?? '—'}ms · Target &lt; 800ms
              </span>
            </div>

            <div className="bg-white border border-neutral-200 p-5 rounded-xl shadow-xs space-y-1">
              <span className="text-xs font-medium text-neutral-500 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-600" />
                Total Volume
              </span>
              <div className="text-3xl font-bold font-mono tabular-nums text-neutral-900">
                {stats.total_calls}
              </div>
              <span className="text-[11px] text-neutral-400">
                {stats.completed_calls} completed normally
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
                Avg Call Duration
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
                <h2 className="text-sm font-semibold text-neutral-900">Pipeline Latency Breakdown (p50 / p95)</h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  End-to-end speech processing timeline measured from client utterances.
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
                <h2 className="text-sm font-semibold text-neutral-900">Daily Call Ingestion Volume</h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Calls logged over the last {days} days with average duration.
                </p>
              </div>

              <div className="h-56 flex items-end justify-between gap-2 pt-6 pb-2 px-2 border-b border-neutral-200">
                {stats.daily_volume.map((dv) => {
                  const maxCount = Math.max(...stats.daily_volume.map((d) => d.call_count), 5);
                  const barHeight = Math.max(12, (dv.call_count / maxCount) * 160);

                  return (
                    <div key={dv.date} className="flex-1 flex flex-col items-center gap-2 group">
                      <div className="text-[11px] font-mono text-neutral-600 tabular-nums">
                        {dv.call_count}
                      </div>
                      <div
                        className="w-full max-w-[36px] bg-neutral-800 hover:bg-emerald-600 transition-all rounded-t-sm"
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

              <div className="text-center text-xs text-neutral-400">
                Aggregated in SQLite D1 prepared queries with bounded limit.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
