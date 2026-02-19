#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Orchestrator } from '../orchestrator/index.js'
import { SqliteMemoryStore } from '../memory/index.js'
import { TelemetryCollector } from '../telemetry/index.js'
import { TorqueEngine } from '../torque/index.js'
import { Learner } from '../learner/index.js'
import { OpenClawAdapter, BashAdapter, HttpAdapter, adapterRegistry } from '../adapters/index.js'
import { config } from '../config/index.js'

const program = new Command()

program
  .name('slc')
  .description('perspective-core CLI — self-learning agent runner')
  .version('0.1.0')

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(startIso: string, endIso?: string): string {
  if (!endIso) return chalk.dim('—')
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function fmtStatus(status: string): string {
  switch (status) {
    case 'success': return chalk.green('success')
    case 'failed':  return chalk.red('failed ')
    case 'running': return chalk.yellow('running')
    case 'aborted': return chalk.red('aborted')
    default:        return chalk.dim('pending')
  }
}

function fmtStatusIcon(status: string): string {
  switch (status) {
    case 'success': return chalk.green('✓')
    case 'failed':  return chalk.red('✗')
    case 'aborted': return chalk.red('!')
    default:        return chalk.yellow('~')
  }
}

// ── Spinner ──────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

class Spinner {
  private frame = 0
  private timer?: ReturnType<typeof setInterval>
  private message: string

  constructor(message: string) {
    this.message = message
  }

  start(): void {
    this.timer = setInterval(() => {
      const icon = chalk.cyan(SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length])
      process.stderr.write(`\r  ${icon} ${this.message}`)
      this.frame++
    }, 80)
  }

  update(message: string): void {
    this.message = message
  }

  stop(finalMessage?: string): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    process.stderr.write('\r' + ' '.repeat(this.message.length + 10) + '\r')
    if (finalMessage) {
      console.log(`  ${finalMessage}`)
    }
  }
}

// ── Adapter resolver ────────────────────────────────────────────────────────

function resolveAdapter(name: string) {
  // Register built-in adapters lazily
  if (!adapterRegistry.has('openclaw')) {
    adapterRegistry.register('openclaw', new OpenClawAdapter())
  }
  if (!adapterRegistry.has('bash')) {
    adapterRegistry.register('bash', new BashAdapter({ command: 'echo "No command specified"' }))
  }
  if (!adapterRegistry.has('http')) {
    adapterRegistry.register('http', new HttpAdapter({ url: 'http://localhost:3000' }))
  }

  const adapter = adapterRegistry.get(name)
  if (!adapter) {
    console.error(chalk.red(`  Unknown adapter: "${name}"`))
    console.error(chalk.dim(`  Available adapters: ${adapterRegistry.list().join(', ')}`))
    process.exit(1)
  }
  return adapter
}

// ─── slc run ─────────────────────────────────────────────────────────────────

interface RunOpts { goal: string; target: string; persona?: string; adapter: string; watch?: boolean }
interface HistoryOpts { limit: string; id?: string; json?: boolean }

