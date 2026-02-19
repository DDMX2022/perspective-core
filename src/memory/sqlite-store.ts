import type Database from 'better-sqlite3'
import DatabaseConstructor from 'better-sqlite3'
import { SCHEMA_DDL } from './schema.js'
import type {
  IMemoryStore,
  RunContext,
  RunStatus,
  TelemetryEvent,
  ErrorSignature,
  FixRecipe,
  Policy,
} from '../types/index.js'

export class SqliteMemoryStore implements IMemoryStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new DatabaseConstructor(dbPath)
    this.init()
  }

  private init(): void {
    this.db.exec(SCHEMA_DDL)
  }

  // ─── Runs ────────────────────────────────────────────────────────────────

  saveRun(run: RunContext): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runs (run_id, goal, target, persona, timestamp, status, meta)
         VALUES (@runId, @goal, @target, @persona, @timestamp, @status, @meta)`,
      )
      .run({
        runId: run.runId,
        goal: run.goal,
        target: run.target,
        persona: run.persona ?? null,
        timestamp: run.timestamp,
        status: run.status,
        meta: run.meta ? JSON.stringify(run.meta) : null,
      })
  }

  updateRunStatus(runId: string, status: RunStatus): void {
    this.db
      .prepare(`UPDATE runs SET status = ? WHERE run_id = ?`)
      .run(status, runId)
  }

  getRun(runId: string): RunContext | undefined {
    const row = this.db
      .prepare(`SELECT * FROM runs WHERE run_id = ?`)
      .get(runId) as Record<string, unknown> | undefined

    return row ? this.mapRun(row) : undefined
  }

  listRuns(limit = 20): RunContext[] {
    const rows = this.db
      .prepare(`SELECT * FROM runs ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[]

    return rows.map(this.mapRun)
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  saveEvent(event: TelemetryEvent): void {
    this.db
      .prepare(
        `INSERT INTO events (run_id, type, content, timestamp)
         VALUES (@runId, @type, @content, @timestamp)`,
      )
      .run(event)
  }

  getEvents(runId: string): TelemetryEvent[] {
    return this.db
      .prepare(`SELECT * FROM events WHERE run_id = ? ORDER BY id ASC`)
      .all(runId) as TelemetryEvent[]
  }

  // ─── Errors ──────────────────────────────────────────────────────────────

  saveError(error: ErrorSignature): void {
    this.db
      .prepare(
        `INSERT INTO errors (run_id, signature, category, raw_message)
         VALUES (@runId, @signature, @category, @rawMessage)`,
      )
      .run(error)
  }

  getErrors(runId: string): ErrorSignature[] {
    return this.db
      .prepare(`SELECT * FROM errors WHERE run_id = ? ORDER BY id ASC`)
      .all(runId) as ErrorSignature[]
  }

  // ─── Fix Recipes ─────────────────────────────────────────────────────────

  upsertFixRecipe(recipe: FixRecipe): void {
    this.db
      .prepare(
        `INSERT INTO fix_recipes (signature, fix_steps_json, success_count, fail_count, last_updated)
         VALUES (@signature, @fixStepsJson, @successCount, @failCount, @lastUpdated)
         ON CONFLICT(signature) DO UPDATE SET
           fix_steps_json = excluded.fix_steps_json,
           success_count  = excluded.success_count,
           fail_count     = excluded.fail_count,
           last_updated   = excluded.last_updated`,
      )
      .run({
        signature: recipe.signature,
        fixStepsJson: JSON.stringify(recipe.fixSteps),
        successCount: recipe.successCount,
        failCount: recipe.failCount,
        lastUpdated: recipe.lastUpdated,
      })
  }

  getFixRecipe(signature: string): FixRecipe | undefined {
    const row = this.db
      .prepare(`SELECT * FROM fix_recipes WHERE signature = ?`)
      .get(signature) as Record<string, unknown> | undefined

    return row ? this.mapRecipe(row) : undefined
  }

  listFixRecipes(): FixRecipe[] {
    const rows = this.db
      .prepare(`SELECT * FROM fix_recipes ORDER BY success_count DESC`)
      .all() as Record<string, unknown>[]

    return rows.map(this.mapRecipe)
  }

  // ─── Policies ────────────────────────────────────────────────────────────

  savePolicy(policy: Policy): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO policies (policy_id, trigger_signature, policy_json, confidence, created_at)
         VALUES (@policyId, @triggerSignature, @policyJson, @confidence, @createdAt)`,
      )
      .run({
        policyId: policy.policyId,
        triggerSignature: policy.triggerSignature,
        policyJson: JSON.stringify(policy.policyJson),
        confidence: policy.confidence,
        createdAt: policy.createdAt,
      })
  }

  getPolicy(triggerSignature: string): Policy | undefined {
    const row = this.db
      .prepare(`SELECT * FROM policies WHERE trigger_signature = ? ORDER BY confidence DESC LIMIT 1`)
      .get(triggerSignature) as Record<string, unknown> | undefined

    return row ? this.mapPolicy(row) : undefined
  }

  listPolicies(): Policy[] {
    const rows = this.db
      .prepare(`SELECT * FROM policies ORDER BY confidence DESC`)
      .all() as Record<string, unknown>[]

    return rows.map(this.mapPolicy)
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  close(): void {
    this.db.close()
  }

  // ─── Row Mappers ─────────────────────────────────────────────────────────

  private mapRun(row: Record<string, unknown>): RunContext {
    return {
      runId: row['run_id'] as string,
      goal: row['goal'] as string,
      target: row['target'] as string,
      persona: row['persona'] as string | undefined,
      timestamp: row['timestamp'] as string,
      status: row['status'] as RunStatus,
      meta: row['meta'] ? JSON.parse(row['meta'] as string) : undefined,
    }
  }

  private mapRecipe(row: Record<string, unknown>): FixRecipe {
    return {
      signature: row['signature'] as string,
      fixSteps: JSON.parse(row['fix_steps_json'] as string) as string[],
      successCount: row['success_count'] as number,
      failCount: row['fail_count'] as number,
      lastUpdated: row['last_updated'] as string,
    }
  }

  private mapPolicy(row: Record<string, unknown>): Policy {
    return {
      policyId: row['policy_id'] as string,
      triggerSignature: row['trigger_signature'] as string,
      policyJson: JSON.parse(row['policy_json'] as string) as Policy['policyJson'],
      confidence: row['confidence'] as number,
      createdAt: row['created_at'] as string,
    }
  }
}
