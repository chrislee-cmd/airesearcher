# HANDOFF — Live Interpreter (worker entry point)

> Read this first, then `BUILD-SPEC.md`. **Date:** 2026-07-21 · **SSOT:** `Widgets Canvas 1c.dc.html` (setup) + `Widget Fullviews.dc.html` (live control).

## Read order
1. **This file** — scope, read order, done-when.
2. **BUILD-SPEC.md** — §1 class map (diff-target) · §3 states · §5 blockers. Card shell rows reuse Probing §1.
3. **.dc.html** (both) — live visual; inline styles = rendering only, port to §1 classes.

## What to port
- **Setup card** → 4-step accordion (project · interview method 3-cards · **input→output languages** · optional keywords). All-open default; collapse to summary.
- **Started** → in-place **live control view** (this replaces the old read-only mirror).
- **Live control fullview** → dual caption panels side-by-side (INPUT source / OUTPUT target, both streaming) + control column: output-audio toggle · observer share link · listeners list · End interpretation (danger button).

## Port order (suggested)
1. Card frame + shell (shared; see Probing §1).
2. Setup steps 1–4, all §3 states.
3. Step state machine (open/collapsed/ready; keywords non-gating).
4. Fullview dual captions (bind to STT/interpretation streams — worker).
5. Controls: audio toggle, observer link, end — after §5 resolved.

## Resolve BEFORE logic (from §5)
- ⚠️ multi-language input/output pairs (supported set + validation)
- ⚠️ observer share link (listen-only token + roster feed)
- ⚠️ output-audio on/off (TTS playback capability)
- ⚠️ keyword/proper-noun injection into STT

## Done when
- [ ] All §3 states render (open · collapsed · ready · started/live · error · disabled).
- [ ] Every visual matches a §1 class / measured value.
- [ ] `proposed-token:` (§2) mapped or raised (incl. `btn-danger-memphis`, `surface-output-tint`).
- [ ] Every `⚠️ contract-change:` (§5) resolved — **credit 50 vs 75 still open**.
- [ ] New strings ko/en/ja/th parity.
