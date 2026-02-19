/**
 * BashAdapter
 *
 * Executes any shell command (or script file) as a perspective-core execution target.
 * The simplest way to plug any domain into the learning loop without writing an adapter from scratch.
 *
 * Features:
 *   - Run any shell command or script: `bash -c "..."`, `./scripts/deploy.sh`, `make test`, etc.
 *   - Policies injected as environment variables (PERSPECTIVE_POLICY_<N>_*)
 *   - Stdout lines → `step` telemetry events
 *   - Stderr lines → classified errors via ErrorClassifier
 *   - Configurable timeout with SIGTERM → SIGKILL escalation
 *   - Working directory override
 *   - Environment variable passthrough / override
 *   - Exit-code-based success detection (default: 0 = success)
 *
 * Usage:
 *
 *   // Run a one-liner
 *   const adapter = new BashAdapter({ command: 'npm test' })
 *
 *   // Run a script file
 *   const adapter = new BashAdapter({
 *     command: './scripts/build-and-test.sh',
 *     cwd: '/my/project',
 *     timeoutMs: 120_000,
 *   })
 *
 *   // Custom success predicate (e.g. exit code 1 is "warnings only", still ok)
 *   const adapter = new BashAdapter({
 *     command: 'eslint src',
 *     isSuccess: (code) => code === 0 || code === 1,
 *   })
 *
 *   // Wire into Orchestrator
 *   const orchestrator = new Orchestrator({
 *     adapter,
 *     memory, telemetry, torque, learner,
 *   })
 */

import { spawn } from 'child_process'
import type {
  IExecutionAdapter,
  RunContext,
  PolicyInstruction,
  ITelemetryCollector,
  ExecutionResult,
} from '../../types/index.js'
import { defaultClassifier } from '../../memory/index.js'

export interface BashAdapterOptions {
  /**
   * The shell command to run. Passed to `bash -c "<command>"`.
   * Examples:
   *   'npm test'
   *   './scripts/deploy.sh'
   *   'cd /app && make build'
   */
  command: string

  /**
   * Working directory for the command.
   * Defaults to process.cwd().
   */
  cwd?: string

  /**
   * Additional environment variables to set for the process.
   * Merged with process.env. Use null values to unset inherited vars.
   */
  env?: Record<string, string>

  /**
   * Timeout in milliseconds. SIGTERM sent first, SIGKILL after 5s if still running.
   * Default: 300_000 (5 minutes)
   */
  timeoutMs?: number

  /**
   * Custom exit-code success predicate.
   * Default: (code) => code === 0
   */
  isSuccess?: (exitCode: number) => boolean

  /**
   * Shell to use. Default: 'bash'
   * Use '/bin/sh' for POSIX compatibility, 'zsh' on macOS if needed.
   */
  shell?: string

  /**
   * If true, stderr lines that look like warnings (start with 'warn', 'warning', 'WARN')
   * are captured as 'step' events instead of 'error' events.
   * Default: false
   */
  treatWarningsAsSteps?: boolean
}

const WARN_PATTERN = /^(warn|warning|WARN|WARNING)\b/

export class BashAdapter implements IExecutionAdapter {
  readonly name = 'bash'

  private readonly opts: Required<BashAdapterOptions>

  constructor(opts: BashAdapterOptions) {
    this.opts = {
      cwd: process.cwd(),
      env: {},
      timeoutMs: 300_000,
      isSuccess: (code) => code === 0,
      shell: 'bash',
      treatWarningsAsSteps: false,
      ...opts,
    }
  }

  async validate(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.opts.shell, ['--version'])
      proc.on('close', (code) => resolve(code === 0))
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
    const ts = () => new Date().toISOString()

