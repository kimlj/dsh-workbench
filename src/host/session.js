// The human-owned terminal registry.
//
// This deliberately does NOT reuse the harness's agent-scoped `ctx.terminals`
// service. That registry fences every session to the exact Agent that opened
// it, which is the correct design for a model tool and the wrong one for a
// terminal a person drives. Keeping our own registry is what makes the DSH
// model structurally unable to reach these shells.
//
// We also drive node-pty directly rather than going through
// `ctx.subprocess.spawnTerminal`, for three measured reasons:
//   1. the harness PTY abstraction exposes no resize at all;
//   2. its Windows handle reports pid 0, so it cannot target a process tree;
//   3. we need a real pid to reap the tree, since ConPTY is not inside a
//      Windows Job Object.

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { launchFor, presetCatalogue } from './presets.js'

const require = createRequire(import.meta.url)
const pty = require('node-pty')

/** Retained scrollback per session, in bytes. */
const SCROLLBACK_BYTES = 256 * 1024

/** Hard cap so a runaway UI cannot exhaust the host process. */
const MAX_SESSIONS = 24

/** Default geometry before the browser reports its real size. */
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 30

/** Sentinel project id addressing the harness working directory. */
export const DEFAULT_PROJECT_ID = 'workbench-default'

function isDirectory(candidate) {
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

/**
 * Run one read-only command and resolve its stdout.
 * @param file - executable name.
 * @param args - argument vector.
 * @returns the stdout text.
 */
function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) reject(error)
        else resolve(String(stdout))
      },
    )
  })
}

/**
 * Read a directory's git state; git absence or a non-repository yields empty
 * state rather than an error.
 * @param cwd - project directory.
 * @returns branch name, changed-file count, and clean flag (null when unknown).
 */
