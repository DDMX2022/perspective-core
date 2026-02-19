#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import { Orchestrator } from '../orchestrator/index.js'
import { SqliteMemoryStore } from '../memory/index.js'
import { TelemetryCollector } from '../telemetry/index.js'
import { TorqueEngine } from '../torque/index.js'
import { Learner } from '../learner/index.js'
import { OpenClawAdapter } from '../adapters/index.js'
import { config } from '../config/index.js'

const program = new Command()

program
  .name('slc')
  .description('perspective-core CLI — self-learning agent runner')
  .version('0.1.0')

// ─── slc run ────────────────────────────────────────────────────────────────

interface RunOpts { goal: string; target: string; persona?: string; adapter: string }
interface HistoryOpts { limit: string }

program
  .command('run')
  .description('Execute a goal against a target using the configured adapter')
  .requiredOption('--goal <goal>', 'Natural language goal for this run')
  .requiredOption('--target <target>', 'Domain-specific target (repo path, URL, etc.)')
  .option('--persona <persona>', 'Optional persona / strategy hint')
  .option('--adapter <adapter>', 'Adapter to use', 'openclaw')
  .action(async (_opts, cmd: Command) => {
    const opts = cmd.opts<RunOpts>()
    const memory = new SqliteMemoryStore(config.DB_PATH)
    const telemetry = new TelemetryCollector().withMemory(memory)

    const orchestrator = new Orchestrator({
      adapter: new OpenClawAdapter(),
      memory,
      telemetry,
      torque: new TorqueEngine(),
      learner: new Learner(),
    })

    console.log(chalk.cyan('\n  perspective-core'))
    console.log(chalk.dim('  ─────────────────────────────'))
    console.log(`  ${chalk.bold('Goal:')}   ${opts.goal}`)
    console.log(`  ${chalk.bold('Target:')} ${opts.target}`)
    if (opts.persona) console.log(`  ${chalk.bold('Persona:')} ${opts.persona}`)
    console.log(chalk.dim('  ─────────────────────────────\n'))

    const start = Date.now()
    const run = await orchestrator.run(opts.goal, opts.target, opts.persona)
    const duration = ((Date.now() - start) / 1000).toFixed(1)

    const statusIcon = run.status === 'success' ? chalk.green('✓') : chalk.red('✗')
    const statusLabel = run.status === 'success' ? chalk.green('Success') : chalk.red('Failed')

    console.log(chalk.dim('  ─────────────────────────────'))
    console.log(`  ${statusIcon} ${statusLabel} in ${duration}s`)
    console.log(`  ${chalk.dim('Run ID:')} ${run.runId}`)
    console.log()

    memory.close()
    process.exit(run.status === 'success' ? 0 : 1)
  })

// ─── slc history ────────────────────────────────────────────────────────────

program
  .command('history')
  .description('List recent runs')
  .option('--limit <n>', 'Number of runs to show', '20')
  .action((_opts, cmd: Command) => {
    const opts = cmd.opts<HistoryOpts>()
    const memory = new SqliteMemoryStore(config.DB_PATH)
    const runs = memory.listRuns(parseInt(opts.limit, 10))

    if (runs.length === 0) {
      console.log(chalk.dim('  No runs yet.'))
      memory.close()
      return
    }

    console.log(chalk.cyan('\n  Run History'))
    console.log(chalk.dim('  ────────────────────────────────────────────────────'))

    for (const run of runs) {
      const icon = run.status === 'success' ? chalk.green('✓') : run.status === 'failed' ? chalk.red('✗') : chalk.yellow('~')
      const ts = new Date(run.timestamp).toLocaleString()
      console.log(`  ${icon} ${chalk.bold(run.runId.slice(0, 8))}  ${chalk.dim(ts)}  ${run.goal.slice(0, 50)}`)
    }

    console.log()
    memory.close()
  })

// ─── slc recipes ────────────────────────────────────────────────────────────

program
  .command('recipes')
  .description('List learned fix recipes')
  .action(() => {
    const memory = new SqliteMemoryStore(config.DB_PATH)
    const recipes = memory.listFixRecipes()

    if (recipes.length === 0) {
      console.log(chalk.dim('  No fix recipes learned yet.'))
      memory.close()
      return
    }

    console.log(chalk.cyan('\n  Fix Recipes'))
    console.log(chalk.dim('  ──────────────────────────────────────────────────'))

    for (const r of recipes) {
      const ratio = r.successCount + r.failCount > 0
        ? `${r.successCount}✓ ${r.failCount}✗`
        : 'no runs yet'
      console.log(`  ${chalk.yellow('⚡')} ${r.signature.slice(0, 60)}`)
      console.log(`     ${chalk.dim(ratio)}  steps: ${r.fixSteps.length}`)
    }

    console.log()
    memory.close()
  })

// ─── slc policies ────────────────────────────────────────────────────────────

program
  .command('policies')
  .description('List active prevention policies')
  .action(() => {
    const memory = new SqliteMemoryStore(config.DB_PATH)
    const policies = memory.listPolicies()

    if (policies.length === 0) {
      console.log(chalk.dim('  No policies active yet.'))
      memory.close()
      return
    }

    console.log(chalk.cyan('\n  Active Policies'))
    console.log(chalk.dim('  ──────────────────────────────────────────────────'))

    for (const p of policies) {
      const conf = Math.round(p.confidence * 100)
      const confColor = conf >= 80 ? chalk.green : conf >= 50 ? chalk.yellow : chalk.red
      console.log(`  ${chalk.blue('⊕')} [${p.policyJson.action.toUpperCase()}] ${p.policyJson.description.slice(0, 60)}`)
      console.log(`     ${chalk.dim(`confidence: ${confColor(conf + '%')}  id: ${p.policyId.slice(0, 8)}`)}`)
    }

    console.log()
    memory.close()
  })

program.parse()
