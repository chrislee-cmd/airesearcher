# Live Interpreter — BUILD-SPEC (CD → Worker handoff)

> **§0 Role boundary.** CD owns presentation; worker owns logic/data/wiring. Spec + `.dc.html` = mechanical TSX port.
> **SSOT:** `Widgets Canvas 1c.dc.html` (setup/states) + `Widget Fullviews.dc.html` (live control view). **Date:** 2026-07-21.
> **Shared contracts:** `CONTEXT-PACK.md` · `tokens.json` (no duplication of color/radius/shadow/type here).
> **Identity:** pastel header `mint` (#cdebd9) · accent `amore` · credit 💎 50.

---

## §1 Class mapping (Conformance-first)
> **Shell + assembly = `../WIDGET-SHELL.md` (SSOT, §S1 class map + §S2 assembly + §S3 identity). Build the shell from there regardless of port order.** Rows below are feature-specific only.

| Element | Measured (proto) | Utility class / token |
|---|---|---|
| Header band | bg pastel-mint · border-b 2px ink | `bg-widget-header-mint`* · `border-b-2 border-ink` |
| Language field (in/out) | border 1.5 ink · radius 24 · side-by-side w/ `→` | `rounded-md border-ink` |
| Keyword chip | bg #f7f7f5 · border 1.4 ink/12% · radius 999 | `bg-surface-elevated rounded-pill border-line` |
| Live caption panel | border 3px ink · radius 16 · shadow 3px3px0 | `rounded-*(16) shadow-memphis-sm` |
| Caption header INPUT | bg #f7f7f5 · mute dot · mono eyebrow | `bg-surface-elevated` |
| Caption header OUTPUT | bg #eafaf0 · success dot | **proposed:surface-output-tint** |
| Output-audio toggle (on) | track #16a34a · ink border · knob #fff | `bg-success border-ink` |
| Observer-link box | mono link · border 1.5 ink · radius 12 + Copy(ink) | `rounded-chrome border-ink` |
| End button | border 2px amore · amore text · shadow 2px2px0 amore | `border-amore text-amore shadow-[…amore]` → **proposed:btn-danger-memphis** |

## §2 proposed-token
- `surface-widget-header-mint` (mint band). Fallback: `surface-banner`.
- `surface-output-tint` (#eafaf0 output caption header). Fallback: `bg-success/8`.
- `btn-danger-memphis` (amore-bordered End button + hard shadow). Fallback: compose `border-amore` + `shadow-memphis-xs`(amore).
- `surface-disabled`, `shadow-card-selected` — shared w/ Probing.

## §3 State matrix
Setup card:
| State | Trigger | Render |
|---|---|---|
| **open** | default | 4 steps. footNote `Set the interpretation languages` · CTA idle `🎧 Start interpreting →` |
| **collapsed** | empty-area click | 4 summary rows |
| **ready** | project ∧ method ∧ (input ∧ output language) | CTA active. (STEP4 keywords = optional, not gating) |
| **started/live** | CTA click | in-place **live control view** (§ live) · CTA `■ End interpretation` |
| **error** *(add)* | mic/tab capture denied | `Banner` warning `captureError`; CTA idle |
| **disabled** *(add)* | credits exhausted | CTA `surface-disabled` |

Setup steps:
1. `Select the project you are working on` — shared ProjectPicker.
2. `Select the interview method` — **3 cards** (same audio routing as Probing).
3. `Set the interpretation languages` — **Input language → Output language** side-by-side dropdowns (multi-language, not KR/EN-only).
4. `Add proper nouns & keywords (optional)` — add-row + chips (e.g. brand names for transcription accuracy).

Live control fullview (`Widget Fullviews` · Interpreter) — **this is the control surface, not a read-only mirror**:
- **Dual caption panels side-by-side**: left INPUT (source lang, mute header) + right OUTPUT (target lang, mint header). Latest utterance pins to bottom; both stream simultaneously.
- Right control column: **Output-audio toggle** (spoken interpretation on/off) · **Observer link** (share + Copy, read-only listeners) · **listeners list** (dot + id + agent + ago) · **End interpretation** (danger button).
- Header: `Input → Output` pill.

## §4 Interaction disclaimer
Proto toggles/links/end button are demo-only. Real audio routing, STT stream, observer broadcast, and session teardown are worker-owned (contract). Captions in proto are canned; live text arrives via realtime.

## §5 contract-change
- ⚠️ `contract-change:` **multi-language input/output** (proto shows arbitrary lang pairs) — confirm supported language set + pair validation.
- ⚠️ `contract-change:` **observer share link** (read-only listener broadcast) — needs a listen-only session token + listener roster feed.
- ⚠️ `contract-change:` **output-audio on/off** — TTS playback toggle is a runtime capability, confirm.
- ⚠️ `contract-change:` **keyword/proper-noun injection** into STT — confirm the pipeline accepts a term list.

## §6 Open items
- Credit 50 vs 75 — **unresolved**, confirm. · Listener count/roster data shape. · i18n parity for new strings.


---

## §3b Initial state — ghost preview (defect-A fix, all data-dependent steps)
> **Decision (2026-07-21): (c) hybrid.** A step whose input isn't ready yet renders a **ghost preview**, never a one-line placeholder bar.
- **Ghost preview** = the REAL populated component (chips / rows / table) rendered **muted** (low opacity, neutral fill — the actual component, not a skeleton bar) + a thin label `Auto-generated after extraction` / `Example`.
- **post-data** = the same component with real data (canonical — worker MUST build it).
- The gated behavior (empty until data) is correct and stays; only the empty *rendering* changes from placeholder → ghost.
- `demo-only` applies to **behavior only**, never to rendered content (§4).

## §7 Strings — i18n keys only (canonical locale, EN = reference)
> **Root fix for language drift:** render every string from the feature's existing **i18n namespace key**, never hardcode. The EN copy in this spec is **reference only** — do NOT ship it verbatim. App locale (currently `/en` default w/ Korean banner) then resolves automatically. Requirement: **0 hardcoded strings**, ko/en/ja/th parity.
