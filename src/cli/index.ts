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

// ─── slc run ─────────────────────────────────────────────────────────────────

interface RunOpts { goal: string; target: string; persona?: string; adapter: string }
interface HistoryOpts { limit: string; id?: string; json?: boolean }

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

    const run = await orchestrator.run(opts.goal, opts.target, opts.persona)

    // Re-read from DB so we get endedAt + real duration
    const stored = memory.getRun(run.runId)
    const duration = stored ? fmtDuration(stored.timestamp, stored.endedAt) : '—'

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

program.parse()

