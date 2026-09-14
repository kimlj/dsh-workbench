// dsh-workbench keyboard navigation: binding grammar, matching, target
// resolution, and persistence.
//
// Pure by construction — no DOM, no React, no module-scope mutable state. The
// browser half injects everything this module is allowed to touch (config
// source, session list, setActive), so the complete decision path runs under
// `node --test` with synthetic events. `createKeyHandler` in particular is
// deliberately narrow: it can select a tab and nothing else. It has no socket
// and no spawn, so a keyboard shortcut structurally cannot restart a PTY.
//
// ── Binding grammar ───────────────────────────────────────────────────────
//   Mod+<1-8>        digits 1–8, where Mod is Ctrl (Windows/Linux) or Cmd (macOS)
//   Mod+9            the single digit 9
//   Ctrl+Tab         a named key
//   Alt+ArrowRight   arrows via ArrowLeft/Right/Up/Down or the short aliases
//   Ctrl+Shift+Tab   modifiers are matched exactly (no extra, none missing)
//   F5, PageUp       function and navigation keys are accepted
//
// `<1-8>` is a digit *range*, so nine terminal slots are one configurable rule
// instead of nine hardcoded ones. Modifiers are matched exactly, which is what
// keeps next (Ctrl+Tab) and previous (Ctrl+Shift+Tab) from colliding.

/** Actions a binding can resolve to, in match-priority order. */
export const ACTIONS = ['select', 'last', 'next', 'prev']

/**
 * Shipped defaults, chosen against Chromium's reserved-shortcut list rather
 * than by taste (see README, "Keyboard navigation"):
 *
 *   select/last — Ctrl+1..9 are NOT reserved: Chromium offers them to the
 *     focused page first, so preventDefault() keeps the browser from switching
 *     its own tabs.
 *   next/prev   — Ctrl+Tab and Ctrl+Shift+Tab ARE reserved, so they never reach
 *     a normal tab (they do reach an app window/PWA or a fullscreen page).
 *     Alt+ArrowRight/Left are not reserved and always arrive, so they are the
 *     binding that works in every Chromium context.
 */
export const DEFAULT_CONFIG = Object.freeze({
  select: ['Mod+<1-8>'],
  last: ['Mod+9'],
  next: ['Ctrl+Tab', 'Alt+ArrowRight'],
  prev: ['Ctrl+Shift+Tab', 'Alt+ArrowLeft'],
})

/** localStorage key holding the user's mapping. */
export const CONFIG_KEY = 'dsh-workbench.shortcuts.v1'

const MODIFIER_ALIASES = {
  ctrl: 'ctrl',
  control: 'ctrl',
  mod: 'mod',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  super: 'meta',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
}

const KEY_ALIASES = {
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  space: 'Space',
  spacebar: 'Space',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  home: 'Home',
  end: 'End',
  insert: 'Insert',
  delete: 'Delete',
  del: 'Delete',
  backspace: 'Backspace',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
}

/** Compact rendering for named keys, used in labels and the status hint. */
const SHORT_KEYS = {
  ArrowRight: '→',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Escape: 'Esc',
  Space: 'Space',
}

/**
 * Whether this browser is macOS-family, where `Mod` means Command.
 * @param nav - navigator-like object; defaults to the global one when present.
 * @returns true on macOS/iOS.
 */
export function isMacPlatform(nav) {
  const source = nav ?? (typeof navigator === 'undefined' ? null : navigator)
  if (source === null || source === undefined) return false
  const platform = typeof source.platform === 'string' ? source.platform : ''
  const agent = typeof source.userAgent === 'string' ? source.userAgent : ''
  return /mac|iphone|ipad|ipod/i.test(`${platform} ${agent}`)
}

/**
 * Parse one binding string.
 * @param text - e.g. `Mod+<1-8>`, `Ctrl+9`, `Alt+ArrowRight`.
 * @param mac - whether `Mod` resolves to Command.
 * @returns `{ok: true, binding}` or `{ok: false, error}`.
 */
