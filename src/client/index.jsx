// dsh-workbench browser half.
//
// Registers two additive seats:
//   sidebar.panellist  — the icon that opens the workbench
//   main[workbench]    — the full-height panel itself
//
// The catalogue describes sidebar.panellist as "each list id addresses the
// matching main panel", with replaceRisk: none, so a fresh id adds a panel
// beside the shipped Conversation instead of shadowing it.
//
// Terminal instances and the socket live in module scope, not in React. React
// mounts and unmounts this panel as the user switches main panels; if the
// terminals were component state, every switch would destroy live sessions.

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import xtermCss from '@xterm/xterm/css/xterm.css'
import * as React from 'react'

import {
  DEFAULT_CONFIG,
  createKeyHandler,
  hintForIndex,
  isForeignEditable,
  isMacPlatform,
  loadConfig,
  normalizeConfig,
  parseForm,
  saveConfig,
  summarize,
  toForm,
} from './keymap.js'

// `slots` is a hard dependency, not an optional one: every seat this plugin
// contributes is registered through it. Declaring it makes Cordis hold this
// fiber until the slot service exists.
//
// Without this declaration the plugin activates on its own (the graph row
// carries no inject edges and `immediately: false`), `ctx.get('slots')` returns
// undefined, and the panel silently never registers — the stylesheet is
// injected and nothing else appears.
export const inject = ['slots']

const PANEL_ID = 'workbench'
const RAIL_TYPE_ID = 'dsh-workbench/rail'
/** Sentinel project id the host maps to its own working directory. */
const DEFAULT_PROJECT_ID = 'workbench-default'
const WS_PATH = '/x/workbench/ws'
const SCROLLBACK_LINES = 5000
const VERSION = '1.1'
const IS_MAC = isMacPlatform()

/**
 * The four configurable actions, in the order the shortcut editor shows them.
 * `Mod` is rendered per platform (Ctrl / Cmd) by keymap.js.
 */
const KEY_FIELDS = [
  { action: 'select', label: 'Terminals', placeholder: 'Mod+<1-8>' },
  { action: 'last', label: 'Last terminal', placeholder: 'Mod+9' },
  { action: 'next', label: 'Next terminal', placeholder: 'Ctrl+Tab' },
  { action: 'prev', label: 'Previous terminal', placeholder: 'Ctrl+Shift+Tab' },
]

const TERMINAL_THEME = {
  background: '#0b0f14',
  foreground: '#d7e0ea',
  cursor: '#7dd3fc',
  selectionBackground: '#264f78',
  black: '#0b0f14',
  red: '#f87171',
  green: '#86efac',
  yellow: '#fcd34d',
  blue: '#93c5fd',
  magenta: '#d8b4fe',
  cyan: '#7dd3fc',
  white: '#e5e7eb',
  brightBlack: '#64748b',
  brightRed: '#fca5a5',
  brightGreen: '#bbf7d0',
  brightYellow: '#fde68a',
  brightBlue: '#bfdbfe',
  brightMagenta: '#e9d5ff',
  brightCyan: '#bae6fd',
  brightWhite: '#f8fafc',
}

