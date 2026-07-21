# design-handoff/ — CD → Worker contract root

> **What this is.** Inbound design handoffs from CD (Claude Design). Each `<feature>/` folder is a **self-contained, repo-committed** package a worker ports to TSX mechanically. CD produces; the worker wires logic/data. No visual decisions are left open here.
>
> **How this reaches the worker.** CD cannot write to this repo. Flow: CD updates the package → human commits it under `design-handoff/` → Claude Code reads it by repo path. There is no other channel; the repo is the single source of exchange.

## AUTHORITY — design-led (greenfield) widgets, CD = visual SSOT
> The integ widgets (Probing · Interpreter · Recruiting · Transcript · AI UT · Desk) are **net-new CD designs, NOT bound to the pre-existing app design system.** Appearance priority:
> 1. **CD is the visual source of truth** — the `.dc.html` + BUILD-SPEC define how the widget looks. Reproduce it.
> 2. Existing DS tokens/classes are a **convenience vocabulary**, used ONLY where they already reproduce the CD value exactly.
> 3. **On conflict, CD wins.** The gap is a DS gap to fill (add a `proposed-token` / new component) — never a CD value to bend toward a DS default.
> Do not "reconcile" these widgets into legacy DS components. Realize the CD design; extend the DS to fit it. `hex/px-forbidden` means **promote CD's value to a token**, NOT substitute the nearest existing DS default.
> **§D Anti-anchoring (build fresh, don't edit legacy UI):** the worker builds the presentation as a **NEW component** per the CD `.dc.html` (e.g. `setup-accordion.tsx`, like Probing did). **Reuse logic/data only** (hooks · API · schema · extract · fit · forms). **Do NOT edit or extend pre-existing UI components** (`recruiting-wizard/wizard.tsx`, `conditions-panel.tsx`, old control panels) — they are **superseded** by the CD design. Only `WIDGET-SHELL.md` is shared. Editing legacy UI = anchoring to the old design system = the exact inversion this handoff forbids.

## How the worker consumes a feature
1. Open `design-handoff/<feature>/HANDOFF.md` first — it is the entry point (read order, file roles, porting steps, done-when checklist).
2. Read `BUILD-SPEC.md` — the contract (identity, §1 class map, §2 proposed-tokens, §3 state matrix, §4 interaction disclaimer, §5 contract-change, §6 open items).
3. Read `../WIDGET-SHELL.md` — the global shell every widget shares (frame · unified toolbar pill · rail · footer). A feature spec's §1 only adds feature-specific rows on top of it.
4. Open the `.dc.html` for the live visual reference (renders in any browser). Treat inline hex/px as **rendering only** — the diff-target is BUILD-SPEC §1's class map, not the inline styles.
4. Resolve every `⚠️ contract-change:` (§5) with the writer BEFORE porting logic — these are needs beyond the current typed contract.

## Conventions (all specs follow these)
- **Vocabulary:** utility classes / tokens only. No raw hex/px in TSX. New visual values are flagged `proposed-token:` and referenced against `../CONTEXT-PACK.md` + `../tokens.json` (token SSOT — never duplicated per feature).
- **Conformance-first:** every visual element maps to an explicit class / measured value (§1) so the worker can diff, not guess.
- **State coverage:** all states are specified statically (incl. error / empty / disabled / loading). A missing state = worker drift; report back, don't invent.
- **Contract preservation:** typed props assumed. Anything outside the contract is surfaced as `⚠️ contract-change:`, never silently invented.
- **Interaction limits:** prototype interactions are demo-only for visual review; real behavior follows the contract.
- **Versioned & self-contained:** each package carries its date + SSOT; reconciles ship as deltas only.

## Feature status
| Feature | Folder | Setup | Fullview | Status |
|---|---|---|---|---|
| Probing Assistant | `probing/` | ✓ | live (persona/spotlight) | ready for port |
| Live Interpreter | `interpreter/` | ✓ | live control (dual caption) | ready for port |
| Recruiting | `recruiting/` | ✓ | responses (crosstab/fit) | ready for port |
| Transcript | `transcript/` | ✓ | list→detail | ready for port |
| AI UT | `ai-ut/` | ✓ | live→review | ready for port |
| Desk Research | `desk/` | ✓ | report (trend/market) | ready for port |

## Package contents (per feature)
```
<feature>/
  HANDOFF.md              ← worker entry point (read first)
  BUILD-SPEC.md           ← the contract
  Widgets Canvas 1c.dc.html   ← setup/states visual ref
  Widget Fullviews.dc.html    ← fullview visual ref
  support.js              ← DC runtime (lets the .dc.html open standalone)
  GEOMETRY.md             ← only when a custom frame is introduced
```
> The two `.dc.html` files are multi-widget canvases; read only the section for `<feature>`. They are duplicated per folder deliberately (self-contained rule).

**Shared, repo-level (not per feature):** `design-handoff/WIDGET-SHELL.md` (global widget shell + assembly — every widget renders inside it) · `design-handoff/CONTEXT-PACK.md` · `design-handoff/tokens.json`.
