import type {
  ITorqueEngine,
  TorqueProfile,
  TorqueDimension,
  RunContext,
  Policy,
} from '../types/index.js'

/**
 * TorqueEngine analyses a goal + run history to derive a weighted strategic
 * profile across five dimensions: stability, speed, safety, cost, quality.
 *
 * The dominant dimension guides the execution adapter's strategy.
 */
export class TorqueEngine implements ITorqueEngine {
  analyse(goal: string, history: RunContext[]): TorqueProfile {
    const dimensions: Partial<Record<TorqueDimension, number>> = {
      stability: 0.5,
      speed: 0.5,
      safety: 0.5,
      cost: 0.5,
      quality: 0.5,
    }

    const goalLower = goal.toLowerCase()

    // Keyword-based heuristic scoring — extend with ML embeddings later
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

    // Penalise speed if recent history shows failures
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
