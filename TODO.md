# TODO — perspective-core

> Phase-by-phase build plan. Each phase is independently deployable/testable.

---

## Phase 1 — Foundation ✅

> Goal: repo runs, logs, spawns execution, streams output.

- [x] Init git repo and push to GitHub
- [x] `npm install` — all deps resolve
- [x] `src/config/index.ts` — Zod-validated env config
- [x] `src/config/logger.ts` — Winston logger (pretty dev / JSON prod)
- [x] `src/adapters/openclaw/index.ts` — OpenClawAdapter (spawn, stream, classify)
- [x] `src/cli/index.ts` — Commander CLI entry point
  - [x] `slc run --goal --target [--persona]`
  - [x] `slc history [--limit] [--id] [--json]`
  - [x] `slc recipes [--json]`
  - [x] `slc policies [--json]`
- [x] Auto-create `data/` and `runs/` directories on startup
- [x] `.gitignore` — ignores `data/`, `runs/`, `node_modules/`, `dist/`
- [x] `npm run build` → dist files, typecheck EXIT:0
- [x] Git init, `main` branch, initial commit

**Done when:** `slc run --goal "hello" --target .` spawns and streams. ✓

---

## Phase 2 — Memory & Learning ✅

> Goal: every run and its events are persisted; the system learns from failures.

- [x] `src/memory/schema.ts` — SQL DDL for all 5 tables (`runs`, `events`, `errors`, `fix_recipes`, `policies`)
- [x] `src/memory/sqlite-store.ts` — `SqliteMemoryStore` full implementation
  - [x] `saveRun` / `updateRunStatus` (writes `ended_at`) / `getRun` / `listRuns`
  - [x] `saveEvent` / `getEvents` (snake_case → camelCase mappers)
  - [x] `saveError` / `getErrors` (snake_case → camelCase mappers)
  - [x] `upsertFixRecipe` / `getFixRecipe` / `listFixRecipes`
  - [x] `savePolicy` / `getPolicy` / `listPolicies`
- [x] `src/memory/error-classifier.ts` — `ErrorClassifier`
  - [x] Pattern-based classification: dependency, permission, network, timeout, logic, unknown
  - [x] Signature normalisation (paths, line numbers, addresses, versions stripped)
  - [x] `IErrorClassifierLLM` interface — plug any LLM in for enrichment (non-blocking)
  - [x] `classifyAndEnrich()` — deterministic first, LLM enrichment async + fire-and-forget
  - [x] Wire into `OpenClawAdapter`
- [x] `src/memory/llm-enrichers.ts` — ready-to-use `IErrorClassifierLLM` implementations
  - [x] `OpenAIEnricher` — optional peer dep `openai`
  - [x] `AnthropicEnricher` — optional peer dep `@anthropic-ai/sdk`
  - [x] `OllamaEnricher` — uses `fetch`, no install needed, local `http://localhost:11434`
  - [x] `GenericFetchEnricher` — bring-your-own `call(prompt): Promise<string>`
- [x] `src/telemetry/collector.ts` — `TelemetryCollector` buffer + flush
- [x] `src/learner/index.ts` — `Learner` (recipe extraction + Wilson score policy promotion)
  - [x] `successCount` increments when recovery steps found (not overall run success)
- [x] `src/orchestrator/index.ts` — full run lifecycle wired
  - [x] `policiesApplied`, `torqueStrategy`, `torqueDominant` stored in `run.meta` per run
  - [x] `handoff.md` generated after every run
- [x] `runs` table: `ended_at` column + `RunContext.endedAt` field
- [x] `slc history` — formatted table with duration, status, goal
  - [x] `--id <prefix>` detail view: errors, steps, recovery events, active policies, torque strategy
  - [x] `--json` flag on all commands
- [x] E2E learning loop test: 5 runs, 1 recipe learned, 2 policies generated, EXIT:0
- [x] Jest + ts-jest: **66 unit tests**, all passing
  - [x] `tests/memory/error-classifier.test.ts` — 32 tests
  - [x] `tests/learner/learner.test.ts` — 15 tests
  - [x] `tests/torque/engine.test.ts` — 19 tests

**Done when:** After a run, `slc history` shows the run with status and duration, and `data/memory.db` contains all events. ✓

---

## Phase 3 — Torque & Strategy ✅

> Goal: the Torque engine meaningfully shapes execution strategy per run.

