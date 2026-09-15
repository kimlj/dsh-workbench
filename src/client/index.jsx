// dsh-workbench browser half.
//
// Registers two additive seats:
//   sidebar.panellist  — the icon that opens the workbench
//   main[workbench]    — the full-height panel itself
//
// The catalogue describes sidebar.panellist as "each list id addresses the
// matching main panel", with replaceRisk: none, so a fresh id adds a panel
// beside the shipped Conversation instead of shadowing it.
//
// Terminal instances and the socket live in module scope, not in React. React
// mounts and unmounts this panel as the user switches main panels; if the
// terminals were component state, every switch would destroy live sessions.

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import xtermCss from '@xterm/xterm/css/xterm.css'
import * as React from 'react'
import { FilesWorkspace, UtilityPanel, UTILITY_PANEL_CSS } from './utility-panel.jsx'

import {
  DEFAULT_CONFIG,
  createKeyHandler,
  hintForIndex,
  isForeignEditable,
  isMacPlatform,
  loadConfig,
  normalizeConfig,
  parseForm,
  saveConfig,
  summarize,
  toForm,
} from './keymap.js'

// `slots` is a hard dependency, not an optional one: every seat this plugin
// contributes is registered through it. Declaring it makes Cordis hold this
// fiber until the slot service exists.
//
// Without this declaration the plugin activates on its own (the graph row
// carries no inject edges and `immediately: false`), `ctx.get('slots')` returns
// undefined, and the panel silently never registers — the stylesheet is
// injected and nothing else appears.
export const inject = ['slots']

const PANEL_ID = 'workbench'
/** Sentinel project id the host maps to its own working directory. */
const DEFAULT_PROJECT_ID = 'workbench-default'
const WS_PATH = '/x/workbench/ws'
const SCROLLBACK_LINES = 5000
const VERSION = '1.1'
const IS_MAC = isMacPlatform()

/**
 * The four configurable actions, in the order the shortcut editor shows them.
 * `Mod` is rendered per platform (Ctrl / Cmd) by keymap.js.
 */
const KEY_FIELDS = [
  { action: 'select', label: 'Terminals', placeholder: 'Mod+<1-8>' },
  { action: 'last', label: 'Last terminal', placeholder: 'Mod+9' },
  { action: 'next', label: 'Next terminal', placeholder: 'Ctrl+Tab' },
  { action: 'prev', label: 'Previous terminal', placeholder: 'Ctrl+Shift+Tab' },
]

const TERMINAL_THEME = {
  background: '#0b0f14',
  foreground: '#d7e0ea',
  cursor: '#7dd3fc',
  selectionBackground: '#264f78',
  black: '#0b0f14',
  red: '#f87171',
  green: '#86efac',
  yellow: '#fcd34d',
  blue: '#93c5fd',
  magenta: '#d8b4fe',
  cyan: '#7dd3fc',
  white: '#e5e7eb',
  brightBlack: '#64748b',
  brightRed: '#fca5a5',
  brightGreen: '#bbf7d0',
  brightYellow: '#fde68a',
  brightBlue: '#bfdbfe',
  brightMagenta: '#e9d5ff',
  brightCyan: '#bae6fd',
  brightWhite: '#f8fafc',
}

