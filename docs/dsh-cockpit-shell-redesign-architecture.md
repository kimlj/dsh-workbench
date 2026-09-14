# DSH shell-wide visual redesign — architecture and feasibility

**Status: analysis only. Nothing implemented, nothing changed.**

Scope correction accepted: the reference is the **whole application**, not the Workbench panel. The existing Workbench V2 is treated as the *functional foundation and visual reference point* and is not to be revisited. This document answers one question: **what is the safest architecture for moving the entire DSH shell toward the reference while preserving every behaviour?**

Evidence tags: **[V]** verified from a primary source read in this session · **[I]** inference · **[U]** unverified, must be probed.

---

## 1. What the shipped shell actually is (the constraints that decide everything)

| Fact | Evidence |
|---|---|
| The frame is a 3-track grid — `sidebar \| center \| rightbar` — and the centre renders `main` keyed by `activePanelId` | **[V]** `dsh-client-ui-layout/lib/client.js:90–128` |
| There is a **global header** in the shell DOM (a `_header` CSS class exists in the shipped app CSS), and it has **no slot and no `data-*` hook** | **[V]** class scan of `dsh-web-frontend/dist/assets/*.css`; **no** top-bar seat in the live slot tree |
| Shell CSS-module class names are **hashed with a readable suffix** (`pI_x6G_frame`, `pI_x6G_rightbarCol`) — the suffix survives source edits, the hash does not | **[V]** `layout/lib/client.js` CSS-module map |
| A family of **stable `data-*` hooks** exists: `data-sidebar-collapsed`, `data-rightbar-col/-collapsed/-fullscreen/-instant`, `data-shell-overlay`, `data-dragging`, `data-side`, and a large `data-dockkit-*` set (tab, strip, pane, split, float) | **[V]** attribute scan of layout / sidebar-right / app-shell bundles |
| The theme's **`--dsw-alias-*` values are applied as inline styles on `<body>`** (`body.style.setProperty(...)`, with an `appliedTokens` clear-and-reapply cycle) | **[V]** `layout/lib/client.js` theme presenter |
| Consequence: a stylesheet **cannot** override those token values — colour changes must go through the theme service | **[I]** from the above (inline beats stylesheet) |
| `ctx.theme.overrideTokens(source, tokens)` stacks a token override layer over the active theme, `{light, dark}` per token, one layer per source, **disposer restores what it covered**; `register({id, colorScheme, tokens})` registers a selectable theme; `setFontSize(px)` is the only font-size write entry | **[V]** live Theme service contract |
| Only **13** tokens are offered as the documented overridable surface (`bg-base`, `bg-layer-1/2`, `bg-overlay`, `border-l1/l2`, `brand-primary`, `label-primary/secondary`, `state-error/success/warn`, `sidebar-fill`); the sheet carries 357 `--dsw-*` names in total | **[V]** `Theme.listTokens`; theme sheet scan |
| Plugins inject global CSS the shipped way: a `<style data-plugin-css="<id>" data-plugin="<pkg>">` element in `document.head`, and the HMR chain removes `style[data-plugin]` on reload | **[V]** `data-plugin-css` sites across shipped client packages; `dsh-client-hmr/lib/client.js` |
| **Our Workbench already uses exactly that mechanism** (`ensureStyles`/`removeStyles`, one `<style>` element, re-created on every `apply`) | **[V]** `src/client/index.jsx` |
| `--dsh-sidebar-inline-padding`, `--dsh-content-font-size*`, `--ds-transition-duration*`, `--ds-font-family-code` are shell-owned variables; the content font size is written inline | **[V]** variable scan; `body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, …)` |

**Two levers, and only two, reach *every* shipped component at once:**
**L0 — the theme service** (colours/surfaces/accent/borders/text, applied to every component that reads tokens, with zero DOM selectors), and
**L1 — one plugin-owned global stylesheet** (density, geometry, nav treatment, header chrome — the things tokens do not cover), targeted through `data-*` hooks where they exist and class-suffix selectors where they do not.

Everything else is decoration or a fork.

---

