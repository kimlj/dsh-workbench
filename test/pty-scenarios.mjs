// PTY regression scenarios, one per process.
//
//   node test/pty-scenarios.mjs list
//   node test/pty-scenarios.mjs create
//
// Driven by `test/pty-regression.mjs`, which runs every scenario in its own
// node process: node-pty's Windows kill helper (the ConPTY console-list agent)
// is not safe to churn repeatedly inside one process — an in-process run of
// these scenarios corrupts the heap and dies with STATUS_HEAP_CORRUPTION
// (0xC0000374). One process per scenario is both stable and a truer regression
// signal, because each scenario starts from a fresh registry.
//
// Coverage: creation, output/scrollback, resize, simultaneous terminals,
// custom commands, project cwd, kill, restart, removal, bootstrap.
//
// REQUIRES a host that allows ConPTY named pipes. Under DSH's confined file
// sandbox node-pty refuses to spawn (`EPERM` on `\\.\pipe\conpty-…`), so run
// this from an ordinary terminal, or with the wider sandbox mode.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WorkbenchRegistry } from '../src/host/session.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Fresh registry with an event sink that records nothing. */
function makeRegistry() {
  return new WorkbenchRegistry({ defaultCwd: process.cwd(), onEvent: () => {} })
}

/**
 * Poll until `probe()` is truthy.
 * @param probe - value getter.
 * @param label - what is being awaited.
 * @param timeoutMs - give up after this long.
 * @returns the first truthy value.
 */
async function waitFor(probe, label, timeoutMs = 30000) {
  const started = Date.now()
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await sleep(120)
  }
}

/** Write one command line and wait for its output token in the scrollback. */
async function run(registry, id, line, needle) {
  registry.write(id, `${line}\r`)
  return waitFor(() => {
    const text = String(registry.read(id) ?? '')
    return text.includes(needle) ? text : null
  }, `"${needle}" in session ${id}`)
}