const PANEL_CSS = `
/* ── frame ──────────────────────────────────────────────────────────────
   The panel is a two-column surface of its own: the working column (header,
   project toolbar, terminal tabs, terminal card, dock) and a full-height
   read-only information rail, separated by one hairline. Everything is sized
   from the reference composition, on the shipped cockpit roles only. */
.dshw-root{display:flex;height:100%;min-height:0;min-width:0;font-size:13px;color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-main{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}
.dshw-nav-row{display:flex;align-items:center;gap:10px;width:100%;height:36px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dshw-nav-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-nav-row[data-active="true"]{background:var(--dsw-cockpit-bg-layer-2,var(--dsw-alias-bg-layer-2));color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary));font-weight:500}
.dshw-nav-row[data-wide="false"]{justify-content:center;padding:0}
.dshw-spacer{flex:1 1 auto}
.dshw-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}

/* ── panel header ─────────────────────────────────────────────────────── */
.dshw-head{display:flex;align-items:center;gap:10px;flex:none;height:52px;padding:0 12px}
.dshw-head-tile{display:flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;border-radius:8px;background:color-mix(in srgb,var(--dsw-cockpit-accent-primary,#3b82f6) 26%,transparent);border:0.5px solid color-mix(in srgb,var(--dsw-cockpit-accent-primary,#3b82f6) 42%,transparent);color:#bfd7ff}
.dshw-head-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dshw-head-title{font-size:17px;font-weight:600;line-height:21px;letter-spacing:-.01em}
.dshw-head-sub{font-size:12.5px;line-height:16px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}

/* ── shared controls ──────────────────────────────────────────────────── */
.dshw-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));cursor:pointer}
.dshw-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-icon:disabled{opacity:.35;cursor:not-allowed}
.dshw-icon[data-on="true"]{color:var(--dsw-cockpit-accent-primary,#3b82f6)}
.dshw-chip{display:inline-flex;align-items:center;gap:7px;flex:none;height:29px;max-width:260px;padding:0 9px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:7px;background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary));font-size:12.5px;font-family:inherit;line-height:1;cursor:pointer;white-space:nowrap}
.dshw-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshw-chip-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dshw-chev{flex:none;opacity:.55}
.dshw-primary{display:inline-flex;align-items:center;gap:6px;flex:none;height:31px;padding:0 13px;border:0;border-radius:8px;background:var(--dsw-cockpit-accent-primary,#3b82f6);color:#fff;font-size:12.5px;font-weight:500;font-family:inherit;cursor:pointer}
.dshw-primary:hover{background:var(--dsw-cockpit-accent-hover,#2563eb)}
.dshw-text{display:inline-flex;align-items:center;gap:6px;flex:none;height:27px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));font-size:12.5px;font-family:inherit;cursor:pointer}
.dshw-text:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-text:disabled{opacity:.35;cursor:not-allowed}
.dshw-btn{display:inline-flex;align-items:center;gap:6px;height:29px;padding:0 10px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:7px;background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font-size:12.5px;font-family:inherit;cursor:pointer}
.dshw-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshw-btn:disabled{opacity:.4;cursor:not-allowed}
.dshw-input{height:29px;padding:0 10px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:7px;background:var(--dsw-cockpit-bg-base,var(--dsw-alias-bg-base));color:inherit;font-size:12.5px;font-family:inherit}
.dshw-input:focus-visible{outline:none;border-color:color-mix(in srgb,var(--dsw-cockpit-accent-primary,#3b82f6) 55%,transparent)}
.dshw-menu{position:absolute;z-index:30;display:flex;flex-direction:column;gap:1px;min-width:250px;padding:5px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-elevation-prominent,0 12px 32px #0009)}
.dshw-menu-item{display:flex;align-items:center;gap:9px;width:100%;min-height:30px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12.5px;font-family:inherit;text-align:left;cursor:pointer}
.dshw-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshw-menu-item:disabled{opacity:.4;cursor:not-allowed}
.dshw-menu-note{padding:2px 9px 6px;font-size:11px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshw-menu-sep{margin:4px 0;border-top:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1))}

/* preset identity: one accent-tinted glyph tile, used by tabs, menu and card */
.dshw-glyph{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;border-radius:6px;font-size:10px;font-weight:700;letter-spacing:-.02em;color:#fff}

/* ── project toolbar ──────────────────────────────────────────────────── */
.dshw-toolbar{display:flex;align-items:center;gap:8px;flex:none;height:39px;padding:0 12px;border-bottom:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1))}
.dshw-toolbar-label{flex:none;font-size:12.5px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshw-path{min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshw-meta{display:inline-flex;align-items:center;gap:6px;flex:none;font-size:12.5px;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary))}
.dshw-meta[data-clean="true"]{color:var(--dsw-cockpit-success,var(--dsw-alias-state-success-primary))}
.dshw-hold{position:relative;flex:none;display:inline-flex}

/* ── terminal tabs ────────────────────────────────────────────────────── */
.dshw-tabrow{display:flex;align-items:flex-end;gap:4px;flex:none;height:38px;padding:0 10px 0 12px;border-bottom:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1))}
.dshw-tabs{display:flex;align-items:flex-end;gap:3px;flex:1 1 auto;min-width:0;height:100%;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.dshw-tabs::-webkit-scrollbar{display:none}
.dshw-tab{position:relative;bottom:-0.5px;display:inline-flex;align-items:center;gap:7px;flex:none;height:32px;padding:0 6px 0 7px;border:0.5px solid transparent;border-radius:7px 7px 0 0;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));font-size:12.5px;font-family:inherit;cursor:pointer;white-space:nowrap}
.dshw-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-tab[data-active="true"]{background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));border-color:var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-bottom-color:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-tab[data-active="true"]::after{content:"";position:absolute;left:-0.5px;right:-0.5px;top:-0.5px;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-cockpit-accent-primary,#3b82f6)}
.dshw-tabnum{flex:none;font-size:11.5px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font-variant-numeric:tabular-nums}
.dshw-tab[data-active="true"] .dshw-tabnum{color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary))}
.dshw-tabstop{flex:none;font-size:11.5px;opacity:.65}
.dshw-tab-x{display:inline-flex;align-items:center;justify-content:center;flex:none;width:17px;height:17px;border-radius:5px;opacity:.45;font-size:13px;line-height:1}
.dshw-tab-x:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover)}
.dshw-tab-add{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;margin-bottom:4px;border:0;border-radius:7px;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));cursor:pointer}
.dshw-tab-add:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-addmenu{top:34px;right:0}
.dshw-addmenu-custom{display:flex;gap:6px;padding:5px 3px 1px}
.dshw-addmenu-custom .dshw-input{min-width:0;flex:1 1 auto}

/* ── terminal card ────────────────────────────────────────────────────── */
.dshw-card{display:flex;flex-direction:column;flex:1 1 auto;min-height:150px;margin:8px 12px 0;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:9px;background:var(--dsw-cockpit-bg-base,var(--dsw-alias-bg-base));overflow:hidden}
.dshw-termhead{display:flex;align-items:center;gap:9px;flex:none;height:39px;padding:0 8px 0 11px;border-bottom:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));font-size:13px}
.dshw-termhead-label{flex:none;font-weight:600;color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-cwd{display:inline-flex;align-items:center;flex:0 1 auto;min-width:0;height:24px;padding:0 8px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:6px;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshw-stage{flex:1 1 auto;min-height:0;position:relative}
.dshw-host,.dshw-term{position:absolute;inset:0;padding:8px 10px}
.dshw-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:18px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font-size:12.5px;text-align:center}
.dshw-empty-title{font-size:13.5px;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary))}
.dshw-err{color:var(--dsw-alias-state-error-primary);font-weight:600}

/* ── dock ─────────────────────────────────────────────────────────────── */
.dshw-dock{display:flex;flex-direction:column;flex:none;margin:0 18px;padding-bottom:16px}
.dshw-docktabs{display:flex;align-items:center;gap:2px;flex:none;height:44px;border-bottom:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1))}
.dshw-docktab{display:inline-flex;align-items:center;gap:7px;height:43px;padding:0 9px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));font-size:13px;font-family:inherit;cursor:pointer}
.dshw-docktab:hover{color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-docktab[data-active="true"]{color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary));border-bottom-color:var(--dsw-cockpit-accent-primary,#3b82f6)}
.dshw-dockcollapse{margin-left:auto}
.dshw-dockcollapse svg{transition:transform 120ms ease}
.dshw-dockcollapse[data-collapsed="true"] svg{transform:rotate(180deg)}
.dshw-dockbadge{display:inline-grid;place-items:center;min-width:17px;height:16px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));font-size:10.5px;font-variant-numeric:tabular-nums}
.dshw-prompts{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;padding:17px 0 15px}
.dshw-prompt{height:30px;padding:0 13px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:999px;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));font-size:12.5px;font-family:inherit;cursor:pointer;white-space:nowrap}
.dshw-prompt:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-prompt:disabled{opacity:.4;cursor:not-allowed}
.dshw-composer{display:flex;flex-direction:column;gap:10px;padding:13px 12px 11px 14px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:12px;background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1))}
.dshw-composer:focus-within{border-color:color-mix(in srgb,var(--dsw-cockpit-accent-primary,#3b82f6) 45%,transparent)}
.dshw-ask{width:100%;min-height:58px;max-height:140px;padding:0;border:0;background:transparent;color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary));font:inherit;font-size:13.5px;line-height:21px;resize:none;outline:none}
.dshw-ask::placeholder{color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshw-composer-foot{display:flex;align-items:center;gap:8px}
.dshw-scope{display:inline-flex;align-items:center;gap:6px;max-width:320px;height:27px;padding:0 9px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:7px;background:transparent;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap}
.dshw-scope:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshw-scope:disabled{cursor:default}
.dshw-scope-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dshw-send{display:inline-grid;place-items:center;flex:none;width:31px;height:31px;border:0;border-radius:999px;background:var(--dsw-cockpit-accent-primary,#3b82f6);color:#fff;cursor:pointer}
.dshw-send:hover:not(:disabled){background:var(--dsw-cockpit-accent-hover,#2563eb)}
.dshw-send:disabled{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));cursor:not-allowed}
.dshw-context{display:flex;flex-direction:column;gap:2px;padding:12px 2px 14px}
.dshw-ctxrow{display:flex;align-items:center;gap:9px;height:27px;font-size:12.5px;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary))}
.dshw-ctxkey{flex:none;width:96px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshw-ctxval{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshw-ctxval[data-mono="true"]{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px}
.dshw-ctxnote{padding-top:7px;font-size:11.5px;line-height:17px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}

/* ── shortcut editor ──────────────────────────────────────────────────── */
.dshw-keys{display:flex;flex-wrap:wrap;gap:9px;align-items:center;flex:none;padding:10px 18px;border-bottom:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));font-size:12px}
.dshw-keys label{display:inline-flex;align-items:center;gap:6px}
.dshw-keys label>span{color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshw-key{height:27px;min-width:144px;padding:0 8px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:6px;background:transparent;color:inherit;font-size:12px;font-family:inherit}
.dshw-key[data-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.dshw-keys-hint{flex:1 1 100%;line-height:1.55;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshw-keys-err{color:var(--dsw-alias-state-error-primary);font-weight:600}

/* ── information rail ─────────────────────────────────────────────────── */
.dshw-rail{display:flex;flex-direction:column;flex:0 0 296px;width:296px;min-width:0;overflow:hidden;border-left:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1))}
.dshw-rail-pane{display:flex;flex-direction:column;height:100%;min-height:0}
.dshwr-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow-y:auto;padding:14px 12px 10px}
.dshwr-section{display:flex;flex-direction:column;gap:1px;padding-bottom:14px}
.dshwr-head{display:flex;align-items:center;gap:8px;height:26px;padding:0 6px;margin-bottom:3px;font-size:12.5px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshwr-head svg{flex:none;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary))}
.dshwr-name{display:flex;align-items:center;gap:8px;height:26px;padding:0 6px;font-size:13px;font-weight:500;color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshwr-path{padding:0 6px 4px 28px;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;line-height:16px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));overflow-wrap:anywhere}
.dshwr-row{display:flex;align-items:center;gap:9px;height:27px;padding:0 6px;border-radius:6px;font-size:12.5px;color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary))}
.dshwr-row svg{flex:none;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshwr-row[data-hover="true"]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshwr-row-name{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshwr-row[data-clean="true"] .dshwr-row-name{color:var(--dsw-cockpit-success,var(--dsw-alias-state-success-primary))}
.dshwr-meta{margin-left:auto;flex:none;font-size:11.5px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption));font-variant-numeric:tabular-nums}
.dshwr-empty{padding:0 6px;font-size:12.5px;line-height:24px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshwr-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:3px 6px 0}
.dshwr-action{display:flex;align-items:center;gap:8px;min-width:0;height:36px;padding:0 9px;border:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));border-radius:8px;background:var(--dsw-cockpit-bg-layer-1,var(--dsw-alias-bg-layer-1));color:var(--dsw-cockpit-text-secondary,var(--dsw-alias-label-secondary));font-size:12px;font-family:inherit;text-align:left;cursor:pointer}
.dshwr-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-cockpit-text-primary,var(--dsw-alias-label-primary))}
.dshwr-action-icon{flex:none;width:16px;height:16px;object-fit:contain}
.dshwr-action-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshwr-more{align-self:flex-start;height:24px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-cockpit-accent-primary,#3b82f6);font-size:12px;font-family:inherit;cursor:pointer}
.dshwr-more:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshwr-foot{display:flex;align-items:center;gap:8px;flex:none;height:32px;padding:0 14px;border-top:0.5px solid var(--dsw-cockpit-border-subtle,var(--dsw-alias-border-l1));font-size:11.5px;color:var(--dsw-cockpit-text-muted,var(--dsw-alias-label-caption))}
.dshwr-foot .dshw-err{font-size:11.5px}
`

