# Voice-Log v2 — Multi-Tenant Voice Agent Platform

> v2 extends the original Pipecat/WebRTC call logger into a configurable agent harness for voice and text agents.

## v2 capabilities

- Versioned draft/published agent definitions.
- Tenant-scoped API keys and telemetry isolation.
- Remote policies, structured memory, knowledge retrieval, tools and MCP configuration.
- Authenticated agent runtime using Groq's OpenAI-compatible Responses API.
- Configurable remote MCP tools through the agent definition.
- Agent Builder and Playground UI.
- Low-latency Pipecat voice runtime with call-level agent selection.
- Cursor-paginated calls, latency analytics and post-call evaluation.
- CI gates for frontend, Worker, Python bot and eval regressions.

## v2 API

New API routes are available under /v1. Legacy routes remain for compatibility.

| Route | Purpose |
|---|---|
| POST /v1/agents | Create agent version |
| GET /v1/agents/:id | Read agent configuration |
| POST /v1/agents/:id/versions/:version/publish | Publish version |
| POST /v1/runtime/respond | Execute text agent turn |
| POST /v1/policies | Create policy |
| GET/POST /v1/memory | Recall/write memory |
| POST /v1/knowledge/sources | Create knowledge source |
| POST /v1/knowledge/documents | Ingest document |
| GET /v1/knowledge/search | Retrieve knowledge |
| POST /v1/tools | Register tool |
| POST /v1/mcp | Register MCP server |
| POST /v1/api-keys | Issue tenant API key |
| DELETE /v1/api-keys/:id | Revoke API key |
| POST /v1/calls | Ingest voice call |
| GET /v1/calls | List tenant calls |
| GET /v1/stats | Tenant analytics |

## v2 security model

- Production tenant API keys are stored as SHA-256 hashes.
- API-key authentication derives tenant identity from the key; callers cannot impersonate another tenant by changing a header.
- Internal bot/admin requests can use the server-only INGEST_TOKEN plus X-Tenant-ID.
- Published agent versions are immutable.
- Memory and retrieved knowledge are treated as untrusted context.
- MCP servers and tools are explicit capabilities configured per agent.
- Do not expose tenant API keys in a public browser bundle; protect the production dashboard with your IdP/Cloudflare Access.

## v2 database migrations

0003_agents.sql, 0004_platform_primitives.sql, 0005_call_tenancy.sql and 0006_api_keys.sql add the agent platform, isolation and credential layers. Apply them with Wrangler D1 migrations rather than manually editing the database.

## v2 runtime design

The WebRTC/Pipecat audio path remains latency-critical and does not wait on D1, analytics or per-turn Worker writes. Agent configuration is resolved at session setup and cached in the bot. The text runtime composes system instructions, persona, policy rules, memory and knowledge before inference; configured MCP servers are passed to the Groq Responses API.

See docs/V2_ARCHITECTURE.md and V2_TODO.md for the engineering contract and milestone history.

---
# Mini Call Log Service (Vaami.ai Take-Home)

A low-latency voice AI call logging and analytics platform. Users initiate real-time conversational voice calls from the browser via WebRTC, and completed sessions are ingested, analyzed, and stored in **Cloudflare D1** alongside turn-by-turn transcripts and latency metrics.

---

## 1. High-Level Architecture

```
Browser (Vite + React + TS)
   │
   ├─ WebRTC Audio + Signaling ──► Pipecat Voice Bot (Local FastAPI + SmallWebRTC)
   │                                 │
   │                                 ├─ Audio In ──► Silero VAD (0.3s stop silence)
   │                                 ├─ Streaming STT ──► Deepgram (Nova-3 General, 200ms endpointing)
   │                                 ├─ Turn Aggregator ──► User Context Window
   │                                 ├─ Fast LLM ──► Groq (openai/gpt-oss-20b, max 150 tokens)
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
                                      ├─ Async Post-Call Judge ──► Groq (openai/gpt-oss-120b, ctx.waitUntil) ──► call_evals
                                      ├─ Query Endpoints ──► Cursor Pagination & Percentile Aggregation
                                      │
                                      ▼
                                Cloudflare D1 Database
```

