# dsh-workbench

A project-scoped, multi-CLI terminal workbench for the DeepSeek Harness web UI.

It adds two **additive** seats to the existing GUI — a `Workbench` icon in the
sidebar rail and a full-height main panel — from which you can open real,
persistent terminals in a chosen project directory:

| Preset | What actually runs |
|---|---|
| PowerShell | your interactive shell (`pwsh` if installed, else `powershell.exe`) |
| Claude Code | your installed `claude` — **its own** account, `CLAUDE.md`, skills, hooks, MCP servers and permissions |
| Codex | your installed `codex`, with its own configuration and sessions |
| OpenCode | your installed `opencode` |
| Hermes | your installed `hermes` |
| Custom | any installed CLI you type |

Nothing about Claude Code, Codex, OpenCode or Hermes is reimplemented here.
This package only locates the executable and starts it, so each keeps its own
identity and its own permission and sandbox systems.

## Cockpit fork

This package is the Workbench half of the **cockpit** fork of DeepSeek Harness.
The fork lives at `C:\Users\kimju\deepseek-harness-workspace\deepseek-harness`
(branch `cockpit`, based on upstream tag **`dsh-v0.1.5-rc.2`**, i.e.
`@deepseek-ai/dsh` 0.1.5-rc.2) and owns the shell, theme, sidebar, and rail
presentation. This package owns the Workbench panel.

It deliberately stays an **external, additive plugin** rather than being vendored
into the monorepo: the fork consumes it by *linking* it into the `web` profile
(a `link:` dependency plus a `dsh.bundle.patch` row), exactly as any third-party
DSH bundle. The host half runs from `src/`; the browser half is served from the
built `lib/client.js`.

Compatible DSH baseline: **`dsh-v0.1.5-rc.2`** (`@deepseek-ai/dsh` 0.1.5-rc.2).

## Status

Built and installed into the `web` profile. Two different reload rules apply:

* A **new bundle row** is composed only at process start — adding this package to
  a profile needs a GUI restart (`dsh plugin --profile web add …`).
* Once the row exists, **bundle contents hot-reload**. `@deepseek-ai/dsh-client-hmr`
  is mounted unconditionally, stat-polls every client bundle every 500 ms,
  re-hashes on change, and pushes a `rebuilt` frame over `/plugins/events`; the
  browser half then invalidates and refreshes that loader entry. Rebuilding
  `lib/client.js` therefore reaches the open page in well under a second, with no
  restart and no refresh.

  A reload disposes the browser half (socket, xterm instances) but never the host
  half, so **running PTYs survive it**: the reconnected client asks for
  `bootstrap()`, rebuilds its tab bar from the registry and re-attaches each
  session's scrollback ring.

## Architecture

```
browser                                    host (Node)
┌───────────────────────────────┐          ┌──────────────────────────────────┐
│ sidebar.panellist → "Workbench"│          │ workbench row                    │
│ main[workbench] → panel        │          │  ctx.webServer.registerUpgrade   │
│  · project selector            │   ws     │   /x/workbench/ws                │
│  · preset buttons              │ ◄──────► │  · ctx.connection.requestRejection│
│  · tab bar                     │          │    (401/403, fails closed)       │
│  · xterm.js per session        │          │  WorkbenchRegistry               │
└───────────────────────────────┘          │   · node-pty per session         │
                                           │   · ring-buffer scrollback       │
                                           │   · kill + taskkill /T /F        │
                                           └──────────────────────────────────┘
```

Terminal instances and the socket live in **module scope**, not React state, so
switching to the Conversation panel and back does not destroy live sessions.

### Why not reuse the harness primitives

* **Not `ctx.terminals`.** That registry is fenced to the exact Agent that opened
  each session (`FOREIGN_SESSION`, no cross-agent sharing). That is right for a
  model tool and wrong for a terminal a person drives. A separate registry is
  what makes the DSH model structurally unable to reach these shells.
