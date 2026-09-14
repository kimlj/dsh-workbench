# A real cockpit shell — architecture recommendation

**Status: analysis only. Nothing implemented, nothing changed.**
`dsh-cockpit-theme` is retained as-is: it proved the limit of non-structural theming and remains a useful, independently disableable layer.

---

## 1. The decisive constraint (this decides everything)

The live `root` slot catalog says, verbatim:

> OCCUPIED by ui-layout's AppFrame, which declares the sidebar, conversation, details, and shell.overlay seats inside it.
> **DO NOT register here.** This is a single slot, so a second entry does not sit beside the frame — it shadows it… **the page would render your component alone, with every seat the frame declares gone.**

Three facts follow, and together they eliminate two of the four options:

1. **The child seats are declared by the `root` occupant.** `dsh-client-ui-layout`'s own docs: "one `register()` call contributes AppFrame into the runtime's built-in `root` slot and, **in the same breath, declares the four child slots (declaration = exclusive render authority)**". So `sidebar`, `main`, `rightbar` and `shell.overlay` exist **only while that one registration exists**. Shadow `root` at runtime and every panel, rail, seat and plugin registration below it disappears.
2. **The shipped frame cannot be imported.** The shell's frozen baseline externals are `react`, `react-dom`, `cordis`, `dsh-client-store`, `dsh-client-ui-slots`, `dsh-client-ui-primitives`, `dsh-client-ui-dockkit`. `dsh-client-ui-layout` is **not** among them, so a third-party bundle cannot `import` `AppFrame` and render the shipped frame inside its own chrome. "Wrapping" is not available — only taking over the seat.
3. **Two more critical things live in that same plugin.** Its `apply()` also (a) **provides `ctx.layout`** (the `ILayout` service used by our Workbench and by other plugins) and (b) **seats the theme presenter**, which projects `ctx.theme` snapshots onto `document.body` — i.e. the mechanism `dsh-cockpit-theme` depends on to apply its token overrides. It also supplies the `usePanelInfo` panel-info source to every occupant. Replacing the frame means owning all three.

**Conclusion: the only structurally sound way to own the frame is to own the `ui-layout` row — disable it in composition and mount our own frame in its place.** Runtime shadowing is documented self-destruction; and there is no seat for a top bar other than being the frame owner.

---

## 2. What a frame owner actually owns — the re-mount map

Exact contracts, read from the live slot catalogs and the layout package's types. A replacement frame must satisfy **all** of these or shipped UI breaks:

| Obligation | Contract | Consumer |
|---|---|---|
| Declare `sidebar` (single) | owner props **`{ collapsed: boolean, width: number }`** (`SIDEBAR_COLLAPSED` when collapsed) | `ui-sidebar`'s SidebarRoot |
| Declare `main` (keyed) | no owner props; dispatch with **`entryKey = activePanelId ?? 'conversation'`** | Conversation, **our Workbench**, any panel |
| Declare `rightbar` (single) | owner props **`{ width, viewportWidth, canShow }`** | `ui-sidebar-right`'s RightbarRoot |
| Declare `shell.overlay` (list) | no owner props; click-through layer | toasts/badges (none today) |
| Provide `ctx.layout` | `selectPanel(panelId)`, `beginNavigation()`, `toggleSidebar()`, `openRightbar(track, fullscreen)`, `closeRightbar()` | Workbench (`focusWorkbenchPanel`), many plugins |
| Provide the panel-info source | `usePanelInfo` global standard prop | every occupant that reads panel state |
| Seat the theme presenter | projects theme snapshot → `document.body` inline tokens + `data-ds-dark-theme` + content font size | **`dsh-cockpit-theme`**, and all theming |
| Own the column solve | rail 56px; sidebar clamp 264–420 (default 280); auto-collapse < 1024; rightbar `0` or clamp 300–`viewport × 0.7`; drag handles (pointer capture + rAF); `grid-template-columns` inline | the frame's own geometry |

That is the complete surface. It is **small, fully documented, and finite** — which is what makes a vendored fork safe rather than reckless.

---

## 3. Options compared

