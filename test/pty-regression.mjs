// PTY regression runner: one node process per scenario.
//
//   node test/pty-regression.mjs            every scenario
//   node test/pty-regression.mjs create kill  named scenarios only
//
// Prints one line per scenario and exits non-zero if any failed. Isolation is
// the point: node-pty's Windows kill helper is not stable under repeated
// spawn/kill churn inside a single process (see test/pty-scenarios.mjs).
//
// REQUIRES a host that allows ConPTY named pipes — an ordinary terminal, or
// DSH's wider sandbox mode.

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const scenariosFile = join(here, 'pty-scenarios.mjs')

/** Run one scenario in its own process. */
function runScenario(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scenariosFile, name], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      err += chunk.toString('utf8')
    })
    child.on('close', (code, signal) => {
      const line = out.trim().split('\n').filter((text) => text !== '').pop() ?? ''
      const crashed = code !== 0 && code !== 1
      resolve({
        name,
        code,
        signal,
        ok: code === 0 && line.startsWith('PASS'),
        line: line === '' ? `no output (code ${code}${signal === null ? '' : `, ${signal}`})` : line,
        note: crashed ? `crashed: ${err.trim().split('\n')[0] ?? ''}`.slice(0, 160) : '',
      })
    })
  })
}

const requested = process.argv.slice(2)
let names = requested
if (names.length === 0) {
  const listed = await new Promise((resolve) => {
    const child = spawn(process.execPath, [scenariosFile, 'list'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8')
    })
    child.on('close', () => resolve(out.trim().split(/\s+/).filter((text) => text !== '')))
  })
  names = listed
}

const results = []
for (const name of names) {
  const result = await runScenario(name)
  results.push(result)
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name.padEnd(11)} ${result.line}${result.note === '' ? '' : `  [${result.note}]`}`)
}

const failed = results.filter((result) => !result.ok)
console.log(
  `\n${results.length - failed.length}/${results.length} PTY scenarios passed` +
    (failed.length === 0 ? '' : ` — failed: ${failed.map((result) => result.name).join(', ')}`),
)
process.exit(failed.length === 0 ? 0 : 1)