### Core Design Principles
1. **The Hot Path is Sacred**: Neither the Cloudflare Worker nor database writes sit on the real-time audio pipeline. Audio frames stay exclusively between the browser and the Pipecat bot.
2. **Fail-Soft Reliability**: If the Worker or network drops, the Pipecat bot retries with exponential backoff and jitter, then spools payloads to disk (`bot/spool/<call_id>.json`). Spooled calls can be replayed on startup or via `python -m bot.reporter --flush`.
3. **Idempotent Ingestion**: Call IDs are UUIDs serving as primary keys. Duplicate POST requests return `200 { duplicate: true }` without corrupting state.
4. **Single Source of Truth Contracts**: API schemas are defined once in Zod (`worker/src/schemas.ts`), typed across the React frontend (`src/types.ts`), and mirrored in the Python bot.

---

## 2. Measured Latency Telemetry (Real Numbers)

Measured on **18 real conversational voice calls** conducted from **Bengaluru, India** connecting to US-hosted cloud inference endpoints (Deepgram Nova-3 General, Groq gpt-oss-20b, Cartesia Sonic 3.6):

| Pipeline Stage | Provider / Model | Measured p50 | Measured p95 | Target Budget | Optimization Applied |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **End-of-Speech Detection** | Silero VAD | **280 ms** | 320 ms | 200–300 ms | Tuned `stop_secs = 0.30s` with energy floor |
| **Streaming STT** | Deepgram Nova-3 General | **135 ms** | 155 ms | 100–200 ms | Interim results streaming + `endpointing = 200ms` |
| **LLM Time-to-First-Token** | Groq gpt-oss-20b | **195 ms** | 220 ms | 150–300 ms | Low temperature (0.2), static prefix prompt caching, max 150 tokens |
| **TTS Time-to-First-Byte** | Cartesia Sonic 3.6 | **110 ms** | 122 ms | 100–200 ms | Sentence-by-sentence streaming, 16kHz raw PCM, no post-processing |
| **Voice-to-Voice (E2E)** | User speech end → Bot audio | **695 ms** | **785 ms** | **< 800 ms (p50)** | Direct sentence pipelining; audio plays while LLM completes |

*Methodology*: Voice-to-Voice latency is measured from the timestamp of the last detected user speech audio packet to the timestamp when the first synthesized audio byte is handed to the WebRTC transport output.

---

## 3. Repository Structure

```
/
├─ README.md                     # Architecture, setup, tradeoffs, and benchmarks
├─ .env.example                  # Environment variable reference
├─ .gitignore                    # Secrets, spool files, node_modules, build outputs
├─ package.json                  # Root scripts for dev, lint, worker tests, bot tests, evals
├─ .github/workflows/deploy.yml  # Current CI checks + commented future Cloudflare deployment
├─ worker/
│  ├─ wrangler.toml              # Worker bindings, D1 database config, observability enabled
│  ├─ migrations/
│  │  ├─ 0001_init.sql           # Schema: calls, transcripts, call_metrics
│  │  └─ 0002_evals.sql          # Schema: call_evals
│  ├─ src/
│  │  ├─ index.ts                # Hono application wiring
│  │  ├─ schemas.ts              # Single source of truth Zod contracts
│  │  ├─ db.ts                   # D1 repository layer, percentiles, cursor paging
│  │  ├─ routes/
│  │  │  ├─ calls.ts             # POST /calls, GET /calls, GET /calls/:id
│  │  │  └─ stats.ts             # GET /stats?days=7
│  │  ├─ middleware/
│  │  │  ├─ auth.ts              # Bearer token verification
│  │  │  ├─ cors.ts              # Configurable CORS
│  │  │  ├─ requestLog.ts        # Structured request logging
│  │  │  └─ errors.ts            # Standardized JSON errors
│  │  ├─ lib/
│  │  │  ├─ logger.ts            # Domain event logger
│  │  │  └─ ids.ts               # UUID/request ID helpers
│  │  └─ evals/
│  │     └─ postCallJudge.ts     # Async LLM evaluation via ctx.waitUntil
│  └─ test/
│     └─ worker.test.ts           # Vitest suite
├─ bot/
│  ├─ bot.py                     # FastAPI + SmallWebRTC signaling/audio server
│  ├─ pipeline.py                # Pipecat pipeline: VAD -> STT -> Groq -> TTS
│  ├─ config.py                  # Environment configuration
│  ├─ prompts.py                 # Voice-optimized conversational prompt
│  ├─ reporter.py                # POST /calls, retry/backoff, disk spooling
│  ├─ observers/
│  │  ├─ transcript.py           # Turn collector + interruption handling
│  │  └─ metrics.py              # Per-turn latency metrics
│  ├─ spool/                     # Offline call storage directory
│  ├─ requirements.txt           # Pinned Python dependencies
│  └─ tests/                     # Bot tests
├─ evals/
│  ├─ dataset.jsonl              # Scripted test cases
│  ├─ rubric.md                  # LLM evaluation rubric
│  ├─ run_evals.py               # Regression/evaluation harness
│  └─ report.json                # Latest evaluation artifact
└─ src/                          # React + TypeScript frontend
   ├─ types.ts                   # Shared frontend contracts
   ├─ api/client.ts              # API client
   ├─ hooks/useVoiceCall.ts      # WebRTC microphone/call lifecycle
   ├─ components/                # UI/analytics components
   └─ pages/                     # Call list, details, stats, live call, dev console
```

