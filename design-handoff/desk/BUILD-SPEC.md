# Desk Research — BUILD-SPEC (CD → Worker handoff)

> **§0 Role boundary.** CD owns presentation; worker owns logic/data/wiring. Spec + `.dc.html` = mechanical TSX port.
> **SSOT:** `Widgets Canvas 1c.dc.html` (setup/states) + `Widget Fullviews.dc.html` (report view). **Date:** 2026-07-21.
> **Shared contracts (do not duplicate):** `../CONTEXT-PACK.md` · `../tokens.json` · `../DESK-RESEARCH-CONTEXT-PACK.md` (current-impl map).
> **Identity:** pastel header `cyan` (#bfe9ef, distinct from Probing sky) · accent `amore` (#ff5c8a) · credit 💎 75.

---

## AUTHORITY — design-led (greenfield) widgets, CD = visual SSOT
> The integ widgets (Probing · Interpreter · Recruiting · Transcript · AI UT · Desk) are **net-new CD designs, NOT bound to the pre-existing app design system.** Appearance priority:
> 1. **CD is the visual source of truth** — the `.dc.html` + BUILD-SPEC define how the widget looks. Reproduce it.
> 2. Existing DS tokens/classes are a **convenience vocabulary**, used ONLY where they already reproduce the CD value exactly.
> 3. **On conflict, CD wins.** The gap is a DS gap to fill (add a `proposed-token` / new component) — never a CD value to bend toward a DS default.
> Do not "reconcile" these widgets into legacy DS components. Realize the CD design; extend the DS to fit it. `hex/px-forbidden` means **promote CD's value to a token**, NOT substitute the nearest existing DS default.

> **§D Anti-anchoring (build fresh, don't edit legacy UI):** the worker builds the presentation as a **NEW component** per the CD `.dc.html` (e.g. `setup-accordion.tsx`, like Probing did). **Reuse logic/data only** (hooks · API · schema · extract · fit · forms). **Do NOT edit or extend pre-existing UI components** (`recruiting-wizard/wizard.tsx`, `conditions-panel.tsx`, old control panels) — they are **superseded** by the CD design. Only `WIDGET-SHELL.md` is shared. Editing legacy UI = anchoring to the old design system = the exact inversion this handoff forbids.

## §1 Class mapping (Conformance-first)
> **Shell + assembly = `../WIDGET-SHELL.md` (SSOT, §S1 class map + §S2 assembly + §S3 identity). Build the shell from there regardless of port order.** Rows below are feature-specific only.

| Element | Measured (proto) | Utility class / token |
|---|---|---|
| Header band | bg pastel-cyan · border-b 2px ink | `bg-widget-header-cyan`* · `border-b-2 border-ink` |
| Keyword chip | border 1.4 ink · radius 999 · `×` mute | `rounded-pill border-ink` |
| Mode card (2-col) | radius 13 · sel border 2 amore + soft glow | `rounded-sm border-amore` + **proposed:shadow-card-selected** |
| Scope field (region/period) | border 1.5 ink · radius 14 | `rounded-sm border-ink` |
| Estimate hint box | bg #f7f7f5 · border 1.4 ink/10% · radius 12 | `bg-surface-elevated rounded-chrome` |
| — Report fullview — | | |
| Scroll-spy nav | 210 · border-r 2 ink · bg #f7f7f5; active `bg-widget-header-cyan` | `border-ink bg-surface-elevated` |
| AI judgment log card | border 1.5 ink/14% · radius 12 · 2-col grid | `rounded-chrome border-line` |
| Section card | border 3 ink · radius 14 · shadow 4px4px0 | `rounded-lg border-ink shadow-memphis-md` |
| Section head band | border-b 2 ink · accent-tinted bg | per-section accent tint (see §2) |
| RQ card | border 2 ink · radius 11 · shadow 2px2px0 | `rounded-chrome border-ink shadow-memphis-xs` |
| Confidence pill | high 🟢`#16a34a` / med 🟡`#e0a83a` / low 🔴 | `signal-success / signal-warning / signal-danger` |
| "To explore" box | bg #fff8e6 · border 1.3 #f0d78a | **proposed:signal-warning-bg/-line** |
| Quant value | mono 800 · `#c2367a` | **proposed:fg-amore-deep** |
| Tier badge | T1 success / T2 warning / T3 mute | `signal-success / -warning / text-mute` |
| Export chips | border 1.5 ink · radius 12 · shadow 2px2px0 | `rounded-chrome border-ink shadow-memphis-xs` |

## §2 proposed-token
- `surface-widget-header-cyan` (cyan band — deliberately distinct from Probing `sky`). Fallback: `surface-banner`. *(brand decision: keep cyan or unify to sky — §6)*
- `signal-warning-bg / -line` (`#fff8e6 / #f0d78a` — "to explore" box; shared w/ Recruiting flag).
- `fg-amore-deep` (`#c2367a` quant value; shared w/ Recruiting).
- Section accent set: `executive→amore · findings→success · quant→warning · rq→info(#8b5cf6) · appendix→mute` — confirm accent token set (RQ `info` currently missing, proto uses `#8b5cf6`).
- `surface-disabled`, `shadow-card-selected`, `shadow-memphis-md` — shared.

## §3 State matrix (cover ALL)
Setup card:
| State | Trigger | Render |
|---|---|---|
| **open** | default | 4 steps. footNote `Add keywords to search` · CTA idle `🔍 Search →` |
| **collapsed** | empty-area click | 4 summary rows (Project / Keywords / Purpose / Scope) |
| **ready** | project ∧ ≥1 keyword ∧ mode ∧ scope | CTA active |
| **started** | CTA click | in-place **Handoff** (crawling) · footNote `Research in progress` · CTA `■ Stop` |
| **stuck** *(add)* | progress stalled 150s | `Banner` info `stuckTitle` (+ refund button after 4.5min) |
| **error/timeout** *(add)* | runtime/budget/scoping fail (300s auto-refund) | `Banner` warning `errorTitle`/`timeoutTitle` + retry |
| **fallback/raw-dump** *(add)* | synth fail → deterministic / raw only | `Banner` info `fallbackTitle`/`rawDumpTitle` + retry |
| **done-empty** *(add)* | done but empty output | `Banner` warning `doneEmptyTitle` + retry |
| **cancelled** *(add)* | user stop | EmptyState `cancelledNotice` |
| **skipped sources** *(add)* | source 0 results | result-top banner, tone by reason (invalid_key = amore) |
| **disabled** *(add)* | credits exhausted | CTA `surface-disabled` |

Setup steps:
1. `Select the project you are working on` — shared ProjectPicker.
2. `Enter topics · keywords` — add-row + keyword chips (max 10).
3. `Choose the research purpose` — **2 cards**: `Trend research`(news · SNS · search volume) · `Market research`(stats · filings · TAM/SAM). *(market adds country-scope KR/Global — proto shows scope in step 4.)*
4. `Set the scope` — search region + period dropdowns + AI-auto-source hint + estimate (`N kw × M src × K region ≈ X searches`; heavy = amore warning).

Report fullview (`Widget Fullviews` · Desk):
- Header: cyan band · project picker · `Latest research ▾` (prior-jobs dropdown, last 20) · close.
- Left scroll-spy section nav (210). Right body: **AI judgment log** (🧠 markers, 2-col) → expanded keywords chips → **section cards** (Executive / Findings / **Quant table** subject·value·source·T1–T3 tier / **Research questions** RQ card + confidence pill + "to explore" / Appendix) → Export (.docx / .md / Google Docs).
- **market mode** = different shape (KPI hero + reference-data warning + size-tier/revenue/outlook/sources); trend mode as above.

## §4 Interaction disclaimer
Proto interactions (picker, mode select, scroll-spy nav, `Latest research ▾`, canned report) are demo-only. Real fan-out crawl, extraction, tiering, judgment, synthesis, and prior-job hydration are worker-owned. **StageFlow timed-reveal** (each stage held ≥5s) is a UI affordance, not real phase timing. Sources are **AI-auto-selected** (no source picker in current control board; `ui-categories` is a deferred presentation layer).

## §5 contract-change (⚠️ surface only)
- ⚠️ `contract-change:` **trend vs market report shapes** (7-section vs 6-section) — heading-icon parsing contract; confirm.
- ⚠️ `contract-change:` **RQ answers** `{ id, question, category, importance, confidence, answer, missing_data[] }`.
- ⚠️ `contract-change:` **quant claims + tier** `{ subject, value, source, tier(T1–T3) }`.
- ⚠️ `contract-change:` **AI judgment log** (marker-filtered lines).
- ⚠️ `contract-change:` **country scope (KR/Global)** for market mode — placement (step 3 vs 4) + gating.
- ⚠️ `contract-change:` **prior-jobs dropdown** (last 20, light list + on-demand hydration).
- ⚠️ `contract-change:` **300s hard deadline + auto-refund + cancel** semantics driving §3 banners.
- ⚠️ `contract-change:` **revenue chart / KPI hero** (market) structured values.

## §6 Open items
- Credit 💎 75 confirm. · **cyan vs sky** header (brand: keep distinct or unify with Probing). · RQ `info` accent token. · Source-picker UX (auto-select now; `ui-categories` deferred). · i18n ko/en/ja/th parity (incl. hardcoded market labels flagged in DESK-RESEARCH-CONTEXT-PACK §9).


---

## §3b Initial state — ghost preview (defect-A fix, all data-dependent steps)
> **Decision (2026-07-21): (c) hybrid.** A step whose input isn't ready yet renders a **ghost preview**, never a one-line placeholder bar.
- **Ghost preview** = the REAL populated component (chips / rows / table) rendered **muted** (low opacity, neutral fill — the actual component, not a skeleton bar) + a thin label `Auto-generated after extraction` / `Example`.
- **post-data** = the same component with real data (canonical — worker MUST build it).
- The gated behavior (empty until data) is correct and stays; only the empty *rendering* changes from placeholder → ghost.
- `demo-only` applies to **behavior only**, never to rendered content (§4).

## §7 Strings — i18n keys only (canonical locale, EN = reference)
> **Root fix for language drift:** render every string from the feature's existing **i18n namespace key**, never hardcode. The EN copy in this spec is **reference only** — do NOT ship it verbatim. App locale (currently `/en` default w/ Korean banner) then resolves automatically. Requirement: **0 hardcoded strings**, ko/en/ja/th parity.