    // Build env: inherit → override with opts.env → inject PERSPECTIVE_* + policy vars
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...this.opts.env,
      // Core run context
      PERSPECTIVE_RUN_ID: run.runId,
      PERSPECTIVE_GOAL: run.goal,
      PERSPECTIVE_TARGET: run.target,
      PERSPECTIVE_PERSONA: run.persona ?? '',
      // Policies as flat env vars so bash scripts can read them
      PERSPECTIVE_POLICIES_JSON: JSON.stringify(policies),
      PERSPECTIVE_POLICY_COUNT: String(policies.length),
    }

    // Also inject each policy individually: PERSPECTIVE_POLICY_0_ACTION, etc.
    policies.forEach((p, i) => {
      env[`PERSPECTIVE_POLICY_${i}_ACTION`] = p.action
      env[`PERSPECTIVE_POLICY_${i}_DESC`] = p.description.slice(0, 200)
    })

    return new Promise((resolve) => {
      const proc = spawn(this.opts.shell, ['-c', this.opts.command], {
        cwd: this.opts.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // ── Timeout handling ─────────────────────────────────────────────────
      let killed = false
      const timeoutHandle = setTimeout(() => {
        killed = true
        proc.kill('SIGTERM')
        // Escalate to SIGKILL after 5s if SIGTERM didn't work
        setTimeout(() => {
          try { proc.kill('SIGKILL') } catch { /* already gone */ }
        }, 5_000)
      }, this.opts.timeoutMs)

      // ── Stdout → step events ─────────────────────────────────────────────
      let stdoutBuf = ''
      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString()
        const lines = stdoutBuf.split('\n')
        stdoutBuf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          steps.push(trimmed)
          telemetry.capture({ runId: run.runId, type: 'step', content: trimmed, timestamp: ts() })
        }
      })

      // ── Stderr → error or warning events ────────────────────────────────
      let stderrBuf = ''
      proc.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString()
        const lines = stderrBuf.split('\n')
        stderrBuf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          if (this.opts.treatWarningsAsSteps && WARN_PATTERN.test(trimmed)) {
            steps.push(trimmed)
            telemetry.capture({ runId: run.runId, type: 'step', content: trimmed, timestamp: ts() })
          } else {
            const { signature, category } = defaultClassifier.classify(trimmed, run.runId)
            errors.push({ signature, category, raw: trimmed })
            telemetry.capture({ runId: run.runId, type: 'error', content: trimmed, timestamp: ts() })
          }
        }
      })

      proc.on('close', (code) => {
        clearTimeout(timeoutHandle)

        // Flush any remaining buffered output
        if (stdoutBuf.trim()) {
          steps.push(stdoutBuf.trim())
          telemetry.capture({ runId: run.runId, type: 'step', content: stdoutBuf.trim(), timestamp: ts() })
        }
        if (stderrBuf.trim() && !this.opts.treatWarningsAsSteps) {
          const trimmed = stderrBuf.trim()
          const { signature, category } = defaultClassifier.classify(trimmed, run.runId)
          errors.push({ signature, category, raw: trimmed })
          telemetry.capture({ runId: run.runId, type: 'error', content: trimmed, timestamp: ts() })
        }

        const exitCode = code ?? -1

        if (killed) {
          const timeoutMsg = `Command timed out after ${this.opts.timeoutMs}ms: ${this.opts.command}`
          errors.push({
            signature: `timeout::command timed out: ${this.opts.command.slice(0, 60)}`,
            category: 'timeout',
            raw: timeoutMsg,
          })
          telemetry.capture({ runId: run.runId, type: 'error', content: timeoutMsg, timestamp: ts() })
        }

        telemetry.capture({
          runId: run.runId,
          type: 'step',
          content: `Process exited with code ${exitCode}`,
          timestamp: ts(),
        })

        const success = !killed && this.opts.isSuccess(exitCode)
        resolve({
          success,
          exitCode,
          summary: success
            ? `bash: "${this.opts.command.slice(0, 60)}" succeeded (${steps.length} lines)`
            : killed
              ? `bash: "${this.opts.command.slice(0, 60)}" timed out after ${this.opts.timeoutMs}ms`
              : `bash: "${this.opts.command.slice(0, 60)}" failed (exit ${exitCode}, ${errors.length} errors)`,
          errors,
          steps,
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timeoutHandle)
        const { signature } = defaultClassifier.classify(err.message, run.runId)
        errors.push({ signature, category: 'unknown', raw: err.message })
        resolve({
          success: false,
          exitCode: -1,
          summary: `Failed to spawn command: ${err.message}`,
          errors,
          steps,
        })
      })
    })
  }
}