## 2. Can a client plugin safely inject global CSS into the shell DOM? — **Yes**

The specific question, answered directly:

- **Mechanism is the shipped one, not a hack.** A plugin appends one `<style data-plugin-css="<id>" data-plugin="<package>">` to `document.head`. Shipped client plugins do this today (the `data-plugin-css` guard is copied across many of them), and the HMR chain already knows to strip `style[data-plugin]` on reload. We are not inventing a channel; we are joining the existing one.
- **Global reach is inherent**, not a privilege: a head stylesheet applies to the whole document, so shell chrome, Conversation, Trajectory, Settings and Workbench are all reachable without replacing any component.
- **`--dsw-*` remains usable**: our rules read `var(--dsw-…)` normally, so token-driven theming still flows through.
- **Order wins ties**: our sheet is appended after the shell's sheets, so an equal-specificity rule of ours beats the shell's. This is why a *narrow* rule set is enough — no need for `!important` in the normal case.
- **The one thing CSS cannot do is recolour the alias tokens**, because those are inline on `<body>`. That is not a gap: it is exactly what `overrideTokens` is for, and using it means theme switching, light/dark, and the settings UI keep working. Using `!important` to fight inline token values would work mechanically and break theming — reject that approach.
- **Reversibility is native**: one `source` id, one style element, one `apply`/dispose pair. Removing the layer (or disposing the plugin) restores the shipped look with no residue.
- **Honest risk**: selectors on hashed classes (`[class*="_header"]`) are brittle in a way `data-*` hooks are not — they can silently stop matching after a DSH upgrade, and they can over-match. Mitigation is in §6.

---

## 3. The five approaches, compared

| # | Approach | Reference coverage | Survives upgrades | Shadows/removes shipped slots | Edits `@deepseek-ai/*` | Profile/composition change | Cleanly disableable | Maintenance |
|---|---|---|---|---|---|---|---|---|
| **A** | **Token layer only** — `ctx.theme.overrideTokens` (+ registered theme), no DOM selectors | Surfaces, layering, borders, text hierarchy, blue accent, sidebar fill, status colours — the *colour/surface half* of the reference. **Nothing** about density, geometry, radii, header shape, nav row treatment | **High** — public, documented, validated API; composable layers | No. Zero structural contact | No | No | Yes — dispose the layer, or flip one flag | **Low** — a token table; re-check the 13-token surface per upgrade |
| **B** | **Additive decoration through existing slots** — `sidebar.brand.mark`/`.name`, `sidebar.footer.action`, `shell.overlay`, our own `sidebar.panellist` entry | Small touches only: a cockpit brand row, a footer/status chip, a global overlay (vignette/hairlines/toast surface). **Cannot** restyle existing rows, the header, or the frame | **High** — slot keys are contracts | No (`replaceRisk: none` seats only) | No | No | Yes — unregister | **Low** |
| **C** | **Wrap/replace selected shell components through slots** — e.g. take `sidebar`, `rightbar`, `sidebar.workspaces`, or `root` | Potentially the whole reference, *including* the header if it had a seat | **Low** — replaces an occupant whose internals are not a contract | **Yes — catastrophic.** These seats are `shadows-shipped-ui`: replacing `sidebar` or `root` deletes the shipped component **and every descendant slot it declares** (panellist, workspaces, settings, brand, guide) | No | No | Only as a whole (all-or-nothing) | **Very high** — permanently chasing upstream internals |
| **D** | **Dedicated external `dsh-cockpit-theme` client plugin** — packages A + B + a bounded slice of E | **A + B coverage, plus** density, radii, header chrome, nav treatment, panel borders — i.e. **essentially the full reference**, minus anything that lives only inside the app shell's private DOM (see §4) | **Medium-high** — A/B parts are upgrade-proof; the structural part needs a selector audit per upgrade | **No** — it only *adds* a stylesheet and additive seat content; nothing is replaced | No | **Yes, one row** (add the package to the profile's bundle list / a profile patch `insert`) → one restart | **Yes, at three levels** (dispose, `disabled: true` on the row, or remove the bundle) | **Medium** — one token table + one clearly-marked selector block |
| **E** | **Patch/fork upstream DSH UI** | Full control | **None** — overwritten on upgrade | N/A | **Yes — forbidden by your constraint** | Yes | No | Unacceptable |