// ── module-scope store ────────────────────────────────────────────────────
// Survives panel unmounts, so live terminals and the socket outlive a switch
// to the Conversation panel and back.

const state = {
  status: 'idle',
  error: null,
  presets: [],
  projects: [],
  sessions: [],
  activeId: null,
  activeProjectId: null,
  platform: null,
  defaultCwd: null,
  // Read-only project metadata for the contextual rail, keyed by project id.
  projectInfo: {},
  // Shortcut mapping, read once from this browser profile's localStorage. The
  // panel keeps it in module scope so a remount (or a hot reload) keeps the
  // user's mapping without touching the host.
  shortcuts: loadConfig(),
}

const records = new Map()
const listeners = new Set()

let pluginCtx = null
let socket = null
let host = null
let closedByUs = false
let reconnectDelay = 500
let styleElement = null
let lastCols = 120
let lastRows = 30
let requestSequence = 0
const pendingRequests = new Map()

function notify() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // One bad subscriber must not stop the others.
    }
  }
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function send(message) {
  if (socket === null || socket.readyState !== 1) return false
  try {
    socket.send(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}

function request(type, fields) {
  return new Promise((resolve, reject) => {
    const requestId = `workbench-${++requestSequence}`
    const timer = window.setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('Workbench request timed out'))
    }, 15000)
    pendingRequests.set(requestId, {
      resolve: (value) => { window.clearTimeout(timer); resolve(value) },
      reject: (error) => { window.clearTimeout(timer); reject(error) },
    })
    if (!send({ t: type, requestId, ...fields })) {
      pendingRequests.delete(requestId)
      window.clearTimeout(timer)
      reject(new Error('Workbench is not connected'))
    }
  })
}

function rejectPending(message) {
  for (const [requestId, pending] of pendingRequests) {
    pendingRequests.delete(requestId)
    pending.reject(new Error(message))
  }
}

// ── styles ────────────────────────────────────────────────────────────────

function ensureStyles() {
  if (styleElement !== null) return
  styleElement = document.createElement('style')
  styleElement.dataset.dshWorkbench = ''
  styleElement.textContent = `${xtermCss}\n${PANEL_CSS}\n${UTILITY_PANEL_CSS}`
  document.head.appendChild(styleElement)
}

function removeStyles() {
  if (styleElement !== null && styleElement.parentNode !== null) {
    styleElement.parentNode.removeChild(styleElement)
  }
  styleElement = null
}

// ── persistent DOM host ───────────────────────────────────────────────────

function ensureHost() {
  if (host === null) {
    host = document.createElement('div')
    host.className = 'dshw-host'
  }
  return host
}

// ── terminals ─────────────────────────────────────────────────────────────

