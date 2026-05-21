<div align="center">

# perspective-core

### Self-learning execution layer for agents and automation

**Your agents run tasks. This makes them remember what worked, learn from what didn't, and get better every time.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-75%20passing-brightgreen.svg)](#testing)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Use Cases](#use-cases) · [Persona Engine](#planetary-persona-engine-v2) · [Build an Adapter](#build-an-adapter) · [Architecture](ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## The Problem

Every agent, script, and automation pipeline today runs **stateless**. It fails, you fix it, it fails the same way tomorrow. There's no memory. No learning. No improvement.

- CI builds break with the same missing dependency — again.
- Deploys fail on the same transient error — again.
- Your AI agent makes the same wrong move — again.
- Ops runbooks exist but nobody follows them — again.

**The fix is always the same. But nothing remembers.**

## The Solution

`perspective-core` sits between your execution engine and the real world. It **watches what happens**, **remembers what fails**, **learns what fixes it**, and **injects that knowledge into the next run** — automatically.

```
    Before perspective-core          After perspective-core
    ─────────────────────           ──────────────────────

    Run → Fail → Fix manually       Run → Fail → Learn fix
    Run → Fail → Fix manually       Run → Apply learned fix → Pass
    Run → Fail → Fix manually       Run → Prevent known failure → Pass
    Run → Fail → Fix manually       Run → Pass (policy active)
    ∞                                ✅ System improves itself
```

One interface. Plug in any execution engine. The framework handles the rest.

---

## Quick Start

```bash
# Install
npm install perspective-core

# Or clone and build from source
git clone https://github.com/DDMX2022/perspective-core.git
cd perspective-core
npm install && npm run build
```

### Run your first learning loop

```bash
# Execute a goal with the bash adapter
npx slc run --goal "build the project" --target ./my-repo --adapter bash

# See what happened
npx slc history

# Check what the system learned
npx slc recipes

# See active prevention policies
npx slc policies
```

### Use as a library

```typescript
import {
  Orchestrator,
  SqliteMemoryStore,
  TelemetryCollector,
  TorqueEngine,
  Learner,
  BashAdapter,
} from 'perspective-core'

const orchestrator = new Orchestrator({
  adapter: new BashAdapter(),
  memory: new SqliteMemoryStore('./data/memory.db'),
  telemetry: new TelemetryCollector(),
  torque: new TorqueEngine(),
  learner: new Learner(),
})

const result = await orchestrator.run(
  'deploy feature X to staging',
  'https://api.my-app.com',
)

// Run it again — policies from the first run are now active.
// Known failure modes are prevented automatically.
```

---

## How It Works

### The Learning Loop

Most systems run and forget. Perspective runs and **remembers**.

```
    ┌─────────────────────────────────────────────────────┐
    │                    Run N                             │
    │                                                     │
    │  1. Load policies learned from previous runs        │
    │  2. Analyse goal → pick strategy (torque profile)   │
    │  3. Execute via adapter                             │
    │  4. Capture every step, error, and recovery         │
    │  5. Extract error signatures                        │
    │  6. Match recovery steps to errors → fix recipe     │
    │  7. If recipe proven reliable → promote to policy   │
    │                                                     │
    └──────────────────────┬──────────────────────────────┘
                           │
                    policies flow down
                           │
    ┌──────────────────────▼──────────────────────────────┐
    │                   Run N+1                            │
    │                                                     │
    │  Policies injected → known failures prevented       │
    │  New errors captured → new recipes learned          │
    │  System gets better with every run                  │
    │                                                     │
    └─────────────────────────────────────────────────────┘
```

### Three stages of learning

| Stage | What happens | Stored as |
|---|---|---|
| **1. Error Signature** | Error is hashed into a stable, normalised fingerprint (paths, versions, line numbers stripped) | `errors` table |
| **2. Fix Recipe** | Recovery steps observed after an error are paired with its signature. Success/fail counts tracked. | `fix_recipes` table |
| **3. Prevention Policy** | After a recipe works reliably (≥3 successes, <30% failure rate), it's promoted to a policy and injected into future runs. | `policies` table |

### Policy actions

Policies aren't vague suggestions. They're structured instructions the adapter receives:

| Action | Meaning | Example |
|---|---|---|
| `require` | Enforce a prerequisite before proceeding | "Run `npm install` before build" |
| `avoid` | Skip a known-dangerous pattern | "Don't delete files without backup" |
| `prefer` | Bias toward a known-good approach | "Use the cached dependency resolution" |
| `warn` | Log a warning, proceed with caution | "This endpoint has been flaky — add retry" |