- [x] `src/torque/engine.ts` — `TorqueEngine` (keyword heuristics, 5 dimensions, `applyPolicies`)
- [x] Torque profile stored per run in `run.meta`
- [x] `slc history --id` shows torque strategy + dominant dimension
- [x] Replace keyword heuristics with LLM/embedding-based goal analysis (`IGoalAnalyserLLM` seam)
- [x] `slc run` output shows active torque strategy during execution

---

## Phase 4 — Policy Injection ✅

> Goal: policies from past runs actively shape future run behaviour.

- [x] `src/orchestrator/index.ts` — policies loaded pre-run and injected into adapter
- [x] `policy_applied` event tracked via telemetry
- [x] `OpenClawAdapter`: `--policies JSON` injected as CLI arg
- [x] `BashAdapter`: `PERSPECTIVE_POLICY_*` env vars injected
- [x] Policy relevance scoring (cosine similarity of trigger signature vs current error)
- [x] Policy expiry / confidence decay over time
- [x] Test: verify policy prevents recurrence in real OpenClaw run

---

## Phase 5 — CLI UX & Handoff ✅

> Goal: clean terminal experience and useful artifacts.

- [x] Pretty run summary (chalk-styled, status icon, duration)
- [x] `handoff.md` generation after each run (`./runs/<run-id>/handoff.md`)
- [x] `slc history --limit N` formatted table
- [x] `slc history --id <prefix>` full run detail
- [x] `--json` flag on all commands
- [x] `slc handoff <runId>` — print/open handoff file from CLI
- [x] `slc run --watch` — stream live telemetry to terminal during execution
- [x] `slc run` progress spinner during execution
- [x] `slc policies-delete <id>` and `slc recipes-delete <signature>`
- [x] `slc export` — dump memory store to JSON/NDJSON

---

## Phase 6 — Adapter Ecosystem ✅

> Goal: prove the framework works across multiple domains.

- [x] `src/adapters/mock/index.ts` — `MockAdapter` (deterministic, scenario cycling)
- [x] `src/adapters/docker/index.ts` — `DockerAdapter` (mounts, env, timeout, SIGKILL)
- [x] `src/adapters/bash/index.ts` — `BashAdapter` (SIGTERM/SIGKILL, policy env vars, warning filter, line-buffered)
- [x] `src/adapters/http/index.ts` — `HttpAdapter` (call REST APIs, classify non-2xx as errors)
- [x] `src/adapters/base.ts` — `BaseAdapter` abstract class with shared utilities
- [x] Adapter registry — `adapterRegistry.register(name, adapter)`
- [x] `slc run --adapter bash` — select adapter via CLI flag
- [x] `docs/creating-an-adapter.md` — adapter authoring guide

---

## LLM Integration Points

> The framework is LLM-optional. Every LLM seam has a deterministic fallback.

| Layer | Today (deterministic) | LLM upgrade path |
|---|---|---|
| Error classification | Regex pattern rules | `IErrorClassifierLLM.enrich()` — **seam exists** ✅ |
| Error enrichment | — | `OpenAIEnricher` / `AnthropicEnricher` / `OllamaEnricher` / `GenericFetchEnricher` ✅ |
| Torque analysis | Keyword heuristics | `IGoalAnalyserLLM` seam — **seam exists** ✅ |
| Recipe extraction | Event type matching | LLM reads raw log → richer fix steps |
| Policy description | Template string | LLM writes `PolicyInstruction.description` |
| Orchestrator planner | Direct execution | LLM plans step sequence from goal |

---

## Definition of Done (System Level)

- [x] System stores error signatures across runs ✓
- [x] At least one fix recipe is learned automatically ✓
- [x] Prevention policy is injected automatically into next run ✓
- [x] Repeated error occurrence is reduced ✓
- [x] At least 2 adapters (OpenClaw + Bash) working end-to-end ✓
- [x] All `slc` commands functional ✓
- [x] `handoff.md` generated after every run ✓

---

## Backlog / Future

- [ ] `@perspective/torque-clustering` — extract as standalone package
- [ ] `@perspective/openclaw-adapter` — extract when stable
- [ ] Postgres memory backend (`IMemoryStore` already abstracted)
- [ ] OpenTelemetry telemetry sink
- [ ] `LLMToolAdapter` — LLM function-calling as execution engine
- [ ] Web UI — run history dashboard
- [ ] Policy confidence decay (stale policies expire)
- [ ] Multi-agent orchestration (parallel runs with shared memory)
- [ ] `slc memory prune --older-than 30d`
- [ ] `IMemoryReader` — read-only query interface for consumers
