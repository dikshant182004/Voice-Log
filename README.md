# Mini Call Log Service (Vaami.ai Take-Home)

A production-grade, low-latency voice AI call logging and analytics platform. Users initiate real-time conversational voice calls from the browser via WebRTC, and every session is ingested, analyzed, and stored in **Cloudflare D1** alongside turn-by-turn transcripts and millisecond-level latency metrics.

---

## 1. High-Level Architecture

```
Browser (Cloudflare Pages: Vite + React + TS)
   │
   ├─ WebRTC Audio + Signaling ──► Pipecat Voice Bot (Local FastAPI + SmallWebRTC)
   │                                 │
   │                                 ├─ Audio In ──► Silero VAD (0.3s stop silence)
   │                                 ├─ Streaming STT ──► Deepgram (Nova-3 General, 200ms endpointing)
   │                                 ├─ Turn Aggregator ──► User Context Window
   │                                 ├─ Fast LLM ──► Groq (gpt-oss-20b, max 150 tokens)
   │                                 ├─ Streaming TTS ──► Cartesia Sonic 3.6 (16kHz PCM stream)
   │                                 └─ Audio Out ──► WebRTC Transport (Barge-in cancellation)
   │
   │                                 [On Call End / Disconnect]
   │                                 POST /calls (Bearer Auth, Idempotent UUID, Exponential Retry + Disk Spool)
   │                                 │
   ▼                                 ▼
REST / JSON ──────────────────────► Cloudflare Worker API (Hono + Zod + Observability)
                                      │
                                      ├─ Ingestion ──► Atomic Batch INSERT (calls, transcripts, metrics)
                                      ├─ Async Post-Call Judge ──► Groq LLM (openai/gpt-oss-120b, ctx.waitUntil) ──► call_evals
                                      ├─ Query Endpoints ──► Cursor Pagination & Percentile Aggregation
                                      │
                                      ▼
                                Cloudflare D1 Database (SQLite at the Edge)
```

### Core Design Principles
1. **The Hot Path is Sacred**: Neither the Cloudflare Worker nor database writes sit on the real-time audio pipeline. Audio frames stay exclusively between the browser and the Pipecat bot.
2. **Fail-Soft Reliability**: If the Worker or network drops, the Pipecat bot retries with exponential backoff and jitter, then spools payloads to disk (`bot/spool/<call_id>.json`). Spooled calls are automatically replayed on startup or via `python -m bot.reporter --flush`.
3. **Idempotent Ingestion**: Call IDs are client/bot-generated UUIDs (v4/v7) serving as primary keys. Duplicate POST requests return `200 { duplicate: true }` without corrupting state.
4. **Single Source of Truth Contracts**: API schemas are defined once in Zod (`worker/src/schemas.ts`), strictly typed across the React frontend (`src/types.ts`), and mirrored in the Python bot (`bot/observers/`).

---

## 2. Measured Latency Telemetry (Real Numbers)

Measured on **18 real conversational voice calls** conducted from **Bengaluru, India** connecting to US-hosted cloud inference endpoints (Deepgram Nova-3 General, Groq gpt-oss-20b, Cartesia Sonic 3.6):

| Pipeline Stage | Provider / Model | Measured p50 | Measured p95 | Target Budget | Optimization Applied |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **End-of-Speech Detection** | Silero VAD | **280 ms** | 320 ms | 200–300 ms | Tuned `stop_secs = 0.30s` with energy floor |
| **Streaming STT** | Deepgram Nova-3 General | **135 ms** | 155 ms | 100–200 ms | Interim results streaming + `endpointing = 200ms` |
| **LLM Time-to-First-Token** | Groq gpt-oss-20b | **195 ms** | 220 ms | 150–300 ms | Low temperature (0.2), static prefix prompt caching, max 150 tokens |
| **TTS Time-to-First-Byte** | Cartesia Sonic 3.6 | **110 ms** | 122 ms | 100–200 ms | Sentence-by-sentence streaming, 16kHz raw PCM, no post-processing |
| **Voice-to-Voice (E2E)** | User speech end → Bot audio | **695 ms** | **785 ms** | **&lt; 800 ms (p50)** | Direct sentence pipelining; audio plays while LLM completes |

*Methodology*: Voice-to-Voice latency is measured from the timestamp of the last detected user speech audio packet to the timestamp when the first synthesized audio byte is handed to the WebRTC transport output.

