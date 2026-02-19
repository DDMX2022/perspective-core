/**
 * perspective-core — Core Types & Interfaces
 *
 * All interfaces are domain-agnostic. The system is designed to be integrated
 * with any execution engine (OpenClaw, bash, HTTP APIs, LLM tools, etc.)
 * by implementing the IExecutionAdapter interface.
 */

// ─── Run Lifecycle ───────────────────────────────────────────────────────────

export type RunStatus = 'pending' | 'running' | 'success' | 'failed' | 'aborted';

export interface RunContext {
  runId: string;
  goal: string;
  /** Domain-specific target — could be a repo, URL, database, file path, etc. */
  target: string;
  /** Persona / strategy hint passed to the orchestrator */
  persona?: string;
  timestamp: string;
  status: RunStatus;
  meta?: Record<string, unknown>;
}

// ─── Events & Telemetry ──────────────────────────────────────────────────────

export type EventType =
  | 'command'
  | 'step'
  | 'error'
  | 'recovery'
  | 'policy_applied'
  | 'info'
  | 'output';

export interface TelemetryEvent {
  id?: number;
  runId: string;
  type: EventType;
  content: string;
  timestamp: string;
}

export interface ITelemetryCollector {
  capture(event: Omit<TelemetryEvent, 'id'>): void;
  flush(): void;
  getEvents(runId: string): TelemetryEvent[];
}

// ─── Errors & Fix Recipes ────────────────────────────────────────────────────

export type ErrorCategory =
  | 'dependency'
  | 'permission'
  | 'network'
  | 'timeout'
  | 'logic'
  | 'unknown';

export interface ErrorSignature {
  id?: number;
  runId: string;
  signature: string;
  category: ErrorCategory;
  rawMessage: string;
}

export interface FixRecipe {
  signature: string;
  fixSteps: string[];
  successCount: number;
  failCount: number;
  lastUpdated: string;
}

// ─── Policies ────────────────────────────────────────────────────────────────

export interface Policy {
  policyId: string;
  triggerSignature: string;
  /** Structured policy instruction injected into the next run prompt */
  policyJson: PolicyInstruction;
  confidence: number;
  createdAt: string;
}

export interface PolicyInstruction {
  action: 'avoid' | 'prefer' | 'require' | 'warn';
  description: string;
  /** Optional domain-specific hints (e.g. flags to pass, env vars to set) */
  hints?: Record<string, unknown>;
}

// ─── Memory Store ────────────────────────────────────────────────────────────

export interface IMemoryStore {
  /** Persist a new run record */
  saveRun(run: RunContext): void;
  /** Update run status */
  updateRunStatus(runId: string, status: RunStatus): void;
  /** Fetch a run by ID */
  getRun(runId: string): RunContext | undefined;
  /** List recent runs, newest first */
  listRuns(limit?: number): RunContext[];

  saveEvent(event: TelemetryEvent): void;
  getEvents(runId: string): TelemetryEvent[];

  saveError(error: ErrorSignature): void;
  getErrors(runId: string): ErrorSignature[];

  upsertFixRecipe(recipe: FixRecipe): void;
  getFixRecipe(signature: string): FixRecipe | undefined;
  listFixRecipes(): FixRecipe[];

  savePolicy(policy: Policy): void;
  getPolicy(triggerSignature: string): Policy | undefined;
  listPolicies(): Policy[];

  close(): void;
}

// ─── Torque Clustering ───────────────────────────────────────────────────────

export type TorqueDimension = 'stability' | 'speed' | 'safety' | 'cost' | 'quality';

export interface TorqueProfile {
  /** Weighted scores per dimension, 0–1 */
  dimensions: Partial<Record<TorqueDimension, number>>;
  /** Dominant dimension derived from weights */
  dominant: TorqueDimension;
  /** Human-readable strategy label */
  strategy: string;
}

export interface ITorqueEngine {
  /** Analyse a goal + past run history to derive a TorqueProfile */
  analyse(goal: string, history: RunContext[]): TorqueProfile;
  /** Adjust the profile based on active policies */
  applyPolicies(profile: TorqueProfile, policies: Policy[]): TorqueProfile;
}

// ─── Learner ─────────────────────────────────────────────────────────────────

export interface ILearner {
  /** Extract fix recipe from the recovery steps observed in a run */
  extractFixRecipe(
    runId: string,
    errors: ErrorSignature[],
    events: TelemetryEvent[],
  ): FixRecipe | null;

  /** Promote a well-proven fix recipe into a prevention policy */
  generatePolicy(recipe: FixRecipe): Policy | null;
}

// ─── Execution Adapter (Domain Integration Point) ────────────────────────────

/**
 * IExecutionAdapter is the PRIMARY integration surface.
 *
 * To integrate perspective-core with a new domain or execution engine:
 * 1. Implement this interface.
 * 2. Register your adapter with the Orchestrator.
 *
 * Examples:
 *   - OpenClawAdapter  → spawns the OpenClaw CLI
 *   - BashAdapter      → runs shell scripts
 *   - HttpAdapter      → calls REST APIs
 *   - LLMToolAdapter   → invokes LLM function-calling tools
 *   - DBMigrationAdapter → runs database migrations
 */
export interface IExecutionAdapter {
  /** Unique identifier for this adapter */
  readonly name: string;

  /**
   * Execute the goal against the target.
   * Stream output via the provided telemetry collector.
   */
  execute(
    run: RunContext,
    policies: PolicyInstruction[],
    telemetry: ITelemetryCollector,
  ): Promise<ExecutionResult>;

  /** Optional: validate that the adapter's dependencies are available */
  validate?(): Promise<boolean>;
}

export interface ExecutionResult {
  success: boolean;
  exitCode?: number;
  /** Summary of what happened (used for handoff.md) */
  summary: string;
  /** Raw errors captured during execution */
  errors: Array<{ signature: string; category: ErrorCategory; raw: string }>;
  /** Steps taken (ordered) — used for fix recipe extraction */
  steps: string[];
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface OrchestratorConfig {
  adapter: IExecutionAdapter;
  memory: IMemoryStore;
  telemetry: ITelemetryCollector;
  torque: ITorqueEngine;
  learner: ILearner;
}

export interface IOrchestrator {
  run(goal: string, target: string, persona?: string): Promise<RunContext>;
  getHistory(limit?: number): RunContext[];
}
