# FULLVIEW — BUILD-SPEC

> **Consumes:** `FULLVIEW-SHELL.md` (class-map + tokens), `WIDGET-SHELL.md` (authority + §S3 identity), `tokens.json`, `CONTEXT-PACK.md`. **CD SSOT:** `Widget Fullview Comps.dc.html`. **Date:** 2026-07-22.

## §1 Class map — see FULLVIEW-SHELL.md
The full class-map lives in `FULLVIEW-SHELL.md §F1–F4` (shell geometry, sidebar, header, per-screen body). §F5 = existing-token drop-ins; §F6 = proposed-tokens to promote. **Diff your component's class list against §F.** Do not duplicate the table here — one SSOT.

## §2 proposed-tokens — see FULLVIEW-SHELL.md §F6
All intentional new values (colors, shadows, radii, type) are listed there with names + values. Writer decides promote-vs-reuse. Do NOT hardcode.

## §3 State matrix (all STATIC — build each)
| # | Screen | State | Notes |
|---|---|---|---|
| 01 | Probing | Live probing | persona grid (filled/partial/empty tiers) + thinking/history rail |
| 02 | Probing | Spotlight | high-importance question modal over blurred backdrop (scrim `ink/34`) |
| 03 | Interpreter | Streaming | twin INPUT/OUTPUT panels (flex:1 each = 389px @1400) + right rail (audio toggle · observer link · listeners) |
| 04 | Transcript | File list | rows: done / processing / (failed variant per §F4) |
| 05 | Transcript | Detail | turns + right rail (export · AI summary · themes) |
| 06 | AI UT | Live | screen monitor (dark chrome) + task card + think-aloud stream |
| 07 | AI UT | Review | insight report + key clips + behavioral metrics (estimated=opacity-50) |
| 08 | Recruiting | Responses | criteria + distribution crosstab + judged table (fit High/Med/Low) |
| 09 | Desk | Report | scroll-spy nav + judgment log + section cards (exec/find/quant/rq/appx) |
> Not yet drawn (worker: request from CD if needed): empty/error/loading for list & report; observer-link copied toast; project-dropdown open.

## §4 Interaction disclaimer (static comps)
Comps disclose states, not behavior. Worker owns: sidebar widget-switch (keeps session alive), project dropdown, transcript list↔detail, AI UT live↔review, desk scroll-spy, copy/pin/export actions. The `onClick`/toggles from the interactive proto are **not** in these comps by design.

## §5 ⚠️ contract-change (confirm before build)
- **§F7.1 mono labels** — fullview uses `ui-monospace` for technical captions/timestamps/IDs/table headers; DS default is non-mono. → `proposed:font-mono-label` OR map to `font-sans`. **Writer decision.**
- **§F7.2 fluid width** — 1400×840 is proto; canvas/grid owns final W/H. Keep among-parts proportions (sidebar 240 fixed · twin panels flex:1 · right rails 300–340 fixed). Intrinsic styling absolute.
- **Sidebar item set** — comps show 6 widgets (Probing/Interpreter/Transcript/AI UT/Recruiting/Desk). Confirm live set + per-widget badge (LIVE/DONE/PREVIEW) source.
- **End-session / close semantics** — `⚠️ contract-change:` if fullview close/end differs from card behavior.

## §6 Open items (inherited)
- Desk header tone: `cyan #bfe9ef` vs unify-with-sky (§F6 · desk spec §6).
- Interpreter credit 50 vs 75 (WIDGET-SHELL §S3).
- Transcript failed-row + processing-progress source data.