async function readGitState(cwd) {
  try {
    const branch = (await run('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    const porcelain = await run('git', ['-C', cwd, 'status', '--porcelain'])
    const changed = porcelain.split('\n').filter((line) => line.trim() !== '').length
    return { branch: branch === '' ? null : branch, changed, clean: changed === 0 }
  } catch {
    return { branch: null, changed: 0, clean: null }
  }
}

/**
 * The most recently modified top-level entries of a directory.
 * @param cwd - project directory.
 * @param limit - maximum entries returned.
 * @returns name, directory flag, and mtime per entry, newest first.
 */
async function recentFiles(cwd, limit) {
  try {
    const entries = await readdir(cwd, { withFileTypes: true })
    const files = await Promise.all(entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map(async (entry) => {
        try {
          const info = await stat(join(cwd, entry.name))
          return { name: entry.name, dir: entry.isDirectory(), mtime: info.mtimeMs }
        } catch {
          return null
        }
      }))
    return files
      .filter((entry) => entry !== null)
      .sort((left, right) => right.mtime - left.mtime)
      .slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Owns every human terminal session and every project the user has registered.
 * It emits plain JSON events; the transport layer decides who receives them.
 */
export class WorkbenchRegistry {
  /**
   * @param options.onEvent - called with each JSON-safe event to broadcast.
   * @param options.defaultCwd - fallback directory when a project is unset.
   */
  constructor(options) {
    this.onEvent = options.onEvent
    this.defaultCwd = options.defaultCwd
    this.sessions = new Map()
    this.projects = []
    this.disposed = false
  }

  // ── projects ────────────────────────────────────────────────────────────

  listProjects() {
    return this.projects.map((project) => ({ ...project }))
  }

  /** Register a project directory. Returns the stored record. */
  addProject(inputPath, name) {
    const target = typeof inputPath === 'string' ? inputPath.trim() : ''
    if (target === '') throw new Error('a project path is required')
    if (!isDirectory(target)) throw new Error(`not a directory: ${target}`)

    const existing = this.projects.find((project) => project.path === target)
    if (existing !== undefined) return { ...existing }

    const record = {
      id: randomUUID(),
      path: target,
      name:
        typeof name === 'string' && name.trim() !== ''
          ? name.trim()
          : target.split(/[\\/]/).filter(Boolean).pop() ?? target,
    }
    this.projects.push(record)
    this.emit({ t: 'projects', projects: this.listProjects() })
    return { ...record }
  }

  removeProject(id) {
    const before = this.projects.length
    this.projects = this.projects.filter((project) => project.id !== id)
    if (this.projects.length !== before) {
      this.emit({ t: 'projects', projects: this.listProjects() })
    }
  }

  /** Resolve a requested cwd, falling back to the harness working directory. */
  resolveCwd(projectId, explicitCwd) {
    if (typeof explicitCwd === 'string' && isDirectory(explicitCwd)) return explicitCwd

    if (typeof projectId === 'string') {
      const project = this.projects.find((entry) => entry.id === projectId)
      if (project !== undefined) return project.path
    }
    return this.defaultCwd
  }

  /**
   * Read-only metadata for one registered project: git branch and state, and
   * the most recently modified top-level entries. Resolves only ids this
   * registry holds, runs no model-facing tool, and never returns the process
   * environment.
   * @param projectId - a project id from `listProjects()`.
   * @returns the info, or null when the id is unknown.
   */
  async projectInfo(projectId) {
    const project = projectId === DEFAULT_PROJECT_ID
      ? { id: DEFAULT_PROJECT_ID, name: 'Working directory', path: this.defaultCwd }
      : this.projects.find((entry) => entry.id === projectId)
    if (project === undefined) return null
    const [git, files] = await Promise.all([
      readGitState(project.path),
      recentFiles(project.path, 5),
    ])
    return { id: project.id, name: project.name, path: project.path, ...git, files }
  }

  // ── sessions ────────────────────────────────────────────────────────────

  /** JSON-safe session summaries for the client. */
  list() {
    return [...this.sessions.values()].map((session) => this.summarise(session))
  }

  summarise(session) {
    return {
      id: session.id,
      presetId: session.presetId,
      label: session.label,
      accent: session.accent,
      cwd: session.cwd,
      projectId: session.projectId,
      pid: session.pid,
      command: session.command,
      status: session.status,
      cols: session.cols,
      rows: session.rows,
      startedAt: session.startedAt,
      exitCode: session.exitCode,
      signal: session.signal,
      bufferedBytes: session.bufferBytes,
    }
  }

  /**
   * Start one real PTY running a preset.
   * @returns the new session summary.
   */
  spawn(request) {
    if (this.disposed) throw new Error('workbench is shutting down')
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`session limit reached (${MAX_SESSIONS})`)
    }

    const presetId = typeof request?.presetId === 'string' ? request.presetId : 'powershell'
    const cwd = this.resolveCwd(request?.projectId, request?.cwd)

    const catalogue = presetCatalogue()
    const preset = catalogue.find((entry) => entry.id === presetId)
    if (preset === undefined) throw new Error(`unknown preset: ${presetId}`)

    const launch = launchFor(presetId, request?.customCommand)
    const cols = Number.isFinite(request?.cols) ? Math.max(20, Math.floor(request.cols)) : DEFAULT_COLS
    const rows = Number.isFinite(request?.rows) ? Math.max(5, Math.floor(request.rows)) : DEFAULT_ROWS

    const child = pty.spawn(launch.file, launch.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env },
    })

    const session = {
      id: randomUUID(),
      presetId,
      label: preset.label,
      accent: preset.accent,
      cwd,
      projectId: typeof request?.projectId === 'string' ? request.projectId : null,
      customCommand: typeof request?.customCommand === 'string' ? request.customCommand : null,
      pty: child,
      pid: child.pid,
      command: [launch.file, ...launch.args].join(' '),
      status: 'running',
      cols,
      rows,
      startedAt: Date.now(),
      exitCode: null,
      signal: null,
      buffer: [],
      bufferBytes: 0,
    }

    child.onData((chunk) => {
      if (this.disposed) return
      this.append(session, chunk)
      this.emit({ t: 'output', id: session.id, data: chunk })
    })

    child.onExit(({ exitCode, signal }) => {
      session.status = 'exited'
      session.exitCode = typeof exitCode === 'number' ? exitCode : null
      session.signal = typeof signal === 'number' ? signal : null
      this.emit({ t: 'exit', ...this.summarise(session) })
    })

    this.sessions.set(session.id, session)
    this.emit({ t: 'session', session: this.summarise(session) })
    return this.summarise(session)
  }

  /** Retained output for one session, replayed when a client attaches. */
  read(id) {
    const session = this.sessions.get(id)
    if (session === undefined) return null
    return session.buffer.join('')
  }

  write(id, data) {
    const session = this.sessions.get(id)
    if (session === undefined || session.status !== 'running') return false
    try {
      session.pty.write(String(data))
      return true
    } catch {
      return false
    }
  }

  resize(id, cols, rows) {
    const session = this.sessions.get(id)
    if (session === undefined || session.status !== 'running') return false
    const nextCols = Math.max(20, Math.floor(Number(cols) || DEFAULT_COLS))
    const nextRows = Math.max(5, Math.floor(Number(rows) || DEFAULT_ROWS))
    try {
      session.pty.resize(nextCols, nextRows)
      session.cols = nextCols
      session.rows = nextRows
      return true
    } catch {
      return false
    }
  }

  /**
   * Terminate one session and its process tree.
   * ConPTY runs outside a Windows Job Object, so killing the pty alone can
   * leave a child agent orphaned; `taskkill /T /F` reaps the tree by pid.
   */
  kill(id) {
    const session = this.sessions.get(id)
    if (session === undefined) return false

    const pid = session.pid
    try {
      session.pty.kill()
    } catch {
      // Already gone.
    }
    if (process.platform === 'win32' && typeof pid === 'number' && pid > 0) {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {
        // Best effort: the pid may be reaped already.
      })
    }
    return true
  }

  /** Drop a finished session from the UI without touching other sessions. */
  remove(id) {
    const session = this.sessions.get(id)
    if (session === undefined) return false
    if (session.status === 'running') this.kill(id)
    this.sessions.delete(id)
    this.emit({ t: 'removed', id })
    return true
  }

  /** Kill and respawn with the same configuration, in the same tab slot. */
  restart(id, overrides) {
    const previous = this.sessions.get(id)
    if (previous === undefined) throw new Error('no such session')

    const request = {
      presetId: overrides?.presetId ?? previous.presetId,
      projectId: overrides?.projectId ?? previous.projectId,
      cwd: overrides?.cwd ?? previous.cwd,
      customCommand: overrides?.customCommand ?? previous.customCommand,
      cols: overrides?.cols ?? previous.cols,
      rows: overrides?.rows ?? previous.rows,
    }

    this.sessions.delete(id)
    this.emit({ t: 'removed', id })
    this.killOnly(previous)
    return this.spawn(request)
  }

  killOnly(session) {
    const pid = session.pid
    try {
      session.pty.kill()
    } catch {
      // Already gone.
    }
    if (process.platform === 'win32' && typeof pid === 'number' && pid > 0) {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
    }
  }

  append(session, chunk) {
    session.buffer.push(chunk)
    session.bufferBytes += chunk.length
    while (session.bufferBytes > SCROLLBACK_BYTES && session.buffer.length > 1) {
      const dropped = session.buffer.shift()
      session.bufferBytes -= dropped.length
    }
  }

  emit(event) {
    try {
      this.onEvent(event)
    } catch {
      // A dead socket must never break the registry.
    }
  }

  /** The full state a freshly attached client needs. */
  bootstrap() {
    return {
      t: 'state',
      presets: presetCatalogue(),
      projects: this.listProjects(),
      sessions: this.list(),
      platform: process.platform,
      defaultCwd: this.defaultCwd,
    }
  }

  dispose() {
    this.disposed = true
    for (const session of this.sessions.values()) this.killOnly(session)
    this.sessions.clear()
  }
}