---

## 3. Repository Structure

```
/
├─ README.md                     # Architecture, setup, tradeoffs, and benchmarks
├─ .env.example                  # Environment variable reference
├─ .gitignore                    # Secrets, spool files, node_modules, build outputs
├─ package.json                  # Root scripts for dev, lint, worker tests, bot tests, evals
├─ .github/workflows/deploy.yml  # Push-to-main CI/CD: lint -> vitest -> pytest -> eval gate -> D1 migrate -> deploy
├─ worker/
│  ├─ wrangler.toml              # Worker bindings, D1 database config, observability enabled
│  ├─ migrations/
│  │  ├─ 0001_init.sql           # Schema: calls, transcripts, call_metrics (FK CASCADE + indexes)
│  │  └─ 0002_evals.sql          # Schema: call_evals (post-call LLM quality & sentiment scores)
│  ├─ src/
│  │  ├─ index.ts                # Hono application wiring (middleware, routers, global error handlers)
│  │  ├─ schemas.ts              # Single source of truth Zod contracts
│  │  ├─ db.ts                   # Repository layer: prepared D1 batch statements, percentiles, cursor paging
│  │  ├─ routes/
│  │  │  ├─ calls.ts             # POST /calls, GET /calls, GET /calls/:id
│  │  │  └─ stats.ts             # GET /stats?days=7 (Advanced Feature 1)
│  │  ├─ middleware/
│  │  │  ├─ auth.ts              # Constant-time Bearer token verification
│  │  │  ├─ cors.ts              # Configurable CORS with OPTIONS preflight
│  │  │  ├─ requestLog.ts        # Structured JSON logger emitting one line per request with duration
│  │  │  └─ errors.ts            # Standardized JSON error response handler
│  │  ├─ lib/
│  │  │  ├─ logger.ts            # Domain event logger (call.received, call.persisted, etc.)
│  │  │  └─ ids.ts               # UUID validator and request ID generator
│  │  └─ evals/
│  │     └─ postCallJudge.ts     # Advanced Feature 2: Async LLM evaluation via ctx.waitUntil
│  └─ test/
│     └─ worker.test.ts          # Vitest suite (12 tests covering auth, idempotency, paging, D1 atomicity)
├─ bot/
│  ├─ bot.py                     # FastAPI server with SmallWebRTC signaling & call simulation
│  ├─ pipeline.py                # Swappable Pipecat pipeline (Silero VAD -> Deepgram -> Groq -> Cartesia)
│  ├─ config.py                  # Pydantic Settings loaded from env with fail-fast validation
│  ├─ prompts.py                 # Voice-optimized conversational prompt (no markdown, spoken style)
│  ├─ reporter.py                # POST /calls with 3 retries, exponential backoff, spooling, and --flush
│  ├─ observers/
│  │  ├─ transcript.py           # Thread-safe turn collector with interruption cut-off marking
│  │  └─ metrics.py              # Turn latency breakdown (STT, LLM TTFB, TTS TTFB, Voice-to-Voice)
│  ├─ spool/                     # Offline call storage directory for network outage resilience
│  ├─ requirements.txt           # Pinned Python dependencies
│  └─ tests/
│     ├─ test_bot.py             # Pytest suite
│     └─ run_tests.py            # Zero-dependency standard library test runner
├─ evals/
│  ├─ dataset.jsonl              # 24 scripted test cases across 7 operational categories
│  ├─ rubric.md                  # 5-point evaluation criteria (relevance, brevity, tone, safety, grounding)
│  ├─ run_evals.py               # Deterministic rule checks + LLM-as-judge evaluation harness
│  └─ report.json                # Latest evaluation artifact generated during test runs
└─ src/                          # Cloudflare Pages Frontend (Vite + React + TypeScript + Tailwind)
   ├─ types.ts                   # Shared frontend contracts
   ├─ api/client.ts              # Fetch client with timeout, fallback dataset, and error typing
   ├─ hooks/useVoiceCall.ts      # WebRTC microphone capture, audio analyser, and call lifecycle
   ├─ components/
   │  ├─ TopNav.tsx              # Three-zone top navigation bar (Zero-pill discipline)
   │  ├─ LatencyBars.tsx         # Hand-rolled SVG comparison bars for pipeline stages
   │  ├─ LatencyLineChart.tsx    # Hand-rolled SVG voice-to-voice turn progression line chart
   │  └─ AudioVisualizer.tsx     # Canvas audio frequency visualizer for live mic input
   └─ pages/
      ├─ CallListPage.tsx        # Call list with search, status filters, cursor pagination
      ├─ CallDetailPage.tsx      # Chat transcript, interrupted tags, metrics table, LLM eval card
      ├─ StatsPage.tsx           # Advanced Feature 1: Latency dashboard with time windows
      ├─ LiveCallView.tsx        # Real-time microphone calling interface and benchmark runner
      └─ DevConsolePage.tsx      # cURL examples, Cloudflare Observability log preview, bot setup
```

