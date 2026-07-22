# RECRUITING-SCHEDULING — Handoff entry point (Claude Design → repo)

> **Feature:** recruiting-scheduling **redesign** (flat editorial legacy → Memphis system) for all 3 screens + new sub-states. **Date:** 2026-07-22. **CD = visual SSOT.**
> **Source brief:** `uploads/CONTEXTFORCD.md` (writer's legacy extraction). This bundle answers it with the new design.
> **Delta bundle.** Assumes repo already has: `CONTEXT-PACK.md`, `tokens.json`, `WIDGET-SHELL.md`, `FULLVIEW-SHELL.md`, `CD-DELIVERABLE-RULES.md`, `docs/DESIGN_SYSTEM_CURRENT.md`.

## What's in this bundle
| File | Role |
|---|---|
| `recruiting-scheduling/HANDOFF.md` | this — read first |
| `recruiting-scheduling/BUILD-SPEC.md` | §1 class map · §2 tokens · §3 state matrix · §4 interaction · **§5 contract-change (READ — data-contract shifts)** · §6 open items |
| `recruiting-scheduling/Recruiting Scheduling Redesign.dc.html` | visual SSOT — 7 static frames. Inline hex = render-only; bind to tokens, never copy hex. |
| `recruiting-scheduling/support.js` | local runtime to open the `.dc.html`. Not a build artifact. |

## ⚠️ This redesign introduces NEW elements not in the legacy code
The worker must **build these fresh** (not skin an existing component). All are detailed in BUILD-SPEC §5 as `⚠️ contract-change:` because they change data/flow, not just visuals:
1. **Master schedule link** — replaces per-candidate unique tokens (`/schedule/[token]`) with ONE project-shared link (`/schedule/<project>`). (Writer already flagged this as in-flight in CONTEXTFORCD §5.8.)
2. **Phone gate** — participant entry screen: last-6-digits identity match against the shared link (extends existing `participant-phone-gate.tsx` from a block gate to the primary identity step).
3. **By-group view** — the "By group" tab was speced (§1b group picker) but had no dedicated screen; now a grouped-section roster (batches + inbox).
4. **Chat reach sub-picker** — All / Group / Individual now reveal a sub-target (none / group Select / candidate Select). Legacy had a bare `Select w-40`; redesign makes the reveal explicit per reach.
5. **Slot title (natural language)** — free-text title field in the slot editor (legacy had `title Input`; redesign elevates it to the top, shown on participant schedule + calendar block).

## Read order (worker)
1. This file → the 5 new elements above.
2. `BUILD-SPEC §5` — the contract-changes; **confirm data/endpoint impact with writer before building** (esp. #1/#2 = token→shared-link+phone identity).
3. `BUILD-SPEC §3` — the 7 frames/states.
4. `Recruiting Scheduling Redesign.dc.html` — pixel reference.
5. Diff your TSX class list against `§1` + `docs/DESIGN_SYSTEM_CURRENT.md` / `tokens.json`; resolve `§2` proposed-tokens.

## Rules (unchanged — CD-DELIVERABLE-RULES.md)
1. Utility class / token only — raw hex/px = drift; new value → `proposed-token:` (§2).
2. Conformance-first — every visual element = explicit class (worker diffs).
3. All states static (§3) — build each; don't infer.
4. Contract-outside-spec → `⚠️ contract-change:` (§5), never silent invention.
5. Build **fresh** per CD; reuse **logic/data only** (`@/lib/scheduling/*`, hooks, endpoints per CONTEXTFORCD §7). Do NOT re-skin the legacy flat components — replace them. Preserve every contract in CONTEXTFORCD §5.