| | **A. New frame-owning plugin (mount/reuse panels)** | **B. Replace/wrap the shipped root via composition** | **C. Separate `dsh-cockpit` frontend** | **D. Minimal maintained fork of only the shell component** |
|---|---|---|---|---|
| **Reference reproduced structurally?** | **Yes** — we own all app DOM: real top bar, outer chrome, composition | Only as "disable upstream and own the seat"; wrapping is impossible (§1.2) | Yes, with unlimited freedom | **Yes** — vendored frame + our chrome |
| **Chat / Trajectory / Settings / Workspaces / plugins reused?** | **Yes, unchanged** — they are separate plugins that `inject` into the seats we declare | Yes **only** if upstream is disabled first; a live shadow disposes their registrations | Yes in principle; requires reproducing the module loader + externals table | **Yes, unchanged** (same seat table, same owner props) |
| **Workbench unchanged internally?** | **Yes** — it uses `main`, `sidebar.panellist`, `sidebar.right.pane.tab*`, `ctx.layout.selectPanel`; all provided | Yes | Yes | **Yes** |
| **Upgrade risk** | Medium-high: implicit contracts (§2) must be mirrored | **High** — same contracts plus lifecycle/cascade unknowns | **Very high** — internal boot/module-loader/handshake protocol | **Medium** — one package to re-diff; contracts already pinned by a test |
| **Upstream code duplicated** | ~0 if vendored, ~600 lines if rewritten | ~0 (but fragile) | **The entire frontend shell + runtime glue**, whose source is not in the install (dist only) | **One small package (~577 readable lines)** as an unmodified base + a small patch |
| **Community distributable?** | Yes — a bundle-patch package | Risky to ship: depends on disable-ordering | Heavy: users must run a custom frontend served by a host patch | **Yes** — `dsh plugin add` + restart, with a compatibility table |
| **Clean disable/revert** | Re-enable `ui-layout`, disable ours | Same, if implemented as disable+own | Remove the host patch and the frontend — larger blast radius | **Two composition rows flipped** |

**Rejected outright**
- **B as runtime shadowing** — the catalog documents it as "your component alone, with every seat gone".
- **C** — the shell bootstrap source is not available (published `dist/` only); reproducing the loader, externals table, auth/connection handshake and boot injection maximizes duplicated surface and concentrates all upgrade risk in one place.
- **Patching installed `@deepseek-ai/*` files (D-as-postinstall)** — invisible to npm, clobbered by any reinstall, impossible to version, and it violates the "don't edit installed packages" rule you set earlier.

---

## 4. Recommendation: **A, realized as D** — a vendored, minimally-patched frame package

They are the same seat; the difference is *how much of the shipped frame we write ourselves*. Vendoring the readable upstream frame and patching it is ~600 lines duplicated, versus a from-scratch frame of comparable size plus every implicit contract re-derived. Vendor, patch minimally, verify the contracts.

**Shape**

```
dsh-cockpit-frame/
  vendor/ui-layout.base.js          # byte-identical upstream client bundle, checksum-pinned
  patches/ui-layout.patch           # our modification, as a reviewable patch
  src/frame/AppFrame.jsx            # our frame: [top bar][columns][optional status bar]
  src/frame/TopBar.jsx              # NEW UI: brand, search, status, model, notifications, avatar
  src/frame/layout-service.js       # ctx.layout + panel-info source, semantics preserved
  src/frame/theme-presenter.js      # preserved verbatim in behaviour (dsh-cockpit-theme depends on it)
  cordis.patch.yml                  # disable ui-layout, insert cockpit-frame
  build.mjs / verify.mjs / test/    # checksum + contract gates
```

**Composition (the whole activation story)**

```yaml
- id: ui-layout
  disabled: true          # the shipped frame stands down
- insert:
    - id: cockpit-frame
      name: dsh-cockpit-frame
```

Patch semantics support exactly this ("id-targeted config overrides, **disables**, and insert lists"), and row addressing is by id with the last write winning.

**Why this is the minimum-ownership answer**
- **Duplicated upstream code: one package** (~577 lines, readable, non-minified). The diff we *maintain* is far smaller — the modified surface is AppFrame's render (add the chrome, wrap the grid in a vertical stack) plus the constants we deliberately change.
- **Zero duplication** of sidebar, right bar, conversation, composer, dockkit, settings, workspaces, primitives, theme sheets: they are separate plugins that keep registering into the seats our frame declares.
- **The contracts are pinned by tests**, not by hope: a contract test asserts the four seats exist with the right kinds and owner-prop shapes, that `ctx.layout` answers all five methods, that `usePanelInfo` is present in occupant props, and that the theme presenter still projects a snapshot onto `document.body`. A DSH upgrade that moves any of them fails loudly instead of half-rendering.

---

## 5. Reuse map — what keeps working untouched