const PANEL_CSS = `
.dshw-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary)}
.dshw-head{display:flex;align-items:center;gap:12px;flex:none;padding:14px 20px 10px}
.dshw-head-tile{display:flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;border-radius:8px;background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary))}
.dshw-head-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.dshw-head-title{font-size:16px;font-weight:600;line-height:22px}
.dshw-head-sub{font-size:12px;line-height:16px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshw-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;flex:none;padding:8px 20px;border-bottom:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1))}
.dshw-group{display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0}
.dshw-spacer{flex:1 1 auto}
.dshw-btn{border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 10px;font-size:12px;line-height:1.4;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.dshw-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshw-btn:disabled{opacity:.4;cursor:not-allowed}
.dshw-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
.dshw-select{background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));color:inherit;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:8px;padding:5px 8px;font-size:12px;max-width:320px}
.dshw-input{background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));color:inherit;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:8px;padding:5px 10px;font-size:12px;min-width:180px;flex:1 1 260px}
.dshw-tabs{display:flex;gap:4px;align-items:center;flex:none;padding:8px 20px 0;overflow-x:auto}
.dshw-tab{display:inline-flex;align-items:center;gap:7px;border:0.5px solid transparent;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));border-radius:8px 8px 0 0;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
.dshw-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshw-tab[data-active="true"]{background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);border-color:var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-bottom-color:transparent;box-shadow:inset 0 2px 0 var(--dsw-cockpit-accent-primary,var(--dsw-alias-brand-primary))}
.dshw-tab-x{opacity:.6;font-weight:700}
.dshw-tab-x:hover{opacity:1}
.dshw-badge{opacity:.5;font-size:10px;min-width:10px;text-align:center;font-variant-numeric:tabular-nums}
.dshw-card{display:flex;flex:1 1 auto;flex-direction:column;min-height:320px;margin:0 20px 12px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:10px;background:var(--dsw-alias-bg-base);overflow:hidden}
.dshw-termhead{display:flex;align-items:center;gap:10px;flex:none;padding:8px 12px;border-bottom:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));font-size:12px;color:var(--dsw-alias-label-primary)}
.dshw-cwd{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,monospace);font-size:11px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshw-stage{flex:1 1 auto;min-height:0;position:relative}
.dshw-host,.dshw-term{position:absolute;inset:0;padding:6px 10px}
.dshw-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font-size:12px;text-align:center;padding:16px}
.dshw-status{display:flex;gap:10px;align-items:center;flex:none;padding:5px 20px;font-size:11px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));border-top:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1))}
.dshw-err{color:var(--dsw-alias-state-error-primary);font-weight:600}
.dshw-keys{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:7px 20px;font-size:11px;border-bottom:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1))}
.dshw-keys label{display:inline-flex;align-items:center;gap:5px}
.dshw-keys label>span{opacity:.7}
.dshw-key{background:transparent;color:inherit;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:5px;padding:3px 6px;font-size:11px;font-family:inherit;min-width:150px}
.dshw-key[data-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.dshw-keys-hint{flex:1 1 100%;opacity:.6;line-height:1.5}
.dshw-keys-err{color:var(--dsw-alias-state-error-primary);font-weight:600}
.dshwr-root{display:flex;flex-direction:column;gap:14px;padding:12px}
.dshwr-section{display:flex;flex-direction:column;gap:6px}
.dshwr-head{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshwr-card{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:10px;background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1))}
.dshwr-name{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dshwr-path{font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:16px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));overflow-wrap:anywhere}
.dshwr-pills{display:flex;flex-wrap:wrap;gap:6px}
.dshwr-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;font-size:11px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshwr-pill[data-clean="true"]{color:var(--dsw-alias-state-success-primary)}
.dshwr-row{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px}
.dshwr-row-name{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dshwr-meta{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font-variant-numeric:tabular-nums}
.dshwr-empty{font-size:12px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshwr-dot{width:8px;height:8px;border-radius:50%;flex:none}
`

// ── module-scope store ────────────────────────────────────────────────────
// Survives panel unmounts, so live terminals and the socket outlive a switch
// to the Conversation panel and back.

const state = {
  status: 'idle',
  error: null,
  presets: [],
  projects: [],
  sessions: [],
  activeId: null,
  activeProjectId: null,
  platform: null,
  defaultCwd: null,
  // Read-only project metadata for the contextual rail, keyed by project id.
  projectInfo: {},
  // Shortcut mapping, read once from this browser profile's localStorage. The
  // panel keeps it in module scope so a remount (or a hot reload) keeps the
  // user's mapping without touching the host.
  shortcuts: loadConfig(),
}

const records = new Map()
const listeners = new Set()

