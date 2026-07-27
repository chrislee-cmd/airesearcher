# WIDGET TOOLBAR — Header action toolbar spec (v2)

> **Scope:** the action toolbar in the **top-right of every collapsed widget card header** (`Widgets Canvas 1c.dc.html`), plus the **video guide modal** it opens. Supersedes the previous 4-item toolbar (credit | status | palette | expand). **Date:** 2026-07-27. **CD = visual SSOT.**
> Inline hex is render-only — bind to the tokens named per row. Reuse `WIDGET-SHELL.md` §S (card shell) + `FULLVIEW-SHELL.md §F5–F6` (token vocab); do not mint duplicates.

## What changed from v1
| Change | Rationale |
|---|---|
| **Status pill removed** (`● READY` / `● LIVE`) | Redundant — session state is already carried by the CTA label ("Start session →" / "End session"), the footer note, the stage-flow, and the fullview header. |
| **Guide button added** (`?` circle) | New: opens a per-widget how-to **video** in a modal. |
| **All 4 cells width-locked to 44px** | Cells were optically uneven (text cell vs icon cells). Fixed width + centered content keeps the toolbar stable as credit value changes (25/50/75). |
| Tooltips on every cell | `title` on guide + palette + expand (credit is self-evident). |

## §1 Toolbar container
| Prop | Value | Token / class |
|---|---|---|
| Layout | `display:inline-flex; align-items:stretch; overflow:hidden; flex-shrink:0` | — |
| Border · radius | **1.5px ink** · **10** | `border-[1.5px] border-ink rounded-[10px]` |
| Background | `paper` | `paper` |
| Shadow | **`2px 2px 0 ink`** | `shadow-memphis-sm` |
| Placement | right end of the card header band (`justify-content:space-between` against the widget title) | — |
| Divider (×3) | `width:1.5px; background:ink` — full-bleed vertical rules **between** cells only | `bg-ink` |

## §2 Cells — order & shared geometry
**Order (left → right): `credit` · `guide` · `palette` · `expand`.**
Shared: `display:inline-flex; align-items:center; justify-content:center;` **`width:44px; padding:6px 0`**. Icon cells: `cursor:pointer`, hover `background: paper-soft`.

| # | Cell | Content | Notes |
|---|---|---|---|
| 1 | **Credit** | 💎 gem + value, **mono 11px / 700** ink, `gap:5px` | Not interactive. Value varies per widget (25 / 50 / 75) — cell width does **not** change. |
| 2 | **Guide** | `?` in circle · 15×15 SVG · stroke **2.2** ink · `title="How to use · video guide"` | Opens §4 modal. Path: `circle r=9` + question stroke + `1.15r` dot. |
| 3 | **Palette** | palette glyph · 15×15 · stroke 2.2 · `title="Change color"` | The palette bowl is filled with **the widget's own pastel** (`{{ row.pastel }}`) — live preview of current tone. |
| 4 | **Expand** | diagonal arrows · 15×15 · stroke **2.6** · `title="Open full view"` | Opens the fullview. Heavier stroke is intentional (matches existing icon). |

> **Icon rule:** all toolbar glyphs are inline SVG, `viewBox 0 0 24 24`, `stroke: ink`, `stroke-linecap/linejoin: round`, **no fill** except the palette dots / question dot / palette bowl tint. Never emoji (credit gem is the one exception, existing).

## §3 Why `?` and not `▶`
Recorded so it isn't re-litigated: every other cell is **widget state/control**, so a play glyph reads as "run the widget" and collides with the body CTA (`Start session →`). `?` is the conventional help affordance, needs no learning, and survives the guide later becoming docs or a product tour. The "it's a video" signal is carried by the tooltip and the modal itself. A hybrid (`?` + ▶ badge) was prototyped and rejected as visually noisy at 15px.

## §4 Video guide modal
**Overlay** — `position:fixed; inset:0; z-index:80; background: rgba(29,27,32,0.55); display:flex; align-items:center; justify-content:center; padding:40px`. Click on scrim closes; card click `stopPropagation`.

