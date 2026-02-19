import { z } from 'zod'

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  /** Path to the SQLite database file */
  DB_PATH: z.string().default('./data/memory.db'),
  /** Directory where per-run artifacts are written */
  RUNS_DIR: z.string().default('./runs'),
  /** Minimum fix recipe success count before policy promotion */
  RECIPE_PROMOTE_THRESHOLD: z.coerce.number().default(3),
  /** Max ratio of fail/success before a recipe is demoted */
  RECIPE_DEMOTE_RATIO: z.coerce.number().default(0.3),
})

export type AppConfig = z.infer<typeof ConfigSchema>

export function loadConfig(): AppConfig {
  return ConfigSchema.parse(process.env)
}

export const config = loadConfig()
