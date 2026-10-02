import { useState, useRef, useCallback, useEffect } from 'react';

export type CallState = 'idle' | 'requesting_mic' | 'connecting' | 'live' | 'ending' | 'reported' | 'error';

export interface UseVoiceCallReturn {
  callState: CallState;
  callId: string | null;
  durationSeconds: number;
  isMuted: boolean;
  errorMessage: string | null;
  analyser: AnalyserNode | null;
  startCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
}

export function useVoiceCall(onCallReported?: (callId: string) => void): UseVoiceCallReturn {
  const [callState, setCallState] = useState<CallState>('idle');
  const [callId, setCallId] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const toggleMute = useCallback(() => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  const endCall = useCallback(async () => {
    if (callState === 'idle' || callState === 'ending' || callState === 'reported') return;

    setCallState('ending');
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop microphone tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Close WebRTC peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Close Audio Context
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setAnalyser(null);

    const finishedCallId = callId;
    setCallState('reported');

    if (finishedCallId && onCallReported) {
      onCallReported(finishedCallId);
    }
  }, [callState, callId, onCallReported]);

  const startCall = useCallback(async () => {
    try {
      setErrorMessage(null);
      setCallState('requesting_mic');
      setDurationSeconds(0);

      const botUrl = import.meta.env.VITE_BOT_URL || 'http://127.0.0.1:8765';

      // 1. Request actual browser microphone with hardware echo cancellation
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // 2. Set up Web Audio Analyser for honest live audio visualizer
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 64;
      source.connect(analyserNode);
      setAnalyser(analyserNode);

      setCallState('connecting');

      // 3. Initiate WebRTC peer connection with the Pipecat bot
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peerConnectionRef.current = pc;

      // Add local audio track
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Handle incoming bot audio track
      pc.ontrack = (event) => {
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch((e) => console.warn('Autoplay error for bot audio:', e));
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setCallState('live');
          startTimeRef.current = Date.now();
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = window.setInterval(() => {
            setDurationSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
          }, 1000);
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          endCall();
        }
      };

      // Create WebRTC Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to Pipecat bot server
      const offerRes = await fetch(`${botUrl}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription?.sdp,
          type: pc.localDescription?.type,
        }),
      });

      if (!offerRes.ok) {
        throw new Error(`Bot signaling server rejected offer (HTTP ${offerRes.status}). Ensure the Pipecat bot is running at ${botUrl}.`);
      }

      const answer = await offerRes.json();
      setCallId(answer.call_id);

      await pc.setRemoteDescription(new RTCSessionDescription({
        type: answer.type,
        sdp: answer.sdp,
      }));

    } catch (err: any) {
      console.error('Call initialization failure:', err);
      setCallState('error');

      // Clean up resources on failure
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      setAnalyser(null);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone access denied. Please grant microphone permission in your browser.');
      } else {
        setErrorMessage(err.message || 'Unable to connect to voice agent signaling server.');
      }
    }
  }, [endCall]);

  return {
    callState,
    callId,
    durationSeconds,
    isMuted,
    errorMessage,
    analyser,
    startCall,
    endCall,
    toggleMute,
  };
}