**C is rejected on correctness, not taste**: those seats exist to let a plugin *add*, and the catalogue's own `replaceRisk: shadows-shipped-ui` marks them as one-way doors. **E is rejected outright** (installed packages are not ours to edit).

**Recommendation: D — a dedicated `dsh-cockpit-theme` client plugin implemented as layers A + B + a bounded E, with A carrying as much of the design as possible.**

The layering order matters more than the packaging:

```
L0  token layer      ctx.theme.overrideTokens('dsh-cockpit-theme', {…13 alias tokens…})
                     └─ all shipped components recolour, theme-safe, upgrade-proof
L1  metric layer     one <style data-plugin-css="dsh-cockpit-theme"> 
                     ├─ 1a: shell-owned CSS variables (density, transitions, code font)
                     └─ 1b: structural rules on stable data-* hooks
                            + a small, marked block of class-suffix selectors for the
                              header/nav rows that have no data hook
L2  decoration       additive seats only (brand row, footer chip, shell.overlay)
L3  never            replacing root/sidebar/rightbar/workspaces
```

---

## 4. Achievability per area of the reference

| Reference element | Reachable via | Coverage | Brittleness |
|---|---|---|---|
| Global background / surface layering, darker panels | **L0** (`bg-base`, `bg-layer-1/2`, `bg-overlay`, `sidebar-fill`) | **High** | None — tokens, not selectors |
| Consistent blue accent, borders, text hierarchy, status colours | **L0** (`brand-primary`, `border-l1/l2`, `label-primary/secondary`, `state-*`) | **High** | None |
| Compact IDE density (row heights, paddings, gaps) | **L1a/L1b** — shell-owned variables where they exist (`--dsh-sidebar-inline-padding`), otherwise structural CSS on `data-sidebar-collapsed`, `data-dockkit-*` | Medium-high | Medium — geometry has no token layer |
| Narrower-feeling chrome / column widths | **L1b only.** The column solve (`sidebar 264–420`, `rightbar ≥300`) is computed in JS and applied to the grid | **Low-medium** | High — the width is a JS-computed track, not a variable |
| Global header / top bar (search, Local, model, bell, avatar) | **L1b only** — the header has **no seat and no data hook**, only a hashed `_header` class | Medium | **Highest** — the one area needing suffix selectors; verify the live DOM first |
| Active navigation styling | **L1b** — nav rows expose hashed classes only; `sidebar.panellist` gives us our own row *content*, not the row chrome | Medium | High |
| Workspace section | `sidebar.workspaces` is `shadows-shipped-ui` → **L1b styling only** (or accept) | Medium | High |
| Panel surfaces, borders, radii | **L1a/L1b** (`--dsw-corner-shape`, border tokens, card rules) | High | Low-medium |
| Typography hierarchy | **L0/L1a** — `setFontSize` for content size; the `--dsw-font-*` ladder lives in the theme sheet (not inline) so a later sheet can override it **[I, verify]** | High | Low |
| Workbench ↔ shell ↔ right rail coherence | **L0 + L1** — Workbench already reads `--dsw-*`; the right rail is `data-sidebar-right-*`-addressable | High | Low |
| Conversation / Trajectory / Settings coherence | **L0** recolours them all automatically; **L1** should *not* touch them beyond shared density variables | High | Low if we stay out of their internals |

**Summary of honest coverage: L0 alone gets roughly the colour/surface half of the reference with near-zero risk. Adding L1 gets the density, radii, nav and header treatment — at the cost of one audited selector block. Nothing in the reference requires replacing a shipped component.**

---

## 5. Packaging trade-off (the one real decision)