program
  .command('run')
  .description('Execute a goal against a target using the configured adapter')
  .requiredOption('--goal <goal>', 'Natural language goal for this run')
  .requiredOption('--target <target>', 'Domain-specific target (repo path, URL, etc.)')
  .option('--persona <persona>', 'Optional persona / strategy hint')
  .option('--adapter <adapter>', 'Adapter to use (openclaw, bash, http, or custom)', 'openclaw')
  .option('--watch', 'Stream live telemetry to terminal during execution')
  .action(async (_opts, cmd: Command) => {
    const opts = cmd.opts<RunOpts>()
    const memory = new SqliteMemoryStore(config.DB_PATH)
    const telemetry = new TelemetryCollector().withMemory(memory)

    // ── Live telemetry streaming (--watch) ──────────────────────────────
    if (opts.watch) {
      const origCapture = telemetry.capture.bind(telemetry)
      telemetry.capture = (event) => {
        origCapture(event)
        const icon = event.type === 'error'
          ? chalk.red('✗')
          : event.type === 'recovery'
            ? chalk.yellow('⟳')
            : event.type === 'policy_applied'
              ? chalk.blue('⊕')
              : chalk.dim('·')
        console.log(`  ${icon} ${chalk.dim(`[${event.type}]`)} ${event.content.slice(0, 120)}`)
      }
    }

    const adapter = resolveAdapter(opts.adapter)

    const orchestrator = new Orchestrator({
      adapter,
      memory,
      telemetry,
      torque: new TorqueEngine(),
      learner: new Learner(),
    })

    console.log(chalk.cyan('\n  perspective-core'))
    console.log(chalk.dim('  ─────────────────────────────'))
    console.log(`  ${chalk.bold('Goal:')}    ${opts.goal}`)
    console.log(`  ${chalk.bold('Target:')}  ${opts.target}`)
    console.log(`  ${chalk.bold('Adapter:')} ${chalk.cyan(opts.adapter)}`)
    if (opts.persona) console.log(`  ${chalk.bold('Persona:')} ${opts.persona}`)
    console.log(chalk.dim('  ─────────────────────────────\n'))

    // ── Progress spinner ────────────────────────────────────────────────
    const spinner = opts.watch ? null : new Spinner('Executing...')
    spinner?.start()

    const run = await orchestrator.run(opts.goal, opts.target, opts.persona)

    spinner?.stop()

    // Re-read from DB so we get endedAt + real duration
    const stored = memory.getRun(run.runId)
    const duration = stored ? fmtDuration(stored.timestamp, stored.endedAt) : '—'

    // Torque strategy from meta
    const meta = run.meta ?? {}
    const torqueStrategy = meta['torqueStrategy'] as string | undefined
    const torqueDominant = meta['torqueDominant'] as string | undefined

    // Show torque strategy during execution output
    if (torqueStrategy) {
      console.log(`  ${chalk.dim('Strategy:')} ${chalk.cyan(torqueStrategy)} ${chalk.dim(`(${torqueDominant ?? '—'})`)}`)
    }

    // Show policy/recipe counts
    const errors = memory.getErrors(run.runId)
    const allPolicies = memory.listPolicies()

    console.log(chalk.dim('  ─────────────────────────────'))
    console.log(`  ${fmtStatusIcon(run.status)} ${fmtStatus(run.status)}  ${chalk.dim(duration)}`)
    console.log(`  ${chalk.dim('Run ID:')}  ${chalk.bold(run.runId.slice(0, 8))}  ${chalk.dim(run.runId.slice(8))}`)
    if (errors.length > 0) {
      console.log(`  ${chalk.dim('Errors:')}  ${chalk.red(String(errors.length))}`)
    }
    if (allPolicies.length > 0) {
      console.log(`  ${chalk.dim('Policies active:')} ${chalk.cyan(String(allPolicies.length))}`)
    }
    const handoff = `${config.RUNS_DIR}/${run.runId}/handoff.md`
    console.log(`  ${chalk.dim('Handoff:')} ${chalk.underline(handoff)}`)
    console.log()

    memory.close()
    process.exit(run.status === 'success' ? 0 : 1)
  })

// ─── slc history ─────────────────────────────────────────────────────────────