**Card** — `width:100%; max-width:860px;` **`max-height:100%; min-height:0; overflow:hidden`** · `flex-direction:column` · border **3px ink** · radius **18** · shadow **`8px8px0 ink/40`**.
> ⚠️ `max-height` + `min-height:0` are **required**, not cosmetic: without them a short viewport (~540–650px) pushes the header — and the ✕ — off-screen with nothing scrollable, leaving scrim-click as the only escape.

| Region | Spec | Token |
|---|---|---|
| **Header** | `padding:13px 20px`, `border-bottom:2px ink`, `flex-shrink:0`, **bg = the widget's pastel** | `border-b-2 border-ink` + `bg-widget-header-<tone>` |
| — icon | same `?` glyph @19px | — |
| — title | `How to use · {widget name}` · Outfit **800 / 19px** · ls -0.4 | `font-display font-extrabold` |
| — duration pill | paper · border 1.5 ink · rounded-pill · mono 10.5/700 · `padding 4px 11px` | `paper border-ink rounded-pill font-mono` |
| — close ✕ | 30px · border 1.5 ink · radius 9 · `shadow 2px2px0 ink` | `border-ink rounded-[9px] shadow-memphis-sm` |
| **Player** | `background: ink` · `aspect-ratio:16/9` · **`flex:1; min-height:0; overflow:hidden`** (shrinks first on short viewports) | `bg-ink` |
| — play button | 74px circle · `rgba(255,255,255,.94)` · border 3px ink · `shadow 4px4px0 rgba(0,0,0,.35)` · 30px ▶ triangle | — |
| — scrub bar | bottom gradient `transparent → rgba(0,0,0,.55)`, `padding 12px 16px`; mono 11px times; 4px track `white/30` with **`amore`** progress fill | `bg-amore` |
| **Footer** | `padding:13px 20px` · `paper-soft` · `border-top:2px ink` · `flex-shrink:0` | `paper-soft border-t-2 border-ink` |
| — blurb | 12.5px `mute`, `line-height 1.5` — one line, **per widget** | `text-mute` |
| — docs button | paper · border 1.5 ink · rounded-pill · `shadow 2px2px0 ink` · 12px/700 · `📄 Read the docs` | `paper border-ink rounded-pill shadow-memphis-sm` |

**Per-widget content** (title, header tone, blurb, video source all key off the widget):
| Widget | Tone | Blurb |
|---|---|---|
| Probing Assistant | sky | See how to inject follow-up questions and read the live persona as the interview runs. |
| Live Interpreter | mint | Set the language pair, start interpreting, and share the observer link with your team. |
| Transcript Generator | lav | Upload recordings or record live, then get a speaker-separated transcript. |
| AI UT | peach | Create a session, share the link, and watch the participant test in real time. |
| Recruiting | sun | Turn a brief into screening criteria, publish a form, and schedule the people who fit. |
| Desk Research | cyan | Add keywords, pick sources, and get a cited research report. |

## §5 States
| State | Treatment |
|---|---|
| Toolbar default | as §2 |
| Cell hover (guide/palette/expand) | `background: paper-soft`; no border/shadow change |
| Modal closed | not rendered |
| Modal open | as §4; player shows poster + play button (not-yet-playing) |
| Short viewport (<~650px) | card clamps to `100%`; player shrinks; header ✕ and footer stay reachable |
| Not drawn (request if needed) | playing / paused / buffering states · no-guide-available (widget without a video) · captions or transcript toggle |

## §6 ⚠️ contract-change
1. **`⚠️ contract-change:` guide video source.** Needs a per-widget asset reference (URL/id) + duration. Where does it live — static config keyed by widget, or CMS/DB? Also: locale variants (KO/EN) if guides are narrated.
2. **`⚠️ contract-change:` status pill removal.** If any consumer read session state from this pill, it's gone — state must come from the CTA/stage-flow/fullview instead. Confirm nothing else depended on it.
3. `📄 Read the docs` needs a per-widget docs URL (or drop the button if docs don't exist yet).
4. Player is a static comp — embed method (native `<video>` vs YouTube/Vimeo iframe) is worker-owned and may change the scrub-bar/controls treatment; keep the frame chrome regardless.
