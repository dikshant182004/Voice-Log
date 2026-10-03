import React, { useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, AlertCircle, Info, Volume2, Send, Zap, Activity } from 'lucide-react';
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
    isAssistantSpeaking,
    transcript,
    interimTranscript,
    isSpeechRecognitionActive,
    speechRecognitionError,
    latestMetrics,
    errorMessage,
    analyser,
    startCall,
    endCall,
    toggleMute,
    sendTurnText,
  } = useVoiceCall(onCallFinished);

  const [inputTurn, setInputTurn] = useState('');

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  const isLive = callState === 'live' || callState === 'connecting' || callState === 'requesting_mic';
  const botUrl = import.meta.env.VITE_BOT_URL || 'http://127.0.0.1:8765';

  const handleSendInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputTurn.trim()) return;
    sendTurnText(inputTurn.trim());
    setInputTurn('');
  };

  const quickPrompts = [
    'What are your customer support hours?',
    'What is your return and refund policy?',
    'Do you support international shipping?',
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-1 pb-4 border-b border-neutral-200">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Voice AI Call Session</h1>
        <p className="text-sm text-neutral-500 max-w-lg mx-auto">
          Talk to your voice AI assistant. Speak into your microphone or send queries in real time.
        </p>
      </div>

      {/* Bot Server Connection Notice */}
      <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-600 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
        <div>
          <span>Signaling target: <code className="font-mono text-neutral-800">{botUrl}</code>.</span>
          <span className="block text-neutral-500 mt-0.5">
            Voice pipeline runs locally with Pipecat, Deepgram STT, Groq LLM, and Cartesia TTS. Start the bot with <code className="font-mono">python3 -m bot.bot</code>.
          </span>
        </div>
      </div>

      {/* Error state */}
      {errorMessage ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block">Call Connection Notice</span>
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
                  ? isAssistantSpeaking ? 'bg-indigo-500 animate-bounce' : 'bg-emerald-500 animate-pulse'
                  : callState === 'connecting' || callState === 'requesting_mic'
                  ? 'bg-amber-500 animate-ping'
                  : callState === 'reported'
                  ? 'bg-blue-500'
                  : 'bg-neutral-400'
              }`}
            />
            <span className="capitalize">
              {callState === 'live' && isAssistantSpeaking ? 'Assistant Speaking...' : callState.replace('_', ' ')}
            </span>
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

        {/* Live Speech-to-Text Status & Interim Transcription */}
        {callState === 'live' && (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 text-xs text-neutral-500">
              <Activity className={`w-3.5 h-3.5 ${isSpeechRecognitionActive && !isMuted ? 'text-emerald-500 animate-pulse' : 'text-neutral-400'}`} />
              <span>
                {isMuted
                  ? 'Microphone muted'
                  : isAssistantSpeaking
                  ? 'Assistant speaking (mic speech paused to prevent echo)'
                  : isSpeechRecognitionActive
                  ? 'Speech-to-Text active & listening...'
                  : 'Initializing speech recognition...'}
              </span>
            </div>

            {/* Interim live speech preview */}
            {interimTranscript && (
              <div className="p-2.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl text-xs text-emerald-900 animate-pulse text-left flex items-start gap-2">
                <Mic className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 block">Hearing speech:</span>
                  <span>"{interimTranscript}"</span>
                </div>
              </div>
            )}

            {speechRecognitionError && (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 text-left">
                {speechRecognitionError} (You can also type your turn below).
              </div>
            )}
          </div>
        )}

        {/* Real-time Turn Telemetry Pill */}
        {latestMetrics ? (
          <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl flex items-center justify-around text-xs font-mono text-neutral-600">
            <div className="flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>STT: <strong className="text-neutral-900">{latestMetrics.stt_ms}ms</strong></span>
            </div>
            <div>
              LLM TTFB: <strong className="text-neutral-900">{latestMetrics.llm_ttfb_ms}ms</strong>
            </div>
            <div>
              TTS TTFB: <strong className="text-neutral-900">{latestMetrics.tts_ttfb_ms}ms</strong>
            </div>
            <div className="text-indigo-600 font-semibold">
              V2V: {latestMetrics.voice_to_voice_ms}ms
            </div>
          </div>
        ) : null}

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

        {/* Live Conversation Transcript */}
        {callState === 'live' && (
          <div className="pt-4 border-t border-neutral-100 text-left space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Live Transcript</h3>
            <div className="max-h-56 overflow-y-auto space-y-2.5 pr-1 text-xs">
              {transcript.length === 0 ? (
                <p className="text-neutral-400 italic text-center py-4">
                  Speak into your microphone or click a prompt below to begin talking...
                </p>
              ) : (
                transcript.map((t, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl flex items-start gap-2.5 ${
                      t.role === 'user'
                        ? 'bg-neutral-100 ml-8 text-neutral-900'
                        : 'bg-indigo-50/70 border border-indigo-100 mr-8 text-indigo-950'
                    }`}
                  >
                    {t.role === 'assistant' ? (
                      <Volume2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    ) : (
                      <Mic className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-semibold capitalize text-[10px] text-neutral-500 mb-0.5">
                        {t.role}
                      </div>
                      <p className="text-xs leading-relaxed">{t.text}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Quick Test Chips */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-medium text-neutral-400">Quick Test Prompts:</span>
              <div className="flex flex-wrap gap-1.5">
                {quickPrompts.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => sendTurnText(q)}
                    className="px-2.5 py-1 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-lg transition-colors"
                  >
                    "{q}"
                  </button>
                ))}
              </div>
            </div>

            {/* Text Input Option for Quiet Environments */}
            <form onSubmit={handleSendInput} className="flex gap-2 pt-2">
              <input
                type="text"
                value={inputTurn}
                onChange={(e) => setInputTurn(e.target.value)}
                placeholder="Or type a question to test conversational turn..."
                className="flex-1 px-3 py-2 text-xs bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-neutral-900"
              />
              <button
                type="submit"
                disabled={!inputTurn.trim()}
                className="px-3 py-2 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>
        )}

        {callState === 'reported' ? (
          <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg text-xs text-neutral-600">
            Session ended. Ingestion payload dispatched to Cloudflare Worker. Loading call details...
          </div>
        ) : null}
      </div>
    </div>
  );
};
