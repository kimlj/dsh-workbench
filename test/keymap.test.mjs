// Keyboard-navigation tests for the dsh-workbench browser half.
//
//   node --test test/
//
// The shortcut path is pure by construction, so everything that decides a
// keystroke runs here without a browser: binding grammar, matching, target
// resolution, the ownership guards, and persistence. The last block is the
// architectural one — it proves the handler can select a tab and reach nothing
// else, which is why a keyboard shortcut cannot restart a PTY.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ACTIONS,
  CONFIG_KEY,
  DEFAULT_CONFIG,
  compileConfig,
  createKeyHandler,
  describeEvent,
  hintForIndex,
  isForeignEditable,
  isMacPlatform,
  loadConfig,
  matchBinding,
  matchEvent,
  normalizeConfig,
  parseBinding,
  parseForm,
  renderBinding,
  saveConfig,
  summarize,
  targetFor,
  toForm,
} from '../src/client/keymap.js'

/** A KeyboardEvent-shaped object with observable preventDefault/stopPropagation. */
function keyEvent(overrides = {}) {
  const event = {
    key: '1',
    code: 'Digit1',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    preventDefaultCount: 0,
    stopPropagationCount: 0,
  }
  Object.assign(event, overrides)
  event.preventDefault = () => {
    event.preventDefaultCount += 1
    event.defaultPrevented = true
  }
  event.stopPropagation = () => {
    event.stopPropagationCount += 1
  }
  return event
}

/** The four terminals named in the V1.1 acceptance list, in tab order. */
const FOUR = [
  { id: 't1', presetId: 'powershell', label: 'PowerShell', status: 'running' },
  { id: 't2', presetId: 'claude', label: 'Claude Code', status: 'running' },
  { id: 't3', presetId: 'codex', label: 'Codex', status: 'running' },
  { id: 't4', presetId: 'opencode', label: 'OpenCode', status: 'running' },
]

// ── grammar ───────────────────────────────────────────────────────────────

test('parses the shipped defaults', () => {
  for (const action of ACTIONS) {
    for (const text of DEFAULT_CONFIG[action]) {
      const parsed = parseBinding(text)
      assert.equal(parsed.ok, true, `${text} should parse`)
    }
  }
})

test('Mod resolves to Ctrl off macOS and to Cmd on macOS', () => {
  const windows = parseBinding('Mod+1', false)
  assert.equal(windows.ok, true)
  assert.equal(windows.binding.ctrl, true)
  assert.equal(windows.binding.meta, false)

  const mac = parseBinding('Mod+1', true)
  assert.equal(mac.ok, true)
  assert.equal(mac.binding.ctrl, false)
  assert.equal(mac.binding.meta, true)
})

test('digit ranges are one rule, not nine', () => {
  const parsed = parseBinding('Mod+<1-8>')
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.binding.digits, [1, 8])
  assert.equal(parsed.binding.digit, null)
})

test('rejects bindings that would break typing or cannot be honoured', () => {
  const rejected = ['', '1', 'Shift+1', 'Ctrl+', 'Ctrl+0', 'Ctrl+Foo', 'Ctrl+<9-1>', 'Ctrl+<1-10>', 'Ctrl+1+2', '1+Ctrl']
  for (const text of rejected) {
    assert.equal(parseBinding(text).ok, false, `${text} should be rejected`)
  }
})

test('accepts navigation and function keys with aliases', () => {
  assert.equal(parseBinding('Alt+ArrowRight').binding.key, 'ArrowRight')
  assert.equal(parseBinding('alt+right').binding.key, 'ArrowRight')
  assert.equal(parseBinding('Ctrl+PageUp').binding.key, 'PageUp')
  assert.equal(parseBinding('F9').binding.key, 'F9')
})

test('renders bindings back to readable text', () => {
  assert.equal(renderBinding(parseBinding('Mod+<1-8>').binding, false), 'Ctrl+1–8')
  assert.equal(renderBinding(parseBinding('Mod+9', true).binding, true), 'Cmd+9')
  assert.equal(renderBinding(parseBinding('Alt+ArrowRight').binding), 'Alt+→')
  assert.equal(renderBinding(parseBinding('Ctrl+Shift+Tab').binding), 'Ctrl+Shift+Tab')
})

// ── matching ──────────────────────────────────────────────────────────────

