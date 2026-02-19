/**
 * HttpAdapter
 *
 * Executes a goal by calling a REST API endpoint and classifying the response.
 *
 * Features:
 *   - Configurable URL, method, headers, body builder
 *   - Non-2xx status codes classified as errors
 *   - Response body parsed and emitted as telemetry steps
 *   - Policies injected as X-Perspective-Policy-* headers
 *   - Configurable timeout
 *   - Custom success predicate based on status code and body
 *
 * Usage:
 *
 *   // Call a REST API that runs a task
 *   const adapter = new HttpAdapter({
 *     url: 'https://api.example.com/tasks/run',
 *     method: 'POST',
 *     buildBody: (run) => ({ goal: run.goal, target: run.target }),
 *   })
 *
 *   // Custom success predicate
 *   const adapter = new HttpAdapter({
 *     url: 'https://ci.example.com/trigger',
 *     method: 'POST',
 *     isSuccess: (status, body) => status >= 200 && status < 300 && body?.status === 'ok',
 *   })
 */

import { BaseAdapter } from '../base.js'
import type {
  RunContext,
  PolicyInstruction,
  ITelemetryCollector,
  ExecutionResult,
} from '../../types/index.js'

export interface HttpAdapterOptions {
  /**
   * The URL to call. Can include template placeholders:
   *   {{goal}}, {{target}}, {{runId}}
   * which are replaced with run context values.
   */
  url: string

  /**
   * HTTP method. Default: 'POST'
   */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

  /**
   * Additional headers to send.
   * Content-Type defaults to 'application/json' for POST/PUT/PATCH.
   */
  headers?: Record<string, string>

  /**
   * Build the request body from the run context.
   * Only used for POST/PUT/PATCH requests.
   * Default: sends { goal, target, runId, persona } as JSON.
   */
  buildBody?: (run: RunContext, policies: PolicyInstruction[]) => unknown

  /**
   * Custom success predicate.
   * Default: (status) => status >= 200 && status < 300
   */
  isSuccess?: (statusCode: number, body: unknown) => boolean

  /**
   * Timeout in milliseconds. Default: 30_000 (30 seconds)
   */
  timeoutMs?: number

  /**
   * Parse the response body and extract step descriptions.
   * Default: if response is JSON with a 'steps' array, uses that;
   * otherwise wraps the response text as a single step.
   */
  parseSteps?: (body: unknown) => string[]

  /**
   * Parse the response body and extract error messages on failure.
   * Default: extracts 'error' or 'message' field from JSON responses.
   */
  parseErrors?: (body: unknown, statusCode: number) => string[]
}

export class HttpAdapter extends BaseAdapter {
  private readonly opts: Required<HttpAdapterOptions>

  constructor(opts: HttpAdapterOptions) {
    super('http')
    this.opts = {
      method: 'POST',
      headers: {},
      buildBody: (run, policies) => ({
        runId: run.runId,
        goal: run.goal,
        target: run.target,
        persona: run.persona,
        policies,
      }),
      isSuccess: (status) => status >= 200 && status < 300,
      timeoutMs: 30_000,
      parseSteps: (body) => {
        if (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>)['steps'])) {
          return ((body as Record<string, unknown>)['steps'] as unknown[]).map(String)
        }
        if (typeof body === 'string') return [body]
        return [JSON.stringify(body)]
      },
      parseErrors: (body, statusCode) => {
        if (body && typeof body === 'object') {
          const b = body as Record<string, unknown>
          const msg = b['error'] ?? b['message'] ?? b['detail']
          if (typeof msg === 'string') return [msg]
        }
        return [`HTTP ${statusCode}`]
      },
      ...opts,
    }
  }

  override async validate(): Promise<boolean> {
    // Check that fetch is available (Node 18+)
    return typeof globalThis.fetch === 'function'
  }

  protected async doExecute(
    run: RunContext,
    policies: PolicyInstruction[],
    telemetry: ITelemetryCollector,
  ): Promise<ExecutionResult> {
    const steps: string[] = []
    const errors: ExecutionResult['errors'] = []

    // Resolve URL template
    const url = this.opts.url
      .replace('{{goal}}', encodeURIComponent(run.goal))
      .replace('{{target}}', encodeURIComponent(run.target))
      .replace('{{runId}}', encodeURIComponent(run.runId))

    // Build headers — inject policies
    const headers: Record<string, string> = { ...this.opts.headers }
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(this.opts.method)

    if (hasBody && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json'
    }

    // Inject policies as headers
    headers['X-Perspective-Run-Id'] = run.runId
    headers['X-Perspective-Goal'] = run.goal
    if (policies.length > 0) {
      headers['X-Perspective-Policies'] = JSON.stringify(policies)
      policies.forEach((p, i) => {
        headers[`X-Perspective-Policy-${i}-Action`] = p.action
      })
    }

    this.emit(telemetry, run.runId, 'step', `${this.opts.method} ${url}`)
    steps.push(`${this.opts.method} ${url}`)

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs)

      const fetchOpts: RequestInit = {
        method: this.opts.method,
        headers,
        signal: controller.signal,
      }

      if (hasBody) {
        fetchOpts.body = JSON.stringify(this.opts.buildBody(run, policies))
      }

      const response = await fetch(url, fetchOpts)
      clearTimeout(timer)

      const statusCode = response.status
      let body: unknown

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        body = await response.json()
      } else {
        body = await response.text()
      }

      this.emit(telemetry, run.runId, 'step', `Response: ${statusCode}`)
      steps.push(`Response: ${statusCode}`)

      const success = this.opts.isSuccess(statusCode, body)

      if (success) {
        const responseSteps = this.opts.parseSteps(body)
        for (const step of responseSteps) {
          steps.push(step)
          this.emit(telemetry, run.runId, 'output', step)
        }
        return this.successResult(steps, [], statusCode)
      } else {
        const responseErrors = this.opts.parseErrors(body, statusCode)
        for (const errMsg of responseErrors) {
          const classified = this.classifyError(errMsg, run.runId)
          errors.push(classified)
          this.emit(telemetry, run.runId, 'error', errMsg)
        }
        return this.failureResult(
          steps,
          errors,
          `HTTP ${this.opts.method} ${url} failed with status ${statusCode}`,
          statusCode,
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      // Classify the error
      if (message.includes('abort') || message.includes('AbortError')) {
        const classified = {
          signature: `timeout::http request exceeded ${this.opts.timeoutMs}ms`,
          category: 'timeout' as const,
          raw: message,
        }
        errors.push(classified)
        this.emit(telemetry, run.runId, 'error', `Request timed out after ${this.opts.timeoutMs}ms`)
      } else {
        const classified = this.classifyError(message, run.runId)
        errors.push(classified)
        this.emit(telemetry, run.runId, 'error', message)
      }

      return this.failureResult(
        steps,
        errors,
        `HTTP ${this.opts.method} failed: ${message}`,
      )
    }
  }
}