* **Not `ctx.subprocess.spawnTerminal`.** Measured against the live runtime:
  it exposes **no resize** anywhere in the install (`resize` appears in zero
  `.d.ts` files), and its Windows handle reports **`pid: 0`**, so it cannot
  target a process tree for reaping. `node-pty` directly gives both a real pid
  and `resize()`.

### Windows specifics handled

* `claude`/`codex`/`hermes` resolve to real `.exe` paths; `opencode` installs as
  `.cmd`/`.ps1` shims, which `CreateProcess` cannot execute — those are launched
  through `cmd.exe /c` or `powershell -File` respectively.
* ConPTY is **not** inside a Windows Job Object, so killing the pty can orphan a
  child agent; kill is followed by `taskkill /PID <pid> /T /F`.
* `pwsh` is preferred but absent on many machines; `powershell.exe` is the
  fallback.
* node-pty's `win32-x64` prebuilds ship in the package — no build toolchain.

## Cockpit presentation and contextual rail

The panel is a two-column surface of its own, composed to the cockpit reference
on the fork's `--dsw-cockpit-*` / `--dsw-*` tokens. The working column carries a
header (accent tile, `Workbench`, subtitle), a project toolbar (a chip menu over
the registered projects, the absolute path, the git branch and tree state, an
overflow with Copy path / Refresh / Forget, and Add Project), a tab strip whose
tabs carry each preset's accent mark and slot number with a pinned `+`, the
terminal card with its own header (preset mark, label, working-directory chip,
Clear, Copy, and an overflow with Restart and Kill), and the dock. Beside it runs
a full-height information rail. Presets, spawn/kill/restart, the keymap,
scrollback, and project registration are unchanged.

### The dock

Under the terminal card, a `Chat` / `Context` pair. The composer sends
**user-authored text only** into the currently selected DSH Session's
Conversation, through the documented scope-addressed path
`ctx.sessions.scope(id).conversation.send`, then switches to the Conversation so
the turn is visible where it happens. With no session open the target chip says
so and the composer is disabled.

The five prompt chips prefill the composer and send nothing. The `Context` tab
lists project facts — name, path, branch, tree state, terminal count — and its
one action appends them to the message as text you can read and edit first.
**No terminal output is ever read, quoted or attached**; see the security model.

The plugin also registers one **read-only contextual rail tab** (`Project Info`)
through the same public rail path any other type uses — `ctx.sidebarRightTabs.register`
plus the keyed `sidebar.right.pane.tab` seat — so the rail learns nothing
Workbench-specific and the plugin stays an ordinary rail contributor.

| Section | Source (real data only) |
|---|---|
| Project Info | the selected project, or the host working directory: name, absolute path, git branch, clean/changed, terminal count |
| Recent Files | the most recently modified top-level entries of that directory |
| Quick Actions | the applications DSH's own `ctx.openInApp` reports the host probed as installed, opening the project directory in one of them; absent when the service, the app list, or the path is |
| Active Terminals | the live registry: label, preset colour, and uptime from `startedAt` |

Git state and file listings are read **read-only** by the host over an additive
`projectInfo` WebSocket message. The host resolves only project ids **it**
registered, or its own working directory — never a client-supplied path — and the
reply carries **no process environment and no terminal content**. No PTY handle,
scrollback, or terminal output is exposed to the DSH model or to the rail.

## Keyboard navigation (V1.1)

The tab bar is fully keyboard-driven. This work is **client-side only**: no host
row, no wire-protocol field, no PTY/session/security change. `src/host/*` and
`cordis.patch.yml` are untouched.

| Shortcut | Action |
|---|---|
| `Ctrl+1` … `Ctrl+8` | select Workbench terminal 1–8, in tab order |
| `Ctrl+9` | select the **last** terminal, matching browser-tab behaviour |
| `Ctrl+Tab`, `Alt+→` | next terminal, wrapping |
| `Ctrl+Shift+Tab`, `Alt+←` | previous terminal, wrapping |
| `Cmd+1` … `Cmd+9` (macOS) | the `Mod` spellings resolve to Cmd there |

