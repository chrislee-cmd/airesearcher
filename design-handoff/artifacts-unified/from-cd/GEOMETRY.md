# GEOMETRY — artifacts-unified surfaces

> Measured from the CD comps, 2026-07-28. Sizes marked **container-owned** are proto values: the app supplies width/height and the layout adapts. Sizes marked **FIXED** must not flex — the composition depends on them.

## Shared principle
Every surface here is *frame + fixed rail(s) + flexible content*. Intrinsic styling (border width, radius, shadow, tone) is **absolute** and never scales with the frame.

---

## A · Deliverables library
| Part | Value | Nature |
|---|---|---|
| Frame | **1560 × 880** | container-owned (full-width in-app surface) |
| Frame border / radius / shadow | 3px ink · 16 · `shadow-frame` | absolute |
| Header height | 65px (pad 16/24 + 24px title line) | derived |
| Filter rail | **240px** | **FIXED** |
| Rail padding · group gap | 16/14 · 18 | absolute |
| List column | remainder, `min-width:0` | flexible |
| List header row | 38px (pad 10/20) | derived |
| **Row height** | **59px** (pad 12/20 + 34px tile) | absolute — the skeleton must match |
| Feature tile | 34 × 34 · radius 9 | absolute |
| Status column | **120px** | **FIXED** |
| Updated column | **104px** | **FIXED** |
| Action column | **214px** | **FIXED** |
| Footer strip | 31px (pad 9/20) | derived |
| Grid card | 4 columns · gap 16 · card min-height 210 | flexible count, absolute gap |
| Grid card tone strip | 33px (pad 9/13) | absolute |
| ⋯ menu | **248px** wide · radius 12 · z-**60** · offset 6px below the trigger, right-aligned | absolute |
| Bulk bar | 41px (pad 11/15) · radius 12 | absolute |

**Column sum check:** 44 (check) + flexible title + 120 + 104 + 214 = 482px of fixed right-hand structure. Below ~900px of list width the meta line wraps first, then the kind chip drops. Do not shrink the action column — the three controls are already at their minimum.

---

## B · Share view shell
| Part | Value | Nature |
|---|---|---|
| Frame — valid / gated | **760 × 780** | container-owned (public page, centred, single column) |
| Frame — dead-end | **568 × 560** | container-owned |
| Frame border / radius / shadow | 3px ink · 16 · `shadow-frame` (24% on dead-end) | absolute |
| Masthead | border-b **3px** · pad 15/22 · two rows, 12px apart | absolute |
| Brand mark | 24 × 24 · radius 7 | absolute |
| Notice strip | 31px (pad 8/22) | derived |
| Body slot | `flex:1; min-height:0` · pad 18–20 / 22 | flexible |
| Footer | 41px (pad 11/22) · border-t 2px | absolute |
| Gate form | max-width **330px**, centred · field radius 22 · submit full-width | absolute |
| Icon tile — dead-end | 70 × 70 · radius 19 | absolute |
| Icon tile — gate | 62 × 62 · radius 17 | absolute |

**Slot contract:** the shell guarantees the slot a scrolling box with 22px side padding and nothing else — no max-width, no typographic reset. A body that needs a reading measure sets its own.

---

## C · Exported documents
| Part | Value | Nature |
|---|---|---|
| Page | **816 × 1056** (Letter @96dpi) | absolute — holds on A4 (`794 × 1123`) unchanged |
| Margins | **84** sides · **72** top/bottom | absolute |
| Text block | 648px wide | derived |
| Tone bar (masthead) | 132 × 6 · radius 3 | absolute |
| Masthead block | tone bar → 15px → eyebrow row → 22px → title → 8–10px → subtitle | absolute |
| Running header (p2+) | top **56px** · tone chip 20 × 4 · 1px rule | absolute |
| Content start (p2+) | top **104px** | absolute |
| Footer | bottom **72px** · 1px rule + 10px + single line | absolute |
| Metadata strip | 1px hairline grid, 3–4 equal cells, cell pad 11/13 | absolute |
| Section head | tone dot 11px + Outfit 800/19 + 7px + **1.6px ink rule** | absolute |
| Body | 16px / **1.65** | absolute (12pt floor) |
| Transcript time column | **78px** | **FIXED** |
| Transcript turn gap | 16px | absolute |
| Table row | pad 10/4 · 1px `line-strong` divider · head 1.6px ink | absolute |

**A4 behaviour:** the layout is margin-driven and top-anchored, so on A4 the text block narrows by 22px and the page runs 67px longer. Nothing is pinned to page height except the footer, which is bottom-anchored. **Do not** rescale the type for A4.

**Pagination rules the generator must honour:**
- A transcript turn never splits across a page — keep-together on the whole turn block.
- A section head never lands as the last element on a page — keep-with-next.
- A table never leaves a single orphan row; the head repeats on continuation.
- The masthead appears on page 1 only; the running header on page 2 onwards.
