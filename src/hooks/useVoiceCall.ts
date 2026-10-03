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
  const [durationSeconds, setDurationSeconds] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<TurnData[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [latestMetrics, setLatestMetrics] = useState<TurnMetrics | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const clientRef = useRef<PipecatClient | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const callIdRef = useRef<string | null>(null);
  const callStateRef = useRef<CallState>('idle');
  const isMutedRef = useRef<boolean>(false);
  const isAssistantSpeakingRef = useRef<boolean>(false);

  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isAssistantSpeakingRef.current = isAssistantSpeaking;
  }, [isAssistantSpeaking]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (clientRef.current) {
        clientRef.current.disconnect().catch(() => {});
        clientRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current = null;
      }
    };
  }, [stopSpeechRecognition]);

  const endCall = useCallback(async () => {
    if (callState === 'idle' || callState === 'ending' || callState === 'reported') {
      return;
    }

    const wasLiveCall = callState === 'live' && durationSeconds > 0;
    setCallState('ending');
    setInterimTranscript('');
    stopSpeechRecognition();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const currentCallId = callIdRef.current;

    // Disconnect Pipecat WebRTC client
    if (clientRef.current) {
      try {
        await clientRef.current.disconnect();
      } catch (err) {
        // Suppress benign stop() / disconnect transport errors
      }
      clientRef.current = null;
    }

    // Clean up Web Audio and Remote Audio
    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setAnalyser(null);
    setIsAssistantSpeaking(false);

    // Notify bot to finalize session and report to Cloudflare Worker
    if (currentCallId) {
      const botUrl = (import.meta.env.VITE_BOT_URL || 'http://localhost:8765').replace(/\/+$/, '');
      try {
        await fetch(`${botUrl}/hangup/${currentCallId}`, { method: 'POST' });
      } catch (err) {
        // Benign notice if bot is offline
      }
    }

    setCallState('reported');

    // ONLY automatically navigate to CallDetailPage if the call actually connected and had duration
    // This prevents 404 fetch loops for calls that failed to connect
    if (wasLiveCall && currentCallId && onCallReported) {
      onCallReported(currentCallId);
    }
  }, [callState, durationSeconds, onCallReported, stopSpeechRecognition]);

  const startCall = useCallback(async () => {
    try {
      setErrorMessage(null);
      setCallState('requesting_mic');
      setDurationSeconds(0);
      setTranscript([]);
      setInterimTranscript('');
      setLatestMetrics(null);
      setIsAssistantSpeaking(false);

      const botUrl = (import.meta.env.VITE_BOT_URL || 'http://localhost:8765').replace(/\/+$/, '');

      // 1. Request microphone permission and attach real Web Audio AnalyserNode
      const userMediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(userMediaStream);
      const analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 64;
      source.connect(analyserNode);
      setAnalyser(analyserNode);

      setCallState('connecting');

      // 2. Instantiate SmallWebRTCTransport connecting to the local Pipecat bot
      const newCallId = crypto.randomUUID();
      setCallId(newCallId);
      callIdRef.current = newCallId;

      const transport = new SmallWebRTCTransport({
        webrtcRequestParams: {
          endpoint: `${botUrl}/offer`,
          requestData: {
            call_id: newCallId,
          },
        },
      });

      // 3. Helper to append turns safely
      const appendTurn = (role: 'user' | 'assistant', text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
        setTranscript((prev) => {
          if (
            prev.length > 0 &&
            prev[prev.length - 1].role === role &&
            prev[prev.length - 1].text.toLowerCase() === trimmed.toLowerCase()
          ) {
            return prev;
          }
          return [...prev, { role, text: trimmed, ts_ms: elapsed }];
        });
      };

      // 4. Instantiate PipecatClient with comprehensive callbacks for RTVI events
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
            appendTurn('assistant', data?.text || '');
          },
          onMetrics: (data: any) => {
            if (!data) return;
            const newMetrics: TurnMetrics = {};
            if (Array.isArray(data.ttfb)) {
              for (const item of data.ttfb) {
                const val = Math.round(item.value * 1000);
                if (item.processor?.includes('stt') || item.processor?.includes('deepgram')) {
                  newMetrics.stt_ms = val;
                } else if (item.processor?.includes('llm') || item.processor?.includes('groq')) {
                  newMetrics.llm_ttfb_ms = val;
                } else if (item.processor?.includes('tts') || item.processor?.includes('cartesia')) {
                  newMetrics.tts_ttfb_ms = val;
                }
              }
            }
            if (Object.keys(newMetrics).length > 0) {
              setLatestMetrics((prev) => ({ ...prev, ...newMetrics }));
            }
          },
        },
      });
      clientRef.current = client;

      // 5. Wire RTVI Event listeners
      client.on(RTVIEvent.TransportStateChanged, (state: TransportState) => {
        if (state === 'connected' || state === 'ready') {
          setCallState('live');
          if (!startTimeRef.current) startTimeRef.current = Date.now();
        } else if (state === 'disconnected') {
          setCallState((prev) => (prev === 'live' ? 'ending' : prev));
        } else if (state === 'error') {
          console.warn('Pipecat transport state: error');
        }
      });

      client.on(RTVIEvent.BotReady, () => {
        setCallState('live');
        startTimeRef.current = Date.now();
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = window.setInterval(() => {
          setDurationSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);
      });

      client.on(RTVIEvent.BotStartedSpeaking, () => {
        setIsAssistantSpeaking(true);
      });

      client.on(RTVIEvent.BotStoppedSpeaking, () => {
        setIsAssistantSpeaking(false);
      });

      client.on(RTVIEvent.UserStartedSpeaking, () => {
        if (isAssistantSpeakingRef.current) {
          setTranscript((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], interrupted: true };
            }
            return updated;
          });
        }
      });

      client.on(RTVIEvent.UserTranscript, (data: any) => {
        if (data?.final) {
          appendTurn('user', data.text || '');
          setInterimTranscript('');
        } else if (data?.text) {
          setInterimTranscript(data.text);
        }
      });

      client.on(RTVIEvent.BotTranscript, (data: any) => {
        appendTurn('assistant', data?.text || '');
      });

      client.on(RTVIEvent.BotOutput, (data: any) => {
        appendTurn('assistant', data?.text || '');
      });

      // Remote audio playback from Pipecat WebRTC
      client.on(RTVIEvent.TrackStarted, (track: MediaStreamTrack) => {
        if (track.kind === 'audio') {
          let audioEl = remoteAudioRef.current;
          if (!audioEl) {
            audioEl = new Audio();
            audioEl.autoplay = true;
            remoteAudioRef.current = audioEl;
          }
          audioEl.srcObject = new MediaStream([track]);
          audioEl.play().catch((playErr) => {
            console.warn('Remote audio playback notice:', playErr);
          });
        }
      });

      client.on(RTVIEvent.Error, (message: any) => {
        console.warn('Pipecat RTVI notice:', message);
      });

      // 6. Initialize media devices & connect
      await client.initDevices();
      await client.connect();

    } catch (err: any) {
      console.warn('Voice call connection notice:', err?.message || err);

      // Clean up client gracefully without throwing unhandled exceptions
      if (clientRef.current) {
        try {
          await clientRef.current.disconnect();
        } catch (_) {}
        clientRef.current = null;
      }

      const botUrl = (import.meta.env.VITE_BOT_URL || 'http://localhost:8765').replace(/\/+$/, '');

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
        setAnalyser(null);
        setCallState('error');
        setErrorMessage('Microphone access denied. Please grant microphone permission in your browser.');
      } else {
        setErrorMessage(err?.message || `Pipecat WebRTC signaling server at ${botUrl} is not reachable.`);
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    if (clientRef.current) {
      try {
        clientRef.current.enableMic(!nextMuted);
      } catch (_) {}
    }

  }, [isMuted]);

  const sendTurnText = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const trimmed = text.trim();
    const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
    setTranscript((prev) => [...prev, { role: 'user', text: trimmed, ts_ms: elapsed }]);
    setInterimTranscript('');

    if (clientRef.current) {
      try {
        await clientRef.current.sendText(trimmed);
      } catch (err: any) {
        console.warn('Failed to send text to Pipecat bot:', err);
      }
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
