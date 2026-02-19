import { spawn } from 'child_process'
import type {
  IExecutionAdapter,
  RunContext,
  PolicyInstruction,
  ITelemetryCollector,
  ExecutionResult,
  ErrorCategory,
} from '../../types/index.js'

/**
 * OpenClawAdapter
 *
 * Spawns the OpenClaw CLI, streams its stdout/stderr through the telemetry
 * collector, and returns a structured ExecutionResult.
 *
 * Policies are injected as --policy flags and as a JSON context file.
 */
export class OpenClawAdapter implements IExecutionAdapter {
  readonly name = 'openclaw'

  private readonly cliBin: string

  constructor(cliBin = 'openclaw') {
    this.cliBin = cliBin
  }

  async validate(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.cliBin, ['--version'])
      proc.on('close', (code: number | null) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  async execute(
    run: RunContext,
    policies: PolicyInstruction[],
    telemetry: ITelemetryCollector,
  ): Promise<ExecutionResult> {
    const steps: string[] = []
    const errors: ExecutionResult['errors'] = []

    const args = this.buildArgs(run, policies)

    return new Promise((resolve) => {
      const proc = spawn(this.cliBin, args, { shell: false })

      proc.stdout.on('data', (data: Buffer) => {
        const line = data.toString().trim()
        if (!line) return
        steps.push(line)
        telemetry.capture({
          runId: run.runId,
          type: 'output',
          content: line,
          timestamp: new Date().toISOString(),
        })
      })

      proc.stderr.on('data', (data: Buffer) => {
        const line = data.toString().trim()
        if (!line) return

        const { signature, category } = this.classifyError(line)
        errors.push({ signature, category, raw: line })

        telemetry.capture({
          runId: run.runId,
          type: 'error',
          content: line,
          timestamp: new Date().toISOString(),
        })
      })

      proc.on('close', (code: number | null) => {
        const success = code === 0

        telemetry.capture({
          runId: run.runId,
          type: 'step',
          content: `Process exited with code ${code}`,
          timestamp: new Date().toISOString(),
        })

        resolve({
          success,
          exitCode: code ?? -1,
          summary: success
            ? `OpenClaw completed successfully (${steps.length} steps)`
            : `OpenClaw failed with exit code ${code} (${errors.length} errors)`,
          errors,
          steps,
        })
      })

      proc.on('error', (err: Error) => {
        const message = err.message
        errors.push({
          signature: this.signatureOf('spawn-error', message),
          category: 'unknown',
          raw: message,
        })
        resolve({
          success: false,
          summary: `Failed to spawn OpenClaw: ${message}`,
          errors,
          steps,
        })
      })
    })
  }

  private buildArgs(run: RunContext, policies: PolicyInstruction[]): string[] {
    const args: string[] = [
      '--goal', run.goal,
      '--repo', run.target,
    ]

    if (run.persona) {
      args.push('--persona', run.persona)
    }

    // Inject policies as JSON argument
    if (policies.length > 0) {
      args.push('--policies', JSON.stringify(policies))
    }

    return args
  }

  private classifyError(message: string): { signature: string; category: ErrorCategory } {
    const lower = message.toLowerCase()

    let category: ErrorCategory = 'unknown'
    if (/permission|access denied|eacces/.test(lower)) category = 'permission'
    else if (/network|enotfound|timeout|econnrefused/.test(lower)) category = 'network'
    else if (/cannot find module|no such file|enoent|missing/.test(lower)) category = 'dependency'
    else if (/timed out|deadline/.test(lower)) category = 'timeout'
    else if (/assert|expect|invariant/.test(lower)) category = 'logic'

    return {
      signature: this.signatureOf(category, message),
      category,
    }
  }

  /**
   * Generate a stable, normalised signature for an error message.
   * Strips dynamic parts (file paths, line numbers, memory addresses).
   */
  private signatureOf(category: string, message: string): string {
    const normalised = message
      .toLowerCase()
      .replace(/\/[^\s]+/g, '<path>')        // file paths
      .replace(/\d+:\d+/g, '<loc>')          // line:col
      .replace(/0x[0-9a-f]+/gi, '<addr>')    // memory addresses
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)

    return `${category}::${normalised}`
  }
}
