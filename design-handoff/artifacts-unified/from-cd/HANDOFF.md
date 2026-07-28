# ARTIFACTS-UNIFIED — Handoff (Claude Design → repo)

> **Bundle:** two new surfaces (unified deliverables library · share view shell) + a document spec the brief deferred. **Date:** 2026-07-28. **Inbound brief:** `CD BRIEF — 산출물 통합` (writer, 2026-07-28).
> **Destination:** `design-handoff/artifacts-unified/from-cd/`.
> **⚠️ This bundle also ships a token-set upgrade.** Read `TOKEN-DECISIONS.md` before touching any component.

## Contents
| File | Role |
|---|---|
| `HANDOFF.md` | this — read first |
| **`tokens.json`** | **v2.0 — CD-authored. Supersedes the 1.x snapshot. `globals.css` reconciles TO this.** |
| **`TOKEN-DECISIONS.md`** | what changed vs 1.x, why, and what the worker must do |
| `deliverables-library.dc.html` + `-BUILD-SPEC.md` | Surface A · 5 frames, 9 states |
| `share-shell.dc.html` + `-BUILD-SPEC.md` | Surface B · 4 frames, 7 states |
| `export-documents.dc.html` + `-BUILD-SPEC.md` | exported document layouts (unsolicited — see below) |
| `GEOMETRY.md` | measured geometry for all three surfaces |
| `support.js` | local runtime to open the `.dc.html` files. Not a build artifact. |

## Read order
1. **`TOKEN-DECISIONS.md`** → `tokens.json`. Four conflicts were resolved as CD decisions; nine families were added. Building against 1.x will produce drift.
2. `deliverables-library-BUILD-SPEC.md` §5 and `share-shell-BUILD-SPEC.md` §5 — the `⚠️ contract-change:` items. Two of them **block** wiring (`meta` display contract, processing progress field).
3. §3 state matrices — build every state; none are inferred.
4. The `.dc.html` files as pixel reference. **Inline hex in them is render-only** — bind to the token in §1, never copy the hex.

## What was designed
**Surface A — deliverables library.** 240px filter rail + list/grid of `DeliverableRow`. The shared 4-state status badge is the mechanism of unification: identical visuals in every feature, never re-worded per feature. Frame A2 is not a screen — it is the status × action enable/disable/hide matrix, drawn so it can be diffed.

**Surface B — share view shell.** Public read-only chrome, feature-blind. B1 and B2 are the same chrome with a transcript body and a desk-report body; that pair is the conformance proof. Dead-end states deliberately drop the feature tone.

**Exported documents (added).** The brief defers the export registry, so nothing said what a downloaded file looks like. Left unspecified, three features would each invent a document. §1 of that spec — the print translation table — is the load-bearing part: the Memphis screen system must not be applied to paper unchanged.

## Two CD decisions worth flagging
1. **Dead-end share states are neutral, not toned.** A pastel band on an expired link reads as a working page in a different colour.
2. **`not_found` and `deleted` render the same screen.** A public page should not confirm whether a token ever existed. If product disagrees, that is an information-disclosure decision — raise it (`share-shell-BUILD-SPEC.md §5.1`).

## Rules followed (CD-DELIVERABLE-RULES.md)
1. Token/class only — **zero `proposed-token`s remain**; everything previously proposed is promoted in `tokens.json` 2.0.
2. Conformance-first — every visual element carries an explicit class or a measured value.
3. All states static — 16 states across the three surfaces.
4. Contract-outside-spec surfaced as `⚠️ contract-change:`, never invented silently.
5. Interaction limits stated; nothing is wired.
