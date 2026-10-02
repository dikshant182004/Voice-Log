import React, { useState, useEffect } from 'react';
import { Search, Filter, Phone, Clock, ArrowRight, RefreshCw, Zap } from 'lucide-react';
import { CallListItem } from '../types';
import { apiClient } from '../api/client';

interface CallListPageProps {
  onSelectCall: (callId: string) => void;
  onStartCall: () => void;
}

export const CallListPage: React.FC<CallListPageProps> = ({ onSelectCall, onStartCall }) => {
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isError, setIsError] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'disconnected' | 'error'>('all');

  const fetchCalls = async (cursor?: string | null) => {
    try {
      setIsLoading(true);
      setIsError(false);
      const res = await apiClient.listCalls(20, cursor);
      if (cursor) {
        setCalls((prev) => [...prev, ...res.items]);
      } else {
        setCalls(res.items);
      }
      setNextCursor(res.next_cursor);
    } catch (err) {
      console.error('Failed to load calls', err);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
  }, []);

  const filteredCalls = calls.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesId = c.id.toLowerCase().includes(q);
      const matchesSummary = (c.summary || '').toLowerCase().includes(q);
      return matchesId || matchesSummary;
    }
    return true;
  });

  const formatDuration = (ms: number): string => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (isoString: string): string => {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Call Telemetry Log</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Real-time voice sessions with streaming STT, LLM TTFB, and TTS latency metrics stored in Cloudflare D1.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchCalls()}
            className="p-2 text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors"
            title="Refresh Calls"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onStartCall}
            className="px-4 py-2 text-xs font-semibold text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 transition-colors flex items-center gap-2"
          >
            <Phone className="w-3.5 h-3.5" />
            <span>New Voice Call</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Call ID or transcript summary..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
          />
        </div>

        {/* Status segmented controls */}
        <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-lg">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              statusFilter === 'all' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            All Calls
          </button>
          <button
            onClick={() => setStatusFilter('completed')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              statusFilter === 'completed' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Completed
          </button>
          <button
            onClick={() => setStatusFilter('disconnected')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              statusFilter === 'disconnected' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Disconnected
          </button>
          <button
            onClick={() => setStatusFilter('error')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              statusFilter === 'error' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Error
          </button>
        </div>
      </div>

      {/* Call List Table */}
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-xs">
        {isLoading && calls.length === 0 ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
                <div className="space-y-2">
                  <div className="h-4 bg-neutral-200 rounded w-48" />
                  <div className="h-3 bg-neutral-100 rounded w-72" />
                </div>
                <div className="h-4 bg-neutral-200 rounded w-20" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm font-medium text-rose-600">Failed to load calls from server</p>
            <button
              onClick={() => fetchCalls()}
              className="px-3 py-1.5 text-xs text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200"
            >
              Retry Connection
            </button>
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Phone className="w-8 h-8 text-neutral-300 mx-auto" />
            <h3 className="text-sm font-semibold text-neutral-900">No calls found</h3>
            <p className="text-xs text-neutral-500 max-w-sm mx-auto">
              Start a voice call or run a benchmark simulation to see turns, transcripts, and latency percentiles.
            </p>
            <button
              onClick={onStartCall}
              className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-neutral-900 rounded-lg hover:bg-neutral-800"
            >
              Start First Call
            </button>
          </div>
        ) : (
          <div className="divide-y divide-neutral-200">
            {filteredCalls.map((call) => (
              <div
                key={call.id}
                onClick={() => onSelectCall(call.id)}
                className="p-4 hover:bg-neutral-50/80 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  {/* Clean unboxed metadata header */}
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <span className="font-mono text-neutral-800 font-medium">{call.id.slice(0, 8)}...{call.id.slice(-4)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatDate(call.started_at)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatDuration(call.duration_ms)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{call.turn_count} turns</span>
                    {call.interruption_count ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-600 font-medium">{call.interruption_count} interrupted</span>
                      </>
                    ) : null}
                  </div>

                  {/* Summary / Outcome */}
                  <p className="text-sm font-medium text-neutral-900 truncate max-w-2xl">
                    {call.summary || (call.status === 'completed' ? 'Voice call completed normally.' : `Call finished with status ${call.status}`)}
                  </p>
                </div>

                {/* Right side stats */}
                <div className="flex items-center gap-4 shrink-0">
                  {call.p50_voice_to_voice_ms ? (
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-xs font-semibold text-emerald-700 font-mono tabular-nums">
                        <Zap className="w-3.5 h-3.5" />
                        <span>{call.p50_voice_to_voice_ms}ms</span>
                      </div>
                      <span className="text-[11px] text-neutral-400">p50 latency</span>
                    </div>
                  ) : null}

                  {/* Status indicator */}
                  <div className="text-right">
                    <span
                      className={`text-xs font-medium ${
                        call.status === 'completed'
                          ? 'text-emerald-700'
                          : call.status === 'error'
                          ? 'text-rose-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {call.status === 'completed' ? 'Completed' : call.status === 'error' ? 'Error' : 'Disconnected'}
                    </span>
                  </div>

                  <ArrowRight className="w-4 h-4 text-neutral-400" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load More Button */}
        {nextCursor ? (
          <div className="p-4 border-t border-neutral-200 text-center bg-neutral-50/50">
            <button
              onClick={() => fetchCalls(nextCursor)}
              disabled={isLoading}
              className="px-4 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-100 transition-colors"
            >
              {isLoading ? 'Loading more calls...' : 'Load more'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
