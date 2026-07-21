# AI UT — BUILD-SPEC (CD → Worker handoff)

> **§0 Role boundary.** CD owns presentation; worker owns logic/data/wiring. Spec + `.dc.html` = mechanical TSX port.
> **SSOT:** `Widgets Canvas 1c.dc.html` (setup/states) + `Widget Fullviews.dc.html` (live → review). **Date:** 2026-07-21.
> **Shared contracts (do not duplicate):** `../CONTEXT-PACK.md` · `../tokens.json`.
> **Identity:** pastel header `peach` (#ffd9be) · accent `amore` (#ff5c8a) · credit `PREVIEW`.

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
| Header band | bg pastel-peach · border-b 2px ink | `bg-widget-header-peach`* · `border-b-2 border-ink` |
| Method card (2-col) | radius 13 · sel border 2 amore + soft glow | `rounded-sm border-amore` + **proposed:shadow-card-selected** |
| Task multiline field | border 1.5 ink · radius 14 · min-h 58 | `rounded-sm border-ink` |
| — Live fullview — | | |
| Screen-share monitor | border 3 ink · radius 16 · shadow 3px3px0 · bg ink | `rounded-*(16) border-ink shadow-memphis-sm` |
| Monitor browser bar | bg #2a262f · traffic-light dots · mono url | `bg-ink-2` |
| REC pill | ink bg · #ef4444 dot · mono | `bg-ink text-white` + `signal-danger` dot |
| End session button | border 2px amore · amore text · shadow 2px2px0 amore | **proposed:btn-danger-memphis** |
| Task panel | border 2 ink · radius 14 · bg #fff7f0 · shadow 2px2px0 | `rounded-md border-ink` + **proposed:surface-task-tint** |
| Task step (done/active/todo) | success ✓ / amore ring / ink16% ring | `text-success` / `border-amore` / `border-line` |
| Think-aloud panel | border 1.5 ink/14% · radius 14 · bg #f7f7f5 | `rounded-md border-line bg-surface-elevated` |
| — Review fullview — | | |
| Insight card | border 1.5 ink/14% · radius 14 · bg #fff7f0 | **proposed:surface-task-tint** |
| Clip card | border 1.5 ink · radius 12 · shadow 2px2px0 · ink thumb | `rounded-chrome border-ink shadow-memphis-xs` |
| Clip tag | pain=`#ef4444` / confusion=`#e0a83a` / positive=`#16a34a` | `signal-danger / signal-warning / signal-success` |
| Metric tile | border 1.4 ink/14% · radius 12; low-confidence = opacity .5 | `rounded-chrome border-line` + `opacity-50` for estimated |
| Back-to-live pill | border 1.5 ink/16% · radius 999 · `‹ Live` | `rounded-pill border-line` |

## §2 proposed-token
- `surface-widget-header-peach` (peach band). Fallback: `surface-banner`.
- `surface-task-tint` (`#fff7f0` task/insight card). Fallback: `bg-peach/20`.
- `btn-danger-memphis` (amore-bordered End button + hard shadow) — shared w/ Interpreter.
- `signal-danger` (`#ef4444` REC dot / pain tag).
- `surface-disabled`, `shadow-card-selected` — shared w/ Probing.

## §3 State matrix (cover ALL)
Setup card:
| State | Trigger | Render |
|---|---|---|
| **open** | default | 4 steps. footNote `Enter expected language & task` · CTA idle `🔗 Create session · issue link` |
| **collapsed** | empty-area click | 4 summary rows (Project / Test method / Expected language / Target · Task) |
| **ready** | project ∧ method ∧ language ∧ (URL ∧ task) | CTA active |
| **share** | CTA click | in-place link-share (Waiting) · footNote `Waiting for participant` · CTA `■ Cancel session` |
| **error** *(add)* | invalid URL / session create fail | `Banner` warning `sessionError` + retry; CTA idle |
| **disabled** *(add)* | credits exhausted | CTA `surface-disabled` |

Setup steps:
1. `Select the project you are working on` — shared ProjectPicker.
2. `Select the test method` — **2 cards** (exclusive axis = capture device): `Test on my device`(I run it here · no link) · `Test on participant device`(issue a link · participant captures).
3. `Select the expected language` — `Participant language` dropdown.
4. `Enter the target and task` — Target URL field + Participant task multiline.

Live/review fullview (`Widget Fullviews` · AI UT) — **two-state**:
- **Live** (default): screen-share monitor (browser-mirror + live cursor + REC/mic/cursor strip) · Assigned-task panel (steps w/ progress) · Think-aloud stream. Header REC timer + **End session** → review.
- **Review** (after End): Insight report · Key clips (3, tagged) · Behavioral metrics (6; low-confidence 2 dimmed) · utterance log. Header `‹ Live` returns (demo).

## §4 Interaction disclaimer
Proto interactions (picker, End session, back-to-live, canned monitor/captions) are demo-only. Real screen capture, cursor/click tracking, think-aloud STT, and insight generation are worker-owned. The 2-card method axis is a **product decision** (capture device); location/observation are runtime, not setup modes.

## §5 contract-change (⚠️ surface only)
- ⚠️ `contract-change:` **participant-device session via link** (link-issue → remote screen+audio capture → recording).
- ⚠️ `contract-change:` **live screen mirror + cursor/click tracking** feed.
- ⚠️ `contract-change:` **assigned task with steps + live progress** shape.
- ⚠️ `contract-change:` **think-aloud transcript** stream `{ tag, text }`.
- ⚠️ `contract-change:` **behavioral metrics with confidence** (estimated → dimmed) — model output shape.
- ⚠️ `contract-change:` **insight report + tagged clips** — model output.
- ⚠️ `contract-change:` **`PREVIEW` credit** billing model.

## §6 Open items
- `PREVIEW` credit confirm. · "Test on my device" local-run branch (no link) detail. · Clip thumbnail source. · i18n ko/en/ja/th parity.


---

## §3b Initial state — ghost preview (defect-A fix, all data-dependent steps)
> **Decision (2026-07-21): (c) hybrid.** A step whose input isn't ready yet renders a **ghost preview**, never a one-line placeholder bar.
- **Ghost preview** = the REAL populated component (chips / rows / table) rendered **muted** (low opacity, neutral fill — the actual component, not a skeleton bar) + a thin label `Auto-generated after extraction` / `Example`.
- **post-data** = the same component with real data (canonical — worker MUST build it).
- The gated behavior (empty until data) is correct and stays; only the empty *rendering* changes from placeholder → ghost.
- `demo-only` applies to **behavior only**, never to rendered content (§4).

## §7 Strings — i18n keys only (canonical locale, EN = reference)
> **Root fix for language drift:** render every string from the feature's existing **i18n namespace key**, never hardcode. The EN copy in this spec is **reference only** — do NOT ship it verbatim. App locale (currently `/en` default w/ Korean banner) then resolves automatically. Requirement: **0 hardcoded strings**, ko/en/ja/th parity.