export function parseBinding(text, mac = false) {
  const fail = (error) => ({ ok: false, error })
  const parts = String(text ?? '')
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length === 0) return fail('a binding cannot be empty')

  const binding = {
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    digits: null,
    digit: null,
    key: null,
  }

  let sawKey = false
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier !== undefined) {
      if (sawKey) return fail(`"${part}" must come before the key`)
      if (modifier === 'mod') {
        // One spelling, both platforms: the browser tab accelerators are Ctrl+N
        // on Windows/Linux and Cmd+N on macOS, and both need intercepting.
        if (mac) binding.meta = true
        else binding.ctrl = true
      } else {
        binding[modifier] = true
      }
      continue
    }

    if (sawKey) return fail('a binding takes exactly one key')
    sawKey = true

    const range = /^<(\d)-(\d)>$/.exec(part) ?? /^<(\d)\.\.(\d)>$/.exec(part)
    if (range !== null) {
      const low = Number(range[1])
      const high = Number(range[2])
      if (low < 1 || high > 9 || low > high) return fail('a digit range must be 1–9 and ascending')
      binding.digits = [low, high]
      continue
    }

    if (/^\d$/.test(part)) {
      const digit = Number(part)
      if (digit < 1 || digit > 9) return fail('only digits 1–9 can be bound')
      binding.digit = digit
      continue
    }

    const alias = KEY_ALIASES[part.toLowerCase()]
    const function_key = /^f([1-9]|1[0-2])$/i.test(part) ? `F${part.slice(1)}` : null
    const key = alias ?? function_key
    if (key === null || key === undefined) return fail(`unsupported key "${part}"`)
    binding.key = key
  }

  if (!sawKey) return fail('a binding needs exactly one key')
  if (binding.digits !== null || binding.digit !== null) {
    // A bare digit (or Shift+digit) is ordinary typing, and stealing it would
    // break every terminal that reads numbers.
    if (!binding.ctrl && !binding.meta && !binding.alt) {
      return fail(`"${text}" needs Ctrl, Cmd or Alt — a plain digit is typing`)
    }
  }
  return { ok: true, binding }
}

/**
 * Compare two key spellings case-insensitively.
 * @param left - first spelling.
 * @param right - second spelling.
 * @returns true when both name the same key.
 */
function sameKey(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  return left.toLowerCase() === right.toLowerCase()
}

/**
 * Reduce a keyboard event to the fields that decide a match.
 * @param event - KeyboardEvent-like object.
 * @returns a plain descriptor.
 */
export function describeEvent(event) {
  return {
    ctrl: event?.ctrlKey === true,
    meta: event?.metaKey === true,
    alt: event?.altKey === true,
    shift: event?.shiftKey === true,
    key: typeof event?.key === 'string' ? event.key : '',
    code: typeof event?.code === 'string' ? event.code : '',
  }
}

/**
 * Match one parsed binding against a descriptor.
 * @param binding - parsed binding.
 * @param desc - descriptor from {@link describeEvent}.
 * @returns `{index}` for a digit (1-based terminal slot, `null` for a plain
 *   digit or named key), or null when the binding does not match.
 */
export function matchBinding(binding, desc) {
  if (
    binding.ctrl !== desc.ctrl ||
    binding.meta !== desc.meta ||
    binding.alt !== desc.alt ||
    binding.shift !== desc.shift
  ) {
    return null
  }

  if (binding.digits !== null) {
    if (!/^[1-9]$/.test(desc.key)) return null
    const digit = Number(desc.key)
    if (digit < binding.digits[0] || digit > binding.digits[1]) return null
    return { index: digit }
  }

  if (binding.digit !== null) {
    return desc.key === String(binding.digit) ? { index: null } : null
  }

  if (sameKey(desc.key, binding.key) || sameKey(desc.code, binding.key)) return { index: null }
  return null
}

/**
 * Resolve a config into `{action, binding}` pairs, dropping unusable entries.
 * @param config - config object; missing or malformed fields fall back per field.
 * @param mac - whether `Mod` resolves to Command.
 * @returns compiled pairs in action order, or [] when nothing is usable.
 */
export function compileConfig(config, mac = false) {
  const source = config ?? {}
  const compiled = []
  for (const action of ACTIONS) {
    const raw = source[action]
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
    for (const text of list) {
      const parsed = parseBinding(text, mac)
      if (parsed.ok) compiled.push({ action, binding: parsed.binding, text })
    }
  }
  return compiled
}

/**
 * Decide which action, if any, a keystroke requests.
 * @param desc - descriptor from {@link describeEvent}.
 * @param config - config object.
 * @param mac - whether `Mod` resolves to Command.
 * @returns `{action, index}` or null.
 */
