# ModeCard — fixed-height + text-clamp fix (localized delta)

> **Scope:** ONLY the mode-selection card (`ModeCard`) used in the widget setup accordions. Touches the card's internal layout + text rules — nothing else. **Date:** 2026-07-23. **CD SSOT:** `Widgets Canvas 1c.dc.html`.
> **Where it renders:** Interview setup (In-person / Online / Observation), Transcription method (Qualitative / Meeting minutes), UT test method (Test on my device / participant device). Any 2- or 3-up `ModeCard` grid.

## Problem being fixed
Card height flexed with subtitle line count → in a row, a 1-line card and a 2-line card had different heights (misaligned grid). First fix over-corrected: reserved 2-line slots created large internal gaps on 1-line cards.

## The rule (final)
- **Card height = fixed 128px** (`box-sizing:border-box`), `display:flex; flex-direction:column`. Height never depends on text.
- **Title = max 2 lines.** `-webkit-line-clamp:2`, overflow hidden. Overflow shows full text via native `title` tooltip. `font 12.5/700`, `line-height 1.25`, `margin-top 7` (after icon).
- **Subtitle = max 2 lines total**, `margin-top 3` (tight to title):
  - **1 subtitle string** → that string clamps to 2 lines (`line-clamp:2`).
  - **2 subtitle strings** → each renders on its own line, clamped to 1 line each (`line-clamp:1`), 1px between. 3rd+ strings dropped (`.slice(0,2)`).
  - `font 9.5/400`, color `#5b5965`, `line-height 1.4`.
- **Content is top-aligned**; leftover space collects once at the card bottom as even padding (do NOT `justify-content:space-between` — that reintroduces the interior gap).
- Icon block unchanged (24px glyph in 38px chip, `margin-bottom 2`, `flex-shrink:0`).
- Selected/idle border + check-badge unchanged (2px `AMORE` vs 1.4px `ink/14`; ✓ badge top-right).

## Reference implementation (React.createElement, from the .dc.html)
```js
const Card = (icon, title, lines, selected) => h('div', { style: { boxSizing: 'border-box', height: 128, display: 'flex', flexDirection: 'column', border: selected ? '2px solid ' + AMORE : '1.4px solid rgba(29,27,32,.14)', borderRadius: 13, padding: '13px 11px', position: 'relative', boxShadow: selected ? '0 4px 12px rgba(255,92,138,.16)' : 'none' } },
  selected ? h('div', { style: { position: 'absolute', top: 9, right: 9, width: 18, height: 18, borderRadius: '50%', background: AMORE, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 } }, '✓') : null,
  h('div', { style: { marginBottom: 2, flexShrink: 0 } }, Icon(icon, 24, { chip: chipFor(icon), chipSize: 38 })),
  h('div', { title: title, style: { fontSize: 12.5, fontWeight: 700, color: INK, marginTop: 7, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } }, title),
  h('div', { style: { marginTop: 3 } },
    ...lines.slice(0, 2).map((l, i) => h('div', { key: i, style: { fontSize: 9.5, color: '#5b5965', marginTop: i === 0 ? 0 : 1, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: lines.length > 1 ? 1 : 2, WebkitBoxOrient: 'vertical' } }, l))));
```

## Token / class mapping (for the TSX port — no raw hex/px)
| Prop | Value | Token / class |
|---|---|---|
| Card height | 128px | `proposed:mode-card-h` (128) — fixed |
| Card radius | 13 | `rounded-[13px]` (off DS scale; keep raw or `proposed:radius-mode-card`) |
| Card pad | 13/11 | `py-[13px] px-[11px]` |
| Border idle / selected | 1.4px `ink/14` · 2px `amore` | `border-line` · `border-2 border-amore` |
| Selected shadow | `0 4px 12px rgba(255,92,138,.16)` | `proposed:shadow-mode-card-selected` (amore glow) |
| Check badge | 18px circle · amore · #fff ✓ | `bg-amore text-white rounded-full` |
| Icon chip | 24 glyph / 38 chip | existing `Icon`/`chipFor` — unchanged |
| Title | 12.5/700 ink · lh 1.25 · **clamp 2** | `text-[12.5px] font-bold text-ink line-clamp-2` |
| Subtitle | 9.5/400 `#5b5965` · lh 1.4 · **clamp 1 (multi) / 2 (single)** | `text-[9.5px] text-mute line-clamp-1`/`-2` |

## Content authoring rule (for whoever writes card copy)
- **Title:** ≤ 2 lines (≈ 24 en-chars). Keep to 1 line where possible.
- **Subtitle:** either ONE short sentence (wraps to ≤2 lines) OR up to TWO one-line fragments. Never 3+.
- Longer text is truncated with ellipsis, not allowed to grow the card.

## Conformance
Diff the ported `ModeCard` against the rule above: fixed 128 height, clamp values, top-aligned content, tight title→subtitle gap. No other card/component changes in this delta.
