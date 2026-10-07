# Voice-Log v2 — Production Agent Platform TODO

Branch: `v2`
Base: `main`
Goal: evolve Voice-Log from a low-latency voice call logger into a configurable, multi-tenant voice-agent platform without compromising the real-time audio hot path.

## 0. Engineering rules
- [x] Preserve WebRTC/Pipecat audio path as the latency-critical hot path.
- [x] No database/network/tool/MCP call may block audio processing.
- [x] Prefer streaming and parallel work wherever possible.
- [x] Keep agent runtime provider-agnostic behind explicit interfaces.
- [x] Use strict schemas and typed contracts at boundaries.
- [x] Pin/review current stable dependency versions before each dependency migration.
- [x] Add tests before/alongside behavior changes.
- [x] Keep every milestone independently buildable and committed.

## 1. Baseline + dependency modernization
- [x] Capture current build/test baseline.
- [x] Audit root, Worker, and Python dependency versions against current official releases/docs.
- [x] Upgrade only compatible stable releases; avoid speculative major upgrades.
- [x] Refresh lockfiles where applicable.
- [x] Add dependency/version documentation and upgrade policy.
- [x] Add CI checks for typecheck, frontend build, Worker tests, Python tests, and eval gate.

## 2. Agent Harness core
- [x] Introduce typed AgentDefinition schema.
- [x] Add AgentRuntime with lifecycle, streaming response, cancellation, and error contracts.
- [x] Separate agent identity, instructions, persona, model config, voice config, policies, tools, MCP, knowledge, and memory.
- [x] Add provider interfaces for LLM/STT/TTS.
- [x] Add deterministic config resolution/validation.
- [x] Add per-request runtime context: tenant, agent, user/session, request/call IDs.
- [x] Ensure runtime is stateless by default and safe for concurrent sessions.
- [x] Add unit tests for config merge, validation, cancellation, and failure behavior.

## 3. Low-latency voice runtime
- [x] Preserve Pipecat streaming architecture.
- [ ] Tune VAD/STT endpointing/turn-stop behavior from measured latency rather than guesses.
- [ ] Stream LLM tokens directly into TTS where provider semantics permit.
- [ ] Support barge-in/cancellation cleanly.
- [x] Avoid synchronous persistence/tool execution in the media path.
- [ ] Add latency budgets and regression thresholds.
- [x] Track p50/p95/p99 for speech-end → STT → LLM TTFB → TTS TTFB → first audio.
- [ ] Add provider timeout/fallback policy without adding avoidable latency.
- [ ] Add load/concurrency smoke tests.

## 4. Agent configuration + versioning
- [x] Persist agent definitions remotely.
- [x] Support draft/test/published versions.
- [x] Add immutable published agent versions.
- [ ] Add environment-specific configuration.
- [x] Add configurable system prompt/persona/voice/model/tool policy.
- [ ] Add agent cloning.
- [ ] Add safe config rollout/rollback.

## 5. Remote policy layer
- [x] Create policy schema.
- [x] Support brand voice, allowed topics, forbidden topics, escalation rules, response limits, data permissions, tool permissions, compliance rules.
- [x] Implement policy resolver with deterministic precedence.
- [x] Cache active policies per agent/version.
- [x] Never fetch remote policy synchronously for every audio turn when cached.
- [ ] Add policy versioning and audit history.
- [ ] Add policy compliance evals.

## 6. Tools + MCP
- [x] Define typed Tool interface.
- [x] Add tool registry.
- [x] Add permission/capability checks before execution.
- [x] Add timeout, cancellation, retry, and result-size limits.
- [x] Add MCP client abstraction.
- [x] Support configurable MCP servers per agent/tenant.
- [x] Keep tool execution off the real-time audio critical path where possible.
- [ ] Stream tool progress/status to the UI.
- [ ] Add tool-call tracing.
- [ ] Add tests for malicious/invalid tool inputs and permission failures.

## 7. Memory
- [x] Separate session memory from long-term memory.
- [x] Define structured memory records with provenance and timestamps.
- [x] Add user/profile memory.
- [ ] Add agent/company memory where appropriate.
- [x] Add memory retrieval policy and token budget.
- [ ] Add write/update/delete semantics and conflict handling.
- [x] Cache hot session context.
- [x] Never inject untrusted memory as higher-priority instructions.
- [ ] Add memory quality and leakage tests.

