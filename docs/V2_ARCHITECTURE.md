# Voice-Log v2 Architecture

## Runtime principles

1. **Audio is sacred.** WebRTC, VAD, streaming STT, streaming LLM, streaming TTS and interruption handling stay in the Pipecat process.
2. **Configuration is resolved before turns.** Agent definitions, policies and permissions are fetched/cached at session setup.
3. **Tools/MCP are capability boundaries.** The model never receives arbitrary network access; every tool is explicitly configured and permissioned.
4. **Memory and knowledge are bounded context.** Retrieval is limited by count/characters and is treated as untrusted context, never as system instructions.
5. **Every request is tenant-scoped.** Agent, policy, memory, knowledge and usage records carry tenant identity.
6. **Published agent versions are immutable.** Production calls reference a concrete version.

## Latency budget

Target the first assistant audio as:

- STT finalization: ~150–300 ms after speech boundary
- LLM TTFB: ~150–300 ms
- TTS first audio: ~100–250 ms
- Transport/jitter: ~50–100 ms

The system should measure p50/p95 rather than assume these targets. Remote persistence, memory writes, analytics and tool execution must not block the audio output path.

## Agent lifecycle

`draft -> test -> published -> rollback`

A published version is immutable. A new configuration creates a new version.

## Request context

Every runtime execution carries:

- tenant ID
- agent ID/version
- session ID
- optional user ID
- request ID
- channel
- cancellation signal

This enables deterministic tracing and cancellation without global mutable state.

## Platform layers

```
UI / SDK
  |
Versioned API
  |
Auth + Tenant isolation
  |
Agent Resolver
  |
+---------------- Agent Runtime ----------------+
| Policy | Memory | Knowledge | Tools | MCP      |
+------------------------------------------------+
  |
Pipecat voice adapter
  |
WebRTC / STT / LLM / TTS
```

## Storage strategy

The current Worker uses Cloudflare D1. v2 keeps D1 for transactional metadata and agent configuration. A vector-capable store should be introduced only when knowledge retrieval needs semantic vectors at production scale; the retrieval contract intentionally hides that implementation.

## Provider strategy

Provider-specific SDKs remain behind runtime/provider adapters. This allows the same agent definition to move between model, STT, TTS and tool providers without changing application-level agent behavior.

## Security

- No default production credentials.
- Tenant ID is mandatory for platform APIs.
- Tool execution requires explicit agent configuration.
- MCP servers are explicit allowlisted resources.
- Retrieved memory/knowledge is untrusted context.
- Published agent definitions are immutable.
