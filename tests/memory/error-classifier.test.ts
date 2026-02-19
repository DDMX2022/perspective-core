/**
 * error-classifier.test.ts
 *
 * Tests for the deterministic pattern-based ErrorClassifier.
 * The LLM enrichment path is tested via a mock IErrorClassifierLLM.
 */
import { ErrorClassifier, normalise } from '../../src/memory/error-classifier.js'
import type { ClassifiedError, IErrorClassifierLLM, EnrichedClassification } from '../../src/memory/error-classifier.js'

const RUN_ID = 'test-run-001'

describe('ErrorClassifier — deterministic patterns', () => {
  const c = new ErrorClassifier()

  describe('dependency errors', () => {
    it.each([
      ['Cannot find module "express"', 'dependency::cannot find module express'],
      ['Module not found: Error: Can\'t resolve \'./components/Button\'', 'dependency::'],
      ['Failed to resolve import "lodash"', 'dependency::'],
    ])('classifies "%s"', (raw, expectedPrefix) => {
      const result = c.classify(raw, RUN_ID)
      expect(result.category).toBe('dependency')
      expect(result.signature).toContain(expectedPrefix.split('::')[0]!)
    })

    it('extracts module name from "Cannot find module"', () => {
      const result = c.classify('Cannot find module "express"', RUN_ID)
      expect(result.signature).toBe('dependency::cannot find module express')
    })
  })

  describe('permission errors', () => {
    it.each([
      'EACCES: permission denied, open \'/etc/passwd\'',
      'Error: Permission denied',
      'EPERM: operation not permitted',
    ])('classifies "%s"', (raw) => {
      const result = c.classify(raw, RUN_ID)
      expect(result.category).toBe('permission')
    })
  })

  describe('network errors', () => {
    it.each([
      'Error: ECONNREFUSED 127.0.0.1:5432',
      'Error: ENOTFOUND api.example.com',
      'FetchError: request to https://example.com failed — Connection reset',
    ])('classifies "%s"', (raw) => {
      const result = c.classify(raw, RUN_ID)
      expect(result.category).toBe('network')
    })
  })

  describe('timeout errors', () => {
    it.each([
      'Error: Operation timed out after 30000ms',
      'Error: request timeout',
      'DEADLINE_EXCEEDED: context deadline exceeded',
      'Error: ETIMEDOUT',      // ETIMEDOUT = timeout, not network
    ])('classifies "%s"', (raw) => {
      const result = c.classify(raw, RUN_ID)
      expect(result.category).toBe('timeout')
    })
  })

  describe('logic errors', () => {
    it.each([
      'TypeError: Cannot read properties of undefined (reading \'map\')',
      'ReferenceError: myVar is not defined',
      'SyntaxError: Unexpected token \'}\'',
    ])('classifies "%s"', (raw) => {
      const result = c.classify(raw, RUN_ID)
      expect(result.category).toBe('logic')
    })

    it('extracts type from TypeError', () => {
      const result = c.classify('TypeError: cannot read properties of undefined', RUN_ID)
      expect(result.signature).toContain('typeerror')
    })
  })

  describe('unknown fallback', () => {
    it('falls back to unknown for unmatched messages', () => {
      const result = c.classify('Something went completely wrong somehow', RUN_ID)
      expect(result.category).toBe('unknown')
      expect(result.signature).toMatch(/^unknown::/)
    })
  })

  describe('signature properties', () => {
    it('signature is always lowercase', () => {
      const result = c.classify('ECONNREFUSED 127.0.0.1:3000', RUN_ID)
      expect(result.signature).toBe(result.signature.toLowerCase())
    })

    it('signature is max 120 chars', () => {
      const longMsg = 'Cannot find module ' + '"x'.repeat(200)
      const result = c.classify(longMsg, RUN_ID)
      expect(result.signature.length).toBeLessThanOrEqual(120)
    })

    it('rawMessage is preserved exactly', () => {
      const raw = 'TypeError: Cannot read properties of undefined (reading \'map\')'
      const result = c.classify(raw, RUN_ID)
      expect(result.rawMessage).toBe(raw)
    })
  })
})

describe('ErrorClassifier.classifyAll', () => {
  const c = new ErrorClassifier()

  it('classifies multiple messages at once', () => {
    const results = c.classifyAll([
      'Cannot find module "express"',
      'ECONNREFUSED 127.0.0.1:5432',
    ], RUN_ID)
    expect(results).toHaveLength(2)
    expect(results[0]!.category).toBe('dependency')
    expect(results[1]!.category).toBe('network')
  })
})

describe('ErrorClassifier — LLM enrichment', () => {
  it('returns null enrichment when no LLM is configured', async () => {
    const c = new ErrorClassifier()
    const { classified, enriched } = c.classifyAndEnrich('Cannot find module "x"', RUN_ID)
    expect(classified.category).toBe('dependency')
    expect(await enriched).toBeNull()
  })

  it('calls LLM enricher and returns result', async () => {
    const mockEnricher: IErrorClassifierLLM = {
      enrich: async (_raw: string, classified: ClassifiedError): Promise<EnrichedClassification> => ({
        description: `LLM says: ${classified.signature}`,
        fixHints: ['Run npm install'],
        confidence: 0.95,
      }),
    }
    const c = new ErrorClassifier({ llm: mockEnricher })
    const { classified, enriched } = c.classifyAndEnrich('Cannot find module "express"', RUN_ID)

    expect(classified.category).toBe('dependency')
    const result = await enriched
    expect(result).not.toBeNull()
    expect(result!.fixHints).toContain('Run npm install')
    expect(result!.confidence).toBe(0.95)
  })

  it('returns null if LLM enricher throws', async () => {
    const flakyEnricher: IErrorClassifierLLM = {
      enrich: async () => { throw new Error('LLM API down') },
    }
    const c = new ErrorClassifier({ llm: flakyEnricher })
    const { enriched } = c.classifyAndEnrich('ECONNREFUSED', RUN_ID)
    expect(await enriched).toBeNull() // never throws — silently swallowed
  })
})

describe('normalise()', () => {
  it('strips semver', () => {
    expect(normalise('package@1.2.3 failed')).not.toContain('1.2.3')
    expect(normalise('package@1.2.3 failed')).toContain('<v>')
  })

  it('strips memory addresses', () => {
    expect(normalise('at 0xdeadbeef')).toContain('<addr>')
  })

  it('strips line:col', () => {
    expect(normalise('error at file.ts:42:7')).not.toMatch(/:\d+/)
  })

  it('collapses whitespace', () => {
    expect(normalise('a    b   c')).toBe('a b c')
  })

  it('lowercases', () => {
    expect(normalise('TypeError')).toBe('typeerror')
  })

  it('truncates at 120 chars', () => {
    expect(normalise('x'.repeat(200)).length).toBeLessThanOrEqual(120)
  })
})
