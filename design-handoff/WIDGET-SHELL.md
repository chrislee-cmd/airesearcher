# WIDGET-SHELL — Global widget design rule (shared contract, repo-root SSOT)

> **This is the single source of truth for the widget shell.** Every widget (Probing · Interpreter · Recruiting · Transcript · AI UT · Desk) renders inside this identical shell. Each feature's `BUILD-SPEC.md §1` references THIS file for shell/assembly and adds only feature-specific rows. If a feature diverges from the shell, that is drift — fix the feature, not this file.
> **Consumes:** `CONTEXT-PACK.md` + `tokens.json` (token vocab). **Date:** 2026-07-21.

## AUTHORITY — design-led (greenfield) widgets, CD = visual SSOT
> The integ widgets (Probing · Interpreter · Recruiting · Transcript · AI UT · Desk) are **net-new CD designs, NOT bound to the pre-existing app design system.** Appearance priority:
> 1. **CD is the visual source of truth** — the `.dc.html` + BUILD-SPEC define how the widget looks. Reproduce it.
> 2. Existing DS tokens/classes are a **convenience vocabulary**, used ONLY where they already reproduce the CD value exactly.
> 3. **On conflict, CD wins.** The gap is a DS gap to fill (add a `proposed-token` / new component) — never a CD value to bend toward a DS default.
> Do not "reconcile" these widgets into legacy DS components. Realize the CD design; extend the DS to fit it. `hex/px-forbidden` means **promote CD's value to a token**, NOT substitute the nearest existing DS default.
> **§D Anti-anchoring (build fresh, don't edit legacy UI):** the worker builds the presentation as a **NEW component** per the CD `.dc.html` (e.g. `setup-accordion.tsx`, like Probing did). **Reuse logic/data only** (hooks · API · schema · extract · fit · forms). **Do NOT edit or extend pre-existing UI components** (`recruiting-wizard/wizard.tsx`, `conditions-panel.tsx`, old control panels) — they are **superseded** by the CD design. Only `WIDGET-SHELL.md` is shared. Editing legacy UI = anchoring to the old design system = the exact inversion this handoff forbids.

## §S0 Why this exists
The shell must reach the worker **regardless of port order or which feature they open first**. It is a peer of CONTEXT-PACK/tokens.json — never embedded inside one feature. (Root cause of prior drift: shell lived only in Probing's spec and others cross-referenced it, so it didn't propagate → split toolbar, ad-hoc headers.)

## §S1a Frame spec — DEDICATED tokens, no DS fallback (⚠️ read before wiring the shell)
> **Root cause of frame drift (#20):** the worker bound the card to a generic DS token (`radius-sm` = 14px), so CD's 20px silently became 14px; the header fell back to the generic banner yellow `#ffd53d` instead of `sun`. This is authority-inversion at the **token layer** — the worker must NOT bind these to the nearest existing DS token.
>
> **Rule:** the shell ships CD's exact values as **dedicated widget tokens**. Never reuse `radius-sm`/`canvas-card-*`/`surface-banner` for these.
>
> | Frame property | CD value (absolute — MUST match) | Do NOT reuse |
> |---|---|---|
> | corner radius | **20px** → new token `--widget-card-radius: 20px` | ✗ `radius-sm` (14) / `canvas-card-radius` |
> | border | **3px ink** → `--widget-card-border: 3px` | ✗ generic card border |
> | shadow | **4px 4px 0 ink** → `shadow-memphis-md` | ✗ `canvas-card-shadow` |
> | header tone | **per-widget pastel** (§S3) → `bg-widget-header-<tone>` (new) | ✗ `surface-banner` #ffd53d |
> | title | **Outfit 800 · 29px · ls -0.9** | ✗ 32px generic heading |
> | step title | **14.5px · 700** | ✗ `text-xl` |
>
> **Container-owned (NOT absolute — canvas may resize):** outer **width×height**. CD's `604×900` is the proto frame, not a hard product constraint — the app canvas grid owns final W/H; keep the **proportions/among-parts spacing**, but the outer box may be responsive. Everything in the table above is intrinsic widget styling and stays absolute regardless of container size.

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
