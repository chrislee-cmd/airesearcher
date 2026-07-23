# Inject-Follow-up — restyle to current design (localized delta)

> **Scope:** ONLY the "Inject a follow-up question" block in the **Probing Assistant fullview** right rail (top of the rail, above "AI thinking stream"). Legacy style → current Memphis system. Nothing else changes. **Date:** 2026-07-23. **CD SSOT:** `Widget Fullview Comps.dc.html` (frame 01 · Probing · Live), mirrored in `Widget Fullviews.dc.html`.
> **Context:** the block was restored in the build but rendered in legacy style (thin light input + flat grey Inject button). This spec brings it to our current design.

## What changes (legacy → current)
| Part | Legacy (remove) | Current (apply) |
|---|---|---|
| Section label | small sentence-case caption | **mono uppercase mini-label**: `ui-monospace` 10px / 700 / `letter-spacing .14em` / color mute-soft `#8a8693` / `margin-bottom 9` |
| Input field | thin light border, no radius rhythm | border **1.5px ink** `#1d1b20` · **radius 22** · `padding 11px 16px` · font 13 · placeholder mute-soft `#8a8693` · `flex:1` · single-line ellipsis |
| Inject button | flat grey / disabled-looking | **amore fill** `#ff5c8a` · white text · **border 2px ink** · **radius 22** · `padding 11px 18px` · font 13 / 700 · **hard shadow `2px 2px 0 #1d1b20`** · `flex-shrink:0` |
| Row | — | `display:flex; gap:9px; align-items:stretch` |
| Helper text | grey caption | 11px mute-soft `#8a8693`, `line-height 1.5`, `margin-top 8`; copy: "Sent to the respondent right away — appears once as a spotlight and is logged to question history." |
| Container | — | wrap in rail row: `border-bottom 1px rgba(29,27,32,.1); padding 14px 16px` (matches the thinking-stream block below it) |

## Reference markup (from the .dc.html — inline hex is render-only; bind to tokens)
```html
<div style="border-bottom:1px solid rgba(29,27,32,0.1);padding:14px 16px;">
  <div style="font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#8a8693;font-weight:700;margin-bottom:9px;">Inject a follow-up question</div>
  <div style="display:flex;gap:9px;align-items:stretch;">
    <div style="flex:1;min-width:0;border:1.5px solid #1d1b20;border-radius:22px;padding:11px 16px;font-size:13px;color:#8a8693;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">e.g. Why was the channel where you found it different?</div>
    <div style="flex-shrink:0;background:#ff5c8a;color:#fff;border:2px solid #1d1b20;border-radius:22px;padding:11px 18px;font-weight:700;font-size:13px;box-shadow:2px 2px 0 #1d1b20;display:flex;align-items:center;">Inject</div>
  </div>
  <div style="font-size:11px;color:#8a8693;line-height:1.5;margin-top:8px;">Sent to the respondent right away — appears once as a spotlight and is logged to question history.</div>
</div>
```

## Token / class map (for the TSX port — no raw hex/px)
| Prop | Value | Token / class |
|---|---|---|
| Mini-label | mono 10 / 700 / .14em / mute-soft | `proposed:font-mono-label text-[10px] uppercase tracking-[0.14em] text-mute-soft` |
| Field border | 1.5px ink | `border-[1.5px] border-ink` |
| Field / button radius | 22 | `rounded-[22px]` (= `proposed:radius-field`, same as canvas AddRow) |
| Field placeholder | mute-soft `#8a8693` | `placeholder:text-mute-soft` |
| Button fill / text | amore `#ff5c8a` / white | `bg-amore text-white` |
| Button border | 2px ink | `border-2 border-ink` |
| Button shadow | `2px 2px 0 #1d1b20` | `shadow-memphis-sm` |
| Helper text | 11px mute-soft | `text-[11px] text-mute-soft` |
| Row container | border-b `ink/10` · pad 14/16 | `border-b border-line py-[14px] px-4` |

## Conformance & placement
- Renders as the **first block** in the Probing fullview right rail (flex:3 column), directly above "AI thinking stream"; both blocks share the same `border-b / padding 14×16` rhythm.
- This matches the shared inject/AddRow styling in the collapsed widget (`Widgets Canvas 1c` `AddRow`: 1.5px ink field, radius 22, amore button). The only delta from AddRow: button label "Inject" (not "＋ Add") and it carries the 2px ink border + hard shadow of a fullview CTA.
- Behavior (submit on Enter / click, disabled-until-nonempty, credit deduction) is worker-owned — not represented in this static block.
- No other component in the fullview changes.