test('Ctrl+1..8 select slots and Ctrl+9 is last', () => {
  const config = normalizeConfig(null)
  for (let slot = 1; slot <= 8; slot += 1) {
    const hit = matchEvent(describeEvent(keyEvent({ key: String(slot) })), config)
    assert.deepEqual(hit, { action: 'select', index: slot })
  }
  assert.deepEqual(matchEvent(describeEvent(keyEvent({ key: '9' })), config), {
    action: 'last',
    index: null,
  })
})

test('modifier sets are matched exactly', () => {
  const config = normalizeConfig(null)
  // Ctrl+Shift+1 is not Ctrl+1, and Ctrl+Alt+1 is not Ctrl+1.
  assert.equal(matchEvent(describeEvent(keyEvent({ key: '1', shiftKey: true })), config), null)
  assert.equal(matchEvent(describeEvent(keyEvent({ key: '1', altKey: true })), config), null)
  assert.equal(matchEvent(describeEvent(keyEvent({ key: '0' })), config), null)
  assert.equal(matchEvent(describeEvent(keyEvent({ key: '1', ctrlKey: false, metaKey: true })), config), null)
})

test('Ctrl+Tab and Ctrl+Shift+Tab stay distinct', () => {
  const config = normalizeConfig(null)
  const next = matchEvent(describeEvent(keyEvent({ key: 'Tab', code: 'Tab' })), config)
  assert.deepEqual(next, { action: 'next', index: null })
  const prev = matchEvent(describeEvent(keyEvent({ key: 'Tab', code: 'Tab', shiftKey: true })), config)
  assert.deepEqual(prev, { action: 'prev', index: null })
})

test('the always-available cycling fallback matches too', () => {
  const config = normalizeConfig(null)
  const next = matchEvent(describeEvent(keyEvent({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: false, altKey: true })), config)
  assert.deepEqual(next, { action: 'next', index: null })
  const prev = matchEvent(describeEvent(keyEvent({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: false, altKey: true })), config)
  assert.deepEqual(prev, { action: 'prev', index: null })
})

test('matchBinding reads the descriptor, not the live event', () => {
  const binding = parseBinding('Ctrl+9').binding
  assert.equal(matchBinding(binding, { ctrl: true, meta: false, alt: false, shift: false, key: '9', code: 'Digit9' }).index, null)
  assert.equal(matchBinding(binding, { ctrl: true, meta: false, alt: false, shift: false, key: '8', code: 'Digit8' }), null)
})

// ── target resolution ─────────────────────────────────────────────────────

test('Ctrl+1..4 reach PowerShell, Claude Code, Codex and OpenCode', () => {
  const ids = [1, 2, 3, 4].map((slot) => targetFor('select', slot, FOUR, 't1'))
  assert.deepEqual(ids, ['t1', 't2', 't3', 't4'])
})

test('Ctrl+9 is the last terminal, matching browser tab behaviour', () => {
  assert.equal(targetFor('last', null, FOUR, 't1'), 't4')
  assert.equal(targetFor('last', null, [FOUR[0]], 't1'), 't1')
})

test('a slot with no terminal is not consumed', () => {
  // Falls through to Chromium instead of doing nothing silently.
  assert.equal(targetFor('select', 9, FOUR, 't1'), null)
  assert.equal(targetFor('select', 5, FOUR, 't1'), null)
  assert.equal(targetFor('select', 0, FOUR, 't1'), null)
})

test('cycling wraps in both directions', () => {
  assert.equal(targetFor('next', null, FOUR, 't1'), 't2')
  assert.equal(targetFor('next', null, FOUR, 't4'), 't1')
  assert.equal(targetFor('prev', null, FOUR, 't1'), 't4')
  assert.equal(targetFor('prev', null, FOUR, 't3'), 't2')
  // No active terminal (or an unknown one) still lands somewhere sensible.
  assert.equal(targetFor('next', null, FOUR, null), 't1')
  assert.equal(targetFor('prev', null, FOUR, 'gone'), 't4')
})

test('no terminals means no action', () => {
  for (const action of ACTIONS) {
    assert.equal(targetFor(action, 1, [], null), null)
    assert.equal(targetFor(action, null, undefined, null), null)
  }
})

// ── handler ownership and side effects ────────────────────────────────────

/**
 * Wrap deps in a proxy that records which names the handler reaches for.
 * @param extra - additional deps, including spies that must stay untouched.
 * @returns the proxied deps and the touched-name set.
 */
