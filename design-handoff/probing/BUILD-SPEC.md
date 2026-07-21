# Probing Assistant — BUILD-SPEC (CD → Worker handoff)

> **§0 Role boundary.** CD owns presentation (visual/layout/copy). Worker owns logic/data/wiring. This spec + the paired `.dc.html` should let the worker port to TSX mechanically — no visual decisions left open.
> **SSOT:** `Widgets Canvas 1c.dc.html` (setup/states) + `Widget Fullviews.dc.html` (live view). **Date:** 2026-07-21.
> **Shared contracts (do not duplicate):** `CONTEXT-PACK.md` (token vocab SSOT) · `tokens.json` (machine values). Colors/radii/shadows/type reference those files' `bg-*` / `shadow-memphis-*` / `text-ink` / `rounded-*`.
> **Identity:** pastel header `sky` · accent `amore` (#ff5c8a) · credit 💎 25.

---

## §1 Class mapping (Conformance-first)
> `.dc.html` renders with inline hex/px (DC runtime can't render utility classes). This table is the diff-target: every visual = an explicit utility class / measured value the worker can compare against.

| Element | Measured (proto) | Utility class / token |
|---|---|---|
| Card shell | 604×900 · border 3px ink · radius 20 · shadow 4px4px0 ink | `WidgetShell` frame · `rounded-*(20)` · `shadow-memphis-md` |
| Header band | bg pastel-sky · border-b 2px ink · pad 18/22 | `bg-widget-header-sky`* · `border-b-2 border-ink` |
| Title | Outfit 800 · 29px · ink · ls -0.9 | `font-display text-[1.8rem] font-extrabold text-ink` |
| Toolbar pill | border 1.5 ink · radius 10 · shadow 2px2px0 · segs pad 6/10 mono 11 | `rounded-chrome border-ink shadow-memphis-xs` |
| Step node (active) | 26·circle · ink bg · #fff · 12.5/800 | `bg-ink text-white rounded-full` |
| Step node (done) | 26·circle · success #16a34a · ✓ | `bg-success text-white` |
| Step node (todo) | 26·circle · ink/6% · mute text | `bg-ink/5 text-mute` |
| Rail line | 2px · ink/12% · left 12 | `bg-ink/10` |
| Method card (idle) | radius 13 · border 1.4 ink/14% · pad 13/11 | `rounded-sm border-line` |
| Method card (selected) | border 2px amore · shadow `0 4px 12px rgba(255,92,138,.16)` | `border-amore` + **proposed:shadow-card-selected** |
| Field / dropdown | border 1.5 ink · radius 22 (pill) or 24 | `rounded-pill` / `rounded-md` |
| CTA (active) | bg ink · #fff · radius 999 · pad 11/20 | `bg-ink text-white rounded-pill` |
| CTA (idle) | bg #eceef1 · #8a8693 · border ink/10% | **proposed:surface-disabled** · `text-mute-soft` |
| Footer note | mono 11 · mute | `font-mono text-xs text-mute` |
| Collapsed summary card | bg #f4fbf6 · border 1.4 #cdeed8 | **proposed:signal-success-bg/-line** |

## §2 proposed-token (new vocabulary → token-PR track)
- `surface-widget-header-sky` (sky pastel band). Fallback: current `surface-banner`.
- `shadow-card-selected` (soft amore glow on selected method card). Fallback: `shadow-memphis-sm`.
- `surface-disabled` (#eceef1 idle CTA). Fallback: `line-soft`.
- `signal-success-bg` / `signal-success-line` (collapsed summary tint).

## §3 State matrix (cover ALL — worker must not guess)
Setup card (`ControlBoardPanel` body):
| State | Trigger | Render |
|---|---|---|
| **open** | default | 4 steps expanded. footNote `0 questions injected` · CTA idle `▶ Start session →` |
| **collapsed** | empty-area click | 4 summary rows (done=success node / current=open / todo=dim). |
| **ready** | project ∧ method ∧ language ∧ ≥1 question | CTA active (ink) |
| **started** | CTA click | in-place **Handoff** → `Please check the full view` + `← Back to setup`. footNote `Session in progress` · CTA `■ End session` |
| **error** *(add)* | submit blocked (no keyword/project) | `Banner` tone=warning, copy key `error`; CTA stays idle |
| **empty** *(add)* | STEP4 no questions | dashed `No questions injected yet` (present) |
| **disabled** *(add)* | credits exhausted / no org | CTA `surface-disabled`, tooltip `Not enough credits` |

Setup steps:
1. `Select the project you are working on` — project dropdown (shared ProjectPicker; bulk-apply checkbox syncs sibling widgets).
2. `Select the interview method` — **3 cards** (audio routing): `Offline`(Host→Mic/Guest→Mic) · `Online`(Host→Mic/Guest→Tab audio) · `Online (observe)`(Host→Tab/Guest→Tab).
3. `Which language do you want for analysis?` — single `Interview language` dropdown.
4. `Inject the questions you must ask` — add-row + list; each row = ink number badge + text + ✕.

Live fullview (`Widget Fullviews` · Probing):
- 5:3 split. Left = **persona grid 8 panels** (each: icon + section eyebrow + ●●●/●●○/●○○/○○○ confidence dots + summary; fill level drives border solid vs dashed).
- Right = **AI thinking stream** (top) + spotlight hint banner + **Question history** (importance dots + technique + ago + ★ pinned).
- **Spotlight overlay** (high-importance Q): full-panel ink/30 scrim + centered card (Outfit 31px question + importance/technique badges + amore rationale + **36px 15s countdown ring** + Copy/Pin). Compact variant = bottom-right card.

## §4 Interaction disclaimer (§6)
Prototype interactions (project picker toggle, step open/collapse, spotlight) are **demo-only for visual review**. Real behavior follows the typed contract — worker wires state, not the proto's handlers. No drag/real-time here; live probing updates arrive via realtime subscription (worker).

## §5 contract-change (needs beyond current typed contract)
- ⚠️ `contract-change:` **bulk-apply project across widgets** — needs a cross-widget project store (proto syncs siblings). Confirm or drop.
- ⚠️ `contract-change:` **"analysis language" as a distinct field** from interview language — confirm data model (proto shows single interview language only).
- ⚠️ `contract-change:` **spotlight importance threshold + 15s auto-save-to-history** — timing/threshold are product decisions, not visual.

## §6 Open items
- Credit 25 confirm. · i18n ko/en/ja/th parity for all new strings. · Spotlight ring duration source of truth.
