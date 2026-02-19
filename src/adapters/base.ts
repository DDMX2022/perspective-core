/**
 * BaseAdapter — Abstract base class with shared utilities for all adapters.
 *
 * Provides common functionality:
 *   - Standard name property
 *   - Default validate() implementation
 *   - Shared helpers for building error results, telemetry timestamps, etc.
 *
 * Extend this class instead of implementing IExecutionAdapter directly
 * to get these utilities for free.
 *
 * @example
 *   class MyAdapter extends BaseAdapter {
 *     constructor() { super('my-adapter') }
 *     async doExecute(run, policies, telemetry) { ... }
 *   }
 */

import type {
  IExecutionAdapter,
  RunContext,
  PolicyInstruction,
  ITelemetryCollector,
  ExecutionResult,
  ErrorCategory,
} from '../types/index.js'
import { defaultClassifier } from '../memory/index.js'

export abstract class BaseAdapter implements IExecutionAdapter {
  readonly name: string

  constructor(name: string) {
    this.name = name
  }

  /**
   * Default validate — always returns true.
   * Override to check that required binaries / services are available.
   */
  async validate(): Promise<boolean> {
    return true
  }

  /**
   * Execute the goal. Delegates to doExecute() which subclasses implement.
   */
  async execute(
    run: RunContext,
    policies: PolicyInstruction[],
    telemetry: ITelemetryCollector,
  ): Promise<ExecutionResult> {
    return this.doExecute(run, policies, telemetry)
  }

  /**
   * Subclasses implement this method to perform the actual execution.
   */
  protected abstract doExecute(
    run: RunContext,
    policies: PolicyInstruction[],
    telemetry: ITelemetryCollector,
  ): Promise<ExecutionResult>

  // ── Shared Helpers ────────────────────────────────────────────────────

  /** ISO timestamp for right now */
  protected ts(): string {
    return new Date().toISOString()
  }

  /** Emit a telemetry event */
  protected emit(
    telemetry: ITelemetryCollector,
    runId: string,
    type: 'step' | 'error' | 'output' | 'recovery' | 'info' | 'policy_applied',
    content: string,
  ): void {
    telemetry.capture({ runId, type, content, timestamp: this.ts() })
  }

  /** Classify a raw error string using the default classifier */
  protected classifyError(raw: string, runId: string): {
    signature: string
    category: ErrorCategory
    raw: string
  } {
    const { signature, category } = defaultClassifier.classify(raw, runId)
    return { signature, category, raw }
  }

  /** Build a success ExecutionResult */
  protected successResult(steps: string[], errors: ExecutionResult['errors'] = [], exitCode = 0): ExecutionResult {
    return {
      success: true,
      exitCode,
      summary: `${this.name} completed successfully (${steps.length} steps)`,
      errors,
      steps,
    }
  }

  /** Build a failure ExecutionResult */
  protected failureResult(
    steps: string[],
    errors: ExecutionResult['errors'],
    summary?: string,
    exitCode?: number,
  ): ExecutionResult {
    return {
      success: false,
      exitCode: exitCode ?? 1,
      summary: summary ?? `${this.name} failed with ${errors.length} error(s)`,
      errors,
      steps,
    }
  }
}