---

## Use Cases

### 🔧 Self-healing CI

Wrap your build/test commands with `BashAdapter`. When `npm test` fails because of a missing dep and the fix is always `npm install`, the system learns that recipe and prevents it next time.

### 🚀 Resilient deployments

Deploys fail from rate limits, unhealthy targets, missing env vars. The system fingerprints each failure, watches what the operator does to recover, and turns proven recoveries into policies.

### 🤖 Agents that stop repeating mistakes

Your LLM agent keeps deleting files it shouldn't, or calling APIs in the wrong order. Wrap it with an adapter. After a few runs, policies like **AVOID: direct file deletion** or **REQUIRE: dry-run first** are injected automatically.

### 📡 API reliability automation

Use `HttpAdapter` to probe endpoints. Classify non-2xx responses. Learn that "429 → wait 10s → retry" works. Promote it to a policy. Your monitoring becomes self-correcting.

### 🐳 Reproducible isolated execution

`DockerAdapter` wraps any inner adapter in a container. Consistent environments, dependency pinning, security boundaries — with the same learning loop underneath.

### 📋 Living runbooks

Instead of wiki pages nobody reads, the system **builds runbooks from observed behavior**. Fix recipes are the runbook. Policies are the enforcement.

---

## Build an Adapter

An adapter is the **only thing you implement** to integrate a new domain. One interface, one method:

```typescript
import { BaseAdapter } from 'perspective-core'
import type { RunContext, PolicyInstruction, ITelemetryCollector, ExecutionResult } from 'perspective-core'

export class MyAdapter extends BaseAdapter {
  constructor() {
    super('my-adapter')
  }

  protected async doExecute(
    run: RunContext,
    policies: PolicyInstruction[],
    telemetry: ITelemetryCollector,
  ): Promise<ExecutionResult> {
    // 1. Read policies — they tell you what to avoid, require, prefer
    // 2. Do your work
    // 3. Stream telemetry events as you go
    // 4. Return a structured result

    this.emit(telemetry, run.runId, 'step', 'Starting...')

    // ... your domain logic ...

    return {
      success: true,
      summary: 'Done',
      errors: [],
      steps: ['step 1', 'step 2'],
    }
  }
}
```

Then register it:

```typescript
import { adapterRegistry } from 'perspective-core'
import { MyAdapter } from './my-adapter.js'

adapterRegistry.register('my-adapter', new MyAdapter())
```

Now `npx slc run --adapter my-adapter --goal "..." --target "..."` works with the full learning loop.

📖 Full guide: [`docs/creating-an-adapter.md`](docs/creating-an-adapter.md)

### Built-in Adapters

| Adapter | What it wraps |
|---|---|
| `BashAdapter` | Shell commands and scripts |
| `HttpAdapter` | REST API calls |
| `DockerAdapter` | Containerised execution (wraps any inner adapter) |
| `OpenClawAdapter` | OpenClaw CLI agent |
| `MockAdapter` | Deterministic scenarios for testing |

---

## Torque Engine — Strategy Selection

Not every run should behave the same way. The **Torque Engine** analyses the goal and run history to derive a strategy profile across five dimensions:

| Dimension | When dominant |
|---|---|
| `stability` | Prefer tested, reversible actions. Use proven recipes. |
| `speed` | Minimise time. Skip optional validation. |
| `safety` | Use dry-run flags. Avoid destructive operations. |
| `cost` | Minimise API calls and resource usage. |
| `quality` | Maximise correctness. Run full validation. |

The dominant dimension is passed to the adapter, so it can adjust behavior per run.

---

## Planetary Persona Engine v2

The **Planetary Persona Engine v2** is an experimental symbolic personality module that sits beside the existing learning, memory, torque, and adapter architecture. It is designed as a **simulated reflective self-model** and **reflective agent layer**, not an astrology chatbot and not a claim of real consciousness.

The first vertical slice includes:

- Seven default symbolic planet agents: Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn
- Deterministic planet activation from user input
- Planet interaction graph with dominant interaction scoring
- Crux Engine v1 for root-tension extraction
- LLM prompt orchestration behind a mockable `LLMAdapter`
- In-memory memory candidates
- Structured self-reflection output
- Local debug UI for testing the full pipeline

Example:

```typescript
import { analyzePersonality } from 'perspective-core'

const result = await analyzePersonality({
  text: 'I want to start my business but I am scared.',
})

console.log(result.crux.realCrux)
// expansion versus safety
```

Run the local debug UI:

```bash
npm run debug:persona
```

Then open the printed URL, usually:

```txt
http://127.0.0.1:4321
```

The debug UI shows the generated response, active planets, dominant interaction, crux, reflection, memory candidates, and raw JSON output.

Safety framing: the module must describe itself as a symbolic personality engine or simulated reflective self-model. It must not claim the AI is conscious, has real feelings, or has real subjective experience.

Full docs: [`docs/planetary-persona-engine-v2.md`](docs/planetary-persona-engine-v2.md)

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Orchestrator                         │
│                                                          │
│  policy loading → torque analysis → execute → learn      │
└──────┬──────────────────┬──────────────────┬─────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
  IExecutionAdapter   MemoryStore       TorqueEngine
  (your domain)       (SQLite)          (strategy)
       │                  │
       ▼                  │
  TelemetryCollector ─────┘
       │
       ▼
     Learner
  (recipes → policies)
```

| Module | Path | What it does |
|---|---|---|
| **Orchestrator** | `src/orchestrator/` | Runs the full lifecycle: load → execute → learn → persist |
| **Memory** | `src/memory/` | SQLite store for runs, events, errors, recipes, policies |
| **Telemetry** | `src/telemetry/` | Structured event capture, buffering, flush |
| **Learner** | `src/learner/` | Fix recipe extraction, policy promotion (Wilson score) |
| **Torque** | `src/torque/` | Goal analysis, dimension weighting, strategy selection |
| **Planetary Persona Engine** | `src/planetary-persona-engine/` | Symbolic reflective layer: activation, interactions, crux, prompt orchestration, memory candidates |
| **Adapters** | `src/adapters/` | Execution engine integrations |
| **CLI** | `src/cli/` | `slc` command-line interface |
| **Types** | `src/types/` | All shared interfaces and contracts |
| **Config** | `src/config/` | Environment, logging, runtime configuration |

📖 Deep-dive: [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## CLI Reference

```bash
slc run --goal <goal> --target <target> [--adapter <name>] [--persona <p>] [--watch]
slc history [--limit <n>] [--id <prefix>] [--json]
slc recipes [--json]
slc policies [--json]
slc handoff <runId>
slc export
slc recipes-delete <signature>
slc policies-delete <id>
```

After each run, a [`handoff.md`](ARCHITECTURE.md#7-handoff-artifact) is generated in `./runs/<run-id>/` with a full summary of what happened, what was learned, and what policies will apply next.

---

## LLM Integration (Optional)

The framework is **LLM-optional**. Every intelligence seam has a deterministic fallback. Plug in an LLM when you want richer analysis:

| Seam | Without LLM | With LLM |
|---|---|---|
| Error classification | Regex pattern matching | `IErrorClassifierLLM` — richer categorisation |
| Error enrichment | Raw message only | OpenAI / Anthropic / Ollama enrichers |
| Torque analysis | Keyword heuristics | `IGoalAnalyserLLM` — semantic goal understanding |
| Persona response | Mock reflective response | `LLMAdapter` — voice layer over structured persona state |
| Recipe extraction | Event-type matching | LLM reads raw logs → better fix steps |
| Policy descriptions | Template strings | LLM writes human-readable policy text |

---

## Testing

```bash
# Unit tests (75 passing)
npm test

# End-to-end learning loop
npm run test:e2e

# Planetary Persona Engine debug UI
npm run debug:persona

# Type checking
npm run typecheck
```

---

## Roadmap

See [`TODO.md`](./TODO.md) for the full build plan. Key upcoming work:

- [ ] `LLMToolAdapter` — LLM function-calling as an execution engine
- [ ] Web dashboard for run history and policy management
- [ ] Multi-agent orchestration with shared memory
- [ ] Postgres memory backend for scale
- [ ] OpenTelemetry sink
- [ ] Extractable packages (`@perspective/torque`, `@perspective/openclaw-adapter`)

---

## Contributing

We welcome contributions! Whether it's a new adapter, a bug fix, improved docs, or a feature idea — [we'd love your help](CONTRIBUTING.md).

```bash
# Fork, clone, branch
git checkout -b my-feature

# Make your changes, then
npm test
npm run typecheck

# Open a PR
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for detailed guidelines.

---

## License

[MIT](LICENSE) — use it, fork it, build on it.
