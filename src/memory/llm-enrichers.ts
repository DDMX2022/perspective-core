/**
 * llm-enrichers.ts
 *
 * Ready-to-use IErrorClassifierLLM implementations for popular LLM providers.
 *
 * All enrichers are non-blocking — the classifier always returns a deterministic
 * result immediately. These run async and patch the result with richer context.
 *
 * Usage — pick one and pass it to ErrorClassifier:
 *
 *   import { OpenAIEnricher } from './llm-enrichers.js'
 *   import { ErrorClassifier } from './error-classifier.js'
 *
 *   const classifier = new ErrorClassifier({
 *     llm: new OpenAIEnricher({ apiKey: process.env.OPENAI_API_KEY! })
 *   })
 *
 *   const { classified, enriched } = classifier.classifyAndEnrich(rawError, runId)
 *   // classified is instant — use it immediately
 *   // await enriched later if you want the LLM description + fix hints
 *
 * Provider setup:
 *   OpenAI:    npm install openai
 *   Anthropic: npm install @anthropic-ai/sdk
 *   Ollama:    npm install ollama  (or just use fetch — it's a local REST API)
 *   Generic:   implement IErrorClassifierLLM directly (see GenericFetchEnricher)
 */

import type { IErrorClassifierLLM, ClassifiedError, EnrichedClassification } from './error-classifier.js'

// ── Shared prompt builder ─────────────────────────────────────────────────────

function buildPrompt(raw: string, classified: ClassifiedError): string {
  return `You are a software reliability expert. Analyse this error and respond with a JSON object.

Error message:
${raw}

Pre-classified as:
  category:  ${classified.category}
  signature: ${classified.signature}

Respond with ONLY valid JSON in this exact shape:
{
  "description": "<one sentence: what went wrong and why>",
  "fixHints": ["<step 1>", "<step 2>", ...],
  "confidence": <0.0-1.0 float: how confident you are in the category>
}

Rules:
- description: plain English, max 120 chars, no jargon
- fixHints: 1–4 actionable steps, most likely first
- confidence: 0.9+ if obvious, 0.5–0.9 if likely, below 0.5 if ambiguous
- No explanation outside the JSON`
}

function parseResponse(text: string): EnrichedClassification {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(cleaned) as {
    description: string
    fixHints: string[]
    confidence: number
  }
  return {
    description: String(parsed.description ?? '').slice(0, 120),
    fixHints: Array.isArray(parsed.fixHints) ? parsed.fixHints.map(String) : [],
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5))),
  }
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

export interface OpenAIEnricherOptions {
  apiKey: string
  model?: string       // default: gpt-4o-mini
  timeoutMs?: number   // default: 8000
}

/**
 * Enriches error classifications using OpenAI.
 *
 * Requires: npm install openai
 *
 * @example
 * const classifier = new ErrorClassifier({
 *   llm: new OpenAIEnricher({ apiKey: process.env.OPENAI_API_KEY! })
 * })
 */
export class OpenAIEnricher implements IErrorClassifierLLM {
  private opts: Required<OpenAIEnricherOptions>

  constructor(opts: OpenAIEnricherOptions) {
    this.opts = {
      model: 'gpt-4o-mini',
      timeoutMs: 8_000,
      ...opts,
    }
  }

