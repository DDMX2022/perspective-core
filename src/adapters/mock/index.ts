import type {
  IExecutionAdapter,
  RunContext,
  PolicyInstruction,
  ITelemetryCollector,
  ExecutionResult,
  ErrorCategory,
} from '../../types/index.js'

export interface MockScenario {
  /** Whether this run should succeed */
  success: boolean
  /** Simulated output steps */
  steps?: string[]
  /** Simulated errors (triggers learning loop) */
  errors?: Array<{
    signature: string
    category: ErrorCategory
    raw: string
  }>
  /**
   * Simulated recovery steps emitted AFTER the first error.
   * These are what the Learner picks up to build fix recipes.
   */
  recoverySteps?: string[]
  /** Artificial delay per step in ms (default: 0) */
  stepDelayMs?: number
}

/**
 * MockAdapter
 *
 * A fully deterministic execution adapter for testing the learning loop
 * end-to-end without any real execution engine.
 *
 * Supports scripted scenarios: steps, errors, recovery steps, success/fail.
 *
 * Usage:
 *
 *   // Simulate a failing run that recovers
 *   const adapter = new MockAdapter({
 *     success: false,
 *     steps: ['Cloning repo...', 'Installing deps...'],
 *     errors: [{ signature: 'dependency::missing-package-xyz', category: 'dependency', raw: 'Cannot find module xyz' }],
 *     recoverySteps: ['Running: npm install xyz', 'Retrying...'],
 *   })
 *
 *   // Cycle through multiple scenarios (one per run)
 *   const adapter = new MockAdapter([scenario1, scenario2, scenario3])
 */
export class MockAdapter implements IExecutionAdapter {
  readonly name = 'mock'

  private scenarios: MockScenario[]
  private callCount = 0

  constructor(scenarioOrScenarios: MockScenario | MockScenario[]) {
    this.scenarios = Array.isArray(scenarioOrScenarios)
      ? scenarioOrScenarios
      : [scenarioOrScenarios]
  }

  async validate(): Promise<boolean> {
    return true
  }

  async execute(
    run: RunContext,
    policies: PolicyInstruction[],
    telemetry: ITelemetryCollector,
  ): Promise<ExecutionResult> {
    // Cycle through scenarios; repeat last one indefinitely
    const scenario = this.scenarios[Math.min(this.callCount, this.scenarios.length - 1)]!
    this.callCount++

    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
    const ts = () => new Date().toISOString()

    // Log which policies are active (useful for verifying injection)
    if (policies.length > 0) {
      telemetry.capture({
        runId: run.runId,
        type: 'policy_applied',
        content: `Policies active: ${policies.map((p) => p.action + ':' + p.description.slice(0, 40)).join(' | ')}`,
        timestamp: ts(),
      })
    }

    // Emit normal steps
    for (const step of scenario.steps ?? ['Starting task...', 'Processing...', 'Done.']) {
      if (scenario.stepDelayMs) await delay(scenario.stepDelayMs)
      telemetry.capture({ runId: run.runId, type: 'step', content: step, timestamp: ts() })
    }

    // Emit errors
    for (const err of scenario.errors ?? []) {
      telemetry.capture({ runId: run.runId, type: 'error', content: err.raw, timestamp: ts() })
    }

    // Emit recovery steps (after errors)
    for (const recovery of scenario.recoverySteps ?? []) {
      if (scenario.stepDelayMs) await delay(scenario.stepDelayMs)
      telemetry.capture({ runId: run.runId, type: 'recovery', content: recovery, timestamp: ts() })
    }

    return {
      success: scenario.success,
      exitCode: scenario.success ? 0 : 1,
      summary: scenario.success
        ? `Mock run succeeded (${(scenario.steps ?? []).length} steps)`
        : `Mock run failed with ${(scenario.errors ?? []).length} error(s)`,
      errors: scenario.errors ?? [],
      steps: [
        ...(scenario.steps ?? []),
        ...(scenario.recoverySteps ?? []),
      ],
    }
  }

  /** Reset the call counter (useful between test runs) */
  reset(): void {
    this.callCount = 0
  }

  get currentCallCount(): number {
    return this.callCount
  }
}
