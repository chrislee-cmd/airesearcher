# DELIVERABLES LIBRARY — BUILD-SPEC

> **Surface A** of the unified-artifacts brief. **CD SSOT:** `deliverables-library.dc.html` (5 frames). **Date:** 2026-07-28.
> **Read first:** `tokens.json` 2.0 + `TOKEN-DECISIONS.md` (both in this folder). Every value below resolves to a 2.0 token — there are no `proposed-token`s left in this surface.
> **Contract:** each row receives one `DeliverableRow` (brief §0) and nothing else. The shell never inspects `feature` to decide layout — identity arrives as a tone, status as a shared 4-state badge.

---

## §1 Class map (diff target)

### Frame + regions
| Element | Spec | Token / class |
|---|---|---|
| Surface frame | border 3px ink · radius 16 · `shadow-frame` · bg `surface-canvas` | `border-[3px] border-ink rounded-panel-lg shadow-frame surface-canvas` |
| Header | border-b 3px ink · `paper` · pad 16/24 | `border-b-[3px] border-ink paper` |
| Filter rail | **240px fixed** · border-r 2px ink · `paper-soft` · pad 16/14 · gap 18 | `w-[240px] shrink-0 border-r-2 border-ink paper-soft` |
| List column | `flex-1`, min-w-0, column | — |
| Footer strip | border-t `line` · `paper-soft` · pad 9/20 · mono 11 `mute-soft` | `border-t border-line paper-soft font-mono-label text-sm text-mute-soft` |

### Header controls
| Element | Spec | Token / class |
|---|---|---|
| Title | Outfit 800 · 24px · ls -0.6 | `font-display font-extrabold` |
| Total count | mono 12 · `mute-soft` — beside the title, no label | `font-mono-label text-mute-soft` |
| Search | max-w 400 · border 1.5 ink · **radius 22** · pad 9/15 · 13px · placeholder `mute-soft` | `border-[1.5px] border-ink rounded-field paper` |
| Sort trigger | grouped: label cell + 1.5px ink divider + caret cell · border 1.5 ink · radius 10 · `shadow-memphis-sm` | `border-[1.5px] border-ink rounded-control paper shadow-memphis-sm` |
| View toggle | two 38px cells, same grouped shell; active cell = `bg-ink text-paper` | same shell, active `bg-ink text-paper` |
> Sort and view-toggle reuse the **picker system** grouped-trigger shell — same border, radius, divider and shadow. They are not bespoke.

