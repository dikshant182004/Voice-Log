import React from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, ShieldAlert, Sparkles, CheckCircle2 } from 'lucide-react';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { AudioVisualizer } from '../components/AudioVisualizer';
import { CallDetailResponse } from '../types';

interface LiveCallViewProps {
  onCallFinished: (call: CallDetailResponse) => void;
}

export const LiveCallView: React.FC<LiveCallViewProps> = ({ onCallFinished }) => {
  const {
    callState,
    callId,
    durationSeconds,
    isMuted,
    errorMessage,
    analyser,
    liveTurns,
    liveMetrics,
    startCall,
    simulateCall,
    endCall,
    toggleMute,
  } = useVoiceCall(onCallFinished);

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  const isLive = callState === 'live' || callState === 'connecting' || callState === 'requesting_mic';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-1 pb-4 border-b border-neutral-200">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Interactive Voice AI Agent</h1>
        <p className="text-sm text-neutral-500 max-w-lg mx-auto">
          Start a real microphone call with WebRTC streaming STT (Deepgram), fast LLM (Groq), and TTS (Cartesia).
        </p>
      </div>

      {/* Error state */}
      {errorMessage ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block">Microphone or Connection Issue</span>
            <p>{errorMessage}</p>
          </div>
        </div>
      ) : null}

      {/* Main Call Control Panel */}
      <div className="bg-white border border-neutral-200 rounded-2xl p-6 sm:p-8 shadow-xs text-center space-y-6">
        {/* Status & Timer */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700">
            <span
              className={`w-2 h-2 rounded-full ${
                callState === 'live'
                  ? 'bg-emerald-500 animate-pulse'
                  : callState === 'connecting' || callState === 'requesting_mic'
                  ? 'bg-amber-500 animate-ping'
                  : callState === 'reported'
                  ? 'bg-blue-500'
                  : 'bg-neutral-400'
              }`}
            />
            <span className="capitalize">{callState.replace('_', ' ')}</span>
          </div>

          <div className="text-4xl font-bold font-mono tabular-nums text-neutral-900">
            {formatTimer(durationSeconds)}
          </div>

          {callId ? (
            <div className="text-xs font-mono text-neutral-400">Session ID: {callId}</div>
          ) : null}
        </div>

        {/* Live Audio Waveform Analyser */}
        <AudioVisualizer analyser={analyser} isActive={callState === 'live' && !isMuted} />

        {/* Action Controls */}
        <div className="flex items-center justify-center gap-4 pt-2">
          {!isLive ? (
            <button
              onClick={startCall}
              className="px-6 py-3 text-sm font-semibold text-white bg-neutral-900 hover:bg-neutral-800 rounded-xl shadow-sm transition-all flex items-center gap-2.5"
            >
              <Phone className="w-4 h-4" />
              <span>Start Microphone Call</span>
            </button>
          ) : (
            <>
              <button
                onClick={toggleMute}
                className={`p-3.5 rounded-xl border transition-colors ${
                  isMuted
                    ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                    : 'bg-neutral-100 border-neutral-200 text-neutral-700 hover:bg-neutral-200'
                }`}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <button
                onClick={endCall}
                className="px-6 py-3 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm transition-all flex items-center gap-2.5"
              >
                <PhoneOff className="w-4 h-4" />
                <span>Hang Up Call</span>
              </button>
            </>
          )}

          {!isLive ? (
            <button
              onClick={simulateCall}
              className="px-4 py-3 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-all flex items-center gap-2"
              title="Runs a simulated benchmark call with real latencies"
            >
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>Run Benchmark Simulation</span>
            </button>
          ) : null}
        </div>

        {callState === 'reported' ? (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Call finished and persisted to database. View in the Calls tab!</span>
          </div>
        ) : null}
      </div>

      {/* Live Transcript Stream */}
      {liveTurns.length > 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-5 shadow-xs space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Live Turn Stream</h2>
          <div className="space-y-3">
            {liveTurns.map((turn) => (
              <div
                key={turn.turn_index}
                className={`p-3 rounded-lg text-sm ${
                  turn.role === 'assistant'
                    ? 'bg-neutral-50 text-neutral-900 border border-neutral-200'
                    : 'bg-neutral-900 text-white'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] opacity-75 mb-1">
                  <span className="font-semibold uppercase">{turn.role}</span>
                  <span className="font-mono tabular-nums">{turn.ts_ms}ms</span>
                </div>
                <p>{turn.text}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
