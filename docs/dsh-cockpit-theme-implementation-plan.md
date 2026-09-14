# `dsh-cockpit-theme` — probe results and final implementation plan

**Status: plan only. Nothing created, nothing modified.** No file in DSH, `dsh-workbench`, the profile, the composition, or any installed `@deepseek-ai/*` package was touched. Every probe below was read-only static analysis of the installed bundles.

Target architecture: **D2** — a separate, additive client plugin, layers **L0 tokens → L1 one owned stylesheet → L2 additive decoration**. The existing Workbench V2 is preserved unchanged and is the *only* Workbench: the centre of the reference is today's Workbench rendered inside a restyled shell.

---

## Part 1 — Probe results

### P1. Header DOM — **a global top bar does not exist in the shipped shell**

- **No seat**: the live slot tree is `root → main, sidebar, rightbar, shell.overlay`. There is no header/topbar seat. **[V]**
- **No chrome class**: every `_header_*` class in the app CSS belongs to **content components**, not shell chrome — `_block_1gdtu_1 / _header_1gdtu_32 / _prompt_1gdtu_70` (a tool-prompt block), `_block_1h7p4_1 / _summary_1h7p4_22 / _copyButton_1h7p4_32 / _header_1h7p4_12` (a diff block), `_dialog_w1urq_22 / _content_w1urq_37 / _header_w1urq_45 / _title_w1urq_53 / _close_w1urq_61` (a dialog). No suffix matching `brand|search|model|rail|top|shell|chrome|nav|sidebar|title` exists anywhere in the app CSS. **[V]**
- **No header row in the layout**: the frame is a three-column grid whose only grid declaration is the column track; there is no `grid-template-areas`/header row. **[V]**
- Corroborating: the bundled icon set has no bell glyph. **[V]** (primitives inventory)

**Conclusion: the reference's top bar is largely synthetic.** It cannot be styled because it does not exist, and it cannot be *added* honestly: no seat exists, and adding a fixed strip through `shell.overlay` would float over the frame rather than push it down (the frame's grid is inline-styled — see P4).

### P2. Token override surface — **broad, and validated by shape, not by name**

The implementation is **[V]**:

```js
overrideTokens(source, tokens) {
  const layer = { seq: this.overrideSeq++, tokens: validateOverrides(source, tokens) }
  this.overrides.set(source, layer); this.publish()
  return () => { if (this.overrides.get(source) !== layer) return; this.overrides.delete(source); this.publish() }
}
```

and `validateOverrides` enforces **only** that each value is a `{ light, dark }` pair of strings, with a teaching error for a bare string. **There is no allowlist of token names.** **[V]**

- The theme sheet declares **79 `--dsw-alias-*`** names (surfaces, masks, borders L1–L4, brand, button fills, labels, states) out of 357 `--dsw-*` names total. **[V]**
- The Inspect provider advertises only **13** as overridable — that is a *documented subset*, not the API's limit. **[V]**
- Alias values are applied **inline on `<body>`** by the layout presenter (`body.style.setProperty`, with an `appliedTokens` clear-and-reapply cycle), while the sheet also carries `body{--dsw-alias-…}` defaults. **Inline wins**, so a stylesheet cannot recolour them — `overrideTokens` is the only correct tool. **[V]**

### P3. Font ladder — **sheet-declared, therefore stylesheet-overridable**

- **181 `--dsw-font-*` names** are declared in CSS rules with concrete values, e.g. `--dsw-font-xs-13-font-weight:400;--dsw-font-xs-13-line-height:20px;--dsw-font-xs-13-font-size:13px`. **[V]**
- **Zero** `--dsw-font-*` names appear anywhere as a JavaScript token key. **[V]**
- Therefore the ladder is *not* part of the inline application, and a later equal-specificity sheet wins without `!important`. **[I, high confidence]**
- The content font size is the exception: it is written inline (`body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, …)`) → use `ctx.theme.setFontSize(px)`. **[V]**

### P4. Grid-track behaviour — **inline, so column widths are not safely restylable**

