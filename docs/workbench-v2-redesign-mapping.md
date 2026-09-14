# Workbench V2 — design-reference mapping and feasibility

**Status: analysis only. No code has been written or changed for this plan.**

Reference: `ChatGPT Image Sep 14, 2026, 06_46_36 PM.png` (preview 1090×586, source 1710×919).

## 0. How this was verified, and how to read the tags

| Tag | Meaning |
|---|---|
| **[V]** | Verified from a primary source I read in this session: the live Cordis Slot tree, an installed package's type declarations, or shipped client source. Appendix A has `path:line`. |
| **[I]** | Inference from verified facts. Reasonable, not proven. |
| **[U]** | Unknown / unverified. Must be spiked before relying on it. |

Sources used:

- Live client Slot tree and client Service catalog (Cordis Inspect, this install).
- Installed client packages under `%DSH_HOME%\profiles\node_modules\@deepseek-ai\` (types + readable client bundles).
- The shell frame's own source: `dsh-client-ui-layout\lib\client.js` **[V]**.
- The existing workbench package in this workspace (client, host, keymap, tests).

**Headline conclusion.** The reference is not a new product design; it is a **recomposition of this install**. It names *this* workbench's presets (PowerShell, Claude Code, Codex, OpenCode, Hermes), shows "DSH v0.1.5-rc.1", and uses the shipped `--dsw-*` design language. Roughly 60% of what it shows is shipped DSH chrome that needs no work, ~25% is new UI inside our own panel and a new right-column tab (both supported extension points), and ~15% needs new **host-side** data (git state, recent files, quick actions). Exactly one element — the embedded agent composer — looks impossible at first reading but is reachable through a documented service path. Nothing requires editing upstream DSH source.

---

## 1. Visual analysis of the reference

### 1.1 Frame and surfaces

Three columns plus a top bar, on a near-black base with one hairline-separated raised layer per region.

- **Top bar** (~36–44px): brand mark left; a rounded search field with placeholder "Search sessions, projects, files…" and a right-aligned `Ctrl K` keycap; right cluster = green dot + "Local", a model chip "DeepSeek-V4-Flash ⌄", bell, gear, avatar.
- **Left column** (~170px in the 1090px preview ⇒ ≈225px at a 1440px window): nav rows, a `WORKSPACES` section header with a disclosure chevron, session/workspace rows (with green state dots and relative times, one level of nesting), and a foot row: "DSH v0.1.5-rc.1" + "Ready" with a green dot.
- **Centre column**: the Workbench panel, itself composed of a header, a project toolbar, a horizontal tab strip, a bordered terminal card, and a bottom dock.
- **Right column** (~195px in the preview ⇒ ≈260px at a 1440px window): four stacked sections — Project Info, Recent Files, Quick Actions, Active Terminals — each with a 12px semibold header and a disclosure chevron.
- **Surface ladder**: base (app) → layer-1 (cards, tab strip, right-panel sections) → layer-2 (nested chips/rows). Region separation is by 1px hairline borders at low alpha, not by heavy shadows.

### 1.2 Centre column, top to bottom

1. **Panel header**: 24px icon in a rounded tile, title "Workbench" (≈18–20px semibold), subtitle "Run your tools. One workspace, all terminals." (12–13px, secondary), and one icon button at the far right with a panel/layout glyph.
2. **Project toolbar**: `Project` label, a bordered chip "▦ jobsift ⌄" (a select), the absolute path in monospace secondary text, a branch pill "⑂ main", a green status pill "✓ Clean", a flexible spacer, and a bordered "+ Add Project" button.
3. **Tab strip**: individual tabs — `1 PowerShell ×`, `AI 2 Claude Code ×`, `3 Codex ×`, `4 OpenCode ×`, `H Hermes ×`, then a `+`. The active tab has a brighter surface and a blue top-edge accent; each tab carries a small colored preset glyph, a slot number, the label, and a close ×. The strip scrolls horizontally.
4. **Terminal card**: a bordered, rounded container *with its own header row* — preset glyph + name (13px semibold), a working-directory chip with a chevron, a spacer, a "Clear" text button, a copy icon, and a "…" overflow menu. The body is near-black monospace text with a bright block cursor.
5. **Dock (the contested region)**: a small tab pair — `Chat` (active, blue underline) and `Context` (with a badge) — then a `+`; below it a row of five outlined pill buttons: *Explain this code · Find related files · Draft a commit message · Debug this issue · Plan next steps*; then the composer card: "Ask anything…", a `+` attachment button, an `@ Workspace ⌄` scope selector, a right-aligned model chip "DeepSeek-V4-Flash ⌄", and a circular filled send button.
6. **Right column sections**: a project card (name, path, branch + Clean pills, "Push" button, "…"), a Recent Files list (file glyph, name, right-aligned relative time for five rows, then a centered "Show more…"), a 2×2 Quick Actions grid (Open in Explorer, Open in VS Code, Run Tests, View Logs), and an Active Terminals list (colored dot, name, right-aligned duration: 12m / 8m / 3m / …).

### 1.3 Typography, spacing, geometry

- **Type scale**: panel title 18–20px/600 · section headers and card titles 12–13px/600 · body 12–13px · meta 11px · terminal and paths 13px monospace. This is exactly the shipped `--dsw-font-*` ladder (`xxxs-11`, `xxs-12`, `xs-13`, `m-18`, `l-20`) **[V]**.
- **Radii**: chips/buttons 6–8px, cards 10px, tabs 6px top-rounded, avatar/send fully round.
- **Spacing**: 12–16px region padding, 8px control gaps, 6–7px chip padding, ~32–34px nav-row height, ~28px list-row height.
- **Density**: four distinct information tiers are visible simultaneously (nav → tabs → terminal → dock), which is what makes the reference read as an IDE rather than a chat app.

### 1.4 Interaction patterns the image implies

Disclosure chevrons (sidebar section, each right-panel section); a select on the project chip; a per-tab close; `+` to add; hover-brightened rows and buttons; active-state underline + surface for tabs; overflow `…` menus; one-click prompt chips; Enter-to-send with an explicit circular send affordance; `@`-scope and `+`-attachment affordances in the composer.

### 1.5 What the image cannot mean (boundary)

The dock sits directly under a terminal full of `git status` output, next to a "Context" tab. Read literally, that invites **feeding terminal output into the agent**. That is the one thing this package must not do: its stated security posture is "DSH model → these terminals: **no path in V1**" (README), which is what makes the model structurally unable to reach a human's shells. Every chat/context affordance in V2 must send **user-authored text only**. **[V]** (README security table) — this is a design constraint, not a limitation of the platform.

---

## 2. The current DSH surface that matters (verified)

### 2.1 Frame and geometry

- The frame owns a 3-track grid (`sidebar | center | rightbar`); the centre renders `main` keyed by `activePanelId`, defaulting to `conversation` **[V]** (`dsh-client-ui-layout\lib\client.js:107–128`).
- **Columns are independent of the selected main key** — the right column is a track that its occupant asks for, not a property of the conversation panel **[V]** (frame doc comment, `client.js:90–105`). So the reference's right column *can* render beside `main[workbench]`.
- Column solve **[V]** (`client.js:13–43`): sidebar rail 56px when collapsed, else clamped to 264–420px (default 280); right column is 0 when no track or when `available < 300`, else clamped to `300 … viewport × 0.7`; the sidebar auto-collapses below 1024px viewport.
- **Design-fidelity note**: proportionally, the reference's columns scale to ≈225px (left) and ≈260px (right) at a 1440px-wide window — both **narrower than this shell's own solve**, which gives the sidebar 264–420px (default 280) and floors the right column at 300px. Expect a visibly wider sidebar/right column than the mockup, or a deliberate default that biases toward the reference.

### 2.2 Seats a third-party client plugin may use (additive, `replaceRisk: none`)

| Seat | Kind | Scope | What it gives us |
|---|---|---|---|
| `main` (key `workbench`) | keyed | root | our panel; props: `useResource`, `useWorkspaces`, `usePanelInfo`, `useSessions`, `useSessionPendingInteraction` — **no session binding** **[V]** |
| `sidebar.panellist` | list | root | nav entry; owner props `{ size, active }`; the sidebar owns the row and projects our `label` **[V]** |
| `sidebar.footer.action` | list | root | an extra action beside Settings at the sidebar foot **[V]** |
| `shell.overlay` | list | root | frame-wide floating layer **[V]** |
| `sidebar.right.pane.tab` / `.title` | keyed | session | right-column tab body and chip title, keyed by the tab type's `id` **[V]** |
| `sidebar.right.tab.menu.item` | list | session | extra items in one right-column tab's actions menu **[V]** |
| `sidebar.right.tab.guide` / `.document` | chain / keyed | session | guide-page replacement and document viewers **[V]** |
| `conversation.input.left` / `.right` / `.overlay` / `conversation.input.dock` / `conversation.composer.dock` | list | session | additive controls around the *real* composer, in the Conversation panel **[V]** |

Seats with `replaceRisk: shadows-shipped-ui` (`root`, `main`, `sidebar`, `sidebar.workspaces`, `rightbar`, `main.conversation`, the composer singles) must **not** be replaced: doing so deletes the shipped UI and every descendant slot it declares.

### 2.3 Services we can call

| Service | Access | Relevant surface |
|---|---|---|
| `ctx.slots` | `ctx.get('slots')` (our plugin already injects it) | `register(options, Component)`, `inject(key, cb)` **[V]** |
| `ctx.layout` | documented client service | `selectPanel(id)`, `toggleSidebar()`, `openRightbar(track, fullscreen)`, `closeRightbar()` **[V]** |
| `ctx.uiWorkspace` | documented client service | `pickDirectory()`, `listDirectory(path, signal)`, `openSession(id)`, `startSession(id?)` **[V]** |
| `ctx.sessions` | documented client service | **`scope(id): AgentContext \| undefined`** — the session-scoped Context **[V]** |
| `ctx.sidebarRight` | declared service (**not** in the Inspect catalog) | `openTab(kind, opts)`, `openResource(address, opts)`, `focus`, `toggleExpanded`, `split`, `float`, `dock` **[V]** |
| `ctx.sidebarRightTabs` | declared service (**not** in the Inspect catalog) | `register(definition)` — the right-column tab-type registry **[V]** |
| `ctx.conversation` | declared service (**not** in the Inspect catalog) | **`send(text): Promise<void>`**, `input` (`SessionInputResolver`), `blocks`, `cancel()`, `loadOlder()`, `updateQueue()` **[V]** |
| `ctx.uiConversation` | declared service | target-neutral conversation registries/assembly **[V]** |

The Inspect Service catalog lists only 8 client services and omits `sidebarRight`, `sidebarRightTabs`, `conversation`, `uiConversation` **[V]** — so the catalog is a *curated* view, not a complete one. Any plan must verify these at runtime rather than assume the catalog is exhaustive.

### 2.4 The load-bearing service detail

`ctx.conversation` is a **root singleton with scope-addressed methods**: property access rebinds `this.ctx` to the caller's context, and the implementation reads the session tag from that scope. Its own error string documents the intended call shape **[V]**:

> `conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`

and a shipped caller does exactly that **[V]**:

```js
const actx = sessions.scope(sessionId)
conversation.input.for(actx).notify(level, text)
```

So a **root-scoped panel can drive a specific session** without any session-scoped React context. Implementation trap to record: never destructure (`const { send } = ctx.conversation`) — the tracker rebinding is lost; always call through the property expression on the session context.

`InputActions` (the public face every session-scope occupant receives) is `setDraft(text)`, `addAttachments`, `removeAttachment`, `pruneAttachments`, `submit()` **[V]**; `InputState` exposes `draft`, `attachmentIds`, `phase`, `occurrences`, `queue` **[V]**. The rich composer internals (`ComposerKeyboard`, the Lexical editor) are explicitly package-internal **[V]**.

### 2.5 Activation facts (they shape the phasing)

- **Client half hot-reloads.** `dsh-client-hmr` stat-polls every client bundle every 500 ms and hot-swaps the loader entry over `/plugins/events` **[V]** — so UI changes reach the open page in well under a second, no restart.
- **Host half does not.** The base composition's host `hmr` row is `disabled: true` **[V]** (`dsh-base\cordis.patch.yml:21–25`); `patchReload: live` watches config only. Any `src/host/**` change needs a GUI restart.

---

## 3. Mapping: reference element → current DSH component

| # | Reference element | Current DSH capability | Verdict |
|---|---|---|---|
| 1 | Top bar: brand, search + `Ctrl K`, Local, model chip, bell, gear, avatar | Shell chrome. **No seat exists** in the live tree (root → `main`, `sidebar`, `rightbar`, `shell.overlay`) **[V]** | **Shipped / not extensible.** Already present; do not touch (upstream edit) |
| 2 | Sidebar nav rows (New Session, Chat, Trajectory, Workbench, Projects, Knowledge, Settings) with labels | Shipped sidebar in its expanded state (rail 56px ⇄ 264–420px) **[V]**; our `sidebar.panellist` entry supplies icon + `label` ("Workbench", order 40) | **Shipped + already ours.** Label is projected by the sidebar; nothing to build |
| 3 | Workspaces list, section header, relative times, nesting | `sidebar.workspaces` (shipped WorkspaceBrowser) — `replaceRisk: shadows-shipped-ui` **[V]** | **Shipped.** Restyling = replacing shipped UI → avoid |
| 4 | Panel header (icon tile, title, subtitle, right icon) | Our panel renders its own chrome; `usePanelInfo` reports the active panel | **New UI in our panel** |
| 5 | Project chip, path, branch pill, Clean pill, Add Project | Project `<select>` + Add project + Forget exist today; branch/Clean have no data source | **Extend ours + new host data** |
| 6 | Tab strip: numbers, preset glyph, label, close ×, `+` | Ours. Numbers/accents/close exist after V1.1 (`hintForIndex`, `session.accent`, `send({t:'remove'})`) | **Extend ours** (`+` spawn menu) |
| 7 | Terminal card: own header, cwd chip, Clear, copy, `…` | Ours has no card header; xterm host is module-scope | **New UI wrapping the same xterm host** |
| 8 | cwd chip changes the terminal's directory | A live PTY cannot be chdir'd from outside | **Constraint.** Display + "open new terminal here"; never inject `cd` into a running TUI |
| 9 | Dock: Chat/Context tabs, suggestion chips, composer, model chip, send | `ctx.conversation.send` + `input.for(actx)` via `ctx.sessions.scope(id)` **[V]**; the *real* composer cannot be mounted outside the Conversation panel | **New UI, real functionality** (see §5.4) |
| 10 | Right column: Project Info / Recent Files / Quick Actions / Active Terminals | Right-column tab type via `ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab`/`.title` **[V]**, precedent: `dsh-client-ui-sidebar-files`, `dsh-client-ui-sidebar-documentpreview` | **New tab type — supported** |
| 11 | Active Terminals durations (12m, 8m, 3m) | Host summaries already carry `startedAt`, `label`, `accent`, `status` **[V]** | **Pure client** (already in `state.sessions`) |
| 12 | Recent Files + relative times | None. `uiWorkspace.listDirectory` exists but its entry shape (`DirectoryListing`) is not declared anywhere in this install **[U]** | **New host capability** (safer than guessing the type) |
| 13 | Quick Actions: Open in Explorer / Open in VS Code | `dsh-client-ui-open-in-app` exists, but it is an internal controller class posting to a host route — **not** a public client service **[V]** | **New host capability** (fixed whitelist) |
| 14 | Run Tests / View Logs | We already spawn PTYs per preset | **Reuse the PTY registry**: a "Run tests" session in the project dir; "View logs" = scrollback or omit |
| 15 | Push button | Requires a mutating, network, credential-prompting operation | **Out of scope.** Map to typing `git push` into a terminal, or omit |
| 16 | Model chip (`DeepSeek-V4-Flash`) in dock and top bar | Top bar = shipped. Composer model seat is `conversation.input.model`, `single` + `shadows-shipped-ui` **[V]** | **Display-only in our dock** (or omit); never replace the shipped selector |
| 17 | `Context` tab | No public API to attach terminal content (and it must not exist) | **Redefine** as workspace/file context, or drop |
| 18 | Green "Clean" / "Ready" / "Local" dots | `StateDot`, `ConnectionIndicator` primitives **[V]**; status colours in tokens | **Reuse primitives** |
| 19 | Icons throughout (branch, folder, copy, ellipsis, send, panel, play…) | 60-icon set in primitives (`IconBranch`, `IconCopy`, `IconEllipsis`, `IconSend16`, `IconPlay`, `IconPanelLeft`, …) **[V]** | **Reuse** |

---

## 4. Reusable existing components (verified inventory)

### 4.1 `@deepseek-ai/dsh-client-ui-primitives` — 123 runtime exports **[V]**

Already in our `build.mjs` externals list, so importing it is wired — **but the package has no directory and no `.d.ts` in this install**: it exists only inside the shell bundle, whose frozen baseline table maps `@deepseek-ai/dsh-client-ui-primitives → Zg` **[V]**. There is no source to typecheck against, and no `.d.ts`, so names are verifiable only at runtime.

- **Buttons**: `Button` (the only one — no separate icon button).
- **Inputs**: `Input`, `Switch`.
- **Overlays**: `Menu`, `Tooltip`, `HoverCard`, `Modal`, `Toast`, plus `useAnchoredPosition`, `useAnchoredMaxHeight`, `useDismissOnOutsidePointer`.
- **Badges/status**: `Pill`, `Tag`, `StateDot`, `ConnectionIndicator`.
- **Lists**: `DisclosureRow` (the only list/section primitive).
- **Formatting**: `relativeTime` (the reference's "2h ago"/"12m"), `fileSizeText`, `fileExtension`, `classifyFileType`, `classifyLinkPath`, `writeClipboard`.
- **Glyphs**: `FileTypeIcon`, `ReferenceIcon`, `LinkIcon`, `BrandWordmark`, `FishLogo`, and the 60-icon set.
- **Content viewers**: `CodeBlock`, `JsonBlock`, `JsonTree`, `MarkdownText`, `DiffBlock`, `ReadBlock`, `SearchBlock`, `TerminalBlock`, `WebBlock`, `RiskConfirmation`, `OnboardingSurface`.
- **Not exported**: generic Card/Surface/Panel, Tabs/SegmentedControl, any layout primitive (Stack/Row/Spacer/ScrollArea/Split), any typography component, empty state, and any `cx`/`clsx` helper.

### 4.2 Theme tokens — 357 `--dsw-*` names **[V]**

Usable as raw CSS custom properties (documented in `dsh-client-ui-theme/README.md`, declared in its compiled sheet). Only **13** are overridable through `ctx.theme` **[V]**. The subset that directly serves this redesign:

- Surfaces: `--dsw-alias-bg-base`, `-bg-layer-1/-2/-3`, `-bg-overlay`; `--dsw-specific-sidebar-fill`, `-sidebar-nav-item-active(-accent)`, `-menu`, `-selector`, `-bubble`, `-input-major`.
- Text: `--dsw-alias-label-primary`, `-secondary`, `-tertiary`, `-caption`.
- Borders: `--dsw-alias-border-l1/-l2/-l3/-l4`, `--dsw-elevation-stroke`.
- Accent/buttons: `--dsw-alias-brand-primary`, `--dsw-alias-button-primary-fill/-primary-hover/-ghost-active-fill/-tool-bar-fill`.
- Status: `--dsw-alias-state-success-primary`, `-error-primary`, `-warn-primary`.
- Type: `--dsw-font-family`, `--dsw-font-xs-13*`, `--dsw-font-xxs-12*`, `--dsw-font-m-18*`, `--dsw-font-l-20*`.
- Shape/elevation: `--dsw-elevation-panel`, `--dsw-shadow-lv1/-lv2`, `--dsw-corner-shape`.

Our current panel CSS uses `color-mix(in srgb, currentColor N%, transparent)` for every border and background — it inherits the app's *text* colour rather than the design system. Migrating to these tokens is the single highest-leverage visual change in the whole redesign.

### 4.3 Slot system **[V]**

`ctx.slots.register(options, Component) => disposer`; per kind `key` (keyed) / `id` (list) / `select` (chain); `ctx.slots.inject(key, cb)` waits for the declaration. There is **no exported React component or hook to render a slot** — an occupant renders only the children its own entry declared, through a `renderSlot` prop. Consequence: **we cannot mount the real composer (or any conversation slot) from `main[workbench]`**, because our key did not declare those children.

### 4.4 Right-column tab type **[V]**

Two stages, exactly as `dsh-client-ui-sidebar-files` does it:

1. `ctx.sidebarRightTabs.register({ id, kind, title, guide? , patterns?, canOpen?, priority? })` — a *page* type omits `patterns` and is opened by `kind`.
2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, Body)` and the same for `sidebar.right.pane.tab.title`.

Then `ctx.sidebarRight.openTab(kind)` claims, places, records and **expands the column in the same step**. Tab bodies are session-scoped and receive `sessionId` plus the session standard props.

### 4.5 Conversation input **[V]**

`ctx.conversation.send(text)` (scope-addressed, returns a Promise), `ctx.conversation.input.for(actx)` → `setDraft/addAttachments/removeAttachment/pruneAttachments/submit/notify/state`, `ctx.conversation.cancel()`. The real composer is a Lexical editor bound to the Conversation shell; it is explicitly not reachable across a plugin boundary.

### 4.6 Ours, already built (no work)

`src/client/keymap.js` (binding grammar, matching, target resolution, persistence, `hintForIndex`), the module-scope session store and socket, the xterm records with scrollback re-attach, the tab bar, project selector, preset buttons, custom command row, and the V1.1 `Keys…` editor.

---

## 5. Components requiring implementation

### 5.1 Inside our panel (client-only, zero restart)

| Component | Notes |
|---|---|
| `PanelHeader` | icon tile + title + subtitle + right action; fed by `usePanelInfo`/`useWorkspaces` |
| `ProjectBar` | extends today's toolbar; branch/Clean pills gated on §5.3 |
| `SessionTabs` | adds the `+` spawn menu; keeps V1.1 number badges and `hintForIndex` tooltips |
| `TerminalCard` | header row (label, cwd chip, Clear, copy, `…`); **must keep the module-scope xterm host node identity** — the redesign's top regression risk |
| `SessionDock` | Chat/Context tabs, chip row, composer; drives `ctx.sessions.scope(id).conversation.send()` |
| Local helpers: `Card`, `SectionHeader`, `ListRow`, `TabStrip`, `EmptyState` | primitives exports none of these; build once, small, token-driven |
| Token CSS | replace `color-mix(currentColor…)` with `--dsw-*` |

### 5.2 Right-column tab (client-only)

One tab type (`kind: 'workbench.project'`, `id: 'dsh-workbench'`) whose body renders four cards: Project Info, Recent Files, Quick Actions, Active Terminals. It shares our module-scope store (same bundle), so "Active Terminals" is live data and clicking a row calls the existing `setActive(id)` — no second transport.

### 5.3 Host capabilities (one restart)

| Capability | Shape | Cost/risk |
|---|---|---|
| `gitStatus(projectId)` | `execFile('git', ['status','--porcelain=v2','--branch'], {cwd})`, TTL-cached per project | read-only; must never run from the model (no tool registration) |
| `recentFiles(projectId, limit)` | bounded `readdir`+`stat` walk, skip `node_modules`/`.git`, depth 2 | read-only; cap rows and depth |
| `quickAction(projectId, actionId)` | fixed whitelist: `explorer`, `vscode` (detached spawn); `runTests` spawns a normal workbench session in that cwd | the only new execution vector — whitelist + user-initiated only |
| protocol | new request/response pairs over the existing authenticated WebSocket, same route, same fence | no new route, no auth change |

### 5.4 The dock — feasible, with one honest caveat

Feasible because `ctx.sessions.scope(sessionId)` returns the session Context and `ctx.conversation.send(text)` is documented and shipped for exactly that addressing style **[V]**. The caveat: we build **our own** composer; the shipped Lexical composer cannot be embedded (§4.3). Our composer sends user-authored text and nothing else; `notify()` lets a result land on that session's real composer.

Consequence for the "Context" tab and the chips: they can be *prompt templates* and *workspace context*, never terminal output (§1.5).

### 5.5 Not achievable without upstream change

| Want | Why | Workaround |
|---|---|---|
| The real composer embedded in our panel | no slot-render API for a panel that did not declare those children **[V]** | our own composer + `conversation.send` |
| Centre column split (terminal above, chat below) | the frame grid is `sidebar \| center \| rightbar`; no split capability **[V]** | dock inside our panel, or the Conversation panel beside the right column |
| Restyling the top bar, sidebar nav, workspaces list | no seat (`replaceRisk: none` nowhere near them) **[V]** | leave shipped chrome alone |
| Changing a *running* shell's directory | PTY has no chdir | display + "open new terminal here" |
| A working Push button | mutating/network/credential flow outside this package's remit | type `git push` in a terminal |

---

## 6. Proposed file changes

**Recommended shape: extend `dsh-workbench`, do not create a second package, and never patch upstream.**

Rationale: the composition row already exists (`cordis.patch.yml` → `dsh-workbench`), so client changes hot-reload with **no restart and no composition edit**; a second package would need a new bundle row (restart) and would duplicate the socket and the registry.

### Phase 1 — client-only (no restart, HMR takes effect in <1 s)

| File | Change |
|---|---|
| `src/client/index.jsx` | register seats only; mount panel + right-column seats; keep store/socket wiring |
| `src/client/ui/PanelHeader.jsx` *(new)* | header |
| `src/client/ui/ProjectBar.jsx` *(new)* | toolbar; branch/Clean gated behind capability probe |
| `src/client/ui/SessionTabs.jsx` *(new)* | tab strip + `+` spawn menu (moves current tab code) |
| `src/client/ui/TerminalCard.jsx` *(new)* | card header around the existing module-scope xterm host |
| `src/client/ui/SessionDock.jsx` *(new)* | chips + composer → `sessions.scope(id).conversation.send()` |
| `src/client/ui/primitives.jsx` *(new)* | local `Card`, `SectionHeader`, `ListRow`, `TabStrip`, `EmptyState` |
| `src/client/ui/tokens.css.js` *(new)* | `--dsw-*`-based stylesheet (replaces `PANEL_CSS`) |
| `src/client/rightpanel/projectTab.jsx` *(new)* | tab definition + body + title for `ctx.sidebarRightTabs` |
| `src/client/keymap.js` | unchanged (V1.1 preserved) |
| `build.mjs` | externals already include the baseline table; no change expected |
| `test/*.test.mjs`, `verify.mjs` | new tests + bundle assertions for the new UI/seat wiring |

### Phase 2 — host additions (one planned restart)

| File | Change |
|---|---|
| `src/host/session.js` | `gitStatus`, `recentFiles`, `quickAction` (whitelist), bounded and cached |
| `src/host/index.js` | new message types on the existing authenticated socket |
| `src/client/store.js` *(new, optional)* | extract the module-scope store from `index.jsx` |
| `test/host.test.mjs` *(new)* | git parse, recent-file bounds, whitelist rejection |
| `README.md` | V2 section: capabilities, shortcut/config docs, security table update |
| `verify.mjs` | extend for the new protocol + host exports |

**Composition changes: none** (`cordis.patch.yml` and the profile's `package.json` stay as they are). If we later split the UI into `dsh-workbench-ui`, that *does* add a bundle row → composition edit + restart.

---

## 7. Risks to upstream compatibility

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | `conversation`, `uiConversation`, `sidebarRight`, `sidebarRightTabs` are **outside the Inspect service catalog** — real, but not part of the queryable contract, so they may change between DSH versions **[V]** | High | `ctx.get(...)` + absence checks; hide the dependent UI when a service is missing; re-verify after each DSH upgrade |
| 2 | `sidebar.right.pane.tab` is keyed by the tab definition's `id`; a mismatch renders an **empty tab, silently** **[V]** | Medium | one constant used for both; a verify.mjs assertion |
| 3 | `ctx.sidebarRight.openTab` "fails loudly" with no mounted seat — and the right column needs an active Session **[V]** | Medium | guard in try/catch; only open when a session exists; fall back to the panel's own card |
| 4 | `main` keys other than `conversation` get **no session binding**, so `useInput`/`inputActions` are unavailable in our panel **[V]** | Medium | drive sessions through services (`sessions.scope`), never through session React context |
| 5 | Replacing a `replaceRisk: shadows-shipped-ui` seat deletes shipped UI and its descendant slots **[V]** | High | additive seats only; a lint-style check in verify.mjs that our registrations never target a shadowing seat |
| 6 | Only 13 tokens are overridable; the other ~344 are use-only **[V]** | Low | read tokens; never override the global theme (also the skill's guidance) |
| 7 | The three baseline externals have **no `.d.ts` and no source** in this install — no typechecking, names verified only at runtime **[V]** | Medium | keep the imported surface minimal; assert the symbols in `verify.mjs`; fail soft if an import is missing |
| 8 | Client HMR means a broken build reaches the live UI in <1 s **[V]** | Medium | keep the current gate: build → `node --check` → `verify.mjs` → only then write the watched `lib/client.js` |
| 9 | Host additions widen the package's deliberately unconfined surface | High | fixed action whitelist, read-only git/fs, no new tool registration, no model reachability; document in the README security table |
| 10 | `dockkit`'s pane/strip components presuppose the right sidebar's whole store/intent/label assembly **[V]** | Medium | do not reuse `DockSurface`; build a simple tab strip from primitives |
| 11 | xterm host node identity: re-mounting it drops browser-side scrollback (PTYs survive) | Medium | keep `ensureHost()` module-scope and render a stable container; assert in tests that `records` and the host node survive a re-render |
| 12 | Design fidelity: the shell's sidebar (264–420, default 280) and right column (≥300) are wider than the reference's proportional ≈225px / ≈260px | Low | accept, or set defaults that bias toward the reference's columns |

---

## 8. Feasibility verdict

**Achievable with the current plugin architecture — no upstream change required — for everything except the four items in §5.5.** The two elements that looked riskiest are both supported:

- the right-column card stack → a documented, precedented tab-type registration (`sidebar-files` does exactly this) **[V]**;
- the embedded composer → a documented, shipped scope-addressed call path (`ctx.sessions.scope(id).conversation`) **[V]**.

### Spikes to run before any implementation (in this order)

| Spike | Question | Accept when |
|---|---|---|
| **S1** | Does a right-column tab type render beside `main[workbench]`, and does `openTab` expand the column? | a card is visible in the right column with the Workbench on screen |
| **S2** | Does `ctx.sessions.scope(id).conversation.send('ping')` from a root-scope button start a real turn in that session? | the user message appears in the Conversation; no root-context error; `input.for(actx).notify()` lands in that session |
| **S3** | Host: `git status --porcelain=v2 --branch` per project, cached, correct for `jobsift` | branch + clean/dirty correct, <300 ms after cache |

S1 and S2 are client-only and cost no restart. S3 needs a restart, so it belongs to Phase 2.

---

## Appendix A — evidence index

| Claim | Source |
|---|---|
| Frame renders `main` keyed by `activePanelId`; columns independent of the main key | `…\dsh-client-ui-layout\lib\client.js:107–128`, doc `:90–105` |
| Column geometry: rail 56, sidebar 264–420, rightbar 0 or 300–70%, collapse <1024 | `…\dsh-client-ui-layout\lib\client.js:13–43` |
| `main` standard props; "other keys receive no Session binding" | Cordis `Slots.listSubTree(root='main')` catalog |
| `sidebar.panellist` owner props `{size, active}`, label projected by the sidebar | `Slots.listSubTree(root='sidebar.panellist')` |
| Right-column tab registry, two-stage registration, expansion on open | `…\dsh-client-ui-sidebar-right\lib\types\client\{service,tab-registry}.d.ts`; `…\dsh-client-ui-sidebar-files\lib\types\client\index.d.ts:1–12` |
| `sidebar.right.pane.tab` props/keys; `rightbar.session` scope + owner props | `Slots.listSubTree(root='rightbar.session')` |
| `conversation.send`, scope addressing, `input.for(actx)`, `InputActions` | `…\dsh-client-ui-conversation\lib\types\client\service.d.ts:20–56`; `…\contract\input.d.ts:171–221` |
| Shipped scope-addressing call shape | `…\dsh-client-ui-conversation\lib\client.js` (`sessions.scope(sessionId)`, the "requires a session scope" error) |
| Primitives/dockkit/slots export inventory; no `.d.ts` | agent audit of `…\dsh-web-frontend\dist\assets\index-BKQ_L1z6.js` frozen namespaces |
| 357 `--dsw-*` tokens; 13 overridable | `…\dsh-client-ui-theme\lib\client.js`, `README.md:54–62`; `Theme.listTokens` |
| Host module HMR disabled | `…\dsh-base\cordis.patch.yml:21–25` |
| Client bundle HMR live | `…\dsh-client-hmr\lib\index.js`, `lib\client.js` |
| Session summary already carries `startedAt`/`accent`/`status` | `dsh-workbench\src\host\session.js:115–133` |
| Security boundary "no model path to these terminals" | `dsh-workbench\README.md` security table |

## Appendix B — decisions I need before implementing

1. **Dock**: build our own composer that really sends (feasible, §5.4) — or keep agent chat in the Conversation panel and leave the dock out?
2. **Chips**: send immediately, or prefill the dock and let you confirm with Send? (I recommend prefill.)
3. **`Context` tab**: workspace/file context, or drop it? (Terminal output is excluded by the security boundary.)
4. **Run Tests / View Logs**: spawn a terminal running the project's test command, or omit?
5. **Push**: omit, or "type `git push` into the active terminal"?
6. **Model chip in the dock**: display-only, or omit?
7. **Phasing**: Phase 1 client-only first (no restart), then Phase 2 host (one restart) — agreed?
8. **Fidelity**: accept a ≥300px right column and the shipped 280px sidebar, or should I bias the defaults toward the reference's narrower columns?
