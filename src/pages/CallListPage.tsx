import React, { useState, useEffect, useRef } from 'react';
import { Search, Phone, ArrowRight, RefreshCw, AlertCircle, AlertTriangle } from 'lucide-react';
import { CallListItem } from '../types';
import { apiClient, HttpError, NetworkError, ConfigurationError } from '../api/client';

interface CallListPageProps {
  onSelectCall: (callId: string) => void;
  onStartCall: () => void;
}

export const CallListPage: React.FC<CallListPageProps> = ({ onSelectCall, onStartCall }) => {
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'disconnected' | 'error'>('all');
  const abortControllerRef = useRef<AbortController | null>(null);

  const isConfigured = apiClient.isConfigured();

  const fetchCalls = async (cursor?: string | null) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setIsLoading(true);
      setErrorMessage(null);
      const res = await apiClient.listCalls(20, cursor, controller.signal);
      if (cursor) {
        setCalls((prev) => [...prev, ...res.items]);
      } else {
        setCalls(res.items);
      }
      setNextCursor(res.next_cursor);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'CanceledError') return;
      if (err instanceof ConfigurationError) {
        setErrorMessage(err.message);
      } else if (err instanceof HttpError) {
        setErrorMessage(`Server error ${err.status}: ${err.message}${err.requestId ? ` (Request ID: ${err.requestId})` : ''}`);
      } else if (err instanceof NetworkError) {
        setErrorMessage(`Could not reach Cloudflare Worker: ${err.message}`);
      } else {
        setErrorMessage(err.message || 'Failed to retrieve calls from database');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
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
      {/* Banner if VITE_API_BASE_URL is missing */}
      {!isConfigured ? (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block">Cloudflare Worker API URL Not Configured</span>
            <p>
              Set <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-amber-900">VITE_API_BASE_URL</code> in your environment to point to your deployed or local Cloudflare Worker.
            </p>
          </div>
        </div>
      ) : null}

      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Call Log</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Persisted voice calls with streaming STT, LLM, and TTS latency metrics from Cloudflare D1.
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
            <span>Start Voice Call</span>
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
            placeholder="Filter by Call ID or summary..."
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
            All
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

      {/* Call List Container */}
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-xs">
        {isLoading && calls.length === 0 ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
                <div className="space-y-2">
                  <div className="h-4 bg-neutral-200 rounded w-48" />
                  <div className="h-3 bg-neutral-100 rounded w-72" />
                </div>
                <div className="h-4 bg-neutral-200 rounded w-20" />
              </div>
            ))}
          </div>
        ) : errorMessage ? (
          <div className="p-12 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
            <h3 className="text-sm font-semibold text-neutral-900">Failed to load calls from Cloudflare D1</h3>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">{errorMessage}</p>
            <button
              onClick={() => fetchCalls()}
              className="mt-2 px-3.5 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Phone className="w-8 h-8 text-neutral-300 mx-auto" />
            <h3 className="text-sm font-semibold text-neutral-900">No calls recorded yet</h3>
            <p className="text-xs text-neutral-500 max-w-sm mx-auto">
              Start a call from the browser with the local Pipecat bot running to record the first session in D1.
            </p>
            <button
              onClick={onStartCall}
              className="mt-2 px-4 py-2 text-xs font-semibold text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 transition-colors"
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

                  <p className="text-sm font-medium text-neutral-900 truncate max-w-2xl">
                    {call.summary || (call.status === 'completed' ? 'Completed call.' : `Status: ${call.status}`)}
                  </p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  {call.p50_voice_to_voice_ms ? (
                    <div className="text-right">
                      <div className="text-xs font-semibold text-neutral-900 font-mono tabular-nums">
                        {call.p50_voice_to_voice_ms}ms
                      </div>
                      <span className="text-[11px] text-neutral-400">p50 v2v</span>
                    </div>
                  ) : null}

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

        {nextCursor ? (
          <div className="p-4 border-t border-neutral-200 text-center bg-neutral-50/50">
            <button
              onClick={() => fetchCalls(nextCursor)}
              disabled={isLoading}
              className="px-4 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-100 transition-colors"
            >
              {isLoading ? 'Loading...' : 'Load more'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
