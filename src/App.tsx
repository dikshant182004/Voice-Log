import React, { useState } from 'react';
import { TopNav } from './components/TopNav';
import { CallListPage } from './pages/CallListPage';
import { CallDetailPage } from './pages/CallDetailPage';
import { StatsPage } from './pages/StatsPage';
import { LiveCallView } from './pages/LiveCallView';
import { DevConsolePage } from './pages/DevConsolePage';
import { AgentBuilderPage } from './pages/AgentBuilderPage';
import { AgentPlaygroundPage } from './pages/AgentPlaygroundPage';
import { CallDetailResponse } from './types';

export function App() {
  const [currentTab, setCurrentTab] = useState<'calls' | 'stats' | 'live' | 'logs' | 'agents' | 'playground'>('calls');
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  const handleSelectCall = (callId: string) => {
    setSelectedCallId(callId);
  };

  const handleBackToCalls = () => {
    setSelectedCallId(null);
    setCurrentTab('calls');
  };

  const handleStartCall = () => {
    setSelectedCallId(null);
    setCurrentTab('live');
  };

  const handleCallFinished = (callId: string) => {
    // Automatically select the newly finished call to inspect its transcript and metrics
    setSelectedCallId(callId);
  };

  return (
    <div className="min-h-screen bg-neutral-50/70 text-neutral-900 font-sans flex flex-col">
      {/* Top Bar following 3-zone contract */}
      <TopNav
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setSelectedCallId(null);
          setCurrentTab(tab);
        }}
        onStartCall={handleStartCall}
        isCallActive={currentTab === 'live'}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {selectedCallId ? (
          <CallDetailPage callId={selectedCallId} onBack={handleBackToCalls} />
        ) : currentTab === 'calls' ? (
          <CallListPage onSelectCall={handleSelectCall} onStartCall={handleStartCall} />
        ) : currentTab === 'stats' ? (
          <StatsPage />
        ) : currentTab === 'live' ? (
          <LiveCallView onCallFinished={handleCallFinished} />
        ) : currentTab === 'agents' ? (
          <AgentBuilderPage />
        ) : currentTab === 'playground' ? (
          <AgentPlaygroundPage />
        ) : (
          <DevConsolePage />
        )}
      </main>

      {/* Clean quiet footer */}
      <footer className="border-t border-neutral-200 bg-white py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500">
          <div>
            <span>Mini Call Log Service</span>
            <span aria-hidden="true" className="mx-2">·</span>
            <span>Cloudflare Workers, D1 & Pipecat Voice Pipeline</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono">p50 Target &lt; 800ms</span>
            <span aria-hidden="true">·</span>
            <span>Deepgram Nova-3 General + Groq gpt-oss-20b + Cartesia Sonic 3.6</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
