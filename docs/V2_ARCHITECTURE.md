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

## Storage and customer-owned data

D1 is the default control-plane store, not a requirement for customer data. Tenants can register named connections and reference them from an agent definition through `connection_id` values. Secrets are never embedded in agent JSON; the connection stores only a secret reference. Customer connection secrets are tenant-scoped at the Worker binding layer: for tenant `acme` and secret ref `POLICY_API`, the binding is `CONNECTION_SECRET_acme_POLICY_API`. MCP credentials follow `MCP_AUTH_acme_<auth_ref>`. This prevents one tenant from selecting another tenant's secret name. Cloudflare recommends Worker Secrets/Secrets Store for sensitive values.

The current adapters include:

- **D1** for the default platform metadata, policies, memory, and lexical knowledge store.
- **HTTP JSON policy adapter** for customer-owned policy/data services.
- **HTTP vector/search adapter** for customer-owned semantic-search infrastructure such as Pinecone, Qdrant, Weaviate, pgvector services, or a customer RAG gateway.
- **HTTP event sink** for customer-owned observability/call-log systems.

The adapter contracts intentionally avoid vendor lock-in. A customer can put a relational database behind a small read/write service or data API rather than giving the LLM unrestricted SQL access to a production database.

### Configurable observability

Agents can specify:

- destination connection
- `d1`, `external`, or `both` delivery mode
- allowed event types
- exact fields to export
- optional retention metadata

This means transcripts, audio references, user IDs, tool arguments, token usage, latency, and other sensitive fields are **not automatically required to leave the platform**. Each tenant chooses what is exported.

### Provider resolution

```
Agent
  |
  +-- policy_connection_id ------> customer policy API / D1
  |
  +-- knowledge_connection_id --> vector/search API / D1
  |
  +-- memory_connection_id -----> memory API / D1
  |
  +-- observability.connection_id -> event sink / D1
```

The runtime resolves these providers per tenant/agent at request time while preserving tenant isolation.

## Provider strategy

Provider-specific SDKs remain behind runtime/provider adapters. This allows the same agent definition to move between model, STT, TTS and tool providers without changing application-level agent behavior.

## Security

- No default production credentials.
- Tenant ID is mandatory for platform APIs.
- Tool execution requires explicit agent configuration.
- MCP servers are explicit allowlisted resources.
- Retrieved memory/knowledge is untrusted context.
- Published agent definitions are immutable.


## Dashboard authentication

For a production dashboard, put the Worker/dashboard behind Cloudflare Access or the organization's IdP. Cloudflare Access can protect Workers and expose authenticated identity to the Worker; the application should still follow the platform's API-key/service-credential model for machine clients. See the Cloudflare Access Worker guidance for the recommended deployment pattern.