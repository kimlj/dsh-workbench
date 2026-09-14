// The Workbench tab for the right column.
//
// Registered as an ordinary extension tab type through `ctx.sidebarRightTabs`
// and the keyed `sidebar.right.pane.tab` / `.title` seats — the same two-stage
// path the shipped `sidebar-files` and `sidebar-documentpreview` packages use.
// Phase 1 shows **client-side data only** (what the browser already holds):
// the active project, transport state, and the running terminals with elapsed
// time. The wireframe's RECENT FILES and QUICK ACTIONS cards need host-side
// capabilities (filesystem reads and app launching) and are deliberately
// deferred to Phase 2; the SHORTCUTS card stands in that slot for now.
//
// Clicking a terminal focuses it and brings the Workbench panel to the centre
// via the documented `ctx.layout.selectPanel`, so the right column is a real
// navigation surface rather than a static list.

import * as React from 'react'

import { Dot, KeyValue, Section, elapsed } from '../ui/primitives.jsx'

/** The tab type's implementation identity, and the key both body seats use. */
export const WORKBENCH_TAB_ID = 'dsh-workbench'

/** The tab kind `ctx.sidebarRight.openTab()` names. */
export const WORKBENCH_TAB_KIND = 'workbench.workbench'

/**
 * Stage one: what the `workbench` tab type IS. A page, not a viewer — it
 * claims no resource address and is opened by kind.
 * @returns the definition to register.
 */
export function workbenchTabDefinition() {
  return {
    id: WORKBENCH_TAB_ID,
    kind: WORKBENCH_TAB_KIND,
    title: () => 'Workbench',
    guide: [
      {
        order: 40,
        title: () => 'Workbench',
        description: () => 'Terminals, project and shortcuts',
      },
    ],
  }
}

/** Stage two, title seat: the chip text. */
export function createWorkbenchTabTitle() {
  return function WorkbenchTabTitle() {
    return <span>Workbench</span>
  }
}

/**
 * Stage two, body seat.
 * @param deps - the store facade the body may use, injected by `index.jsx`;
 *   this module never imports the store, so there is no cycle and no second
 *   copy of the session state.
 * @returns the tab body component.
 */
export function createWorkbenchTabBody({ state, subscribe, setActive, focusPanel, isMac, getShortcuts }) {
  return function WorkbenchTabBody() {
    const [, forceRender] = React.useReducer((count) => count + 1, 0)

    React.useEffect(() => subscribe(forceRender), [])

    const project = state.projects.find((entry) => entry.id === state.activeProjectId) ?? null
    const sessions = state.sessions
    const running = sessions.filter((session) => session.status === 'running').length

    return (
      <div className="dshw-rp">
        <Section title="Project">
          <div className="dshw-rp-card">
            <KeyValue label="Project">{project === null ? 'none selected' : project.name}</KeyValue>
            <div className="dshw-rp-kv">
              <span>Path</span>
              <span className="dshw-path" title={project?.path ?? state.defaultCwd ?? ''}>
                {project?.path ?? state.defaultCwd ?? '—'}
              </span>
            </div>
            <KeyValue label="Transport">
              <span className={state.status === 'open' ? 'dshw-ok' : 'dshw-err'}>
                {state.status === 'open' ? 'connected' : state.status === 'connecting' ? 'connecting…' : 'offline'}
              </span>
            </KeyValue>
            {running !== sessions.length && (
              <KeyValue label="Exited">{sessions.length - running}</KeyValue>
            )}
          </div>
        </Section>

        <Section title={`Terminals (${sessions.length})`}>
          {sessions.length === 0 ? (
            <div className="dshw-rp-card">
              <span className="dshw-rp-empty">No terminals open. Use + in the tab strip.</span>
            </div>
          ) : (
            <div className="dshw-rp-card" style={{ gap: 2, padding: 6 }}>
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="dshw-rp-row"
                  data-active={session.id === state.activeId}
                  title={`${session.presetId} · pid ${session.pid} · ${session.cwd}`}
                  onClick={() => {
                    setActive(session.id)
                    if (typeof focusPanel === 'function') focusPanel()
                  }}
                >
                  <Dot color={session.accent} />
                  <span className="dshw-rp-name">{session.label}</span>
                  <span className="dshw-rp-meta">
                    {session.status === 'running'
                      ? elapsed(session.startedAt)
                      : session.exitCode === null
                        ? 'stopped'
                        : `exit ${session.exitCode}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Shortcuts">
          <div className="dshw-rp-card">
            <span className="dshw-mono" style={{ fontSize: 11 }}>
              {typeof getShortcuts === 'function' ? getShortcuts() : ''}
            </span>
            <span className="dshw-rp-empty" style={{ padding: 0 }}>
              {isMac ? 'Mod = Cmd on macOS' : 'Mod = Ctrl on Windows/Linux'}. Editing lives in Keys… in the
              panel header.
            </span>
          </div>
        </Section>
      </div>
    )
  }
}
