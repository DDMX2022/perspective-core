# Creating an Adapter

> How to integrate a new execution engine or domain with perspective-core.

---

## Overview

An **adapter** is the primary integration surface in perspective-core. It wraps any execution engine — a CLI tool, REST API, shell script, database migration runner, LLM function-calling, or anything else — and exposes it to the learning loop.

The learning loop provides:
- **Memory** — errors, events, and run context persisted across runs
- **Fix Recipes** — automatically extracted recovery patterns
- **Policies** — prevention rules promoted from proven recipes
- **Torque Profiles** — strategic dimension weighting per run
- **Handoff Artifacts** — markdown summaries of each run

Your adapter only needs to implement **one method**: `execute()`.

---

## Quick Start

### Option 1: Extend `BaseAdapter` (recommended)

```typescript
import { BaseAdapter } from 'perspective-core'
import type {
  RunContext,
  PolicyInstruction,
  ITelemetryCollector,
  ExecutionResult,
} from 'perspective-core'

export class MyAdapter extends BaseAdapter {
  constructor() {
    super('my-adapter') // unique adapter name
  }

  protected async doExecute(
    run: RunContext,
    policies: PolicyInstruction[],
    telemetry: ITelemetryCollector,
  ): Promise<ExecutionResult> {
    const steps: string[] = []
    const errors: ExecutionResult['errors'] = []

    // Emit telemetry events as you go
    this.emit(telemetry, run.runId, 'step', 'Starting execution...')
    steps.push('Starting execution...')

    try {
      // ... your domain logic here ...

      // On error, classify and track it
      // const classified = this.classifyError(rawErrorMessage, run.runId)
      // errors.push(classified)

      return this.successResult(steps)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(this.classifyError(message, run.runId))
      return this.failureResult(steps, errors, `MyAdapter failed: ${message}`)
    }
  }
}
```

### Option 2: Implement `IExecutionAdapter` directly

```typescript
import type {
  IExecutionAdapter,
  RunContext,
  PolicyInstruction,
  ITelemetryCollector,
  ExecutionResult,
} from 'perspective-core'

export class MyAdapter implements IExecutionAdapter {
  readonly name = 'my-adapter'

  async validate(): Promise<boolean> {
    // Check that dependencies are available
    return true
  }

  async execute(
    run: RunContext,
    policies: PolicyInstruction[],
    telemetry: ITelemetryCollector,
  ): Promise<ExecutionResult> {
    // ... implementation ...
    return {
      success: true,
      exitCode: 0,
      summary: 'Completed successfully',
      errors: [],
      steps: ['Step 1', 'Step 2'],
    }
  }
}
```

---

## Interface Reference

### `IExecutionAdapter`

| Property/Method | Type | Description |
|---|---|---|
| `name` | `string` (readonly) | Unique identifier for this adapter |
| `validate?()` | `Promise<boolean>` | Check that dependencies are available |
| `execute()` | `Promise<ExecutionResult>` | Run the goal against the target |

### `execute()` Parameters

| Parameter | Type | Description |
|---|---|---|
| `run` | `RunContext` | The current run context (ID, goal, target, persona) |
| `policies` | `PolicyInstruction[]` | Active prevention policies to inject |
| `telemetry` | `ITelemetryCollector` | Collector for streaming events |

### `ExecutionResult`

| Field | Type | Description |
|---|---|---|
| `success` | `boolean` | Whether the execution succeeded |
| `exitCode?` | `number` | Process exit code (if applicable) |
| `summary` | `string` | Human-readable summary for handoff.md |
| `errors` | `Array<{signature, category, raw}>` | Classified errors |
| `steps` | `string[]` | Ordered list of steps taken |

---

## BaseAdapter Helpers

When you extend `BaseAdapter`, you get these utilities for free:

| Method | Description |
|---|---|
| `this.ts()` | Returns current ISO timestamp |
| `this.emit(telemetry, runId, type, content)` | Emit a telemetry event |
| `this.classifyError(raw, runId)` | Classify a raw error string |
| `this.successResult(steps, errors?, exitCode?)` | Build a success result |
| `this.failureResult(steps, errors, summary?, exitCode?)` | Build a failure result |

---

## Telemetry Event Types

Emit these event types via `telemetry.capture()`:

| Type | When to emit |
|---|---|
| `step` | Each meaningful step of execution |
| `output` | Raw output from the execution engine |
| `error` | When an error is detected |
| `recovery` | When a recovery action is taken (critical for learning!) |
| `policy_applied` | When a policy influences execution |
| `info` | Informational messages |

### Why `recovery` events matter

The **Learner** extracts fix recipes by looking for `recovery` events that follow `error` events. If your adapter can detect that an error was resolved (e.g., a retry succeeded, a fallback was used), emit a `recovery` event:

```typescript
telemetry.capture({
  runId: run.runId,
  type: 'recovery',
  content: 'Retried with fallback dependency and succeeded',
  timestamp: new Date().toISOString(),
})
```

---

## Injecting Policies

Policies are structured instructions that should influence your adapter's behaviour. Each policy has:

```typescript
interface PolicyInstruction {
  action: 'avoid' | 'prefer' | 'require' | 'warn'
  description: string
  hints?: Record<string, unknown>
}
```

How to use them depends on your domain:

- **CLI tools**: Pass as flags, env vars, or config file
- **REST APIs**: Send as headers or request body fields
- **LLM tools**: Include in the system prompt
- **Shell scripts**: Export as `PERSPECTIVE_POLICY_*` env vars

---

## Registering Your Adapter

```typescript
import { adapterRegistry } from 'perspective-core'
import { MyAdapter } from './my-adapter.js'

// Register it
adapterRegistry.register('my-adapter', new MyAdapter())

// Now usable via CLI:
// slc run --adapter my-adapter --goal "..." --target "..."
```

---

## Built-in Adapters

| Adapter | Description | Use case |
|---|---|---|
| `OpenClawAdapter` | Spawns the OpenClaw CLI | AI agent execution |
| `BashAdapter` | Runs shell commands | Scripts, builds, deploys |
| `DockerAdapter` | Runs inside Docker containers | Isolated/reproducible envs |
| `HttpAdapter` | Calls REST APIs | Remote task execution |
| `MockAdapter` | Deterministic test scenarios | Testing the learning loop |

---

## Testing Your Adapter

```typescript
import { Orchestrator, SqliteMemoryStore, TelemetryCollector, TorqueEngine, Learner } from 'perspective-core'
import { MyAdapter } from './my-adapter.js'

const memory = new SqliteMemoryStore(':memory:')
const telemetry = new TelemetryCollector().withMemory(memory)

const orchestrator = new Orchestrator({
  adapter: new MyAdapter(),
  memory,
  telemetry,
  torque: new TorqueEngine(),
  learner: new Learner(),
})

const run = await orchestrator.run('my goal', 'my target')
console.log(run.status) // 'success' | 'failed'

// Check what was learned
const recipes = memory.listFixRecipes()
const policies = memory.listPolicies()
```

---

## Checklist

- [ ] Adapter has a unique `name`
- [ ] `execute()` returns a proper `ExecutionResult`
- [ ] Errors are classified (use `defaultClassifier.classify()` or `this.classifyError()`)
- [ ] Steps are emitted as telemetry events
- [ ] Recovery actions emit `recovery` events
- [ ] Policies are injected into the execution context
- [ ] `validate()` checks for required dependencies
- [ ] Adapter is registered via `adapterRegistry.register()`
