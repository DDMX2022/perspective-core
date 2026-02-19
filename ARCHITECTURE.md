# Architecture — perspective-core

> Deep-dive into how the system is structured, how modules communicate, and how to extend it.

---

## 1. Guiding Principles

1. **Domain-agnostic core** — The orchestrator, memory, learner, and torque modules know nothing about OpenClaw, bash, or any other execution engine. They operate purely on abstract types.
2. **Adapter pattern for execution** — Everything domain-specific lives behind `IExecutionAdapter`. Swap out the execution engine without touching the learning loop.
3. **Memory-first design** — Every run, event, error, and policy is persisted before acting on it. No in-memory-only state.
4. **Policies as first-class citizens** — Learned policies are structured data (`PolicyInstruction`), not free-form text. This makes them injectable, auditable, and testable.
5. **Observable by default** — Telemetry is not optional. Adapters are required to stream events through `ITelemetryCollector`.

---

## 2. System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         User / CLI                              │
└───────────────────────────────┬─────────────────────────────────┘
                                │  goal, target, persona
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestrator                               │
│                                                                 │
│  1. Generate run ID & context                                   │
│  2. Load active policies from MemoryStore                       │
│  3. Run TorqueEngine.analyse(goal, history) → TorqueProfile     │
│  4. Apply policies to profile                                   │
│  5. Call adapter.execute(run, policies, telemetry)              │
│  6. Persist ExecutionResult events                              │
│  7. Run Learner.extractFixRecipe()                              │
│  8. Run Learner.generatePolicy() if threshold met               │
│  9. Update run status in MemoryStore                            │
│ 10. Write handoff.md artifact                                   │
└───────────────┬──────────────────────────────────┬─────────────┘
                │                                  │
                ▼                                  ▼
┌──────────────────────────┐       ┌───────────────────────────┐
│   IExecutionAdapter      │       │      MemoryStore          │
│  (domain integration)    │       │      (SQLite)             │
│                          │       │                           │
│  • OpenClawAdapter       │       │  runs                     │
│  • BashAdapter           │       │  events                   │
│  • HttpAdapter           │       │  errors                   │
│  • YourAdapter ◄──────── │───────│  fix_recipes              │
│                          │       │  policies                 │
└──────────────────────────┘       └───────────────────────────┘
                │
                ▼
┌──────────────────────────┐
│   TelemetryCollector     │
│                          │
│  capture() → buffer      │
│  flush()   → MemoryStore │
└──────────────────────────┘
```

---

## 3. Module Contracts

### 3.1 IExecutionAdapter — The Integration Surface

This is the **only interface you need to implement** to integrate a new domain.

```typescript
interface IExecutionAdapter {
  readonly name: string

  execute(
    run: RunContext,
    policies: PolicyInstruction[],   // ← active prevention policies
    telemetry: ITelemetryCollector,  // ← stream events here
  ): Promise<ExecutionResult>

  validate?(): Promise<boolean>      // ← optional health check
}
```

**Responsibilities of an adapter:**
- Accept `policies` and use them to influence execution strategy
- Stream all meaningful events through `telemetry.capture()`
- Return a structured `ExecutionResult` with errors and steps
- NOT interact with the memory store directly

### 3.2 IMemoryStore

The memory store is SQLite-backed and is the single source of truth for all persistent state.

```typescript
interface IMemoryStore {
  saveRun / updateRunStatus / getRun / listRuns
  saveEvent / getEvents
  saveError / getErrors
  upsertFixRecipe / getFixRecipe / listFixRecipes
  savePolicy / getPolicy / listPolicies
  close()
}
```

### 3.3 ITelemetryCollector

Buffers events during a run and flushes them to the memory store at the end (or in real-time for streaming).

```typescript
interface ITelemetryCollector {
  capture(event: Omit<TelemetryEvent, 'id'>): void
  flush(): void
  getEvents(runId: string): TelemetryEvent[]
}
```

### 3.4 ITorqueEngine

Analyses the goal and run history to derive a weighted strategic profile.

```typescript
interface ITorqueEngine {
  analyse(goal: string, history: RunContext[]): TorqueProfile
  applyPolicies(profile: TorqueProfile, policies: Policy[]): TorqueProfile
}
```

**TorqueDimensions:** `stability | speed | safety | cost | quality`

The dominant dimension influences adapter behaviour. Example:
- `safety` dominant → OpenClawAdapter uses `--dry-run` flags, prefers reversible actions
- `speed` dominant → OpenClawAdapter skips validation passes
- `stability` dominant → prefer previously-successful fix recipes over novel approaches

### 3.5 ILearner

Converts observed execution data into reusable knowledge.

```typescript
interface ILearner {
  extractFixRecipe(runId, errors, events): FixRecipe | null
  generatePolicy(recipe): Policy | null
}
```

**Fix recipe promotion threshold:** After a fix recipe has `successCount >= 3` and `failCount / successCount < 0.3`, it is promoted to a prevention policy with `confidence` score.

---

## 4. Learning Loop — Detailed

```
Run N completes
    │
    ├─ errors detected?
    │       │ yes
    │       ▼
    │  extract error signatures
    │  (hash of: error type + message pattern + context)
    │       │
    │       ▼
    │  scan events for recovery steps
    │  (events after the error, before next error or success)
    │       │
    │       ▼
    │  upsertFixRecipe(signature, recoverySteps)
    │  → increment successCount or failCount based on run outcome
    │       │
    │       ▼
    │  if recipe.successCount >= THRESHOLD
    │       │
    │       ▼
    │  generatePolicy(recipe)
    │  → PolicyInstruction { action, description, hints }
    │  → saved to policies table
    │
