// Workbench V2 Phase 1 stylesheet.
//
// Migrated from the V1 `color-mix(in srgb, currentColor N%, transparent)`
// approach to the shell's own design tokens. Every name below was verified to
// exist in the shipped theme sheet (`dsh-client-ui-theme/lib/client.js`, 357
// `--dsw-*` names) before being used; each carries a literal fallback so a
// theme that lacks a token still renders the intended geometry.
//
// Layout rule for V2: the ACTIVE TERMINAL DOMINATES. Chrome above it is three
// compact rows (header, project bar, tabs) and one status line below; the card
// takes every remaining pixel and never scrolls the terminal out of view.

export const WORKBENCH_CSS = `
.dshw-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-base,transparent)}

/* ── panel header (compact label row, per the approved wireframe) ───────── */
.dshw-head{display:flex;align-items:center;gap:10px;padding:9px 12px 5px}
.dshw-label{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,inherit)}
.dshw-sub{font-size:var(--dsw-font-xxs-12-font-size,12px);color:var(--dsw-alias-label-caption,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshw-spacer{flex:1 1 auto}

/* ── controls ───────────────────────────────────────────────────────────── */
.dshw-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 12px 8px}
.dshw-group{display:flex;align-items:center;gap:6px;min-width:0}
.dshw-chip,.dshw-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10));color:var(--dsw-alias-label-secondary,inherit);border-radius:8px;padding:4px 8px;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1.4;cursor:pointer;white-space:nowrap;max-width:100%}
.dshw-btn{background:transparent}
.dshw-chip:hover:not(:disabled),.dshw-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,inherit)}
.dshw-btn:disabled,.dshw-chip:disabled{opacity:.45;cursor:not-allowed}
.dshw-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,#2563eb);color:var(--dsw-alias-label-primary-inverted,#fff)}
.dshw-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#1d4ed8);color:var(--dsw-alias-label-primary-inverted,#fff)}
.dshw-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,inherit);cursor:pointer}
.dshw-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,inherit)}
.dshw-select{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10));color:var(--dsw-alias-label-secondary,inherit);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:8px;padding:4px 6px;font-size:var(--dsw-font-xxs-12-font-size,12px);max-width:230px}
.dshw-input{background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10)));color:inherit;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:8px;padding:4px 8px;font-size:var(--dsw-font-xxs-12-font-size,12px);min-width:150px;flex:1 1 150px}
.dshw-input:focus,.dshw-select:focus{outline:1px solid var(--dsw-alias-brand-primary,#7dd3fc);outline-offset:0}
.dshw-path{font-family:var(--dsw-font-family,ui-monospace,Menlo,Consolas,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:44ch}
.dshw-mono{font-family:var(--dsw-font-family,ui-monospace,Menlo,Consolas,monospace)}
.dshw-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
.dshw-badge{opacity:.55;font-size:10px;min-width:10px;text-align:center;font-variant-numeric:tabular-nums}

/* ── tab strip (flat numbered items, per the approved wireframe) ────────── */
.dshw-tabs{display:flex;align-items:center;gap:2px;padding:0 8px 0 12px;overflow-x:auto;scrollbar-width:thin;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22))}
.dshw-tab{display:inline-flex;align-items:center;gap:7px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,inherit);border-radius:7px 7px 0 0;padding:6px 9px;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1.35;white-space:nowrap;cursor:pointer}
.dshw-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit)}
.dshw-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10));color:var(--dsw-alias-label-primary,inherit);box-shadow:inset 0 -2px 0 0 var(--dsw-alias-brand-primary,#7dd3fc)}
.dshw-tab-x{opacity:.5;font-weight:700;border-radius:4px;padding:0 2px}
.dshw-tab-x:hover{opacity:1;background:var(--dsw-alias-state-error-primary,rgba(248,113,113,.25))}
.dshw-tabs-add{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;flex:0 0 auto}
.dshw-tabs-add:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,inherit)}

/* ── terminal card (the dominant surface) ───────────────────────────────── */
.dshw-card{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;margin:8px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));overflow:hidden}
.dshw-card-head{display:flex;align-items:center;gap:8px;padding:5px 6px 5px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));min-height:34px}
.dshw-card-title{font-size:var(--dsw-font-xxs-12-font-size,12px);font-weight:var(--dsw-font-xxs-12-font-weight,600);color:var(--dsw-alias-label-primary,inherit);white-space:nowrap}
.dshw-card-body{position:relative;flex:1 1 auto;min-height:0;background:var(--dsw-alias-bg-base,#0b0f14)}
.dshw-host{position:absolute;inset:0;padding:4px 8px}
.dshw-term{position:absolute;inset:0;padding:4px 8px}
.dshw-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-label-tertiary,#7c8b9c);font-size:var(--dsw-font-xxs-12-font-size,12px);text-align:center;padding:16px}

/* ── status line ────────────────────────────────────────────────────────── */
.dshw-status{display:flex;align-items:center;gap:10px;padding:6px 12px;font-size:11px;color:var(--dsw-alias-label-tertiary,inherit);border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16))}
.dshw-err{color:var(--dsw-alias-state-error-primary,#f87171);font-weight:600}
.dshw-ok{color:var(--dsw-alias-state-success-primary,#86efac)}

/* ── popover menu ───────────────────────────────────────────────────────── */
.dshw-menu-wrap{position:relative;display:inline-flex}
.dshw-menu{position:absolute;z-index:40;top:calc(100% + 5px);right:0;min-width:196px;max-height:60vh;overflow:auto;padding:5px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay,#161b22));box-shadow:var(--dsw-shadow-lv2,0 12px 32px rgba(0,0,0,.45))}
.dshw-menu-left{right:auto;left:0}
.dshw-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font-size:var(--dsw-font-xxs-12-font-size,12px);text-align:left;cursor:pointer}
.dshw-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,inherit)}
.dshw-menu-item:disabled{opacity:.45;cursor:not-allowed}
.dshw-menu-item[data-danger="true"]:hover{background:var(--dsw-alias-state-error-primary,rgba(248,113,113,.22))}
.dshw-menu-note{padding:2px 8px 6px;font-size:10px;color:var(--dsw-alias-label-caption,inherit);opacity:.8}
.dshw-menu-sep{height:1px;margin:5px 4px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.2))}
.dshw-menu-form{display:flex;gap:6px;padding:4px}

/* ── keys editor ────────────────────────────────────────────────────────── */
.dshw-keys{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:8px 12px;font-size:11px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16))}
.dshw-keys label{display:inline-flex;align-items:center;gap:5px}
.dshw-keys label>span{color:var(--dsw-alias-label-tertiary,inherit)}
.dshw-key{background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1)));color:inherit;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:6px;padding:3px 6px;font-size:11px;font-family:inherit;min-width:148px}
.dshw-key[data-invalid="true"]{border-color:var(--dsw-alias-state-error-primary,#f87171)}
.dshw-keys-hint{flex:1 1 100%;color:var(--dsw-alias-label-caption,inherit);opacity:.85;line-height:1.5}
.dshw-keys-err{color:var(--dsw-alias-state-error-primary,#f87171);font-weight:600}

/* ── right-column Workbench tab ─────────────────────────────────────────── */
.dshw-rp{display:flex;flex-direction:column;gap:10px;padding:10px 12px;font-size:var(--dsw-font-xxs-12-font-size,12px);color:var(--dsw-alias-label-secondary,inherit);overflow:auto}
.dshw-rp-section{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-caption,inherit)}
.dshw-rp-card{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.dshw-rp-kv{display:flex;align-items:baseline;gap:8px}
.dshw-rp-kv>span:first-child{color:var(--dsw-alias-label-caption,inherit);min-width:62px;font-size:11px}
.dshw-rp-row{display:flex;align-items:center;gap:8px;width:100%;padding:5px 6px;border:none;border-radius:6px;background:transparent;color:inherit;font-size:var(--dsw-font-xxs-12-font-size,12px);text-align:left;cursor:pointer}
.dshw-rp-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dshw-rp-row[data-active="true"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.dshw-rp-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshw-rp-meta{margin-left:auto;flex:0 0 auto;color:var(--dsw-alias-label-caption,inherit);font-size:11px;font-variant-numeric:tabular-nums}
.dshw-rp-empty{padding:6px;color:var(--dsw-alias-label-caption,inherit);font-size:11px}
`
