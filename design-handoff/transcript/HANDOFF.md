# HANDOFF — Transcript Generator (worker entry point)

> Read this first, then `BUILD-SPEC.md`. **Date:** 2026-07-21 · **SSOT:** `Widgets Canvas 1c.dc.html` (setup) + `Widget Fullviews.dc.html` (result).

## Read order
1. **This file** — scope, read order, done-when.
2. **BUILD-SPEC.md** — §1 class map (diff-target) · §3 states · §5 blockers. Shell rows reuse Probing §1.
3. **.dc.html** (both) — live visual; inline hex/px = rendering only, port to §1 classes.

## What to port
- **Setup card** → 4-step accordion (project · transcription method 2-cards · analysis language · upload/record). All-open default; collapse to summary.
- **Started** → in-place **6-stage StageFlow** (Upload→Transcribe→Document→Speakers→Typos→Polish).
- **Done** → hero ("Transcript is ready!") → CTA to results.
- **Result fullview** → two-level: file list → detail (2-split transcript stream + Export/AI summary/Key themes). Back `‹` sits left of search in the detail toolbar.

## Port order (suggested)
1. Card frame + shell (shared; see Probing §1).
2. Setup steps 1–4, all §3 states (incl. error/empty/disabled).
3. State machine (open/collapsed/ready/started/done).
4. StageFlow nodes (3-state) — bind to progress feed.
5. Result: file list → detail; export.

## Resolve BEFORE logic (§5)
- ⚠️ 6-stage progress phase enum · ⚠️ file-list shape + statuses · ⚠️ speaker-turn shape · ⚠️ AI summary/themes · ⚠️ export .docx/.txt/.srt

## Done when
- [ ] All §3 states render (open · collapsed · ready · started · done · error · empty · disabled).
- [ ] Every visual matches a §1 class / measured value (no raw hex/px).
- [ ] `proposed-token:` (§2) mapped or raised (incl. `signal-progress`, `surface-progress-tint`, `shadow-success-memphis`).
- [ ] Every `⚠️ contract-change:` (§5) resolved with the writer.
- [ ] New strings ko/en/ja/th parity.
