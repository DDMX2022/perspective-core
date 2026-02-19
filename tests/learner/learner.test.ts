/**
 * learner.test.ts
 *
 * Unit tests for Learner.extractFixRecipe() and Learner.generatePolicy()
 */
import { Learner } from '../../src/learner/index.js'
import type { ErrorSignature, TelemetryEvent, FixRecipe } from '../../src/types/index.js'

// Force config values for tests
process.env['RECIPE_PROMOTE_THRESHOLD'] = '3'
process.env['RECIPE_DEMOTE_RATIO'] = '0.3'

const RUN_ID = 'test-run-001'
const NOW = new Date('2026-01-01T12:00:00Z')
const T = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

function makeError(overrides?: Partial<ErrorSignature>): ErrorSignature {
  return {
    runId: RUN_ID,
    signature: 'dependency::cannot find module xyz',
    category: 'dependency',
    rawMessage: 'Cannot find module "xyz" or its corresponding type declarations',
    ...overrides,
  }
}

function makeEvent(type: TelemetryEvent['type'], content: string, offsetMs = 0): TelemetryEvent {
  return { runId: RUN_ID, type, content, timestamp: T(offsetMs) }
}

describe('Learner.extractFixRecipe()', () => {
  const learner = new Learner()

  it('returns null when there are no errors', () => {
    expect(learner.extractFixRecipe(RUN_ID, [], [])).toBeNull()
  })

  it('returns null when there are errors but no recovery events', () => {
    const errors = [makeError()]
    const events = [
      makeEvent('step', 'Cloning repo...', 0),
      makeEvent('error', 'Cannot find module "xyz" or its corresponding type declarations', 100),
    ]
    expect(learner.extractFixRecipe(RUN_ID, errors, events)).toBeNull()
  })

  it('extracts a recipe from recovery-typed events', () => {
    const errors = [makeError()]
    const events = [
      makeEvent('step', 'Cloning repo...', 0),
      makeEvent('error', 'Cannot find module "xyz" or its corresponding type declarations', 100),
      makeEvent('recovery', 'Running: npm install xyz', 200),
      makeEvent('recovery', 'Retrying build...', 300),
    ]

    const recipe = learner.extractFixRecipe(RUN_ID, errors, events)
    expect(recipe).not.toBeNull()
    expect(recipe!.signature).toBe('dependency::cannot find module xyz')
    expect(recipe!.fixSteps).toEqual(['Running: npm install xyz', 'Retrying build...'])
    expect(recipe!.successCount).toBe(0) // caller sets this
    expect(recipe!.failCount).toBe(0)
  })

  it('extracts a recipe from step events after the error timestamp', () => {
    const errors = [makeError()]
    const events = [
      makeEvent('step', 'Installing deps...', 0),
      makeEvent('error', 'Cannot find module "xyz" or its corresponding type declarations', 500),
      makeEvent('step', 'Running: npm install xyz', 600),  // after error → recovery
      makeEvent('step', 'Build retry succeeded', 700),
    ]

    const recipe = learner.extractFixRecipe(RUN_ID, errors, events)
    expect(recipe).not.toBeNull()
    expect(recipe!.fixSteps).toContain('Running: npm install xyz')
    expect(recipe!.fixSteps).toContain('Build retry succeeded')
  })

  it('does NOT include steps that occurred BEFORE the error', () => {
    const errors = [makeError()]
    const events = [
      makeEvent('step', 'Pre-error step', 0),
      makeEvent('error', 'Cannot find module "xyz" or its corresponding type declarations', 500),
      makeEvent('recovery', 'Post-error recovery', 600),
    ]

    const recipe = learner.extractFixRecipe(RUN_ID, errors, events)
    expect(recipe!.fixSteps).not.toContain('Pre-error step')
    expect(recipe!.fixSteps).toContain('Post-error recovery')
  })

  it('uses the first error as the recipe key when multiple errors exist', () => {
    const errors = [
      makeError({ signature: 'dependency::first-error', rawMessage: 'First error message here yep' }),
      makeError({ signature: 'network::second-error', rawMessage: 'Second error' }),
    ]
    const events = [
      makeEvent('error', 'First error message here yep', 100),
      makeEvent('recovery', 'Fix for first error', 200),
    ]

    const recipe = learner.extractFixRecipe(RUN_ID, errors, events)
    expect(recipe!.signature).toBe('dependency::first-error')
  })
})

describe('Learner.generatePolicy()', () => {
  const learner = new Learner()

  function makeRecipe(overrides?: Partial<FixRecipe>): FixRecipe {
    return {
      signature: 'dependency::cannot find module xyz',
      fixSteps: ['npm install xyz', 'retry build'],
      successCount: 3,
      failCount: 0,
      lastUpdated: NOW.toISOString(),
      ...overrides,
    }
  }

  it('returns null when successCount is below threshold (< 3)', () => {
    expect(learner.generatePolicy(makeRecipe({ successCount: 0 }))).toBeNull()
    expect(learner.generatePolicy(makeRecipe({ successCount: 1 }))).toBeNull()
    expect(learner.generatePolicy(makeRecipe({ successCount: 2 }))).toBeNull()
  })

  it('generates a policy when successCount meets threshold', () => {
    const policy = learner.generatePolicy(makeRecipe({ successCount: 3 }))
    expect(policy).not.toBeNull()
    expect(policy!.triggerSignature).toBe('dependency::cannot find module xyz')
    expect(policy!.policyJson.action).toBe('avoid')
    expect((policy!.policyJson.hints as Record<string, unknown>)?.fixSteps).toEqual([
      'npm install xyz',
      'retry build',
    ])
  })

  it('returns null when fail ratio exceeds RECIPE_DEMOTE_RATIO (0.3)', () => {
    // 3 success, 2 fail → ratio = 2/3 = 0.67 > 0.3 → demoted
    expect(learner.generatePolicy(makeRecipe({ successCount: 3, failCount: 2 }))).toBeNull()
  })

  it('generates a policy when fail ratio is within limits', () => {
    // 10 success, 2 fail → ratio = 0.2 ≤ 0.3 → promoted
    const policy = learner.generatePolicy(makeRecipe({ successCount: 10, failCount: 2 }))
    expect(policy).not.toBeNull()
  })

  it('policy description includes the signature and fix steps', () => {
    const policy = learner.generatePolicy(makeRecipe())!
    expect(policy.policyJson.description).toContain('dependency::cannot find module xyz')
    expect(policy.policyJson.description).toContain('npm install xyz')
  })

  it('assigns a UUID policyId', () => {
    const policy = learner.generatePolicy(makeRecipe())!
    expect(policy.policyId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('confidence increases with more successes', () => {
    const low = learner.generatePolicy(makeRecipe({ successCount: 3, failCount: 0 }))!
    const high = learner.generatePolicy(makeRecipe({ successCount: 50, failCount: 0 }))!
    expect(high.confidence).toBeGreaterThan(low.confidence)
  })

  it('confidence is between 0 and 1', () => {
    const policy = learner.generatePolicy(makeRecipe({ successCount: 5, failCount: 1 }))!
    expect(policy.confidence).toBeGreaterThanOrEqual(0)
    expect(policy.confidence).toBeLessThanOrEqual(1)
  })
})