  async enrich(raw: string, classified: ClassifiedError): Promise<EnrichedClassification> {
    // Dynamic import so openai is an optional peer dep — won't break if not installed
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional peer dep
    const { default: OpenAI } = await import('openai').catch(() => {
      throw new Error('openai package not installed. Run: npm install openai')
    })

    const client = new OpenAI({
      apiKey: this.opts.apiKey,
      timeout: this.opts.timeoutMs,
    })

    const response = await client.chat.completions.create({
      model: this.opts.model,
      messages: [{ role: 'user', content: buildPrompt(raw, classified) }],
      temperature: 0,
      max_tokens: 300,
    })

    const text = response.choices[0]?.message?.content ?? ''
    return parseResponse(text)
  }
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

export interface AnthropicEnricherOptions {
  apiKey: string
  model?: string     // default: claude-3-haiku-20240307 (fast + cheap)
  timeoutMs?: number
}

/**
 * Enriches error classifications using Anthropic Claude.
 *
 * Requires: npm install @anthropic-ai/sdk
 *
 * @example
 * const classifier = new ErrorClassifier({
 *   llm: new AnthropicEnricher({ apiKey: process.env.ANTHROPIC_API_KEY! })
 * })
 */
export class AnthropicEnricher implements IErrorClassifierLLM {
  private opts: Required<AnthropicEnricherOptions>

  constructor(opts: AnthropicEnricherOptions) {
    this.opts = {
      model: 'claude-3-haiku-20240307',
      timeoutMs: 8_000,
      ...opts,
    }
  }

  async enrich(raw: string, classified: ClassifiedError): Promise<EnrichedClassification> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional peer dep
    const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
      throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk')
    })

    const client = new Anthropic({ apiKey: this.opts.apiKey })

    const message = await client.messages.create({
      model: this.opts.model,
      max_tokens: 300,
      messages: [{ role: 'user', content: buildPrompt(raw, classified) }],
    })

    const block = message.content[0]
    const text = block && block.type === 'text' ? block.text : ''
    return parseResponse(text)
  }
}

// ── Ollama (local) ────────────────────────────────────────────────────────────

export interface OllamaEnricherOptions {
  model?: string       // default: llama3.2 — change to whatever you have pulled
  baseUrl?: string     // default: http://localhost:11434
  timeoutMs?: number
}

/**
 * Enriches error classifications using a local Ollama instance.
 * No API key needed — fully offline.
 *
 * Requires: Ollama running locally (https://ollama.ai)
 *           ollama pull llama3.2  (or whatever model you prefer)
 *
 * @example
 * const classifier = new ErrorClassifier({
 *   llm: new OllamaEnricher({ model: 'llama3.2' })
 * })
 */
export class OllamaEnricher implements IErrorClassifierLLM {
  private opts: Required<OllamaEnricherOptions>

  constructor(opts: OllamaEnricherOptions = {}) {
    this.opts = {
      model: 'llama3.2',
      baseUrl: 'http://localhost:11434',
      timeoutMs: 15_000,
      ...opts,
    }
  }

  async enrich(raw: string, classified: ClassifiedError): Promise<EnrichedClassification> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs)

    try {
      const res = await fetch(`${this.opts.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.opts.model,
          prompt: buildPrompt(raw, classified),
          stream: false,
          format: 'json',
        }),
      })

      if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)

      const data = await res.json() as { response: string }
      return parseResponse(data.response)
    } finally {
      clearTimeout(timer)
    }
  }
}

// ── Generic fetch (bring-your-own endpoint) ───────────────────────────────────

export interface GenericFetchEnricherOptions {
  /**
   * Called with the prompt string. Return the raw LLM text response.
   * Wrap any API here — Azure OpenAI, Vertex AI, Bedrock, etc.
   */
  call: (prompt: string) => Promise<string>
}

/**
 * Adapter for any LLM API — just provide a function that takes a prompt
 * and returns the raw text response.
 *
 * @example
 * const classifier = new ErrorClassifier({
 *   llm: new GenericFetchEnricher({
 *     call: async (prompt) => {
 *       const res = await myAzureClient.complete(prompt)
 *       return res.text
 *     }
 *   })
 * })
 */
export class GenericFetchEnricher implements IErrorClassifierLLM {
  constructor(private opts: GenericFetchEnricherOptions) {}

  async enrich(raw: string, classified: ClassifiedError): Promise<EnrichedClassification> {
    const text = await this.opts.call(buildPrompt(raw, classified))
    return parseResponse(text)
  }
}
