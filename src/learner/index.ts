import { randomUUID } from 'crypto'
import type {
  ILearner,
  FixRecipe,
  Policy,
  ErrorSignature,
  TelemetryEvent,
  PolicyInstruction,
} from '../types/index.js'
import { config } from '../config/index.js'

/**
 * Learner converts observed execution data into reusable knowledge:
 *   errors + recovery events  →  FixRecipe
 *   FixRecipe (proven)        →  Policy (prevention)
 */
export class Learner implements ILearner {
  extractFixRecipe(
    runId: string,
    errors: ErrorSignature[],
    events: TelemetryEvent[],
  ): FixRecipe | null {
    if (errors.length === 0) return null

    // Use the first error as the recipe key (most impactful failure)
    const primaryError = errors[0]!

    // Find all recovery steps — events that come after the first error event
    const errorTimestamp = events.find(
      (e) => e.type === 'error' && e.content.includes(primaryError.rawMessage.slice(0, 40)),
    )?.timestamp

    const recoverySteps = events
      .filter(
        (e) =>
          e.type === 'recovery' ||
          (e.type === 'step' && errorTimestamp && e.timestamp > errorTimestamp),
      )
      .map((e) => e.content)

    if (recoverySteps.length === 0) return null

    return {
      signature: primaryError.signature,
      fixSteps: recoverySteps,
      successCount: 0, // caller updates this based on run outcome
      failCount: 0,
      lastUpdated: new Date().toISOString(),
    }
  }

  generatePolicy(recipe: FixRecipe): Policy | null {
    const { successCount, failCount } = recipe

    // Promote to policy when success count meets threshold
    // and failure ratio is acceptable
    if (successCount < config.RECIPE_PROMOTE_THRESHOLD) return null
    if (successCount > 0 && failCount / successCount > config.RECIPE_DEMOTE_RATIO) return null

    const confidence = this.calculateConfidence(successCount, failCount)

    const policyJson: PolicyInstruction = {
      action: 'avoid',
      description: `Prevent recurrence of: ${recipe.signature}. Known fix: ${recipe.fixSteps.slice(0, 2).join(' → ')}`,
      hints: {
        fixSteps: recipe.fixSteps,
        signature: recipe.signature,
      },
    }

    return {
      policyId: randomUUID(),
      triggerSignature: recipe.signature,
      policyJson,
      confidence,
      createdAt: new Date().toISOString(),
    }
  }

  private calculateConfidence(successCount: number, failCount: number): number {
    const total = successCount + failCount
    if (total === 0) return 0
    // Wilson score lower bound (simplified)
    const p = successCount / total
    const z = 1.645 // 90% confidence interval
    const lower =
      (p + (z * z) / (2 * total) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) /
      (1 + (z * z) / total)
    return Math.round(lower * 100) / 100
  }
}
