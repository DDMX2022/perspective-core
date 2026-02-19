import type {
  ITelemetryCollector,
  TelemetryEvent,
  IMemoryStore,
} from '../types/index.js'

/**
 * TelemetryCollector buffers events during a run and flushes to the memory
 * store at the end (or on-demand for real-time streaming).
 *
 * Designed to be created fresh per run.
 */
export class TelemetryCollector implements ITelemetryCollector {
  private buffer: TelemetryEvent[] = []
  private memory?: IMemoryStore

  /**
   * Optionally wire a memory store so flush() persists automatically.
   */
  withMemory(memory: IMemoryStore): this {
    this.memory = memory
    return this
  }

  capture(event: Omit<TelemetryEvent, 'id'>): void {
    this.buffer.push({ ...event })
  }

  flush(): void {
    if (!this.memory) return
    for (const event of this.buffer) {
      this.memory.saveEvent(event)
    }
  }

  getEvents(runId: string): TelemetryEvent[] {
    return this.buffer.filter((e) => e.runId === runId)
  }

  /** Clear the buffer (e.g. after flush) */
  clear(): void {
    this.buffer = []
  }
}