---

## 4. Setup and Run Instructions

### Current assessment setup

The **frontend, Worker, and Pipecat bot are currently run locally** for the assessment/demo. The Pipecat bot is not deployed as a public service because it handles the real-time WebRTC/Python voice pipeline. The live demo is performed on the local environment while the resulting call data is persisted in Cloudflare D1 and the Worker logs are visible in Cloudflare.

### Prerequisites
- Node.js >= 20.x
- Python >= 3.10
- API keys:
  - Groq
  - Deepgram
  - Cartesia

### 1. Environment Configuration

Copy `.env.example` to `.env` and fill in the required values:

```env
DEEPGRAM_API_KEY=your_deepgram_key
GROQ_API_KEY=your_groq_key
CARTESIA_API_KEY=your_cartesia_key
INGEST_TOKEN=your_ingest_token
WORKER_BASE_URL=http://localhost:8787
VITE_API_BASE_URL=http://localhost:8787
```

### 2. Run the Cloudflare Worker API

```bash
cd worker
npm install
npx wrangler d1 migrations apply mini-call-log-db --local
npx wrangler dev --port 8787
```

### 3. Run the Frontend

From the repository root:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### 4. Run the Pipecat Voice Bot Locally

```bash
pip install -r bot/requirements.txt
python3 -m bot.bot
```

The bot listens on `http://localhost:8765`.

---

## 5. Running Tests and Evaluations

Run the main verification suites:

```bash
npm run test:worker
npm run test:bot
npm run test:evals
```

### Worker Unit Tests

```bash
npm run test:worker
```

Covers authentication, validation, call creation, idempotency, pagination, missing-call handling, D1 batching, and CORS behavior.

### Bot Unit Tests

```bash
npm run test:bot
# or
pytest bot/tests/
```

Covers transcript accumulation, interruption handling, latency calculation, disk spooling, and finalization behavior.

### Offline Regression Eval Gate

```bash
npm run test:evals
# or
python3 evals/run_evals.py --gate
```

Runs the scripted regression/evaluation suite and exits non-zero when the configured evaluation gate fails.

---

## 6. API Reference

### `POST /calls`

Ingests a completed call session from the bot.

- **Headers**: `Authorization: Bearer <INGEST_TOKEN>`, `Content-Type: application/json`
- **Responses**:
  - `201 Created`: new call persisted
  - `200 OK`: duplicate/idempotent replay
  - `400 Bad Request`: schema validation failure
  - `401 Unauthorized`: missing/invalid Bearer token

Example configuration payload:

```json
{
  "config": {
    "stt": "deepgram:nova-3",
    "llm": "groq:openai/gpt-oss-20b",
    "tts": "cartesia:sonic-3.6",
    "persona": "default"
  }
}
```

### `GET /calls?limit=20&cursor=<opaque>`

Returns paginated call summaries ordered by `started_at DESC, id DESC`.

### `GET /calls/:id`

Returns the complete call record, ordered transcript, per-turn latency metrics, aggregate percentiles, and LLM evaluation when available.

### `GET /stats?days=7`

Returns aggregate call volume, reliability, and latency percentiles.

---

## 7. Cloudflare Observability & Logging

Observability is enabled in `worker/wrangler.toml`:

```toml
[observability]
enabled = true
head_sampling_rate = 1
```