function ensureTerminal(summary) {
  if (records.has(summary.id)) return records.get(summary.id)
  if (host === null) return null

  const container = document.createElement('div')
  container.className = 'dshw-term'
  container.style.display = 'none'

  const term = new Terminal({
    allowProposedApi: true,
    convertEol: false,
    cursorBlink: true,
    fontFamily: 'Cascadia Mono, Consolas, Menlo, monospace',
    fontSize: 13,
    scrollback: SCROLLBACK_LINES,
    theme: TERMINAL_THEME,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(container)
  term.onData((data) => send({ t: 'input', id: summary.id, data }))

  host.appendChild(container)
  const record = { term, fit, container, summary }
  records.set(summary.id, record)

  try {
    term.resize(summary.cols || lastCols, summary.rows || lastRows)
  } catch {
    // Geometry is corrected on first activation.
  }
  send({ t: 'attach', id: summary.id })
  return record
}

function writeTo(id, data) {
  const record = records.get(id)
  if (record === undefined) return
  record.term.write(data)
}

function fitActive() {
  const record = state.activeId === null ? undefined : records.get(state.activeId)
  if (record === undefined || record.container.style.display === 'none') return
  try {
    record.fit.fit()
  } catch {
    return
  }
  if (record.term.cols === lastCols && record.term.rows === lastRows) return
  lastCols = record.term.cols
  lastRows = record.term.rows
  send({ t: 'resize', id: state.activeId, cols: lastCols, rows: lastRows })
}

function setActive(id) {
  state.activeId = id
  for (const [sid, record] of records) {
    const isActive = sid === id
    record.container.style.display = isActive ? 'block' : 'none'
  }
  notify()
  window.requestAnimationFrame(() => {
    fitActive()
    const record = id === null ? undefined : records.get(id)
    if (record !== undefined) record.term.focus()
  })
}

function dropTerminal(id) {
  const record = records.get(id)
  if (record === undefined) return
  try {
    record.term.dispose()
  } catch {
    // Already disposed.
  }
  if (record.container.parentNode !== null) {
    record.container.parentNode.removeChild(record.container)
  }
  records.delete(id)
}

// ── session bookkeeping ───────────────────────────────────────────────────

function upsertSession(summary) {
  const index = state.sessions.findIndex((entry) => entry.id === summary.id)
  if (index === -1) state.sessions = [...state.sessions, summary]
  else state.sessions = state.sessions.map((entry) => (entry.id === summary.id ? summary : entry))
}

function patchSession(id, patch) {
  state.sessions = state.sessions.map((entry) =>
    entry.id === id ? { ...entry, ...patch } : entry,
  )
}

function dropSession(id) {
  state.sessions = state.sessions.filter((entry) => entry.id !== id)
  dropTerminal(id)
  if (state.activeId === id) {
    state.activeId = state.sessions.length > 0 ? state.sessions[state.sessions.length - 1].id : null
    if (state.activeId !== null) setActive(state.activeId)
  }
  notify()
}

/**
 * Ask the host for one project's read-only metadata when it is not already
 * held. The host resolves only ids it registered, so no path leaves the client.
 * @param projectId - registered project id, or null.
 */
function requestProjectInfo(projectId, force = false) {
  if (projectId === null || (!force && state.projectInfo[projectId] !== undefined)) return
  send({ t: 'projectInfo', id: projectId })
}

/** The project id the rail reports on: the selected one, else the host default. */
function railProjectId() {
  return state.activeProjectId ?? DEFAULT_PROJECT_ID
}

// ── transport ─────────────────────────────────────────────────────────────

function handle(message) {
  if (typeof message.requestId === 'string') {
    const pending = pendingRequests.get(message.requestId)
    if (pending !== undefined) {
      pendingRequests.delete(message.requestId)
      if (message.t === 'error') {
        const error = new Error(message.message ?? 'Workbench request failed')
        error.code = message.code
        pending.reject(error)
      } else {
        pending.resolve(message.result)
      }
      return
    }
  }
  switch (message.t) {
    case 'state': {
      state.presets = message.presets ?? []
      state.projects = message.projects ?? []
      state.platform = message.platform ?? null
      state.defaultCwd = message.defaultCwd ?? null
      state.sessions = message.sessions ?? []
      for (const summary of state.sessions) {
        ensureTerminal(summary)
        send({ t: 'attach', id: summary.id })
      }
      const running = state.sessions.find((entry) => entry.status === 'running')
      const preferred = running ?? state.sessions[0]
      if (state.activeId === null && preferred !== undefined) setActive(preferred.id)
      else notify()
      // The contextual rail mounts before the socket opens, so its first
      // request can be dropped; ask again once the bootstrap lands.
      requestProjectInfo(railProjectId())
      return
    }
    case 'session': {
      upsertSession(message.session)
      ensureTerminal(message.session)
      notify()
      return
    }
    case 'spawned': {
      upsertSession(message.session)
      ensureTerminal(message.session)
      setActive(message.session.id)
      return
    }
    case 'output':
    case 'attached':
      writeTo(message.id, message.data)
      return
    case 'exit':
      patchSession(message.id, { status: 'exited', exitCode: message.exitCode })
      notify()
      return
    case 'removed':
      dropSession(message.id)
      return
    case 'projects':
      state.projects = message.projects ?? []
      notify()
      return
    case 'project':
      if (!state.projects.some((entry) => entry.id === message.project.id)) {
        state.projects = [...state.projects, message.project]
      }
      state.activeProjectId = message.project.id
      notify()
      return
    case 'projectInfo':
      state.projectInfo = { ...state.projectInfo, [message.id]: message.info }
      notify()
      return
    case 'error':
      state.error = message.message ?? 'unknown error'
      notify()
      return
    default:
      return
  }
}

function ensureSocket() {
  if (socket !== null && (socket.readyState === 0 || socket.readyState === 1)) return
  closedByUs = false
  state.status = 'connecting'
  notify()

  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${scheme}//${window.location.host}${WS_PATH}`)
  socket = ws

  ws.onopen = () => {
    state.status = 'open'
    state.error = null
    reconnectDelay = 500
    notify()
    send({ t: 'hello' })
    if (state.activeId !== null) send({ t: 'attach', id: state.activeId })
  }
  ws.onmessage = (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    handle(message)
  }
  ws.onclose = () => {
    if (socket === ws) socket = null
    state.status = 'closed'
    rejectPending('Workbench connection closed')
    notify()
    if (closedByUs) return
    const delay = reconnectDelay
    reconnectDelay = Math.min(reconnectDelay * 2, 8000)
    window.setTimeout(() => {
      if (!closedByUs) ensureSocket()
    }, delay)
  }
  ws.onerror = () => {
    // onclose owns recovery.
  }
}

function listProjectFiles(projectId, path) {
  return request('fileList', { projectId, path })
}

function readProjectFile(projectId, path) {
  return request('fileRead', { projectId, path })
}

function writeProjectFile(projectId, path, content, expectedVersion) {
  return request('fileWrite', { projectId, path, content, expectedVersion })
}

// ── actions ───────────────────────────────────────────────────────────────

function spawnSession(presetId, customCommand) {
  state.error = null
  send({
    t: 'spawn',
    presetId,
    projectId: state.activeProjectId,
    customCommand: customCommand ?? null,
    cols: lastCols,
    rows: lastRows,
  })
}

async function pickProject() {
  const uiWorkspace = pluginCtx === null ? undefined : pluginCtx.get('uiWorkspace')
  if (uiWorkspace === undefined || typeof uiWorkspace.pickDirectory !== 'function') {
    state.error = 'directory picker is unavailable in this composition'
    notify()
    return
  }
  try {
    const path = await uiWorkspace.pickDirectory()
    if (typeof path === 'string' && path !== '') send({ t: 'addProject', path })
  } catch (error) {
    state.error = String(error?.message ?? error)
    notify()
  }
}

// ── components ────────────────────────────────────────────────────────────

/** Compact relative time for rail metadata. */
function relativeTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/** How long a terminal has been alive, in the rail's `12m` / `3h` shorthand. */
function uptime(startedAt) {
  const text = relativeTime(startedAt)
  return text === 'now' ? '0m' : text
}

/**
 * The text currently on screen in one terminal, trailing blank lines dropped.
 * @param term - the xterm instance.
 * @returns The viewport as plain text.
 */
function viewportText(term) {
  const buffer = term.buffer.active
  const lines = []
  for (let row = 0; row < term.rows; row += 1) {
    const line = buffer.getLine(buffer.viewportY + row)
    lines.push(line === undefined ? '' : line.translateToString(true))
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

// ── iconography ───────────────────────────────────────────────────────────
//
// One 16px stroked set, drawn locally rather than imported: the three baseline
// externals ship no icon surface this plugin can rely on, and a local table
// keeps the panel's glyphs consistent with each other at every size.

const GLYPH_PATHS = {
  folder: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h3.38a1.5 1.5 0 0 1 1.06.44l.62.62A1.5 1.5 0 0 0 10.62 8h4.88A1.5 1.5 0 0 1 17 9.5v7A1.5 1.5 0 0 1 15.5 18h-11A1.5 1.5 0 0 1 3 16.5z',
  branch: 'M6 3.5v9m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0-9a2 2 0 1 1 0 4 2 2 0 0 1 0-4m8 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4m0 4c0 3-1.5 4.5-4.5 5',
  check: 'M4 10.5 8 14.5 16 5.5',
  chevron: 'M5 8l5 5 5-5',
  plus: 'M10 4.5v11M4.5 10h11',
  copy: 'M7.5 7.5V5.2A1.7 1.7 0 0 1 9.2 3.5h5.6A1.7 1.7 0 0 1 16.5 5.2v5.6a1.7 1.7 0 0 1-1.7 1.7h-2.3M5.2 7.5h5.6a1.7 1.7 0 0 1 1.7 1.7v5.6a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V9.2a1.7 1.7 0 0 1 1.7-1.7z',
  trash: 'M4 6h12M8 6V4.5h4V6M6 6l.7 9.2A1.4 1.4 0 0 0 8.1 16.5h3.8a1.4 1.4 0 0 0 1.4-1.3L14 6',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
  keys: 'M3 6.5h14v7H3zM6 9h.01M9 9h.01M12 9h.01M6.5 11.5h7',
  file: 'M11 2.8H6.2A1.7 1.7 0 0 0 4.5 4.5v11a1.7 1.7 0 0 0 1.7 1.7h7.6a1.7 1.7 0 0 0 1.7-1.7V7zM11 2.8V7h4.5',
  terminal: 'M4.5 5.5 8 9l-3.5 3.5M10 14h5.5',
  send: 'M10 16V4.5M5 9.5 10 4.5l5 5',
  chat: 'M4 5.7A1.7 1.7 0 0 1 5.7 4h8.6A1.7 1.7 0 0 1 16 5.7v6.1a1.7 1.7 0 0 1-1.7 1.7H8l-4 3z',
  layers: 'M10 3 3.5 6.3 10 9.6l6.5-3.3zM3.5 10.2 10 13.5l6.5-3.3M3.5 13.9 10 17.2l6.5-3.3',
  info: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 9.3v4M10 6.8h.01',
  panel: 'M3.5 5.2A1.7 1.7 0 0 1 5.2 3.5h9.6a1.7 1.7 0 0 1 1.7 1.7v9.6a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7zM12.5 3.5v13',
}

/**
 * One glyph from the local table.
 * @param props.name - key in GLYPH_PATHS.
 * @param props.size - square edge in px (default 16).
 * @returns An inline SVG that inherits `currentColor`.
 */
function Glyph({ name, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={GLYPH_PATHS[name]} />
    </svg>
  )
}

/** Two-character mark per preset, so a tab is identifiable before its label. */
const PRESET_MARKS = {
  powershell: 'PS',
  claude: 'AI',
  codex: 'CX',
  opencode: 'OC',
  hermes: 'H',
  custom: '>_',
}

/**
 * The accent-tinted identity tile a preset carries through the tab strip, the
 * spawn menu and the terminal card header.
 * @param props.presetId - preset the session was spawned from.
 * @param props.accent - the preset's accent colour.
 * @param props.size - square edge in px.
 * @returns The tile.
 */
function PresetMark({ presetId, accent, size = 20 }) {
  const mark = PRESET_MARKS[presetId] ?? (presetId ?? '?').slice(0, 2).toUpperCase()
  return (
    <span
      className="dshw-glyph"
      style={{ background: accent ?? '#64748b', width: size, height: size, fontSize: mark.length > 1 ? 9.5 : 11 }}
      aria-hidden="true"
    >
      {mark}
    </span>
  )
}

/** Compact facts for the native Context companion. */
function RailSections() {
  return (
    <section className="dshwr-section">
      <span className="dshwr-head"><Glyph name="terminal" size={15} />Active Terminals</span>
      {state.sessions.length === 0
        ? <span className="dshwr-empty">No terminals open.</span>
        : state.sessions.map((session) => (
          <div className="dshwr-row" data-hover="true" key={session.id} title={session.cwd}>
            <span
              className="dshw-dot"
              style={{ background: session.status === 'running' ? session.accent : 'var(--dsw-cockpit-text-muted,#61666b)' }}
            />
            <span className="dshwr-row-name">{session.label}</span>
            <span className="dshwr-meta">
              {session.status === 'running' ? uptime(session.startedAt) : 'stopped'}
            </span>
          </div>
        ))}
    </section>
  )
}

/**
 * The Workbench's contextual rail tab: the shared read-only sections, rendered
 * in a registered rail tab. No PTY handle or terminal content is exposed.
 */
function WorkbenchRail() {
  const [, forceRender] = React.useReducer((count) => count + 1, 0)
  React.useEffect(() => subscribe(forceRender), [])
  return (
    <div className="dshw-rail-pane" data-workbench-rail>
      <div className="dshwr-root"><RailSections /></div>
      <div className="dshwr-foot">
        <span className="dshw-dot" style={{ background: state.status === 'open' ? 'var(--dsw-cockpit-success,#22c55e)' : 'var(--dsw-cockpit-warning,#f59e0b)' }} />
        <span>{state.status === 'open' ? 'Connected' : state.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
        <span className="dshw-spacer" />
        <span title={`Active shortcuts — ${summarize(state.shortcuts, IS_MAC)}`}>v{VERSION}</span>
      </div>
    </div>
  )
}

/**
 * The companion's Files tab: the human project file manager and editor over
 * the confined host file service. It resolves only registered project ids and
 * exposes no PTY handle or terminal content to the DSH model.
 */
function WorkbenchFiles() {
  const [, forceRender] = React.useReducer((count) => count + 1, 0)
  React.useEffect(() => subscribe(forceRender), [])
  return (
    <div className="dshw-rail-files" data-workbench-files>
      <FilesWorkspace
        variant="rail"
        projectId={railProjectId()}
        connectionState={state.status}
        listFiles={listProjectFiles}
        readFile={readProjectFile}
        writeFile={writeProjectFile}
      />
    </div>
  )
}

function WorkbenchIcon(props) {
  const size = typeof props?.size === 'number' ? props.size : 20
  const active = props?.active === true
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
      <path d="M6.5 9.25 9 11.75l-2.5 2.5" />
      <path d="M12.5 14.5h5" />
    </svg>
  )
}

function WorkbenchPanel() {
  const [, forceRender] = React.useReducer((count) => count + 1, 0)
  const stageRef = React.useRef(null)
  const rootRef = React.useRef(null)
  const [custom, setCustom] = React.useState('')
  const [keysOpen, setKeysOpen] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)
  const [projectOpen, setProjectOpen] = React.useState(false)
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [termMoreOpen, setTermMoreOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(null)
  const [keyErrors, setKeyErrors] = React.useState(null)

  React.useEffect(() => {
    const unsubscribe = subscribe(forceRender)
    ensureStyles()
    ensureHost()
    const stage = stageRef.current
    if (stage !== null && host.parentNode !== stage) stage.appendChild(host)
    ensureSocket()
    return () => {
      unsubscribe()
      const current = stageRef.current
      if (current !== null && host !== null && host.parentNode === current) {
        current.removeChild(host)
      }
    }
  }, [])

  // Keyboard navigation (V1.1).
  //
  // Registered with `capture: true` on the window, so it runs before xterm's
  // textarea listeners: a matched shortcut is preventDefault()ed (Chromium
  // never performs its own tab switch) and stopPropagation()ed (the keystroke
  // never reaches the PTY). Selecting a tab only toggles which xterm container
  // is displayed and refits/focuses it — no spawn, no attach, no socket write —
  // so a live Claude Code / Codex / PowerShell / OpenCode session is untouched.
  //
  // The listener lives exactly as long as this panel: DSH unmounts the inactive
  // main panel, so "while the Workbench is active" is the effect's own lifetime.
  // The runtime guard re-checks visibility and focus ownership per keystroke, so
  // a hidden/shadowed panel, and any text field outside the panel (DSH Chat's
  // composer, this panel's own composer), can never lose a keystroke to these
  // bindings.
  React.useEffect(() => {
    const onKeyDown = createKeyHandler({
      getConfig: () => state.shortcuts,
      getSessions: () => state.sessions,
      getActiveId: () => state.activeId,
      setActive,
      isActiveContext: (event) => {
        const root = rootRef.current
        if (root === null || root.isConnected !== true) return false
        if (typeof root.getClientRects === 'function' && root.getClientRects().length === 0) return false
        return !isForeignEditable(event.target, root)
      },
      mac: IS_MAC,
    })
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  React.useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return undefined
    const observer = new ResizeObserver(() => fitActive())
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const customPreset = state.presets.find((preset) => preset.id === 'custom')
  const active = state.sessions.find((session) => session.id === state.activeId)
  const projectId = railProjectId()
  const project = state.projects.find((entry) => entry.id === projectId)
  const info = state.projectInfo[projectId]
  const projectPath = info?.path ?? project?.path ?? state.defaultCwd ?? ''
  const projectName = info?.name ?? project?.name ?? 'Working directory'
  React.useEffect(() => { requestProjectInfo(projectId) }, [projectId])
  const clearActive = () => {
    const record = state.activeId === null ? undefined : records.get(state.activeId)
    if (record !== undefined) record.term.clear()
  }
  // Copy is a browser-side read of what is already on this user's screen — the
  // selection, or the visible viewport when nothing is selected. It never asks
  // the host for scrollback and never leaves the browser except to the
  // clipboard the user asked for.
  const copyActive = () => {
    const record = state.activeId === null ? undefined : records.get(state.activeId)
    if (record === undefined) return
    const text = record.term.getSelection() || viewportText(record.term)
    if (text === '') return
    void navigator.clipboard?.writeText(text)
  }

  return (
    <div className="dshw-root" ref={rootRef}>
      <div className="dshw-main">
        <div className="dshw-head">
          <span className="dshw-head-tile"><Glyph name="folder" size={20} /></span>
          <span className="dshw-head-text">
            <span className="dshw-head-title">Workbench</span>
            <span className="dshw-head-sub">Run your tools. One workspace, all terminals.</span>
          </span>
          <span className="dshw-spacer" />
          <button
            className="dshw-icon"
            type="button"
            aria-expanded={keysOpen}
            data-on={keysOpen}
            title="Configure the Workbench keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            onClick={() => {
              setKeyErrors(null)
              setDraft(keysOpen ? null : toForm(state.shortcuts))
              setKeysOpen(!keysOpen)
            }}
          >
            <Glyph name="keys" size={17} />
          </button>
        </div>

        <div className="dshw-toolbar">
          <span className="dshw-toolbar-label">Project</span>
          <span className="dshw-hold">
            <button
              type="button"
              className="dshw-chip"
              aria-expanded={projectOpen}
              title="Project that new terminals start in"
              onClick={() => { setProjectOpen(open => !open); setMoreOpen(false) }}
            >
              <Glyph name="folder" size={15} />
              <span className="dshw-chip-label">{projectName}</span>
              <span className="dshw-chev"><Glyph name="chevron" size={13} /></span>
            </button>
            {projectOpen && (
              <div className="dshw-menu" role="menu" style={{ top: 34, left: 0 }}>
                <button
                  type="button"
                  role="menuitem"
                  className="dshw-menu-item"
                  onClick={() => { setProjectOpen(false); state.activeProjectId = null; notify() }}
                >
                  <Glyph name="folder" size={15} />
                  {state.defaultCwd ?? 'Default directory'}
                </button>
                {state.projects.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    className="dshw-menu-item"
                    title={entry.path}
                    onClick={() => { setProjectOpen(false); state.activeProjectId = entry.id; notify() }}
                  >
                    <Glyph name="folder" size={15} />
                    {entry.name}
                  </button>
                ))}
              </div>
            )}
          </span>
          <span className="dshw-path" title={projectPath}>{projectPath}</span>
          {info?.branch != null && (
            <span className="dshw-meta" title="Current git branch">
              <Glyph name="branch" size={14} />
              {info.branch}
            </span>
          )}
          {info?.clean === true && (
            <span className="dshw-meta" data-clean="true" title="Working tree is clean">
              <Glyph name="check" size={14} />
              Clean
            </span>
          )}
          {info?.clean === false && (
            <span className="dshw-meta" title="Files changed since the last commit">
              <span className="dshw-dot" style={{ background: 'var(--dsw-cockpit-warning,#f59e0b)' }} />
              {info.changed} changed
            </span>
          )}
          <span className="dshw-spacer" />
          <span className="dshw-hold">
            <button
              type="button"
              className="dshw-icon"
              aria-expanded={moreOpen}
              aria-label="Project actions"
              title="Project actions"
              onClick={() => { setMoreOpen(open => !open); setProjectOpen(false) }}
            >
              <Glyph name="more" size={17} />
            </button>
            {moreOpen && (
              <div className="dshw-menu" role="menu" style={{ top: 32, right: 0, minWidth: 220 }}>
                <button
                  type="button"
                  role="menuitem"
                  className="dshw-menu-item"
                  disabled={projectPath === ''}
                  onClick={() => { setMoreOpen(false); void navigator.clipboard?.writeText(projectPath) }}
                >
                  <Glyph name="copy" size={15} />
                  Copy path
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="dshw-menu-item"
                  onClick={() => { setMoreOpen(false); requestProjectInfo(projectId, true) }}
                >
                  <Glyph name="branch" size={15} />
                  Refresh git state
                </button>
                {state.activeProjectId !== null && (
                  <>
                    <div className="dshw-menu-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className="dshw-menu-item"
                      title="Unregister this project (does not touch the files)"
                      onClick={() => {
                        setMoreOpen(false)
                        send({ t: 'removeProject', id: state.activeProjectId })
                        state.activeProjectId = null
                        notify()
                      }}
                    >
                      <Glyph name="trash" size={15} />
                      Forget this project
                    </button>
                  </>
                )}
              </div>
            )}
          </span>
          <button className="dshw-primary" type="button" onClick={() => void pickProject()}>
            <Glyph name="plus" size={15} />
            Add Project
          </button>
        </div>

        {keysOpen && (
          <div className="dshw-keys">
            {KEY_FIELDS.map((field) => (
              <label key={field.action}>
                <span>{field.label}</span>
                <input
                  className="dshw-key"
                  value={draft?.[field.action] ?? ''}
                  placeholder={field.placeholder}
                  spellCheck={false}
                  data-invalid={keyErrors?.[field.action] !== undefined}
                  title={keyErrors?.[field.action] ?? `${field.placeholder} — comma-separate alternatives`}
                  onChange={(event) =>
                    setDraft({ ...draft, [field.action]: event.target.value })
                  }
                />
              </label>
            ))}
            <button
              className="dshw-btn"
              type="button"
              onClick={() => {
                const parsed = parseForm(draft)
                if (!parsed.ok) {
                  setKeyErrors(parsed.errors)
                  return
                }
                state.shortcuts = normalizeConfig(parsed.config)
                saveConfig(undefined, state.shortcuts)
                setKeyErrors(null)
                setKeysOpen(false)
                setDraft(null)
                notify()
              }}
            >
              Save
            </button>
            <button
              className="dshw-btn"
              type="button"
              title="Restore the shipped defaults"
              onClick={() => {
                setDraft(toForm(DEFAULT_CONFIG))
                setKeyErrors(null)
              }}
            >
              Reset
            </button>
            <button
              className="dshw-btn"
              type="button"
              onClick={() => {
                setKeysOpen(false)
                setDraft(null)
                setKeyErrors(null)
              }}
            >
              Close
            </button>
            {keyErrors !== null && <span className="dshw-keys-err">Fix the highlighted binding to save.</span>}
          </div>
        )}

        <div className="dshw-tabrow">
          <div className="dshw-tabs">
          {state.sessions.map((session, index) => {
            const shortcut = hintForIndex(index + 1, state.shortcuts, IS_MAC)
            return (
              <button
                key={session.id}
                type="button"
                className="dshw-tab"
                data-active={session.id === state.activeId}
                onClick={() => setActive(session.id)}
                title={`${session.presetId} · pid ${session.pid} · ${session.cwd}${
                  shortcut === null ? '' : ` · ${shortcut}`
                }`}
              >
                <PresetMark presetId={session.presetId} accent={session.accent} />
                {shortcut !== null && (
                  <span className="dshw-tabnum" title={shortcut}>{index + 1}</span>
                )}
                {session.label}
                {session.status !== 'running' && (
                  <span className="dshw-tabstop">
                    {session.exitCode === null ? 'stopped' : `exit ${session.exitCode}`}
                  </span>
                )}
                <span
                  className="dshw-tab-x"
                  role="button"
                  tabIndex={-1}
                  title="Kill and close this terminal"
                  onClick={(event) => {
                    event.stopPropagation()
                    send({ t: 'remove', id: session.id })
                  }}
                >
                  ×
                </span>
              </button>
            )
          })}
          </div>
          <span className="dshw-hold">
            <button
              type="button"
              className="dshw-tab-add"
              aria-expanded={addOpen}
              aria-label="New terminal"
              title="New terminal"
              onClick={() => { setAddOpen(open => !open) }}
            >
              <Glyph name="plus" size={17} />
            </button>
            {addOpen && (
              <div className="dshw-menu dshw-addmenu" role="menu">
                {state.presets.filter((preset) => preset.id !== 'custom').map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="menuitem"
                    className="dshw-menu-item"
                    disabled={!preset.available}
                    title={preset.available ? preset.hint : `${preset.command} was not found on PATH`}
                    onClick={() => { setAddOpen(false); spawnSession(preset.id) }}
                  >
                    <PresetMark presetId={preset.id} accent={preset.accent} size={18} />
                    {preset.label}
                  </button>
                ))}
                <div className="dshw-menu-sep" />
                <div className="dshw-addmenu-custom">
                  <input
                    className="dshw-input"
                    value={custom}
                    placeholder={customPreset?.hint ?? 'Run any installed command…'}
                    onChange={(event) => setCustom(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && custom.trim() !== '') {
                        setAddOpen(false)
                        spawnSession('custom', custom.trim())
                      }
                    }}
                  />
                  <button
                    className="dshw-btn"
                    type="button"
                    disabled={custom.trim() === ''}
                    onClick={() => { setAddOpen(false); spawnSession('custom', custom.trim()) }}
                  >
                    Run
                  </button>
                </div>
              </div>
            )}
          </span>
        </div>

        <div className="dshw-card">
          {active !== undefined && (
            <div className="dshw-termhead">
              <PresetMark presetId={active.presetId} accent={active.accent} size={19} />
              <span className="dshw-termhead-label">{active.label}</span>
              <span className="dshw-cwd" title={active.cwd}>{active.cwd}</span>
              <span className="dshw-spacer" />
              <button className="dshw-text" type="button" onClick={clearActive}>Clear</button>
              <button
                className="dshw-icon"
                type="button"
                aria-label="Copy the selection"
                title="Copy the current selection"
                onClick={copyActive}
              >
                <Glyph name="copy" size={16} />
              </button>
              <span className="dshw-hold">
                <button
                  className="dshw-icon"
                  type="button"
                  aria-expanded={termMoreOpen}
                  aria-label="Terminal actions"
                  title="Terminal actions"
                  onClick={() => setTermMoreOpen(open => !open)}
                >
                  <Glyph name="more" size={17} />
                </button>
                {termMoreOpen && (
                  <div className="dshw-menu" role="menu" style={{ top: 32, right: 0, minWidth: 210 }}>
                    <button
                      type="button"
                      role="menuitem"
                      className="dshw-menu-item"
                      onClick={() => { setTermMoreOpen(false); send({ t: 'restart', id: active.id }) }}
                    >
                      <Glyph name="terminal" size={15} />
                      Restart in the same directory
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="dshw-menu-item"
                      onClick={() => { setTermMoreOpen(false); void navigator.clipboard?.writeText(active.cwd) }}
                    >
                      <Glyph name="copy" size={15} />
                      Copy working directory
                    </button>
                    <div className="dshw-menu-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className="dshw-menu-item"
                      onClick={() => { setTermMoreOpen(false); send({ t: 'remove', id: active.id }) }}
                    >
                      <Glyph name="trash" size={15} />
                      Kill this terminal
                    </button>
                  </div>
                )}
              </span>
            </div>
          )}
          <div className="dshw-stage" ref={stageRef}>
            {state.sessions.length === 0 && (
              <div className="dshw-empty">
                <div className="dshw-empty-title">No terminals yet.</div>
                <div>
                  Choose a project, then open PowerShell, Claude Code, Codex, OpenCode or Hermes —
                  each runs as its own real CLI in that directory.
                </div>
              </div>
            )}
          </div>
        </div>

        <UtilityPanel />
      </div>
    </div>
  )
}