### Filter rail
| Element | Spec | Token / class |
|---|---|---|
| Group label | mono 9.5 · `.12em` · uppercase · `mute-soft` · mb 9 | `font-mono-label text-mute-soft` |
| Filter row (off) | pad 7/10 · radius 9 · transparent border + bg · label 12.5/600 `mute` | `rounded-icon` |
| Filter row (**on**) | border 1.5 ink · `paper` · `shadow-memphis-sm` · label 12.5/**800** `ink` | `border-[1.5px] border-ink rounded-icon paper shadow-memphis-sm` |
| Checkbox | 14px · border 1.6 ink · radius 4 · checked = `bg-ink` + white ✓ | `border-ink rounded-xs` |
| Feature dot | 9px circle · `pastel.<tone>` · ring `ink/28` | `bg-<tone>` |
| Status dot | 8px · signal colour; **draft is hollow** (white fill + 1.6px `mute-soft` ring) | `bg-success` / `bg-processing` / `bg-error` |
| Count | mono 11 · `mute-soft` · right-aligned | `font-mono-label text-mute-soft` |
| Project row (active) | bg `pastel.lav` · label 800 ink | `bg-lav` |
> The **selected filter row carries a shadow**; the unselected one has no border at all. This is deliberate — a rail of 12 outlined rows competes with the list. Selection is the only thing that should draw.

### List row
| Element | Spec | Token / class |
|---|---|---|
| Row | pad 12/20 · border-b `line` · gap 9 | `border-b border-line` |
| — hover | bg `surface-canvas` | `surface-canvas` |
| — selected | bg `#fff9fb` (amore-bg at ~18%) + **`inset 3px 0 0 amore`** left edge + tile gains `shadow-memphis-sm-faint` | `bg-amore-bg/20`, inset via `shadow-[inset_3px_0_0_var(--color-amore)]` |
| Feature tile | 34px · border 2px ink · radius 9 · bg `pastel.<tone>` · 15px glyph | `border-2 border-ink rounded-icon bg-<tone>` |
| Title | 13.5/700 ink · truncate. **`error` rows drop to `mute-soft`** | `text-lg font-bold` |
| Kind chip | mono 10/700 `mute-soft` · border 1.3 `line-strong` · radius 5 | `font-mono-label border-line-strong rounded-xs text-mute-soft` |
| Meta line | 11px `mute-soft`, dot-free, wraps | `text-sm text-mute-soft` |
| Status column | **120px fixed** | — |
| Status badge | dot + label · radius pill · pad 3/10 · 11.5/700 · tinted per state (below) | `rounded-pill` |
| Updated column | **104px fixed** · mono 11.5 `mute-soft` | `font-mono-label text-mute-soft` |
| Action column | **214px fixed**, right-aligned, gap 7 | — |

### Status badge — the shared 4-state vocabulary
| State | Dot | Tint | Border | Text |
|---|---|---|---|---|
| `ready` | `success` | `success-bg` | `success-line` | `success-text` |
| `processing` | `processing` | `lav-bg` | `lav-line` | `lav-text` |
| `draft` | hollow (`paper` + `mute-soft` ring) | `paper-soft` | `line-strong` | `mute` |
| `error` | `error` | `error-bg` | `error-line` | `error-text` |
> Identical in list, grid, rail and matrix. **Never** re-word per feature ("Transcribing", "Crawling" etc. belong in the meta line, not the badge) — a shared status vocabulary is the point of the unification.

### Action buttons
| Treatment | Spec | Used for |
|---|---|---|
| Primary | `bg-ink text-paper` · border 2px ink · pill · `shadow-memphis-sm` @28% | Open, when the row is actionable |
| Secondary | `paper` · border 1.5 ink · pill · `shadow-memphis-sm` | Share, ⋯, Open on an `error` row |
| **Disabled** | `surface-disabled` track · border 1.5 `ink/20` · **`text-mute`** · **no shadow** | any action not applicable right now |
| **Hidden** | not rendered | `shareable=false` only |

---

## §2 proposed-tokens
**None.** Every value in this surface is in `tokens.json` 2.0. The one near-miss found in audit (`#ffe0ec` → `amore-bg` `#ffe1eb`) is corrected in the comp.

---

## §3 State matrix (all STATIC — build each)
| # | Frame | State | Notes |
|---|---|---|---|
| A1 | List | **populated** | mixed features · all four statuses present · row 3 hover · row 5 selected · bulk-capable checkboxes |
| A2 | — | **status × action matrix** | the enable/disable/hide rules, drawn per state. Not a UI screen — a conformance target. |
| A3 | Grid | **populated** | same rows as cards; tone header strip carries identity; selected card = `shadow-memphis-md-amore` |
| A4a | List | **⋯ menu open** | portal, z-60, 248px, radius 12, `shadow-memphis-lg` @30%. Groups: Export (from `export_formats`) → Organize (Move / Delete). Trigger flips to `bg-ink`. |
| A4b | List | **multi-select + bulk bar** | 3 selected · `warning-bg` bar + `shadow-memphis-md-amber` · Move/Delete enabled, **Export disabled** (mixed formats, empty intersection) |
| A5a | — | **loading** | 6 skeleton rows, opacity laddering 1 → 0.32, keeping the row rhythm (34 tile · 2 text lines · badge · date · action) |
| A5b | — | **empty (0 total)** | 📥 tile · "No deliverables yet" · four tone-tinted widget CTAs |
| A5c | — | **filtered-empty** | dashed 🔍 tile · active filter chips (removable) · "42 exist — none are both X and Y" · Clear all |
| A5d | — | **error** | frame `shadow-memphis-md-error` · `error-bg` eyebrow · Try again (primary) + Contact support · `ref` id in mono |

### Action-enable rules (A2, normative)
| `status` | Open | Share | Export |
|---|---|---|---|
| `ready` | ✔ primary | ✔ (unless `shareable=false` → **hidden**) | ✔ from `export_formats` |
| `processing` | ✔ primary (shows progress) | ✖ disabled | ✖ disabled |
| `draft` | ✔ primary | ✖ disabled | ✖ disabled |
| `error` | ✔ **secondary** (surfaces failure + retry) | ✖ disabled | ✖ disabled |
- `export_formats: []` → the **whole Export group is omitted** from the ⋯ menu. Never render an empty group heading.
- `shareable=false` → Share is **removed**, not greyed. Disabled means "not right now"; hidden means "never for this kind". Mixing them teaches users to distrust greyed controls.
- Bulk Export requires a **non-empty intersection** of `export_formats` across the selection; Move and Delete never depend on format.

---

## §4 Interaction disclaimer
Static comps: states, not behaviour. Worker owns search, sort, filter combination, selection maths, menu open/close and placement, Open→fullview routing, share-dialog invocation, export dispatch, move-to-project, delete confirmation, pagination/virtualisation. Nothing is wired in the `.dc.html`.

---

## §5 ⚠️ contract-change
1. **`⚠️ contract-change:` `meta` needs a display contract.** `meta: Record<string, unknown>` cannot be rendered generically — the comp shows curated strings ("64 min · 2 speakers", "34 sources · T1 12", "24 responses · High fit 8"). Either (a) the API returns a `meta_display: string[]` of pre-formatted badges, or (b) the client owns a per-`kind` formatter map. **(a) is strongly preferred** — otherwise every new `kind` requires a front-end change, which defeats the shared contract. Until resolved, the row renders `meta` in key order, which will look wrong.
2. **`⚠️ contract-change:` `processing` has no progress field.** The comp shows "Analyzing clips · 62%". Nothing in `DeliverableRow` carries it. Add `progress?: number` (0–1) or accept that processing rows show no percentage.
3. **`⚠️ contract-change:` counts for the filter rail.** Per-feature and per-status counts (`18 / 9 / 7 / 8`, `31 / 4 / 5 / 2`) are rendered in the rail. Either the API returns facet counts or the client computes them from the full array — the latter only works if the list is unpaginated. **Decide before pagination lands.**
4. **`⚠️ contract-change:` `folder_id` is unused.** The rail groups by project only. If folders are a real hierarchy the rail needs a second level; if not, drop the field.
5. `feature` is typed `'transcript' | 'desk' | 'ut' | 'recruiting'` with probing/translate to follow. The tone map is complete for all six today — adding them is a data change only, no UI work.

---

## §6 Open items
- Pagination vs infinite scroll (affects §5.3).
- Whether Open on a `processing` row goes to the fullview or to a progress view.
- Sort field set (comp shows "Updated"; created / title / feature presumably follow).
- Row-level keyboard affordance: the row is not a link in the comp; Open is the only navigation.
