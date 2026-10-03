import { useState, useRef, useCallback, useEffect } from 'react';
import { PipecatClient, RTVIEvent, TransportState } from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';

export type CallState = 'idle' | 'requesting_mic' | 'connecting' | 'live' | 'ending' | 'reported' | 'error';

export interface TurnData {
  role: 'user' | 'assistant';
  text: string;
  ts_ms?: number;
  interrupted?: boolean;
}

export interface TurnMetrics {
  stt_ms?: number;
  llm_ttfb_ms?: number;
  tts_ttfb_ms?: number;
  voice_to_voice_ms?: number;
}

export interface UseVoiceCallReturn {
  callState: CallState;
  callId: string | null;
  durationSeconds: number;
  isMuted: boolean;
  isAssistantSpeaking: boolean;
  transcript: TurnData[];
  interimTranscript: string;
  latestMetrics: TurnMetrics | null;
  errorMessage: string | null;
  analyser: AnalyserNode | null;
  startCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  sendTurnText: (text: string) => Promise<void>;
}

export function useVoiceCall(onCallReported?: (callId: string) => void): UseVoiceCallReturn {
  const [callState, setCallState] = useState<CallState>('idle');
  const [callId, setCallId] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TurnData[]>([]);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [latestMetrics, setLatestMetrics] = useState<TurnMetrics | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const clientRef = useRef<PipecatClient | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const callIdRef = useRef<string | null>(null);
  const isAssistantSpeakingRef = useRef(false);

  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  useEffect(() => {
    isAssistantSpeakingRef.current = isAssistantSpeaking;
  }, [isAssistantSpeaking]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (clientRef.current) clientRef.current.disconnect().catch(() => {});
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
      }
    };
  }, []);

  const endCall = useCallback(async () => {
    if (callState === 'idle' || callState === 'ending' || callState === 'reported') return;

    const wasLiveCall = callState === 'live' && durationSeconds > 0;
    setCallState('ending');
    setInterimTranscript('');

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const currentCallId = callIdRef.current;

    if (clientRef.current) {
      try {
        await clientRef.current.disconnect();
      } catch (_) {}
      clientRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }

    setAnalyser(null);
    setIsAssistantSpeaking(false);

    if (currentCallId) {
      const botUrl = (import.meta.env.VITE_BOT_URL || 'http://localhost:8765').replace(/\/+$/, '');
      try {
        await fetch(`${botUrl}/hangup/${currentCallId}`, { method: 'POST' });
      } catch (_) {}
    }

    setCallState('reported');

    if (wasLiveCall && currentCallId && onCallReported) {
      onCallReported(currentCallId);
    }
  }, [callState, durationSeconds, onCallReported]);

  const startCall = useCallback(async () => {
    try {
      setErrorMessage(null);
      setCallState('requesting_mic');
      setDurationSeconds(0);
      startTimeRef.current = 0;
      setTranscript([]);
      setInterimTranscript('');
      setLatestMetrics(null);
      setIsAssistantSpeaking(false);

      const botUrl = (import.meta.env.VITE_BOT_URL || 'http://localhost:8765').replace(/\/+$/, '');
      const newCallId = crypto.randomUUID();

      setCallId(newCallId);
      callIdRef.current = newCallId;
      setCallState('connecting');

      // Keep the transport on Pipecat's standard SmallWebRTC flow. The
      // request is supplied to connect(), while initDevices() owns the real
      // browser microphone track.
      const transport = new SmallWebRTCTransport();

      const appendTurn = (role: 'user' | 'assistant', text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;

        const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
        setTranscript((prev) => {
          const last = prev[prev.length - 1];

          // Pipecat can deliver the same RTVI transcript through more than one
          // callback/event surface. De-duplicate exact repeats while preserving
          // legitimate consecutive turns.
          if (last && last.role === role) {
            const lastNorm = last.text.trim().toLowerCase().replace(/\s+/g, ' ');
            const nextNorm = trimmed.toLowerCase().replace(/\s+/g, ' ');

            if (lastNorm === nextNorm) {
              return prev;
            }

            // RTVI may first deliver a partial assistant transcript and then
            // the accumulated/full text. Replace the partial instead of
            // rendering the answer twice.
            if (role === 'assistant' && (nextNorm.startsWith(lastNorm) || lastNorm.startsWith(nextNorm))) {
              const updated = [...prev];
              if (nextNorm.length >= lastNorm.length) {
                updated[updated.length - 1] = { ...last, text: trimmed, ts_ms: elapsed };
              }
              return updated;
            }
          }

          return [...prev, { role, text: trimmed, ts_ms: elapsed }];
        });
      };

      const client = new PipecatClient({
        transport,
        enableMic: true,
        enableCam: false,
        callbacks: {
          onConnected: () => {
            setCallState('live');
            if (!startTimeRef.current) startTimeRef.current = Date.now();
          },
          onUserTranscript: (data: any) => {
            if (data?.final) {
              appendTurn('user', data.text || '');
              setInterimTranscript('');
            } else if (data?.text) {
              setInterimTranscript(data.text);
            }
          },
          onBotTranscript: (data: any) => {
            const text = String(data?.text || '').trim();
            if (!text) return;
            setTranscript((prev) => {
              const normalized = text.toLowerCase().replace(/\s+/g, ' ');
              if (prev.some((turn) =>
                turn.role === 'assistant' &&
                turn.text.trim().toLowerCase().replace(/\s+/g, ' ') === normalized
              )) {
                return prev;
              }
              const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
              return [...prev, { role: 'assistant', text, ts_ms: elapsed }];
            });
          },
          onMetrics: (data: any) => {
            if (!data) return;
            const next: TurnMetrics = {};
            if (Array.isArray(data.ttfb)) {
              for (const item of data.ttfb) {
                const val = Math.round(Number(item.value) * 1000);
                const processor = String(item.processor || '').toLowerCase();
                if (processor.includes('stt') || processor.includes('deepgram')) {
                  next.stt_ms = val;
                } else if (processor.includes('llm') || processor.includes('groq')) {
                  next.llm_ttfb_ms = val;
                } else if (processor.includes('tts') || processor.includes('cartesia')) {
                  next.tts_ttfb_ms = val;
                }
              }
            }
            if (Object.keys(next).length) {
              setLatestMetrics((prev) => ({ ...(prev || {}), ...next }));
            }
          },
        },
      });
      clientRef.current = client;

      client.on(RTVIEvent.TransportStateChanged, (state: TransportState) => {
        if (state === 'connected' || state === 'ready') {
          setCallState('live');
          if (!startTimeRef.current) startTimeRef.current = Date.now();
        } else if (state === 'disconnected') {
          setCallState((prev) => (prev === 'live' ? 'ending' : prev));
        } else if (state === 'error') {
          setErrorMessage('Pipecat transport reported an error. Check the bot terminal for the underlying service error.');
        }
      });

      client.on(RTVIEvent.BotReady, () => {
        setCallState('live');
        if (!startTimeRef.current) startTimeRef.current = Date.now();
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = window.setInterval(() => {
          setDurationSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);
      });

      client.on(RTVIEvent.BotStartedSpeaking, () => setIsAssistantSpeaking(true));
      client.on(RTVIEvent.BotStoppedSpeaking, () => setIsAssistantSpeaking(false));

      client.on(RTVIEvent.UserStartedSpeaking, () => {
        console.info('[Pipecat] VAD: user started speaking');
        if (isAssistantSpeakingRef.current) {
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, interrupted: true };
            return updated;
          });
        }
      });

      client.on(RTVIEvent.UserStoppedSpeaking, () => {
        console.info('[Pipecat] VAD: user stopped speaking');
      });

      // IMPORTANT: Do not also register UserTranscript/BotTranscript/BotOutput
      // event listeners here. The client callbacks above receive the same RTVI
      // transcript events; registering both caused every answer to appear twice.

      client.on(RTVIEvent.TrackStarted, (track: MediaStreamTrack, participant?: any) => {
        // Never play the local microphone track back through an audio element.
        if (track.kind !== 'audio' || participant?.local) return;
        let audioEl = remoteAudioRef.current;
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
          audioEl.playsInline = true;
          remoteAudioRef.current = audioEl;
        }
        audioEl.srcObject = new MediaStream([track]);
        audioEl.play().catch(() => {});
      });

      client.on(RTVIEvent.Error, (message: any) => {
        console.warn('Pipecat RTVI notice:', message);
      });

      // PipecatClient owns the real microphone track. Do not open a second
      // getUserMedia() stream here: a second capture path can make debugging
      // echo/VAD behavior much harder and is not the audio sent to Pipecat.
      await client.initDevices();
      console.info('[Pipecat] microphone enabled:', client.isMicEnabled);
      await client.connect({
        webrtcRequestParams: {
          endpoint: `${botUrl}/offer`,
          requestData: { call_id: newCallId },
        },
      });
    } catch (err: any) {
      console.warn('Voice call connection notice:', err?.message || err);

      if (clientRef.current) {
        try {
          await clientRef.current.disconnect();
        } catch (_) {}
        clientRef.current = null;
      }

      const botUrl = (import.meta.env.VITE_BOT_URL || 'http://localhost:8765').replace(/\/+$/, '');
      setCallState('error');

      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone access denied. Please grant microphone permission in your browser.');
      } else {
        setErrorMessage(err?.message || `Pipecat WebRTC signaling server at ${botUrl} is not reachable.`);
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    try {
      clientRef.current?.enableMic(!nextMuted);
    } catch (_) {}
  }, [isMuted]);

  const sendTurnText = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const trimmed = text.trim();
    const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
    setTranscript((prev) => [...prev, { role: 'user', text: trimmed, ts_ms: elapsed }]);
    setInterimTranscript('');

    try {
      await clientRef.current?.sendText(trimmed);
    } catch (err: any) {
      console.warn('Failed to send text to Pipecat bot:', err);
    }
  }, []);

  return {
    callState,
    callId,
    durationSeconds,
    isMuted,
    isAssistantSpeaking,
    transcript,
    interimTranscript,
    latestMetrics,
    errorMessage,
    analyser,
    startCall,
    endCall,
    toggleMute,
    sendTurnText,
  };
}
