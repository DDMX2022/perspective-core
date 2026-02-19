import type {
  ITorqueEngine,
  TorqueProfile,
  TorqueDimension,
  RunContext,
  Policy,
} from '../types/index.js'

// ── LLM goal analysis interface (pluggable) ─────────────────────────────────

/**
 * IGoalAnalyserLLM — plug in any LLM or embedding model to replace keyword
 * heuristics with semantic goal analysis.
 *
 * Implementations should return a partial dimension weighting based on the
 * goal text. The TorqueEngine merges these with history-based adjustments.
 *
 * Example implementations:
 *   - OpenAI embeddings → cluster-based dimension scoring
 *   - Anthropic Claude → structured JSON extraction of intent
 *   - Local Ollama → lightweight on-device analysis
 *
 * The engine NEVER blocks on the LLM if it fails — falls back to keywords.
 */
export interface IGoalAnalyserLLM {
  /**
   * Analyse a goal string and return suggested dimension weights (0–1).
   * Only return dimensions that the analyser is confident about;
   * omitted dimensions will use the default (0.5).
   */
  analyseGoal(goal: string): Promise<Partial<Record<TorqueDimension, number>>>
}

export interface TorqueEngineOptions {
  /** Optional LLM-based goal analyser — replaces keyword heuristics when available */
  goalAnalyser?: IGoalAnalyserLLM
}

/**
 * TorqueEngine analyses a goal + run history to derive a weighted strategic
 * profile across five dimensions: stability, speed, safety, cost, quality.
 *
 * The dominant dimension guides the execution adapter's strategy.
 *
 * Goal analysis uses a two-layer approach:
 *   Layer 1: Keyword heuristics (always available, fast, deterministic)
 *   Layer 2: LLM/embedding analysis via IGoalAnalyserLLM (optional, async)
 *
 * When an IGoalAnalyserLLM is provided, its results take priority.
 * If the LLM call fails, keyword heuristics are used as fallback.
 */
export class TorqueEngine implements ITorqueEngine {
  private goalAnalyser?: IGoalAnalyserLLM

  constructor(opts: TorqueEngineOptions = {}) {
    this.goalAnalyser = opts.goalAnalyser
  }

  async analyse(goal: string, history: RunContext[]): Promise<TorqueProfile> {
    const dimensions: Partial<Record<TorqueDimension, number>> = {
      stability: 0.5,
      speed: 0.5,
      safety: 0.5,
      cost: 0.5,
      quality: 0.5,
    }

    // ── Layer 1: Try LLM/embedding goal analysis first ──────────────────
    let usedLLM = false
    if (this.goalAnalyser) {
      try {
        const llmWeights = await this.goalAnalyser.analyseGoal(goal)
        // Merge LLM weights — they take priority over defaults
        for (const [dim, weight] of Object.entries(llmWeights) as [TorqueDimension, number][]) {
          if (typeof weight === 'number' && weight >= 0 && weight <= 1) {
            dimensions[dim] = weight
          }
        }
        usedLLM = true
      } catch {
        // LLM failed — fall through to keyword heuristics
      }
    }

    // ── Layer 2: Keyword heuristics (fallback or additive) ──────────────
    if (!usedLLM) {
      this.applyKeywordHeuristics(goal, dimensions)
    }

    // ── History-based adjustments (always applied) ──────────────────────
    const recentRuns = history.slice(0, 5)
    const recentFailureRate =
      recentRuns.length > 0
        ? recentRuns.filter((r) => r.status === 'failed').length / recentRuns.length
        : 0

    if (recentFailureRate > 0.4) {
      dimensions.speed = Math.max(0, (dimensions.speed ?? 0.5) - 0.2)
      dimensions.stability = Math.min(1, (dimensions.stability ?? 0.5) + 0.2)
    }

    const dominant = this.findDominant(dimensions)

    return {
      dimensions,
      dominant,
      strategy: this.strategyLabel(dominant, recentFailureRate),
    }
  }

