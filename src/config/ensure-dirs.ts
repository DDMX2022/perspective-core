import { mkdirSync } from 'fs'
import { dirname } from 'path'

/**
 * Ensure all runtime directories exist before the system starts.
 * Called once at CLI startup and in SqliteMemoryStore constructor.
 */
export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true })
}

export function ensureFileDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
}
