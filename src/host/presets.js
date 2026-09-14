// Preset catalogue and Windows-aware executable resolution.
//
// Every preset maps to a REAL installed CLI. Nothing here reimplements an
// external agent: we only locate the executable and start it, so Claude Code,
// Codex, OpenCode and Hermes keep their own accounts, configuration, skills,
// hooks, MCP servers and permission systems.
//
// Windows matters here: `opencode` and many other CLIs install as `.cmd`/`.ps1`
// shims. node-pty spawns through CreateProcess, which does NOT apply PATHEXT,
// so a bare `opencode` would fail to launch. We resolve the real file and pick
// the right interpreter for its extension.

import { existsSync } from 'node:fs'
import { delimiter, extname, join } from 'node:path'

/** Fallback when PATHEXT is somehow unset (it always is on Windows). */
const PATHEXT_FALLBACK = ['.COM', '.EXE', '.BAT', '.CMD']

/** Extensions probed for a bare command name, in Windows precedence order. */
function pathExtensions() {
  const raw = process.env.PATHEXT
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = raw
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (parsed.length > 0) return parsed
  }
  return PATHEXT_FALLBACK
}

/** PATH entries, with the quoting Windows sometimes stores. */
function searchDirectories() {
  const raw = process.env.PATH ?? ''
  return raw
    .split(delimiter)
    .map((entry) => entry.replace(/^"|"$/g, '').trim())
    .filter(Boolean)
}

/**
 * Resolve one command to a real executable path, or null when absent.
 * A command containing a separator is treated as an explicit path.
 */
export function findExecutable(command) {
  if (typeof command !== 'string' || command.trim() === '') return null
  const name = command.trim()

  if (name.includes('/') || name.includes('\\')) {
    return existsSync(name) ? name : null
  }

  const extensions = extname(name) === '' ? pathExtensions() : ['']
  for (const directory of searchDirectories()) {
    for (const extension of extensions) {
      const candidate = join(directory, name + extension)
      try {
        if (existsSync(candidate)) return candidate
      } catch {
        // An unreadable PATH entry must not abort the search.
      }
    }
  }
  return null
}

/**
 * Build the argv that actually launches a resolved file.
 * `.ps1` needs a PowerShell host and `.cmd`/`.bat` need `cmd.exe`, because
 * CreateProcess cannot execute either directly.
 */
export function argvFor(resolvedPath, args) {
  const extension = extname(resolvedPath).toLowerCase()

  if (extension === '.ps1') {
    const host = findExecutable('pwsh') ?? findExecutable('powershell')
    if (host === null) {
      throw new Error(`cannot run ${resolvedPath}: no PowerShell host on PATH`)
    }
    return {
      file: host,
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolvedPath, ...args],
    }
  }

  if (extension === '.cmd' || extension === '.bat') {
    return {
      file: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', resolvedPath, ...args],
    }
  }

  return { file: resolvedPath, args: [...args] }
}

/** The interactive shell: prefer PowerShell 7 when the machine has it. */
export function shellArgv() {
  const pwsh = findExecutable('pwsh')
  if (pwsh !== null) return { file: pwsh, args: ['-NoLogo'] }

  const legacy = findExecutable('powershell')
  if (legacy !== null) return { file: legacy, args: ['-NoLogo'] }

  throw new Error('no PowerShell interpreter found on PATH')
}

/** Split a human-typed command line into argv, honouring simple quoting. */
export function splitCommandLine(line) {
  const tokens = []
  let current = ''
  let quote = null
  let started = false

  for (const character of line) {
    if (quote !== null) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (character === ' ' || character === '\t') {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += character
    started = true
  }

  if (started) tokens.push(current)
  return tokens
}

/** One catalogue row per preset. `command: null` means resolved at launch. */
const DEFINITIONS = [
  {
    id: 'powershell',
    label: 'PowerShell',
    hint: 'Interactive shell in the selected project',
    command: null,
    accent: '#3b82f6',
  },
  {
    id: 'claude',
    label: 'Claude Code',
    hint: 'Your installed claude CLI, with its own config',
    command: 'claude',
    accent: '#d97757',
  },
  {
    id: 'codex',
    label: 'Codex',
    hint: 'Your installed codex CLI, with its own config',
    command: 'codex',
    accent: '#10a37f',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    hint: 'Your installed opencode CLI',
    command: 'opencode',
    accent: '#8b5cf6',
  },
  {
    id: 'hermes',
    label: 'Hermes',
    hint: 'Your installed hermes CLI',
    command: 'hermes',
    accent: '#f59e0b',
  },
  {
    id: 'custom',
    label: 'Custom',
    hint: 'Run any installed command in the project directory',
    command: null,
    accent: '#64748b',
  },
]

/**
 * Preset rows for the client, including live availability so the UI can
 * disable a button for a CLI this machine does not have.
 */
export function presetCatalogue() {
  return DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    hint: definition.hint,
    accent: definition.accent,
    command: definition.command,
    available:
      definition.command === null ? true : findExecutable(definition.command) !== null,
    resolvedPath:
      definition.command === null ? null : findExecutable(definition.command),
  }))
}

/**
 * Resolve one preset to a concrete argv.
 * @param presetId - catalogue id.
 * @param customCommand - command line used by the `custom` preset.
 */
export function launchFor(presetId, customCommand) {
  if (presetId === 'powershell') return shellArgv()

  if (presetId === 'custom') {
    const line = typeof customCommand === 'string' ? customCommand.trim() : ''
    if (line === '') throw new Error('Custom requires a command to run')
    const [name, ...args] = splitCommandLine(line)
    if (name === undefined) throw new Error('Custom requires a command to run')
    const resolved = findExecutable(name)
    if (resolved === null) throw new Error(`command not found on PATH: ${name}`)
    return argvFor(resolved, args)
  }

  const definition = DEFINITIONS.find((entry) => entry.id === presetId)
  if (definition === undefined) throw new Error(`unknown preset: ${presetId}`)
  if (definition.command === null) throw new Error(`preset ${presetId} has no command`)

  const resolved = findExecutable(definition.command)
  if (resolved === null) throw new Error(`command not found on PATH: ${definition.command}`)
  return argvFor(resolved, [])
}