function watchedDeps(extra = {}) {
  const touched = new Set()
  const calls = []
  const target = {
    getConfig: () => normalizeConfig(null),
    getSessions: () => FOUR,
    getActiveId: () => 't1',
    setActive: (id) => calls.push(['setActive', id]),
    isActiveContext: () => true,
    ...extra,
  }
  const deps = new Proxy(target, {
    get(object, property) {
      if (typeof property === 'string') touched.add(property)
      return object[property]
    },
  })
  return { deps, touched, calls }
}

test('a shortcut selects a tab and calls nothing else', () => {
  // `send` and `spawnSession` stand in for the transport: the handler must not
  // even read them, which is what makes "switching never restarts a PTY"
  // structural rather than a promise.
  const { deps, touched, calls } = watchedDeps({
    send: () => assert.fail('the shortcut path must never touch the transport'),
    spawnSession: () => assert.fail('the shortcut path must never spawn'),
  })
  const handler = createKeyHandler(deps)

  const event = keyEvent({ key: '2' })
  assert.equal(handler(event), true)
  assert.equal(event.preventDefaultCount, 1)
  assert.equal(event.stopPropagationCount, 1)
  assert.deepEqual(calls, [['setActive', 't2']])

  assert.deepEqual(
    [...touched].sort(),
    ['getActiveId', 'getConfig', 'getSessions', 'isActiveContext', 'mac', 'setActive'],
  )
})

test('every named terminal is reachable by its own shortcut', () => {
  for (const [slot, session] of FOUR.entries()) {
    const { deps, calls } = watchedDeps()
    const handler = createKeyHandler(deps)
    const event = keyEvent({ key: String(slot + 1) })
    assert.equal(handler(event), true)
    assert.deepEqual(calls, [['setActive', session.id]])
  }
})

test('nothing is consumed outside the workbench', () => {
  const { deps, calls } = watchedDeps({ isActiveContext: () => false })
  const handler = createKeyHandler(deps)
  const event = keyEvent({ key: '1' })
  assert.equal(handler(event), false)
  assert.equal(event.preventDefaultCount, 0)
  assert.equal(event.stopPropagationCount, 0)
  assert.deepEqual(calls, [])
})

test('unrelated, composing, and already-handled keystrokes pass through', () => {
  const { deps, calls } = watchedDeps()
  const handler = createKeyHandler(deps)

  const unrelated = keyEvent({ key: 'k', code: 'KeyK' })
  assert.equal(handler(unrelated), false)

  const composing = keyEvent({ key: '1', isComposing: true })
  assert.equal(handler(composing), false)

  const claimed = keyEvent({ key: '1', defaultPrevented: true })
  assert.equal(handler(claimed), false)

  assert.deepEqual(calls, [])
})

test('a slot beyond the open terminals is left to the browser', () => {
  const { deps, calls } = watchedDeps()
  const handler = createKeyHandler(deps)
  const event = keyEvent({ key: '7' })
  assert.equal(handler(event), false)
  assert.equal(event.preventDefaultCount, 0)
  assert.deepEqual(calls, [])
})

test('a remapped config drives the same handler', () => {
  const config = normalizeConfig({ select: 'Alt+<1-4>', last: 'Alt+9', next: 'Alt+ArrowDown', prev: 'Alt+ArrowUp' })
  const { deps, calls } = watchedDeps({ getConfig: () => config })
  const handler = createKeyHandler(deps)

  assert.equal(handler(keyEvent({ key: '3', ctrlKey: false, altKey: true })), true)
  assert.deepEqual(calls, [['setActive', 't3']])

  // The old Ctrl binding is gone once remapped.
  assert.equal(handler(keyEvent({ key: '1', ctrlKey: true, altKey: false })), false)
})

// ── panel ownership guards ────────────────────────────────────────────────

test('typing in another panel is never hijacked', () => {
  const root = { contains: (node) => node.insideRoot === true }
  const chatComposer = { tagName: 'TEXTAREA', isContentEditable: false, insideRoot: false }
  const otherInput = { tagName: 'INPUT', isContentEditable: false, insideRoot: false }
  const chatProse = { tagName: 'DIV', isContentEditable: true, insideRoot: false }

  assert.equal(isForeignEditable(chatComposer, root), true)
  assert.equal(isForeignEditable(otherInput, root), true)
  assert.equal(isForeignEditable(chatProse, root), true)
})

