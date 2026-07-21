# HANDOFF — Probing Assistant (worker entry point)

> Read this first, then `BUILD-SPEC.md`. **Date:** 2026-07-21 · **SSOT:** `Widgets Canvas 1c.dc.html` (setup) + `Widget Fullviews.dc.html` (live).

## Read order
1. **This file** — scope, read order, done-when.
2. **BUILD-SPEC.md** — the contract. §1 class map = your diff-target. §3 = every state you must build. §5 = blockers to resolve first.
3. **.dc.html** (both) — open in a browser for the live visual. Inline hex/px = rendering only; port to the §1 classes, not the inline styles.

## What to port
- **Setup card** → `desk-card-body`-style `ControlBoardPanel` body: 4-step accordion (project · interview method 3-cards · analysis language · inject questions). All-open default; empty-area click collapses to summary rows.
- **Started** → in-place Handoff ("Please check the full view"). Live probing itself renders in the fullview.
- **Live fullview** → 5:3 split: persona grid (8 panels, confidence dots) + thinking stream + question history + **spotlight overlay** (full-screen high-importance question, 15s ring).

## Port order (suggested)
1. Card frame + header/toolbar/footer (shared shell — see §1; identical across widgets).
2. Setup steps 1–4, static, all states from §3 (incl. error/empty/disabled).
3. Wire step state machine (open/collapsed/ready) — logic yours.
4. Fullview persona grid + history (read-only from data).
5. Spotlight overlay (after §5 timing/threshold resolved).

## Resolve BEFORE logic (from §5)
- ⚠️ bulk-apply project across widgets (cross-widget store?)
- ⚠️ "analysis language" as a field distinct from interview language
- ⚠️ spotlight importance threshold + 15s auto-save timing

## Done when
- [ ] All §3 states render (open · collapsed · ready · started · error · empty · disabled).
- [ ] Every visual matches a §1 class / measured value (no raw hex/px in TSX).
- [ ] All `proposed-token:` (§2) either mapped to an existing token or raised as a token-PR.
- [ ] Every `⚠️ contract-change:` (§5) resolved with the writer.
- [ ] New strings have ko/en/ja/th parity.
