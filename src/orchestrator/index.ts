import { randomUUID } from 'crypto'
import { writeFileSync } from 'fs'
import { join } from 'path'
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
  TorqueProfile,
  PolicyInstruction,
} from '../types/index.js'
import { logger } from '../config/logger.js'
import { ensureDir } from '../config/ensure-dirs.js'
import { config } from '../config/index.js'

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

    // Persist which policies + torque strategy were active for this run
    run.meta = {
      ...run.meta,
      policiesApplied: allPolicies.map((p) => ({
        policyId: p.policyId.slice(0, 8),
        action: p.policyJson.action,
        triggerSignature: p.triggerSignature,
        confidence: p.confidence,
      })),
      torqueStrategy: torqueProfile.strategy,
      torqueDominant: torqueProfile.dominant,
    }
    this.memory.saveRun(run)

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
        const existing = this.memory.getFixRecipe(recipe.signature)
        // successCount = times this error was seen AND recovery steps were captured
        // failCount    = times this error was seen with NO recovery (unrecovered failure)
        const hasRecovery = recipe.fixSteps.length > 0
        const updated = {
          ...recipe,
          successCount: (existing?.successCount ?? 0) + (hasRecovery ? 1 : 0),
          failCount: (existing?.failCount ?? 0) + (hasRecovery ? 0 : 1),
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
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[${runId}] Unexpected error during execution: ${msg}`)
    }

    // ── 7. Update status ──────────────────────────────────────────────────
    this.memory.updateRunStatus(runId, finalStatus)
    run.status = finalStatus

    // ── 8. Write handoff.md ───────────────────────────────────────────────
    this.writeHandoff(run, torqueProfile, policyInstructions)

    return run
  }

  getHistory(limit = 20): RunContext[] {
    return this.memory.listRuns(limit)
  }

  private writeHandoff(
    run: RunContext,
    torqueProfile: TorqueProfile,
    policiesApplied: PolicyInstruction[],
  ): void {
    try {
      const runDir = join(config.RUNS_DIR, run.runId)
      ensureDir(runDir)

      const errors = this.memory.getErrors(run.runId)
      const events = this.memory.getEvents(run.runId)
      const steps = events.filter((e) => e.type === 'step' || e.type === 'output').map((e) => e.content)
      const statusIcon = run.status === 'success' ? '✅' : '❌'

      const dimLines = Object.entries(torqueProfile.dimensions)
        .map(([k, v]) => `- ${k}: ${Math.round((v as number) * 100)}%`)
        .join('\n')

      const errorLines =
        errors.length > 0
          ? errors.map((e) => `- [${e.category}] ${e.rawMessage.slice(0, 100)}`).join('\n')
          : '_None_'

      const policyLines =
        policiesApplied.length > 0
          ? policiesApplied
              .map((p) => `- ${p.action.toUpperCase()}: ${p.description.slice(0, 100)}`)
              .join('\n')
          : '_None_'

      const stepLines =
        steps.length > 0
          ? steps
              .slice(0, 20)
              .map((s, i) => `${i + 1}. ${s.slice(0, 120)}`)
              .join('\n')
          : '_No steps recorded_'

      const md = [
        `# Run Handoff — \`${run.runId.slice(0, 8)}\``,
        '',
        `**Date:** ${new Date(run.timestamp).toLocaleString()}`,
        `**Full Run ID:** \`${run.runId}\``,
        '',
        '## Goal',
        run.goal,
        '',
        '## Target',
        run.target,
        ...(run.persona ? ['', `## Persona`, run.persona] : []),
        '',
        `## Status`,
        `${statusIcon} **${run.status.toUpperCase()}**`,
        '',
        '## Strategy (Torque Profile)',
        `- **Dominant:** ${torqueProfile.dominant}`,
        `- **Strategy:** ${torqueProfile.strategy}`,
        dimLines,
        '',
        '## Steps Taken',
        stepLines,
        '',
        '## Errors Encountered',
        errorLines,
        '',
        '## Policies Applied',
        policyLines,
        '',
        '---',
        `_Generated by perspective-core_`,
      ].join('\n')

      writeFileSync(join(runDir, 'handoff.md'), md, 'utf8')
      logger.info(`[${run.runId}] Handoff written: ${join(runDir, 'handoff.md')}`)
    } catch (err) {
      logger.warn(`[${run.runId}] Failed to write handoff.md`, { err })
    }
  }
}
