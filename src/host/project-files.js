// Human-facing project file access for the Workbench utility panel.
//
// Every operation starts from a project id already held by WorkbenchRegistry,
// resolves the registered root with realpath(), and rejects lexical or symlink
// escapes before reading or writing. This module registers no Cordis service
// or model tool; it is reachable only through the authenticated Workbench
// browser socket.

import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'

/** Largest text file the browser editor accepts. */
export const MAX_EDIT_BYTES = 2 * 1024 * 1024
/** Largest directory listing returned in one response. */
export const MAX_DIRECTORY_ENTRIES = 500

const OMITTED_DIRECTORIES = new Set(['.git', 'node_modules'])
const utf8 = new TextDecoder('utf-8', { fatal: true })

/** Error with a stable code the browser can present without guessing. */
export class ProjectFileError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProjectFileError'
    this.code = code
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function normalizeRelative(input) {
  if (typeof input !== 'string') throw new ProjectFileError('INVALID_PATH', 'file path must be a string')
  const value = input.replaceAll('\\', '/').replace(/^\.\//, '')
  if (value.includes('\0') || isAbsolute(value) || /^[a-zA-Z]:/.test(value)) {
    throw new ProjectFileError('OUTSIDE_ROOT', 'file path must stay inside the project root')
  }
  return value === '.' ? '' : value
}

function isInside(root, candidate) {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function confined(rootInput, relativePath) {
  const root = await realpath(rootInput)
  const requested = normalizeRelative(relativePath)
  const lexical = resolve(root, requested)
  if (!isInside(root, lexical)) {
    throw new ProjectFileError('OUTSIDE_ROOT', 'file path must stay inside the project root')
  }
  let target
  try {
    target = await realpath(lexical)
  } catch (error) {
    throw new ProjectFileError('NOT_FOUND', `file path does not exist: ${requested || '.'}`)
  }
  if (!isInside(root, target)) {
    throw new ProjectFileError('OUTSIDE_ROOT', 'file path resolves outside the project root')
  }
  return { root, target, relativePath: requested }
}

function decodeText(bytes, relativePath) {
  try {
    return utf8.decode(bytes)
  } catch {
    throw new ProjectFileError('BINARY_FILE', `file is not valid UTF-8 text: ${relativePath}`)
  }
}

/** Project-root file operations addressed only by registry-owned project ids. */
export class ProjectFileService {
  /** @param resolveRoot - resolves a registry-owned project id to its root. */
  constructor(resolveRoot) {
    this.resolveRoot = resolveRoot
  }

  async resolve(projectId, relativePath) {
    const root = this.resolveRoot(projectId)
    if (root === null) throw new ProjectFileError('UNKNOWN_PROJECT', 'unknown Workbench project')
    return confined(root, relativePath)
  }

  /** List one directory below the registered project root. */
  async list(projectId, relativePath = '') {
    const resolved = await this.resolve(projectId, relativePath)
    const info = await stat(resolved.target)
    if (!info.isDirectory()) throw new ProjectFileError('NOT_DIRECTORY', 'file path is not a directory')
    const entries = await readdir(resolved.target, { withFileTypes: true })
    const visible = entries
      .filter(entry => !(entry.isDirectory() && OMITTED_DIRECTORIES.has(entry.name)))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      })
      .slice(0, MAX_DIRECTORY_ENTRIES)
      .map(entry => ({
        name: entry.name,
        path: resolved.relativePath === '' ? entry.name : `${resolved.relativePath}/${entry.name}`,
        dir: entry.isDirectory(),
      }))
    return { path: resolved.relativePath, entries: visible, truncated: entries.length > visible.length }
  }

  /** Read one bounded UTF-8 file and return its optimistic-concurrency version. */
  async read(projectId, relativePath) {
    const resolved = await this.resolve(projectId, relativePath)
    const info = await stat(resolved.target)
    if (!info.isFile()) throw new ProjectFileError('NOT_FILE', 'file path is not a regular file')
    if (info.size > MAX_EDIT_BYTES) {
      throw new ProjectFileError('FILE_TOO_LARGE', `file exceeds the ${MAX_EDIT_BYTES} byte editor limit`)
    }
    const bytes = await readFile(resolved.target)
    return {
      path: resolved.relativePath,
      content: decodeText(bytes, resolved.relativePath),
      version: digest(bytes),
      size: bytes.length,
      modifiedAt: info.mtimeMs,
    }
  }

  /** Save one existing UTF-8 file only when its last-read version still matches. */
  async write(projectId, relativePath, content, expectedVersion) {
    if (typeof content !== 'string') throw new ProjectFileError('INVALID_CONTENT', 'file content must be text')
    const next = Buffer.from(content, 'utf8')
    if (next.length > MAX_EDIT_BYTES) {
      throw new ProjectFileError('FILE_TOO_LARGE', `file exceeds the ${MAX_EDIT_BYTES} byte editor limit`)
    }
    if (typeof expectedVersion !== 'string' || expectedVersion === '') {
      throw new ProjectFileError('VERSION_REQUIRED', 'save requires the version returned by file read')
    }
    const resolved = await this.resolve(projectId, relativePath)
    const info = await stat(resolved.target)
    if (!info.isFile()) throw new ProjectFileError('NOT_FILE', 'file path is not a regular file')
    const current = await readFile(resolved.target)
    if (digest(current) !== expectedVersion) {
      throw new ProjectFileError('EXTERNAL_MODIFICATION', 'file changed outside the Workbench; reopen it before saving')
    }
    await writeFile(resolved.target, next)
    const written = await stat(resolved.target)
    return {
      path: resolved.relativePath,
      version: digest(next),
      size: next.length,
      modifiedAt: written.mtimeMs,
    }
  }
}
