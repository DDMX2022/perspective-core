/**
 * policy-scoring.ts
 *
 * Policy relevance scoring — determines how relevant a stored policy is
 * to a current error, and applies confidence decay over time.
 *
 * Scoring uses a two-layer approach:
 *   Layer 1: Trigram-based cosine similarity of trigger signatures (always available)
 *   Layer 2: Optional LLM-based semantic matching (future seam)
 *
 * Confidence decay:
 *   Policies lose confidence over time if they are not reinforced by new
 *   successful applications. The decay rate is configurable.
 */

import type { Policy } from '../types/index.js'

// ── Trigram cosine similarity ─────────────────────────────────────────────────

/**
 * Extract character trigrams from a string.
 * e.g., "hello" → ["hel", "ell", "llo"]
 */
function trigrams(s: string): string[] {
  const normalised = s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim()
  const result: string[] = []
  for (let i = 0; i <= normalised.length - 3; i++) {
    result.push(normalised.slice(i, i + 3))
  }
  return result
}

/**
 * Build a term frequency map from a list of tokens.
 */
function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>()
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1)
  }
  return freq
}

/**
 * Compute cosine similarity between two strings using trigram vectors.
 * Returns a value between 0 (no similarity) and 1 (identical).
 */
export function cosineSimilarity(a: string, b: string): number {
  const triA = trigrams(a)
  const triB = trigrams(b)

  if (triA.length === 0 || triB.length === 0) return 0

  const freqA = termFrequency(triA)
  const freqB = termFrequency(triB)

  // Dot product
  let dot = 0
  for (const [term, countA] of freqA) {
    const countB = freqB.get(term) ?? 0
    dot += countA * countB
  }

  // Magnitudes
  let magA = 0
  for (const count of freqA.values()) magA += count * count
  let magB = 0
  for (const count of freqB.values()) magB += count * count

  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  if (denom === 0) return 0

  return dot / denom
}

// ── Policy relevance scoring ──────────────────────────────────────────────────

export interface PolicyRelevanceResult {
  policy: Policy
  /** Similarity score between trigger signature and current error (0–1) */
  similarity: number
  /** Effective confidence after decay (0–1) */
  effectiveConfidence: number
  /** Combined relevance score (similarity × effectiveConfidence) */
  relevance: number
}

export interface PolicyScoringOptions {
  /** Minimum similarity threshold to consider a policy relevant. Default: 0.3 */
  minSimilarity?: number
  /** Confidence decay rate per day. Default: 0.005 (0.5% per day) */
  decayRatePerDay?: number
  /** Minimum confidence floor — policies never decay below this. Default: 0.1 */
  minConfidence?: number
}

const DEFAULT_SCORING_OPTIONS: Required<PolicyScoringOptions> = {
  minSimilarity: 0.3,
  decayRatePerDay: 0.005,
  minConfidence: 0.1,
}

/**
 * Score a single policy against a current error signature.
 */
export function scorePolicy(
  policy: Policy,
  errorSignature: string,
  opts: PolicyScoringOptions = {},
): PolicyRelevanceResult {
  const { decayRatePerDay, minConfidence } = { ...DEFAULT_SCORING_OPTIONS, ...opts }

  const similarity = cosineSimilarity(policy.triggerSignature, errorSignature)
  const effectiveConfidence = applyDecay(policy.confidence, policy.createdAt, decayRatePerDay, minConfidence)
  const relevance = similarity * effectiveConfidence

  return { policy, similarity, effectiveConfidence, relevance }
}

/**
 * Score all policies against a current error signature, filter by minimum
 * similarity, and return sorted by relevance (highest first).
 */
export function scoreAllPolicies(
  policies: Policy[],
  errorSignature: string,
  opts: PolicyScoringOptions = {},
): PolicyRelevanceResult[] {
  const { minSimilarity } = { ...DEFAULT_SCORING_OPTIONS, ...opts }

  return policies
    .map((p) => scorePolicy(p, errorSignature, opts))
    .filter((r) => r.similarity >= minSimilarity)
    .sort((a, b) => b.relevance - a.relevance)
}

/**
 * Filter policies to only those relevant to the given set of error signatures.
 * Returns unique policies sorted by best relevance.
 */
export function filterRelevantPolicies(
  policies: Policy[],
  errorSignatures: string[],
  opts: PolicyScoringOptions = {},
): Policy[] {
  const seen = new Set<string>()
  const results: PolicyRelevanceResult[] = []

  for (const sig of errorSignatures) {
    const scored = scoreAllPolicies(policies, sig, opts)
    for (const r of scored) {
      if (!seen.has(r.policy.policyId)) {
        seen.add(r.policy.policyId)
        results.push(r)
      }
    }
  }

  return results
    .sort((a, b) => b.relevance - a.relevance)
    .map((r) => r.policy)
}

// ── Confidence decay ──────────────────────────────────────────────────────────

/**
 * Apply exponential decay to a policy's confidence based on age.
 *
 * Formula: effective = max(minConfidence, original * (1 - rate)^days)
 *
 * This ensures policies that aren't reinforced gradually lose influence,
 * while still maintaining a minimum floor so they're never completely ignored.
 */
export function applyDecay(
  confidence: number,
  createdAt: string,
  decayRatePerDay: number,
  minConfidence: number,
): number {
  const ageMs = Date.now() - new Date(createdAt).getTime()
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24))
  const decayed = confidence * Math.pow(1 - decayRatePerDay, ageDays)
  return Math.max(minConfidence, Math.round(decayed * 1000) / 1000)
}

/**
 * Get the effective confidence of a policy (with decay applied).
 */
export function getEffectiveConfidence(
  policy: Policy,
  opts: PolicyScoringOptions = {},
): number {
  const { decayRatePerDay, minConfidence } = { ...DEFAULT_SCORING_OPTIONS, ...opts }
  return applyDecay(policy.confidence, policy.createdAt, decayRatePerDay, minConfidence)
}