test('the workbench owns its own inputs, including xterm helpers', () => {
  const root = { contains: (node) => node.insideRoot === true }
  // xterm keeps a hidden textarea inside the panel to receive typing.
  assert.equal(isForeignEditable({ tagName: 'TEXTAREA', insideRoot: true }, root), false)
  // The custom-command field likewise.
  assert.equal(isForeignEditable({ tagName: 'INPUT', insideRoot: true }, root), false)
})

test('a neutral target (body, panel chrome) is not foreign', () => {
  const root = { contains: () => false }
  assert.equal(isForeignEditable({ tagName: 'BODY', isContentEditable: false }, root), false)
  assert.equal(isForeignEditable({ tagName: 'BUTTON' }, root), false)
  assert.equal(isForeignEditable(null, root), false)
})

// ── configuration ─────────────────────────────────────────────────────────

test('normalizeConfig keeps valid fields and defaults the rest', () => {
  const config = normalizeConfig({ select: 'Alt+<1-3>', last: 'nonsense', next: 'Alt+ArrowDown' })
  assert.deepEqual(config.select, ['Alt+<1-3>'])
  assert.deepEqual(config.last, [...DEFAULT_CONFIG.last])
  assert.deepEqual(config.next, ['Alt+ArrowDown'])
  assert.deepEqual(config.prev, [...DEFAULT_CONFIG.prev])
})

test('normalizeConfig survives hand-mangled input', () => {
  for (const junk of [null, undefined, 42, 'Ctrl+1', {}, { select: [] }, { select: [7] }]) {
    const config = normalizeConfig(junk)
    for (const action of ACTIONS) assert.ok(Array.isArray(config[action]) && config[action].length > 0)
  }
})

test('the editor form round-trips and reports errors per field', () => {
  const form = toForm(DEFAULT_CONFIG)
  assert.equal(form.select, 'Mod+<1-8>')
  assert.equal(form.next, 'Ctrl+Tab, Alt+ArrowRight')

  const ok = parseForm(form)
  assert.equal(ok.ok, true)
  assert.deepEqual(normalizeConfig(ok.config), normalizeConfig(null))

  const bad = parseForm({ ...form, prev: 'Ctrl+Foo' })
  assert.equal(bad.ok, false)
  assert.match(bad.errors.prev, /unsupported key/)

  const empty = parseForm({ ...form, next: '   ' })
  assert.equal(empty.ok, false)
  assert.match(empty.errors.next, /at least one/)
})

test('the mapping persists through a storage-shaped object', () => {
  const store = new Map()
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  }
  const custom = normalizeConfig({ select: 'Alt+<1-4>' })
  assert.equal(saveConfig(storage, custom), true)
  assert.ok(store.has(CONFIG_KEY))
  assert.deepEqual(loadConfig(storage).select, ['Alt+<1-4>'])

  store.set(CONFIG_KEY, '{not json')
  assert.deepEqual(loadConfig(storage), normalizeConfig(null))
  assert.deepEqual(loadConfig(undefined), normalizeConfig(null))
})

test('compileConfig drops unusable entries without losing the rest', () => {
  const compiled = compileConfig({ select: ['Ctrl+<1-8>', 'garbage'], next: 'Ctrl+Tab' })
  assert.equal(compiled.length, 2)
  assert.deepEqual(compiled.map((entry) => entry.action), ['select', 'next'])
})

// ── rendering helpers ─────────────────────────────────────────────────────

test('tab hints name the shortcut for each slot', () => {
  const config = normalizeConfig(null)
  assert.equal(hintForIndex(1, config), 'Ctrl+1')
  assert.equal(hintForIndex(4, config), 'Ctrl+4')
  assert.equal(hintForIndex(9, config), null)
  assert.equal(hintForIndex(3, config, true), 'Cmd+3')
})

test('the status summary lists every configured action', () => {
  const text = summarize(DEFAULT_CONFIG)
  assert.match(text, /Ctrl\+1–8/)
  assert.match(text, /Ctrl\+9 last/)
  assert.match(text, /Ctrl\+Tab/)
  assert.match(text, /Alt\+→/)
})

test('platform detection is total and never throws', () => {
  assert.equal(isMacPlatform({ platform: 'MacIntel', userAgent: '' }), true)
  assert.equal(isMacPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }), false)
  assert.equal(isMacPlatform(null), false)
  assert.equal(isMacPlatform(undefined), false)
})
