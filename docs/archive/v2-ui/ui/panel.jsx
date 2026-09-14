// Panel chrome for the V2 Workbench: header, project bar, terminal tabs and
// the terminal card itself.
//
// All four are presentational and props-driven; the module-scope session
// store, the socket and the xterm registry stay in `index.jsx`, which renders
// these. The terminal card owns exactly one DOM node that must be stable for
// the panel's whole life: the card body is the element `index.jsx` parents the
// persistent xterm host into, so re-rendering the card never remounts a
// terminal.

import * as React from 'react'

import { hintForIndex } from '../keymap.js'
import { Dot, Icon, MenuItem, Popover } from './primitives.jsx'

/**
 * Panel header: one compact label row.
 *
 * The approved wireframe asks for a section-label header rather than a hero
 * title, and puts the shortcut legend in the bottom bar — so this row carries
 * only identity, the keys affordance and the version, leaving every spare pixel
 * to the terminal.
 */
export function PanelHeader({ subtitle, keysOpen, onToggleKeys, version }) {
  return (
    <div className="dshw-head">
      <span className="dshw-label">Workbench</span>
      <span className="dshw-sub">{subtitle}</span>
      <span className="dshw-spacer" />
      <button
        type="button"
        className="dshw-btn"
        aria-expanded={keysOpen}
        title="Configure the Workbench keyboard shortcuts"
        onClick={onToggleKeys}
      >
        Keys…
      </button>
      <span className="dshw-path" title={`dsh-workbench v${version}`}>
        v{version}
      </span>
    </div>
  )
}

/**
 * Project toolbar: the active project, its absolute path, and registration.
 *
 * Spawning moved to the tab strip's `+` menu (the reference puts presets where
 * terminals are created), which is what lets one toolbar row serve the whole
 * panel and keeps the terminal dominant.
 */
export function ProjectBar({
  projects,
  activeProjectId,
  defaultCwd,
  onSelectProject,
  onAddProject,
  onForgetProject,
}) {
  const active = projects.find((project) => project.id === activeProjectId)
  return (
    <div className="dshw-bar">
      <div className="dshw-group">
        <span className="dshw-sub">Project</span>
        <select
          className="dshw-select"
          value={activeProjectId ?? ''}
          title="Project that new terminals start in"
          onChange={(event) => onSelectProject(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">{defaultCwd ?? 'default directory'}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} — {project.path}
            </option>
          ))}
        </select>
        <button type="button" className="dshw-btn" onClick={onAddProject} title="Register a project directory">
          <Icon name="plus" size={13} />
          Add Project
        </button>
        {activeProjectId !== null && (
          <button
            type="button"
            className="dshw-btn"
            title="Unregister this project (does not touch the files)"
            onClick={onForgetProject}
          >
            Forget
          </button>
        )}
      </div>
      <span className="dshw-spacer" />
      <span className="dshw-path" title={active?.path ?? defaultCwd ?? ''}>
        {active?.path ?? defaultCwd ?? ''}
      </span>
    </div>
  )
}

/**
 * Terminal tab strip: numbered tabs in host order, plus the create menu.
 *
 * Numbers are the V1.1 slot badges, so `Ctrl+1…8` is discoverable without
 * opening the keys editor; the tooltip carries the resolved binding.
 */
