import React from 'react';
import { PhoneCall, BarChart3, ListFilter, Terminal, Bot } from 'lucide-react';

interface TopNavProps {
  currentTab: 'calls' | 'stats' | 'live' | 'logs' | 'agents' | 'playground';
  onSelectTab: (tab: 'calls' | 'stats' | 'live' | 'logs' | 'agents' | 'playground') => void;
  onStartCall: () => void;
  isCallActive?: boolean;
}

export const TopNav: React.FC<TopNavProps> = ({
  currentTab,
  onSelectTab,
  onStartCall,
  isCallActive,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Zone 1: Single text element wordmark */}
        <div className="flex items-center gap-6">
        <button
            onClick={() => onSelectTab('calls')}
            className="text-lg font-bold tracking-tight text-neutral-900 hover:text-neutral-700 transition-colors text-left"
          >
            Mini Call Log
          </button>
        </div>

        {/* Zone 2: 4 clean text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-neutral-600">
          <button
            onClick={() => onSelectTab('calls')}
            className={`transition-colors flex items-center gap-1.5 pb-0.5 ${
              currentTab === 'calls'
                ? 'text-neutral-900 border-b-2 border-neutral-900 font-semibold'
                : 'hover:text-neutral-900'
            }`}
          >
            <ListFilter className="w-4 h-4" />
            <span>Calls</span>
          </button>
          <button
            onClick={() => onSelectTab('stats')}
            className={`transition-colors flex items-center gap-1.5 pb-0.5 ${
              currentTab === 'stats'
                ? 'text-neutral-900 border-b-2 border-neutral-900 font-semibold'
                : 'hover:text-neutral-900'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Latency Analytics</span>
          </button>
          <button
            onClick={() => onSelectTab('live')}
            className={`transition-colors flex items-center gap-1.5 pb-0.5 ${
              currentTab === 'live'
                ? 'text-neutral-900 border-b-2 border-neutral-900 font-semibold'
                : 'hover:text-neutral-900'
            }`}
          >
            <PhoneCall className="w-4 h-4" />
            <span>Live Voice Agent</span>
          </button>
          <button
            onClick={() => onSelectTab('agents')}
            className={`transition-colors flex items-center gap-1.5 pb-0.5 ${
              currentTab === 'agents'
                ? 'text-neutral-900 border-b-2 border-neutral-900 font-semibold'
                : 'hover:text-neutral-900'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>Agents</span>
          </button>
          <button
            onClick={() => onSelectTab('playground')}
            className={`transition-colors flex items-center gap-1.5 pb-0.5 ${
              currentTab === 'playground'
                ? 'text-neutral-900 border-b-2 border-neutral-900 font-semibold'
                : 'hover:text-neutral-900'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Playground</span>
          </button>
          <button
            onClick={() => onSelectTab('logs')}
            className={`transition-colors flex items-center gap-1.5 pb-0.5 ${
              currentTab === 'logs'
                ? 'text-neutral-900 border-b-2 border-neutral-900 font-semibold'
                : 'hover:text-neutral-900'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>API & Observability</span>
          </button>
        </nav>

        {/* Zone 3: 1-2 primary actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onStartCall}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap flex items-center gap-2 ${
              isCallActive
                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                : 'bg-neutral-900 hover:bg-neutral-800 text-white shadow-sm'
            }`}
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>{isCallActive ? 'Live Call in Progress' : 'Start Voice Call'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