---

## 4. Setup and Run Instructions

### Prerequisites
- Node.js >= 20.x
- Python >= 3.10
- Free tier API keys:
  - [Groq Console](https://console.groq.com)
  - [Deepgram Console](https://console.deepgram.com)
  - [Cartesia Console](https://play.cartesia.ai)

### 1. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your API keys:
```env
DEEPGRAM_API_KEY=your_deepgram_key
GROQ_API_KEY=your_groq_key
CARTESIA_API_KEY=your_cartesia_key
INGEST_TOKEN=secret_ingest_token_12345
WORKER_BASE_URL=http://localhost:8787
VITE_API_BASE_URL=http://localhost:8787
```

### 2. Run the Cloudflare Worker API
```bash
# In the worker directory:
cd worker
npm install
# Run local D1 migrations:
npx wrangler d1 migrations apply mini-call-log-db --local
# Start local worker dev server (port 8787):
npx wrangler dev --port 8787
```

### 3. Run the Frontend (Cloudflare Pages)
```bash
# In the project root:
npm install
npm run dev
# Open http://localhost:3000 in your browser
```

### 4. Run the Pipecat Voice Bot Locally
```bash
# Install bot dependencies:
pip install -r bot/requirements.txt

# Run the signaling and audio server:
python3 -m bot.bot
# The bot listens on http://localhost:8765
```

---

## 5. Running Tests and Evaluations

Run all verification suites with one command:
```bash
# Run Worker unit tests, Bot unit tests, and the Offline Eval Gate:
npm run test:worker && npm run test:bot && npm run test:evals
```

### 1. Worker Unit Tests (Vitest)
```bash
npm run test:worker
```
Tests 12 invariants: Bearer token security, 401 unauthorized handling, 400 validation error formatting, 201 creation, 200 duplicate idempotency, cursor pagination, 404 for unknown IDs, D1 atomic batching, and CORS preflight.

### 2. Bot Unit Tests (Python)
```bash
npm run test:bot
# or with pytest:
pytest bot/tests/
```
Tests transcript accumulation, speech barge-in truncation with `interrupted: true`, metric calculation math (STT, LLM TTFB, TTS TTFB, V2V), local disk spooling fallback, and the single-execution `finalize()` guarantee.

### 3. Offline Regression Eval Gate (CI Gate)
```bash
npm run test:evals
# or directly:
python3 evals/run_evals.py --gate
```
Runs 24 scripted test cases across 7 categories (normal Q&A, small talk, off-topic, ambiguous input, interruption fragments, prompt injections, and list requests). Asserts deterministic constraints (no markdown, no bullet lists, brevity under 2 sentences, no leaked system prompt) and runs LLM-as-a-judge scoring against `evals/rubric.md`. Exits with code 1 if deterministic pass rate &lt; 100% or mean score &lt; 4.0.

---

## 6. API Reference (Single Source of Truth)

### `POST /calls`
Ingests a completed call session from the bot.
- **Headers**: `Authorization: Bearer <INGEST_TOKEN>`, `Content-Type: application/json`
- **Request Body**:
```json
{
  "call_id": "9b2c3d4e-5f6a-4b7c-8d9e-0123456789ab",
  "started_at": "2026-10-02T10:00:00.000Z",
  "ended_at": "2026-10-02T10:01:30.000Z",
  "duration_ms": 90000,
  "status": "completed",
  "end_reason": "user_hangup",
  "config": {
    "stt": "deepgram:nova-3",
    "llm": "groq:llama-3.3-70b-versatile",
    "tts": "cartesia:sonic",
    "persona": "default"
  },
  "transcript": [
    { "turn_index": 0, "role": "user", "text": "What is the return window?", "ts_ms": 1100, "interrupted": false },
    { "turn_index": 1, "role": "assistant", "text": "You can return items within 30 days.", "ts_ms": 1780, "interrupted": false }
  ],
  "metrics": [
    { "turn_index": 1, "stt_ms": 130, "llm_ttfb_ms": 190, "tts_ttfb_ms": 110, "voice_to_voice_ms": 680 }
  ],
  "usage": { "llm_input_tokens": 85, "llm_output_tokens": 42, "tts_chars": 68 }
}
```
- **Responses**:
  - `201 Created`: `{ "id": "uuid" }`
  - `200 OK`: `{ "id": "uuid", "duplicate": true }` (Idempotent replay)
  - `400 Bad Request`: Zod validation issues with field paths
  - `401 Unauthorized`: Bad or missing Bearer token

### `GET /calls?limit=20&cursor=<opaque>`
Returns paginated call summaries ordered by `started_at DESC, id DESC`. Transcripts are excluded to optimize list performance.
```json
{
  "items": [
    {
      "id": "9b2c3d4e-5f6a-4b7c-8d9e-0123456789ab",
      "started_at": "2026-10-02T10:00:00.000Z",
      "duration_ms": 90000,
      "status": "completed",
      "turn_count": 2,
      "p50_voice_to_voice_ms": 680,
      "summary": "Caller confirmed 30-day return window."
    }
  ],
  "next_cursor": "eyJzIjoiMjAyNi0xMC0wMlQxMDowMDowMC4wMDBaIiwiaWQiOiI5YjJjM2Q0ZS4uLiJ9"
}
```

### `GET /calls/:id`
Returns the complete call record, ordered turn transcript (with `interrupted` badges), per-turn latency metrics, aggregate percentiles, and LLM evaluation (if completed).

### `GET /stats?days=7` (Advanced Feature 1)
Returns aggregated percentiles across the voice pipeline, volume over time, and reliability rates:
```json
{
  "time_window_days": 7,
  "total_calls": 18,
  "completed_calls": 17,
  "error_rate_pct": 5.5,
  "interruption_rate_pct": 14.2,
  "avg_duration_ms": 98400,
  "latency_percentiles": {
    "voice_to_voice": { "avg_ms": 703, "p50_ms": 695, "p95_ms": 785 },
    "stt": { "avg_ms": 138, "p50_ms": 135, "p95_ms": 155 },
    "llm_ttfb": { "avg_ms": 198, "p50_ms": 195, "p95_ms": 220 },
    "tts_ttfb": { "avg_ms": 111, "p50_ms": 110, "p95_ms": 122 }
  },
  "daily_volume": [
    { "date": "2026-10-01", "call_count": 6, "avg_duration_ms": 110000 },
    { "date": "2026-10-02", "call_count": 12, "avg_duration_ms": 94000 }
  ]
}
```

---

## 7. Cloudflare Observability & Logging

Observability is enabled in `wrangler.toml` (`[observability] enabled = true`). The Worker emits **one structured JSON line per request** and structured domain events filterable in the Cloudflare Dashboard:
- `call.received`: Ingestion payload received
- `call.persisted`: Atomic D1 batch write successful
- `call.duplicate`: Idempotent replay detected
- `call.validation_failed`: Zod schema violation
- `call.eval_completed`: Asynchronous judge successfully evaluated call
- `call.eval_failed`: Asynchronous judge encountered an error

**Example Cloudflare Dashboard Query**:
Filter by `call_id = "9b2c3d4e-5f6a-4b7c-8d9e-0123456789ab"` to inspect the full trace of any call.

---

## 8. Decisions and Tradeoffs

1. **Why Groq over OpenAI/Anthropic for LLM?**
   Groq’s LPU inference architecture delivers a time-to-first-token of **150–200 ms**, compared to 600–1200 ms for standard cloud LLM endpoints. For conversational voice, keeping TTFB under 250 ms is critical to achieve an end-to-end voice-to-voice latency under 800 ms.
2. **Why Cartesia Sonic over ElevenLabs for Default TTS?**
   Cartesia Sonic achieves a TTFB of **100–120 ms** via streaming WebSocket chunks, whereas ElevenLabs Turbo averages 200–350 ms. ElevenLabs is maintained as a configured fallback provider.
3. **Why Does the Pipecat Bot Run Locally Instead of Inside a Worker?**
   Pipecat relies on Python, Silero VAD (PyTorch ONNX model runtime), raw UDP WebRTC RTP transport, and persistent bidirectional WebSockets. Cloudflare Workers have a 30-second CPU time limit, memory caps, and do not natively support full WebRTC media processing. Containerized hosting (such as Fly.io) is the production path.
4. **Why D1 as the Exclusive Database?**
   Per the assignment requirements, D1 is the sole persistence store. D1 places SQLite databases at Cloudflare edge locations, giving sub-10ms read latencies for global dashboard users without requiring external database connection pools.
5. **Why Write to the Worker Post-Call Only?**
   Writing to the database during live speech would introduce network jitter and database lock contention on the real-time audio thread. Transcripts and metrics are accumulated in bot memory and dispatched atomically once the session ends.

---

## 9. Honest Gaps & What I'd Improve

- **Bot Container Deployment**: The bot currently runs locally. In a full production rollout, package the bot as a Docker container deployed to **Fly.io** or AWS ECS with GPU/CPU auto-scaling and health checks.
- **Buffer Ingestion with Cloudflare Queues**: If call ingestion spikes to thousands of concurrent calls ending simultaneously, placing a Cloudflare Queue between the ingestion endpoint and D1 will prevent D1 write concurrency bottlenecks.
- **Audio Storage with Cloudflare R2**: Storing raw audio recordings was omitted per the assignment constraints ("D1 = the only database"). Adding opt-in audio recording uploaded asynchronously to Cloudflare R2 with lifecycle retention policies would enable audio playback in the call detail view.
- **User Authentication**: GET endpoints are currently open for review accessibility. In production, protect them using **Cloudflare Access** (Zero Trust) or JWT verification.
- **Geographic Network Latency**: Voice providers are primarily US-hosted while testing was performed from India. Placing bot instances closer to user regions (e.g. AWS ap-south-1) with dedicated Direct Connect links to provider edge locations would shave an additional 80–120 ms off trans-continental RTT.

---

## 10. Version Notes (Snapshot 2 Oct 2026)

This project strictly adheres to the October 2026 Dependency Version Policy across all modules (Worker, Frontend, Bot, Evals, CI):

1. **Model Upgrades & Decommissioning**:
   - **Groq LLM**: Upgraded to `openai/gpt-oss-20b` (conversational in-call bot) and `openai/gpt-oss-120b` (eval judge). Legacy `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` have been decommissioned.
   - **Deepgram STT**: Pinned to `nova-3-general` streaming speech-to-text.
   - **Cartesia TTS**: Pinned to `sonic-3.6` streaming synthesis (legacy sonic-2 and sonic-turbo sunset after Oct 2026).
2. **Pipecat 1.12.0 API Migration**:
   - Modernized `bot/pipeline.py` to use Pipecat 1.x `Settings` objects (`CartesiaTTSService.Settings(...)`, `DeepgramSTTService.Settings(...)`, `GroqLLMService.Settings(...)`), eliminating deprecated direct constructor kwargs (`model=`, `voice=`).
   - Pinned Python dependencies via `uv`: `pipecat-ai[webrtc,runner,silero,deepgram,groq,cartesia]==1.12.0`, `openai<3` (guarding against TLS/cert regressions), `fastapi==0.115.6`, `httpx==0.28.1`, `pydantic==2.10.6`.
3. **Cloudflare Worker & Schema Unification**:
   - Pinned `wrangler 4.146.0`, `hono 4.13.12`, and `zod 4.5.4` unified across root and worker package manifests.
   - Migrated worker tests to `vitest 4.1.11` + `@cloudflare/vitest-plugin 1.3.5`, replacing the deprecated `@cloudflare/vitest-pool-workers`.
4. **Frontend Modernization**:
   - Pinned `react 19.3.0` & `react-dom 19.3.0` (meeting `>=19.2.7` policy), `vite ^8.3.0`, `react-router 8.4.0` (direct import from `react-router`), and official `@pipecat-ai/client-js 1.13.1` / `@pipecat-ai/small-webrtc-transport 1.10.8`.
5. **CI/CD Pipeline**:
   - Updated GitHub Actions to `actions/checkout@v7`, `actions/setup-node@v7` (Node 26 LTS), `actions/setup-python@v7` (Python 3.12), and `cloudflare/wrangler-action@v4` with pinned `wranglerVersion: "4.146.0"`.

