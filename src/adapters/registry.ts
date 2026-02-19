/**
 * Adapter Registry
 *
 * Central registry for execution adapters. Allows dynamic adapter selection
 * via CLI flag: `slc run --adapter bash`
 *
 * Built-in adapters are pre-registered. Custom adapters can be added via
 * `adapterRegistry.register(name, adapter)`.
 *
 * Usage:
 *
 *   import { adapterRegistry } from 'perspective-core'
 *
 *   // Get a built-in adapter
 *   const adapter = adapterRegistry.get('bash')
 *
 *   // Register a custom adapter
 *   adapterRegistry.register('my-api', new HttpAdapter({ url: '...' }))
 *
 *   // List all available adapters
 *   const names = adapterRegistry.list()
 */

import type { IExecutionAdapter } from '../types/index.js'

class AdapterRegistry {
  private adapters = new Map<string, IExecutionAdapter>()

  /**
   * Register an adapter. If an adapter with the same name exists, it is replaced.
   */
  register(name: string, adapter: IExecutionAdapter): void {
    this.adapters.set(name, adapter)
  }

  /**
   * Retrieve an adapter by name.
   * Returns undefined if not found.
   */
  get(name: string): IExecutionAdapter | undefined {
    return this.adapters.get(name)
  }

  /**
   * Check if an adapter is registered.
   */
  has(name: string): boolean {
    return this.adapters.has(name)
  }

  /**
   * List all registered adapter names.
   */
  list(): string[] {
    return Array.from(this.adapters.keys())
  }

  /**
   * Unregister an adapter by name.
   */
  unregister(name: string): boolean {
    return this.adapters.delete(name)
  }

  /**
   * Clear all registered adapters.
   */
  clear(): void {
    this.adapters.clear()
  }
}

/** Singleton adapter registry */
export const adapterRegistry = new AdapterRegistry()
