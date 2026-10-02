import React from 'react';
import { Phone, PhoneOff, Mic, MicOff, AlertCircle, Info } from 'lucide-react';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { AudioVisualizer } from '../components/AudioVisualizer';

interface LiveCallViewProps {
  onCallFinished: (callId: string) => void;
}

export const LiveCallView: React.FC<LiveCallViewProps> = ({ onCallFinished }) => {
  const {
    callState,
    callId,
    durationSeconds,
    isMuted,
    errorMessage,
    analyser,
    startCall,
    endCall,
    toggleMute,
  } = useVoiceCall(onCallFinished);

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  const isLive = callState === 'live' || callState === 'connecting' || callState === 'requesting_mic';
  const botUrl = import.meta.env.VITE_BOT_URL || 'http://127.0.0.1:8765';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-1 pb-4 border-b border-neutral-200">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Voice AI Call Session</h1>
        <p className="text-sm text-neutral-500 max-w-lg mx-auto">
          Talk to the local Pipecat agent via browser WebRTC. Use headphones to prevent acoustic echo.
        </p>
      </div>

      {/* Bot Server Connection Notice */}
      <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-600 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
        <div>
          <span>Signaling target: <code className="font-mono text-neutral-800">{botUrl}</code>.</span>
          <span className="block text-neutral-500 mt-0.5">Ensure the local bot is running via <code className="font-mono">python -m bot.bot</code> before starting a call.</span>
        </div>
      </div>

      {/* Error state */}
      {errorMessage ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block">Call Connection Error</span>
            <p>{errorMessage}</p>
          </div>
        </div>
      ) : null}

      {/* Main Call Control Panel */}
      <div className="bg-white border border-neutral-200 rounded-2xl p-6 sm:p-8 shadow-xs text-center space-y-6">
        {/* Status Badge & Duration */}
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
            <div className="text-xs font-mono text-neutral-400">Call ID: {callId}</div>
          ) : null}
        </div>

        {/* Real-time Microphone Waveform */}
        <AudioVisualizer analyser={analyser} isActive={callState === 'live' && !isMuted} />

        {/* Action Controls */}
        <div className="flex items-center justify-center gap-4 pt-2">
          {!isLive ? (
            <button
              onClick={startCall}
              className="px-6 py-3 text-sm font-semibold text-white bg-neutral-900 hover:bg-neutral-800 rounded-xl shadow-sm transition-all flex items-center gap-2.5"
            >
              <Phone className="w-4 h-4" />
              <span>Start Call</span>
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
                <span>End Call</span>
              </button>
            </>
          )}
        </div>

        {callState === 'reported' ? (
          <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg text-xs text-neutral-600">
            Session ended. Ingestion payload dispatched to Cloudflare Worker.
          </div>
        ) : null}
      </div>
    </div>
  );
};