| Feature | Why it survives |
|---|---|
| **Chat / Conversation** | Registers into `main[conversation]` and declares its own `main.conversation` subtree; our frame renders `main` with the same `entryKey` dispatch |
| **Trajectory** | A `conversation.view` entry inside the conversation subtree — two levels below the frame, untouched |
| **Settings** | The shipped `sidebar.settings` seat inside SidebarRoot, which our frame mounts with the same `{collapsed, width}` |
| **Workspaces** | `sidebar.workspaces` occupant; same seat, same owner props |
| **Panellist (Chat, Trajectory, Projects, Knowledge, **Workbench**)** | `sidebar.panellist` list; the frame only renders the column |
| **Right rail** (files, document preview, **our Workbench tab**) | `rightbar` → `rightbar.session` → `sidebar.right.pane.tab`, all declared/rendered as today |
| **Every other plugin** | Anything using `ctx.layout`, `usePanelInfo` or a slot keeps working, because those are provided by us with identical semantics |
| **`dsh-workbench`** | **Zero changes.** It uses `main[workbench]`, `sidebar.panellist`, `sidebar.right.pane.tab*`, `ctx.layout.selectPanel`, `ctx.sessions`, `ctx.sidebarRight*`, and its own host/WS. It cannot tell whether the frame around it is shipped or ours |
| **`dsh-cockpit-theme`** | Keeps working — provided our frame preserves the theme presenter (a hard requirement in §2, and a test in §4) |

**Newly owned UI (not duplicated, genuinely new):** the top bar (brand, search, connection/status, model, notifications, avatar), the outer chrome/padding/gaps, and an optional status bar. Every control in it binds to an existing service (`sessions.search`, `uiWorkspace`, `theme`, `locale`, …). One open item: whether a *global* model control has a service to bind to, or whether the top bar shows it display-only — to be verified before building.

---

## 6. Security boundary (unchanged by construction)

- The frame is a **client UI plugin**: it touches DOM, slots, `ctx.layout` and `ctx.theme` and nothing else. No host half, no route, no process, no filesystem.
- It does **not** touch the Workbench host, its WebSocket, or its PTY registry. The workbench's own boundary — *no model-facing tool, no `ctx.terminals`, no path from the agent to a human shell* — is untouched, because the frame never enters that path.
- The top bar must not become a PTY surface: no terminal content enters it, and nothing in the frame is registered as a model tool.

---

## 7. Risks and their mitigations

| Risk | Mitigation |
|---|---|
| Owning the frame means a bug blanks the app | Vendored base + small patch; the frame renders shipped seats for everything it does not own; a contract test runs before every build |
| A DSH upgrade changes a frame contract | Checksum-pinned base + contract tests that fail loudly; the re-sync procedure is "diff the new upstream `ui-layout` against the pinned base, re-apply the patch" |
| Forgetting the theme presenter silently breaks all theming (including `dsh-cockpit-theme`) | It is an explicit obligation in the §2 map and a contract test |
| `ctx.layout` semantics drift | Five methods, reproduced exactly; a test asserts each is callable and that `selectPanel` drives the rendered panel |
| Composition ordering (our patch must land after `dsh-web-app`) | Bundle patches apply in `dsh.profile.bundles` order; ours is appended last, as `dsh-workbench` already is |
| Community users on a different DSH version | README compatibility table (DSH version ↔ base checksum) and a refuse-to-start check when the base checksum does not match |

---

## 8. Open items to verify before building (cheap, read-only)

1. **Top-bar model control** — is there a global model-selection service, or does the top bar show it display-only / omit it?
2. **Search** — does a global search surface already exist as a dialog (Ctrl+K) that the top bar should open rather than reimplement?
3. **`usePanelInfo` source** — confirm how the layout plugin contributes it (`provideRoot` vs internal), so we contribute it identically.
4. **Notification/bell equivalent** — check whether any shipped plugin owns a notification surface; if not, the bell is new UI or omitted (as the earlier probes already suggested for the icon set).
5. **`SIDEBAR_COLLAPSED` and the solve constants** — read the vendored base to confirm the exact values we must preserve.

---

## 9. Recommendation in one sentence

**Disable the shipped `ui-layout` row in our bundle patch and mount `dsh-cockpit-frame`: a vendored, checksum-pinned copy of the readable ~577-line layout plugin carrying a small reviewable patch, which declares the same four seats with the same owner-prop contracts, provides the same `ctx.layout` and theme presenter, and adds the composition the reference actually needs — a real top bar and cockpit chrome — while every shipped panel, setting, workspace, plugin and `dsh-workbench` itself keeps running unchanged.**
