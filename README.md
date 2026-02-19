# perspective-core

> A **domain-agnostic self-learning agent framework** that wraps any execution engine with memory, telemetry, cross-run policy learning, and torque-driven decision guidance.

---

## What is this?

`perspective-core` is the brain layer that sits **above** any execution engine. It doesn't care whether you're running shell scripts, spawning CLI tools, calling APIs, or invoking LLM tool-use — as long as you implement a single `IExecutionAdapter`, the framework gives you:

- 📦 **Persistent memory** across runs (SQLite)
- 📡 **Structured telemetry** — commands, steps, errors, outputs
- 🧠 **Automatic learning** — recurring failures become fix recipes; fix recipes become prevention policies
- ⚡ **Policy injection** — policies from past failures are injected into future runs automatically
- 🔁 **Torque Clustering** — dominant force analysis (stability, speed, safety, cost, quality) guides execution strategy
- 🖥️ **CLI** — `slc run`, `slc history`, auto-generated `handoff.md`

---

## Architecture

```
User / CLI
    ↓
Orchestrator (Perspective Brain)
    ├── loads active policies from memory
    ├── runs torque analysis on goal + history
    ↓
IExecutionAdapter  ←── YOUR INTEGRATION POINT
    ├── OpenClawAdapter  (default)
    ├── BashAdapter
    ├── HttpAdapter
    └── YourDomainAdapter  (implement & plug in)
    ↓
ExecutionResult
    ↓
Telemetry Collector  →  Memory Store (SQLite)
    ↓
Learner
    ├── extract fix recipes from errors
    └── generate prevention policies
    ↓
Policies saved → injected into NEXT run
```

---

## Quick Start

```bash
# Clone & install
git clone https://github.com/your-org/perspective-core.git
cd perspective-core
npm install

# Run with the OpenClaw adapter (default)
npx slc run --goal "refactor auth module" --target ./my-repo

# View run history
npx slc history

# Build
npm run build
```

---

## Integration Guide — Bring Your Own Domain

`perspective-core` is built to be **integrated with any domain** by implementing a single interface:

```typescript
import type { IExecutionAdapter, RunContext, PolicyInstruction, ITelemetryCollector, ExecutionResult } from 'perspective-core'

export class MyDomainAdapter implements IExecutionAdapter {
  readonly name = 'my-domain'

  async execute(
    run: RunContext,
    policies: PolicyInstruction[],
    telemetry: ITelemetryCollector,
  ): Promise<ExecutionResult> {
    // 1. Use `policies` to guide your execution strategy
    // 2. Use `telemetry.capture()` to stream events back
    // 3. Return a structured ExecutionResult

    telemetry.capture({ runId: run.runId, type: 'step', content: 'Starting task...', timestamp: new Date().toISOString() })

    // ... your domain logic here ...

    return {
      success: true,
      summary: 'Task completed successfully',
      errors: [],
      steps: ['step 1', 'step 2'],
    }
  }

  async validate(): Promise<boolean> {
    // Optional: check that your tool/API is available
    return true
  }
}
```

Then wire it into the orchestrator:

```typescript
import { Orchestrator } from 'perspective-core/orchestrator'
import { SqliteMemoryStore } from 'perspective-core/memory'
import { TelemetryCollector } from 'perspective-core/telemetry'
import { TorqueEngine } from 'perspective-core/torque'
import { Learner } from 'perspective-core/learner'
import { MyDomainAdapter } from './adapters/my-domain.js'

const orchestrator = new Orchestrator({
  adapter: new MyDomainAdapter(),
  memory: new SqliteMemoryStore('./data/memory.db'),
  telemetry: new TelemetryCollector(),
  torque: new TorqueEngine(),
  learner: new Learner(),
})

const result = await orchestrator.run(
  'Deploy feature X to staging',
  'https://api.my-domain.com',
)

console.log(result.status) // 'success' | 'failed'
```

---

## Module Overview

| Module | Path | Responsibility |
|---|---|---|
| **Types** | `src/types/` | All shared interfaces — the contract between modules |
| **Config** | `src/config/` | Env vars, logger, runtime config |
| **Memory** | `src/memory/` | SQLite store — runs, events, errors, recipes, policies |
| **Telemetry** | `src/telemetry/` | Event capture, buffering, flush to memory |
| **Orchestrator** | `src/orchestrator/` | Core run lifecycle — policy load → execute → learn |
| **Torque** | `src/torque/` | Dominant force analysis & strategy selection |
| **Learner** | `src/learner/` | Fix recipe extraction & policy generation |
| **Adapters** | `src/adapters/` | Execution engine integrations (OpenClaw, Bash, etc.) |
| **CLI** | `src/cli/` | `slc` command — run, history, handoff |

---

## Database Schema

```sql
runs(run_id, goal, target, persona, timestamp, status, meta)
events(id, run_id, type, content, timestamp)
errors(id, run_id, signature, category, raw_message)
fix_recipes(signature, fix_steps_json, success_count, fail_count, last_updated)
policies(policy_id, trigger_signature, policy_json, confidence, created_at)
```

---

## Learning Loop

```
1.  Execute task via adapter
2.  Capture telemetry (commands, steps, errors, outputs)
3.  Detect errors → extract error signatures
4.  Find recovery steps in event stream
5.  Store / update fix recipe (signature → steps)
6.  If recipe confidence threshold met → generate prevention policy
7.  Inject active policies into NEXT run prompt
8.  Repeat → system improves with every run
```

---

## Torque Clustering

The **Torque Engine** analyses the goal text and run history to derive a weighted profile across five dimensions:

| Dimension | Meaning |
|---|---|
| `stability` | Prefer safe, tested, reversible actions |
| `speed` | Minimise time-to-completion |
| `safety` | Avoid destructive or irreversible operations |
| `cost` | Minimise resource / API usage |
| `quality` | Maximise output correctness and completeness |

The **dominant dimension** drives strategy selection and is passed to the adapter as context.

---

## Adapters (Built-in & Planned)

| Adapter | Status | Description |
|---|---|---|
| `OpenClawAdapter` | 🚧 In Progress | Spawns OpenClaw CLI, streams logs |
| `DockerAdapter` | ✅ Skeleton Ready | Wraps any execution in an isolated container |
| `BashAdapter` | 📋 Planned | Runs shell scripts / commands |
| `HttpAdapter` | 📋 Planned | Calls REST APIs |
| `LLMToolAdapter` | 📋 Planned | LLM function-calling tool use |

---

## CLI Reference

```bash
slc run --goal <goal> --target <target> [--persona <persona>]
slc history [--limit <n>]
slc recipes          # list learned fix recipes
slc policies         # list active prevention policies
```

After each run, a `handoff.md` is generated in `./runs/<run-id>/` with a full summary.

---

## Roadmap

See [`TODO.md`](./TODO.md) for the full phase-by-phase build plan.

---

## License

MIT