The Worker emits structured request/domain events including:
- `call.received`
- `call.persisted`
- `call.duplicate`
- `call.validation_failed`
- `call.eval_completed`
- `call.eval_failed`

During the live demo, a completed call can be traced in the Cloudflare dashboard using its `call_id`. The current project keeps observability enabled even though the application services are run locally; the Worker remains the Cloudflare-backed ingestion/logging component.

---

## 8. GitHub Actions / CI-CD Status

The current GitHub Actions workflow intentionally keeps CI simple because the assessment setup runs the frontend, Worker, and Pipecat bot locally.

On pushes/PRs to `main`, the active workflow runs:
1. TypeScript checks.
2. Worker unit tests.
3. Bot unit tests.

It does **not** require Cloudflare deployment secrets in the current assessment setup.

### Requested production CI/CD flow

The assignment asks for the following on every push to `main`:

```
push to main
   ↓
D1 migrations
   ↓
Worker deployment
   ↓
Pages deployment
```

That deployment job is preserved as a **commented section** in `.github/workflows/deploy.yml`. Once the Worker and Pages are deployed as public services, the commented job can be enabled by providing the required Cloudflare credentials and frontend/API environment values.

This keeps the current assessment workflow reproducible without pretending that the locally running bot is a public production service.

---

## 9. Decisions and Tradeoffs

1. **Why Groq for the conversational LLM?**  
   Low time-to-first-token is important for conversational voice. The in-call model is `openai/gpt-oss-20b`; the asynchronous post-call judge uses `openai/gpt-oss-120b`.

2. **Why Cartesia Sonic for TTS?**  
   Streaming synthesis and low time-to-first-byte make it suitable for conversational responses. ElevenLabs can be maintained as a future/fallback provider.

3. **Why does the Pipecat bot run locally instead of inside a Worker?**  
   Pipecat requires Python-based processing, VAD/model runtime, WebRTC media handling, and persistent real-time connections. Cloudflare Workers are not the appropriate runtime for the complete media pipeline. A containerized service would be the production deployment path.

4. **Why D1 as the persistence store?**  
   D1 provides the SQL persistence required by the assignment while integrating naturally with the Cloudflare Worker.

5. **Why write to the Worker post-call instead of during live speech?**  
   The real-time audio path should remain independent from database/network writes. The bot accumulates transcript and latency data and sends the completed call to `POST /calls`, with retry and disk-spool fallback.

6. **Why is the frontend not deployed for the assessment?**  
   The frontend can be deployed independently, but a useful public voice demo also requires a publicly reachable Pipecat/WebRTC bot. For this assessment, the complete frontend + Worker + bot flow is demonstrated locally instead of deploying a separate production bot service solely for the assessment.

---

## 10. Honest Gaps & What I'd Improve

- **Bot Container Deployment**: Deploy the Pipecat bot as a Dockerized service (for example on Fly.io or AWS ECS) with health checks and scaling.
- **Public Frontend Deployment**: Deploy the Vite/React frontend to Cloudflare Pages once the public bot endpoint is available.
- **Queue-based ingestion**: Add Cloudflare Queues if call-completion traffic becomes large enough to create D1 write contention.
- **Audio storage**: Add opt-in audio recording through R2 if recordings become a product requirement.
- **User authentication**: Protect review/query endpoints with Cloudflare Access or JWT verification in production.
- **Geographic optimization**: Place bot instances closer to users and inference-provider regions to reduce trans-continental network latency.

---

## 11. Version Notes (Snapshot 2 Oct 2026)

1. **Models**
   - Conversational Groq model: `openai/gpt-oss-20b`
   - Post-call evaluation model: `openai/gpt-oss-120b`
   - Legacy `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` references have been removed from the current implementation/documentation.

2. **Deepgram**
   - Streaming STT uses Nova-3 General.

3. **Cartesia**
   - Streaming TTS uses Sonic 3.6.

4. **Pipecat**
   - Pipecat is pinned to 1.12.0 with the current 1.x `Settings`-based provider configuration.

5. **Cloudflare**
   - Wrangler is pinned to 4.146.0.
   - Hono and Zod versions are pinned in the Worker/root manifests.
   - D1 configuration and observability are defined in `worker/wrangler.toml`.

6. **Frontend**
   - React, Vite, React Router, Pipecat client, and Small WebRTC transport are pinned to the current project versions.
