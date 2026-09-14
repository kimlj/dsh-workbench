// Pre-install verification: proves the built bundle satisfies the module-loader
// contract, and that the host half loads and resolves this machine's real CLIs.
// Throwaway harness; not shipped.

import { readFile } from 'node:fs/promises'

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

// ── 1. browser bundle contract ────────────────────────────────────────────
{
  const source = await readFile(new URL('./lib/client.js', import.meta.url), 'utf8')

  let registration = null
  globalThis.window = { __ModuleLoader__: { load: (entry) => { registration = entry } } }
  // xterm ships UMD bundles that read the browser global `self` while their
  // module body evaluates, so the harness must present one.
  globalThis.self = globalThis

  const noop = () => ({})
  const reactStub = {
    __esModule: true,
    Fragment: {},
    createElement: noop,
    useCallback: (fn) => fn,
    useEffect: noop,
    useMemo: (fn) => fn(),
    useReducer: () => [undefined, noop],
    useRef: () => ({ current: null }),
    useState: () => [undefined, noop],
  }
  const requireStub = (id) => {
    if (id === 'react' || id === 'react/jsx-runtime') return reactStub
    throw new Error(`unexpected external require: ${id}`)
  }

  new Function('require', source)(requireStub)

  check('bundle registers with the module loader', registration !== null)
  if (registration !== null) {
    check('module id is the package name', registration.id === 'dsh-workbench', registration.id)
    const exported = registration.factory(requireStub)
    check('factory returns apply()', typeof exported.apply === 'function')
    check('factory returns inject[]', Array.isArray(exported.inject))
    check(
      "inject declares the 'slots' hard dependency",
      Array.isArray(exported.inject) && exported.inject.includes('slots'),
      JSON.stringify(exported.inject),
    )
  }

  // The keyboard layer must survive bundling: a source-level import that
  // esbuild inlined away, or a build that shipped a stale artifact, would leave
  // the panel without shortcuts while every other check still passed.
  check('bundle carries the keydown wiring', source.includes('addEventListener("keydown"'))
  check(
    'bundle carries the capture-phase flag',
    /addEventListener\("keydown",\s*\w+,\s*true\)/.test(source),
  )
  check('bundle carries the config storage key', source.includes('dsh-workbench.shortcuts.v1'))
  check('bundle version marker is 1.1', source.includes('"1.1"') || source.includes("'1.1'"))
}

// ── 1b. keyboard layer, exercised directly ────────────────────────────────
{
  const keymap = await import('./src/client/keymap.js')
  const defaults = keymap.normalizeConfig(null)
  const compiled = keymap.compileConfig(defaults)
  check(
    'keymap compiles every default action',
    keymap.ACTIONS.every((action) => compiled.some((entry) => entry.action === action)),
    compiled.map((entry) => entry.action).join(','),
  )

  const sessions = [
    { id: 'a', presetId: 'powershell' },
    { id: 'b', presetId: 'claude' },
    { id: 'c', presetId: 'codex' },
    { id: 'd', presetId: 'opencode' },
  ]
  check(
    'Ctrl+1..4 address the four named presets',
    ['a', 'b', 'c', 'd'].every((id, index) => keymap.targetFor('select', index + 1, sessions, 'a') === id),
  )
  check('Ctrl+9 addresses the last terminal', keymap.targetFor('last', null, sessions, 'a') === 'd')
  check('cycling wraps', keymap.targetFor('next', null, sessions, 'd') === 'a' && keymap.targetFor('prev', null, sessions, 'a') === 'd')

  const handler = keymap.createKeyHandler({
    getConfig: () => defaults,
    getSessions: () => sessions,
    getActiveId: () => 'a',
    setActive: () => undefined,
    isActiveContext: () => true,
  })
  const event = {
    key: '3',
    code: 'Digit3',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation: () => undefined,
  }
  check('handler consumes Ctrl+3 and preventDefaults it', handler(event) === true && event.defaultPrevented === true)
}

// ── 2. host half loads and resolves real CLIs ─────────────────────────────
{
  const host = await import('./src/host/index.js')
  check('host exports name', host.name === 'workbench', host.name)
  check('host injects webServer', Array.isArray(host.inject) && host.inject.includes('webServer'))
  check('host exports apply()', typeof host.apply === 'function')
  check('host exposes the ws path', host.WS_PATH === '/x/workbench/ws', host.WS_PATH)

  const presets = await import('./src/host/presets.js')
  for (const id of ['powershell', 'claude', 'codex', 'opencode', 'hermes']) {
    try {
      const launch = presets.launchFor(id)
      check(`preset "${id}" resolves`, true, `${launch.file} ${launch.args.join(' ')}`.slice(0, 120))
    } catch (error) {
      check(`preset "${id}" resolves`, false, String(error?.message ?? error))
    }
  }

  const catalogue = presets.presetCatalogue()
  check('catalogue has 6 rows', catalogue.length === 6, String(catalogue.length))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