function CockpitNavigation({ wide, destination, usePanelInfo }) {
  const rail = pluginCtx?.get('sidebarRight')
  const mode = React.useSyncExternalStore(
    React.useCallback(listener => rail?.subscribe(listener) ?? (() => {}), [rail]),
    React.useCallback(() => rail?.companionMode() ?? 'tabs', [rail]),
  )
  const workbenchActive = usePanelInfo(info => info.activePanelId === PANEL_ID)
  // The Workbench row selects the companion's Home tab; Chat and Trajectory
  // name their own tabs. Every row keeps the centre panel on the Workbench.
  const companion = destination === 'workbench' ? 'home' : destination
  const active = workbenchActive && mode === companion
  const label = destination === 'workbench' ? 'Workbench' : destination === 'chat' ? 'Chat' : 'Trajectory'
  const glyph = destination === 'workbench' ? 'terminal' : destination === 'chat' ? 'chat' : 'layers'
  return (
    <button
      type="button"
      className="dshw-nav-row"
      data-wide={wide}
      data-active={active || undefined}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={wide ? undefined : label}
      onClick={() => {
        try { pluginCtx?.get('layout')?.selectPanel(PANEL_ID) } catch {}
        rail?.openCompanion(companion)
      }}
    >
      <Glyph name={glyph} size={wide ? 16 : 18} />
      {wide ? <span>{label}</span> : null}
    </button>
  )
}

