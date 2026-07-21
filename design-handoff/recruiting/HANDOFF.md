# HANDOFF — Recruiting (worker entry point)

> Read this first, then `BUILD-SPEC.md`. **Date:** 2026-07-21 · **SSOT:** `Widgets Canvas 1c.dc.html` (setup) + `Widget Fullviews.dc.html` (responses).

## Read order
1. **This file** — scope, read order, done-when.
2. **BUILD-SPEC.md** — §1 class map (setup + responses fullview) · §3 states · §5 blockers. Shared shell rows reuse Probing §1.
3. **.dc.html** (both) — live visual; inline styles = rendering only.

## What to port
- **Setup card** → 4-step accordion (source upload · criteria chips · screening survey w/ locked blocks · publish Google Form). All-open default; collapse to summary.
- **Published** → in-place Handoff ("Please check the full view").
- **Responses fullview** → 2-panel: left (criteria + gender×age crosstab, counts fixed at 100%) / right (form selector · Fit/Raw tabs · fit filter chips · judged table w/ fit badge + reason + ⚠ flags). PII (name/phone) excluded from view.

## Port order (suggested)
1. Card frame + shell (shared; see Probing §1).
2. Setup steps 1–4, all §3 states (incl. extracting/error/empty/disabled).
3. Step state machine + publish flow.
4. Responses fullview: criteria + crosstab (read-only), judged table.
5. Fit filters / tabs (client filter over judged data).

## Resolve BEFORE logic (from §5)
- ⚠️ AI criteria extraction from source docs (typed criteria + required flag + category)
- ⚠️ standard locked survey blocks (consent + PII) vs editable domain questions — schema
- ⚠️ fit judgement shape `{ fit, reason, flags[] }` per respondent
- ⚠️ PII exclusion enforced at query/view layer
- ⚠️ distribution fixed at 100% (filters highlight, never recompute)
- ⚠️ Google Form + linked Sheet creation (integration scope)

## Out of scope (do not build here)
- **Scheduling** (candidate → slot → admin invite request) — separate feature; actual outreach handled by the admin view.
- **Respondent drawer** (full Q→A + PII lock) — static/deferred.

## Done when
- [ ] All §3 states render (open · collapsed · ready · published · extracting · error · empty · disabled).
- [ ] Every visual matches a §1 class / measured value.
- [ ] `proposed-token:` (§2) mapped or raised (incl. `surface-locked`, `signal-warning-*`, `fg-amore-deep`).
- [ ] Every `⚠️ contract-change:` (§5) resolved with the writer.
- [ ] New strings ko/en/ja/th parity · PII never leaves the query layer.