Run N+1 starts
    │
    ├─ load policies matching current goal signatures
    ├─ inject as PolicyInstruction[] into adapter.execute()
    └─ adapter uses policies to avoid known failure modes
```

---

## 5. Database Schema (Full)

```sql
-- Run lifecycle
CREATE TABLE runs (
  run_id    TEXT PRIMARY KEY,
  goal      TEXT NOT NULL,
  target    TEXT NOT NULL,
  persona   TEXT,
  timestamp TEXT NOT NULL,
  status    TEXT NOT NULL CHECK(status IN ('pending','running','success','failed','aborted')),
  meta      TEXT  -- JSON blob for domain-specific metadata
);

-- Structured event stream
CREATE TABLE events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id    TEXT NOT NULL REFERENCES runs(run_id),
  type      TEXT NOT NULL,
  content   TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

-- Extracted error signatures
CREATE TABLE errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES runs(run_id),
  signature   TEXT NOT NULL,
  category    TEXT NOT NULL,
  raw_message TEXT NOT NULL
);

-- Learned fix recipes
CREATE TABLE fix_recipes (
  signature     TEXT PRIMARY KEY,
  fix_steps_json TEXT NOT NULL,  -- JSON array of strings
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  last_updated  TEXT NOT NULL
);

-- Prevention policies derived from recipes
CREATE TABLE policies (
  policy_id          TEXT PRIMARY KEY,
  trigger_signature  TEXT NOT NULL,
  policy_json        TEXT NOT NULL,  -- JSON PolicyInstruction
  confidence         REAL NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE INDEX idx_events_run_id    ON events(run_id);
CREATE INDEX idx_errors_run_id    ON errors(run_id);
CREATE INDEX idx_errors_signature ON errors(signature);
CREATE INDEX idx_policies_trigger ON policies(trigger_signature);
```

---

## 6. Policy Injection Flow

```
Orchestrator.run(goal, target)
    │
    ├─ memory.listPolicies()
    │       → all active policies
    │
    ├─ filter policies relevant to current goal
    │   (signature match, keyword overlap, or domain tags)
    │
    ├─ torque.applyPolicies(profile, relevantPolicies)
    │   → adjusts dimension weights based on policy actions
    │
    └─ adapter.execute(run, relevantPolicies.map(p => p.policyJson), telemetry)
            │
            └─ adapter reads PolicyInstruction[]
                   • action: 'avoid'   → skip dangerous patterns
                   • action: 'prefer'  → bias toward known-good paths
                   • action: 'require' → enforce prerequisites
                   • action: 'warn'    → log warning, proceed carefully
```

---

## 7. Handoff Artifact

After each run, the orchestrator writes `./runs/<run-id>/handoff.md`:

```markdown
# Run Handoff — <run-id>

## Goal
<goal text>

## Target
<target>

## Status
✅ Success | ❌ Failed

## Strategy (Torque Profile)
- Dominant: stability
- Dimensions: stability=0.8, safety=0.7, speed=0.3

## Steps Taken
1. ...
2. ...

## Errors Encountered
- [dependency] Missing package xyz → fixed via `npm install xyz`

## Policies Applied
- AVOID: direct file deletion without backup (confidence: 0.92)

## New Recipes Learned
- none

## Next Run Hints
- Policy PID-003 will be active
```

---

## 8. Extension Points

| Extension Point | How to Extend |
|---|---|
| New execution domain | Implement `IExecutionAdapter` |
| Custom memory backend | Implement `IMemoryStore` (swap SQLite for Postgres, Redis, etc.) |
| Custom torque dimensions | Extend `TorqueDimension` union type |
| Custom error categorisation | Override `ErrorClassifier` in the learner |
| Custom policy scoring | Override `confidenceScore()` in the learner |
| Custom telemetry sink | Implement `ITelemetryCollector` (e.g. send to OpenTelemetry) |

---

## 9. Future Packages (When Ready to Split)

| Package | When to split |
|---|---|
| `@perspective/torque-clustering` | When used by 2+ independent projects |
| `@perspective/openclaw-adapter` | When OpenClaw adapter has its own release cycle |
| `@perspective/memory-postgres` | When a Postgres backend is needed for scale |
