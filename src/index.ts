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
export { SqliteMemoryStore } from './memory/index.js'
export { TelemetryCollector } from './telemetry/index.js'
export { TorqueEngine } from './torque/index.js'
export { Learner } from './learner/index.js'

// Config
export { config, loadConfig } from './config/index.js'
export { logger } from './config/logger.js'

// Built-in adapters
export { OpenClawAdapter } from './adapters/openclaw/index.js'
export { DockerAdapter } from './adapters/docker/index.js'
export type { DockerAdapterOptions } from './adapters/docker/index.js'
export { MockAdapter } from './adapters/mock/index.js'
export type { MockScenario } from './adapters/mock/index.js'