export function matchEvent(desc, config, mac = false) {
  for (const entry of compileConfig(config, mac)) {
    const hit = matchBinding(entry.binding, desc)
    if (hit !== null) return { action: entry.action, index: hit.index }
  }
  return null
}

/**
 * Resolve an action to the terminal id it selects. Pure: reads the list, never
 * mutates it, and never touches the transport.
 * @param action - one of {@link ACTIONS}.
 * @param index - 1-based slot for `select`.
 * @param sessions - ordered session summaries, exactly as the tab bar renders them.
 * @param activeId - currently active session id.
 * @returns a session id, or null when the action cannot be satisfied.
 */
export function targetFor(action, index, sessions, activeId) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null
  if (action === 'select') {
    if (!Number.isInteger(index) || index < 1 || index > sessions.length) return null
    return sessions[index - 1].id
  }
  if (action === 'last') return sessions[sessions.length - 1].id

  const current = sessions.findIndex((session) => session.id === activeId)
  if (action === 'next') {
    const next = current === -1 ? 0 : (current + 1) % sessions.length
    return sessions[next].id
  }
  if (action === 'prev') {
    const prev = current === -1 ? sessions.length - 1 : (current - 1 + sessions.length) % sessions.length
    return sessions[prev].id
  }
  return null
}

/**
 * Whether a key event landed in a text field that the workbench does not own.
 *
 * DSH Chat's composer is a textarea in another panel; while the workbench is
 * the visible main panel it is normally unmounted, but this guard keeps the
 * shortcuts from ever firing out of a foreign editable context, and it treats
 * the workbench's own inputs (including xterm's hidden helper textarea, which
 * lives inside the panel) as ours.
 *
 * @param target - event target.
 * @param root - the workbench panel root element.
 * @returns true when the event must be ignored.
 */
export function isForeignEditable(target, root) {
  if (target === null || target === undefined) return false
  if (root !== null && root !== undefined && typeof root.contains === 'function' && root.contains(target)) {
    return false
  }
  const tag = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : ''
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return target.isContentEditable === true
}

/**
 * Build the capture-phase keydown handler.
 *
 * Registered with `capture: true`, so it runs before xterm's own textarea
 * listeners and before any bubble-phase handler. On a match it calls
 * `preventDefault()` (the browser never performs its accelerator) and
 * `stopPropagation()` (the keystroke never reaches the PTY), then selects the
 * tab. `stopImmediatePropagation` is deliberately NOT used: unrelated
 * capture-phase listeners registered on the same node already ran, and none of
 * them should be surprised by a shortcut they did not ask for.
 *
 * @param deps - injected collaborators; every one is required by name.
 * @returns the handler, returning true when it consumed the event.
 */
export function createKeyHandler(deps) {
  const {
    getConfig,
    getSessions,
    getActiveId,
    setActive,
    isActiveContext,
    mac = false,
  } = deps

  return function handleKeyDown(event) {
    if (event === null || event === undefined) return false
    // Someone closer to the event already claimed it; do not double-handle.
    if (event.defaultPrevented === true) return false
    // Mid-IME composition: never steal a keystroke from text entry.
    if (event.isComposing === true) return false

    const hit = matchEvent(describeEvent(event), getConfig(), mac)
    if (hit === null) return false

    if (typeof isActiveContext === 'function' && isActiveContext(event) !== true) return false

    const id = targetFor(hit.action, hit.index, getSessions(), getActiveId())
    // No such terminal (or none at all): leave the key alone so Chromium's own
    // behaviour still applies, rather than swallowing it silently.
    if (id === null) return false

    event.preventDefault()
    event.stopPropagation()
    setActive(id)
    return true
  }
}

// ── config persistence and rendering ──────────────────────────────────────

/**
 * Coerce anything (partial config, hand-edited JSON) into a full config.
 * @param raw - candidate config.
 * @returns a config object; each field falls back to its default independently.
 */
export function normalizeConfig(raw) {
  const source = raw === null || typeof raw !== 'object' ? {} : raw
  const config = {}
  for (const action of ACTIONS) {
    const raw_list = source[action]
    const list = Array.isArray(raw_list) ? raw_list : typeof raw_list === 'string' ? [raw_list] : []
    const usable = list.filter((text) => typeof text === 'string' && parseBinding(text).ok)
    config[action] = usable.length > 0 ? usable : [...DEFAULT_CONFIG[action]]
  }
  return config
}

