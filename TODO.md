# TODO — perspective-core

> Phase-by-phase build plan. Each phase is independently deployable/testable.

---

## Phase 1 — Foundation

> Goal: repo runs, logs, spawns execution, streams output.

- [ ] Init git repo and push to GitHub
- [ ] `npm install` — verify all deps resolve
- [ ] `src/config/index.ts` — env config loader (dotenv-style, Zod-validated)
- [ ] `src/config/logger.ts` — Winston logger with structured JSON + pretty console
- [ ] `src/adapters/openclaw/index.ts` — OpenClawAdapter skeleton
  - [ ] Spawn OpenClaw CLI process
  - [ ] Stream stdout/stderr through `ITelemetryCollector`
  - [ ] Return structured `ExecutionResult`
- [ ] `src/adapters/openclaw/validate.ts` — check OpenClaw CLI is installed/available
- [ ] `src/cli/index.ts` — Commander CLI entry point
  - [ ] `slc run --goal --target [--persona]`
  - [ ] Pretty terminal output with chalk
- [ ] Create `runs/` directory per-run on start
- [ ] `.gitignore` — ignore `data/`, `runs/`, `node_modules/`, `dist/`

**Done when:** `slc run --goal "hello" --target .` spawns OpenClaw and streams output to terminal.

---

## Phase 2 — Memory

> Goal: every run and its events are persisted in SQLite.

- [ ] `src/memory/schema.ts` — SQL DDL for all tables
- [ ] `src/memory/sqlite-store.ts` — `SqliteMemoryStore` implementing `IMemoryStore`
  - [ ] `saveRun` / `updateRunStatus` / `getRun` / `listRuns`
  - [ ] `saveEvent` / `getEvents`
  - [ ] `saveError` / `getErrors`
  - [ ] `upsertFixRecipe` / `getFixRecipe` / `listFixRecipes`
  - [ ] `savePolicy` / `getPolicy` / `listPolicies`
- [ ] `src/memory/index.ts` — barrel export
- [ ] `src/telemetry/collector.ts` — `TelemetryCollector` buffering + flush to memory
- [ ] Wire telemetry flush into orchestrator run lifecycle
- [ ] Parse OpenClaw log lines into structured `TelemetryEvent` types
- [ ] Extract error signatures from captured events
  - [ ] `src/memory/error-classifier.ts` — categorise errors by pattern
- [ ] `slc history` CLI command — list last N runs from DB

**Done when:** After a run, `slc history` shows the run with status, and `data/memory.db` contains all events.

---

## Phase 3 — Learning

> Goal: the system learns from failures across runs.

- [ ] `src/learner/recipe-extractor.ts`
  - [ ] Scan event stream for recovery steps after each error
  - [ ] Build `FixRecipe` with ordered fix steps
- [ ] `src/learner/policy-generator.ts`
  - [ ] Promote fix recipe to `Policy` when `successCount >= 3`
  - [ ] Calculate `confidence` score
  - [ ] Build `PolicyInstruction` (action, description, hints)
- [ ] `src/learner/index.ts` — `Learner` class implementing `ILearner`
- [ ] Wire learner into orchestrator post-run
- [ ] `slc recipes` CLI command — list learned fix recipes
- [ ] `slc policies` CLI command — list active prevention policies

**Done when:** After 3+ identical failures (with recovery), a policy is auto-generated and visible in `slc policies`.

---

## Phase 4 — Policy Injection

> Goal: policies from past runs actively shape future run behaviour.

- [ ] `src/orchestrator/policy-loader.ts` — load and filter relevant policies pre-run
- [ ] `src/orchestrator/index.ts` — `Orchestrator` class implementing `IOrchestrator`
  - [ ] Full run lifecycle: context → policies → torque → execute → learn → persist
- [ ] `src/torque/engine.ts` — `TorqueEngine` implementing `ITorqueEngine`
  - [ ] `analyse(goal, history)` → `TorqueProfile`
  - [ ] `applyPolicies(profile, policies)` → adjusted `TorqueProfile`
  - [ ] Dimension scoring: stability, speed, safety, cost, quality
- [ ] OpenClawAdapter: accept `PolicyInstruction[]` and inject into prompt/flags
- [ ] Track which policies were applied per run (event type: `policy_applied`)
- [ ] Test: verify policy injected in run N+1 after failure in run N

**Done when:** A policy created in Phase 3 is automatically injected into the next run and prevents recurrence.

---

## Phase 5 — CLI UX & Handoff

> Goal: clean terminal experience and useful artifacts.

- [ ] Pretty run summary in terminal (chalk-styled)
  - [ ] Run ID, goal, status, duration, errors count, policies applied
- [ ] `handoff.md` generation after each run
  - [ ] Goal, target, strategy, steps, errors, policies, next hints
  - [ ] Written to `./runs/<run-id>/handoff.md`
- [ ] `slc run` shows live streaming output during execution
- [ ] `slc history --limit N` with formatted table output
- [ ] `slc history --id <run-id>` shows full run detail
- [ ] `slc recipes` — table of fix recipes with counts
- [ ] `slc policies` — table of active policies with confidence scores
- [ ] `--json` flag on all commands for machine-readable output

**Done when:** A full run produces a clean terminal summary + `handoff.md`, and all history commands are usable.

---

## Phase 6 — Adapter Ecosystem

> Goal: prove the framework works across multiple domains.

- [ ] `src/adapters/bash/index.ts` — BashAdapter (run shell scripts as execution engine)
- [ ] `src/adapters/http/index.ts` — HttpAdapter (call REST APIs)
- [ ] `src/adapters/base.ts` — BaseAdapter abstract class with shared utilities
- [ ] Adapter registry — `adapterRegistry.register(name, adapter)`
- [ ] `slc run --adapter bash` — select adapter via CLI flag
- [ ] Integration test: run learning loop end-to-end with BashAdapter
- [ ] Document adapter authoring guide in `docs/creating-an-adapter.md`

**Done when:** A second adapter (Bash) works with the full learning loop, end-to-end.

---

## Definition of Done (System Level)

- [ ] System stores error signatures across runs ✓
- [ ] At least one fix recipe is learned automatically ✓
- [ ] Prevention policy is injected automatically into next run ✓
- [ ] Repeated error occurrence is reduced ✓
- [ ] At least 2 adapters (OpenClaw + Bash) working ✓
- [ ] All `slc` commands functional ✓
- [ ] `handoff.md` generated after every run ✓

---

## Backlog / Future

- [ ] `@perspective/torque-clustering` — extract as standalone package
- [ ] `@perspective/openclaw-adapter` — extract when stable
- [ ] Postgres memory backend
- [ ] OpenTelemetry telemetry sink
- [ ] LLMToolAdapter — LLM function-calling integration
- [ ] Web UI — run history dashboard
- [ ] Policy confidence decay (stale policies expire)
- [ ] Multi-agent orchestration (parallel runs with shared memory)