// ── plugin ────────────────────────────────────────────────────────────────

/**
 * Install one seat, reporting a failure instead of killing the fiber.
 *
 * `slots.inject` runs its callback synchronously when the slot is already
 * declared — which is always the case here — so a bad `register()` would
 * otherwise throw straight out of `apply()` and fail the whole plugin entry.
 * Surfacing it loudly is far more debuggable than a silent dead fiber.
 */
function installSeat(slots, slotKey, install) {
  try {
    slots.inject(slotKey, install)
  } catch (error) {
    console.error(`[dsh-workbench] could not register the ${slotKey} seat:`, error)
  }
}

/**
 * Register the workbench seats.
 * @param ctx - client plugin context.
 */
export function apply(ctx) {
  pluginCtx = ctx
  ensureStyles()

  const slots = ctx.get('slots')
  if (slots === undefined) {
    // Unreachable while `inject` is honoured; kept so a future composition
    // change reports itself rather than failing silently.
    console.error('[dsh-workbench] slots service unavailable; the Workbench panel cannot register')
    return
  }

  installSeat(slots, 'sidebar.navigation', function* () {
    yield slots.register({ name: 'sidebar.navigation', id: 'cockpit-chat', order: 10 }, props => <CockpitNavigation {...props} destination="chat" />)
    yield slots.register({ name: 'sidebar.navigation', id: 'cockpit-trajectory', order: 20 }, props => <CockpitNavigation {...props} destination="trajectory" />)
    yield slots.register({ name: 'sidebar.navigation', id: 'cockpit-workbench', order: 30 }, props => <CockpitNavigation {...props} destination="workbench" />)
  })

  installSeat(slots, 'main', () =>
    slots.register({ name: 'main', key: PANEL_ID }, () => <WorkbenchPanel />),
  )

  // Land on the Workbench — the cockpit's primary surface. The frame owns the
  // selection and this asks for it once at boot; a later user selection is
  // theirs. A composition without the layout service, or without this main
  // key, simply keeps the Conversation.
  ctx.inject(['layout'], (scope) => {
    try {
      scope.layout.selectPanel(PANEL_ID)
    } catch (error) {
      console.info('[dsh-workbench] could not select the Workbench main panel:', String(error?.message ?? error))
    }
  })

  // Companion rail: Home (Active Terminals today, future Suggestions) and Files
  // are Workbench-owned bodies registered into the fork's companion seats. No
  // dockkit tab type is registered, so the rail's four tabs are the same for
  // every cockpit action and the model gains no handle to a terminal.
  ctx.inject(['sidebarRight', 'slots'], (scope) => {
    const sidebarRight = scope.get('sidebarRight')
    const railSlots = scope.get('slots')
    const disposeHome = railSlots.inject('rightbar.home', () => railSlots.register(
      { name: 'rightbar.home' },
      () => <WorkbenchRail />,
    ))
    const disposeFiles = railSlots.inject('rightbar.files', () => railSlots.register(
      { name: 'rightbar.files' },
      () => <WorkbenchFiles />,
    ))
    // A fresh Workbench load opens the companion on Chat: Workbench centre, DSH
    // Chat right. A selection that arrives before the session seat mounts is
    // retained by the controller and consumed when it binds.
    sidebarRight.openCompanion('chat')
    scope.effect(() => () => {
      disposeFiles()
      disposeHome()
    })
  })

  console.info(
    `[dsh-workbench v${VERSION}] seats registered: sidebar.navigation + main[workbench] · keys ${summarize(
      state.shortcuts,
      IS_MAC,
    )}`,
  )

  ctx.effect(() => () => {
    closedByUs = true
    if (socket !== null) {
      try {
        socket.close()
      } catch {
        // Already closed.
      }
      socket = null
    }
    for (const id of [...records.keys()]) dropTerminal(id)
    removeStyles()
    pluginCtx = null
  })
}
