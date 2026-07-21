# WIDGET-SHELL — Global widget design rule (shared contract, repo-root SSOT)

> **This is the single source of truth for the widget shell.** Every widget (Probing · Interpreter · Recruiting · Transcript · AI UT · Desk) renders inside this identical shell. Each feature's `BUILD-SPEC.md §1` references THIS file for shell/assembly and adds only feature-specific rows. If a feature diverges from the shell, that is drift — fix the feature, not this file.
> **Consumes:** `CONTEXT-PACK.md` + `tokens.json` (token vocab). **Date:** 2026-07-21.

## §S0 Why this exists
The shell must reach the worker **regardless of port order or which feature they open first**. It is a peer of CONTEXT-PACK/tokens.json — never embedded inside one feature. (Root cause of prior drift: shell lived only in Probing's spec and others cross-referenced it, so it didn't propagate → split toolbar, ad-hoc headers.)

## §S1 Shell class map (identical across all widgets)
| Element | Measured | Utility class / token |
|---|---|---|
| Card frame | 604×900 · border 3px ink · radius 20 · shadow 4px4px0 ink · overflow hidden · flex-col | `WidgetShell` · `rounded-*(20) border-ink shadow-memphis-md` |
| Header band | border-b 2px ink · pad 18/22 · flex row space-between · bg = widget pastel (§S3) | `border-b-2 border-ink` + `bg-widget-header-<tone>` |
| Title | Outfit 800 · 29px · ink · ls -0.9 | `font-display text-[1.8rem] font-extrabold text-ink` |
| Toolbar pill (unified) | border 1.5 ink · radius 10 · shadow 2px2px0 · segs pad 6/10 mono 11 · 1.5px ink dividers | `rounded-chrome border-ink shadow-memphis-xs` |
| — toolbar seg: credit | 💎 + n | mono |
| — toolbar seg: status | ● dot + `READY`/`LIVE` | dot `signal-success`/`amore` |
| — toolbar seg: palette | 🎨 (theme) | — |
| — toolbar seg: fullview | ⤢ (LAST) | — |
| Body | pad varies · flex-col · **body scrolls, card height fixed 900** | `flex-1 overflow-y-auto` |
| Step rail | vertical line left 12 · 2px ink/12% | `bg-ink/10` |
| Step node (active) | 26·circle · ink bg · #fff · 12.5/800 | `bg-ink text-white rounded-full` |
| Step node (done) | 26·circle · success #16a34a · ✓ | `bg-success text-white` |
| Step node (todo) | 26·circle · ink/6% · mute | `bg-ink/5 text-mute` |
| Step title | 14.5 · 800 · ink | `font-bold text-ink` |
| Field / dropdown | border 1.5 ink · radius 22 (pill) or 24 | `rounded-pill` / `rounded-md` |
| Method/use-case card (idle) | radius 13 · border 1.4 ink/14% · pad 13/11 | `rounded-sm border-line` |
| Method card (selected) | border 2px amore · shadow `0 4px 12px rgba(255,92,138,.16)` | `border-amore` + **proposed:shadow-card-selected** |
| Collapsed summary row | done=success node + label + value · `Change` right | `bg-signal-success-bg border-signal-success-line` |
| Footer row | border-t 1px ink/8% · pad 15/22 · footNote left · CTA right | `border-t border-line` |
| CTA (active) | bg ink · #fff · radius 999 · pad 11/20 · shadow 2px2px0 | `bg-ink text-white rounded-pill shadow-memphis-xs` |
| CTA (idle) | bg #eceef1 · #8a8693 · border ink/10% | **proposed:surface-disabled** `text-mute-soft` |

## §S2 Assembly rules (composition — do not split/merge)
- **Header toolbar = ONE pill**, segments in exact order `[ 💎credit │ ● status │ 🎨 │ ⤢ ]`, divided by 1.5px ink rules, inside one `rounded-chrome border-ink shadow-memphis-xs` container. ✗ Never render credit/palette and status/fullview as detached boxes.
- **Title + toolbar** = single header row (title left, toolbar right).
- **Steps** = children of ONE vertical rail (left line threads all nodes). Never separate cards per step.
- **CTA + footNote** = one footer row with border-top; CTA always right, footNote left.
- **Card height fixed (900); only the body scrolls.** Steps never resize the card.

## §S3 Per-widget identity (only the differences)
| Widget | Header tone (`bg-widget-header-*`) | Credit | Accent |
|---|---|---|---|
| Probing Assistant | sky `#cfe6ff` | 💎 25 | amore |
| Live Interpreter | mint `#cdebd9` | 💎 50* | amore |
| Recruiting | sun `#ffe8a8` | 💎 10 | amore |
| Transcript | lav `#e7defe` | 💎 25 | amore (+progress `#8b5cf6`) |
| AI UT | peach `#ffd9be` | `PREVIEW` | amore |
| Desk Research | cyan `#bfe9ef`* | 💎 75 | amore |
> `*` open decisions: Interpreter credit 50 vs 75; Desk cyan vs unify-with-sky. See each spec §6.

## §S4 proposed-tokens introduced by the shell
`bg-widget-header-{sky,mint,sun,lav,peach,cyan}` · `shadow-card-selected` · `surface-disabled` · `signal-success-bg/-line` (collapsed summary). Fallbacks in each spec §2.
