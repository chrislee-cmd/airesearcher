# HANDOFF — Desk Research (worker entry point)

> Read this first, then `BUILD-SPEC.md`. **Date:** 2026-07-21 · **SSOT:** `Widgets Canvas 1c.dc.html` (setup) + `Widget Fullviews.dc.html` (report).

## Read order
1. **This file** — scope, read order, done-when.
2. **BUILD-SPEC.md** — §1 class map (diff-target) · §3 states (many banners) · §5 blockers. Shell rows reuse Probing §1.
3. **.dc.html** (both) — live visual; inline hex/px = rendering only.
4. `../DESK-RESEARCH-CONTEXT-PACK.md` — current-impl map (sources, parsers, i18n, known debt §9).

## What to port
- **Setup card** → 4-step accordion (project · topics/keywords chips · research purpose 2-cards trend/market · scope region+period+estimate). All-open default; collapse to summary.
- **Started** → in-place Handoff (crawling). Report renders in fullview.
- **Report fullview** → scroll-spy nav + AI judgment log + expanded-keyword chips + section cards (Executive/Findings/**Quant table**/**RQ cards**/Appendix) + Export. **market mode = different shape** (KPI hero + reference-data warning + size-tier/revenue/outlook/sources).

## Port order (suggested)
1. Card frame + shell (shared; see Probing §1).
2. Setup steps 1–4, all §3 states — **note the large banner set** (stuck/error/timeout/fallback/raw-dump/done-empty/cancelled/skipped).
3. State machine + crawl progress.
4. Report: judgment log + section cards (trend); RQ + quant tables.
5. market-mode shape; prior-jobs dropdown (hydration).

## Resolve BEFORE logic (§5)
- ⚠️ trend vs market report shapes · ⚠️ RQ answers · ⚠️ quant claims + tier · ⚠️ judgment log · ⚠️ country scope · ⚠️ prior-jobs dropdown · ⚠️ 300s deadline/refund/cancel · ⚠️ revenue/KPI structured values

## Done when
- [ ] All §3 states render — including every banner (stuck · error · timeout · fallback · raw-dump · done-empty · cancelled · skipped · disabled).
- [ ] Every visual matches a §1 class / measured value.
- [ ] `proposed-token:` (§2) mapped or raised (incl. `signal-warning-*`, `fg-amore-deep`, section accent set, RQ `info`).
- [ ] Every `⚠️ contract-change:` (§5) resolved with the writer.
- [ ] **cyan vs sky** header decided (§6). · Source auto-select preserved (no picker). · i18n ko/en/ja/th parity incl. hardcoded market labels.
