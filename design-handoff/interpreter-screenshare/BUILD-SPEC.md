# INTERPRETER-SCREENSHARE — Handoff (localized delta)

> **Scope:** ONE new fullview layout — **Live Interpreter · Shared screen + 2-column captions** (frame `10` in `Widget Fullview Comps.dc.html`). **Date:** 2026-07-26. **CD = visual SSOT.**
> **Delta bundle.** Assumes repo has: `FULLVIEW-SHELL.md` (§F shell class-map + tokens), `tokens.json`, `CONTEXT-PACK.md`, `CD-DELIVERABLE-RULES.md`. Everything not listed here is unchanged from FULLVIEW-SHELL §F and the existing interpreter fullview (state 03).

## What this is
A **variant of the Interpreter fullview** for sessions where a screen/tab is being shared (online interview or observed session): the shared screen sits on top of the content column, and the INPUT/OUTPUT caption panels move underneath it as a **2-column row**. Right rail (output-audio toggle · observer link · listeners) is unchanged from state 03.

```
┌ sidebar 240 ┬──────────── content column (flex:1) ─────────────┬ rail 300 ┐
│             │  ┌── shared screen monitor (flex:1.15) ───────┐  │  audio   │
│  widget     │  └────────────────────────────────────────────┘  │  link    │
│  switch     │  ┌ INPUT (flex:1) ┐ ┌ OUTPUT (flex:1) ┐          │ listeners│
└─────────────┴──└────────────────┘─└─────────────────┘──────────┴──────────┘
```

## §1 Class map (diff target — inline hex in the .dc.html is render-only)
Shell (frame · sidebar · header · mint band · End-session · ✕) = **`FULLVIEW-SHELL.md §F1–F3`, unchanged.** Header adds one static chip: `Korean → English` (`paper border-ink rounded-pill font-mono`) next to the LIVE timer.

| Element | Spec | Token / class |
|---|---|---|
| Content column | `flex:1; display:flex; flex-direction:column; gap:14; padding:18px 20px` (rail 300 fixed, gap 16) | layout only |
| **Shared-screen monitor** | `flex:1.15` · border 3px ink · radius 16 · shadow 3px3px0 ink · bg ink · overflow hidden | `border-[3px] border-ink rounded-[16px] shadow-memphis-md bg-ink` |
| — titlebar | bg `#2a262f` · border-b 1.5px `#000` · pad 9/13 · 3 traffic lights · URL pill (`bg-ink`, radius 6, mono 11, `text-faint`) | `bg-ink-2` + literal macOS lights (decorative, not tokens) |
| — SHARING badge | mono 10/700 · mint `#cdebd9` | `text-widget-header-mint` (on dark) |
| — stage | bg `paper-soft` · centered participant tiles, max-width 560, gap 12 | `paper-soft` |
| — tile | `aspect-ratio:16/10` · radius 12 · paper · border 2px `line` (idle) / **2px `success`** (active speaker) · soft drop `0 6px 20px ink/8` | `rounded-sm paper border-2 border-line` / `border-success` + `proposed:shadow-tile-lift` |
| — avatar | 44px circle · border 2px ink · bg sky (moderator) / rose (participant) | `bg-widget-header-sky` / `proposed:amore-bg-soft` |
| — stage caption | mono 10.5 · mute-soft, bottom-left 12/16 | `font-mono text-faint` |
| **Caption row** | `flex:1; display:flex; gap:14` — two equal panels | layout only |
| — INPUT panel | border 3px ink · radius 16 · paper · **shadow 3px3px0 ink** · header bg `paper-soft`, dot mute-soft | `border-[3px] border-ink rounded-[16px] paper shadow-memphis-md` |
| — OUTPUT panel | same but **shadow 3px3px0 `success`** · header bg `#eafaf0`, dot/label success | + `proposed:signal-success-bg-soft`, `proposed:shadow-memphis-md-success` |
| — panel header | pad 10/16 · border-b 2px ink · mono 9.5/700/.14em label + Outfit 15/700 language | `font-mono` + `font-display` |
| — caption body | bottom-anchored (`justify-content:flex-end`), gap 14, pad 18/20, scrolls | `.sc` scrollbar |
| — settled line | Outfit 16 / `text-faint` | `font-display text-faint` |
| — live line | Outfit 19 · ink (INPUT) / ink + weight 600 (OUTPUT) · trailing `…` in `text-faint` | `font-display text-ink` |
| Right rail | **unchanged from state 03** — output-audio toggle (track `success`, knob paper, border 2px ink), observer-link field + Copy, listeners list | see FULLVIEW-SHELL §F4 (Interpreter) |

## §2 proposed-tokens
Reuse FULLVIEW-SHELL §F6 — do NOT mint duplicates. New here:
- `proposed:shadow-memphis-md-success` = `3px 3px 0 #16a34a` (OUTPUT panel; derive from `--color-success`).
- `proposed:shadow-tile-lift` = `0 6px 20px rgba(29,27,32,0.08)` (participant tile; the one soft shadow in an otherwise hard-shadow system — intentional, reads as "inside the shared screen", not a Memphis card).
Everything else (ink/ink-2/paper/paper-soft/faint/success/mint/sky, memphis-md, radius 16) = existing.

## §3 State coverage
| State | Status |
|---|---|
| Sharing · live captions (active speaker = participant) | **drawn** (frame 10) |
| No-share fallback | use existing **state 03** (twin panels full-height, no monitor) — the two layouts are alternates of the same fullview |
| Not-yet-drawn (request if needed) | share paused/stopped · presenter-only (no tiles, app window) · captions empty (session starting) · listener count 0 · output-audio off |

## §4 Interaction disclaimer
Static comp — discloses layout/state only. Worker owns: share-stream mount + aspect fitting, active-speaker detection, caption streaming/anchoring, audio toggle, copy-link, listener presence.

## §5 ⚠️ contract-change
1. **`⚠️ contract-change:` layout switch trigger.** Which signal picks layout 10 vs state 03 — is a screen/tab share present on the session? Needs a boolean on session state (e.g. `session.isSharing`) exposed to the fullview. Confirm source (capture API vs session record).
2. **Active-speaker ring** (`border-success` on the speaking tile) assumes per-participant audio-level data. Confirm availability; if absent, drop the ring and keep tiles neutral.
3. Header `Korean → English` chip = existing session language pair (no new data).

## §6 Open items
- Tile count/layout beyond 2 participants (grid wrap vs scroll strip).
- Whether the monitor should be resizable / collapsible against the caption row (currently fixed `1.15 : 1`).