let pluginCtx = null
let socket = null
let host = null
let closedByUs = false
let reconnectDelay = 500
let styleElement = null
let lastCols = 120
let lastRows = 30

function notify() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // One bad subscriber must not stop the others.
    }
  }
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function send(message) {
  if (socket === null || socket.readyState !== 1) return false
  try {
    socket.send(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}

// ── styles ────────────────────────────────────────────────────────────────

function ensureStyles() {
  if (styleElement !== null) return
  styleElement = document.createElement('style')
  styleElement.dataset.dshWorkbench = ''
  styleElement.textContent = `${xtermCss}\n${PANEL_CSS}`
  document.head.appendChild(styleElement)
}

function removeStyles() {
  if (styleElement !== null && styleElement.parentNode !== null) {
    styleElement.parentNode.removeChild(styleElement)
  }
  styleElement = null
}

// ── persistent DOM host ───────────────────────────────────────────────────

function ensureHost() {
  if (host === null) {
    host = document.createElement('div')
    host.className = 'dshw-host'
  }
  return host
}

// ── terminals ─────────────────────────────────────────────────────────────

function ensureTerminal(summary) {
  if (records.has(summary.id)) return records.get(summary.id)
  if (host === null) return null

  const container = document.createElement('div')
  container.className = 'dshw-term'
  container.style.display = 'none'

  const term = new Terminal({
    allowProposedApi: true,
    convertEol: false,
    cursorBlink: true,
    fontFamily: 'Cascadia Mono, Consolas, Menlo, monospace',
    fontSize: 13,
    scrollback: SCROLLBACK_LINES,
    theme: TERMINAL_THEME,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(container)
  term.onData((data) => send({ t: 'input', id: summary.id, data }))

  host.appendChild(container)
  const record = { term, fit, container, summary }
  records.set(summary.id, record)

  try {
    term.resize(summary.cols || lastCols, summary.rows || lastRows)
  } catch {
    // Geometry is corrected on first activation.
  }
  send({ t: 'attach', id: summary.id })
  return record
}

function writeTo(id, data) {
  const record = records.get(id)
  if (record === undefined) return
  record.term.write(data)
}

function fitActive() {
  const record = state.activeId === null ? undefined : records.get(state.activeId)
  if (record === undefined || record.container.style.display === 'none') return
  try {
    record.fit.fit()
  } catch {
    return
  }
  if (record.term.cols === lastCols && record.term.rows === lastRows) return
  lastCols = record.term.cols
  lastRows = record.term.rows
  send({ t: 'resize', id: state.activeId, cols: lastCols, rows: lastRows })
}

function setActive(id) {
  state.activeId = id
  for (const [sid, record] of records) {
    const isActive = sid === id
    record.container.style.display = isActive ? 'block' : 'none'
  }
  notify()
  window.requestAnimationFrame(() => {
    fitActive()
    const record = id === null ? undefined : records.get(id)
    if (record !== undefined) record.term.focus()
  })
}

function dropTerminal(id) {
  const record = records.get(id)
  if (record === undefined) return
  try {
    record.term.dispose()
  } catch {
    // Already disposed.
  }
  if (record.container.parentNode !== null) {
    record.container.parentNode.removeChild(record.container)
  }
  records.delete(id)
}

// ── session bookkeeping ───────────────────────────────────────────────────

function upsertSession(summary) {
  const index = state.sessions.findIndex((entry) => entry.id === summary.id)
  if (index === -1) state.sessions = [...state.sessions, summary]
  else state.sessions = state.sessions.map((entry) => (entry.id === summary.id ? summary : entry))
}

function patchSession(id, patch) {
  state.sessions = state.sessions.map((entry) =>
    entry.id === id ? { ...entry, ...patch } : entry,
  )
}

function dropSession(id) {
  state.sessions = state.sessions.filter((entry) => entry.id !== id)
  dropTerminal(id)
  if (state.activeId === id) {
    state.activeId = state.sessions.length > 0 ? state.sessions[state.sessions.length - 1].id : null
    if (state.activeId !== null) setActive(state.activeId)
  }
  notify()
}

/**
 * Ask the host for one project's read-only metadata when it is not already
 * held. The host resolves only ids it registered, so no path leaves the client.
 * @param projectId - registered project id, or null.
 */
function requestProjectInfo(projectId) {
  if (projectId === null || state.projectInfo[projectId] !== undefined) return
  send({ t: 'projectInfo', id: projectId })
}

/** The project id the rail reports on: the selected one, else the host default. */
function railProjectId() {
  return state.activeProjectId ?? DEFAULT_PROJECT_ID
}

// ── transport ─────────────────────────────────────────────────────────────

function handle(message) {
  switch (message.t) {
    case 'state': {
      state.presets = message.presets ?? []
      state.projects = message.projects ?? []
      state.platform = message.platform ?? null
      state.defaultCwd = message.defaultCwd ?? null
      state.sessions = message.sessions ?? []
      for (const summary of state.sessions) {
        ensureTerminal(summary)
        send({ t: 'attach', id: summary.id })
      }
      const running = state.sessions.find((entry) => entry.status === 'running')
      const preferred = running ?? state.sessions[0]
      if (state.activeId === null && preferred !== undefined) setActive(preferred.id)
      else notify()
      return
    }
    case 'session': {
      upsertSession(message.session)
      ensureTerminal(message.session)
      notify()
      return
    }
    case 'spawned': {
      upsertSession(message.session)
      ensureTerminal(message.session)
      setActive(message.session.id)
      return
    }
    case 'output':
    case 'attached':
      writeTo(message.id, message.data)
      return
    case 'exit':
      patchSession(message.id, { status: 'exited', exitCode: message.exitCode })
      notify()
      return
    case 'removed':
      dropSession(message.id)
      return
    case 'projects':
      state.projects = message.projects ?? []
      notify()
      return
    case 'project':
      if (!state.projects.some((entry) => entry.id === message.project.id)) {
        state.projects = [...state.projects, message.project]
      }
      state.activeProjectId = message.project.id
      notify()
      return
    case 'projectInfo':
      state.projectInfo = { ...state.projectInfo, [message.id]: message.info }
      notify()
      return
    case 'error':
      state.error = message.message ?? 'unknown error'
      notify()
      return
    default:
      return
  }
}

function ensureSocket() {
  if (socket !== null && (socket.readyState === 0 || socket.readyState === 1)) return
  closedByUs = false
  state.status = 'connecting'
  notify()

  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${scheme}//${window.location.host}${WS_PATH}`)
  socket = ws

  ws.onopen = () => {
    state.status = 'open'
    state.error = null
    reconnectDelay = 500
    notify()
    send({ t: 'hello' })
    if (state.activeId !== null) send({ t: 'attach', id: state.activeId })
  }
  ws.onmessage = (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    handle(message)
  }
  ws.onclose = () => {
    if (socket === ws) socket = null
    state.status = 'closed'
    notify()
    if (closedByUs) return
    const delay = reconnectDelay
    reconnectDelay = Math.min(reconnectDelay * 2, 8000)
    window.setTimeout(() => {
      if (!closedByUs) ensureSocket()
    }, delay)
  }
  ws.onerror = () => {
    // onclose owns recovery.
  }
}

// ── actions ───────────────────────────────────────────────────────────────

function spawnSession(presetId, customCommand) {
  state.error = null
  send({
    t: 'spawn',
    presetId,
    projectId: state.activeProjectId,
    customCommand: customCommand ?? null,
    cols: lastCols,
    rows: lastRows,
  })
}

async function pickProject() {
  const uiWorkspace = pluginCtx === null ? undefined : pluginCtx.get('uiWorkspace')
  if (uiWorkspace === undefined || typeof uiWorkspace.pickDirectory !== 'function') {
    state.error = 'directory picker is unavailable in this composition'
    notify()
    return
  }
  try {
    const path = await uiWorkspace.pickDirectory()
    if (typeof path === 'string' && path !== '') send({ t: 'addProject', path })
  } catch (error) {
    state.error = String(error?.message ?? error)
    notify()
  }
}

// ── components ────────────────────────────────────────────────────────────

/** Compact relative time for rail metadata. */
function relativeTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/**
 * The Workbench's contextual rail tab: read-only project, git, file, and
 * terminal facts the plugin already owns. It registers through the same public
 * rail path as any other type and exposes no PTY handle or terminal content.
 */
function WorkbenchRail() {
  const [, forceRender] = React.useReducer((count) => count + 1, 0)
  React.useEffect(() => subscribe(forceRender), [])
  React.useEffect(() => { requestProjectInfo(railProjectId()) }, [state.activeProjectId])
  const projectId = railProjectId()
  const project = state.projects.find((entry) => entry.id === projectId)
  const info = state.projectInfo[projectId]
  return (
    <div className="dshwr-root" data-workbench-rail>
      <section className="dshwr-section">
        <span className="dshwr-head">Project Info</span>
        <div className="dshwr-card">
          <span className="dshwr-name">{info?.name ?? project?.name ?? 'Working directory'}</span>
          <span className="dshwr-path">{info?.path ?? project?.path ?? state.defaultCwd ?? ''}</span>
          <span className="dshwr-pills">
            {info?.branch != null && <span className="dshwr-pill">{info.branch}</span>}
            {info?.clean === true && <span className="dshwr-pill" data-clean="true">Clean</span>}
            {info?.clean === false && (
              <span className="dshwr-pill">{info.changed} changed</span>
            )}
            <span className="dshwr-pill" data-terminals>
              {state.sessions.length} terminal{state.sessions.length === 1 ? '' : 's'}
            </span>
          </span>
        </div>
      </section>

      <section className="dshwr-section">
        <span className="dshwr-head">Recent Files</span>
        {info === undefined || info.files.length === 0
          ? <span className="dshwr-empty">No files read yet.</span>
          : info.files.map((file) => (
            <div className="dshwr-row" key={file.name} title={file.name}>
              <span className="dshwr-row-name">{file.dir ? `${file.name}/` : file.name}</span>
              <span className="dshwr-meta">{relativeTime(file.mtime)}</span>
            </div>
          ))}
      </section>

      <section className="dshwr-section">
        <span className="dshwr-head">Active Terminals</span>
        {state.sessions.length === 0
          ? <span className="dshwr-empty">No terminals open.</span>
          : state.sessions.map((session) => (
            <div className="dshwr-row" key={session.id} title={session.cwd}>
              <span className="dshwr-dot" style={{ background: session.accent }} />
              <span className="dshwr-row-name">{session.label}</span>
              <span className="dshwr-meta">{session.status}</span>
            </div>
          ))}
      </section>
    </div>
  )
}

function WorkbenchIcon(props) {
  const size = typeof props?.size === 'number' ? props.size : 20
  const active = props?.active === true
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
      <path d="M6.5 9.25 9 11.75l-2.5 2.5" />
      <path d="M12.5 14.5h5" />
    </svg>
  )
}

function WorkbenchPanel() {
  const [, forceRender] = React.useReducer((count) => count + 1, 0)
  const stageRef = React.useRef(null)
  const rootRef = React.useRef(null)
  const [custom, setCustom] = React.useState('')
  const [keysOpen, setKeysOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(null)
  const [keyErrors, setKeyErrors] = React.useState(null)

  React.useEffect(() => {
    const unsubscribe = subscribe(forceRender)
    ensureStyles()
    ensureHost()
    const stage = stageRef.current
    if (stage !== null && host.parentNode !== stage) stage.appendChild(host)
    ensureSocket()
    return () => {
      unsubscribe()
      const current = stageRef.current
      if (current !== null && host !== null && host.parentNode === current) {
        current.removeChild(host)
      }
    }
  }, [])

  // Keyboard navigation (V1.1).
  //
  // Registered with `capture: true` on the window, so it runs before xterm's
  // textarea listeners: a matched shortcut is preventDefault()ed (Chromium
  // never performs its own tab switch) and stopPropagation()ed (the keystroke
  // never reaches the PTY). Selecting a tab only toggles which xterm container
  // is displayed and refits/focuses it — no spawn, no attach, no socket write —
  // so a live Claude Code / Codex / PowerShell / OpenCode session is untouched.
  //
  // The listener lives exactly as long as this panel: DSH unmounts the inactive
  // main panel, so "while the Workbench is active" is the effect's own lifetime.
  // The runtime guard re-checks visibility and focus ownership per keystroke, so
  // a hidden/shadowed panel, and any text field outside the panel (DSH Chat's
  // composer), can never lose a keystroke to these bindings.
  React.useEffect(() => {
    const onKeyDown = createKeyHandler({
      getConfig: () => state.shortcuts,
      getSessions: () => state.sessions,
      getActiveId: () => state.activeId,
      setActive,
      isActiveContext: (event) => {
        const root = rootRef.current
        if (root === null || root.isConnected !== true) return false
        if (typeof root.getClientRects === 'function' && root.getClientRects().length === 0) return false
        return !isForeignEditable(event.target, root)
      },
      mac: IS_MAC,
    })
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  React.useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return undefined
    const observer = new ResizeObserver(() => fitActive())
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const customPreset = state.presets.find((preset) => preset.id === 'custom')
  const active = state.sessions.find((session) => session.id === state.activeId)

  return (
    <div className="dshw-root" ref={rootRef}>
      <div className="dshw-head">
        <span className="dshw-head-tile"><WorkbenchIcon size={18} /></span>
        <span className="dshw-head-text">
          <span className="dshw-head-title">Workbench</span>
          <span className="dshw-head-sub">Run your tools. One workspace, all terminals.</span>
        </span>
      </div>

      <div className="dshw-bar">
        <div className="dshw-group">
          <select
            className="dshw-select"
            value={state.activeProjectId ?? ''}
            onChange={(event) => {
              state.activeProjectId = event.target.value === '' ? null : event.target.value
              notify()
            }}
            title="Project that new terminals start in"
          >
            <option value="">{state.defaultCwd ?? 'default directory'}</option>
            {state.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} — {project.path}
              </option>
            ))}
          </select>
          <button className="dshw-btn" type="button" onClick={() => void pickProject()}>
            Add project…
          </button>
          {state.activeProjectId !== null && (
            <button
              className="dshw-btn"
              type="button"
              title="Unregister this project (does not touch the files)"
              onClick={() => {
                send({ t: 'removeProject', id: state.activeProjectId })
                state.activeProjectId = null
                notify()
              }}
            >
              Forget
            </button>
          )}
        </div>

        <div className="dshw-spacer" />

        <div className="dshw-group">
          {state.presets
            .filter((preset) => preset.id !== 'custom')
            .map((preset) => (
              <button
                key={preset.id}
                className="dshw-btn"
                type="button"
                disabled={!preset.available}
                title={preset.available ? preset.hint : `${preset.command} was not found on PATH`}
                onClick={() => spawnSession(preset.id)}
              >
                <span className="dshw-dot" style={{ background: preset.accent }} />
                {preset.label}
              </button>
            ))}
        </div>
      </div>

      <div className="dshw-bar">
        <input
          className="dshw-input"
          value={custom}
          placeholder={customPreset?.hint ?? 'Run any installed command…'}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && custom.trim() !== '') spawnSession('custom', custom.trim())
          }}
        />
        <button
          className="dshw-btn"
          type="button"
          disabled={custom.trim() === ''}
          onClick={() => spawnSession('custom', custom.trim())}
        >
          Run custom
        </button>
        <button
          className="dshw-btn"
          type="button"
          aria-expanded={keysOpen}
          title="Configure the Workbench keyboard shortcuts"
          onClick={() => {
            setKeyErrors(null)
            setDraft(keysOpen ? null : toForm(state.shortcuts))
            setKeysOpen(!keysOpen)
          }}
        >
          Keys…
        </button>
      </div>

      {keysOpen && (
        <div className="dshw-keys">
          {KEY_FIELDS.map((field) => (
            <label key={field.action}>
              <span>{field.label}</span>
              <input
                className="dshw-key"
                value={draft?.[field.action] ?? ''}
                placeholder={field.placeholder}
                spellCheck={false}
                data-invalid={keyErrors?.[field.action] !== undefined}
                title={keyErrors?.[field.action] ?? `${field.placeholder} — comma-separate alternatives`}
                onChange={(event) =>
                  setDraft({ ...draft, [field.action]: event.target.value })
                }
              />
            </label>
          ))}
          <button
            className="dshw-btn"
            type="button"
            onClick={() => {
              const parsed = parseForm(draft)
              if (!parsed.ok) {
                setKeyErrors(parsed.errors)
                return
              }
              state.shortcuts = normalizeConfig(parsed.config)
              saveConfig(undefined, state.shortcuts)
              setKeyErrors(null)
              setKeysOpen(false)
              setDraft(null)
              notify()
            }}
          >
            Save
          </button>
          <button
            className="dshw-btn"
            type="button"
            title="Restore the shipped defaults"
            onClick={() => {
              setDraft(toForm(DEFAULT_CONFIG))
              setKeyErrors(null)
            }}
          >
            Reset
          </button>
          <button
            className="dshw-btn"
            type="button"
            onClick={() => {
              setKeysOpen(false)
              setDraft(null)
              setKeyErrors(null)
            }}
          >
            Close
          </button>
          <div className="dshw-keys-hint">
            Mod = Ctrl on Windows/Linux, Cmd on macOS. Comma-separate alternatives. Chromium keeps
            Ctrl+Tab / Ctrl+Shift+Tab for its own tabs in a normal browser tab — those bindings only
            arrive when DSH runs as an app window (installed PWA / <code>--app</code>) or fullscreen;
            Alt+→ / Alt+← always arrive. Switching tabs never touches a running session; saved per
            browser profile.
            {keyErrors !== null && (
              <span className="dshw-keys-err"> Fix the highlighted binding to save.</span>
            )}
          </div>
        </div>
      )}

      <div className="dshw-tabs">
        {state.sessions.map((session, index) => {
          const shortcut = hintForIndex(index + 1, state.shortcuts, IS_MAC)
          return (
            <button
              key={session.id}
              type="button"
              className="dshw-tab"
              data-active={session.id === state.activeId}
              onClick={() => setActive(session.id)}
              title={`${session.presetId} · pid ${session.pid} · ${session.cwd}${
                shortcut === null ? '' : ` · ${shortcut}`
              }`}
            >
              {shortcut !== null && (
                <span className="dshw-badge" title={shortcut}>
                  {index + 1}
                </span>
              )}
              <span className="dshw-dot" style={{ background: session.accent }} />
              {session.label}
              {session.status !== 'running' && (
                <span style={{ opacity: 0.65 }}>
                  {session.exitCode === null ? 'stopped' : `exit ${session.exitCode}`}
                </span>
              )}
              <span
                className="dshw-tab-x"
                role="button"
                tabIndex={-1}
                title="Kill and close this terminal"
                onClick={(event) => {
                  event.stopPropagation()
                  send({ t: 'remove', id: session.id })
                }}
              >
                ×
              </span>
            </button>
          )
        })}
      </div>

      <div className="dshw-card">
        {active !== undefined && (
          <div className="dshw-termhead">
            <span className="dshw-dot" style={{ background: active.accent }} />
            <span>{active.label}</span>
            <span className="dshw-cwd" title={active.cwd}>{active.cwd}</span>
          </div>
        )}
        <div className="dshw-stage" ref={stageRef}>
          {state.sessions.length === 0 && (
            <div className="dshw-empty">
              <div>No terminals yet.</div>
              <div>
                Choose a project, then open PowerShell, Claude Code, Codex, OpenCode or Hermes —
                each runs as its own real CLI in that directory.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="dshw-status">
        <span>
          {state.status === 'open'
            ? 'connected'
            : state.status === 'connecting'
              ? 'connecting…'
              : 'disconnected — retrying'}
        </span>
        <span>{state.sessions.length} terminal(s)</span>
        {state.platform !== null && <span>{state.platform}</span>}
        <span title="dsh-workbench version">v{VERSION}</span>
        <span title={`Active shortcuts — ${summarize(state.shortcuts, IS_MAC)}`}>
          keys {summarize(state.shortcuts, IS_MAC).split(' · ')[0]}
        </span>
        {state.error !== null && <span className="dshw-err">{state.error}</span>}
      </div>
    </div>
  )
}

// ── plugin ────────────────────────────────────────────────────────────────

/**
 * Install one seat, reporting a failure instead of killing the fiber.
 *
 * `slots.inject` runs its callback synchronously when the slot is already
 * declared — which is always the case here — so a bad `register()` would
 * otherwise throw straight out of `apply()` and fail the whole plugin entry.
 * Surfacing it loudly is far more debuggable than a silent dead fiber.
 */
function installSeat(slots, slotKey, install) {
  try {
    slots.inject(slotKey, install)
  } catch (error) {
    console.error(`[dsh-workbench] could not register the ${slotKey} seat:`, error)
  }
}

/**
 * Register the workbench seats.
 * @param ctx - client plugin context.
 */
export function apply(ctx) {
  pluginCtx = ctx
  ensureStyles()

  const slots = ctx.get('slots')
  if (slots === undefined) {
    // Unreachable while `inject` is honoured; kept so a future composition
    // change reports itself rather than failing silently.
    console.error('[dsh-workbench] slots service unavailable; the Workbench panel cannot register')
    return
  }

  installSeat(slots, 'sidebar.panellist', () =>
    slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, label: 'Workbench', order: 40 },
      (props) => <WorkbenchIcon {...props} />,
    ),
  )

  installSeat(slots, 'main', () =>
    slots.register({ name: 'main', key: PANEL_ID }, () => <WorkbenchPanel />),
  )

  // Contextual rail: a read-only tab registered through the same public path
  // any other rail type uses. It carries only facts this plugin already owns,
  // so the rail learns nothing Workbench-specific and the DSH model gains no
  // handle to any terminal.
  ctx.inject(['sidebarRightTabs'], (scope) => {
    const tabs = scope.get('sidebarRightTabs')
    const railSlots = scope.get('slots')
    const disposeType = tabs.register({
      id: RAIL_TYPE_ID,
      kind: 'workbench-rail',
      title: () => 'Project Info',
      guide: [{
        order: 40,
        title: () => 'Project Info',
        description: () => 'Project, git state, recent files, and active terminals.',
      }],
    })
    const disposeBody = railSlots.inject('sidebar.right.pane.tab', () => railSlots.register(
      { name: 'sidebar.right.pane.tab', key: RAIL_TYPE_ID },
      () => <WorkbenchRail />,
    ))
    scope.effect(() => () => { disposeBody(); disposeType() })
  })

  console.info(
    `[dsh-workbench v${VERSION}] seats registered: sidebar.panellist + main[workbench] · keys ${summarize(
      state.shortcuts,
      IS_MAC,
    )}`,
  )

  ctx.effect(() => () => {
    closedByUs = true
    if (socket !== null) {
      try {
        socket.close()
      } catch {
        // Already closed.
      }
      socket = null
    }
    for (const id of [...records.keys()]) dropTerminal(id)
    removeStyles()
    pluginCtx = null
  })
}
