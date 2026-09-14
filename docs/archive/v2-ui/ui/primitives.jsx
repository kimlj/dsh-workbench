// Small, local UI primitives for the Workbench redesign.
//
// Why local and not `@deepseek-ai/dsh-client-ui-primitives`: that package is a
// shell-bundled baseline external with **no installable directory and no
// `.d.ts`** in this deployment, and — measured — it exports no card, no tab
// strip, no layout or typography helper and no popover. Everything the
// redesign needs from it (a popover, a section header, a card, a row, a dot)
// is a few lines here, against the same `--dsw-*` tokens, with zero new
// external dependency and no untypecheckable import surface.

import * as React from 'react'

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  chevron: 'M6 9l6 6 6-6',
  copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM5 15V5a1 1 0 0 1 1-1h9',
  trash: 'M4 7h16M9 7V5h6v2M6.5 7l.9 12.1h9.2L17.5 7',
  close: 'M6 6l12 12M18 6L6 18',
  terminal: 'M3 5h18v14H3zM7 9.5 9.5 12 7 14.5M12.5 14.5h4.5',
  folder: 'M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  key: 'M14 7a4 4 0 1 0-3.5 3.97L9 12.5l-1.5-.5L6 13.5 5.5 16 8 17l1.5-1.5L9 14l1.5-1.5',
}

/**
 * One stroked glyph.
 * @param props - `name`, optional `size`.
 * @returns the svg element.
 */
export function Icon({ name, size = 14 }) {
  const path = ICONS[name] ?? ICONS.terminal
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  )
}

/** A row inside a popover; closes the popover after the handler runs. */
export function MenuItem({ children, onClick, disabled = false, danger = false }) {
  return (
    <button
      type="button"
      className="dshw-menu-item"
      data-danger={danger}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/**
 * A trigger plus an anchored menu.
 *
 * Minimal by design: outside-pointer dismissal on the capture phase (so it
 * wins over the trigger's own click), Escape to close, and a render-prop child
 * that receives `close` so a submenu form can decide when to dismiss itself.
 *
 * @param props - `label`, optional `title`, `className`, `align: 'left'|'right'`, `disabled`, and a `children(close)` function.
 * @returns the trigger and, while open, the menu.
 */
export function Popover({ label, title, className = 'dshw-icon-btn', align = 'right', disabled = false, children }) {
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef(null)

  React.useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      const wrap = wrapRef.current
      if (wrap !== null && !wrap.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <span className="dshw-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={className}
        title={title}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      {open && (
        <span className={`dshw-menu${align === 'left' ? ' dshw-menu-left' : ''}`} role="menu">
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </span>
      )}
    </span>
  )
}

/** A status dot; `color` is a preset accent supplied by the host catalogue. */
export function Dot({ color }) {
  return <span className="dshw-dot" style={{ background: color ?? 'currentColor' }} />
}

/**
 * Short elapsed time for an Active Terminals row.
 * @param startedAt - epoch milliseconds from the host session summary.
 * @param now - injectable clock, for tests.
 * @returns e.g. `now`, `12m`, `1h 05m`, `2d`.
 */
export function elapsed(startedAt, now = Date.now()) {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return ''
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d`
}

/** A titled group of rows in the right column. */
export function Section({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="dshw-rp-section">{title}</div>
      {children}
    </div>
  )
}

/** A key/value line inside a right-column card. */
export function KeyValue({ label, children }) {
  return (
    <div className="dshw-rp-kv">
      <span>{label}</span>
      <span className="dshw-rp-name">{children}</span>
    </div>
  )
}
