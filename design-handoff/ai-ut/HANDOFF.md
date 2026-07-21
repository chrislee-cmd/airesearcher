# HANDOFF — AI UT (worker entry point)

> Read this first, then `BUILD-SPEC.md`. **Date:** 2026-07-21 · **SSOT:** `Widgets Canvas 1c.dc.html` (setup) + `Widget Fullviews.dc.html` (live→review).

## Read order
1. **This file** — scope, read order, done-when.
2. **BUILD-SPEC.md** — §1 class map (diff-target) · §3 states · §5 blockers. Shell rows reuse Probing §1.
3. **.dc.html** (both) — live visual; inline hex/px = rendering only.

## What to port
- **Setup card** → 4-step accordion (project · test method 2-cards · expected language · target URL + task). All-open default; collapse to summary.
- **Share** → in-place link-share (Waiting for participant).
- **Live/review fullview** → two-state: **Live** (screen-share monitor + assigned-task panel + think-aloud stream) → **End session** → **Review** (insight report + tagged clips + behavioral metrics, low-confidence dimmed).

## Port order (suggested)
1. Card frame + shell (shared; see Probing §1).
2. Setup steps 1–4, all §3 states.
3. State machine (open/collapsed/ready/share).
4. Fullview live (bind screen mirror + think-aloud stream — worker).
5. Fullview review (insight/clips/metrics from model output).

## Resolve BEFORE logic (§5)
- ⚠️ participant-device session via link · ⚠️ live screen mirror + cursor/click · ⚠️ assigned-task + progress · ⚠️ think-aloud stream · ⚠️ metrics w/ confidence · ⚠️ insight + clips · ⚠️ `PREVIEW` billing

## Done when
- [ ] All §3 states render (open · collapsed · ready · share · error · disabled) + live + review.
- [ ] Every visual matches a §1 class / measured value.
- [ ] `proposed-token:` (§2) mapped or raised (incl. `btn-danger-memphis`, `surface-task-tint`, `signal-danger`).
- [ ] Every `⚠️ contract-change:` (§5) resolved with the writer.
- [ ] Method 2-card axis (capture device) preserved — location/observation are runtime, not setup modes.
- [ ] New strings ko/en/ja/th parity.
