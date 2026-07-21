# Outbound Handoff → CD: Desk Research Widget

> **Direction: writer → CD (design request).** This gives you the context + data contract to design the **Desk Research** widget. The **setup card is already done** (matches the unified V2 shell); the big design surface left is the **report full-view**. Design it standalone in your `.dc.html` per the CD deliverable rules (`design-handoff/CD-DELIVERABLE-RULES.md`).

## What Desk Research is
An automated web/stats/filings research widget on the research canvas. User enters project + keywords + a research purpose, it crawls sources, and produces a structured report. Two purposes:
- **Trend research** — qualitative trend report (~7 sections).
- **Market research** — market sizing/competitive report (~6 sections) + revenue/KPI data + country scope.

Credit **💎75**. Header pastel **cyan `#bfe9ef`**. Shares the **unified V2 shell** (see `design-handoff/README.md` frame spec + `Widgets Canvas 1c.dc.html` — the Desk Research row). Do not re-derive the shell; the report full-view should feel like the same system (ink 3px frame, single toolbar pill, Outfit 800 headers, etc.).

## Flow (states)
1. **Setup** (DONE — 4-step accordion: ①project ②topics/keywords chips ③purpose 2-card trend↔market ④scope: region+period+estimate; market adds country-scope KR/Global). Already built matching the shell.
2. **Started / crawling** — in-place handoff ("Please check the full view"), progress while it researches. **300s deadline** with refund + cancel.
3. **Report full-view** ⭐ — **THE main design ask** (below).
4. **Runtime edge states** to also design: `stuck` · `error` · `timeout` · `fallback` (partial) · `raw-dump` (unparsed) · `done-empty` · `cancelled` · `skipped` · `disabled`.

---

## ⭐ Report full-view — data contract (design around these shapes)

The report is a **structured markdown parsed into sections**. Design a scrollable report with a **scroll-spy section nav**. Sections (by icon/kind):

| Section | Icon | Content |
|---|---|---|
| **Findings** | 📝 | topic sub-sections (each = title + emphasis large/medium/small + body). Design a **TopicCard**. |
| **Research Questions & Findings** | ❓ | RQ answers — design an **RQ card** per the shape below. |
| **Quantitative Snapshots** | 📊 | quant claims, each with a **sourcing tier T1/T2/T3** badge. |
| **Competitive / Market Map** | 🏢 | keyword sub-sections (competitors/market entities). |
| **Caveats** | ⚠️ | limitations/disclaimers. |
| **Appendix — Sources** | 📚 | source list grouped by tier **T1 / T2 / T3**. |

**RQ answer shape** (design a card for this):
```
{ id, question, category, importance, confidence, answer, missing_data }
```
- `importance` / `confidence` → design as badges/levels. `missing_data` → a "data gap" treatment.

**Quant claim** → value + a **tier badge (T1 primary / T2 secondary / T3 weak)**.

**AI judgment log** — a marker-filtered reasoning log (why the AI concluded X). Design a collapsible/aside **judgment log** panel.

**Market mode adds:**
- **Revenue / KPI** — structured series (revenue, growth, market size). Design a **revenue/KPI chart + dataset table**.
- **Country scope** — KR vs Global toggle affects the market data shown.

**Section accents** — each section kind has an accent token (design a per-kind color accent set — align to the widget's cyan family + the system tokens; propose tokens where needed).

---

## Component boundaries (presentation vs container)
- **CD designs (presentation):** report layout, scroll-spy nav, section cards, TopicCard, RQ card, quant + tier badges, appendix (T1/T2/T3), AI judgment log, revenue/KPI chart, all runtime states. Typed props only, no data fetching.
- **Worker wires (container):** parses the report markdown into sections (`desk-report-parser`), fetches job data, handles states/deadline/cancel, binds the data to your presentation. Existing logic — you don't design data flow.

## What to deliver (per CD-DELIVERABLE-RULES.md)
- `Widgets Canvas 1c.dc.html` with the **Desk Research report full-view + every runtime state** as static columns (renders standalone via support.js).
- Exact tokens (no arbitrary hex — promote to tokens; the widget uses cyan `#bfe9ef` header + the system ink/accent palette). Propose new tokens (`proposed-token`) where the report needs colors the system lacks (e.g. tier badges, section accents, confidence levels).
- All states drawn (findings/RQ/quant/market variants + stuck/error/timeout/fallback/empty/cancelled).
- README + BUILD-SPEC per the rules; align the shell to the unified system (don't invent a new frame).

## Reference in repo (for your context)
- Unified system SSOT: `design-handoff/README.md` + `design-handoff/Widgets Canvas 1c.dc.html` (Desk Research row) + `design-handoff/Icon System.dc.html`.
- Deliverable rules: `design-handoff/CD-DELIVERABLE-RULES.md`.
- (Setup already built to match — the report full-view is the new surface.)

## Open question for the user (flag if unsure)
- Report full-view = **modal/expanded panel** vs an in-canvas expanded card? (Other widgets use an "Open Fullview →" that expands.) Design for the fullview/expanded surface; confirm dimensions with the user if needed.