```js
style: { gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px` }
```
**[V]** The resolved widths (sidebar rail 56 / 264–420 default 280; rightbar 0 or 300–70%) are written as an **inline style**. A stylesheet can only beat it with `!important` — and that would **freeze user resizing**, because the drag handler updates the same inline property. **[I, from the drag implementation]**

### P5. Nav-row internals — **there is a stable semantic hook: `aria-current`**

```jsx
<button type="button"
  className={clsx(SidebarRoot_module_css_default.panelRow, active && SidebarRoot_module_css_default.panelActive)}
  aria-label={label}
  aria-current={active ? "page" : undefined}
  onClick={() => selectPanel(id)}>
```
**[V]** The row is a real `<button>`, carries `aria-label`, and the active row carries **`aria-current="page"`**. The class names are hashed at build time (`SidebarRoot_module_css_default.*`) — the readable keys exist only in source.

### Supporting inventory (all **[V]**)

- **Layout class map** (hashed values, readable keys): `frame`, `sidebarCol`, `centerCol`, `rightbarCol`, `handle`, `overlayLayer`.
- **Stable `data-*` hooks**: `data-sidebar-collapsed`, `data-dragging`, `data-shell-overlay`, `data-side`, `data-rightbar-col`, `data-rightbar-collapsed`, `data-rightbar-fullscreen`, `data-rightbar-instant`, the `data-sidebar-right-*` family (`-open`, `-panel`, `-mode`, `-guide`, `-toggle`, `-expand`, `-float-host`, `-unavailable`), and a large `data-dockkit-*` family.
- **Theme root marker**: `data-ds-dark-theme` on `<body>`.
- **Shell-owned CSS variables**: `--dsh-sidebar-inline-padding`, `--ds-transition-duration*`, `--ds-ease-in-out`, `--ds-font-family-code`, `--dsh-scrollbar-*`.
- **Plugin CSS convention**: `<style data-plugin-css="<id>" data-plugin="<package>">`; the HMR chain removes `style[data-plugin]` on reload. Workbench already uses this mechanism.

---

## Part 2 — Region-by-region classification against the reference

| Reference region | Class | Achieved by | Why not higher |
|---|---|---|---|
| **Global surfaces / background** | **Exact** | L0 alias tokens (79 available) + `--dsw-static-*` sheet values | — |
| **Typography** | **Close** | L1 sheet override of the 181 `--dsw-font-*` ladder; `setFontSize` for content size | Per-component size *assignments* live in hashed rules; we move the ladder, we do not re-assign every element |
| **Left sidebar** | **Close** | L0 (`--dsw-specific-sidebar-fill`, borders, labels) + `--dsh-sidebar-inline-padding` + `[data-sidebar-collapsed]` | Interior row chrome is hashed; shape changes are Approximate |
| **Navigation rows** | **Close** | `button[aria-current="page"]` for active, `aria-label` for identity, plus L0 tokens | Hover/rest/focus shapes come from hashed classes; our Workbench row's *content* is ours, its chrome is not |
| **Workspaces section** | **Approximate** | L0 tokens only; `sidebar.workspaces` is a `shadows-shipped-ui` single seat we must not replace | No stable per-row hook was found; deeper treatment means either hashed selectors or shadowing shipped UI |
| **Right rail** | **Close** | `[data-sidebar-right-panel]` / `-open` / `-mode` scopes + L0 tokens | Interior card shapes are hashed |
| **Spacing / density** | **Approximate** | Shell-owned variables where they exist + `data-*`-scoped structural rules | There is **no density token**; most component padding lives in hashed rules, so global density is unreachable in one lever |
| **Column widths** | **Not safely achievable** | — | Inline `gridTemplateColumns`; overriding means `!important` that fights and freezes the drag handler |
| **Global header / top bar** | **Not safely achievable** | — | The surface does not exist: no seat, no class, no layout row. The mockup is synthetic here |
| **Centre Workbench integration** | **Exact** | Nothing to do: the panel already reads `--dsw-*`, so L0 restyles it automatically | — |

**Net:** the reference's *surface, colour, border, accent and type* language is reachable exactly; its *navigation, sidebar and right-rail* language is reachable closely; its *density* and *workspace list* only approximately; its *header* and *narrower rails* not safely. That is roughly the reference minus the invented top bar and the narrower chrome.

---

## Part 3 — Selector inventory: every hashed/private dependence

**Safe (ship these):** `[aria-current="page"]`, `[aria-label]`, `button`/element structure, `[data-sidebar-collapsed]`, `[data-rightbar-*]`, `[data-sidebar-right-*]`, `[data-dockkit-*]`, `[data-shell-overlay]`, `[data-ds-dark-theme]`, and our own `dshw-*`/`dct-*` classes.

**Hashed/private — each use is a maintenance liability:**

| # | Selector a redesign would want | Class it depends on | Decision |
|---|---|---|---|
| 1 | App frame background/border | `[class*="_frame"]` (layout map key `frame`) | **Avoid** — tokens cover surfaces |
| 2 | Per-column styling | `[class*="_sidebarCol"]`, `[class*="_centerCol"]`, `[class*="_rightbarCol"]` | **Avoid** — use `data-*` / tokens |
| 3 | Column resize handles | `[class*="_handle"]` | **Forbidden** — interactive chrome |
| 4 | Frame overlay layer | `[class*="_overlayLayer"]` | Use `[data-shell-overlay]` instead |
| 5 | Nav row rest/hover shape | `SidebarRoot_module_css_default.panelRow` | **Avoid** — use `[aria-current]` + tokens |
| 6 | Nav row active shape | `SidebarRoot_module_css_default.panelActive` | **Avoid** — use `[aria-current="page"]` |
| 7 | Content-block headers | `_header_1gdtu_32`, `_header_1h7p4_12` (tool-prompt / diff blocks) | **Forbidden** — these are *content*, not chrome |
| 8 | Dialog internals | `_dialog_*`, `_content_*`, `_title_*`, `_close_*`, `_header_w1urq_45` | **Forbidden** — dialog chrome, shared by every feature |
| 9 | Workspace/session rows | unnamed hashed classes in the sidebar package | **Avoid** |
| 10 | Right-rail cards | unnamed hashed classes in `sidebar-right` | **Avoid** — scope to `[data-sidebar-right-panel]` |

**Planned residual reliance: zero required hashed selectors.** The design is achievable with hooks + tokens only. If a future gap forces one, it goes into a single `PRIVATE_SELECTORS` block with a verification probe (below) — never scattered.

**Variable caveats to encode as rules:** never stylesheet-override `--dsh-content-font-size` (inline; use `setFontSize`); never `!important` the grid track; prefer `overrideTokens` for every `--dsw-alias-*` value.

---

## Part 4 — Final implementation plan

### Package shape (`dsh-cockpit-theme`, D2)

```
dsh-cockpit-theme/
  package.json          name + exports["."] + dsh.bundle.patch + dsh.client{platform:"web"}
  cordis.patch.yml      one additive row: { id: cockpit-theme, name: dsh-cockpit-theme }
  src/host/index.js     minimal no-op host half (no services, no tools, no capabilities)
  src/client/index.jsx  apply(): owns the three layers, all inside ctx.effect
  src/client/tokens.js  the L0 token table ({light, dark} pairs per alias token)
  src/client/layers/    surface.js  typography.js  density.js  navigation.js
  src/client/private.js optional, empty-by-default PRIVATE_SELECTORS block
  build.mjs / wrap.mjs  same esbuild + module-loader pipeline as dsh-workbench
  verify.mjs            bundle contract + token-shape + layer assertions
  test/*.test.mjs       token-table and selector-scope unit tests
```

No host capability, no tool registration, no protocol, no route, no PTY contact. The host half exists only so the composition row resolves.

### The three layers (all owned by one `ctx.effect`, all independently disposable)

**L0 — token layer.**
`ctx.theme.overrideTokens('dsh-cockpit-theme', TOKENS)`, where `TOKENS` is a table of `{light, dark}` pairs restricted to **semantic alias tokens** (`bg-base`, `bg-layer-1/2/3`, `bg-overlay`, `bg-mask-*`, `border-l1..l4`, `brand-primary`, `label-primary/secondary/tertiary/caption`, `button-*` fills, `state-*`, and `--dsw-specific-sidebar-fill`). Optionally also `ctx.theme.register({id:'cockpit-dark', colorScheme:'dark', tokens})` so the look is *selectable* in Settings rather than forced — recommend both: the layer gives immediate effect, the registered theme gives the user an exit.

**L1 — one owned stylesheet.** A single `<style data-plugin-css="dsh-cockpit-theme" data-plugin="dsh-cockpit-theme">` inserted in the plugin's effect, carrying three ordered blocks:
1. `1a-vars` — shell-owned variables (`--dsh-sidebar-inline-padding`, `--ds-transition-duration*`, `--ds-font-family-code`) and the `--dsw-font-*` ladder values (P3: safe without `!important`).
2. `1b-structure` — rules scoped to stable hooks only: `[data-sidebar-collapsed]`, `[data-rightbar-col]`, `[data-sidebar-right-panel]`, `[data-sidebar-right-open]`, `[data-shell-overlay]`, `[data-dockkit-strip]`, `button[aria-current="page"]`.
3. `1c-private` — empty. Reserved for any single selector that proves unavoidable, each with the DSH version and a comment.

Every rule is scoped under a body-level guard (e.g. `body[data-cockpit-theme]`) so the entire sheet can be neutralised by removing one attribute.

**L2 — additive decoration (optional, later).** `sidebar.brand.mark` / `sidebar.brand.name` for a cockpit brand treatment, `sidebar.footer.action` for a status chip, `shell.overlay` for non-interactive accents. Additive seats only — never `root`, `sidebar`, `sidebar.workspaces`, `rightbar`, or `main.conversation`.

### Phasing (each phase independently shippable and reversible)

| Phase | Content | Risk |
|---|---|---|
| **A** | Package skeleton + L0 token layer only | Very low — no selectors at all |
| **B** | L1a variables + typography ladder | Low — sheet-declared values |
| **C** | L1b structural rules on stable hooks (sidebar, nav, right rail, dockkit) | Low-medium |
| **D** | L2 additive brand/footer decoration | Low |
| **E** | Optional: register `cockpit-dark` as a selectable theme | Low |

### Verification (built in, not bolted on)

- `verify.mjs`: bundle contract, `dsh.client` declaration, **every token value is a `{light,dark}` pair** (mirrors `validateOverrides`), every structural selector starts with an allowed hook prefix (`[data-`, `[aria-`, `body[data-cockpit-theme]`).
- `test/tokens.test.mjs`: token-table shape + no forbidden key (`--dsh-content-font-size`, `--dsw-alias-*` handled only via overrideTokens).
- A dev-only **selector audit** in the client: after mount, `document.querySelectorAll` each structural selector and log any that matched zero elements — this is what converts "hashed-class brittleness" from a silent failure into a visible one after each DSH upgrade.
- The existing Workbench test suite is untouched and still authoritative for the panel.

### Activation, disable, and the upgrade contract

- **Activation:** one composition row added to the profile's bundle list (or the profile's own `cordis.patch.yml` as an `insert`), then **one GUI restart** for the first mount; afterwards client changes hot-reload exactly as Workbench does.
- **Disable, three levels:** dispose the layer(s) → `disabled: true` on the row → remove the row.
- **Upgrade audit (per DSH release):** re-run the selector audit, re-check the 79 alias names and the `--dsw-font-*` ladder still exist, and confirm `data-*`/`aria-current` hooks are unchanged. Expected effort: minutes, and failures are visible rather than silent.

### Explicit preservation guarantees

- `dsh-workbench` is **not modified**; no second Workbench is created; the centre of the reference *is* the existing panel rendered by the same seats.
- No shipped slot is replaced; Conversation, Trajectory, Workspaces, Settings, session state and every existing plugin keep their behaviour.
- No `@deepseek-ai/*` file is edited; the theme is additive, and the only profile contact is one additive bundle row.
- The model→PTY boundary is untouched: this plugin registers no tool, no service and no host capability.

---

## Part 5 — What is lost relative to the reference, stated plainly

1. **No global top bar.** The mockup's search/Local/model/bell/avatar strip does not exist in DSH and has no seat. It will not be built as part of this theme (an overlay approximation would float over content rather than integrate).
2. **Rails will not narrow.** Column widths stay JS-solved (sidebar 280 default, rightbar ≥300) unless you drag them, because overriding them would break resizing.
3. **Global density will be uneven.** Density is per-component and hashed; the theme can smooth the areas with hooks and variables, not every padding.
4. **The workspaces list stays structurally as-is** — tokens and typography only.

Everything else in the reference — the darker layered surfaces, borders, blue accent, typography hierarchy, compact navigation treatment, panel treatment, and the Workbench's integration with the shell and right rail — is reachable with **zero required hashed selectors**.

Awaiting approval before creating the package.
