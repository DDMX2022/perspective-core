/**
 * perspective-core — Public API
 *
 * Import from 'perspective-core' to build integrations.
 * IExecutionAdapter is the primary extension point — implement it to
 * integrate any execution engine or domain with the learning loop.
 *
 * @example
 * import { Orchestrator, SqliteMemoryStore, TelemetryCollector, TorqueEngine, Learner } from 'perspective-core'
 * import type { IExecutionAdapter } from 'perspective-core'
 */

// Types & interfaces — the full contract
export * from './types/index.js'

// Core modules
export { Orchestrator } from './orchestrator/index.js'
export {
  SqliteMemoryStore,
  ErrorClassifier,
  defaultClassifier,
  normaliseError,
  OpenAIEnricher,
  AnthropicEnricher,
  OllamaEnricher,
  GenericFetchEnricher,
  cosineSimilarity,
  scorePolicy,
  scoreAllPolicies,
  filterRelevantPolicies,
  applyDecay,
  getEffectiveConfidence,
} from './memory/index.js'
export type {
  ClassifiedError,
  EnrichedClassification,
  IErrorClassifierLLM,
  OpenAIEnricherOptions,
  AnthropicEnricherOptions,
  OllamaEnricherOptions,
  GenericFetchEnricherOptions,
  PolicyRelevanceResult,
  PolicyScoringOptions,
} from './memory/index.js'
export { TelemetryCollector } from './telemetry/index.js'
export { TorqueEngine } from './torque/index.js'
export type { IGoalAnalyserLLM, TorqueEngineOptions } from './torque/index.js'
export { Learner } from './learner/index.js'
export {
  getDefaultPlanetAgents,
  activatePlanets,
  extractCrux,
  getDefaultPlanetInteractions,
  getRelevantInteractions,
  getDominantInteraction,
  scoreInteraction,
  interactionKey,
  MockLLMAdapter,
  buildPersonalityPrompt,
  buildMemoryCandidates,
  reflectOnInteraction,
  analyzePersonality,
} from './planetary-persona-engine/index.js'
export type {
  ActivationResult,
  CruxResult,
  InteractionType,
  LLMAdapter,
  MemoryCandidate,
  PersonalityAnalysisInput,
  PersonalityAnalysisResult,
  PersonalityInternalState,
  PersonalityPromptState,
  PlanetActivation,
  PlanetAgent,
  PlanetInteraction,
  PlanetName,
  ReflectionResult,
} from './planetary-persona-engine/index.js'

// Config
export { config, loadConfig } from './config/index.js'
export { logger } from './config/logger.js'

// Built-in adapters
export { BaseAdapter } from './adapters/base.js'
export { OpenClawAdapter } from './adapters/openclaw/index.js'
export { DockerAdapter } from './adapters/docker/index.js'
export type { DockerAdapterOptions } from './adapters/docker/index.js'
export { BashAdapter } from './adapters/bash/index.js'
export type { BashAdapterOptions } from './adapters/bash/index.js'
export { HttpAdapter } from './adapters/http/index.js'
export type { HttpAdapterOptions } from './adapters/http/index.js'
export { adapterRegistry } from './adapters/registry.js'
export { MockAdapter } from './adapters/mock/index.js'
export type { MockScenario } from './adapters/mock/index.js'