export function SessionTabs({
  sessions,
  activeId,
  shortcuts,
  isMac,
  presets,
  customPreset,
  onSelect,
  onClose,
  onSpawn,
  onSpawnCustom,
}) {
  const [custom, setCustom] = React.useState('')
  const runCustom = (close) => {
    const text = custom.trim()
    if (text === '') return
    onSpawnCustom(text)
    setCustom('')
    close()
  }

  return (
    <div className="dshw-tabs">
      {sessions.map((session, index) => {
        const shortcut = hintForIndex(index + 1, shortcuts, isMac)
        return (
          <button
            key={session.id}
            type="button"
            className="dshw-tab"
            data-active={session.id === activeId}
            onClick={() => onSelect(session.id)}
            title={`${session.presetId} · pid ${session.pid} · ${session.cwd}${
              shortcut === null ? '' : ` · ${shortcut}`
            }`}
          >
            {shortcut !== null && <span className="dshw-badge">{index + 1}</span>}
            <Dot color={session.accent} />
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
                onClose(session.id)
              }}
            >
              ×
            </span>
          </button>
        )
      })}

      <Popover label={<Icon name="plus" size={14} />} title="New terminal" align="left">
        {(close) => (
          <>
            <div className="dshw-menu-note">New terminal in {customPreset?.cwdLabel ?? 'the selected project'}</div>
            {presets.map((preset) => (
              <MenuItem
                key={preset.id}
                disabled={!preset.available}
                onClick={() => {
                  onSpawn(preset.id)
                  close()
                }}
              >
                <Dot color={preset.accent} />
                {preset.label}
                {!preset.available && <span className="dshw-rp-meta">not found</span>}
              </MenuItem>
            ))}
            <div className="dshw-menu-sep" />
            <div className="dshw-menu-form">
              <input
                className="dshw-input"
                value={custom}
                placeholder="Run any command…"
                onChange={(event) => setCustom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') runCustom(close)
                }}
              />
              <button
                type="button"
                className="dshw-btn"
                disabled={custom.trim() === ''}
                onClick={() => runCustom(close)}
              >
                Run
              </button>
            </div>
          </>
        )}
      </Popover>
    </div>
  )
}

/**
 * The terminal card — the surface that owns the panel.
 *
 * `stageRef` must land on the body element: `index.jsx` appends the persistent
 * module-scope xterm host into it and observes it for refits. `openHere`
 * spawns another terminal in this session's directory (a PTY cannot be
 * chdir'd), which is the honest reading of the reference's cwd control.
 */
export function TerminalCard({ stageRef, session, onClear, onCopy, onKill, onCopyPath, onOpenHere, children }) {
  const running = session?.status === 'running'
  return (
    <div className="dshw-card">
      <div className="dshw-card-head">
        {session !== null && session !== undefined && (
          <>
            <Dot color={session.accent} />
            <span className="dshw-card-title">{session.label}</span>
            <Popover
              className="dshw-chip"
              title="Working directory"
              label={
                <>
                  <Icon name="folder" size={13} />
                  <span className="dshw-path" style={{ maxWidth: '30ch' }}>
                    {session.cwd}
                  </span>
                  <Icon name="chevron" size={12} />
                </>
              }
            >
              {(close) => (
                <>
                  <MenuItem
                    onClick={() => {
                      onCopyPath(session.cwd)
                      close()
                    }}
                  >
                    <Icon name="copy" size={13} />
                    Copy path
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      onOpenHere(session)
                      close()
                    }}
                  >
                    <Icon name="plus" size={13} />
                    New terminal here
                  </MenuItem>
                </>
              )}
            </Popover>
            <span className="dshw-spacer" />
            <button
              type="button"
              className="dshw-btn"
              title="Clear the visible scrollback (the session keeps running)"
              onClick={onClear}
            >
              Clear
            </button>
            <button type="button" className="dshw-icon-btn" title="Copy selection or buffer" onClick={onCopy}>
              <Icon name="copy" size={14} />
            </button>
            <Popover label={<span style={{ fontWeight: 700 }}>…</span>} title="Terminal actions">
              {(close) => (
                <MenuItem
                  danger
                  disabled={!running}
                  onClick={() => {
                    onKill(session.id)
                    close()
                  }}
                >
                  <Icon name="trash" size={13} />
                  Kill terminal
                </MenuItem>
              )}
            </Popover>
          </>
        )}
      </div>
      <div className="dshw-card-body" ref={stageRef}>
        {children}
      </div>
    </div>
  )
}

/** Bottom bar: transport state, terminal population, platform, errors. */
export function StatusLine({ connected, status, count, platform, error }) {
  return (
    <div className="dshw-status">
      <span className={connected ? 'dshw-ok' : undefined}>●</span>
      <span>
        {status === 'open' ? 'connected' : status === 'connecting' ? 'connecting…' : 'disconnected — retrying'}
      </span>
      <span>{count} terminal(s)</span>
      {platform !== null && <span>{platform}</span>}
      {error !== null && <span className="dshw-err">{error}</span>}
    </div>
  )
}
