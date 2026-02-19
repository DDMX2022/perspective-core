/**
 * error-classifier.ts
 *
 * Classifies raw error messages into structured ErrorSignature objects.
 *
 * Architecture — two layers:
 *
 *   Layer 1 — Deterministic patterns (runs offline, no API key needed)
 *     Fast regex-based matching covering the most common error categories.
 *     This is the default path used by OpenClawAdapter and MockAdapter.
 *
 *   Layer 2 — LLM enrichment hook (optional, async)
 *     IErrorClassifierLLM interface: plug in any LLM client to enrich a
 *     classified error with a human-readable summary and better fixHints.
 *     The core loop never blocks on the LLM — enrichment is fire-and-patch.
 *
 * Signature normalisation rules:
 *   - Paths stripped to basename only
 *   - Line/column numbers removed
 *   - Memory addresses removed
 *   - Package versions replaced with version placeholder
 *   - Max 120 chars, lowercased
 *
 * Usage:
 *   const classifier = new ErrorClassifier()
 *   const sig = classifier.classify('Cannot find module "express"')
 *   // → { signature: 'dependency::cannot find module "express"', category: 'dependency', ... }
 *
 * LLM enrichment (future):
 *   const classifier = new ErrorClassifier({ llm: new OpenAIErrorEnricher() })
 *   const sig = await classifier.classifyAndEnrich('...')
 */

import type { ErrorSignature, ErrorCategory } from '../types/index.js'

// ── Pattern table ─────────────────────────────────────────────────────────────

interface PatternRule {
  category: ErrorCategory
  patterns: RegExp[]
  /** Extract a normalised key phrase to anchor the signature */
  extract?: (raw: string) => string
}