/**
 * Load the stored mapping.
 * @param storage - localStorage-like object; defaults to the global one.
 * @returns a full config; defaults when absent or unreadable.
 */
export function loadConfig(storage) {
  const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
  if (store === null || store === undefined) return normalizeConfig(null)
  try {
    const text = store.getItem(CONFIG_KEY)
    if (typeof text !== 'string' || text === '') return normalizeConfig(null)
    return normalizeConfig(JSON.parse(text))
  } catch {
    // Unreadable or hand-mangled: defaults, never a broken panel.
    return normalizeConfig(null)
  }
}

/**
 * Persist a mapping.
 * @param storage - localStorage-like object; defaults to the global one.
 * @param config - config to store.
 * @returns true when it was written.
 */
export function saveConfig(storage, config) {
  const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
  if (store === null || store === undefined) return false
  try {
    store.setItem(CONFIG_KEY, JSON.stringify(normalizeConfig(config)))
    return true
  } catch {
    return false
  }
}

/**
 * Render one config field as the comma-separated text the editor shows.
 * @param config - config object.
 * @returns `{select, last, next, prev}` strings.
 */
export function toForm(config) {
  const normalized = normalizeConfig(config)
  return Object.fromEntries(ACTIONS.map((action) => [action, normalized[action].join(', ')]))
}

/**
 * Validate the editor's four fields.
 * @param form - `{select, last, next, prev}` strings.
 * @returns `{ok: true, config}` or `{ok: false, errors}` keyed by field.
 */
export function parseForm(form) {
  const errors = {}
  const config = {}
  for (const action of ACTIONS) {
    const list = String(form?.[action] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
    if (list.length === 0) {
      errors[action] = 'needs at least one binding'
      continue
    }
    for (const text of list) {
      const parsed = parseBinding(text)
      if (!parsed.ok) errors[action] = `${text}: ${parsed.error}`
    }
    if (errors[action] === undefined) config[action] = list
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, config }
}

/**
 * Render one parsed binding back to text.
 * @param binding - parsed binding.
 * @param mac - whether `Mod` resolved to Command.
 * @returns e.g. `Ctrl+1–8`, `Alt+→`.
 */
export function renderBinding(binding, mac = false) {
  const parts = []
  if (binding.ctrl) parts.push('Ctrl')
  if (binding.meta) parts.push(mac ? 'Cmd' : 'Meta')
  if (binding.alt) parts.push('Alt')
  if (binding.shift) parts.push('Shift')
  if (binding.digits !== null) parts.push(`${binding.digits[0]}–${binding.digits[1]}`)
  else if (binding.digit !== null) parts.push(String(binding.digit))
  else parts.push(SHORT_KEYS[binding.key] ?? binding.key)
  return parts.join('+')
}

/**
 * Render the shortcut for terminal slot `index`, for a tab tooltip.
 * @param index - 1-based slot.
 * @param config - config object.
 * @param mac - whether `Mod` resolves to Command.
 * @returns the binding text, or null when no binding covers that slot.
 */
export function hintForIndex(index, config, mac = false) {
  const source = config ?? {}
  for (const text of source.select ?? []) {
    const parsed = parseBinding(text, mac)
    if (!parsed.ok || parsed.binding.digits === null) continue
    const [low, high] = parsed.binding.digits
    if (index < low || index > high) continue
    const single = { ...parsed.binding, digits: null, digit: index }
    return renderBinding(single, mac)
  }
  return null
}

/**
 * One-line human summary of the active mapping, for the status bar.
 * @param config - config object.
 * @param mac - whether `Mod` resolves to Command.
 * @returns e.g. `Ctrl+1–8 · Ctrl+9 last · Ctrl+Tab / Alt+→ · Ctrl+Shift+Tab / Alt+←`.
 */
export function summarize(config, mac = false) {
  const normalized = normalizeConfig(config)
  const render = (action) => {
    const texts = []
    for (const text of normalized[action]) {
      const parsed = parseBinding(text, mac)
      if (parsed.ok) texts.push(renderBinding(parsed.binding, mac))
    }
    return texts.join(' / ')
  }
  const parts = [`${render('select')}`, `${render('last')} last`, render('next'), render('prev')]
  return parts.filter((part) => part !== '').join(' · ')
}
