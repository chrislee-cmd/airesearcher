# RECRUITING LIST CONTROLS — Sort & filter bar (surface-scoped)

> **Scope:** the **Uploaded-list controls in the Recruiting fullview ① Responses tab** — the sort/filter bar and its pickers. **Date:** 2026-07-27. **CD SSOT:** `Recruiting Journey Fullview.dc.html`, frame **N6** (states A / B / C).
> **Relationship to `picker-system/`:** this is the **recruiting-scoped application** of the global Picker System. If both bundles ship, build the shared component from `picker-system/BUILD-SPEC.md` and treat this file as the surface's composition + copy. If only this ships, it is self-contained.

## The defect this fixes
The live implementation renders three free-floating pills (`Sort ▾` · `선정여부 ▾` · `M1 ▾`) with ad-hoc gaps across the toolbar — inconsistent spacing, no visual grouping, and no way to tell what is currently filtered. Filtering also stopped at the question level, with no way to pick specific answers.

## State A — resting bar
Single row, `padding 12px 18px`, `border-bottom 1px line`:
1. **List title** — `Uploaded list` Outfit 800/16 + count mono 12/700 `mute-soft`.
2. **1.5px `line` divider**, 22px tall.
3. **Segmented control** (one border, ink dividers, `shadow 2px2px0 ink`, radius 10) containing **`Sort ▼`** and **`Filter ▼`** — 12.5/700, 13px icon (sort = up/down arrows, filter = funnel), stroke 2.3.
4. `margin-left:auto` → **search field** (`🔍 Search name · contact`, border `line`, radius 10) + **`↓ CSV`** button (border 1.5 ink, `shadow 2px2px0 ink`).

## State B — filter picker open
- Count becomes **`38 / 447`** — filtered in `amore-deep`, total in `mute-soft`.
- `Filter` cell → **ink fill + white**, with an **amore count badge** (`2`) and caret `▲`.
- Helper right-aligned: "Filters narrow the table — the distribution crosstab stays at 100%."
- **Active chip row** (`background #fffdf6`, `border-bottom 1px line`, `padding 10px 18px`): mono `ACTIVE` label + one chip per filtered field (`선정여부 M1 · M2` / `플랫폼 학생`) + `Clear all`.
- **Two-pane picker**, 660×330, border 2px ink, radius 13, `shadow 4px4px0 ink/.22`:
  - **Left 250px** (`surface-canvas`, `border-right 2px ink`) — `QUESTION` label; one row per survey question; active row = `paper` + 1.5px ink border + weight 800; questions with filters carry an **amore count badge**; chevron `›` (`ink` active / `line-empty` idle).
  - **Right** — `ANSWERS · <question>` + `Select all` (`amore-deep`); search field; **checkbox rows, multi-select** (17px box radius 5, ink fill + `✓` when on; selected row tint `#fffdf6`, weight 700) with per-answer counts (`M1 214`, `M2 96`, `M3 71`, `보류 38`, `탈락 22`, `(빈 값) 6`).
  - **Footer** (`paper-soft`, `border-top 2px ink`) — `2 selected · 38 rows` + `Reset` + **`Apply`** (ink fill).

## State C — sort picker open
320px panel: `SORT BY` label + **radio list, single-select** (Name / Contact / 선정여부 / 출생년도 / Added date / Slot) + footer `ORDER` with an **`↑ Asc` / `↓ Desc`** segmented control. Single-select applies instantly; the direction segment is separate so sorting and filtering never share a control.

## Rules carried from this surface
1. **Multi-select is required** — a question can be filtered to several answers at once (`M1` + `M2`).
2. **Explicit Apply** — the table is 447 rows; do not refetch per checkbox click.
3. **Filters never change the crosstab** — the Distribution card stays at 100% of responses (existing contract); it only highlights.
4. `(빈 값)` is a first-class option — respondents who skipped the question must be filterable.
5. Question labels can be long Korean strings — left pane truncates with ellipsis, never wraps.

## Tokens
Same map as `picker-system/BUILD-SPEC.md §5` — 15 mapped, 6 gaps (`picker-option-selected`, `focus-ring`, `shadow-picker-panel`, off-scale radii, border widths, `control-h-*`). No recruiting-specific tokens are introduced.

## ⚠️ contract-change
1. **`⚠️ contract-change:` per-answer counts.** The picker shows a count next to every answer value — requires a per-question value histogram for the uploaded list. Confirm it can be computed client-side from the loaded rows (447 is fine) or needs an endpoint.
2. **`⚠️ contract-change:` multi-value filter payload.** Filter state moves from one value per field to `{ field: string[] }`. Confirm the list query accepts arrays (`IN`) and that combining fields is `AND` across fields / `OR` within a field.
3. `(빈 값)` requires null/empty to be a queryable value, not just absent.
4. Sort field list must come from the uploaded sheet's columns, not a hardcoded set.