const SCENARIOS = {
  async create() {
    const registry = makeRegistry()
    try {
      const session = registry.spawn({ presetId: 'powershell', cols: 90, rows: 25 })
      assert.equal(session.presetId, 'powershell')
      assert.equal(session.status, 'running')
      assert.ok(Number.isInteger(session.pid) && session.pid > 0, `pid was ${session.pid}`)
      assert.equal(session.cwd, process.cwd())
      assert.equal(session.cols, 90)
      assert.equal(session.rows, 25)
      assert.ok(typeof session.startedAt === 'number' && session.startedAt > 0)
      assert.equal(registry.list().length, 1)
      await run(registry, session.id, 'echo CREATE_OK', 'CREATE_OK')
      return `pid=${session.pid} cols=${session.cols} rows=${session.rows} cwd=${session.cwd}`
    } finally {
      registry.dispose()
    }
  },

  async scrollback() {
    const registry = makeRegistry()
    try {
      const session = registry.spawn({ presetId: 'powershell' })
      await run(registry, session.id, 'echo SCROLLBACK_TOKEN', 'SCROLLBACK_TOKEN')
      const first = String(registry.read(session.id) ?? '')
      await sleep(300)
      const second = String(registry.read(session.id) ?? '')
      assert.ok(first.includes('SCROLLBACK_TOKEN'))
      assert.ok(second.includes('SCROLLBACK_TOKEN'), 'buffer must persist across reads')
      const summary = registry.list().find((entry) => entry.id === session.id)
      assert.ok(summary.bufferedBytes > 0, 'bufferedBytes must be accounted')
      return `bytes=${summary.bufferedBytes} firstRead=${first.length} secondRead=${second.length}`
    } finally {
      registry.dispose()
    }
  },

  async resize() {
    const registry = makeRegistry()
    try {
      const session = registry.spawn({ presetId: 'powershell', cols: 80, rows: 24 })
      await run(registry, session.id, 'echo READY', 'READY')
      registry.resize(session.id, 132, 43)
      const summary = await waitFor(() => {
        const entry = registry.list().find((item) => item.id === session.id)
        return entry !== undefined && entry.cols === 132 && entry.rows === 43 ? entry : null
      }, 'the resize in the summary')
      return `${summary.cols}x${summary.rows}`
    } finally {
      registry.dispose()
    }
  },

  async multi() {
    const registry = makeRegistry()
    try {
      const a = registry.spawn({ presetId: 'powershell' })
      const b = registry.spawn({ presetId: 'powershell' })
      const c = registry.spawn({ presetId: 'powershell' })
      assert.equal(new Set([a.pid, b.pid, c.pid]).size, 3, 'each session needs its own pid')
      await Promise.all([
        run(registry, a.id, 'echo TOKEN_ALPHA', 'TOKEN_ALPHA'),
        run(registry, b.id, 'echo TOKEN_BRAVO', 'TOKEN_BRAVO'),
        run(registry, c.id, 'echo TOKEN_CHARLIE', 'TOKEN_CHARLIE'),
      ])
      const bufferOf = (id) => String(registry.read(id) ?? '')
      assert.ok(bufferOf(a.id).includes('TOKEN_ALPHA'))
      assert.ok(!bufferOf(a.id).includes('TOKEN_BRAVO'), 'no cross-talk between terminals')
      assert.ok(!bufferOf(a.id).includes('TOKEN_CHARLIE'))
      assert.ok(bufferOf(b.id).includes('TOKEN_BRAVO'))
      assert.ok(!bufferOf(b.id).includes('TOKEN_ALPHA'))
      assert.ok(bufferOf(c.id).includes('TOKEN_CHARLIE'))
      return `pids=${a.pid},${b.pid},${c.pid}`
    } finally {
      registry.dispose()
    }
  },

  async custom() {
    const registry = makeRegistry()
    try {
      const session = registry.spawn({
        presetId: 'custom',
        customCommand: 'powershell -NoProfile -Command Write-Output CUSTOM_TOKEN',
      })
      assert.equal(session.presetId, 'custom')
      await run(registry, session.id, '', 'CUSTOM_TOKEN')
      return `pid=${session.pid}`
    } finally {
      registry.dispose()
    }
  },

  async project() {
    const registry = makeRegistry()
    try {
      const directory = mkdtempSync(join(tmpdir(), 'dshw-regression-'))
      const project = registry.addProject(directory, 'regression')
      assert.equal(project.path, directory)
      const session = registry.spawn({ presetId: 'powershell', projectId: project.id })
      assert.equal(session.cwd, directory, 'the project directory must become the cwd')
      assert.equal(session.projectId, project.id)
      await run(registry, session.id, 'pwd', 'dshw-regression-')
      const explicit = registry.spawn({ presetId: 'powershell', cwd: process.cwd() })
      assert.equal(explicit.cwd, process.cwd(), 'an explicit cwd wins over the project')
      registry.removeProject(project.id)
      assert.equal(registry.listProjects().length, 0)
      return `project cwd honoured, explicit cwd honoured, project removed`
    } finally {
      registry.dispose()
    }
  },

  async kill() {
    const registry = makeRegistry()
    try {
      const session = registry.spawn({ presetId: 'powershell' })
      await run(registry, session.id, 'echo BEFORE_KILL', 'BEFORE_KILL')
      registry.kill(session.id)
      const summary = await waitFor(() => {
        const entry = registry.list().find((item) => item.id === session.id)
        return entry !== undefined && entry.status === 'exited' ? entry : null
      }, 'the session to report exited')
      assert.equal(registry.list().length, 1, 'a killed session stays listed until removed')
      assert.ok(String(registry.read(session.id) ?? '').includes('BEFORE_KILL'), 'scrollback remains')
      return `exitCode=${summary.exitCode ?? 'null'} recordRetained=true`
    } finally {
      registry.dispose()
    }
  },

  async restart() {
    const registry = makeRegistry()
    try {
      const session = registry.spawn({ presetId: 'powershell' })
      await run(registry, session.id, 'echo FIRST_PROCESS', 'FIRST_PROCESS')
      const firstPid = session.pid
      const restarted = registry.restart(session.id, { cols: 100, rows: 30 })
      assert.equal(restarted.id, session.id, 'restart keeps the session identity')
      assert.notEqual(restarted.pid, firstPid, 'restart must be a new process')
      assert.equal(restarted.status, 'running')
      await run(registry, session.id, 'echo SECOND_PROCESS', 'SECOND_PROCESS')
      return `pid ${firstPid} -> ${restarted.pid}`
    } finally {
      registry.dispose()
    }
  },

  async remove() {
    const registry = makeRegistry()
    try {
      const session = registry.spawn({ presetId: 'powershell' })
      await run(registry, session.id, 'echo DOOMED', 'DOOMED')
      registry.remove(session.id)
      assert.equal(registry.list().length, 0)
      assert.equal(registry.read(session.id), null)
      assert.equal(registry.bootstrap().sessions.length, 0)
      return 'record, buffer and bootstrap entry all dropped'
    } finally {
      registry.dispose()
    }
  },

  async bootstrap() {
    const registry = makeRegistry()
    try {
      const bootstrap = registry.bootstrap()
      assert.ok(Array.isArray(bootstrap.presets) && bootstrap.presets.length >= 5)
      assert.ok(bootstrap.presets.every((preset) => typeof preset.id === 'string'))
      assert.ok(Array.isArray(bootstrap.projects))
      assert.equal(typeof bootstrap.defaultCwd, 'string')
      assert.ok(Array.isArray(bootstrap.sessions))
      return `presets=${bootstrap.presets.length} defaultCwd=${bootstrap.defaultCwd}`
    } finally {
      registry.dispose()
    }
  },
}

export const SCENARIO_NAMES = Object.keys(SCENARIOS)

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith('pty-scenarios.mjs')

if (invokedDirectly) {
  const name = process.argv[2]
  if (name === 'list') {
    console.log(SCENARIO_NAMES.join(' '))
    process.exit(0)
  }
  const scenario = SCENARIOS[name]
  if (scenario === undefined) {
    console.error(`unknown scenario "${name}" — known: ${SCENARIO_NAMES.join(', ')}`)
    process.exit(2)
  }
  try {
    const detail = await scenario()
    console.log(`PASS  ${name.padEnd(11)} ${detail ?? ''}`)
    process.exit(0)
  } catch (error) {
    console.log(`FAIL  ${name.padEnd(11)} ${error?.message ?? error}`)
    process.exit(1)
  }
}