const PATTERN_RULES: PatternRule[] = [
  {
    category: 'dependency',
    patterns: [
      /cannot find module/i,
      /module not found/i,
      /failed to resolve/i,
      /no such package/i,
      /package.*not found/i,
      /ENOENT.*node_modules/i,
      /peer dep.*missing/i,
      /unmet peer dependency/i,
      /could not resolve.*import/i,
    ],
    extract: (raw) => {
      // Extract the module name from common patterns
      const m =
        raw.match(/cannot find module ['"](.*?)['"]/i) ??
        raw.match(/module not found.*['"](.*?)['"]/i) ??
        raw.match(/failed to resolve.*['"](.*?)['"]/i)
      return m ? `cannot find module ${m[1]}` : 'dependency resolution failed'
    },
  },
  {
    category: 'permission',
    patterns: [
      /EACCES/,
      /EPERM/,
      /permission denied/i,
      /access denied/i,
      /operation not permitted/i,
      /insufficient permissions/i,
      /not authorized/i,
      /forbidden/i,
    ],
    extract: (raw) => {
      const m = raw.match(/EACCES.*?'(.*?)'/i) ?? raw.match(/permission denied.*?['"](.*?)['"]/i)
      return m ? `permission denied: ${basename(m[1])}` : 'permission denied'
    },
  },
  {
    category: 'timeout',
    patterns: [
      /timeout/i,
      /timed out/i,
      /exceeded.*time/i,
      /time limit/i,
      /deadline exceeded/i,
      /ESOCKETTIMEDOUT/,
      /ETIMEDOUT/,
    ],
    extract: () => 'operation timed out',
  },
  {
    category: 'network',
    patterns: [
      /ECONNREFUSED/,
      /ECONNRESET/,
      /ENOTFOUND/,
      /network.*error/i,
      /connection refused/i,
      /connection reset/i,
      /getaddrinfo/i,
      /fetch failed/i,
      /ERR_NETWORK/,
    ],
    extract: (raw) => {
      const m = raw.match(/ECONNREFUSED.*?([\d.]+:\d+)/) ??
        raw.match(/ENOTFOUND\s+(\S+)/)
      return m ? `connection failed: ${m[1]}` : 'network connection failed'
    },
  },
  {
    category: 'logic',
    patterns: [
      /TypeError/,
      /ReferenceError/,
      /SyntaxError/,
      /RangeError/,
      /undefined is not/i,
      /null.*property/i,
      /cannot read prop/i,
      /is not a function/i,
      /is not defined/i,
      /unexpected token/i,
      /assertion.*failed/i,
      /invariant.*violation/i,
    ],
    extract: (raw) => {
      const m = raw.match(/(TypeError|ReferenceError|SyntaxError|RangeError):\s*(.{0,60})/i)
      return m ? `${m[1].toLowerCase()}: ${normalise(m[2])}` : normalise(raw.slice(0, 80))
    },
  },
]

// ── LLM enrichment interface (pluggable) ─────────────────────────────────────

/**
 * Implement this interface to add LLM-powered enrichment.
 * The enricher receives the raw message and the deterministic classification,
 * and can return an improved description and optional fix hints.
 *
 * Example implementations:
 *   - OpenAIErrorEnricher (calls GPT-4o with the raw error)
 *   - AnthropicErrorEnricher (calls Claude)
 *   - LocalLLMEnricher (calls Ollama)
 *
 * The classifier NEVER awaits the LLM on the hot path — enrichment is
 * always optional and fire-and-patch at the caller's discretion.
 */
export interface IErrorClassifierLLM {
  enrich(raw: string, classified: ClassifiedError): Promise<EnrichedClassification>
}

export interface ClassifiedError {
  signature: string
  category: ErrorCategory
  rawMessage: string
}

export interface EnrichedClassification {
  /** LLM-generated human-readable description */
  description: string
  /** Suggested fix steps the LLM generated */
  fixHints: string[]
  /** Confidence 0–1 that the classification is correct */
  confidence: number
}

// ── Classifier ────────────────────────────────────────────────────────────────

export interface ErrorClassifierOptions {
  /** Optional LLM enricher — enrichment is always async and non-blocking */
  llm?: IErrorClassifierLLM
}

export class ErrorClassifier {
  private llm?: IErrorClassifierLLM

  constructor(opts: ErrorClassifierOptions = {}) {
    this.llm = opts.llm
  }

  /**
   * Classify a raw error message synchronously using pattern rules.
   * Always fast, always works offline.
   */
  classify(rawMessage: string, runId: string): ClassifiedError {
    const cleaned = rawMessage.trim()

    for (const rule of PATTERN_RULES) {
      if (rule.patterns.some((p) => p.test(cleaned))) {
        const phrase = rule.extract ? rule.extract(cleaned) : normalise(cleaned.slice(0, 80))
        return {
          signature: `${rule.category}::${phrase}`.slice(0, 120),
          category: rule.category,
          rawMessage: cleaned,
        }
      }
    }

    // Fallback: unknown category, normalised raw message as signature
    return {
      signature: `unknown::${normalise(cleaned.slice(0, 80))}`,
      category: 'unknown',
      rawMessage: cleaned,
    }
  }

  /**
   * Classify then optionally enrich via LLM.
   * Returns the deterministic result immediately; enrichment is async.
   *
   * Usage:
   *   const { classified, enriched } = await classifier.classifyAndEnrich(raw, runId)
   *   // classified is always present
   *   // enriched is a Promise<EnrichedClassification | null> — await it when convenient
   */
  classifyAndEnrich(
    rawMessage: string,
    runId: string,
  ): { classified: ClassifiedError; enriched: Promise<EnrichedClassification | null> } {
    const classified = this.classify(rawMessage, runId)

    const enriched: Promise<EnrichedClassification | null> = this.llm
      ? this.llm.enrich(rawMessage, classified).catch(() => null)
      : Promise.resolve(null)

    return { classified, enriched }
  }

  /**
   * Classify an array of raw error strings in one call.
   */
  classifyAll(rawMessages: string[], runId: string): ClassifiedError[] {
    return rawMessages.map((raw) => this.classify(raw, runId))
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip paths to their basename */
function basename(p: string): string {
  return p.replace(/.*[/\\]/, '')
}

/**
 * Normalise a raw error string into a stable, comparable key:
 *   - lowercase
 *   - strip file paths to basename
 *   - remove line/col numbers
 *   - remove memory addresses
 *   - collapse whitespace
 *   - strip version numbers
 */
export function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(0x[0-9a-f]+)\b/gi, '<addr>')        // memory addresses
    .replace(/\b\d+\.\d+\.\d+(-[\w.]+)?\b/g, '<v>') // semver
    .replace(/:\d+(:\d+)?/g, '')                      // line:col
    .replace(/\b(\/[\w./\\-]+)\b/g, (m) => basename(m)) // paths → basename
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

// ── Singleton convenience export ─────────────────────────────────────────────

export const defaultClassifier = new ErrorClassifier()
