import * as React from 'react'

const HEIGHT_KEY = 'dsh-workbench.utility.height.v1'
const COLLAPSED_KEY = 'dsh-workbench.utility.collapsed.v1'
const TAB_KEY = 'dsh-workbench.utility.tab.v1'
const DEFAULT_HEIGHT = 244
const MIN_HEIGHT = 150
const MAX_HEIGHT = 540
const TABS = ['files', 'activity', 'problems', 'output']

function storageNumber(key, fallback) {
  try {
    const stored = localStorage.getItem(key)
    if (stored === null) return fallback
    const parsed = Number(stored)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function storageBoolean(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

function storageTab() {
  try {
    const value = localStorage.getItem(TAB_KEY)
    return TABS.includes(value) ? value : 'files'
  } catch {
    return 'files'
  }
}

function remember(key, value) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Browser storage may be unavailable; the live interaction still works.
  }
}

function Icon({ name }) {
  const paths = {
    chevron: 'M5 7.5 10 12.5l5-5',
    close: 'M5 5l10 10M15 5 5 15',
    collapse: 'M4 8l6 6 6-6',
    expand: 'M7 3H3v4M13 3h4v4M7 17H3v-4M13 17h4v-4',
    restore: 'M7 5H4.5A1.5 1.5 0 0 0 3 6.5v9A1.5 1.5 0 0 0 4.5 17h9A1.5 1.5 0 0 0 15 15.5V13M7 3h10v10H7z',
    save: 'M4 3.5h10l2.5 2.5v10.5H3.5v-13zM7 3.5v4h6v-4M7 16v-5h6v5',
    folder: 'M3 7A1.5 1.5 0 0 1 4.5 5.5h3.2l1.7 1.7h6.1A1.5 1.5 0 0 1 17 8.7v6.8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5z',
    file: 'M6 3h5l4 4v10H6zM11 3v4h4',
  }
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

function EmptyState({ title, detail }) {
  return (
    <div className="dshw-util-empty">
      <span>{title}</span>
      {detail === undefined ? null : <small>{detail}</small>}
    </div>
  )
}

function DirectoryRows({ path, depth, directories, toggleDirectory, openFile }) {
  const directory = directories[path]
  if (directory?.loading) {
    return <div className="dshw-tree-note" style={{ paddingLeft: 10 + depth * 14 }}>Loading…</div>
  }
  if (directory?.error !== undefined) {
    return <div className="dshw-tree-note dshw-tree-error" style={{ paddingLeft: 10 + depth * 14 }}>{directory.error}</div>
  }
  return (directory?.entries ?? []).map(entry => (
    <React.Fragment key={entry.path}>
      <button
        type="button"
        className="dshw-tree-row"
        style={{ paddingLeft: 8 + depth * 14 }}
        title={entry.path}
        onClick={() => { if (entry.dir) toggleDirectory(entry.path); else openFile(entry.path) }}
      >
        <span className="dshw-tree-chevron" data-open={(entry.dir && directories[entry.path]?.open) || undefined}>
          {entry.dir ? <Icon name="chevron" /> : null}
        </span>
        <Icon name={entry.dir ? 'folder' : 'file'} />
        <span>{entry.name}</span>
      </button>
      {entry.dir && directories[entry.path]?.open ? (
        <DirectoryRows
          path={entry.path}
          depth={depth + 1}
          directories={directories}
          toggleDirectory={toggleDirectory}
          openFile={openFile}
        />
      ) : null}
    </React.Fragment>
  ))
}

function FilesWorkspace({ projectId, connectionState, listFiles, readFile, writeFile, maximized, setMaximized }) {
  const [directories, setDirectories] = React.useState({})
  const [tabs, setTabs] = React.useState([])
  const [activePath, setActivePath] = React.useState(null)

  const loadDirectory = React.useCallback((path, open = true) => {
    setDirectories(current => ({
      ...current,
      [path]: { ...(current[path] ?? {}), open, loading: true, error: undefined },
    }))
    listFiles(projectId, path).then(
      result => setDirectories(current => ({
        ...current,
        [path]: { open, loading: false, entries: result.entries, truncated: result.truncated },
      })),
      error => setDirectories(current => ({
        ...current,
        [path]: { open, loading: false, entries: [], error: String(error?.message ?? error) },
      })),
    )
  }, [listFiles, projectId])

  React.useEffect(() => {
    setDirectories({})
    setTabs([])
    setActivePath(null)
    setMaximized(false)
    loadDirectory('')
  }, [projectId, connectionState, loadDirectory, setMaximized])

  const toggleDirectory = React.useCallback((path) => {
    const current = directories[path]
    if (current?.entries !== undefined) {
      setDirectories(all => ({ ...all, [path]: { ...all[path], open: !all[path].open } }))
    } else {
      loadDirectory(path)
    }
  }, [directories, loadDirectory])

  const openFile = React.useCallback((path) => {
    if (tabs.some(tab => tab.path === path)) {
      setActivePath(path)
      return
    }
    setActivePath(path)
    setTabs(current => [...current, { path, content: '', savedContent: '', version: null, loading: true, error: null, saving: false }])
    readFile(projectId, path).then(
      result => setTabs(current => current.map(tab => tab.path === path
        ? { ...tab, content: result.content, savedContent: result.content, version: result.version, loading: false, error: null }
        : tab)),
      error => setTabs(current => current.map(tab => tab.path === path
        ? { ...tab, loading: false, error: String(error?.message ?? error) }
        : tab)),
    )
  }, [projectId, readFile, tabs])

  const active = tabs.find(tab => tab.path === activePath)
  const closeTab = (path) => {
    const closing = tabs.find(tab => tab.path === path)
    if (closing !== undefined && closing.content !== closing.savedContent
      && !window.confirm(`Discard unsaved changes to ${path}?`)) return
    const index = tabs.findIndex(tab => tab.path === path)
    const next = tabs.filter(tab => tab.path !== path)
    setTabs(next)
    if (activePath === path) setActivePath(next[Math.min(index, next.length - 1)]?.path ?? null)
    if (next.length === 0) setMaximized(false)
  }

  const saveActive = () => {
    if (active === undefined || active.loading || active.saving || active.version === null
      || active.content === active.savedContent) return
    const savedContent = active.content
    setTabs(current => current.map(tab => tab.path === active.path ? { ...tab, saving: true, error: null } : tab))
    writeFile(projectId, active.path, savedContent, active.version).then(
      result => setTabs(current => current.map(tab => tab.path === active.path
        ? { ...tab, saving: false, savedContent, version: result.version, error: null }
        : tab)),
      error => setTabs(current => current.map(tab => tab.path === active.path
        ? { ...tab, saving: false, error: String(error?.message ?? error) }
        : tab)),
    )
  }

  return (
    <div className="dshw-files">
      <aside className="dshw-tree" aria-label="Project files">
        <div className="dshw-tree-title">PROJECT TREE</div>
        <div className="dshw-tree-scroll">
          <DirectoryRows path="" depth={0} directories={directories} toggleDirectory={toggleDirectory} openFile={openFile} />
          {directories['']?.truncated ? <div className="dshw-tree-note">Directory truncated.</div> : null}
        </div>
      </aside>
      <section className="dshw-editor">
        <div className="dshw-editor-tabs" role="tablist">
          <div className="dshw-editor-tabscroll">
            {tabs.map(tab => (
              <button
                key={tab.path}
                type="button"
                role="tab"
                aria-selected={tab.path === activePath}
                className="dshw-editor-tab"
                data-active={tab.path === activePath}
                title={tab.path}
                onClick={() => setActivePath(tab.path)}
              >
                <span className="dshw-editor-dirty" data-dirty={tab.content !== tab.savedContent || undefined} />
                <span>{tab.path.split('/').pop()}</span>
                <span
                  className="dshw-editor-close"
                  role="button"
                  tabIndex={-1}
                  aria-label={`Close ${tab.path}`}
                  onClick={(event) => { event.stopPropagation(); closeTab(tab.path) }}
                >×</span>
              </button>
            ))}
          </div>
          <button className="dshw-util-icon" type="button" disabled={active === undefined || active.content === active.savedContent || active.saving} aria-label="Save file" title="Save file" onClick={saveActive}>
            <Icon name="save" />
          </button>
          <button className="dshw-util-icon" type="button" disabled={active === undefined} aria-label={maximized ? 'Restore editor' : 'Maximize editor'} title={maximized ? 'Restore editor' : 'Maximize editor'} onClick={() => setMaximized(value => !value)}>
            <Icon name={maximized ? 'restore' : 'expand'} />
          </button>
        </div>
        {active === undefined
          ? <EmptyState title="Open a file from the project tree." />
          : active.loading
            ? <EmptyState title="Loading file…" />
            : active.error !== null && active.version === null
              ? <EmptyState title="File unavailable" detail={active.error} />
              : (
                <div className="dshw-editor-body">
                  <textarea
                    value={active.content}
                    spellCheck={false}
                    aria-label={`Edit ${active.path}`}
                    onChange={event => setTabs(current => current.map(tab => tab.path === active.path
                      ? { ...tab, content: event.target.value, error: null }
                      : tab))}
                    onKeyDown={event => {
                      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                        event.preventDefault()
                        saveActive()
                      }
                    }}
                  />
                  <div className="dshw-editor-status">
                    <span title={active.path}>{active.path}</span>
                    <span title={active.error ?? undefined}>{active.error !== null ? active.error : active.saving ? 'Saving…' : active.content !== active.savedContent ? 'Modified' : 'Saved'}</span>
                  </div>
                </div>
              )}
      </section>
    </div>
  )
}

/** Reusable resizable Workbench utility panel. */
export function UtilityPanel({ projectId, connectionState, listFiles, readFile, writeFile }) {
  const [tab, setTab] = React.useState(storageTab)
  const [height, setHeight] = React.useState(() => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, storageNumber(HEIGHT_KEY, DEFAULT_HEIGHT))))
  const [collapsed, setCollapsed] = React.useState(() => storageBoolean(COLLAPSED_KEY, false))
  const [maximized, setMaximized] = React.useState(false)
  const drag = React.useRef(null)

  const selectTab = value => {
    setTab(value)
    setCollapsed(false)
    remember(TAB_KEY, value)
    remember(COLLAPSED_KEY, false)
  }

  return (
    <section
      className="dshw-utility"
      data-collapsed={collapsed || undefined}
      data-maximized={maximized || undefined}
      style={collapsed || maximized ? undefined : { height }}
    >
      {!collapsed && !maximized ? (
        <div
          className="dshw-util-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize utility panel"
          onPointerDown={event => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { y: event.clientY, height, last: height }
          }}
          onPointerMove={event => {
            if (drag.current === null) return
            const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, drag.current.height + drag.current.y - event.clientY))
            drag.current.last = next
            setHeight(next)
          }}
          onPointerUp={event => {
            if (drag.current === null) return
            const finalHeight = drag.current.last
            drag.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
            remember(HEIGHT_KEY, finalHeight)
          }}
          onPointerCancel={() => { drag.current = null }}
        />
      ) : null}
      <div className="dshw-util-tabs" role="tablist">
        {TABS.map(value => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className="dshw-util-tab" data-active={tab === value} onClick={() => selectTab(value)}>
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
        <span className="dshw-spacer" />
        <button
          className="dshw-util-icon"
          type="button"
          data-collapsed={collapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand utility panel' : 'Collapse utility panel'}
          title={collapsed ? 'Expand utility panel' : 'Collapse utility panel'}
          onClick={() => {
            const next = !collapsed
            setCollapsed(next)
            if (next) setMaximized(false)
            remember(COLLAPSED_KEY, next)
          }}
        >
          <Icon name="collapse" />
        </button>
      </div>
      {collapsed ? null : (
        <div className="dshw-util-content">
          {tab === 'files' ? (
            <FilesWorkspace
              projectId={projectId}
              connectionState={connectionState}
              listFiles={listFiles}
              readFile={readFile}
              writeFile={writeFile}
              maximized={maximized}
              setMaximized={setMaximized}
            />
          ) : tab === 'activity'
            ? <EmptyState title="No recorded activity." detail="This panel will show deterministic project and process events when a reliable event source is available." />
            : tab === 'problems'
              ? <EmptyState title="No diagnostics." detail="Typecheck, lint, test, and build diagnostics appear only when a real diagnostic source is connected." />
              : <EmptyState title="No task output." detail="Build and test output appears only when a deterministic task source is connected." />}
        </div>
      )}
    </section>
  )
}

export const UTILITY_PANEL_CSS = `
.dshw-utility{position:relative;display:flex;flex:none;flex-direction:column;min-height:0;margin:8px 12px 10px;border-top:.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));background:var(--dsw-cockpit-bg-base,var(--dsw-alias-bg-base))}
.dshw-utility[data-collapsed]{height:37px!important;margin-bottom:8px}
.dshw-utility[data-maximized]{position:absolute;inset:0;z-index:20;margin:0;background:var(--dsw-cockpit-bg-base,var(--dsw-alias-bg-base))}
.dshw-util-resize{position:absolute;top:-4px;right:0;left:0;height:8px;z-index:2;cursor:row-resize;touch-action:none}
.dshw-util-resize::after{content:"";position:absolute;top:3px;left:50%;width:34px;height:2px;border-radius:2px;background:transparent;transform:translateX(-50%)}
.dshw-util-resize:hover::after{background:var(--dsw-cockpit-border-strong,var(--dsw-alias-border-l3))}
.dshw-util-tabs{display:flex;align-items:center;gap:2px;flex:none;height:36px;border-bottom:.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1))}
.dshw-util-tab{position:relative;height:36px;padding:0 10px;border:0;background:transparent;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font:inherit;font-size:12px;cursor:pointer}
.dshw-util-tab:hover,.dshw-util-tab[data-active="true"]{color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-util-tab[data-active="true"]::after{content:"";position:absolute;right:8px;bottom:-.5px;left:8px;height:2px;background:var(--dsw-cockpit-accent-primary,#3b82f6)}
.dshw-util-icon{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));cursor:pointer}
.dshw-util-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-util-icon:disabled{opacity:.3;cursor:default}
.dshw-util-tabs>.dshw-util-icon{margin-right:2px}
.dshw-util-tabs>.dshw-util-icon svg{transition:transform 120ms ease}
.dshw-util-tabs>.dshw-util-icon[data-collapsed="true"] svg{transform:rotate(180deg)}
.dshw-util-content{display:flex;flex:1;min-height:0}
.dshw-util-empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:18px;text-align:center;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));font-size:12.5px}
.dshw-util-empty small{max-width:480px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));line-height:17px}
.dshw-files{display:grid;grid-template-columns:minmax(160px,220px) minmax(0,1fr);flex:1;min-width:0;min-height:0}
.dshw-tree{display:flex;flex-direction:column;min-width:0;min-height:0;border-right:.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1))}
.dshw-tree-title{display:flex;align-items:center;flex:none;height:31px;padding:0 10px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font-size:10px;font-weight:600;letter-spacing:.08em}
.dshw-tree-scroll{flex:1;min-height:0;overflow:auto;padding-bottom:6px}
.dshw-tree-row{display:flex;align-items:center;gap:5px;width:100%;height:25px;padding-right:7px;border:0;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));font:inherit;font-size:12px;text-align:left;cursor:pointer;white-space:nowrap}
.dshw-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-tree-row>span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dshw-tree-chevron{display:grid;place-items:center;flex:none;width:12px;height:16px}
.dshw-tree-chevron svg{width:12px;height:12px;transform:rotate(-90deg);transition:transform 100ms ease}
.dshw-tree-chevron[data-open="true"] svg{transform:rotate(0deg)}
.dshw-tree-note{padding:5px 10px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font-size:11px;line-height:15px}
.dshw-tree-error{color:var(--dsw-alias-state-error-primary)}
.dshw-editor{display:flex;flex-direction:column;min-width:0;min-height:0}
.dshw-editor-tabs{display:flex;align-items:center;flex:none;height:31px;border-bottom:.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1))}
.dshw-editor-tabscroll{display:flex;flex:1;min-width:0;height:100%;overflow-x:auto;scrollbar-width:none}
.dshw-editor-tabscroll::-webkit-scrollbar{display:none}
.dshw-editor-tab{display:flex;align-items:center;gap:6px;flex:none;max-width:180px;height:31px;padding:0 6px 0 9px;border:0;border-right:.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));background:transparent;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font:inherit;font-size:11.5px;cursor:pointer}
.dshw-editor-tab>span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshw-editor-tab[data-active="true"]{background:var(--dsw-cockpit-bg-base,var(--dsw-alias-bg-base));color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-editor-dirty{width:6px;height:6px;border-radius:50%;background:transparent}
.dshw-editor-dirty[data-dirty="true"]{background:var(--dsw-cockpit-warning,var(--dsw-alias-state-warn-primary))}
.dshw-editor-close{display:grid;place-items:center;width:16px;height:16px;border-radius:4px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font-size:14px}
.dshw-editor-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-editor-body{display:flex;flex:1;flex-direction:column;min-height:0}
.dshw-editor-body textarea{box-sizing:border-box;flex:1;min-width:0;min-height:0;padding:10px 12px;border:0;outline:0;resize:none;background:var(--dsw-cockpit-bg-base,var(--dsw-alias-bg-base));color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary));font:12px/18px var(--ds-font-family-code,"Cascadia Mono",Consolas,monospace);tab-size:2;white-space:pre}
.dshw-editor-status{display:flex;justify-content:space-between;gap:12px;flex:none;height:23px;padding:0 9px;border-top:.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font-size:10.5px;line-height:23px}
.dshw-editor-status span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`
