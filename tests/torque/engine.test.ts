/**
 * engine.test.ts
 *
 * Unit tests for TorqueEngine.analyse() and TorqueEngine.applyPolicies()
 */
import { TorqueEngine } from '../../src/torque/engine.js'
import type { RunContext, Policy } from '../../src/types/index.js'

function makeRun(status: 'success' | 'failed', goal = 'test goal'): RunContext {
  return {
    runId: 'run-' + Math.random().toString(36).slice(2, 8),
    goal,
    target: './repo',
    timestamp: new Date().toISOString(),
    status,
  }
}

function makePolicy(action: 'avoid' | 'prefer' | 'require'): Policy {
  return {
    policyId: 'policy-001',
    triggerSignature: 'dependency::some-error',
    policyJson: {
      action,
      description: `Test policy: ${action}`,
      hints: {},
    },
    confidence: 0.8,
    createdAt: new Date().toISOString(),
  }
}

describe('TorqueEngine.analyse()', () => {
  const engine = new TorqueEngine()

  it('returns a profile with all 5 dimensions', () => {
    const profile = engine.analyseSync('do something', [])
    expect(Object.keys(profile.dimensions)).toEqual(
      expect.arrayContaining(['stability', 'speed', 'safety', 'cost', 'quality']),
    )
  })

  it('all dimensions are between 0 and 1', () => {
    const profile = engine.analyseSync('fast build and deploy', [])
    for (const score of Object.values(profile.dimensions)) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it('has a dominant dimension', () => {
    const profile = engine.analyseSync('test', [])
    expect(profile.dominant).toMatch(/^(stability|speed|safety|cost|quality)$/)
  })

  it('has a strategy label', () => {
    const profile = engine.analyseSync('test', [])
    expect(typeof profile.strategy).toBe('string')
    expect(profile.strategy.length).toBeGreaterThan(0)
  })

  describe('keyword scoring', () => {
    it('raises safety when goal contains "safe"', () => {
      const normal = engine.analyseSync('deploy the app', [])
      const safe = engine.analyseSync('safely deploy the app', [])
      expect(safe.dimensions.safety!).toBeGreaterThan(normal.dimensions.safety!)
    })

    it('raises speed when goal contains "fast"', () => {
      const normal = engine.analyseSync('run tests', [])
      const fast = engine.analyseSync('run tests fast', [])
      expect(fast.dimensions.speed!).toBeGreaterThan(normal.dimensions.speed!)
    })

    it('raises quality when goal contains "thorough"', () => {
      const normal = engine.analyseSync('test everything', [])
      const thorough = engine.analyseSync('thorough test of everything', [])
      expect(thorough.dimensions.quality!).toBeGreaterThan(normal.dimensions.quality!)
    })

    it('raises cost when goal contains "cheap"', () => {
      const normal = engine.analyseSync('run pipeline', [])
      const cheap = engine.analyseSync('run pipeline cheap', [])
      expect(cheap.dimensions.cost!).toBeGreaterThan(normal.dimensions.cost!)
    })

    it('dominant is "speed" for a "fast" goal (clean history)', () => {
      const profile = engine.analyseSync('fast deploy now asap', [])
      expect(profile.dominant).toBe('speed')
    })

    it('dominant is "safety" for a "safe rollback" goal', () => {
      const profile = engine.analyseSync('safe rollback to previous version', [])
      expect(profile.dominant).toBe('safety')
    })
  })

  describe('failure rate penalty', () => {
    it('lowers speed and raises stability after high failure rate', () => {
      const failHistory = [makeRun('failed'), makeRun('failed'), makeRun('failed')]
      const cleanHistory = [makeRun('success'), makeRun('success'), makeRun('success')]

      const fail = engine.analyseSync('deploy', failHistory)
      const clean = engine.analyseSync('deploy', cleanHistory)

      expect(fail.dimensions.speed!).toBeLessThan(clean.dimensions.speed!)
      expect(fail.dimensions.stability!).toBeGreaterThan(clean.dimensions.stability!)
    })

    it('strategy is "Cautious Recovery" after high failure rate', () => {
      const failHistory = [makeRun('failed'), makeRun('failed'), makeRun('failed')]
      const profile = engine.analyseSync('run build', failHistory)
      expect(profile.strategy).toBe('Cautious Recovery')
    })

    it('strategy is "Stable Execution" with no failures', () => {
      const profile = engine.analyseSync('run build', [])
      expect(profile.strategy).toBe('Stable Execution')
    })
  })

  describe('async analyse with LLM goal analyser', () => {
    it('uses LLM weights when goalAnalyser is provided', async () => {
      const analyser = {
        async analyseGoal() {
          return { safety: 0.95, speed: 0.1 }
        },
      }
      const llmEngine = new TorqueEngine({ goalAnalyser: analyser })
      const profile = await llmEngine.analyse('deploy something', [])
      expect(profile.dimensions.safety).toBe(0.95)
      expect(profile.dimensions.speed).toBe(0.1)
    })

    it('falls back to keyword heuristics when LLM fails', async () => {
      const analyser = {
        async analyseGoal(): Promise<Partial<Record<string, number>>> {
          throw new Error('LLM unavailable')
        },
      }
      const llmEngine = new TorqueEngine({ goalAnalyser: analyser as any })
      const profile = await llmEngine.analyse('fast deploy now asap', [])
      // Should still work via keyword fallback
      expect(profile.dimensions.speed).toBeGreaterThan(0.5)
    })
  })
})

describe('TorqueEngine.applyPolicies()', () => {
  const engine = new TorqueEngine()

  it('returns a profile with the same dimension keys', () => {
    const base = engine.analyseSync('test', [])
    const adjusted = engine.applyPolicies(base, [makePolicy('avoid')])
    expect(Object.keys(adjusted.dimensions)).toEqual(
      expect.arrayContaining(['stability', 'speed', 'safety', 'cost', 'quality']),
    )
  })

  it('"avoid" policy raises safety dimension', () => {
    const base = engine.analyseSync('test', [])
    const adjusted = engine.applyPolicies(base, [makePolicy('avoid')])
    expect(adjusted.dimensions.safety!).toBeGreaterThanOrEqual(base.dimensions.safety!)
  })

  it('"prefer" policy raises stability dimension', () => {
    const base = engine.analyseSync('test', [])
    const adjusted = engine.applyPolicies(base, [makePolicy('prefer')])
    expect(adjusted.dimensions.stability!).toBeGreaterThanOrEqual(base.dimensions.stability!)
  })

  it('"require" policy raises quality and lowers speed', () => {
    const base = engine.analyseSync('test', [])
    const adjusted = engine.applyPolicies(base, [makePolicy('require')])
    expect(adjusted.dimensions.quality!).toBeGreaterThanOrEqual(base.dimensions.quality!)
    expect(adjusted.dimensions.speed!).toBeLessThanOrEqual(base.dimensions.speed!)
  })

  it('multiple policies compound their effects', () => {
    const base = engine.analyseSync('test', [])
    const one = engine.applyPolicies(base, [makePolicy('avoid')])
    const three = engine.applyPolicies(base, [makePolicy('avoid'), makePolicy('avoid'), makePolicy('avoid')])
    expect(three.dimensions.safety!).toBeGreaterThan(one.dimensions.safety!)
  })

  it('dimensions never exceed 1.0 regardless of policy count', () => {
    const base = engine.analyseSync('test', [])
    const policies = Array.from({ length: 20 }, () => makePolicy('avoid'))
    const adjusted = engine.applyPolicies(base, policies)
    for (const score of Object.values(adjusted.dimensions)) {
      expect(score).toBeLessThanOrEqual(1.0)
    }
  })

  it('no policies → profile is unchanged', () => {
    const base = engine.analyseSync('test', [])
    const unchanged = engine.applyPolicies(base, [])
    expect(unchanged.dimensions).toEqual(base.dimensions)
  })
})