| | **D1 — inside `dsh-workbench`** | **D2 — new `dsh-cockpit-theme` package** |
|---|---|---|
| Profile/composition change | **None** | **One row** (bundle list, or a profile-patch `insert`) |
| Activation | **Hot-reloads instantly** (existing HMR chain) | **One GUI restart** for the first mount; content hot-reloads afterwards |
| Disable | Edit one flag and rebuild | `disabled: true` on the row, or remove the bundle — no rebuild |
| Coupling | A *global* shell theme ships inside the terminal package; disabling Workbench disables the theme | Clean separation; the theme is a first-class, independently reviewable concern |
| Review surface | `index.jsx` grows a theme concern it should not own | One small package, one purpose |
| Composition skill needed | No | Yes — load `editing-cordis-compositions` before touching the profile |

**Recommendation: D2** for the end state (clean, independently removable, no coupling), with the caveat that it costs one profile row and one restart. If you would rather not touch the profile at all right now, **D1 is a legitimate temporary home** — the theme code would be written as an isolated module (`src/client/cockpit.js`) that can be lifted into its own package later without rewriting.

---

## 6. Risk register and kill switch

| Risk | Mitigation |
|---|---|
| Hashed class selectors silently stop matching after an upgrade | Prefer `data-*` hooks; confine suffix selectors to **one clearly-marked block** with a comment naming the DSH version they were verified against; a startup probe logs (in dev) when a scoped selector matches nothing |
| Over-broad selectors leaking into Conversation/Trajectory | Every structural rule is scoped under a root guard; a single `data-cockpit="on"` attribute on `<body>` lets the whole sheet be neutralised by removing one attribute |
| `!important` creeping in | Forbidden in normal rules; permitted only where a shipped declaration is itself `!important` or inline (the token values are inline — and for those we use `overrideTokens`, not `!important`) |
| Fighting the user's theme preference (light/dark) | `overrideTokens` takes `{light, dark}` pairs, so light mode stays correct; the reference's dark look becomes a *registered theme* the user can select rather than a forced override |
| Blast radius while iterating | Development happens with the layer disposed (flag off) until it is coherent; the style element is added/removed through one `apply`/dispose pair, exactly as Workbench's `ensureStyles` already does |
| Breaking Workbench V2 | Untouched: the theme layer only *adds* tokens and a global sheet; Workbench already consumes `--dsw-*` and needs no edits |

**Kill switch, three levels:** (1) `ctx.theme.overrideTokens` disposer + style-element removal on plugin dispose; (2) `disabled: true` on the composition row; (3) remove the bundle row entirely. Level 1 is instant and needs no restart.

---

## 7. What must be verified before implementation (probe list)

1. **Header DOM** — the exact live structure of the app shell's global header (element, class suffix, child rows). This is the only area with no stable hook, so it decides how much of the header we can honestly restyle. **[U]**
2. **Token override surface** — empirically confirm which of the 13 documented alias tokens actually move, and whether additional alias tokens are accepted at runtime. **[U]**
3. **Font ladder** — confirm whether `--dsw-font-*` values come from the sheet (overridable by a later sheet) or from inline application. **[I → probe]**
4. **Grid track override** — confirm whether the resolved column widths are inline (then CSS cannot narrow the rails honestly) or variable-driven. **[U]**
5. **Nav row internals** — the sidebar's row markup, to see whether an active-state treatment is reachable without matching a hash. **[U]**

Each probe is a read-only DOM inspection (a few minutes with the layer disabled), not an implementation step.

---

## 8. Recommendation in one paragraph

Build a **separate, additive, globally-scoped `dsh-cockpit-theme` client plugin** that layers (L0) a theme-service token override carrying as much of the reference's colour, surface, border and accent language as the alias layer allows; (L1) one plugin-owned stylesheet, marked with the shipped `data-plugin-css` convention, carrying density variables and structural rules targeted at stable `data-*` hooks with a small, audited block of class-suffix selectors for the header and nav rows that have no hooks; and (L2) additive slot decorations for the brand row and a footer chip. It replaces no shipped component, edits no `@deepseek-ai/*` file, keeps every existing slot, plugin and behaviour intact, survives DSH upgrades except for a per-upgrade selector audit, and can be disabled at three independent levels — including instantly, without a restart.