## 8. Knowledge / RAG
- [x] Add knowledge-source abstraction.
- [x] Support documents/FAQs/web content ingestion.
- [ ] Chunk, embed, index, and retrieve with metadata filters.
- [x] Add pluggable knowledge-provider contract with D1 fallback.
- [x] Add customer-owned HTTP vector/search adapter for Pinecone/Qdrant/Weaviate/pgvector gateways.
- [ ] Add first-party direct vector-provider SDK adapters.
- [x] Add tenant/agent isolation to every retrieval query.
- [ ] Add citations/provenance to retrieved context.
- [ ] Add retrieval latency telemetry.
- [ ] Add groundedness evals.

## 9. Multi-tenancy + auth
- [x] Add tenant-scoped integration connection registry.
- [ ] Add organizations/tenants.
- [ ] Add users and memberships/roles.
- [ ] Scope agents, policies, knowledge, memory, tools, calls, and usage by tenant.
- [x] Add authentication and authorization middleware.
- [x] Add customer-owned policy/data HTTP adapter and per-agent policy connection selection.
- [ ] Add API keys/service credentials for agent integrations.
- [ ] Add rate limits and quotas.
- [x] Add tenant-safe data access tests.

## 10. API + SDK
- [x] Version the public API.
- [x] Add agent CRUD/version endpoints.
- [x] Add text message endpoint.
- [x] Add voice/session endpoint.
- [ ] Add streaming response transport.
- [x] Add tool/MCP configuration endpoints.
- [x] Add knowledge ingestion endpoints.
- [x] Add memory endpoints where appropriate.
- [ ] Generate/maintain TypeScript contracts.
- [x] Add minimal JS/TS client SDK example.

## 11. Agent Builder + Playground
- [x] Agent creation/editing UI.
- [ ] Model + voice configuration.
- [ ] Prompt/persona editor.
- [ ] Policy editor.
- [ ] Tool/MCP configuration.
- [ ] Knowledge upload/management.
- [ ] Memory controls.
- [x] Add connection references for external memory adapters.
- [ ] Test/publish workflow.
- [ ] Live voice playground.
- [x] Text playground.
- [ ] Execution trace with latency, retrieval, memory, and tool events.

## 12. Observability
- [ ] Add correlation IDs across browser → bot → Worker → agent runtime → tools.
- [ ] Add structured agent execution traces.
- [ ] Record latency, token usage, tool calls, retrievals, errors, cancellations.
- [ ] Add tenant/agent/version dimensions.
- [x] Add configurable external observability sink and per-agent log field selection.
- [ ] Add dashboards for latency, reliability, usage, and cost.
- [ ] Add privacy-aware logging/redaction.

## 13. Evaluation + safety
- [ ] Extend existing eval harness for configurable agents.
- [ ] Add task completion, relevance, groundedness, policy compliance, tool selection, memory correctness.
- [ ] Add voice latency regression gates.
- [ ] Add adversarial prompt/tool-input cases.
- [ ] Add tenant isolation tests.
- [ ] Add release gate for agent versions.

## 14. Production deployment
- [x] Containerize Pipecat bot.
- [x] Add health/readiness endpoints.
- [ ] Add horizontal scaling strategy.
- [ ] Place bot/inference infrastructure geographically for latency.
- [ ] Deploy frontend.
- [ ] Deploy Worker/API.
- [x] Add configurable customer-owned policy, knowledge, memory, and observability connection references.
- [ ] Configure production database/vector storage.
- [ ] Add secrets management.
- [x] Add migrations and rollback strategy.
- [x] Add CI/CD for v2.

## 15. Product polish
- [ ] Landing page explaining platform value.
- [ ] Demo agents: Marketing, Sales, Support.
- [ ] Agent onboarding flow.
- [ ] Usage/cost dashboard.
- [x] API documentation.
- [x] Architecture documentation.
- [x] Production troubleshooting guide.
- [x] Resume/project documentation with measured benchmarks.

## Commit sequence
1. chore(v2): establish baseline and dependency policy
2. feat(agent): add configurable agent harness contracts/runtime
3. feat(voice): connect harness to low-latency Pipecat runtime
4. feat(config): add persisted agent configs and versioning
5. feat(policy): add remote policy resolver
6. feat(tools): add tool registry and execution contracts
7. feat(mcp): add configurable MCP client layer
8. feat(memory): add session and long-term memory
9. feat(knowledge): add tenant-safe RAG
10. feat(auth): add multi-tenant auth and isolation
11. feat(api): add versioned agent platform API
12. feat(ui): add agent builder and playground
13. feat(observability): add traces, metrics, and cost telemetry
14. feat(evals): add platform regression/safety gates
15. feat(deploy): productionize bot/API/frontend
16. docs(v2): finalize product, architecture, and resume documentation
