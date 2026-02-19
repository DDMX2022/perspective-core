import { randomUUID } from 'crypto'
import type {
  IExecutionAdapter,
  IOrchestrator,
  IMemoryStore,
  ITorqueEngine,
  ILearner,
  ITelemetryCollector,
  RunContext,
  RunStatus,
  OrchestratorConfig,
} from '../types/index.js'
import { logger } from '../config/logger.js'

/**
 * Orchestrator — the Perspective Brain.
 *
 * Full run lifecycle:
 *   1. Create run context
 *   2. Load active policies from memory
 *   3. Analyse goal with TorqueEngine
 *   4. Execute via adapter (with policies injected)
 *   5. Persist telemetry & errors
 *   6. Run learner (extract recipe, generate policy)
 *   7. Update run status
 *   8. Write handoff artifact
 */
export class Orchestrator implements IOrchestrator {
  private adapter: IExecutionAdapter
  private memory: IMemoryStore
  private telemetry: ITelemetryCollector
  private torque: ITorqueEngine
  private learner: ILearner

  constructor(cfg: OrchestratorConfig) {
    this.adapter = cfg.adapter
    this.memory = cfg.memory
    this.telemetry = cfg.telemetry
    this.torque = cfg.torque
    this.learner = cfg.learner
  }

  async run(goal: string, target: string, persona?: string): Promise<RunContext> {
    const runId = randomUUID()
    const timestamp = new Date().toISOString()

    const run: RunContext = {
      runId,
      goal,
      target,
      persona,
      timestamp,
      status: 'pending',
    }

    // ── 1. Persist run ────────────────────────────────────────────────────
    this.memory.saveRun(run)
    logger.info(`[${runId}] Run started`, { goal, target, persona })

    // ── 2. Load policies ──────────────────────────────────────────────────
    const allPolicies = this.memory.listPolicies()
    logger.info(`[${runId}] Loaded ${allPolicies.length} policies`)

    // ── 3. Torque analysis ────────────────────────────────────────────────
    const history = this.memory.listRuns(20)
    let torqueProfile = this.torque.analyse(goal, history)
    torqueProfile = this.torque.applyPolicies(torqueProfile, allPolicies)
    logger.info(`[${runId}] Torque: ${torqueProfile.strategy} (dominant: ${torqueProfile.dominant})`)

    const policyInstructions = allPolicies.map((p) => p.policyJson)

    // ── 4. Execute ────────────────────────────────────────────────────────
    this.memory.updateRunStatus(runId, 'running')
    run.status = 'running'

    let finalStatus: RunStatus = 'failed'

    try {
      const result = await this.adapter.execute(run, policyInstructions, this.telemetry)

      // ── 5. Persist telemetry & errors ─────────────────────────────────
      this.telemetry.flush()

      for (const err of result.errors) {
        this.memory.saveError({
          runId,
          signature: err.signature,
          category: err.category,
          rawMessage: err.raw,
        })
      }

      // ── 6. Learn ──────────────────────────────────────────────────────
      const storedErrors = this.memory.getErrors(runId)
      const storedEvents = this.memory.getEvents(runId)

      const recipe = this.learner.extractFixRecipe(runId, storedErrors, storedEvents)
      if (recipe) {
        // Update counters based on outcome
        const existing = this.memory.getFixRecipe(recipe.signature)
        const updated = {
          ...recipe,
          successCount: (existing?.successCount ?? 0) + (result.success ? 1 : 0),
          failCount: (existing?.failCount ?? 0) + (result.success ? 0 : 1),
          lastUpdated: new Date().toISOString(),
        }
        this.memory.upsertFixRecipe(updated)
        logger.info(`[${runId}] Fix recipe updated: ${recipe.signature}`)

        const policy = this.learner.generatePolicy(updated)
        if (policy) {
          this.memory.savePolicy(policy)
          logger.info(`[${runId}] New policy generated: ${policy.policyId} (confidence: ${policy.confidence})`)
        }
      }

      finalStatus = result.success ? 'success' : 'failed'
      logger.info(`[${runId}] Run ${finalStatus}: ${result.summary}`)
    } catch (err) {
      finalStatus = 'failed'
      logger.error(`[${runId}] Unexpected error during execution`, { err })
    }

    // ── 7. Update status ──────────────────────────────────────────────────
    this.memory.updateRunStatus(runId, finalStatus)
    run.status = finalStatus

    return run
  }

  getHistory(limit = 20): RunContext[] {
    return this.memory.listRuns(limit)
  }
}
