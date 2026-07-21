# Recruiting — BUILD-SPEC (CD → Worker handoff)

> **§0 Role boundary.** CD owns presentation (visual/layout/copy). Worker owns logic/data/wiring. This spec + the paired `.dc.html` = a mechanical TSX port — no visual decisions left open.
> **SSOT:** `Widgets Canvas 1c.dc.html` (setup/states) + `Widget Fullviews.dc.html` (responses view). **Date:** 2026-07-21.
> **Shared contracts (do not duplicate):** `CONTEXT-PACK.md` (token vocab SSOT) · `tokens.json` (machine values) · `RECRUITING-CONTEXT-PACK.md` (current-impl map). Colors/radii/shadows/type reference those files' `bg-*` / `shadow-memphis-*` / `text-ink` / `rounded-*`.
> **Identity:** pastel header `sun` (#ffe8a8) · accent `amore` (#ff5c8a) · credit 💎 10.

---

## §1 Class mapping (Conformance-first)
> `.dc.html` renders inline hex/px (DC runtime can't render utility classes). This table is the diff-target: every visual = an explicit class / measured value.
> **Shell + assembly = `../WIDGET-SHELL.md` (SSOT, §S1 class map + §S2 assembly + §S3 identity). Build the shell from there regardless of port order.** Rows below are feature-specific only.

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

## §1b Assembly rules (composition — worker must not split/merge parts)
> §1 lists parts; this fixes how they COMPOSE. Conformance diffs assembly too, not just individual classes.
- **Header toolbar = ONE pill**, not separate boxes: `[ 💎{credit} │ ● {status} │ 🎨 │ ⤢ ]` in a single `border-ink rounded-chrome shadow-memphis-xs` container, segments divided by 1.5px ink rules, in this exact order (credit · status · palette · fullview-last). ✗ Do NOT render credit/palette and READY/Fullview as detached pills.
- **Title + toolbar** share the header band row: title left, toolbar right, single row.
- **Step accordion** = one vertical rail (left line) threading all 4 nodes; steps are children of the rail, never separate cards.
- **CTA + footNote** = one footer row (footNote left, CTA right), border-top divider.

## §2 proposed-token (new vocabulary → token-PR track)
- `surface-widget-header-sun` (sun pastel band). Fallback: `surface-banner`.
- `surface-locked` (#faf6ea locked survey block). Fallback: `bg-amber-50`-equiv neutral.
- `signal-warning-bg / -line / -text` (⚠ flag pill #fff8e6/#f0d78a/#8a5a10).
- `fg-amore-deep` (#c2367a — crosstab highlight + medium-fit text). Fallback: `text-amore` darkened.
- `surface-disabled`, `shadow-card-selected` — shared w/ Probing.

## §3 State snapshots (build EACH — populated content is CANONICAL, not demo)
> 👻 **Initial state = ghost preview (c-hybrid, 2026-07-21):** a pre-data step renders the REAL component **muted** (low-opacity actual chips/rows, NOT a skeleton bar) + label `Auto-generated after extraction`. post-data swaps to real data. Placeholder bars are forbidden.
> ⚠️ **Read this first:** the proto renders every step OPEN + POPULATED so you can SEE the finished UI of each step. That populated UI (criteria chips, locked survey rows) **is the spec you must build** — it is NOT "demo-only." Do NOT substitute a one-line gray placeholder for a step whose populated design is shown. Each step has a **pre-data** and a **post-data** render; build both.

**Per-step render (pre-data → post-data):**
| Step | Pre-data (no input yet) | Post-data (CANONICAL — build this) |
|---|---|---|
| 1 Source | paste box (empty) + dropzone | paste box w/ text + uploaded-file chips list |
| 2 Criteria | slim disabled row `Upload source to extract criteria` | **criteria chips** — required=amore border + `Required`, nice-to-have=line border, category eyebrow (mono 9). *(build the chip component now; seed w/ sample if no data)* |
| 3 Survey | slim disabled row `Approve criteria to generate the survey` | **section rows** — Privacy consent 🔒 + Screening questions (editable) + Personal info 🔒; locked rows bg `surface-locked` + `🔒 Standard` pill |
| 4 Publish | info card (creates Form + linked Sheet, anyone-with-link) | same + enabled |

**Widget-level states (each a distinct static render):**
| State | Trigger | Render |
|---|---|---|
| **open (default)** | widget opened | 4 steps expanded, each in its pre/post-data render above. footNote `Upload source to extract criteria` · CTA `Extract criteria` (idle until source present) |
| **extracting** | after source upload | STEP2/3 skeleton + `Extracting criteria…`; CTA idle |
| **populated/ready** | criteria+survey present | STEP2 chips + STEP3 rows shown (post-data); CTA active `Publish form →` |
| **collapsed** | empty-area click | 4 summary rows (Source `3 files · RFP` / Criteria `12 criteria` / Survey `4 sections · 18 questions` / Publish `Google Form`) |
| **published** | CTA click | in-place Handoff → `Please check the full view` + `← Back to setup`. footNote `Published · collecting responses` · CTA `View responses →` |
| **error** | source parse fail | `Banner` warning `extractError` + retry; CTA idle |
| **empty (fullview)** | 0 responses after publish | responses list = `No responses yet` dashed state |
| **disabled** | credits exhausted / no org | CTA `surface-disabled`, tooltip `Not enough credits` |

> **CTA label depends on stage:** before criteria exist the primary action is `Extract criteria`; after publish-ready it is `Publish form →`. Do not hardcode one.

Responses fullview (`Widget Fullviews` · Recruiting) — 2-panel:
- **Left (400)**: Participant criteria card (summary + chips) + **Distribution card** = gender×age crosstab (row/col totals + grand; one highlight cell; note "Fixed at 100% — filters highlight, never change counts").
- **Right**: form selector · `[Fit summary | Raw data]` tabs · fit filter chips (`All / High / Medium / Low` w/ counts) · **judged table** (`#N`+⚠flag · Gender · Age · Region · Fit badge + one-line reason). Footer: `name & phone excluded from view`.

## §4 Interaction disclaimer (scope = BEHAVIOR ONLY, never content)
> This disclaimer covers **interactive behavior**, NOT rendered content. The proto's populated content (chips, rows, tables) is canonical (§3) — only the wiring is demo.
- Demo-only **behavior**: picker toggle, step open/collapse, fit-filter chips, tab switch, canned crosstab numbers. Real filtering/extraction/publish/ingest are worker-owned.
- **NOT demo**: every rendered element, its populated layout, copy, and classes. Build them.

## §7 Strings (canonical locale = Korean; EN = reference only)
> Product default locale is **ko**. Do NOT ship the English spec labels verbatim (that caused mixed-language drift). Use the `Recruiting` i18n namespace; EN column is for the worker's comprehension only. All 4 locales (ko/en/ja/th) must reach parity.

| Key | ko (ship) | en (reference) |
|---|---|---|
| title | 리크루팅 | Recruiting |
| step1 | 소스 자료 업로드 (RFP · 브리프 · 이메일) | Upload the source material |
| step1.paste | 이메일, 메신저, 브리프 텍스트를 그대로 붙여넣으세요 | Paste an RFP, brief, or recruiting email |
| step1.drop | 파일을 끌어다 놓거나 클릭 | Drag & drop or click to upload |
| step2 | 참여자 조건 검토 | Review the participant criteria |
| step2.pre | 조건 추출을 위해 소스를 업로드하세요 | Upload source to extract criteria |
| step3 | 스크리닝 설문 검토 | Review the screening survey |
| step3.pre | 조건 승인 후 설문이 생성됩니다 | Approve criteria to generate the survey |
| step4 | Google Form으로 발행 | Publish to a Google Form |
| step4.desc | Google Form + 연결된 시트를 생성해 링크 보유자에게 공유합니다 | Creates a Google Form + linked Sheet, shared with anyone-with-link |
| cta.extract | 조건 추출 | Extract criteria |
| cta.publish | 폼 발행 → | Publish form → |
| foot.pre | 조건 추출을 위해 소스를 업로드하세요 | Upload source to extract criteria |
| badge.required | 필수 | Required |
| badge.locked | 🔒 표준 | 🔒 Standard |
| status.ready | 준비됨 | READY |
> Fullview strings (criteria/distribution/fit/…) follow the same rule — ship ko, keep en for reference.

## §5 contract-change (beyond current typed contract)
- ⚠️ `contract-change:` **AI criteria extraction from source docs** — needs an extract pipeline (RFP/brief → typed criteria list w/ required flag + category).
- ⚠️ `contract-change:` **standard locked survey blocks** (consent + PII) vs editable domain questions — confirm the survey schema distinguishes locked vs editable sections.
- ⚠️ `contract-change:` **fit judgement (high/medium/low + reason + flags)** — model-produced field, confirm shape `{ fit, reason, flags[] }` per respondent.
- ⚠️ `contract-change:` **PII exclusion in view** (name/phone hidden) — enforce at query/view layer, not just UI hide.
- ⚠️ `contract-change:` **distribution fixed at 100%** (filters highlight cells but never recompute counts) — a deliberate stats rule, confirm.
- ⚠️ `contract-change:` **Google Form + linked Sheet creation** — external integration scope (form gen, permissions, response sync).

## §6 Open items
- Credit 💎 10 / `PREVIEW` billing confirm. · Scheduling is a **separate scope** (candidate → slot → admin invite request; actual outreach handled by admin view — out of this widget). · i18n ko/en/ja/th parity for all new strings. · Respondent drawer (full Q→A + PII lock) — static/deferred, not in this set.