program
  .command('history')
  .description('List recent runs or show detail for a single run')
  .option('--limit <n>', 'Number of runs to show', '20')
  .option('--id <runId>', 'Show full detail for a specific run (prefix or full ID)')
  .option('--json', 'Output as JSON')
  .action((_opts, cmd: Command) => {
    const opts = cmd.opts<HistoryOpts>()
    const memory = new SqliteMemoryStore(config.DB_PATH)

    // ── Detail view ────────────────────────────────────────────────────────
    if (opts.id) {
      // Support prefix matching
      const allRuns = memory.listRuns(1000)
      const run = allRuns.find((r) => r.runId.startsWith(opts.id!))

      if (!run) {
        console.error(chalk.red(`  No run found with ID starting with "${opts.id}"`))
        memory.close()
        process.exit(1)
      }

      if (opts.json) {
        const errors = memory.getErrors(run.runId)
        const events = memory.getEvents(run.runId)
        console.log(JSON.stringify({ run, errors, events }, null, 2))
        memory.close()
        return
      }

      const errors = memory.getErrors(run.runId)
      const events = memory.getEvents(run.runId)
      const duration = fmtDuration(run.timestamp, run.endedAt)

      // Extract meta fields stored by orchestrator
      const meta = run.meta ?? {}
      const policiesApplied = meta['policiesApplied'] as Array<{
        policyId: string; action: string; triggerSignature: string; confidence: number
      }> | undefined
      const torqueStrategy = meta['torqueStrategy'] as string | undefined
      const torqueDominant = meta['torqueDominant'] as string | undefined

      console.log(chalk.cyan('\n  Run Detail'))
      console.log(chalk.dim('  ─────────────────────────────────────────────────────'))
      console.log(`  ${fmtStatusIcon(run.status)} ${fmtStatus(run.status)}  ${chalk.dim(duration)}`)
      console.log(`  ${chalk.dim('ID:')}       ${run.runId}`)
      console.log(`  ${chalk.dim('Goal:')}     ${run.goal}`)
      console.log(`  ${chalk.dim('Target:')}   ${run.target}`)
      if (run.persona) console.log(`  ${chalk.dim('Persona:')}  ${run.persona}`)
      console.log(`  ${chalk.dim('Started:')}  ${new Date(run.timestamp).toLocaleString()}`)
      if (run.endedAt) {
        console.log(`  ${chalk.dim('Ended:')}    ${new Date(run.endedAt).toLocaleString()}`)
      }
      if (torqueStrategy) {
        console.log(`  ${chalk.dim('Strategy:')} ${chalk.cyan(torqueStrategy)}  ${chalk.dim(`dominant: ${torqueDominant ?? '—'}`)}`)
      }

      if (policiesApplied && policiesApplied.length > 0) {
        console.log(chalk.dim('\n  Policies active during run:'))
        for (const p of policiesApplied) {
          const conf = Math.round(p.confidence * 100)
          console.log(`    ${chalk.blue('⊕')} ${chalk.bold(`[${p.action.toUpperCase()}]`)} ${p.triggerSignature}  ${chalk.dim(`${conf}% · id: ${p.policyId}`)}`)
        }
      } else {
        console.log(`  ${chalk.dim('Policies:')} ${chalk.dim('none active')}`)
      }

      if (errors.length > 0) {
        console.log(chalk.dim('\n  Errors:'))
        for (const e of errors) {
          console.log(`    ${chalk.red('✗')} ${chalk.bold(`[${e.category}]`)} ${e.signature}`)
          console.log(`      ${chalk.dim(e.rawMessage.slice(0, 100))}`)
        }
      }

      const steps = events.filter((e) => e.type === 'step' || e.type === 'recovery')
      if (steps.length > 0) {
        console.log(chalk.dim('\n  Steps:'))
        for (const s of steps) {
          const prefix = s.type === 'recovery' ? chalk.yellow('⟳') : chalk.dim('·')
          console.log(`    ${prefix} ${s.content.slice(0, 100)}`)
        }
      }

      const handoff = `${config.RUNS_DIR}/${run.runId}/handoff.md`
      console.log(`\n  ${chalk.dim('Handoff:')} ${chalk.underline(handoff)}`)
      console.log()
      memory.close()
      return
    }

    // ── List view ──────────────────────────────────────────────────────────
    const runs = memory.listRuns(parseInt(opts.limit, 10))

    if (opts.json) {
      console.log(JSON.stringify(runs, null, 2))
      memory.close()
      return
    }

    if (runs.length === 0) {
      console.log(chalk.dim('\n  No runs yet. Use `slc run` to start one.\n'))
      memory.close()
      return
    }

    // Column widths
    const W_ID = 10
    const W_STATUS = 9
    const W_DUR = 7
    const W_GOAL = 52

    const header =
      chalk.dim('  ' +
        'ID'.padEnd(W_ID) +
        'STATUS'.padEnd(W_STATUS) +
        'DUR'.padEnd(W_DUR) +
        'GOAL')

    console.log(chalk.cyan('\n  Run History'))
    console.log(chalk.dim('  ' + '─'.repeat(W_ID + W_STATUS + W_DUR + W_GOAL)))
    console.log(header)
    console.log(chalk.dim('  ' + '─'.repeat(W_ID + W_STATUS + W_DUR + W_GOAL)))

    for (const run of runs) {
      const id = run.runId.slice(0, 8).padEnd(W_ID)
      const status = (run.status.slice(0, 7)).padEnd(W_STATUS)
      const dur = fmtDuration(run.timestamp, run.endedAt).replace(/\x1b\[[0-9;]*m/g, '').padEnd(W_DUR)
      const goal = run.goal.length > W_GOAL ? run.goal.slice(0, W_GOAL - 1) + '…' : run.goal

      console.log(
        `  ${fmtStatusIcon(run.status)} ${chalk.bold(id)}${fmtStatus(run.status).padEnd(W_STATUS + 9)}${chalk.dim(dur)}${goal}`,
      )
    }

    console.log(chalk.dim(`\n  ${runs.length} run${runs.length === 1 ? '' : 's'}. Use --id <prefix> for detail.\n`))
    memory.close()
  })

// ─── slc recipes ─────────────────────────────────────────────────────────────

program
  .command('recipes')
  .description('List learned fix recipes')
  .option('--json', 'Output as JSON')
  .action((_opts, cmd: Command) => {
    const opts = cmd.opts<{ json?: boolean }>()
    const memory = new SqliteMemoryStore(config.DB_PATH)
    const recipes = memory.listFixRecipes()

    if (opts.json) {
      console.log(JSON.stringify(recipes, null, 2))
      memory.close()
      return
    }

    if (recipes.length === 0) {
      console.log(chalk.dim('\n  No fix recipes learned yet. Run more jobs to build knowledge.\n'))
      memory.close()
      return
    }

    console.log(chalk.cyan('\n  Fix Recipes'))
    console.log(chalk.dim('  ──────────────────────────────────────────────────'))

    for (const r of recipes) {
      const total = r.successCount + r.failCount
      const pct = total > 0 ? Math.round((r.successCount / total) * 100) : 0
      const pctStr = total > 0
        ? (pct >= 70 ? chalk.green(`${pct}%`) : pct >= 40 ? chalk.yellow(`${pct}%`) : chalk.red(`${pct}%`))
        : chalk.dim('—')

      console.log(`  ${chalk.yellow('⚡')} ${chalk.bold(r.signature)}`)
      console.log(`     ${chalk.dim('recovery rate:')} ${pctStr}  ${chalk.green(String(r.successCount))}✓ ${chalk.red(String(r.failCount))}✗  steps: ${chalk.cyan(String(r.fixSteps.length))}`)
      if (r.fixSteps.length > 0) {
        console.log(`     ${chalk.dim('→')} ${r.fixSteps[0]}${r.fixSteps.length > 1 ? chalk.dim(` (+${r.fixSteps.length - 1} more)`) : ''}`)
      }
    }

    console.log()
    memory.close()
  })

// ─── slc policies ────────────────────────────────────────────────────────────

program
  .command('policies')
  .description('List active prevention policies')
  .option('--json', 'Output as JSON')
  .action((_opts, cmd: Command) => {
    const opts = cmd.opts<{ json?: boolean }>()
    const memory = new SqliteMemoryStore(config.DB_PATH)
    const policies = memory.listPolicies()

    if (opts.json) {
      console.log(JSON.stringify(policies, null, 2))
      memory.close()
      return
    }

    if (policies.length === 0) {
      console.log(chalk.dim('\n  No policies active yet. Policies are promoted from fix recipes.\n'))
      memory.close()
      return
    }

    console.log(chalk.cyan('\n  Active Policies'))
    console.log(chalk.dim('  ──────────────────────────────────────────────────'))

    for (const p of policies) {
      const conf = Math.round(p.confidence * 100)
      const confColor = conf >= 80 ? chalk.green : conf >= 50 ? chalk.yellow : chalk.red
      console.log(`  ${chalk.blue('⊕')} ${chalk.bold(`[${p.policyJson.action.toUpperCase()}]`)} ${p.triggerSignature}`)
      console.log(`     ${chalk.dim('confidence:')} ${confColor(`${conf}%`)}  ${chalk.dim(`id: ${p.policyId.slice(0, 8)}`)}  ${chalk.dim(`created: ${new Date(p.createdAt).toLocaleDateString()}`)}`)
      console.log(`     ${chalk.dim(p.policyJson.description.slice(0, 90))}`)
    }

    console.log()
    memory.close()
  })

// ─── slc policies delete ────────────────────────────────────────────────────

program
  .command('policies-delete <id>')
  .alias('pd')
  .description('Delete a policy by ID (prefix or full)')
  .action((id: string) => {
    const memory = new SqliteMemoryStore(config.DB_PATH)
    const policies = memory.listPolicies()
    const policy = policies.find((p) => p.policyId.startsWith(id))

    if (!policy) {
      console.error(chalk.red(`  No policy found with ID starting with "${id}"`))
      memory.close()
      process.exit(1)
    }

    const deleted = memory.deletePolicy(policy.policyId)
    if (deleted) {
      console.log(chalk.green(`  ✓ Deleted policy ${policy.policyId.slice(0, 8)} (${policy.triggerSignature})`))
    } else {
      console.error(chalk.red(`  Failed to delete policy`))
    }
    memory.close()
  })

// ─── slc recipes delete ─────────────────────────────────────────────────────

program
  .command('recipes-delete <signature>')
  .alias('rd')
  .description('Delete a fix recipe by its error signature (prefix or full)')
  .action((sig: string) => {
    const memory = new SqliteMemoryStore(config.DB_PATH)
    const recipes = memory.listFixRecipes()
    const recipe = recipes.find((r) => r.signature.startsWith(sig) || r.signature.includes(sig))

    if (!recipe) {
      console.error(chalk.red(`  No recipe found matching "${sig}"`))
      memory.close()
      process.exit(1)
    }

    const deleted = memory.deleteFixRecipe(recipe.signature)
    if (deleted) {
      console.log(chalk.green(`  ✓ Deleted recipe: ${recipe.signature}`))
    } else {
      console.error(chalk.red(`  Failed to delete recipe`))
    }
    memory.close()
  })

// ─── slc handoff ─────────────────────────────────────────────────────────────

program
  .command('handoff [runId]')
  .description('Print the handoff.md file for a run')
  .action((runId?: string) => {
    const memory = new SqliteMemoryStore(config.DB_PATH)

    // If no runId, use the most recent run
    let resolvedId: string
    if (runId) {
      const allRuns = memory.listRuns(1000)
      const match = allRuns.find((r) => r.runId.startsWith(runId))
      if (!match) {
        console.error(chalk.red(`  No run found with ID starting with "${runId}"`))
        memory.close()
        process.exit(1)
      }
      resolvedId = match.runId
    } else {
      const latest = memory.listRuns(1)
      if (latest.length === 0) {
        console.error(chalk.red('  No runs found. Use `slc run` to start one.'))
        memory.close()
        process.exit(1)
      }
      resolvedId = latest[0]!.runId
    }

    const handoffPath = join(config.RUNS_DIR, resolvedId, 'handoff.md')

    if (!existsSync(handoffPath)) {
      console.error(chalk.red(`  Handoff file not found: ${handoffPath}`))
      memory.close()
      process.exit(1)
    }

    const content = readFileSync(handoffPath, 'utf8')
    console.log(content)
    memory.close()
  })

// ─── slc export ──────────────────────────────────────────────────────────────

program
  .command('export')
  .description('Export memory store data to JSON or NDJSON')
  .option('--format <format>', 'Output format: json or ndjson', 'json')
  .option('--runs', 'Export runs')
  .option('--recipes', 'Export fix recipes')
  .option('--policies', 'Export policies')
  .option('--all', 'Export everything (default if no flags given)')
  .action((_opts, cmd: Command) => {
    const opts = cmd.opts<{ format: string; runs?: boolean; recipes?: boolean; policies?: boolean; all?: boolean }>()
    const memory = new SqliteMemoryStore(config.DB_PATH)

    const exportAll = opts.all || (!opts.runs && !opts.recipes && !opts.policies)
    const format = opts.format === 'ndjson' ? 'ndjson' : 'json'

    const data: Record<string, unknown> = {}

    if (exportAll || opts.runs) {
      const runs = memory.listRuns(10000)
      const enrichedRuns = runs.map((r) => ({
        ...r,
        events: memory.getEvents(r.runId),
        errors: memory.getErrors(r.runId),
      }))
      data['runs'] = enrichedRuns
    }

    if (exportAll || opts.recipes) {
      data['recipes'] = memory.listFixRecipes()
    }

    if (exportAll || opts.policies) {
      data['policies'] = memory.listPolicies()
    }

    if (format === 'ndjson') {
      for (const [type, items] of Object.entries(data)) {
        if (Array.isArray(items)) {
          for (const item of items) {
            console.log(JSON.stringify({ _type: type, ...item as object }))
          }
        } else {
          console.log(JSON.stringify({ _type: type, ...items as object }))
        }
      }
    } else {
      console.log(JSON.stringify(data, null, 2))
    }

    memory.close()
  })

program.parse()
