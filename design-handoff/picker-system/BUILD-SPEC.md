# PICKER SYSTEM — Global control spec (dropdown · select · sort · filter)

> **Scope:** ONE component family for **every** picker across the product — widget cards, fullviews, modals, public pages. Generalized from the Recruiting list controls. **Date:** 2026-07-27. **CD SSOT:** `Picker System.dc.html`.
> **Delta bundle.** Assumes repo has `tokens.json`, `FULLVIEW-SHELL.md` (§F5–F6 token vocab), `WIDGET-SHELL.md`, `CD-DELIVERABLE-RULES.md`. Inline hex is render-only — bind to §5 tokens.
> **Supersedes:** the per-surface pickers currently hand-rolled in recruiting / transcript / desk toolbars. Build **one** shared component; do not fork per widget.

## §1 Trigger
| Variant | Height | Geometry | Use |
|---|---|---|---|
| **md** (default) | **34px** | border 1.5 ink · radius 10 · `paper` · `shadow 2px2px0 ink` · `padding 7px 12px` · 12.5/700 | fullview toolbars, tables, modals |
| **sm** (dense) | **28px** | border 1.4 · radius 8 · `shadow 1.5px1.5px0 ink` · `padding 5px 10px` · 11.5/700 | widget-card rails, side panels |
| **field** | 40px | border 1.5 ink · **radius 22** · full-width · 13/600 | setup-form selects — **unchanged existing spec** (see §3 G8) |

Icon 13px inline SVG, stroke 2.3 ink; caret `▼` 9px `mute-soft`.

**Grouping rule (this is the fix for the drifting-pill bug):**
- 2+ sibling pickers → **one segmented control**: single 1.5px ink border, radius 10, `shadow 2px2px0 ink`, `overflow:hidden`, cells split by **1.5px ink dividers**. No gaps, no per-pill shadows.
- A lone picker → standalone trigger.
- **Never** free-floating pills spaced by ad-hoc margins.
- Right-anchor secondary utilities (search, export) with `margin-left:auto`.

### Trigger states (identical on every surface)
| State | Treatment |
|---|---|
| default | `paper` |
| hover | fill → `paper-soft`; border/shadow unchanged |
| open | **ink fill · white label · caret ▲** |
| applied | count badge, **amore** pill, mono 10.5/800 white |
| focus | **`0 0 0 2px paper, 0 0 0 4px amore`** ring (new — see §5 gaps) |
| disabled | `surface-disabled` fill · `text-faint` · border `ink/18` · **no shadow** · not focusable |

## §2 Panels — choose by selection model
| | **P1 single-select** | **P2 multi-select** | **P3 two-pane** |
|---|---|---|---|
| Control | radio 15px | checkbox 17px, radius 5 | checkbox (right pane) |
| Width | 240–320 | 280–330 | 500–660 |
| Apply | **instant, closes** | **explicit Apply** | **explicit Apply** |
| Search | — | at **>8 options** | right pane, at >8 |
| Footer | direction segment (sort only) | `N selected` + Reset / Apply | same |
| Use when | one value, short list | many values, one field | values **grouped under a parent** (survey question, table column, category) |

Shared panel shell: border **2px ink** · radius **13** · `paper` · `shadow 4px4px0 ink/.22` · inner rules `line` 1.5px · section labels mono 9.5/700/.1em uppercase `mute-soft`.
Option row: radius 8 · `padding 8px 10px` · selected fill **`#fffdf6`** + label weight 700 · count right-aligned mono 11 `mute-soft` · long labels `truncate` (never wrap).
Two-pane: left column 190–250 fixed, `surface-canvas`, `border-right 2px ink`; active field = `paper` + 1.5px ink border + applied-count badge.

**Active-filter chip row** (below the bar, only when 2+ filterable fields): `Active` mono label + chips (border 1.5 ink · rounded-pill · `padding 4px 6px 4px 11px` · field name `mute-soft` + value ink 700 + 17px `✕` on `surface-disabled` circle) + `Clear all` underlined.

