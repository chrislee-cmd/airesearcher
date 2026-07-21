# Recruiting — BUILD-SPEC (CD → Worker handoff)

> **§0 Role boundary.** CD owns presentation (visual/layout/copy). Worker owns logic/data/wiring. This spec + the paired `.dc.html` = a mechanical TSX port — no visual decisions left open.
> **SSOT:** `Widgets Canvas 1c.dc.html` (setup/states) + `Widget Fullviews.dc.html` (responses view). **Date:** 2026-07-21.
> **Shared contracts (do not duplicate):** `CONTEXT-PACK.md` (token vocab SSOT) · `tokens.json` (machine values) · `RECRUITING-CONTEXT-PACK.md` (current-impl map). Colors/radii/shadows/type reference those files' `bg-*` / `shadow-memphis-*` / `text-ink` / `rounded-*`.
> **Identity:** pastel header `sun` (#ffe8a8) · accent `amore` (#ff5c8a) · credit 💎 10.

---

## §1 Class mapping (Conformance-first)
> `.dc.html` renders inline hex/px (DC runtime can't render utility classes). This table is the diff-target: every visual = an explicit class / measured value.
> Card shell / header band / title / toolbar pill / step nodes / rail / field / CTA rows are **identical to Probing §1** — see that spec. Recruiting-specific rows below.

| Element | Measured (proto) | Utility class / token |
|---|---|---|
| Header band | bg pastel-sun · border-b 2px ink · pad 18/22 | `bg-widget-header-sun`* · `border-b-2 border-ink` |
| Source paste box | border 1.5 ink · radius 14 · min-h 50 · mute placeholder | `rounded-sm border-ink text-mute` |
| Upload dropzone | border 1.6 dashed ink/22% · radius 14 · pad 16 · bg #f7f7f5 | `rounded-sm border-dashed border-line bg-surface-elevated` |
| Criteria chip (required) | border 1.4 amore · radius 999 · cat eyebrow mono 9 | `rounded-pill border-amore` |
| Criteria chip (nice-to-have) | border 1.4 ink/14% · radius 999 | `rounded-pill border-line` |
| Survey section row | border 1.4 ink/14% · radius 12 · pad 11/13 | `rounded-chrome border-line` |
| Survey locked row | bg #faf6ea · `🔒 Standard` pill | **proposed:surface-locked** |
| Publish info card | bg #f7f7f5 · border 1.4 ink/10% · radius 12 | `bg-surface-elevated rounded-chrome` |
| CTA (active/idle) | ink/#fff · radius 999 // #eceef1/#8a8693 | `bg-ink rounded-pill` // **proposed:surface-disabled** |
| — Fullview responses — | | |
| Modal shell | max-w 1400 · h 840 · border 3 ink · radius 14 · shadow 10px10px0 ink/28% | `rounded-lg border-ink shadow-memphis-lg` |
| Header action pill | border 1.5 ink · radius 999 · shadow 2px2px0 | `rounded-pill border-ink shadow-memphis-xs` |
| Criteria/Distribution card | border 2 ink · radius 12 · shadow 2px2px0 | `rounded-chrome border-ink shadow-memphis-xs` |
| Crosstab highlight cell | color #c2367a · bg amore/12% · weight 800 · radius 6 | `text-amore-deep bg-amore/12` → **proposed:fg-amore-deep** |
| Fit badge high / med / low | success #16a34a / amore #c2367a / mute #8a8693 (dot+label) | `text-success` / `text-amore-deep` / `text-mute` |
| Flag pill | `#8a5a10` on `#fff8e6` border `#f0d78a` | **proposed:signal-warning-bg/-line/-text** |
| Judged table header | sticky · bg #f7f7f5 · mono 9.5 uppercase mute | `sticky bg-surface-elevated font-mono text-mute` |

## §2 proposed-token (new vocabulary → token-PR track)
- `surface-widget-header-sun` (sun pastel band). Fallback: `surface-banner`.
- `surface-locked` (#faf6ea locked survey block). Fallback: `bg-amber-50`-equiv neutral.
- `signal-warning-bg / -line / -text` (⚠ flag pill #fff8e6/#f0d78a/#8a5a10).
- `fg-amore-deep` (#c2367a — crosstab highlight + medium-fit text). Fallback: `text-amore` darkened.
- `surface-disabled`, `shadow-card-selected` — shared w/ Probing.

## §3 State matrix (cover ALL — worker must not guess)
Setup card (`ControlBoardPanel` body):
| State | Trigger | Render |
|---|---|---|
| **open** | default | 4 steps expanded. footNote `Upload source to extract criteria` · CTA idle `🔗 Publish form →` |
| **collapsed** | empty-area click | 4 summary rows (Source `3 files · RFP` / Criteria `12 criteria` / Survey `4 sections · 18 questions` / Publish `Google Form`) |
| **ready** | source ∧ criteria ∧ survey ∧ publish-confirm | CTA active (ink) |
| **published** | CTA click | in-place **Handoff** → `Please check the full view` + `← Back to setup`. footNote `Published · collecting responses` · CTA `View responses →` |
| **extracting** *(add)* | after source upload, before criteria ready | STEP2/3 show skeleton + `Extracting criteria…` (spinner text); CTA idle |
| **error** *(add)* | source parse fail / no source | `Banner` warning `extractError` + retry; CTA idle |
| **empty** *(add)* | 0 responses after publish | fullview list empty → `No responses yet` dashed state |
| **disabled** *(add)* | credits exhausted / no org | CTA `surface-disabled`, tooltip `Not enough credits` |

Setup steps:
1. `Upload the source material (RFP · brief · email)` — paste box + dropzone (`pdf · docx · xlsx · csv · txt · up to 10`).
2. `Review the participant criteria` — auto-extracted chips; **required = amore border**, nice-to-have = line border; category eyebrow.
3. `Review the screening survey` — section list; **Privacy consent & Personal info = 🔒 Standard locked blocks** (uneditable); only domain screening questions editable.
4. `Publish to a Google Form` — info card (creates Form + linked Sheet, anyone-with-link).

Responses fullview (`Widget Fullviews` · Recruiting) — 2-panel:
- **Left (400)**: Participant criteria card (summary + chips) + **Distribution card** = gender×age crosstab (row/col totals + grand; one highlight cell; note "Fixed at 100% — filters highlight, never change counts").
- **Right**: form selector · `[Fit summary | Raw data]` tabs · fit filter chips (`All / High / Medium / Low` w/ counts) · **judged table** (`#N`+⚠flag · Gender · Age · Region · Fit badge + one-line reason). Footer: `name & phone excluded from view`.

## §4 Interaction disclaimer (§6)
Prototype interactions (project picker, step open/collapse, fit-filter chips, tab switch) are **demo-only for visual review**. Real filtering, extraction, publish, and response ingest are worker-owned (contract). Crosstab counts are canned; live data via response feed.

## §5 contract-change (beyond current typed contract)
- ⚠️ `contract-change:` **AI criteria extraction from source docs** — needs an extract pipeline (RFP/brief → typed criteria list w/ required flag + category).
- ⚠️ `contract-change:` **standard locked survey blocks** (consent + PII) vs editable domain questions — confirm the survey schema distinguishes locked vs editable sections.
- ⚠️ `contract-change:` **fit judgement (high/medium/low + reason + flags)** — model-produced field, confirm shape `{ fit, reason, flags[] }` per respondent.
- ⚠️ `contract-change:` **PII exclusion in view** (name/phone hidden) — enforce at query/view layer, not just UI hide.
- ⚠️ `contract-change:` **distribution fixed at 100%** (filters highlight cells but never recompute counts) — a deliberate stats rule, confirm.
- ⚠️ `contract-change:` **Google Form + linked Sheet creation** — external integration scope (form gen, permissions, response sync).

## §6 Open items
- Credit 💎 10 / `PREVIEW` billing confirm. · Scheduling is a **separate scope** (candidate → slot → admin invite request; actual outreach handled by admin view — out of this widget). · i18n ko/en/ja/th parity for all new strings. · Respondent drawer (full Q→A + PII lock) — static/deferred, not in this set.