What a switch does — and does not do:

* Only the active xterm container is shown; every other container stays mounted
  and its session stays alive. Measured against the code path: `setActive()`
  toggles `display`, refits, sends `resize` (a SIGWINCH, not a restart) and
  focuses that terminal's xterm, so typing resumes immediately.
* No `spawn`, no `restart`, no `attach`, no `kill`. The handler is built by
  `createKeyHandler()` from injected callbacks and reaches **only** `setActive`;
  `test/keymap.test.mjs` asserts that with a proxy that fails if the handler so
  much as reads a transport or spawn callback. "Switching never restarts a PTY"
  is therefore structural, not a promise.
* The listener is registered on the window with `capture: true`, so it runs
  before xterm's textarea listeners and before any bubble-phase handler. On a
  match it calls `preventDefault()` (Chromium never performs its own accelerator)
  and `stopPropagation()` (the keystroke never reaches the PTY).
* Scope: the effect's lifetime is the panel's lifetime, and DSH unmounts the
  inactive main panel — so the shortcuts exist only while the Workbench is the
  active panel. On every keystroke a second guard re-checks that the panel root
  is connected, visible (`getClientRects()` non-empty) and that the event target
  is not a text field outside the panel, so DSH Chat's composer and every other
  panel keep their keys.
* A digit with no matching terminal (say `Ctrl+7` with three tabs) is deliberately
  **not** consumed, so Chromium's own behaviour still applies instead of the key
  dying silently.

### Can Chromium intercept Ctrl+1…9? Yes. Ctrl+Tab? Not in a browser tab

Chromium routes a keystroke OS → browser-reserved → focused page → non-reserved
browser accelerators ([routing hierarchy][ks-doc]). The reserved set is
`BrowserCommandController::IsReservedCommandOrKey`, documented as "a reserved
command whose keyboard shortcuts should not be sent to the renderer"
([source][reserved]). It contains `IDC_CLOSE_TAB` (Ctrl+W), `IDC_CLOSE_WINDOW`,
`IDC_NEW_TAB` (Ctrl+T), `IDC_NEW_WINDOW` (Ctrl+N), `IDC_NEW_INCOGNITO_WINDOW`,
`IDC_NEW_ISOLATED_WINDOW`, `IDC_RESTORE_TAB` (Ctrl+Shift+T), `IDC_SELECT_NEXT_TAB`
(Ctrl+PgDn), `IDC_SELECT_PREVIOUS_TAB` (Ctrl+PgUp), `IDC_CYCLE_TO_NEXT_TAB`
(Ctrl+Tab), `IDC_CYCLE_TO_PREV_TAB` (Ctrl+Shift+Tab) and `IDC_EXIT`.

* **Ctrl+1…8 / Ctrl+9 are not reserved** (`IDC_SELECT_TAB_0..7`,
  `IDC_SELECT_LAST_TAB` are absent), so the page receives them first and
  `preventDefault()` stops the browser's own tab switch. Interception is reliable.
* **Ctrl+Tab / Ctrl+Shift+Tab are reserved**, so in a normal browser tab Chromium
  eats them before any listener — capture phase or not — can see them. Nothing in
  a page can change that, and `navigator.keyboard.lock()` is not a way around it
  (it needs JS-initiated fullscreen and only covers OS-level keys).
* Two contexts move them back into reach, by Chromium's own rules: an **app
  window** — an installed PWA or `chrome --app=…`, where the same function starts
  with "In Apps mode, no keys are reserved" — and **fullscreen**, where all
  commands except fullscreen-exit are delivered to the page. The Ctrl+Tab
  bindings are kept for exactly those contexts.
* So the shipped defaults pair Ctrl+Tab with `Alt+→` / `Alt+←`: not reserved,
  always delivered, and working in every context. Nothing is hardcoded — see below.

[ks-doc]: https://chromium.googlesource.com/chromium/src/+/main/docs/ui/learn/keyboard_shortcuts.md
[reserved]: https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/ui/browser_command_controller.cc