## §3 Global deltas — decisions the recruiting-only version didn't need
| # | Decision |
|---|---|
| **G1** | **Portal, not a child.** Render panels in a portal at **z-index 60** (modals 80). Widget cards and fullview panes both use `overflow:hidden` — an in-flow panel is clipped. Anchor below-left; flip up when viewport bottom is within 12px; clamp `max-height` to available space with internal scroll. |
| **G2** | **Neutral tone, never the widget pastel.** Trigger + panel stay ink/paper in all six widgets; only the count badge is amore. Pastel would make one control read as six components on a single canvas. |
| **G3** | **Apply model by selection type.** Single = instant + close. Multi / two-pane = explicit Apply (otherwise every checkbox refetches a 447-row table). `Reset` clears that picker only; `Clear all` lives on the chip row. |
| **G4** | **Chips only when many.** Chip row appears at 2+ filterable fields. A lone picker shows its value in the trigger label (`Status: Confirmed`) — a one-filter chip row is noise. |
| **G5** | **Counts are optional.** Per-option counts assume a client-side dataset. On server-paged lists omit them rather than firing a count query per option; layout must not shift when absent. |
| **G6** | **Keyboard + a11y (mandatory now).** trigger = `button[aria-expanded][aria-haspopup]`; panel = `listbox`; P1 options `role=option[aria-selected]`; P2/P3 `aria-multiselectable` + checkbox roles. `↑↓` move · `Space` toggle · `Enter` apply · `Esc` close + restore focus · `← →` cross panes in P3. Visible focus ring required. |
| **G7** | **Narrow → drill-down.** Under ~520px, P3 collapses to one column: field list → tap → values with a `‹ Field` back row. Same tokens. Applies to public pages and side panels. |
| **G8** | **Form fields are not pickers.** Setup-form selects keep radius 22 / full width. This system covers toolbar & table controls. **Both open the same P1/P2 panel body** — only the trigger differs, so the panel is a shared component. |

## §4 Edge states (a global component can't skip these)
| State | Treatment |
|---|---|
| **Loading** | 4 skeleton rows: 17px `surface-disabled` box + 11px bar at 72/58/80/46% |
| **Empty** | dashed `line-empty` 38px tile + 🔍 + "No matching options" + hint |
| **Error** | `warning-bg` note w/ `warning-line-amber` border + `↻ Retry` button |
| **Long labels** | single-line ellipsis; count column never shrinks (`flex-shrink:0`) |
| Not drawn (request if needed) | async search (debounce spinner in field) · "N more" overflow · nested 3-level grouping |

## §5 Token map
**Mapped (15) — values match existing tokens exactly:** `ink` `#1d1b20` · `paper` `#fff` · `paper-soft` `#f7f7f5` · `surface-canvas` `#fbfbf9` · `mute` `#5b5965` · `mute-soft` `#8a8693` · `text-faint` `#a3a7ad` · `line-empty` `#c9ccd2` · `surface-disabled` `#eceef1` · `amore` `#ff5c8a` · `amore-deep` `#c2334f` · `warning-bg/-line-amber/-text` · `line`/`line-soft` · `shadow-memphis-sm` · `shadow-memphis-sm-faint`.

**⚠️ Gaps (6) — resolve before global rollout; each is a drift source:**
| Value | proposed token | Why |
|---|---|---|
| `#fffdf6` | `picker-option-selected` | selected option row tint (sun @ ~4%) — currently a one-off |
| `0 0 0 2px paper, 0 0 0 4px amore` | **`focus-ring`** | **no focus token exists product-wide**; G6 makes it mandatory |
| `4px 4px 0 rgba(29,27,32,.22)` | `shadow-picker-panel` | floating panel lift; between memphis-md and -lg, tinted |
| radius `5 · 8 · 10 · 13` | `radius-check / -option / -trigger / -panel` | DS scale is 2/4/14/24/999 — all four off-scale |
| border `1.4 / 1.5 / 1.8 / 2px` | `border-hair / -thin / -check / -strong` | four widths in one component; should collapse to 1.5 (chrome) + 2 (emphasis) |
| `34px / 28px` trigger height | **`control-h-md` / `control-h-sm`** | **no height token** — heights are emergent from padding, so they drift per surface |

**Recommended order:** promote `focus-ring` + `control-h-md/-sm` first — product-wide gaps this component merely surfaced. Then `picker-option-selected` + `shadow-picker-panel`. Border widths / off-scale radii may stay raw `border-[Npx]` **if** the DS declines a denser scale — but pick one policy and apply it everywhere.

## §6 ⚠️ contract-change
1. **`⚠️ contract-change:` shared component replaces per-surface pickers.** Existing hand-rolled selects in recruiting / transcript / desk toolbars must be migrated, not left in place — parallel implementations were the original drift cause.
2. **`⚠️ contract-change:` filter ≠ crosstab.** Filters narrow the table only; distribution crosstabs stay at 100% of responses (existing recruiting contract) — must hold for any surface that pairs a filter with an aggregate.
3. **Option counts** need a source decision per surface (client dataset vs server aggregate) — see G5.
4. **Focus token** (`focus-ring`) is a product-wide addition — writer decides the value before this ships.