  /**
   * Synchronous analyse for backward compatibility and tests.
   * Uses keyword heuristics only (no LLM).
   */
  analyseSync(goal: string, history: RunContext[]): TorqueProfile {
    const dimensions: Partial<Record<TorqueDimension, number>> = {
      stability: 0.5,
      speed: 0.5,
      safety: 0.5,
      cost: 0.5,
      quality: 0.5,
    }

    this.applyKeywordHeuristics(goal, dimensions)

    const recentRuns = history.slice(0, 5)
    const recentFailureRate =
      recentRuns.length > 0
        ? recentRuns.filter((r) => r.status === 'failed').length / recentRuns.length
        : 0

    if (recentFailureRate > 0.4) {
      dimensions.speed = Math.max(0, (dimensions.speed ?? 0.5) - 0.2)
      dimensions.stability = Math.min(1, (dimensions.stability ?? 0.5) + 0.2)
    }

    const dominant = this.findDominant(dimensions)

    return {
      dimensions,
      dominant,
      strategy: this.strategyLabel(dominant, recentFailureRate),
    }
  }

  private applyKeywordHeuristics(
    goal: string,
    dimensions: Partial<Record<TorqueDimension, number>>,
  ): void {
    const goalLower = goal.toLowerCase()

    if (/safe|careful|backup|revert|rollback/.test(goalLower)) {
      dimensions.safety = Math.min(1, (dimensions.safety ?? 0.5) + 0.3)
      dimensions.stability = Math.min(1, (dimensions.stability ?? 0.5) + 0.2)
    }
    if (/fast|quick|urgent|asap|now/.test(goalLower)) {
      dimensions.speed = Math.min(1, (dimensions.speed ?? 0.5) + 0.3)
    }
    if (/quality|thorough|complete|comprehensive/.test(goalLower)) {
      dimensions.quality = Math.min(1, (dimensions.quality ?? 0.5) + 0.3)
    }
    if (/cheap|cost|budget|minimal/.test(goalLower)) {
      dimensions.cost = Math.min(1, (dimensions.cost ?? 0.5) + 0.3)
    }
  }

  applyPolicies(profile: TorqueProfile, policies: Policy[]): TorqueProfile {
    const adjusted = { ...profile.dimensions }

    for (const policy of policies) {
      const { action } = policy.policyJson
      if (action === 'avoid') {
        // Avoiding something → increase safety weight
        adjusted.safety = Math.min(1, (adjusted.safety ?? 0.5) + 0.1)
      } else if (action === 'prefer') {
        // Prefer stable paths
        adjusted.stability = Math.min(1, (adjusted.stability ?? 0.5) + 0.1)
      } else if (action === 'require') {
        // Requirements slow things down slightly but improve quality
        adjusted.quality = Math.min(1, (adjusted.quality ?? 0.5) + 0.1)
        adjusted.speed = Math.max(0, (adjusted.speed ?? 0.5) - 0.05)
      }
    }

    const dominant = this.findDominant(adjusted)

    return {
      dimensions: adjusted,
      dominant,
      strategy: this.strategyLabel(dominant, 0),
    }
  }

  private findDominant(
    dimensions: Partial<Record<TorqueDimension, number>>,
  ): TorqueDimension {
    return (Object.entries(dimensions) as [TorqueDimension, number][]).reduce(
      (max, [dim, score]) => (score > (dimensions[max] ?? 0) ? dim : max),
      'stability' as TorqueDimension,
    )
  }

  private strategyLabel(dominant: TorqueDimension, failureRate: number): string {
    const labels: Record<TorqueDimension, string> = {
      stability: failureRate > 0.4 ? 'Cautious Recovery' : 'Stable Execution',
      speed: 'Fast Track',
      safety: 'Safety-First',
      cost: 'Cost-Optimised',
      quality: 'Quality-Focused',
    }
    return labels[dominant]
  }
}