### Changing the mapping

`Keys…` in the toolbar opens a four-field editor — terminals, last, next,
previous. Changes are validated before they are accepted (a bad binding is
highlighted with its parse error and nothing is saved) and persisted per browser
profile in `localStorage` under `dsh-workbench.shortcuts.v1`.

Binding grammar, one rule per field, comma-separated alternatives:

```
Mod+<1-8>        a digit range — one rule for eight terminals
Mod+9            a single digit
Ctrl+Tab         a named key (Tab, Esc, Enter, Space, PageUp/Down, Home, End,
Alt+ArrowRight   Insert, Delete, Backspace, ArrowLeft/Right/Up/Down, F1–F12)
Ctrl+Shift+Tab   modifiers: Mod, Ctrl, Meta/Cmd/Win, Alt/Option, Shift
```

`Mod` is Ctrl on Windows/Linux and Cmd on macOS. Modifiers are matched
**exactly**, which is what keeps `Ctrl+Tab` and `Ctrl+Shift+Tab` from colliding.
Digit bindings must carry Ctrl, Cmd or Alt, and the punctuation keys are
rejected outright — Chromium's own shortcut guidelines flag them as
layout-dependent. `Reset` restores the shipped defaults.

The status bar shows `v1.1` and the active selection binding, and each tab that a
binding covers carries its slot number, so the mapping is discoverable without
opening the editor.

### Verifying it

```sh
npm test        # 33 unit tests: grammar, matching, targets, guards, persistence
npm run verify  # bundle contract + live preset resolution
```

Live checklist (needs a running GUI and four terminals): open PowerShell, Claude
Code, Codex and OpenCode in that order, note the tab badges 1–4, then with focus
in any terminal press `Ctrl+1`…`Ctrl+4` and check that each tab becomes active,
that the browser tab count does not change, that the prompt below the switch is
still the same running process (no banner, no re-init), and that typing goes
straight into the newly selected terminal. `Ctrl+9` must land on OpenCode, and
`Alt+→`/`Alt+←` must cycle with wrap-around.

**Result, Web GUI in a Chrome tab (Windows):** confirmed. `Ctrl+1`…`Ctrl+9`
switch Workbench terminals while Chrome keeps its own tabs, the running
PowerShell / Claude Code / Codex / OpenCode sessions are untouched (same prompt,
no re-init), and focus lands back in the selected terminal so typing continues
immediately — which is also what the Chromium analysis above predicts. The
`Ctrl+Tab` half of the mapping was not observable there, as expected: it is
Chromium-reserved in a tab and is kept for app-window/PWA and fullscreen use.

## Install

```sh
dsh plugin --profile web add -w <absolute-path-to-this-directory>
```

The bundle is auto-reconciled into `dsh.profile.bundles` because this package
declares `dsh.bundle.patch`. Then **restart the GUI** — a new bundle layer is
only composed at process start.

Verify the row is composed before restarting:

```sh
dsh --profile web --dump-config | Select-String workbench -Context 2,2
```

## Run

The Workbench is part of the DSH `web` profile, so starting the app starts it.
From a fresh terminal, against the source fork:

```sh
cd C:\Users\kimju\deepseek-harness-workspace\deepseek-harness
pnpm run build                       # only when the fork's client sources changed
pnpm dsh web --no-open --port 3091   # prints http://127.0.0.1:3091/?token=…
```

Open the printed URL once (the token sets the signed browser cookie). The
`Workbench` entry then appears in the sidebar, and its `Project Info` rail tab is
available from the right rail's add control.

## Build

```sh
npm run build          # from an ordinary terminal
```

Under a sandbox that refuses piped child stdio, esbuild's service spawn fails
with `EPERM`. Use the pipe-free equivalent instead:

```sh
node_modules/@esbuild/win32-x64/esbuild.exe src/client/index.jsx \
  --bundle --format=cjs --platform=browser --target=chrome110 \
  --jsx=automatic --loader:.css=text \
  "--define:process.env.NODE_ENV='production'" \
  --external:react --external:react/jsx-runtime --external:react-dom \
  --external:react-dom/client --external:@deepseek-ai/cordis \
  --external:@deepseek-ai/dsh-client-store \
  --external:@deepseek-ai/dsh-client-ui-slots \
  --external:@deepseek-ai/dsh-client-ui-primitives \
  --external:@deepseek-ai/dsh-client-ui-dockkit \
  --outfile=lib/client.body.js
node wrap.mjs
```

`node verify.mjs` then checks the loader contract and that every preset resolves
on this machine, without needing a restart.

## Version control

This package is its own Git repository (see [Cockpit fork](#cockpit-fork) for why
it is not inside the DSH monorepo). Tracked: source, tests, build scripts,
`cordis.patch.yml`, `package-lock.json`, docs, and the built `lib/client.js` that
the profile actually loads. Ignored: `node_modules/` (native `node-pty` prebuilds)
and the intermediate `lib/client.body.js`. Rebuild and commit `lib/client.js`
whenever the browser half changes.

## Files

| Path | Role |
|---|---|
| `package.json` | `dsh.bundle.patch` + `dsh.client` declarations, exports, deps |
| `cordis.patch.yml` | the one host row this bundle inserts |
| `src/host/index.js` | Cordis host plugin: authenticated upgrade route, wire protocol, read-only `projectInfo` |
| `src/host/session.js` | `WorkbenchRegistry`: PTY lifecycle, scrollback, kill, projects, read-only project metadata |
| `src/host/presets.js` | preset catalogue + Windows executable/shim resolution |
| `src/client/index.jsx` | cockpit presentation, panel, tabs, project selector, rail tab, xterm, module-scope store |
| `src/client/keymap.js` | V1.1 shortcut grammar, matching, target resolution, persistence (pure) |
| `test/keymap.test.mjs` | unit tests for the keyboard layer (`node --test`) |
| `build.mjs` / `wrap.mjs` | bundle into the module-loader factory format |
| `lib/client.js` | the built browser bundle the DSH profile serves (tracked) |
| `verify.mjs` | pre-install verification |
| `.gitignore` | ignores `node_modules/` and the intermediate `lib/client.body.js` |

## Security model

| Domain | Confinement |
|---|---|
| DSH agent tools | unchanged — `ctx.sandbox.confine`, approval, fs sandbox |
| **Human terminals (this)** | deliberately **unconfined**; you asked for arbitrary local execution |
| External agents | their own permission/sandbox systems; DSH does not mediate |
| DSH model → these terminals | **no path**: no tool is registered, and nothing this plugin sends can carry terminal content |

The socket is fenced by `ctx.connection.requestRejection` — the same Host/Origin
check and signed browser cookie that protects `/api`. It **fails closed**: if the
connection service is absent the upgrade is refused rather than degrading to an
unauthenticated shell. The route is `/x/workbench/ws`, deliberately outside
`/api`, which the connection row owns. The process environment is never returned
to the client and never logged.

The dock does not weaken that boundary, and is the reason to state it twice. It
is a one-way text path **out** of the browser: what it sends is what the user
typed into it. It never reads a PTY, an xterm buffer or the host's scrollback,
and the `Context` tab carries only the same project metadata the rail already
shows. Copy in the terminal card header is a browser-side read of the selection
already on screen, into the clipboard the user asked for — it neither leaves the
browser nor reaches the model. Quick Actions launch through DSH's existing
`ctx.openInApp` capability on a directory this host already registered; this
plugin adds no host action of its own.

## Not in V1

No model visibility into these sessions, no output capture, no cross-harness
comparison, no token/cost data, no persistence across a DSH restart. Sessions are
process-local by design. The contextual rail tab is **read-only metadata**. The
rail's Quick Actions are limited to `ctx.openInApp`: "Run Tests" and "View Logs"
from the reference need host actions this plugin deliberately does not add, and
a Push button is a credentialed network flow outside its remit — type `git push`
in a terminal.
