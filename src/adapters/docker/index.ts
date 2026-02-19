import { spawn } from 'child_process'
import type {
  IExecutionAdapter,
  RunContext,
  PolicyInstruction,
  ITelemetryCollector,
  ExecutionResult,
} from '../../types/index.js'
import { logger } from '../../config/logger.js'

export interface DockerAdapterOptions {
  /**
   * Docker image to run.
   * The image must have your execution tool (e.g. openclaw, bash, python) available.
   */
  image: string

  /**
   * Optional extra docker run flags (e.g. ['--memory', '512m', '--cpus', '1']).
   * Do NOT include --rm, -e, or -v here — those are managed automatically.
   */
  dockerFlags?: string[]

  /**
   * Host directories to mount into the container.
   * Each entry: { host: '/abs/path', container: '/workspace', readonly?: true }
   */
  mounts?: Array<{ host: string; container: string; readonly?: boolean }>

  /**
   * Environment variables to pass into the container.
   */
  env?: Record<string, string>

  /**
   * The inner adapter to execute inside the container.
   * Its execute() call is serialised to JSON and passed as --perspective-run arg.
   *
   * IMPORTANT: The image must have `perspective-core` available and run
   * `slc docker-exec` as its ENTRYPOINT or CMD.
   *
   * For fully custom images, set `command` instead.
   */
  innerAdapter?: IExecutionAdapter

  /**
   * Override the command run inside the container entirely.
   * e.g. ['openclaw', '--goal', '...']
   * If set, innerAdapter is ignored.
   */
  command?: string[]

  /** Working directory inside the container. Default: /workspace */
  workdir?: string

  /** Timeout in ms before the container is killed. Default: 300_000 (5 min) */
  timeoutMs?: number
}

/**
 * DockerAdapter
 *
 * Runs execution inside an isolated Docker container.
 * This is the recommended execution strategy for:
 *   - Untrusted code execution
 *   - Reproducible domain environments
 *   - Per-run clean state (--rm)
 *   - Multi-language / multi-tool domains
 *
 * The Orchestrator, Memory, and Learner always run on the host.
 * Only the execution layer is containerised.
 *
 * Architecture:
 *
 *   Orchestrator (host)
 *       │
 *       └──▶ DockerAdapter.execute()
 *                 │
 *                 └──▶ docker run --rm <image> <command>
 *                           (streams stdout/stderr back via telemetry)
 *                           (returns structured ExecutionResult)
 *
 * Usage:
 *
 *   const orchestrator = new Orchestrator({
 *     adapter: new DockerAdapter({
 *       image: 'my-org/openclaw-env:latest',
 *       mounts: [{ host: process.cwd(), container: '/workspace' }],
 *       command: ['openclaw', '--goal', run.goal, '--repo', '/workspace'],
 *     }),
 *     ...
 *   })
 */
export class DockerAdapter implements IExecutionAdapter {
  readonly name = 'docker'

  private readonly opts: DockerAdapterOptions

  constructor(opts: DockerAdapterOptions) {
    this.opts = opts
  }

  async validate(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('docker', ['info'])
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
    const { image, dockerFlags = [], mounts = [], env = {}, workdir = '/workspace', timeoutMs = 300_000 } = this.opts

    // ── Build docker run command ───────────────────────────────────────────
    const args: string[] = ['run', '--rm']

    // Workdir
    args.push('--workdir', workdir)

    // Environment — pass run context + policies as env vars
    const runEnv: Record<string, string> = {
      ...env,
      PERSPECTIVE_RUN_ID: run.runId,
      PERSPECTIVE_GOAL: run.goal,
      PERSPECTIVE_TARGET: run.target,
      PERSPECTIVE_POLICIES: JSON.stringify(policies),
    }
    if (run.persona) runEnv['PERSPECTIVE_PERSONA'] = run.persona

    for (const [key, val] of Object.entries(runEnv)) {
      args.push('-e', `${key}=${val}`)
    }

    // Mounts
    for (const m of mounts) {
      const flag = m.readonly
        ? `${m.host}:${m.container}:ro`
        : `${m.host}:${m.container}`
      args.push('-v', flag)
    }

    // Extra flags
    args.push(...dockerFlags)

    // Image
    args.push(image)

    // Command inside container
    const innerCommand = this.resolveCommand(run, policies)
    args.push(...innerCommand)

    logger.info(`[${run.runId}] DockerAdapter: docker ${args.join(' ')}`)

    telemetry.capture({
      runId: run.runId,
      type: 'step',
      content: `Spawning container: ${image}`,
      timestamp: new Date().toISOString(),
    })

    return new Promise((resolve) => {
      const proc = spawn('docker', args, { shell: false })

      // Enforce timeout
      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
        errors.push({
          signature: `timeout::container exceeded ${timeoutMs}ms`,
          category: 'timeout',
          raw: `Container killed after ${timeoutMs}ms`,
        })
      }, timeoutMs)

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
        // Docker prefixes pull/status messages to stderr — filter them
        if (line.startsWith('Unable to find image') || line.includes('Pulling from')) {
          telemetry.capture({ runId: run.runId, type: 'info', content: line, timestamp: new Date().toISOString() })
          return
        }
        errors.push({
          signature: `docker-stderr::${line.slice(0, 80)}`,
          category: 'unknown',
          raw: line,
        })
        telemetry.capture({ runId: run.runId, type: 'error', content: line, timestamp: new Date().toISOString() })
      })

      proc.on('close', (code: number | null) => {
        clearTimeout(timer)
        const success = code === 0
        telemetry.capture({
          runId: run.runId,
          type: 'step',
          content: `Container exited with code ${code}`,
          timestamp: new Date().toISOString(),
        })
        resolve({
          success,
          exitCode: code ?? -1,
          summary: success
            ? `Container run completed (${steps.length} output lines)`
            : `Container failed with exit code ${code} (${errors.length} errors)`,
          errors,
          steps,
        })
      })

      proc.on('error', (err: Error) => {
        clearTimeout(timer)
        errors.push({
          signature: `docker-spawn-error::${err.message.slice(0, 80)}`,
          category: 'unknown',
          raw: err.message,
        })
        resolve({
          success: false,
          summary: `Failed to spawn docker: ${err.message}`,
          errors,
          steps,
        })
      })
    })
  }

  private resolveCommand(run: RunContext, policies: PolicyInstruction[]): string[] {
    // Explicit command override takes priority
    if (this.opts.command) return this.opts.command

    // If an inner adapter is provided, delegate to it via a serialised context
    // The container image must handle PERSPECTIVE_* env vars and invoke its own logic
    if (this.opts.innerAdapter) {
      return [
        'slc', 'docker-exec',
        '--run', JSON.stringify({ ...run, policies }),
      ]
    }

    // Fallback: just run bash in interactive mode (useful for debugging)
    logger.warn(`[${run.runId}] DockerAdapter: no command or innerAdapter set — falling back to bash`)
    return ['bash', '-c', `echo "PERSPECTIVE_GOAL=$PERSPECTIVE_GOAL" && echo "No command configured"`]
  }
}
