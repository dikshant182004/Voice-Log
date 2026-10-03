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
  isSpeechRecognitionActive: boolean;
  speechRecognitionError: string | null;
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
  const isAssistantSpeakingRef = useRef<boolean>(false);

  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

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
  }, []);

  const endCall = useCallback(async () => {
    if (callState === 'idle' || callState === 'ending' || callState === 'reported') {
      return;
    }

    setCallState('ending');
    setInterimTranscript('');

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
        console.warn('Pipecat disconnect notice:', err);
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
        console.warn('Bot hangup notification notice (bot will finalize upon WebRTC close):', err);
      }
    }

    setCallState('reported');

    if (currentCallId && onCallReported) {
      onCallReported(currentCallId);
    }
  }, [callState, onCallReported]);

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

      // 1. Request microphone permission and create audio analyser for real visualizer
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

      // 3. Instantiate PipecatClient
      const client = new PipecatClient({
        transport,
        enableMic: true,
        enableCam: false,
      });
      clientRef.current = client;

      // 4. Wire Pipecat RTVI Events
      client.on(RTVIEvent.TransportStateChanged, (state: TransportState) => {
        if (state === 'connected' || state === 'ready') {
          setCallState('live');
        } else if (state === 'disconnected') {
          setCallState((prev) => (prev === 'live' ? 'ending' : prev));
        } else if (state === 'error') {
          setCallState('error');
          setErrorMessage('Pipecat WebRTC transport connection encountered an error.');
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
        // If user interrupts while assistant is speaking, mark interruption
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

      // Streaming STT from Deepgram via Pipecat RTVI protocol
      client.on(RTVIEvent.UserTranscript, (data: any) => {
        if (data?.final) {
          const text = (data.text || '').trim();
          if (text) {
            const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
            setTranscript((prev) => [...prev, { role: 'user', text, ts_ms: elapsed }]);
          }
          setInterimTranscript('');
        } else if (data?.text) {
          setInterimTranscript(data.text);
        }
      });

      // Bot speech transcription
      client.on(RTVIEvent.BotTranscript, (data: any) => {
        const text = (data?.text || '').trim();
        if (text) {
          const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
          setTranscript((prev) => [...prev, { role: 'assistant', text, ts_ms: elapsed }]);
        }
      });

      client.on(RTVIEvent.BotOutput, (data: any) => {
        const text = (data?.text || '').trim();
        if (text) {
          const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
          setTranscript((prev) => {
            // Avoid duplicate if botTranscript already captured it
            if (prev.length > 0 && prev[prev.length - 1].role === 'assistant' && prev[prev.length - 1].text === text) {
              return prev;
            }
            return [...prev, { role: 'assistant', text, ts_ms: elapsed }];
          });
        }
      });

      // Latency telemetry metrics from Pipecat pipeline
      client.on(RTVIEvent.Metrics, (data: any) => {
        if (!data) return;
        const newMetrics: TurnMetrics = {};

        // Parse TTFB metrics (STT, LLM, TTS)
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

        if (Array.isArray(data.processing)) {
          for (const item of data.processing) {
            const val = Math.round(item.value * 1000);
            if (item.processor?.includes('stt') && !newMetrics.stt_ms) {
              newMetrics.stt_ms = val;
            } else if (item.processor?.includes('llm') && !newMetrics.llm_ttfb_ms) {
              newMetrics.llm_ttfb_ms = val;
            } else if (item.processor?.includes('tts') && !newMetrics.tts_ttfb_ms) {
              newMetrics.tts_ttfb_ms = val;
            }
          }
        }

        if (newMetrics.stt_ms && newMetrics.llm_ttfb_ms && newMetrics.tts_ttfb_ms) {
          newMetrics.voice_to_voice_ms = newMetrics.stt_ms + newMetrics.llm_ttfb_ms + newMetrics.tts_ttfb_ms;
        }

        if (Object.keys(newMetrics).length > 0) {
          setLatestMetrics((prev) => ({ ...prev, ...newMetrics }));
        }
      });

      // Remote audio playback from Pipecat WebRTC
      client.on(RTVIEvent.TrackStarted, (track: MediaStreamTrack, participant: any) => {
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
        console.error('Pipecat RTVI error:', message);
        setErrorMessage(typeof message?.data === 'string' ? message.data : 'Voice pipeline encountered an error.');
      });

      // 5. Initialize media devices & connect
      await client.initDevices();
      await client.connect();

    } catch (err: any) {
      console.error('Call initialization failure:', err);
      setCallState('error');

      if (clientRef.current) {
        try {
          await clientRef.current.disconnect();
        } catch (_) {}
        clientRef.current = null;
      }

      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      setAnalyser(null);

      const botUrl = (import.meta.env.VITE_BOT_URL || 'http://localhost:8765').replace(/\/+$/, '');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone access denied. Please grant microphone permission in your browser.');
      } else if (err.message && !err.message.includes('[object Object]')) {
        setErrorMessage(`Call connection error: ${err.message}. Please verify the Python bot is running at ${botUrl}.`);
      } else {
        setErrorMessage(
          `Unable to connect to Pipecat voice bot at ${botUrl}. Please verify the Python bot is running with "python3 -m bot.bot" and that your Deepgram, Groq, and Cartesia API keys are configured in .env.`
        );
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (clientRef.current) {
      const nextMuted = !isMuted;
      clientRef.current.enableMic(!nextMuted);
      setIsMuted(nextMuted);
    }
  }, [isMuted]);

  const sendTurnText = useCallback(async (text: string) => {
    if (!text.trim() || !clientRef.current) return;
    try {
      await clientRef.current.sendText(text.trim());
      const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
      setTranscript((prev) => [...prev, { role: 'user', text: text.trim(), ts_ms: elapsed }]);
      setInterimTranscript('');
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
    isSpeechRecognitionActive: callState === 'live' && !isMuted,
    speechRecognitionError: null,
    latestMetrics,
    errorMessage,
    analyser,
    startCall,
    endCall,
    toggleMute,
    sendTurnText,
  };
}
