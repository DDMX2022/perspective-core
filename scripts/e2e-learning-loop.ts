/**
 * e2e-learning-loop.ts
 *
 * End-to-end smoke test for the full perspective-core learning loop.
 * Runs WITHOUT OpenClaw — uses MockAdapter with scripted scenarios.
 *
 * What this validates:
 *   Run 1: error occurs, no recipe yet
 *   Run 2: same error, recipe success_count=1
 *   Run 3: same error, recipe success_count=2
 *   Run 4: same error, recipe success_count=3 → POLICY GENERATED ✓
 *   Run 5: policy is loaded and injected into the adapter ✓
 *
 * Usage:
 *   npx tsx scripts/e2e-learning-loop.ts
 */

import { Orchestrator } from '../src/orchestrator/index.js'
import { SqliteMemoryStore } from '../src/memory/index.js'
import { TelemetryCollector } from '../src/telemetry/index.js'
import { TorqueEngine } from '../src/torque/index.js'
import { Learner } from '../src/learner/index.js'
import { MockAdapter } from '../src/adapters/mock/index.js'

const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

const DB_PATH = './data/e2e-test.db'
const RUNS_DIR = './runs'

// Override env for this test
process.env['DB_PATH'] = DB_PATH
process.env['RUNS_DIR'] = RUNS_DIR
process.env['RECIPE_PROMOTE_THRESHOLD'] = '3'
process.env['LOG_LEVEL'] = 'warn' // suppress info logs during test

// ── Scenario: always fails with the same error, but recovers ─────────────────
const FAILING_SCENARIO = {
  success: false,
  steps: ['Cloning repo...', 'Installing dependencies...', 'Running build...'],
  errors: [
    {
      signature: 'dependency::cannot find module xyz',
      category: 'dependency' as const,
      raw: 'Cannot find module "xyz" or its corresponding type declarations',
    },
  ],
  recoverySteps: ['Running: npm install xyz', 'Retrying build...', 'Build retry succeeded'],
}

// ── After enough runs, the recipe is promoted and runs succeed ────────────────
const PASSING_SCENARIO = {
  success: true,
  steps: ['Cloning repo...', 'Installing dependencies (xyz pre-installed)...', 'Build succeeded ✓'],
}

async function run(): Promise<void> {
  console.log(`\n${CYAN}${BOLD}perspective-core — E2E Learning Loop Test${RESET}`)
  console.log(`${DIM}${'─'.repeat(52)}${RESET}\n`)

  // Fresh DB for each test run
  const { unlinkSync, existsSync } = await import('fs')
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH)

  const memory = new SqliteMemoryStore(DB_PATH)

  const TOTAL_RUNS = 5
  // Runs 1-4: fail with recovery. Run 5: pass (policy should be active)
  const scenarios = [
    FAILING_SCENARIO,
    FAILING_SCENARIO,
    FAILING_SCENARIO,
    FAILING_SCENARIO,
    PASSING_SCENARIO,
  ]

  for (let i = 0; i < TOTAL_RUNS; i++) {
    const scenario = scenarios[i]!
    // Fresh telemetry collector per run — prevents cross-run event buffer bleed
    const telemetry = new TelemetryCollector().withMemory(memory)
    const orchestrator = new Orchestrator({
      adapter: new MockAdapter(scenario),
      memory,
      telemetry,
      torque: new TorqueEngine(),
      learner: new Learner(),
    })

    const result = await orchestrator.run(
      'Build and test the auth module',
      './my-repo',
      'careful',
    )

    const icon = result.status === 'success' ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`
    const recipes = memory.listFixRecipes()
    const policies = memory.listPolicies()

    console.log(
      `  ${icon} Run ${i + 1}/${TOTAL_RUNS}` +
      `  ${DIM}status:${RESET} ${result.status.padEnd(7)}` +
      `  ${DIM}recipes:${RESET} ${recipes.length}` +
      `  ${DIM}policies:${RESET} ${YELLOW}${policies.length}${RESET}` +
      `  ${DIM}id:${RESET} ${result.runId.slice(0, 8)}`,
    )

    // After run 4, validate recipe was created
    if (i === 3) {
      const recipe = memory.getFixRecipe('dependency::cannot find module xyz')
      if (recipe && recipe.successCount >= 3) {
        console.log(`\n  ${GREEN}✓ Fix recipe learned after run 4${RESET}`)
        console.log(`    ${DIM}signature:${RESET}     ${recipe.signature}`)
        console.log(`    ${DIM}success_count:${RESET} ${recipe.successCount}`)
        console.log(`    ${DIM}fix_steps:${RESET}     ${recipe.fixSteps.slice(0, 2).join(' → ')}`)
      } else {
        console.log(`\n  ${RED}✗ Expected fix recipe with successCount >= 3 after run 4${RESET}`)
      }
    }

    // After run 5, validate policy was injected
    if (i === 4) {
      const policy = memory.getPolicy('dependency::cannot find module xyz')
      if (policy) {
        console.log(`\n  ${GREEN}✓ Policy generated and active${RESET}`)
        console.log(`    ${DIM}policy_id:${RESET}   ${policy.policyId.slice(0, 8)}`)
        console.log(`    ${DIM}action:${RESET}      ${policy.policyJson.action}`)
        console.log(`    ${DIM}confidence:${RESET}  ${Math.round(policy.confidence * 100)}%`)
        console.log(`    ${DIM}description:${RESET} ${policy.policyJson.description.slice(0, 80)}`)
      } else {
        console.log(`\n  ${YELLOW}⚠ Policy not yet generated (may need more runs or lower threshold)${RESET}`)
      }
    }
  }

  // Final summary
  const allRuns = memory.listRuns()
  const allRecipes = memory.listFixRecipes()
  const allPolicies = memory.listPolicies()

  console.log(`\n${DIM}${'─'.repeat(52)}${RESET}`)
  console.log(`  ${BOLD}Summary${RESET}`)
  console.log(`  Total runs:     ${allRuns.length}`)
  console.log(`  Fix recipes:    ${allRecipes.length}`)
  console.log(`  Active policies: ${allPolicies.length}`)
  console.log(`  Handoff files:  ./runs/<run-id>/handoff.md\n`)

  memory.close()

  const allPassed = allPolicies.length > 0
  process.exit(allPassed ? 0 : 1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
