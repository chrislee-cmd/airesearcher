# FULLVIEW — Handoff entry point (Claude Design → repo)

> **Feature:** Widget **fullview** surface (expanded view opened via `⤢`) for all 6 widgets. **Date:** 2026-07-22. **CD = visual SSOT.**
> This bundle is a **delta**. It assumes the repo already has: `CONTEXT-PACK.md`, `tokens.json`, `WIDGET-SHELL.md`, `CD-DELIVERABLE-RULES.md`, and the per-feature folders. It adds the **fullview shell** (a peer of WIDGET-SHELL) + one static comp gallery.

## What's in this bundle
| File | Role |
|---|---|
| `FULLVIEW-SHELL.md` *(bundle root → commit next to WIDGET-SHELL.md)* | **The contract.** §F class-map, existing-token map (§F5), proposed-tokens (§F6), contract-notes (§F7). Diff target. |
| `fullview/BUILD-SPEC.md` | §1 class-map pointer · §3 state matrix (9 states) · §4 interaction disclaimer · §5 contract-change · §6 open items. |
| `fullview/Widget Fullview Comps.dc.html` | **Visual reference.** 9 static state frames. Inline hex = render-only; bind to FULLVIEW-SHELL classes, never copy hex. |
| `fullview/support.js` | Runtime to open the `.dc.html` locally. Not a build artifact. |

## Read order (worker)
1. `FULLVIEW-SHELL.md` — the fullview shell + token vocab (inherits WIDGET-SHELL authority model).
2. `fullview/BUILD-SPEC.md §3` — the 9 states to build (all static; interaction is yours to wire).
3. `Widget Fullview Comps.dc.html` — pixel reference per state.
4. Diff your TSX class list against `FULLVIEW-SHELL §F1–F4`; resolve every §F6 `proposed-token`; confirm §F7 decisions with writer.

## Rules (unchanged — see CD-DELIVERABLE-RULES.md)
1. Utility class / token only — raw hex/px = drift; new value → `proposed-token:` (§F6).
2. Conformance-first — every visual element = explicit class (worker diffs).
3. All states static (§3) — build each; don't infer.
4. Contract-outside-spec → `⚠️ contract-change:` (§5), never silent invention.
5. Build **fresh** per CD; reuse **logic/data only**; do NOT edit legacy UI. Sidebar = one shared component (§F7.3), like `<WidgetShell>`.
