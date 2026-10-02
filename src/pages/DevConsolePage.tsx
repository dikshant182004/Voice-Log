import React, { useState } from 'react';
import { Terminal, Copy, Check, ShieldCheck, Activity, Database } from 'lucide-react';

export const DevConsolePage: React.FC = () => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const curlExamples = [
    {
      title: '1. Ingest Finished Call (Bot -> Cloudflare Worker)',
      desc: 'Authenticated with Bearer token. Idempotent: duplicate POST returns 200 { duplicate: true } without inserting twice.',
      cmd: `curl -X POST https://mini-call-log-worker.<subdomain>.workers.dev/calls \\
  -H "Authorization: Bearer <INGEST_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "call_id": "9b2c3d4e-5f6a-4b7c-8d9e-0123456789ab",
    "started_at": "2026-10-02T10:00:00.000Z",
    "ended_at": "2026-10-02T10:01:30.000Z",
    "duration_ms": 90000,
    "status": "completed",
    "end_reason": "user_hangup",
    "config": { "stt": "deepgram:nova-3-general", "llm": "groq:openai/gpt-oss-20b", "tts": "cartesia:sonic-3.6", "persona": "default" },
    "transcript": [
      { "turn_index": 0, "role": "user", "text": "What is the return window?", "ts_ms": 1100, "interrupted": false },
      { "turn_index": 1, "role": "assistant", "text": "You can return items within 30 days.", "ts_ms": 1780, "interrupted": false }
    ],
    "metrics": [
      { "turn_index": 1, "stt_ms": 130, "llm_ttfb_ms": 190, "tts_ttfb_ms": 110, "voice_to_voice_ms": 680 }
    ],
    "usage": { "llm_input_tokens": 85, "llm_output_tokens": 42, "tts_chars": 68 }
  }'`,
    },
    {
      title: '2. List Calls with Cursor Pagination',
      desc: 'Retrieves call summaries ordered by started_at DESC. Does not load transcripts for maximum throughput.',
      cmd: `curl -X GET "https://mini-call-log-worker.<subdomain>.workers.dev/calls?limit=20"`,
    },
    {
      title: '3. Get Call Detail (Transcript, Metrics, and Evaluation)',
      desc: 'Fetches complete turn transcript with interrupted flags and per-turn latency breakdown.',
      cmd: `curl -X GET "https://mini-call-log-worker.<subdomain>.workers.dev/calls/9b2c3d4e-5f6a-4b7c-8d9e-0123456789ab"`,
    },
    {
      title: '4. Get Aggregate Latency Analytics (Advanced Feature 1)',
      desc: 'Fetches p50/p95 percentiles across STT, LLM TTFB, TTS TTFB, and Voice-to-Voice over the last N days.',
      cmd: `curl -X GET "https://mini-call-log-worker.<subdomain>.workers.dev/stats?days=7"`,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">API Reference & Cloudflare Observability</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Single source of truth REST API contracts implemented on Cloudflare Workers and D1 database.
        </p>
      </div>

      {/* Cloudflare Observability & Logging Architecture */}
      <div className="bg-white border border-neutral-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-600" />
          <h2 className="text-sm font-semibold text-neutral-900">Observability in Cloudflare Dashboard</h2>
        </div>
        <p className="text-xs text-neutral-600 leading-relaxed">
          The Worker emits <strong>structured JSON logs</strong> per request and per lifecycle event.
          Filter by <code className="font-mono bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-800">call_id</code> in the Cloudflare Dashboard to trace any call from ingestion to persistence and evaluation:
        </p>

        <div className="bg-neutral-950 text-neutral-200 rounded-lg p-4 font-mono text-xs overflow-x-auto space-y-1">
          <div><span className="text-neutral-500"># Cloudflare Worker Structured Log Output:</span></div>
          <div>{`{"level":"info","request_id":"c8a19","event":"call.received","call_id":"9b2c3...","metadata":{"status":"completed","turns":6}}`}</div>
          <div>{`{"level":"info","request_id":"c8a19","event":"call.persisted","call_id":"9b2c3..."}`}</div>
          <div>{`{"level":"info","request_id":"c8a19","method":"POST","route":"/calls","status":201,"duration_ms":3.42,"call_id":"9b2c3..."}`}</div>
          <div>{`{"level":"info","request_id":"c8a19","event":"call.eval_completed","call_id":"9b2c3...","metadata":{"sentiment":"positive","task_completion":5}}`}</div>
        </div>
      </div>

      {/* Local Bot Execution Commands */}
      <div className="bg-white border border-neutral-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-sky-600" />
          <h2 className="text-sm font-semibold text-neutral-900">How to Run the Voice Bot Locally</h2>
        </div>
        <p className="text-xs text-neutral-600">
          The Pipecat voice pipeline runs locally, connecting to browser WebRTC audio and ingesting finished calls to the Worker:
        </p>

        <div className="bg-neutral-950 text-neutral-200 rounded-lg p-4 font-mono text-xs overflow-x-auto space-y-2">
          <div><span className="text-emerald-400"># 1. Install bot dependencies:</span></div>
          <div>pip install -r bot/requirements.txt</div>
          <div className="pt-1"><span className="text-emerald-400"># 2. Run unit tests:</span></div>
          <div>python3 bot/tests/run_tests.py</div>
          <div className="pt-1"><span className="text-emerald-400"># 3. Start local WebRTC signaling server:</span></div>
          <div>python3 -m bot.bot</div>
          <div className="pt-1"><span className="text-emerald-400"># 4. Flush any offline spooled calls:</span></div>
          <div>python3 -m bot.reporter --flush</div>
        </div>
      </div>

      {/* Curl Commands */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-neutral-900">cURL API Testing Examples</h2>
        {curlExamples.map((item, idx) => (
          <div key={idx} className="bg-white border border-neutral-200 rounded-xl p-5 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-neutral-900">{item.title}</h3>
              <button
                onClick={() => copyToClipboard(item.cmd, idx)}
                className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 px-2 py-1 rounded transition-colors"
              >
                {copiedIndex === idx ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy cURL</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-neutral-500">{item.desc}</p>
            <pre className="bg-neutral-900 text-neutral-200 p-3 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre">
              {item.cmd}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
};
